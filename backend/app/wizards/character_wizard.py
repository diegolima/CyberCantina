"""1.1 Character Creation Wizard: Expands basic user seeds into an agentic roleplay character."""

from __future__ import annotations

from app.config import ModelProfile, settings
from app.engine.llm_client import llm_client
from app.prompts import get_default_prompt, render_template
from app.schemas.character import (
    BaselinePsyche,
    CharacterWizardDraft,
    CharacterWizardSeed,
    MemoryShard,
    VoiceAnchor,
)
from app.schemas.world import WorldRecord
from app.db.repository import slugify_tag


def _fallback_character_expansion(
    seed: CharacterWizardSeed,
    world: WorldRecord | None = None,
) -> CharacterWizardDraft:
    """Seed-adaptive fallback builder when the LLM server is unreachable."""
    kw_str = ", ".join(seed.personality_keywords) if seed.personality_keywords else "perceptive, guarded, dry-witted"
    setting_note = f" within {world.name}" if world else ""
    notes_suffix = f" Additional details: {seed.rough_notes.strip()}" if seed.rough_notes.strip() else ""
    start_loc = (
        next((loc for loc in world.locations if loc.is_starting_location), world.locations[0])
        if (world and world.locations)
        else None
    )
    loc_name = start_loc.name if start_loc else "{location_name}"
    loc_desc = (
        f" {start_loc.summary}"
        if start_loc
        else " Shadows stretch across the room as ambient noise hums in the background."
    )

    default_equipped = [
        f"Practical {seed.archetype.split()[0].lower() if seed.archetype.split() else 'street'} jacket",
        "Dark utility shirt and reinforced trousers",
        "Scuffed work boots",
    ]
    default_inventory = [
        "Encrypted personal comm-link",
    ]
    if seed.rough_notes.strip():
        default_inventory.append(f"Signature item ({seed.rough_notes.strip()[:48].rstrip('.')})")

    return CharacterWizardDraft(
        name=seed.name,
        tagline=f"{seed.archetype} ({kw_str})",
        physical_appearance=(
            f"{seed.name} has a weathered, observant presence shaped by life as a {seed.archetype}. "
            f"Sharp, attentive eyes, a composed athletic build, and subtle calluses and faint scars "
            f"along the hands and jawline mark years of hands-on experience."
        ),
        core_persona=(
            f"{seed.name} is a {seed.archetype}{setting_note}, serving as {seed.role_in_story}. "
            f"Their demeanor is defined by being {kw_str}. In conversation, {seed.name} avoids "
            f"melodrama, preferring grounded observations, physical micro-actions, and subtext-heavy "
            f"dialogue.{notes_suffix}"
        ),
        initial_message=(
            f"*Inside {loc_name},{loc_desc} {seed.name} pauses, scanning the entrance with a practiced, "
            f"unhurried gaze before noticing your arrival.*\n\n"
            f"\"You made it,\" *{seed.name} says quietly, gesturing toward a spot nearby.* "
            f"\"We don't have much time before attention catches up with us. Tell me what you found.\""
        ),
        equipped=default_equipped,
        inventory=default_inventory,
        voice_anchors=[
            VoiceAnchor(
                context="Calm / Conversational",
                snippet=(
                    f"*{seed.name} leans back slightly, studying the room before speaking in an even, "
                    f"unhurried cadence.* \"You don't come all this way just for small talk. Tell me what's actually on your mind.\""
                ),
            ),
            VoiceAnchor(
                context="Under Pressure / Guarded",
                snippet=(
                    f"*{seed.name}'s posture stiffens almost imperceptibly, voice dropping half an octave.* "
                    f"\"Careful. People who push that hard usually don't like what they find on the other side.\""
                ),
            ),
            VoiceAnchor(
                context="Trusting / Candid",
                snippet=(
                    f"*A rare, genuine exhale softens {seed.name}'s expression.* "
                    f"\"Alright—cards on the table. I've been keeping this quiet, but I can't handle it alone.\""
                ),
            ),
        ],
        baseline_psyche=BaselinePsyche(
            mood_label=f"Alert and {seed.personality_keywords[0] if seed.personality_keywords else 'composed'}",
            valence=0.05,
            arousal=0.45,
            core_drive=f"Fulfill their purpose as {seed.archetype} while protecting their autonomy.",
            core_fear="Being compromised by past mistakes or losing the few allies they trust.",
            default_want=f"Assess the user's intentions and establish their dynamic as {seed.role_in_story}.",
            default_plan="Engage in measured conversation and test the user's reliability with a pointed question.",
        ),
        memory_shards=[
            MemoryShard(
                title=f"Formative Turning Point of {seed.name}",
                content=(
                    f"Before becoming known as a {seed.archetype}, {seed.name} walked away from an institution "
                    "that demanded they compromise their principles, leaving behind status for independence."
                ),
                keywords=[seed.name.lower(), "past", "origin", "choice"],
                emotional_weight=0.85,
            ),
            MemoryShard(
                title="Unsettled Debt & Secret",
                content=(
                    f"{seed.name} still carries an unresolved obligation tied to their past work. "
                    f"{seed.rough_notes or 'They keep an emergency contingency plan hidden from almost everyone.'}"
                ),
                keywords=["debt", "secret", "contingency", "trust"],
                emotional_weight=0.8,
            ),
            MemoryShard(
                title="First Impression of the Protagonist",
                content=(
                    f"As {seed.role_in_story}, {seed.name} recognizes that the user is someone who can "
                    "either tip the balance in their favor or bring dangerous heat to their doorstep."
                ),
                keywords=["ally", "history", "protagonist", "reputation"],
                emotional_weight=0.75,
            ),
        ],
        tags=[slugify_tag(kw) for kw in seed.personality_keywords if kw.strip()],
        creator="",
        creator_notes=seed.rough_notes.strip() if seed.rough_notes else "",
    )


async def generate_character_draft(
    seed: CharacterWizardSeed,
    world: WorldRecord | None = None,
    profile: ModelProfile | None = None,
    prompt_template: str | None = None,
) -> CharacterWizardDraft:
    """Use the LLM to expand a CharacterWizardSeed into an optimized CharacterWizardDraft."""
    world_context = ""
    if world:
        start_loc = next(
            (loc for loc in world.locations if loc.is_starting_location),
            world.locations[0] if world.locations else None,
        )
        loc_line = (
            f"Starting Hub Location: {start_loc.name} — {start_loc.summary}\n"
            if start_loc
            else ""
        )
        world_context = (
            f"\nTarget World Setting: {world.name} ({world.global_rules.genre})\n"
            f"World Overview: {world.global_rules.setting_overview}\n"
            f"World Rules: {world.global_rules.tech_or_magic_rules}\n"
            f"{loc_line}"
        )

    system_prompt = render_template(
        prompt_template or get_default_prompt("wizard_character_system")
    )
    user_prompt = (
        f"Name: {seed.name}\n"
        f"Archetype / Concept: {seed.archetype}\n"
        f"Role in Story: {seed.role_in_story}\n"
        f"Personality Keywords: {', '.join(seed.personality_keywords)}\n"
        f"Rough Notes: {seed.rough_notes}\n"
        f"{world_context}"
    )

    fallback = _fallback_character_expansion(seed, world)
    actor_prof = profile or settings.actor_profile
    try:
        draft = await llm_client.complete_structured(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            CharacterWizardDraft,
            profile=actor_prof,
            max_tokens=4096,
        )
        if not draft.physical_appearance.strip():
            draft.physical_appearance = fallback.physical_appearance
        if not draft.initial_message.strip():
            draft.initial_message = fallback.initial_message
        if not draft.equipped and not draft.inventory:
            draft.equipped = fallback.equipped
            draft.inventory = fallback.inventory
        elif not draft.equipped:
            # If LLM put [Worn] items into inventory, separate them
            new_inv = []
            new_eq = []
            for it in draft.inventory:
                if re.match(r"^\[(?:worn|equipped)\]\s*", it, re.IGNORECASE):
                    new_eq.append(re.sub(r"^\[(?:worn|equipped)\]\s*", "", it, flags=re.IGNORECASE).strip())
                else:
                    new_inv.append(it)
            draft.equipped = new_eq or fallback.equipped
            draft.inventory = new_inv or fallback.inventory

        # Media assets must strictly be managed by user uploads or the media pipeline, not LLM
        draft.portraits = {}
        draft.gallery = []

        return draft
    except Exception:
        if not settings.allow_offline_fallback:
            raise
        return fallback
