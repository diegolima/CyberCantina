"""Phase 2 context scoping, Zone 1-4 prompt building, and turn bundle assembly.

Submodules:
- `lore_scope`: Character working-window filtering & triggered location/container/item lore
- `zone1_static`: KV-cache-stable system persona, world rules, and temperament instructions
- `zone2_episodic`: LOD episodic cascade (`summary` -> `synopsis` -> `dropped`) & vector recall
- `zone3_history`: Epistemic-isolated branch history formatting (`@Character:` whisper scoping)
- `zone4_ephemeral`: Per-turn physical state, spatial graph neighbors, and choice/roll injection
- `assembler`: Top-level `assemble_four_zone_messages` orchestrator
"""

from __future__ import annotations

from app.engine.context.lore_scope import (
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
from app.engine.context.zone1_static import (
    DiscoveredPersonaView,
    resolve_character_known_persona,
    build_all_character_known_personas,
    format_zone1_player_protagonist_block,
    build_zone1_narrator_system_prompt,
    build_zone1_static_system_prompt,
    build_zone1_ensemble_system_prompt,
)
from app.engine.context.zone2_episodic import (
    TurnContextBundle,
    _chunk_synopsis_fallback,
    render_zone2_lod_episodic_summary,
    build_zone2_episodic_summary,
    pack_recalled_items_to_budget,
    elevate_compacted_episode_turns,
)
from app.engine.context.zone4_ephemeral import (
    _project_snapshot_to_elapsed,
    resolve_character_previous_state,
    build_zone4_ephemeral_tail_frame,
)
from app.engine.context.assembler import (
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
