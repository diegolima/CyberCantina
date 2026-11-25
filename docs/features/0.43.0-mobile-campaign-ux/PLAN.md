---
feature: mobile-campaign-ux
target_version: 0.43.0
document_type: plan
status: completed
last_updated: 2026-11-26
---

# Implementation Plan — v0.43.0 Mobile Campaign UX, Turn Controls & Responsive Codex

## Step 1: Feature Package
- [x] Author `FRD.md` (`status: in_progress` -> `completed` at end)
- [x] Author `REVIEW.md` (`status: in_progress` -> `completed` at end)
- [x] Author `PLAN.md` (`status: in_progress` -> `completed` at end)

## Step 2: TurnCard Footer Redesign
- [x] Create `frontend/src/components/chat/TurnSwipeSwitcher.tsx` (`buildSwipePreviewText`, `‹ v#/N ›`, `.ui-popover.turn-swipe-popover`, no `GitBranch` icon beside switcher)
- [x] Update `ChatStage.tsx` (`openTurnPopover` mutual exclusion, `childCountByTurnId`) & `TurnCard.tsx` (footer classes, 2-tap `Confirm?` delete, mobile icon-only Delete with `aria-label`, `.cognition-header-detail`)
- [x] Style `.turn-swipe-*`, `.turn-actions-divider`, `.turn-delete-*`, and responsive rules in `04-chat-and-turns.css` & `15-responsive.css`

## Step 3: Game Mechanics & World Codex Mobile Reader
- [x] Add `getAdjacentMechanicsTopics` in `frontend/src/components/world/mechanics/mechanicsHelpers.ts`
- [x] Add `← Previous` / `Next →` pager in `CodexMechanicsDetail.tsx`
- [x] Add mobile single-pane drill-down (`codex-two-pane--mobile-list` / `codex-two-pane--mobile-detail`), `.codex-mobile-detail-bar`, and Game Mechanics topic picker sheet in `WorldCodexTab.tsx`
- [x] Update `WorldInspectorModal.tsx` (`.world-inspector-base-grid`, `.modal-footer--hide-mobile-readonly`) and `12-world-codex.css` / `07-modals-and-forms.css` / `15-responsive.css`
- [x] Re-enable `.inspector .ui-mechanics-help-btn` on `<= 620px` in `15-responsive.css`

## Step 4: Stage Header Compact Clock, Mobile Default-Collapsed Cognition & Jump-to-Latest
- [x] Extend `splitWorldClockDisplay` in `worldClockDisplay.ts` with `datePrefix` & `hourDigits`; render `.stage-clock-date` in `ChatStage.tsx`
- [x] Add `isMobileLayout?: boolean` to `ChatStageProps`, pass from `App.tsx`, collapse latest turn cognition by default when true
- [x] Add `isTurnFeedScrolledAwayFromBottom` in `chatHelpers.tsx` and floating `.turn-feed-jump-btn` in `ChatStage.tsx`

## Step 5: Mobile Composer Ergonomics, `DirectorChoicesDrawer` & `GmTalkDrawer`
- [x] Single-row icon-only secondary tools in `ChatComposer.tsx` & `15-responsive.css`
- [x] Add `shouldEnterSubmitComposer` in `chatHelpers.tsx` and apply coarse-pointer `Enter = newline` to Story & GM Talk inputs in `ChatComposer.tsx`
- [x] Restructure `.choices-option-row` into `.choices-option-main` + `.choices-option-meta` in `DirectorChoicesDrawer.tsx`, add `.choices-dc-input`, and expand `16px` iOS anti-zoom + mobile picker max-heights in `15-responsive.css`
- [x] Add compact `GmTalkDrawer.tsx` header spans (`.gm-spoiler-pill-detail`, `.gm-clear-btn-label`)

## Step 6: Full-Screen Modals, `BranchGraphCanvas` Touch Pan/Pinch & Viewport Polish
- [x] Add `viewport-fit=cover` in `frontend/index.html`
- [x] Make `.story-modal-panel`, `.context-health-modal`, and `.party-modal-card` full-screen on `<= 820px` + scrollable `.story-modal-tabs`
- [x] Add `computeBranchPinchViewport` in `branchGraphLayout.ts`, `touch-action: none` in `14-story-and-bookmarks.css`, and multi-pointer pinch/pan in `BranchGraphCanvas.tsx`
- [x] Mobile chat reading polish in `15-responsive.css` (1-col `.cognition-steps`, tighter `.turn-card` padding, wider `.user-prompt-row` / `.user-message-container`)

## Step 7: Touch Ergonomics — Mini-Map Hit Targets & Overlay Swipe-to-Dismiss
- [x] Add transparent `r={22}` `.minimap-node-hit-target` circles in `InspectorLocationCard.tsx`
- [x] Create `frontend/src/utils/drawerSwipe.ts` and `frontend/src/hooks/useDrawerSwipeDismiss.ts`
- [x] Wire `useDrawerSwipeDismiss` into `AppSidebar.tsx` and `LiveInspector.tsx`

## Step 8: Tests, Mechanics Catalog, Architecture Docs & Sibling Wiki Sync
- [x] Add comprehensive Vitest suite `frontend/src/components/__tests__/mobileCampaignUx.test.tsx`
- [x] Sync `timelines-branching` & `timelines-graph-bookmarks` in `mechanicsCatalog.ts`
- [x] Regenerate & check architecture docs (`scripts/generate_arch_docs.py`)
- [x] Update sibling wiki pages in `../cybercantina-wiki`

## Step 9: Verification
- [x] `npm --prefix frontend run arch:check`
- [x] `npm --prefix frontend run css:audit`
- [x] `npm --prefix frontend run build`
- [x] `npm --prefix frontend test`
- [x] `backend/.venv/bin/python scripts/generate_arch_docs.py --check`
- [x] Mark feature docs `completed`
