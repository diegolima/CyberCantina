---
feature: timeline-branching-and-story-modal
target_version: 0.28.0
document_type: review
status: approved
last_updated: 2026-11-22
---

# Pre-Implementation Architectural Review
## Timeline Branching, Story Modal & Interactive Branch Graph (v0.28.0)

### 1. Critical Architectural Traps Identified & Mitigated

1. **`delete_last_turn` Multi-Branch Wipe Hazard (`backend/app/db/repos/turns.py`)**
   - **Trap:** Previously, `delete_last_turn` collected `to_delete` via a recursive CTE rooted at `WHERE campaign_id = ? AND parent_turn_id = ?`. After checking out an earlier interior turn (via **Branch**) or branching off a parent that already has an existing continuation, clicking **Delete** would recursively wipe sibling and descendant timelines.
   - **Mitigation:**
     - Add an explicit interior-node guard (`SELECT 1 FROM turn_nodes WHERE campaign_id = ? AND parent_turn_id = ? LIMIT 1`) rejecting deletion of any turn with descendants (`ValueError` → HTTP 400), mirrored by disabling `Delete` on `TurnCard` when `hasDescendants === true`.
     - Restrict sibling deletion strictly to childless siblings under `parent_id` sharing the exact same `user_message` as the target leaf turn, preserving both developed sibling branches and distinct-prompt alternate turns.
     - Update [`test_edit_last_message_swipe_and_delete_last_turn_with_swipes`](file:///home/diegolima/Git/cybercantina/backend/tests/test_engine_and_branches.py#L1247-L1338) and add dedicated regression tests.

2. **Zero-Migration Swipe vs. Distinct-Prompt Branch Distinction**
   - **Trap:** `turn_nodes` has no `is_swipe` or `swipe_group_id` column. Naively hiding all childless non-active siblings would make newly created 1-turn alternate branches (with a different prompt) disappear from the Branch Graph as soon as the user switches back to the main timeline.
   - **Mitigation:** Group non-active childless siblings by `user_message` per parent. Only collapse them under a visible anchor sibling when a visible sibling shares the same `user_message`; if a prompt bucket has no active/followed sibling, promote its newest turn as a visible node and attach any same-prompt duplicates to it. Always keep all `active_branch_turns` visible.

3. **Single-Click Overload on Branch Graph Nodes**
   - **Trap:** Triggering path highlighting, swipe expansion, scroll-to-message, and timeline switching all on a single node click causes conflicting modal/navigation behavior.
   - **Mitigation:** Single-click selects the node, highlights the Turn #0 → Node path, and updates a screen-space HTML Node Detail Bar with explicit context-aware buttons (`Zoom to moment` on active branch only; `Switch to this timeline` on alternate branch tips and single-tip alternate interiors; `Branch from here` on any interior node). The `+N swipes` badge uses its own padded hit target with `stopPropagation()`.

4. **SVG Canvas & Node-Only Vitest Guardrails**
   - **Trap:** Mounting HTML controls inside `<svg><foreignObject>` under pan/zoom `<g transform>` layers causes repaint glitches and pointer-capture bugs; mixing layout math into React components prevents unit testing under Node-only Vitest (no `jsdom`).
   - **Mitigation:** Keep all graph filtering, swipe grouping, lane layout, path lineage, and viewport math in pure TypeScript (`frontend/src/components/story/branchGraphLayout.ts`). Render the toolbar and Node Detail Bar as screen-space HTML overlays outside `<svg>`. Pair pure unit tests with `ReactDOMServer.renderToStaticMarkup` assertions.

5. **Map-Arrival Waypoints (`__arrival__`)**
   - **Trap:** Filtering out `__arrival__` nodes breaks parent–child `parent_turn_id` edges; rendering full narrative cards for map moves adds visual bloat.
   - **Mitigation:** Render `__arrival__` turns as compact rounded waypoint pills in the Branch Graph while omitting card-level `Branch` buttons on `StandaloneArrivalCard`. Add `data-turn-id` on both `TurnCard` and `StandaloneArrivalCard` so active-branch `Zoom to moment` works seamlessly for any visible node.

6. **Right Inspector & Responsive Sidebar Parity**
   - **Trap:** Adding **Story** only to expanded `AppSidebar` breaks collapsed icon-rail navigation; leaving stale props/sections in `LiveInspector` breaks tests or leaves dead code.
   - **Mitigation:** Add **Story** between **Codex** and **Party** in both `expanded`/`overlay` and `rail` modes of `AppSidebar`, remove **Story** and **Timeline Branches** from `LiveInspector`, and verify all existing `AppSidebar`/`LiveInspector` tests.
