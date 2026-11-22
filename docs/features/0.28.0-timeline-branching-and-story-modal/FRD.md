---
feature: timeline-branching-and-story-modal
target_version: 0.28.0
document_type: frd
status: completed
last_updated: 2026-11-22
---

# Feature Requirements Document (FRD)
## Timeline Branching, Story Modal & Interactive Branch Graph

**Status:** Completed  
**Target Version:** CyberCantina v0.28.0  
**Scope:**
- Backend Branch-Safe Turn Deletion & Checkout Invariants ([`turns.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/turns.py), [`crud_and_state.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/campaign_routes/crud_and_state.py))
- Frontend Turn Card Branch Action, Rewind Banner & Scroll Targeting ([`TurnCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/TurnCard.tsx), [`StandaloneArrivalCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/StandaloneArrivalCard.tsx), [`ChatStage.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ChatStage.tsx), [`useCampaignTurnActions.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/hooks/useCampaignTurnActions.ts))
- Frontend Left Sidebar Navigation & Right Inspector Cleanup ([`AppSidebar.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/AppSidebar.tsx), [`LiveInspector.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/LiveInspector.tsx), [`App.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/App.tsx))
- Frontend Story Modal & SVG Pan/Zoom Branch Graph (`frontend/src/components/story/StoryModal.tsx`, `frontend/src/components/story/BranchGraphCanvas.tsx`, `frontend/src/components/story/branchGraphLayout.ts`)
- User-Facing Wiki Documentation ([`First-Campaign-and-Interface-Tour.md`](file:///home/diegolima/Git/cybercantina-wiki/First-Campaign-and-Interface-Tour.md), [`Live-Inspector-Map-and-Timeline.md`](file:///home/diegolima/Git/cybercantina-wiki/Live-Inspector-Map-and-Timeline.md), [`Playing-Directing-and-Mechanics.md`](file:///home/diegolima/Git/cybercantina-wiki/Playing-Directing-and-Mechanics.md))

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
CyberCantina's backend already models campaign history as a parent-linked turn tree (`turn_nodes.parent_turn_id` + `campaigns.active_leaf_turn_id`) with branch-scoped world snapshots, character states, spatial overrides, episodic summaries, and vector memories. However, the current user experience makes non-destructive branching difficult to discover, visually unreadable, and hazardous to use:

1. **No Direct "Branch" Workflow on Turn Cards:** Players can only `Swipe` a previous turn (regenerating *that* turn with the same prompt) or open the narrow right-pane **Timeline Branches** list to click an earlier node. There is no first-class **Branch** action on previous turn cards to rewind to a chosen moment and continue in a new direction.
2. **Unreadable Flat Timeline List in the Right Inspector:** In [LiveInspector.tsx](file:///home/diegolima/Git/cybercantina/frontend/src/components/LiveInspector.tsx#L563-L728), **Story** (episodic summaries) and **Timeline Branches** are squeezed into a ~300px right sidebar. Timeline nodes render as a flat depth-indented list (`marginLeft` capped at `32px`), interleaving sibling branches and cluttering the list with every unfollowed swipe regeneration.
3. **Destructive Multi-Branch Deletion Hazard:** [`delete_last_turn`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/turns.py#L846-L910) deletes *all* children of `leaf_turn.parent_turn_id` and all of their recursive descendants. If a player rewinds to an earlier turn (making it `isLastTurn`) or branches off an interior turn and then clicks **Delete** on the new branch leaf, the backend silently destroys sibling and descendant timelines.

### 1.2 Proposed Solution
Promote timeline branching into a first-class, non-destructive exploration workflow paired with a dedicated **Story** modal and an interactive **Branch Graph**:

1. **Turn Card "Branch" Button:** Add a **Branch** action on every previous turn card on the active timeline—including **Turn #0 (Opening Scene)** once the campaign reaches Turn #1—rewinding `active_leaf_turn_id` to that turn without deleting the existing continuation and focusing the composer to prompt a new branch.
2. **Branch-Safe Deletion Hardening:** Refactor `delete_last_turn` and turn-card `Delete` availability so deleting a leaf turn can never wipe sibling branches or descendant timelines.
3. **Left-Sidebar "Story" Entry & Cleaner Right Inspector:** Move **Story** and **Timeline Branches** out of [LiveInspector.tsx](file:///home/diegolima/Git/cybercantina/frontend/src/components/LiveInspector.tsx) and introduce a **Story** button in [AppSidebar.tsx](file:///home/diegolima/Git/cybercantina/frontend/src/components/AppSidebar.tsx) positioned between **Codex** and **Party** (in both expanded and collapsed icon-rail modes).
4. **Story Modal (`Summary` + `Timelines` / Branch Graph):**
   - **Summary:** Houses the existing branch-scoped Zone 2 episodic summaries.
   - **Timelines (Branch Graph):** Renders the campaign's turn tree as an interactive pan/zoom SVG directed acyclic graph, visually hiding unfollowed swipes by default (with optional on-node expansion), displaying per-turn summaries as node descriptions, highlighting lineage paths on selection, letting users **Zoom to moment** on the active timeline, and letting users **Switch timelines** on alternate branches.

---

## 2. Scope, Boundaries & Core Invariants

1. **Strictly Non-Destructive Branching:** Clicking **Branch** on any turn or switching timelines in the Branch Graph only updates `campaigns.active_leaf_turn_id` (`POST /api/campaigns/{campaign_id}/checkout`). Existing turns, swipes, episodic chunks, spatial overrides, and memories on other branches remain intact.
2. **Branch-Safe Deletion Invariant:** Deleting a turn must **never** delete sibling branches or descendant timelines:
   - Deleting an interior turn that already has children in `turn_nodes` is forbidden (disabled in UI, rejected with HTTP 400 in backend).
   - Deleting a leaf turn removes **only** that leaf turn (and optionally its unfollowed same-prompt swipes if no sibling branches are affected—never any sibling that has children or a distinct branch prompt).
3. **Visual-Only Swipe Filtering:** Hiding unfollowed swipes in the Branch Graph is a **presentation filter only**. All swipe rows stay persisted in SQLite and remain accessible via the turn card's `v1 / v2 / ...` switcher and optional on-node expansion in the graph.
4. **Zero Click-Overload on Graph Nodes:** Selecting a node in the Branch Graph must **never** silently close the modal or mutate the active timeline on a single exploratory click. Selection highlights the Turn #0 → Node path and updates an HTML overlay action bar with explicit actions (`Zoom to moment`, `Switch to timeline`, `Branch from here`, swipe expand/collapse).
5. **Active-Timeline Scoping for "Zoom to Moment":** Because [ChatStage.tsx](file:///home/diegolima/Git/cybercantina/frontend/src/components/ChatStage.tsx#L1514-L1555) only renders `bundle.active_branch_turns`, **Zoom to moment** is enabled **only** for nodes on the currently active timeline. For nodes on an alternate timeline, **Zoom to moment** is hidden or disabled while **Switch to timeline** is offered so the user can load that timeline first.
6. **Frontend Architecture & SVG Canvas Guardrails:**
   - Pure graph filtering, swipe grouping, lineage calculation, and tree coordinate layout must live in DOM-free TypeScript helpers (`branchGraphLayout.ts`) so Vitest (Node-only) can unit-test them directly.
   - Interactive controls, tooltips, and the selected-node detail/action bar must render as screen-space HTML overlays outside `<svg>` / `<g transform>` (never editable controls inside `<foreignObject>`).
   - Semantic colors follow project guardrails: `--accent-amber` / `--accent-cyan` / `--accent-violet` for active lineage, selection, and branching accents; `--accent-rose` reserved strictly for errors and destructive actions.
7. **Out of Scope for v0.28.0:**
   - Merging two divergent branches back into a single turn (the turn model remains a rooted tree, i.e., a single-parent DAG).
   - Custom user-authored branch names/colors persisted in SQLite (auto-derived labels/descriptions are used in v0.28.0).
   - Deleting an entire inactive branch directly from the Branch Graph modal.

---

## 3. Functional Requirements

### FR-1: Turn Card "Branch" Action & Rewind Flow

#### 1.1 Eligibility & Placement
- Render a **`Branch`** button (`<GitBranch size={12} /> Branch`) in the footer action bar of [TurnCard.tsx](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/TurnCard.tsx#L1105-L1186) for **every previous turn card** on the active branch:
  - **Included:** Turn #0 (`isRoot`, Opening Scene) **once the active branch has at least 2 turns** (`active_branch_turns.length > 1`, i.e., once the user is on Turn #1 or later), and every interior turn `Turn #1 .. Turn #(N-1)`.
  - **Excluded:**
    - The current active leaf turn (`isLastTurn`, including Turn #0 when no Turn #1 exists yet), since the user is already prompting from that turn.
    - Standalone map-arrival cards (`actor_id === "__arrival__"` rendered via [`StandaloneArrivalCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/StandaloneArrivalCard.tsx)), which do **not** render a card-level `Branch` button.
  - **Disabled state:** Disabled while `isBusy` (streaming or Phase 5 running) or `isDeletingTurn`.
- **Distinct from `Swipe`:**
  - `Swipe` (existing): rewinds *before* Turn #N (`parentTurnId = turn.parent_turn_id`) and regenerates Turn #N with the same prompt.
  - `Branch` (new): rewinds *to* Turn #N (`checkout_turn_branch(turn.id)`) so Turn #N remains the latest card and the player's next prompt becomes a new Turn #(N+1) branching off Turn #N.
  - Tooltip copy must make this unmistakable (e.g., `"Branch from here — rewind to Turn #N without deleting the current timeline"`).

#### 1.2 Rewind Behavior on Click
1. If the player is currently editing a turn (`editingTurn` in [ChatStage.tsx](file:///home/diegolima/Git/cybercantina/frontend/src/components/ChatStage.tsx#L1373)), cancel edit mode cleanly (`handleCancelEdit()`).
2. Clear any staged `pendingLocationOverrideId`.
3. Call `onCheckoutTurn(turn.id)` (`POST /api/campaigns/{campaign_id}/checkout`).
4. Focus the composer textarea (`textareaRef.current?.focus()`) so the player can immediately write the diverging prompt.
5. Future turns submitted from the composer naturally send `parent_turn_id = bundle.campaign.active_leaf_turn_id` (now `turn.id`), executing Phase 1–5 against that branch's isolated world/character/spatial/memory state.

#### 1.3 In-Stage Rewind Continuity Banner
- Because rewinding to an interior turn removes turns `#(N+1)..#K` from `active_branch_turns`, players need immediate reassurance that their prior timeline was preserved.
- Whenever the active leaf turn (`lastBranchTurn`) has **at least one existing child** in `bundle.all_turn_nodes`, render a compact, non-intrusive banner at the bottom of `.turn-feed` (above the composer):
  - Displays: *"Branched at Turn #N · Existing continuation preserved — prompt below to start a new branch"* (with count of existing child branches when >1).
  - Includes a quick button **`Open Branch Graph`** that opens the **Story** modal directly on the **Timelines** tab.

---

### FR-2: Branch-Safe Turn Deletion (`delete_last_turn` Hardening)

#### 2.1 Interior Node Guard
- **Backend ([`turns.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/turns.py#L846-L955)):** Before deleting `leaf_turn`, verify that `leaf_turn.id` has **no child turns** in `turn_nodes` (`SELECT 1 FROM turn_nodes WHERE campaign_id = ? AND parent_turn_id = ? LIMIT 1`). If children exist, raise `ValueError("Cannot delete a turn that has descendant branches")` (surfaced as HTTP 400).
- **Frontend ([`TurnCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/TurnCard.tsx#L1173-L1185)):** Compute `hasDescendants` for `turn.id` from `bundle.all_turn_nodes`. On `isLastTurn`, disable (or hide with explanatory tooltip) the **Delete** button whenever `hasDescendants` is `true` (e.g., immediately after branching back to Turn #2).

#### 2.2 Sibling-Branch Isolation on Leaf Deletion
- Update `delete_last_turn` so it **never** deletes unrelated sibling branches under `parent_id`:
  - **Target set (`deleted_ids`):** Delete `leaf_turn.id` only—**or**, if preserving the existing "delete all swipes of the last message" ergonomics, restrict extra deleted siblings strictly to **childless siblings under `parent_id` whose `user_message == leaf_turn.user_message`**.
  - Any sibling under `parent_id` that **has children** or has a **different `user_message`** (i.e., an alternate branch) must **never** be included in `deleted_ids`.
  - All cascade cleanups (`vector_entries`, `turn_nodes`, `location_edges`, `location_nodes`, `location_containers`, `campaign_characters`) operate strictly on `deleted_ids`.
  - `campaigns.active_leaf_turn_id` rolls back to `parent_id` as before (or to another surviving sibling if desired—rolling back to `parent_id` is deterministic and matches existing undo semantics).

---

### FR-3: Left Sidebar "Story" Navigation & Right Inspector Cleanup

#### 3.1 Left Sidebar ([`AppSidebar.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/AppSidebar.tsx))
- Add a **`Story`** button inside `Campaign Tools` positioned **between `Codex` and `Party`**:
  - **Expanded mode (`sidebar-campaign-nav`):** `<ScrollText size={15} color="var(--accent-amber)" />` + label `Story`, `aria-pressed={isStoryOpen}`, active styling when open, and a compact count/indicator badge (showing episodic summary count or branch count, plus a subtle dot if a new episodic summary was generated on the last turn).
  - **Icon rail mode (`mode === "rail"`):** Matching `rail-category-btn` placed between `Codex` and `Party` with `aria-label="Open Campaign Story & Timelines"`, `title="Story & Timelines"`, and `aria-pressed={isStoryOpen}`.
  - Clicking **Story** closes any mobile/tablet sidebar overlay (`onCloseOverlay?.()`) and opens `StoryModal` (defaulting to the last opened category or `Summary`, or `Timelines` when triggered via the in-stage `Open Branch Graph` shortcut).

#### 3.2 Right Inspector Cleanup ([`LiveInspector.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/LiveInspector.tsx))
- Remove the **Story** (`storageKey="story"`, lines 563–588) and **Timeline Branches** (`storageKey="timeline"`, lines 590–728) `InspectorSection` blocks from `LiveInspector.tsx`.
- Remove dead inspector-only state (`turnFilter`, `filteredTurnNodes`, `activeBranchSet`, `storyChanged`) and unused `onCheckoutTurn` / `memoryConfig` props from `LiveInspector.tsx` (passing them to `StoryModal` via `App.tsx` instead).
- Preserve all remaining right-pane live scene sections: **World Clock**, **Location / Mini-Map**, **Characters**, and **Internals**.

---

### FR-4: Story Modal (`Summary` & `Timelines`)

Clicking **Story** opens `StoryModal.tsx` (following CyberCantina's stabilized tabbed modal chrome, `Escape` / backdrop click to close, responsive viewport sizing `min(1100px, 95vw)` × `min(820px, 90vh)` so the SVG Branch Graph has ample room):

- **Header & Category Tabs:**
  - Modal title: **`Story`** (with campaign name subtitle).
  - Two primary tabs:
    1. **`Summary`** (icon: `ScrollText`, badge: `bundle.episodic_chunks.length`).
    2. **`Timelines`** (icon: `GitBranch`, badge: visible branch/timeline count).
- **Tab 1 — `Summary`:**
  - Displays the exact current right-pane "Story" contents:
    - A brief scope note clarifying that summaries reflect the **currently active timeline branch**.
    - Ordered list of `bundle.episodic_chunks` showing `Turns {start_turn_depth}–{end_turn_depth}` and `summary_text`.
    - When `bundle.episodic_chunks.length === 0`, displays the existing empty-state explanation referencing `memoryConfig.working_memory_turns` and `memoryConfig.episodic_chunk_size`.
- **Tab 2 — `Timelines` (View Title: `Branch Graph`):**
  - Displays the header **`Branch Graph`** with summary stats (e.g., active turn depth, total timelines/branch tips, and hidden unfollowed swipe count) and the interactive SVG pan/zoom tree described in FR-5 and FR-6.

---

### FR-5: Branch Graph Data Model, Swipe Hiding & Node Descriptions

#### 5.1 Tree Construction & Active Lineage
- Construct the directed rooted tree from `bundle.all_turn_nodes` using `parent_turn_id` links rooted at Turn #0 (`parent_turn_id == null` / `depth_index === 0`).
- Identify:
  - **`activeBranchSet`:** IDs in `bundle.active_branch_turns`.
  - **`activeLeafId`:** `bundle.campaign.active_leaf_turn_id`.
  - **Branch Tips (Leaf Nodes):** Visible nodes with `0` visible children.
  - **Fork Points:** Visible nodes with `>= 2` visible children.

#### 5.2 Visual Hiding of Unfollowed Swipes (Non-Destructive, Zero-Migration Heuristic)
- **Zero-Migration Detection Rule:** Without adding new columns to `turn_nodes`, given a parent node `P` with children `C_1, ..., C_k`:
  - A child `C_i` is **always visible** if:
    1. `C_i.id ∈ activeBranchSet` (on the currently checked-out timeline, including `activeLeafId`), **OR**
    2. `C_i` has at least one child in `all_turn_nodes` (it was followed up on), **OR**
    3. `C_i` has a **different `user_message`** from every other visible sibling under `P` (protecting intentional 1-turn alternate branches created via **Branch** from vanishing when the player switches back to another timeline).
  - Any remaining child `C_j` under `P` (not on the active branch, `0` children, and sharing the same `user_message` as a visible sibling `C_anchor` under `P`) is classified as an **unfollowed swipe** and **visually hidden** from the default graph. This works retroactively on all existing campaigns without a database migration.
- **Worked Example (from spec):**
  - Player generates 4 swipes on Turn #2 (`#2a`, `#2b`, `#2c`, `#2d` — all sharing `parent = #1` and the same `user_message`) and continues `#2d → #3 → #4`.
  - `#2d` has children (`#3`), so `#2d` is visible. `#2a`, `#2b`, `#2c` have `0` children, are not on `activeBranchSet`, and match `#2d`'s prompt → **hidden by default** (no cluttered dead-end edges).
  - If the player later zooms to Turn #2 on the card, switches to `#2a` (`v1`), and branches from `#2a`, `#2a` is now in `activeBranchSet` (and gains children once prompted) → **`#2a` immediately appears on the Branch Graph**!
- **Optional On-Demand Swipe Expansion:**
  - Each visible node `C_anchor` that has `m > 0` hidden unfollowed sibling swipes displays a compact pill badge (e.g., `+3 swipes`) with its own hit target (`stopPropagation()`).
  - Clicking the `+3 swipes` pill (or clicking **`Show 3 unfollowed swipes`** in the Node Detail Bar) toggles inline expansion for that turn group: `#2a`, `#2b`, `#2c` expand as sibling nodes alongside `#2d` (styled softly as unfollowed swipes), while the continuation edge `#2d → #3` remains anchored exclusively to `#2d`.
  - Clicking the pill/toggle again collapses `#2a–#2c` back into `+3 swipes`.

#### 5.3 Node Descriptions, Metadata & Map-Arrival Waypoints
- **Standard / Narrator / Solo Turn Nodes:** Each node card in the SVG tree displays:
  - **Header:** `Turn #{depth_index}` + concise status badge (`Active` on `activeLeafId`, `Tip` on alternate branch tips, `+N swipes` if hidden swipes exist, and optional summary-chunk indicator if an `episodic_chunk` anchors at `turn.id`).
  - **Primary Description:**
    1. If `turn.post_turn?.notable_event_summary` is non-empty, display **that summary** as the turn's description (e.g., `★ <notable_event_summary>`).
    2. Otherwise, fall back to a concise truncated snippet of `turn.user_message` (or `[Opening Scene]` for Turn #0).
  - **Secondary Meta:** World timestamp (time portion) and/or speaker/location cue in the detail bar.
- **Map-Arrival Waypoint Nodes (`actor_id === "__arrival__"`):** Rendered as **compact waypoint pills** (e.g., compass/map-pin icon + destination location name) in the Branch Graph so parent–child lineage stays visually intact without giving map moves the visual weight of full narrative turn cards.

---

### FR-6: Branch Graph SVG Pan/Zoom Tree & Interactions

#### 6.1 SVG Pan/Zoom Canvas & Layout
- Render the Branch Graph inside a dedicated pan/zoom SVG viewport (`BranchGraphCanvas.tsx`), aligned with CyberCantina's map canvas ergonomics ([SpatialTopologyCanvas.tsx](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/SpatialTopologyCanvas.tsx)):
  - **Deterministic Automatic Tree Layout (`branchGraphLayout.ts`):**
    - Left-to-right (or top-to-bottom) directed tree ordered by `depth_index`, with non-overlapping branch lanes computed deterministically (no manual node dragging needed).
    - Smooth directed cubic Bézier edges from parent → child.
    - Visual styling distinguishes:
      - **Active timeline spine** (`activeBranchSet`): high-contrast highlighted stroke/node border.
      - **Selected lineage path** (Turn #0 → `selectedNodeId`): bright accent path highlight (`--accent-cyan` or `--accent-amber`).
      - **Alternate timelines:** readable muted-neutral nodes/edges with distinct **branch tip** styling.
      - **Expanded unfollowed swipes:** dashed incoming edge and softer opacity so they read unmistakably as dead-end alternatives.
  - **Pan & Zoom Controls:**
    - Pointer drag on background to pan; mouse wheel (centered on cursor) and toolbar `+` / `−` buttons to zoom (clamped sensible min/max scale).
    - Toolbar controls: **`Fit Graph`**, **`Center on Active`**, and an optional global **`Show all swipes (N)`** toggle (hidden when `N === 0`).
    - On opening the `Timelines` tab, automatically center/fit the viewport with `activeLeafId` comfortably in view.

#### 6.2 Node Selection, Path Highlighting & Action Bar
- **Clicking any node** selects it (`selectedNodeId = node.id`) without closing the modal:
  - **Path Highlighting:** Immediately highlights every node and edge along the unique ancestor path from **Turn #0 → `selectedNodeId`** in the SVG graph.
  - **Screen-Space Node Detail & Action Bar:** Renders as an HTML overlay panel (outside `<svg>`) docked at the bottom (or right side) of the Branch Graph view, showing:
    - `Turn #{depth_index}`, world timestamp, active/alternate timeline badge, speaker/location, full `notable_event_summary` (when present), user prompt, and short prose preview.
    - **Context-Aware Actions:**
      1. **`Zoom to moment`** *(Scroll to message in chat)*:
         - **Shown & enabled ONLY when `selectedNode` is on the currently active timeline (`activeBranchSet.has(selectedNode.id)`).**
         - Clicking closes `StoryModal`, locates `[data-turn-id="<selectedNode.id>"]` inside `.turn-feed` ([ChatStage.tsx](file:///home/diegolima/Git/cybercantina/frontend/src/components/ChatStage.tsx)), smoothly scrolls it into view (`scrollIntoView({ behavior: "smooth", block: "center" })`), and applies a brief (~1.5s) visual pulse highlight on that turn card.
         - **When `selectedNode` is on an alternate timeline:** **`Zoom to moment` is hidden (or disabled)** so the user is never offered an impossible scroll target; instead, the primary action lets them switch to that timeline first.
      2. **`Switch to this timeline`** *(Load alternate timeline)*:
         - **Shown ONLY when `selectedNode` is NOT on the currently active timeline AND either:**
           - `selectedNode` is a **branch tip (leaf node)** (`0` visible children), **OR**
           - `selectedNode` is an **interior alternate-branch node with a single unique descendant branch tip** (resolved deterministically to that unique tip; omitted on interior alternate nodes that split into 2+ downstream tips so there is no ambiguous branch choice).
         - Clicking calls `onCheckoutTurn(targetTipId)` (`POST /api/campaigns/{campaign_id}/checkout`), **closes `StoryModal` immediately**, and **smoothly scrolls `.turn-feed` to the latest turn (tip)** of the newly loaded timeline so the player can read and continue prompting from there.
         - Disabled while `isMutatingLocked` (streaming / Phase 5 running).
      3. **`Branch from here`** *(Rewind & fork)*:
         - **Always offered on any non-leaf turn** (whether on the active timeline or an alternate timeline, including interior alternate nodes that split into multiple downstream tips) when `!isMutatingLocked`. Clicking calls `onCheckoutTurn(selectedNode.id)`, closes the modal, and focuses the composer so the user can prompt a new branch starting after `selectedNode`.
      4. **`Show / Hide N unfollowed swipes`**:
         - Shown when `selectedNode` has hidden unfollowed sibling swipes (mirroring the inline `+N swipes` badge on the SVG node).

#### 6.3 Quick Tip-Switch Ergonomics
- Clicking an alternate **branch tip (leaf)** node selects it, highlights the full Turn #0 → Tip path, and elevates **`Switch to this timeline`** as the primary CTA button in the Node Detail Bar (with double-click on an alternate branch tip optionally triggering the switch directly when `!isMutatingLocked`).

---

## 4. Acceptance Criteria

1. **Branch Button Coverage:** Every previous standard/narrator/solo turn card on the active timeline—including **Turn #0** once Turn #1 exists—displays a **Branch** button; the current active leaf (`isLastTurn`) and `__arrival__` map-move cards do not display **Branch**.
2. **Non-Destructive Rewind & Continuation:** Clicking **Branch** on Turn #k rewinds the chat feed and campaign state to Turn #k without deleting Turns `#(k+1)..#N`, displays the in-stage rewind continuity banner, focuses the composer, and attaches the next submitted turn as a new child of Turn #k (`Turn #(k+1)` on the new branch).
3. **Branch-Safe Deletion:**
   - Attempting to delete an interior turn that has descendant branches is blocked in both the UI (`Delete` disabled) and backend (`400 Bad Request`).
   - Deleting a leaf turn on Branch B never deletes sibling Branch A (or its descendants) sharing the same `parent_turn_id`.
4. **Navigation & Inspector Cleanup:**
   - **Story** appears between **Codex** and **Party** in [AppSidebar.tsx](file:///home/diegolima/Git/cybercantina/frontend/src/components/AppSidebar.tsx) in both expanded and `rail` modes.
   - **Story** and **Timeline Branches** are removed from [LiveInspector.tsx](file:///home/diegolima/Git/cybercantina/frontend/src/components/LiveInspector.tsx).
   - Clicking **Story** opens `StoryModal` with **Summary** (active-branch episodic chunks) and **Timelines** (**Branch Graph**).
5. **Unfollowed Swipe Hiding, Waypoints & Expansion:**
   - Generating 4 swipes (`#2a–#2d`) and continuing from `#2d` displays `#2d` on the Branch Graph while hiding `#2a–#2c` by default via the zero-migration same-`user_message` heuristic and showing a `+3 swipes` indicator.
   - Clicking the `+3 swipes` control expands `#2a–#2c` visually alongside `#2d` with the continuation edge still stemming from `#2d`.
   - Switching to `#2a` on the turn card and branching makes `#2a` appear on the Branch Graph immediately.
   - Creating a single-turn alternate branch with a *different* prompt does not vanish from the Branch Graph when switching back to the main timeline.
   - Map-arrival (`__arrival__`) turns render as compact waypoint nodes in the Branch Graph preserving parent–child continuity.
6. **Graph Selection, Summaries, Zoom & Timeline Switching:**
   - Turns with `post_turn.notable_event_summary` display that summary as their node description; turns without one fall back cleanly to their prompt/opening label.
   - Clicking any node highlights the directed path from Turn #0 to that node and updates the HTML Node Detail Bar.
   - **Zoom to moment** is available only for nodes on the currently active timeline (hidden/disabled on alternate timelines) and smoothly scrolls to `[data-turn-id]` in `ChatStage` after closing the modal.
   - **Switch to this timeline** appears on alternate branch tips (and interior alternate nodes with a single unique descendant tip); clicking it checks out that timeline's tip, closes `StoryModal`, and smoothly scrolls to the latest turn. **Branch from here** remains available on every interior node.
   - Pan, wheel/button zoom, **Fit Graph**, and **Center on Active** all work cleanly in the SVG Branch Graph.
7. **Verification Gates:** Backend (`ruff check`, `tach check`, `pytest`), Frontend (`arch:check`, `build`, `vitest`), Architecture Docs (`generate_arch_docs.py --check`), and Wiki updates (`../cybercantina-wiki`) all pass cleanly.

---

## 5. Resolved Design Decisions

1. **`__arrival__` Map-Move Cards (`StandaloneArrivalCard`):** Rendered as compact waypoint nodes in the Branch Graph to preserve parent–child lineage visually, without a card-level **Branch** button on `StandaloneArrivalCard`.
2. **Post-Switch Behavior on `Switch to this timeline`:** Immediately closes `StoryModal` after `checkout` and smoothly scrolls `.turn-feed` to the latest turn (tip) of the newly loaded timeline.
3. **Unfollowed Swipe Detection:** Uses the zero-migration deterministic same-`user_message` heuristic (`same parent_turn_id` + `0 children` + `not in active_branch_turns` + `matching user_message` with a visible sibling) so existing campaigns require no schema migration.
4. **Interior Alternate-Branch Nodes:** Shows **`Switch to this timeline`** only on alternate branch tips and interior alternate nodes with a single unique descendant tip, while always offering **`Branch from here`** on any interior node.
