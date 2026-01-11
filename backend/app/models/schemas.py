"""
Pydantic models for request/response validation.
"""

from datetime import datetime
from enum import Enum
from typing import Optional, Any
from pydantic import BaseModel, Field, HttpUrl


# ============================================================================
# Enums
# ============================================================================

class JobStatus(str, Enum):
    """Status of a website generation job."""
    PENDING = "pending"
    SCRAPING = "scraping"
    EXTRACTING = "extracting"
    GENERATING = "generating"
    DEPLOYING = "deploying"
    COMPLETED = "completed"
    FAILED = "failed"


class BusinessType(str, Enum):
    """Type of business for template selection."""
    RESTAURANT = "restaurant"
    TRADES = "trades"
    PROFESSIONAL = "professional"
    RETAIL = "retail"
    CREATIVE = "creative"
    HEALTH = "health"
    GENERAL = "general"


# ============================================================================
# Request Models
# ============================================================================

class JobCreateRequest(BaseModel):
    """Request to create a new website generation job."""
    business_name: str = Field(..., min_length=1, max_length=200)
    location: Optional[str] = Field(None, max_length=200)
    website_url: Optional[HttpUrl] = None
    facebook_url: Optional[HttpUrl] = None
    instagram_url: Optional[str] = None  # Can be URL or @handle
    client_email: Optional[str] = None
    template_preference: Optional[str] = None
    
    class Config:
        json_schema_extra = {
            "example": {
                "business_name": "Acme Coffee Shop",
                "location": "San Francisco, CA",
                "website_url": "https://acmecoffee.com",
                "facebook_url": "https://facebook.com/acmecoffee",
                "instagram_url": "@acmecoffee"
            }
        }


class DeployRequest(BaseModel):
    """Request to deploy a generated website."""
    custom_domain: Optional[str] = None
    

# ============================================================================
# Business Data Models
# ============================================================================

class ContactInfo(BaseModel):
    """Contact information for a business."""
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    website: Optional[str] = None


class SocialMedia(BaseModel):
    """Social media links."""
    facebook: Optional[str] = None
    instagram: Optional[str] = None
    twitter: Optional[str] = None
    linkedin: Optional[str] = None
    youtube: Optional[str] = None


class Service(BaseModel):
    """A service offered by the business."""
    name: str
    description: Optional[str] = None
    price: Optional[str] = None
    icon: Optional[str] = None


class Testimonial(BaseModel):
    """Customer testimonial/review."""
    quote: str
    author: str
    rating: Optional[float] = None
    source: Optional[str] = None
    date: Optional[str] = None


class BusinessHours(BaseModel):
    """Business operating hours."""
    monday: Optional[str] = None
    tuesday: Optional[str] = None
    wednesday: Optional[str] = None
    thursday: Optional[str] = None
    friday: Optional[str] = None
    saturday: Optional[str] = None
    sunday: Optional[str] = None


class ExtractedBusinessData(BaseModel):
    """Normalized business data extracted from all sources."""
    business_name: str
    tagline: Optional[str] = None
    description_short: Optional[str] = None
    description_long: Optional[str] = None
    business_type: BusinessType = BusinessType.GENERAL
    year_established: Optional[str] = None
    
    services: list[Service] = []
    unique_selling_points: list[str] = []
    
    contact: ContactInfo = ContactInfo()
    social_media: SocialMedia = SocialMedia()
    hours: Optional[BusinessHours] = None
    
    testimonials: list[Testimonial] = []
    rating: Optional[float] = None
    review_count: Optional[int] = None
    
    images: list[str] = []
    logo_url: Optional[str] = None
    
    # Metadata
    data_quality_score: int = 0
    sources_used: list[str] = []
    missing_fields: list[str] = []


# ============================================================================
# Scraping Models
# ============================================================================

class ScrapedSource(BaseModel):
    """Data from a single scraped source."""
    source: str  # 'google', 'website', 'facebook', 'instagram'
    success: bool
    data: Optional[dict[str, Any]] = None
    error: Optional[str] = None


class ScrapeResult(BaseModel):
    """Result of scraping all sources."""
    sources: list[ScrapedSource]
    raw_data: dict[str, Any]


# ============================================================================
# Generation Models
# ============================================================================

class GeneratedSite(BaseModel):
    """A generated website ready for deployment."""
    html: str
    css: Optional[str] = None
    js: Optional[str] = None
    assets: list[str] = []
    
    # Metadata
    template_used: str
    sections_included: list[str]
    generation_time_ms: int


# ============================================================================
# Deployment Models
# ============================================================================

class DeploymentResult(BaseModel):
    """Result of deploying to Vercel."""
    deployment_id: str
    url: str
    production_url: str
    status: str
    dns_records: Optional[list[dict]] = None


# ============================================================================
# Job Models
# ============================================================================

class JobProgress(BaseModel):
    """Progress update for a job."""
    stage: str
    message: str
    progress_percent: int
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class Job(BaseModel):
    """A website generation job."""
    id: str
    status: JobStatus
    created_at: datetime
    updated_at: datetime
    
    # Input
    request: JobCreateRequest
    
    # Progress
    progress: list[JobProgress] = []
    current_stage: Optional[str] = None
    
    # Results (populated as job progresses)
    scrape_result: Optional[ScrapeResult] = None
    extracted_data: Optional[ExtractedBusinessData] = None
    generated_site: Optional[GeneratedSite] = None
    deployment: Optional[DeploymentResult] = None
    
    # Error handling
    error: Optional[str] = None
    error_details: Optional[dict] = None


# ============================================================================
# Response Models
# ============================================================================

class JobResponse(BaseModel):
    """API response for job operations."""
    job: Job
    message: str = "Success"


class JobListResponse(BaseModel):
    """API response for listing jobs."""
    jobs: list[Job]
    total: int
    page: int
    page_size: int


class HealthResponse(BaseModel):
    """Health check response."""
    status: str = "healthy"
    version: str
    environment: str
    services: dict[str, bool]


class ErrorResponse(BaseModel):
    """Error response."""
    error: str
    detail: Optional[str] = None
    code: Optional[str] = None
