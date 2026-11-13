"""Phase 5: Async Post-Turn Clerk & Character State Engine.

Domain modules live under ``app.engine.clerk``; this module remains a
backwards-compatible re-export facade for existing callers, monkeypatches, and tests.
"""

from __future__ import annotations

from app.config import AgentDispatchMode, ModelProfile, settings  # noqa: F401
from app.db.repository import CantinaRepository  # noqa: F401
from app.engine.affective_engine import (
    MechanicalTurnSignals,
    ResolvedWitnessEvent,
    apply_co_present_witness_coupling,
    ensure_snapshot_care_state,
    materialize_snapshot_with_care,
    project_care_to_minute,
    resolve_post_turn_care_state,
)  # noqa: F401
from app.engine.character_agent import (
    apply_character_inventory_delta,
    arbitrate_inventory_disputes,
    arbitrate_inventory_disputes_detailed,
    collect_relinquished_item_instances,
    detect_inventory_disputes,
    enforce_permanent_item_locks,
    heuristic_character_agent_delta,
    item_names_match_word_bounded,
    resolve_roll_for_character,
    run_character_post_turn_agent,
)  # noqa: F401
from app.engine.llm_client import llm_client  # noqa: F401
from app.engine.mentions import (
    DecomposedUserMessage,
    MentionTargetScope,
    decompose_user_message,
    filter_user_message_for_character,
    sanitize_history_for_episodic_summary,
)  # noqa: F401
from app.engine.phase2_context import (
    resolve_character_previous_state,
    was_character_present_on_turn,
)  # noqa: F401
from app.prompts import (
    DEFAULT_CLERK_MEMORY_COMPACTION_SYSTEM,
    get_default_prompt,
    render_template,
)  # noqa: F401
from app.engine.world_clock import (
    advance_world_timestamp,  # noqa: F401  (re-exported for backwards compatibility)
    describe_world_timestamp,
    extract_time_hint_minutes,
    parse_world_timestamp,
    resolve_bounded_turn_elapsed_minutes,
    resolve_turn_timestamp,
)  # noqa: F401
from app.schemas.affective import (
    AffectiveCareState,
    MAX_TURN_ELAPSED_MINUTES_SANITY,
    VisibilityScope,
)  # noqa: F401
from app.schemas.character import (
    CharacterRecord,
    CharacterStateSnapshot,
    CognitionBlock,
    ItemInstance,
    MemoryShard,
)  # noqa: F401
from app.schemas.persona import (
    PersonaKnowledgeProvenance,
    PersonaRecord,
    PersonaTurnStateSnapshot,
)  # noqa: F401
from app.schemas.turn import (
    ArbitrationRulingRecord,
    CharacterAgentDelta,
    EpisodicChunkLLMOutput,
    EpisodicChunkRecord,
    ExtractedCharacterMemory,
    ImprovisedLocationSpec,
    PersonaGossipEvent,
    Phase4ProgressCallback,
    Phase4ProgressEvent,
    Phase4RosterEntry,
    Phase5ProgressCallback,
    Phase5ProgressEvent,
    Phase5RosterEntry,
    PostTurnStateDelta,
    PreTurnAnalysis,
    TurnNodeRecord,
    WorldPostTurnDelta,
    WorldStateSnapshot,
)  # noqa: F401
from app.schemas.world import LocationNode, NeighborLocationView, normalize_compass_direction  # noqa: F401

from app.engine.clerk.gossip import (  # noqa: F401
    merge_scene_flags,
    verify_prose_gossip_exchanges,
    apply_turn_persona_state_and_gossip,
)
from app.engine.clerk.inventory import (  # noqa: F401
    _normalize_inventory_item,
    _matches_inventory_removal,
    merge_inventory,
    _GENERIC_ITEM_ADJECTIVES,
    _extract_heuristic_inventory_delta,
)
from app.engine.clerk.memories import (  # noqa: F401
    _STOP_WORDS,
    _synthesize_concise_sentences,
    _tokenize_meaningful,
    _memory_similarity,
    _SIGNIFICANCE_PATTERNS,
    _extract_heuristic_character_memories,
    resolve_present_character_for_memory,
    apply_extracted_character_memories,
    CompactedMemorySpec,
    compact_character_memories,
)
from app.engine.clerk.episodic import (  # noqa: F401
    _resolve_summarize_fn,
    compute_episodic_chunk_witnesses,
    compute_episodic_chunk_salience,
    _derive_fallback_episodic_fields,
    summarize_turn_chunk,
    _ORIGINAL_SUMMARIZE_TURN_CHUNK,
    summarize_turn_chunk_structured,
)
from app.engine.clerk.heuristics import (  # noqa: F401
    heuristic_post_turn_delta,
    _heuristic_spatial_and_inventory_delta,
    heuristic_world_post_turn_delta,
)
from app.engine.clerk.pipeline import (  # noqa: F401
    should_fast_path_passive_bystander,
    run_phase5_post_turn_clerk,
)

run_phase4_post_turn_clerk = run_phase5_post_turn_clerk
