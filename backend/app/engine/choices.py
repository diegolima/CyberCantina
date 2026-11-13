"""Pure engine logic, deterministic condition gating, and compliance for Director Choices."""

from __future__ import annotations

from collections.abc import Collection, Mapping, Sequence
import re
from typing import Any, Final

from app.engine.phase1_pre import classify_outcome_tier
from app.schemas.character import CharacterRecord, CharacterStateSnapshot, CognitionBlock
from app.schemas.mechanics import (
    ChoicePreviewOutcome,
    ChoicePreviewRequest,
    ChoicePreviewResponse,
)
from app.schemas.turn import (
    CanonicalOutcomeTier,
    CharacterCheckSpec,
    CharacterChoiceOption,
    CharacterChoiceSet,
    ChoiceGate,
    ChoiceResolution,
)

GATE_SPECIFICITY: Final[Mapping[ChoiceGate, int]] = {
    "critical_success": 2,
    "critical_failure": 2,
    "success_plus": 1,
    "failure_minus": 1,
    "any": 0,
}

DIRECTOR_CONTINUE_MESSAGE: Final[str] = (
    "The scene director presents possibilities for the characters."
)

_COMMON_STOPWORDS: Final[set[str]] = {
    "the", "a", "an", "and", "or", "to", "in", "on", "at", "by", "for", "with",
    "of", "from", "into", "onto", "out", "off", "over", "under", "up", "down",
}


def gate_matches(gate: ChoiceGate, tier: CanonicalOutcomeTier | None) -> bool:
    """Return True if the roll outcome tier satisfies the choice gate."""
    if gate == "any":
        return True
    if tier is None:
        return False
    if gate == "critical_success":
        return tier == "Critical Success"
    if gate == "success_plus":
        return tier in ("Clean Success", "Critical Success")
    if gate == "failure_minus":
        return tier in ("Simple Failure", "Failure with Consequences", "Critical Failure")
    if gate == "critical_failure":
        return tier == "Critical Failure"
    return False


def resolve_choice_set(
    character_id: str,
    choice_set: CharacterChoiceSet,
    gate_tier: CanonicalOutcomeTier | None,
) -> ChoiceResolution:
    """Deterministically resolve choices against the character's gate roll tier."""
    if not choice_set.options:
        return ChoiceResolution(
            character_id=character_id,
            status="free_with_exclusions",
            gate_roll_tier=gate_tier,
            allowed=[],
            excluded=[],
        )

    satisfied: list[CharacterChoiceOption] = []
    unsatisfied: list[CharacterChoiceOption] = []

    for opt in choice_set.options:
        if gate_matches(opt.gate, gate_tier):
            satisfied.append(opt)
        else:
            unsatisfied.append(opt)

    excluded_labels = [opt.label for opt in unsatisfied if opt.gate != "any"]
    conditional_satisfied = [opt for opt in satisfied if opt.gate != "any"]

    if conditional_satisfied:
        max_spec = max(GATE_SPECIFICITY.get(opt.gate, 0) for opt in conditional_satisfied)
        top_tier = [
            opt for opt in conditional_satisfied
            if GATE_SPECIFICITY.get(opt.gate, 0) == max_spec
        ]
        if len(top_tier) == 1:
            mandatory_label = top_tier[0].label
            return ChoiceResolution(
                character_id=character_id,
                status="mandatory",
                gate_roll_tier=gate_tier,
                allowed=[mandatory_label],
                excluded=excluded_labels,
            )
        # Multiple tied at highest rank
        return ChoiceResolution(
            character_id=character_id,
            status="constrained",
            gate_roll_tier=gate_tier,
            allowed=[opt.label for opt in top_tier],
            excluded=excluded_labels,
        )

    # If no conditional options satisfied, check if any unconditional 'any' options exist
    if satisfied:
        return ChoiceResolution(
            character_id=character_id,
            status="constrained",
            gate_roll_tier=gate_tier,
            allowed=[opt.label for opt in satisfied],
            excluded=excluded_labels,
        )

    # All options were conditional and NONE matched
    return ChoiceResolution(
        character_id=character_id,
        status="free_with_exclusions",
        gate_roll_tier=gate_tier,
        allowed=[],
        excluded=excluded_labels,
    )


def filter_choices_to_present(
    choices: Mapping[str, CharacterChoiceSet],
    present_ids: set[str],
) -> tuple[dict[str, CharacterChoiceSet], list[str]]:
    """Filter choices to characters physically present in the scene, returning (applied, dropped)."""
    applied: dict[str, CharacterChoiceSet] = {}
    dropped: list[str] = []
    for cid, c_set in choices.items():
        if cid in present_ids:
            applied[cid] = c_set
        else:
            dropped.append(cid)
    return applied, dropped


def build_gate_check_spec(
    character: CharacterRecord,
    choice_set: CharacterChoiceSet,
) -> CharacterCheckSpec:
    """Build a synthetic Phase 1 CharacterCheckSpec for a choice-gated roll (Decision D1)."""
    return CharacterCheckSpec(
        character_id=character.id,
        requires_roll=True,
        check_role="active_attempt",
        action_description=f"{character.name}'s decisive moment",
        skill_or_approach="Fate / Timing",
        difficulty_class=choice_set.gate_difficulty_class,
        relevant_modifier=0,
    )


def build_gate_directives(
    character_name: str,
    tier: CanonicalOutcomeTier,
) -> tuple[str, str]:
    """Return neutral (plan_directive, narrative_directive) for choice gate rolls."""
    plan_dir = (
        f"A decisive moment turns on [{tier}]. "
        "Adopt the course of action available under your Director Choice directive."
    )
    narr_dir = (
        f"A decisive moment resolves on [{tier}]. "
        f"Depict the course of action established in {character_name}'s plan."
    )
    return plan_dir, narr_dir


def cognition_dispatch_order(
    present: Sequence[CharacterRecord],
    primary_id: str,
    choice_target_ids: Collection[str],
) -> list[CharacterRecord]:
    """Shared single ordering authority for Phase 3 and Zone 4 cognition."""
    return sorted(
        present,
        key=lambda c: (
            0 if c.id == primary_id else (1 if c.id in choice_target_ids else 2),
            c.id,
        ),
    )


def render_choice_directive(resolution: ChoiceResolution, character_name: str) -> str:
    """Render the Director Choice prompt section for Phase 3 character cognition."""
    lines = [f"\n=== DIRECTOR CHOICE DIRECTIVE FOR {character_name.upper()} ==="]

    if resolution.status == "mandatory":
        mand = resolution.allowed[0] if resolution.allowed else "Act"
        lines.append(f'- MANDATORY ACTION: You MUST choose and execute: "{mand}".')
    elif resolution.status == "constrained":
        lines.append("- AVAILABLE OPTIONS: You MUST choose ONE of the following for your <plan>:")
        for opt in resolution.allowed:
            lines.append(f'  * "{opt}"')
    else:  # free_with_exclusions
        lines.append(
            "- FREE CHOICE: None of your conditional options were unlocked by the dice roll. "
            "You may decide your own course of action freely."
        )

    if resolution.excluded:
        lines.append("- BARRED OPTIONS: You MUST NOT attempt or execute any of the following:")
        for opt in resolution.excluded:
            lines.append(f'  * "{opt}"')

    lines.extend([
        "",
        "COGNITIVE PROTOCOL FOR CHOICES:",
        "1. Field `selected_choice`: State the exact label of the choice you are adopting "
        "(or null if deciding freely).",
        "2. Field `<plan>` (Bullet 1): Your first bullet point MUST immediately and irrevocably "
        "execute the chosen action.",
        "3. Inner Conflict & Regret: If the choice conflicts with your core persona, active disposition, or core fear:",
        "   - Your `<want>` must maintain your true personal desire.",
        "   - Bullets 2-3 of `<plan>` must focus on damage control, visceral hesitation, or coping with consequences.",
        "   - You are explicitly PERMITTED a sharp shift in `feeling_tone`, `feeling_intensity`, and `feeling_agency` to reflect shock, strain, or reluctance.",
    ])

    return "\n".join(lines)


def build_directed_cognition_schema(resolution: ChoiceResolution) -> dict[str, Any]:
    """Build a flat GBNF-safe JSON schema for CognitionBlock with categorical affect enums."""
    schema = CognitionBlock.model_json_schema()
    schema.pop("$defs", None)
    props = dict(schema.get("properties", {}))

    ordered_props: dict[str, Any] = {}
    for key in (
        "recall",
        "feeling",
        "feeling_tone",
        "feeling_intensity",
        "feeling_agency",
        "scene_threat",
        "scene_coping",
        "want",
    ):
        if key in props:
            ordered_props[key] = props[key]

    if resolution.status in ("mandatory", "constrained") and resolution.allowed:
        ordered_props["selected_choice"] = {
            "type": "string",
            "enum": list(resolution.allowed),
            "description": "Exact label selected from the Director choices.",
        }
    else:
        ordered_props["selected_choice"] = {
            "type": ["string", "null"],
            "description": "Null if deciding freely, or an unbarred label.",
        }

    for key in ("plan", "skipped"):
        if key in props:
            ordered_props[key] = props[key]

    schema["properties"] = ordered_props
    schema["required"] = [
        "recall",
        "feeling",
        "feeling_tone",
        "feeling_intensity",
        "feeling_agency",
        "scene_threat",
        "scene_coping",
        "want",
        "selected_choice",
        "plan",
        "skipped",
    ]
    return schema


def build_undirected_cognition_schema() -> dict[str, Any]:
    """Build flat structured schema omitting choice-related and raw float fields."""
    schema = CognitionBlock.model_json_schema()
    schema.pop("$defs", None)
    props = dict(schema.get("properties", {}))

    ordered_props: dict[str, Any] = {}
    for key in (
        "recall",
        "feeling",
        "feeling_tone",
        "feeling_intensity",
        "feeling_agency",
        "scene_threat",
        "scene_coping",
        "want",
        "plan",
        "skipped",
    ):
        if key in props:
            ordered_props[key] = props[key]

    schema["properties"] = ordered_props
    schema["required"] = [
        "recall",
        "feeling",
        "feeling_tone",
        "feeling_intensity",
        "feeling_agency",
        "scene_threat",
        "scene_coping",
        "want",
        "plan",
        "skipped",
    ]
    return schema


def label_mentioned_in(text: str, label: str) -> bool:
    """Check if label or its core content tokens are present in text."""
    if not text or not label:
        return False
    t_lower = text.casefold()
    l_lower = label.casefold()
    if l_lower in t_lower:
        return True

    # Token overlap check (ignoring punctuation and stopwords)
    tokens = [
        w for w in re.findall(r"\b\w+\b", l_lower)
        if len(w) >= 3 and w not in _COMMON_STOPWORDS
    ]
    if not tokens:
        return False
    matches = sum(1 for tok in tokens if tok in t_lower)
    return (matches / len(tokens)) >= 0.5


def check_choice_compliance(
    cog: CognitionBlock,
    resolution: ChoiceResolution,
) -> tuple[bool, str | None]:
    """Check if a CognitionBlock complied with the choice resolution."""
    first_bullet = cog.plan.splitlines()[0] if cog.plan else ""
    first_bullet_clean = re.sub(r"^[-*•\d.)\s]+", "", first_bullet).strip()

    if resolution.status == "mandatory":
        mand = resolution.allowed[0] if resolution.allowed else ""
        if cog.selected_choice != mand:
            return False, f"Selected choice '{cog.selected_choice}' did not match mandatory '{mand}'."
        if not label_mentioned_in(first_bullet_clean, mand):
            return False, f"Plan bullet 1 does not execute mandatory choice '{mand}'."
        return True, None

    if resolution.status == "constrained":
        if cog.selected_choice not in resolution.allowed:
            return False, f"Selected choice '{cog.selected_choice}' is not in allowed choices {resolution.allowed}."
        if not label_mentioned_in(first_bullet_clean, cog.selected_choice):
            return False, f"Plan bullet 1 does not execute selected choice '{cog.selected_choice}'."
        return True, None

    # free_with_exclusions
    for ex in resolution.excluded:
        if cog.selected_choice and label_mentioned_in(cog.selected_choice, ex):
            return False, f"Selected choice matches barred option '{ex}'."
        if label_mentioned_in(cog.plan, ex):
            return False, f"Plan mentions barred option '{ex}'."
    return True, None


def coerce_choice_compliance(
    cog: CognitionBlock,
    resolution: ChoiceResolution,
    previous_state: CharacterStateSnapshot | None = None,
) -> CognitionBlock:
    """Deterministically coerce non-compliant cognition into compliance (Decision D3)."""
    complied, reason = check_choice_compliance(cog, resolution)
    if complied:
        cog.choice_compliance = "complied"
        cog.choice_compliance_note = None
        return cog

    cog.choice_compliance = "coerced"
    cog.choice_compliance_note = reason or "Choice enforced deterministically."

    existing_bullets = [
        re.sub(r"^[-*•\d.)\s]+", "", line).strip()
        for line in (cog.plan.splitlines() if cog.plan else [])
        if line.strip()
    ]

    if resolution.status == "mandatory":
        target_choice = resolution.allowed[0]
        cog.selected_choice = target_choice
        if not existing_bullets or not label_mentioned_in(existing_bullets[0], target_choice):
            new_bullets = [f"- {target_choice}."] + [f"- {b}." for b in existing_bullets[:2]]
            cog.plan = "\n".join(new_bullets)
        return cog

    if resolution.status == "constrained":
        # Find which allowed choice best matches the plan or default to first
        matched_choice = resolution.allowed[0]
        for opt in resolution.allowed:
            if label_mentioned_in(cog.plan, opt):
                matched_choice = opt
                break
        cog.selected_choice = matched_choice
        if not existing_bullets or not label_mentioned_in(existing_bullets[0], matched_choice):
            new_bullets = [f"- {matched_choice}."] + [f"- {b}." for b in existing_bullets[:2]]
            cog.plan = "\n".join(new_bullets)
        return cog

    # free_with_exclusions: remove barred bullets
    filtered_bullets: list[str] = []
    for b in existing_bullets:
        if any(label_mentioned_in(b, ex) for ex in resolution.excluded):
            continue
        filtered_bullets.append(f"- {b}.")

    cog.selected_choice = None
    if filtered_bullets:
        cog.plan = "\n".join(filtered_bullets[:3])
    else:
        fallback = previous_state.active_plan if previous_state else "Assess the situation."
        cog.plan = f"- {fallback}"

    return cog


def preview_choice_set(req: ChoicePreviewRequest) -> ChoicePreviewResponse:
    """Calculate deterministic probabilities for each outcome and gate tier (Decision D4)."""
    dc = req.choice_set.gate_difficulty_class
    mod = 0

    tier_counts: dict[CanonicalOutcomeTier, int] = {
        "Critical Failure": 0,
        "Failure with Consequences": 0,
        "Simple Failure": 0,
        "Clean Success": 0,
        "Critical Success": 0,
    }

    # Map resolution outcome key -> list of tiers that produce it
    outcome_map: dict[str, dict[str, Any]] = {}

    d20_values = [req.manual_dice_override] if req.manual_dice_override else list(range(1, 21))
    total_faces = len(d20_values)

    # Prepare effective choice set for resolve_choice_set (ensuring non-empty unique labels)
    effective_set: CharacterChoiceSet | None = None
    if req.choice_set.options:
        synthetic_options = []
        seen = set()
        for idx, opt in enumerate(req.choice_set.options):
            raw_label = opt.label.strip() if opt.label else ""
            if not raw_label or raw_label.casefold() in seen:
                raw_label = f"Option {idx + 1}"
                suffix = 2
                while raw_label.casefold() in seen:
                    raw_label = f"Option {idx + 1} ({suffix})"
                    suffix += 1
            seen.add(raw_label.casefold())
            synthetic_options.append(
                CharacterChoiceOption(
                    label=raw_label,
                    gate=opt.gate,
                )
            )
        effective_set = CharacterChoiceSet(
            options=synthetic_options,
            gate_difficulty_class=dc,
        )

    for d20 in d20_values:
        total = d20 + mod
        tier = classify_outcome_tier(d20, total, dc)
        tier_counts[tier] += 1

        if effective_set is not None:
            res = resolve_choice_set("preview", effective_set, tier)
            outcome_key = f"{res.status}::{','.join(sorted(res.allowed))}::{','.join(sorted(res.excluded))}"
            if outcome_key not in outcome_map:
                outcome_map[outcome_key] = {
                    "status": res.status,
                    "allowed": res.allowed,
                    "excluded": res.excluded,
                    "count": 0,
                    "tiers": set(),
                }
            outcome_map[outcome_key]["count"] += 1
            outcome_map[outcome_key]["tiers"].add(tier)

    tier_probs = {t: round(c / total_faces, 4) for t, c in tier_counts.items()}

    gate_probs: dict[ChoiceGate, float] = {
        "any": 1.0,
        "critical_success": tier_probs["Critical Success"],
        "success_plus": round(tier_probs["Clean Success"] + tier_probs["Critical Success"], 4),
        "failure_minus": round(
            tier_probs["Simple Failure"]
            + tier_probs["Failure with Consequences"]
            + tier_probs["Critical Failure"],
            4,
        ),
        "critical_failure": tier_probs["Critical Failure"],
    }

    tier_order = [
        "Critical Failure",
        "Failure with Consequences",
        "Simple Failure",
        "Clean Success",
        "Critical Success",
    ]

    outcomes: list[ChoicePreviewOutcome] = []
    for data in outcome_map.values():
        sorted_tiers = [t for t in tier_order if t in data["tiers"]]
        outcomes.append(
            ChoicePreviewOutcome(
                status=data["status"],
                allowed=data["allowed"],
                excluded=data["excluded"],
                probability=round(data["count"] / total_faces, 4),
                tiers=sorted_tiers,
            )
        )

    outcomes.sort(key=lambda o: -o.probability)

    return ChoicePreviewResponse(
        difficulty_class=dc,
        modifier=mod,
        pinned_d20=req.manual_dice_override,
        tier_probabilities=tier_probs,
        gate_probabilities=gate_probs,
        outcomes=outcomes,
    )
