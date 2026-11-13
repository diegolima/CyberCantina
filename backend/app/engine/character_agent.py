"""Character State Agent & Inventory Arbitration.

Domain modules live under ``app.engine.char_agent``; this module remains a
backwards-compatible re-export facade."""

from __future__ import annotations

from app.config import ModelProfile, settings  # noqa: F401
from app.engine.affective_engine import (
    ensure_snapshot_care_state,
    render_zone4_affective_block,
)  # noqa: F401
from app.engine.llm_client import llm_client  # noqa: F401
from app.engine.mentions import DecomposedUserMessage, filter_user_message_for_character  # noqa: F401
from app.prompts import PROMPT_KEY_CHARACTER_POST_TURN, PROMPT_KEY_CLERK_ARBITRATION  # noqa: F401
from app.prompts.renderer import get_default_prompt, render_template  # noqa: F401
from app.schemas.affective import (
    AgencyLevel,
    CopingLevel,
    FeelingTone,
    IntensityLevel,
    OrdinalImpact,
    RelationalEventSpec,
    ThreatLevel,
)  # noqa: F401
from app.schemas.character import (
    CharacterRecord,
    CharacterStateSnapshot,
    ItemInstance,
    MemoryShard,
    coerce_item_list,
    format_item_names,
)  # noqa: F401
from app.schemas.turn import (
    ArbitrationRulingRecord,
    CharacterAgentDelta,
    ExtractedCharacterMemory,
    InventoryArbitrationResult,
    PreTurnAnalysis,
    TurnNodeRecord,
)  # noqa: F401
from app.schemas.world import LocationNode, NeighborLocationView  # noqa: F401

from app.engine.char_agent.matching import (  # noqa: F401
    logger,
    _TRAILING_FILLER_WORDS,
    _LEADING_FILLER_WORDS,
    _GENERIC_ITEM_ADJECTIVES,
    _USER_ALIASES,
    _NARRATOR_ALIASES,
    _ITEM_ARTICLES,
    normalize_inventory_item,
    clean_equipped_display_label,
    _significant_item_tokens,
    item_names_match_word_bounded,
    matches_inventory_query,
    match_best_item_instance,
    normalize_mood_label,
    _clamp_sentence,
    normalize_stance_updates,
    format_relationship_notes_for_prompt,
)
from app.engine.char_agent.inventory import (  # noqa: F401
    enforce_permanent_item_locks,
    collect_relinquished_item_instances,
    _consume_donated_instance,
    apply_character_inventory_delta,
    ContestedItemCase,
    detect_inventory_disputes,
    resolve_roll_for_character,
    _heuristic_arbitrate_case,
    arbitrate_inventory_disputes_detailed,
    arbitrate_inventory_disputes,
)
from app.engine.char_agent.agent import (  # noqa: F401
    _extract_scoped_heuristic_inventory,
    heuristic_character_agent_delta,
    run_character_post_turn_agent,
)
