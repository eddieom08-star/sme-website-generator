"""
Configuration settings for the SME Website Generator.
Loads from environment variables with sensible defaults.
"""

from functools import lru_cache
from typing import Optional
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    # App
    app_name: str = "SME Website Generator"
    app_version: str = "1.0.0"
    debug: bool = False
    environment: str = "development"
    
    # API Keys
    anthropic_api_key: str
    firecrawl_api_key: str
    apify_api_token: str
    vercel_token: str
    google_places_api_key: Optional[str] = None
    
    # 21st.dev MCP (optional - falls back to built-in templates)
    twentyfirst_api_key: Optional[str] = None
    
    # Redis
    redis_url: str = "redis://localhost:6379"
    
    # Database (optional)
    database_url: Optional[str] = None
    
    # API Rate Limits
    max_concurrent_jobs: int = 5
    job_timeout_seconds: int = 300
    
    # Scraping
    scrape_timeout_seconds: int = 60
    max_retries: int = 3
    
    # Vercel
    vercel_team_id: Optional[str] = None
    
    # CORS
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:5173"]
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = False


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()


# Convenience exports
settings = get_settings()
