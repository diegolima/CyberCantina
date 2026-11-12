"""Cognitive distillation and world synthesis for SillyTavern character cards."""

from __future__ import annotations

import re
from typing import Any

from app.config import ModelProfile, settings
from app.engine.llm_client import llm_client
from app.prompts import get_default_prompt, render_template
from app.schemas.affective import infer_temperament_and_worldview_from_text
from app.schemas.character import (
    BaselinePsyche,
    CharacterWizardDraft,
    CharacterWizardLLMOutput,
    MemoryShard,
    VoiceAnchor,
    normalize_bullet_plan,
    normalize_starting_mood,
)
from app.schemas.world import WorldRecord, WorldWizardSeed
from app.wizards.sillytavern_parser import SillyTavernRawCard


def _extract_section(text: str, heading: str) -> str:
    """Extract content under a specific heading until the next heading or double newline."""
    pattern = rf"(?:^|\n)(?:#+\s*|\*\*\s*|)" + re.escape(heading) + rf"(?:\s*\*+|\s*:|)(?:\n+)([\s\S]*?)(?=(?:\n(?:#+\s*|\*\*\s*|[A-Z][a-zA-Z\s]{{2,20}}:)|\Z))"
    match = re.search(pattern, text, re.IGNORECASE)
    if match:
        return match.group(1).strip()
    return ""


def _extract_lore_entry_keys(
    entry: dict[str, Any],
    *,
    fallback_name: str = "",
) -> list[str]:
    """Extract deduplicated trigger keywords from a character_book entry."""
    keys: list[str] = []
    seen: set[str] = set()
    for field in ("keys", "key", "secondary_keys"):
        raw = entry.get(field)
        if isinstance(raw, str):
            candidates = [part.strip() for part in raw.split(",")]
        elif isinstance(raw, list):
            candidates = [str(item).strip() for item in raw]
        else:
            candidates = []
        for cand in candidates:
            if cand and cand.lower() not in seen:
                seen.add(cand.lower())
                keys.append(cand)
    if not keys and fallback_name:
        return [fallback_name.lower()]
    return keys


def _format_character_book_for_prompt(
    entries: list[dict[str, Any]],
    *,
    max_entries: int = 12,
    max_entry_chars: int = 500,
    max_total_chars: int = 4500,
) -> str:
    """Format enabled character_book lorebook entries into a bounded prompt section."""
    lines: list[str] = []
    total_chars = 0
    for idx, entry in enumerate(entries):
        if not isinstance(entry, dict) or entry.get("enabled") is False:
            continue
        content = str(entry.get("content") or "").strip()
        if not content:
            continue
        title = str(entry.get("comment") or entry.get("name") or f"Entry {idx + 1}").strip()
        keys = _extract_lore_entry_keys(entry)
        snippet = content[:max_entry_chars].strip()
        if len(content) > max_entry_chars:
            snippet += "..."
        key_suffix = f" (keys: {', '.join(keys[:6])})" if keys else ""
        line = f"- [{title[:60]}]{key_suffix}: {snippet}"
        if total_chars + len(line) > max_total_chars:
            break
        lines.append(line)
        total_chars += len(line) + 1
        if len(lines) >= max_entries:
            break
    return "\n".join(lines)


def _fallback_sillytavern_distillation(
    card: SillyTavernRawCard,
    world: WorldRecord | None = None,
) -> CharacterWizardDraft:
    """Heuristic fallback parser when LLM completion is unavailable."""
    name = card.name or "Unknown Character"
    tagline_parts = [t.capitalize() for t in card.tags[:3]]
    tagline = f"{name} ({', '.join(tagline_parts)})" if tagline_parts else f"{name} (Independent Roleplay Agent)"

    # 1. Physical Appearance (extract from description section if present)
    appearance_raw = _extract_section(card.description, "Appearance")
    if not appearance_raw:
        # Fallback: look for physical descriptions in first 2 paragraphs
        paras = [p.strip() for p in card.description.split("\n\n") if p.strip()]
        appearance_raw = paras[0] if paras else f"{name} has an observant presence shaped by their background."
    physical_appearance = appearance_raw[:350].strip()

    # 2. Core Persona (personality or persona section)
    extracted_personality = _extract_section(card.description, "Personality")
    if card.personality.strip() and extracted_personality:
        personality_raw = f"{card.personality.strip()}. {extracted_personality}"
    else:
        personality_raw = card.personality.strip() or extracted_personality
    if not personality_raw:
        paras = [p.strip() for p in card.description.split("\n\n") if p.strip()]
        personality_raw = " ".join(paras[1:3]) if len(paras) > 1 else card.description
    core_persona = personality_raw[:450].strip() or f"{name} is confident, observant, and grounded."

    # 3. Initial Message
    initial_message = card.first_mes.strip()
    if not initial_message:
        initial_message = f"*{name} watches you closely, adjusting their posture before speaking.* \"What brings you here?\""

    # 4. Equipped & Inventory heuristics
    default_equipped = ["Practical street attire", "Durable utility footwear"]
    # Scan for common items
    text_corpus = f"{card.description} {card.first_mes}".lower()
    if any(k in text_corpus for k in ("jacket", "coat", "hoodie")):
        default_equipped[0] = "Concealed-carry jacket and street clothes"
    if any(k in text_corpus for k in ("leather", "armor", "vest")):
        default_equipped.append("Reinforced protective vest")

    default_inventory = ["Encrypted personal comm-device"]
    if any(k in text_corpus for k in ("gun", "pistol", "sidearm", "weapon")):
        default_inventory.append("Concealed sidearm")
    if any(k in text_corpus for k in ("badge", "police", "officer", "detective")):
        default_inventory.append("Service badge and identification")
    if any(k in text_corpus for k in ("keys", "keycard")):
        default_inventory.append("Apartment keycard")

    # 5. Voice Anchors
    voice_anchors: list[VoiceAnchor] = []
    if card.mes_example:
        # Try extracting dialogue lines
        dialogue_blocks = re.split(r"<START>", card.mes_example, flags=re.IGNORECASE)
        for block in dialogue_blocks:
            lines = [l.strip() for l in block.split("\n") if l.strip()]
            for line in lines:
                if line.lower().startswith(f"{name.lower()}:") or line.lower().startswith("{{char}}:"):
                    snippet = re.sub(r"^(?:[a-zA-Z0-9_\s]+|\{\{char\}\}):\s*", "", line).strip()
                    if snippet and len(voice_anchors) < 3:
                        voice_anchors.append(
                            VoiceAnchor(
                                context=f"Cadence Example {len(voice_anchors) + 1}",
                                snippet=snippet,
                            )
                        )
    if not voice_anchors:
        voice_anchors = [
            VoiceAnchor(
                context="Calm / Conversational",
                snippet=f"*{name} leans back slightly, studying the room.* \"You don't come all this way just for small talk.\"",
            ),
            VoiceAnchor(
                context="Under Pressure / Guarded",
                snippet=f"*{name}'s expression tightens, voice dropping low.* \"Careful what you ask for. You might not like the answer.\"",
            ),
        ]

    # 6. Baseline Psyche (including CARE temperament preset & worldview inference)
    inferred_temp, inferred_wv = infer_temperament_and_worldview_from_text(
        card.personality,
        core_persona,
        card.description,
        card.scenario,
        " ".join(card.tags),
    )
    temp_arch = getattr(inferred_temp, "archetype", "balanced")
    if temp_arch in ("stoic", "balanced"):
        mood_label, val, ar = "Calm & Composed", 0.2, 0.2
    elif temp_arch in ("paranoiac", "proud_rival"):
        mood_label, val, ar = "Wary & Guarded", -0.2, 0.4
    elif temp_arch == "confidant":
        mood_label, val, ar = "Warm & Receptive", 0.6, 0.3
    elif temp_arch == "volatile":
        mood_label, val, ar = "Uneasy & On-Edge", -0.4, 0.6
    else:
        mood_label, val, ar = "Wary & Guarded", -0.2, 0.4

    baseline_psyche = BaselinePsyche(
        mood_label=mood_label,
        valence=val,
        arousal=ar,
        core_drive=f"Accomplish their mission and protect what matters to them.",
        core_fear=f"Being cornered, manipulated, or losing control in critical moments.",
        default_want=f"Assess the immediate surroundings and the user's motives.",
        default_plan=(
            "- Assess the immediate surroundings and note all available exits.\n"
            "- Gauge the user's motives through cautious, guarded interaction.\n"
            "- Protect personal autonomy and avoid committing to promises prematurely."
        ),
        initial_worldview=inferred_wv,
        temperament=inferred_temp,
    )

    # 7. Memory Shards
    memory_shards: list[MemoryShard] = []
    # If character_book entries exist, convert them!
    if card.character_book_entries:
        for idx, entry in enumerate(card.character_book_entries):
            if not isinstance(entry, dict) or entry.get("enabled") is False:
                continue
            title = str(entry.get("comment") or entry.get("name") or f"Lore Shard {idx + 1}").strip()
            content = str(entry.get("content", "")).strip()
            keys = _extract_lore_entry_keys(entry, fallback_name=name)
            if content:
                memory_shards.append(
                    MemoryShard(
                        title=title[:60],
                        content=content[:300],
                        keywords=keys,
                        emotional_weight=0.75,
                    )
                )
                if len(memory_shards) >= 5:
                    break

    if not memory_shards:
        # Split description into paragraph shards
        paras = [p.strip() for p in card.description.split("\n\n") if len(p.strip()) > 40]
        for idx, p in enumerate(paras[:4]):
            title_match = re.match(r"^#*\s*([A-Za-z0-9\s&]+)[:\n]", p)
            title = title_match.group(1).strip() if title_match else f"{name} Background Note {idx + 1}"
            memory_shards.append(
                MemoryShard(
                    title=title[:60],
                    content=p[:350],
                    keywords=[name.lower(), "origin", "background"],
                    emotional_weight=0.7,
                )
            )

    if not memory_shards:
        memory_shards = [
            MemoryShard(
                title=f"Background of {name}",
                content=f"{name} has spent years navigating high-stakes situations, learning to trust their instincts above all.",
                keywords=[name.lower(), "origin"],
                emotional_weight=0.8,
            )
        ]

    return CharacterWizardDraft(
        name=name,
        tagline=tagline,
        physical_appearance=physical_appearance,
        core_persona=core_persona,
        initial_message=initial_message,
        equipped=default_equipped,
        inventory=default_inventory,
        voice_anchors=voice_anchors,
        baseline_psyche=baseline_psyche,
        memory_shards=memory_shards,
        tags=card.tags,
        creator=card.creator,
        creator_notes=card.creator_notes,
    )


async def distill_sillytavern_card(
    card: SillyTavernRawCard,
    world: WorldRecord | None = None,
    profile: ModelProfile | None = None,
    prompt_template: str | None = None,
) -> CharacterWizardDraft:
    """Use structured LLM completion to deconstruct a SillyTavern card into CharacterWizardDraft."""
    fallback = _fallback_sillytavern_distillation(card, world)
    actor_prof = profile or settings.actor_profile

    world_context = ""
    if world:
        world_context = (
            f"\nTarget World Setting: {world.name} ({world.global_rules.genre})\n"
            f"World Overview: {world.global_rules.setting_overview}\n"
        )

    system_prompt = render_template(
        prompt_template or get_default_prompt("wizard_character_sillytavern_system")
    )
    lorebook_block = _format_character_book_for_prompt(card.character_book_entries)
    lorebook_section = (
        f"Character Book / Lorebook Entries:\n{lorebook_block}\n\n"
        if lorebook_block
        else ""
    )
    user_prompt = (
        f"Character Name: {card.name}\n"
        f"Raw Description:\n{card.description}\n\n"
        f"Personality:\n{card.personality}\n\n"
        f"Scenario Context:\n{card.scenario}\n\n"
        f"First Message / Greeting:\n{card.first_mes}\n\n"
        f"Dialogue Examples:\n{card.mes_example}\n\n"
        f"{lorebook_section}"
        f"Tags: {', '.join(card.tags)}\n"
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
            required_properties=list(CharacterWizardLLMOutput.model_fields.keys()),
        )
        draft = (
            llm_out.to_draft()
            if isinstance(llm_out, CharacterWizardLLMOutput)
            else llm_out
        )

        # Ensure mandatory metadata from card is strictly preserved
        if not draft.name.strip():
            draft.name = card.name
        draft.tags = card.tags or draft.tags
        draft.creator = card.creator or draft.creator
        draft.creator_notes = card.creator_notes or draft.creator_notes

        # Ensure fallback defaults if LLM outputs empty strings
        if not draft.physical_appearance.strip():
            draft.physical_appearance = fallback.physical_appearance
        if not draft.core_persona.strip():
            draft.core_persona = fallback.core_persona
        if not draft.initial_message.strip():
            draft.initial_message = card.first_mes.strip() or fallback.initial_message
        if not draft.equipped:
            draft.equipped = fallback.equipped
        if not draft.inventory:
            draft.inventory = fallback.inventory
        if not draft.voice_anchors:
            draft.voice_anchors = fallback.voice_anchors
        if not draft.memory_shards:
            draft.memory_shards = fallback.memory_shards

        # Snap mood to canonical preset
        m_label, m_val, m_ar = normalize_starting_mood(
            draft.baseline_psyche.mood_label,
            draft.baseline_psyche.valence,
            draft.baseline_psyche.arousal,
        )
        draft.baseline_psyche.mood_label = m_label
        draft.baseline_psyche.valence = m_val
        draft.baseline_psyche.arousal = m_ar
        draft.baseline_psyche.default_plan = (
            normalize_bullet_plan(draft.baseline_psyche.default_plan)
            or fallback.baseline_psyche.default_plan
        )

        # Media assets must strictly be managed by the media pipeline, not hallucinated by the LLM
        draft.portraits = {}
        draft.gallery = []

        return draft
    except Exception:
        if not settings.allow_offline_fallback:
            raise
        return fallback


def synthesize_world_seed_from_sillytavern(card: SillyTavernRawCard) -> WorldWizardSeed:
    """Synthesize a WorldWizardSeed from card scenario, tags, and initial message."""
    name = card.name or "Character"
    tags_lower = [t.lower() for t in card.tags]

    # Inferred genre
    genre = "Contemporary Noir & Crime"
    if any(t in tags_lower for t in ("cyberpunk", "sci-fi", "scifi", "futuristic")):
        genre = "Cyberpunk / Tech-Noir"
    elif any(t in tags_lower for t in ("fantasy", "medieval", "magic", "isekai")):
        genre = "Dark High Fantasy"
    elif any(t in tags_lower for t in ("horror", "lovecraft", "thriller")):
        genre = "Psychological Horror & Mystery"
    elif any(t in tags_lower for t in ("space", "galaxy", "scifi")):
        genre = "Space Opera & Galactic Frontier"

    world_name = f"{name}'s Domain"
    # Look for setting names or location clues
    scene_match = re.search(r"\b(?:in|at|inside)\s+(?:the\s+)?([A-Z][a-zA-Z0-9\s]{2,20})", card.scenario + " " + card.first_mes)
    if scene_match:
        loc_candidate = scene_match.group(1).strip()
        if len(loc_candidate) < 25 and loc_candidate.lower() not in (name.lower(), "the room", "a bar"):
            world_name = f"{loc_candidate} & Environs"

    lore_fallback = ""
    if not card.scenario.strip() and card.character_book_entries:
        lore_snippets = [
            str(entry.get("content") or "").strip()
            for entry in card.character_book_entries
            if isinstance(entry, dict) and entry.get("enabled") is not False and str(entry.get("content") or "").strip()
        ]
        if lore_snippets:
            lore_fallback = " ".join(lore_snippets[:2])

    core_premise = card.scenario.strip() or lore_fallback or (
        f"A gritty, high-stakes narrative setting where {name} navigates dangerous rivalries and shifting alliances."
    )
    if len(core_premise) > 300:
        clipped = core_premise[:300]
        core_premise = (clipped.rsplit(".", 1)[0] + ".") if "." in clipped else clipped.rstrip() + "..."

    hub_concept = card.first_mes.strip()[:200] or f"A bustling establishment where {name} meets contacts."

    return WorldWizardSeed(
        name=world_name,
        genre_and_tone=f"{genre}, atmospheric and consequential",
        core_premise=core_premise,
        initial_hub_concept=hub_concept,
        location_count=5,
    )
