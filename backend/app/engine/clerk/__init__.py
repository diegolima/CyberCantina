"""Phase 5 async post-turn clerk & character state package.

Submodules:
- `gossip`: Witness verification & persona turn-state gossip propagation
- `inventory`: Inventory normalization, add/remove merging, and heuristic delta extraction
- `memories`: Character memory shard deduplication, extraction, and semantic compaction
- `episodic`: Turn-chunk witness calculation, salience scoring, and episodic summarization
- `heuristics`: Deterministic offline fallback deltas for world/character post-turn state
- `pipeline`: `run_phase5_post_turn_clerk` coordinator & passive-bystander fast path
"""

from __future__ import annotations

from app.engine.clerk.gossip import (
    merge_scene_flags,
    verify_prose_gossip_exchanges,
    apply_turn_persona_state_and_gossip,
)
from app.engine.clerk.inventory import (
    _normalize_inventory_item,
    _matches_inventory_removal,
    merge_inventory,
    _GENERIC_ITEM_ADJECTIVES,
    _extract_heuristic_inventory_delta,
)
from app.engine.clerk.memories import (
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
from app.engine.clerk.episodic import (
    _resolve_summarize_fn,
    compute_episodic_chunk_witnesses,
    compute_episodic_chunk_salience,
    _derive_fallback_episodic_fields,
    summarize_turn_chunk,
    _ORIGINAL_SUMMARIZE_TURN_CHUNK,
    summarize_turn_chunk_structured,
)
from app.engine.clerk.heuristics import (
    heuristic_post_turn_delta,
    _heuristic_spatial_and_inventory_delta,
    heuristic_world_post_turn_delta,
)
from app.engine.clerk.pipeline import (
    should_fast_path_passive_bystander,
    run_phase5_post_turn_clerk,
)

__all__ = [
    "merge_scene_flags",
    "verify_prose_gossip_exchanges",
    "apply_turn_persona_state_and_gossip",
    "_normalize_inventory_item",
    "_matches_inventory_removal",
    "merge_inventory",
    "_GENERIC_ITEM_ADJECTIVES",
    "_extract_heuristic_inventory_delta",
    "_STOP_WORDS",
    "_synthesize_concise_sentences",
    "_tokenize_meaningful",
    "_memory_similarity",
    "_SIGNIFICANCE_PATTERNS",
    "_extract_heuristic_character_memories",
    "resolve_present_character_for_memory",
    "apply_extracted_character_memories",
    "CompactedMemorySpec",
    "compact_character_memories",
    "_resolve_summarize_fn",
    "compute_episodic_chunk_witnesses",
    "compute_episodic_chunk_salience",
    "_derive_fallback_episodic_fields",
    "summarize_turn_chunk",
    "_ORIGINAL_SUMMARIZE_TURN_CHUNK",
    "summarize_turn_chunk_structured",
    "heuristic_post_turn_delta",
    "_heuristic_spatial_and_inventory_delta",
    "heuristic_world_post_turn_delta",
    "should_fast_path_passive_bystander",
    "run_phase5_post_turn_clerk",
]
