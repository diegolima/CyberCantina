---
feature: gm-agentic-tools
target_version: 0.34.0
document_type: review
status: approved
last_updated: 2026-11-23
---

# Pre-Implementation Review — v0.34.0 Phase 2: Native GM Tool Calling & Read-Only Tools

## Key Architectural Traps & Mitigations

1. **Ollama `/api/chat` vs. OpenAI `/v1/chat/completions` Tool Wire Mismatch:**
   - Native Ollama `/api/chat` sends `assistant.tool_calls[*].function.arguments` as a JSON object (`dict`), and expects `role: "tool"` messages with `tool_name` + string `content`.
   - OpenAI-compatible `/v1/chat/completions` sends `assistant.tool_calls[*].function.arguments` as a JSON string (`str`), requires a non-empty `id` (`tool_call_id`), and expects `role: "tool"` messages with `tool_call_id`, `name`, and string `content`.
   - `llm_client.complete_with_tools` normalizes canonical internal messages into the wire format required by each backend/driver (`_format_messages_for_ollama_tools`, `_format_messages_for_openai_tools`, `_parse_tool_calls`), synthesizing `call_<hex>` IDs when absent.

2. **Graceful `ToolsUnsupportedError` Fallback Without Breaking OOC Q&A:**
   - Not all local GGUF Jinja templates, `webgpu` models, `aihorde` workers, or prose-only fine-tunes support `tools`.
   - `complete_with_tools` immediately raises `ToolsUnsupportedError` for `webgpu`/`aihorde`, and detects HTTP 400/422 tool-unsupported errors from Ollama/OpenAI-compat/Browser Relay.
   - When `ToolsUnsupportedError` occurs on Round 1 of `run_gm_tool_loop`, `gm_routes.py` emits a gentle `event: notice` and falls through seamlessly to Phase 1 (`stream_chat` + `detect_explicit_codex_add_intent`), preserving the user's message and reply.

3. **Single-Read Fetch Response Body in Browser Drivers:**
   - Browser `fetch()` `Response.text()` streams can only be consumed once. Both `ollamaDriver.ts` and `remoteProviderDriver.ts` must read `await resp.text()` once on HTTP 400/422 and inspect the cached string for both retry handling (`think`/`reasoning`) and `tools_unsupported` classification.

4. **Strict 3-Layer Spoiler Gating Inside Every Read Tool:**
   - All 5 read-only tools (`search_world_codex`, `get_world_codex_entry`, `search_campaign_turns`, `get_campaign_turns`, `get_campaign_entity`) execute against `_compute_branch_visibility(bundle)`.
   - When `unlock_lore === false`, unvisited locations/containers, unrevealed `secret` lore, private `<cognition>`, and CARE/core-drive/memory-shard fields are never returned or added to `GmSourceRef` attributions.

5. **Human-Confirmed Write Boundary & Runaway Loop Caps:**
   - `propose_world_lore_entry` never writes to SQLite; it validates through `GmWorldLoreDraftLLMOutput` -> `WorldLoreNodeDraft`, runs `find_world_codex_duplicates` (flagging base-world entries requiring GM Mode), caps at `MAX_GM_PROPOSALS_PER_TURN = 3`, and emits the Phase 1 `GmCodexProposal` card.
   - `run_gm_tool_loop` caps rounds at `MAX_GM_TOOL_ROUNDS = 4` and total tool calls at `MAX_GM_TOOL_CALLS_PER_TURN = 6`, handing off to a final `stream_chat` synthesis pass if the cap is reached.

6. **Layer Boundaries, Hygiene & Optional Component Props:**
   - Tool DTOs live in leaf `backend/app/schemas/llm_tools.py` and `app.engine.gm_tools` is declared in `backend/tach.toml`.
   - Never leak raw `str(exc)` in SSE `notice`/`error` payloads; sanitize dynamic log values via `sanitize_log_value`; keep new `GmTalkDrawerProps` optional for test parity and ensure new CSS classes are referenced in TSX (`css:audit`).
