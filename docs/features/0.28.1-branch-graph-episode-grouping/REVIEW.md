---
feature: branch-graph-episode-grouping
target_version: 0.28.1
document_type: review
status: approved
last_updated: 2026-11-22
---

# Pre-Implementation Architectural Review
## Branch Graph Summarized Episode Grouping & Alternate Summary Switcher (v0.28.1)

### Critical Architectural Traps Identified & Mitigated

1. **Active-Branch Scoping of `bundle.episodic_chunks` (`turns.py`)**
   - **Trap:** `get_campaign_state_bundle` filters `episodic_chunks` strictly to `leaf_turn_id in valid_turn_ids`. Relying solely on `bundle.episodic_chunks` breaks cross-timeline pseudo-node visibility whenever the user checks out a shorter branch or alternate timeline.
   - **Mitigation:** Add `list_campaign_episodic_chunks(campaign_id)` and expose an additive `all_episodic_chunks` field on `CampaignStateBundle`, while keeping `episodic_chunks` strictly active-branch-scoped for `Story → Summary` and Zone 2 prompt assembly.

2. **Exact Turn-ID Chain Membership vs. Naive Depth Matching (`branchGraphLayout.ts`)**
   - **Trap:** Matching turns to a chunk using `start_turn_depth <= depth_index <= end_turn_depth` would falsely swallow short divergent branches at the same depths, and would fail when two timelines both create `Turns 1–8` chunks sharing trunk turns `T1–T3`.
   - **Mitigation:** Walk `parent_turn_id` pointers backward from `chunk.leaf_turn_id` to resolve each chunk's exact turn-ID chain. Enforce active-first disjoint turn ownership (`claimedTurnIds`): overlapping alternate chunks register as alternate summary variants on the shared trunk pseudo-node and group only their unclaimed post-divergence turns.

3. **Interior `__arrival__` Waypoints & Active-Edge Highlighting**
   - **Trap:** Phase 4/5 skips `actor_id === "__arrival__"` when building `unsummarized`, so waypoints can lie inside `[start_turn_depth, end_turn_depth]`. Additionally, checking `activeBranchSet.has(parentId)` breaks amber spine edges leaving a collapsed pseudo-node whose ID is `episode:<chunk_id>`.
   - **Mitigation:** Walking `parent_turn_id` naturally absorbs interior `__arrival__` waypoints into the contiguous episode chain. Edge active-branch status checks `(nodeById[parentId]?.isActiveBranch ?? false) && node.isActiveBranch`.

4. **Expanded Episode Frame Overlapping Foreign Branches**
   - **Trap:** When an active branch cuts off horizontally from an interior turn of an expanded alternate-branch episode, a single naive bounding box over all turns of the episode visually overlaps the foreign branch's cards.
   - **Mitigation:** Segment expanded episode bounding frames by contiguous same-row (`y`) runs (`ExpandedEpisodeSegment[]`) so frames only enclose member turns.

5. **Click Overload, SSR Auto-Expansion & Viewport Jump**
   - **Trap:** Expanding on bare single-click prevents reading an episode summary in the Detail Bar; initializing auto-expansion only inside `useEffect` breaks SSR assertions and causes a flicker on mount; expanding 8 turns shifts downstream branches ~2,200px horizontally.
   - **Mitigation:** Keep single-click = select; use dedicated interactive pills (`+N turns`, `Collapse`, `‹ ›` chevron switcher) with `stopPropagation()`. Compute `defaultExpandedEpisodeIds` synchronously inside `buildBranchGraphModel` layered with `episodeExpandOverrides` (reset on `activeLeafId` change), and preserve screen-space pan anchor on expand/collapse.
