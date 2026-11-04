"""Turn pipeline, mechanics/RNG, state snapshot, and campaign tree schemas."""

from __future__ import annotations

from typing import Any, Awaitable, Callable, Final, Literal
import re

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.character import (
    CharacterRecord,
    CharacterStateSnapshot,
    CognitionBlock,
    MemoryShard,
)
from app.schemas.persona import PersonaRecord
from app.schemas.world import (
    CompassDirection,
    LocationEdge,
    LocationNode,
    NeighborLocationView,
    normalize_compass_direction,
)


CanonicalOutcomeTier = Literal[
    "Critical Failure",
    "Failure with Consequences",
    "Simple Failure",
    "Clean Success",
    "Critical Success",
]

CheckRole = Literal[
    "active_attempt",
    "contested_reaction",
    "scene_hazard",
    "co_present_bystander",
]

DiceMode = Literal[
    "auto",
    "forced",
    "disabled",
]

ChoiceGate = Literal[
    "any",
    "critical_success",
    "success_plus",
    "failure_minus",
    "critical_failure",
]

ChoiceStatus = Literal[
    "mandatory",
    "constrained",
    "free_with_exclusions",
]

ChoiceComplianceOutcome = Literal[
    "complied",
    "coerced",
]

DEFAULT_GATE_DC: Final[int] = 12
MAX_CHOICE_LABEL_LENGTH: Final[int] = 80
MAX_CHOICE_OPTIONS: Final[int] = 6


class CharacterChoiceOption(BaseModel):
    """A single choice/possibility directed to a character."""

    label: str = Field(min_length=1, max_length=MAX_CHOICE_LABEL_LENGTH)
    gate: ChoiceGate = "any"

    @field_validator("label", mode="before")
    @classmethod
    def _sanitize_label(cls, v: Any) -> str:
        if v is None:
            return ""
        s = str(v).strip()
        s = re.sub(r"\s+", " ", s)
        s = re.sub(r"[<>]", "", s).strip()
        return s[:MAX_CHOICE_LABEL_LENGTH]


class CharacterChoiceSet(BaseModel):
    """Collection of options presented to a character, with an optional custom gate DC."""

    options: list[CharacterChoiceOption] = Field(min_length=1, max_length=MAX_CHOICE_OPTIONS)
    gate_difficulty_class: int = Field(default=DEFAULT_GATE_DC, ge=1, le=30)

    @model_validator(mode="after")
    def _unique_labels_casefold(self) -> CharacterChoiceSet:
        seen = set()
        for opt in self.options:
            norm = opt.label.casefold()
            if norm in seen:
                raise ValueError(f"Duplicate choice option label: '{opt.label}'")
            seen.add(norm)
        return self

    @property
    def has_gates(self) -> bool:
        return any(opt.gate != "any" for opt in self.options)


class ChoiceResolution(BaseModel):
    """Unchangeable audit snapshot of what Phase 3 was told. Never recomputed on load."""

    character_id: str
    status: ChoiceStatus
    gate_roll_tier: CanonicalOutcomeTier | None = None
    allowed: list[str] = Field(default_factory=list)
    excluded: list[str] = Field(default_factory=list)
    ruleset_version: int = 1


class MechanicsTrigger(BaseModel):
    """Auxiliary detection of an uncertain/risky action requiring an RNG check."""

    requires_roll: bool = False
    action_description: str = ""
    skill_or_approach: str = "General"
    difficulty_class: int = Field(default=12, ge=5, le=25)
    relevant_modifier: int = Field(default=0, ge=-5, le=8)


class CharacterCheckSpec(BaseModel):
    """JSON-Schema-safe per-character check specification emitted in a single Phase 1 pass."""

    character_id: str = Field(
        description="Exact character ID from Characters Present in Room."
    )
    requires_roll: bool = Field(
        default=False,
        description="True ONLY if this specific character attempts, resists, or is directly exposed to a risky action this turn.",
    )
    check_role: CheckRole = Field(
        default="active_attempt",
        description="Role in the check: 'active_attempt' (initiating action), 'contested_reaction' (defending/resisting), or 'scene_hazard' (reacting to hazard).",
    )
    action_description: str = Field(
        default="",
        description="Action or reaction phrased strictly from THIS character's perspective and agency.",
    )
    skill_or_approach: str = Field(
        default="General",
        description="Relevant skill or approach for this character.",
    )
    difficulty_class: int = Field(default=12, ge=5, le=25)
    relevant_modifier: int = Field(
        default=0,
        ge=-5,
        le=8,
        description="Modifier derived from this character's archetype, tagline, and equipped/carried gear.",
    )


class DiceRollResult(BaseModel):
    """Resolved d20 check injected into Zone 4 so the Actor narrates the outcome."""

    character_id: str | None = None
    character_name: str | None = None
    check_role: CheckRole = "active_attempt"
    is_manual_override: bool = False
    is_choice_gate: bool = False
    action_description: str
    skill_or_approach: str
    d20_raw: int = Field(ge=1, le=20)
    modifier: int
    total: int
    difficulty_class: int
    outcome_tier: CanonicalOutcomeTier
    plan_directive: str = Field(
        default="",
        description="Explicit instruction governing how the character's Phase 3 <plan> is affected.",
    )
    narrative_directive: str = Field(
        description="Explicit instruction governing Phase 4 prose depiction and consequences."
    )

    @field_validator("outcome_tier", mode="before")
    @classmethod
    def _normalize_legacy_outcome_tier(cls, v: Any) -> Any:
        if v == "Failure with Consequence":
            return "Failure with Consequences"
        if v == "Partial Success":
            return "Simple Failure"
        return v


class PreTurnLLMOutput(BaseModel):
    """Grammar-safe Phase 1 output produced by the Auxiliary Pre-Processor LLM."""

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
    character_checks: list[CharacterCheckSpec] = Field(default_factory=list)
    revealed_persona_keys: list[str] = Field(
        default_factory=list,
        description="Secret persona keys explicitly revealed by the player's message this turn.",
    )


class PreTurnAnalysis(PreTurnLLMOutput):
    """Hydrated Phase 1 pre-turn analysis with deterministic per-character RNG results."""

    dice_mode: DiceMode = Field(
        default="auto",
        description="Effective RNG mode ('auto', 'forced', or 'disabled') applied to this turn.",
    )
    manual_dice_value: int | None = Field(
        default=None,
        ge=1,
        le=20,
        description="Pinned d20 value if user specified one in 'forced' mode; None when random or non-forced.",
    )
    character_rolls: dict[str, DiceRollResult] = Field(default_factory=dict)
    resolved_roll: DiceRollResult | None = None
    character_choices: dict[str, CharacterChoiceSet] = Field(default_factory=dict)
    choice_resolutions: dict[str, ChoiceResolution] = Field(default_factory=dict)
    dice_mode_promoted: bool = False

    @model_validator(mode="before")
    @classmethod
    def _backfill_legacy_dice_mode(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if "dice_mode" not in data or data["dice_mode"] is None:
                char_rolls = data.get("character_rolls") or {}
                resolved = data.get("resolved_roll")
                has_manual = False
                manual_val = None
                if isinstance(resolved, dict) and resolved.get("is_manual_override"):
                    has_manual = True
                    manual_val = resolved.get("d20_raw")
                elif isinstance(char_rolls, dict):
                    for r in char_rolls.values():
                        if isinstance(r, dict) and r.get("is_manual_override"):
                            has_manual = True
                            manual_val = r.get("d20_raw")
                            break
                if has_manual:
                    data["dice_mode"] = "forced"
                    data["manual_dice_value"] = manual_val
                else:
                    data["dice_mode"] = "auto"
        return data

    @model_validator(mode="after")
    def _populate_resolved_roll(self) -> PreTurnAnalysis:
        if self.dice_mode == "disabled":
            self.character_rolls = {}
            self.resolved_roll = None
            self.mechanics_check.requires_roll = False
            for c in self.character_checks:
                c.requires_roll = False
            self.manual_dice_value = None
            return self

        if self.dice_mode != "forced":
            self.manual_dice_value = None

        if self.resolved_roll is None and self.character_rolls:
            if self.active_speaker_id and self.active_speaker_id in self.character_rolls:
                self.resolved_roll = self.character_rolls[self.active_speaker_id]
            else:
                self.resolved_roll = next(iter(self.character_rolls.values()))
        elif not self.character_rolls:
            self.resolved_roll = None
        return self


RecallSourceType = Literal[
    "lore", "location_lore", "character_shard", "episodic_chunk", "item_lore"
]


class RecalledMemoryItem(BaseModel):
    """A single world/location lore, character shard, item lore, or episodic memory retrieved for Zone 4."""

    id: str
    source_type: RecallSourceType
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


class ExtractedCharacterMemory(BaseModel):
    """Per-character high-salience personal memory extracted by the Phase 4 Clerk."""

    character_id: str = Field(
        default="",
        description="ID (or name) of the present character who experienced this personal memory.",
    )
    title: str = Field(
        description="Short 3-6 word evocative title for the memory."
    )
    content: str = Field(
        description=(
            "Strictly 1-2 synthesized sentences capturing the specific event/catalyst and "
            "the character's personal/emotional takeaway."
        )
    )
    significance: Literal["trauma", "bonding", "betrayal", "revelation", "vow"] = Field(
        default="revelation",
        description="Category of personal significance: 'trauma', 'bonding', 'betrayal', 'revelation', or 'vow'.",
    )
    keywords: list[str] = Field(
        default_factory=list,
        description="2-5 entity names or trigger keywords for semantic recall.",
    )
    emotional_weight: float = Field(
        default=0.85,
        ge=0.0,
        le=1.0,
        description="Emotional intensity weight (0.75-1.0 for transformative moments).",
    )
    supersedes_memory_id: str | None = Field(
        default=None,
        description=(
            "If this refines or updates an existing ephemeral memory from the ongoing scene, "
            "set to that memory's ID instead of creating a duplicate."
        ),
    )

    @field_validator("significance", mode="before")
    @classmethod
    def _coerce_significance(
        cls, v: Any
    ) -> Literal["trauma", "bonding", "betrayal", "revelation", "vow"]:
        if isinstance(v, str):
            low = v.strip().lower()
            if low in {"trauma", "bonding", "betrayal", "revelation", "vow"}:
                return low  # type: ignore[return-value]
            if "traum" in low or "fear" in low or "scar" in low:
                return "trauma"
            if "bond" in low or "trust" in low or "friend" in low:
                return "bonding"
            if "betray" in low or "decei" in low or "lie" in low:
                return "betrayal"
            if "vow" in low or "promis" in low or "oath" in low or "swear" in low:
                return "vow"
        return "revelation"


class WorldPostTurnDelta(BaseModel):
    """Global world-state output produced by the Post-Turn World Clerk (clock, space, flags, macro events)."""

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
        description="1-sentence objective summary if a significant macro plot or world-state event transpired.",
    )
    scene_flags_updated: list[str] = Field(default_factory=list)
    scene_flags_removed: list[str] = Field(default_factory=list)

    @field_validator("elapsed_minutes", mode="before")
    @classmethod
    def _clamp_elapsed_minutes(cls, v: Any) -> int:
        try:
            return max(0, min(1440, int(round(float(v)))))
        except (TypeError, ValueError):
            return 2


CharacterLocationTransition = Literal["stay_here", "follow_player", "move_to_neighbor"]


class CharacterAgentDelta(BaseModel):
    """Per-character post-turn state mutation proposal emitted by a Character State Agent."""

    mood_label: str = Field(
        default="Observant and composed",
        description="2-4 word evocative mood description capturing the character's current affective state.",
    )
    valence_delta: float = Field(
        default=0.0,
        ge=-1.0,
        le=1.0,
        description="Signed change in emotional valence relative to pre-turn baseline (typically -0.20 to +0.20).",
    )
    arousal_delta: float = Field(
        default=0.0,
        ge=-1.0,
        le=1.0,
        description="Signed change in emotional arousal/intensity relative to pre-turn baseline (typically -0.20 to +0.20).",
    )
    updated_want: str | None = Field(
        default=None,
        description="Optional refreshed 1-sentence immediate goal if the scene shifted what this character wants.",
    )
    stance_updates: dict[str, str] = Field(
        default_factory=dict,
        description=(
            "Sparse 'target: stance' pairs for entities whose standing shifted this turn "
            "(use 'user' for the player and character ID or name for other characters; each stance is 1 short sentence)."
        ),
    )
    items_equipped: list[str] = Field(
        default_factory=list,
        description="Items or clothing newly put on, worn, drawn, or wielded by this character this turn.",
    )
    items_unequipped: list[str] = Field(
        default_factory=list,
        description="Previously equipped items stowed, holstered, or tucked back into carried inventory (not dropped).",
    )
    items_obtained: list[str] = Field(
        default_factory=list,
        description="Items newly picked up, received, or pocketed into carried inventory by this character.",
    )
    items_removed: list[str] = Field(
        default_factory=list,
        description="Items dropped, handed over to someone else, stripped off and left behind, or consumed.",
    )
    location_transition: CharacterLocationTransition = Field(
        default="stay_here",
        description=(
            "'stay_here' if staying in the starting room, 'follow_player' if moving together with the player "
            "to the new active scene location, or 'move_to_neighbor' if departing independently to an adjacent exit."
        ),
    )
    target_location_id: str | None = Field(
        default=None,
        description="Destination neighbor location ID when location_transition == 'move_to_neighbor'.",
    )
    new_memories: list[ExtractedCharacterMemory] = Field(
        default_factory=list,
        description=(
            "Transformative personal memories ('trauma', 'bonding', 'betrayal', 'revelation', 'vow') "
            "formed by THIS character on this turn. Empty list on ordinary turns."
        ),
    )
    persona_secrets_disclosed_to: dict[str, list[str]] = Field(
        default_factory=dict,
        description="Gossip exchange: mapping of recipient character_id to secret persona keys communicated in dialogue.",
    )

    @field_validator("valence_delta", "arousal_delta", mode="before")
    @classmethod
    def _clamp_affect_delta(cls, v: Any) -> float:
        try:
            return round(max(-1.0, min(1.0, float(v))), 2)
        except (TypeError, ValueError):
            return 0.0

    @field_validator("stance_updates", mode="before")
    @classmethod
    def _coerce_stance_updates(cls, v: Any) -> dict[str, str]:
        if isinstance(v, dict):
            return {
                str(k).strip(): str(val).strip()
                for k, val in v.items()
                if str(k).strip() and val is not None and str(val).strip()
            }
        if isinstance(v, list):
            out: dict[str, str] = {}
            for entry in v:
                if isinstance(entry, str) and ":" in entry:
                    target, stance = entry.split(":", 1)
                    if target.strip() and stance.strip():
                        out[target.strip()] = stance.strip()
                elif isinstance(entry, dict):
                    target = str(
                        entry.get("character")
                        or entry.get("target")
                        or entry.get("id")
                        or ""
                    ).strip()
                    stance = str(
                        entry.get("stance") or entry.get("note") or entry.get("view") or ""
                    ).strip()
                    if target and stance:
                        out[target] = stance
            return out
        return {}

    @field_validator("location_transition", mode="before")
    @classmethod
    def _coerce_location_transition(cls, v: Any) -> CharacterLocationTransition:
        if isinstance(v, str):
            low = v.strip().lower()
            if low in ("stay_here", "follow_player", "move_to_neighbor"):
                return low  # type: ignore[return-value]
            if "follow" in low or "with_player" in low or "accompany" in low:
                return "follow_player"
            if "neighbor" in low or "depart" in low or "leave" in low or "move" in low:
                return "move_to_neighbor"
        return "stay_here"


class PersonaGossipEvent(BaseModel):
    """A secret persona trait shared between NPCs during narrative prose."""

    source_character_id: str
    recipient_character_id: str
    trait_key: str
    verbatim_reference: str = Field(
        default="",
        description="Snippet from raw_prose substantiating the gossip.",
    )


class DisputedItemDecision(BaseModel):
    """Single item custody ruling issued by the Clerk Arbitrator."""

    item_name: str = Field(description="Name of the contested item.")
    winner_id: str = Field(
        description="Winning character_id who holds the item at the end of the turn, 'user' if the player holds it, or 'none' if nobody acquired it."
    )
    rationale: str = Field(
        default="",
        description="Brief 1-sentence justification grounded in the narrative prose and dice outcome.",
    )


class ArbitrationRulingRecord(BaseModel):
    """Structured audit record for a contested item custody decision."""

    item_name: str
    reason: Literal["multi_claim", "unrelinquished_transfer"]
    claimant_ids: list[str] = Field(default_factory=list)
    prior_holder_id: str | None = None
    winner_id: str  # character_id, 'user', or 'none'
    winner_label: str
    rationale: str = ""


class InventoryArbitrationResult(BaseModel):
    """Clerk arbitration output resolving contested item claims across Character Agents."""

    decisions: list[DisputedItemDecision] = Field(default_factory=list)


class PostTurnStateDelta(BaseModel):
    """Composite post-turn state record combining Global World Clerk output and reconciled Character Agent deltas."""

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
        description="Items or clothing newly put on, picked up, or acquired by the active character this turn.",
    )
    inventory_removed: list[str] = Field(
        default_factory=list,
        description="Items or clothing taken off, dropped, given away, or consumed by the active character this turn.",
    )
    relationship_shift_note: str | None = None
    character_memories: list[ExtractedCharacterMemory] = Field(
        default_factory=list,
        description=(
            "Significant personal memories (trauma, bonding, betrayal, revelation, vow) formed "
            "this turn by characters present in the scene. Empty list on ordinary turns."
        ),
    )
    character_deltas: dict[str, CharacterAgentDelta] = Field(
        default_factory=dict,
        description="Per-character post-turn deltas indexed by character_id.",
    )
    arbitration_notes: list[str] = Field(
        default_factory=list,
        description="Audit log of Clerk arbitration rulings if item disputes occurred this turn.",
    )
    character_names: dict[str, str] = Field(
        default_factory=dict,
        description="Snapshot map of character_id -> display name for all agents that ran on this turn.",
    )
    arbitration_rulings: list[ArbitrationRulingRecord] = Field(
        default_factory=list,
        description="Structured item custody rulings linking winners, losing claimants, and prior holders.",
    )
    compacted_character_ids: list[str] = Field(
        default_factory=list,
        description="Character IDs whose aged ephemeral memories were consolidated into a compacted shard this turn.",
    )


CharacterSpotlightRole = Literal["primary_speaker", "co_present"]


class Phase3RosterEntry(BaseModel):
    """Single character entry in the Phase 3 Multi-Cognition execution roster."""

    character_id: str
    character_name: str
    role: CharacterSpotlightRole


class Phase3ProgressEvent(BaseModel):
    """Real-time lifecycle event emitted over SSE during Phase 3 Multi-Cognition."""

    event: Literal[
        "phase3_start",
        "phase3_agent_start",
        "phase3_agent_complete",
        "phase3_agent_error",
        "phase3_complete",
    ]
    dispatch_mode: str | None = None
    roster: list[Phase3RosterEntry] | None = None
    character_id: str | None = None
    character_name: str | None = None
    role: CharacterSpotlightRole | None = None
    cognition: CognitionBlock | None = None
    cognitions: dict[str, CognitionBlock] | None = None
    character_names: dict[str, str] | None = None
    used_fallback: bool = False
    choice_compliance: ChoiceComplianceOutcome | None = None
    choice_compliance_note: str | None = None
    error: str | None = None


Phase3ProgressCallback = Callable[[Phase3ProgressEvent], Awaitable[None]]

Phase5AgentKind = Literal["world_clerk", "character"]
Phase4AgentKind = Phase5AgentKind


class Phase5RosterEntry(BaseModel):
    agent_key: str  # "clerk" for Global World Clerk, or character.id
    kind: Phase5AgentKind
    label: str      # "clerk" or character.name


Phase4RosterEntry = Phase5RosterEntry


class Phase5ProgressEvent(BaseModel):
    event: Literal[
        "phase5_start",
        "phase5_agent_start",
        "phase5_agent_complete",
        "phase5_agent_error",
        "phase5_arbitration_start",
        "phase4_start",
        "phase4_agent_start",
        "phase4_agent_complete",
        "phase4_agent_error",
        "phase4_arbitration_start",
    ]
    turn_id: str
    dispatch_mode: str | None = None
    roster: list[Phase5RosterEntry] | None = None
    agent_key: str | None = None
    kind: Phase5AgentKind | None = None
    label: str | None = None
    world_delta: WorldPostTurnDelta | None = None
    character_delta: CharacterAgentDelta | None = None
    contested_agent_keys: list[str] | None = None
    error: str | None = None


Phase4ProgressEvent = Phase5ProgressEvent
Phase5ProgressCallback = Callable[[Phase5ProgressEvent], Awaitable[None]]
Phase4ProgressCallback = Phase5ProgressCallback


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
    cognitions: dict[str, CognitionBlock] = Field(
        default_factory=dict,
        description="Per-character Phase 3 CognitionBlocks keyed by character_id.",
    )
    cognition_character_names: dict[str, str] = Field(
        default_factory=dict,
        description="Display name lookup for characters in cognitions.",
    )
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
    persona_id: str | None = None
    persona_snapshot: PersonaRecord | None = None
    participant_character_ids: list[str] = Field(default_factory=list)
    active_leaf_turn_id: str | None = None
    prompt_preset_id: str | None = None
    created_at: str


class CampaignStateBundle(BaseModel):
    """Full live state returned to the Frontend Studio & Inspector."""

    campaign: CampaignRecord
    active_branch_turns: list[TurnNodeRecord]
    all_turn_nodes: list[TurnNodeRecord]
    current_world_snapshot: WorldStateSnapshot
    current_character_state: CharacterStateSnapshot
    character_states: dict[str, CharacterStateSnapshot] = Field(default_factory=dict)
    character_records: dict[str, CharacterRecord] = Field(default_factory=dict)
    present_character_ids: list[str] = Field(default_factory=list)
    active_location: LocationNode
    neighbor_locations: list[NeighborLocationView]
    visible_locations: list[LocationNode]
    visible_edges: list[LocationEdge] = Field(default_factory=list)
    episodic_chunks: list[EpisodicChunkRecord]


class CampaignCharacterMemoriesUpdateRequest(BaseModel):
    """Payload to update campaign-scoped memory shards for a character."""

    memory_shards: list[MemoryShard] = Field(default_factory=list)


class TurnSubmitRequest(BaseModel):
    """Payload to execute a 4-phase roleplay turn (or swipe/branch from parent_turn_id)."""

    user_message: str = Field(default="")
    parent_turn_id: str | None = Field(
        default=None,
        description=(
            "Parent turn ID to branch from. If omitted, uses campaign's active_leaf_turn_id. "
            "Pass an earlier turn ID to regenerate (swipe) or branch the timeline."
        ),
    )
    dice_mode: DiceMode = Field(
        default="auto",
        description="RNG mechanics mode: 'auto' (LLM decides if roll needed), 'forced' (guarantees a roll), 'disabled' (roll never performed).",
    )
    manual_dice_override: int | None = Field(
        default=None,
        ge=1,
        le=20,
        description="Optional manual d20 roll value (1-20), valid only when dice_mode is 'forced'.",
    )
    override_location_id: str | None = Field(
        default=None,
        description="Optional location ID override to force the scene location for this turn or swipe.",
    )
    narrative_mode: Literal[
        "standard",
        "describe",
        "advance",
        "complication",
        "custom",
    ] = Field(
        default="standard",
        description="Turn execution mode: 'standard' for NPC dialogue/actions, or narrator modes for objective world descriptions.",
    )
    narrator_directive: str | None = Field(
        default=None,
        description="Optional guidance for the narrator meta-actor (e.g. specific environmental focus, duration, or event).",
    )
    duration_minutes: int | None = Field(
        default=None,
        ge=1,
        le=1440,
        description="Optional explicit minutes to advance the in-game clock when narrative_mode is 'advance'.",
    )
    character_choices: dict[str, CharacterChoiceSet] = Field(
        default_factory=dict,
        description="Optional director choices keyed by character_id to guide Phase 3 planning.",
    )

    @field_validator("narrative_mode", mode="before")
    @classmethod
    def _coerce_legacy_narrative_mode(cls, v: Any) -> Any:
        if v == "perception":
            return "custom"
        return v

    @field_validator("user_message", mode="before")
    @classmethod
    def _coerce_user_message(cls, v: Any) -> str:
        if v is None:
            return ""
        return str(v)

    @model_validator(mode="after")
    def _reconcile_dice_mode_and_override(self) -> TurnSubmitRequest:
        if "dice_mode" not in self.model_fields_set and self.manual_dice_override is not None:
            self.dice_mode = "forced"
        if self.dice_mode != "forced":
            self.manual_dice_override = None
        if self.dice_mode == "disabled" and any(
            cs.has_gates for cs in self.character_choices.values()
        ):
            self.dice_mode = "auto"
        return self
