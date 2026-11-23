---
feature: gm-codex-authoring-and-tools
target_version: 0.33.0
document_type: frd
status: completed
last_updated: 2026-11-23
---

# Feature Requirements Document (FRD)
## GM-Assisted World Codex Authoring & Phased Tool Calling

**Status:** Phase 1 Completed (`v0.33.0`) · Phase 2 Completed (`v0.34.0`)  
**Target Version:** CyberCantina v0.33.0 (Phase 1) / v0.34.0 (Phase 2)  
**Depends On:**
- [v0.31.0 Campaign Lore Authoring, GM Mode ("Unlock Lore & Secrets"), Secret Discovery & Major Events](file:///home/diegolima/Git/cybercantina/docs/features/0.31.0-campaign-lore-gm-mode-and-major-events/FRD.md)
- [v0.32.0 GM Talk — Out-of-Character Campaign Assistant & `@` Entity Mentions](file:///home/diegolima/Git/cybercantina/docs/features/0.32.0-gm-talk/FRD.md)

**Expected Scope:**
- **Phase 1 (Structured Proposal & Deterministic Codex Save):**
  - GM Schemas & Prompt Templates ([`backend/app/schemas/gm.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/gm.py), [`backend/app/schemas/world.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/world.py), [`backend/app/prompts/defaults.py`](file:///home/diegolima/Git/cybercantina/backend/app/prompts/defaults.py))
  - GM Codex Draft Engine & Branch-Safe Append Persistence ([`backend/app/engine/gm_codex.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/gm_codex.py), [`backend/app/engine/gm_talk.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/gm_talk.py), [`backend/app/db/repos/campaign_lore_items.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/campaign_lore_items.py), [`backend/app/db/repos/gm_chat.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/gm_chat.py), [`backend/app/db/schema.sql`](file:///home/diegolima/Git/cybercantina/backend/app/db/schema.sql))
  - Campaign GM & Lore API Routes ([`backend/app/routers/campaign_routes/gm_routes.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/campaign_routes/gm_routes.py), [`backend/app/routers/campaign_routes/spatial_routes.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/campaign_routes/spatial_routes.py))
  - Frontend GM Talk Drawer Proposal Card & API Client ([`frontend/src/components/chat/GmCodexProposalCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/GmCodexProposalCard.tsx), [`frontend/src/components/chat/GmTalkDrawer.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/GmTalkDrawer.tsx), [`frontend/src/hooks/useGmTalk.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/hooks/useGmTalk.ts), [`frontend/src/api/gm.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/api/gm.ts), [`frontend/src/types/gm.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/gm.ts), [`frontend/src/styles/`](file:///home/diegolima/Git/cybercantina/frontend/src/styles/))
- **Phase 2 (Native Tool Calling, Capability Toggle & Read-Only Tools):**
  - Provider-Agnostic Tool Calling Abstraction ([`backend/app/engine/llm_client.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/llm_client.py), `backend/app/providers/`)
  - User Profile & System Settings Toggle ([`backend/app/schemas/auth.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/auth.py), [`backend/app/config.py`](file:///home/diegolima/Git/cybercantina/backend/app/config.py), [`frontend/src/components/auth/ProfileBehaviorCards.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/ProfileBehaviorCards.tsx))
  - GM Agentic Tool Loop, Read-Only Retrieval Tools & `propose_world_lore_entry` Tool ([`backend/app/engine/gm_talk.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/gm_talk.py))
- **User-Facing Wiki Documentation:** [`../cybercantina-wiki`](file:///home/diegolima/Git/cybercantina-wiki/Home.md) (`Playing-Directing-and-Mechanics.md`, `First-Campaign-and-Interface-Tour.md`, `Prompt-Customization-and-Presets.md`, `Importing-and-Exporting.md`)

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
With v0.32.0 **GM Talk ("Neuromancer")**, players can ask grounded out-of-character (OOC) questions about recent turns, encountered threats, equipment, and world lore. A common workflow emerges during long campaigns:

1. A player encounters a notable threat, faction unit, or piece of equipment in play (e.g., an *Aegis Mobile Scanner Arch* during a compliance inspection).
2. The player asks Neuromancer in GM Talk what it was and what would make a good Codex entry.
3. Neuromancer synthesizes a grounded, epistemically accurate summary from active-branch turns and sources.
4. Today, the player must manually open the World Codex tab, switch/enable GM Mode if required, create a new entry, re-type title/category/tags, and manually strip OOC turn citations (`Sources: Turns 12–14`) before saving.

At the same time, CyberCantina supports a wide range of local and cloud LLMs—including **prose/RP-focused local models** (7B–24B fine-tunes) that do not reliably support native tool calling, alongside **agentic instruct models** (such as Qwen3 or Gemma 4) that do. Any GM-assisted authoring design must work reliably for prose-model users today while laying a clean foundation for tool-capable models to assist with broader campaign tasks (read-only lookups, extending lore, adding map locations, creating characters) in the future.

### 1.2 Proposed Solution (Two-Phase Architecture)
Introduce **GM-Assisted World Codex Authoring** via a **human-in-the-loop proposal pattern** (`Draft → Deterministic Review/Edit → Confirm/Cancel → Persist`) delivered in two phases:

- **Phase 1 — `complete_structured` World Codex Proposals (Universal Compatibility):**
  - Users can explicitly ask Neuromancer to draft a World Codex entry—either via a **"Draft Codex Entry"** button on any GM Talk assistant message or via an explicit conversational request in GM Talk.
  - A dedicated `complete_structured` pass extracts a schema-validated `WorldLoreNodeDraft` (`category`, `title`, `entity_tags`, `content`) stripped of OOC turn citations.
  - GM Talk presents a deterministic, editable **Codex Proposal Card** inline where the user can adjust fields, review potential duplicate entries, and click **Confirm & Save** or **Cancel** without further LLM mediation.
- **Phase 2 — Native Tool Calling & Capability Toggle (Reusing the 2-Model Split):**
  - Add native tool-calling support to `llm_client` and provider adapters, paired with a user-configurable **`gm_tools_enabled`** capability toggle in **Profile → Preferences → Behavior → GM Talk**.
  - Because `resolve_gm_profile` already lets users assign `Clerk` (while keeping their favorite prose model on `Primary`), users can enable agentic GM tools on a tool-capable `Clerk` model without introducing a 3rd model configuration slot.
  - Initial Phase 2 tools cover **read-only retrieval** (searching existing World Codex entries, turns, and permitted entities) and **`propose_world_lore_entry`**, emitting the **exact same** Phase 1 confirmation card and persistence path.

---

## 2. Scope, Boundaries & Core Invariants

1. **Human-in-the-Loop Persistence Invariant (Hard):**
   - Neither Phase 1 (`complete_structured`) nor Phase 2 (any mutating `propose_*` tool) may ever write directly to `lore_nodes` or mutate campaign simulation state.
   - Every proposed Codex addition or update must pass through a deterministic UI confirmation step (**Edit → Confirm & Save / Cancel**) before persisting.
2. **Unified Proposal Contract Across Phases (Hard):**
   - Phase 1 structured extraction and Phase 2's `propose_world_lore_entry` tool must produce the exact same `GmCodexProposal` payload, render through the same `GmTalkDrawer` confirmation card, and persist through the same branch-safe backend endpoint.
3. **World-Codex-Only Scope Invariant (Phase 1 & Phase 2 Initial Release):**
   - Initial scope is strictly **campaign-scoped Copy-on-Write World Codex entries** (`WorldLoreCategory`: `"history"`, `"culture"`, `"faction"`, `"figure"`, `"rumor"`, `"threat"`, `"artifact"`).
   - **Out of scope for this FRD:** Location/container `lore_nodes` (including `secret` category), character episodic memories, CARE affective state, map location/container creation, and character creation. (Phase 2 tool architecture explicitly leaves room for those as future tools.)
4. **In-Universe Prose & Epistemic Hygiene Invariant (Hard):**
   - Proposed `content` must conform to `WorldLoreNodeDraft` (`title` 1–120 chars, `content` 1–2000 chars, `entity_tags` 1–20 tags) written in concise, in-universe encyclopedia prose.
   - OOC turn citations (e.g., `Sources: Turns 12–14`), speaker headers, and leaked reasoning tags (`<think>`, `<thought>`, `<reasoning>`, `<scratchpad>`) must never be persisted inside `LoreNode.content`. Turn provenance may be surfaced separately as UI-only metadata (`source_turns`) on the proposal card.
   - Proposals must preserve epistemic honesty for unconfirmed facts (e.g., *"detection limits are unconfirmed"*) rather than inventing canon.
5. **Unified Spoiler Safety Invariant via `unlock_lore` (Hard):**
   - When `campaign.world_settings.unlock_lore === false`, both Phase 1 drafting and Phase 2 read-only tools must strictly obey GM Talk's 3-layer spoiler gate: unrevealed `secret` lore, unvisited locations/containers, and private `<cognition>` / internal CARE values are never surfaced to the model or leaked into a proposal.
   - Confirmed entries saved to the campaign World Codex use `WorldLoreCategory` (never `"secret"`).
6. **Branch-Safe Persistence & Non-Destructive Append Invariant (Hard):**
   - Saved entries must use CyberCantina's branch-safe Copy-on-Write campaign lore system (`anchor_turn_id`, `superseded_at_turn_id`, `vector_entries` indexing), never leaking across sibling timeline branches.
   - Saving a confirmed proposal must use an additive/targeted single-entry endpoint rather than overwriting the full `lore_nodes` list from potentially stale client state.
7. **2-Model Split & Graceful Fallback Invariant:**
   - No 3rd "GM model" configuration slot is added; GM Talk continues using `gm_model_role` (`"primary"` vs `"clerk"`) via `resolve_gm_profile`.
   - When `gm_tools_enabled` is `False` (default) or the active provider/model does not support native tool calling, GM Talk operates using Phase 1 behavior without failing general OOC Q&A.
8. **UI, Security & Architecture Hygiene:**
   - Assistive AI drafting controls ("Draft Codex Entry", proposal badges) use `--accent-amber` or `--accent-violet` (never `--accent-rose`); reserve `--accent-rose` strictly for validation errors and destructive actions.
   - Keyword/tag editing in the confirmation card must use `TagChipsInput`.
   - All new backend/frontend modules must comply with `tach.toml` (`tach check`), `.dependency-cruiser.cjs` (`arch:check`), `css:audit`, and never expose raw exception strings in HTTP/SSE payloads.

---

## 3. Phase 1 Requirements: `complete_structured` World Codex Additions

### FR-1.1: Explicit User Triggers in GM Talk
No Codex proposal is ever generated automatically on normal OOC Q&A turns. Proposals are triggered only by explicit user intent through two entry points:

1. **Message Action Button ("Draft Codex Entry"):**
   - Every completed Neuromancer assistant message in [`GmTalkDrawer.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/GmTalkDrawer.tsx) displays a compact secondary action button **`Draft Codex Entry`** (alongside `Copy`).
   - Clicking it sends `POST /api/campaigns/{campaign_id}/gm/codex-draft` referencing `message_id` (plus optional user guidance, or none for direct extraction).
   - Works deterministically without ambiguity—even if the user's previous question was phrased informally (*"what was the aegis scanner?"*).
2. **Explicit Conversational Request in GM Talk:**
   - When the user sends an explicit request in GM Talk asking to add/save an entry to the Codex (e.g., *"add that to the codex"*, *"create a codex entry for the Aegis scanner"*), the backend detects the explicit add-to-codex intent (and ensures pure questions such as *"what would be a reasonable entry to add to the codex?"* are **not** misclassified as a confirmed write—or if drafted at all, only surface a non-mutating proposal card).
   - Over `POST /api/campaigns/{campaign_id}/gm/chat`, after streaming Neuromancer's brief confirmation reply, the backend executes the `complete_structured` draft pass and emits an `event: codex_proposal` SSE event containing the structured proposal payload.

### FR-1.2: Structured Extraction Schema & Prompt (`complete_structured`)
- **LLM Output Schema (`GmWorldLoreDraftLLMOutput`)** in [`backend/app/schemas/gm.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/gm.py):
  - `category: WorldLoreCategory` (`history | culture | faction | figure | rumor | threat | artifact`)
  - `title: str` (`min_length=1, max_length=120`)
  - `entity_tags: list[str]` (`min_length=1, max_length=20`) — modeled as a JSON array (`list[str]`), never a newline/comma-delimited string.
  - `content: str` (`min_length=1, max_length=2000`) — clean in-universe lore prose.
  - `source_turns: list[int]` (`default_factory=list`) — optional OOC turn numbers cited in the draft context, stored separately from `content`.
- **Constrained Local-Model Compatibility:**
  - Calls to `llm_client.complete_structured` must explicitly pass `required_properties=list(GmWorldLoreDraftLLMOutput.model_fields.keys())` so Pydantic v2 defaults do not allow local 12B Ollama/`llama.cpp` models to omit keys or emit blanks.
  - Deterministic `@model_validator` / post-processing strips leaked reasoning wrapper tags (`<think>`, `<thought>`, `<reasoning>`, `<scratchpad>`), strips residual OOC `"Sources: Turns ..."` trailing lines from `content`, and normalizes `entity_tags` via `normalize_and_validate_entity_tags`.
- **Prompt Registration & Fallback:**
  - Register `PROMPT_KEY_GM_CODEX_DRAFT = "gm_codex_draft"` in [`backend/app/prompts/defaults.py`](file:///home/diegolima/Git/cybercantina/backend/app/prompts/defaults.py) so users/presets can customize Codex style while preserving strict schema & spoiler boundaries.
  - Context supplied to the draft call: active-branch World overview, existing World Codex titles/categories (to avoid duplicate titles and match world tone), recent GM Talk exchange (or referenced `message_id`), and permitted source snippets (respecting `unlock_lore`).
  - Support Browser Ollama / WebGPU routing and `allow_offline_fallback` mock/deterministic drafting for tests.

### FR-1.3: Deterministic Confirmation Card (`GmTalkDrawer.tsx`)
When a `GmCodexProposal` is received (from either the message button or `codex_proposal` SSE event), render an inline **Codex Entry Proposal** card attached to the corresponding assistant message:

- **Editable Fields (100% deterministic, zero LLM calls on edit):**
  - **Title:** Text input (`1..120` chars, required).
  - **Category:** Dropdown over `WORLD_LORE_CATEGORIES` (`History`, `Culture`, `Faction`, `Figure`, `Rumor`, `Threat`, `Artifact`).
  - **Tags / Keywords:** [`TagChipsInput`](file:///home/diegolima/Git/cybercantina/frontend/src/components/TagChipsInput.tsx) (`1..20` tags required).
  - **Content:** Multi-line textarea (`1..2000` chars, live character counter, required).
- **Duplicate & Overlap Awareness:**
  - Backend checks active-branch World Codex entries for exact/normalized title matches or high `entity_tags` overlap and attaches `duplicate_matches: list[GmCodexDuplicateMatch]` (`{ id, title, category }`) to the proposal.
  - If a match exists, the card displays a subtle amber notice (*"Similar Codex entry exists: `<Title>`"*) and lets the user choose **Create as New Entry** or **Update Existing Entry** (with a quick preview/link or diff awareness).
- **Provenance & Controls:**
  - Optional muted metadata line if `source_turns` is non-empty (e.g., `Grounded in Turns 12–14` — clearly marked as not saved into the entry text).
  - **`Confirm & Save`** (validates client-side bounds matching `WorldLoreNodeDraft`, disables during save, transitions card to a confirmed badge **`Saved to Codex · <Title>`** with a link/action to open the Codex entry) and **`Cancel`** (dismisses/marks proposal cancelled cleanly).
- **Reload / Branch Continuity:**
  - Proposal state (`id`, draft payload, `status`: `"pending" | "confirmed" | "cancelled"`, `saved_lore_id`) is persisted with the assistant message in `gm_chat_messages` (e.g., `proposals_json TEXT NOT NULL DEFAULT '[]'` column via idempotent migration in `schema.sql` / `schema_init.py`) so closing/reopening the drawer or reloading the page preserves pending/confirmed proposal cards on the active branch.

### FR-1.4: Permissions & Branch-Safe Single-Entry Persistence
- **Permission Boundary (Campaign World Codex Access):**
  - Currently, `PUT /api/campaigns/{campaign_id}/lore` (`aupdate_campaign_world_lore`) enforces `unlock_lore == True` (`enforce_unlock=True`) so players don't edit world canon arbitrarily from the World Codex editor.
  - However, the primary motivation for GM-assisted Codex authoring is allowing a **player during an active campaign** to catalog encountered threats/equipment (e.g., *"Aegis Mobile Scanner Arch"*) **without** having to enable `Unlock Lore & Secrets (GM Mode)` and expose all hidden campaign secrets.
  - Therefore, the dedicated confirmed-proposal save endpoint (`POST /api/campaigns/{campaign_id}/lore/entries`) allows the **campaign owner** to append (or update a campaign-authored CoW World Codex entry) regardless of `unlock_lore` (`enforce_unlock=False` when creating/updating a player-confirmed World Codex entry), while keeping `WorldLoreCategory` strictly non-secret (`allow_secret=False`) and preserving read-only spoiler gating for all unrevealed base-world secrets.
  - *(Open Review Question: confirm whether updates to pre-existing base-world authored Codex entries should require `unlock_lore === True` while new campaign entries and updates to campaign-created entries are always allowed for the campaign owner.)*
- **API Endpoint (`POST /api/campaigns/{campaign_id}/lore/entries`):**
  - Request body: `{ draft: WorldLoreNodeDraft, replace_lore_id?: str | None, proposal_message_id?: str | None, proposal_id?: str | None }`.
  - Validates `WorldLoreNodeDraft`, loads active-branch campaign World Codex entries server-side, appends or replaces the targeted entry atomically, computes its embedding via `_aupdate_campaign_scoped_lore` (or dedicated helper), marks the proposal `confirmed` on `gm_chat_messages` if referenced, and returns the updated `CampaignStateBundle` (plus `saved_lore_id`).
  - Also add `PATCH /api/campaigns/{campaign_id}/gm/proposals/{proposal_id}` (or action `"cancel"`) to persist `"cancelled"` state cleanly.

---

## 4. Phase 2 Requirements: Native Tool Calling, Capability Toggle & Read-Only Tools

Phase 2 upgrades GM Talk from single-shot context + intent drafting into an **agentic tool-using OOC assistant** for users running tool-capable models, while sharing 100% of Phase 1's proposal UI and persistence layer.

### FR-2.1: Provider-Agnostic Tool Calling in `llm_client` & `app/providers/`
- Add typed tool abstractions to [`backend/app/engine/llm_client.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/llm_client.py):
  - `LlmToolDefinition(name, description, parameters_json_schema)`
  - `LlmToolCall(id, name, arguments)`
  - `complete_with_tools(...)` / streaming tool-turn support across:
    - OpenAI-compatible providers (`tools` + `tool_calls` message delta assembly),
    - Ollama native `/api/chat` (`tools` support),
    - Anthropic / Gemini native adapters (if separate) and local relay / Browser Ollama where supported.
- **Safety & Telemetry Guards:**
  - Enforce a hard maximum tool-call loop depth per GM Talk turn (e.g., `MAX_GM_TOOL_ROUNDS = 4`) to prevent infinite loops on 7–12B models.
  - Record tool-round telemetry cleanly via `LlmCallTelemetry` without breaking existing turn telemetry contracts.
  - Emit lightweight SSE status events (e.g., `event: tool_status` with `{ tool_name, label }` such as *"Searching World Codex..."*) so the user sees real-time progress during read-only tool calls before final prose streams.

### FR-2.2: Capability Toggle & 2-Model Integration
- **Settings Schema & Persistence:**
  - Add `gm_tools_enabled: bool | None` (effective default `False`) to `user_model_settings` ([`schema.sql`](file:///home/diegolima/Git/cybercantina/backend/app/db/schema.sql), `schema_init.py`), `AppSettings`, `UserModelSettingsPayload`, and `ProfileModelSettingsResponse` ([`backend/app/schemas/auth.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/auth.py), [`frontend/src/types/auth.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/auth.ts)).
- **Profile → Preferences → Behavior → `GM Talk` UI ([`ProfileBehaviorCards.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/ProfileBehaviorCards.tsx)):**
  - Add a **`GM Agentic Tools`** toggle inside the existing **GM Talk** behavior card alongside `Model Role` (`Primary` vs `Clerk`), `Temperature`, and `Max Tokens`.
  - Include concise helper copy explaining the 2-model workflow: *"Allows Neuromancer to inspect campaign lore/turns via read-only tools and propose Codex entries conversationally. Requires a tool-capable model (tip: keep a prose model on Primary and assign a tool-capable model to Clerk)."*
  - Respect `isLocked` (`!allow_user_model_overrides`) and per-field reset semantics.
- **Runtime Dispatch & Graceful Fallback:**
  - When `gm_tools_enabled === True` and the resolved GM profile (`resolve_gm_profile`) supports tool calling: `POST /api/campaigns/{campaign_id}/gm/chat` runs the Phase 2 tool loop instead of Phase 1's conversational intent router.
  - If the provider/model returns an unsupported-tools error (e.g., 400 from an Ollama model template without tool support or WebGPU), automatically retry/fall back to Phase 1 mode for that turn and surface a non-blocking info notice in `GmTalkDrawer`.
  - The manual **"Draft Codex Entry"** button on GM messages (FR-1.1) remains available in both Phase 1 and Phase 2 as a fast one-click shortcut.

### FR-2.3: Initial Phase 2 Toolset (Read-Only + World Codex Proposal)
Every Phase 2 tool executes against the **active timeline branch** and strictly enforces `campaign.world_settings.unlock_lore`:

1. **Read-Only Retrieval Tools (Auto-executed inside the tool loop):**
   - `search_world_codex(query: str, category: WorldLoreCategory | None = None, limit: int = 8)`
     - Searches active-branch World Codex entries (title, `entity_tags`, content) via hybrid keyword + vector lookup. Returns matching IDs, titles, categories, tags, and concise snippets.
   - `get_world_codex_entry(lore_id: str | None = None, title: str | None = None)`
     - Returns the full content of a single active-branch World Codex entry so the GM can verify existing canon or avoid duplicates before proposing.
   - `search_campaign_turns(query: str, limit: int = 5)` / `get_campaign_turns(start_turn: int, end_turn: int)`
     - Searches or fetches active-branch turn summaries/prose (`turn_nodes`), excluding `<cognition>` unless `unlock_lore === true`. Allows the GM to look back beyond `working_memory_turns` when drafting entries from earlier episodes.
   - `get_campaign_entity(kind: Literal["character", "location", "container"], query: str)`
     - Looks up permitted public details of characters, visited locations, or visited containers (respecting `unlock_lore` gating identically to `@` mention resolution).
2. **Proposal Tool (Human-Confirmed Write):**
   - `propose_world_lore_entry(category: WorldLoreCategory, title: str, entity_tags: list[str], content: str, source_turns: list[int] = [], replace_lore_id: str | None = None)`
     - Validates inputs through `WorldLoreNodeDraft` + deterministic hygiene (stripping OOC turn citations/reasoning tags), runs the duplicate-match check against existing World Codex entries, attaches a `GmCodexProposal` to the assistant message, and emits the `event: codex_proposal` SSE event.
     - Returns a structured tool result to the model: `{ status: "proposal_presented", title, category, duplicate_matches }` explicitly instructing the model to tell the user the tentative entry is ready for review/confirmation (never claiming it is already saved).
     - Only proposes when the user explicitly asked to add/save/draft a Codex entry (enforced both by tool description/system prompt and user-confirmation gating).

### FR-2.4: Future Tool Expansion Path (Out of Scope for v0.33.0–v0.34.0, Enabled by This Architecture)
Once Phase 2's tool loop and `propose_*` confirmation pattern are established, future versions can add additional tools without changing the core loop:
- `propose_location_lore_entry` / `propose_secret_reveal` (GM Mode gated)
- `propose_map_location` / `propose_location_connection`
- `propose_character_draft` (integrating with `wizards/char_gen/`)

---

## 5. Acceptance Criteria & Verification Plan

### 5.1 Phase 1 Acceptance Criteria
- [x] Clicking **`Draft Codex Entry`** on any GM Talk message generates a valid `WorldLoreNodeDraft` (`category`, `title`, `entity_tags`, `content`) via `complete_structured` with explicit `required_properties`.
- [x] Explicit conversational requests in GM Talk (e.g., *"add this to the codex"*) emit a `codex_proposal` SSE event and render the confirmation card without mutating `lore_nodes` automatically; ordinary OOC questions (including *"what would be a reasonable entry to add to the codex?"*) do not silently mutate state.
- [x] Generated `content` contains clean in-universe prose with OOC turn citations (`Sources: Turns ...`) and `<think>`/`<thought>`/`<reasoning>`/`<scratchpad>` blocks stripped; `source_turns` renders only as UI provenance metadata.
- [x] The inline confirmation card lets the user deterministically edit `title`, `category`, `entity_tags` (via `TagChipsInput`), and `content`, surfaces duplicate/similar World Codex entries, and offers **`Confirm & Save`** and **`Cancel`** with zero extra LLM calls.
- [x] Confirming persists the entry via `POST /api/campaigns/{campaign_id}/lore/entries` to the active branch's Copy-on-Write World Codex, indexes it in `vector_entries`, and makes it immediately searchable in World Codex and future GM Talk queries—without leaking to sibling branches.
- [x] Proposal state (`pending`, `confirmed`, `cancelled`) persists across drawer close/reopen and page reload on the active branch, and respects `unlock_lore` spoiler boundaries.

### 5.2 Phase 2 Acceptance Criteria
- [x] **Profile → Preferences → Behavior → GM Talk** exposes a **`GM Agentic Tools`** (`gm_tools_enabled`) toggle (default `false`) that works cleanly with `gm_model_role` (`Primary` vs `Clerk`).
- [x] When enabled on a tool-capable model, Neuromancer can execute bounded read-only tools (`search_world_codex`, `get_world_codex_entry`, `search_campaign_turns`, `get_campaign_turns`, `get_campaign_entity`) within `unlock_lore` constraints and emit `tool_status` SSE progress events.
- [x] Calling `propose_world_lore_entry` emits the exact same `codex_proposal` card and persistence flow as Phase 1 without writing to the database until the user confirms.
- [x] When disabled or when an active provider/model rejects native `tools`, GM Talk gracefully falls back to Phase 1 behavior without breaking OOC chat.

### 5.3 Required Verification Suite
- **Backend:**
  - `cd backend && .venv/bin/ruff check app tests && .venv/bin/tach check`
  - `backend/.venv/bin/pytest backend/tests` (covering `GmWorldLoreDraftLLMOutput` sanitization & `required_properties`, spoiler-safe vs GM-Mode draft context, branch-safe `POST /api/campaigns/{id}/lore/entries` append/update + vector indexing + sibling-branch isolation, `gm_chat_messages` proposal state persistence, and Phase 2 tool loop bounds, spoiler enforcement, and fallback behavior)
- **Frontend:**
  - `npm --prefix frontend run arch:check && npm --prefix frontend run css:audit && npm --prefix frontend run build && npm --prefix frontend test` (covering `GmTalkDrawer` proposal card rendering, deterministic edits via `TagChipsInput`, duplicate warning UI, confirm/cancel state transitions, `Draft Codex Entry` trigger, and `ProfileBehaviorCards` `gm_tools_enabled` toggle)
- **Architecture & Wiki Docs:**
  - `backend/.venv/bin/python scripts/generate_arch_docs.py && backend/.venv/bin/python scripts/generate_arch_docs.py --check`
  - Update user-facing wiki pages in `../cybercantina-wiki` (`Playing-Directing-and-Mechanics.md`, `First-Campaign-and-Interface-Tour.md`, `Prompt-Customization-and-Presets.md`, `Importing-and-Exporting.md`; plus `Providers-Models-and-Embeddings.md` in Phase 2).
