"""Permanent item locking, character inventory deltas, and contest arbitration."""

from __future__ import annotations

import re
import uuid

from app.config import (
    ModelProfile,
    settings,
)
from app.engine.llm_client import llm_client
from app.prompts import PROMPT_KEY_CLERK_ARBITRATION
from app.prompts.renderer import (
    get_default_prompt,
    render_template,
)
from app.schemas.character import (
    CharacterRecord,
    CharacterStateSnapshot,
    ItemInstance,
    coerce_item_list,
)
from app.schemas.turn import (
    ArbitrationRulingRecord,
    CharacterAgentDelta,
    DiceRollResult,
    InventoryArbitrationResult,
    PreTurnAnalysis,
    TurnNodeRecord,
)
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

from app.engine.char_agent.matching import (
    _GENERIC_ITEM_ADJECTIVES,
    _USER_ALIASES,
    clean_equipped_display_label,
    logger,
    match_best_item_instance,
    matches_inventory_query,
    normalize_inventory_item,
)

def enforce_permanent_item_locks(
    *,
    scene_characters: list[CharacterRecord],
    prev_states_by_char: dict[str, CharacterStateSnapshot],
    character_deltas: dict[str, CharacterAgentDelta],
) -> list[str]:
    """Veto Clerk removals on 'permanent' items and strip competing co-present NPC claims to prevent cloning."""
    chars_by_id = {c.id: c for c in scene_characters}
    audit_notes: list[str] = []

    for ch in scene_characters:
        prev_st = prev_states_by_char.get(ch.id)
        if prev_st is None:
            continue
        perm_items = [
            it
            for it in coerce_item_list([*prev_st.equipped, *prev_st.inventory])
            if "permanent" in it.flags
        ]
        if not perm_items:
            continue

        for perm in perm_items:
            perm_queries = {perm.name.strip().lower(), normalize_inventory_item(perm.name)}
            holder_delta = character_deltas.get(ch.id)
            if holder_delta is not None:
                kept_rem: list[str] = []
                vetoed_rem = False
                for r in holder_delta.items_removed:
                    rc = r.strip().lstrip("-").strip()
                    if rc and matches_inventory_query(rc, perm_queries):
                        vetoed_rem = True
                    else:
                        kept_rem.append(r)
                holder_delta.items_removed = kept_rem

                # Also strip "-item" prefixed removal shorthands on items_equipped / items_obtained
                def _filter_neg_shorthand(
                    entries: list[str], queries: set[str] = perm_queries
                ) -> tuple[list[str], bool]:
                    out: list[str] = []
                    hit = False
                    for ent in entries:
                        ec = ent.strip()
                        if ec.startswith("-") and len(ec) > 1 and matches_inventory_query(ec[1:].strip(), queries):
                            hit = True
                        else:
                            out.append(ent)
                    return out, hit

                holder_delta.items_equipped, hit_eq = _filter_neg_shorthand(holder_delta.items_equipped)
                holder_delta.items_obtained, hit_ob = _filter_neg_shorthand(holder_delta.items_obtained)
                if vetoed_rem or hit_eq or hit_ob:
                    audit_notes.append(
                        f"[{perm.name}] Permanent flag protected custody on {ch.name} (Clerk removal vetoed)."
                    )

            # Strip competing acquisition claims on all other co-present characters to prevent cloning
            for other_id, other_delta in character_deltas.items():
                if other_id == ch.id:
                    continue
                other_prev = prev_states_by_char.get(other_id)
                other_already_has = other_prev is not None and any(
                    x.id == perm.id or normalize_inventory_item(x.name) == normalize_inventory_item(perm.name)
                    for x in coerce_item_list([*other_prev.equipped, *other_prev.inventory])
                )
                if other_already_has:
                    continue
                orig_eq_len = len(other_delta.items_equipped)
                orig_ob_len = len(other_delta.items_obtained)
                other_delta.items_equipped = [
                    it
                    for it in other_delta.items_equipped
                    if it.strip().startswith("-") or not matches_inventory_query(it, perm_queries)
                ]
                other_delta.items_obtained = [
                    it
                    for it in other_delta.items_obtained
                    if it.strip().startswith("-") or not matches_inventory_query(it, perm_queries)
                ]
                if len(other_delta.items_equipped) < orig_eq_len or len(other_delta.items_obtained) < orig_ob_len:
                    other_name = chars_by_id[other_id].name if other_id in chars_by_id else other_id
                    audit_notes.append(
                        f"[{perm.name}] Permanent flag on {ch.name} blocked competing claim by {other_name} (cloning prevented)."
                    )

    return audit_notes


def collect_relinquished_item_instances(
    *,
    scene_characters: list[CharacterRecord],
    prev_states_by_char: dict[str, CharacterStateSnapshot],
    character_deltas: dict[str, CharacterAgentDelta],
) -> list[tuple[str, ItemInstance]]:
    """Collect non-permanent ItemInstances being removed this turn so recipients preserve metadata/lore_id."""
    donated: list[tuple[str, ItemInstance]] = []
    for ch in scene_characters:
        prev_st = prev_states_by_char.get(ch.id)
        delta = character_deltas.get(ch.id)
        if prev_st is None or delta is None:
            continue
        rem_queries: set[str] = set()
        for raw in delta.items_removed:
            c = raw.strip().lstrip("-").strip()
            if c:
                rem_queries.add(c.lower())
                norm = normalize_inventory_item(c)
                if norm:
                    rem_queries.add(norm)
        for raw in [*delta.items_equipped, *delta.items_obtained]:
            c = raw.strip()
            if c.startswith("-") and len(c) > 1:
                rem = c[1:].strip()
                rem_queries.add(rem.lower())
                norm = normalize_inventory_item(rem)
                if norm:
                    rem_queries.add(norm)
        if not rem_queries:
            continue
        for inst in coerce_item_list([*prev_st.equipped, *prev_st.inventory]):
            if "permanent" in inst.flags:
                continue
            if matches_inventory_query(inst.name, rem_queries):
                donated.append((ch.id, inst))
    return donated


def _consume_donated_instance(
    donor_pool: list[tuple[str, ItemInstance]] | None,
    *,
    recipient_id: str | None,
    raw_label: str,
) -> ItemInstance | None:
    if not donor_pool:
        return None
    eligible_indices = [
        i
        for i, (donor_id, _inst) in enumerate(donor_pool)
        if recipient_id is None or donor_id != recipient_id
    ]
    if not eligible_indices:
        return None
    eligible_items = [donor_pool[i][1] for i in eligible_indices]
    best_rel = match_best_item_instance(eligible_items, raw_label)
    if best_rel is None:
        return None
    pool_idx = eligible_indices[best_rel]
    _, matched_inst = donor_pool.pop(pool_idx)
    return matched_inst


def apply_character_inventory_delta(
    *,
    existing_equipped: Sequence[ItemInstance | str],
    existing_inventory: Sequence[ItemInstance | str],
    delta: CharacterAgentDelta,
    donor_pool: list[tuple[str, ItemInstance]] | None = None,
    recipient_id: str | None = None,
) -> tuple[list[ItemInstance], list[ItemInstance]]:
    """Apply 4-bucket item transitions while preserving ItemInstance metadata and permanent locks."""
    eq_pool = coerce_item_list(list(existing_equipped))
    inv_pool = coerce_item_list(list(existing_inventory))

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
    new_equipped: list[ItemInstance] = []
    seen_equipped_norm: set[str] = set()
    stowed_items: list[ItemInstance] = []

    for inst in eq_pool:
        clean_name = clean_equipped_display_label(inst.name) or inst.name.strip()
        if not clean_name:
            continue
        is_perm = "permanent" in inst.flags
        if not is_perm and matches_inventory_query(clean_name, remove_queries):
            continue
        norm = normalize_inventory_item(clean_name)
        if not norm or norm in seen_equipped_norm:
            continue
        inst_clean = inst.model_copy(update={"name": clean_name[:160]})
        if (
            matches_inventory_query(clean_name, unequip_queries)
            and not matches_inventory_query(clean_name, equip_add_norms)
        ):
            stowed_items.append(inst_clean)
            continue
        new_equipped.append(inst_clean)
        seen_equipped_norm.add(norm)

    # 2. Add newly equipped items (drawing intact ItemInstances from carried inventory or donor_pool first)
    remaining_inv = list(inv_pool)
    for raw_label in equip_additions:
        norm = normalize_inventory_item(raw_label)
        if not norm or norm in seen_equipped_norm:
            continue
        matched_inv_idx = match_best_item_instance(remaining_inv, raw_label)
        if matched_inv_idx is not None:
            drawn = remaining_inv.pop(matched_inv_idx)
            if "permanent" not in drawn.flags and matches_inventory_query(drawn.name, remove_queries):
                continue
            cleaned_drawn_name = clean_equipped_display_label(drawn.name) or drawn.name
            preferred_name = (
                raw_label if len(raw_label) >= len(cleaned_drawn_name) else cleaned_drawn_name
            )
            equipped_inst = drawn.model_copy(update={"name": preferred_name[:160]})
        else:
            if matches_inventory_query(raw_label, remove_queries):
                continue
            donated_inst = _consume_donated_instance(
                donor_pool, recipient_id=recipient_id, raw_label=raw_label
            )
            if donated_inst is not None:
                cleaned_donated = clean_equipped_display_label(donated_inst.name) or donated_inst.name
                preferred_name = (
                    cleaned_donated if len(cleaned_donated) >= len(raw_label) else raw_label
                )
                equipped_inst = donated_inst.model_copy(update={"name": preferred_name[:160]})
            else:
                equipped_inst = ItemInstance(name=raw_label[:160])

        eff_norm = normalize_inventory_item(equipped_inst.name)
        if eff_norm and eff_norm not in seen_equipped_norm:
            new_equipped.append(equipped_inst)
            seen_equipped_norm.add(eff_norm)

    # 3. Filter remaining carried inventory (excluding items removed or newly drawn into equipped)
    new_inventory: list[ItemInstance] = []
    seen_inv_norm: set[str] = set()

    for inst in remaining_inv:
        clean_name = inst.name.strip()
        if not clean_name:
            continue
        is_perm = "permanent" in inst.flags
        if not is_perm and matches_inventory_query(clean_name, remove_queries):
            continue
        norm = normalize_inventory_item(clean_name)
        if not norm or norm in seen_inv_norm or norm in seen_equipped_norm:
            continue
        new_inventory.append(inst.model_copy(update={"name": clean_name[:160]}))
        seen_inv_norm.add(norm)

    # 4. Append stowed items and newly obtained items into carried inventory
    for stowed in stowed_items:
        norm = normalize_inventory_item(stowed.name)
        if not norm or norm in seen_inv_norm or norm in seen_equipped_norm:
            continue
        new_inventory.append(stowed)
        seen_inv_norm.add(norm)

    for raw_carried in carried_additions:
        clean = raw_carried.strip()
        if not clean:
            continue
        norm = normalize_inventory_item(clean)
        if not norm or norm in seen_inv_norm or norm in seen_equipped_norm:
            continue
        if matches_inventory_query(clean, remove_queries):
            continue
        donated_inst = _consume_donated_instance(
            donor_pool, recipient_id=recipient_id, raw_label=clean
        )
        if donated_inst is not None:
            preferred_name = (
                donated_inst.name if len(donated_inst.name) >= len(clean) else clean
            )
            carried_inst = donated_inst.model_copy(update={"name": preferred_name[:160]})
        else:
            carried_inst = ItemInstance(name=clean[:160])

        eff_norm = normalize_inventory_item(carried_inst.name)
        if eff_norm and eff_norm not in seen_inv_norm and eff_norm not in seen_equipped_norm:
            new_inventory.append(carried_inst)
            seen_inv_norm.add(eff_norm)

    # Ensure intra-character ID uniqueness across equipped + inventory
    seen_ids: set[str] = set()
    for bucket in (new_equipped, new_inventory):
        for i, it in enumerate(bucket):
            if it.id in seen_ids:
                bucket[i] = it.model_copy(update={"id": f"{it.id}_{uuid.uuid4().hex[:6]}"})
            seen_ids.add(bucket[i].id)

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
                held_name = held.name if isinstance(held, ItemInstance) else str(held)
                unrelinquished_holder_by_norm[h_norm] = (ch.id, held_name)

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


def resolve_roll_for_character(
    pre_turn: PreTurnAnalysis,
    character_id: str,
) -> DiceRollResult | None:
    """Lookup character's specific roll, falling back to resolved_roll only on legacy turns."""
    if pre_turn.character_rolls and character_id in pre_turn.character_rolls:
        return pre_turn.character_rolls[character_id]
    if pre_turn.resolved_roll is not None and pre_turn.resolved_roll.character_id in (None, character_id):
        return pre_turn.resolved_roll
    return None


def _heuristic_arbitrate_case(
    case: ContestedItemCase,
    *,
    completed_turn: TurnNodeRecord,
    chars_by_id: dict[str, CharacterRecord],
) -> tuple[str, str]:
    """Deterministic fallback referee when offline: inspect roll outcome and prose custody cues."""
    # Check claimants' individual rolls
    failed_claimants: set[str] = set()
    for cid in case.claimant_ids:
        c_roll = resolve_roll_for_character(completed_turn.pre_turn, cid)
        if c_roll is not None and "Failure" in c_roll.outcome_tier:
            failed_claimants.add(cid)

    if (
        case.reason == "unrelinquished_transfer"
        and case.prior_holder_id
        and case.prior_holder_id in chars_by_id
    ):
        active_takers = [cid for cid in case.claimant_ids if cid != case.prior_holder_id]
        if active_takers and all(cid in failed_claimants for cid in active_takers):
            holder_name = chars_by_id[case.prior_holder_id].name
            return (
                case.prior_holder_id,
                f"Check resulted in failure; {holder_name} retained custody of {case.display_name}.",
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

    roll_info_lines = []
    if completed_turn.pre_turn.character_rolls:
        for cid, r in completed_turn.pre_turn.character_rolls.items():
            name = chars_by_id[cid].name if cid in chars_by_id else cid
            roll_info_lines.append(f"{name}: {r.action_description} -> {r.outcome_tier} (rolled {r.total} vs DC {r.difficulty_class})")
    elif completed_turn.pre_turn.resolved_roll is not None:
        r = completed_turn.pre_turn.resolved_roll
        roll_info_lines.append(f"{r.action_description} -> {r.outcome_tier} (rolled {r.total} vs DC {r.difficulty_class})")
    roll_info = "\n".join(roll_info_lines) if roll_info_lines else "None"

    user_prompt = (
        "Contested Items:\n" + "\n".join(dispute_lines) + "\n\n"
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
