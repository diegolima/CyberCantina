"""Unit tests for the character wizard draft pipeline (single-pass & 3-pass fallback paths)."""

from __future__ import annotations

import pytest

from app.config import settings
from app.db.repository import CantinaRepository
from app.engine import llm_client as llm_module
from app.schemas.character import (
    BaselinePsyche,
    CharacterWizardLLMOutput,
    CharacterWizardPass1LLMOutput,
    CharacterWizardPass2LLMOutput,
    CharacterWizardSeed,
)
from app.wizards.character_wizard import generate_character_draft
from tests.factories import seed_world


@pytest.mark.asyncio
async def test_generate_character_draft_single_pass_heals_omissions(
    empty_repo: CantinaRepository,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Custom prompt_template routes through single-pass generation and heals omitted fields."""
    user = empty_repo.create_user(username="wiz_user", display_name="Wiz")
    world = seed_world(empty_repo, owner_id=user.id, name="Aether Spire")

    seen_systems: list[str] = []

    async def fake_complete_structured(messages, schema_cls, **kwargs):
        seen_systems.append(messages[0]["content"])
        assert schema_cls is CharacterWizardLLMOutput
        return CharacterWizardLLMOutput(
            name="Mira Vance",
            tagline="Sharp-eyed courier with unpaid debts.",
            species="",
            distinctive_features=["Silver scar over left eyebrow"],
            character_bio="",
            mannerisms=["taps thumb", "  glances at exits  "],
            visual_aesthetic="",
            personality_traits=[],
            core_persona="Pragmatic, cautious, and quick to deflect personal questions.",
            moral_code=[],
            quirks_flaws=[],
            communication_style=[],
            voice_anchors=[],
            equipped=[],
            inventory=[],
            initial_message="",
            baseline_psyche=BaselinePsyche(
                mood_label="tense",
                valence=0.1,
                arousal=0.95,
                core_drive="Pay off the syndicate.",
                core_fear="Locked in an off-world brig.",
                default_want="Verify the drop coordinates.",
                default_plan="",
            ),
        )

    monkeypatch.setattr(llm_module.llm_client, "complete_structured", fake_complete_structured)

    seed = CharacterWizardSeed(
        name="Mira Vance",
        archetype="Courier",
        role_in_story="Smuggler running contraband between districts",
        personality_keywords=["cautious", "resourceful"],
        rough_notes="Carries a cracked compass.",
    )
    draft = await generate_character_draft(
        seed,
        world=world,
        prompt_template="Single-pass test template for {{world_name}}",
    )

    assert len(seen_systems) == 1
    assert "Single-pass test template" in seen_systems[0]
    assert draft.name == "Mira Vance"
    assert draft.species
    assert draft.sex
    assert draft.pronouns
    assert draft.age
    assert draft.build_and_height.endswith("cm")
    assert len(draft.distinctive_features) >= 6
    assert "Aether Spire" in draft.character_bio
    assert "Carries a cracked compass." in draft.character_bio
    assert len(draft.mannerisms) == 2
    assert draft.moral_code
    assert draft.quirks_flaws
    assert draft.communication_style
    assert draft.voice_anchors
    assert draft.equipped or draft.inventory
    assert draft.initial_message
    assert draft.baseline_psyche.default_plan
    assert draft.baseline_psyche.mood_label


@pytest.mark.asyncio
async def test_generate_character_draft_single_pass_respects_offline_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Single-pass failures raise when allow_offline_fallback=False and fall back when True."""

    async def boom(*args, **kwargs):
        raise RuntimeError("offline")

    monkeypatch.setattr(llm_module.llm_client, "complete_structured", boom)
    seed = CharacterWizardSeed(
        name="Kael",
        archetype="Scout",
        role_in_story="Outrider",
        personality_keywords=["vigilant"],
    )

    monkeypatch.setattr(settings, "allow_offline_fallback", False)
    with pytest.raises(RuntimeError, match="offline"):
        await generate_character_draft(seed, prompt_template="Custom template")

    monkeypatch.setattr(settings, "allow_offline_fallback", True)
    fallback_draft = await generate_character_draft(seed, prompt_template="Custom template")
    assert fallback_draft.name == "Kael"
    assert fallback_draft.initial_message


@pytest.mark.asyncio
async def test_generate_character_draft_three_pass_partial_and_error_fallbacks(
    empty_repo: CantinaRepository,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """3-pass pipeline heals empty bio/mannerisms, falls back on Pass 3 errors, and raises on Pass 1 when offline fallback is off."""
    user = empty_repo.create_user(username="wiz_3p", display_name="Wiz 3P")
    world = seed_world(empty_repo, owner_id=user.id, name="Glass Harbor")
    seed = CharacterWizardSeed(
        name="Soren",
        archetype="Archivist",
        role_in_story="Keeper of drowned ledgers",
        personality_keywords=["methodical", "secretive"],
        rough_notes="Sleeps with a brass key.",
    )

    async def partial_passes(messages, schema_cls, **kwargs):
        name = schema_cls.__name__
        if name == "CharacterWizardPass1LLMOutput":
            return CharacterWizardPass1LLMOutput(
                name="Soren",
                tagline="Silent keeper of saltwater secrets.",
                character_bio="",
                mannerisms=["adjusts spectacles"],
                equipped=["Heavy Wool Coat"],
                inventory=["Salt-Stained Ledger"],
            )
        if name == "CharacterWizardPass2LLMOutput":
            return CharacterWizardPass2LLMOutput(
                personality_traits=["methodical", "guarded"],
                core_persona="Soren speaks softly and guards every ledger page like state treasure.",
                moral_code=["Never burn a surviving record."],
                quirks_flaws=["Counts footsteps on docks."],
                communication_style=["measured", "quiet"],
                core_drive="Preserve the pre-flood archives.",
                core_fear="Losing the harbor vault key.",
                default_want="Verify the stranger's manifest.",
                default_plan=["Keep lantern low", "Inspect seal"],
            )
        raise RuntimeError("Pass 3 timed out")

    monkeypatch.setattr(llm_module.llm_client, "complete_structured", partial_passes)

    draft = await generate_character_draft(seed, world=world)
    assert "Glass Harbor" in draft.character_bio
    assert "Sleeps with a brass key." in draft.character_bio
    assert len(draft.mannerisms) == 4
    assert draft.initial_message  # healed from fallback when Pass 3 failed

    async def pass1_boom(*args, **kwargs):
        raise RuntimeError("pass 1 down")

    monkeypatch.setattr(llm_module.llm_client, "complete_structured", pass1_boom)
    monkeypatch.setattr(settings, "allow_offline_fallback", False)
    with pytest.raises(RuntimeError, match="pass 1 down"):
        await generate_character_draft(seed, world=world)
