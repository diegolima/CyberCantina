"""Zone 1 KV-cached static system prompt assembly and discovered-persona views."""

from __future__ import annotations

from app.prompts import (
    get_default_prompt,
    render_template,
)
from app.schemas.character import (
    CharacterRecord,
    CharacterStateSnapshot,
)
from app.schemas.persona import (
    PersonaItemInstance,
    PersonaLoreEntry,
    PersonaRecord,
    PersonaTurnStateSnapshot,
)
from app.schemas.world import WorldRecord
from dataclasses import dataclass

@dataclass(frozen=True)
class DiscoveredPersonaView:
    """Subset of persona traits known to a specific character at turn execution time."""

    persona_id: str
    name: str
    physical_appearance: str
    revealed_age: str | None
    visible_equipped: list[PersonaItemInstance]
    known_inventory: list[PersonaItemInstance]
    known_lore: list[PersonaLoreEntry]


def resolve_character_known_persona(
    persona_snapshot: PersonaRecord | None,
    current_player_state: PersonaTurnStateSnapshot | None,
    unlocked_keys: list[str] | set[str] | None,
) -> DiscoveredPersonaView | None:
    """Resolve the epistemically filtered view of the player persona for an NPC."""
    if persona_snapshot is None:
        return None
    keys = set(unlocked_keys or [])

    revealed_age = None
    if persona_snapshot.age:
        if not persona_snapshot.age_is_secret or "age" in keys:
            revealed_age = str(persona_snapshot.age)

    equipped_pool = (
        current_player_state.equipped
        if current_player_state is not None
        else persona_snapshot.equipped
    )
    inventory_pool = (
        current_player_state.inventory
        if current_player_state is not None
        else persona_snapshot.inventory
    )

    visible_equipped = [
        it for it in equipped_pool if not it.is_secret or it.id in keys
    ]
    known_inventory = [
        it for it in inventory_pool if not it.is_secret or it.id in keys
    ]
    known_lore = [
        l for l in persona_snapshot.lore_entries if not l.is_secret or l.id in keys
    ]

    app_parts: list[str] = []
    if persona_snapshot.build_and_height and persona_snapshot.build_and_height.strip():
        app_parts.append(persona_snapshot.build_and_height.strip())
    if persona_snapshot.distinctive_features:
        app_parts.append(f"Distinctive features: {', '.join(persona_snapshot.distinctive_features)}")
    appearance_str = "; ".join(app_parts) if app_parts else persona_snapshot.physical_appearance

    return DiscoveredPersonaView(
        persona_id=persona_snapshot.id,
        name=persona_snapshot.name,
        physical_appearance=appearance_str,
        revealed_age=revealed_age,
        visible_equipped=visible_equipped,
        known_inventory=known_inventory,
        known_lore=known_lore,
    )


def build_all_character_known_personas(
    persona_snapshot: PersonaRecord | None,
    current_player_state: PersonaTurnStateSnapshot | None,
    all_character_states: dict[str, CharacterStateSnapshot],
) -> dict[str, DiscoveredPersonaView]:
    """Precompute known persona views for every character in the turn context."""
    if persona_snapshot is None:
        return {}
    res: dict[str, DiscoveredPersonaView] = {}
    for cid, cstate in all_character_states.items():
        view = resolve_character_known_persona(
            persona_snapshot,
            current_player_state,
            cstate.unlocked_persona_keys,
        )
        if view is not None:
            res[cid] = view
    return res


def format_zone1_player_protagonist_block(persona_snapshot: PersonaRecord | None) -> str:
    """Format static protagonist identity block for Zone 1.

    Guarantees 100% KV-cache reuse because player attributes in Zone 1
    are immutable for the campaign.
    """
    if not persona_snapshot:
        return ""
    lines = ["\n\n=== PLAYER / PROTAGONIST ===", f"Name: {persona_snapshot.name}"]
    demographics: list[str] = []
    if persona_snapshot.species and persona_snapshot.species.strip():
        demographics.append(f"Species: {persona_snapshot.species.strip()}")
    if persona_snapshot.sex and persona_snapshot.sex.strip():
        demographics.append(f"Sex: {persona_snapshot.sex.strip()}")
    if persona_snapshot.pronouns and persona_snapshot.pronouns.strip():
        demographics.append(f"Pronouns: {persona_snapshot.pronouns.strip()}")
    if demographics:
        lines.append(" | ".join(demographics))

    if persona_snapshot.build_and_height and persona_snapshot.build_and_height.strip():
        lines.append(f"Build & Height: {persona_snapshot.build_and_height.strip()}")
    if persona_snapshot.distinctive_features:
        lines.append(f"Distinctive Features: {', '.join(persona_snapshot.distinctive_features)}")

    if persona_snapshot.persona_bio and persona_snapshot.persona_bio.strip():
        lines.append(f"Persona Bio: {persona_snapshot.persona_bio.strip()}")
    elif persona_snapshot.physical_appearance and persona_snapshot.physical_appearance.strip():
        lines.append(f"Physical Appearance: {persona_snapshot.physical_appearance.strip()}")

    lines.append("Note: This is the player character. Do NOT speak, decide, or act on behalf of the player.")
    return "\n".join(lines)


def build_zone1_narrator_system_prompt(
    world: WorldRecord,
    prompt_template: str | None = None,
    persona_snapshot: PersonaRecord | None = None,
) -> str:
    """Zone 1: Strictly static system prompt prefix for the Narrator Meta-Actor."""
    template = prompt_template or get_default_prompt("narrator_zone1_system")
    base = render_template(
        template,
        world_name=world.name,
        genre=world.global_rules.genre,
        tone=world.global_rules.tone,
        setting_overview=world.global_rules.setting_overview,
        tech_or_magic_rules=world.global_rules.tech_or_magic_rules,
    )
    return base + format_zone1_player_protagonist_block(persona_snapshot)


def build_zone1_static_system_prompt(
    world: WorldRecord,
    character: CharacterRecord,
    prompt_template: str | None = None,
    persona_snapshot: PersonaRecord | None = None,
) -> str:
    """Zone 1: Strictly static system prompt prefix to guarantee 100% KV-cache hits across turns."""
    style_str = f"Communication Style: {', '.join(character.communication_style)}\n" if character.communication_style else ""
    anchors_str = "\n".join(f"- [{v.context}]: {v.snippet}" for v in character.voice_anchors)
    voice_lines = f"{style_str}{anchors_str}".strip() or "- None"

    appearance_parts: list[str] = []
    if character.build_and_height:
        height_label = "Build & Height" if "," in character.build_and_height else "Height"
        appearance_parts.append(f"- {height_label}: {character.build_and_height}")
    if character.distinctive_features:
        appearance_parts.append(f"- Distinctive Features: {', '.join(character.distinctive_features)}")
    if character.posture:
        appearance_parts.append(f"- Posture: {character.posture}")
    if character.mannerisms:
        mannerism_lines = "\n".join(f"  * {m}" for m in character.mannerisms)
        appearance_parts.append(f"- Mannerisms & Behavioral Tells:\n{mannerism_lines}")
    if character.visual_aesthetic:
        appearance_parts.append(f"- Visual Aesthetic: {character.visual_aesthetic}")
    if not appearance_parts and character.physical_appearance.strip():
        appearance_parts.append(f"- Overview: {character.physical_appearance.strip()}")

    appearance_line = (
        f"Physical Appearance (Immutable Anatomy & Features):\n" + "\n".join(appearance_parts) + "\n"
        if appearance_parts
        else ""
    )

    identity_items: list[str] = []
    if character.species and character.species.lower() != "human":
        identity_items.append(f"Species: {character.species}")
    if character.sex:
        identity_items.append(f"Sex: {character.sex}")
    if character.pronouns:
        identity_items.append(f"Pronouns: {character.pronouns}")
    if character.age:
        identity_items.append(f"Age: {character.age}")
    identity_prefix = f"Demographics: {', '.join(identity_items)}\n" if identity_items else ""
    if character.character_bio and character.character_bio != character.physical_appearance:
        identity_prefix += f"Bio: {character.character_bio}\n"

    persona_parts: list[str] = []
    if character.personality_traits:
        persona_parts.append(f"Traits: {', '.join(character.personality_traits)}")
    if character.moral_code:
        persona_parts.append(f"Boundaries: {', '.join(character.moral_code)}")
    if character.quirks_flaws:
        persona_parts.append(f"Quirks & Flaws: {', '.join(character.quirks_flaws)}")
    persona_parts.append(character.core_persona)
    full_persona = "\n".join(persona_parts)

    tagline_with_identity = f"{character.tagline}\n{identity_prefix}".strip() if identity_prefix else character.tagline

    template = prompt_template or get_default_prompt("actor_zone1_system")
    base = render_template(
        template,
        character_name=character.name,
        world_name=world.name,
        genre=world.global_rules.genre,
        tone=world.global_rules.tone,
        setting_overview=world.global_rules.setting_overview,
        tech_or_magic_rules=world.global_rules.tech_or_magic_rules,
        tagline=tagline_with_identity,
        appearance_section=appearance_line,
        physical_appearance=character.physical_appearance,
        core_persona=full_persona,
        core_drive=character.baseline_psyche.core_drive,
        core_fear=character.baseline_psyche.core_fear,
        voice_lines=voice_lines,
    )
    return base + format_zone1_player_protagonist_block(persona_snapshot)


def build_zone1_ensemble_system_prompt(
    world: WorldRecord,
    present_characters: list[CharacterRecord],
    prompt_template: str | None = None,
    persona_snapshot: PersonaRecord | None = None,
) -> str:
    """Zone 1: Static prefix for multi-character ensemble prose generation.
    If len(present_characters) == 1: uses standard build_zone1_static_system_prompt.
    If len > 1: sorts characters by canonical id to maximize KV-cache reuse,
    rendering an ensemble cast sheet with persona, drive, fear, and voice anchors.
    """
    if len(present_characters) <= 1:
        single_char = present_characters[0] if present_characters else None
        if single_char is None:
            return build_zone1_narrator_system_prompt(world, prompt_template=prompt_template, persona_snapshot=persona_snapshot)
        return build_zone1_static_system_prompt(world, single_char, prompt_template=prompt_template, persona_snapshot=persona_snapshot)

    # Multi-character ensemble: sort strictly by canonical id
    sorted_cast = sorted(present_characters, key=lambda c: c.id)
    cast_sections: list[str] = []
    for c in sorted_cast:
        style_prefix = f"  - Style: {', '.join(c.communication_style)}\n" if c.communication_style else ""
        v_lines = style_prefix + "\n".join(f"  - [{v.context}]: {v.snippet}" for v in c.voice_anchors)
        v_lines = v_lines.strip() or "  - None"

        appearance_parts: list[str] = []
        if c.build_and_height:
            appearance_parts.append(f"Build: {c.build_and_height}")
        if c.distinctive_features:
            appearance_parts.append(f"Features: {', '.join(c.distinctive_features)}")
        if c.posture:
            appearance_parts.append(f"Posture: {c.posture}")
        if c.modifications:
            appearance_parts.append(f"Cyberware: {', '.join(c.modifications)}")
        if c.mannerisms:
            appearance_parts.append(f"Tells: {', '.join(c.mannerisms)}")
        if not appearance_parts and c.physical_appearance.strip():
            appearance_parts.append(c.physical_appearance.strip())
        app_text = f"  Appearance: {'; '.join(appearance_parts)}\n" if appearance_parts else ""

        persona_parts = []
        if c.personality_traits:
            persona_parts.append(f"Traits: {', '.join(c.personality_traits)}")
        persona_parts.append(c.core_persona)
        c_persona = " | ".join(persona_parts)

        cast_sections.append(
            f"=== CHARACTER: {c.name} (id='{c.id}') ===\n"
            f"Tagline: {c.tagline}\n"
            f"{app_text}"
            f"Persona: {c_persona}\n"
            f"Drive: {c.baseline_psyche.core_drive} | Fear: {c.baseline_psyche.core_fear}\n"
            f"Voice & Mannerism Anchors:\n{v_lines}"
        )
    ensemble_cast_text = "\n\n".join(cast_sections)

    protagonist_block = format_zone1_player_protagonist_block(persona_snapshot)

    return (
        f"You are the narrative ensemble writer in an interactive story.\n\n"
        f"=== WORLD SETTING: {world.name} ===\n"
        f"Genre & Tone: {world.global_rules.genre} — {world.global_rules.tone}\n"
        f"Overview: {world.global_rules.setting_overview}\n"
        f"World Rules: {world.global_rules.tech_or_magic_rules}\n\n"
        f"=== CAST PRESENT IN ROOM ===\n"
        f"{ensemble_cast_text}"
        f"{protagonist_block}\n\n"
        f"=== NARRATIVE PROTOCOL ===\n"
        f"Write rich, immersive, multi-character narrative prose capturing physical actions (*italics*) "
        f"and spoken dialogue (\"quotes\") for the present characters. "
        f"Honor each character's voice anchors, active thoughts, feelings, and tactical plans provided in the turn context. "
        f"When characters act under a dice check, strictly enforce the mechanical outcome tier in narrative prose:\n"
        f"- Critical Failure: The action catastrophically backfires with severe consequences. Never narrate success.\n"
        f"- Failure with Consequences: The attempt fails with noticeable resistance or secondary complications.\n"
        f"- Simple Failure: The attempt cleanly fails without piling on extra disasters.\n"
        f"- Clean Success: The attempt succeeds smoothly as intended.\n"
        f"- Critical Success: The attempt succeeds with outstanding flair and extra advantage.\n"
        f"Do NOT output <cognition> blocks. Never speak or act on behalf of the user."
    )
