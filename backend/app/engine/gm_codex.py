"""Structured World Codex entry drafting, intent detection, and duplicate checking for GM Talk."""

from __future__ import annotations

import logging
import re
import uuid
from collections.abc import Sequence
from typing import Any

from app.config import ModelProfile
from app.db.repos.base import utc_now_iso
from app.db.repository import CantinaRepository
from app.engine.gm_talk import (
    _collapse_inline,
    _compute_branch_visibility,
    _estimate_tokens,
    _format_turn_prose_snippet,
    is_offline_fallback_enabled,
)
from app.engine.llm_client import llm_client
from app.prompts import DEFAULT_GM_CODEX_DRAFT, PROMPT_KEY_GM_CODEX_DRAFT, render_template
from app.providers.local_relay import RelayRemoteError, RelayUnavailableError
from app.schemas.gm import (
    GmChatMessage,
    GmCodexDuplicateMatch,
    GmCodexProposal,
    GmWorldLoreDraftLLMOutput,
)
from app.schemas.world import LoreNode, WorldLoreNodeDraft, synthesize_fallback_tags
from app.security.log_sanitize import sanitize_log_value

logger = logging.getLogger("cybercantina.engine.gm_codex")

_EXPLORATORY_PREFIXES = (
    "what would",
    "what should",
    "what could",
    "what kind of",
    "what type of",
    "how would",
    "how should",
    "should i ",
    "should we ",
    "would it ",
    "would you recommend",
    "would you suggest",
    "what is ",
    "what was ",
    "tell me ",
    "suggest ",
)
_EXPLORATORY_PHRASES = (
    "reasonable entry",
    "good entry",
    "example entry",
    "what entry",
)
_POLITE_PREFIXES = (
    "please ",
    "can you ",
    "could you ",
    "would you ",
    "hey gm ",
    "hey neuromancer ",
    "neuromancer ",
)
_ACTION_VERBS = (
    "add",
    "save",
    "put",
    "create",
    "draft",
    "record",
    "log",
    "register",
    "store",
    "write",
    "make",
)
_CODEX_TARGETS = ("codex", "lore entry", "world lore")


def _split_clauses(text: str) -> list[str]:
    """Split user input linearly into trimmed clauses without regex backtracking."""
    clauses: list[str] = []
    start = 0
    for idx, ch in enumerate(text):
        if ch in ".!?;,\n":
            chunk = text[start:idx].strip()
            if chunk:
                clauses.append(chunk)
            start = idx + 1
    tail = text[start:].strip()
    if tail:
        clauses.append(tail)
    return clauses


def detect_explicit_codex_add_intent(message: str) -> bool:
    """Return True only for explicit user requests to add/draft/save a Codex entry."""
    normalized = " ".join((message or "").lower().split())
    if not normalized:
        return False
    if not any(target in normalized for target in _CODEX_TARGETS):
        return False

    for raw_clause in _split_clauses(normalized):
        if any(phrase in raw_clause for phrase in _EXPLORATORY_PHRASES):
            continue
        if any(raw_clause.startswith(prefix) for prefix in _EXPLORATORY_PREFIXES):
            continue

        clause = raw_clause
        stripped = True
        while stripped:
            stripped = False
            for prefix in _POLITE_PREFIXES:
                if clause.startswith(prefix):
                    clause = clause[len(prefix) :].strip()
                    stripped = True
                    break

        target_pos = -1
        for target in _CODEX_TARGETS:
            pos = clause.find(target)
            if pos != -1 and (target_pos == -1 or pos < target_pos):
                target_pos = pos
        if target_pos == -1:
            continue

        tokens = [tok.strip("\"'`()[]{}:") for tok in clause[:target_pos].split()]
        if any(tok in _ACTION_VERBS for tok in tokens):
            return True

    return False


def _normalize_title_key(title: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", (title or "").lower()))


def find_world_codex_duplicates(
    draft: WorldLoreNodeDraft,
    existing_world_lore: Sequence[LoreNode],
    *,
    base_world_ids: set[str] | None = None,
) -> list[GmCodexDuplicateMatch]:
    """Detect existing World Codex entries with exact/similar titles or strong tag overlap."""
    draft_title_norm = _normalize_title_key(draft.title)
    draft_tags = {t.strip().lower() for t in draft.entity_tags if t.strip()}

    scored: list[tuple[int, GmCodexDuplicateMatch]] = []
    for existing in existing_world_lore:
        ex_title_norm = _normalize_title_key(existing.title)
        score = 0
        reason = ""

        if draft_title_norm and ex_title_norm and draft_title_norm == ex_title_norm:
            score = 3
            reason = "Exact title match"
        elif (
            draft_title_norm
            and ex_title_norm
            and min(len(draft_title_norm), len(ex_title_norm)) >= 5
            and (draft_title_norm in ex_title_norm or ex_title_norm in draft_title_norm)
        ):
            score = 2
            reason = "Similar title"
        else:
            ex_tags = {t.strip().lower() for t in existing.entity_tags if t.strip()}
            shared = draft_tags & ex_tags
            union = draft_tags | ex_tags
            jaccard = (len(shared) / len(union)) if union else 0.0
            if len(shared) >= 2 or jaccard >= 0.5:
                score = 1
                reason = f"Shared tags: {', '.join(sorted(shared)[:3])}"

        if score <= 0:
            continue

        if base_world_ids is not None:
            is_base_world = (
                existing.campaign_id is None
                or existing.id in base_world_ids
                or (existing.origin_lore_id is not None and existing.origin_lore_id in base_world_ids)
            )
        else:
            is_base_world = existing.campaign_id is None

        scored.append(
            (
                score,
                GmCodexDuplicateMatch(
                    id=existing.id,
                    title=existing.title,
                    category=existing.category if existing.category != "secret" else "rumor",
                    is_base_world=is_base_world,
                    match_reason=reason,
                ),
            )
        )

    scored.sort(key=lambda item: (-item[0], item[1].title.lower()))
    return [match for _, match in scored[:5]]


def _extract_turn_numbers(text: str) -> list[int]:
    """Extract positive turn numbers mentioned in OOC GM text (e.g., Turn 13, Turns 12-14)."""
    turns: set[int] = set()
    for a, b in re.findall(r"turns?\s+(\d+)\s*[–-]\s*(\d+)", text, flags=re.IGNORECASE):
        lo, hi = int(a), int(b)
        if 0 < lo <= hi and (hi - lo) <= 50:
            turns.update(range(lo, hi + 1))
    for single in re.findall(r"turns?\s+(\d+)", text, flags=re.IGNORECASE):
        val = int(single)
        if val > 0:
            turns.add(val)
    return sorted(turns)


def build_offline_codex_draft(
    source_text: str,
    user_prompt: str | None = None,
) -> GmWorldLoreDraftLLMOutput:
    """Deterministic fallback generator when `allow_offline_fallback` is enabled."""
    lines = [ln.strip() for ln in (source_text or "").splitlines() if ln.strip()]
    title = ""
    body_lines: list[str] = []

    for idx, line in enumerate(lines):
        if line.startswith("#") and not title:
            title = line.lstrip("#").strip()[:120]
            continue
        if idx == 1 and title and "·" in line and len(line) < 90:
            # Skip OOC subtitle lines like "Security equipment · First observed at..."
            continue
        body_lines.append(line)

    if not title:
        seed = (user_prompt or source_text or "Codex Entry").strip()
        words = [w.strip(".,!?:;\"'") for w in seed.split() if w.strip(".,!?:;\"'")]
        title = " ".join(words[:5])[:120] or "Campaign Codex Entry"

    body = "\n\n".join(body_lines).strip() or (source_text or title).strip()
    lowered = f"{title} {body}".lower()
    if any(k in lowered for k in ("scanner", "device", "pistol", "shard", "weapon", "relic", "artifact")):
        category = "artifact"
    elif any(k in lowered for k in ("enemy", "threat", "patrol", "raider", "drone", "beast", "hazard")):
        category = "threat"
    elif any(k in lowered for k in ("faction", "syndicate", "guild", "corp", "order")):
        category = "faction"
    elif any(k in lowered for k in ("rumor", "whisper", "unconfirmed")):
        category = "rumor"
    else:
        category = "history"

    tags = synthesize_fallback_tags(title, body)
    turns = _extract_turn_numbers(source_text or "")
    return GmWorldLoreDraftLLMOutput.model_validate(
        {
            "category": category,
            "title": title,
            "entity_tags": tags,
            "content": body,
            "source_turns": turns,
        }
    )


async def draft_world_codex_proposal(
    repo: CantinaRepository,
    *,
    campaign_id: str,
    owner_id: str,
    gm_profile: ModelProfile,
    resolved_prompts: dict[str, str],
    target_message_id: str | None = None,
    user_instruction: str | None = None,
    recent_exchange: tuple[str, str] | None = None,
    llm_client_override: Any | None = None,
) -> GmCodexProposal:
    """Extract a schema-validated, spoiler-safe World Codex entry proposal via `complete_structured`."""
    bundle = repo.get_campaign_state_bundle(campaign_id, owner_id=owner_id)
    world = repo.get_world(bundle.campaign.world_id)
    vis = _compute_branch_visibility(bundle)
    gm_messages = repo.list_gm_messages_for_branch(campaign_id, vis.valid_turn_ids)
    base_world_ids = repo.get_base_world_lore_ids(bundle.campaign.world_id)

    exchange_messages: list[GmChatMessage] = []
    if target_message_id:
        target_idx = next((i for i, m in enumerate(gm_messages) if m.id == target_message_id), -1)
        if target_idx == -1:
            raise KeyError(f"GM message '{target_message_id}' not found on the active branch.")
        target_msg = gm_messages[target_idx]
        if target_msg.role != "assistant":
            raise ValueError("Codex entries can only be drafted from a Neuromancer assistant message.")
        start_idx = max(0, target_idx - 3)
        exchange_messages = gm_messages[start_idx : target_idx + 1]
        fallback_source_text = target_msg.content
    elif recent_exchange is not None:
        exchange_messages = gm_messages[-4:]
        fallback_source_text = recent_exchange[1]
    else:
        asst_indices = [i for i, m in enumerate(gm_messages) if m.role == "assistant"]
        if not asst_indices:
            raise ValueError("No Neuromancer GM message is available on this branch to draft from.")
        last_idx = asst_indices[-1]
        start_idx = max(0, last_idx - 3)
        exchange_messages = gm_messages[start_idx : last_idx + 1]
        fallback_source_text = gm_messages[last_idx].content

    if vis.unlock_lore:
        spoiler_policy = (
            "GM MODE ACTIVE (Unlock Lore & Secrets is ON): You may reference confirmed campaign events and "
            "GM-known world details, but never write OOC turn numbers inside `content`."
        )
    else:
        spoiler_policy = (
            "SPOILER-SAFE MODE ACTIVE (Unlock Lore & Secrets is OFF): Only include facts established in "
            "player-visible turns and revealed lore. If something was not established, explicitly state that it is unconfirmed."
        )

    raw_tmpl = resolved_prompts.get(PROMPT_KEY_GM_CODEX_DRAFT) or DEFAULT_GM_CODEX_DRAFT
    try:
        system_prompt = render_template(
            raw_tmpl,
            world_name=world.name,
            spoiler_policy=spoiler_policy,
        )
    except Exception:
        system_prompt = render_template(
            DEFAULT_GM_CODEX_DRAFT,
            world_name=world.name,
            spoiler_policy=spoiler_policy,
        )

    rules = world.global_rules
    codex_index_lines: list[str] = []
    for ln in bundle.world_lore_nodes[:40]:
        tags_str = ", ".join(ln.entity_tags[:5])
        codex_index_lines.append(f"- [{ln.category}] {ln.title} (tags: {tags_str})")
    codex_index_block = "\n".join(codex_index_lines) or "No World Codex entries yet."

    safe_ctx = max(2048, int(gm_profile.context_size or 8192))
    turns_budget = max(500, min(1800, int(safe_ctx * 0.22)))
    recent_turn_blocks: list[str] = []
    turn_tok = 0
    for turn in reversed(bundle.active_branch_turns[-8:]):
        snippet = _format_turn_prose_snippet(turn, include_cognition=vis.unlock_lore)
        tok = _estimate_tokens(snippet)
        if turn_tok + tok > turns_budget and recent_turn_blocks:
            break
        recent_turn_blocks.append(snippet)
        turn_tok += tok
    recent_turns_text = "\n\n".join(reversed(recent_turn_blocks)) or "No turns recorded yet."

    convo_lines: list[str] = []
    for msg in exchange_messages:
        speaker = "Player (OOC)" if msg.role == "user" else "Neuromancer (GM)"
        convo_lines.append(f"{speaker}: {msg.content}")
    if recent_exchange is not None:
        convo_lines.append(f"Player (OOC): {recent_exchange[0]}")
        convo_lines.append(f"Neuromancer (GM): {recent_exchange[1]}")
    convo_text = "\n\n".join(convo_lines)

    instruction_text = (user_instruction or "").strip()
    user_parts = [
        f"<world>\nWorld: {world.name} ({rules.genre} — {rules.tone})\nOverview: {_collapse_inline(rules.setting_overview, 400)}\n</world>",
        f"<existing_world_codex>\n{codex_index_block}\n</existing_world_codex>",
        f"<recent_campaign_turns>\n{recent_turns_text}\n</recent_campaign_turns>",
        f"<gm_conversation>\n{convo_text}\n</gm_conversation>",
    ]
    if instruction_text:
        user_parts.append(f"<user_request>\n{instruction_text}\n</user_request>")
    else:
        user_parts.append(
            "<user_request>\nDraft a clean, grounded World Codex entry summarizing the main subject from Neuromancer's latest reply.\n</user_request>"
        )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": "\n\n".join(user_parts)},
    ]

    active_llm = llm_client_override or llm_client
    required_props = list(GmWorldLoreDraftLLMOutput.model_fields.keys())
    try:
        llm_out = await active_llm.complete_structured(
            messages,
            GmWorldLoreDraftLLMOutput,
            profile=gm_profile,
            temperature=min(0.4, float(gm_profile.temperature)),
            max_tokens=min(1024, max(512, int(gm_profile.max_tokens))),
            required_properties=required_props,
        )
    except (RelayUnavailableError, RelayRemoteError):
        raise
    except Exception as exc:
        if is_offline_fallback_enabled():
            logger.info(
                "Using offline fallback Codex draft for campaign '%s' (%s)",
                sanitize_log_value(campaign_id),
                sanitize_log_value(type(exc).__name__),
            )
            llm_out = build_offline_codex_draft(fallback_source_text, instruction_text)
        else:
            raise

    draft = WorldLoreNodeDraft(
        title=llm_out.title,
        category=llm_out.category,
        content=llm_out.content,
        entity_tags=list(llm_out.entity_tags),
    )
    dupes = find_world_codex_duplicates(
        draft,
        bundle.world_lore_nodes,
        base_world_ids=base_world_ids,
    )
    return GmCodexProposal(
        id=f"prop_{uuid.uuid4().hex[:12]}",
        status="pending",
        draft=draft,
        source_turns=list(llm_out.source_turns),
        duplicate_matches=dupes,
        replace_lore_id=None,
        saved_lore_id=None,
        created_at=utc_now_iso(),
    )
