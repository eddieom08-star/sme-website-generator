"""
Scraper Service - Multi-source web scraping for business data.

Supports:
- Firecrawl for website content
- Apify for Facebook and Instagram
- Google Places API for business info
"""

import asyncio
from typing import Optional, Any
from urllib.parse import urlparse

import httpx
import structlog
from tenacity import retry, stop_after_attempt, wait_exponential

from app.config import settings
from app.models import ScrapedSource, ScrapeResult, JobCreateRequest

logger = structlog.get_logger()


class ScraperService:
    """Multi-source scraper for business information."""
    
    def __init__(self):
        self.timeout = httpx.Timeout(settings.scrape_timeout_seconds)
    
    async def scrape_all(
        self,
        request: JobCreateRequest,
        on_progress: Optional[callable] = None,
    ) -> ScrapeResult:
        """
        Scrape all available sources concurrently.
        
        Returns aggregated results from all sources.
        """
        tasks = []
        
        # Google Places (if location provided)
        if request.location:
            tasks.append(self._scrape_google_places(
                business_name=request.business_name,
                location=request.location,
            ))
        else:
            tasks.append(self._empty_result("google"))
        
        # Website (if URL provided)
        if request.website_url:
            tasks.append(self._scrape_website(str(request.website_url)))
        else:
            tasks.append(self._empty_result("website"))
        
        # Facebook (if URL provided)
        if request.facebook_url:
            tasks.append(self._scrape_facebook(str(request.facebook_url)))
        else:
            tasks.append(self._empty_result("facebook"))
        
        # Instagram (if handle/URL provided)
        if request.instagram_url:
            tasks.append(self._scrape_instagram(request.instagram_url))
        else:
            tasks.append(self._empty_result("instagram"))
        
        if on_progress:
            await on_progress("scraping", "Scraping data sources...", 10)
        
        # Run all scrapers concurrently
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Process results
        sources = []
        raw_data = {}
        
        source_names = ["google", "website", "facebook", "instagram"]
        for name, result in zip(source_names, results):
            if isinstance(result, Exception):
                sources.append(ScrapedSource(
                    source=name,
                    success=False,
                    error=str(result),
                ))
                logger.warning(f"Scraping {name} failed", error=str(result))
            else:
                sources.append(result)
                if result.success and result.data:
                    raw_data[name] = result.data
        
        if on_progress:
            successful = sum(1 for s in sources if s.success)
            await on_progress(
                "scraping",
                f"Scraped {successful}/{len(sources)} sources",
                30,
            )
        
        return ScrapeResult(sources=sources, raw_data=raw_data)
    
    async def _empty_result(self, source: str) -> ScrapedSource:
        """Return empty result for skipped sources."""
        return ScrapedSource(source=source, success=False, error="Not provided")
    
    # ========================================================================
    # Google Places
    # ========================================================================
    
    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def _scrape_google_places(
        self,
        business_name: str,
        location: str,
    ) -> ScrapedSource:
        """Scrape Google Places API for business information."""
        if not settings.google_places_api_key:
            return ScrapedSource(
                source="google",
                success=False,
                error="Google Places API key not configured",
            )
        
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            # Step 1: Find Place
            find_response = await client.get(
                "https://maps.googleapis.com/maps/api/place/findplacefromtext/json",
                params={
                    "input": f"{business_name} {location}",
                    "inputtype": "textquery",
                    "fields": "place_id,name,formatted_address",
                    "key": settings.google_places_api_key,
                },
            )
            find_data = find_response.json()
            
            if not find_data.get("candidates"):
                return ScrapedSource(
                    source="google",
                    success=False,
                    error="Business not found on Google",
                )
            
            place_id = find_data["candidates"][0]["place_id"]
            
            # Step 2: Get Place Details
            details_response = await client.get(
                "https://maps.googleapis.com/maps/api/place/details/json",
                params={
                    "place_id": place_id,
                    "fields": ",".join([
                        "name",
                        "formatted_address",
                        "formatted_phone_number",
                        "opening_hours",
                        "reviews",
                        "photos",
                        "website",
                        "types",
                        "editorial_summary",
                        "rating",
                        "user_ratings_total",
                    ]),
                    "key": settings.google_places_api_key,
                },
            )
            details_data = details_response.json()
            
            if "result" not in details_data:
                return ScrapedSource(
                    source="google",
                    success=False,
                    error="Failed to get place details",
                )
            
            logger.info("Google Places scraped", place_id=place_id)
            
            return ScrapedSource(
                source="google",
                success=True,
                data=details_data["result"],
            )
    
    # ========================================================================
    # Website (Firecrawl)
    # ========================================================================
    
    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def _scrape_website(self, url: str) -> ScrapedSource:
        """Scrape website content using Firecrawl."""
        if not settings.firecrawl_api_key:
            return ScrapedSource(
                source="website",
                success=False,
                error="Firecrawl API key not configured",
            )
        
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                "https://api.firecrawl.dev/v1/scrape",
                headers={
                    "Authorization": f"Bearer {settings.firecrawl_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "url": url,
                    "formats": ["markdown", "html"],
                    "onlyMainContent": True,
                },
            )
            
            if response.status_code != 200:
                return ScrapedSource(
                    source="website",
                    success=False,
                    error=f"Firecrawl error: {response.status_code}",
                )
            
            data = response.json()
            
            if not data.get("success"):
                return ScrapedSource(
                    source="website",
                    success=False,
                    error=data.get("error", "Unknown Firecrawl error"),
                )
            
            logger.info("Website scraped", url=url)
            
            return ScrapedSource(
                source="website",
                success=True,
                data=data.get("data", {}),
            )
    
    # ========================================================================
    # Facebook (Apify)
    # ========================================================================
    
    @retry(stop=stop_after_attempt(2), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def _scrape_facebook(self, url: str) -> ScrapedSource:
        """Scrape Facebook page using Apify."""
        if not settings.apify_api_token:
            return ScrapedSource(
                source="facebook",
                success=False,
                error="Apify API token not configured",
            )
        
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as client:
            response = await client.post(
                "https://api.apify.com/v2/acts/apify~facebook-pages-scraper/run-sync-get-dataset-items",
                params={"token": settings.apify_api_token},
                json={
                    "startUrls": [{"url": url}],
                    "maxPosts": 10,
                    "maxReviews": 10,
                },
            )
            
            if response.status_code != 200:
                return ScrapedSource(
                    source="facebook",
                    success=False,
                    error=f"Apify error: {response.status_code}",
                )
            
            data = response.json()
            
            # Apify returns an array
            if isinstance(data, list) and len(data) > 0:
                logger.info("Facebook scraped", url=url)
                return ScrapedSource(
                    source="facebook",
                    success=True,
                    data=data[0],
                )
            
            return ScrapedSource(
                source="facebook",
                success=False,
                error="No data returned from Facebook scrape",
            )
    
    # ========================================================================
    # Instagram (Apify)
    # ========================================================================
    
    @retry(stop=stop_after_attempt(2), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def _scrape_instagram(self, handle_or_url: str) -> ScrapedSource:
        """Scrape Instagram profile using Apify."""
        if not settings.apify_api_token:
            return ScrapedSource(
                source="instagram",
                success=False,
                error="Apify API token not configured",
            )
        
        # Extract username from URL or handle
        username = handle_or_url
        if "instagram.com" in handle_or_url:
            # Extract from URL
            parsed = urlparse(handle_or_url)
            path_parts = parsed.path.strip("/").split("/")
            if path_parts:
                username = path_parts[0]
        elif username.startswith("@"):
            username = username[1:]
        
        if not username:
            return ScrapedSource(
                source="instagram",
                success=False,
                error="Invalid Instagram handle",
            )
        
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as client:
            response = await client.post(
                "https://api.apify.com/v2/acts/apify~instagram-profile-scraper/run-sync-get-dataset-items",
                params={"token": settings.apify_api_token},
                json={
                    "usernames": [username],
                },
            )
            
            if response.status_code != 200:
                return ScrapedSource(
                    source="instagram",
                    success=False,
                    error=f"Apify error: {response.status_code}",
                )
            
            data = response.json()
            
            if isinstance(data, list) and len(data) > 0:
                logger.info("Instagram scraped", username=username)
                return ScrapedSource(
                    source="instagram",
                    success=True,
                    data=data[0],
                )
            
            return ScrapedSource(
                source="instagram",
                success=False,
                error="No data returned from Instagram scrape",
            )
