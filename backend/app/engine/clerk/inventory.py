"""Inventory item normalization, removal matching, merging, and heuristic item deltas."""

from __future__ import annotations

import re

from app.engine.character_agent import item_names_match_word_bounded
from app.schemas.character import ItemInstance
from collections.abc import Sequence

def _normalize_inventory_item(raw: str | ItemInstance) -> str:
    """Normalize an inventory item label by stripping state tags like '[Worn]' or '(worn)'."""
    raw_str = raw.name if isinstance(raw, ItemInstance) else str(raw)
    s = raw_str.strip().lower()
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


def _matches_inventory_removal(existing_item: str | ItemInstance, removal_queries: set[str]) -> bool:
    """Return True if existing_item matches any removal query by exact normalized name or whole-word token subset."""
    if not removal_queries:
        return False
    raw_str = existing_item.name if isinstance(existing_item, ItemInstance) else str(existing_item)
    ex_low = raw_str.strip().lower()
    ex_norm = _normalize_inventory_item(raw_str)
    if ex_low in removal_queries or ex_norm in removal_queries:
        return True
    for rem in removal_queries:
        if item_names_match_word_bounded(ex_norm, rem):
            return True
    return False


def merge_inventory(
    existing_inventory: list[str],
    added_items: list[str],
    removed_items: list[str] | None = None,
) -> list[str]:
    """Merge added and removed clothing/objects into existing_inventory with prefix/substring tolerance."""
    remove_queries: set[str] = set()
    for raw_rem in removed_items or []:
        cleaned = raw_rem.strip()
        if cleaned:
            remove_queries.add(cleaned.lower())
            norm = _normalize_inventory_item(cleaned)
            if norm:
                remove_queries.add(norm)

    additions: list[str] = []
    for raw in added_items:
        cleaned = raw.strip()
        if not cleaned:
            continue
        if cleaned.startswith("-") and len(cleaned) > 1:
            rem_val = cleaned[1:].strip()
            remove_queries.add(rem_val.lower())
            norm = _normalize_inventory_item(rem_val)
            if norm:
                remove_queries.add(norm)
        elif cleaned.startswith("+") and len(cleaned) > 1:
            additions.append(cleaned[1:].strip())
        else:
            additions.append(cleaned)

    addition_overrides: dict[str, str] = {}
    for item in additions:
        norm = _normalize_inventory_item(item)
        if norm:
            addition_overrides[norm] = item

    merged: list[str] = []
    seen_norm: set[str] = set()
    for existing in existing_inventory:
        ex_clean = existing.strip()
        if not ex_clean:
            continue
        if _matches_inventory_removal(ex_clean, remove_queries):
            continue
        ex_norm = _normalize_inventory_item(ex_clean)
        if not ex_norm or ex_norm in seen_norm:
            continue
        if ex_norm in addition_overrides:
            merged.append(addition_overrides[ex_norm])
        else:
            merged.append(ex_clean)
        seen_norm.add(ex_norm)

    for item in additions:
        item_norm = _normalize_inventory_item(item)
        if not item_norm or item_norm in seen_norm:
            continue
        if _matches_inventory_removal(item, remove_queries):
            continue
        merged.append(item)
        seen_norm.add(item_norm)

    return merged


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


def _extract_heuristic_inventory_delta(
    user_message: str,
    raw_prose: str,
    current_inventory: Sequence[str | ItemInstance] | None = None,
) -> tuple[list[str], list[str]]:
    """Extract deterministic inventory additions and removals when running without a live Clerk LLM."""
    combined = f"{user_message}\n{raw_prose}"
    combined_lower = combined.lower()
    inv_added: list[str] = []
    inv_removed: list[str] = []

    remove_cue = bool(
        re.search(
            r"\b(take off|takes off|took off|remove|removes|removed|shed|sheds|unfasten|unfastens|"
            r"strip off|strips off|drop|drops|dropped|hand over|hands over|give|gives|gave|toss|tosses|discard|discards)\b",
            combined_lower,
        )
    )
    if remove_cue and current_inventory:
        for item in current_inventory:
            if isinstance(item, ItemInstance) and "permanent" in item.flags:
                continue
            norm = _normalize_inventory_item(item)
            if not norm:
                continue
            item_label = item.name if isinstance(item, ItemInstance) else str(item)
            if norm in combined_lower:
                inv_removed.append(item_label)
                continue
            tokens = [
                w
                for w in re.findall(r"[a-z0-9]{4,}", norm)
                if w not in _GENERIC_ITEM_ADJECTIVES
            ]
            if any(re.search(rf"\b{re.escape(tok)}\b", combined_lower) for tok in tokens):
                inv_removed.append(item_label)

    wear_matches = re.finditer(
        r"\b(?:put on|puts on|pull on|pulls on|slip into|slips into|wear|wears|don|dons)\s+"
        r"(?:(?:an|a|the|my|her|his|their|your)\b\s*)?([a-z0-9][a-z0-9\s\-]{2,32}?)"
        r"(?=[.,;!?'\")\n]|$|\s+(?:and|before|while|to|over|under|as|from|in)\b)",
        combined,
        re.I,
    )
    for m in wear_matches:
        garment = m.group(1).strip()
        if len(garment) >= 3:
            inv_added.append(f"[Worn] {garment[0].upper() + garment[1:]}")

    acquire_matches = re.finditer(
        r"\b(?:pick up|picks up|pocket|pockets|grab|grabs|hand you|hands you|give you|gives you|"
        r"hand her|hands her|hand him|hands him|give her|gives her|give him|gives him)\s+"
        r"(?:(?:an|a|the|my|her|his|their|your)\b\s*)?([a-z0-9][a-z0-9\s\-]{2,32}?)"
        r"(?=[.,;!?'\")\n]|$|\s+(?:and|before|while|to|from|off|on|in|into|across)\b)",
        combined,
        re.I,
    )
    for m in acquire_matches:
        obj = m.group(1).strip()
        if len(obj) >= 3 and obj.lower() not in {"it", "them", "this", "that", "him", "her", "me", "you"}:
            inv_added.append(obj[0].upper() + obj[1:])

    return inv_added, inv_removed
