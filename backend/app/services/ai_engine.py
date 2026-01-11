"""
AI Engine Service - Claude-powered data extraction and content generation.

Uses Anthropic's Claude API to:
1. Extract and normalize business data from scraped sources
2. Fill gaps in missing data
3. Generate website content
"""

import json
from typing import Optional, Any

import httpx
import structlog
from anthropic import AsyncAnthropic

from app.config import settings
from app.models import (
    ScrapeResult,
    ExtractedBusinessData,
    BusinessType,
    Service,
    Testimonial,
    ContactInfo,
    SocialMedia,
    BusinessHours,
)

logger = structlog.get_logger()


class AIEngineService:
    """AI-powered data extraction and content generation."""
    
    def __init__(self):
        self.client = AsyncAnthropic(api_key=settings.anthropic_api_key)
        self.model = "claude-sonnet-4-20250514"
    
    async def extract_business_data(
        self,
        scrape_result: ScrapeResult,
        business_name: str,
        on_progress: Optional[callable] = None,
    ) -> ExtractedBusinessData:
        """
        Extract and normalize business data from scraped sources.
        
        Uses Claude to intelligently merge data from multiple sources
        and fill in gaps where possible.
        """
        if on_progress:
            await on_progress("extracting", "Analyzing scraped data with AI...", 40)
        
        # Build the prompt with all scraped data
        prompt = self._build_extraction_prompt(scrape_result, business_name)
        
        try:
            response = await self.client.messages.create(
                model=self.model,
                max_tokens=4096,
                messages=[
                    {"role": "user", "content": prompt}
                ],
                system=self._get_extraction_system_prompt(),
            )
            
            # Parse the response
            content = response.content[0].text
            
            # Extract JSON from response
            extracted = self._parse_json_response(content)
            
            if on_progress:
                await on_progress("extracting", "Data extracted successfully", 50)
            
            # Convert to Pydantic model
            return self._to_business_data(extracted, scrape_result)
            
        except Exception as e:
            logger.exception("Extraction failed", error=str(e))
            # Return minimal data on failure
            return ExtractedBusinessData(
                business_name=business_name,
                data_quality_score=0,
                missing_fields=["all"],
            )
    
    async def fill_gaps(
        self,
        data: ExtractedBusinessData,
        on_progress: Optional[callable] = None,
    ) -> ExtractedBusinessData:
        """
        Fill gaps in extracted data using AI-generated content.
        
        Only generates content that can be reasonably inferred
        from the existing data.
        """
        if data.data_quality_score >= 70 and not data.missing_fields:
            return data
        
        if on_progress:
            await on_progress("extracting", "Filling data gaps with AI...", 55)
        
        prompt = self._build_gap_fill_prompt(data)
        
        try:
            response = await self.client.messages.create(
                model=self.model,
                max_tokens=2048,
                messages=[
                    {"role": "user", "content": prompt}
                ],
                system=self._get_gap_fill_system_prompt(),
            )
            
            content = response.content[0].text
            gap_data = self._parse_json_response(content)
            
            # Merge gap-filled data
            data = self._merge_gap_data(data, gap_data)
            
            if on_progress:
                await on_progress("extracting", "Data gaps filled", 60)
            
            return data
            
        except Exception as e:
            logger.warning("Gap filling failed", error=str(e))
            return data
    
    def _build_extraction_prompt(
        self,
        scrape_result: ScrapeResult,
        business_name: str,
    ) -> str:
        """Build the extraction prompt with scraped data."""
        
        sources_text = ""
        for source, data in scrape_result.raw_data.items():
            sources_text += f"\n\n=== {source.upper()} DATA ===\n"
            sources_text += json.dumps(data, indent=2, default=str)[:8000]
        
        return f"""Extract and normalize business information for "{business_name}".

SCRAPED DATA FROM MULTIPLE SOURCES:
{sources_text}

Return a JSON object with this exact structure:
{{
  "business_name": "Official business name",
  "tagline": "Short catchy tagline",
  "description_short": "1-2 sentence description",
  "description_long": "2-3 paragraph detailed description",
  "business_type": "restaurant|trades|professional|retail|creative|health|general",
  "year_established": "Year or null",
  "services": [
    {{"name": "Service name", "description": "Description", "icon": "emoji"}}
  ],
  "unique_selling_points": ["USP 1", "USP 2", "USP 3"],
  "contact": {{
    "phone": "Phone number",
    "email": "Email address",
    "address": "Full address",
    "website": "Website URL"
  }},
  "social_media": {{
    "facebook": "Facebook URL",
    "instagram": "Instagram URL",
    "twitter": "Twitter URL",
    "linkedin": "LinkedIn URL"
  }},
  "hours": {{
    "monday": "9am - 5pm",
    "tuesday": "9am - 5pm"
  }},
  "testimonials": [
    {{"quote": "Review text", "author": "Name", "rating": 5, "source": "Google"}}
  ],
  "rating": 4.5,
  "review_count": 47,
  "data_quality_score": 75,
  "sources_used": ["google", "website"],
  "missing_fields": ["email", "hours"]
}}

IMPORTANT:
- Only include data that is actually found in the sources
- Do not invent factual claims (phone numbers, addresses, etc.)
- You CAN enhance descriptions and create taglines based on available info
- Mark missing fields in the missing_fields array
- Return ONLY valid JSON, no explanation"""

    def _get_extraction_system_prompt(self) -> str:
        """System prompt for data extraction."""
        return """You are a business data extraction specialist. Your task is to analyze scraped data from multiple sources and extract normalized, structured business information.

Key responsibilities:
1. Extract factual information accurately (names, addresses, phone numbers)
2. Identify the business type from context
3. Consolidate reviews and testimonials
4. Note which data sources were used
5. Calculate a data quality score (0-100) based on completeness
6. List any missing critical fields

NEVER invent factual data like phone numbers, addresses, or specific claims.
You CAN enhance descriptions, create taglines, and generate USPs based on available information.

Always return valid JSON matching the requested schema."""

    def _get_gap_fill_system_prompt(self) -> str:
        """System prompt for gap filling."""
        return """You are a professional copywriter for small business websites. Your task is to generate realistic content to fill gaps in business data.

Rules:
1. NEVER invent factual claims not supported by existing data
2. For services, expand with typical services for the business type
3. Keep tone professional but friendly
4. Generate content that sounds authentic and natural
5. If business is a "plumber", you can list typical plumbing services
6. USPs should be based on context clues from the data

Return only the fields that need to be generated, as valid JSON."""

    def _build_gap_fill_prompt(self, data: ExtractedBusinessData) -> str:
        """Build prompt for gap filling."""
        return f"""Business: {data.business_name}
Type: {data.business_type.value}
Current data: {data.model_dump_json(indent=2)}

Missing or weak fields: {data.missing_fields}

Generate content for the missing/weak fields only.
Return a JSON object with just those fields filled in."""

    def _parse_json_response(self, content: str) -> dict:
        """Parse JSON from Claude's response."""
        # Try to extract JSON from markdown code blocks
        if "```json" in content:
            start = content.find("```json") + 7
            end = content.find("```", start)
            content = content[start:end].strip()
        elif "```" in content:
            start = content.find("```") + 3
            end = content.find("```", start)
            content = content[start:end].strip()
        
        # Clean up common issues
        content = content.strip()
        
        try:
            return json.loads(content)
        except json.JSONDecodeError as e:
            logger.warning("JSON parse error", error=str(e), content=content[:500])
            # Try to salvage partial JSON
            try:
                # Find the last complete object
                last_brace = content.rfind("}")
                if last_brace > 0:
                    return json.loads(content[:last_brace + 1])
            except:
                pass
            return {}

    def _to_business_data(
        self,
        extracted: dict,
        scrape_result: ScrapeResult,
    ) -> ExtractedBusinessData:
        """Convert extracted dict to Pydantic model."""
        
        # Parse business type
        business_type = BusinessType.GENERAL
        if extracted.get("business_type"):
            try:
                business_type = BusinessType(extracted["business_type"])
            except ValueError:
                pass
        
        # Parse services
        services = []
        for s in extracted.get("services", []):
            if isinstance(s, dict):
                services.append(Service(
                    name=s.get("name", "Service"),
                    description=s.get("description"),
                    icon=s.get("icon"),
                ))
            elif isinstance(s, str):
                services.append(Service(name=s))
        
        # Parse testimonials
        testimonials = []
        for t in extracted.get("testimonials", []):
            if isinstance(t, dict):
                testimonials.append(Testimonial(
                    quote=t.get("quote", t.get("text", "")),
                    author=t.get("author", t.get("author_name", "Customer")),
                    rating=t.get("rating"),
                    source=t.get("source"),
                ))
        
        # Parse contact
        contact_data = extracted.get("contact", {})
        contact = ContactInfo(
            phone=contact_data.get("phone"),
            email=contact_data.get("email"),
            address=contact_data.get("address"),
            website=contact_data.get("website"),
        )
        
        # Parse social media
        social_data = extracted.get("social_media", {})
        social_media = SocialMedia(
            facebook=social_data.get("facebook"),
            instagram=social_data.get("instagram"),
            twitter=social_data.get("twitter"),
            linkedin=social_data.get("linkedin"),
        )
        
        # Parse hours
        hours_data = extracted.get("hours", {})
        hours = BusinessHours(**hours_data) if hours_data else None
        
        return ExtractedBusinessData(
            business_name=extracted.get("business_name", "Business"),
            tagline=extracted.get("tagline"),
            description_short=extracted.get("description_short"),
            description_long=extracted.get("description_long"),
            business_type=business_type,
            year_established=extracted.get("year_established"),
            services=services,
            unique_selling_points=extracted.get("unique_selling_points", []),
            contact=contact,
            social_media=social_media,
            hours=hours,
            testimonials=testimonials,
            rating=extracted.get("rating"),
            review_count=extracted.get("review_count"),
            data_quality_score=extracted.get("data_quality_score", 50),
            sources_used=extracted.get("sources_used", list(scrape_result.raw_data.keys())),
            missing_fields=extracted.get("missing_fields", []),
        )

    def _merge_gap_data(
        self,
        data: ExtractedBusinessData,
        gap_data: dict,
    ) -> ExtractedBusinessData:
        """Merge gap-filled data into existing data."""
        
        # Update simple fields if missing
        if gap_data.get("tagline") and not data.tagline:
            data.tagline = gap_data["tagline"]
        
        if gap_data.get("description_short") and not data.description_short:
            data.description_short = gap_data["description_short"]
        
        if gap_data.get("description_long") and not data.description_long:
            data.description_long = gap_data["description_long"]
        
        # Extend services if gap-filled ones are better
        if gap_data.get("services"):
            gap_services = [
                Service(
                    name=s.get("name", "Service"),
                    description=s.get("description"),
                    icon=s.get("icon"),
                )
                for s in gap_data["services"]
                if isinstance(s, dict)
            ]
            if len(gap_services) > len(data.services):
                data.services = gap_services
        
        # Add USPs if missing
        if gap_data.get("unique_selling_points") and not data.unique_selling_points:
            data.unique_selling_points = gap_data["unique_selling_points"]
        
        # Recalculate quality score
        data.data_quality_score = min(100, data.data_quality_score + 15)
        data.missing_fields = [f for f in data.missing_fields if getattr(data, f, None)]
        
        return data
