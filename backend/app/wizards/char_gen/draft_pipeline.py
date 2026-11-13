"""3-pass AI character draft generation pipeline."""

from __future__ import annotations

import logging

from app.config import (
    ModelProfile,
    settings,
)
from app.db.repository import slugify_tag
from app.engine.llm_client import llm_client
from app.prompts import (
    get_default_prompt,
    render_template,
)
from app.schemas.affective import infer_temperament_and_worldview_from_text
from app.schemas.character import (
    BaselinePsyche,
    CharacterWizardDraft,
    CharacterWizardLLMOutput,
    CharacterWizardPass1LLMOutput,
    CharacterWizardPass2LLMOutput,
    CharacterWizardPass3LLMOutput,
    CharacterWizardSeed,
    coerce_item_list,
    normalize_bullet_plan,
    normalize_starting_mood,
    sanitize_character_markup,
)
from app.schemas.world import WorldRecord

from app.wizards.char_gen.genre_profiles import (
    _clean_mannerism,
    _sanitize_height_only,
    _split_compound_items,
)
from app.wizards.char_gen.inference import (
    _fallback_character_expansion,
    _normalize_distinctive_features,
    infer_demographics_and_anatomy,
    infer_dialogue_anchors_and_style,
    infer_moral_code_and_quirks,
)

logger = logging.getLogger(__name__)


async def generate_character_draft(
    seed: CharacterWizardSeed,
    world: WorldRecord | None = None,
    profile: ModelProfile | None = None,
    prompt_template: str | None = None,
) -> CharacterWizardDraft:
    """Use a 3-Pass Pipelined LLM generation to expand a CharacterWizardSeed into a rich, coherent draft."""
    world_context = ""
    start_loc = None
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

    loc_name = start_loc.name if start_loc else "the starting district"
    loc_desc = (
        f" {start_loc.summary}"
        if start_loc
        else " Shadows stretch across the room as ambient noise hums in the background."
    )

    fallback = _fallback_character_expansion(seed, world)
    actor_prof = profile or settings.actor_profile

    # If user provided a custom prompt_template, run single-pass legacy path
    if prompt_template:
        system_prompt = render_template(prompt_template)
        user_prompt = (
            f"Name: {seed.name}\n"
            f"Archetype / Concept: {seed.archetype}\n"
            f"Role in Story: {seed.role_in_story}\n"
            f"Personality Keywords: {', '.join(seed.personality_keywords)}\n"
            f"Rough Notes: {seed.rough_notes}\n"
            f"{world_context}"
        )
        try:
            llm_out = await llm_client.complete_structured(
                [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                CharacterWizardLLMOutput,
                profile=actor_prof,
                max_tokens=4096,
            )
            draft = (
                llm_out.to_draft()
                if isinstance(llm_out, CharacterWizardLLMOutput)
                else llm_out
            )
            # Heal single pass omissions
            demo = infer_demographics_and_anatomy(draft.name, seed.archetype, seed.rough_notes, draft.species or "Human")
            if not draft.species:
                draft.species = fallback.species
            draft.sex = draft.sex or demo["sex"]
            draft.pronouns = draft.pronouns or demo["pronouns"]
            draft.age = draft.age or demo["age"]
            draft.build_and_height = _sanitize_height_only(draft.build_and_height, demo["height"])
            draft.posture = draft.posture or demo["posture"]
            if not draft.distinctive_features or len(draft.distinctive_features) < 6:
                draft.distinctive_features = _normalize_distinctive_features(
                    draft.distinctive_features,
                    demo["build"],
                    fallback.distinctive_features,
                )
            if not draft.character_bio:
                world_note = f" in {world.name}" if world else ""
                notes_part = f" {seed.rough_notes.strip()}" if seed.rough_notes.strip() else ""
                draft.character_bio = f"{draft.name} is an active {seed.archetype}{world_note}, operating as {seed.role_in_story}.{notes_part}".strip()
            if not draft.physical_appearance:
                draft.physical_appearance = f"{draft.name} has an {demo['build']}, standing at {draft.build_and_height}, featuring {', '.join(draft.distinctive_features[:3])}."
            if not draft.mannerisms:
                draft.mannerisms = fallback.mannerisms
            else:
                draft.mannerisms = [_clean_mannerism(m) for m in draft.mannerisms if _clean_mannerism(m)] or fallback.mannerisms
            if not draft.visual_aesthetic:
                draft.visual_aesthetic = fallback.visual_aesthetic
            if not draft.personality_traits:
                draft.personality_traits = fallback.personality_traits
            if not draft.moral_code:
                aligned_m, aligned_q = infer_moral_code_and_quirks(seed.archetype, seed.personality_keywords, seed.rough_notes, draft.core_persona)
                draft.moral_code = aligned_m
                draft.quirks_flaws = draft.quirks_flaws or aligned_q
            if not draft.communication_style or not draft.voice_anchors:
                c_style, v_anchors = infer_dialogue_anchors_and_style(draft.name, seed.archetype, world.global_rules.genre if world else "", seed.rough_notes)
                draft.communication_style = draft.communication_style or c_style
                draft.voice_anchors = draft.voice_anchors or v_anchors
            if not draft.equipped and not draft.inventory:
                draft.equipped = fallback.equipped
                draft.inventory = fallback.inventory
            if not draft.initial_message:
                draft.initial_message = fallback.initial_message
            draft.baseline_psyche.default_plan = (
                normalize_bullet_plan(draft.baseline_psyche.default_plan)
                or fallback.baseline_psyche.default_plan
            )
            # Snap mood
            m_label, m_val, m_ar = normalize_starting_mood(
                draft.baseline_psyche.mood_label,
                draft.baseline_psyche.valence,
                draft.baseline_psyche.arousal,
            )
            draft.baseline_psyche.mood_label = m_label
            draft.baseline_psyche.valence = m_val
            draft.baseline_psyche.arousal = m_ar
            return draft
        except Exception:
            if not settings.allow_offline_fallback:
                raise
            return fallback

    # --- 3-PASS PIPELINED GENERATION ---
    try:
        # PASS 1: Identity, Demographics, Height, Anatomy, and Gear
        pass1_system = render_template(get_default_prompt("wizard_character_pass1_system"))
        pass1_user = (
            f"Name: {seed.name}\n"
            f"Archetype / Concept: {seed.archetype}\n"
            f"Role in Story: {seed.role_in_story}\n"
            f"Personality Keywords: {', '.join(seed.personality_keywords)}\n"
            f"Rough Notes: {seed.rough_notes}\n"
            f"{world_context}"
        )

        p1_out: CharacterWizardPass1LLMOutput = await llm_client.complete_structured(
            [
                {"role": "system", "content": pass1_system},
                {"role": "user", "content": pass1_user},
            ],
            CharacterWizardPass1LLMOutput,
            profile=actor_prof,
            max_tokens=2048,
            required_properties=list(CharacterWizardPass1LLMOutput.model_fields.keys()),
        )

        # Heal Pass 1 output using procedural demographics and anatomy
        demo = infer_demographics_and_anatomy(
            p1_out.name or seed.name,
            seed.archetype,
            seed.rough_notes,
            p1_out.species or "Human",
        )
        name = sanitize_character_markup(p1_out.name or seed.name, single_line=True) or fallback.name
        tagline = sanitize_character_markup(p1_out.tagline or "", single_line=True) or fallback.tagline
        species = sanitize_character_markup(p1_out.species or "", single_line=True) or demo["species"]
        sex = sanitize_character_markup(p1_out.sex or "", single_line=True) or demo["sex"]
        pronouns = sanitize_character_markup(p1_out.pronouns or "", single_line=True) or demo["pronouns"]
        age = sanitize_character_markup(p1_out.age or "", single_line=True) or demo["age"]

        raw_height_field = sanitize_character_markup(p1_out.build_and_height or "", single_line=True)
        build_and_height = _sanitize_height_only(raw_height_field, demo["height"])
        # Preserve any trailing build descriptor if the LLM put one in build_and_height
        build_hint = demo["build"]
        if "," in raw_height_field:
            trailing_build = raw_height_field.split(",", 1)[1].strip()
            if trailing_build:
                build_hint = trailing_build

        posture = sanitize_character_markup(p1_out.posture or "", single_line=True) or demo["posture"]
        visual_aesthetic = sanitize_character_markup(p1_out.visual_aesthetic or "", single_line=True) or fallback.visual_aesthetic

        raw_features = [
            s
            for s in (sanitize_character_markup(f, single_line=True) for f in p1_out.distinctive_features)
            if s
        ]
        features = _normalize_distinctive_features(raw_features, build_hint, fallback.distinctive_features)

        character_bio = sanitize_character_markup(p1_out.character_bio or "")
        if not character_bio:
            world_note = f" within {world.name}" if world else ""
            notes_part = f" {seed.rough_notes.strip()}" if seed.rough_notes.strip() else ""
            character_bio = f"{name} is an active {seed.archetype}{world_note}, operating as {seed.role_in_story}.{notes_part}".strip() or fallback.character_bio

        physical_appearance = sanitize_character_markup(p1_out.physical_appearance or "")
        if not physical_appearance:
            physical_appearance = f"{name} has an {build_hint}, standing at {build_and_height}, featuring {', '.join(features[:3])}."

        mannerisms = [
            _clean_mannerism(sanitize_character_markup(m, single_line=True))
            for m in p1_out.mannerisms
            if _clean_mannerism(sanitize_character_markup(m, single_line=True))
        ] or list(fallback.mannerisms)
        if len(mannerisms) < 4:
            for m in fallback.mannerisms:
                if len(mannerisms) >= 4:
                    break
                if m not in mannerisms:
                    mannerisms.append(m)

        raw_equipped = _split_compound_items(
            [
                s
                for s in (sanitize_character_markup(it, single_line=True) for it in p1_out.equipped)
                if s
            ]
            or [str(it) for it in fallback.equipped]
        )
        raw_inventory = _split_compound_items(
            [
                s
                for s in (sanitize_character_markup(it, single_line=True) for it in p1_out.inventory)
                if s
            ]
            or [str(it) for it in fallback.inventory]
        )

        # PASS 2: Psychology, Demeanor, Aligned Ethics, Voice Anchors, Plan, and Shards
        pass2_system = render_template(get_default_prompt("wizard_character_pass2_system"))
        pass2_user = (
            f"=== ESTABLISHED PASS 1 IDENTITY & PHYSICALITY ===\n"
            f"Name: {name}\n"
            f"Tagline: {tagline}\n"
            f"Demographics: {species}, {sex} ({pronouns}), Age: {age}, Height: {build_and_height}\n"
            f"Resting Posture: {posture}\n"
            f"Distinctive Physical Features: {', '.join(features)}\n"
            f"Mannerisms / Tells: {'; '.join(mannerisms)}\n"
            f"Visual Aesthetic: {visual_aesthetic}\n"
            f"Starting Gear: Equipped: {', '.join(raw_equipped)} | Inventory: {', '.join(raw_inventory)}\n"
            f"Character Bio / Concept: {character_bio}\n\n"
            f"=== ORIGINAL USER SEED & CONTEXT ===\n"
            f"Archetype / Concept: {seed.archetype}\n"
            f"Role in Story: {seed.role_in_story}\n"
            f"Personality Keywords: {', '.join(seed.personality_keywords)}\n"
            f"Rough Notes: {seed.rough_notes}\n"
            f"{world_context}"
        )

        p2_out: CharacterWizardPass2LLMOutput = await llm_client.complete_structured(
            [
                {"role": "system", "content": pass2_system},
                {"role": "user", "content": pass2_user},
            ],
            CharacterWizardPass2LLMOutput,
            profile=actor_prof,
            max_tokens=2560,
            required_properties=list(CharacterWizardPass2LLMOutput.model_fields.keys()),
        )

        personality_traits = [
            s
            for s in (sanitize_character_markup(t, single_line=True) for t in p2_out.personality_traits)
            if s
        ] or fallback.personality_traits
        core_persona = sanitize_character_markup(p2_out.core_persona or "") or fallback.core_persona

        aligned_moral, aligned_quirks = infer_moral_code_and_quirks(
            seed.archetype,
            seed.personality_keywords,
            seed.rough_notes,
            core_persona,
        )
        moral_code = [
            s
            for s in (sanitize_character_markup(m, single_line=True) for m in p2_out.moral_code)
            if s
        ] or aligned_moral
        quirks_flaws = [
            s
            for s in (sanitize_character_markup(q, single_line=True) for q in p2_out.quirks_flaws)
            if s
        ] or aligned_quirks

        genre_text = (world.global_rules.genre if (world and world.global_rules) else "")
        style_fallback, anchors_fallback = infer_dialogue_anchors_and_style(name, seed.archetype, genre_text, seed.rough_notes)
        communication_style = [
            s
            for s in (sanitize_character_markup(c, single_line=True) for c in p2_out.communication_style)
            if s
        ] or style_fallback
        voice_anchors = p2_out.voice_anchors or anchors_fallback
        for va in voice_anchors:
            va.context = sanitize_character_markup(va.context, single_line=True)
            va.snippet = sanitize_character_markup(va.snippet, preserve_italics=True)

        core_drive = sanitize_character_markup(p2_out.core_drive or "", single_line=True) or fallback.baseline_psyche.core_drive
        core_fear = sanitize_character_markup(p2_out.core_fear or "", single_line=True) or fallback.baseline_psyche.core_fear
        default_want = sanitize_character_markup(p2_out.default_want or "", single_line=True) or fallback.baseline_psyche.default_want
        default_plan = normalize_bullet_plan(
            [sanitize_character_markup(s) for s in p2_out.default_plan]
        ) or fallback.baseline_psyche.default_plan

        memory_shards = p2_out.memory_shards or fallback.memory_shards
        for ms in memory_shards:
            ms.title = sanitize_character_markup(ms.title, single_line=True)
            ms.content = sanitize_character_markup(ms.content)

        mood_label, val, ar = normalize_starting_mood(p2_out.starting_mood)

        inferred_temp, inferred_wv = infer_temperament_and_worldview_from_text(
            character_bio,
            core_persona,
            " ".join(seed.personality_keywords),
            seed.rough_notes,
        )

        # PASS 3: Dedicated 3-Beat Turn 0 Opening Scene & Intent-Driven Greeting
        pass3_system = render_template(get_default_prompt("wizard_character_pass3_system"))
        anchors_summary = "\n".join(
            f"- [{va.context}]: {va.snippet}" for va in voice_anchors[:2]
        )
        memories_summary = "\n".join(
            f"- {ms.title}: {ms.content}" for ms in memory_shards[:3]
        )
        pass3_user = (
            f"=== CHARACTER SITUATION, BIO & INTENT ===\n"
            f"Name: {name} ({tagline})\n"
            f"Role in Story: {seed.role_in_story}\n"
            f"Creator Notes / Current Predicament: {seed.rough_notes.strip() or 'None specified'}\n"
            f"Character Bio: {character_bio}\n"
            f"Core Drive: {core_drive}\n"
            f"Immediate Want: {default_want}\n"
            f"Immediate Tactical Plan:\n{default_plan}\n"
            f"Recent Backstory Context:\n{memories_summary}\n\n"
            f"=== APPEARANCE, VOICE & GEAR ===\n"
            f"Demographics: {species}, {sex} ({pronouns}), Age: {age}, Height: {build_and_height}\n"
            f"Distinctive Features: {', '.join(features)}\n"
            f"Resting Posture: {posture}\n"
            f"Mannerisms / Tells: {'; '.join(mannerisms)}\n"
            f"Equipped Attire & Gear: {', '.join(raw_equipped)}\n"
            f"Carried Inventory: {', '.join(raw_inventory)}\n"
            f"Persona & Defense Mechanisms: {core_persona}\n"
            f"Communication Style: {', '.join(communication_style)}\n"
            f"Active Starting Mood: {mood_label}\n"
            f"Voice Anchors:\n{anchors_summary}\n\n"
            f"=== STARTING LOCATION ===\n"
            f"Location: {loc_name}\n"
            f"Atmosphere & Sensory Details: {loc_desc}\n\n"
            f"Compose the 3-beat Turn 0 opening scene:\n"
            f"1. *Environment & Stakes* grounded in why {name} is here right now.\n"
            f"2. *Quick Character Overview* (key visual details, posture/state, and a tell).\n"
            f"3. \"First spoken line driven by their current predicament and immediate intent.\""
        )

        try:
            p3_out: CharacterWizardPass3LLMOutput = await llm_client.complete_structured(
                [
                    {"role": "system", "content": pass3_system},
                    {"role": "user", "content": pass3_user},
                ],
                CharacterWizardPass3LLMOutput,
                profile=actor_prof,
                max_tokens=1024,
                required_properties=["initial_message"],
            )
            initial_message = (p3_out.initial_message or "").strip()
        except Exception as p3_exc:
            logger.warning("Pass 3 scene generation failed (%s); falling back to location-aware template.", p3_exc)
            initial_message = ""

        if not initial_message:
            initial_message = fallback.initial_message

        draft = CharacterWizardDraft(
            name=name,
            tagline=tagline,
            character_bio=character_bio,
            physical_appearance=physical_appearance,
            species=species,
            sex=sex,
            pronouns=pronouns,
            age=age,
            build_and_height=build_and_height,
            distinctive_features=features,
            posture=posture,
            mannerisms=mannerisms,
            modifications=[],
            visual_aesthetic=visual_aesthetic,
            personality_traits=personality_traits,
            core_persona=core_persona,
            moral_code=moral_code,
            quirks_flaws=quirks_flaws,
            communication_style=communication_style,
            initial_message=initial_message,
            equipped=coerce_item_list(raw_equipped),
            inventory=coerce_item_list(raw_inventory),
            voice_anchors=voice_anchors,
            baseline_psyche=BaselinePsyche(
                mood_label=mood_label,
                valence=val,
                arousal=ar,
                core_drive=core_drive,
                core_fear=core_fear,
                default_want=default_want,
                default_plan=default_plan,
                initial_worldview=inferred_wv,
                temperament=inferred_temp,
            ),
            memory_shards=memory_shards,
            tags=[slugify_tag(kw) for kw in seed.personality_keywords if kw.strip()] or fallback.tags,
            creator="",
            creator_notes=seed.rough_notes.strip() if seed.rough_notes else "",
            portraits={},
            gallery=[],
        )
        return draft
    except Exception:
        if not settings.allow_offline_fallback:
            raise
        return fallback
