---
feature: gm-talk
target_version: 0.32.0
document_type: frd
status: completed
last_updated: 2026-11-23
---

# Feature Requirements Document (FRD)
## GM Talk — Out-of-Character Campaign Assistant & `@` Entity Mentions

**Status:** Completed  
**Target Version:** CyberCantina v0.32.0  
**Depends On:**
- [v0.25.0 Profile Modal UX Redesign](file:///home/diegolima/Git/cybercantina/docs/features/0.25.0-profile-modal-ux-redesign/FRD.md)
- [v0.28.0 Timeline Branching, Story Modal & Interactive Branch Graph](file:///home/diegolima/Git/cybercantina/docs/features/0.28.0-timeline-branching-and-story-modal/FRD.md)
- [v0.31.0 Campaign Lore Authoring, GM Mode ("Unlock Lore & Secrets"), Secret Discovery & Major Events](file:///home/diegolima/Git/cybercantina/docs/features/0.31.0-campaign-lore-gm-mode-and-major-events/FRD.md)

**Scope:**
- SQLite Schema & Persistence ([`schema.sql`](file:///home/diegolima/Git/cybercantina/backend/app/db/schema.sql), [`schema_init.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/schema_init.py), `backend/app/db/repos/gm_chat.py`, `backend/app/db/repos/users.py`)
- User Profile & System Default Model Settings ([`auth.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/auth.py), [`settings.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/settings.py), [`auth.py` router](file:///home/diegolima/Git/cybercantina/backend/app/routers/auth.py))
- GM Talk Prompt Template, Context/Retrieval Engine & Browser-Provider Routing ([`defaults.py`](file:///home/diegolima/Git/cybercantina/backend/app/prompts/defaults.py), `backend/app/engine/gm_talk.py`, [`vector_store.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/vector_store.py))
- Campaign GM Talk API Routes & `.zcc` Export/Import ([`backend/app/routers/campaign_routes/gm_routes.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/campaign_routes/), [`campaigns.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/campaigns.py), [`zcc_campaign_io.py`](file:///home/diegolima/Git/cybercantina/backend/app/services/zcc_campaign_io.py))
- Frontend Chat Composer Trigger, `/gm` Slash Command, GM Talk Slide-Out Drawer, Reused Composer GM Mode & `@` Mention Popover ([`ChatComposer.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/ChatComposer.tsx), [`GmTalkDrawer.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/GmTalkDrawer.tsx), [`GmMentionPopover.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/GmMentionPopover.tsx), [`useGmTalk.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/hooks/useGmTalk.ts), [`gm.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/api/gm.ts), [`turn.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/turn.ts))
- Frontend Profile Behavior Settings & Campaign Export Modal ([`ProfileBehaviorCards.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/ProfileBehaviorCards.tsx), [`ProfilePreferencesTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/ProfilePreferencesTab.tsx), [`profilePreferences.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/utils/profilePreferences.ts), [`auth.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/auth.ts))
- Modular Stylesheets ([`frontend/src/styles/`](file:///home/diegolima/Git/cybercantina/frontend/src/styles/))
- User-Facing Wiki Documentation ([`Playing-Directing-and-Mechanics.md`](file:///home/diegolima/Git/cybercantina-wiki/Playing-Directing-and-Mechanics.md), [`Interface-Tour.md`](file:///home/diegolima/Git/cybercantina-wiki/Interface-Tour.md), [`Providers-and-Models.md`](file:///home/diegolima/Git/cybercantina-wiki/Providers-and-Models.md), [`Prompt-Customization-and-Presets.md`](file:///home/diegolima/Git/cybercantina-wiki/Prompt-Customization-and-Presets.md))

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
CyberCantina's 5-phase turn pipeline is purpose-built for immersive, strictly in-character roleplay and epistemic isolation. However, during a running campaign, players frequently need to pause and talk **out of character (OOC)** to a Game Master—for example:
- Recapping what happened in an earlier turn (`"What happened in @Turn 2?"`),
- Asking grounded questions about world lore, faction history, or site details without advancing the story clock or triggering NPC reactions,
- Checking current world state, party/persona inventory, or character status,
- Brainstorming options or verifying continuity (and, when testing/authoring with GM Mode enabled, inspecting hidden secrets or NPC cognition).

Today, players have no dedicated OOC channel. Sending an OOC question in the main composer consumes a turn, triggers Phase 1–5 mutations, pollutes narrative history, and forces characters to respond in-character.

### 1.2 Proposed Solution
Introduce **GM Talk ("Neuromancer")**, a dedicated, read-only OOC chat modal accessible during any active campaign:
1. **`Talk to GM` Entry Point & `/gm` Slash Command:** A button positioned immediately to the left of the `Narrator` button in the campaign chat composer footer—plus `/gm` and `/gm <message>` slash commands—opening a separate GM Talk modal where **Neuromancer** greets the player.
2. **Branch-Safe GM Conversation Persistence:** GM chat messages are anchored to the active branch (`anchor_turn_id`), keeping OOC discussions isolated per timeline branch and cleanly resetting via a **`Clear Chat`** button.
3. **Grounded Campaign Context + Automatic Lore Retrieval:** By default, Neuromancer receives the last `N` verbatim turns on the active branch, the current location (and active container), and the user's current party (including the player persona), augmented by pre-turn semantic lore retrieval over the campaign's vector index.
4. **Intuitive `@` Mention Live Search (Antigravity-Style UX):** Typing `@` in the GM modal composer opens a two-stage `Browse` slide-out (`Characters`, `Lore`, `Locations`, `Containers`, `Turns`) supporting both category drill-down and direct live filtering, backed by structured entity IDs so multi-word names and turns inject full, exact context into the GM prompt.
5. **Unified Spoiler Safety via `unlock_lore`:** Spoiler gating reuses the existing **`Unlock Lore & Secrets (GM Mode)`** campaign setting (`campaign.world_settings.unlock_lore`) with no duplicate toggle. When disabled, unrevealed `secret` lore, unvisited locations/containers, and private NPC `<cognition>` / hidden CARE state are strictly excluded from GM context, vector retrieval, and `@` mention search.
6. **Dedicated GM Model Behavior Settings & Browser Routing:** A new **GM** card under **Profile → Preferences → Behavior** lets users choose which configured model role powers the GM (`Primary (Actor)` default vs. `Clerk`), plus `Temperature` (default `0.5`) and `Max Tokens` (default `1024`), with full support for server-side and Browser Ollama / WebGPU providers.
7. **Opt-In `.zcc` Campaign Export:** Campaign exports include an **`Include GM conversations`** toggle (off by default) to optionally bundle `gm_chat_messages` in `.zcc` v2 archives.

---

## 2. Scope, Boundaries & Core Invariants

1. **Zero Campaign Mutation Invariant (Hard):**
   - GM Talk is strictly **read-only** with respect to campaign simulation state. It must never create `turn_nodes`, advance the world clock, run Phase 1–5 pipelines, mutate `world_state_snapshots`, alter inventories/CARE/memories, or modify `lore_nodes`.
2. **Unified Spoiler-Safety Invariant via `unlock_lore` (Hard):**
   - `campaign.world_settings.unlock_lore` (**Unlock Lore & Secrets (GM Mode)**) is the single source of truth for GM spoiler visibility.
   - When `unlock_lore` is `False`:
     - Unrevealed `secret` lore entries (`category == "secret"` and `id` not in `world_snapshot.revealed_lore_ids`),
     - Unvisited locations and unvisited containers,
     - Private character `<cognition>` blocks, hidden CARE affective internals, and unrevealed character private secrets/memories
     must be excluded uniformly across **all three** backend layers: (a) default context assembly, (b) pre-turn vector RAG retrieval, and (c) `@` mention search & ID resolution.
   - Secrets whose IDs *are* in the active branch's `world_snapshot.revealed_lore_ids` remain visible to the GM even when `unlock_lore` is `False` so players can discuss discoveries already made in play.
   - When `unlock_lore` is `True`: the GM has full omniscient access to all world/location/container lore (including unrevealed secrets), all locations/containers, and turn `<cognition>` / internal character state.
3. **Active-Branch Truth & Branch-Safe GM Chat Invariant (Hard):**
   - All default context (last `N` verbatim turns, current location, party roster, active lore, revealed secret IDs) and all `@` mention lookups (`@Turns`, `@Lore`, `@Locations`, `@Containers`, `@Characters`) resolve strictly against the campaign's **currently active timeline branch** (`active_leaf_turn_id` ancestor chain).
   - Every persisted `gm_chat_messages` row is anchored to `anchor_turn_id` (`campaign.active_leaf_turn_id` at send time, or `NULL` if sent before Turn 1). Loading or clearing GM messages filters by `(anchor_turn_id IS NULL OR anchor_turn_id IN valid_branch_turn_ids)`, so branching from an earlier turn, switching to a sibling branch, or deleting/rewinding turns never leaks GM conversations across branches.
4. **Structured `@` Mention Identity Invariant (Hard):**
   - `@` mentions selected from the popover carry structured `{ kind, id, label }` references in the API request payload rather than relying on fragile free-text regex parsing for multi-word entity names.
5. **Local-Model-Friendly Hybrid Retrieval Invariant:**
   - Lore retrieval must not depend on multi-turn LLM tool/function calling (which is unreliable or slow on 8B–12B local Ollama/llama.cpp models). Instead, use deterministic **explicit `@` mention pinning + pre-turn semantic vector RAG** against CyberCantina's existing `vector_entries` index.
6. **UI, Styling & Security Hygiene:**
   - Use `--accent-violet` / `--accent-amber` for GM Talk icons, badges, and mention tokens; reserve `--accent-rose` strictly for errors and destructive actions (`Clear Chat`).
   - Place new CSS rules in the matching modular stylesheet under `frontend/src/styles/` (keeping `15-responsive.css` last) and pass `npm --prefix frontend run css:audit`.
   - Never leak raw exception strings (`str(exc)`) in SSE/HTTP error payloads; sanitize dynamic log values via `sanitize_log_value`.

---

## 3. Functional Requirements

### FR-1: Campaign Entry Point, ~50% Slide-Out Drawer & Reused Composer Mode

#### 1.1 `Talk to GM` Button & `/gm` Slash Command ([`ChatComposer.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/ChatComposer.tsx#L695-L717))
- Render a **`Talk to GM`** button inside `composer-footer-left`, immediately to the **left** of the `Narrator` button.
- Styling:
  - Uses the shared `.composer-action-btn` visual language with a distinct icon (`Compass` tinted `--accent-violet`) and clear tooltip: `"Talk to Neuromancer (GM) — Discuss world lore, state, and past turns out of character [/gm]"`.
  - When GM Talk is minimized while Neuromancer is still streaming in the background, displays a subtle pulsing dot indicator on **`Talk to GM`**.
  - On narrow/mobile viewports (`<= 620px`), adapts cleanly alongside `Narrator` and `Quick Exits` without overflowing the composer footer.
- **`/gm` Slash Command:**
  - Register `/gm` in the main composer's slash-command autocomplete and dispatcher:
    - `/gm` (no arguments): opens the GM Talk slide-out without consuming a campaign turn.
    - `/gm <message>`: opens the GM Talk slide-out and **immediately dispatches `<message>`** to Neuromancer as a GM Talk turn (clearing the main composer input without creating a campaign turn).
- Availability:
  - Visible during active campaigns.
  - Opening the slide-out is allowed while idle; if a main campaign turn is currently streaming (`isStreaming`), sending a new GM message (including via `/gm <message>`) is blocked/disabled with a brief notice (preventing contention on single-GPU local Ollama instances), while viewing existing GM chat history remains possible.

#### 1.2 GM Talk Slide-Out Layout (`GmTalkDrawer.tsx`), Reused Composer Mode & Click-Outside Minimize
- Clicking **`Talk to GM`** (or running `/gm`) opens a bottom-up slide-out panel anchored directly above `.composer-bar`, covering **~50% of the main chat feed** (with an optional expand/restore toggle to `84%` and a `72%` mobile fallback on `<= 620px`) while leaving the upper half of the campaign turn feed visible for reference:
  - **Header:**
    - Title (`Neuromancer · GM Talk` + campaign/world subtitle).
    - **Spoiler-Mode Status Pill (Read-Only):**
      - When `unlock_lore === false`: subtle muted/cyan pill **`Spoiler-Safe`** (tooltip: *"Secrets and character thoughts are hidden. Enable Unlock Lore & Secrets (GM Mode) in World Settings to allow spoilers."*).
      - When `unlock_lore === true`: subtle amber/violet pill **`GM Mode · Secrets Unlocked`** (tooltip: *"Unlock Lore & Secrets (GM Mode) is enabled in World Settings; Neuromancer can reference hidden secrets and character thoughts."*).
    - **Model Role Indicator:** Compact muted tag showing active model role (e.g., `Primary` or `Clerk`, temp `0.5`).
    - **`Clear Chat`** button (inline two-step confirm, rose accent) to delete the active branch's GM conversation and reset the slide-out to its blank initial state, plus Expand/Restore (`Maximize2`/`Minimize2`) and Minimize (`ChevronDown`) buttons.
  - **Message Stream & Initial Greeting State:**
    - Displays user and Neuromancer (GM) messages in a clean OOC chat layout (distinct from in-character `TurnCard` styling—no avatar portraits, dice trays, or choice cards).
    - **Blank / Initial Greeting:** When the active branch has no persisted GM messages (on first open or immediately after `Clear Chat`), render a non-persisted welcome message from **Neuromancer**:
      > *"Hello, I'm Neuromancer, Cybercantina's GM. You can ask me anything about the ongoing campaign."*
      accompanied by starter tips and a **`Browse @`** trigger button.
    - User messages render any attached `@` mentions as styled inline/header reference pills (e.g. `@Turn 2`, `@Kaelen`, `@The Rusty Anchor`).
    - Neuromancer responses stream token-by-token over SSE with a `Stop` button to abort generation mid-stream, render formatted Markdown prose, and include a one-click `Copy` action.
    - Optional compact collapsible footer on GM responses (`Sources used: ...`) listing pinned `@` mentions and retrieved lore titles (never exposing hidden/unrevealed titles when `unlock_lore === false`).
  - **Reused Prompt Area (GM Composer Mode):**
    - While the GM slide-out is open, `.composer-bar` switches into violet-accented **GM Mode** with an isolated GM draft (preserving any in-progress story draft, `editingTurn`, and staged `Choices` untouched until minimized).
    - Replaces story-only buttons (`Narrator`, `Exits`, `Choices`, `diceMode`, `Magic Wand`) with GM controls: active **`Talk to GM`** toggle, **`Browse @`**, **`Minimize`**, and **`Ask GM`** / **`Stop`**, plus the pinned `@` mention chip strip and Antigravity `@` mention popover (FR-2).
  - **Click-Outside Minimize & Escape Key Isolation:**
    - Clicking anywhere outside the slide-out panel and the reused `.composer-bar` smoothly collapses the drawer using a downward minimize animation (`gmMinimizeOut`) into the composer bar.
    - Pressing `Escape` while the `@` mention popover is open closes *only* the popover; pressing `Escape` when no popover is open minimizes the GM slide-out.

---

### FR-2: `@` Mention Live Search ("Antigravity-Style" UX)

#### 2.1 Trigger & Two-Stage Slide-Out (`GmMentionPopover.tsx`)
Typing `@` (at the start of the input or preceded by whitespace/opening punctuation) opens a floating popover anchored immediately above the GM modal composer:

1. **Stage 1 — `Browse` Mode (Immediately after typing `@` with empty query):**
   - Displays a **`Browse`** header listing selectable entity categories with icons and concise descriptions:
     - **`Characters`** — *"Party members, campaign characters & your persona"*
     - **`Lore`** — *"World Codex, location & container lore"*
     - **`Locations`** — *"Known campaign locations"* (or *"All world locations"* when `unlock_lore === true`)
     - **`Containers`** — *"Known rooms, buildings & nested areas"* (or *"All containers"* when `unlock_lore === true`)
     - **`Turns`** — *"Jump to a turn on the active branch"*
2. **Stage 2 — Category Drill-Down (Selecting a category via click, `Enter`, or `Tab`):**
   - Transitions the active `@` token in the composer to a scoped category prefix (matching the Antigravity `@category:` pattern):
     - `@characters:`, `@lore:`, `@locations:`, `@containers:`, `@turns:`
   - Displays the list of selectable items in that category, filtered live as the user continues typing after the colon:
     - **Characters:** Name + role badge (`Persona`, `In Party`, `Present`, or `Campaign NPC`).
     - **Lore:** Title + category badge (`History`, `Faction`, `Artifact`, `Rumor`, `Local`, `Secret`) + scope breadcrumb (e.g., `World Codex` or location/container name).
     - **Locations:** Location name + brief summary/tags + `Current` badge if active location.
     - **Containers:** Container name + parent hierarchy breadcrumb (e.g., `Cantina › Backroom Safe`) + `Current` badge if active.
     - **Turns:** Reverse-chronological list of active-branch turns showing `Turn #N` + truncated user/narrator preview (e.g. `Turn 14 · "I inspect the console..."`). Typing digits (e.g. `2` or `14`) prioritizes exact/prefix turn-number matches; typing words filters by turn text/bookmark title. (Typing `@turns:2` or `@Turn 2` selects Turn 2 effortlessly via mouse or arrow keys.)
   - Displays a subtle footer hint: `↑↓ navigate · Enter select · Backspace back · esc to exit`.
3. **Direct Live Search (Continuing to type after `@` without choosing a category):**
   - Typing immediately after `@` (e.g., `@kael`, `@turn 2`, `@rusty`) switches the popover seamlessly from `Browse` into **Unified Live Search** across all permitted categories simultaneously.
   - Results narrow dynamically as characters are typed, showing each match's category icon/badge and secondary context snippet.
   - Special handling for `@turn <N>` / `@t<N>` queries: prioritizes matching active-branch turn numbers near the top of unified results.

#### 2.2 Keyboard Navigation & Selection Mechanics
- `ArrowUp` / `ArrowDown`: Move highlight across categories (Stage 1) or results (Stage 2 / Live Search), wrapping or clamping smoothly and keeping the active item scrolled into view.
- `Enter` or `Tab`:
  - In Stage 1 (`Browse`): drills into the highlighted category (inserts `@<category>:`).
  - In Stage 2 / Live Search: selects the highlighted entity, replaces the active `@...` query in the textarea with a clean readable token (e.g., `@Kaelen` or `@Turn 2` followed by a trailing space), and registers the structured mention `{ kind, id, label }` in the message's mention list.
- `Backspace`: When the caret is immediately after an empty category prefix (e.g., `@lore:`), pops back to Stage 1 (`Browse`) with `@` remaining open.
- `Escape`: Dismisses the popover cleanly without closing the GM modal.
- **Mention Chip Strip & Sync:**
  - Selected mentions are displayed as removable compact chips (`TagChips`-style, with category icon and `×`) directly above the composer input so users can verify exactly which entities will be pinned into GM context—and removing a chip (or deleting its token from the text) removes that mention from the submitted payload.
  - Cap pinned mentions per message to a sensible limit (e.g., `10` mentions max) to protect smaller local context windows.

#### 2.3 Mention Search Endpoint & Spoiler Filtering
- `GET /api/campaigns/{campaign_id}/gm/mentions?category=<optional>&q=<optional>&limit=<default 20>`:
  - Resolves all entities against the campaign's **active branch** (`active_leaf_turn_id`).
  - Enforces `campaign.world_settings.unlock_lore`:
    - When `unlock_lore === false`:
      - `lore`: excludes `category == "secret"` unless `lore.id in current_world_snapshot.revealed_lore_ids`; excludes lore attached to unvisited locations/containers.
      - `locations`: includes only locations in `current_world_snapshot.visited_location_ids` (plus current active location).
      - `containers`: includes only containers in `current_world_snapshot.visited_container_ids` (plus active container's ancestor chain).
      - `characters`: includes the user's persona and campaign characters (no hidden spoiler fields exposed in snippets).
      - `turns`: active-branch turns only (public user message + prose/bookmark preview; never `<cognition>`).
    - When `unlock_lore === true`: includes all world/location/container lore (including unrevealed secrets, tagged as `Secret · Hidden` vs `Secret · Discovered`), all locations, and all containers.

---

### FR-3: GM Context Assembly, Spoiler Safety & Lore Retrieval

#### 3.1 GM System Prompt (`PROMPT_KEY_GM_TALK_SYSTEM`)
- Register `PROMPT_KEY_GM_TALK_SYSTEM = "gm_talk_system"` in [`backend/app/prompts/defaults.py`](file:///home/diegolima/Git/cybercantina/backend/app/prompts/defaults.py) (available in Prompt Presets & Prompt Editor).
- System prompt responsibilities:
  - Establishes the persona of **Neuromancer**, CyberCantina's out-of-character Game Master (helpful, analytical, concise, never roleplaying as an NPC unless the user explicitly asks for an example/brainstorm).
  - Grounds all answers strictly in the supplied campaign context (`<world>`, `<current_scene>`, `<party>`, `<recent_turns>`, `<referenced_entities>`, `<retrieved_lore>`), explicitly admitting when something is unknown or unestablished rather than hallucinating canon.
  - Includes a dynamic spoiler-policy directive matching `campaign.world_settings.unlock_lore`:
    - When `False`: explicitly reminds the GM that it is operating in **Spoiler-Safe Mode** and only sees player-known facts.
    - When `True`: notes that **GM Mode** is active and hidden secrets / internal character thoughts may be discussed openly.

#### 3.2 Default Context Injection (Every GM Message)
Assembled fresh on each GM request from the active branch state:
1. **World Overview:** World name, genre, tone, setting overview, tech/magic rules, and current in-game timestamp (`world_clock`).
2. **Current Location & Scene:** Active location name, description, environmental tags, active container hierarchy (if inside a container), active `scene_flags`, and present characters.
3. **User's Party & Persona:**
   - Active player persona (name, bio/description, equipped items, carried inventory, persona lore entries).
   - Every character currently in the user's party (`parties_json` / active party membership): name, tagline, core public appearance/summary, equipped & carried inventory, current status.
   - *When `unlock_lore === true` only:* also includes character internal CARE affective summary and private motivations/core drive/fear.
4. **Last `N` Verbatim Turns (Active Branch):**
   - Pulls the last `N` turns along the active branch up to `active_leaf_turn_id`, where `N` defaults to the user's effective `working_memory_turns` (bounded by a safe token budget reserved for recent history).
   - Formats each turn clearly with its branch turn number (`Turn #12`), timestamp, location, user input, and narrative prose.
   - *When `unlock_lore === true` only:* optionally appends concise character `<cognition>` summaries for those turns within budget.
5. **Prior GM Talk History:**
   - Recent GM Talk user/assistant messages for continuity, trimmed oldest-first to stay safely within the GM model's `context_size` minus output `gm_max_tokens`.

#### 3.3 Explicit `@` Mention Pinning (`<referenced_entities>`)
- Every `{ kind, id }` submitted in `mentions` is re-validated server-side against the campaign, active branch, and `unlock_lore` gate (silently skipping or flagging any unauthorized/unrevealed ID).
- Validated entities are serialized in full and injected with high priority (never dropped before RAG results):
  - **`character` / `persona`:** Full public identity, appearance, current location, party membership, equipped & carried items (plus core drive/fear, moral code, CARE affective state, and top character memories when `unlock_lore === true`).
  - **`location`:** Name, description, environmental tags, exits/neighbors, present characters, containers summary, and permitted local lore.
  - **`container`:** Name, container type, hierarchy path, description, items, and permitted L1 container lore.
  - **`lore`:** Full title, category, scope (World / Location / Container), entity tags, and full content.
  - **`turn`:** Exact branch turn number, timestamp, active location, user message, full narrative prose, bookmark/personal note if present (plus `<cognition>` blocks and post-turn delta summary when `unlock_lore === true`).

#### 3.4 Automatic Pre-Turn Lore Retrieval (`<retrieved_lore>`)
- In addition to explicit `@` mentions, the backend runs a lightweight pre-turn retrieval query using the user's latest GM message (and optionally the previous GM exchange if the message is a short follow-up like *"tell me more about them"*):
  - Queries `vector_entries` via CyberCantina's existing `embed_text` + branch-safe filtering (matching v0.31.0's `(campaign_id IS NULL OR campaign_id = ?)` + `anchor_turn_id` / `superseded_at_turn_id` active-branch logic) for:
    - World / Location / L1 Container lore (`source_type = 'lore'`),
    - Active-branch episodic summaries (`source_type = 'episodic'`).
  - Also runs lightweight keyword/tag matching against active-branch `lore_nodes` titles & `entity_tags` as a fallback when embeddings are unavailable or offline.
  - **Spoiler Enforcement:**
    - When `unlock_lore === false`: strictly filters out any `secret` lore not in `revealed_lore_ids`, any lore belonging to unvisited locations/containers, and any character private cognition vectors.
    - When `unlock_lore === true`: may also search unrevealed `secret` lore nodes (via keyword/content match since `secret` nodes are excluded from `vector_entries` by design in v0.31.0).
  - Deduplicates retrieved entries against already-pinned `@` mentions and injects top-K matches within a dedicated token budget (e.g., `~1200` tokens or proportional to model context size).

---

### FR-4: GM Model Configuration & Profile Behavior Settings

#### 4.1 User Settings & System Defaults Schema
Extend user/system behavior settings consistently across DB, Pydantic schemas, and TypeScript types:

| Field | Type | Constraints | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `gm_model_role` | `Literal["primary", "clerk"]` | `"primary"` \| `"clerk"` | `"primary"` | Which configured model profile (Primary Actor vs. Clerk) powers GM Talk. |
| `gm_temperature` | `float` | `0.0 <= v <= 2.0` | `0.5` | Sampling temperature used specifically for GM Talk completions. |
| `gm_max_tokens` | `int` | `128 <= v <= 4096` | `1024` | Maximum output tokens per GM Talk response. |

- **Database ([`schema.sql`](file:///home/diegolima/Git/cybercantina/backend/app/db/schema.sql#L61-L79), [`schema_init.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/schema_init.py)):**
  - Add nullable columns `gm_model_role TEXT NULL`, `gm_temperature REAL NULL`, `gm_max_tokens INTEGER NULL` to `user_model_settings` via idempotent `ALTER TABLE` migrations.
  - Add corresponding default fields on `AppSettings` (system-wide defaults configurable by admins if desired, defaulting to `"primary"`, `0.5`, `1024`).
- **API Schemas ([`backend/app/schemas/auth.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/auth.py#L316-L398), [`frontend/src/types/auth.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/auth.ts)):**
  - Add `gm_model_role`, `gm_temperature`, `gm_max_tokens` to `UserModelSettingsPayload`.
  - Add `effective_gm_*`, `user_gm_*`, and `default_gm_*` fields to `ProfileModelSettingsResponse`.
- **Model Resolution & Browser-Local Provider Routing:**
  - When `effective_gm_model_role == "primary"` (or when `"clerk"` is selected and `effective_clerk_mirrors_actor` is `True`): resolve the user's effective **Actor** `ModelProfile` (provider, model, context size, keep-alive, credentials/relay) and override only `temperature = effective_gm_temperature` and `max_tokens = effective_gm_max_tokens`.
  - When `effective_gm_model_role == "clerk"` and `effective_clerk_mirrors_actor` is `False`: resolve the user's effective **Clerk** `ModelProfile` and override `temperature` and `max_tokens`.
  - **Browser Ollama / WebGPU Routing:** If the resolved `ModelProfile` uses a browser-local provider (`browser_ollama` or `webgpu`), GM Talk reuses the existing client-side browser-provider execution/relay flow (assembling the prompt/context on the backend, executing inference in the browser, and persisting the completed user + assistant turn to `gm_chat_messages`) so BYOP/browser-local users have full parity.
  - Because `context_size` and model identity stay identical to the already-configured Primary or Clerk profile, Ollama does not need to reload/evict models just to answer a GM question.

#### 4.2 Profile → Preferences → Behavior UI ([`ProfileBehaviorCards.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/ProfileBehaviorCards.tsx))
- Add a 5th behavior card titled **`GM Talk`** (subtitle: `Out-of-Character Assistant`, accent: `var(--accent-violet)` or `var(--accent-amber)`) in `BEHAVIOR_CARD_META` ([`profilePreferences.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/utils/profilePreferences.ts#L58-L83)) and `ProfileBehaviorCards.tsx`:
  - **Model Role Select:** `Primary (Actor)` / `Clerk` (with clear note if `Clerk mirrors Actor` is currently enabled).
  - **Temperature Input:** Numeric/stepped input (`0.0`–`2.0`, step `0.05` or `0.1`, default `0.5`) with validation and per-field reset button (`FieldResetButton`).
  - **Max Tokens Input:** `IntegerField` (`128`–`4096`, default `1024`) with validation and per-field reset button.
- Respects `isLocked` (`!allow_user_model_overrides`) and participates in the existing Profile auto-save / `Reset All` / validation count flow seamlessly.

---

### FR-5: Backend Persistence & Streaming API

#### 5.1 Database Table (`gm_chat_messages`)
Add a dedicated, branch-safe `gm_chat_messages` table in [`schema.sql`](file:///home/diegolima/Git/cybercantina/backend/app/db/schema.sql):
```sql
CREATE TABLE IF NOT EXISTS gm_chat_messages (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    anchor_turn_id TEXT NULL REFERENCES turn_nodes(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    mentions_json TEXT NOT NULL DEFAULT '[]',
    sources_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gm_chat_messages_campaign
    ON gm_chat_messages(campaign_id, anchor_turn_id, created_at);
```
- **Branch-Safety Semantics:**
  - Each message pair created during GM Talk records `anchor_turn_id = campaign.active_leaf_turn_id` (`NULL` if sent before Turn 1).
  - Querying (`GET`) and clearing (`DELETE`) GM messages filter strictly to `(anchor_turn_id IS NULL OR anchor_turn_id IN valid_branch_turn_ids)` for the campaign's active branch.
  - Branching from an earlier turn, switching to a sibling timeline, or rewinding/deleting turns (`ON DELETE CASCADE`) keeps GM conversations strictly isolated to their branch without cluttering `turn_nodes`.

#### 5.2 API Endpoints (`backend/app/routers/campaign_routes/gm_routes.py`)
All routes verify campaign ownership via existing campaign access guards:
1. `GET /api/campaigns/{campaign_id}/gm/messages`
   - Returns persisted GM chat messages for the **active branch** (chronological), current `unlock_lore` boolean, and active GM model summary (`role`, `model_name`, `temperature`, `max_tokens`).
2. `DELETE /api/campaigns/{campaign_id}/gm/messages`
   - Deletes `gm_chat_messages` rows belonging to the **active branch** (`anchor_turn_id IS NULL OR anchor_turn_id IN valid_branch_turn_ids`)—leaving sibling branches intact—and returns `{ cleared: true }`.
3. `GET /api/campaigns/{campaign_id}/gm/mentions`
   - Query params: `category?: "characters" | "lore" | "locations" | "containers" | "turns"`, `q?: string`, `limit?: int = 25`.
   - Returns structured candidate items `{ kind, id, label, subtitle, badge }` filtered by active branch and `unlock_lore`.
4. `POST /api/campaigns/{campaign_id}/gm/chat`
   - Request body: `{ message: str, mentions: list[GmMentionRef] = [] }` (plus optional browser-provider relay headers/execution support consistent with existing turn streaming).
   - Streams Server-Sent Events (`text/event-stream`)—or, for browser-local providers (`browser_ollama` / `webgpu`), returns the assembled prompt/meta for client execution followed by persistence via a completion endpoint (or unified relay stream):
     - `event: meta` — `{ unlock_lore, model_role, model, pinned_mentions, retrieved_sources }`
     - `event: token` — `{ text }` (incremental streamed tokens; strips leaked `<think>`/`<thought>`/`<reasoning>`/`<scratchpad>` wrapper blocks deterministically)
     - `event: done` — `{ user_message, assistant_message }` (persisted rows anchored to `active_leaf_turn_id`)
     - `event: error` — `{ detail }` (sanitized user-facing error message, never raw stack trace)
   - If the client cancels/aborts mid-stream, no half-corrupted assistant message is persisted (or partial response is discarded cleanly).
   - Supports offline/mock fallback cleanly for automated tests when `allow_offline_fallback` is enabled.

---

### FR-6: `.zcc` Export/Import & Documentation Boundaries
- **`.zcc` Exports ([`zcc_campaign_io.py`](file:///home/diegolima/Git/cybercantina/backend/app/services/zcc_campaign_io.py)):**
  - Base-world exports (`base_only=True`) never include `gm_chat_messages`.
  - Add an **`Include GM conversations`** toggle (`include_gm_chat: bool = False`, **off by default**) to the Campaign Export UI and export endpoint query/body.
  - When `include_gm_chat=True`: serialize `gm_chat_messages` (including `anchor_turn_id`, `role`, `content`, `mentions_json`, `sources_json`, `created_at`) into the `.zcc` v2 campaign manifest, and remap `campaign_id` / `anchor_turn_id` cleanly on import.
  - When `include_gm_chat=False` (default): omit `gm_chat_messages` from the archive.
- **Wiki Documentation:**
  - Update [`Playing-Directing-and-Mechanics.md`](file:///home/diegolima/Git/cybercantina-wiki/Playing-Directing-and-Mechanics.md), [`Interface-Tour.md`](file:///home/diegolima/Git/cybercantina-wiki/Interface-Tour.md), [`Providers-and-Models.md`](file:///home/diegolima/Git/cybercantina-wiki/Providers-and-Models.md), and [`Prompt-Customization-and-Presets.md`](file:///home/diegolima/Git/cybercantina-wiki/Prompt-Customization-and-Presets.md) in `../cybercantina-wiki`.

---

## 4. Resolved Design Decisions

1. **GM Identity & Initial Greeting:** The GM is named **Neuromancer**. Opening a blank GM chat (first open or after `Clear Chat`) displays the non-persisted greeting: *"Hello, I'm Neuromancer, Cybercantina's GM. You can ask me anything about the ongoing campaign."*
2. **Branch-Safe GM Chat Persistence:** `gm_chat_messages` includes `anchor_turn_id` referencing `turn_nodes(id) ON DELETE CASCADE`, scoping reads, `Clear Chat`, and turn deletions/rewinds strictly to the active timeline branch.
3. **Campaign `.zcc` Export Opt-In:** Campaign exports expose an **`Include GM conversations`** toggle (default `false`); when enabled, `gm_chat_messages` round-trips cleanly in `.zcc` v2 archives.
4. **Browser Ollama / WebGPU Routing:** Supported in v0.32.0 by reusing CyberCantina's existing browser-provider execution/relay pipeline.
5. **Main Composer `/gm` Slash Command:** `/gm` opens the GM Talk modal; `/gm <message>` opens the modal and immediately sends `<message>` to Neuromancer.
6. **Unified Spoiler Gating:** Driven solely by `campaign.world_settings.unlock_lore` (no separate GM spoiler toggle).

---

## 5. Acceptance Criteria & Verification Plan

### 5.1 Acceptance Criteria
- [x] A **`Talk to GM`** button appears in the campaign chat composer footer immediately to the left of the **`Narrator`** button and opens the GM Talk modal.
- [x] Typing `/gm` in the main composer opens the GM Talk modal; typing `/gm <message>` opens the modal and immediately sends `<message>` to Neuromancer without creating a campaign turn.
- [x] Opening a blank GM chat (or clicking **`Clear Chat`**) displays Neuromancer's greeting (*"Hello, I'm Neuromancer, Cybercantina's GM. You can ask me anything about the ongoing campaign."*).
- [x] GM Talk maintains a separate, branch-safe persisted OOC chat (`gm_chat_messages` with `anchor_turn_id`) supporting SSE token streaming, Browser Ollama / WebGPU routing, `Stop` cancellation, Markdown rendering, and branch-scoped **`Clear Chat`**, without ever mutating campaign turns, world state, CARE, memories, or lore.
- [x] Default GM context includes the active branch's last `N` verbatim turns (`working_memory_turns`), active location/container, user party roster, and player persona, supplemented by automatic pre-turn lore/episodic retrieval.
- [x] Typing `@` in the GM modal opens the `Browse` slide-out (`Characters`, `Lore`, `Locations`, `Containers`, `Turns`); selecting a category drills down into filterable items (including reverse-chronological turn previews for `Turns`), and typing directly without choosing a category narrows unified results live.
- [x] Keyboard navigation (`↑`/`↓`, `Enter`/`Tab`, `Backspace` to return to `Browse`, `Esc` closing only the popover) works cleanly, and selected mentions submit structured `{ kind, id, label }` references that inject full entity context into the GM prompt.
- [x] Spoiler safety is driven exclusively by `campaign.world_settings.unlock_lore`:
  - When `unlock_lore === false`: unrevealed `secret` lore, unvisited locations/containers, and private `<cognition>` / internal CARE values are excluded from default context, vector retrieval, and `@` mention search/resolution; revealed secrets (`revealed_lore_ids`) remain accessible.
  - When `unlock_lore === true`: all secrets, locations, containers, and turn `<cognition>` are accessible, and the modal header displays the GM Mode status pill.
- [x] **Profile → Preferences → Behavior** includes a **`GM Talk`** card allowing users to configure Model Role (`Primary` default vs. `Clerk`), Temperature (`0.5` default), and Max Tokens (`1024` default) with per-field reset buttons and `allow_user_model_overrides` lock parity.
- [x] Campaign `.zcc` export includes an **`Include GM conversations`** toggle (off by default) that round-trips `gm_chat_messages` when enabled.
- [x] `PROMPT_KEY_GM_TALK_SYSTEM` is registered in `defaults.py` and editable via Prompt Presets.

### 5.2 Required Verification Suite
- **Backend:**
  - `cd backend && .venv/bin/ruff check app tests && .venv/bin/tach check`
  - `backend/.venv/bin/pytest backend/tests` (covering `gm_chat_messages` + `user_model_settings` migrations, branch-safe `anchor_turn_id` isolation & `Clear Chat`, GM behavior settings resolution & defaults, active-branch context assembly, `unlock_lore=False` vs `True` enforcement across context/RAG/mentions, explicit `@` mention pinning, SSE streaming + zero-mutation verification, and `.zcc` v2 `include_gm_chat` export/import round-trip)
- **Frontend:**
  - `npm --prefix frontend run arch:check && npm --prefix frontend run css:audit && npm --prefix frontend run build && npm --prefix frontend test` (covering `Talk to GM` button placement left of `Narrator`, `/gm` and `/gm <message>` slash command handling, `GmTalkModal` Neuromancer greeting, spoiler pill & `Clear Chat`, `@` mention state machine — Browse → category drill-down → direct live search → Backspace/Esc handling, `ProfileBehaviorCards` GM Talk card rendering & reset, and export modal `Include GM conversations` toggle)
- **Architecture & Wiki Docs:**
  - `backend/.venv/bin/python scripts/generate_arch_docs.py && backend/.venv/bin/python scripts/generate_arch_docs.py --check`
  - Update user-facing wiki pages in `../cybercantina-wiki` (`Playing-Directing-and-Mechanics.md`, `Interface-Tour.md`, `Providers-and-Models.md`, `Prompt-Customization-and-Presets.md`).
