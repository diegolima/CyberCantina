"""Leaf Pydantic v2 schemas for GM Talk ('Neuromancer') out-of-character chat."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.world import (
    WorldLoreCategory,
    WorldLoreNodeDraft,
    normalize_and_validate_entity_tags,
    normalize_lore_category,
)

GmModelRole = Literal["primary", "clerk"]
GmMentionKind = Literal["character", "persona", "lore", "location", "container", "turn", "mechanic"]
GmMentionCategory = Literal["characters", "lore", "locations", "containers", "turns", "mechanics"]
GmCodexProposalStatus = Literal["pending", "confirmed", "cancelled"]

_CODEX_REASONING_TAGS = ("think", "thought", "reasoning", "scratchpad")


def _strip_reasoning_blocks_linear(text: str) -> str:
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
        for tag in _CODEX_REASONING_TAGS:
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
            break
        idx = close_pos + len(close_token)
    return "".join(out).strip()


def _normalize_inline_emphasis_tags(text: str) -> str:
    """Convert strict `<i>`/`<em>` tags to Markdown `*` without touching `<` comparisons."""
    out = text
    for token in ("<i>", "</i>", "<I>", "</I>", "<em>", "</em>", "<EM>", "</EM>"):
        out = out.replace(token, "*")
    return out


def sanitize_codex_draft_text(text: Any, *, strip_ooc_sources: bool = True) -> str:
    """Strip reasoning wrappers, inline emphasis HTML tags, and trailing OOC turn citations."""
    if not isinstance(text, str):
        return ""
    cleaned = _normalize_inline_emphasis_tags(_strip_reasoning_blocks_linear(text))
    if not strip_ooc_sources:
        return cleaned.strip()

    lines = [ln.rstrip() for ln in cleaned.splitlines()]
    while lines and not lines[-1].strip():
        lines.pop()

    while lines:
        tail = lines[-1].strip()
        tail_unwrapped = tail.strip("*_ `").lower()
        is_ooc_source = (
            tail_unwrapped.startswith("sources:")
            or tail_unwrapped.startswith("source:")
            or tail_unwrapped.startswith("grounded in turn")
            or tail_unwrapped.startswith("first observed in turn")
        )
        if is_ooc_source and ("turn" in tail_unwrapped or "episode" in tail_unwrapped):
            lines.pop()
            while lines and not lines[-1].strip():
                lines.pop()
            continue
        break

    return "\n".join(lines).strip()


class GmMentionRef(BaseModel):
    """Structured reference pinned by a player via `@` mention in GM Talk."""

    kind: GmMentionKind
    id: str = Field(..., min_length=1, max_length=256)
    label: str = Field(..., min_length=1, max_length=200)


class GmMentionCandidate(BaseModel):
    """Live-search candidate returned by `GET /api/campaigns/{id}/gm/mentions`."""

    kind: GmMentionKind
    category: GmMentionCategory
    id: str
    label: str
    subtitle: str = ""
    badge: str = ""


class GmSourceRef(BaseModel):
    """Source attribution entry shown under a GM Talk assistant reply."""

    kind: str
    id: str
    label: str


class GmCodexDuplicateMatch(BaseModel):
    """Existing World Codex entry sharing a title or keyword overlap with a draft."""

    id: str
    title: str
    category: WorldLoreCategory
    is_base_world: bool = False
    match_reason: str = ""


class GmWorldLoreDraftLLMOutput(BaseModel):
    """Grammar-constrained LLM output for drafting a campaign-scoped World Codex entry."""

    category: WorldLoreCategory = Field(
        ...,
        description="World Codex category: history, culture, faction, figure, rumor, threat, or artifact.",
    )
    title: str = Field(
        ...,
        min_length=1,
        max_length=120,
        description="Concise in-universe Codex title without OOC turn citations or subtitles.",
    )
    entity_tags: list[str] = Field(
        ...,
        min_length=1,
        max_length=20,
        description="3 to 8 concise trigger keywords or entity names for Codex search and RAG recall.",
    )
    content: str = Field(
        ...,
        min_length=1,
        max_length=2000,
        description="Concise in-universe encyclopedia description grounded in observed campaign facts; exclude OOC turn citations.",
    )
    source_turns: list[int] = Field(
        default_factory=list,
        description="Optional branch turn numbers supporting this entry (UI provenance metadata only; not stored in content).",
    )

    @model_validator(mode="before")
    @classmethod
    def _sanitize_codex_draft(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        out = dict(data)
        raw_title = sanitize_codex_draft_text(out.get("title"), strip_ooc_sources=True)
        # Keep title single-line and bounded
        title_line = " ".join(raw_title.split())[:120].strip()
        out["title"] = title_line or "Untitled Codex Entry"

        raw_content = sanitize_codex_draft_text(out.get("content"), strip_ooc_sources=True)
        if len(raw_content) > 2000:
            raw_content = raw_content[:1997].rstrip() + "..."
        out["content"] = raw_content

        out["category"] = normalize_lore_category(
            out.get("category"),
            allow_secret=False,
            allow_artifact=True,
            strict=False,
        )

        raw_tags = out.get("entity_tags")
        if isinstance(raw_tags, str):
            raw_tags = [part.strip() for part in raw_tags.replace("\n", ",").split(",") if part.strip()]
        out["entity_tags"] = normalize_and_validate_entity_tags(
            raw_tags,
            strict=False,
            fallback_title=out["title"],
            fallback_content=out["content"],
        )

        raw_turns = out.get("source_turns")
        turns: list[int] = []
        if isinstance(raw_turns, list):
            seen_turns: set[int] = set()
            for item in raw_turns:
                try:
                    tnum = int(item)
                except (TypeError, ValueError):
                    continue
                if tnum > 0 and tnum not in seen_turns:
                    seen_turns.add(tnum)
                    turns.append(tnum)
        out["source_turns"] = sorted(turns)
        return out


class GmCodexProposal(BaseModel):
    """Tentative World Codex entry attached to a GM Talk reply awaiting deterministic confirmation."""

    id: str
    status: GmCodexProposalStatus = "pending"
    draft: WorldLoreNodeDraft
    source_turns: list[int] = Field(default_factory=list)
    duplicate_matches: list[GmCodexDuplicateMatch] = Field(default_factory=list)
    replace_lore_id: str | None = None
    saved_lore_id: str | None = None
    created_at: str = ""


class GmCodexDraftRequest(BaseModel):
    """Request payload for `POST /api/campaigns/{id}/gm/codex-draft`."""

    message_id: str | None = Field(default=None, max_length=128)
    instruction: str | None = Field(default=None, max_length=1000)


class GmCodexDraftResponse(BaseModel):
    """Response payload for `POST /api/campaigns/{id}/gm/codex-draft`."""

    message_id: str
    proposal: GmCodexProposal


class GmProposalActionRequest(BaseModel):
    """Request payload for updating a pending GM Codex proposal state (cancellation)."""

    status: Literal["cancelled"]


class GmChatMessage(BaseModel):
    """Persisted out-of-character GM Talk message anchored to a timeline branch."""

    id: str
    campaign_id: str
    anchor_turn_id: str | None = None
    role: Literal["user", "assistant"]
    content: str
    mentions: list[GmMentionRef] = Field(default_factory=list)
    sources: list[GmSourceRef] = Field(default_factory=list)
    proposals: list[GmCodexProposal] = Field(default_factory=list)
    created_at: str


class GmChatRequest(BaseModel):
    """Incoming GM Talk question and pinned entity references."""

    message: str = Field(..., min_length=1, max_length=8000)
    mentions: list[GmMentionRef] = Field(default_factory=list, max_length=10)

    @field_validator("message")
    @classmethod
    def _validate_message_non_blank(cls, value: str) -> str:
        cleaned = (value or "").strip()
        if not cleaned:
            raise ValueError("GM message must not be empty.")
        return cleaned


class GmMessagesResponse(BaseModel):
    """Response payload for `GET /api/campaigns/{id}/gm/messages`."""

    messages: list[GmChatMessage] = Field(default_factory=list)
    unlock_lore: bool = False
    gm_model_role: GmModelRole = "primary"
    gm_model_name: str = ""
    gm_temperature: float = 0.5
    gm_max_tokens: int = 1024
    gm_tools_enabled: bool = False


class GmMentionsResponse(BaseModel):
    """Response payload for `GET /api/campaigns/{id}/gm/mentions`."""

    items: list[GmMentionCandidate] = Field(default_factory=list)
