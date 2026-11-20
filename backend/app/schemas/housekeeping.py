"""Pydantic v2 schemas for Chloromancer housekeeping scheduler and purge previews."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class ChloromancerJobInfo(BaseModel):
    """Metadata and runtime state for a registered Chloromancer housekeeping job."""

    job_id: str
    description: str
    interval_minutes: int
    enabled: bool
    running: bool = False


class ChloromancerRunRecord(BaseModel):
    """Persisted audit record for one Chloromancer job execution."""

    id: str
    job_id: str
    trigger: Literal["scheduled", "manual"] | str
    started_at: str
    finished_at: str
    status: Literal["ok", "skipped", "error"] | str
    items_affected: int = 0
    details: dict[str, Any] = Field(default_factory=dict)


class ChloromancerStatusResponse(BaseModel):
    """Current scheduler state, job definitions, and recent run history."""

    scheduler_active: bool
    interval_minutes: int
    inactive_user_purge_days: int | None = None
    jobs: list[ChloromancerJobInfo] = Field(default_factory=list)
    recent_runs: list[ChloromancerRunRecord] = Field(default_factory=list)


class PurgeCandidatePreview(BaseModel):
    """Summary of one standard user account eligible for inactivity purge."""

    user_id: str
    username: str
    display_name: str
    created_at: str
    last_login_at: str | None = None
    last_active_at: str
    days_inactive: int
    character_count: int = 0
    world_count: int = 0
    campaign_count: int = 0
    media_bytes: int = 0


class PurgePreviewResponse(BaseModel):
    """Dry-run preview of accounts eligible for inactivity purge."""

    days_threshold: int | None = None
    cutoff_at: str | None = None
    candidates: list[PurgeCandidatePreview] = Field(default_factory=list)
    total_users: int = 0
    total_characters: int = 0
    total_worlds: int = 0
    total_campaigns: int = 0
    total_media_bytes: int = 0


class AdminMediaPurgePreviewResponse(BaseModel):
    """Dry-run counts and byte totals of non-built-in media eligible for admin purge."""

    purge_images: bool = False
    purge_videos: bool = False
    images_count: int = 0
    images_bytes: int = 0
    videos_count: int = 0
    videos_bytes: int = 0
    total_bytes: int = 0
    cascade_videos_included: bool = False


class AdminMediaPurgeRequest(BaseModel):
    """Fine-grained admin purge request for non-built-in media."""

    purge_images: bool = False
    purge_videos: bool = False


class AdminMediaPurgeResponse(BaseModel):
    """Result of purging non-built-in media from disk and database."""

    purge_images: bool
    purge_videos: bool
    images_deleted: int = 0
    videos_deleted: int = 0
    bytes_reclaimed: int = 0
