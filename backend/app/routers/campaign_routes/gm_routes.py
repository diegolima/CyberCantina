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
from app.engine.gm_talk import (
    ReasoningTagStreamFilter,
    build_gm_context_and_messages,
    build_offline_gm_reply,
    is_offline_fallback_enabled,
    search_gm_mentions,
)
from app.engine.llm_client import llm_client
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
    GmMentionCategory,
    GmMentionsResponse,
    GmMessagesResponse,
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
                    "pinned_mentions": [s.model_dump() for s in prep.pinned_sources],
                    "retrieved_sources": [s.model_dump() for s in prep.retrieved_sources],
                },
            )

            tag_filter = ReasoningTagStreamFilter()
            chunks: list[str] = []
            try:
                active_llm = _resolve_facade_attr("llm_client", llm_client)
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
            except (RelayUnavailableError, RelayRemoteError):
                raise
            except asyncio.CancelledError:
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
            if not assistant_text:
                if is_offline_fallback_enabled():
                    assistant_text = build_offline_gm_reply(req.message, prep)
                    yield _sse_packet("token", {"text": assistant_text})
                else:
                    yield _sse_packet(
                        "error",
                        {"detail": "Neuromancer returned an empty response. Try rephrasing or adjusting max tokens."},
                    )
                    return

            anchor_turn_id = prep.bundle.campaign.active_leaf_turn_id if prep.bundle else campaign.active_leaf_turn_id
            pinned_refs = [
                ref
                for ref in req.mentions[:10]
                if any(s.kind == ref.kind and s.id == ref.id for s in prep.pinned_sources)
            ]
            user_msg, asst_msg = repo.append_gm_message_pair(
                campaign_id=campaign_id,
                anchor_turn_id=anchor_turn_id,
                user_content=req.message,
                user_mentions=pinned_refs,
                assistant_content=assistant_text,
                sources=prep.all_sources,
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
