"""Character, psyche, memory shard, and cognition schemas."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

MemoryOrigin = Literal[
    "backstory", "clerk_ephemeral", "clerk_promoted", "compacted"
]
MemorySignificance = Literal[
    "trauma", "bonding", "betrayal", "revelation", "vow", "consolidated"
]


class VoiceAnchor(BaseModel):
    """Few-shot dialogue and action anchor demonstrating character cadence."""

    context: str = Field(
        description="Situational or emotional context, e.g. 'Calm / Banter', 'Cornered / Hostile', 'Vulnerable'."
    )
    snippet: str = Field(
        description="1-3 sentences of sample action and dialogue showing exact voice and mannerisms."
    )


class BaselinePsyche(BaseModel):
    """Initial psychological and motivational profile for a character."""

    mood_label: str = Field(default="Wary but composed")
    valence: float = Field(
        default=0.0,
        ge=-1.0,
        le=1.0,
        description="Emotional valence from -1.0 (distressed/hostile) to +1.0 (elated/warm).",
    )
    arousal: float = Field(
        default=0.4,
        ge=0.0,
        le=1.0,
        description="Emotional activation/intensity from 0.0 (calm/lethargic) to 1.0 (panicked/furious).",
    )
    core_drive: str = Field(description="Deep long-term motivation guiding the character's life.")
    core_fear: str = Field(description="What the character most dreads losing or facing.")
    default_want: str = Field(description="Immediate scene-level desire at the start of the story.")
    default_plan: str = Field(description="Initial actionable approach to achieving their want.")


class MemoryShard(BaseModel):
    """Atomic backstory or episodic/personal memory seeded into the character's vector store."""

    id: str | None = Field(
        default=None,
        description="Optional stable identifier for branch tracking, promotion, or superseding.",
    )
    title: str = Field(description="Short label for the memory shard.")
    content: str = Field(
        description="Self-contained 2-4 sentence memory written from an objective or personal perspective."
    )
    keywords: list[str] = Field(default_factory=list, description="Entity names and triggers.")
    emotional_weight: float = Field(default=0.7, ge=0.0, le=1.0)
    origin: MemoryOrigin = Field(
        default="backstory",
        description="Origin tier: 'backstory', 'clerk_ephemeral', 'clerk_promoted', or 'compacted'.",
    )
    significance: MemorySignificance | None = Field(
        default=None,
        description="Personal significance category when extracted or compacted by the Clerk.",
    )
    anchor_turn_id: str | None = Field(
        default=None,
        description="Turn ID where this memory was formed (for branch-safe filtering).",
    )
    created_at_depth: int | None = Field(
        default=None,
        description="Turn depth index when this memory was created (for 40-turn compaction tracking).",
    )
    superseded_at_turn_id: str | None = Field(
        default=None,
        description="Turn ID where this ephemeral memory was superseded or compacted into a consolidated memory.",
    )


class CharacterWizardSeed(BaseModel):
    """User-provided basic inputs for the 1.1 Character Creation Wizard."""

    name: str = Field(..., min_length=1, description="Character's name or alias.")
    archetype: str = Field(..., description="Brief concept, e.g. 'Burned-out cyber-surgeon turned bartender'.")
    role_in_story: str = Field(
        default="Key deuteragonist & confidant",
        description="How this character relates to the protagonist/user.",
    )
    personality_keywords: list[str] = Field(
        default_factory=list,
        description="3-5 adjectives or tropes.",
    )
    rough_notes: str = Field(
        default="",
        description="Optional freeform notes, physical details, secrets, or backstory ideas.",
    )
    world_id: str | None = Field(
        default=None,
        description="Optional world ID to ground the character in an existing setting.",
    )


class CharacterWizardDraft(BaseModel):
    """Structured AI-expanded character package produced by the Character Wizard."""

    name: str
    tagline: str = Field(description="One-line evocative summary of the character.")
    physical_appearance: str = Field(
        default="",
        description=(
            "Dedicated immutable physical appearance (build, facial features, hair, eyes, "
            "scars, permanent cyberware/augmentations) excluding temporary clothing or held items."
        ),
    )
    core_persona: str = Field(
        description=(
            "High-density persona block (~150-300 words) covering psychology, "
            "demeanor, speech habits, and behavioral rules for Zone 1 Static Prefix."
        )
    )
    initial_message: str = Field(
        default="",
        description=(
            "Default Turn 0 opening scene narrative prose and in-character greeting "
            "(actions in *italics*, spoken dialogue in \"quotes\")."
        ),
    )
    equipped: list[str] = Field(
        default_factory=list,
        description="Starting equipped attire, armor, cyberware, or wielded weapons.",
    )
    inventory: list[str] = Field(
        default_factory=list,
        description="Starting carried inventory of tools, personal items, or stashed objects.",
    )
    voice_anchors: list[VoiceAnchor] = Field(default_factory=list)
    baseline_psyche: BaselinePsyche
    memory_shards: list[MemoryShard] = Field(default_factory=list)
    tags: list[str] = Field(
        default_factory=list,
        description="Optional categorization tags for filtering, grouping, and card export.",
    )
    creator: str = Field(
        default="",
        description="Optional author name, handle, or contact string for card export and SillyTavern compatibility.",
    )
    creator_notes: str = Field(
        default="",
        description="Optional built-in usage/roleplay guidance or scenario notes from the creator.",
    )


class CharacterRecord(CharacterWizardDraft):
    """Persisted character entity in SQLite."""

    id: str
    world_id: str | None = None
    pending_deletion: bool = False
    version: int = Field(
        default=1,
        description="Monotonically increasing version counter.",
    )
    created_at: str


class CharacterVersionSummary(BaseModel):
    """Version metadata entry for historical inspection."""

    id: str
    character_id: str
    version: int
    created_at: str


class CharacterUpdatePayload(CharacterWizardDraft):
    """Payload for updating a character (in-place if unused, or silently forked if used by a campaign)."""

    world_id: str | None = None


class CognitionBlock(BaseModel):
    """Structured multi-step thinking emitted in Phase 3 before narrative prose."""

    recall: str = Field(
        default="",
        description="What the character remembers from history/lore relevant to this moment (1-3 bullet points starting with '- ' on separate lines).",
    )
    feeling: str = Field(
        default="",
        description="How the character feels right now in response to the user's words/subtext (1 evocative sentence).",
    )
    valence: float = Field(default=0.0, ge=-1.0, le=1.0)
    arousal: float = Field(default=0.5, ge=0.0, le=1.0)
    want: str = Field(
        default="",
        description="What the character needs and wants in this immediate interaction (1 singular sentence).",
    )
    plan: str = Field(
        default="",
        description="What the character plans to do or say right now (2-3 sequential bullet points starting with '- ' on separate lines).",
    )
    skipped: bool = Field(
        default=False,
        description="True if the model omitted the <cognition> block and streamed prose directly.",
    )


class CharacterStateSnapshot(BaseModel):
    """Turn-indexed affective, spatial, inventory, and motivational state of a character."""

    turn_id: str
    character_id: str
    current_location_id: str
    mood_label: str
    valence: float = Field(default=0.0, ge=-1.0, le=1.0)
    arousal: float = Field(default=0.4, ge=0.0, le=1.0)
    active_want: str
    active_plan: str
    relationship_notes: dict[str, str] = Field(default_factory=dict)
    equipped: list[str] = Field(default_factory=list)
    inventory: list[str] = Field(default_factory=list)
