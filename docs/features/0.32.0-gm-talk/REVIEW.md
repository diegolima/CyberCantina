---
feature: gm-talk
target_version: 0.32.0
document_type: review
status: approved
last_updated: 2026-11-23
---

# Pre-Implementation Review — v0.32.0 GM Talk ("Neuromancer")

## Key Architectural Traps & Mitigations

1. **Unified 3-Layer `unlock_lore` Spoiler Gating:**
   - Spoiler safety is governed exclusively by `campaign.world_settings.unlock_lore` (**Unlock Lore & Secrets (GM Mode)**).
   - When `unlock_lore` is `False`, unrevealed `secret` lore entries (`category == "secret"` and not in `world_snapshot.revealed_lore_ids`), unvisited locations/containers, and private `<cognition>` / internal CARE values must be filtered uniformly across **three** independent layers:
     1. **Default context assembly** (`<party>`, `<recent_turns>`, `<current_scene>`),
     2. **Pre-turn hybrid RAG** (vector retrieval + keyword fallback),
     3. **`@` mention live search & server-side pin resolution** (`GET /gm/mentions` and `POST /gm/chat` `mentions`).
   - Meanwhile, `secret` entries already in the active branch's `world_snapshot.revealed_lore_ids` remain visible so players can discuss uncovered clues.

2. **`vector_entries` Secret Exclusion When `unlock_lore = True`:**
   - By v0.31.0 design, `secret` lore nodes are intentionally excluded from `vector_entries`. When `unlock_lore` is `True`, pre-turn retrieval in `app.engine.gm_talk` must also run keyword/tag matching directly over active-branch `lore_nodes` so hidden secrets are retrievable without requiring explicit `@` mentions.

3. **Branch-Safe GM Chat Persistence (`anchor_turn_id`):**
   - `gm_chat_messages` carries `anchor_turn_id TEXT NULL REFERENCES turn_nodes(id) ON DELETE CASCADE`.
   - Reads (`GET /gm/messages`), prompts (prior GM history), and `Clear Chat` (`DELETE /gm/messages`) filter strictly to `(anchor_turn_id IS NULL OR anchor_turn_id IN valid_branch_turn_ids)`, preserving sibling branches and rolling back automatically on turn deletion/rewind.
   - `.zcc` v2 export includes `gm_chat_messages` only when `include_gm_chat=True` (default `False`), filtering by exported turn chain on `timeline_scope == "active"` and remapping `anchor_turn_id` on import.

4. **Browser Ollama / WebGPU Relay Inside SSE Streaming:**
   - `llm_client.stream_chat` already routes `browser_ollama`, `webgpu`, and browser-credential providers over `local_relay_hub.stream(...)` using `relay_user_context` + `relay_tab_context`.
   - In `POST /api/campaigns/{campaign_id}/gm/chat`, `tab_id = relay_tab_context.get()` must be captured before returning `StreamingResponse` and both `relay_user_context` and `relay_tab_context` must be bound inside `_sse_generator()` (and reset in `finally`) so async streaming runs on the originating tab's WebSocket relay session.

5. **Zero-Mutation & Ollama Reload Prevention:**
   - GM Talk never runs Phase 1–5, never writes `turn_nodes` or snapshots, and `resolve_gm_profile` only overrides `temperature` and `max_tokens` on the resolved `actor` or `clerk` `ModelProfile`—preserving `context_size`, `model`, and `keep_alive_minutes` so Ollama never evicts/reloads weights mid-session.

6. **Layer Boundaries, Security & CSS Hygiene:**
   - Keep `backend/app/schemas/gm.py` and `frontend/src/types/gm.ts` strictly leaf modules (`tach check`, `arch:check`).
   - Strip leaked `<think>` / `<thought>` / `<reasoning>` / `<scratchpad>` blocks via a linear `.find()` / stateful stream filter (no polynomial ReDoS regexes), sanitize dynamic log strings with `sanitize_log_value`, and never return raw `str(exc)` in SSE error payloads.
   - Keep `onOpenGmTalk` optional on `ChatComposerProps` so existing component tests continue to pass, insert `/gm` alphabetically between `event` and `help` in `SLASH_COMMANDS`, and keep all new CSS classes referenced in TSX and placed before `15-responsive.css` (`css:audit`).
