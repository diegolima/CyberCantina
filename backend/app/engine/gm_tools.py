"""Spoiler-gated read-only campaign tools, World Codex proposal tool, and bounded GM tool loop."""

from __future__ import annotations

import json
import logging
import uuid
from collections.abc import AsyncIterator
from typing import Any

from app.config import ModelProfile
from app.db.repos.base import utc_now_iso
from app.db.repository import CantinaRepository
from app.engine.gm_codex import find_world_codex_duplicates
from app.engine.gm_talk import (
    GmPreparedContext,
    _BranchVisibility,
    _collapse_inline,
    _compute_branch_visibility,
    _container_breadcrumb,
    _format_character_detail,
    _format_turn_prose_snippet,
    _is_lore_visible,
    strip_reasoning_blocks,
)
from app.engine.llm_client import ToolsUnsupportedError, llm_client
from app.providers.local_relay import RelayRemoteError, RelayUnavailableError
from app.schemas.gm import (
    GmCodexProposal,
    GmSourceRef,
    GmWorldLoreDraftLLMOutput,
)
from app.schemas.llm_tools import LlmToolCall, LlmToolDefinition
from app.schemas.turn import CampaignStateBundle
from app.schemas.world import WORLD_LORE_CATEGORIES, WorldLoreNodeDraft
from app.security.log_sanitize import sanitize_log_value

logger = logging.getLogger("cybercantina.engine.gm_tools")

MAX_GM_TOOL_ROUNDS = 4
MAX_GM_TOOL_CALLS_PER_TURN = 6
MAX_GM_PROPOSALS_PER_TURN = 3

GM_TOOLS_SYSTEM_ADDENDUM = (
    "=== AGENTIC TOOLS POLICY ===\n"
    "- You have read-only lookup tools (`search_world_codex`, `get_world_codex_entry`, `search_campaign_turns`, "
    "`get_campaign_turns`, `get_campaign_entity`) to inspect earlier turns, Codex entries, or entities not shown in recent context.\n"
    "- You also have `propose_world_lore_entry`, which presents an editable confirmation card to the player (it does NOT save automatically).\n"
    "- Call `search_world_codex` before proposing a new Codex entry so you avoid duplicates.\n"
    "- ONLY call `propose_world_lore_entry` when the player explicitly asks to add, save, create, draft, or update a World Codex entry. "
    "Do NOT call it for exploratory questions (e.g., 'What would be a reasonable entry to add?').\n"
    "- Never write OOC turn numbers inside `content` (use `source_turns` instead). After calling `propose_world_lore_entry`, "
    "tell the player the draft is ready for review and confirmation—never claim it is already saved."
)

GM_TOOL_DEFINITIONS: list[LlmToolDefinition] = [
    LlmToolDefinition(
        name="search_world_codex",
        description=(
            "Search active-branch World Codex entries by keyword, tag, or category. "
            "Use this to check existing canon and avoid duplicate Codex proposals."
        ),
        parameters={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Keywords, entity name, or topic to search."},
                "category": {
                    "type": "string",
                    "enum": list(WORLD_LORE_CATEGORIES),
                    "description": "Optional World Codex category filter.",
                },
                "limit": {"type": "integer", "minimum": 1, "maximum": 12, "default": 8},
            },
            "required": ["query"],
        },
    ),
    LlmToolDefinition(
        name="get_world_codex_entry",
        description="Read the full text and tags of a single World Codex entry by ID or title.",
        parameters={
            "type": "object",
            "properties": {
                "lore_id": {"type": "string", "description": "Exact LoreNode ID if known."},
                "title": {"type": "string", "description": "Exact or partial World Codex entry title."},
            },
        },
    ),
    LlmToolDefinition(
        name="search_campaign_turns",
        description=(
            "Search earlier turns along the active timeline branch by keywords. "
            "Useful when looking up past encounters or details older than working memory."
        ),
        parameters={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Keywords or names to find in past turns."},
                "limit": {"type": "integer", "minimum": 1, "maximum": 8, "default": 5},
            },
            "required": ["query"],
        },
    ),
    LlmToolDefinition(
        name="get_campaign_turns",
        description="Read verbatim active-branch turn records across an inclusive turn-number range (max 6 turns per call).",
        parameters={
            "type": "object",
            "properties": {
                "start_turn": {"type": "integer", "minimum": 0, "description": "Starting branch turn number."},
                "end_turn": {"type": "integer", "minimum": 0, "description": "Ending branch turn number (inclusive)."},
            },
            "required": ["start_turn", "end_turn"],
        },
    ),
    LlmToolDefinition(
        name="get_campaign_entity",
        description="Look up permitted details of a campaign character, player persona, visited location, or visited container.",
        parameters={
            "type": "object",
            "properties": {
                "kind": {
                    "type": "string",
                    "enum": ["character", "persona", "location", "container"],
                    "description": "Entity kind to inspect.",
                },
                "query": {"type": "string", "description": "Entity name or ID."},
            },
            "required": ["kind", "query"],
        },
    ),
    LlmToolDefinition(
        name="propose_world_lore_entry",
        description=(
            "Present a tentative World Codex entry card for the player to edit, confirm, or cancel. "
            "Call ONLY on explicit player request to add/save/create/draft/update a Codex entry."
        ),
        parameters={
            "type": "object",
            "properties": {
                "category": {
                    "type": "string",
                    "enum": list(WORLD_LORE_CATEGORIES),
                    "description": "World Codex category (enemies/hazards -> 'threat', notable NPCs -> 'figure', devices/items -> 'artifact').",
                },
                "title": {"type": "string", "description": "Concise in-universe Codex title (<= 120 chars)."},
                "entity_tags": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "3 to 8 concise retrieval keywords.",
                },
                "content": {
                    "type": "string",
                    "description": "Concise in-universe encyclopedia prose (<= 2000 chars). Do NOT include OOC turn citations.",
                },
                "source_turns": {
                    "type": "array",
                    "items": {"type": "integer"},
                    "description": "Optional supporting turn numbers for UI provenance only.",
                },
                "replace_lore_id": {
                    "type": "string",
                    "description": "Optional existing World Codex entry ID when updating an existing entry.",
                },
            },
            "required": ["category", "title", "entity_tags", "content"],
        },
    ),
]


def describe_gm_tool_status(tool_name: str, args: dict[str, Any] | None = None) -> str:
    """Return a concise, human-readable status label for SSE `tool_status` events."""
    a = args or {}
    if tool_name == "search_world_codex":
        return "Searching World Codex…"
    if tool_name == "get_world_codex_entry":
        return "Reading Codex entry…"
    if tool_name == "search_campaign_turns":
        return "Searching campaign turns…"
    if tool_name == "get_campaign_turns":
        try:
            lo = int(a.get("start_turn", 0))
            hi = int(a.get("end_turn", lo))
            if hi < lo:
                lo, hi = hi, lo
            return f"Checking Turn {lo}…" if lo == hi else f"Checking Turns {lo}–{hi}…"
        except (TypeError, ValueError):
            return "Checking campaign turns…"
    if tool_name == "get_campaign_entity":
        return "Inspecting campaign records…"
    if tool_name == "propose_world_lore_entry":
        return "Preparing World Codex proposal…"
    return "Running GM lookup…"


def _is_base_world_node(lore_id: str, campaign_id: str | None, origin_lore_id: str | None, base_ids: set[str]) -> bool:
    return (
        campaign_id is None
        or lore_id in base_ids
        or (origin_lore_id is not None and origin_lore_id in base_ids)
    )


async def execute_gm_tool(
    repo: CantinaRepository,
    *,
    bundle: CampaignStateBundle,
    vis: _BranchVisibility,
    base_world_ids: set[str],
    call: LlmToolCall,
    emitted_proposals: list[GmCodexProposal],
) -> tuple[dict[str, Any], list[GmSourceRef], GmCodexProposal | None]:
    """Execute one GM tool strictly against the active branch and `unlock_lore` spoiler rules."""
    name = call.name
    args = call.arguments or {}
    sources: list[GmSourceRef] = []
    visible_world_nodes = [
        ln for ln in bundle.world_lore_nodes if _is_lore_visible(ln, vis)
    ]

    if name == "search_world_codex":
        query = str(args.get("query") or "").strip()
        cat_filter = str(args.get("category") or "").strip().lower() or None
        try:
            limit = max(1, min(12, int(args.get("limit") or 8)))
        except (TypeError, ValueError):
            limit = 8

        q_tokens = [tok for tok in query.lower().split() if len(tok) >= 2]
        world_nodes_by_id = {ln.id: ln for ln in visible_world_nodes}
        scored: dict[str, tuple[int, Any]] = {}

        for ln in visible_world_nodes:
            if cat_filter and ln.category != cat_filter:
                continue
            title_low = ln.title.lower()
            tags_low = " ".join(ln.entity_tags).lower()
            content_low = ln.content.lower()
            score = 0
            if query and query.lower() in title_low:
                score += 10
            for tok in q_tokens:
                if tok in title_low:
                    score += 4
                if tok in tags_low:
                    score += 3
                if tok in content_low:
                    score += 1
            if not query or score > 0:
                scored[ln.id] = (score, ln)

        if query:
            try:
                vec_hits = await repo.vector_store.search_memories(
                    queries=[query],
                    mentioned_entities=q_tokens[:5],
                    world_id=bundle.campaign.world_id,
                    character_id="__gm_talk__",
                    campaign_id=bundle.campaign.id,
                    valid_branch_turn_ids=vis.valid_turn_ids,
                    top_k=limit,
                )
                for hit in vec_hits:
                    if hit.source_type != "lore" or hit.id not in world_nodes_by_id:
                        continue
                    ln = world_nodes_by_id[hit.id]
                    if cat_filter and ln.category != cat_filter:
                        continue
                    prev_score = scored.get(ln.id, (0, ln))[0]
                    scored[ln.id] = (prev_score + 5, ln)
            except Exception:
                pass

        ranked = sorted(scored.values(), key=lambda item: (-item[0], item[1].title.lower()))[:limit]
        results = []
        for _, ln in ranked:
            is_base = _is_base_world_node(ln.id, ln.campaign_id, ln.origin_lore_id, base_world_ids)
            results.append(
                {
                    "id": ln.id,
                    "title": ln.title,
                    "category": ln.category,
                    "entity_tags": list(ln.entity_tags),
                    "snippet": _collapse_inline(ln.content, 220),
                    "is_base_world": is_base,
                }
            )
            sources.append(GmSourceRef(kind="lore", id=ln.id, label=ln.title))
        return {"entries": results, "total_world_codex": len(visible_world_nodes)}, sources, None

    if name == "get_world_codex_entry":
        lore_id = str(args.get("lore_id") or "").strip()
        title = str(args.get("title") or "").strip()
        target = None
        if lore_id:
            target = next((ln for ln in visible_world_nodes if ln.id == lore_id), None)
        if target is None and title:
            title_low = title.lower()
            target = next((ln for ln in visible_world_nodes if ln.title.lower() == title_low), None)
            if target is None:
                target = next((ln for ln in visible_world_nodes if title_low in ln.title.lower()), None)
        if target is None:
            return {"error": "World Codex entry not found."}, sources, None
        sources.append(GmSourceRef(kind="lore", id=target.id, label=target.title))
        return (
            {
                "id": target.id,
                "title": target.title,
                "category": target.category,
                "entity_tags": list(target.entity_tags),
                "content": target.content,
                "is_base_world": _is_base_world_node(
                    target.id, target.campaign_id, target.origin_lore_id, base_world_ids
                ),
            },
            sources,
            None,
        )

    if name == "search_campaign_turns":
        query = str(args.get("query") or "").strip()
        try:
            limit = max(1, min(8, int(args.get("limit") or 5)))
        except (TypeError, ValueError):
            limit = 5
        q_tokens = [tok for tok in query.lower().split() if len(tok) >= 2]
        matches: list[tuple[int, Any]] = []
        for turn in bundle.active_branch_turns:
            parts = [turn.user_message or "", turn.raw_prose or "", turn.user_note or ""]
            if vis.unlock_lore:
                if turn.cognitions:
                    parts.extend(f"{c.want} {c.feeling} {c.recall}" for c in turn.cognitions.values())
                elif turn.cognition:
                    parts.append(f"{turn.cognition.want} {turn.cognition.feeling} {turn.cognition.recall}")
            hay = " ".join(parts).lower()
            score = sum(1 for tok in q_tokens if tok in hay)
            if query and query.lower() in hay:
                score += 4
            if not query or score > 0:
                matches.append((score, turn))
        matches.sort(key=lambda item: (-item[0], -item[1].depth_index))
        turns_out = []
        for _, turn in matches[:limit]:
            loc_obj = vis.loc_by_id.get(turn.world_snapshot.active_location_id)
            loc_name = loc_obj.name if loc_obj else turn.world_snapshot.active_location_id
            turns_out.append(
                {
                    "turn_number": turn.depth_index,
                    "turn_id": turn.id,
                    "timestamp": turn.world_snapshot.world_timestamp,
                    "location": loc_name,
                    "snippet": _format_turn_prose_snippet(turn, include_cognition=vis.unlock_lore, max_chars=550),
                }
            )
            sources.append(GmSourceRef(kind="turn", id=turn.id, label=f"Turn {turn.depth_index}"))
        return {"turns": turns_out}, sources, None

    if name == "get_campaign_turns":
        try:
            start_t = int(args.get("start_turn", 0))
            end_t = int(args.get("end_turn", start_t))
        except (TypeError, ValueError):
            return {"error": "Invalid turn range."}, sources, None
        if end_t < start_t:
            start_t, end_t = end_t, start_t
        if end_t - start_t > 5:
            end_t = start_t + 5
        turns_out = []
        for turn in bundle.active_branch_turns:
            if start_t <= turn.depth_index <= end_t:
                turns_out.append(
                    {
                        "turn_number": turn.depth_index,
                        "turn_id": turn.id,
                        "detail": _format_turn_prose_snippet(
                            turn, include_cognition=vis.unlock_lore, max_chars=1400
                        ),
                    }
                )
                sources.append(GmSourceRef(kind="turn", id=turn.id, label=f"Turn {turn.depth_index}"))
        return {"turns": turns_out}, sources, None

    if name == "get_campaign_entity":
        kind = str(args.get("kind") or "").strip().lower()
        query = str(args.get("query") or "").strip().lower()
        if not query:
            return {"error": "Entity query is required."}, sources, None

        if kind == "persona":
            persona = bundle.campaign.persona_snapshot
            if persona and (query in persona.name.lower() or query == persona.id.lower()):
                sources.append(GmSourceRef(kind="persona", id=persona.id, label=persona.name))
                return (
                    {
                        "kind": "persona",
                        "id": persona.id,
                        "name": persona.name,
                        "tagline": persona.tagline,
                        "bio": persona.persona_bio,
                        "equipped": [it.name for it in persona.equipped],
                        "inventory": [it.name for it in persona.inventory],
                    },
                    sources,
                    None,
                )
            return {"error": "Persona not found."}, sources, None

        if kind == "character":
            matches = [
                c
                for c in bundle.character_records.values()
                if query == c.id.lower() or query in c.name.lower()
            ]
            if not matches:
                return {"error": "Character not found."}, sources, None
            char = matches[0]
            state = bundle.character_states.get(char.id)
            sources.append(GmSourceRef(kind="character", id=char.id, label=char.name))
            return (
                {
                    "kind": "character",
                    "id": char.id,
                    "name": char.name,
                    "summary": _format_character_detail(char, state, vis=vis, detailed=True),
                },
                sources,
                None,
            )

        if kind == "location":
            for loc in vis.loc_by_id.values():
                if not vis.unlock_lore and loc.id not in vis.visited_location_ids:
                    continue
                if query == loc.id.lower() or query in loc.name.lower():
                    sources.append(GmSourceRef(kind="location", id=loc.id, label=loc.name))
                    permitted_lore = [
                        {"title": ln.title, "category": ln.category, "content": ln.content}
                        for ln in loc.lore_nodes
                        if _is_lore_visible(ln, vis, owner_location_id=loc.id)
                    ]
                    return (
                        {
                            "kind": "location",
                            "id": loc.id,
                            "name": loc.name,
                            "summary": loc.summary,
                            "description": loc.description,
                            "environmental_tags": list(loc.environmental_tags),
                            "local_lore": permitted_lore,
                        },
                        sources,
                        None,
                    )
            return {"error": "Location not found or not yet visited."}, sources, None

        if kind == "container":
            for cont in vis.cont_by_id.values():
                if not vis.unlock_lore and cont.id not in vis.visited_container_ids:
                    continue
                if query == cont.id.lower() or query in cont.name.lower():
                    sources.append(GmSourceRef(kind="container", id=cont.id, label=cont.name))
                    permitted_lore = [
                        {"title": ln.title, "category": ln.category, "content": ln.content}
                        for ln in cont.lore_nodes
                        if _is_lore_visible(ln, vis, owner_container_id=cont.id)
                    ]
                    return (
                        {
                            "kind": "container",
                            "id": cont.id,
                            "name": cont.name,
                            "breadcrumb": _container_breadcrumb(cont.id, vis.cont_by_id),
                            "depth": cont.depth,
                            "description": cont.description,
                            "local_lore": permitted_lore,
                        },
                        sources,
                        None,
                    )
            return {"error": "Container not found or not yet visited."}, sources, None

        return {"error": f"Unsupported entity kind '{kind}'."}, sources, None

    if name == "propose_world_lore_entry":
        if len(emitted_proposals) >= MAX_GM_PROPOSALS_PER_TURN:
            return (
                {
                    "status": "limit_reached",
                    "error": f"Maximum of {MAX_GM_PROPOSALS_PER_TURN} Codex proposals per turn reached.",
                },
                sources,
                None,
            )

        try:
            llm_out = GmWorldLoreDraftLLMOutput.model_validate(args)
            draft = WorldLoreNodeDraft(
                title=llm_out.title,
                category=llm_out.category,
                content=llm_out.content,
                entity_tags=list(llm_out.entity_tags),
            )
        except Exception as exc:
            return (
                {"status": "validation_error", "error": f"Invalid Codex entry arguments: {type(exc).__name__}"},
                sources,
                None,
            )

        dupes = find_world_codex_duplicates(
            draft,
            visible_world_nodes,
            base_world_ids=base_world_ids,
        )

        raw_replace_id = str(args.get("replace_lore_id") or "").strip() or None
        validated_replace_id: str | None = None
        requires_gm_mode_for_replace = False
        if raw_replace_id:
            target_existing = next(
                (ln for ln in visible_world_nodes if ln.id == raw_replace_id), None
            )
            if target_existing is not None:
                is_base = _is_base_world_node(
                    target_existing.id,
                    target_existing.campaign_id,
                    target_existing.origin_lore_id,
                    base_world_ids,
                )
                if is_base and not vis.unlock_lore:
                    requires_gm_mode_for_replace = True
                else:
                    validated_replace_id = target_existing.id

        proposal = GmCodexProposal(
            id=f"prop_{uuid.uuid4().hex[:12]}",
            status="pending",
            draft=draft,
            source_turns=list(llm_out.source_turns),
            duplicate_matches=dupes,
            replace_lore_id=validated_replace_id,
            saved_lore_id=None,
            created_at=utc_now_iso(),
        )
        return (
            {
                "status": "proposal_presented",
                "proposal_id": proposal.id,
                "title": draft.title,
                "category": draft.category,
                "duplicate_matches": [
                    {"id": d.id, "title": d.title, "is_base_world": d.is_base_world}
                    for d in dupes
                ],
                "requires_gm_mode_for_replace": requires_gm_mode_for_replace,
                "note": "Proposal confirmation card presented to the player. Do not claim it is saved yet.",
            },
            sources,
            proposal,
        )

    return {"error": f"Unknown tool '{name}'."}, sources, None


def _dedupe_sources(sources: list[GmSourceRef]) -> list[GmSourceRef]:
    seen: set[tuple[str, str]] = set()
    out: list[GmSourceRef] = []
    for s in sources:
        key = (s.kind, s.id)
        if key in seen:
            continue
        seen.add(key)
        out.append(s)
    return out


def _build_synthesis_messages(
    prep_messages: list[dict[str, str]],
    tool_trace: list[tuple[str, dict[str, Any], dict[str, Any]]],
) -> list[dict[str, str]]:
    """Build plain wire-safe messages for `stream_chat` fallback synthesis without tool roles."""
    plain_messages: list[dict[str, str]] = [
        {
            "role": str(m.get("role") or "user"),
            "content": str(m.get("content") or ""),
        }
        for m in prep_messages
    ]
    if not tool_trace:
        return plain_messages

    lines: list[str] = [
        "=== RETRIEVED TOOL FINDINGS FOR FINAL REPLY ===",
        "Summarize these findings directly in plain prose for the player. "
        "Do NOT output raw tool-call JSON. "
        "If `propose_world_lore_entry` succeeded, tell the player the draft card is ready for review and confirmation (never claim it is already saved).",
    ]
    total_chars = sum(len(line) for line in lines) + 2
    max_total_chars = 4000
    for idx, (tool_name, tool_args, tool_out) in enumerate(tool_trace, start=1):
        try:
            args_str = json.dumps(tool_args, ensure_ascii=False)
        except Exception:
            args_str = "{}"
        if len(args_str) > 200:
            args_str = args_str[:197] + "…"
        try:
            out_str = json.dumps(tool_out, ensure_ascii=False)
        except Exception:
            out_str = "{}"
        if len(out_str) > 750:
            out_str = out_str[:747] + "…"
        entry = f"[{idx}] {tool_name}({args_str}) -> {out_str}"
        if total_chars + len(entry) + 1 > max_total_chars:
            lines.append("[Additional earlier tool outputs truncated for context budget.]")
            break
        lines.append(entry)
        total_chars += len(entry) + 1

    plain_messages.append({"role": "system", "content": "\n".join(lines)})
    return plain_messages


async def run_gm_tool_loop(
    repo: CantinaRepository,
    *,
    bundle: CampaignStateBundle,
    prep: GmPreparedContext,
    gm_profile: ModelProfile,
    llm_client_override: Any | None = None,
) -> AsyncIterator[tuple[str, Any]]:
    """Run bounded tool-calling rounds for Neuromancer, yielding progress, proposals, and final output."""
    active_llm = llm_client_override or llm_client
    vis = _compute_branch_visibility(bundle)
    base_world_ids = repo.get_base_world_lore_ids(bundle.campaign.world_id)

    convo_messages: list[dict[str, Any]] = [dict(m) for m in prep.messages]
    if convo_messages and convo_messages[0].get("role") == "system":
        convo_messages[0] = {
            "role": "system",
            "content": f"{convo_messages[0]['content']}\n\n{GM_TOOLS_SYSTEM_ADDENDUM}",
        }

    emitted_proposals: list[GmCodexProposal] = []
    extra_sources: list[GmSourceRef] = []
    tool_trace: list[tuple[str, dict[str, Any], dict[str, Any]]] = []
    total_tool_calls = 0

    for round_idx in range(MAX_GM_TOOL_ROUNDS):
        try:
            result = await active_llm.complete_with_tools(
                convo_messages,
                GM_TOOL_DEFINITIONS,
                profile=gm_profile,
                disable_reasoning=True,
            )
        except ToolsUnsupportedError:
            if round_idx == 0:
                raise
            logger.info(
                "GM tools rejected mid-loop for campaign '%s'; falling back to final stream.",
                sanitize_log_value(bundle.campaign.id),
            )
            break
        except (RelayUnavailableError, RelayRemoteError):
            raise

        if not result.tool_calls:
            clean_text = strip_reasoning_blocks(result.content or "")
            yield ("extra_sources", _dedupe_sources(extra_sources))
            yield ("proposals", emitted_proposals)
            yield ("final_text", clean_text)
            return

        convo_messages.append(
            {
                "role": "assistant",
                "content": result.content or "",
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {"name": tc.name, "arguments": tc.arguments},
                    }
                    for tc in result.tool_calls
                ],
            }
        )

        for tc in result.tool_calls:
            if total_tool_calls >= MAX_GM_TOOL_CALLS_PER_TURN:
                convo_messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "name": tc.name,
                        "content": json.dumps(
                            {"error": "Tool call budget for this turn reached; summarize what you know now."}
                        ),
                    }
                )
                continue

            total_tool_calls += 1
            label = describe_gm_tool_status(tc.name, tc.arguments)
            yield ("tool_status", {"tool_name": tc.name, "label": label, "phase": "running"})
            tool_out, tool_sources, maybe_prop = await execute_gm_tool(
                repo,
                bundle=bundle,
                vis=vis,
                base_world_ids=base_world_ids,
                call=tc,
                emitted_proposals=emitted_proposals,
            )
            extra_sources.extend(tool_sources)
            tool_trace.append((tc.name, dict(tc.arguments or {}), tool_out))
            if maybe_prop is not None:
                emitted_proposals.append(maybe_prop)
            convo_messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "name": tc.name,
                    "content": json.dumps(tool_out),
                }
            )
            yield ("tool_status", {"tool_name": tc.name, "label": label, "phase": "done"})

    # Max rounds or mid-loop unsupported error reached: hand off clean text synthesis to stream_chat
    yield ("extra_sources", _dedupe_sources(extra_sources))
    yield ("proposals", emitted_proposals)
    yield ("fallback_stream", _build_synthesis_messages(prep.messages, tool_trace))
