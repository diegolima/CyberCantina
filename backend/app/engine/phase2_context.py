"""Phase 2: Context Builder, 4-Zone KV-Cache Prompt Assembly & Long-Term Memory Injection.

Domain modules live under ``app.engine.context``; this module remains a
backwards-compatible re-export facade for existing callers and tests.
"""

from __future__ import annotations

from app.config import ModelProfile, settings  # noqa: F401
from app.db.vector_store import (
    build_short_memory_content,
    extract_context_activations,
)  # noqa: F401
from app.engine.affective_engine import (
    compute_provisional_cognition_preview,
    describe_edge_stance,
    describe_trust_tier,
    ensure_snapshot_care_state,
    materialize_snapshot_with_care,
    project_care_to_minute,
    render_zone4_affective_block,
    seed_initial_care_state,
)  # noqa: F401
from app.engine.mentions import (
    DecomposedUserMessage,
    decompose_user_message,
    filter_user_message_for_character,
)  # noqa: F401
from app.engine.world_clock import describe_world_timestamp  # noqa: F401
from app.prompts import get_default_prompt, render_template  # noqa: F401
from app.schemas.character import (
    CharacterRecord,
    CharacterStateSnapshot,
    CognitionBlock,
    ItemInstance,
    coerce_item_list,
    format_item_names,
    normalize_item_key,
)  # noqa: F401
from app.schemas.persona import (
    PersonaItemInstance,
    PersonaLoreEntry,
    PersonaRecord,
    PersonaTurnStateSnapshot,
)  # noqa: F401
from app.schemas.turn import (
    EpisodicChunkRecord,
    PreTurnAnalysis,
    RecalledMemoryItem,
    TurnNodeRecord,
    WorldStateSnapshot,
)  # noqa: F401
from app.schemas.world import (
    LocationContainer,
    LocationNode,
    LoreNode,
    NeighborLocationView,
    WorldRecord,
)  # noqa: F401

from app.engine.context.lore_scope import (  # noqa: F401
    _WORD_TOKEN_RE,
    logger,
    _CHAT_MSG_OVERHEAD_TOKENS,
    _PROMPT_SAFETY_MARGIN_TOKENS,
    estimate_text_tokens,
    estimate_messages_tokens,
    resolve_actor_context_ceiling,
    _DISCOVERY_CHECK_STEMS,
    _tag_matches_text,
    _LORE_OVERLAP_STOPWORDS,
    _ITEM_SIGNAL_ADJECTIVES,
    was_character_present_on_turn,
    get_character_working_window,
    is_lore_substantively_in_working_window,
    _item_matches_turn_signal,
    resolve_triggered_item_lore,
    _select_scoped_lore_for_turn,
    select_active_location_lore_for_turn,
    select_active_container_lore_for_turn,
    build_container_chain,
    get_immediate_level1_container,
    _truncate_cue_text,
    compute_lca_transition_cue,
)
from app.engine.context.zone1_static import (  # noqa: F401
    DiscoveredPersonaView,
    resolve_character_known_persona,
    build_all_character_known_personas,
    format_zone1_player_protagonist_block,
    build_zone1_narrator_system_prompt,
    build_zone1_static_system_prompt,
    build_zone1_ensemble_system_prompt,
)
from app.engine.context.zone2_episodic import (  # noqa: F401
    TurnContextBundle,
    _chunk_synopsis_fallback,
    render_zone2_lod_episodic_summary,
    build_zone2_episodic_summary,
    pack_recalled_items_to_budget,
    elevate_compacted_episode_turns,
)
from app.engine.context.zone4_ephemeral import (  # noqa: F401
    _project_snapshot_to_elapsed,
    resolve_character_previous_state,
    build_zone4_ephemeral_tail_frame,
)
from app.engine.context.assembler import (  # noqa: F401
    resolve_phase2_turn_context,
    assemble_four_zone_messages,
)

__all__ = [
    "_WORD_TOKEN_RE",
    "logger",
    "_CHAT_MSG_OVERHEAD_TOKENS",
    "_PROMPT_SAFETY_MARGIN_TOKENS",
    "estimate_text_tokens",
    "estimate_messages_tokens",
    "resolve_actor_context_ceiling",
    "_DISCOVERY_CHECK_STEMS",
    "_tag_matches_text",
    "_LORE_OVERLAP_STOPWORDS",
    "_ITEM_SIGNAL_ADJECTIVES",
    "was_character_present_on_turn",
    "get_character_working_window",
    "is_lore_substantively_in_working_window",
    "_item_matches_turn_signal",
    "resolve_triggered_item_lore",
    "_select_scoped_lore_for_turn",
    "select_active_location_lore_for_turn",
    "select_active_container_lore_for_turn",
    "build_container_chain",
    "get_immediate_level1_container",
    "_truncate_cue_text",
    "compute_lca_transition_cue",
    "DiscoveredPersonaView",
    "resolve_character_known_persona",
    "build_all_character_known_personas",
    "format_zone1_player_protagonist_block",
    "build_zone1_narrator_system_prompt",
    "build_zone1_static_system_prompt",
    "build_zone1_ensemble_system_prompt",
    "TurnContextBundle",
    "_chunk_synopsis_fallback",
    "render_zone2_lod_episodic_summary",
    "build_zone2_episodic_summary",
    "pack_recalled_items_to_budget",
    "elevate_compacted_episode_turns",
    "_project_snapshot_to_elapsed",
    "resolve_character_previous_state",
    "build_zone4_ephemeral_tail_frame",
    "resolve_phase2_turn_context",
    "assemble_four_zone_messages",
]
