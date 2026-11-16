"""Admin Communication Messages router (public Home delivery + admin CRUD/reorder/archive)."""

from __future__ import annotations

import logging
from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user, require_admin
from app.db.repos.base import utc_now_iso
from app.dependencies import get_repo
from app.schemas.admin_messages import (
    AdminMessageListResponse,
    AdminMessageRecord,
    AdminMessageReorderRequest,
    AdminMessageWriteRequest,
    PublicAdminMessage,
)
from app.schemas.auth import UserProfile
from app.security.log_sanitize import sanitize_log_value

logger = logging.getLogger("cybercantina.routers.admin_messages")
router = APIRouter(tags=["admin-messages"])


def _require_multi_user_mode(repo) -> None:
    if repo.is_single_user_passwordless_mode():
        raise HTTPException(
            status_code=403,
            detail="Admin communication messages are disabled in single-user passwordless mode.",
        )


@router.get("/api/messages/home", response_model=list[PublicAdminMessage])
def list_home_messages(
    _current_user: UserProfile = Depends(get_current_user),
) -> list[PublicAdminMessage]:
    """Return active admin communication messages targeted to Home (or Both)."""
    repo = get_repo()
    if repo.is_single_user_passwordless_mode():
        return []
    rows = repo.list_visible_admin_messages("home", utc_now_iso())
    return [PublicAdminMessage.model_validate(r) for r in rows]


@router.get("/api/admin/messages", response_model=AdminMessageListResponse)
def admin_list_messages(
    _admin: UserProfile = Depends(require_admin),
) -> AdminMessageListResponse:
    """List active (live/scheduled) and archived (deleted/expired) admin messages."""
    repo = get_repo()
    _require_multi_user_mode(repo)
    now = utc_now_iso()
    active = [
        AdminMessageRecord.model_validate(r)
        for r in repo.list_active_admin_messages(now)
    ]
    archived = [
        AdminMessageRecord.model_validate(r)
        for r in repo.list_archived_admin_messages(now)
    ]
    return AdminMessageListResponse(active=active, archived=archived)


@router.post("/api/admin/messages", response_model=AdminMessageRecord)
def admin_create_message(
    req: AdminMessageWriteRequest,
    admin: UserProfile = Depends(require_admin),
) -> AdminMessageRecord:
    """Create a new admin communication message."""
    repo = get_repo()
    _require_multi_user_mode(repo)
    created = repo.create_admin_message(
        placement=req.placement,
        title=req.title,
        message=req.message,
        urgency=req.urgency,
        dismissable=req.dismissable,
        starts_at=req.starts_at,
        expires_at=req.expires_at,
    )
    logger.info(
        "Admin '%s' created communication message id=%s urgency=%s placement=%s",
        sanitize_log_value(admin.username),
        sanitize_log_value(created["id"]),
        created["urgency"],
        created["placement"],
    )
    return AdminMessageRecord.model_validate(created)


@router.put("/api/admin/messages/reorder", response_model=list[AdminMessageRecord])
def admin_reorder_messages(
    req: AdminMessageReorderRequest,
    _admin: UserProfile = Depends(require_admin),
) -> list[AdminMessageRecord]:
    """Reorder active messages within a single urgency group without bumping revision."""
    repo = get_repo()
    _require_multi_user_mode(repo)
    try:
        rows = repo.reorder_admin_messages(
            urgency=req.urgency,
            ordered_ids=req.ordered_ids,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return [AdminMessageRecord.model_validate(r) for r in rows]


@router.put("/api/admin/messages/{message_id}", response_model=AdminMessageRecord)
def admin_update_message(
    message_id: str,
    req: AdminMessageWriteRequest,
    admin: UserProfile = Depends(require_admin),
) -> AdminMessageRecord:
    """Update an active message or edit-and-restore an archived message with revision + 1."""
    repo = get_repo()
    _require_multi_user_mode(repo)
    updated = repo.update_admin_message(
        message_id,
        placement=req.placement,
        title=req.title,
        message=req.message,
        urgency=req.urgency,
        dismissable=req.dismissable,
        starts_at=req.starts_at,
        expires_at=req.expires_at,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Admin message not found.")
    logger.info(
        "Admin '%s' updated communication message id=%s rev=%d",
        sanitize_log_value(admin.username),
        sanitize_log_value(message_id),
        updated["revision"],
    )
    return AdminMessageRecord.model_validate(updated)


@router.delete("/api/admin/messages/{message_id}")
def admin_delete_message(
    message_id: str,
    admin: UserProfile = Depends(require_admin),
) -> dict[str, str]:
    """Soft-delete an active admin communication message (moves to Archived)."""
    repo = get_repo()
    _require_multi_user_mode(repo)
    deleted = repo.soft_delete_admin_message(message_id)
    if not deleted:
        raise HTTPException(
            status_code=404,
            detail="Active admin message not found.",
        )
    logger.info(
        "Admin '%s' soft-deleted communication message id=%s",
        sanitize_log_value(admin.username),
        sanitize_log_value(message_id),
    )
    return {"status": "archived", "id": message_id}
