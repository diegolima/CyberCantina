---
feature: turn-context-telemetry
target_version: 0.27.0
document_type: frd
status: completed
last_updated: 2026-11-20
---

# Feature Requirements Document (FRD)
## Turn Context Telemetry & Context Health Indicator

**Status:** Completed  
**Target Version:** CyberCantina v0.27.0  
**Scope:**
- Backend Telemetry Schemas & Collector (`backend/app/schemas/telemetry.py`, `backend/app/engine/telemetry.py`)
- Backend LLM Client & Provider Usage Extraction ([`llm_client.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/llm_client.py), [`local_relay.py`](file:///home/diegolima/Git/cybercantina/backend/app/providers/local_relay.py), [`lore_scope.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/lore_scope.py))
- Backend Phase 2/4 Context Assembly & Turn Pipeline Integration ([`assembler.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/assembler.py), [`phase1_pre.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/phase1_pre.py), [`runner.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/cognition/runner.py), [`phase4_prose.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/phase4_prose.py), [`pipeline.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/clerk/pipeline.py), [`turn_streaming.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/campaign_routes/turn_streaming.py))
- Backend Persistence & Migrations ([`schema.sql`](file:///home/diegolima/Git/cybercantina/backend/app/db/schema.sql), `backend/app/db/repos/turns.py`)
- Frontend Browser Relay Usage Passthrough ([`ollamaDriver.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/local/ollamaDriver.ts), [`remoteProviderDriver.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/local/remoteProviderDriver.ts), [`webgpuDriver.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/local/webgpuDriver.ts), [`local/types.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/local/types.ts))
- Frontend Top-Bar Indicator & Drill-Down Modal ([`ChatStage.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ChatStage.tsx), `frontend/src/components/chat/ContextHealthPill.tsx`, `frontend/src/components/chat/ContextHealthModal.tsx`)
- User-Facing Wiki Documentation ([`Home.md`](file:///home/diegolima/Git/cybercantina-wiki/Home.md), [`Interface-Tour.md`](file:///home/diegolima/Git/cybercantina-wiki/Interface-Tour.md), [`Playing-and-Mechanics.md`](file:///home/diegolima/Git/cybercantina-wiki/Playing-and-Mechanics.md))

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
Today, CyberCantina's multi-phase turn pipeline (Phase 1 Pre-Turn → Phase 2 Context Assembly → Phase 3 Cognition → Phase 4 Prose → Phase 5 Clerk) has no user-visible visibility into token consumption or context-window pressure:

1. **Silent Context Degradation:** When a campaign grows and Phase 4's 4-zone prompt exceeds the Actor's `input_budget`, [assembler.py](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/assembler.py#L458-L526) trims oldest Zone 3 working-memory turns, cascades Zone 2 episodic summaries to synopses or drops them, and logs a server-side `logger.warning`. Players never see this happening in the UI and only notice when characters mysteriously forget recent events.
2. **Undetected Silent Cropping:** Context budgeting relies on a heuristic (`ceil(len(text) / 3.3) + 12` tokens/msg). On dense formatting, code, or non-English prose, the heuristic can underestimate actual BPE tokens—causing Ollama or a cloud backend to silently left-crop the prompt or cut off output (`done_reason == "length"`) without warning.
3. **Discarded Provider Telemetry:** [llm_client.py](file:///home/diegolima/Git/cybercantina/backend/app/engine/llm_client.py) and the browser relay drivers currently discard provider-reported token counts (`prompt_eval_count` / `eval_count` on Ollama; `usage.prompt_tokens` / `usage.completion_tokens` on OpenAI-compatible APIs), making it impossible to inspect how much context each phase actually consumed.

### 1.2 Proposed Solution
Introduce a **Turn Context Telemetry** system paired with a compact **Context Health** indicator in the campaign top bar and an interactive drill-down modal:

1. **Exact Per-Phase Telemetry Capture:** Capture provider-reported input/output token counts, finish/stop reasons, and Phase 4's 4-zone trimming/cropping metrics across all 4 LLM phases, persisting a compact JSON snapshot on each `turn_node`.
2. **Top-Bar Context Health Indicator:** Display a compact clickable pill to the right of the campaign name in [ChatStage.tsx](file:///home/diegolima/Git/cybercantina/frontend/src/components/ChatStage.tsx#L1429-L1433) showing overall health (`Healthy` / `Warning` / `Critical`) alongside a 4-bar vertical micro-meter representing the 4 LLM phases.
3. **Context Health Drill-Down Modal:** Clicking the indicator opens a modal with 4 phase bar graphs showing `%` of context used, color-coded by health (Green / Amber / Red), annotating exactly what was dropped or cropped, plus a Phase 4 Zone 1–4 breakdown, expandable sub-call details, and actionable tuning recommendations.

---

## 2. Scope, Boundaries & Core Invariants

1. **Per-Turn Branch-Safe Persistence:** Telemetry is stored on `turn_nodes` (`telemetry_json TEXT NULL`), not as a single campaign-level field. Branching, rewinding, or switching timeline heads automatically displays the telemetry of the active branch's latest turn.
2. **Backward Compatibility:** Legacy `turn_nodes` with `telemetry_json IS NULL` and fresh Turn 0 campaigns (greeting only, no player turns yet) must render cleanly in a neutral/idle state without errors or fake `0%` green bars.
3. **Zero Regression to Turn Latency or Streaming:** Token usage extraction piggybacks on existing HTTP/SSE/WebSocket responses—no extra LLM calls or tokenizer round-trips. If an OpenAI-compatible server rejects `stream_options: {"include_usage": true}` with HTTP 400, the client automatically retries without `stream_options` and falls back to estimated counts.
4. **Leaf Schema & Architecture Compliance:** Telemetry DTOs live in a leaf schema module (`backend/app/schemas/telemetry.py`) with no upward imports from `app.engine` or `app.routers` (`tach check` compliant). Frontend pure formatting/classification helpers live outside DOM components so Vitest (Node-only) can unit-test them directly.
5. **Semantic Color Guardrails:**
   - **Healthy:** Green / Emerald (`--accent-emerald`)
   - **Warning (Drops / Trimming):** Yellow / Amber (`--accent-amber`)
   - **Critical (Cropping / Overflow / Truncation):** Red / Rose (`--accent-rose`, reserved strictly for critical/error states)
   - **Idle / Unknown:** Muted neutral (`--text-muted`)
6. **Out of Scope for v0.27.0:**
   - Full raw prompt text storage in SQLite (avoids bloating `cybercantina.db` with duplicated system prompts per turn).
   - Billing/cost-in-USD calculation across cloud providers.
   - Multi-turn historical trend charts (v0.27.0 focuses on the active turn's health and per-phase breakdown).

---

## 3. Functional Requirements

### FR-1: Per-Phase Telemetry Capture & Data Model

#### 1.1 Four Tracked LLM Phases
Although the turn lifecycle has 5 numbered phases, Phase 2 is local context/RAG assembly (no LLM call). Telemetry tracks the **4 LLM-executing phases**:

| Phase Key | Display Label | Role / Context Window | Typical LLM Calls per Turn |
| :--- | :--- | :--- | :--- |
| `phase1_pre` | **Phase 1 — Pre-Turn** | Clerk | 1 call (intent, movement, rolls, persona disclosures) |
| `phase3_cognition` | **Phase 3 — Cognition** | Actor or Clerk (when `delegate_cognition_to_clerk` is enabled) | `N` calls (1 per present character) |
| `phase4_prose` | **Phase 4 — Prose** | Actor | 1 streaming call (4-zone prompt → narrative response) |
| `phase5_clerk` | **Phase 5 — Clerk** | Clerk | 1–5+ calls (World Clerk, per-character Post-Turn Agents, optional Inventory Arbiter, optional Memory Extraction, periodic Episodic Compaction) |

#### 1.2 Per-Call Telemetry Fields
Each LLM invocation recorded via a turn-scoped `ContextVar` collector captures:
- `phase`: `"phase1_pre" | "phase3_cognition" | "phase4_prose" | "phase5_clerk"`
- `label`: Human-readable sub-call label (e.g., `"Pre-Turn Analysis"`, `"Cognition: Mira"`, `"Actor Prose"`, `"World Clerk"`, `"Character Agent: Mira"`, `"Episodic Compaction"`)
- `model`: Effective model ID used
- `provider_type`: Provider type (`ollama`, `browser_ollama`, `webgpu`, `openrouter`, `nanogpt`, `aihorde`, `openai_compat`)
- `prompt_tokens`: Exact input tokens from provider, or heuristic estimate if omitted
- `completion_tokens`: Exact output tokens from provider, or heuristic estimate if omitted
- `usage_source`: `"exact"` (provider-reported) or `"estimated"` (char heuristic fallback)
- `context_ceiling`: Effective context window in tokens for this call (`int | None`)
- `finish_reason`: Normalized stop reason (`"stop"`, `"length"`, `"error"`, `"unknown"`)
- `retries`: Number of internal retries (e.g., JSON schema fallback)
- `duration_ms`: Wall-clock latency in milliseconds

#### 1.3 Provider Usage Extraction Rules
- **Ollama (`/api/chat` — server & browser relay):**
  - Non-streaming: read `prompt_eval_count`, `eval_count`, and `done_reason` from the JSON response.
  - Streaming: read `prompt_eval_count`, `eval_count`, and `done_reason` from the final `done: true` NDJSON chunk.
- **OpenAI-Compatible / OpenRouter / NanoGPT (`/chat/completions` — server & browser relay):**
  - Non-streaming: read `usage.prompt_tokens`, `usage.completion_tokens`, and `choices[0].finish_reason`.
  - Streaming: pass `stream_options: {"include_usage": true}` on the request and read `usage` / `finish_reason` from the final SSE chunk(s). If a server responds with HTTP 400 mentioning `stream_options`, retry once without it and fall back to `"estimated"`.
- **AI Horde / WebGPU / Fallback:**
  - Read `usage` if returned; otherwise compute `prompt_tokens = estimate_messages_tokens(messages)` and `completion_tokens = estimate_text_tokens(output_text)` and mark `usage_source = "estimated"`.

#### 1.4 Phase 4 Context Budget & Zone Breakdown
[assembler.py](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/assembler.py) returns a structured `Phase4BudgetReport` alongside the assembled messages:
- `context_ceiling`: Resolved Actor context window (`int | None`)
- `reserved_output_tokens`: Actor `max_tokens` reservation
- `safety_margin_tokens`: `_PROMPT_SAFETY_MARGIN_TOKENS` (256)
- `input_budget`: Effective input budget (`int | None`)
- **Estimated per-zone footprints (post-assembly):**
  - `zone1_tokens` (Static system prompt: world rules, character sheets, persona)
  - `zone2_tokens` (Episodic LOD summaries)
  - `zone3_tokens` (Working memory recent turns)
  - `zone4_tokens` (Ephemeral tail frame: location, state, cognition, recalled RAG)
- **Degradation counters:**
  - `total_zone3_turns_available` & `dropped_zone3_turns` (trimmed oldest working-memory turns)
  - `trimmed_below_min_wm` (`bool` — whether Step 3 last-resort trim breached `min_working_memory_turns`)
  - `total_zone2_chunks_available`, `downgraded_zone2_chunks` (`summary` → `synopsis`), and `dropped_zone2_chunks`
  - `base_exceeds_budget` (`bool` — whether `zone1 + zone4 > input_budget`)
  - `estimated_cropped_tokens` (`int` — `max(0, (zone1 + zone4) - input_budget)` or `max(0, prompt_tokens - context_ceiling)` when provider-reported overflow occurs)

#### 1.5 Context Ceiling Resolution
- **Ollama / Browser Ollama:** Configured `profile.context_size` (or role default `12288` Actor / `8192` Clerk), clamped to model max if known.
- **WebGPU:** `min(profile.context_size, get_webgpu_max_context(model))`.
- **Cloud / OpenAI-Compatible (`openrouter`, `nanogpt`, `openai_compat`, `aihorde`):** Use the probed model's `context_length` from provider catalog metadata when available; otherwise `null` (unknown ceiling).

---

### FR-2: Context Health Classification Rules

Each phase is assigned a health status (`"healthy" | "warning" | "critical" | "idle"`), and the overall turn health is the **worst** status across all 4 phases (`critical > warning > healthy > idle`).

For multi-call phases (Phase 3, Phase 5), the phase's primary utilization percentage is the **peak single-call utilization** (`max(prompt_tokens / context_ceiling)` across its calls), because peak single-call fill—not summed tokens—determines whether context cropping occurs.

| Status | Color | Trigger Conditions |
| :--- | :--- | :--- |
| **Critical** | Red (`--accent-rose`) | Any of: <br>1. **Prompt Cropping / Overflow:** `base_exceeds_budget == True` (Zone 1 + Zone 4 alone exceed `input_budget`), **OR** `trimmed_below_min_wm == True` (Zone 3 trimmed below `min_working_memory_turns`), **OR** provider-reported `prompt_tokens >= context_ceiling` (actual silent prompt cropping when ceiling is known). <br>2. **Output Truncation:** Any call in the phase ended with `finish_reason == "length"` / `done_reason == "length"`. |
| **Warning** | Yellow/Amber (`--accent-amber`) | Not Critical, and any of: <br>1. `dropped_zone3_turns > 0` (oldest working-memory turns were dropped to fit budget while preserving `min_working_memory_turns`). <br>2. `dropped_zone2_chunks > 0` or `downgraded_zone2_chunks > 0` (episodic LOD cascade triggered due to budget pressure). <br>3. Any single call reached `>= 90%` of its known `context_ceiling` (imminent cropping risk). |
| **Healthy** | Green (`--accent-emerald`) | At least one call completed in the phase with none of the Warning or Critical triggers. *(Note: Routine RAG recall capping via `recall_budget_prose_tokens` / `recall_budget_cognition_tokens` is expected behavior and does **not** trigger Warning.)* |
| **Idle / Unknown** | Muted Neutral | No calls executed in this phase (e.g., Turn 0, solo narrator turn with no Phase 3 Cognition calls, or legacy turn without telemetry). |

**Unknown Context Ceiling Handling (Cloud Providers without `context_length`):**
- Percentage fill is `null` (bars render at a subtle neutral baseline width or proportional-to-turn-total with an `"Unknown limit"` label rather than a fabricated `%`).
- Health still accurately flags **Critical** if `finish_reason == "length"` occurs, and **Healthy** otherwise, while displaying exact token counts (e.g., `4,180 tok`).

---

### FR-3: Persistence, API & Live Streaming

1. **Database Schema (`turn_nodes`):**
   - Add `telemetry_json TEXT NULL` to `turn_nodes` in [schema.sql](file:///home/diegolima/Git/cybercantina/backend/app/db/schema.sql#L344-L359) and an idempotent additive `ALTER TABLE turn_nodes ADD COLUMN telemetry_json TEXT NULL` migration for existing SQLite databases.
2. **API Exposure:**
   - Add `telemetry: TurnTelemetry | None = None` to `TurnNodeRecord` (backend) and `TurnNodeRecord` (frontend `frontend/src/types/turn.ts`).
   - Returned automatically in campaign bundle loads (`GET /api/campaigns/{id}`) and branch switches—no extra polling endpoint required.
3. **Live SSE Streaming (`turn_streaming.py`):**
   - Emit an SSE event `event: telemetry` containing the partial `TurnTelemetry` payload:
     1. Immediately after **Phase 4** completes (so P1, P3, and P4 update live while P5 runs in the background).
     2. Again when **Phase 5** finishes and persists the final `telemetry_json` onto the `turn_node`.
   - Frontend updates the active turn's `telemetry` in-place on each `telemetry` SSE event.

---

### FR-4: Top-Bar "Context Health" Indicator

- **Placement:** Inside `.stage-title-row` in [ChatStage.tsx](file:///home/diegolima/Git/cybercantina/frontend/src/components/ChatStage.tsx#L1429-L1433), immediately to the right of `.stage-campaign-title` (visible whenever a campaign is open).
- **Visual Design (`ContextHealthPill.tsx`):**
  - Rendered as a compact, accessible `<button type="button">` pill (`aria-label="Context Health: <status>. Click to inspect phase token usage."`).
  - Contains:
    1. A status dot + short status label (`Healthy`, `Warning`, `Critical`, or `Idle` on Turn 0).
    2. A **4-bar vertical micro-meter** (4 tiny vertical bars, ~14–16px tall, one each for P1, P3, P4, P5), where each bar's fill height reflects that phase's peak `%` of context used (clamped to a visible minimum of ~15% when active so low-usage phases remain legible) and its fill color reflects that phase's individual health (Green / Amber / Red / Muted).
  - **Hover Tooltip:** Native `title` or lightweight tooltip summarizing overall status, peak `%` used (e.g., `Phase 4: 84% of 12,288 tok — 2 turns dropped`), and `"Click for details"`.
  - **Live Updating Indicator:** Subtle pulse on the P5 micro-bar while Phase 5 is still running after prose finishes streaming.
  - **Responsive Behavior:** On narrow viewports (`< 768px`), hide the text label and retain the compact colored dot + 4-bar micro-meter so the campaign title, location/clock badges, and Inspector toggle never overflow.

---

### FR-5: Context Health Drill-Down Modal

Clicking the top-bar indicator opens `ContextHealthModal.tsx` (standard CyberCantina modal chrome, `Escape` / backdrop click to close):

1. **Header & Overall Summary Banner:**
   - Shows the turn depth / active turn label, overall health badge (`Healthy` / `Warning` / `Critical`), total tokens sent & generated across the turn, and whether counts are **Exact** (provider-reported) or **Estimated** (heuristic fallback).
2. **4 Phase Bar Graphs (Primary View):**
   - Renders one horizontal progress bar per LLM phase (**Phase 1 — Pre-Turn**, **Phase 3 — Cognition**, **Phase 4 — Prose**, **Phase 5 — Clerk**).
   - Each row displays:
     - Phase title + model badge (and role: Actor / Clerk).
     - Percentage used of context window (e.g., `78%` and `9,580 / 12,288 tok`) — or absolute tokens (`4,120 tok · limit unknown`) when `context_ceiling` is `null`.
     - **Color-coded bar fill:**
       - **Green:** Healthy fill up to `%` used.
       - **Amber (Warning):** Amber fill + inline callout badge specifying **what and how much was dropped** (e.g., `2 working-memory turns dropped · 1 episodic chunk downgraded`).
       - **Red (Critical):** Red fill (capped visually at `100%` with an overflow hatch/indicator if `> 100%`) + inline callout badge specifying **how much was cropped or truncated** (e.g., `~640 tok cropped (Zone 1+4 exceeded budget)` or `Output truncated at 1,024 max_tokens`).
3. **Phase 4 Zone 1–4 Stacked Breakdown:**
   - Directly beneath (or integrated into) the Phase 4 bar, show a segmented breakdown of **Zone 1 (Static)**, **Zone 2 (Episodic)**, **Zone 3 (Working Memory)**, **Zone 4 (Ephemeral/RAG)**, and **Output**, with exact/estimated token shares so users can pinpoint *why* Phase 4 is full (e.g., oversized character/world prompts vs. long working memory).
4. **Expandable Sub-Call Table (Multi-Call Phases):**
   - Clicking a phase row expands its individual LLM calls (e.g., each character's Cognition call in Phase 3, or World Clerk / Character Agent / Memory / Episodic Compaction calls in Phase 5) showing `Label`, `Model`, `Prompt tok`, `Output tok`, `Latency`, `Source (Exact/Est.)`, and `Stop Reason`.
5. **Actionable Recommendations (Warning / Critical only):**
   - When the turn is in `Warning` or `Critical`, render a concise diagnostic tip tailored to the root cause (e.g., *"Zone 1 static prompt uses 56% of your 8,192-token Actor window. Increase Actor Context Size in Profile → Models, reduce Working Memory turns, or switch to the Fast & Concise prompt preset."*) with a direct button to open Profile/Model Settings.

---

## 4. Acceptance Criteria

1. **Exactness:** Running a turn against local Ollama or OpenRouter/NanoGPT records `usage_source: "exact"` with provider-reported `prompt_tokens` and `completion_tokens` for all 4 LLM phases (including streaming Phase 4).
2. **Graceful Fallback:** Running against a provider that omits `usage` (or rejects `stream_options`) completes without error and records `usage_source: "estimated"`.
3. **Warning Detection:** Configuring a tight `context_size` that causes `assembler.py` to drop ≥1 Zone 3 turn (while staying `>= min_working_memory_turns`) turns the top-bar indicator **Amber (Warning)** and displays the exact count of dropped turns/chunks in the Phase 4 bar inside the modal.
4. **Critical Detection:** Triggering either `base_exceeds_budget`, `trimmed_below_min_wm`, `prompt_tokens >= context_ceiling`, or `finish_reason == "length"` turns the indicator **Red (Critical)** and displays the cropped token count or truncation reason in the modal.
5. **Branch Integrity:** Rewinding or switching to an earlier branch turn displays that turn's persisted `telemetry_json`, and Turn 0 / pre-`v0.27.0` turns render the neutral Idle state without errors.
6. **Live Updates:** During a turn, the indicator updates via SSE after Phase 4 finishes and settles after Phase 5 completes.
7. **Verification Gates:** Backend (`ruff`, `tach check`, `pytest`), Frontend (`arch:check`, `build`, `vitest`), Architecture Docs (`generate_arch_docs.py --check`), and Wiki updates (`../cybercantina-wiki`) all pass cleanly.

---

## 5. Open Design Decisions (For Review Before Implementation)

1. **Turn 0 Dry-Run vs. Neutral Idle:** On a brand-new campaign (before the player sends Turn 1), should the top-bar indicator show a muted `Idle` pill until Turn 1 completes, or run a lightweight Phase 4 dry-run estimate on load so users immediately see their Zone 1 baseline footprint? *(Recommended: Muted `Idle` in v0.27.0 to keep campaign-load latency zero; dry-run can be added later if desired.)*
2. **Phase 5 Background Failures:** If a Phase 5 sub-call fails or times out (e.g., Episodic Compaction fails and falls back deterministically), should that surface as an informational note inside the Phase 5 expandable list without turning Context Health red (since it's a network/parse error, not context cropping)? *(Recommended: Yes — show a subtle warning icon on the failed sub-call row while keeping Context Health strictly about context capacity/cropping.)*
3. **Model Context Ceiling for Generic `openai_compat`:** Many self-hosted OpenAI-compatible servers don't include `context_length` in `/v1/models`. Should we allow an optional `context_size` override on `ModelProfile` for `openai_compat` too, or simply display absolute token counts when unknown? *(Recommended: Display absolute token counts when unknown in v0.27.0, and honor `context_length` automatically whenever `/models` provides it.)*
