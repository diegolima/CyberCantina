---
feature: timeline-branching-and-story-modal
target_version: 0.28.0
document_type: plan
status: completed
last_updated: 2026-11-22
---

# Execution Plan
## Timeline Branching, Story Modal & Interactive Branch Graph (v0.28.0)

### Phase 1: Backend Branch-Safe Turn Deletion
- [x] Harden `delete_last_turn` in `backend/app/db/repos/turns.py` with interior-node descendant guard and sibling-branch isolation (same-`user_message` childless swipes only).
- [x] Update route docstrings in `backend/app/routers/campaign_routes/crud_and_state.py`.
- [x] Update `test_edit_last_message_swipe_and_delete_last_turn_with_swipes` and add branch-safe deletion tests in `backend/tests/test_engine_and_branches.py`.

### Phase 2: Pure Branch Graph Layout & Filtering Engine
- [x] Create `frontend/src/components/story/branchGraphLayout.ts` with zero-migration swipe collapsing, compact `__arrival__` waypoints, `notable_event_summary` descriptions, `uniqueDescendantTipId`, primary-spine lane layout, lineage path computation, and fit/center viewport helpers.

### Phase 3: Story Modal & SVG Pan/Zoom Branch Graph UI
- [x] Create `frontend/src/components/story/BranchGraphCanvas.tsx` (pan/zoom SVG tree, `+N swipes` expansion hit target, toolbar controls, screen-space HTML Node Detail & Action Bar).
- [x] Create `frontend/src/components/story/StoryModal.tsx` (`Summary` + `Timelines` tabs, Escape/backdrop handling).

### Phase 4: Turn Card Branching, Rewind Banner, Sidebar, Inspector & App Wiring
- [x] Update `frontend/src/components/chat/TurnCard.tsx` (`Branch` button on previous turns including Turn #0 once on Turn #1, disabled `Delete` when `hasDescendants`, `data-turn-id` + highlight pulse).
- [x] Update `frontend/src/components/chat/StandaloneArrivalCard.tsx` (`data-turn-id` + highlight pulse, no card-level `Branch`).
- [x] Update `frontend/src/components/chat/chatHelpers.tsx` and `frontend/src/components/ChatStage.tsx` (branch rewind handler, composer focus, scroll-to-turn with highlight, in-stage rewind continuity banner).
- [x] Update `frontend/src/components/AppSidebar.tsx` (`Story` between `Codex` and `Party` in expanded and rail modes).
- [x] Clean up `frontend/src/components/LiveInspector.tsx` (remove `Story` and `Timeline Branches` sections and dead state/props).
- [x] Wire lifted `StoryModal`, scroll target, composer focus, and sidebar props in `frontend/src/App.tsx`.
- [x] Add styles in `frontend/src/styles.css`.

### Phase 5: Tests, Architecture Docs & Wiki Documentation
- [x] Add `frontend/src/components/__tests__/branchGraphAndStory.test.tsx` and update `partyUi.test.tsx`.
- [x] Run backend checks (`ruff`, `tach`, `pytest`), frontend checks (`arch:check`, `build`, `vitest`), and `generate_arch_docs.py --check`.
- [x] Update sibling GitHub Wiki (`First-Campaign-and-Interface-Tour.md`, `Live-Inspector-Map-and-Timeline.md`, `Playing-Directing-and-Mechanics.md`).
