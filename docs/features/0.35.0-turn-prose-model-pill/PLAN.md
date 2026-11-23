---
feature: turn-prose-model-pill
target_version: 0.35.0
document_type: plan
status: completed
last_updated: 2026-11-23
---

# Implementation Plan — v0.35.0 Turn Prose Model Pill, Latency Popover & Prose Icon Alignment

## Step 1: Feature Package Lifecycle Docs
- [x] Author `FRD.md` (updated for passive `usage.cost` capture & `ContextHealthModal` `Time` column)
- [x] Author `REVIEW.md`
- [x] Author `PLAN.md`

## Step 2: Backend Schemas, Provider Resolution & Telemetry Capture
- [x] Extend `LlmCallTelemetry` in `backend/app/schemas/telemetry.py` (`provider_id`, `provider_name`, `provider_color`, `ttft_ms`, `eval_duration_ms`, `cost_usd`)
- [x] Extend `ResolvedEndpoint` (`backend/app/providers/endpoint.py`) and `resolve_endpoint` (`backend/app/providers/resolver.py`) with `provider_name` and `provider_color`
- [x] Add `eval_duration_ms` and passive `cost_usd` parsing in `backend/app/providers/local_relay.py`
- [x] Propagate `provider_id`, `provider_name`, `provider_color` across all `build_call_target` branches and record `ttft_ms`, `eval_duration_ms`, passive `cost_usd`, and `model_override` in `backend/app/engine/llm_client.py`

## Step 3: Frontend Browser Relay Passthrough
- [x] Add `eval_duration_ms` and `cost_usd` to `RelayDriverResult` in `frontend/src/local/types.ts`
- [x] Extract `eval_duration` → `eval_duration_ms` in `frontend/src/local/ollamaDriver.ts`
- [x] Extract `eval_duration_ms` (Ollama NDJSON) and passive `usage.cost` → `cost_usd` (OpenAI SSE / non-streaming) in `frontend/src/local/remoteProviderDriver.ts`
- [x] Forward `eval_duration_ms` and `cost_usd` in `llm.done` WebSocket messages inside `frontend/src/providers/LocalRelayContext.tsx`

## Step 4: Frontend Telemetry Types, Helpers & Turn Prose Pill UI
- [x] Mirror additive telemetry fields on `LlmCallTelemetry` in `frontend/src/types/telemetry.ts`
- [x] Create pure helper module `frontend/src/components/chat/proseTelemetryHelpers.ts`
- [x] Create `frontend/src/components/chat/TurnProseModelPill.tsx` with anchored popover (`Escape`/outside-click dismissal, cost slot, `"Inspect all 4 phases"` link)
- [x] Wire optional popover & turn-scoped `ContextHealthModal` props through `frontend/src/components/chat/TurnCard.tsx` and `frontend/src/components/ChatStage.tsx`
- [x] Add `Time` column (`formatDurationMs(c.duration_ms)`) to `frontend/src/components/chat/ContextHealthModal.tsx`

## Step 5: Prose vs. Cognition Icon Alignment
- [x] Update `role === "actor"` watermark icon from `Brain` to `Feather` in `frontend/src/components/models/ModelCard.tsx` (preserving `Brain` strictly for Cognition)

## Step 6: Modular Stylesheets & Responsive Rules
- [x] Add `.turn-card--popover-open`, `.turn-card-footer-row`, `.turn-model-pill*`, and `.turn-model-popover*` styles in `frontend/src/styles/04-chat-and-turns.css`
- [x] Add `<= 620px` icon-only collapse, tap-target padding, full-width mobile popover clamping, and `prefers-reduced-motion` coverage in `frontend/src/styles/15-responsive.css`

## Step 7: Tests
- [x] Extend `backend/tests/test_turn_telemetry.py`
- [x] Create `frontend/src/components/__tests__/turnProseModelPill.test.tsx` and extend `contextHealth.test.tsx`, `browserDrivers.test.ts`, and `browserCredentialVaultAndDriver.test.ts`

## Step 8: Architecture Docs, Wiki & Finalization
- [x] Regenerate and `--check` architecture docs (`scripts/generate_arch_docs.py`)
- [x] Update sibling wiki pages in `../cybercantina-wiki/`
- [x] Run full backend & frontend verification checks and mark feature docs `completed`
