---
feature: gm-agentic-tools
target_version: 0.34.0
document_type: plan
status: completed
last_updated: 2026-11-23
---

# Implementation Plan — v0.34.0 Phase 2: Native GM Tool Calling & Read-Only Tools

## Stage 0: Feature Lifecycle Artifacts
- [x] Author `REVIEW.md`
- [x] Author `PLAN.md`
- [x] Mark Phase 2 in progress in `../0.33.0-gm-codex-authoring-and-tools/FRD.md`

## Stage 1: Backend Tool Schemas & Provider-Agnostic Tool Calling
- [x] Create leaf schema module `backend/app/schemas/llm_tools.py` (`LlmToolDefinition`, `LlmToolCall`, `LlmToolCompletionResult`)
- [x] Extend `OpenAICompatProvider.build_chat_payload` (`backend/app/providers/openai_compat.py`) and `LocalRelayHub` (`backend/app/providers/local_relay.py`) for `tools` / `tool_calls`
- [x] Add `ToolsUnsupportedError`, wire message formatters, `_parse_tool_calls`, and `LLMClient.complete_with_tools` in `backend/app/engine/llm_client.py`

## Stage 2: Capability Toggle (`gm_tools_enabled`) Across Settings & Profile UI
- [x] Add `gm_tools_enabled` across `config.py`, `schema.sql`, `schema_init.py`, `auth_users.py`, `schemas/auth.py`, `dependencies.py`, `routers/settings.py`, and `schemas/gm.py`
- [x] Add `gmToolsEnabled` across `frontend/src/types/auth.ts`, `profilePreferences.ts`, `ProfilePreferencesTab.tsx`, and **`GM Agentic Tools`** toggle in `ProfileBehaviorCards.tsx`

## Stage 3: GM Toolset, Bounded Loop & Route Integration
- [x] Create `backend/app/engine/gm_tools.py` (5 spoiler-gated read-only tools + `propose_world_lore_entry` + `run_gm_tool_loop`) and register `app.engine.gm_tools` in `backend/tach.toml`
- [x] Integrate `gm_tools_enabled`, `tool_status`, `notice`, and Round-1 `ToolsUnsupportedError` fallback in `backend/app/routers/campaign_routes/gm_routes.py`

## Stage 4: Frontend Browser Drivers, GM Talk UI & Styles
- [x] Extend `frontend/src/local/{types,ollamaDriver,remoteProviderDriver,webgpuDriver}.ts` and `LocalRelayContext.tsx` for `tools` / `tool_calls` / `tools_unsupported`
- [x] Extend `frontend/src/types/gm.ts`, `frontend/src/api/gm.ts`, `useGmTalk.ts`, `GmTalkDrawer.tsx`, `ChatStage.tsx`, and `05-composer-and-slash.css` (`toolStatus`, `toolNotice`, `Tools` badge)

## Stage 5: Tests, Architecture Docs, Wiki & Finalization
- [x] Add `backend/tests/test_gm_tools.py` and run `ruff check`, `tach check`, `pytest`
- [x] Extend `frontend/src/components/__tests__/gmTalkUi.test.tsx`, `profileModalUi.test.tsx`, and `frontend/src/local/__tests__/browserDrivers.test.ts`; run `arch:check`, `css:audit`, `build`, `test`
- [x] Regenerate and `--check` architecture docs (`scripts/generate_arch_docs.py`)
- [x] Update `../cybercantina-wiki` (`Playing-Directing-and-Mechanics.md`, `Providers-Models-and-Embeddings.md`)
- [x] Finalize Phase 2 statuses in `FRD.md`, `PLAN.md`, and update `walkthrough.md`
