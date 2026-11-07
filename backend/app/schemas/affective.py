"""Core Pydantic schemas, enums, and archetype presets for the CARE psychology engine."""

from __future__ import annotations

import re
from typing import Any, Final, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

TemperamentArchetype = Literal[
    "balanced",
    "stoic",
    "volatile",
    "confidant",
    "paranoiac",
    "proud_rival",
]

ValidEmotion = Literal[
    "default",
    "happy",
    "sad",
    "afraid",
    "angry",
    "disgusted",
    "surprised",
    "contempt",
]

# Compact vocabularies for Phase 3 XML & GBNF-flat Phase 5 JSON
FeelingTone = Literal[
    "elated",
    "warm",
    "content",
    "neutral",
    "guarded",
    "uneasy",
    "melancholy",
    "bitter",
    "hostile",
    "anguished",
]
IntensityLevel = Literal["calm", "low", "moderate", "high", "extreme"]
AgencyLevel = Literal["helpless", "pressured", "steady", "assured", "commanding"]
ThreatLevel = Literal["none", "low", "moderate", "high", "critical"]
CopingLevel = Literal["overwhelmed", "strained", "adequate", "mastery"]

# Symmetric 5-point ordinal scale for fast GBNF grammar compilation in Phase 5
OrdinalImpact = Literal["strong_neg", "mild_neg", "none", "mild_pos", "strong_pos"]
GrievanceShift = Literal["reconciled", "eased", "none", "slighted", "grave_wrong"]
VisibilityScope = Literal["public_room", "local_whisper", "remote_comm"]

MAX_TURN_ELAPSED_MINUTES_SANITY: Final[int] = 43_200  # 30 days max per single turn

VALID_FEELING_TONES: Final[tuple[FeelingTone, ...]] = (
    "elated",
    "warm",
    "content",
    "neutral",
    "guarded",
    "uneasy",
    "melancholy",
    "bitter",
    "hostile",
    "anguished",
)
VALID_INTENSITY_LEVELS: Final[tuple[IntensityLevel, ...]] = (
    "calm",
    "low",
    "moderate",
    "high",
    "extreme",
)
VALID_AGENCY_LEVELS: Final[tuple[AgencyLevel, ...]] = (
    "helpless",
    "pressured",
    "steady",
    "assured",
    "commanding",
)
VALID_THREAT_LEVELS: Final[tuple[ThreatLevel, ...]] = (
    "none",
    "low",
    "moderate",
    "high",
    "critical",
)
VALID_COPING_LEVELS: Final[tuple[CopingLevel, ...]] = (
    "overwhelmed",
    "strained",
    "adequate",
    "mastery",
)
VALID_ORDINAL_IMPACTS: Final[tuple[OrdinalImpact, ...]] = (
    "strong_neg",
    "mild_neg",
    "none",
    "mild_pos",
    "strong_pos",
)
VALID_GRIEVANCE_SHIFTS: Final[tuple[GrievanceShift, ...]] = (
    "reconciled",
    "eased",
    "none",
    "slighted",
    "grave_wrong",
)

TONE_TO_VALENCE: Final[dict[FeelingTone, float]] = {
    "elated": 0.85,
    "warm": 0.55,
    "content": 0.30,
    "neutral": 0.00,
    "guarded": -0.18,
    "uneasy": -0.35,
    "melancholy": -0.50,
    "bitter": -0.62,
    "hostile": -0.78,
    "anguished": -0.90,
}

INTENSITY_TO_AROUSAL: Final[dict[IntensityLevel, float]] = {
    "calm": 0.15,
    "low": 0.30,
    "moderate": 0.50,
    "high": 0.75,
    "extreme": 0.95,
}


def coerce_temperament_archetype(raw: Any) -> TemperamentArchetype:
    """Coerce free-form strings or display labels into a canonical TemperamentArchetype."""
    if not isinstance(raw, str):
        return "balanced"
    low = raw.strip().lower().replace("-", "_").replace(" ", "_")
    if low in {
        "balanced",
        "stoic",
        "volatile",
        "confidant",
        "paranoiac",
        "proud_rival",
    }:
        return low  # type: ignore[return-value]
    if "stoic" in low or "guard" in low or "unflappable" in low:
        return "stoic"
    if "volatil" in low or "mercenar" in low or "explos" in low or "hothead" in low:
        return "volatile"
    if "confidant" in low or "generous" in low or "empath" in low or "warm" in low:
        return "confidant"
    if "paranoi" in low or "suspici" in low or "cynic" in low:
        return "paranoiac"
    if "rival" in low or "proud" in low or "arrogant" in low or "aristocrat" in low:
        return "proud_rival"
    return "balanced"


def coerce_feeling_tone(raw: Any, default: FeelingTone = "neutral") -> FeelingTone:
    """Coerce LLM tone synonyms into canonical FeelingTone literals."""
    if not isinstance(raw, str):
        return default
    low = raw.strip().lower()
    if low in VALID_FEELING_TONES:
        return low  # type: ignore[return-value]
    if any(k in low for k in ("elat", "joy", "triumph", "thrill", "ecstat", "euphor")):
        return "elated"
    if any(k in low for k in ("warm", "affection", "fond", "friendly", "tender", "grateful")):
        return "warm"
    if any(k in low for k in ("content", "pleased", "amused", "relaxed", "satisfied", "calm")):
        return "content"
    if any(k in low for k in ("anguish", "devastat", "terror", "panick", "despair", "horrif")):
        return "anguished"
    if any(k in low for k in ("hostil", "angr", "furi", "rage", "enrag", "wrath", "aggress")):
        return "hostile"
    if any(k in low for k in ("bitter", "resent", "contempt", "disgust", "scorn", "cynic")):
        return "bitter"
    if any(k in low for k in ("melanchol", "sad", "grief", "sorrow", "hurt", "deject", "weary")):
        return "melancholy"
    if any(k in low for k in ("uneas", "anxi", "nervous", "afraid", "fear", "tense", "worri")):
        return "uneasy"
    if any(k in low for k in ("guard", "wary", "suspici", "cautious", "skeptic", "aloof")):
        return "guarded"
    return default


def coerce_intensity_level(
    raw: Any, default: IntensityLevel = "moderate"
) -> IntensityLevel:
    """Coerce LLM intensity strings into canonical IntensityLevel literals."""
    if not isinstance(raw, str):
        return default
    low = raw.strip().lower()
    if low in VALID_INTENSITY_LEVELS:
        return low  # type: ignore[return-value]
    if any(k in low for k in ("extrem", "peak", "overwhelm", "explos", "severe", "max")):
        return "extreme"
    if any(k in low for k in ("high", "strong", "sharp", "intense", "elevat", "acute")):
        return "high"
    if any(k in low for k in ("med", "moderat", "steady", "normal")):
        return "moderate"
    if any(k in low for k in ("low", "mild", "faint", "slight", "subtle", "subdued")):
        return "low"
    if any(k in low for k in ("calm", "none", "still", "tranquil", "flat", "zero", "rest")):
        return "calm"
    return default


def coerce_agency_level(raw: Any, default: AgencyLevel = "steady") -> AgencyLevel:
    """Coerce LLM dominance/agency strings into canonical AgencyLevel literals."""
    if not isinstance(raw, str):
        return default
    low = raw.strip().lower()
    if low in VALID_AGENCY_LEVELS:
        return low  # type: ignore[return-value]
    if any(k in low for k in ("command", "dominat", "control", "master", "authorit", "power")):
        return "commanding"
    if any(k in low for k in ("assur", "confiden", "bold", "assert", "firm")):
        return "assured"
    if any(k in low for k in ("helpless", "powerless", "trapped", "cornered", "submiss", "broken")):
        return "helpless"
    if any(k in low for k in ("pressur", "defens", "backfoot", "rattled", "vulnerable", "weak")):
        return "pressured"
    return default


def coerce_threat_level(raw: Any, default: ThreatLevel = "none") -> ThreatLevel:
    """Coerce LLM threat strings into canonical ThreatLevel literals."""
    if not isinstance(raw, str):
        return default
    low = raw.strip().lower()
    if low in VALID_THREAT_LEVELS:
        return low  # type: ignore[return-value]
    if any(k in low for k in ("crit", "lethal", "mortal", "extreme", "severe", "deadly")):
        return "critical"
    if any(k in low for k in ("high", "danger", "acute", "urgent", "grave")):
        return "high"
    if any(k in low for k in ("moderat", "med", "notable", "tense", "guarded")):
        return "moderate"
    if any(k in low for k in ("low", "minor", "mild", "slight", "subtle")):
        return "low"
    if any(k in low for k in ("none", "safe", "calm", "zero", "benign")):
        return "none"
    return default


def coerce_coping_level(raw: Any, default: CopingLevel = "adequate") -> CopingLevel:
    """Coerce LLM coping strings into canonical CopingLevel literals."""
    if not isinstance(raw, str):
        return default
    low = raw.strip().lower()
    if low in VALID_COPING_LEVELS:
        return low  # type: ignore[return-value]
    if any(k in low for k in ("master", "command", "effortless", "dominant", "strong", "high")):
        return "mastery"
    if any(k in low for k in ("overwhelm", "helpless", "collaps", "panick", "broken", "none")):
        return "overwhelmed"
    if any(k in low for k in ("strain", "struggl", "pressur", "shak", "low", "taxed")):
        return "strained"
    return default


def coerce_ordinal_impact(raw: Any, default: OrdinalImpact = "none") -> OrdinalImpact:
    """Coerce LLM ordinal impact strings into canonical 5-point OrdinalImpact literals."""
    if not isinstance(raw, str):
        return default
    low = raw.strip().lower().replace("-", "_").replace(" ", "_")
    if low in VALID_ORDINAL_IMPACTS:
        return low  # type: ignore[return-value]
    if any(k in low for k in ("strong_neg", "major_neg", "severe", "betray", "hostile", "much_worse")):
        return "strong_neg"
    if any(k in low for k in ("mild_neg", "slight_neg", "minor_neg", "neg", "worse", "decrease", "down")):
        return "mild_neg"
    if any(k in low for k in ("strong_pos", "major_pos", "heroic", "deep", "much_better", "life_saving")):
        return "strong_pos"
    if any(k in low for k in ("mild_pos", "slight_pos", "minor_pos", "pos", "better", "increase", "up")):
        return "mild_pos"
    return default


def coerce_grievance_shift(raw: Any, default: GrievanceShift = "none") -> GrievanceShift:
    """Coerce LLM grievance shift strings into canonical GrievanceShift literals."""
    if not isinstance(raw, str):
        return default
    low = raw.strip().lower().replace("-", "_").replace(" ", "_")
    if low in VALID_GRIEVANCE_SHIFTS:
        return low  # type: ignore[return-value]
    if any(k in low for k in ("grave", "betray", "severe", "major", "strong_neg", "unforgiv")):
        return "grave_wrong"
    if any(k in low for k in ("slight", "insult", "minor", "mild_neg", "offen", "wrong")):
        return "slighted"
    if any(k in low for k in ("reconcil", "forgiv", "atone", "restitut", "settled", "strong_pos")):
        return "reconciled"
    if any(k in low for k in ("ease", "apolog", "soften", "mild_pos", "amend")):
        return "eased"
    return default


class WorldviewProfile(BaseModel):
    """Layer 1 existential priors shaping stranger trust, resting dominance, and moral outrage."""

    benevolence: float = Field(
        default=0.0,
        ge=-1.0,
        le=1.0,
        description="Predatory/rigged world (-1.0) to fair/cooperative world (+1.0).",
    )
    belonging: float = Field(
        default=0.0,
        ge=-1.0,
        le=1.0,
        description="Alienated outsider (-1.0) to rooted protector (+1.0).",
    )
    agency: float = Field(
        default=0.2,
        ge=-1.0,
        le=1.0,
        description="Fatalistic resignation (-1.0) to defiant self-determination (+1.0).",
    )

    @field_validator("benevolence", "belonging", "agency", mode="before")
    @classmethod
    def _clamp_axis(cls, v: Any) -> float:
        try:
            return round(max(-1.0, min(1.0, float(v))), 4)
        except (TypeError, ValueError):
            return 0.0


_ARCHETYPE_PRESET_PARAMS: Final[dict[TemperamentArchetype, dict[str, float]]] = {
    "balanced": {
        "relational_inertia": 0.80,
        "negativity_ratio": 3.5,
        "theta_pos_base": 0.15,
        "theta_neg_base": -0.12,
        "composure_resilience": 1.0,
    },
    "stoic": {
        "relational_inertia": 0.92,
        "negativity_ratio": 2.5,
        "theta_pos_base": 0.16,
        "theta_neg_base": -0.16,
        "composure_resilience": 1.8,
    },
    "volatile": {
        "relational_inertia": 0.55,
        "negativity_ratio": 6.0,
        "theta_pos_base": 0.15,
        "theta_neg_base": -0.08,
        "composure_resilience": 0.6,
    },
    "confidant": {
        "relational_inertia": 0.78,
        "negativity_ratio": 1.8,
        "theta_pos_base": 0.10,
        "theta_neg_base": -0.18,
        "composure_resilience": 1.1,
    },
    "paranoiac": {
        "relational_inertia": 0.88,
        "negativity_ratio": 8.0,
        "theta_pos_base": 0.28,
        "theta_neg_base": -0.06,
        "composure_resilience": 0.8,
    },
    "proud_rival": {
        "relational_inertia": 0.84,
        "negativity_ratio": 4.0,
        "theta_pos_base": 0.18,
        "theta_neg_base": -0.12,
        "composure_resilience": 1.4,
    },
}

_ARCHETYPE_DEFAULT_WORLDVIEW: Final[dict[TemperamentArchetype, tuple[float, float, float]]] = {
    "balanced": (0.0, 0.1, 0.2),
    "stoic": (-0.2, 0.3, 0.1),
    "volatile": (-0.5, -0.3, 0.6),
    "confidant": (0.6, 0.7, 0.2),
    "paranoiac": (-0.8, -0.7, 0.3),
    "proud_rival": (-0.3, -0.1, 0.8),
}


class TemperamentConfig(BaseModel):
    """Gottman & Kalman tuning parameters seeded from a TemperamentArchetype preset."""

    archetype: TemperamentArchetype = "balanced"
    relational_inertia: float = Field(default=0.80, ge=0.40, le=0.96)
    negativity_ratio: float = Field(default=3.5, ge=1.0, le=10.0)
    theta_pos_base: float = Field(default=0.15, ge=0.05, le=0.40)
    theta_neg_base: float = Field(default=-0.12, ge=-0.40, le=-0.03)
    composure_resilience: float = Field(default=1.0, ge=0.30, le=2.50)

    @model_validator(mode="before")
    @classmethod
    def _hydrate_archetype_defaults(cls, data: Any) -> Any:
        if isinstance(data, str):
            arch = coerce_temperament_archetype(data)
            return {"archetype": arch, **_ARCHETYPE_PRESET_PARAMS[arch]}
        if isinstance(data, dict):
            arch = coerce_temperament_archetype(data.get("archetype", "balanced"))
            preset = _ARCHETYPE_PRESET_PARAMS[arch]
            merged: dict[str, Any] = {"archetype": arch}
            for key, default_val in preset.items():
                raw_val = data.get(key)
                if raw_val is None:
                    merged[key] = default_val
                else:
                    merged[key] = raw_val
            # Clamp numeric overrides defensively if LLM emitted slightly out-of-range numbers
            try:
                merged["relational_inertia"] = max(0.40, min(0.96, float(merged["relational_inertia"])))
            except (TypeError, ValueError):
                merged["relational_inertia"] = preset["relational_inertia"]
            try:
                merged["negativity_ratio"] = max(1.0, min(10.0, float(merged["negativity_ratio"])))
            except (TypeError, ValueError):
                merged["negativity_ratio"] = preset["negativity_ratio"]
            try:
                merged["theta_pos_base"] = max(0.05, min(0.40, float(merged["theta_pos_base"])))
            except (TypeError, ValueError):
                merged["theta_pos_base"] = preset["theta_pos_base"]
            try:
                merged["theta_neg_base"] = max(-0.40, min(-0.03, float(merged["theta_neg_base"])))
            except (TypeError, ValueError):
                merged["theta_neg_base"] = preset["theta_neg_base"]
            try:
                merged["composure_resilience"] = max(0.30, min(2.50, float(merged["composure_resilience"])))
            except (TypeError, ValueError):
                merged["composure_resilience"] = preset["composure_resilience"]
            return merged
        return data


def temperament_config_for_archetype(archetype: TemperamentArchetype | str) -> TemperamentConfig:
    """Return canonical TemperamentConfig for the given archetype preset."""
    arch = coerce_temperament_archetype(archetype)
    return TemperamentConfig(archetype=arch, **_ARCHETYPE_PRESET_PARAMS[arch])


def default_worldview_for_archetype(archetype: TemperamentArchetype | str) -> WorldviewProfile:
    """Return canonical starting WorldviewProfile for the given archetype preset."""
    arch = coerce_temperament_archetype(archetype)
    ben, bel, age = _ARCHETYPE_DEFAULT_WORLDVIEW[arch]
    return WorldviewProfile(benevolence=ben, belonging=bel, agency=age)


_ARCHETYPE_INFERENCE_PATTERNS: Final[tuple[tuple[TemperamentArchetype, re.Pattern[str]], ...]] = (
    (
        "paranoiac",
        re.compile(
            r"\b(paranoid|paranoiac|cynical|suspicious|conspirator(?:ial)?|distrustful|spy|informant|"
            r"traumatized|haunted|hypervigilant|jaded)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "volatile",
        re.compile(
            r"\b(volatile|hot[- ]?headed|impulsive|explosive|fiery|reckless|berserk|brawler|"
            r"short[- ]?fused|unpredictable|wrathful)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "proud_rival",
        re.compile(
            r"\b(proud|arrogant|haughty|aristocrat(?:ic)?|noble|rival|duelist|elitist|"
            r"imperious|vain|competitive)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "confidant",
        re.compile(
            r"\b(warm|empathic|empathetic|compassionate|gentle|kind[- ]?hearted|healer|caretaker|"
            r"supportive|generous|nurturing|optimistic|confidant)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "stoic",
        re.compile(
            r"\b(stoic|disciplined|guarded|veteran|unflappable|bodyguard|reserved|"
            r"unsentimental|cold[- ]?blooded|impassive)\b",
            re.IGNORECASE,
        ),
    ),
)


def infer_temperament_and_worldview_from_text(
    *texts: str,
) -> tuple[TemperamentConfig, WorldviewProfile]:
    """Deterministically infer TemperamentConfig & WorldviewProfile from character seed/card text."""
    corpus = " ".join(t for t in texts if t).lower()
    best_arch: TemperamentArchetype = "balanced"
    best_score = 0
    for arch, pattern in _ARCHETYPE_INFERENCE_PATTERNS:
        hits = len(set(m.group(0).lower() for m in pattern.finditer(corpus)))
        if hits > best_score:
            best_score = hits
            best_arch = arch

    wv = default_worldview_for_archetype(best_arch)
    ben, bel, age = wv.benevolence, wv.belonging, wv.agency
    if re.search(r"\b(lone wolf|exile|outcast|drifter|estranged|solitary|alienated)\b", corpus):
        bel -= 0.20
    elif re.search(r"\b(community|protector|loyal crew|family|guardian|devoted)\b", corpus):
        bel += 0.20

    if re.search(r"\b(fatalis(?:t|tic)|helpless|trapped|doomed|broken|powerless)\b", corpus):
        age -= 0.25
    elif re.search(r"\b(self[- ]?made|defiant|mastermind|commanding|relentless|determined)\b", corpus):
        age += 0.20

    if re.search(r"\b(corrupt|predatory|cutthroat|bleak|betrayed|grim)\b", corpus):
        ben -= 0.15
    elif re.search(r"\b(hopeful|idealistic|altruistic|trusting|Merciful)\b", corpus):
        ben += 0.15

    refined_wv = WorldviewProfile(
        benevolence=round(max(-1.0, min(1.0, ben)), 2),
        belonging=round(max(-1.0, min(1.0, bel)), 2),
        agency=round(max(-1.0, min(1.0, age)), 2),
    )
    return temperament_config_for_archetype(best_arch), refined_wv


class SituationalAppraisal(BaseModel):
    """Layer 3 immediate tactical evaluation of the active scene."""

    threat: float = Field(default=0.0, ge=0.0, le=1.0)
    coping: float = Field(default=0.4, ge=-1.0, le=1.0)
    goal_congruence: float = Field(default=0.0, ge=-1.0, le=1.0)
    ambiguity: float = Field(default=0.0, ge=0.0, le=1.0)


class RelationalEdge(BaseModel):
    """Layer 4 directed dyadic bond toward 'user' or a known character_id."""

    target_id: str  # Canonical: 'user' or character_id (never raw Persona name or self_id)
    warmth: float = Field(default=0.0, ge=-1.0, le=1.0)
    respect: float = Field(default=0.0, ge=-1.0, le=1.0)
    trust: float = Field(default=0.0, ge=-1.0, le=1.0)
    power: float = Field(default=0.0, ge=-1.0, le=1.0)
    grievance: float = Field(default=0.0, ge=0.0, le=1.0)
    obligation: float = Field(default=0.0, ge=-1.0, le=1.0)
    consolidated_warmth: float = Field(default=0.0, ge=-1.0, le=1.0)
    consolidated_trust: float = Field(default=0.0, ge=-1.0, le=1.0)
    episodic_note: str = Field(default="", max_length=160)

    @field_validator("episodic_note", mode="before")
    @classmethod
    def _trim_note(cls, v: Any) -> str:
        if v is None:
            return ""
        return str(v).strip()[:160]


class AffectiveCareState(BaseModel):
    """Self-contained, versioned per-(turn_id, character_id) CARE state."""

    schema_version: Literal[1] = 1
    is_provisional: bool = False  # True on Phase 3 preview; False after Phase 5 commit
    state_elapsed_minutes: int = Field(default=0, ge=0)
    valence: float = Field(default=0.0, ge=-1.0, le=1.0)
    arousal: float = Field(default=0.4, ge=0.0, le=1.0)
    dominance: float = Field(default=0.0, ge=-1.0, le=1.0)
    composure: float = Field(default=0.85, ge=0.0, le=1.0)
    mood_variance: tuple[float, float, float] = (0.08, 0.08, 0.08)
    active_emotion: ValidEmotion = "default"
    short_mood_label: str = Field(default="Observant and composed", max_length=80)
    outward_demeanor: str = Field(default="Observant and composed", max_length=120)
    active_worldview: WorldviewProfile = Field(default_factory=WorldviewProfile)
    appraisal: SituationalAppraisal = Field(default_factory=SituationalAppraisal)
    relations: dict[str, RelationalEdge] = Field(default_factory=dict)

    @field_validator("short_mood_label", mode="before")
    @classmethod
    def _trim_short_mood(cls, v: Any) -> str:
        s = str(v or "").strip()
        return s[:80] if s else "Observant and composed"

    @field_validator("outward_demeanor", mode="before")
    @classmethod
    def _trim_demeanor(cls, v: Any) -> str:
        s = str(v or "").strip()
        return s[:120] if s else "Observant and composed"


class CategoricalFeelingImpulse(BaseModel):
    """Parsed from Phase 3 <feeling> attributes (or synthesized from legacy float attributes)."""

    tone: FeelingTone = "neutral"
    intensity: IntensityLevel = "moderate"
    agency: AgencyLevel = "steady"
    threat: ThreatLevel = "none"
    coping: CopingLevel = "adequate"
    used_legacy_float_fallback: bool = False
    legacy_valence: float | None = None
    legacy_arousal: float | None = None

    @field_validator("tone", mode="before")
    @classmethod
    def _coerce_tone(cls, v: Any) -> FeelingTone:
        return coerce_feeling_tone(v)

    @field_validator("intensity", mode="before")
    @classmethod
    def _coerce_intensity(cls, v: Any) -> IntensityLevel:
        return coerce_intensity_level(v)

    @field_validator("agency", mode="before")
    @classmethod
    def _coerce_agency(cls, v: Any) -> AgencyLevel:
        return coerce_agency_level(v)

    @field_validator("threat", mode="before")
    @classmethod
    def _coerce_threat(cls, v: Any) -> ThreatLevel:
        return coerce_threat_level(v)

    @field_validator("coping", mode="before")
    @classmethod
    def _coerce_coping(cls, v: Any) -> CopingLevel:
        return coerce_coping_level(v)


def impulse_from_legacy_floats(
    valence: float,
    arousal: float,
) -> CategoricalFeelingImpulse:
    """Deterministically quantize legacy Phase 3 float attributes into CategoricalFeelingImpulse."""
    v = max(-1.0, min(1.0, float(valence)))
    a = max(0.0, min(1.0, float(arousal)))

    if v >= 0.70:
        tone: FeelingTone = "elated"
    elif v >= 0.42:
        tone = "warm"
    elif v >= 0.15:
        tone = "content"
    elif v > -0.12:
        tone = "neutral"
    elif v > -0.28:
        tone = "guarded"
    elif v > -0.44:
        tone = "uneasy"
    elif v > -0.56:
        tone = "melancholy"
    elif v > -0.70:
        tone = "bitter"
    elif v > -0.84:
        tone = "hostile"
    else:
        tone = "anguished"

    if a < 0.22:
        intensity: IntensityLevel = "calm"
    elif a < 0.38:
        intensity = "low"
    elif a < 0.62:
        intensity = "moderate"
    elif a < 0.84:
        intensity = "high"
    else:
        intensity = "extreme"

    threat: ThreatLevel = (
        "high" if (v <= -0.55 and a >= 0.72) else ("low" if v <= -0.25 else "none")
    )
    agency: AgencyLevel = "pressured" if (v <= -0.50 and a >= 0.70) else "steady"
    coping: CopingLevel = "strained" if (v <= -0.60 and a >= 0.75) else "adequate"

    return CategoricalFeelingImpulse(
        tone=tone,
        intensity=intensity,
        agency=agency,
        threat=threat,
        coping=coping,
        used_legacy_float_fallback=True,
        legacy_valence=round(v, 3),
        legacy_arousal=round(a, 3),
    )


class RelationalEventSpec(BaseModel):
    """GBNF-flat per-target relational shift emitted inside CharacterAgentDelta."""

    target: str = Field(description="'user' for the player, or exact character_id.")
    warmth_shift: OrdinalImpact = "none"
    respect_shift: OrdinalImpact = "none"
    trust_shift: OrdinalImpact = "none"
    power_shift: OrdinalImpact = "none"
    grievance_shift: GrievanceShift = "none"
    obligation_shift: OrdinalImpact = "none"
    note: str = Field(default="", max_length=160)

    @field_validator(
        "warmth_shift",
        "respect_shift",
        "trust_shift",
        "power_shift",
        "obligation_shift",
        mode="before",
    )
    @classmethod
    def _coerce_ordinal(cls, v: Any) -> OrdinalImpact:
        return coerce_ordinal_impact(v)

    @field_validator("grievance_shift", mode="before")
    @classmethod
    def _coerce_grievance(cls, v: Any) -> GrievanceShift:
        return coerce_grievance_shift(v)

    @field_validator("note", mode="before")
    @classmethod
    def _trim_event_note(cls, v: Any) -> str:
        if v is None:
            return ""
        return str(v).strip()[:160]
