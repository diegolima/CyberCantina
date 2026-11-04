"""User personas REST router."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth import get_current_user
from app.db.repository import CantinaRepository
from app.dependencies import get_repo
from app.schemas.auth import UserProfile
from app.schemas.persona import (
    PersonaCreatePayload,
    PersonaRecord,
    PersonaUpdatePayload,
    is_default_persona_id,
)

router = APIRouter(prefix="/api/personas", tags=["personas"])


@router.get("", response_model=list[PersonaRecord])
async def list_user_personas(
    user: UserProfile = Depends(get_current_user),
    repo: CantinaRepository = Depends(get_repo),
) -> list[PersonaRecord]:
    """List all personas owned by the current user."""
    return repo.list_personas(owner_id=user.id)


@router.post("", response_model=PersonaRecord, status_code=status.HTTP_201_CREATED)
async def create_persona(
    payload: PersonaCreatePayload,
    user: UserProfile = Depends(get_current_user),
    repo: CantinaRepository = Depends(get_repo),
) -> PersonaRecord:
    """Create a new persona in the master gallery."""
    if not payload.name.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Persona name cannot be empty.",
        )
    return repo.create_persona(draft=payload, owner_id=user.id)


@router.get("/{persona_id}", response_model=PersonaRecord)
async def get_persona(
    persona_id: str,
    user: UserProfile = Depends(get_current_user),
    repo: CantinaRepository = Depends(get_repo),
) -> PersonaRecord:
    """Fetch a single persona by ID."""
    persona = repo.get_persona(persona_id, owner_id=user.id)
    if not persona:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Persona '{persona_id}' not found.",
        )
    return persona


@router.put("/{persona_id}", response_model=PersonaRecord)
async def update_persona(
    persona_id: str,
    payload: PersonaUpdatePayload,
    user: UserProfile = Depends(get_current_user),
    repo: CantinaRepository = Depends(get_repo),
) -> PersonaRecord:
    """Update persona fields and secret/public toggles."""
    if is_default_persona_id(persona_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The default 'User' persona is hard-coded and cannot be modified.",
        )
    persona = repo.get_persona(persona_id, owner_id=user.id)
    if not persona:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Persona '{persona_id}' not found.",
        )
    try:
        return repo.update_persona(persona_id, payload, owner_id=user.id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc


@router.delete("/{persona_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_persona(
    persona_id: str,
    user: UserProfile = Depends(get_current_user),
    repo: CantinaRepository = Depends(get_repo),
) -> None:
    """Delete a persona from the master gallery. Campaigns keep their snapshots."""
    if is_default_persona_id(persona_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The default 'User' persona is hard-coded and cannot be deleted.",
        )
    persona = repo.get_persona(persona_id, owner_id=user.id)
    if not persona:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Persona '{persona_id}' not found.",
        )
    try:
        repo.delete_persona(persona_id, owner_id=user.id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
