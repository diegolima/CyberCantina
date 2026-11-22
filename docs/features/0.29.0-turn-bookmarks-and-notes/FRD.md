---
feature: turn-bookmarks-and-notes
target_version: 0.29.0
document_type: frd
status: completed
last_updated: 2026-11-22
---

# Feature Requirements Document (FRD)
## Turn Bookmarks, Personal Notes & Clerk Single-Turn Summarization

**Status:** Completed  
**Target Version:** CyberCantina v0.29.0  
**Depends On:**
- [v0.28.0 Timeline Branching, Story Modal & Interactive Branch Graph](file:///home/diegolima/Git/cybercantina/docs/features/0.28.0-timeline-branching-and-story-modal/FRD.md)
- [v0.28.1 Branch Graph Summarized Episode Grouping & Alternate Summary Switcher](file:///home/diegolima/Git/cybercantina/docs/features/0.28.1-branch-graph-episode-grouping/FRD.md)

**Scope:**
- SQLite Schema & Turn Repository Persistence ([`schema.sql`](file:///home/diegolima/Git/cybercantina/backend/app/db/schema.sql), [`schema_init.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/schema_init.py), [`turns.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/turns.py))
- Turn Schemas & Campaign Turn Bookmark/Summary Endpoints ([`turn.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/turn.py), [`crud_and_state.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/campaign_routes/crud_and_state.py))
- Dedicated Clerk Single-Turn Summary Prompt & Helper ([`defaults.py`](file:///home/diegolima/Git/cybercantina/backend/app/prompts/defaults.py), [`episodic.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/clerk/episodic.py))
- Frontend Types, API Client, Turn Card Bookmark UI & Magic Wand Note Editor ([`turn.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/turn.ts), [`campaigns.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/api/campaigns.ts), [`TurnCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/TurnCard.tsx), [`MagicWandButton.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/MagicWandButton.tsx))
- Story Modal `Bookmarks` Tab & Branch Graph Integration ([`StoryModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/story/StoryModal.tsx), [`BranchGraphCanvas.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/story/BranchGraphCanvas.tsx), [`branchGraphLayout.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/story/branchGraphLayout.ts), [`styles.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css))
- User-Facing Wiki Documentation ([`Live-Inspector-Map-and-Timeline.md`](file:///home/diegolima/Git/cybercantina-wiki/Live-Inspector-Map-and-Timeline.md), [`Playing-Directing-and-Mechanics.md`](file:///home/diegolima/Git/cybercantina-wiki/Playing-Directing-and-Mechanics.md))

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
In long, multi-branch CyberCantina campaigns, players frequently want to mark memorable roleplay exchanges, character turning points, or strategic branch candidates so they can revisit or branch from them later. Today, navigation relies on two automatic mechanisms that leave a gap:

1. **Plot-Only Notable Events (`notable_event_summary`):** The Phase 5 World Clerk only populates `notable_event_summary` when a significant macro plot or world-state shift occurs ([`defaults.py`](file:///home/diegolima/Git/cybercantina/backend/app/prompts/defaults.py#L222)). Emotionally resonant dialogue, humor, or subtle character moments receive `null` and fall back to raw `user_message` snippets in [`branchGraphLayout.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/story/branchGraphLayout.ts#L205-L230).
2. **No Player-Curated Turn Index:** While `StoryModal` (`Summary` + `Timelines`) exposes episodic summaries and the full branch graph, players have no way to bookmark specific turns across active or alternate branches, attach personal out-of-character notes, search those bookmarks by note keywords, or jump directly to them.

### 1.2 Proposed Solution
Introduce **Turn Bookmarks & Personal Notes** as a lightweight, strictly out-of-context annotation layer:

1. **Turn Card Bookmark Toggle & Purple Note Row:** Every eligible narrative turn card (`depth_index >= 1`, non-arrival) gets a dedicated top-left **Bookmark** toggle button and, once bookmarked, an inline purple-accented personal note display & editor positioned below any `notable_event_summary`.
2. **Un-Bookmark Note Retention:** Toggling a bookmark off preserves the user's `user_note` in SQLite (hidden while un-bookmarked, restored if re-bookmarked) to prevent accidental data loss.
3. **Clerk Magic Wand Summarizer:** Inside the bookmark note editor, a **Magic Wand** button calls the **Clerk** model with a dedicated unconditional 1-sentence summary prompt—passing both the target turn and its immediate parent turn for pronoun/context resolution.
4. **Timeline (`BranchGraphCanvas`) Integration:** Consistent **Bookmark** iconography across turn nodes and collapsed Episode pseudo-nodes, updated node description precedence (`user_note` -> `notable_event_summary` -> existing fallback), and preservation of bookmarked swipes so they are never hidden on the graph.
5. **Story Modal `Bookmarks` Tab:** A dedicated searchable index of all bookmarked turns across the campaign (ordered by `Turn #`, then swipe/creation order), with one-click jump-to-moment on the active timeline or automatic focus-and-expand inside `Timelines` for alternate branches/swipes.

---

## 2. Scope, Boundaries & Core Invariants

1. **Strict Zero-Context-Injection Invariant:**
   - `user_note` and `is_bookmarked` are **purely player-facing metadata**. They must **never** be injected into Phase 1–5 LLM prompts (Zones 1–4 working memory, episodic chunk compaction, character cognition, character post-turn agents, or `vector_entries` embeddings).
2. **Icon & Color Separation Invariant:**
   - `★` and amber (`--accent-amber`) remain exclusively reserved for Clerk-generated **`notable_event_summary`** and episodic milestones.
   - **Bookmark** (`Bookmark` icon from `lucide-react`) and **purple/violet** (`var(--accent-violet)` / `var(--accent-purple)`) are used consistently across **all** surfaces (Turn Card toggle, Turn Card note row, Story `Bookmarks` tab, Timeline turn nodes, and Timeline Episode summary badges) to prevent symbol collision with `★` or color collision with blue (`#93c5fd`) Director Choices Guidance.
3. **Eligibility Exclusions (Hard Invariant):**
   - **Turn #0 (`depth_index === 0`, Opening Scene)** cannot be bookmarked.
   - **Map-move turns (`actor_id === "__arrival__"`, rendered via [`StandaloneArrivalCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/StandaloneArrivalCard.tsx))** cannot be bookmarked.
   - Both exclusions must be enforced in the frontend (button omitted) and backend (HTTP `400 Bad Request`).
4. **Data Retention on Un-Bookmark:**
   - Setting `is_bookmarked = false` **must not** wipe `user_note` in SQLite. If the turn is bookmarked again later, its previously saved `user_note` reappears intact.
5. **Architectural Separation from `post_turn_json`:**
   - `is_bookmarked` and `user_note` live as first-class columns on `turn_nodes` (and top-level fields on `TurnNodeRecord`), **not** inside `post_turn_json`. Phase 5 Clerk/Agent execution and `AgentChangesModal` mutation counters remain untouched.
6. **Out of Scope for v0.29.0:**
   - Injecting bookmarked turns or notes into RAG/LLM prompts.
   - Bookmark folders, multi-tag taxonomies, or per-character private bookmarks.
   - Bookmarking Turn #0 or `__arrival__` map-move waypoints.

---

## 3. Functional Requirements

### FR-1: Data Model & Persistence (`turn_nodes`)

#### 1.1 SQLite Schema & Migration
- Extend `turn_nodes` in [`schema.sql`](file:///home/diegolima/Git/cybercantina/backend/app/db/schema.sql#L344-L360) with:
  - `is_bookmarked INTEGER NOT NULL DEFAULT 0`
  - `user_note TEXT NULL`
- Add an idempotent `ALTER TABLE` migration in [`SchemaInitMixin`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/schema_init.py) checking `PRAGMA table_info(turn_nodes)` so existing databases upgrade cleanly without data loss.
- Expose `is_bookmarked: bool = False` and `user_note: str | None = None` on `TurnNodeRecord` in [`backend/app/schemas/turn.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/turn.py) and [`frontend/src/types/turn.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/turn.ts).

#### 1.2 Backend Turn Bookmark API
Add authenticated, campaign-owner-scoped endpoints in [`crud_and_state.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/campaign_routes/crud_and_state.py):

1. **`PATCH /api/campaigns/{campaign_id}/turns/{turn_id}/bookmark`**
   - **Request Body:** `{ is_bookmarked?: bool, user_note?: str | None }` (partial updates allowed; `user_note` trimmed and normalized—empty/whitespace string stored as `None`, capped at a reasonable max length such as 500 characters).
   - **Validation & Guards:**
     - Verify campaign ownership (`owner_id == current_user.id`) and that `turn_id` belongs to `campaign_id`.
     - Reject with HTTP `400` if `turn.depth_index == 0` (`"Turn #0 cannot be bookmarked"`) or `turn.actor_id == "__arrival__"` (`"Map-move turns cannot be bookmarked"`).
     - Updating `is_bookmarked` to `False` preserves existing `user_note` unless `user_note` is explicitly provided in the payload.
   - **Response:** Updated `TurnNodeRecord` (or updated `CampaignStateBundle` / bookmark payload; returning updated `TurnNodeRecord` allows lightweight in-place state patching without re-fetching the entire campaign).

2. **`POST /api/campaigns/{campaign_id}/turns/{turn_id}/bookmark-summary`**
   - **Behavior:** Invokes the **Clerk** model (`eff_clerk`) to summarize `turn_id` in 1 concise sentence for use as a bookmark note draft (does **not** auto-save to `user_note` so the user can review, edit, or undo via the Magic Wand before saving).
   - **Validation & Guards:** Same ownership, campaign membership, and non-Turn-0 / non-`__arrival__` checks as above.
   - **Response:** `{ summary: str }`.

---

### FR-2: Turn Card Bookmark Toggle, Note Display & Editor (`TurnCard.tsx`)

#### 2.1 Top-Left Dedicated Bookmark Slot
- On every eligible turn card (`!isRoot` and not `__arrival__`), render a **Bookmark** button (`<Bookmark size={14} />`) in a dedicated **top-left corner slot / header row** with explicit padding/flex layout inside `.turn-card` so it:
  - Never overlaps the right-aligned `.user-bubble` (even on narrow viewports with long messages) or other turn-card header badges.
  - Remains untoggled by default (subtle muted outline icon; filled purple/violet icon when `turn.is_bookmarked === true`).
- Clicking the button toggles `turn.is_bookmarked` immediately (disabled only while a bookmark mutation for that turn is in flight).
- **Turn #0 (`isRoot`)** and **map-move cards ([`StandaloneArrivalCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/StandaloneArrivalCard.tsx))** do **not** render any bookmark control.

#### 2.2 Footer Display & Ordering
- In [`TurnCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/TurnCard.tsx#L1106-L1121) (footer metadata area):
  - Keep `notable_event_summary` rendered as before (`★ {turn.post_turn.notable_event_summary}` in `var(--accent-amber)`).
  - When `turn.is_bookmarked` is `true`, render the bookmark note row **below** `notable_event_summary` (or in the dedicated bookmark note slot below the primary metadata row when both are present):
    - Uses a **`Bookmark` icon** and **purple/violet shade** (`var(--accent-violet)` / `var(--accent-purple)`).
    - If `turn.user_note` is present: displays `<Bookmark size={12} /> {turn.user_note}` alongside a subtle **Edit note** action.
    - If `turn.user_note` is empty/null: displays a compact `+ Add bookmark note` button (with the purple `Bookmark` icon) so the card stays clean when no note is desired.
  - When `turn.is_bookmarked` is `false`, the bookmark note row is hidden (even if a retained `user_note` exists in storage).

#### 2.3 Inline Bookmark Note Editor & Magic Wand
- Clicking `+ Add bookmark note` or **Edit note** opens a compact inline purple-bordered editor directly inside the Turn Card footer area:
  - Text input / compact textarea (pre-populated with `turn.user_note ?? ""`, auto-focused on open).
  - **Magic Wand button** (following [`MagicWandButton.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/MagicWandButton.tsx) patterns with `generating` spinner, cancel, and `Undo` revert support) placed beside the input:
    - Calls `POST /api/campaigns/{campaign_id}/turns/{turn_id}/bookmark-summary`.
    - Populates the draft input with the returned 1-sentence summary without immediately overwriting saved DB state until the user confirms **Save** (or lets the user `Undo` back to their previous draft text).
  - Explicit **Save** (also `Enter` when single-line or `Ctrl/Cmd+Enter`), **Clear** (if editing an existing note), and **Cancel** (`Escape`) actions.

---

### FR-3: Dedicated Clerk Single-Turn Summarization Prompt

#### 3.1 Dedicated Prompt Template
- Add a new default prompt key in [`backend/app/prompts/defaults.py`](file:///home/diegolima/Git/cybercantina/backend/app/prompts/defaults.py) (e.g., `PROMPT_KEY_CLERK_TURN_BOOKMARK_SUMMARY = "clerk_turn_bookmark_summary_system"`), surfaced alongside existing Clerk prompts so presets can customize it if desired.
- **Prompt Behavior:** Unlike `notable_event_summary` (which instructs the model to emit `null` unless a macro plot shift occurs), this prompt **always** produces a single, objective, concise sentence (<= ~25 words) capturing what happened in the target turn (dialogue, decision, discovery, or emotional beat).
- Runs against the user's configured **Clerk** model profile (`eff_clerk`, low temperature e.g. `0.2`), never the main creative actor model.

#### 3.2 Parent-Turn Context Input
- When constructing the user payload for the Clerk summary call, supply:
  - **Previous Turn (`parent_turn_id`, read-only context):** Previous user prompt (or `[Opening Scene]` / `[Narrator]` when `depth_index === 0`) and a concise excerpt of its `raw_prose` (or `notable_event_summary` + tail of `raw_prose`) labeled clearly as *prior context only—do not summarize this turn*.
  - **Target Turn (to summarize):** Target `depth_index`, location name, speaker character name(s), `user_message` (handling `[...]` narrator cues and empty messages gracefully), and `raw_prose`.
- **Offline / Error Fallback:** When `settings.allow_offline_fallback` is enabled and the Clerk LLM call fails or is unavailable, generate a clean deterministic 1-sentence fallback from `notable_event_summary`, `cognition.plan`, or truncated `user_message` / `raw_prose`.

---

### FR-4: Timeline (`BranchGraphCanvas`) Bookmarks & Summary Grouping

#### 4.1 Swipe Visibility Invariant for Bookmarked Turns
- In [`branchGraphLayout.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/story/branchGraphLayout.ts#L411-L478), unfollowed childless sibling swipes are normally collapsed into `hiddenSwipes`.
- **Rule:** Any turn with `is_bookmarked === true` must **never** be collapsed into `hiddenSwipes` (treat `Boolean(child.is_bookmarked)` alongside `activeBranchSet.has(child.id) || hasKids` in `visibleChildrenByParent`). This guarantees bookmarked swipes always remain visible on the Branch Graph and can be directly focused.

#### 4.2 Node Description Priority
- Update `resolveNodeDescription` in [`branchGraphLayout.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/story/branchGraphLayout.ts#L205-L230) to resolve descriptions in strict priority order:
  1. `turn.user_note?.trim()` *(only when `turn.is_bookmarked` is `true`)* — marked with a bookmark/note indicator rather than `★`.
  2. `turn.post_turn?.notable_event_summary?.trim()` — marked with `★`.
  3. Existing fallback chain (`[Opening Scene]`, `Arrived: ...`, `user_message`, `[Scene Narration]`, `Turn #N`).
- Note: An un-bookmarked turn that still has a retained `user_note` in DB must **not** display `user_note` as its Timeline description (`is_bookmarked` gates display).
- In the bottom Node Detail Bar ([`BranchGraphCanvas.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/story/BranchGraphCanvas.tsx#L1605-L1632)), if a bookmarked node has **both** `user_note` and `notable_event_summary`, display both clearly (purple Bookmark note + amber `★` notable event).

#### 4.3 Visual Indicators on Individual Nodes & Summary Pseudo-Nodes
- **Individual Turn & Swipe Nodes:**
  - Bookmarked nodes render a crisp **purple/violet `Bookmark` icon** inside the card header (budgeted cleanly alongside `Turn #N`, `ACTIVE`/`TIP`/`SWIPE` pill, episodic dot, and timestamp) and optional subtle purple border/highlight accent when not selected/active.
- **Collapsed Episode Summary Pseudo-Nodes:**
  - Extend `EpisodeGroupMeta` in [`branchGraphLayout.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/story/branchGraphLayout.ts#L36-L62) with `bookmarkedTurnIds: string[]` (or `bookmarkCount: number`) counting any turn in `ep.turnIds` with `is_bookmarked === true` (and/or any bookmarked swipes anchored inside the episode if applicable).
  - When `bookmarkCount > 0`, render a compact **purple Bookmark badge** (`<Bookmark /> N`, e.g., `2`) in the top row of the Episode card between the `Turns X–Y` range label and the `SUMMARY`/`IN PROGRESS`/`ALT` badge, with tooltip `"Contains N bookmarked turn(s)"`, and surface the count in the Episode Detail Bar header.

---

### FR-5: Story Modal `Bookmarks` Tab (`StoryModal.tsx`)

#### 5.1 Tab Header & Empty State
- Add a third tab **`Bookmarks`** (icon: `<Bookmark size={14} color="var(--accent-violet)" />`, count badge = total bookmarked turns in `bundle.all_turn_nodes`) to [`StoryModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/story/StoryModal.tsx#L93-L122).
- Empty state when no turns are bookmarked: concise guidance explaining that players can click the bookmark icon on any turn card (after Turn #0) to save and annotate key moments.

#### 5.2 Ordering, Badges & Live Keyword Filtering
- **Ordering:** List all bookmarked turns from `bundle.all_turn_nodes` sorted ascending by **`depth_index` (Turn #)**, using **swipe / creation order** (e.g., `created_at` ascending, then `id`) as tie-breaker.
- **Per-Item Presentation:** Each bookmark row displays:
  - `Turn #N` + swipe label when sibling swipes exist (e.g., `v1`, `v2`),
  - Branch status pill: **`Active Timeline`** vs. **`Alternate Branch`** / **`Alternate Swipe`**,
  - Location name & world timestamp,
  - `user_note` (highlighted with purple bookmark styling, if present), `notable_event_summary` (if present), and a concise truncated snippet of `user_message` / `raw_prose`.
- **Live Keyword Filter:**
  - Search input at the top of the `Bookmarks` tab (with clear button) that live-filters the list on every keystroke by case-insensitive keyword matching against `user_note` (and optionally matching `notable_event_summary` / `user_message` when needed, or clearly scoped—if scoped strictly to note text, display a clear placeholder `"Filter bookmarks by note keywords..."` and empty-filter state `"No bookmarked notes match '...'"`).

#### 5.3 Click-to-Navigate Behavior
Clicking a bookmark item in the `Bookmarks` tab routes dynamically based on whether `turn.id` is in `bundle.active_branch_turns`:

1. **On the Currently Active Timeline:**
   - Calls `onZoomToTurn(turn.id)`: closes `StoryModal`, smoothly scrolls `ChatStage` to `[data-turn-id="<id>"]`, and briefly highlights the turn card (reusing existing [`ChatStage.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ChatStage.tsx#L154-L173) scroll targeting).
2. **Not on the Currently Active Timeline (Alternate Branch or Unfollowed Swipe):**
   - Switches `StoryModal` to the **`Timelines`** tab with `turn.id` focused in [`BranchGraphCanvas.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/story/BranchGraphCanvas.tsx):
     - Automatically expands any collapsed Episode containing `turn.id` (`episodeExpandOverrides[ep.id] = true`) so the target node is actually rendered in `model.nodeById`.
     - Selects `turn.id` (`selectedNodeId = turn.id`) so its Turn #0 -> Node lineage path highlights and the bottom Detail Bar offers **`Switch to this timeline`** (when it has a unique descendant tip) or **`Branch from here`**.
     - Centers the Branch Graph viewport on the focused node (rather than `activeLeafId`).

---

## 4. Acceptance Criteria & Verification Plan

### 4.1 Acceptance Criteria
- [x] Turn #0 (`depth_index === 0`) and map-move turns (`actor_id === "__arrival__"`) have no bookmark icon in the UI and return HTTP `400` if targeted via bookmark/summary APIs.
- [x] Eligible turn cards display an untoggled `Bookmark` icon in a dedicated top-left corner slot without overlapping Turn #0 portraits or user prompt bubbles.
- [x] Toggling bookmark status persists across page reloads; un-bookmarking hides the note row in chat/timeline while retaining `user_note` in SQLite so re-bookmarking restores it.
- [x] Bookmarked turns support adding/editing/clearing `user_note` (including turns that already have `notable_event_summary`), rendered in purple below `notable_event_summary` in the Turn Card footer.
- [x] `user_note` and `is_bookmarked` never appear in any LLM prompt payload (Phase 1–5 context assembly, episodic compaction, or vector embeddings).
- [x] Clicking the Magic Wand inside the note editor calls the Clerk model using the dedicated 1-sentence summary prompt with the parent turn as read-only context, populates the draft with Undo support, and works with offline fallback.
- [x] In the Timeline (`BranchGraphCanvas`), bookmarked swipes are never hidden inside `hiddenSwipes`, bookmarked nodes display the purple Bookmark icon, collapsed Episode cards containing bookmarks display a purple Bookmark count badge, and node descriptions prioritize `user_note` -> `notable_event_summary` -> fallback.
- [x] `StoryModal` exposes a `Bookmarks` tab ordered by `(Turn #, swipe/creation order)` with live note keyword filtering; clicking an active-timeline bookmark closes the modal and scrolls to the turn, while clicking an alternate-timeline bookmark switches to `Timelines`, auto-expands any enclosing episode, selects the node, and centers the viewport on it.

### 4.2 Required Verification Suite
- **Backend:**
  - `cd backend && .venv/bin/ruff check app tests && .venv/bin/tach check`
  - `backend/.venv/bin/pytest backend/tests` (covering migration, Turn #0 & `__arrival__` rejection, note retention on un-bookmark, Clerk wand endpoint with parent-turn context + offline fallback, and non-injection into Phase 2/5 context)
- **Frontend:**
  - `npm --prefix frontend run arch:check && npm --prefix frontend run build && npm --prefix frontend test` (covering `branchGraphLayout` priority/episode counts/swipe visibility, `TurnCard` slot & ordering, `StoryModal` Bookmarks tab filtering/sorting/routing, and `BranchGraphCanvas` focus + episode auto-expansion)
- **Architecture & Wiki Docs:**
  - `backend/.venv/bin/python scripts/generate_arch_docs.py && backend/.venv/bin/python scripts/generate_arch_docs.py --check`
  - Update user-facing documentation in `../cybercantina-wiki` (`Live-Inspector-Map-and-Timeline.md`, `Playing-Directing-and-Mechanics.md`, and `Prompt-Customization-and-Presets.md` if the new Clerk prompt is user-editable in presets).
