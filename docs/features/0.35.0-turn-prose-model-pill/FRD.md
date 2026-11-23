---
feature: turn-prose-model-pill
target_version: 0.35.0
document_type: frd
status: completed
last_updated: 2026-11-23
---

# Feature Requirements Document (FRD)
## Turn Prose Model Pill, Latency Popover & Prose Icon Alignment

**Status:** Completed  
**Target Version:** CyberCantina v0.35.0  
**Scope:**
- Backend Telemetry & Provider Attribution ([`backend/app/schemas/telemetry.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/telemetry.py), [`backend/app/providers/endpoint.py`](file:///home/diegolima/Git/cybercantina/backend/app/providers/endpoint.py), [`backend/app/providers/resolver.py`](file:///home/diegolima/Git/cybercantina/backend/app/providers/resolver.py), [`backend/app/providers/local_relay.py`](file:///home/diegolima/Git/cybercantina/backend/app/providers/local_relay.py), [`backend/app/engine/llm_client.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/llm_client.py))
- Frontend Browser Relay Telemetry Passthrough ([`frontend/src/local/types.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/local/types.ts), [`frontend/src/local/ollamaDriver.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/local/ollamaDriver.ts), [`frontend/src/local/remoteProviderDriver.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/local/remoteProviderDriver.ts), [`frontend/src/providers/LocalRelayContext.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/providers/LocalRelayContext.tsx))
- Frontend Telemetry Types & Formatting Helpers ([`frontend/src/types/telemetry.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/telemetry.ts), [`frontend/src/components/chat/proseTelemetryHelpers.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/proseTelemetryHelpers.ts))
- Frontend Turn Card Pill, Anchored Telemetry Popover & Modal Timing ([`frontend/src/components/chat/TurnProseModelPill.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/TurnProseModelPill.tsx), [`frontend/src/components/chat/TurnCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/TurnCard.tsx), [`frontend/src/components/ChatStage.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ChatStage.tsx), [`frontend/src/components/chat/ContextHealthModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/ContextHealthModal.tsx))
- Frontend Prose Icon Alignment ([`frontend/src/components/models/ModelCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/models/ModelCard.tsx))
- Frontend Styles & Responsive Rules ([`frontend/src/styles/04-chat-and-turns.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles/04-chat-and-turns.css), [`frontend/src/styles/15-responsive.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles/15-responsive.css))
- User-Facing Wiki Documentation (`../cybercantina-wiki`)

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
While CyberCantina captures per-turn LLM telemetry in `turn_nodes.telemetry_json` (introduced in v0.27.0), three usability and observability gaps remain:

1. **No Per-Turn Model Provenance in the Chat Stream:** Players comparing swipes (`v1`, `v2`, …) or switching providers/models mid-campaign cannot see which model or provider generated a specific turn's prose without opening external logs or inspecting raw DB rows.
2. **Global-Only Telemetry Surface Without Performance Metrics:** The top-bar `ContextHealthPill` only inspects the active branch's *latest* turn, and `ContextHealthModal` omits response generation latency and throughput (`tokens/s`) even though `duration_ms` and token counts are already captured.
3. **Icon Semantic Collision (`Brain`):** [ModelCard.tsx](file:///home/diegolima/Git/cybercantina/frontend/src/components/models/ModelCard.tsx#L231-L238) currently uses `Brain` as the watermark icon for the Primary/Actor (prose) model across Admin Settings and User Profile, while `TurnCard`, `LiveStreamingTurnCard`, `promptRoleDefinitions.ts`, and Character Inspector modals use `Brain` for **Cognition** (Phase 3 inner thoughts & psychology). Reusing `Brain` on a turn-card prose pill would collide visually with the Cognition toggle directly above it.

### 1.2 Proposed Solution
Introduce a **Turn Prose Model Pill** and **Anchored Telemetry Popover** on turn cards, paired with a codebase-wide **Prose vs. Cognition icon separation**:

1. **Prose Model Pill in Turn Footer:** Render a compact pill immediately to the right of `world_timestamp` in [TurnCard.tsx](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/TurnCard.tsx#L1161-L1164) showing a prose-specific icon (`Feather`) and the truncated model name, shaded with the provider's configured color (`neutral` | `cyan` | `purple` | `indigo` | `bronze`). On small screens (`<= 620px`), collapse the pill to the icon only.
2. **Anchored Generation Metrics Popover:** Clicking the pill opens a lightweight anchored popover displaying the full untruncated model ID, provider name, total generation time, time-to-first-token (TTFT) and decode throughput (`tok/s`) when available, token summary, and an extensible section for future per-response metadata (such as estimated/actual cost), plus a drill-down link into `ContextHealthModal` for that turn.
3. **Prose Icon Alignment (`Feather`):** Replace `Brain` with `Feather` for the Primary/Prose (`actor`) model card in [ModelCard.tsx](file:///home/diegolima/Git/cybercantina/frontend/src/components/models/ModelCard.tsx#L231-L238) (shared by both Admin Settings and User Profile model pages), reserving `Brain` strictly for Cognition references.

---

## 2. Scope, Boundaries & Core Invariants

1. **Snapshot Attribution (Branch-Safe & Portable):** Provider identity (`provider_id`, `provider_name`, `provider_color`) and model ID must be snapshotted inside `LlmCallTelemetry` at generation time rather than resolved dynamically from `ProvidersContext` at render time. Historical turns, deleted/recolored providers, non-admin views of system providers, and `.zcc` campaign imports/exports must retain accurate pill labels and shading.
2. **Backward Compatibility:**
   - All new fields on `LlmCallTelemetry` (`provider_id`, `provider_name`, `provider_color`, `ttft_ms`, `eval_duration_ms`, `cost_usd`) must be optional with safe defaults (`None`) so existing `turn_nodes.telemetry_json` rows deserialize cleanly without a SQLite schema migration.
   - Turns without `phase4_prose` telemetry (Turn `#0` root greetings, legacy pre-v0.27.0 turns, `__arrival__` cards, and offline-simulated fallback responses) must omit the pill gracefully.
3. **Honest Throughput Math:** `tokens/s` must never fabricate precision from total request latency when prompt evaluation or queue wait dominates, or when token counts are estimated. Decode speed and end-to-end throughput rules are strictly defined in FR-1.3 and FR-3.2.
4. **No Layout Reflow on Toggle:** Clicking the pill must not push adjacent footer badges (`★ notable_event_summary`, `.agent-pills-row`, swipe/action buttons) horizontally or wrap the footer. The details UI opens as an anchored overlay popover with viewport-safe clamping on small screens.
5. **Leaf Schema & Architecture Compliance:** Backend DTO additions live in the leaf module [`backend/app/schemas/telemetry.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/telemetry.py) (`tach check` compliant). Pure formatting and `tok/s` calculation helpers live outside DOM components so Vitest (Node-only) can unit-test them directly.
6. **Out of Scope for v0.35.0:**
   - Maintaining hardcoded per-model pricing tables or estimating USD cost when a provider does not natively report it (v0.35.0 passively captures native `usage.cost` when returned, such as by OpenRouter).
   - Separate footer pills for Phase 1, Phase 3, or Phase 5 calls (those remain inspectable via `ContextHealthModal`).
   - Database column migrations on `turn_nodes` (existing `telemetry_json TEXT NULL` column is reused).

---

## 3. Functional Requirements

### FR-1: Backend Telemetry Attribution & Timing Capture

#### 1.1 Additive Fields on `LlmCallTelemetry`
Extend `LlmCallTelemetry` in [`backend/app/schemas/telemetry.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/telemetry.py#L23-L38) (and mirror in [`frontend/src/types/telemetry.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/telemetry.ts)) with optional backward-compatible fields:
- `provider_id: str | None = None` — Provider record ID at call time.
- `provider_name: str | None = None` — Snapshot of provider display name at call time (e.g., `"Local Ollama"`, `"OpenRouter"`).
- `provider_color: Literal["neutral", "cyan", "purple", "indigo", "bronze"] | None = None` — Snapshot of `LLMProvider.color` at call time.
- `ttft_ms: int | None = Field(default=None, ge=0)` — Time to first non-empty streamed content delta in milliseconds (for streaming calls).
- `eval_duration_ms: int | None = Field(default=None, ge=0)` — Provider-reported decode duration in milliseconds when supplied natively (e.g., Ollama `eval_duration` nanoseconds converted to ms).
- `cost_usd: float | None = Field(default=None, ge=0.0)` — Passively captured provider-reported call cost in USD (e.g., OpenRouter `usage.cost`), or `None` when not supplied by the provider.

#### 1.2 Complete Provider Metadata Propagation
- Propagate `provider_id`, `provider_name`, and `provider_color` through `ResolvedEndpoint` ([`backend/app/providers/endpoint.py`](file:///home/diegolima/Git/cybercantina/backend/app/providers/endpoint.py)) and `CallTarget` ([`backend/app/engine/llm_client.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/llm_client.py#L442-L484)) for **all** provider paths (`ollama`, `openai_compat`, `openrouter`, `nanogpt`, `aihorde`, `browser_ollama`, `webgpu`), fixing the current gap where server-side OpenAI-compat and Ollama `CallTarget` instances omit `provider_id`.
- For legacy profile-only calls without a `provider_id`, leave `provider_id = None`, `provider_name = None`, and `provider_color = "neutral"`.

#### 1.3 Effective Fallback Model & Stream Timing Accuracy
- **Fallback Model Fix:** In `LLMClient.stream_chat` ([`llm_client.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/llm_client.py#L1485-L1529)), when an OpenAI-compatible provider (e.g., AI Horde) falls back to an alternate model (`active_payload["model"] = fallback`), `_record_llm_telemetry` must record the **actual executed model** (`active_payload["model"]`), not the original `active_profile.model`.
- **TTFT & Native Eval Duration Capture:**
  - In `stream_chat` (Ollama native, OpenAI-compat SSE, and browser relay streams), record `first_token_at = time.monotonic()` on the first non-empty yielded content delta so `ttft_ms = max(0, int((first_token_at - started_at) * 1000))`.
  - On native Ollama `/api/chat` `done: true` chunks (and browser Ollama relay usage payloads if forwarded), extract `eval_duration` (nanoseconds) when present and convert to `eval_duration_ms = round(eval_duration_ns / 1_000_000)`.
  - Note: For local `browser_ollama` / `webgpu` relay calls, `RelayStreamUsage` in [`local_relay.py`](file:///home/diegolima/Git/cybercantina/backend/app/providers/local_relay.py#L53) forwards `eval_duration_ms` and `cost_usd` when available; otherwise `ttft_ms` measured on the server stream provides a consistent fallback across all streaming drivers.
- **Passive Cost Capture:** When an OpenAI-compatible provider (server-side or browser relay, e.g., OpenRouter) returns a finite non-negative numeric `usage.cost` field in JSON or SSE usage chunks, record it passively on `LlmCallTelemetry.cost_usd` without maintaining pricing tables.

---

### FR-2: Turn Card Prose Model Pill

#### 2.1 Placement & Eligibility
- **Location:** Inside the turn footer metadata group in [`TurnCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/TurnCard.tsx#L1161-L1176), immediately to the right of `• {turn.world_snapshot.world_timestamp}` and before `notable_event_summary` / `.agent-pills-row`:
  ```text
  Turn #4 • Day 1, 21:14  [Feather qwen2.5:14b]  ★ Notable event  [clerk 2] [Mira 1]
  ```
- **When Rendered:** Render only when `turn.telemetry?.phases?.phase4_prose?.calls` contains at least one recorded call (`calls.length > 0`).
  - Omit on Turn `#0` (`isRoot` without telemetry), legacy turns with `telemetry == null`, standalone `__arrival__` turns, and offline-simulated fallback turns where no LLM call succeeded.
  - If multiple `phase4_prose` calls were recorded on a turn, use the **final** call in `calls` (representing the completed prose output).
- **Live Streaming (`LiveStreamingTurnCard.tsx`):** Not required during active streaming (the pill appears once the turn finalizes and `TurnCard` renders), keeping the in-progress streaming footer minimal.

#### 2.2 Visual Design, Provider Shading & Truncation
- **Element:** Native `<button type="button">` styled with a compact pill class matching `.agent-pill` proportions (`font-size: 0.69rem`, `padding: 2px 7px`, `border-radius: 999px`, `line-height: 1.3`) combined with provider color classes:
  - Reuse `.provider-pill--{color}` semantic variables (`--provider-{cyan,purple,indigo,bronze}-{bg,border,fg}` from [`00-tokens.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles/00-tokens.css#L84-L95)).
  - For `"neutral"` or missing `provider_color` (legacy telemetry), use a subtle neutral pill treatment (`background: var(--bg-card)`, `border: 1px solid var(--border-subtle)`, `color: var(--text-secondary)`) so the pill remains clearly interactive.
- **Icon:** Render `<Feather size={11} aria-hidden="true" />` at the leading edge of the pill on **all** viewport sizes.
- **Model Label & Truncation (Desktop / Tablet `> 620px`):**
  - Derive a clean display string from `call.model` (e.g., stripping verbose registry prefixes like `hf.co/<org>/` or redundant provider namespaces only when helpful, OR preserving concise model slug) and enforce CSS truncation (`max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`) so long model IDs never break footer layout.
  - Set `title` / `aria-label` to include the full model ID and provider name (e.g., `"Prose generated by anthropic/claude-3.7-sonnet via OpenRouter — click for timing details"`).
- **Compact Mobile Collapse (`<= 620px`):**
  - Using pure CSS inside [`15-responsive.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles/15-responsive.css) (`@media (max-width: 620px)`), hide the model text label (`display: none`) so the pill collapses cleanly to the single `<Feather />` icon inside its provider-tinted badge.
  - Increase touch padding slightly in the `<= 620px` rule (e.g., `padding: 3px 8px; min-height: 24px;`) to prevent mis-taps against `clerk` / character agent pills.

---

### FR-3: Anchored Prose Telemetry Popover

#### 3.1 Interaction & Positioning
- Clicking the pill toggles an anchored popover (`role="dialog"` or `aria-expanded` disclosure panel) attached to that specific `TurnCard`'s pill wrapper.
- **Dismissal:**
  - Clicking the pill again toggles it closed.
  - Clicking anywhere outside the popover closes it.
  - Pressing `Escape` closes it (without interfering with modal/global shortcuts).
  - Opening another turn's pill (or starting an edit/swipe) should close any previously open pill popover, or keep state isolated per card cleanly.
- **Responsive Viewport Safety:**
  - On desktop/tablet, anchor above or below the pill (`position: absolute; z-index: 40;`) with horizontal alignment guarded so it stays within the turn card.
  - On compact screens (`<= 620px`), constrain width (`max-width: calc(100vw - 32px)`) and clamp/center within the turn card bounds so an icon-only pill near the left or right edge never clips off-screen.

#### 3.2 Popover Contents & Metric Rules
The popover displays a concise, structured summary for the turn's prose generation:

1. **Header (Always Shown):**
   - `<Feather />` icon + provider badge (using `provider_name || formatProviderTypeLabel(provider_type)` with the provider color tint).
   - **Full untruncated `model` string** (monospace, wrapping cleanly for long IDs—essential for both mobile icon-only view and desktop truncated pills).
2. **Generation Timing & Speed:**
   - **Generation Time:** Formatted `duration_ms` (e.g., `4.2s` or `840ms` when `< 1000ms`), shown whenever `duration_ms > 0` (otherwise `—`).
   - **Time to First Token (TTFT):** Shown when `ttft_ms != null` (e.g., `1.1s`), helping users distinguish prompt-eval / queue wait from streaming speed.
   - **Tokens / sec (`tok/s`):** Shown **only when meaningful and available**:
     - **Priority 1 (Exact Native Decode):** If `usage_source === "exact"` and `eval_duration_ms > 0` and `completion_tokens > 0`, compute `completion_tokens / (eval_duration_ms / 1000)` (labeled e.g. `48.2 tok/s`).
     - **Priority 2 (Stream Decode Window):** Otherwise, if `usage_source === "exact"`, `ttft_ms != null`, `duration_ms - ttft_ms >= 200`, and `completion_tokens >= 5`, compute `completion_tokens / ((duration_ms - ttft_ms) / 1000)`.
     - **Priority 3 (End-to-End Fallback / Estimated):** If only `duration_ms > 0` and `completion_tokens > 0` exist without separate decode timing (non-streaming or legacy v0.27.0–v0.34.0 turns):
       - When `usage_source === "exact"`: optionally display with an `(e2e)` qualifier or omit decode `tok/s` in favor of showing total duration + output tokens cleanly—let pure helper `computeProseTokensPerSecond(call)` govern this consistently.
       - When `usage_source === "estimated"`: prefix with `~` (or hide `tok/s` with `"Est."` note) so heuristic character estimates are never presented as exact hardware throughput.
3. **Token Summary:**
   - Compact row showing `Prompt: X tok` · `Output: Y tok` (with `(Exact)` / `(Est.)` badge) and `Stop: finish_reason` if non-standard (e.g., highlighted in `--accent-rose` when `finish_reason === "length"`).
4. **Cost (When Reported):**
   - If `call.cost_usd != null`, render a `Cost` row (formatted e.g. `$0.0042`; labeled `Prose cost` when additional phases on the turn also report `cost_usd`, alongside a `Turn total` row summing across all phases). When `cost_usd == null`, omit the row cleanly so zero-cost local providers show no `$0.00` noise.
5. **Drill-Down Link to Full Turn Telemetry & Sub-Call Timings:**
   - Include a subtle footer action button (`"Inspect all 4 phases"`) that closes the popover and opens [`ContextHealthModal`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/ContextHealthModal.tsx#L77-L83) scoped to **that turn's** `telemetry` and `turn.depth_index` (extending `ChatStage.tsx` to support inspecting any clicked turn, not only the latest turn).
   - Add a `Time` column (`formatDurationMs(c.duration_ms)`) to the expandable sub-call table in `ContextHealthModal.tsx` so per-call latency is visible across Phases 1, 3, 4, and 5.

---

### FR-4: Prose vs. Cognition Icon Alignment

To eliminate ambiguity between "prose model" and "cognition" across the entire UI:

1. **Primary / Prose Model Card (`ModelCard.tsx`):**
   - In [`frontend/src/components/models/ModelCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/models/ModelCard.tsx#L231-L238), change the `role === "actor"` watermark icon from `<Brain size={110} />` to `<Feather size={110} />`.
   - Because both [`AdminModelsTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AdminModelsTab.tsx#L66) and [`ProfilePreferencesTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/ProfilePreferencesTab.tsx#L666) render `ModelDeck` → `ModelCard`, this updates both the Admin Settings and User Profile model pages consistently.
   - Keep `role === "clerk"` as `<Cpu size={110} />` and `role === "vectors"` as `<Database size={110} />`.
2. **Preserve `Brain` Strictly for Cognition:**
   - Retain `Brain` across all cognition surfaces: [`TurnCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/TurnCard.tsx#L628-L692) (Inner Cognition drawer & character tabs), [`LiveStreamingTurnCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/LiveStreamingTurnCard.tsx#L156-L295) (Phase 3 cognition progress), [`promptRoleDefinitions.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/prompts/promptRoleDefinitions.ts#L35) (Cognition prompt role), [`ProfileBehaviorCards.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/ProfileBehaviorCards.tsx#L53), and Inspector / Wizard modals.

---

### FR-5: End-User Documentation (Wiki)

Upon implementation, update the sibling `../cybercantina-wiki` repository to document:
- The turn card prose model pill (provider color coding, responsive icon collapse, and telemetry popover metrics) in `Interface-Tour.md` and `Playing-and-Mechanics.md`.
- The updated Prose (`Feather`) model icon in `Providers-and-Models.md` / `Interface-Tour.md` if model card icons are referenced.

---

## 4. Non-Functional Requirements

1. **Performance:** Zero extra API requests or database queries on campaign load or turn rendering; all data comes from existing `turn.telemetry` payloads.
2. **Accessibility:** Pill button includes descriptive `aria-label`, `aria-expanded`, and `aria-controls`; popover supports `Escape` dismissal and readable contrast across all 5 provider color themes (`neutral`, `cyan`, `purple`, `indigo`, `bronze`).
3. **CSS & Theme Hygiene:** Place turn pill and popover styles in [`frontend/src/styles/04-chat-and-turns.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles/04-chat-and-turns.css) and `<= 620px` responsive overrides in [`frontend/src/styles/15-responsive.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles/15-responsive.css), using semantic tokens from `00-tokens.css` with no `!important` overrides (`npm run css:audit` compliant).
4. **Testing:**
   - **Backend (`pytest`):** Verify `LlmCallTelemetry` backward compatibility with legacy JSON payloads, provider metadata snapshot (`provider_id`, `provider_name`, `provider_color`), fallback model telemetry recording, and `ttft_ms` / `eval_duration_ms` capture in streaming paths.
   - **Frontend (`vitest`):** Unit-test pure helpers (`getProseCallTelemetry`, `formatDurationMs`, `computeProseTokensPerSecond`, `formatShortModelName`) and SSR-render assertions (`ReactDOMServer.renderToStaticMarkup`) for `TurnCard` (with telemetry, legacy `null` telemetry, neutral vs colored providers) and `ModelCard` (`Feather` watermark for `actor`).
