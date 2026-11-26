---
feature: ux-resilience-polish
target_version: 0.47.0
document_type: plan
status: completed
last_updated: 2026-11-26
---

# Implementation Plan — UX, Accessibility & Stream Resilience Polish

## Step 1: Feature Spec Package
- [x] Create isolated worktree `.worktrees/ux-resilience-polish` on branch `feat/ux-resilience-polish`
- [x] Author `FRD.md` (`docs/features/TBD-ux-resilience-polish/FRD.md`)
- [x] Author `REVIEW.md` (`docs/features/TBD-ux-resilience-polish/REVIEW.md`)
- [x] Author `PLAN.md` (`docs/features/TBD-ux-resilience-polish/PLAN.md`)

## Step 2: Quick Mobile & Keyboard A11y Wins
- [x] Convert `.home-card-main-zone`, `.home-card-new-shelf`, and `.home-nav-profile-chip` in `frontend/src/components/HomeScreen.tsx` to native `<button type="button">` elements
- [x] Update `frontend/src/styles/10-home.css` with button resets and `:focus-visible` focus rings for Home cards, shelves, and profile chip
- [x] Fix Step 2 character selection checkbox keyboard toggling in `frontend/src/components/NewCampaignModal.tsx` without double-toggling on click
- [x] Update `frontend/src/styles/15-responsive.css` under `@media (max-width: 820px)` to set `font-size: 16px` on `.field-input`, `.field-textarea`, `.field-select`, `.form-input`, `.form-select`, `.field-input--compact`, and `.tag-chips-inline-input`, cleaning up redundant narrower overrides without `!important` and checking mobile 2-column grid overflow

## Step 3: Offline / Server-Unreachable Resilience
- [x] Create `frontend/src/components/shared/ServerUnreachableScreen.tsx` (dark-themed `"Cannot reach CyberCantina server"` screen with **Retry Connection** button and `online` event listener)
- [x] Update `frontend/src/App.tsx` startup auth/workspace flow to catch network/5xx errors, distinguish unreachable servers from 401/`{ authenticated: false }`, and render `ServerUnreachableScreen` instead of silently dropping onto `AuthScreen`
- [x] Remove dead `frontend/public/offline.html` and clean up stale `offline.html` references in `frontend/vite.config.ts` (`includeAssets`) and `frontend/nginx.conf`, keeping `workbox.navigateFallback: "/index.html"`

## Step 4: Backend & Frontend Campaign Turn Stream Stop + Error Recovery
- [x] Update `backend/app/routers/campaign_routes/turn_streaming.py`:
  - Cancel Phase 3 `p3_task` on client disconnect instead of shielding it (`asyncio.shield`), while keeping `asyncio.shield(worker_task)` on Phase 5
  - Handle `asyncio.CancelledError` cleanly in `_sse_generator` (matching `gm_routes.py`)
- [x] Update `frontend/src/types/` and `frontend/src/hooks/useCampaignTurnActions.ts`:
  - Wire `AbortController` (`stopTurnStream`) into `streamCampaignTurn` and abort on campaign change / unmount
  - Track `hasTurnSavedRef` / structured error state (`kind: "turn_pre_save" | "turn_post_save" | "action"`, `retryable`, `failedTurnOpts`) and snapshot composer draft + `TurnSubmitOptions`
  - Add `onCancelOrRestoreDraft` / retry callback support, restoring draft only when composer is empty on clean Stop or `turn_pre_save` error
- [x] Update `frontend/src/App.tsx`, `frontend/src/components/ChatStage.tsx`, `frontend/src/components/chat/ChatComposer.tsx`, and `frontend/src/styles/05-composer-and-slash.css`:
  - Swap Send button to **Stop** during `isStreaming` (Phases 1–4) and disabled **"Finalizing…"** during `isPhase4Running` (Phase 5)
  - Render provider-agnostic `role="alert"` error card (**"Turn Error:"** / **"Action Error:"** / **"Turn Finalization Error:"**) with **Retry** (only on `turn_pre_save`), **Dismiss**, and **Model Settings** (only on `turn_pre_save`)

## Step 5: Shared Modal Accessibility (`useModalDialog`) & Cross-Editor Dirty-Close / `beforeunload` Guards
- [x] Update `frontend/src/providers/NavigationHistoryContext.tsx` and `frontend/src/hooks/useOverlayBackHandler.ts`:
  - Expose `requestClose()` from `useOverlayBackHandler` (opening `NavigationGuardModal` when `isDirty`, closing immediately when clean)
  - Add centralized `beforeunload` listener in `NavigationHistoryProvider` whenever any overlay is dirty or `routeGuardRef.current?.isBlocked`
- [x] Create stack-aware, Node-SSR-safe `frontend/src/hooks/useModalDialog.ts` providing `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, topmost-only focus trap, focus restoration, and topmost-only `Escape` handling
- [x] Roll out `useModalDialog` across all ~16+ app modals (`PersonaEditorModal`, `NewCampaignModal`, `ProfileModal`, `AdminModal`, `FeedbackModal`, `CharacterInspectorModal`, `WorldInspectorModal`, `NotesModal`, `DeleteConfirmationModal`, `HomeEntityPickerModal`, `ExportBundleModal`, `ExportCampaignModal`, `ImportPreviewModal`, `CharacterWizardModal`, `WorldWizardModal`, `AgentChangesModal`, `SettingsModal`) and align existing `role="dialog"` modals where applicable
- [x] Wire `requestClose` to backdrop clicks, X buttons, Cancel buttons, and `Escape` across all dirty-tracked editors (`PersonaEditorModal`, `CharacterInspectorModal`, `WorldInspectorModal`, `NotesModal`, `CharacterWizardModal`, `WorldWizardModal`)
- [x] Fix `PersonaEditorModal.tsx` false-dirty tracking by excluding server-persisted `portraitUrl` and `gallery` from `currentSnapshot`

## Step 6: Unit & Integration Tests
- [x] Add backend pytest coverage in `backend/tests/` verifying Phase 3 task cancellation and clean `asyncio.CancelledError` handling in `turn_streaming.py`
- [x] Add/update frontend Vitest tests covering:
  - `useCampaignTurnActions` / `ChatStage` / `ChatComposer`: Stop button (`isStreaming` vs `isPhase4Running` Finalizing), `AbortError` handling, draft snapshot restore when empty, structured error card (Retry / Dismiss / Model Settings vs Action Error)
  - `ServerUnreachableScreen` & `App.tsx` startup error classification helper
  - `HomeScreen` native `<button type="button">` card/shelf/profile-chip rendering and `NewCampaignModal` Step 2 checkbox handling
  - `NavigationHistoryContext` / `useOverlayBackHandler` `requestClose` (dirty vs clean) and `beforeunload` guard
  - `useModalDialog` SSR safety + `role="dialog"` / `aria-modal="true"` assertions across core modals

## Step 7: Planned User-Facing Wiki Updates (Deferred to Merge Time)
- [x] Inspect `../cybercantina-wiki/_Sidebar.md` and `../cybercantina-wiki/Home.md`, and apply updates at merge time to:
  - `../cybercantina-wiki/First-Campaign-and-Interface-Tour.md` — Document the server-unreachable retry screen, keyboard navigation on the Home Control Deck, and unsaved-change / active-stream close protections.
  - `../cybercantina-wiki/Playing-Directing-and-Mechanics.md` — Document stopping an in-progress campaign turn stream (Phases 1–4) and retrying/dismissing failed turns without losing your draft.

## Step 8: Architecture Docs, Spec Finalization & Full Verification
- [x] Regenerate and verify architecture docs:
  `backend/.venv/bin/python scripts/generate_arch_docs.py && backend/.venv/bin/python scripts/generate_arch_docs.py --check`
- [x] Mark `FRD.md`, `REVIEW.md`, and `PLAN.md` `status: completed` with all boxes checked upon completion
- [x] Run full verification gates inside `.worktrees/ux-resilience-polish`:
  - Backend: `cd backend && .venv/bin/ruff check app tests && .venv/bin/tach check` and `backend/.venv/bin/pytest backend/tests`
  - Frontend: `npm --prefix frontend run arch:check && npm --prefix frontend run css:audit && npm --prefix frontend run build && npm --prefix frontend test`
