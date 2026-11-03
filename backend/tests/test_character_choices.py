"""Unit and integration tests for Director-Guided Character Choices."""

import pytest
from app.engine.choices import (
    build_directed_cognition_schema,
    build_gate_check_spec,
    build_gate_directives,
    build_undirected_cognition_schema,
    check_choice_compliance,
    coerce_choice_compliance,
    cognition_dispatch_order,
    filter_choices_to_present,
    gate_matches,
    preview_choice_set,
    resolve_choice_set,
)
from app.schemas.character import BaselinePsyche, CharacterRecord, CharacterStateSnapshot, CognitionBlock
from app.schemas.mechanics import ChoicePreviewRequest
from app.schemas.turn import (
    CanonicalOutcomeTier,
    CharacterChoiceOption,
    CharacterChoiceSet,
    ChoiceResolution,
    PreTurnAnalysis,
    TurnSubmitRequest,
)


def _make_dummy_character(cid: str = "char_soren", name: str = "Soren Kael") -> CharacterRecord:
    return CharacterRecord(
        id=cid,
        name=name,
        world_id="world_1",
        tagline="A cautious investigator",
        core_persona="Pragmatic, cynical, observant.",
        baseline_psyche=BaselinePsyche(
            core_drive="Survival",
            core_fear="Betrayal",
            default_want="Look for exits",
            default_plan="Assess surroundings",
            mood_label="Wary",
        ),
        created_at="2026-11-02T00:00:00Z",
    )


def test_gate_matches():
    assert gate_matches("any", "Critical Failure") is True
    assert gate_matches("any", None) is True

    assert gate_matches("critical_success", "Critical Success") is True
    assert gate_matches("critical_success", "Clean Success") is False
    assert gate_matches("critical_success", None) is False

    assert gate_matches("success_plus", "Clean Success") is True
    assert gate_matches("success_plus", "Critical Success") is True
    assert gate_matches("success_plus", "Simple Failure") is False

    assert gate_matches("failure_minus", "Simple Failure") is True
    assert gate_matches("failure_minus", "Failure with Consequences") is True
    assert gate_matches("failure_minus", "Critical Failure") is True
    assert gate_matches("failure_minus", "Clean Success") is False

    assert gate_matches("critical_failure", "Critical Failure") is True
    assert gate_matches("critical_failure", "Simple Failure") is False


def test_resolve_choice_set_unconditional():
    choice_set = CharacterChoiceSet(
        options=[
            CharacterChoiceOption(label="Open Door", gate="any"),
            CharacterChoiceOption(label="Back Away", gate="any"),
        ]
    )
    res = resolve_choice_set("soren", choice_set, "Clean Success")
    assert res.status == "constrained"
    assert res.allowed == ["Open Door", "Back Away"]
    assert res.excluded == []


def test_resolve_choice_set_mandatory_gated():
    choice_set = CharacterChoiceSet(
        options=[
            CharacterChoiceOption(label="Open Door", gate="any"),
            CharacterChoiceOption(label="Back Away", gate="any"),
            CharacterChoiceOption(label="Look Closer", gate="critical_success"),
        ]
    )
    # On Critical Success, Look Closer is mandatory
    res_crit = resolve_choice_set("soren", choice_set, "Critical Success")
    assert res_crit.status == "mandatory"
    assert res_crit.allowed == ["Look Closer"]
    assert res_crit.excluded == []

    # On Clean Success, Look Closer is excluded, others allowed
    res_clean = resolve_choice_set("soren", choice_set, "Clean Success")
    assert res_clean.status == "constrained"
    assert res_clean.allowed == ["Open Door", "Back Away"]
    assert res_clean.excluded == ["Look Closer"]


def test_resolve_choice_set_specificity_ranking():
    choice_set = CharacterChoiceSet(
        options=[
            CharacterChoiceOption(label="Regular Action", gate="success_plus"),
            CharacterChoiceOption(label="Legendary Action", gate="critical_success"),
        ]
    )
    # On Critical Success, both match, but critical_success has higher rank -> mandatory
    res = resolve_choice_set("soren", choice_set, "Critical Success")
    assert res.status == "mandatory"
    assert res.allowed == ["Legendary Action"]


def test_resolve_choice_set_tied_specificity():
    choice_set = CharacterChoiceSet(
        options=[
            CharacterChoiceOption(label="Option Alpha", gate="critical_success"),
            CharacterChoiceOption(label="Option Beta", gate="critical_success"),
        ]
    )
    res = resolve_choice_set("soren", choice_set, "Critical Success")
    assert res.status == "constrained"
    assert res.allowed == ["Option Alpha", "Option Beta"]


def test_resolve_choice_set_free_fallback_with_exclusions():
    choice_set = CharacterChoiceSet(
        options=[
            CharacterChoiceOption(label="Super Action", gate="critical_success"),
            CharacterChoiceOption(label="Fumble Recovery", gate="critical_failure"),
        ]
    )
    # On Clean Success, neither conditional gate is met -> free agency, both excluded
    res = resolve_choice_set("soren", choice_set, "Clean Success")
    assert res.status == "free_with_exclusions"
    assert res.allowed == []
    assert set(res.excluded) == {"Super Action", "Fumble Recovery"}


def test_choice_preview():
    req = ChoicePreviewRequest(
        choice_set=CharacterChoiceSet(
            options=[
                CharacterChoiceOption(label="Look Closer", gate="critical_success"),
                CharacterChoiceOption(label="Open Door", gate="any"),
                CharacterChoiceOption(label="Back Away", gate="any"),
            ],
            gate_difficulty_class=12,
        )
    )
    prev = preview_choice_set(req)
    assert prev.difficulty_class == 12
    assert prev.modifier == 0
    assert prev.pinned_d20 is None

    # Total probabilities must equal 1.0
    assert sum(prev.tier_probabilities.values()) == pytest.approx(1.0)
    assert prev.gate_probabilities["critical_success"] == pytest.approx(0.20)
    assert prev.gate_probabilities["any"] == pytest.approx(1.0)
    assert len(prev.outcomes) == 2  # Mandatory Look Closer (20%) and Constrained Open/Back (80%)


def test_choice_preview_pinned():
    req = ChoicePreviewRequest(
        choice_set=CharacterChoiceSet(
            options=[
                CharacterChoiceOption(label="Look Closer", gate="critical_success"),
                CharacterChoiceOption(label="Open Door", gate="any"),
            ],
            gate_difficulty_class=12,
        ),
        dice_mode="forced",
        manual_dice_override=20,
    )
    prev = preview_choice_set(req)
    assert prev.pinned_d20 == 20
    assert prev.tier_probabilities["Critical Success"] == 1.0
    assert len(prev.outcomes) == 1
    assert prev.outcomes[0].status == "mandatory"
    assert prev.outcomes[0].allowed == ["Look Closer"]
    assert prev.outcomes[0].probability == 1.0


def test_compliance_and_coercion_mandatory():
    res = ChoiceResolution(
        character_id="soren",
        status="mandatory",
        allowed=["Look Closer"],
        excluded=[],
    )
    # Compliant
    cog_good = CognitionBlock(
        want="Examine the door",
        selected_choice="Look Closer",
        plan="- Look closer at the locking mechanism.\n- Step back.",
    )
    complied, reason = check_choice_compliance(cog_good, res)
    assert complied is True
    assert reason is None

    # Non-compliant: model chose something else
    cog_bad = CognitionBlock(
        want="Leave",
        selected_choice="Back Away",
        plan="- Back away from the door slowly.",
    )
    complied, reason = check_choice_compliance(cog_bad, res)
    assert complied is False
    assert "did not match mandatory" in reason

    # Coerce
    coerced = coerce_choice_compliance(cog_bad, res)
    assert coerced.choice_compliance == "coerced"
    assert coerced.selected_choice == "Look Closer"
    assert "Look Closer" in coerced.plan.splitlines()[0]


def test_compliance_and_coercion_free_with_exclusions():
    res = ChoiceResolution(
        character_id="soren",
        status="free_with_exclusions",
        allowed=[],
        excluded=["Super Attack"],
    )
    cog_violating = CognitionBlock(
        want="Fight",
        selected_choice="Super Attack",
        plan="- Unleash a super attack on the door.\n- Regroup.",
    )
    complied, reason = check_choice_compliance(cog_violating, res)
    assert complied is False

    coerced = coerce_choice_compliance(cog_violating, res)
    assert coerced.choice_compliance == "coerced"
    assert coerced.selected_choice is None
    assert "super attack" not in coerced.plan.lower()


def test_cognition_dispatch_order():
    soren = _make_dummy_character("c_soren", "Soren Kael")
    vesper = _make_dummy_character("c_vesper", "Vesper")
    nix = _make_dummy_character("c_nix", "Nix")

    # If soren is primary, nix has choices, vesper has none
    ordered = cognition_dispatch_order([vesper, nix, soren], primary_id="c_soren", choice_target_ids={"c_nix"})
    assert [c.id for c in ordered] == ["c_soren", "c_nix", "c_vesper"]


def test_filter_choices_to_present():
    c_set = CharacterChoiceSet(options=[CharacterChoiceOption(label="Look Closer")])
    applied, dropped = filter_choices_to_present({"c1": c_set, "c2": c_set}, {"c1"})
    assert "c1" in applied
    assert dropped == ["c2"]


def test_turn_submit_request_dice_promotion():
    req = TurnSubmitRequest(
        user_message="Hello",
        dice_mode="disabled",
        character_choices={
            "soren": CharacterChoiceSet(
                options=[
                    CharacterChoiceOption(label="Look Closer", gate="critical_success"),
                    CharacterChoiceOption(label="Back Away", gate="any"),
                ]
            )
        },
    )
    # Decision D2: disabled automatically promoted to auto
    assert req.dice_mode == "auto"


def test_pre_turn_analysis_reload_survival():
    res = ChoiceResolution(character_id="c1", status="mandatory", allowed=["Look Closer"])
    pt = PreTurnAnalysis(
        dice_mode="auto",
        character_choices={"c1": CharacterChoiceSet(options=[CharacterChoiceOption(label="Look Closer")])},
        choice_resolutions={"c1": res},
    )
    dumped = pt.model_dump()
    reloaded = PreTurnAnalysis.model_validate(dumped)
    assert "c1" in reloaded.choice_resolutions
    assert reloaded.choice_resolutions["c1"].allowed == ["Look Closer"]


def test_resolve_character_dice_checks_gate_spec_replacement():
    from app.engine.phase1_pre import resolve_character_dice_checks
    from app.schemas.turn import CharacterCheckSpec, MechanicsTrigger

    soren = _make_dummy_character("soren", "Soren Kael")
    choice_set = CharacterChoiceSet(
        options=[CharacterChoiceOption(label="Look Closer", gate="critical_success")],
        gate_difficulty_class=15,
    )
    gate_spec = build_gate_check_spec(soren, choice_set)
    # Existing LLM spec with different DC and modifier
    existing_spec = CharacterCheckSpec(
        character_id="soren",
        requires_roll=True,
        action_description="Dodging falling rocks",
        skill_or_approach="Agility",
        difficulty_class=12,
        relevant_modifier=3,
    )

    results = resolve_character_dice_checks(
        [soren],
        character_checks=[existing_spec],
        fallback_trigger=MechanicsTrigger(requires_roll=False),
        user_message="Look at the door",
        dice_mode="auto",
        manual_override=20,
        gate_specs={"soren": gate_spec},
    )

    assert "soren" in results
    roll = results["soren"]
    assert roll.is_choice_gate is True
    assert roll.modifier == 0  # Decision D1: 0 modifier
    assert roll.difficulty_class == 15  # Choice set DC
    assert roll.d20_raw == 20
    assert roll.outcome_tier == "Critical Success"
    assert "Look Closer" not in roll.narrative_directive  # No choice option leakage in narrative directive


def test_preview_choices_endpoint(monkeypatch: pytest.MonkeyPatch):
    from fastapi.testclient import TestClient
    from app import main as main_module
    from app.auth import get_current_user
    from app.schemas.auth import UserProfile

    dummy_user = UserProfile(
        id="user_1",
        username="testuser",
        display_name="Test User",
        role="admin",
        created_at="2026-11-02T00:00:00Z",
        updated_at="2026-11-02T00:00:00Z",
    )
    main_module.app.dependency_overrides[get_current_user] = lambda: dummy_user

    client = TestClient(main_module.app)
    try:
        payload = {
            "choice_set": {
                "options": [
                    {"label": "Look Closer", "gate": "critical_success"},
                    {"label": "Back Away", "gate": "any"},
                ],
                "gate_difficulty_class": 12,
            },
            "dice_mode": "auto",
        }
        resp = client.post("/api/mechanics/choice-preview", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["difficulty_class"] == 12
        assert "gate_probabilities" in data
        assert data["gate_probabilities"]["critical_success"] == 0.20
        assert len(data["outcomes"]) == 2

        # Verify options with empty label (user typing in progress) do not cause 422
        typing_payload = {
            "choice_set": {
                "character_id": "c_soren",
                "options": [
                    {"id": "opt_1", "label": "", "gate": "critical_failure"},
                ],
                "gate_difficulty_class": 12,
            },
            "dice_mode": "auto",
        }
        typing_resp = client.post("/api/mechanics/choice-preview", json=typing_payload)
        assert typing_resp.status_code == 200
        typing_data = typing_resp.json()
        assert typing_data["gate_probabilities"]["critical_failure"] > 0

        # Verify options exceeding 80 characters (such as reported 135 char input) are truncated without 422
        long_text = (
            "Realize that it's too quiet - the sound of rustling leaves and the fire crackling "
            "remain, but there are no sounds of insects or birds"
        )
        assert len(long_text) > 80
        long_payload = {
            "choice_set": {
                "character_id": "c_soren",
                "options": [
                    {"id": "opt_1", "label": long_text, "gate": "any"},
                ],
                "gate_difficulty_class": 12,
            },
            "dice_mode": "auto",
        }
        long_resp = client.post("/api/mechanics/choice-preview", json=long_payload)
        assert long_resp.status_code == 200
    finally:
        main_module.app.dependency_overrides.pop(get_current_user, None)


def test_choice_option_max_length_and_turn_submit_truncation():
    """Verify that choice options sanitize and truncate labels to MAX_CHOICE_LABEL_LENGTH (80)."""
    from app.schemas.turn import MAX_CHOICE_LABEL_LENGTH, TurnSubmitRequest
    from app.schemas.mechanics import ChoicePreviewOption

    long_input = (
        "Realize that it's too quiet - the sound of rustling leaves and the fire crackling "
        "remain, but there are no sounds of insects or birds"
    )
    assert len(long_input) > 80

    opt = CharacterChoiceOption(label=long_input)
    assert len(opt.label) == MAX_CHOICE_LABEL_LENGTH
    assert opt.label == long_input[:MAX_CHOICE_LABEL_LENGTH]

    preview_opt = ChoicePreviewOption(label=long_input)
    assert len(preview_opt.label) == MAX_CHOICE_LABEL_LENGTH
    assert preview_opt.label == long_input[:MAX_CHOICE_LABEL_LENGTH]

    req = TurnSubmitRequest(
        user_message="Look around",
        character_choices={
            "char_123": CharacterChoiceSet(
                options=[CharacterChoiceOption(label=long_input)]
            )
        },
    )
    assert len(req.character_choices["char_123"].options[0].label) == 80


