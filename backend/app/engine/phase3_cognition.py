"""Phase 3: Character Cognition & Hidden Thought Generation.

Domain modules live under ``app.engine.cognition``; this module remains a
backwards-compatible re-export facade."""

from __future__ import annotations

from app.config import settings  # noqa: F401
from app.engine.affective_engine import (
    compute_provisional_cognition_preview,
    ensure_snapshot_care_state,
    render_zone4_affective_block,
)  # noqa: F401
from app.engine.mentions import CharacterWhisper, DecomposedUserMessage, decompose_user_message  # noqa: F401
from app.engine.phase2_context import (
    DiscoveredPersonaView,
    TurnContextBundle,
    get_immediate_level1_container,
    pack_recalled_items_to_budget,
    resolve_character_previous_state,
    select_active_container_lore_for_turn,
    select_active_location_lore_for_turn,
)  # noqa: F401
from app.engine.llm_client import llm_client  # noqa: F401
from app.prompts import get_default_prompt, render_template  # noqa: F401
from app.prompts.defaults import (
    DEFAULT_CHARACTER_COGNITION_SYSTEM,
    PROMPT_KEY_CHARACTER_COGNITION,
)  # noqa: F401
from app.schemas.affective import (
    INTENSITY_TO_AROUSAL,
    TONE_TO_VALENCE,
    AgencyLevel,
    CategoricalFeelingImpulse,
    CopingLevel,
    FeelingTone,
    IntensityLevel,
    ThreatLevel,
    coerce_agency_level,
    coerce_coping_level,
    coerce_feeling_tone,
    coerce_intensity_level,
    coerce_threat_level,
    impulse_from_legacy_floats,
)  # noqa: F401
from app.schemas.auth import ModelProfile  # noqa: F401
from app.schemas.character import (
    CharacterRecord,
    CharacterStateSnapshot,
    CognitionBlock,
    format_item_names,
)  # noqa: F401
from app.schemas.turn import (
    CanonicalOutcomeTier,
    CharacterSpotlightRole,
    ChoiceResolution,
    Phase3ProgressCallback,
    Phase3ProgressEvent,
    Phase3RosterEntry,
    PreTurnAnalysis,
    RecalledMemoryItem,
)  # noqa: F401
from app.schemas.world import LocationNode, NeighborLocationView, WorldRecord  # noqa: F401

from app.engine.cognition.xml_parser import (  # noqa: F401
    logger,
    _extract_xml_tag,
    strip_xml_tag_blocks,
    _VALENCE_ATTR_RE,
    _AROUSAL_ATTR_RE,
    _TONE_ATTR_RE,
    _INTENSITY_ATTR_RE,
    _AGENCY_ATTR_RE,
    _THREAT_ATTR_RE,
    _COPING_ATTR_RE,
    _ROLL_OUTCOME_ATTR_RE,
    _clamp,
    parse_cognition_xml,
    _format_cognition_bullets,
    _PROMPT_LEAKAGE_RE,
    _sanitize_cognition_text,
)
from app.engine.cognition.heuristics import (  # noqa: F401
    PriorCognitionCue,
    heuristic_character_cognition,
    select_cognition_recalled_items,
)
from app.engine.cognition.runner import (  # noqa: F401
    run_character_cognition_agent,
    run_phase3_multi_cognition,
    generate_clerk_cognition,
)
