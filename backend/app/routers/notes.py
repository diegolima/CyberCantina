"""Private user notes router."""

from __future__ import annotations

import logging
from typing import Any
from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.dependencies import get_repo
from app.schemas.auth import UserProfile
from app.schemas.note import (
    UserNoteCreatePayload,
    UserNoteRecord,
    UserNoteUpdatePayload,
)

logger = logging.getLogger("cybercantina.routers.notes")
router = APIRouter(tags=["notes"])


@router.get("/api/notes", response_model=list[UserNoteRecord])
def list_my_notes(
    current_user: UserProfile = Depends(get_current_user),
) -> list[UserNoteRecord]:
    """List all private notes created by the current user, ordered by starred first, then updated_at."""
    repo = get_repo()
    return repo.list_user_notes(current_user.id)


@router.post("/api/notes", response_model=UserNoteRecord)
def create_my_note(
    payload: UserNoteCreatePayload,
    current_user: UserProfile = Depends(get_current_user),
) -> UserNoteRecord:
    """Create a new private note for the current user."""
    repo = get_repo()
    return repo.create_user_note(
        owner_id=current_user.id,
        title=payload.title,
        content=payload.content,
        tags=payload.tags,
        is_starred=payload.is_starred,
    )


@router.get("/api/notes/{note_id}", response_model=UserNoteRecord)
def get_my_note(
    note_id: str,
    current_user: UserProfile = Depends(get_current_user),
) -> UserNoteRecord:
    """Get a single private note."""
    repo = get_repo()
    note = repo.get_user_note(note_id, current_user.id)
    if not note:
        raise HTTPException(status_code=404, detail=f"Note '{note_id}' not found")
    return note


@router.put("/api/notes/{note_id}", response_model=UserNoteRecord)
def update_my_note(
    note_id: str,
    payload: UserNoteUpdatePayload,
    current_user: UserProfile = Depends(get_current_user),
) -> UserNoteRecord:
    """Update title, content, tags, or starred status of a private note."""
    repo = get_repo()
    updated = repo.update_user_note(
        note_id=note_id,
        owner_id=current_user.id,
        title=payload.title,
        content=payload.content,
        tags=payload.tags,
        is_starred=payload.is_starred,
    )
    if not updated:
        raise HTTPException(status_code=404, detail=f"Note '{note_id}' not found")
    return updated


@router.delete("/api/notes/{note_id}")
def delete_my_note(
    note_id: str,
    current_user: UserProfile = Depends(get_current_user),
) -> dict[str, Any]:
    """Delete a private note."""
    repo = get_repo()
    deleted = repo.delete_user_note(note_id, current_user.id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Note '{note_id}' not found")
    return {"status": "deleted", "id": note_id}
