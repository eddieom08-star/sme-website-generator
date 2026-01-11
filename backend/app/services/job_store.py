"""
Job Store - In-memory storage for jobs.

In production, replace with Redis or PostgreSQL backend.
"""

from typing import Optional
from datetime import datetime

from app.models import Job, JobStatus


class JobStore:
    """Simple in-memory job store. Replace with Redis/PostgreSQL for production."""
    
    def __init__(self):
        self._jobs: dict[str, Job] = {}
    
    async def create(self, job: Job) -> Job:
        """Create a new job."""
        self._jobs[job.id] = job
        return job
    
    async def get(self, job_id: str) -> Optional[Job]:
        """Get a job by ID."""
        return self._jobs.get(job_id)
    
    async def update(self, job: Job) -> Job:
        """Update an existing job."""
        job.updated_at = datetime.utcnow()
        self._jobs[job.id] = job
        return job
    
    async def delete(self, job_id: str) -> bool:
        """Delete a job."""
        if job_id in self._jobs:
            del self._jobs[job_id]
            return True
        return False
    
    async def list(
        self,
        page: int = 1,
        page_size: int = 20,
        status: Optional[JobStatus] = None,
    ) -> list[Job]:
        """List jobs with pagination and optional status filter."""
        jobs = list(self._jobs.values())
        
        # Filter by status
        if status:
            jobs = [j for j in jobs if j.status == status]
        
        # Sort by created_at descending
        jobs.sort(key=lambda j: j.created_at, reverse=True)
        
        # Paginate
        start = (page - 1) * page_size
        end = start + page_size
        return jobs[start:end]
    
    async def count(self, status: Optional[JobStatus] = None) -> int:
        """Count jobs with optional status filter."""
        if status:
            return len([j for j in self._jobs.values() if j.status == status])
        return len(self._jobs)
