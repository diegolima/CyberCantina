"""Character, psyche, memory shard, and cognition schemas."""

from __future__ import annotations

from collections.abc import Sequence
import hashlib
import html
import json
import re
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.affective import (
    INTENSITY_TO_AROUSAL,
    TONE_TO_VALENCE,
    AgencyLevel,
    AffectiveCareState,
    CategoricalFeelingImpulse,
    CopingLevel,
    FeelingTone,
    IntensityLevel,
    TemperamentConfig,
    ThreatLevel,
    WorldviewProfile,
    coerce_agency_level,
    coerce_coping_level,
    coerce_feeling_tone,
    coerce_intensity_level,
    coerce_threat_level,
    impulse_from_legacy_floats,
)

MemoryOrigin = Literal[
    "backstory", "clerk_ephemeral", "clerk_promoted", "compacted"
]
MemorySignificance = Literal[
    "trauma", "bonding", "betrayal", "revelation", "vow", "consolidated"
]
ItemFlag = Literal["permanent", "artifact"]
VALID_ITEM_FLAGS: tuple[ItemFlag, ...] = ("permanent", "artifact")

CanonicalOutcomeTier = Literal[
    "Critical Failure",
    "Failure with Consequences",
    "Simple Failure",
    "Clean Success",
    "Critical Success",
]

_ITEM_PREFIX_RE = re.compile(
    r"^\[(?:worn|carried|equipped|held|stashed|clothing|item|object)\]\s*",
    flags=re.IGNORECASE,
)
_ITEM_SUFFIX_RE = re.compile(
    r"\s*\((?:worn|carried|equipped|held|stashed|clothing|item|object)\)$",
    flags=re.IGNORECASE,
)


def normalize_item_key(raw: str) -> str:
    """Normalize an item name for deterministic legacy ID hashing and matching."""
    s = re.sub(r"\s+", " ", (raw or "").strip().lower())
    s = _ITEM_PREFIX_RE.sub("", s)
    s = _ITEM_SUFFIX_RE.sub("", s).strip()
    return s or re.sub(r"\s+", " ", (raw or "").strip().lower())


def deterministic_item_id(name: str) -> str:
    """Derive a stable deterministic item ID from normalized item name."""
    norm = normalize_item_key(name)
    digest = hashlib.sha1(norm.encode("utf-8")).hexdigest()[:10]
    return f"item_{digest}"


class ItemInstance(BaseModel):
    """Structured inventory/equipment item with deterministic legacy-string coercion."""

    id: str = Field(
        default="",
        description="Stable item identifier (deterministic hash when coerced from legacy str).",
    )
    name: str = Field(..., min_length=1, max_length=160)
    note: str = Field(
        default="",
        max_length=300,
        description="Brief player note or mini-lore attached to this item.",
    )
    flags: list[ItemFlag] = Field(default_factory=list)
    lore_id: str | None = Field(
        default=None,
        description="Linked World LoreNode ID if flagged as a world artifact.",
    )

    @model_validator(mode="before")
    @classmethod
    def _coerce_raw_input(cls, data: Any) -> Any:
        if isinstance(data, cls):
            return data
        if isinstance(data, str):
            clean = re.sub(r"\s+", " ", data.strip())[:160]
            if not clean:
                raise ValueError("Item name cannot be empty.")
            return {
                "id": deterministic_item_id(clean),
                "name": clean,
                "note": "",
                "flags": [],
                "lore_id": None,
            }
        if isinstance(data, dict):
            raw_name = str(data.get("name") or "").strip()
            clean_name = re.sub(r"\s+", " ", raw_name)[:160]
            raw_id = str(data.get("id") or "").strip() or (
                deterministic_item_id(clean_name) if clean_name else ""
            )
            raw_note = str(data.get("note") or "").strip()[:300]
            raw_lore = str(data.get("lore_id") or "").strip() or None
            raw_flags = data.get("flags") if isinstance(data.get("flags"), list) else []
            dedup_flags: list[str] = []
            for flag in raw_flags:
                if isinstance(flag, str):
                    fc = flag.strip().lower()
                    if fc in VALID_ITEM_FLAGS and fc not in dedup_flags:
                        dedup_flags.append(fc)
            return {
                **data,
                "id": raw_id,
                "name": clean_name,
                "note": raw_note,
                "flags": dedup_flags,
                "lore_id": raw_lore,
            }
        return data

    @model_validator(mode="after")
    def _normalize_flag_invariants(self) -> "ItemInstance":
        if not self.id or not self.id.strip():
            self.id = deterministic_item_id(self.name)
        self.lore_id = (self.lore_id or "").strip() or None
        dedup: list[ItemFlag] = []
        for f in self.flags:
            if f in VALID_ITEM_FLAGS and f not in dedup:
                dedup.append(f)
        if self.lore_id and "artifact" not in dedup:
            dedup.append("artifact")
        elif not self.lore_id and "artifact" in dedup:
            dedup = [f for f in dedup if f != "artifact"]
        self.flags = dedup
        return self

    @classmethod
    def from_raw(
        cls,
        raw: Any,
        *,
        strict_artifact_link: bool = False,
    ) -> "ItemInstance | None":
        """Coerce str | dict | ItemInstance safely, returning None on blank strings."""
        if raw is None:
            return None
        if isinstance(raw, cls):
            return raw
        if isinstance(raw, str):
            clean = re.sub(r"\s+", " ", raw.strip())[:160]
            if not clean:
                return None
            return cls(id=deterministic_item_id(clean), name=clean)
        if isinstance(raw, dict):
            raw_name = str(raw.get("name") or "").strip()
            if not raw_name:
                return None
            if strict_artifact_link:
                raw_flags = raw.get("flags") if isinstance(raw.get("flags"), list) else []
                has_art_flag = any(
                    isinstance(f, str) and f.strip().lower() == "artifact"
                    for f in raw_flags
                )
                raw_lore = str(raw.get("lore_id") or "").strip() or None
                if has_art_flag and not raw_lore:
                    raise ValueError(
                        "Flag 'artifact' requires linking a valid world artifact lore_id."
                    )
            return cls.model_validate(raw)
        raise ValueError(f"Unsupported item format: {type(raw)}")

    def __str__(self) -> str:
        return self.name

    def __eq__(self, other: object) -> bool:
        if isinstance(other, str):
            return self.name == other
        if isinstance(other, ItemInstance):
            return super().__eq__(other)
        return NotImplemented

    def lower(self) -> str:
        return self.name.lower()

    def strip(self, chars: str | None = None) -> str:
        return self.name.strip(chars)

    def startswith(self, prefix: str | tuple[str, ...]) -> bool:
        return self.name.startswith(prefix)

    def endswith(self, suffix: str | tuple[str, ...]) -> bool:
        return self.name.endswith(suffix)


def coerce_item_list(
    val: Any,
    *,
    strict_artifact_link: bool = False,
) -> list[ItemInstance]:
    """Coerce heterogeneous list[str | dict | ItemInstance] with intra-list ID disambiguation."""
    if not isinstance(val, list):
        return []
    result: list[ItemInstance] = []
    seen_ids: set[str] = set()
    for idx, entry in enumerate(val):
        parsed = ItemInstance.from_raw(entry, strict_artifact_link=strict_artifact_link)
        if parsed is None:
            continue
        if parsed.id in seen_ids:
            parsed = parsed.model_copy(update={"id": f"{parsed.id}_{idx}"})
        seen_ids.add(parsed.id)
        result.append(parsed)
    return result


def format_item_names(items: Sequence[ItemInstance | str]) -> list[str]:
    """Extract clean display names for prompt formatting and ', '.join(...) call sites."""
    names: list[str] = []
    for it in items:
        label = it.name if isinstance(it, ItemInstance) else str(it).strip()
        if label:
            names.append(label)
    return names


def dump_items_json(items: Sequence[ItemInstance | str]) -> str:
    """Serialize item list to canonical JSON array of ItemInstance dicts for SQLite."""
    coerced = coerce_item_list(list(items))
    return json.dumps([it.model_dump() for it in coerced])


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
    initial_worldview: WorldviewProfile = Field(
        default_factory=WorldviewProfile,
        description="Starting Layer 1 existential priors (benevolence, belonging, agency).",
    )
    temperament: TemperamentConfig = Field(
        default_factory=TemperamentConfig,
        description="Gottman & Kalman psychological temperament preset and dynamics tuning.",
    )


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


VALID_EMOTIONS = (
    "default",
    "happy",
    "sad",
    "afraid",
    "angry",
    "disgusted",
    "surprised",
    "contempt",
)


class GalleryImage(BaseModel):
    """Photo album asset item for a character."""

    id: str = Field(description="Unique identifier for the gallery image.")
    url: str = Field(description="URL or endpoint path to retrieve the image.")
    caption: str = Field(default="", description="Optional caption or title for the image.")
    created_at: str = Field(description="ISO 8601 timestamp when the image was uploaded.")


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


BASELINE_MOOD_PRESETS: dict[str, tuple[float, float]] = {
    "Calm & Composed": (0.2, 0.2),
    "Wary & Guarded": (-0.2, 0.4),
    "Melancholy & Subdued": (-0.5, 0.2),
    "Hostile & Tense": (-0.7, 0.8),
    "Uneasy & On-Edge": (-0.4, 0.6),
    "Warm & Receptive": (0.6, 0.3),
    "Elated & Triumphant": (0.8, 0.7),
}


def normalize_starting_mood(
    raw_mood: str | None,
    valence: float | None = None,
    arousal: float | None = None,
) -> tuple[str, float, float]:
    """Snap any raw mood string or coords to one of the 7 canonical baseline presets."""
    if raw_mood and raw_mood in BASELINE_MOOD_PRESETS:
        preset_v, preset_a = BASELINE_MOOD_PRESETS[raw_mood]
        v = valence if valence is not None else preset_v
        a = arousal if arousal is not None else preset_a
        return raw_mood, v, a

    clean = (raw_mood or "").strip().lower()
    if any(k in clean for k in ("wary", "guard", "suspicio", "skeptic", "cautio", "defens")):
        label = "Wary & Guarded"
    elif any(k in clean for k in ("calm", "compos", "steady", "serene", "poised", "relax")):
        label = "Calm & Composed"
    elif any(k in clean for k in ("melanchol", "subdue", "sad", "gloom", "depress", "weary", "sorrow")):
        label = "Melancholy & Subdued"
    elif any(k in clean for k in ("hostil", "tense", "angr", "furious", "aggres", "fuming")):
        label = "Hostile & Tense"
    elif any(k in clean for k in ("uneas", "edge", "nervous", "anxious", "restless", "fear", "alarm")):
        label = "Uneasy & On-Edge"
    elif any(k in clean for k in ("warm", "receptiv", "friend", "kind", "open", "welcom")):
        label = "Warm & Receptive"
    elif any(k in clean for k in ("elat", "triumphant", "joy", "excite", "cheer", "proud")):
        label = "Elated & Triumphant"
    elif valence is not None and arousal is not None:
        best_label = "Calm & Composed"
        best_dist = float("inf")
        for p_label, (pv, pa) in BASELINE_MOOD_PRESETS.items():
            dist = ((valence - pv) ** 2 + (arousal - pa) ** 2) ** 0.5
            if dist < best_dist:
                best_dist = dist
                best_label = p_label
        label = best_label
    else:
        label = "Calm & Composed"

    v, a = BASELINE_MOOD_PRESETS[label]
    return label, v, a


def _split_plan_steps(raw: Any) -> list[str]:
    """Split a string or sequence of tactical plan items into clean standalone step strings."""
    if raw is None:
        return []
    if isinstance(raw, (list, tuple)):
        items: list[str] = []
        for entry in raw:
            items.extend(_split_plan_steps(str(entry)))
        return items

    text = sanitize_character_markup(str(raw))
    if not text:
        return []
    items = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        # Split inline merged bullets such as '. - Next step', ' * Next', or ' - Step'
        parts = re.split(
            r"(?<=[.!?;:])\s+-\s+|\s+[•*]\s+|\s+-\s+(?=[A-Z])|\s+(?=\d+[.)]\s+[A-Z])",
            line,
        )
        for part in parts:
            p = part.strip()
            if p:
                items.append(p)
    cleaned: list[str] = []
    for item in items:
        step = re.sub(r"^(?:[-*•]+|\d+[.)])\s*", "", item).strip()
        if step:
            cleaned.append(step)
    return cleaned


def normalize_bullet_plan(plan: str | Sequence[str] | None) -> str:
    """Normalize an action plan into newline-separated '- ' markdown bullet points."""
    steps = _split_plan_steps(plan)
    if not steps:
        return ""
    return "\n".join(f"- {step}" for step in steps)


_HTML_COMMENT_RE = re.compile(r"<!--[\s\S]*?-->")
_REASONING_BLOCK_RE = re.compile(
    r"<(?P<tag>think|thought|reasoning|scratchpad)\b[^>]*>[\s\S]*?</(?P=tag)\s*>",
    re.IGNORECASE,
)
_ITALIC_TAG_RE = re.compile(
    r"<(?P<tag>i|em)\b[^>]*>([\s\S]*?)</(?P=tag)\s*>",
    re.IGNORECASE,
)
_PARAGRAPH_BOUNDARY_RE = re.compile(r"</p\s*>\s*<p\b[^>]*>", re.IGNORECASE)
_PARAGRAPH_TAG_RE = re.compile(r"</?p\b[^>]*>", re.IGNORECASE)
_BR_TAG_RE = re.compile(r"<br\s*/?>", re.IGNORECASE)
_LIST_ITEM_OPEN_RE = re.compile(r"<li\b[^>]*>", re.IGNORECASE)
_LIST_ITEM_CLOSE_RE = re.compile(r"</li\s*>", re.IGNORECASE)
_ANY_MARKUP_TAG_RE = re.compile(r"</?[a-zA-Z][a-zA-Z0-9_:-]*(?:\s+[^<>]*?)?/?>")


def _italic_match_to_markdown(match: re.Match[str]) -> str:
    """Convert an HTML <i>/<em> match into paragraph-safe Markdown *italics*."""
    raw_inner = match.group(2)
    if not raw_inner or not raw_inner.strip():
        return ""
    lead_ws_match = re.match(r"^\s*", raw_inner)
    trail_ws_match = re.search(r"\s*$", raw_inner)
    lead_ws = lead_ws_match.group(0) if lead_ws_match else ""
    trail_ws = trail_ws_match.group(0) if trail_ws_match else ""
    core = raw_inner.strip()

    paragraphs = re.split(r"\n{2,}", core)
    wrapped_paras: list[str] = []
    for para in paragraphs:
        p = para.strip()
        if not p:
            continue
        if p.startswith("*") and p.endswith("*") and len(p) > 2:
            wrapped_paras.append(p)
        else:
            p_clean = p.replace("*", "")
            if p_clean:
                wrapped_paras.append(f"*{p_clean}*")
    if not wrapped_paras:
        return ""
    return f"{lead_ws}" + "\n\n".join(wrapped_paras) + f"{trail_ws}"


def sanitize_character_markup(
    text: str,
    *,
    preserve_italics: bool = False,
    single_line: bool = False,
) -> str:
    """Strip LLM-generated HTML/XML tags & entities while preserving prose *italics* when requested."""
    if not text:
        return ""
    cleaned = _HTML_COMMENT_RE.sub("", text)
    cleaned = _REASONING_BLOCK_RE.sub("", cleaned)

    cleaned = _PARAGRAPH_BOUNDARY_RE.sub("\n\n", cleaned)
    cleaned = _PARAGRAPH_TAG_RE.sub("\n\n", cleaned)
    cleaned = _BR_TAG_RE.sub(" " if single_line else "\n", cleaned)
    cleaned = _LIST_ITEM_OPEN_RE.sub("- ", cleaned)
    cleaned = _LIST_ITEM_CLOSE_RE.sub("\n", cleaned)

    if preserve_italics:
        prev = None
        while prev != cleaned:
            prev = cleaned
            cleaned = _ITALIC_TAG_RE.sub(_italic_match_to_markdown, cleaned)

    cleaned = _ANY_MARKUP_TAG_RE.sub("", cleaned)
    cleaned = html.unescape(cleaned).replace("\xa0", " ")

    if single_line:
        return re.sub(r"\s+", " ", cleaned).strip()

    lines = [ln.rstrip() for ln in cleaned.splitlines()]
    cleaned = "\n".join(lines)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


class CharacterWizardPass1LLMOutput(BaseModel):
    """Pass 1 target: Core narrative identity, demographics, metric height, immutable anatomy, and gear."""

    name: str = Field(default="New Character")
    tagline: str = Field(default="", description="One-line evocative summary of the character.")
    character_bio: str = Field(
        default="",
        description="High-level narrative concept, background origin, public reputation, occupation, and role in world. Strictly exclude physical anatomy and clothing.",
    )
    species: str = Field(default="Human", description="Biological or mechanical origin.")
    sex: str = Field(default="", description="Biological sex or presentation ('Male', 'Female', 'Non-binary'). Never leave empty.")
    pronouns: str = Field(default="", description="Grammatical pronouns ('he/him', 'she/her', 'they/them'). Never leave empty.")
    age: str = Field(default="", description="Chronological or apparent age (e.g. '34', '52', '21'). Never leave empty.")
    build_and_height: str = Field(
        default="",
        description="Metric height ONLY calibrated to species, sex, and archetype (e.g. '182 cm', '168 cm', '194 cm'). STRICTLY EXCLUDE build, frame, or weight descriptors. Never leave empty.",
    )
    physical_appearance: str = Field(
        default="",
        description="Dedicated immutable physical appearance (facial features, hair, eyes, scars, permanent mods) strictly excluding clothing/held gear.",
    )
    distinctive_features: list[str] = Field(
        default_factory=list,
        description="Exactly 6 concise chips of concrete immutable physical markers: eyes, hair, skin, scars, tattoos, build, or anomalies. At least 1 chip MUST be unusual or quirky. STRICTLY NO CLOTHES OR GEAR.",
    )
    posture: str = Field(default="", description="Habitual physical stance and bearing.")
    mannerisms: list[str] = Field(
        default_factory=list,
        description="4 natural behavioral micro-actions and conversational tells (covering stress, guardedness, idle habit, and speech cadence, written directly without category labels).",
    )
    visual_aesthetic: str = Field(
        default="",
        description="High-level clothing style or dress vibe brief (e.g. 'practical weathered techwear', 'travel-worn boiled leather').",
    )
    equipped: list[str] = Field(
        default_factory=list,
        description="3-5 starting equipped clothing, armor, or wielded items strictly consistent with world genre. Each entry MUST be a single discrete object (1 upper body, 1 lower body, 1 footwear, 1 belt/accessory). Never join multiple items with 'and'.",
    )
    inventory: list[str] = Field(
        default_factory=list,
        description="2-4 starting carried tools, personal pocket items, or keepsakes strictly consistent with world genre. Each entry must be a single discrete object.",
    )
    tags: list[str] = Field(default_factory=list)


class CharacterWizardPass2LLMOutput(BaseModel):
    """Pass 2 target: Demeanor, aligned moral code & flaws, literary voice anchors, action plan, and episodic vector memories."""

    personality_traits: list[str] = Field(
        default_factory=list,
        description="4-6 high-level tropes, traits, or archetypal adjectives (chips).",
    )
    core_persona: str = Field(
        default="",
        description="High-signal, concise demeanor block (45-75 words, 2-4 crisp sentences) covering interpersonal attitude, social defense mechanisms, and conversational intent. Do NOT repeat personality_traits, communication_style, moral code, or physical traits.",
    )
    moral_code: list[str] = Field(
        default_factory=list,
        description="2-3 ethical boundaries or lines they will not cross, STRICTLY ALIGNED with their persona (e.g. a detached cynic has transactional boundaries, NOT generic heroic vows).",
    )
    quirks_flaws: list[str] = Field(
        default_factory=list,
        description="2-3 concrete behavioral flaws, vices, or neurotic habits.",
    )
    communication_style: list[str] = Field(
        default_factory=list,
        description="3-5 voice texture chips (e.g. ['clipped', 'monotone', 'dryly sarcastic', 'mid-Atlantic cadence']).",
    )
    voice_anchors: list[VoiceAnchor] = Field(
        default_factory=list,
        description="3 distinct action+dialogue examples ('Calm / Banter', 'Guarded / Under Pressure', 'Vulnerable / Urgent') stylistically grounded in prominent genre authors.",
    )
    starting_mood: str = Field(
        default="Calm & Composed",
        description="One of: 'Calm & Composed', 'Wary & Guarded', 'Melancholy & Subdued', 'Hostile & Tense', 'Uneasy & On-Edge', 'Warm & Receptive', 'Elated & Triumphant'.",
    )
    core_drive: str = Field(
        default="",
        description="One concise sentence capturing the character's underlying life motivation.",
    )
    core_fear: str = Field(
        default="",
        description="One concise sentence capturing the character's deep emotional or existential fear.",
    )
    default_want: str = Field(
        default="",
        description="One concise sentence capturing their immediate short-term objective right now, grounded in their bio and current predicament.",
    )
    default_plan: list[str] = Field(
        default_factory=list,
        description="2-3 concise tactical Turn 0 action steps (plain strings without bullet dashes; each element renders on its own line).",
    )
    memory_shards: list[MemoryShard] = Field(
        default_factory=list,
        description="3-4 concrete episodic backstory memory shards (Who, What happened, Where, Consequence) with entity keywords for vector retrieval. Strictly avoid poetic or abstract scene painting.",
    )

    @field_validator("default_plan", mode="before")
    @classmethod
    def _coerce_default_plan(cls, v: Any) -> list[str]:
        return _split_plan_steps(v)


class CharacterWizardPass3LLMOutput(BaseModel):
    """Pass 3 target: Structured 3-beat Turn 0 opening scene and in-character greeting."""

    initial_message: str = Field(
        default="",
        description=(
            "Focused 3-beat Turn 0 scene (~90-140 words): "
            "(1) *Environment & immediate stakes* grounded in current situation, "
            "(2) *Quick visual character overview* & tell, "
            "(3) \"Intent-driven opening dialogue\" matching their predicament and voice anchors."
        ),
    )


class CharacterWizardLLMOutput(BaseModel):
    """LLM-only structured output target for character generation & SillyTavern distillation (keeps list[str] gear)."""

    name: str
    tagline: str = Field(description="One-line evocative summary of the character.")
    character_bio: str = Field(
        default="",
        description="High-level narrative concept, background origin, public reputation, occupation, and role. Strictly exclude physical anatomy, hair/eyes, scars, cyberware, clothing, or personality quirks.",
    )
    physical_appearance: str = Field(
        default="",
        description=(
            "Dedicated immutable physical appearance (build, facial features, hair, eyes, "
            "scars, permanent cyberware/augmentations) excluding temporary clothing or held items."
        ),
    )
    species: str = Field(default="Human", description="Biological or mechanical origin.")
    sex: str = Field(default="", description="Biological sex or presentation.")
    pronouns: str = Field(default="", description="Grammatical pronouns (e.g. he/him, she/her, they/them).")
    age: str = Field(default="", description="Chronological or apparent age.")
    build_and_height: str = Field(default="", description="Metric height ONLY (e.g. '182 cm'). Put physical build in distinctive_features.")
    distinctive_features: list[str] = Field(
        default_factory=list,
        description="Exactly 6 concise chips for concrete physical markers: eyes, hair, skin, scars, tattoos, or setting anomalies. At least 1 chip must be an unusual or quirky feature. STRICTLY NO CLOTHES OR GEAR.",
    )
    posture: str = Field(default="", description="Habitual physical stance and bearing (e.g. 'composed and alert').")
    mannerisms: list[str] = Field(
        default_factory=list,
        description="At least 4 behavioral micro-actions and conversational tells (e.g. 1 under pressure, 1 when guarded, 1 idle, 1 speech tic).",
    )
    modifications: list[str] = Field(default_factory=list, description="Cyberware, implants, tattoos, or scars (auto-merged into distinctive_features).")
    visual_aesthetic: str = Field(default="", description="General clothing style or dress vibe (e.g. 'practical weathered techwear').")
    personality_traits: list[str] = Field(default_factory=list, description="4-6 high-level tropes and traits (chips).")
    core_persona: str = Field(
        description=(
            "High-signal, concise demeanor block (45-75 words, 2-4 crisp sentences) covering "
            "interpersonal attitude, social defense mechanisms, and conversational intent. "
            "Strictly exclude items in personality_traits, communication_style, moral_code, quirks_flaws, and physical traits."
        )
    )
    moral_code: list[str] = Field(
        default_factory=list,
        description="2-3 ethical boundaries or lines the character will not cross (e.g. ['never harms non-combatants']).",
    )
    quirks_flaws: list[str] = Field(
        default_factory=list,
        description="2-3 concrete behavioral flaws, vices, or neurotic habits (e.g. ['chain smoker under stress']).",
    )
    communication_style: list[str] = Field(
        default_factory=list,
        description="3-5 voice texture chips (e.g. ['clipped', 'monotone', 'dryly sarcastic']).",
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
        description="Starting equipped attire, armor, cyberware, or wielded weapons consistent with world genre.",
    )
    inventory: list[str] = Field(
        default_factory=list,
        description="Starting carried inventory of tools, personal items, or stashed objects consistent with world genre.",
    )
    voice_anchors: list[VoiceAnchor] = Field(default_factory=list)
    baseline_psyche: BaselinePsyche
    memory_shards: list[MemoryShard] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    creator: str = Field(default="")
    creator_notes: str = Field(default="")

    @model_validator(mode="after")
    def _sync_bio_and_appearance(self) -> "CharacterWizardLLMOutput":
        if not self.character_bio and self.physical_appearance:
            self.character_bio = self.physical_appearance
        elif not self.physical_appearance and self.character_bio:
            self.physical_appearance = self.character_bio
        if self.modifications:
            seen = {f.lower() for f in self.distinctive_features}
            for m in self.modifications:
                if m.strip() and m.strip().lower() not in seen:
                    self.distinctive_features.append(m.strip())
                    seen.add(m.strip().lower())
        return self

    def to_draft(self) -> "CharacterWizardDraft":
        """Normalize '[Worn]'/'[Equipped]' string prefixes and convert to CharacterWizardDraft."""
        raw_eq = [s.strip() for s in self.equipped if isinstance(s, str) and s.strip()]
        raw_inv = [s.strip() for s in self.inventory if isinstance(s, str) and s.strip()]
        if not raw_eq and raw_inv:
            separated_eq: list[str] = []
            separated_inv: list[str] = []
            for it in raw_inv:
                if re.match(r"^\[(?:worn|equipped)\]\s*", it, re.IGNORECASE):
                    cleaned = re.sub(r"^\[(?:worn|equipped)\]\s*", "", it, flags=re.IGNORECASE).strip()
                    if cleaned:
                        separated_eq.append(cleaned)
                else:
                    separated_inv.append(it)
            if separated_eq:
                raw_eq = separated_eq
                raw_inv = separated_inv
        return CharacterWizardDraft(
            name=self.name,
            tagline=self.tagline,
            character_bio=self.character_bio,
            physical_appearance=self.physical_appearance,
            species=self.species,
            sex=self.sex,
            pronouns=self.pronouns,
            age=self.age,
            build_and_height=self.build_and_height,
            distinctive_features=list(self.distinctive_features),
            posture=self.posture,
            mannerisms=list(self.mannerisms),
            modifications=list(self.modifications),
            visual_aesthetic=self.visual_aesthetic,
            personality_traits=list(self.personality_traits),
            core_persona=self.core_persona,
            moral_code=list(self.moral_code),
            quirks_flaws=list(self.quirks_flaws),
            communication_style=list(self.communication_style),
            initial_message=self.initial_message,
            equipped=coerce_item_list(raw_eq),
            inventory=coerce_item_list(raw_inv),
            voice_anchors=list(self.voice_anchors),
            baseline_psyche=self.baseline_psyche,
            memory_shards=list(self.memory_shards),
            tags=list(self.tags),
            creator=self.creator,
            creator_notes=self.creator_notes,
        )


class CharacterWizardDraft(BaseModel):
    """Structured AI-expanded character package produced by the Character Wizard."""

    name: str
    tagline: str = Field(description="One-line evocative summary of the character.")
    character_bio: str = Field(
        default="",
        description="High-level narrative concept, background origin, public reputation, occupation, and role. Strictly exclude physical anatomy, hair/eyes, scars, cyberware, clothing, or personality quirks.",
    )
    physical_appearance: str = Field(
        default="",
        description=(
            "Dedicated immutable physical appearance (build, facial features, hair, eyes, "
            "scars, permanent cyberware/augmentations) excluding temporary clothing or held items."
        ),
    )
    species: str = Field(default="Human", description="Biological or mechanical origin.")
    sex: str = Field(default="", description="Biological sex or presentation.")
    pronouns: str = Field(default="", description="Grammatical pronouns (e.g. he/him, she/her, they/them).")
    age: str = Field(default="", description="Chronological or apparent age.")
    build_and_height: str = Field(default="", description="Metric height ONLY (e.g. '182 cm'). Put physical build in distinctive_features.")
    distinctive_features: list[str] = Field(
        default_factory=list,
        description="3-6 concise chips for concrete physical markers: eyes, hair, skin, scars, tattoos, or setting anomalies.",
    )
    posture: str = Field(default="", description="Habitual physical stance and bearing (e.g. 'composed and alert').")
    mannerisms: list[str] = Field(
        default_factory=list,
        description="2-3 behavioral micro-actions and conversational tells (e.g. ['fidgets with signet ring when pressured']).",
    )
    modifications: list[str] = Field(default_factory=list, description="Cyberware, implants, tattoos, or scars (auto-merged into distinctive_features).")
    visual_aesthetic: str = Field(default="", description="General clothing style or dress vibe (e.g. 'practical weathered techwear').")
    personality_traits: list[str] = Field(default_factory=list, description="3-5 high-level tropes and traits (chips).")
    core_persona: str = Field(
        description=(
            "High-signal, concise demeanor block (45-75 words, 2-4 crisp sentences) covering "
            "interpersonal attitude, social defense mechanisms, and conversational intent. "
            "Strictly exclude items in personality_traits, communication_style, moral_code, quirks_flaws, and physical traits."
        )
    )
    moral_code: list[str] = Field(
        default_factory=list,
        description="2-3 ethical boundaries or lines the character will not cross (e.g. ['never harms non-combatants']).",
    )
    quirks_flaws: list[str] = Field(
        default_factory=list,
        description="2-3 concrete behavioral flaws, vices, or neurotic habits (e.g. ['chain smoker under stress']).",
    )
    communication_style: list[str] = Field(
        default_factory=list,
        description="3-5 voice texture chips (e.g. ['clipped', 'monotone', 'dryly sarcastic']).",
    )
    initial_message: str = Field(
        default="",
        description=(
            "Default Turn 0 opening scene narrative prose and in-character greeting "
            "(actions in *italics*, spoken dialogue in \"quotes\")."
        ),
    )
    equipped: list[ItemInstance] = Field(
        default_factory=list,
        description="Starting equipped attire, armor, cyberware, or wielded weapons.",
    )
    inventory: list[ItemInstance] = Field(
        default_factory=list,
        description="Starting carried inventory of tools, personal items, or stashed objects.",
    )

    @model_validator(mode="after")
    def _sanitize_and_sync_fields(self) -> "CharacterWizardDraft":
        for field_name in (
            "name",
            "tagline",
            "species",
            "sex",
            "pronouns",
            "age",
            "build_and_height",
            "posture",
            "visual_aesthetic",
            "creator",
        ):
            val = getattr(self, field_name, "")
            if val:
                setattr(self, field_name, sanitize_character_markup(val, single_line=True))

        for field_name in (
            "character_bio",
            "physical_appearance",
            "core_persona",
            "creator_notes",
        ):
            val = getattr(self, field_name, "")
            if val:
                setattr(self, field_name, sanitize_character_markup(val))

        if self.initial_message:
            self.initial_message = sanitize_character_markup(
                self.initial_message, preserve_italics=True
            )

        for list_field in (
            "distinctive_features",
            "mannerisms",
            "modifications",
            "personality_traits",
            "moral_code",
            "quirks_flaws",
            "communication_style",
            "tags",
        ):
            raw_list = getattr(self, list_field, [])
            if raw_list:
                cleaned_list = [
                    s
                    for s in (
                        sanitize_character_markup(x, single_line=True)
                        for x in raw_list
                        if isinstance(x, str)
                    )
                    if s
                ]
                setattr(self, list_field, cleaned_list)

        for va in self.voice_anchors:
            va.context = sanitize_character_markup(va.context, single_line=True)
            va.snippet = sanitize_character_markup(va.snippet, preserve_italics=True)

        if self.baseline_psyche:
            bp = self.baseline_psyche
            bp.mood_label = sanitize_character_markup(bp.mood_label, single_line=True)
            bp.core_drive = sanitize_character_markup(bp.core_drive, single_line=True)
            bp.core_fear = sanitize_character_markup(bp.core_fear, single_line=True)
            bp.default_want = sanitize_character_markup(bp.default_want, single_line=True)
            bp.default_plan = sanitize_character_markup(bp.default_plan)

        for ms in self.memory_shards:
            ms.title = sanitize_character_markup(ms.title, single_line=True)
            ms.content = sanitize_character_markup(ms.content)
            ms.keywords = [
                k
                for k in (
                    sanitize_character_markup(kw, single_line=True)
                    for kw in ms.keywords
                )
                if k
            ]

        for item in (*self.equipped, *self.inventory):
            item.name = sanitize_character_markup(item.name, single_line=True)
            item.note = sanitize_character_markup(item.note, single_line=True)

        if not self.character_bio and self.physical_appearance:
            self.character_bio = self.physical_appearance
        elif not self.physical_appearance and self.character_bio:
            self.physical_appearance = self.character_bio
        if self.modifications:
            seen = {f.lower() for f in self.distinctive_features}
            for m in self.modifications:
                if m.strip() and m.strip().lower() not in seen:
                    self.distinctive_features.append(m.strip())
                    seen.add(m.strip().lower())
        return self

    @field_validator("equipped", "inventory", mode="before")
    @classmethod
    def _coerce_items(cls, val: Any) -> list[ItemInstance]:
        return coerce_item_list(val)
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
    portraits: dict[str, str] = Field(
        default_factory=dict,
        description="Map of emotional expression (e.g. 'default', 'happy') to media asset URL.",
    )
    gallery: list[GalleryImage] = Field(
        default_factory=list,
        description="List of uploaded photo album image assets.",
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

    @field_validator("equipped", "inventory", mode="before")
    @classmethod
    def _coerce_items(cls, val: Any) -> list[ItemInstance]:
        return coerce_item_list(val, strict_artifact_link=True)


class CognitionBlock(BaseModel):
    """Structured multi-step thinking emitted in Phase 3 before narrative prose."""

    recall: str = Field(
        default="",
        description="Up to 2-3 concise bullet points recalling immediate trigger, key backstory, or secret relevant right now (strictly under 12 words per bullet; never pad with filler).",
    )
    feeling: str = Field(
        default="",
        description="1 concise evocative sentence (under 20 words) capturing internal emotional state right now, anchored to <internal_affective_state>.",
    )
    feeling_tone: FeelingTone = Field(
        default="neutral",
        description="Primary affective tone right now.",
    )
    feeling_intensity: IntensityLevel = Field(
        default="moderate",
        description="Emotional activation/intensity level right now.",
    )
    feeling_agency: AgencyLevel = Field(
        default="steady",
        description="Sense of personal control, leverage, or dominance right now.",
    )
    scene_threat: ThreatLevel = Field(
        default="none",
        description="Immediate physical or social danger perceived in the scene.",
    )
    scene_coping: CopingLevel = Field(
        default="adequate",
        description="Assessed tactical ability to handle the situation.",
    )
    valence: float = Field(default=0.0, ge=-1.0, le=1.0)
    arousal: float = Field(default=0.5, ge=0.0, le=1.0)
    feeling_impulse: CategoricalFeelingImpulse | None = Field(
        default=None,
        description="Parsed categorical affective appraisal from Phase 3.",
    )
    want: str = Field(
        default="",
        description="1 singular sentence (under 20 words) defining immediate scene objective.",
    )
    selected_choice: str | None = Field(
        default=None,
        description="The choice selected from the Director options, or null if none.",
    )
    choice_compliance: Literal["complied", "coerced"] | None = Field(
        default=None,
        description="Compliance state of character choice execution.",
    )
    choice_compliance_note: str | None = Field(
        default=None,
        description="Human-readable reason for choice coercion, if any.",
    )
    plan: str = Field(
        default="",
        description="2-3 brief sequential bullet points (under 15 words each) outlining immediate physical action and dialogue, adhering strictly to the Object Interaction Hierarchy and roll outcome.",
    )
    skipped: bool = Field(
        default=False,
        description="True if the model omitted the <cognition> block and streamed prose directly.",
    )
    roll_outcome_tier: CanonicalOutcomeTier | None = Field(
        default=None,
        description="Mechanical check outcome tier resolved for this character this turn.",
    )

    @field_validator("roll_outcome_tier", mode="before")
    @classmethod
    def _coerce_roll_outcome(cls, v: Any) -> CanonicalOutcomeTier | None:
        if not v:
            return None
        s = str(v).strip().lower()
        mapping: dict[str, CanonicalOutcomeTier] = {
            "critical failure": "Critical Failure",
            "failure with consequences": "Failure with Consequences",
            "simple failure": "Simple Failure",
            "clean success": "Clean Success",
            "critical success": "Critical Success",
        }
        return mapping.get(s)

    @field_validator("feeling_tone", mode="before")
    @classmethod
    def _coerce_tone(cls, v: Any) -> FeelingTone:
        return coerce_feeling_tone(v)

    @field_validator("feeling_intensity", mode="before")
    @classmethod
    def _coerce_intensity(cls, v: Any) -> IntensityLevel:
        return coerce_intensity_level(v)

    @field_validator("feeling_agency", mode="before")
    @classmethod
    def _coerce_agency(cls, v: Any) -> AgencyLevel:
        return coerce_agency_level(v)

    @field_validator("scene_threat", mode="before")
    @classmethod
    def _coerce_threat(cls, v: Any) -> ThreatLevel:
        return coerce_threat_level(v)

    @field_validator("scene_coping", mode="before")
    @classmethod
    def _coerce_coping(cls, v: Any) -> CopingLevel:
        return coerce_coping_level(v)

    @model_validator(mode="after")
    def _sync_affective_cognition(self) -> "CognitionBlock":
        categorical_keys = {
            "feeling_tone",
            "feeling_intensity",
            "feeling_agency",
            "scene_threat",
            "scene_coping",
        }
        has_cat_set = bool(self.model_fields_set & categorical_keys)
        has_legacy_float_set = bool(self.model_fields_set & {"valence", "arousal"})

        if self.feeling_impulse is not None:
            if "valence" not in self.model_fields_set:
                self.valence = round(
                    self.feeling_impulse.legacy_valence
                    if (
                        self.feeling_impulse.used_legacy_float_fallback
                        and self.feeling_impulse.legacy_valence is not None
                    )
                    else TONE_TO_VALENCE[self.feeling_impulse.tone],
                    2,
                )
            if "arousal" not in self.model_fields_set:
                self.arousal = round(
                    self.feeling_impulse.legacy_arousal
                    if (
                        self.feeling_impulse.used_legacy_float_fallback
                        and self.feeling_impulse.legacy_arousal is not None
                    )
                    else INTENSITY_TO_AROUSAL[self.feeling_impulse.intensity],
                    2,
                )
            if not has_cat_set:
                self.feeling_tone = self.feeling_impulse.tone
                self.feeling_intensity = self.feeling_impulse.intensity
                self.feeling_agency = self.feeling_impulse.agency
                self.scene_threat = self.feeling_impulse.threat
                self.scene_coping = self.feeling_impulse.coping
        elif has_cat_set and not has_legacy_float_set:
            self.valence = round(TONE_TO_VALENCE[self.feeling_tone], 2)
            self.arousal = round(INTENSITY_TO_AROUSAL[self.feeling_intensity], 2)
            if not self.skipped:
                self.feeling_impulse = CategoricalFeelingImpulse(
                    tone=self.feeling_tone,
                    intensity=self.feeling_intensity,
                    agency=self.feeling_agency,
                    threat=self.scene_threat,
                    coping=self.scene_coping,
                )
        elif has_legacy_float_set and not has_cat_set:
            imp = impulse_from_legacy_floats(self.valence, self.arousal)
            self.feeling_tone = imp.tone
            self.feeling_intensity = imp.intensity
            self.feeling_agency = imp.agency
            self.scene_threat = imp.threat
            self.scene_coping = imp.coping
            if not self.skipped:
                self.feeling_impulse = imp
        elif has_cat_set and has_legacy_float_set:
            if not self.skipped:
                self.feeling_impulse = CategoricalFeelingImpulse(
                    tone=self.feeling_tone,
                    intensity=self.feeling_intensity,
                    agency=self.feeling_agency,
                    threat=self.scene_threat,
                    coping=self.scene_coping,
                )
        return self

    def to_feeling_impulse(self) -> CategoricalFeelingImpulse:
        """Return validated CategoricalFeelingImpulse for provisional previews and Phase 5 fusion."""
        if self.feeling_impulse is not None:
            return self.feeling_impulse
        return CategoricalFeelingImpulse(
            tone=self.feeling_tone,
            intensity=self.feeling_intensity,
            agency=self.feeling_agency,
            threat=self.scene_threat,
            coping=self.scene_coping,
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
    equipped: list[ItemInstance] = Field(default_factory=list)
    inventory: list[ItemInstance] = Field(default_factory=list)
    unlocked_persona_keys: list[str] = Field(default_factory=list)
    persona_knowledge_provenance: dict[str, Any] = Field(default_factory=dict)
    care_state: AffectiveCareState | None = Field(
        default=None,
        description="Self-contained 4-layer CARE affective and relational snapshot.",
    )

    @field_validator("equipped", "inventory", mode="before")
    @classmethod
    def _coerce_state_items(cls, val: Any) -> list[ItemInstance]:
        return coerce_item_list(val)


class CharacterFeatureExtractionRequest(BaseModel):
    character_bio: str
    existing_features: list[str] = Field(default_factory=list)


class CharacterFeatureExtractionResponse(BaseModel):
    extracted_features: list[str] = Field(default_factory=list)
    rewritten_bio: str


class CharacterPersonaExtractionRequest(BaseModel):
    core_persona: str
    existing_moral_code: list[str] = Field(default_factory=list)
    existing_quirks_flaws: list[str] = Field(default_factory=list)


class CharacterPersonaExtractionResponse(BaseModel):
    extracted_moral_code: list[str] = Field(default_factory=list)
    extracted_quirks_flaws: list[str] = Field(default_factory=list)
    rewritten_core_persona: str



class CharacterQuirksExtractionRequest(BaseModel):
    core_persona: str
    existing_quirks: list[str] = Field(default_factory=list)


class CharacterQuirksExtractionResponse(BaseModel):
    extracted_quirks: list[str] = Field(default_factory=list)
    rewritten_core_persona: str
