"""Admin housekeeping router for Chloromancer scheduler status, dry-run preview, and manual triggers."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import require_admin
from app.dependencies import get_repo
from app.housekeeping import (
    JobAlreadyRunningError,
    JobNotFoundError,
    chloromancer_scheduler,
    compute_purge_preview,
)
from app.schemas.auth import UserProfile
from app.schemas.housekeeping import (
    ChloromancerRunRecord,
    ChloromancerStatusResponse,
    PurgePreviewResponse,
)

router = APIRouter(tags=["admin-housekeeping"])


@router.get("/api/admin/chloromancer/status", response_model=ChloromancerStatusResponse)
def admin_chloromancer_status(
    limit: int = Query(default=20, ge=1, le=100),
    _admin: UserProfile = Depends(require_admin),
) -> ChloromancerStatusResponse:
    """Return Chloromancer scheduler state, registered jobs, and recent execution logs."""
    return chloromancer_scheduler.get_status(get_repo(), limit=limit)


@router.get("/api/admin/chloromancer/purge-preview", response_model=PurgePreviewResponse)
def admin_chloromancer_purge_preview(
    days: int | None = Query(default=None, ge=1, le=3650),
    admin: UserProfile = Depends(require_admin),
) -> PurgePreviewResponse:
    """Preview standard user accounts eligible for inactivity purge without deleting data."""
    return compute_purge_preview(
        get_repo(),
        days_override=days,
        exclude_user_id=admin.id,
    )


@router.post("/api/admin/chloromancer/run/{job_id}", response_model=ChloromancerRunRecord)
async def admin_chloromancer_run_job(
    job_id: str,
    admin: UserProfile = Depends(require_admin),
) -> ChloromancerRunRecord:
    """Manually trigger a registered Chloromancer housekeeping job."""
    repo = get_repo()
    try:
        result = await chloromancer_scheduler.run_job(
            job_id,
            trigger="manual",
            actor_user_id=admin.id,
            repo=repo,
        )
    except JobNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except JobAlreadyRunningError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    if result is None:
        raise HTTPException(status_code=500, detail=f"Job '{job_id}' returned no run record.")
    return ChloromancerRunRecord.model_validate(result)
