---
feature: turn-prose-model-pill
target_version: 0.35.0
document_type: review
status: approved
last_updated: 2026-11-23
---

# Pre-Implementation Review — v0.35.0 Turn Prose Model Pill, Latency Popover & Prose Icon Alignment

## Key Architectural Traps & Mitigations

1. **Missing `provider_id` on Server-Side `CallTarget` Paths (`llm_client.py`):**
   - `build_call_target()` in `backend/app/engine/llm_client.py` previously passed `provider_id=endpoint.provider_id` only on the browser/WebGPU branch, leaving `provider_id=None` on server-side `openai_compat` and native `ollama` branches.
   - `ResolvedEndpoint` (`backend/app/providers/endpoint.py`) must remain a leaf dataclass (zero `app.*` imports), carrying optional `provider_name: str | None = None` and `provider_color: str = "neutral"` populated in `resolve_endpoint()`, and `build_call_target()` must propagate `provider_id`, `provider_name`, and `provider_color` across **all** resolved branches.

2. **OpenAI-Compatible Streaming Fallback Model Attribution (`stream_chat`):**
   - When an OpenAI-compatible provider (e.g., AI Horde) falls back via `active_payload["model"] = fallback`, `_record_llm_telemetry()` previously received `profile=active_profile` and logged the requested model rather than the fallback model that actually generated the prose.
   - `_record_llm_telemetry()` must accept `model_override: str | None = None` and OpenAI-compat call sites must pass `str(active_payload.get("model") or active_profile.model)`. Streaming attempts must also cleanly reset `first_token_at`, `oai_stream_parts`, and `oai_cost_usd` per attempt when retrying HTTP 400 / fallback requests.

3. **Strict Numeric & Boolean Coercion (`eval_duration_ms`, `cost_usd`):**
   - In Python, `isinstance(True, (int, float))` evaluates to `True`, and JSON payloads from external APIs can include `NaN`, `Infinity`, or negative values.
   - Both `local_relay.py` (`_coerce_opt_float`, `_coerce_opt_int`) and `llm_client.py` (`_ns_to_ms`, `_coerce_opt_cost_usd`) must explicitly reject `bool`, `None`, non-finite floats, and negative values; browser drivers (`ollamaDriver.ts`, `remoteProviderDriver.ts`, `LocalRelayContext.tsx`) must apply matching `Number.isFinite` and `>= 0` guards.

4. **Turn Card Stacking Context & Mobile Popover Containment (`frontend/AGENTS.md`):**
   - `.turn-feed` stacks `.turn-card` elements vertically in DOM order. An anchored popover inside an earlier turn card will sit behind subsequent `.turn-card` elements (or clip behind the sticky composer) unless the host `.turn-card` elevates its stacking context when open (`.turn-card--popover-open { position: relative; z-index: var(--z-card-popover-host); }`) and the popover opens upward (`bottom: calc(100% + 8px)`).
   - At `@media (max-width: 620px)` (`15-responsive.css`), switching `.turn-model-pill-anchor` to `position: static` and anchoring `.turn-model-popover` to `.turn-card-footer-row` (`left: 0; right: 0; width: auto;`) guarantees zero horizontal clipping regardless of where the icon-only pill wraps.

5. **Backward-Compatible `TurnCardProps` & Node-Only Vitest Constraints:**
   - Six existing SSR test suites (`turnBookmarks.test.tsx`, `branchGraphAndStory.test.tsx`, `emptyRoomSolo.test.tsx`, `worldMedia.test.tsx`, `personaParity.test.tsx`, `firstVisitDescriptions.test.tsx`) render `<TurnCard />` directly without `ChatStage` state. All new props on `TurnCardProps` must remain optional with local fallback state when uncontrolled.
   - Vitest runs in Node without `jsdom` or `@testing-library/react`; keep speed, duration, cost, and label logic in pure TypeScript (`proseTelemetryHelpers.ts`) and pair unit tests with `ReactDOMServer.renderToStaticMarkup` assertions.

6. **Layer Boundaries & CSS Hygiene:**
   - `backend/app/schemas/telemetry.py` may import `ProviderColor` from sibling leaf schema `app.schemas.provider`, verified with `tach check`.
   - `frontend/src/types/telemetry.ts` imports only `import type { ProviderColor } from "./providers"` (`dependency-cruiser` `arch:check` compliant).
   - Styles reside strictly in `04-chat-and-turns.css` and `15-responsive.css` using `00-tokens.css` variables and zero `!important` rules (`css:audit` compliant).
