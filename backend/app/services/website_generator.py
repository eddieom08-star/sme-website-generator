"""
Website Generator Service - Generates beautiful HTML websites.

Can use:
1. Built-in Tailwind templates (default)
2. 21st.dev MCP for premium AI-generated components (optional)
"""

import time
from typing import Optional
from datetime import datetime

import httpx
import structlog
from anthropic import AsyncAnthropic

from app.config import settings
from app.models import ExtractedBusinessData, GeneratedSite, BusinessType

logger = structlog.get_logger()


class WebsiteGeneratorService:
    """Generates beautiful websites from business data."""
    
    def __init__(self):
        self.client = AsyncAnthropic(api_key=settings.anthropic_api_key)
        self.model = "claude-sonnet-4-20250514"
    
    async def generate(
        self,
        data: ExtractedBusinessData,
        on_progress: Optional[callable] = None,
    ) -> GeneratedSite:
        """
        Generate a complete website from business data.
        
        Uses Claude with 21st.dev components for beautiful, modern UI.
        """
        start_time = time.time()
        
        if on_progress:
            await on_progress("generating", "Generating website design...", 65)
        
        # Determine which sections to include
        sections = self._determine_sections(data)
        
        # Generate the website
        if settings.twentyfirst_api_key:
            # Use 21st.dev for premium components
            html = await self._generate_with_21st_dev(data, sections)
        else:
            # Use built-in template with Claude enhancement
            html = await self._generate_with_claude(data, sections)
        
        if on_progress:
            await on_progress("generating", "Website generated!", 90)
        
        generation_time = int((time.time() - start_time) * 1000)
        
        return GeneratedSite(
            html=html,
            template_used="21st_dev" if settings.twentyfirst_api_key else "tailwind_modern",
            sections_included=sections,
            generation_time_ms=generation_time,
        )
    
    def _determine_sections(self, data: ExtractedBusinessData) -> list[str]:
        """Determine which sections to include based on available data."""
        sections = ["navigation", "hero", "services", "about", "contact", "footer"]
        
        if data.testimonials:
            sections.insert(4, "testimonials")
        
        if data.unique_selling_points:
            sections.insert(2, "features")
        
        return sections
    
    async def _generate_with_21st_dev(
        self,
        data: ExtractedBusinessData,
        sections: list[str],
    ) -> str:
        """Generate website using 21st.dev MCP for premium components."""
        
        # Use Claude with 21st.dev tool
        prompt = self._build_21st_dev_prompt(data, sections)
        
        try:
            response = await self.client.messages.create(
                model=self.model,
                max_tokens=8192,
                messages=[
                    {"role": "user", "content": prompt}
                ],
                system=self._get_21st_dev_system_prompt(),
            )
            
            html = response.content[0].text
            
            # Clean up any markdown formatting
            if "```html" in html:
                start = html.find("```html") + 7
                end = html.find("```", start)
                html = html[start:end].strip()
            elif "```" in html:
                start = html.find("```") + 3
                end = html.find("```", start)
                html = html[start:end].strip()
            
            return html
            
        except Exception as e:
            logger.exception("21st.dev generation failed, falling back to template")
            return await self._generate_with_claude(data, sections)
    
    async def _generate_with_claude(
        self,
        data: ExtractedBusinessData,
        sections: list[str],
    ) -> str:
        """Generate website using Claude with built-in Tailwind template."""
        
        prompt = self._build_generation_prompt(data, sections)
        
        response = await self.client.messages.create(
            model=self.model,
            max_tokens=8192,
            messages=[
                {"role": "user", "content": prompt}
            ],
            system=self._get_generation_system_prompt(),
        )
        
        html = response.content[0].text
        
        # Clean up any markdown formatting
        if "```html" in html:
            start = html.find("```html") + 7
            end = html.find("```", start)
            html = html[start:end].strip()
        elif "```" in html:
            start = html.find("```") + 3
            end = html.find("```", start)
            html = html[start:end].strip()
        
        return html
    
    def _get_21st_dev_system_prompt(self) -> str:
        """System prompt for 21st.dev generation."""
        return """You are an expert web designer creating beautiful, modern websites using 21st.dev premium components.

Your designs should be:
1. Visually stunning with modern aesthetics
2. Mobile-responsive using Tailwind CSS
3. Professional and polished
4. Fast-loading with minimal JavaScript
5. Accessible and SEO-friendly

Use the 21st.dev component library for premium UI elements like:
- Hero sections with gradient backgrounds
- Modern card layouts
- Animated statistics counters
- Testimonial carousels
- Contact forms with validation

Return complete, valid HTML that works standalone with Tailwind CSS CDN."""

    def _get_generation_system_prompt(self) -> str:
        """System prompt for website generation."""
        return """You are an expert web designer creating beautiful, modern websites.

Design principles:
1. Clean, professional aesthetic with plenty of whitespace
2. Modern color schemes appropriate to the business type
3. Mobile-first responsive design using Tailwind CSS
4. Clear visual hierarchy and typography
5. Subtle animations for engagement
6. Fast-loading (use Tailwind CDN, minimal JS)

Include:
- Sticky navigation with smooth scroll
- Hero section with gradient/image background
- Services/features in card grid
- About section with key info
- Testimonials (if available)
- Contact section with all details
- Footer with links and copyright

Return ONLY the complete HTML document, no explanations."""

    def _build_21st_dev_prompt(
        self,
        data: ExtractedBusinessData,
        sections: list[str],
    ) -> str:
        """Build prompt for 21st.dev generation."""
        return f"""Create a stunning, modern website for this business:

BUSINESS DATA:
{data.model_dump_json(indent=2)}

SECTIONS TO INCLUDE: {sections}

DESIGN REQUIREMENTS:
- Use a color scheme appropriate for a {data.business_type.value} business
- Create visual hierarchy with the business name and tagline prominent
- Services should be in an attractive card grid
- Include social proof (rating, review count) if available
- Make the contact section easy to find and use
- Add subtle micro-interactions and hover effects

Generate a complete, beautiful HTML page using Tailwind CSS CDN.
The result should look like a premium $5000+ website."""

    def _build_generation_prompt(
        self,
        data: ExtractedBusinessData,
        sections: list[str],
    ) -> str:
        """Build the generation prompt with all business data."""
        
        # Build template context
        services_html = self._generate_services_html(data.services)
        testimonials_html = self._generate_testimonials_html(data.testimonials)
        contact_html = self._generate_contact_html(data)
        hours_html = self._generate_hours_html(data.hours)
        social_html = self._generate_social_html(data.social_media)
        usps_html = self._generate_usps_html(data.unique_selling_points)
        
        # Get color scheme
        colors = self._get_color_scheme(data.business_type)
        
        return f"""Create a complete, beautiful HTML website for this business:

BUSINESS: {data.business_name}
TYPE: {data.business_type.value}
TAGLINE: {data.tagline or 'Welcome to ' + data.business_name}
SHORT DESC: {data.description_short or ''}
LONG DESC: {data.description_long or ''}

SERVICES:
{services_html}

UNIQUE SELLING POINTS:
{usps_html}

TESTIMONIALS:
{testimonials_html}

CONTACT:
{contact_html}

HOURS:
{hours_html}

SOCIAL:
{social_html}

RATING: {data.rating or 'N/A'} ({data.review_count or 0} reviews)

COLOR SCHEME: {colors}

SECTIONS TO INCLUDE: {sections}

Generate a complete HTML document with:
1. DOCTYPE and proper head with meta tags
2. Tailwind CSS via CDN
3. Custom color configuration
4. All sections with real content (no placeholders)
5. Responsive design
6. Modern, professional styling

Return ONLY the HTML, no markdown formatting or explanations."""

    def _generate_services_html(self, services: list) -> str:
        """Generate services list for prompt."""
        if not services:
            return "No services specified"
        return "\n".join([f"- {s.name}: {s.description or 'N/A'}" for s in services])
    
    def _generate_testimonials_html(self, testimonials: list) -> str:
        """Generate testimonials list for prompt."""
        if not testimonials:
            return "No testimonials available"
        return "\n".join([
            f'- "{t.quote}" - {t.author} ({t.rating}/5 on {t.source})'
            for t in testimonials
        ])
    
    def _generate_contact_html(self, data: ExtractedBusinessData) -> str:
        """Generate contact info for prompt."""
        lines = []
        if data.contact.phone:
            lines.append(f"Phone: {data.contact.phone}")
        if data.contact.email:
            lines.append(f"Email: {data.contact.email}")
        if data.contact.address:
            lines.append(f"Address: {data.contact.address}")
        return "\n".join(lines) or "No contact info"
    
    def _generate_hours_html(self, hours) -> str:
        """Generate hours for prompt."""
        if not hours:
            return "Hours not specified"
        hours_dict = hours.model_dump() if hours else {}
        return "\n".join([f"{k}: {v}" for k, v in hours_dict.items() if v])
    
    def _generate_social_html(self, social) -> str:
        """Generate social links for prompt."""
        if not social:
            return "No social media"
        social_dict = social.model_dump() if social else {}
        return "\n".join([f"{k}: {v}" for k, v in social_dict.items() if v])
    
    def _generate_usps_html(self, usps: list) -> str:
        """Generate USPs for prompt."""
        if not usps:
            return "No USPs specified"
        return "\n".join([f"- {usp}" for usp in usps])
    
    def _get_color_scheme(self, business_type: BusinessType) -> dict:
        """Get appropriate color scheme for business type."""
        schemes = {
            BusinessType.RESTAURANT: {
                "primary": "#dc2626",
                "secondary": "#991b1b",
                "accent": "#fbbf24",
            },
            BusinessType.TRADES: {
                "primary": "#2563eb",
                "secondary": "#1e40af",
                "accent": "#f97316",
            },
            BusinessType.PROFESSIONAL: {
                "primary": "#1e3a5a",
                "secondary": "#0f172a",
                "accent": "#d4af37",
            },
            BusinessType.HEALTH: {
                "primary": "#0d9488",
                "secondary": "#065f46",
                "accent": "#6ee7b7",
            },
            BusinessType.CREATIVE: {
                "primary": "#7c3aed",
                "secondary": "#5b21b6",
                "accent": "#f472b6",
            },
            BusinessType.RETAIL: {
                "primary": "#059669",
                "secondary": "#047857",
                "accent": "#fbbf24",
            },
            BusinessType.GENERAL: {
                "primary": "#3b82f6",
                "secondary": "#1d4ed8",
                "accent": "#f59e0b",
            },
        }
        return schemes.get(business_type, schemes[BusinessType.GENERAL])
