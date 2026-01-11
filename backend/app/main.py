"""
SME Website Generator - Main Application Entry Point

A production-ready application that scrapes business information
and generates beautiful websites using AI.
"""

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional
import uuid

from fastapi import FastAPI, HTTPException, BackgroundTasks, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
import structlog

from app.config import settings
from app.models import (
    JobCreateRequest,
    DeployRequest,
    Job,
    JobStatus,
    JobResponse,
    JobProgress,
    HealthResponse,
    ErrorResponse,
)
from app.services.orchestrator import WebsiteGeneratorOrchestrator
from app.services.job_store import JobStore

# Configure structured logging
structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer()
    ],
    wrapper_class=structlog.stdlib.BoundLogger,
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
)

logger = structlog.get_logger()

# Job store (in-memory for simplicity, can be replaced with Redis/PostgreSQL)
job_store = JobStore()

# WebSocket connections for real-time updates
ws_connections: dict[str, list[WebSocket]] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    logger.info("Starting SME Website Generator", version=settings.app_version)
    yield
    logger.info("Shutting down SME Website Generator")


# Create FastAPI app
app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Generate beautiful websites for SMEs from their social media presence",
    lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins + ["*"],  # Allow all in dev
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================================
# Helper Functions
# ============================================================================

async def notify_job_update(job_id: str, job: Job):
    """Send job update to connected WebSocket clients."""
    if job_id in ws_connections:
        for ws in ws_connections[job_id]:
            try:
                await ws.send_json(job.model_dump(mode="json"))
            except Exception:
                pass  # Client disconnected


async def process_job(job_id: str):
    """Background task to process a website generation job."""
    job = await job_store.get(job_id)
    if not job:
        return
    
    orchestrator = WebsiteGeneratorOrchestrator()
    
    try:
        # Update progress callback
        async def on_progress(stage: str, message: str, percent: int):
            job.current_stage = stage
            job.progress.append(JobProgress(
                stage=stage,
                message=message,
                progress_percent=percent,
            ))
            job.updated_at = datetime.utcnow()
            await job_store.update(job)
            await notify_job_update(job_id, job)
        
        # Run the orchestrator
        result = await orchestrator.run(
            request=job.request,
            on_progress=on_progress,
        )
        
        # Update job with results
        job.scrape_result = result.scrape_result
        job.extracted_data = result.extracted_data
        job.generated_site = result.generated_site
        job.status = JobStatus.COMPLETED
        job.updated_at = datetime.utcnow()
        
        await on_progress("completed", "Website generated successfully!", 100)
        
    except Exception as e:
        logger.exception("Job failed", job_id=job_id, error=str(e))
        job.status = JobStatus.FAILED
        job.error = str(e)
        job.updated_at = datetime.utcnow()
    
    await job_store.update(job)
    await notify_job_update(job_id, job)


# ============================================================================
# API Routes
# ============================================================================

@app.get("/api/health", response_model=HealthResponse, tags=["Health"])
async def health_check():
    """Check application health and service connectivity."""
    return HealthResponse(
        status="healthy",
        version=settings.app_version,
        environment=settings.environment,
        services={
            "anthropic": bool(settings.anthropic_api_key),
            "firecrawl": bool(settings.firecrawl_api_key),
            "apify": bool(settings.apify_api_token),
            "vercel": bool(settings.vercel_token),
        }
    )


@app.post("/api/jobs", response_model=JobResponse, tags=["Jobs"])
async def create_job(
    request: JobCreateRequest,
    background_tasks: BackgroundTasks,
):
    """
    Create a new website generation job.
    
    The job will run in the background. Use the returned job ID to
    track progress via the GET endpoint or WebSocket.
    """
    job_id = str(uuid.uuid4())
    now = datetime.utcnow()
    
    job = Job(
        id=job_id,
        status=JobStatus.PENDING,
        created_at=now,
        updated_at=now,
        request=request,
    )
    
    await job_store.create(job)
    
    # Start background processing
    background_tasks.add_task(process_job, job_id)
    
    logger.info("Job created", job_id=job_id, business_name=request.business_name)
    
    return JobResponse(job=job, message="Job created successfully")


@app.get("/api/jobs/{job_id}", response_model=JobResponse, tags=["Jobs"])
async def get_job(job_id: str):
    """Get job status and results."""
    job = await job_store.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    return JobResponse(job=job)


@app.get("/api/jobs/{job_id}/preview", response_class=HTMLResponse, tags=["Jobs"])
async def get_job_preview(job_id: str):
    """Get the generated HTML preview."""
    job = await job_store.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    if not job.generated_site:
        raise HTTPException(status_code=400, detail="Website not yet generated")
    
    return HTMLResponse(content=job.generated_site.html)


@app.post("/api/jobs/{job_id}/deploy", response_model=JobResponse, tags=["Jobs"])
async def deploy_job(
    job_id: str,
    request: DeployRequest,
    background_tasks: BackgroundTasks,
):
    """Deploy the generated website to Vercel."""
    job = await job_store.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    if not job.generated_site:
        raise HTTPException(status_code=400, detail="Website not yet generated")
    
    if job.deployment:
        raise HTTPException(status_code=400, detail="Already deployed")
    
    # Import here to avoid circular imports
    from app.services.deployer import VercelDeployer
    
    deployer = VercelDeployer()
    
    try:
        job.status = JobStatus.DEPLOYING
        await job_store.update(job)
        await notify_job_update(job_id, job)
        
        deployment = await deployer.deploy(
            html=job.generated_site.html,
            project_name=job.request.business_name,
            custom_domain=request.custom_domain,
        )
        
        job.deployment = deployment
        job.status = JobStatus.COMPLETED
        job.updated_at = datetime.utcnow()
        await job_store.update(job)
        await notify_job_update(job_id, job)
        
        logger.info("Deployment successful", job_id=job_id, url=deployment.url)
        
    except Exception as e:
        logger.exception("Deployment failed", job_id=job_id)
        job.status = JobStatus.FAILED
        job.error = f"Deployment failed: {str(e)}"
        await job_store.update(job)
        await notify_job_update(job_id, job)
        raise HTTPException(status_code=500, detail=str(e))
    
    return JobResponse(job=job, message="Deployed successfully")


@app.get("/api/jobs", tags=["Jobs"])
async def list_jobs(
    page: int = 1,
    page_size: int = 20,
    status: Optional[JobStatus] = None,
):
    """List all jobs with optional filtering."""
    jobs = await job_store.list(page=page, page_size=page_size, status=status)
    total = await job_store.count(status=status)
    
    return {
        "jobs": jobs,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


# ============================================================================
# WebSocket for Real-time Updates
# ============================================================================

@app.websocket("/ws/jobs/{job_id}")
async def websocket_job_updates(websocket: WebSocket, job_id: str):
    """WebSocket endpoint for real-time job updates."""
    await websocket.accept()
    
    # Register connection
    if job_id not in ws_connections:
        ws_connections[job_id] = []
    ws_connections[job_id].append(websocket)
    
    try:
        # Send current job state immediately
        job = await job_store.get(job_id)
        if job:
            await websocket.send_json(job.model_dump(mode="json"))
        
        # Keep connection alive and listen for client messages
        while True:
            try:
                await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
            except asyncio.TimeoutError:
                # Send ping to keep connection alive
                await websocket.send_json({"type": "ping"})
                
    except WebSocketDisconnect:
        pass
    finally:
        # Cleanup connection
        if job_id in ws_connections:
            ws_connections[job_id].remove(websocket)
            if not ws_connections[job_id]:
                del ws_connections[job_id]


# ============================================================================
# Error Handlers
# ============================================================================

@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc):
    return ErrorResponse(
        error=exc.detail,
        code=str(exc.status_code),
    )


# ============================================================================
# Run with Uvicorn
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.debug,
    )
