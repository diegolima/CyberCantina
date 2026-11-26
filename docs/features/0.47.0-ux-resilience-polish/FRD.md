---
feature: ux-resilience-polish
target_version: 0.47.0
document_type: frd
status: completed
last_updated: 2026-11-26
---

# Feature Requirements Document — UX, Accessibility & Stream Resilience Polish

## 1. Overview & Motivation

CyberCantina has accumulated several cross-cutting UX, accessibility, and resilience gaps across its campaign stage, home deck, modal system, and startup offline handling:
- Active campaign turn streams cannot be stopped once initiated, even though the underlying `streamCampaignTurn` client and browser-relay cancellation (`llm.cancel`) already accept abort signals.
- Submitting a campaign turn immediately clears the composer draft, and any stream or campaign action failure displays a static `"Ollama / LLM Error:"` banner with no Retry or Dismiss controls.
- Navigation/network failures during startup (`refreshAuthStatus` / `loadWorkspaceData`) are uncaught in `App.tsx`, silently dropping users onto `AuthScreen`, while `public/offline.html` is shadowed by Workbox's `navigateFallback: "/index.html"`.
- Core modals lack `role="dialog"`, `aria-modal="true"`, focus traps, focus restoration, and consistent `Escape` handling; dirty-tracked editors only guard browser Back via `useOverlayBackHandler` while backdrop/X/Cancel clicks and `beforeunload` silently discard edits.
- Home deck cards and the navbar profile chip are clickable `<div>` elements unreachable by keyboard, and mobile `@media (max-width: 820px)` omits `font-size: 16px` on generic form classes (`.field-input`, `.field-select`, `.field-textarea`, `.form-input`, `.form-select`, `.field-input--compact`, `.tag-chips-inline-input`), triggering iOS Safari auto-zoom.

This package addresses all four pillars cohesively in a single feature branch.

---

## 2. Agreed Product Decisions

### 2.1 Campaign Turn Stream Cancellation & Error Recovery
- **AbortController wiring (`useCampaignTurnActions.ts` + `frontend/src/api/stream.ts`):**
  - Wire an `AbortController` per turn stream in `useCampaignTurnActions.ts` and pass `controller.signal` to `streamCampaignTurn`.
  - Abort any active stream cleanly on campaign switch or hook unmount.
- **Stop vs. Finalizing composer button (`ChatComposer.tsx` + `ChatStage.tsx`):**
  - While `isStreaming === true` (Phases 1–4, **before** `turn_saved` arrives), swap the composer's Send button into a **Stop** button (`type="button"`).
  - Once `turn_saved` is emitted and Phase 5 post-turn clerks run (`isPhase4Running === true`), disable the action button in a **"Finalizing…"** state so SQLite writes and `phase5_complete` state reconciliation are never desynced.
  - Keep `Enter` / form `onSubmit` disabled while `isBusy` so pressing `Enter` mid-stream never accidentally cancels or resubmits.
- **Backend Phase 3 cancellation (`backend/app/routers/campaign_routes/turn_streaming.py`):**
  - Cancel `p3_task` on client disconnect instead of shielding it (`asyncio.shield`), so stopping a multi-character cognition swarm halts server/relay LLM work immediately.
  - Catch `asyncio.CancelledError` cleanly in `_sse_generator` (matching `gm_routes.py`) without emitting spurious error events or stack traces.
  - Preserve `await asyncio.shield(worker_task)` on Phase 5 post-turn clerks so SQLite commits after `turn_saved` cannot be aborted mid-transaction.
  - Browser-relayed `llm.cancel` already propagates via `backend/app/providers/local_relay.py` and `LocalRelayContext.tsx`.
- **Clean cancellation & draft restoration:**
  - Treat `AbortError` as a clean user cancellation (no error banner), discard partial streamed prose without saving a turn, and restore the cancelled prompt/slash/dice/choices into the composer **only if the composer is currently empty**.
- **Error recovery & draft preservation (`ChatStage.tsx` + `useCampaignTurnActions.ts`):**
  - Keep clearing the composer immediately upon send, while snapshotting both the full `TurnSubmitOptions` and composer draft state (`inputText`, `activeSlash`, `diceMode`, `diceOverride`, `stagedChoices`).
  - Tag errors structurally by origin (`turn_pre_save`, `turn_post_save`, `action`):
    - **Pre-`turn_saved` failure (`turn_pre_save`):** auto-restore the snapshot draft into the composer *only if the composer is currently empty*, and render a provider-agnostic `role="alert"` error card (**"Turn Error:"** instead of **"Ollama / LLM Error:"**) with **Retry** (replaying exact `TurnSubmitOptions`), **Dismiss**, and **Model Settings** (instead of `"Configure Ollama Models"`).
    - **Post-`turn_saved` failure (`turn_post_save`):** display a dismissible error card **without** Retry or draft auto-restore (preventing duplicate sibling turns).
    - **Non-LLM campaign action errors (`action` — location override, physical state override, party create/disband):** render as a separate dismissible **"Action Error:"** banner without Retry or Model Settings.

### 2.2 Offline & Backend-Unreachable Resilience
- **Startup error handling (`App.tsx` + `ServerUnreachableScreen.tsx`):**
  - Catch startup failures in `refreshAuthStatus()` and `loadWorkspaceData()`, distinguishing network/5xx/unreachable failures from genuine unauthenticated responses (`200 { authenticated: false }` or `401`).
  - Render a dedicated dark-themed React **"Cannot reach CyberCantina server"** screen (`frontend/src/components/shared/ServerUnreachableScreen.tsx`, matching the existing visual aesthetic) with a **Retry Connection** button and automatic retry on the `window` `"online"` event instead of silently dropping users onto `AuthScreen`.
- **Service Worker & SPA deep-links (`frontend/vite.config.ts` + `frontend/nginx.conf`):**
  - Keep `workbox.navigateFallback: "/index.html"` in `frontend/vite.config.ts` so SPA deep-links (`/campaigns/:id`) continue working online and boot into the precached React shell offline (where `App.tsx` renders `ServerUnreachableScreen`).
  - Remove the dead `frontend/public/offline.html` asset and remove its stale references in `frontend/vite.config.ts` (`includeAssets`) and `frontend/nginx.conf`.

### 2.3 Unified Modal Accessibility & Dirty-Close Guards
- **Shared stack-aware `useModalDialog` hook (`frontend/src/hooks/useModalDialog.ts`):**
  - Node-SSR-safe (all DOM/window/document interactions strictly inside `useEffect`).
  - Maintains a lightweight topmost-modal stack (aligned with stacked overlays such as `ProfileModal -> FeedbackModal`, `PersonaEditorModal -> NavigationGuardModal`, `WorldInspectorModal -> ExportDialog/ReimagineModal`) so nested modals never fight over focus or key events.
  - Provides:
    - `role="dialog"`, `aria-modal="true"`, and `aria-labelledby` (or `aria-label`)
    - Topmost-only `Tab` / `Shift+Tab` focus trap within focusable descendants
    - Focus restoration to the previously focused element on close
    - Topmost-only `Escape` key handling routed through the modal's close / guarded-close handler
  - Roll out across **all ~16+ app modals**: `PersonaEditorModal`, `NewCampaignModal`, `ProfileModal`, `AdminModal`, `FeedbackModal`, `CharacterInspectorModal`, `WorldInspectorModal`, `NotesModal`, `DeleteConfirmationModal`, `HomeEntityPickerModal`, `ExportBundleModal`, `ExportCampaignModal`, `ImportPreviewModal`, `CharacterWizardModal`, `WorldWizardModal`, `AgentChangesModal`, `SettingsModal`, and verify consistent alignment on modals that already declare `role="dialog"` (`StoryModal`, `ContextHealthModal`, `PartyManagementModal`, `LoreIndexModal`, `ImageLightboxModal`, `NavigationGuardModal`, `PortalPromotionModal`, `MapDialogs`).
- **Unified dirty-close guard (`useOverlayBackHandler.ts` + `NavigationHistoryContext.tsx`):**
  - Extend `useOverlayBackHandler` to return `{ requestClose }`:
    - When `isDirty` is `true`, `requestClose()` triggers `NavigationGuardModal` (matching browser Back behavior).
    - When clean, `requestClose()` closes immediately via `onClose()`.
  - Wire `requestClose` to backdrop clicks, header X buttons, Cancel buttons, and `Escape` across all dirty-tracked editors (`PersonaEditorModal`, `CharacterInspectorModal`, `WorldInspectorModal`, `NotesModal`, `CharacterWizardModal`, `WorldWizardModal`), while keeping post-save `handleSubmit` calling raw `onClose()`.
- **Centralized `beforeunload` guard (`NavigationHistoryContext.tsx`):**
  - Attach a `window` `"beforeunload"` listener whenever any registered overlay has `isDirty: true` OR `routeGuardRef.current?.isBlocked` (active campaign stream).
- **`PersonaEditorModal` media dirty-state fix (`PersonaEditorModal.tsx`):**
  - Exclude server-persisted immediate media mutations (`portraitUrl`, `gallery` managed directly via `PersonaMediaTab` API calls) from `currentSnapshot` / dirty baseline so uploading or deleting media does not falsely prompt `"Discard unsaved persona changes?"`.

### 2.4 Mobile Input Auto-Zoom & Home/Modal Keyboard Accessibility
- **Home Deck & Navbar keyboard accessibility (`HomeScreen.tsx` + `10-home.css`):**
  - Convert `.home-card-main-zone`, `.home-card-new-shelf`, and `.home-nav-profile-chip` from clickable `<div>` elements to native `<button type="button">` elements with clean button CSS resets and `:focus-visible` focus rings.
- **New Campaign Step 2 checkbox fix (`NewCampaignModal.tsx`):**
  - Fix the Step 2 character selection checkbox (currently `onChange={() => {}}`) so keyboard `Spacebar` toggles character selection cleanly without double-toggling with the parent container click.
- **iOS Safari 16px input sizing (`15-responsive.css`):**
  - Under `@media (max-width: 820px)`, apply `font-size: 16px` to `.field-input`, `.field-textarea`, `.field-select`, `.form-input`, `.form-select`, `.field-input--compact`, and `.tag-chips-inline-input` (covering Auth, Initial Setup, Profile, Admin, Persona, New Campaign, and tag chip inputs), removing redundant narrower overrides cleanly without `!important`.

---

## 3. Out of Scope
- Offline-first local campaign storage or queued turn submission while disconnected.
- Rewriting `useGmTalk.ts` cancellation semantics (GM Talk already supports `AbortController` and Stop; only campaign turn streaming is brought up to parity with phase-aware safeguards).
- Redesigning modal visual layouts beyond accessibility attributes, focus rings, and mobile 16px input sizing.
