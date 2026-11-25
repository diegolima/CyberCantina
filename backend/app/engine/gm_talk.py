"""Out-of-character Neuromancer GM Talk engine: mention search, 3-layer spoiler gating, and hybrid RAG."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field

from app.config import settings
from app.db.repository import CantinaRepository
from app.engine.game_mechanics import (
    CARRYOVER_MATCH_MIN_SCORE,
    UMBRELLA_MECHANIC_ID,
    UMBRELLA_MECHANIC_LABEL,
    format_mechanics_article_prompt_block,
    format_mechanics_directory_block,
    get_mechanics_article,
    get_subcategory_map,
    has_inline_mechanics_trigger,
    list_mechanics_articles,
    search_mechanics_articles,
    wrap_game_mechanics_section,
)
from app.engine.parties import get_player_party
from app.prompts import DEFAULT_GM_TALK_SYSTEM, PROMPT_KEY_GM_TALK_SYSTEM, render_template
from app.schemas.character import CharacterRecord, CharacterStateSnapshot
from app.schemas.gm import (
    GmChatMessage,
    GmMentionCandidate,
    GmMentionCategory,
    GmMentionRef,
    GmSourceRef,
)
from typing import Any
from app.schemas.physical import format_physical_state_prompt_value
from app.schemas.turn import CampaignStateBundle, TurnNodeRecord
from app.schemas.world import (
    LocationContainer,
    LocationNode,
    LoreNode,
    format_distance_meters,
    format_exit_travel_phrase,
    is_edge_revealed,
    resolve_revealed_edge_pairs,
)
from app.security.log_sanitize import sanitize_log_value

logger = logging.getLogger("cybercantina.engine.gm_talk")

_REASONING_TAGS = ("think", "thought", "reasoning", "scratchpad")


def _estimate_tokens(text: str) -> int:
    """Fast heuristic token estimator (~4 chars per token)."""
    if not text:
        return 0
    return max(1, len(text) // 4)


def _collapse_inline(text: str, max_len: int = 120) -> str:
    """Collapse newlines/whitespace into a single bounded preview string."""
    cleaned = " ".join((text or "").replace("\r", " ").replace("\n", " ").split()).strip()
    if len(cleaned) <= max_len:
        return cleaned
    return cleaned[: max(1, max_len - 1)].rstrip() + "…"


def strip_reasoning_blocks(text: str) -> str:
    """Linearly strip `<think>`, `<thought>`, `<reasoning>`, and `<scratchpad>` blocks without ReDoS."""
    if not text:
        return ""
    out: list[str] = []
    lower = text.lower()
    idx = 0
    n = len(text)
    while idx < n:
        lt = lower.find("<", idx)
        if lt == -1:
            out.append(text[idx:])
            break
        matched_tag: str | None = None
        tag_end = -1
        for tag in _REASONING_TAGS:
            prefix = f"<{tag}"
            if lower.startswith(prefix, lt):
                after = lt + len(prefix)
                if after < n and lower[after] in (">", " ", "\t", "\n", "\r"):
                    close_gt = lower.find(">", after)
                    if close_gt != -1:
                        matched_tag = tag
                        tag_end = close_gt + 1
                        break
        if matched_tag is None:
            out.append(text[idx : lt + 1])
            idx = lt + 1
            continue
        out.append(text[idx:lt])
        close_token = f"</{matched_tag}>"
        close_pos = lower.find(close_token, tag_end)
        if close_pos == -1:
            # Unclosed wrapper tag: drop remaining reasoning text cleanly.
            break
        idx = close_pos + len(close_token)
    return "".join(out).strip()


class ReasoningTagStreamFilter:
    """Incremental linear filter stripping `<think>`/`<thought>`/`<reasoning>`/`<scratchpad>` during SSE streaming."""

    def __init__(self) -> None:
        self._buf = ""
        self._active_tag: str | None = None

    def feed(self, delta: str) -> str:
        """Consume a streamed chunk and return safe visible text."""
        if not delta:
            return ""
        self._buf += delta
        emitted: list[str] = []

        while self._buf:
            lower = self._buf.lower()
            if self._active_tag is not None:
                close_tok = f"</{self._active_tag}>"
                close_idx = lower.find(close_tok)
                if close_idx != -1:
                    self._buf = self._buf[close_idx + len(close_tok) :]
                    self._active_tag = None
                    continue
                # Keep trailing tail in case closing tag spans chunk boundary
                keep = len(close_tok)
                if len(self._buf) > keep:
                    self._buf = self._buf[-keep:]
                break

            lt = lower.find("<")
            if lt == -1:
                emitted.append(self._buf)
                self._buf = ""
                break
            if lt > 0:
                emitted.append(self._buf[:lt])
                self._buf = self._buf[lt:]
                lower = self._buf.lower()

            # Now self._buf starts with '<'. Check if it matches or could prefix a reasoning tag.
            maybe_prefix = False
            matched_tag: str | None = None
            open_end = -1
            for tag in _REASONING_TAGS:
                open_prefix = f"<{tag}"
                if len(self._buf) < len(open_prefix):
                    if open_prefix.startswith(lower):
                        maybe_prefix = True
                elif lower.startswith(open_prefix):
                    if len(self._buf) == len(open_prefix):
                        maybe_prefix = True
                    elif self._buf[len(open_prefix)] in (">", " ", "\t", "\n", "\r"):
                        gt = self._buf.find(">", len(open_prefix))
                        if gt == -1:
                            maybe_prefix = True
                        else:
                            matched_tag = tag
                            open_end = gt + 1
                            break

            if matched_tag is not None:
                self._active_tag = matched_tag
                self._buf = self._buf[open_end:]
                continue
            if maybe_prefix:
                break
            # Literal '<' that is not a reasoning tag
            emitted.append("<")
            self._buf = self._buf[1:]

        return "".join(emitted)

    def flush(self) -> str:
        """Flush remaining non-reasoning tail after stream ends."""
        if self._active_tag is not None:
            self._buf = ""
            return ""
        rest = self._buf
        self._buf = ""
        return rest


@dataclass
class _BranchVisibility:
    bundle: CampaignStateBundle
    valid_turn_ids: set[str]
    unlock_lore: bool
    revealed_lore_ids: set[str]
    revealed_edge_ids: set[str]
    revealed_edge_pairs: set[tuple[str, str]]
    visited_location_ids: set[str]
    visited_container_ids: set[str]
    active_container_ancestors: list[str]
    cont_by_id: dict[str, LocationContainer]
    loc_by_id: dict[str, LocationNode]
    turn_by_id: dict[str, TurnNodeRecord]


def _container_ancestors(
    start_container_id: str | None,
    cont_by_id: dict[str, LocationContainer],
) -> list[str]:
    """Return ancestor chain from outermost macro container down to immediate parent."""
    chain: list[str] = []
    seen: set[str] = set()
    curr = start_container_id
    while curr and curr in cont_by_id and curr not in seen:
        seen.add(curr)
        chain.append(curr)
        curr = cont_by_id[curr].parent_container_id
    chain.reverse()
    return chain


def _container_breadcrumb(
    container_id: str | None,
    cont_by_id: dict[str, LocationContainer],
) -> str:
    ancestors = _container_ancestors(container_id, cont_by_id)
    return " › ".join(cont_by_id[cid].name for cid in ancestors if cid in cont_by_id)


def _compute_branch_visibility(bundle: CampaignStateBundle) -> _BranchVisibility:
    snap = bundle.current_world_snapshot
    valid_turn_ids = {t.id for t in bundle.active_branch_turns}
    unlock_lore = bool(bundle.campaign.world_settings.unlock_lore)
    revealed_lore_ids = set(snap.revealed_lore_ids or [])
    revealed_edge_ids = set(snap.revealed_edge_ids or [])
    revealed_edge_pairs = resolve_revealed_edge_pairs(
        bundle.visible_edges, revealed_edge_ids
    )
    visited_location_ids = set(snap.visited_location_ids or []) | {bundle.active_location.id}
    cont_by_id = {c.id: c for c in bundle.containers}
    active_ancestors = _container_ancestors(bundle.active_location.container_id, cont_by_id)
    visited_container_ids = set(snap.visited_container_ids or []) | set(active_ancestors)
    loc_by_id = {loc.id: loc for loc in bundle.visible_locations}
    loc_by_id[bundle.active_location.id] = bundle.active_location
    turn_by_id = {t.id: t for t in bundle.active_branch_turns}
    return _BranchVisibility(
        bundle=bundle,
        valid_turn_ids=valid_turn_ids,
        unlock_lore=unlock_lore,
        revealed_lore_ids=revealed_lore_ids,
        revealed_edge_ids=revealed_edge_ids,
        revealed_edge_pairs=revealed_edge_pairs,
        visited_location_ids=visited_location_ids,
        visited_container_ids=visited_container_ids,
        active_container_ancestors=active_ancestors,
        cont_by_id=cont_by_id,
        loc_by_id=loc_by_id,
        turn_by_id=turn_by_id,
    )


def _visible_location_exits_for_gm(
    loc_id: str,
    vis: _BranchVisibility,
) -> list[dict[str, Any]]:
    """Return spoiler-gated outgoing connections from `loc_id` for GM Talk and GM Tools."""
    if not vis.unlock_lore and loc_id not in vis.visited_location_ids:
        return []
    exits: list[dict[str, Any]] = []
    for edge in vis.bundle.visible_edges:
        if edge.from_location_id != loc_id:
            continue
        revealed = is_edge_revealed(
            edge.id,
            edge.from_location_id,
            edge.to_location_id,
            vis.revealed_edge_ids,
            vis.revealed_edge_pairs,
        )
        if edge.is_secret and not revealed and not vis.unlock_lore:
            continue
        dest = vis.loc_by_id.get(edge.to_location_id)
        dest_name = dest.name if dest else edge.to_location_id
        entry: dict[str, Any] = {
            "edge_id": edge.id,
            "destination": dest_name,
            "direction_label": edge.direction_label,
            "compass_direction": edge.compass_direction,
            "distance": format_distance_meters(edge.distance_meters),
            "travel": format_exit_travel_phrase(
                edge.distance_meters, edge.speed_modifier, edge.travel_mode
            ),
            "speed_modifier": edge.speed_modifier,
            "travel_mode": edge.travel_mode,
            "obstacles": list(edge.obstacles),
            "is_blocked": bool(edge.is_blocked),
        }
        if edge.is_secret:
            entry["secret_status"] = (
                "Secret · Discovered" if revealed else "Secret · Hidden"
            )
        exits.append(entry)
    return exits


def _is_lore_visible(
    lore: LoreNode,
    vis: _BranchVisibility,
    *,
    owner_location_id: str | None = None,
    owner_container_id: str | None = None,
) -> bool:
    """Enforce `unlock_lore` gating across world, location, and L1 container lore."""
    if vis.unlock_lore:
        return True
    if lore.category == "secret" and lore.id not in vis.revealed_lore_ids:
        return False
    if owner_location_id and owner_location_id not in vis.visited_location_ids:
        return False
    if owner_container_id and owner_container_id not in vis.visited_container_ids:
        return False
    return True


def _collect_permitted_lore(
    vis: _BranchVisibility,
) -> list[tuple[LoreNode, str, str | None, str | None]]:
    """Return (LoreNode, scope_label, owner_location_id, owner_container_id) visible under unlock_lore."""
    out: list[tuple[LoreNode, str, str | None, str | None]] = []
    seen_ids: set[str] = set()

    for lore in vis.bundle.world_lore_nodes:
        if lore.id not in seen_ids and _is_lore_visible(lore, vis):
            seen_ids.add(lore.id)
            out.append((lore, "World Codex", None, None))

    for loc in vis.loc_by_id.values():
        for lore in loc.lore_nodes:
            if lore.id not in seen_ids and _is_lore_visible(lore, vis, owner_location_id=loc.id):
                seen_ids.add(lore.id)
                out.append((lore, loc.name, loc.id, None))

    for cont in vis.cont_by_id.values():
        for lore in cont.lore_nodes:
            if lore.id not in seen_ids and _is_lore_visible(lore, vis, owner_container_id=cont.id):
                seen_ids.add(lore.id)
                out.append((lore, cont.name, None, cont.id))

    return out


def _lore_badge(lore: LoreNode, scope_label: str, vis: _BranchVisibility) -> str:
    if lore.category == "secret":
        if lore.id in vis.revealed_lore_ids:
            return "Secret · Discovered"
        return "Secret · Hidden"
    return f"{scope_label} · {lore.category.title()}"


def _parse_turn_number_query(q: str) -> str | None:
    """Extract numeric turn query if user typed e.g. '2', 'turn 2', 'turn2', or 't2'."""
    cleaned = q.strip().lower()
    if not cleaned:
        return None
    if cleaned.isdigit():
        return cleaned
    for prefix in ("turn ", "turn", "t "):
        if cleaned.startswith(prefix):
            rest = cleaned[len(prefix) :].strip()
            if rest.isdigit():
                return rest
    if cleaned.startswith("t") and len(cleaned) > 1 and cleaned[1:].isdigit():
        return cleaned[1:]
    return None


def search_gm_mentions(
    repo: CantinaRepository,
    campaign_id: str,
    owner_id: str,
    *,
    category: GmMentionCategory | None = None,
    q: str = "",
    limit: int = 25,
) -> list[GmMentionCandidate]:
    """Return active-branch, spoiler-gated `@` mention candidates for GM Talk."""
    bundle = repo.get_campaign_state_bundle(campaign_id, owner_id=owner_id)
    vis = _compute_branch_visibility(bundle)
    ql = (q or "").strip().lower()
    turn_digits = _parse_turn_number_query(ql) if ql else None

    player_party = get_player_party(bundle.current_world_snapshot.parties or [])
    party_ids = set(player_party.member_ids) if player_party else set()
    present_ids = set(bundle.present_character_ids or [])

    scored: list[tuple[int, int, GmMentionCandidate, str]] = []
    seq = 0

    def _add(cand: GmMentionCandidate, extra_search: str = "", boost: int = 0) -> None:
        nonlocal seq
        seq += 1
        if category and cand.category != category:
            return
        if not ql:
            scored.append((100 + boost, seq, cand, extra_search))
            return
        lbl = cand.label.lower()
        hay = f"{lbl} {cand.subtitle.lower()} {cand.badge.lower()} {extra_search.lower()}"
        if ql in lbl:
            score = 10 if lbl.startswith(ql) else 25
            scored.append((score + boost, seq, cand, extra_search))
        elif ql in hay:
            scored.append((50 + boost, seq, cand, extra_search))

    # 1. Characters (Persona + Campaign NPCs)
    if category in (None, "characters"):
        persona = bundle.campaign.persona_snapshot
        if persona is not None:
            _add(
                GmMentionCandidate(
                    kind="persona",
                    category="characters",
                    id=persona.id,
                    label=persona.name,
                    subtitle=_collapse_inline(persona.tagline or persona.persona_bio or "Player Persona", 72),
                    badge="Persona",
                ),
                extra_search=" ".join(persona.tags),
                boost=-5,
            )
        for char in bundle.character_records.values():
            tags_bits: list[str] = []
            if char.id in party_ids:
                tags_bits.append("In Party")
            if char.id in present_ids:
                tags_bits.append("Present")
            badge = " · ".join(tags_bits) if tags_bits else "Campaign NPC"
            _add(
                GmMentionCandidate(
                    kind="character",
                    category="characters",
                    id=char.id,
                    label=char.name,
                    subtitle=_collapse_inline(char.tagline or char.core_persona, 72),
                    badge=badge,
                ),
                extra_search=" ".join(char.tags),
                boost=-3 if char.id in party_ids else (-1 if char.id in present_ids else 0),
            )

    # 2. Lore
    if category in (None, "lore"):
        for lore, scope_label, _loc_id, _cont_id in _collect_permitted_lore(vis):
            _add(
                GmMentionCandidate(
                    kind="lore",
                    category="lore",
                    id=lore.id,
                    label=lore.title,
                    subtitle=_collapse_inline(lore.content, 72),
                    badge=_lore_badge(lore, scope_label, vis),
                ),
                extra_search=" ".join(lore.entity_tags),
            )

    # 3. Locations
    if category in (None, "locations"):
        ordered_locs = sorted(
            vis.loc_by_id.values(),
            key=lambda l: (0 if l.id == bundle.active_location.id else (1 if l.is_visited else 2), l.name.lower()),
        )
        for loc in ordered_locs:
            if not vis.unlock_lore and loc.id not in vis.visited_location_ids:
                continue
            badge = (
                "Current"
                if loc.id == bundle.active_location.id
                else ("Visited" if loc.is_visited else "Unvisited")
            )
            _add(
                GmMentionCandidate(
                    kind="location",
                    category="locations",
                    id=loc.id,
                    label=loc.name,
                    subtitle=_collapse_inline(loc.summary or loc.description, 72),
                    badge=badge,
                ),
                extra_search=" ".join(loc.environmental_tags),
                boost=-2 if loc.id == bundle.active_location.id else 0,
            )

    # 4. Containers
    if category in (None, "containers"):
        ordered_conts = sorted(
            vis.cont_by_id.values(),
            key=lambda c: (0 if c.id in vis.active_container_ancestors else 1, c.depth, c.name.lower()),
        )
        for cont in ordered_conts:
            if not vis.unlock_lore and cont.id not in vis.visited_container_ids:
                continue
            crumb = _container_breadcrumb(cont.parent_container_id, vis.cont_by_id)
            subtitle = crumb if crumb else _collapse_inline(cont.description, 72)
            badge = "Current" if cont.id in vis.active_container_ancestors else f"L{cont.depth}"
            _add(
                GmMentionCandidate(
                    kind="container",
                    category="containers",
                    id=cont.id,
                    label=cont.name,
                    subtitle=subtitle,
                    badge=badge,
                ),
                extra_search=" ".join(cont.environmental_tags),
            )

    # 5. Turns (Reverse-chronological along active branch; NEVER include <cognition>)
    if category in (None, "turns"):
        for turn in reversed(bundle.active_branch_turns):
            turn_num = str(turn.depth_index)
            label = f"Turn {turn.depth_index}"
            preview_src = (
                turn.user_note
                or turn.user_message
                or turn.raw_prose
                or "Opening Scene"
            )
            subtitle = _collapse_inline(preview_src, 72)
            badge = "Bookmarked" if turn.is_bookmarked else (turn.world_snapshot.world_timestamp or "")
            if not ql:
                _add(
                    GmMentionCandidate(
                        kind="turn",
                        category="turns",
                        id=turn.id,
                        label=label,
                        subtitle=subtitle,
                        badge=badge,
                    )
                )
                continue

            if turn_digits is not None:
                if turn_num == turn_digits:
                    seq += 1
                    scored.append((1, seq, GmMentionCandidate(kind="turn", category="turns", id=turn.id, label=label, subtitle=subtitle, badge=badge), ""))
                    continue
                if turn_num.startswith(turn_digits):
                    seq += 1
                    scored.append((8, seq, GmMentionCandidate(kind="turn", category="turns", id=turn.id, label=label, subtitle=subtitle, badge=badge), ""))
                    continue

            _add(
                GmMentionCandidate(
                    kind="turn",
                    category="turns",
                    id=turn.id,
                    label=label,
                    subtitle=subtitle,
                    badge=badge,
                ),
                extra_search=f"{turn.user_message} {turn.raw_prose} {turn.user_note or ''}",
            )

    # 6. Game Mechanics (strictly scoped to @mechanics: category or `@mech...` global prefix)
    if category == "mechanics":
        subcat_map = get_subcategory_map()
        include_umbrella = not ql or ql in (
            "all",
            "any",
            "rule",
            "rules",
            "mech",
            "mecha",
            "mechan",
            "mechani",
            "mechanic",
            "mechanics",
        )
        if include_umbrella:
            seq += 1
            scored.append(
                (
                    0,
                    seq,
                    GmMentionCandidate(
                        kind="mechanic",
                        category="mechanics",
                        id=UMBRELLA_MECHANIC_ID,
                        label=UMBRELLA_MECHANIC_LABEL,
                        subtitle="Let Neuromancer search all CyberCantina game rules",
                        badge="All Rules",
                    ),
                    "",
                )
            )
        if not ql:
            for art in list_mechanics_articles():
                sub = subcat_map.get(art.subcategory_id)
                seq += 1
                scored.append(
                    (
                        100,
                        seq,
                        GmMentionCandidate(
                            kind="mechanic",
                            category="mechanics",
                            id=art.id,
                            label=art.title,
                            subtitle=_collapse_inline(art.in_one_line, 72),
                            badge=sub.short_label if sub else art.subcategory_id,
                        ),
                        "",
                    )
                )
        else:
            rank_by_id = {
                art.id: rank_score
                for rank_score, art in search_mechanics_articles(ql, limit=50, min_score=1)
            }
            for art in list_mechanics_articles():
                sub = subcat_map.get(art.subcategory_id)
                sub_short = sub.short_label if sub else art.subcategory_id
                sub_full = sub.label if sub else art.subcategory_id
                rank_score = rank_by_id.get(art.id, 0)
                if rank_score > 0:
                    sort_key = max(1, 100 - min(99, rank_score))
                else:
                    hay = (
                        f"{art.id} {art.title} {art.short_title or ''} "
                        f"{sub_full} {' '.join(art.keywords)} {art.in_one_line}"
                    ).lower()
                    if ql not in hay:
                        continue
                    sort_key = 120
                seq += 1
                scored.append(
                    (
                        sort_key,
                        seq,
                        GmMentionCandidate(
                            kind="mechanic",
                            category="mechanics",
                            id=art.id,
                            label=art.title,
                            subtitle=_collapse_inline(art.in_one_line, 72),
                            badge=sub_short,
                        ),
                        "",
                    )
                )
    elif category is None and ql and len(ql) >= 4 and "mechanics".startswith(ql):
        seq += 1
        scored.append(
            (
                5,
                seq,
                GmMentionCandidate(
                    kind="mechanic",
                    category="mechanics",
                    id=UMBRELLA_MECHANIC_ID,
                    label=UMBRELLA_MECHANIC_LABEL,
                    subtitle="Enable CyberCantina game rules lookup for this question",
                    badge="All Rules",
                ),
                "",
            )
        )

    scored.sort(key=lambda item: (item[0], item[1]))
    return [item[2] for item in scored[:limit]]


def _format_turn_prose_snippet(turn: TurnNodeRecord, *, include_cognition: bool, max_chars: int = 1200) -> str:
    loc_id = turn.world_snapshot.active_location_id
    user_part = (turn.user_message or "").strip() or "[Scene / Narrator Turn]"
    prose_part = (turn.raw_prose or "").strip()
    if len(prose_part) > max_chars:
        prose_part = prose_part[:max_chars].rstrip() + "…"
    lines = [f"[Turn {turn.depth_index} | Time: {turn.world_snapshot.world_timestamp} | LocID: {loc_id}]"]
    lines.append(f"Player: {user_part}")
    if prose_part:
        lines.append(f"Narrative: {prose_part}")
    if turn.user_note:
        lines.append(f"Player Note: {turn.user_note}")
    if include_cognition:
        cog_parts: list[str] = []
        if turn.cognitions:
            for cid, cog in turn.cognitions.items():
                cname = turn.cognition_character_names.get(cid, cid)
                cog_parts.append(f"{cname}: want='{cog.want}' feeling='{cog.feeling}'")
        elif turn.cognition and (turn.cognition.want or turn.cognition.feeling):
            cog_parts.append(f"want='{turn.cognition.want}' feeling='{turn.cognition.feeling}'")
        if cog_parts:
            lines.append("Cognition (GM Mode): " + " | ".join(cog_parts))
    return "\n".join(lines)


def _format_character_detail(
    char: CharacterRecord,
    state: CharacterStateSnapshot | None,
    *,
    vis: _BranchVisibility,
    detailed: bool,
) -> str:
    equipped = [it.name for it in (state.equipped if state else char.equipped)]
    inventory = [it.name for it in (state.inventory if state else char.inventory)]
    loc_id = state.current_location_id if state else None
    loc_name = vis.loc_by_id[loc_id].name if loc_id and loc_id in vis.loc_by_id else (loc_id or "Unknown")

    lines = [f"- {char.name} (id={char.id}): {char.tagline or char.core_persona[:140]}"]
    lines.append(f"  Location: {loc_name}")
    if state is not None:
        phys_str = format_physical_state_prompt_value(
            state.physical_stance, state.physical_context
        )
        if phys_str:
            lines.append(f"  Physical State: {phys_str}")
    if equipped:
        lines.append(f"  Equipped: {', '.join(equipped)}")
    if inventory:
        lines.append(f"  Inventory: {', '.join(inventory)}")
    if detailed:
        if char.physical_appearance:
            lines.append(f"  Appearance: {_collapse_inline(char.physical_appearance, 220)}")
        if char.core_persona:
            lines.append(f"  Public Persona Summary: {_collapse_inline(char.core_persona, 260)}")
    if vis.unlock_lore:
        lines.append(
            f"  [GM Mode] Core Drive: {char.baseline_psyche.core_drive} | "
            f"Core Fear: {char.baseline_psyche.core_fear}"
        )
        if state and state.mood_label:
            stances = ", ".join(state.relationship_notes.keys()) or "none"
            lines.append(
                f"  [GM Mode] Mood: {state.mood_label} | Want: {state.active_want} | Stances: {stances}"
            )
        if detailed and char.memory_shards:
            shards = "; ".join(f"{m.title}: {_collapse_inline(m.content, 120)}" for m in char.memory_shards[:4])
            lines.append(f"  [GM Mode] Memory Shards: {shards}")
    return "\n".join(lines)


def _serialize_pinned_mention(
    ref: GmMentionRef,
    vis: _BranchVisibility,
) -> tuple[str, GmSourceRef] | None:
    """Resolve and format an explicit `@` mention subject to active-branch + `unlock_lore` gating."""
    bundle = vis.bundle
    if ref.kind == "persona":
        persona = bundle.campaign.persona_snapshot
        if not persona or persona.id != ref.id:
            return None
        lines = [
            f"### Pinned Persona: {persona.name}",
            f"Species/Age/Pronouns: {persona.species or 'Human'} / {persona.age or 'unspecified'} / {persona.pronouns or 'unspecified'}",
            f"Tagline: {persona.tagline}",
            f"Bio: {persona.persona_bio}",
        ]
        player_turn_state = bundle.current_persona_turn_state
        if player_turn_state is not None:
            phys_str = format_physical_state_prompt_value(
                player_turn_state.physical_stance,
                player_turn_state.physical_context,
            )
            if phys_str:
                lines.append(f"Physical State: {phys_str}")
        if persona.equipped:
            lines.append("Equipped: " + ", ".join(it.name for it in persona.equipped))
        if persona.inventory:
            lines.append("Inventory: " + ", ".join(it.name for it in persona.inventory))
        if persona.lore_entries:
            lines.append(
                "Persona Lore: "
                + "; ".join(f"{le.title}: {le.content}" for le in persona.lore_entries)
            )
        return "\n".join(lines), GmSourceRef(kind="persona", id=persona.id, label=persona.name)

    if ref.kind == "character":
        char = bundle.character_records.get(ref.id)
        if not char:
            return None
        state = bundle.character_states.get(char.id)
        return (
            f"### Pinned Character: {char.name}\n" + _format_character_detail(char, state, vis=vis, detailed=True),
            GmSourceRef(kind="character", id=char.id, label=char.name),
        )

    if ref.kind == "location":
        loc = vis.loc_by_id.get(ref.id)
        if not loc:
            return None
        if not vis.unlock_lore and loc.id not in vis.visited_location_ids:
            return None
        lines = [
            f"### Pinned Location: {loc.name}",
            f"Summary: {loc.summary}",
            f"Description: {loc.description}",
        ]
        if loc.environmental_tags:
            lines.append("Tags: " + ", ".join(loc.environmental_tags))
        permitted_exits = _visible_location_exits_for_gm(loc.id, vis)
        if permitted_exits:
            exit_strs = []
            for ex in permitted_exits:
                tags = [ex["distance"], ex["travel"]]
                if ex["obstacles"]:
                    tags.append("obstacles: " + ", ".join(ex["obstacles"]))
                if ex["is_blocked"]:
                    tags.append("Blocked")
                if "secret_status" in ex:
                    tags.append(ex["secret_status"])
                exit_strs.append(
                    f"- [{ex['compass_direction'] or 'N'}] {ex['direction_label']} -> {ex['destination']} ({'; '.join(tags)})"
                )
            lines.append("Connections:\n" + "\n".join(exit_strs))
        permitted_loc_lore = [
            ln for ln in loc.lore_nodes if _is_lore_visible(ln, vis, owner_location_id=loc.id)
        ]
        if permitted_loc_lore:
            lines.append(
                "Local Lore:\n"
                + "\n".join(f"- [{ln.category}] {ln.title}: {ln.content}" for ln in permitted_loc_lore)
            )
        return "\n".join(lines), GmSourceRef(kind="location", id=loc.id, label=loc.name)

    if ref.kind == "container":
        cont = vis.cont_by_id.get(ref.id)
        if not cont:
            return None
        if not vis.unlock_lore and cont.id not in vis.visited_container_ids:
            return None
        crumb = _container_breadcrumb(cont.id, vis.cont_by_id)
        lines = [
            f"### Pinned Container (Level {cont.depth}): {crumb or cont.name}",
            f"Description: {cont.description}",
        ]
        if cont.environmental_tags:
            lines.append("Tags: " + ", ".join(cont.environmental_tags))
        permitted_cont_lore = [
            ln for ln in cont.lore_nodes if _is_lore_visible(ln, vis, owner_container_id=cont.id)
        ]
        if permitted_cont_lore:
            lines.append(
                "Container Lore:\n"
                + "\n".join(f"- [{ln.category}] {ln.title}: {ln.content}" for ln in permitted_cont_lore)
            )
        return "\n".join(lines), GmSourceRef(kind="container", id=cont.id, label=cont.name)

    if ref.kind == "lore":
        for lore, scope_label, _loc_id, _cont_id in _collect_permitted_lore(vis):
            if lore.id == ref.id:
                tags = ", ".join(lore.entity_tags)
                txt = (
                    f"### Pinned Lore: {lore.title} ({_lore_badge(lore, scope_label, vis)})\n"
                    f"Tags: {tags}\n"
                    f"Content: {lore.content}"
                )
                return txt, GmSourceRef(kind="lore", id=lore.id, label=lore.title)
        return None

    if ref.kind == "turn":
        turn = vis.turn_by_id.get(ref.id)
        if not turn:
            return None
        txt = f"### Pinned Turn {turn.depth_index}\n" + _format_turn_prose_snippet(
            turn, include_cognition=vis.unlock_lore, max_chars=2800
        )
        return txt, GmSourceRef(kind="turn", id=turn.id, label=f"Turn {turn.depth_index}")

    return None


@dataclass
class GmPreparedContext:
    """Prepared LLM message list, resolved prompt metadata, and attribution sources."""

    messages: list[dict[str, str]]
    unlock_lore: bool
    pinned_sources: list[GmSourceRef] = field(default_factory=list)
    retrieved_sources: list[GmSourceRef] = field(default_factory=list)
    all_sources: list[GmSourceRef] = field(default_factory=list)
    bundle: CampaignStateBundle | None = None
    mechanics_active: bool = False
    mechanics_explicit: bool = False
    mechanics_needs_non_tool_fallback: bool = False


def _has_recent_mechanic_carryover(prior_gm_messages: list[GmChatMessage]) -> bool:
    """Return True when the latest persisted GM reply cited at least one `mechanic` source."""
    for msg in reversed(prior_gm_messages):
        if msg.role == "assistant":
            return any(src.kind == "mechanic" for src in (msg.sources or []))
    return False


def _resolve_non_tool_mechanics_blocks(
    user_message: str,
    *,
    is_explicit: bool,
) -> tuple[list[str], list[GmSourceRef]]:
    """Deterministically match top 1-2 Game Mechanics articles for non-tool / fallback mode."""
    subcat_map = get_subcategory_map()
    min_score = 1 if is_explicit else CARRYOVER_MATCH_MIN_SCORE
    hits = search_mechanics_articles(user_message, limit=2, min_score=min_score)
    if hits:
        blocks: list[str] = []
        sources: list[GmSourceRef] = []
        for _, art in hits:
            sub = subcat_map.get(art.subcategory_id)
            sub_label = sub.label if sub else art.subcategory_id
            blocks.append(format_mechanics_article_prompt_block(art, sub_label))
            sources.append(GmSourceRef(kind="mechanic", id=art.id, label=art.title))
        return blocks, sources
    if is_explicit:
        return [format_mechanics_directory_block()], []
    return [], []


def apply_non_tool_mechanics_fallback(
    prep: GmPreparedContext,
    user_message: str,
) -> list[GmSourceRef]:
    """Inject deterministic `<game_mechanics>` context if tool calling failed or is unsupported."""
    if not prep.mechanics_needs_non_tool_fallback:
        return []
    blocks, new_sources = _resolve_non_tool_mechanics_blocks(
        user_message,
        is_explicit=prep.mechanics_explicit,
    )
    prep.mechanics_needs_non_tool_fallback = False
    if not blocks:
        return []

    if prep.messages and prep.messages[0].get("role") == "system":
        prep.messages[0] = {
            "role": "system",
            "content": f"{prep.messages[0]['content']}\n\n{wrap_game_mechanics_section(blocks)}",
        }

    existing_keys = {(s.kind, s.id) for s in prep.all_sources}
    added: list[GmSourceRef] = []
    for src in new_sources:
        key = (src.kind, src.id)
        if key in existing_keys:
            continue
        existing_keys.add(key)
        prep.retrieved_sources.append(src)
        prep.all_sources.append(src)
        added.append(src)
    return added


async def build_gm_context_and_messages(
    repo: CantinaRepository,
    *,
    campaign_id: str,
    owner_id: str,
    user_message: str,
    mentions: list[GmMentionRef],
    working_memory_turns: int,
    context_size: int,
    gm_max_tokens: int,
    resolved_prompts: dict[str, str],
    gm_tools_enabled: bool = False,
) -> GmPreparedContext:
    """Assemble spoiler-safe active-branch context, explicit `@` pins, and hybrid RAG for Neuromancer."""
    bundle = repo.get_campaign_state_bundle(campaign_id, owner_id=owner_id)
    vis = _compute_branch_visibility(bundle)
    world = repo.get_world(
        bundle.campaign.world_id,
        valid_turn_ids=vis.valid_turn_ids,
        campaign_id=campaign_id,
    )
    prior_gm_messages: list[GmChatMessage] = repo.list_gm_messages_for_branch(
        campaign_id, vis.valid_turn_ids
    )

    # 1. Pinned `@` Mentions (deduplicated, re-validated against active branch & unlock_lore)
    pinned_blocks: list[str] = []
    pinned_sources: list[GmSourceRef] = []
    seen_pin_keys: set[tuple[str, str]] = set()
    mechanics_blocks: list[str] = []
    pinned_mechanic_ids: set[str] = set()
    has_umbrella_trigger = False
    subcat_map = get_subcategory_map()

    for ref in mentions[:10]:
        key = (ref.kind, ref.id)
        if key in seen_pin_keys:
            continue
        seen_pin_keys.add(key)
        if ref.kind == "mechanic":
            if ref.id == UMBRELLA_MECHANIC_ID:
                has_umbrella_trigger = True
                continue
            art = get_mechanics_article(ref.id)
            if art is not None:
                sub = subcat_map.get(art.subcategory_id)
                sub_label = sub.label if sub else art.subcategory_id
                mechanics_blocks.append(format_mechanics_article_prompt_block(art, sub_label))
                pinned_mechanic_ids.add(art.id)
                pinned_sources.append(GmSourceRef(kind="mechanic", id=art.id, label=art.title))
            continue
        resolved_pin = _serialize_pinned_mention(ref, vis)
        if resolved_pin is not None:
            block_txt, src = resolved_pin
            pinned_blocks.append(block_txt)
            pinned_sources.append(src)

    if has_inline_mechanics_trigger(user_message):
        has_umbrella_trigger = True

    has_carryover = _has_recent_mechanic_carryover(prior_gm_messages)
    mechanics_explicit = bool(pinned_mechanic_ids) or has_umbrella_trigger
    mechanics_active = mechanics_explicit or has_carryover

    # Inline `@Turn N` fallback (e.g. from `/gm What happened in @Turn 2?` in the main composer)
    if len(seen_pin_keys) < 10:
        turn_by_depth = {t.depth_index: t for t in bundle.active_branch_turns}
        for match in re.finditer(r"@turn\s+(\d+)\b", user_message, re.IGNORECASE):
            if len(seen_pin_keys) >= 10:
                break
            depth = int(match.group(1))
            matched_turn = turn_by_depth.get(depth)
            if matched_turn and ("turn", matched_turn.id) not in seen_pin_keys:
                seen_pin_keys.add(("turn", matched_turn.id))
                resolved_pin = _serialize_pinned_mention(
                    GmMentionRef(kind="turn", id=matched_turn.id, label=f"Turn {depth}"),
                    vis,
                )
                if resolved_pin is not None:
                    block_txt, src = resolved_pin
                    pinned_blocks.append(block_txt)
                    pinned_sources.append(src)

    # 2. Pre-Turn Hybrid Lore & Episodic Retrieval (vector + keyword fallback, unlock_lore-gated)
    permitted_lore_entries = _collect_permitted_lore(vis)
    permitted_lore_by_id: dict[str, tuple[LoreNode, str]] = {
        lore.id: (lore, scope) for lore, scope, _lid, _cid in permitted_lore_entries
    }
    pinned_lore_ids = {s.id for s in pinned_sources if s.kind == "lore"}

    rag_query = user_message.strip()
    if len(rag_query) < 40 and prior_gm_messages:
        last_user = next((m.content for m in reversed(prior_gm_messages) if m.role == "user"), "")
        if last_user:
            rag_query = f"{last_user[:160]} {rag_query}"

    retrieved_blocks: list[str] = []
    retrieved_sources: list[GmSourceRef] = []
    retrieved_ids: set[str] = set()
    rag_tokens = 0
    rag_budget = 1200

    try:
        vec_hits = await repo.vector_store.search_memories(
            queries=[rag_query],
            mentioned_entities=[ref.label for ref in mentions],
            world_id=bundle.campaign.world_id,
            character_id="__gm_talk__",  # Never pulls private character_shard vectors
            campaign_id=campaign_id,
            valid_branch_turn_ids=vis.valid_turn_ids,
            top_k=8,
        )
    except Exception as exc:
        logger.debug("GM Talk vector lookup skipped for campaign '%s': %s", sanitize_log_value(campaign_id), sanitize_log_value(str(exc)))
        vec_hits = []

    for hit in vec_hits:
        if rag_tokens >= rag_budget:
            break
        if hit.source_type in ("lore", "location_lore", "container_lore"):
            if hit.id in pinned_lore_ids or hit.id in retrieved_ids:
                continue
            permitted = permitted_lore_by_id.get(hit.id)
            if permitted is None:
                continue
            lore, scope_label = permitted
            block = f"- [{_lore_badge(lore, scope_label, vis)}] {lore.title}: {lore.content}"
            tok = _estimate_tokens(block)
            if rag_tokens + tok <= rag_budget or not retrieved_blocks:
                retrieved_blocks.append(block)
                retrieved_sources.append(GmSourceRef(kind="lore", id=lore.id, label=lore.title))
                retrieved_ids.add(lore.id)
                rag_tokens += tok
        elif hit.source_type == "episodic_chunk":
            if hit.id in retrieved_ids:
                continue
            block = f"- [Episodic Recap] {hit.title}: {hit.content}"
            tok = _estimate_tokens(block)
            if rag_tokens + tok <= rag_budget or not retrieved_blocks:
                retrieved_blocks.append(block)
                retrieved_sources.append(GmSourceRef(kind="episodic", id=hit.id, label=hit.title or "Episode"))
                retrieved_ids.add(hit.id)
                rag_tokens += tok

    # Keyword / entity_tag fallback (ensures offline retrieval AND retrieves secret lore when unlock_lore=True)
    q_tokens = [tok for tok in rag_query.lower().replace("?", " ").replace(",", " ").split() if len(tok) >= 3]
    if q_tokens and rag_tokens < rag_budget:
        kw_matches: list[tuple[int, LoreNode, str]] = []
        for lore, scope_label in permitted_lore_by_id.values():
            if lore.id in pinned_lore_ids or lore.id in retrieved_ids:
                continue
            hay = f"{lore.title} {' '.join(lore.entity_tags)} {lore.content}".lower()
            hits_count = sum(1 for qt in q_tokens if qt in hay)
            if hits_count > 0:
                kw_matches.append((hits_count, lore, scope_label))
        kw_matches.sort(key=lambda item: (-item[0], item[1].title.lower()))
        for _score, lore, scope_label in kw_matches[:5]:
            block = f"- [{_lore_badge(lore, scope_label, vis)}] {lore.title}: {lore.content}"
            tok = _estimate_tokens(block)
            if rag_tokens + tok > rag_budget and retrieved_blocks:
                break
            retrieved_blocks.append(block)
            retrieved_sources.append(GmSourceRef(kind="lore", id=lore.id, label=lore.title))
            retrieved_ids.add(lore.id)
            rag_tokens += tok

    # 2b. Opt-In Game Mechanics Non-Tool Fallback (tools mode defers to `lookup_game_rules`)
    mechanics_needs_non_tool_fallback = False
    if mechanics_active and not pinned_mechanic_ids:
        if gm_tools_enabled:
            mechanics_needs_non_tool_fallback = True
        else:
            mech_blocks, mech_sources = _resolve_non_tool_mechanics_blocks(
                user_message,
                is_explicit=mechanics_explicit,
            )
            mechanics_blocks.extend(mech_blocks)
            retrieved_sources.extend(mech_sources)

    # 3. World, Scene, Party & Persona Default Context
    rules = world.global_rules
    snap = bundle.current_world_snapshot
    world_block = "\n".join(
        [
            f"World: {world.name} ({rules.genre} — {rules.tone})",
            f"Overview: {_collapse_inline(rules.setting_overview, 500)}",
            f"World Rules: {_collapse_inline(rules.tech_or_magic_rules, 400)}",
            f"Current In-Game Time: {snap.world_timestamp} (Elapsed: {snap.campaign_elapsed_minutes}m)",
            f"Active Branch Progress: {len(bundle.active_branch_turns)} turn(s), current leaf is Turn {bundle.active_branch_turns[-1].depth_index}",
        ]
    )

    active_cont_path = _container_breadcrumb(bundle.active_location.container_id, vis.cont_by_id)
    present_names = [
        bundle.character_records[cid].name
        for cid in bundle.present_character_ids
        if cid in bundle.character_records
    ]
    scene_lines = [
        f"Current Location: {bundle.active_location.name}",
        f"Container Path: {active_cont_path or 'None (Top-Level)'}",
        f"Description: {bundle.active_location.description}",
        f"Tags: {', '.join(bundle.active_location.environmental_tags) or 'none'}",
        f"Scene Flags: {', '.join(snap.scene_flags) or 'none'}",
        f"Present Characters: {', '.join(present_names) or 'none (player is alone)'}",
    ]
    scene_block = "\n".join(scene_lines)

    party_lines: list[str] = []
    persona = bundle.campaign.persona_snapshot
    if persona is not None:
        eq = ", ".join(it.name for it in persona.equipped) or "none"
        inv = ", ".join(it.name for it in persona.inventory) or "none"
        party_lines.append(
            f"Player Persona: {persona.name} — {persona.tagline}\n"
            f"  Bio: {_collapse_inline(persona.persona_bio, 300)}\n"
            f"  Equipped: {eq} | Inventory: {inv}"
        )
    else:
        party_lines.append("Player Persona: Standard unnamed protagonist")

    player_party = get_player_party(snap.parties or [])
    party_char_ids = [mid for mid in (player_party.member_ids if player_party else []) if mid != "user"]
    if party_char_ids:
        party_lines.append(f"Player's Party ({player_party.name if player_party else 'Party'}):")
        for cid in party_char_ids:
            char = bundle.character_records.get(cid)
            if char:
                party_lines.append(
                    _format_character_detail(char, bundle.character_states.get(cid), vis=vis, detailed=False)
                )
    else:
        party_lines.append("Player's Party: Traveling solo (no active party companions).")

    other_present = [cid for cid in bundle.present_character_ids if cid not in party_char_ids]
    if other_present:
        party_lines.append("Other Present Characters:")
        for cid in other_present:
            char = bundle.character_records.get(cid)
            if char:
                party_lines.append(
                    _format_character_detail(char, bundle.character_states.get(cid), vis=vis, detailed=False)
                )
    party_block = "\n".join(party_lines)

    # 4. Last N Verbatim Turns on Active Branch
    safe_ctx = max(2048, int(context_size or 8192))
    turns_budget = max(800, int(safe_ctx * 0.35))
    n_recent = max(1, int(working_memory_turns or 12))
    recent_slice = bundle.active_branch_turns[-n_recent:]
    turn_blocks_rev: list[str] = []
    turns_tok = 0
    for turn in reversed(recent_slice):
        txt = _format_turn_prose_snippet(turn, include_cognition=vis.unlock_lore)
        t_tok = _estimate_tokens(txt)
        if turns_tok + t_tok > turns_budget and turn_blocks_rev:
            break
        turn_blocks_rev.append(txt)
        turns_tok += t_tok
    recent_turns_block = "\n\n".join(reversed(turn_blocks_rev)) or "No turns recorded yet."

    # 5. Compose System Prompt
    if vis.unlock_lore:
        spoiler_policy = (
            "GM MODE ACTIVE (Unlock Lore & Secrets is ON): You have full access to hidden location/container "
            "secrets, unvisited locations, and private character cognition/motivations. Discuss them openly when helpful."
        )
    else:
        spoiler_policy = (
            "SPOILER-SAFE MODE ACTIVE (Unlock Lore & Secrets is OFF): You only see player-known lore, "
            "visited locations/containers, and discovered secrets. Never invent or guess hidden secrets or private NPC thoughts."
        )

    raw_tmpl = resolved_prompts.get(PROMPT_KEY_GM_TALK_SYSTEM) or DEFAULT_GM_TALK_SYSTEM
    try:
        rendered_role = render_template(
            raw_tmpl,
            world_name=world.name,
            spoiler_policy=spoiler_policy,
        )
    except Exception:
        rendered_role = render_template(
            DEFAULT_GM_TALK_SYSTEM,
            world_name=world.name,
            spoiler_policy=spoiler_policy,
        )

    context_sections = [
        rendered_role,
        f"<world>\n{world_block}\n</world>",
        f"<current_scene>\n{scene_block}\n</current_scene>",
        f"<party>\n{party_block}\n</party>",
        f"<recent_turns>\n{recent_turns_block}\n</recent_turns>",
    ]
    if pinned_blocks:
        context_sections.append("<referenced_entities>\n" + "\n\n".join(pinned_blocks) + "\n</referenced_entities>")
    if retrieved_blocks:
        context_sections.append("<retrieved_lore>\n" + "\n".join(retrieved_blocks) + "\n</retrieved_lore>")
    if mechanics_blocks:
        context_sections.append(wrap_game_mechanics_section(mechanics_blocks))

    system_content = "\n\n".join(context_sections)

    # 6. Trim prior GM chat history oldest-first to fit remaining context window
    avail_history_budget = max(256, safe_ctx - gm_max_tokens - _estimate_tokens(system_content) - _estimate_tokens(user_message) - 128)
    history_rev: list[dict[str, str]] = []
    hist_tok = 0
    for msg in reversed(prior_gm_messages):
        m_tok = _estimate_tokens(msg.content) + 12
        if hist_tok + m_tok > avail_history_budget:
            break
        history_rev.append({"role": msg.role, "content": msg.content})
        hist_tok += m_tok

    messages = [
        {"role": "system", "content": system_content},
        *reversed(history_rev),
        {"role": "user", "content": user_message},
    ]
    all_sources = [*pinned_sources, *retrieved_sources]
    return GmPreparedContext(
        messages=messages,
        unlock_lore=vis.unlock_lore,
        pinned_sources=pinned_sources,
        retrieved_sources=retrieved_sources,
        all_sources=all_sources,
        bundle=bundle,
        mechanics_active=mechanics_active,
        mechanics_explicit=mechanics_explicit,
        mechanics_needs_non_tool_fallback=mechanics_needs_non_tool_fallback,
    )


def build_offline_gm_reply(
    user_message: str,
    prep: GmPreparedContext,
) -> str:
    """Deterministic grounded fallback reply used when `allow_offline_fallback` is enabled."""
    bundle = prep.bundle
    loc_name = bundle.active_location.name if bundle else "Current Location"
    turn_count = len(bundle.active_branch_turns) if bundle else 0
    mode_label = "GM Mode (Secrets Unlocked)" if prep.unlock_lore else "Spoiler-Safe Mode"
    pins = ", ".join(s.label for s in prep.pinned_sources) or "none"
    retrieved = ", ".join(s.label for s in prep.retrieved_sources) or "none"
    return (
        f"**Neuromancer ({mode_label})**\n\n"
        f"- **Current Location:** {loc_name}\n"
        f"- **Active Branch Turns:** {turn_count}\n"
        f"- **Pinned References:** {pins}\n"
        f"- **Retrieved Lore:** {retrieved}\n\n"
        f"Offline fallback response to: _{_collapse_inline(user_message, 140)}_"
    )


def is_offline_fallback_enabled() -> bool:
    """Expose `settings.allow_offline_fallback` cleanly for GM routes."""
    return bool(settings.allow_offline_fallback)
