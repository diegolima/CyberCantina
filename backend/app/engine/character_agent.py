"""Post-Turn Per-Character State Agents & Two-Tier Clerk Inventory Arbitration."""

from __future__ import annotations

from dataclasses import dataclass
import logging
import re
from typing import Literal

from app.config import ModelProfile, settings
from app.engine.llm_client import llm_client
from app.prompts import PROMPT_KEY_CHARACTER_POST_TURN, PROMPT_KEY_CLERK_ARBITRATION
from app.prompts.renderer import get_default_prompt, render_template
from app.schemas.character import (
    CharacterRecord,
    CharacterStateSnapshot,
    MemoryShard,
)
from app.schemas.turn import (
    ArbitrationRulingRecord,
    CharacterAgentDelta,
    ExtractedCharacterMemory,
    InventoryArbitrationResult,
    PreTurnAnalysis,
    TurnNodeRecord,
)
from app.schemas.world import LocationNode, NeighborLocationView

logger = logging.getLogger("cybercantina.character_agent")

_TRAILING_FILLER_WORDS = {
    "a",
    "an",
    "the",
    "and",
    "or",
    "but",
    "of",
    "in",
    "on",
    "at",
    "to",
    "for",
    "with",
    "from",
    "by",
    "as",
    "while",
    "beneath",
    "under",
    "over",
    "into",
    "her",
    "his",
    "their",
    "its",
    "my",
    "your",
    "is",
    "are",
    "was",
    "were",
    "feeling",
    "currently",
    "very",
    "quite",
}

_LEADING_FILLER_WORDS = {
    "she",
    "he",
    "they",
    "i",
    "is",
    "are",
    "was",
    "feels",
    "feeling",
    "currently",
    "a",
    "an",
    "the",
}

_GENERIC_ITEM_ADJECTIVES = {
    "dark",
    "light",
    "heavy",
    "worn",
    "old",
    "new",
    "small",
    "large",
    "black",
    "white",
    "work",
    "utility",
    "stained",
    "leather",
    "concealed",
}

_USER_ALIASES = {
    "user",
    "player",
    "protagonist",
    "you",
    "the user",
    "the player",
    "the protagonist",
    "stranger",
}


def normalize_inventory_item(raw: str) -> str:
    """Normalize an inventory item label by stripping state tags like '[Worn]' or '(equipped)'."""
    s = raw.strip().lower()
    s = re.sub(
        r"^\[(?:worn|carried|equipped|held|stashed|clothing|item|object)\]\s*",
        "",
        s,
    )
    s = re.sub(
        r"\s*\((?:worn|carried|equipped|held|stashed|clothing|item|object)\)$",
        "",
        s,
    )
    return s.strip()


def clean_equipped_display_label(raw: str) -> str:
    """Strip redundant '[Worn]' / '[Equipped]' prefixes when storing into the dedicated equipped list."""
    s = raw.strip()
    s = re.sub(r"^[+-]\s*", "", s)
    s = re.sub(
        r"^\[(?:worn|equipped|held|clothing)\]\s*",
        "",
        s,
        flags=re.I,
    )
    s = re.sub(
        r"\s*\((?:worn|equipped|held)\)$",
        "",
        s,
        flags=re.I,
    )
    return s.strip()


def matches_inventory_query(existing_item: str, queries: set[str]) -> bool:
    """Return True if existing_item matches any query exactly, by normalized name, or by 4+ char substring."""
    if not queries:
        return False
    ex_low = existing_item.strip().lower()
    ex_norm = normalize_inventory_item(existing_item)
    if ex_low in queries or ex_norm in queries:
        return True
    for q in queries:
        if len(q) >= 4 and (q in ex_norm or (len(ex_norm) >= 4 and ex_norm in q)):
            return True
    return False


def normalize_mood_label(raw: str, fallback: str = "Observant and composed") -> str:
    """Normalize an affective mood string into a crisp 2-4 word evocative mood description."""
    cleaned = re.sub(r"\s*\((?:valence|arousal)[^)]*\)", "", raw or "", flags=re.I)
    cleaned = re.sub(r"^\[mood:\s*([^\]]+)\]", r"\1", cleaned, flags=re.I)
    cleaned = cleaned.strip().strip("\"'`*_.-:;! ")
    if not cleaned:
        cleaned = fallback.strip() or "Observant and composed"

    # Prefer the primary clause before explanatory conjunctions or semicolons when over-verbose
    words_all = cleaned.split()
    if len(words_all) > 4:
        clause = re.split(
            r"[;:.!?\n]|(?:\s+[—–-]\s+)|\b(?:because|while|beneath|despite|after|when|as\s+(?:she|he|they))\b",
            cleaned,
            maxsplit=1,
            flags=re.I,
        )[0].strip()
        if len(clause.split()) >= 2:
            cleaned = clause

    words = [w.strip(",;:!?.") for w in cleaned.split() if w.strip(",;:!?.")]
    while len(words) > 2 and words[0].lower() in _LEADING_FILLER_WORDS:
        words.pop(0)

    if len(words) > 4:
        words = words[:4]
    while len(words) > 2 and words[-1].lower() in _TRAILING_FILLER_WORDS:
        words.pop()

    if len(words) == 1:
        single = words[0].capitalize()
        return f"{single} and observant" if single.lower() != "observant" else "Observant and composed"
    if not words:
        return fallback or "Observant and composed"

    result = " ".join(words)
    return result[0].upper() + result[1:]


def _clamp_sentence(text: str, max_chars: int = 160) -> str:
    """Normalize a stance note into a single clean sentence."""
    s = re.sub(r"\s+", " ", (text or "").strip()).strip("\"'")
    if not s:
        return ""
    first_sent = re.split(r"(?<=[.!?])\s+", s, maxsplit=1)[0].strip()
    if len(first_sent) > max_chars:
        first_sent = first_sent[: max_chars - 1].rsplit(" ", 1)[0].rstrip(",;:") + "."
    if first_sent and first_sent[-1] not in ".!?":
        first_sent += "."
    return first_sent


def normalize_stance_updates(
    raw_stances: dict[str, str],
    *,
    self_id: str,
    self_name: str = "",
    known_characters: list[CharacterRecord] | None = None,
) -> dict[str, str]:
    """Resolve raw target labels in stance_updates to canonical 'user' or character.id keys."""
    if not raw_stances:
        return {}
    chars = known_characters or []
    normalized: dict[str, str] = {}

    for raw_target, raw_note in raw_stances.items():
        target_clean = raw_target.strip()
        note_clean = _clamp_sentence(raw_note)
        if not target_clean or not note_clean:
            continue

        t_low = target_clean.lower()
        if t_low == self_id.lower() or (self_name and t_low == self_name.strip().lower()):
            continue

        canonical_key: str | None = None
        if t_low in _USER_ALIASES or t_low.startswith("player ") or t_low.startswith("user "):
            canonical_key = "user"
        else:
            for ch in chars:
                if ch.id.lower() == t_low or ch.name.strip().lower() == t_low:
                    canonical_key = ch.id
                    break
            if canonical_key is None:
                matches = [
                    ch
                    for ch in chars
                    if len(ch.name.split()[0]) >= 3
                    and (
                        ch.name.split()[0].lower() == t_low
                        or ch.name.split()[0].lower() in t_low
                    )
                ]
                if len(matches) == 1:
                    canonical_key = matches[0].id

        if canonical_key is None:
            # Allow minor unindexed NPC names in clean Title Case, avoiding self
            if self_name and self_name.split()[0].lower() == t_low:
                continue
            canonical_key = target_clean

        if canonical_key != self_id:
            normalized[canonical_key] = note_clean

    return normalized


def format_relationship_notes_for_prompt(
    relationship_notes: dict[str, str],
    character_name_map: dict[str, str] | None = None,
) -> str:
    """Format canonical relationship_notes using human-readable character names for prompts."""
    if not relationship_notes:
        return "None"
    lookup = character_name_map or {}
    parts: list[str] = []
    for key, note in relationship_notes.items():
        if key == "user":
            label = "Player (user)"
        else:
            label = lookup.get(key, key)
        parts.append(f"{label}: {note}")
    return "; ".join(parts)


def apply_character_inventory_delta(
    *,
    existing_equipped: list[str],
    existing_inventory: list[str],
    delta: CharacterAgentDelta,
) -> tuple[list[str], list[str]]:
    """Apply 4-bucket item transitions (equipped, unequipped, obtained, removed) without duplication."""
    remove_queries: set[str] = set()
    for raw in delta.items_removed:
        c = raw.strip().lstrip("-").strip()
        if c:
            remove_queries.add(c.lower())
            norm = normalize_inventory_item(c)
            if norm:
                remove_queries.add(norm)

    unequip_queries: set[str] = set()
    for raw in delta.items_unequipped:
        c = raw.strip()
        if c:
            unequip_queries.add(c.lower())
            norm = normalize_inventory_item(c)
            if norm:
                unequip_queries.add(norm)

    equip_additions: list[str] = []
    for raw in delta.items_equipped:
        c = raw.strip()
        if not c:
            continue
        if c.startswith("-") and len(c) > 1:
            rem = c[1:].strip()
            remove_queries.add(rem.lower())
            norm = normalize_inventory_item(rem)
            if norm:
                remove_queries.add(norm)
            continue
        label = clean_equipped_display_label(c)
        if label:
            equip_additions.append(label)

    carried_additions: list[str] = []
    for raw in delta.items_obtained:
        c = raw.strip()
        if not c:
            continue
        if c.startswith("-") and len(c) > 1:
            rem = c[1:].strip()
            remove_queries.add(rem.lower())
            norm = normalize_inventory_item(rem)
            if norm:
                remove_queries.add(norm)
            continue
        c_plus = c[1:].strip() if c.startswith("+") and len(c) > 1 else c
        if re.match(r"^\[(?:worn|equipped)\]", c_plus, flags=re.I):
            label = clean_equipped_display_label(c_plus)
            if label:
                equip_additions.append(label)
        else:
            carried_additions.append(c_plus)

    equip_add_norms = {
        normalize_inventory_item(it) for it in equip_additions if normalize_inventory_item(it)
    }

    # 1. Filter existing equipped items; collect stowed/unequipped items to move to carried inventory
    new_equipped: list[str] = []
    seen_equipped_norm: set[str] = set()
    stowed_items: list[str] = []

    for item in existing_equipped:
        clean = item.strip()
        if not clean:
            continue
        if matches_inventory_query(clean, remove_queries):
            continue
        norm = normalize_inventory_item(clean)
        if not norm or norm in seen_equipped_norm:
            continue
        if matches_inventory_query(clean, unequip_queries) and norm not in equip_add_norms:
            stowed_items.append(clean_equipped_display_label(clean) or clean)
            continue
        new_equipped.append(clean)
        seen_equipped_norm.add(norm)

    # 2. Add newly equipped items
    for item in equip_additions:
        norm = normalize_inventory_item(item)
        if not norm or norm in seen_equipped_norm:
            continue
        if matches_inventory_query(item, remove_queries):
            continue
        new_equipped.append(item)
        seen_equipped_norm.add(norm)

    # 3. Filter existing carried inventory (excluding items removed or newly drawn into equipped)
    new_inventory: list[str] = []
    seen_inv_norm: set[str] = set()

    for item in existing_inventory:
        clean = item.strip()
        if not clean:
            continue
        if matches_inventory_query(clean, remove_queries):
            continue
        norm = normalize_inventory_item(clean)
        if not norm or norm in seen_inv_norm or norm in seen_equipped_norm:
            continue
        new_inventory.append(clean)
        seen_inv_norm.add(norm)

    # 4. Append stowed items and newly obtained items into carried inventory
    for item in [*stowed_items, *carried_additions]:
        clean = item.strip()
        if not clean:
            continue
        norm = normalize_inventory_item(clean)
        if not norm or norm in seen_inv_norm or norm in seen_equipped_norm:
            continue
        if matches_inventory_query(clean, remove_queries):
            continue
        new_inventory.append(clean)
        seen_inv_norm.add(norm)

    return new_equipped, new_inventory


@dataclass
class ContestedItemCase:
    """Represents a physical item contention detected across present Character Agents."""

    norm_key: str
    display_name: str
    claimant_ids: list[str]
    prior_holder_id: str | None
    reason: Literal["multi_claim", "unrelinquished_transfer"]


def detect_inventory_disputes(
    *,
    scene_characters: list[CharacterRecord],
    prev_states_by_char: dict[str, CharacterStateSnapshot],
    character_deltas: dict[str, CharacterAgentDelta],
) -> list[ContestedItemCase]:
    """Tier 1 deterministic detector for multi-claim or unrelinquished-transfer item disputes."""
    if len(scene_characters) < 2:
        return []

    claims_by_norm: dict[str, list[tuple[str, str]]] = {}
    for ch in scene_characters:
        delta = character_deltas.get(ch.id)
        if delta is None:
            continue
        claimed_raw = [*delta.items_equipped, *delta.items_obtained]
        prev_st = prev_states_by_char.get(ch.id)
        already_held_norms = {
            normalize_inventory_item(x)
            for x in ([*(prev_st.equipped if prev_st else []), *(prev_st.inventory if prev_st else [])])
            if normalize_inventory_item(x)
        }
        seen_for_char: set[str] = set()
        for raw_item in claimed_raw:
            norm = normalize_inventory_item(raw_item)
            if not norm or norm in seen_for_char or norm in already_held_norms:
                continue
            seen_for_char.add(norm)
            claims_by_norm.setdefault(norm, []).append((ch.id, clean_equipped_display_label(raw_item) or raw_item.strip()))

    # Map items currently held by each present character that were NOT relinquished this turn
    unrelinquished_holder_by_norm: dict[str, tuple[str, str]] = {}
    for ch in scene_characters:
        prev_st = prev_states_by_char.get(ch.id)
        if prev_st is None:
            continue
        delta = character_deltas.get(ch.id)
        rem_queries: set[str] = set()
        if delta:
            for r in delta.items_removed:
                rc = r.strip()
                if rc:
                    rem_queries.add(rc.lower())
                    rn = normalize_inventory_item(rc)
                    if rn:
                        rem_queries.add(rn)
        for held in [*prev_st.equipped, *prev_st.inventory]:
            if matches_inventory_query(held, rem_queries):
                continue
            h_norm = normalize_inventory_item(held)
            if h_norm and h_norm not in unrelinquished_holder_by_norm:
                unrelinquished_holder_by_norm[h_norm] = (ch.id, held)

    disputes: list[ContestedItemCase] = []
    for norm_key, claimants in claims_by_norm.items():
        claimant_ids = [cid for cid, _ in claimants]
        display_name = claimants[0][1]
        prior_holder = unrelinquished_holder_by_norm.get(norm_key)

        if len(claimant_ids) >= 2:
            prior_id = prior_holder[0] if prior_holder else None
            all_involved = list(dict.fromkeys([*claimant_ids, *([prior_id] if prior_id else [])]))
            disputes.append(
                ContestedItemCase(
                    norm_key=norm_key,
                    display_name=display_name,
                    claimant_ids=all_involved,
                    prior_holder_id=prior_id,
                    reason="multi_claim",
                )
            )
        elif prior_holder is not None and prior_holder[0] != claimant_ids[0]:
            disputes.append(
                ContestedItemCase(
                    norm_key=norm_key,
                    display_name=prior_holder[1],
                    claimant_ids=[claimant_ids[0], prior_holder[0]],
                    prior_holder_id=prior_holder[0],
                    reason="unrelinquished_transfer",
                )
            )

    return disputes


def _heuristic_arbitrate_case(
    case: ContestedItemCase,
    *,
    completed_turn: TurnNodeRecord,
    chars_by_id: dict[str, CharacterRecord],
) -> tuple[str, str]:
    """Deterministic fallback referee when offline: inspect roll outcome and prose custody cues."""
    roll = completed_turn.pre_turn.resolved_roll
    if (
        case.reason == "unrelinquished_transfer"
        and case.prior_holder_id
        and roll is not None
        and "Failure" in roll.outcome_tier
    ):
        holder_name = chars_by_id[case.prior_holder_id].name if case.prior_holder_id in chars_by_id else case.prior_holder_id
        return (
            case.prior_holder_id,
            f"Check resulted in {roll.outcome_tier}; {holder_name} retained custody of {case.display_name}.",
        )

    prose = completed_turn.raw_prose or ""
    item_tokens = [w for w in re.findall(r"[a-z0-9]{4,}", case.norm_key) if w not in _GENERIC_ITEM_ADJECTIVES]
    sentences = re.split(r"(?<=[.!?])\s+|\n+", prose)
    custody_verb_re = re.compile(
        r"\b(grabs?|snatch(?:es|ed)?|catch(?:es)|caught|pockets?|takes?|took|picks?\s+up|"
        r"secures?|claims?|retrieves?|intercepts?|wrenches?|disarms?|keeps?|kept|holds?\s+onto)\b",
        re.I,
    )

    for sent in reversed(sentences):
        s_low = sent.lower()
        if item_tokens and not any(tok in s_low for tok in item_tokens) and case.norm_key not in s_low:
            continue
        if not custody_verb_re.search(sent):
            continue
        for cid in case.claimant_ids:
            ch = chars_by_id.get(cid)
            if not ch:
                continue
            first = ch.name.split()[0].lower()
            if ch.name.lower() in s_low or (len(first) >= 3 and re.search(rf"\b{re.escape(first)}\b", s_low)):
                return (
                    cid,
                    f"Narrative prose depicts {ch.name} securing {case.display_name}.",
                )

    if case.reason == "unrelinquished_transfer" and case.prior_holder_id:
        holder_name = chars_by_id[case.prior_holder_id].name if case.prior_holder_id in chars_by_id else case.prior_holder_id
        return (
            case.prior_holder_id,
            f"No explicit handoff or disarm in prose; {holder_name} retains {case.display_name}.",
        )

    if completed_turn.actor_id in case.claimant_ids:
        winner = chars_by_id[completed_turn.actor_id].name if completed_turn.actor_id in chars_by_id else completed_turn.actor_id
        return (
            completed_turn.actor_id,
            f"Awarded {case.display_name} to primary turn actor {winner}.",
        )

    first_id = case.claimant_ids[0]
    first_name = chars_by_id[first_id].name if first_id in chars_by_id else first_id
    return first_id, f"Awarded {case.display_name} to {first_name}."


async def arbitrate_inventory_disputes_detailed(
    *,
    disputes: list[ContestedItemCase],
    scene_characters: list[CharacterRecord],
    character_deltas: dict[str, CharacterAgentDelta],
    completed_turn: TurnNodeRecord,
    profile: ModelProfile | None = None,
    prompt_template: str | None = None,
) -> tuple[dict[str, CharacterAgentDelta], list[str], list[ArbitrationRulingRecord]]:
    """Tier 2 Clerk Arbitrator: resolve contested item custody and return reconciled deltas, audit notes, and structured rulings."""
    if not disputes:
        return character_deltas, [], []

    chars_by_id = {c.id: c for c in scene_characters}
    clerk_prof = profile or settings.clerk_profile
    system_prompt = render_template(
        prompt_template or get_default_prompt(PROMPT_KEY_CLERK_ARBITRATION)
    )

    dispute_lines: list[str] = []
    for d in disputes:
        claimant_desc = ", ".join(
            f"{chars_by_id[cid].name} (id='{cid}')" if cid in chars_by_id else cid
            for cid in d.claimant_ids
        )
        holder_note = (
            f" [Prior holder: {chars_by_id[d.prior_holder_id].name} (id='{d.prior_holder_id}')]"
            if d.prior_holder_id and d.prior_holder_id in chars_by_id
            else ""
        )
        dispute_lines.append(
            f"- Item '{d.display_name}' ({d.reason}): Claimants = [{claimant_desc}]{holder_note}"
        )

    roll_info = "None"
    if completed_turn.pre_turn.resolved_roll is not None:
        r = completed_turn.pre_turn.resolved_roll
        roll_info = f"{r.action_description} -> {r.outcome_tier} (rolled {r.total} vs DC {r.difficulty_class})"

    user_prompt = (
        f"Contested Items:\n" + "\n".join(dispute_lines) + "\n\n"
        f"Mechanics / Dice Outcome: {roll_info}\n"
        f"User Message:\n{completed_turn.user_message}\n\n"
        f"Narrative Prose:\n{completed_turn.raw_prose}"
    )

    rulings_by_norm: dict[str, tuple[str, str]] = {}
    try:
        arb_res = await llm_client.complete_structured(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            InventoryArbitrationResult,
            profile=clerk_prof,
            temperature=0.1,
        )
        for dec in arb_res.decisions:
            d_norm = normalize_inventory_item(dec.item_name)
            w_raw = dec.winner_id.strip()
            w_low = w_raw.lower()
            resolved_winner = "none"
            if w_low in ("none", "nobody", "environment", "floor", "table"):
                resolved_winner = "none"
            elif w_low in _USER_ALIASES:
                resolved_winner = "user"
            else:
                for ch in scene_characters:
                    if ch.id.lower() == w_low or ch.name.lower() == w_low or ch.name.split()[0].lower() == w_low:
                        resolved_winner = ch.id
                        break
            if d_norm:
                rulings_by_norm[d_norm] = (resolved_winner, dec.rationale.strip())
    except Exception as exc:
        if not settings.allow_offline_fallback:
            raise
        logger.warning("Clerk inventory arbitration LLM failed (%s); using deterministic prose referee.", exc)

    reconciled = {cid: delta.model_copy(deep=True) for cid, delta in character_deltas.items()}
    audit_notes: list[str] = []
    rulings: list[ArbitrationRulingRecord] = []

    for case in disputes:
        if case.norm_key in rulings_by_norm:
            winner_id, rationale = rulings_by_norm[case.norm_key]
        else:
            # Also try fuzzy match against rulings_by_norm keys
            matched_ruling = next(
                (
                    val
                    for k, val in rulings_by_norm.items()
                    if matches_inventory_query(case.display_name, {k})
                ),
                None,
            )
            if matched_ruling is not None:
                winner_id, rationale = matched_ruling
            else:
                winner_id, rationale = _heuristic_arbitrate_case(
                    case, completed_turn=completed_turn, chars_by_id=chars_by_id
                )

        query_set = {case.norm_key, case.display_name.lower()}

        # Strip losing claims from all non-winning characters
        for cid in case.claimant_ids:
            if cid == winner_id or cid not in reconciled:
                continue
            d = reconciled[cid]
            d.items_equipped = [
                it for it in d.items_equipped if not matches_inventory_query(it, query_set)
            ]
            d.items_obtained = [
                it for it in d.items_obtained if not matches_inventory_query(it, query_set)
            ]

        # Enforce item conservation if a prior holder lost custody to another character or the player
        if (
            case.prior_holder_id
            and winner_id != case.prior_holder_id
            and winner_id != "none"
            and case.prior_holder_id in reconciled
        ):
            holder_delta = reconciled[case.prior_holder_id]
            if not any(matches_inventory_query(r, query_set) for r in holder_delta.items_removed):
                holder_delta.items_removed.append(case.display_name)

        winner_label = (
            chars_by_id[winner_id].name
            if winner_id in chars_by_id
            else ("Player" if winner_id == "user" else "Unclaimed")
        )
        note = f"[{case.display_name}] Custody -> {winner_label}" + (f": {rationale}" if rationale else "")
        audit_notes.append(note)
        rulings.append(
            ArbitrationRulingRecord(
                item_name=case.display_name,
                reason=case.reason,
                claimant_ids=list(case.claimant_ids),
                prior_holder_id=case.prior_holder_id,
                winner_id=winner_id,
                winner_label=winner_label,
                rationale=rationale or "",
            )
        )

    return reconciled, audit_notes, rulings


async def arbitrate_inventory_disputes(
    *,
    disputes: list[ContestedItemCase],
    scene_characters: list[CharacterRecord],
    character_deltas: dict[str, CharacterAgentDelta],
    completed_turn: TurnNodeRecord,
    profile: ModelProfile | None = None,
    prompt_template: str | None = None,
) -> tuple[dict[str, CharacterAgentDelta], list[str]]:
    """Tier 2 Clerk Arbitrator: resolve contested item custody and mutate character_deltas in-place safely."""
    reconciled, audit_notes, _ = await arbitrate_inventory_disputes_detailed(
        disputes=disputes,
        scene_characters=scene_characters,
        character_deltas=character_deltas,
        completed_turn=completed_turn,
        profile=profile,
        prompt_template=prompt_template,
    )
    return reconciled, audit_notes


def _extract_scoped_heuristic_inventory(
    *,
    character: CharacterRecord,
    is_active_speaker: bool,
    present_characters: list[CharacterRecord],
    user_message: str,
    raw_prose: str,
    prev_state: CharacterStateSnapshot,
) -> tuple[list[str], list[str], list[str], list[str]]:
    """Deterministic per-character item extractor returning (equipped, unequipped, obtained, removed)."""
    other_chars = [c for c in present_characters if c.id != character.id]
    char_first = character.name.split()[0].lower() if character.name.split() else character.name.lower()

    def _mentions_other_npc_exclusively(segment: str) -> bool:
        seg_low = segment.lower()
        mentions_self = character.name.lower() in seg_low or (
            len(char_first) >= 3 and bool(re.search(rf"\b{re.escape(char_first)}\b", seg_low))
        )
        if mentions_self:
            return False
        for oc in other_chars:
            oc_first = oc.name.split()[0].lower() if oc.name.split() else oc.name.lower()
            if oc.name.lower() in seg_low or (
                len(oc_first) >= 3 and re.search(rf"\b{re.escape(oc_first)}\b", seg_low)
            ):
                return True
        return False

    def _segment_applies_to_character(segment: str, *, from_user_msg: bool) -> bool:
        seg_low = segment.lower()
        mentions_self = character.name.lower() in seg_low or (
            len(char_first) >= 3 and bool(re.search(rf"\b{re.escape(char_first)}\b", seg_low))
        )
        if mentions_self:
            return True
        if _mentions_other_npc_exclusively(segment):
            return False
        if from_user_msg:
            # In user message, "give you / hand you" applies to active speaker; "I pick up" is the player!
            if is_active_speaker and re.search(r"\b(?:hand|hands|give|gives|pass|passes|toss|tosses)\s+(?:you|her|him)\b", seg_low):
                return True
            if is_active_speaker and len(present_characters) == 1:
                # Preserve legacy single-character deterministic behavior where user/prose combined cues apply
                if not re.search(r"\bi\s+(?:pick up|pocket|grab|put on|wear|don)\b", seg_low):
                    return True
            return False
        return is_active_speaker

    items_equipped: list[str] = []
    items_unequipped: list[str] = []
    items_obtained: list[str] = []
    items_removed: list[str] = []

    current_all = [*prev_state.equipped, *prev_state.inventory]
    segments: list[tuple[str, bool]] = [
        *[(s, True) for s in re.split(r"(?<=[.!?])\s+|\n+", user_message) if s.strip()],
        *[(s, False) for s in re.split(r"(?<=[.!?])\s+|\n+", raw_prose) if s.strip()],
    ]

    for seg, from_user in segments:
        seg_low = seg.lower()

        # Check direct user handoff to a named character: "I hand Viktor the wrench" / "give Kira the keycard"
        if from_user and (
            character.name.lower() in seg_low
            or (len(char_first) >= 3 and re.search(rf"\b{re.escape(char_first)}\b", seg_low))
        ):
            named_give = re.finditer(
                rf"\b(?:hand|hands|give|gives|pass|passes|toss|tosses)\s+{re.escape(char_first)}(?:\s+[a-z]+)?\s+"
                r"(?:(?:an|a|the|my|this)\b\s*)?([a-z0-9][a-z0-9\s\-]{2,32}?)"
                r"(?=[.,;!?'\")\n]|$|\s+(?:and|before|while|to|from|in)\b)",
                seg,
                re.I,
            )
            for m in named_give:
                obj = m.group(1).strip()
                if len(obj) >= 3:
                    items_obtained.append(obj[0].upper() + obj[1:])

        if not _segment_applies_to_character(seg, from_user_msg=from_user):
            continue

        # 1. Holster / stow into carried inventory (unequip without dropping)
        if re.search(r"\b(holsters?|stows?|sheathes?|tucks?\s+away|puts?\s+away)\b", seg_low):
            for eq_item in prev_state.equipped:
                norm = normalize_inventory_item(eq_item)
                if not norm:
                    continue
                tokens = [w for w in re.findall(r"[a-z0-9]{4,}", norm) if w not in _GENERIC_ITEM_ADJECTIVES]
                if norm in seg_low or any(re.search(rf"\b{re.escape(tok)}\b", seg_low) for tok in tokens):
                    items_unequipped.append(eq_item)

        # 2. Remove / drop / hand over / take off
        if re.search(
            r"\b(take off|takes off|took off|remove|removes|removed|shed|sheds|unfasten|unfastens|"
            r"strip off|strips off|drop|drops|dropped|hand over|hands over|give|gives|gave|toss|tosses|discard|discards)\b",
            seg_low,
        ):
            for item in current_all:
                norm = normalize_inventory_item(item)
                if not norm:
                    continue
                if norm in seg_low:
                    items_removed.append(item)
                    continue
                tokens = [w for w in re.findall(r"[a-z0-9]{4,}", norm) if w not in _GENERIC_ITEM_ADJECTIVES]
                if any(re.search(rf"\b{re.escape(tok)}\b", seg_low) for tok in tokens):
                    items_removed.append(item)

        # 3. Wear / equip / draw
        wear_matches = re.finditer(
            r"\b(?:put on|puts on|pull on|pulls on|slip into|slips into|wear|wears|don|dons|draws?|equips?|wields?)\s+"
            r"(?:(?:an|a|the|my|her|his|their|your)\b\s*)?([a-z0-9][a-z0-9\s\-]{2,32}?)"
            r"(?=[.,;!?'\")\n]|$|\s+(?:and|before|while|to|over|under|as|from|in)\b)",
            seg,
            re.I,
        )
        for m in wear_matches:
            garment = m.group(1).strip()
            if len(garment) >= 3 and garment.lower() not in {"it", "them", "this", "that", "gun", "closer", "breath"}:
                items_equipped.append(garment[0].upper() + garment[1:])

        # 4. Obtain / pick up / pocket
        acquire_matches = re.finditer(
            r"\b(?:pick up|picks up|pocket|pockets|grab|grabs|catch|catches|snatch|snatches|"
            r"hand you|hands you|give you|gives you|hand her|hands her|hand him|hands him|give her|gives her|give him|gives him)\s+"
            r"(?:(?:an|a|the|my|her|his|their|your)\b\s*)?([a-z0-9][a-z0-9\s\-]{2,32}?)"
            r"(?=[.,;!?'\")\n]|$|\s+(?:and|before|while|to|from|off|on|in|into|across)\b)",
            seg,
            re.I,
        )
        for m in acquire_matches:
            obj = m.group(1).strip()
            if len(obj) >= 3 and obj.lower() not in {"it", "them", "this", "that", "him", "her", "me", "you"}:
                items_obtained.append(obj[0].upper() + obj[1:])

    return items_equipped, items_unequipped, items_obtained, items_removed


def heuristic_character_agent_delta(
    *,
    character: CharacterRecord,
    prev_state: CharacterStateSnapshot,
    completed_turn: TurnNodeRecord,
    active_location: LocationNode,
    neighbors: list[NeighborLocationView],
    present_characters: list[CharacterRecord],
    extracted_memories_fn=None,
) -> CharacterAgentDelta:
    """Deterministic per-character state delta used when running without a live Clerk LLM."""
    is_speaker = completed_turn.actor_id == character.id
    user_msg = completed_turn.user_message
    raw_prose = completed_turn.raw_prose
    pre_turn = completed_turn.pre_turn
    combined_lower = f"{user_msg}\n{raw_prose}".lower()

    # 1. Mood, Valence & Arousal (anchored strictly to prev_state)
    char_cog = (
        (completed_turn.cognitions or {}).get(character.id)
        if hasattr(completed_turn, "cognitions") and completed_turn.cognitions
        else (completed_turn.cognition if is_speaker else None)
    )
    if char_cog and not char_cog.skipped:
        val_delta = round(char_cog.valence - prev_state.valence, 2)
        ar_delta = round(char_cog.arousal - prev_state.arousal, 2)
        mood = normalize_mood_label(char_cog.feeling, fallback=prev_state.mood_label)
        updated_want = char_cog.want or None
    else:
        sentiment_low = pre_turn.user_sentiment.lower()
        if "betray" in combined_lower or "confrontational" in sentiment_low or "tense" in sentiment_low:
            val_delta = -0.12
            ar_delta = 0.15
            mood = "Guarded, tense vigilance"
        elif "vulnerable" in sentiment_low or "trust" in combined_lower or "saved" in combined_lower:
            val_delta = 0.10
            ar_delta = 0.06
            mood = "Attentive, quiet concern"
        else:
            val_delta = 0.02
            ar_delta = 0.0
            mood = normalize_mood_label(prev_state.mood_label, fallback="Observant and measured")
        updated_want = None

    # 2. Directed Stances (toward 'user' and co-present NPCs)
    stances: dict[str, str] = {}
    char_first = character.name.split()[0].lower() if character.name.split() else character.name.lower()
    char_engaged = is_speaker or character.name.lower() in combined_lower or (
        len(char_first) >= 3 and bool(re.search(rf"\b{re.escape(char_first)}\b", combined_lower))
    )

    if char_engaged:
        if re.search(r"\b(betray(?:ed|al)?|sold .+ out|lied to|broke .+ trust)\b", combined_lower):
            stances["user"] = "Views them with sharp distrust after the exposed betrayal."
        elif re.search(r"\b(solemn(?:ly)? (?:swear|vow)|blood oath|saved (?:my|her|his) life|trust you)\b", combined_lower):
            stances["user"] = "Holds cautious, deepening trust bound by their shared commitment."
        elif "confrontational" in pre_turn.user_sentiment.lower():
            stances["user"] = "Wary of their confrontational posture and watching their hands."

        for oc in present_characters:
            if oc.id == character.id:
                continue
            oc_first = oc.name.split()[0].lower() if oc.name.split() else oc.name.lower()
            oc_mentioned = oc.name.lower() in combined_lower or (
                len(oc_first) >= 3 and bool(re.search(rf"\b{re.escape(oc_first)}\b", combined_lower))
            )
            if oc_mentioned or (oc.id == completed_turn.actor_id):
                if oc.id not in prev_state.relationship_notes:
                    stances[oc.id] = f"Reading {oc.name}'s reactions closely in {active_location.name}."

    # 3. Scoped Inventory Transitions
    eq_add, eq_unequip, inv_obtain, inv_rem = _extract_scoped_heuristic_inventory(
        character=character,
        is_active_speaker=is_speaker,
        present_characters=present_characters,
        user_message=user_msg,
        raw_prose=raw_prose,
        prev_state=prev_state,
    )

    # 4. Independent Character Location Transition
    loc_transition: Literal["stay_here", "follow_player", "move_to_neighbor"] = "stay_here"
    target_loc_id: str | None = None
    msg_low = user_msg.lower()

    # Check if this NPC independently departed to a neighbor while the player stayed
    if pre_turn.spatial_intent == "stay" and neighbors:
        depart_re = re.compile(
            rf"\b{re.escape(char_first)}\b[^.!?\n]{{0,50}}\b(?:storms?\s+out|leaves?|walks?\s+(?:into|out|toward)|heads?\s+(?:into|to|toward)|retreats?\s+(?:into|to))\b",
            re.I,
        )
        if len(char_first) >= 3 and depart_re.search(raw_prose):
            for nb in neighbors:
                dest_words = [w.lower() for w in nb.destination.name.split() if len(w) > 3]
                if nb.destination.name.lower() in raw_prose.lower() or any(w in raw_prose.lower() for w in dest_words):
                    loc_transition = "move_to_neighbor"
                    target_loc_id = nb.destination.id
                    break
    elif pre_turn.spatial_intent in ("move_known", "explore_new"):
        user_moved_alone = bool(
            re.search(r"\b(alone|by myself|without you|slip out alone|leave .+ behind)\b", msg_low)
        )
        told_to_stay = len(char_first) >= 3 and bool(
            re.search(
                rf"\b{re.escape(char_first)}\b[^.!?\n]{{0,30}}\b(?:stay here|wait here|hold the door|watch the door|stay behind)\b",
                msg_low,
            )
        )
        other_invited_exclusively = False
        if not is_speaker and len(present_characters) > 1 and not (
            character.name.lower() in msg_low
            or (len(char_first) >= 3 and re.search(rf"\b{re.escape(char_first)}\b", msg_low))
        ):
            for oc in present_characters:
                if oc.id == character.id:
                    continue
                oc_first = oc.name.split()[0].lower()
                if len(oc_first) >= 3 and re.search(
                    rf"\b(?:just|only)\s+{re.escape(oc_first)}\b|\b{re.escape(oc_first)},\s*(?:come|follow|walk)\s+with\s+me\b",
                    msg_low,
                ):
                    other_invited_exclusively = True
                    break

        if user_moved_alone or told_to_stay or other_invited_exclusively:
            loc_transition = "stay_here"
        else:
            loc_transition = "follow_player"

    # 5. Character-Specific Personal Memories
    memories: list[ExtractedCharacterMemory] = []
    if extracted_memories_fn is not None:
        all_candidates: list[ExtractedCharacterMemory] = extracted_memories_fn(
            user_message=user_msg,
            raw_prose=raw_prose,
            present_characters=present_characters,
            active_character=next((c for c in present_characters if c.id == completed_turn.actor_id), character),
            mentioned_entities=pre_turn.mentioned_entities,
        )
        memories = [m for m in all_candidates if m.character_id == character.id]

    return CharacterAgentDelta(
        mood_label=mood,
        valence_delta=val_delta,
        arousal_delta=ar_delta,
        updated_want=updated_want,
        stance_updates=stances,
        items_equipped=eq_add,
        items_unequipped=eq_unequip,
        items_obtained=inv_obtain,
        items_removed=inv_rem,
        location_transition=loc_transition,
        target_location_id=target_loc_id,
        new_memories=memories,
    )


async def run_character_post_turn_agent(
    *,
    character: CharacterRecord,
    prev_state: CharacterStateSnapshot,
    completed_turn: TurnNodeRecord,
    active_location: LocationNode,
    neighbors: list[NeighborLocationView],
    present_characters: list[CharacterRecord],
    all_participants: list[CharacterRecord],
    active_shards: list[MemoryShard],
    profile: ModelProfile | None = None,
    prompt_template: str | None = None,
    extracted_memories_fn=None,
) -> CharacterAgentDelta:
    """Execute a focused Post-Turn Character State Agent for a single present character."""
    clerk_prof = profile or settings.clerk_profile
    is_speaker = completed_turn.actor_id == character.id
    name_map = {c.id: c.name for c in all_participants}
    name_map[character.id] = character.name

    co_present_lines = [
        f"- id='{c.id}': {c.name} ({c.tagline})"
        for c in present_characters
        if c.id != character.id
    ]
    co_present_str = "\n".join(co_present_lines) or "None (only you and the player)"

    neighbor_str = "\n".join(
        f"- id='{n.destination.id}': {n.destination.name} (via {n.direction_label})"
        for n in neighbors
    ) or "None"

    existing_mem_lines = [
        f"- [id='{s.id}' | {s.origin}{f'/{s.significance}' if s.significance else ''}] {s.title}: {s.content}"
        for s in active_shards[-8:]
    ]
    existing_mem_str = "\n".join(existing_mem_lines) or "None"

    stances_str = format_relationship_notes_for_prompt(prev_state.relationship_notes, name_map)
    equipped_str = ", ".join(prev_state.equipped) if prev_state.equipped else "None"
    inventory_str = ", ".join(prev_state.inventory) if prev_state.inventory else "None"

    speaker_name = name_map.get(completed_turn.actor_id, character.name)
    char_cog = (
        (completed_turn.cognitions or {}).get(character.id)
        if hasattr(completed_turn, "cognitions") and completed_turn.cognitions
        else (completed_turn.cognition if is_speaker else None)
    )
    cognition_context = ""
    if char_cog and not char_cog.skipped:
        cognition_context = (
            f"\n{character.name}'s Intra-Turn Cognition Impulse (at start of response):\n"
            f"- Feeling Impulse: {char_cog.feeling} "
            f"(Impulse Valence: {char_cog.valence:+.2f}, Impulse Arousal: {char_cog.arousal:.2f})\n"
            f"- Immediate Want: {char_cog.want}\n"
            f"- Planned Action: {char_cog.plan}\n"
            f"*(Note: Compute valence_delta and arousal_delta strictly relative to Pre-Turn Baseline below, NOT relative to Impulse.)*\n"
        )

    roll_str = ""
    if completed_turn.pre_turn.resolved_roll is not None:
        r = completed_turn.pre_turn.resolved_roll
        roll_str = f"Mechanics Outcome: {r.action_description} -> [{r.outcome_tier}] ({r.narrative_directive})\n"

    system_prompt = render_template(
        prompt_template or get_default_prompt(PROMPT_KEY_CHARACTER_POST_TURN),
        character_name=character.name,
        character_id=character.id,
    )
    user_prompt = (
        f"Character Identity:\n"
        f"- Name: {character.name} (id='{character.id}')\n"
        f"- Tagline: {character.tagline}\n"
        f"- Core Drive: {character.baseline_psyche.core_drive}\n"
        f"- Core Fear: {character.baseline_psyche.core_fear}\n"
        f"- Role This Turn: {'Primary Speaking Character' if is_speaker else 'Co-Present Witness in Scene'}\n\n"
        f"Pre-Turn Baseline State (Anchor deltas here):\n"
        f"- Pre-Turn Mood: {prev_state.mood_label}\n"
        f"- Pre-Turn Valence: {prev_state.valence:+.2f}\n"
        f"- Pre-Turn Arousal: {prev_state.arousal:.2f}\n"
        f"- Pre-Turn Want: {prev_state.active_want}\n"
        f"- Existing Stances: {stances_str}\n"
        f"- Equipped / Worn: {equipped_str}\n"
        f"- Carried Inventory: {inventory_str}\n"
        f"{cognition_context}\n"
        f"Scene Roster & Spatial Context:\n"
        f"- Starting Location: {active_location.name} (id='{active_location.id}')\n"
        f"- Player Spatial Intent: {completed_turn.pre_turn.spatial_intent}"
        f"{f' ({completed_turn.pre_turn.target_location_hint})' if completed_turn.pre_turn.target_location_hint else ''}\n"
        f"- Co-Present Characters:\n{co_present_str}\n"
        f"- Known Exits:\n{neighbor_str}\n\n"
        f"Existing Memories for {character.name} (do NOT duplicate; use supersedes_memory_id if refining ephemeral):\n"
        f"{existing_mem_str}\n\n"
        f"=== COMPLETED TURN EXCHANGE ===\n"
        f"{roll_str}"
        f"User Message:\n{completed_turn.user_message}\n\n"
        f"Narrative Prose (spoken/enacted primarily by {speaker_name}):\n{completed_turn.raw_prose}"
    )

    try:
        delta = await llm_client.complete_structured(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            CharacterAgentDelta,
            profile=clerk_prof,
            temperature=0.25,
        )
    except Exception as exc:
        if not settings.allow_offline_fallback:
            raise
        logger.warning(
            "Character State Agent for '%s' failed (%s); falling back to heuristic character delta.",
            character.name,
            exc,
        )
        delta = heuristic_character_agent_delta(
            character=character,
            prev_state=prev_state,
            completed_turn=completed_turn,
            active_location=active_location,
            neighbors=neighbors,
            present_characters=present_characters,
            extracted_memories_fn=extracted_memories_fn,
        )

    # Post-process invariants: 2-4 word mood, canonical stance keys, and strict self-scoped memory ownership
    delta.mood_label = normalize_mood_label(delta.mood_label, fallback=prev_state.mood_label)
    delta.stance_updates = normalize_stance_updates(
        delta.stance_updates,
        self_id=character.id,
        self_name=character.name,
        known_characters=all_participants,
    )
    for mem in delta.new_memories:
        mem.character_id = character.id

    return delta
