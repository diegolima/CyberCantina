"""Pydantic v2 schemas for Admin Communication Messages."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

MessagePlacement = Literal["login", "home", "both"]
MessageUrgency = Literal["info", "warning", "critical"]
AdminMessageStatus = Literal["live", "scheduled", "expired", "deleted"]


def _normalize_utc_iso(raw: str | None, *, field_name: str) -> str | None:
    """Parse a timezone-aware ISO-8601 timestamp and normalize to UTC '%Y-%m-%dT%H:%M:%SZ'."""
    if raw is None:
        return None
    cleaned = raw.strip()
    if not cleaned:
        return None
    if cleaned.endswith("Z"):
        cleaned = f"{cleaned[:-1]}+00:00"
    try:
        dt = datetime.fromisoformat(cleaned)
    except ValueError as exc:
        raise ValueError(f"{field_name} must be a valid ISO-8601 timestamp.") from exc
    if dt.tzinfo is None:
        raise ValueError(f"{field_name} must include a timezone offset or 'Z'.")
    dt_utc = dt.astimezone(timezone.utc)
    return dt_utc.strftime("%Y-%m-%dT%H:%M:%SZ")


class PublicAdminMessage(BaseModel):
    """Sanitized public payload served to Login/Registration and Home surfaces."""

    id: str
    revision: int
    placement: MessagePlacement
    title: str
    message: str
    urgency: MessageUrgency
    dismissable: bool
    expires_at: str | None = None


class AdminMessageRecord(PublicAdminMessage):
    """Full administrative message record including schedule, ordering, and archive metadata."""

    starts_at: str | None = None
    sort_order: int = 0
    created_at: str
    updated_at: str
    deleted_at: str | None = None
    status: AdminMessageStatus


class AdminMessageWriteRequest(BaseModel):
    """Create or update payload for an admin communication message."""

    placement: MessagePlacement = "both"
    title: str = Field(..., min_length=1, max_length=120)
    message: str = Field(..., min_length=1, max_length=2000)
    urgency: MessageUrgency = "info"
    dismissable: bool = True
    starts_at: str | None = None
    expires_at: str | None = None

    @field_validator("title")
    @classmethod
    def _validate_title(cls, value: str) -> str:
        cleaned = " ".join(value.replace("\r\n", "\n").replace("\r", "\n").split())
        if not cleaned:
            raise ValueError("Title cannot be empty.")
        if len(cleaned) > 120:
            raise ValueError("Title must be 120 characters or fewer.")
        return cleaned

    @field_validator("message")
    @classmethod
    def _validate_message(cls, value: str) -> str:
        cleaned = value.replace("\r\n", "\n").replace("\r", "\n").strip()
        if not cleaned:
            raise ValueError("Message cannot be empty.")
        if len(cleaned) > 2000:
            raise ValueError("Message must be 2000 characters or fewer.")
        return cleaned

    @field_validator("starts_at")
    @classmethod
    def _validate_starts_at(cls, value: str | None) -> str | None:
        return _normalize_utc_iso(value, field_name="starts_at")

    @field_validator("expires_at")
    @classmethod
    def _validate_expires_at(cls, value: str | None) -> str | None:
        return _normalize_utc_iso(value, field_name="expires_at")

    @model_validator(mode="after")
    def _validate_effective_window(self) -> "AdminMessageWriteRequest":
        now_utc = datetime.now(timezone.utc)
        if self.expires_at is not None:
            exp_dt = datetime.fromisoformat(self.expires_at.replace("Z", "+00:00"))
            if exp_dt < now_utc:
                raise ValueError("Until date/time must be empty or in the future (>= now).")
            if self.starts_at is not None:
                start_dt = datetime.fromisoformat(self.starts_at.replace("Z", "+00:00"))
                if exp_dt <= start_dt:
                    raise ValueError("Until date/time must be strictly after From date/time.")
        return self


class AdminMessageReorderRequest(BaseModel):
    """Payload to reorder active messages within a single urgency group."""

    urgency: MessageUrgency
    ordered_ids: list[str] = Field(default_factory=list)


class AdminMessageListResponse(BaseModel):
    """Response bundle for the admin Communication tab (Active + Archived)."""

    active: list[AdminMessageRecord] = Field(default_factory=list)
    archived: list[AdminMessageRecord] = Field(default_factory=list)
