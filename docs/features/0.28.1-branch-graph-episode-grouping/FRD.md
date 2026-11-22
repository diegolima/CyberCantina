---
feature: branch-graph-episode-grouping
target_version: 0.28.1
document_type: frd
status: completed
last_updated: 2026-11-22
---

# Feature Requirements Document (FRD)
## Branch Graph Summarized Episode Grouping & Alternate Summary Switcher

**Status:** Completed  
**Target Version:** CyberCantina v0.28.1  
**Depends On:** [v0.28.0 Timeline Branching, Story Modal & Interactive Branch Graph](file:///home/diegolima/Git/cybercantina/docs/features/0.28.0-timeline-branching-and-story-modal/FRD.md)  
**Scope:**
- Backend Cross-Timeline Chunk Exposure ([`turns.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/turns.py), [`turn.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/turn.py))
- Frontend Type Sync ([`turn.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/turn.ts))
- Frontend Branch Graph Episode Grouping, Topology & Interaction ([`branchGraphLayout.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/story/branchGraphLayout.ts), [`BranchGraphCanvas.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/story/BranchGraphCanvas.tsx), [`StoryModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/story/StoryModal.tsx), [`styles.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css))
- User-Facing Wiki Documentation ([`Live-Inspector-Map-and-Timeline.md`](file:///home/diegolima/Git/cybercantina-wiki/Live-Inspector-Map-and-Timeline.md))

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
CyberCantina v0.28.0 introduced the pan/zoom SVG **Branch Graph** inside `StoryModal` (`Timelines` tab). While unfollowed swipes are collapsed via zero-migration prompt matching, every retained narrative turn and map-arrival waypoint still renders as a full-width horizontal node (`TURN_CARD_W = 228`, `COL_GAP = 56`). In long campaigns (30–100+ turns across multiple branches), this creates two usability problems:

1. **Horizontal Tree Sprawl:** The graph stretches thousands of pixels horizontally, causing initial `computeFitGraphViewport` zoom to drop below the `0.72` readability threshold and hiding distant branches off-screen.
2. **Disconnect Between `Summary` and `Timelines`:** Past turns that have already been condensed into Zone 2 `episodic_chunks` still occupy individual cards in the Branch Graph, forcing players to scan turn-by-turn across early campaign history instead of reading the story at an episode level with on-demand drill-down.

### 1.2 Proposed Solution
Collapse turns belonging to summarized episodes into **Summary Pseudo-Nodes** inside the **Timelines** (`Branch Graph`) view while preserving full tree topology, branch origins, and on-demand inspection:

1. **Episode Grouping in Branch Graph:** Contiguous turn chains covered by any timeline's `episodic_chunks` render as compact **Summary Pseudo-Nodes** by default, while unsummarized working-memory turns and standalone un-summarized branches remain individually visible.
2. **Spoiler-Safe Active-First Display + Alternate Summary Switcher:** A summary pseudo-node displays the **active timeline's** matching summary by default, or `"Episode in Progress"` when the active timeline hasn't summarized that span yet—paired with an explicit **chevron / slide control** (`View alternate timeline summary`) whenever alternate timeline summaries exist for that span.
3. **Branch-Origin Preservation:** Any timeline(s) that branched out from turns *inside* a collapsed pseudo-node remain visible originating from the pseudo-node (annotated with their exact origin turn) and re-anchor to their exact branching turn node when the episode is expanded.
4. **Dedicated Expand/Collapse Pills & Active-Tip Auto-Expansion:** Single-clicking a pseudo-node selects it for reading in the Node Detail Bar; explicit pills expand/collapse the episode (with viewport anchoring), and any episode containing the active timeline's tip opens pre-expanded.

---

## 2. Scope, Boundaries & Core Invariants

1. **Zero Database Migration:** All episode grouping, branch precedence, and summary-switching rules derive purely from existing `turn_nodes` (`id`, `parent_turn_id`, `depth_index`, `actor_id`) and `episodic_chunks` (`start_turn_depth`, `end_turn_depth`, `leaf_turn_id`, `title`, `synopsis_text`, `summary_text`) rows.
2. **Active-Branch Scoping Preserved Outside the Graph:**
   - `CampaignStateBundle.episodic_chunks` **must remain scoped to the active branch** (`get_branch_episodic_chunks`) so `Story -> Summary`, Zone 2 LOD prompt assembly, and vector recall semantics are completely unchanged.
   - Cross-timeline chunk discovery for the Branch Graph uses a dedicated additive field (`all_episodic_chunks` on `CampaignStateBundle`, defaulting to `[]` if omitted).
3. **Grouped Scope Invariant:** Only turns belonging to a summarized episode (plus interior `__arrival__` waypoints along that chunk's ancestor chain) may be grouped into a summary pseudo-node. Unsummarized turns, Turn #0 (`[Opening Scene]`), and un-summarized divergent turns must never be grouped.
4. **Exact Turn-ID Chain Membership (Never Depth-Only):** Chunk membership must be resolved by walking `parent_turn_id` pointers backward from `chunk.leaf_turn_id` and selecting turns in `[start_turn_depth, end_turn_depth]`. Never match turns by `depth_index` range alone, which would falsely swallow short divergent branches at the same depths.
5. **Single-Owner Disjoint Partition:** A `TurnNodeRecord` may belong to at most **one** summary pseudo-node in the rendered graph. Active-branch chunks claim shared trunk turns first; overlapping alternate-branch chunks group only their unclaimed post-divergence turns.
6. **Invariant Timeline Count:** Collapsing or expanding summary pseudo-nodes is a presentation transform only and must **never** alter `branchTipCount` (`countVisibleTimelines`), checkout behavior, or `StoryModal` tab counts.
7. **No Click-Overload & SVG Overlay Guardrails:**
   - Single-clicking a pseudo-node selects it without immediately expanding it.
   - Interactive expand/collapse and chevron switcher controls inside `<svg>` use dedicated `<g data-graph-interactive="true">` hit targets with `stopPropagation()` (never `<foreignObject>` inputs); full text and controls mirror in the screen-space HTML Node Detail Bar.
   - All grouping, precedence, and layout logic lives in pure DOM-free TypeScript (`branchGraphLayout.ts`) so Node-only Vitest can test it directly.
8. **Out of Scope for v0.28.1:**
   - Editing or deleting `episodic_chunks` from the Branch Graph UI.
   - Manual user-defined arbitrary turn groups unrelated to `episodic_chunks`.

---

## 3. Functional Requirements

### FR-1: Backend Cross-Timeline Chunk Exposure & Frontend Type Sync

#### 1.1 `CampaignStateBundle.all_episodic_chunks` ([`turns.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/turns.py), [`turn.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/turn.py))
- Add `list_campaign_episodic_chunks(campaign_id: str) -> list[EpisodicChunkRecord]` on `CantinaRepository` returning all `episodic_chunks` rows for the campaign ordered by `start_turn_depth ASC, created_at ASC` (reusing the existing row-hydration logic from `get_branch_episodic_chunks`).
- Add `all_episodic_chunks: list[EpisodicChunkRecord] = Field(default_factory=list)` to `CampaignStateBundle` in `backend/app/schemas/turn.py`, populated in `get_campaign_state_bundle`.
- Keep `CampaignStateBundle.episodic_chunks` unchanged (strictly filtered to `leaf_turn_id in valid_turn_ids` for the active branch).

#### 1.2 Frontend `EpisodicChunkRecord` & `CampaignStateBundle` ([`turn.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/turn.ts))
- Sync `EpisodicChunkRecord` in `frontend/src/types/turn.ts` with backend `EpisodicChunkRecord`:
  - Add optional/defaulted `title?: string`, `synopsis_text?: string`, `keywords?: string[]`, `witness_character_ids?: string[]`, and `salience_score?: number` (matching fields already serialized by the API).
- Add `all_episodic_chunks?: EpisodicChunkRecord[]` to `CampaignStateBundle` in `frontend/src/types/turn.ts` (with `BranchGraphCanvas` gracefully falling back to `bundle.all_episodic_chunks ?? bundle.episodic_chunks`).

---

### FR-2: Deterministic Episode Grouping, Waypoint Absorption & Multi-Branch Precedence

#### 2.1 Resolving a Chunk's Exact Turn Chain
Given `chunk: EpisodicChunkRecord`:
1. Start at `curr = turnById.get(chunk.leaf_turn_id)`. If missing, ignore the chunk.
2. Walk backward via `parent_turn_id` until `curr` is `null` or `curr.depth_index < chunk.start_turn_depth`.
3. Collect every turn encountered whose `depth_index` satisfies `chunk.start_turn_depth <= curr.depth_index <= chunk.end_turn_depth` (ordered root-to-leaf by `depth_index ASC`).
4. **Interior `__arrival__` Waypoint Absorption:** Because Phase 4/5 (`backend/app/engine/clerk/pipeline.py`) excludes `actor_id === "__arrival__"` turns from `unsummarized` while `parent_turn_id` chains pass directly through them, any `__arrival__` turn encountered on the chain between `start_turn_depth` and `end_turn_depth` **is included** in that chunk's grouped turn set so the episode stays a single contiguous segment.
5. Turn #0 (`depth_index === 0`) is never inside `[start_turn_depth, end_turn_depth]` (since `max_summarized_depth` starts at `0`) and always remains a visible root node.

#### 2.2 Multi-Timeline Precedence & Disjoint Turn Ownership
When `all_episodic_chunks` contains chunks from multiple timelines:
1. **Priority Order:** Sort chunks so **active-branch chunks** (`activeChunkIds`, i.e. `chunk.leaf_turn_id ∈ activeBranchSet`) come first (by `start_turn_depth ASC`), followed by **alternate-branch chunks** (by `start_turn_depth ASC, created_at ASC`).
2. **Claiming Disjoint Spans:** Maintain a `claimedTurnIds: Set<string>`:
   - For each chunk in priority order, filter its resolved turn chain to `unclaimedTurns` (`!claimedTurnIds.has(t.id)`).
   - If `unclaimedTurns.length === 0`, this chunk produces no new pseudo-node (though it may still register as an alternate summary view on the pseudo-node that already claimed its starting turns; see FR-3.2).
   - If `unclaimedTurns.length > 0` and forms a contiguous parent-linked chain (split into contiguous runs if needed, skipping single-turn trivialities only if fewer than 1 turn): claim those turn IDs into `claimedTurnIds` and create an `EpisodeGroupDescriptor` spanning `[firstTurn.depth_index .. lastTurn.depth_index]`.
   - **Worked Example (Two Summarized Branches):** Timeline A and Timeline B branch at Turn #3; both reach Turn #17 and generate `Turns 1–8` chunks (`Chunk_A` on active, `Chunk_B` on alternate).
     - `Chunk_A` (active) claims `T1, T2, T3, T4_A..T8_A` → **Pseudo-Node `Ep 1 (Turns 1–8)`**.
     - `Chunk_B` (alternate) finds `T1..T3` already claimed and claims `T4_B..T8_B` → **Pseudo-Node `Ep 1 Branch (Turns 4–8)`** originating from `Ep 1` (with `Chunk_B` also discoverable via the alternate-summary switcher if `Chunk_B` shares `T1..T3`).
3. **Worked Example (Short Alternate Branch):** `Chunk_A` (`Turns 1–8`, `T1..T3 -> T4_A..T8_A`) exists on Timeline A. User checks out Timeline B at `T5_B` (`T1..T3 -> T4_B -> T5_B`).
   - `Chunk_A` claims `T1..T3` and `T4_A..T8_A`.
   - `T4_B` and `T5_B` are **not** in `Chunk_A`'s ancestor chain → they remain ungrouped visible turn nodes branching off the `Ep 1` pseudo-node, while `Ep 1` defaults to `"Episode in Progress"` (FR-3.1).

---

### FR-3: Summary Pseudo-Node Rendering, `"Episode in Progress"` Default & Alternate Summary Switcher

#### 3.1 Pseudo-Node Visual Anatomy & Default Description
Each collapsed `EpisodeGroupDescriptor` renders in the SVG graph as a distinct **Summary Pseudo-Node** (visually differentiated from standard turn cards, e.g. layered/stacked card border or subtle folder/scroll motif, `--accent-amber` / `--accent-violet` cues depending on active-branch status):
- **Header:**
  - Range label: `Turns {startDepth}–{endDepth}` (e.g., `Turns 1–8`), plus `N turns` count (excluding or noting waypoints).
  - Status badge when applicable: `ACTIVE` (only if collapsed manually while containing `activeLeafId`), `ALT` / `TIP` if an alternate tip sits inside and was manually collapsed, or `IN PROGRESS` badge when unmatched on the active timeline.
- **Default Description Logic:**
  1. **Active Timeline Match:** If the group's primary chunk is in `activeBranchChunks` (or belongs to the currently active timeline):
     - Display `chunk.title` (if non-empty) and `chunk.synopsis_text` (falling back to truncated `chunk.summary_text`).
  2. **No Active-Timeline Match:** If the active timeline has **not** created a matching summary for this episode span (e.g., active timeline branched before `leaf_turn_id` or hasn't reached summarization yet):
     - Default card text reads **`"Episode in Progress"`** with a muted subtitle noting the cross-timeline scope (e.g., `Turns 1–8 · Summarized on another timeline`), preventing accidental spoilers from another branch's summary.

#### 3.2 Explicit Alternate-Summary Switcher (`View alternate timeline summary`)
Whenever at least one alternate timeline summary applies to a pseudo-node's span (including when the default view is `"Episode in Progress"`, or when multiple timelines have summarized chunks overlapping the pseudo-node's turn span):
- **Inline SVG Chevron Control (`<g data-graph-interactive="true">`):**
  - Render a compact interactive bar/pill on the pseudo-node (e.g., `‹` `Alt summary` / `1/2` `›` or a `View alternate timeline summary` toggle + prev/next chevrons) with `e.stopPropagation()` so clicking chevrons **never** triggers node selection jump or episode expansion.
  - Clicking next (`›`) / previous (`‹`) slides/cycles the pseudo-node's displayed summary index (`0 = Active / "Episode in Progress"`, `1..K = each alternate timeline's matching chunk summary`), updating the card's title/synopsis in place and indicating the source timeline/depth (e.g., `Timeline via Turn #17`).
- **Mirrored Detail Bar Switcher:**
  - Selecting the pseudo-node displays the exact same **prev/next chevron switcher** (`View alternate timeline summary` / `‹ Active | Alt 1 of N ›`) in the screen-space HTML **Node Detail Bar**, showing the full `summary_text`, `title`, keywords, and which branch tip/turn created that summary.

---

### FR-4: Collapsed Branching Topology, Edge Origin Labeling & Hidden Swipes

#### 4.1 Collapsed vs. Expanded Edge Re-Parenting
- **Entry Edge:** When an episode pseudo-node `E` is collapsed, its `parentId` is the parent of the episode's first turn (typically Turn #0 or the preceding episode/turn).
- **Exit Edges (Single & Multiple Branches Inside Episode):**
  - Every visible child node `C` outside `E` whose `turn.parent_turn_id` is **any** turn inside `E` (whether at the end `end_turn_depth` or at an interior branching turn inside `E`) re-parents visually to `E.id` while `E` is collapsed:
    - Example 1 (1 interior branch): Timeline B branched at Turn #3 inside `Ep 1 (Turns 1–8)`. When `Ep 1` is collapsed, both `Turn #9` (continuation from Turn #8) and `Turn #4_B` (branch from Turn #3) originate from `Ep 1`'s right edge.
    - Example 2 (multiple interior branches): Timeline B branched at Turn #2, Timeline C branched at Turn #6, and main continued from Turn #8. When `Ep 1` is collapsed, **all three** (`Turn #3_B`, `Turn #7_C`, `Turn #9`) originate from `Ep 1`.
  - **Origin Labels on Collapsed Outgoing Edges:** When an outgoing edge from a collapsed pseudo-node `E` originates from an interior turn inside `E` (or whenever `E` has `>= 2` outgoing edges), render a concise pill/label or tooltip on the edge (`from Turn #2`, `from Turn #6`, `from Turn #8`) so the user can tell which branches diverged at different turns without expanding first.
- **Expanded Re-Anchoring:** When `E` is expanded, `E` is replaced by its actual grouped turn/waypoint nodes in the layout, and every outgoing edge immediately re-anchors to its exact `turn.parent_turn_id` node inside `E`.

#### 4.2 Hidden Unfollowed Swipes Inside Episodes
- Apply the existing zero-migration same-`user_message` swipe hiding rule (`branchGraphLayout.ts`) **before** or **orthogonally to** episode grouping:
  - Unfollowed swipes anchored to turns *inside* a collapsed episode remain tucked inside the episode (not rendered as separate outgoing branches from the pseudo-node).
  - The pseudo-node badge/detail bar surfaces the aggregate hidden swipe count inside that episode (e.g., `+2 swipes inside`), and clicking the toolbar **`Show swipes (N)`** toggle either auto-expands episodes containing hidden swipes or expands those swipes cleanly once the episode is expanded (preference: auto-expand episodes that contain hidden swipes when `Show swipes` is turned ON so `Show swipes (N)` always reveals all `N` swipes).

#### 4.3 Ancestor Path Highlighting & Timeline Counts
- `computeAncestorPath` walks seamlessly through collapsed pseudo-nodes (since `E.parentId` and outgoing edges `E.id -> child.id` form a valid rooted tree).
- `countVisibleTimelines` / `model.branchTipCount` counts visible non-swipe branch tips on the underlying tree **invariantly** (never inflated or deflated by collapsing episodes).

---

### FR-5: Expand / Collapse Interaction, Auto-Expansion & Viewport Anchoring

#### 5.1 Expand & Collapse Controls
- **Expand Pill (Collapsed State):** Every collapsed summary pseudo-node renders a dedicated interactive **`+N turns` / `Expand` pill** (`data-graph-interactive="true"`, padded hit target, `stopPropagation()`), plus a matching **`Expand N turns`** button in the Node Detail Bar when selected.
- **Collapse Pill (Expanded State):** Every expanded episode renders a subtle visual group indicator (e.g., bracket/frame or header pill on its first/last turn) with a **`Collapse Ep K`** pill so the user can collapse it back in one click, plus a **`Collapse Episode`** button in the Node Detail Bar when any turn inside that expanded episode is selected.
- **Toolbar Bulk Controls:** Add a compact toolbar toggle when at least one episode exists (e.g., **`Collapse all`** / **`Expand all`**).

#### 5.2 Auto-Expand When Active Tip Is Inside an Episode
- Upon opening `StoryModal -> Timelines` (or when `activeLeafId` changes), compute the initial `expandedEpisodeIds` set:
  - Any episode group `E` that **contains `activeLeafId`** in its exact grouped turn-ID set starts **expanded** automatically.
  - All other episodes start **collapsed**.
- If a user switches timelines to a branch whose tip is inside an episode, or opens `StoryModal` via `Open Branch Graph` while rewound into an episode, that episode is immediately readable without an extra click.
- Users may still manually click the collapse pill on an auto-expanded episode if desired; if collapsed while containing `activeLeafId`, the pseudo-node carries the `ACTIVE` border/badge styling and selects cleanly.

#### 5.3 Selection, Detail Bar Actions & Pan Anchoring
- **Selecting a Pseudo-Node:** Single-clicking a pseudo-node selects `E.id` (`selectedNodeId = E.id`), highlights the Turn #0 → `E` ancestor path, and shows in the Node Detail Bar:
  - Episode range (`Turns X–Y`), turn count, branch-offs count (e.g., `2 branches diverge inside`), active/in-progress status badge.
  - Active summary text (or `"Episode in Progress"` notice) + inline **Alternate Summary Switcher** chevrons when available.
  - Primary CTA: **`Expand N turns`** (to inspect individual turns, **`Zoom to moment`**, or **`Branch from here`**—since turn-specific actions require choosing a specific turn inside the episode).
  - If the pseudo-node is on an alternate branch with a single unique descendant branch tip (`uniqueDescendantTipId !== null`), **`Switch to this timeline`** may still be offered directly.
- **Viewport Anchoring on Toggle:** When expanding or collapsing an episode `E`, preserve `E`'s screen-space anchor (or gently pan to center the newly expanded/collapsed span) so downstream nodes do not jump abruptly off-screen.
- **Toolbar Stats:** Update the toolbar summary counter to clarify grouped turns (e.g., `34 turns (2 episodes collapsed) · 3 timelines`).

---

## 4. Acceptance Criteria

1. **Grouped vs. Ungrouped Scope:**
   - Summarized episodes (`episodic_chunks`) collapse into Summary Pseudo-Nodes by default when opening `Timelines`, while Turn #0 and unsummarized working-memory turns stay visible as individual turn cards.
   - Interior `__arrival__` waypoints along a chunk's parent chain are absorbed into the pseudo-node without fragmenting it.
2. **Cross-Timeline Creation & `"Episode in Progress"`:**
   - When Timeline A has summarized `Turns 1–8` and the user checks out short Timeline B (`T1..T3 -> T4_B -> T5_B`), `Ep 1` still groups `T1..T3 + T4_A..T8_A` and displays **`"Episode in Progress"`** by default, with `T4_B -> T5_B` branching cleanly out of `Ep 1` (and `T4_B..T5_B` are **not** swallowed into `Ep 1`).
3. **Alternate Summary Chevron Switcher:**
   - Clicking the pseudo-node's chevron / `View alternate timeline summary` control (or the mirrored control in the Detail Bar) cycles between the default active view (`Active Summary` or `"Episode in Progress"`) and available alternate-timeline summaries without expanding the node or altering the active timeline.
4. **Branching Inside Episodes (1 & Multiple Branches):**
   - When 1 or multiple timelines diverge from turns inside a collapsed pseudo-node, all branching timelines originate visibly from the pseudo-node with origin labels/tooltips (`from Turn #k`).
   - Clicking the pseudo-node's **Expand pill** reveals all constituent turns and re-anchors each outgoing timeline edge to its exact originating turn node.
   - Clicking the **Collapse pill** collapses the episode back into its pseudo-node without breaking `branchTipCount` or `computeAncestorPath`.
5. **Active-Tip Auto-Expansion:**
   - When `active_leaf_turn_id` is inside an episode (e.g., after rewinding via **Branch** to Turn #4 inside `Turns 1–8`), opening `Timelines` displays that episode **expanded** by default with `ACTIVE` tip highlighted.
6. **Swipe & Click Discipline:**
   - Single-clicking a pseudo-node selects it and shows its details without auto-expanding.
   - `Show swipes (N)` and hidden swipe counts remain accurate and accessible when episodes contain unfollowed swipes.
7. **Verification Gates:**
   - Backend (`ruff check`, `tach check`, `pytest`), Frontend (`arch:check`, `build`, `vitest` covering pure grouping/precedence/branching/auto-expand unit tests + `StoryModal`/`BranchGraphCanvas` SSR assertions), Architecture Docs (`generate_arch_docs.py --check`), and Wiki updates (`../cybercantina-wiki`) all pass cleanly.

---

## 5. Resolved Design Decisions

1. **Backend Additive Field vs. Breaking `episodic_chunks`:** Keep `CampaignStateBundle.episodic_chunks` strictly active-branch-scoped for `Story -> Summary` and Zone 2 context; add `all_episodic_chunks` for the Branch Graph.
2. **Disjoint Turn Ownership Precedence:** Active-branch chunks claim shared trunk turns first; overlapping alternate-branch chunks group only their unclaimed post-divergence turns so no turn node is ever duplicated in the tree.
3. **Spoiler-Safe `"Episode in Progress"` + Explicit Chevron Switcher:** Never silently display another timeline's summary on an unmatched active timeline; default to `"Episode in Progress"` and require an explicit chevron slide/click (`View alternate timeline summary`) to preview alternate-timeline summaries.
4. **Pill-Driven Expand/Collapse + Active-Tip Auto-Expand:** Preserve v0.28.0's single-click selection invariant by dedicating an explicit pill on the pseudo-node for expansion (and a collapse pill when expanded), while automatically expanding any episode containing `active_leaf_turn_id` on open.
