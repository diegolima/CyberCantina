"""Turn pipeline, mechanics/RNG, state snapshot, and campaign tree schemas."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.character import CharacterStateSnapshot, CognitionBlock
from app.schemas.world import (
    CompassDirection,
    LocationEdge,
    LocationNode,
    NeighborLocationView,
    normalize_compass_direction,
)


class MechanicsTrigger(BaseModel):
    """Auxiliary detection of an uncertain/risky action requiring an RNG check."""

    requires_roll: bool = False
    action_description: str = ""
    skill_or_approach: str = "General"
    difficulty_class: int = Field(default=12, ge=5, le=25)
    relevant_modifier: int = Field(default=0, ge=-5, le=8)


class DiceRollResult(BaseModel):
    """Resolved d20 check injected into Zone 4 so the Actor narrates the outcome."""

    action_description: str
    skill_or_approach: str
    d20_raw: int
    modifier: int
    total: int
    difficulty_class: int
    outcome_tier: Literal[
        "Critical Failure",
        "Failure with Consequence",
        "Partial Success",
        "Clean Success",
        "Critical Success",
    ]
    narrative_directive: str


class PreTurnAnalysis(BaseModel):
    """Phase 1 output produced by the Auxiliary Pre-Processor."""

    user_sentiment: str = Field(
        default="neutral, attentive",
        description="Emotional tone of the user's message.",
    )
    subtext_interpretation: str = Field(
        default="Direct communication without hidden subtext.",
        description="What the user's character is implying or probing for beneath literal words.",
    )
    mentioned_entities: list[str] = Field(
        default_factory=list,
        description="Characters, places, factions, or items referenced.",
    )
    memory_search_queries: list[str] = Field(
        default_factory=list,
        description="1-2 semantic queries to run against the vector store.",
    )
    spatial_intent: Literal["stay", "move_known", "explore_new"] = "stay"
    target_location_hint: str | None = None
    active_speaker_id: str | None = Field(
        default=None,
        description="Character ID selected to speak on this turn from characters present at active_location.",
    )
    speaker_order: list[str] = Field(
        default_factory=list,
        description="Ordered list of character IDs present at active_location who may speak or banter.",
    )
    mechanics_check: MechanicsTrigger = Field(default_factory=MechanicsTrigger)
    resolved_roll: DiceRollResult | None = None


class RecalledMemoryItem(BaseModel):
    """A single lore, character shard, or episodic memory retrieved for Zone 4."""

    id: str
    source_type: Literal["lore", "character_shard", "episodic_chunk"]
    title: str
    content: str
    score: float = 1.0


class WorldStateSnapshot(BaseModel):
    """Turn-indexed snapshot of the world clock and active location."""

    turn_id: str
    world_timestamp: str
    active_location_id: str
    scene_flags: list[str] = Field(default_factory=list)


class ImprovisedLocationSpec(BaseModel):
    """New location node dynamically created when characters explore an unmapped room/area."""

    name: str
    summary: str
    description: str
    environmental_tags: list[str] = Field(default_factory=list)
    entry_direction_label: str = "Doorway"
    return_direction_label: str = "Back the way you came"
    compass_direction: CompassDirection = "N"
    travel_minutes: int = Field(default=1, ge=1, le=240)

    @field_validator("compass_direction", mode="before")
    @classmethod
    def _coerce_compass_direction(cls, v: Any) -> CompassDirection:
        if v is None:
            return "N"
        return normalize_compass_direction(str(v))


class PostTurnStateDelta(BaseModel):
    """Phase 4 output produced by the Async Post-Turn Clerk."""

    elapsed_minutes: int = Field(
        default=2,
        ge=0,
        le=1440,
        description="Narrative time elapsed during this turn in minutes.",
    )
    new_world_timestamp: str | None = Field(
        default=None,
        description=(
            "Absolute in-world time ('YYYY-MM-DD HH:MM') at the END of this turn, set only when the "
            "turn states or clearly implies a specific time or a time skip (e.g. 'it's 5am', "
            "'they slept until morning', 'three days later'). Overrides elapsed_minutes."
        ),
    )
    transition_type: Literal["stay", "move_existing", "improvise_new"] = "stay"
    target_location_id: str | None = None
    improvised_location: ImprovisedLocationSpec | None = None
    notable_event_summary: str | None = Field(
        default=None,
        description="1-sentence atomic memory if a significant plot or relationship event transpired.",
    )
    scene_flags_updated: list[str] = Field(default_factory=list)
    scene_flags_removed: list[str] = Field(default_factory=list)
    inventory_added: list[str] = Field(
        default_factory=list,
        description="Items or clothing newly put on, picked up, or acquired by the character this turn.",
    )
    inventory_removed: list[str] = Field(
        default_factory=list,
        description="Items or clothing taken off, dropped, given away, or consumed by the character this turn.",
    )
    relationship_shift_note: str | None = None


class EpisodicChunkRecord(BaseModel):
    """Compressed episodic summary for Zone 2 & semantic vector retrieval."""

    id: str
    campaign_id: str
    start_turn_depth: int
    end_turn_depth: int
    leaf_turn_id: str
    summary_text: str
    created_at: str


class TurnNodeRecord(BaseModel):
    """Single exchange node in the branching conversation tree."""

    id: str
    campaign_id: str
    parent_turn_id: str | None = None
    depth_index: int
    user_message: str
    actor_id: str
    raw_prose: str
    cognition: CognitionBlock
    pre_turn: PreTurnAnalysis
    post_turn: PostTurnStateDelta | None = None
    world_snapshot: WorldStateSnapshot
    character_state: CharacterStateSnapshot
    character_states: dict[str, CharacterStateSnapshot] = Field(default_factory=dict)
    recalled_items: list[RecalledMemoryItem] = Field(default_factory=list)
    created_at: str


class CampaignRecord(BaseModel):
    """A playable roleplay campaign linking a World, Character, and Turn Tree."""

    id: str
    name: str
    world_id: str
    character_id: str
    participant_character_ids: list[str] = Field(default_factory=list)
    active_leaf_turn_id: str | None = None
    created_at: str


class CampaignStateBundle(BaseModel):
    """Full live state returned to the Frontend Studio & Inspector."""

    campaign: CampaignRecord
    active_branch_turns: list[TurnNodeRecord]
    all_turn_nodes: list[TurnNodeRecord]
    current_world_snapshot: WorldStateSnapshot
    current_character_state: CharacterStateSnapshot
    character_states: dict[str, CharacterStateSnapshot] = Field(default_factory=dict)
    present_character_ids: list[str] = Field(default_factory=list)
    active_location: LocationNode
    neighbor_locations: list[NeighborLocationView]
    visible_locations: list[LocationNode]
    visible_edges: list[LocationEdge] = Field(default_factory=list)
    episodic_chunks: list[EpisodicChunkRecord]


class TurnSubmitRequest(BaseModel):
    """Payload to execute a 4-phase roleplay turn (or swipe/branch from parent_turn_id)."""

    user_message: str = Field(..., min_length=1)
    parent_turn_id: str | None = Field(
        default=None,
        description=(
            "Parent turn ID to branch from. If omitted, uses campaign's active_leaf_turn_id. "
            "Pass an earlier turn ID to regenerate (swipe) or branch the timeline."
        ),
    )
    manual_dice_override: int | None = Field(
        default=None,
        ge=1,
        le=20,
        description="Optional manual d20 roll value for testing or tabletop override.",
    )
    override_location_id: str | None = Field(
        default=None,
        description="Optional location ID override to force the scene location for this turn or swipe.",
    )
