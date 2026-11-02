"""Backward-compatibility shim for Phase 3 Actor & Cognition.

Historically, CyberCantina unified Phase 3 Actor prose generation and cognition parsing
in this module. In the 5-phase pipeline, these are cleanly split into:
- Phase 3 Multi-Cognition (app.engine.phase3_cognition)
- Phase 4 Narrative Prose Generation (app.engine.phase4_prose)

This module re-exports the canonical functions for backward compatibility.
"""

from __future__ import annotations

import sys
from typing import Any

from app.engine.llm_client import llm_client
from app.engine.phase3_cognition import (
    generate_clerk_cognition,
    parse_cognition_xml,
    _format_cognition_bullets,
)
from app.engine.phase4_prose import (
    build_offline_simulated_prose,
    stream_phase4_prose,
)
from app.schemas.auth import ModelProfile
from app.schemas.character import CharacterRecord, CharacterStateSnapshot, CognitionBlock
from app.schemas.turn import PreTurnAnalysis, RecalledMemoryItem
from app.schemas.world import LocationNode, NeighborLocationView


def build_offline_simulated_response(
    *,
    user_message: str,
    character: CharacterRecord,
    previous_state: CharacterStateSnapshot,
    active_location: LocationNode,
    neighbors: list[NeighborLocationView],
    recalled_items: list[RecalledMemoryItem],
    pre_turn: PreTurnAnalysis,
    is_narrator: bool = False,
    narrative_mode: str | None = None,
    narrator_directive: str | None = None,
) -> str:
    """Legacy helper: constructs offline simulated response including <cognition>."""
    return build_offline_simulated_prose(
        user_message=user_message,
        character=character,
        previous_state=previous_state,
        active_location=active_location,
        neighbors=neighbors,
        recalled_items=recalled_items,
        pre_turn=pre_turn,
        is_narrator=is_narrator,
        narrative_mode=narrative_mode,
        narrator_directive=narrator_directive,
        include_cognition=True,
    )


# Alias stream_phase3_actor to stream_phase4_prose
stream_phase3_actor = stream_phase4_prose

__all__ = [
    "build_offline_simulated_response",
    "generate_clerk_cognition",
    "llm_client",
    "parse_cognition_xml",
    "_format_cognition_bullets",
    "stream_phase3_actor",
    "stream_phase4_prose",
]



def build_offline_simulated_response(
    *,
    user_message: str,
    character: CharacterRecord,
    previous_state: CharacterStateSnapshot,
    active_location: LocationNode,
    neighbors: list[NeighborLocationView],
    recalled_items: list[RecalledMemoryItem],
    pre_turn: PreTurnAnalysis,
    is_narrator: bool = False,
    narrative_mode: str | None = None,
    narrator_directive: str | None = None,
) -> str:
    """Legacy helper: constructs offline simulated response including <cognition>."""
    return build_offline_simulated_prose(
        user_message=user_message,
        character=character,
        previous_state=previous_state,
        active_location=active_location,
        neighbors=neighbors,
        recalled_items=recalled_items,
        pre_turn=pre_turn,
        is_narrator=is_narrator,
        narrative_mode=narrative_mode,
        narrator_directive=narrator_directive,
        include_cognition=True,
    )


# Alias stream_phase3_actor to the canonical Phase 4 prose streaming function
stream_phase3_actor = stream_phase4_prose

__all__ = [
    "build_offline_simulated_response",
    "generate_clerk_cognition",
    "parse_cognition_xml",
    "_format_cognition_bullets",
    "stream_phase3_actor",
    "stream_phase4_prose",
]
