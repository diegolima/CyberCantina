"""Scene-flag merging, prose-verified persona gossip exchange, and persona unlock tracking."""

from __future__ import annotations

import re

from app.schemas.character import (
    CharacterRecord,
    CharacterStateSnapshot,
)
from app.schemas.persona import (
    PersonaKnowledgeProvenance,
    PersonaRecord,
    PersonaTurnStateSnapshot,
)
from app.schemas.turn import PersonaGossipEvent

def merge_scene_flags(
    existing_flags: list[str],
    updated_flags: list[str],
    removed_flags: list[str] | None = None,
    max_flags: int = 10,
) -> list[str]:
    """Merge new scene/inventory/world flags into existing_flags without overwriting prior flags,
    applying removals and maintaining a sliding FIFO window of at most max_flags."""
    remove_set = {f.strip().lower() for f in (removed_flags or []) if f.strip()}
    additions: list[str] = []
    for raw in updated_flags:
        cleaned = raw.strip()
        if not cleaned:
            continue
        if cleaned.startswith("-") and len(cleaned) > 1:
            remove_set.add(cleaned[1:].strip().lower())
        elif cleaned.startswith("+") and len(cleaned) > 1:
            additions.append(cleaned[1:].strip())
        else:
            additions.append(cleaned)

    merged: list[str] = []
    seen_lower: set[str] = set()
    for flag in existing_flags:
        f_clean = flag.strip()
        f_low = f_clean.lower()
        if f_clean and f_low not in remove_set and f_low not in seen_lower:
            merged.append(f_clean)
            seen_lower.add(f_low)

    for flag in additions:
        f_low = flag.lower()
        if f_low not in remove_set and f_low not in seen_lower:
            merged.append(flag)
            seen_lower.add(f_low)

    if max_flags > 0 and len(merged) > max_flags:
        merged = merged[-max_flags:]

    return merged


def verify_prose_gossip_exchanges(
    *,
    raw_prose: str,
    present_characters: list[CharacterRecord],
    all_character_states: dict[str, CharacterStateSnapshot],
    persona_snapshot: PersonaRecord | None,
) -> list[PersonaGossipEvent]:
    """Inspect raw_prose to verify if an NPC possessing a secret verbalized it to a co-present NPC.

    Prose-Verified Gossip Protocol:
    1. Both source and recipient NPCs must be present in the room.
    2. The source NPC must already have unlocked the secret trait in their unlocked_persona_keys.
    3. The recipient NPC must NOT already have unlocked the secret trait.
    4. The secret's keyword or title must actually appear in raw_prose with word boundaries.
    """
    if persona_snapshot is None or len(present_characters) < 2 or not raw_prose.strip():
        return []

    # Build map of secret trait_key -> list of trigger keywords
    trait_keywords_map: dict[str, list[str]] = {}
    if persona_snapshot.age and persona_snapshot.age_is_secret:
        trait_keywords_map["age"] = [str(persona_snapshot.age).strip().lower()]

    for it in persona_snapshot.equipped + persona_snapshot.inventory:
        if it.is_secret:
            kws = list(it.trigger_keywords) or [it.name.lower()]
            trait_keywords_map[it.id] = [k.strip().lower() for k in kws if k.strip()]

    for lore in persona_snapshot.lore_entries:
        if lore.is_secret:
            kws = list(lore.trigger_keywords) or [lore.title.lower()]
            trait_keywords_map[lore.id] = [k.strip().lower() for k in kws if k.strip()]

    events: list[PersonaGossipEvent] = []

    for src in present_characters:
        src_state = all_character_states.get(src.id)
        if not src_state:
            continue
        src_keys = set(src_state.unlocked_persona_keys)
        if not src_keys:
            continue

        for trait_key in src_keys:
            kw_candidates = trait_keywords_map.get(trait_key, [])
            matched_snippet = None
            for kw in kw_candidates:
                kw_clean = kw.strip().lower()
                if len(kw_clean) >= 3 or (trait_key == "age" and len(kw_clean) >= 1):
                    pattern = rf"\b{re.escape(kw_clean)}\b"
                    m = re.search(pattern, raw_prose, flags=re.I)
                    if m:
                        start = max(0, m.start() - 25)
                        end = min(len(raw_prose), m.end() + 25)
                        matched_snippet = raw_prose[start:end].strip()
                        break

            if not matched_snippet:
                continue

            for recipient in present_characters:
                if recipient.id == src.id:
                    continue
                rec_state = all_character_states.get(recipient.id)
                if rec_state and trait_key not in rec_state.unlocked_persona_keys:
                    if not any(
                        e.recipient_character_id == recipient.id and e.trait_key == trait_key
                        for e in events
                    ):
                        events.append(
                            PersonaGossipEvent(
                                source_character_id=src.id,
                                recipient_character_id=recipient.id,
                                trait_key=trait_key,
                                verbatim_reference=matched_snippet,
                            )
                        )

    return events


def apply_turn_persona_state_and_gossip(
    *,
    turn_id: str,
    present_characters: list[CharacterRecord],
    character_states: dict[str, CharacterStateSnapshot],
    current_player_state: PersonaTurnStateSnapshot | None,
    player_revealed_keys: list[str],
    verified_gossip_events: list[PersonaGossipEvent],
) -> tuple[dict[str, CharacterStateSnapshot], PersonaTurnStateSnapshot | None]:
    """Persist turn state mutations for personas and NPC epistemic unlocks."""
    updated = dict(character_states)

    for ch in present_characters:
        st = updated.get(ch.id)
        if st is None:
            continue
        keys = list(st.unlocked_persona_keys)
        prov = dict(st.persona_knowledge_provenance)
        changed = False

        # 1. Direct player revelation to present NPCs
        for k in player_revealed_keys:
            if k not in keys:
                keys.append(k)
                prov[k] = PersonaKnowledgeProvenance(
                    unlocked_at_turn_id=turn_id,
                    learned_from="player",
                )
                changed = True

        # 2. Verified gossip to recipient NPCs
        for ev in verified_gossip_events:
            if ev.recipient_character_id == ch.id:
                if ev.trait_key not in keys:
                    keys.append(ev.trait_key)
                    prov[ev.trait_key] = PersonaKnowledgeProvenance(
                        unlocked_at_turn_id=turn_id,
                        learned_from=ev.source_character_id,
                    )
                    changed = True

        if changed:
            updated[ch.id] = st.model_copy(
                update={
                    "unlocked_persona_keys": keys,
                    "persona_knowledge_provenance": prov,
                }
            )

    return updated, current_player_state
