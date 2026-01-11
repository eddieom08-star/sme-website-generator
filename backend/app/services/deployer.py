"""
Vercel Deployer Service - Deploys generated websites to Vercel.

Handles:
1. Project creation
2. File upload
3. Deployment
4. Custom domain configuration
"""

import asyncio
import hashlib
import base64
from typing import Optional

import httpx
import structlog

from app.config import settings
from app.models import DeploymentResult

logger = structlog.get_logger()


class VercelDeployer:
    """Deploy websites to Vercel."""
    
    def __init__(self):
        self.base_url = "https://api.vercel.com"
        self.headers = {
            "Authorization": f"Bearer {settings.vercel_token}",
            "Content-Type": "application/json",
        }
        self.timeout = httpx.Timeout(60.0)
    
    async def deploy(
        self,
        html: str,
        project_name: str,
        custom_domain: Optional[str] = None,
    ) -> DeploymentResult:
        """
        Deploy a website to Vercel.
        
        1. Creates project if needed
        2. Uploads files
        3. Creates deployment
        4. Waits for ready status
        5. Configures custom domain if provided
        """
        # Generate project slug
        project_slug = self._slugify(project_name)
        
        logger.info("Starting Vercel deployment", project=project_slug)
        
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            # Step 1: Create or get project
            project_id = await self._ensure_project(client, project_slug)
            
            # Step 2: Prepare files
            files = self._prepare_files(html, project_slug)
            
            # Step 3: Create deployment
            deployment = await self._create_deployment(
                client, project_slug, project_id, files
            )
            
            # Step 4: Wait for deployment to be ready
            deployment = await self._wait_for_ready(client, deployment["id"])
            
            # Step 5: Configure custom domain if provided
            dns_records = None
            if custom_domain:
                dns_records = await self._configure_domain(
                    client, project_id, custom_domain
                )
            
            logger.info(
                "Deployment complete",
                url=deployment.get("url"),
                deployment_id=deployment.get("id"),
            )
            
            return DeploymentResult(
                deployment_id=deployment["id"],
                url=f"https://{deployment.get('url', '')}",
                production_url=f"https://{project_slug}.vercel.app",
                status=deployment.get("readyState", "READY"),
                dns_records=dns_records,
            )
    
    def _slugify(self, name: str) -> str:
        """Convert business name to valid Vercel project slug."""
        import re
        slug = name.lower()
        slug = re.sub(r"[^a-z0-9]+", "-", slug)
        slug = re.sub(r"^-|-$", "", slug)
        return slug[:50]  # Vercel limit
    
    def _prepare_files(self, html: str, project_slug: str) -> list[dict]:
        """Prepare files for Vercel deployment."""
        
        # Main HTML file
        html_bytes = html.encode("utf-8")
        html_sha = hashlib.sha1(html_bytes).hexdigest()
        
        # Vercel configuration
        vercel_config = {
            "version": 2,
            "routes": [
                {"handle": "filesystem"},
                {"src": "/(.*)", "dest": "/index.html"}
            ],
            "headers": [
                {
                    "source": "/(.*)",
                    "headers": [
                        {"key": "X-Content-Type-Options", "value": "nosniff"},
                        {"key": "X-Frame-Options", "value": "DENY"},
                    ]
                }
            ]
        }
        import json
        config_bytes = json.dumps(vercel_config).encode("utf-8")
        config_sha = hashlib.sha1(config_bytes).hexdigest()
        
        # Robots.txt
        robots = f"User-agent: *\nAllow: /\nSitemap: https://{project_slug}.vercel.app/sitemap.xml"
        robots_bytes = robots.encode("utf-8")
        robots_sha = hashlib.sha1(robots_bytes).hexdigest()
        
        # Sitemap
        sitemap = f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://{project_slug}.vercel.app/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>"""
        sitemap_bytes = sitemap.encode("utf-8")
        sitemap_sha = hashlib.sha1(sitemap_bytes).hexdigest()
        
        return [
            {
                "file": "index.html",
                "sha": html_sha,
                "size": len(html_bytes),
                "encoding": "base64",
                "data": base64.b64encode(html_bytes).decode("utf-8"),
            },
            {
                "file": "vercel.json",
                "sha": config_sha,
                "size": len(config_bytes),
                "encoding": "base64",
                "data": base64.b64encode(config_bytes).decode("utf-8"),
            },
            {
                "file": "robots.txt",
                "sha": robots_sha,
                "size": len(robots_bytes),
                "encoding": "base64",
                "data": base64.b64encode(robots_bytes).decode("utf-8"),
            },
            {
                "file": "sitemap.xml",
                "sha": sitemap_sha,
                "size": len(sitemap_bytes),
                "encoding": "base64",
                "data": base64.b64encode(sitemap_bytes).decode("utf-8"),
            },
        ]
    
    async def _ensure_project(
        self,
        client: httpx.AsyncClient,
        project_slug: str,
    ) -> str:
        """Create project if it doesn't exist, return project ID."""
        
        # Try to create project
        response = await client.post(
            f"{self.base_url}/v9/projects",
            headers=self.headers,
            json={
                "name": project_slug,
                "framework": None,
            },
        )
        
        data = response.json()
        
        if response.status_code == 200:
            logger.info("Project created", project_id=data.get("id"))
            return data["id"]
        
        # Project might already exist
        if data.get("error", {}).get("code") == "project_already_exists":
            # Get existing project
            get_response = await client.get(
                f"{self.base_url}/v9/projects/{project_slug}",
                headers=self.headers,
            )
            if get_response.status_code == 200:
                project_data = get_response.json()
                logger.info("Using existing project", project_id=project_data.get("id"))
                return project_data["id"]
        
        # Fallback to using slug as ID
        logger.warning("Could not get project ID, using slug", slug=project_slug)
        return project_slug
    
    async def _create_deployment(
        self,
        client: httpx.AsyncClient,
        project_slug: str,
        project_id: str,
        files: list[dict],
    ) -> dict:
        """Create a new deployment."""
        
        payload = {
            "name": project_slug,
            "project": project_id,
            "target": "production",
            "files": files,
            "projectSettings": {
                "framework": None,
            },
        }
        
        # Add team ID if configured
        if settings.vercel_team_id:
            payload["teamId"] = settings.vercel_team_id
        
        response = await client.post(
            f"{self.base_url}/v13/deployments",
            headers=self.headers,
            json=payload,
        )
        
        if response.status_code not in (200, 201):
            error = response.json()
            raise Exception(f"Deployment failed: {error}")
        
        return response.json()
    
    async def _wait_for_ready(
        self,
        client: httpx.AsyncClient,
        deployment_id: str,
        max_attempts: int = 60,
    ) -> dict:
        """Wait for deployment to reach READY state."""
        
        for attempt in range(max_attempts):
            response = await client.get(
                f"{self.base_url}/v13/deployments/{deployment_id}",
                headers=self.headers,
            )
            
            if response.status_code != 200:
                raise Exception(f"Failed to check deployment status: {response.text}")
            
            data = response.json()
            state = data.get("readyState")
            
            if state == "READY":
                return data
            
            if state == "ERROR":
                raise Exception(f"Deployment failed: {data.get('errorMessage', 'Unknown error')}")
            
            # Still building, wait
            await asyncio.sleep(2)
        
        raise Exception("Deployment timed out")
    
    async def _configure_domain(
        self,
        client: httpx.AsyncClient,
        project_id: str,
        domain: str,
    ) -> list[dict]:
        """Configure custom domain for the project."""
        
        response = await client.post(
            f"{self.base_url}/v10/projects/{project_id}/domains",
            headers=self.headers,
            json={"name": domain},
        )
        
        data = response.json()
        
        if response.status_code not in (200, 201):
            logger.warning("Domain configuration failed", domain=domain, error=data)
            return None
        
        # Return DNS records for the user to configure
        return [
            {"type": "A", "name": "@", "value": "76.76.21.21"},
            {"type": "CNAME", "name": "www", "value": "cname.vercel-dns.com"},
        ]
