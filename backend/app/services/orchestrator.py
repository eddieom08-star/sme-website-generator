"""
Website Generator Orchestrator - Coordinates the full generation pipeline.

Pipeline:
1. Scrape all sources (parallel)
2. Extract & normalize data with AI
3. Fill gaps if needed
4. Generate website
5. (Optional) Deploy to Vercel
"""

from typing import Optional, Callable, Awaitable
from dataclasses import dataclass

import structlog

from app.models import (
    JobCreateRequest,
    ScrapeResult,
    ExtractedBusinessData,
    GeneratedSite,
)
from app.services.scraper import ScraperService
from app.services.ai_engine import AIEngineService
from app.services.website_generator import WebsiteGeneratorService

logger = structlog.get_logger()


@dataclass
class OrchestrationResult:
    """Result of the orchestration pipeline."""
    scrape_result: ScrapeResult
    extracted_data: ExtractedBusinessData
    generated_site: GeneratedSite


ProgressCallback = Callable[[str, str, int], Awaitable[None]]


class WebsiteGeneratorOrchestrator:
    """Orchestrates the complete website generation pipeline."""
    
    def __init__(self):
        self.scraper = ScraperService()
        self.ai_engine = AIEngineService()
        self.generator = WebsiteGeneratorService()
    
    async def run(
        self,
        request: JobCreateRequest,
        on_progress: Optional[ProgressCallback] = None,
    ) -> OrchestrationResult:
        """
        Run the complete website generation pipeline.
        
        Args:
            request: The job creation request with business info
            on_progress: Optional callback for progress updates
        
        Returns:
            OrchestrationResult with all pipeline outputs
        """
        logger.info("Starting orchestration", business=request.business_name)
        
        # Default progress callback
        if on_progress is None:
            async def on_progress(stage: str, message: str, percent: int):
                logger.info(f"[{percent}%] {stage}: {message}")
        
        # Step 1: Scrape all sources
        await on_progress("scraping", "Starting data collection...", 5)
        scrape_result = await self.scraper.scrape_all(
            request=request,
            on_progress=on_progress,
        )
        
        # Log scrape results
        successful_sources = [s.source for s in scrape_result.sources if s.success]
        logger.info(
            "Scraping complete",
            successful=successful_sources,
            total=len(scrape_result.sources),
        )
        
        # Step 2: Extract & normalize data
        await on_progress("extracting", "Analyzing data with AI...", 35)
        extracted_data = await self.ai_engine.extract_business_data(
            scrape_result=scrape_result,
            business_name=request.business_name,
            on_progress=on_progress,
        )
        
        logger.info(
            "Extraction complete",
            quality_score=extracted_data.data_quality_score,
            services=len(extracted_data.services),
            testimonials=len(extracted_data.testimonials),
        )
        
        # Step 3: Fill gaps if needed
        if extracted_data.data_quality_score < 70 or extracted_data.missing_fields:
            await on_progress("extracting", "Enhancing data...", 55)
            extracted_data = await self.ai_engine.fill_gaps(
                data=extracted_data,
                on_progress=on_progress,
            )
            
            logger.info(
                "Gap filling complete",
                new_quality_score=extracted_data.data_quality_score,
            )
        
        # Step 4: Generate website
        await on_progress("generating", "Creating website design...", 65)
        generated_site = await self.generator.generate(
            data=extracted_data,
            on_progress=on_progress,
        )
        
        logger.info(
            "Generation complete",
            sections=generated_site.sections_included,
            time_ms=generated_site.generation_time_ms,
        )
        
        await on_progress("completed", "Website ready!", 100)
        
        return OrchestrationResult(
            scrape_result=scrape_result,
            extracted_data=extracted_data,
            generated_site=generated_site,
        )
