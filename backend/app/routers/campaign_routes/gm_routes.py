"""GM Talk ('Neuromancer') REST & SSE streaming routes."""

from __future__ import annotations

import asyncio
import json
from typing import AsyncIterator

from fastapi import Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.auth import get_current_user
from app.dependencies import (
    get_repo,
    resolve_effective_models,
    resolve_gm_profile,
)
from app.engine.gm_codex import (
    detect_explicit_codex_add_intent,
    draft_world_codex_proposal,
)
from app.engine.gm_talk import (
    ReasoningTagStreamFilter,
    build_gm_context_and_messages,
    build_offline_gm_reply,
    is_offline_fallback_enabled,
    search_gm_mentions,
)
from app.engine.gm_tools import run_gm_tool_loop
from app.engine.llm_client import ToolsUnsupportedError, llm_client
from app.providers.local_relay import (
    RelayRemoteError,
    RelayUnavailableError,
    relay_tab_context,
    relay_user_context,
)
from app.routers.campaign_routes.schemas_and_gate import (
    _resolve_facade_attr,
    logger,
    router,
)
from app.routers.campaign_routes.turn_streaming import _RELAY_ERROR_MESSAGES
from app.schemas.auth import UserProfile
from app.schemas.gm import (
    GmChatRequest,
    GmCodexDraftRequest,
    GmCodexDraftResponse,
    GmCodexProposal,
    GmMentionCategory,
    GmMentionsResponse,
    GmMessagesResponse,
    GmProposalActionRequest,
)
from app.security.log_sanitize import sanitize_log_value


def _sse_packet(event: str, data: dict[str, object]) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@router.get("/api/campaigns/{campaign_id}/gm/messages", response_model=GmMessagesResponse)
def get_campaign_gm_messages(
    campaign_id: str,
    current_user: UserProfile = Depends(get_current_user),
) -> GmMessagesResponse:
    """Return active-branch GM Talk history, spoiler status, and active GM model summary."""
    repo = _resolve_facade_attr("get_repo", get_repo)()
    try:
        bundle = repo.get_campaign_state_bundle(campaign_id, owner_id=current_user.id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Campaign '{campaign_id}' not found.") from None

    valid_turn_ids = {t.id for t in bundle.active_branch_turns}
    messages = repo.list_gm_messages_for_branch(campaign_id, valid_turn_ids)
    eff = _resolve_facade_attr("resolve_effective_models", resolve_effective_models)(current_user.id)
    gm_profile, gm_role = resolve_gm_profile(eff)
    return GmMessagesResponse(
        messages=messages,
        unlock_lore=bool(bundle.campaign.world_settings.unlock_lore),
        gm_model_role=gm_role,
        gm_model_name=gm_profile.model,
        gm_temperature=gm_profile.temperature,
        gm_max_tokens=gm_profile.max_tokens,
        gm_tools_enabled=bool(getattr(eff, "gm_tools_enabled", False)),
    )


@router.delete("/api/campaigns/{campaign_id}/gm/messages")
def clear_campaign_gm_messages(
    campaign_id: str,
    current_user: UserProfile = Depends(get_current_user),
) -> dict[str, object]:
    """Delete GM Talk messages visible on the currently active timeline branch."""
    repo = _resolve_facade_attr("get_repo", get_repo)()
    try:
        bundle = repo.get_campaign_state_bundle(campaign_id, owner_id=current_user.id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Campaign '{campaign_id}' not found.") from None

    valid_turn_ids = {t.id for t in bundle.active_branch_turns}
    deleted = repo.clear_gm_messages_for_branch(campaign_id, valid_turn_ids)
    return {"cleared": True, "deleted": deleted}


@router.get("/api/campaigns/{campaign_id}/gm/mentions", response_model=GmMentionsResponse)
def search_campaign_gm_mentions(
    campaign_id: str,
    category: GmMentionCategory | None = Query(default=None),
    q: str = Query(default=""),
    limit: int = Query(default=25, ge=1, le=50),
    current_user: UserProfile = Depends(get_current_user),
) -> GmMentionsResponse:
    """Return active-branch, spoiler-gated `@` mention candidates for GM Talk."""
    repo = _resolve_facade_attr("get_repo", get_repo)()
    try:
        items = search_gm_mentions(
            repo,
            campaign_id,
            current_user.id,
            category=category,
            q=q,
            limit=limit,
        )
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Campaign '{campaign_id}' not found.") from None
    return GmMentionsResponse(items=items)


@router.post("/api/campaigns/{campaign_id}/gm/chat")
async def stream_campaign_gm_chat(
    campaign_id: str,
    req: GmChatRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> StreamingResponse:
    """Stream an out-of-character Neuromancer GM Talk completion over SSE (zero campaign mutation)."""
    repo = _resolve_facade_attr("get_repo", get_repo)()
    try:
        campaign = repo.get_campaign(campaign_id, owner_id=current_user.id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Campaign '{campaign_id}' not found.") from None

    eff = _resolve_facade_attr("resolve_effective_models", resolve_effective_models)(current_user.id)
    gm_profile, gm_role = resolve_gm_profile(eff)
    gm_tools_enabled = bool(getattr(eff, "gm_tools_enabled", False))
    resolved_prompts = repo.resolve_effective_prompts(
        user_id=current_user.id,
        campaign_id=campaign_id,
    )
    origin_tab_id = relay_tab_context.get()

    async def _sse_generator() -> AsyncIterator[str]:
        user_tok = relay_user_context.set(current_user.id)
        tab_tok = relay_tab_context.set(origin_tab_id)
        try:
            prep = await build_gm_context_and_messages(
                repo,
                campaign_id=campaign_id,
                owner_id=current_user.id,
                user_message=req.message,
                mentions=req.mentions,
                working_memory_turns=eff.working_memory_turns,
                context_size=int(gm_profile.context_size or 8192),
                gm_max_tokens=gm_profile.max_tokens,
                resolved_prompts=resolved_prompts,
            )

            yield _sse_packet(
                "meta",
                {
                    "unlock_lore": prep.unlock_lore,
                    "model_role": gm_role,
                    "model": gm_profile.model,
                    "temperature": gm_profile.temperature,
                    "max_tokens": gm_profile.max_tokens,
                    "tools_enabled": gm_tools_enabled,
                    "pinned_mentions": [s.model_dump() for s in prep.pinned_sources],
                    "retrieved_sources": [s.model_dump() for s in prep.retrieved_sources],
                },
            )

            active_llm = _resolve_facade_attr("llm_client", llm_client)
            tag_filter = ReasoningTagStreamFilter()
            chunks: list[str] = []
            proposals: list[GmCodexProposal] = []
            merged_sources = list(prep.all_sources)
            run_phase1_flow = not gm_tools_enabled
            stream_messages: list[dict[str, object]] = list(prep.messages)

            if gm_tools_enabled and prep.bundle is not None:
                try:
                    async for ev_kind, ev_val in run_gm_tool_loop(
                        repo,
                        bundle=prep.bundle,
                        prep=prep,
                        gm_profile=gm_profile,
                        llm_client_override=active_llm,
                    ):
                        if ev_kind == "tool_status":
                            yield _sse_packet("tool_status", ev_val)
                        elif ev_kind == "extra_sources":
                            seen_src = {(s.kind, s.id) for s in merged_sources}
                            for src in ev_val:
                                if (src.kind, src.id) not in seen_src:
                                    seen_src.add((src.kind, src.id))
                                    merged_sources.append(src)
                        elif ev_kind == "proposals":
                            proposals = list(ev_val)
                        elif ev_kind == "final_text":
                            if ev_val:
                                chunks.append(ev_val)
                                yield _sse_packet("token", {"text": ev_val})
                        elif ev_kind == "fallback_stream":
                            stream_messages = list(ev_val)
                            # Stream final synthesis without triggering Phase 1 auto-draft twice
                            async for raw_delta in active_llm.stream_chat(
                                stream_messages,
                                profile=gm_profile,
                                disable_reasoning=True,
                            ):
                                clean_delta = tag_filter.feed(raw_delta)
                                if clean_delta:
                                    chunks.append(clean_delta)
                                    yield _sse_packet("token", {"text": clean_delta})
                            tail = tag_filter.flush()
                            if tail:
                                chunks.append(tail)
                                yield _sse_packet("token", {"text": tail})
                except ToolsUnsupportedError:
                    logger.info(
                        "GM tools unsupported for model '%s' in campaign '%s'; falling back to Phase 1.",
                        sanitize_log_value(gm_profile.model),
                        sanitize_log_value(campaign_id),
                    )
                    yield _sse_packet(
                        "notice",
                        {
                            "detail": (
                                "The active GM model or provider does not support native tools; "
                                "answered using standard GM Talk mode."
                            )
                        },
                    )
                    run_phase1_flow = True
                except (RelayUnavailableError, RelayRemoteError, asyncio.CancelledError):
                    raise
                except Exception as exc:
                    if is_offline_fallback_enabled() and not chunks:
                        run_phase1_flow = True
                    else:
                        logger.warning(
                            "GM Talk tool loop failed for campaign '%s': %s",
                            sanitize_log_value(campaign_id),
                            sanitize_log_value(type(exc).__name__),
                        )
                        yield _sse_packet(
                            "error",
                            {
                                "detail": (
                                    "Neuromancer could not generate a response. "
                                    "Check your model provider and try again."
                                )
                            },
                        )
                        return

            if run_phase1_flow:
                try:
                    async for raw_delta in active_llm.stream_chat(
                        prep.messages,
                        profile=gm_profile,
                        disable_reasoning=True,
                    ):
                        clean_delta = tag_filter.feed(raw_delta)
                        if clean_delta:
                            chunks.append(clean_delta)
                            yield _sse_packet("token", {"text": clean_delta})
                    tail = tag_filter.flush()
                    if tail:
                        chunks.append(tail)
                        yield _sse_packet("token", {"text": tail})
                except (RelayUnavailableError, RelayRemoteError, asyncio.CancelledError):
                    raise
                except Exception as exc:
                    if is_offline_fallback_enabled() and not chunks:
                        fallback = build_offline_gm_reply(req.message, prep)
                        chunks.append(fallback)
                        yield _sse_packet("token", {"text": fallback})
                    else:
                        logger.warning(
                            "GM Talk LLM stream failed for campaign '%s': %s",
                            sanitize_log_value(campaign_id),
                            sanitize_log_value(type(exc).__name__),
                        )
                        yield _sse_packet(
                            "error",
                            {"detail": "Neuromancer could not generate a response. Check your model provider and try again."},
                        )
                        return

            assistant_text = "".join(chunks).strip()
            if not assistant_text and not proposals:
                if is_offline_fallback_enabled():
                    assistant_text = build_offline_gm_reply(req.message, prep)
                    yield _sse_packet("token", {"text": assistant_text})
                else:
                    yield _sse_packet(
                        "error",
                        {"detail": "Neuromancer returned an empty response. Try rephrasing or adjusting max tokens."},
                    )
                    return

            if not assistant_text and proposals:
                assistant_text = (
                    f"I've prepared a tentative World Codex entry for **{proposals[0].draft.title}**. "
                    "Review or edit it below and confirm when ready."
                )
                yield _sse_packet("token", {"text": assistant_text})

            anchor_turn_id = prep.bundle.campaign.active_leaf_turn_id if prep.bundle else campaign.active_leaf_turn_id
            pinned_refs = [
                ref
                for ref in req.mentions[:10]
                if any(s.kind == ref.kind and s.id == ref.id for s in prep.pinned_sources)
            ]

            if run_phase1_flow and detect_explicit_codex_add_intent(req.message):
                try:
                    proposal = await draft_world_codex_proposal(
                        repo,
                        campaign_id=campaign_id,
                        owner_id=current_user.id,
                        gm_profile=gm_profile,
                        resolved_prompts=resolved_prompts,
                        user_instruction=req.message,
                        recent_exchange=(req.message, assistant_text),
                        llm_client_override=active_llm,
                    )
                    proposals.append(proposal)
                except (RelayUnavailableError, RelayRemoteError, asyncio.CancelledError):
                    raise
                except Exception as draft_exc:
                    logger.warning(
                        "GM Talk auto Codex draft failed for campaign '%s': %s",
                        sanitize_log_value(campaign_id),
                        sanitize_log_value(type(draft_exc).__name__),
                    )

            user_msg, asst_msg = repo.append_gm_message_pair(
                campaign_id=campaign_id,
                anchor_turn_id=anchor_turn_id,
                user_content=req.message,
                user_mentions=pinned_refs,
                assistant_content=assistant_text,
                sources=merged_sources,
                assistant_proposals=proposals,
            )
            for prop in proposals:
                yield _sse_packet(
                    "codex_proposal",
                    {
                        "message_id": asst_msg.id,
                        "proposal": prop.model_dump(),
                    },
                )
            yield _sse_packet(
                "done",
                {
                    "user_message": user_msg.model_dump(),
                    "assistant_message": asst_msg.model_dump(),
                },
            )
        except RelayUnavailableError:
            logger.warning("GM Talk relay offline for campaign '%s'", sanitize_log_value(campaign_id))
            yield _sse_packet(
                "error",
                {
                    "detail": (
                        "Browser inference relay is not connected. Keep this browser tab open "
                        "and check your Local Ollama or WebGPU provider in Profile."
                    )
                },
            )
        except RelayRemoteError as exc:
            logger.warning(
                "GM Talk browser driver error (%s) for campaign '%s'",
                sanitize_log_value(exc.code),
                sanitize_log_value(campaign_id),
            )
            msg = _RELAY_ERROR_MESSAGES.get(exc.code, _RELAY_ERROR_MESSAGES["inference_failed"])
            yield _sse_packet("error", {"detail": msg})
        except asyncio.CancelledError:
            # Client cancelled/aborted mid-stream: discard incomplete pair cleanly.
            return
        except Exception as exc:
            logger.warning(
                "GM Talk stream setup failed for campaign '%s': %s",
                sanitize_log_value(campaign_id),
                sanitize_log_value(type(exc).__name__),
            )
            yield _sse_packet(
                "error",
                {"detail": "GM response failed. Check your campaign state and model settings."},
            )
        finally:
            relay_tab_context.reset(tab_tok)
            relay_user_context.reset(user_tok)

    return StreamingResponse(
        _sse_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/api/campaigns/{campaign_id}/gm/codex-draft", response_model=GmCodexDraftResponse)
async def draft_campaign_gm_codex_entry(
    campaign_id: str,
    req: GmCodexDraftRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> GmCodexDraftResponse:
    """Draft a tentative campaign World Codex entry from a Neuromancer GM Talk message."""
    repo = _resolve_facade_attr("get_repo", get_repo)()
    try:
        bundle = repo.get_campaign_state_bundle(campaign_id, owner_id=current_user.id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Campaign '{campaign_id}' not found.") from None

    valid_turn_ids = {t.id for t in bundle.active_branch_turns}
    branch_msgs = repo.list_gm_messages_for_branch(campaign_id, valid_turn_ids)
    target_msg_id = req.message_id
    if not target_msg_id:
        asst_msgs = [m for m in branch_msgs if m.role == "assistant"]
        if not asst_msgs:
            raise HTTPException(
                status_code=400,
                detail="No Neuromancer GM message is available on this branch to draft from.",
            )
        target_msg_id = asst_msgs[-1].id

    eff = _resolve_facade_attr("resolve_effective_models", resolve_effective_models)(current_user.id)
    gm_profile, _ = resolve_gm_profile(eff)
    resolved_prompts = repo.resolve_effective_prompts(
        user_id=current_user.id,
        campaign_id=campaign_id,
    )
    active_llm = _resolve_facade_attr("llm_client", llm_client)
    origin_tab_id = relay_tab_context.get()

    user_tok = relay_user_context.set(current_user.id)
    tab_tok = relay_tab_context.set(origin_tab_id)
    try:
        proposal = await draft_world_codex_proposal(
            repo,
            campaign_id=campaign_id,
            owner_id=current_user.id,
            gm_profile=gm_profile,
            resolved_prompts=resolved_prompts,
            target_message_id=target_msg_id,
            user_instruction=req.instruction,
            llm_client_override=active_llm,
        )
        repo.attach_gm_message_proposal(campaign_id, target_msg_id, proposal)
        return GmCodexDraftResponse(message_id=target_msg_id, proposal=proposal)
    except KeyError:
        raise HTTPException(status_code=404, detail="Target GM message was not found on the active branch.") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RelayUnavailableError:
        raise HTTPException(
            status_code=503,
            detail=(
                "Browser inference relay is not connected. Keep this browser tab open "
                "and check your Local Ollama or WebGPU provider in Profile."
            ),
        ) from None
    except RelayRemoteError as exc:
        msg = _RELAY_ERROR_MESSAGES.get(exc.code, _RELAY_ERROR_MESSAGES["inference_failed"])
        raise HTTPException(status_code=502, detail=msg) from None
    except Exception as exc:
        logger.warning(
            "GM Codex draft failed for campaign '%s': %s",
            sanitize_log_value(campaign_id),
            sanitize_log_value(type(exc).__name__),
        )
        raise HTTPException(
            status_code=502,
            detail="Neuromancer could not draft a Codex entry. Check your model provider and try again.",
        ) from None
    finally:
        relay_tab_context.reset(tab_tok)
        relay_user_context.reset(user_tok)


@router.patch("/api/campaigns/{campaign_id}/gm/proposals/{proposal_id}")
def update_campaign_gm_proposal(
    campaign_id: str,
    proposal_id: str,
    req: GmProposalActionRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> dict[str, object]:
    """Update a pending GM Codex proposal status (e.g. deterministic cancellation)."""
    repo = _resolve_facade_attr("get_repo", get_repo)()
    try:
        repo.get_campaign(campaign_id, owner_id=current_user.id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Campaign '{campaign_id}' not found.") from None

    updated = repo.update_gm_proposal_status(campaign_id, proposal_id, req.status)
    if updated is None:
        raise HTTPException(status_code=404, detail="GM Codex proposal was not found.")
    return {"proposal": updated.model_dump()}
