---
feature: browser-navigation
target_version: 0.45.0
document_type: plan
status: completed
last_updated: 2026-11-26
---

# Implementation Plan — v0.45.0 Browser Navigation & Overlay Back-Stack

## Step 1: Feature Spec Package
- [x] Author `FRD.md` (`docs/features/0.45.0-browser-navigation/FRD.md`)
- [x] Author `REVIEW.md` (`docs/features/0.45.0-browser-navigation/REVIEW.md`)
- [x] Author `PLAN.md` (`docs/features/0.45.0-browser-navigation/PLAN.md`)

## Step 2: Leaf Navigation Types & Pure History/Route Utilities
- [x] Create `frontend/src/types/navigation.ts` defining `AppRoute` (`{ kind: "home" } | { kind: "campaign"; campaignId: string }`), `HistoryNavState`, `OverlayRegistration`, and `NavigationGuardPrompt`
- [x] Re-export navigation types from `frontend/src/types/index.ts`
- [x] Create `frontend/src/utils/navigationHistory.ts` with pure, Vitest-testable helpers: `parseAppRoute(pathname)`, `formatAppRoute(route)`, `buildHistoryNavState(...)`, `parseHistoryNavState(raw)`, `reconcileOverlayHistoryAction(...)`, and Forward stale-entry normalization

## Step 3: Navigation History Context, `useOverlayBackHandler` & `NavigationGuardModal`
- [x] Create `frontend/src/providers/NavigationHistoryContext.tsx` managing route navigation (`navigateTo`, `replaceRoute`), session nonce, LIFO overlay stack registration, batched depth reconciliation (`replaceState` on same-depth swap, `pushState` on deepen, pending-ignore counter on programmatic unwind), `popstate` dispatching, dirty/streaming guard interruption, and deferred Back confirmation
- [x] Create `frontend/src/hooks/useOverlayBackHandler.ts` (optional-context-safe: clean no-op outside `NavigationHistoryProvider` for standalone SSR tests)
- [x] Create `frontend/src/components/shared/NavigationGuardModal.tsx` (`z-index: 1300`, `Escape` → Stay, accessible focus/buttons for Stay vs. Discard/Leave) and add any needed styles in `frontend/src/styles/`

## Step 4: Route-Driven Campaign Lifecycle in `App.tsx` & `AppModals.tsx`
- [x] Wrap `App` root inside `NavigationHistoryProvider` (preserving `LocalRelayProvider` inside authenticated shell)
- [x] Remove silent `localStorage` auto-resume on `/` in `loadWorkspaceData`; resolve initial `/campaigns/:id` directly across `AuthScreen` / `InitialSetupScreen` once authenticated, with `replaceRoute({ kind: "home" })` + non-blocking fallback notice on 404/403
- [x] Wire `route` ↔ `bundle` synchronization in `App.tsx` with a monotonic load-request nonce (prevents stale async `getCampaignState` overwriting a subsequent Back press)
- [x] Update campaign open (`HomeScreen` / `NewCampaignModal` / `CharacterWizardModal`), `handleCloseCampaign` (`pushState` to `/`), `handleLogout`, `handleAccountDeleted`, and active-campaign deletion (`replaceRoute` to `/`)
- [x] Register the `isStreaming` route-exit guard (`isPhase4Running` alone remains silent)

## Step 5: Wire Dismissible Overlays & Mobile/Tablet Drawers
- [x] Register `App.tsx` overlays: `layout.activeOverlayDrawer` (`"left"` / `"right"`), `NotesFlyout`, `StoryModal`, `PartyManagementModal`, `ExportCampaignModal`
- [x] Register `HomeScreen.tsx` overlays: `HomeEntityPickerModal`, `ExportBundleModal`, `ImportPreviewModal`
- [x] Register `AppModals.tsx` dismissible overlays: `DeleteConfirmationModal`, `NewCampaignModal`, `ProfileModal`, `AdminModal` (plus internal sub-modal in `AdminModal.tsx` & `FeedbackModal.tsx`)
- [x] Register `ChatStage.tsx` & inspector overlays: `GmTalkDrawer`, `ContextHealthModal`, `AgentChangesModal`, `LiveInspector.tsx` fullscreen map modal, `LoreIndexModal.tsx`, `ImageLightboxModal.tsx`

## Step 6: Add Deterministic Dirty Tracking & Back Guards to Editors & Wizards
- [x] Wire `WorldInspectorModal.tsx` existing `isDirty` state (plus inline sub-confirmation modals) into `useOverlayBackHandler`
- [x] Add deterministic snapshot-based `isDirty` tracking and `useOverlayBackHandler` to `CharacterInspectorModal.tsx`, `PersonaEditorModal.tsx`, and `NotesModal` (`NotesDrawer.tsx`)
- [x] Add active-draft / modified-seed dirty tracking and `useOverlayBackHandler` to `CharacterWizardModal` (`WizardModals.tsx`) and `WorldWizardModal.tsx`

## Step 7: Unit Tests (Vitest) & Playwright E2E Coverage
- [x] Create `frontend/src/utils/__tests__/navigationHistory.test.ts` covering route parsing/formatting, `HistoryNavState` validation, depth reconciliation (open, stack, same-depth swap, modal-to-route launch), dirty/streaming guard re-push logic, and Forward stale-entry cleanup
- [x] Create `frontend/src/components/__tests__/navigationGuard.test.tsx` verifying `NavigationGuardModal` SSR rendering and optional-context-safe `useOverlayBackHandler` behavior
- [x] Update `frontend/e2e/fixtures/cantinaApiMock.ts` (`startInCampaign` compatibility) and verify all 7 existing E2E specs (`01`–`07`)
- [x] Add `frontend/e2e/08-browser-navigation-and-back-stack.spec.ts` covering Workflow 1, Workflow 2 (mobile & desktop), stacked overlays, dirty discard guard, streaming guard, deep-link across auth, invalid campaign fallback, and Forward hygiene

## Step 8: User-Facing Wiki Updates
- [x] Inspect `../cybercantina-wiki/_Sidebar.md` and `../cybercantina-wiki/Home.md` and update affected user-facing guide pages (campaign URLs, multi-tab isolation, Back / mobile swipe-back dismissal)

## Step 9: Architecture Docs, Spec Finalization & Full Verification
- [x] Regenerate and verify architecture docs: `backend/.venv/bin/python scripts/generate_arch_docs.py && backend/.venv/bin/python scripts/generate_arch_docs.py --check`
- [x] Mark `FRD.md`, `REVIEW.md`, and `PLAN.md` `status: completed` with all boxes checked
- [x] Run full verification gates:
  - Backend: `cd backend && .venv/bin/ruff check app tests && .venv/bin/tach check` and `backend/.venv/bin/pytest backend/tests`
  - Frontend: `npm --prefix frontend run arch:check && npm --prefix frontend run css:audit && npm --prefix frontend run build && npm --prefix frontend test`
  - E2E: `npm --prefix frontend run typecheck:e2e && npm --prefix frontend run test:e2e`
