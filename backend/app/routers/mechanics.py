"""Mechanics and dice preview API router."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.auth import get_current_user
from app.engine.choices import preview_choice_set
from app.schemas.auth import UserProfile
from app.schemas.mechanics import ChoicePreviewRequest, ChoicePreviewResponse

router = APIRouter(tags=["mechanics"])


@router.post("/api/mechanics/choice-preview", response_model=ChoicePreviewResponse)
def preview_choices(
    req: ChoicePreviewRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> ChoicePreviewResponse:
    """Calculate deterministic outcome and gate probabilities for a choice set."""
    return preview_choice_set(req)
