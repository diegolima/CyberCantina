---
feature: browser-navigation
target_version: 0.45.0
document_type: review
status: completed
last_updated: 2026-11-26
---

# Pre-Implementation Review — v0.45.0 Browser Navigation & Overlay Back-Stack

## Key Architectural Traps & Mitigations

### 1. Async `history.back()` Race Conditions on Swapped Overlays & Modal-to-Route Launches
- **Trap:** In CyberCantina, multiple UI actions close one overlay and open another—or launch a campaign—within the same event handler:
  - `HomeScreen.tsx` (`HomeEntityPickerModal` callbacks, lines 697–717): `setActivePickerCategory(null)` followed immediately by `onInspectCharacter(c)`, `onInspectWorld(w)`, `onEditPersona(p)`, or `handlePickerNewClick(cat)`.
  - `App.tsx` (`handleOpenMechanicsGuide`, lines 250–264): `layout.closeOverlays()`, `setStoryModalTab(null)`, `setIsPartyModalOpen(false)`, then `setCampaignWorldSheetTab("codex")`.
  - `NotesDrawer.tsx` (`NotesFlyout`, lines 352–355): `onClose()` followed by `onOpenModal()`.
  - `AppModals.tsx` (`CharacterWizardModal.onCreated` lines 244–259, `NewCampaignModal.onCreate` lines 465–484): closes the modal/wizard while simultaneously creating and entering a new campaign.
  Because `window.history.back()` is asynchronous and dispatches `popstate` on a later task, calling `back()` on unmount of modal A while modal B mounts and calls `pushState()` causes the delayed `popstate` from A to close B or drop the newly opened campaign route.
- **Mitigation:**
  - Use **target-depth reconciliation** in `NavigationHistoryContext` rather than naive per-component `pushState` on mount + `history.back()` on unmount.
  - Batch stack sync in a post-commit effect/microtask: if the active overlay count transitions `1 → 1` (e.g., Picker → Inspector, Story → Codex, Flyout → NotesModal), update the current entry in place via `history.replaceState` (keeping `overlayDepth: 1` with the new `overlayId`) instead of calling `back()` + `pushState()`.
  - When a modal closes and the active route changes in the same transition (e.g., `NewCampaignModal` or `CharacterWizardModal` launching `/campaigns/:id`), transition the history entry directly from `overlayDepth: 1` on `/` to `overlayDepth: 0` on `/campaigns/:id` using `history.replaceState`—or, when coming from `overlayDepth: 0`, `pushState`—so Back from the launched campaign always returns cleanly to `/` at `overlayDepth: 0`.
  - Track a `pendingProgrammaticBacksRef` counter whenever programmatic UI closes (`X`, `Escape`, backdrop, Save) pop an overlay depth so those synthetic `popstate` events are consumed cleanly without triggering a second close.

### 2. `popstate` Cannot Be Cancelled (`preventDefault()` Unavailable) & Re-Push Guard Loop
- **Trap:** The browser fires `popstate` *after* it has already moved the history cursor backward. Calling `event.preventDefault()` does nothing. If the user swipes Back while `isStreaming` is true or while an editor/wizard is dirty, the browser is already sitting on the previous history entry when the handler runs. Naive re-pushing can trigger nested `popstate` handling or double-open the guard prompt.
- **Mitigation:**
  - Inside `popstate` handling, evaluate the top guarded overlay (if any) or the `isStreaming` route guard *before* mutating React state.
  - If blocked (`isDirty` or `isStreaming`), immediately restore the interrupted entry via `window.history.pushState(restoredEnvelope, "", restoredPath)` and store a single pending continuation descriptor (`{ action: "closeOverlay" | "leaveCampaign", overlayId?, targetRoute }`) in `NavigationGuardModal` state.
  - Ignore subsequent Back attempts while a guard modal is already open (or treat `Escape` inside `NavigationGuardModal` as **Stay**).
  - When the user clicks **Discard** / **Leave**, close the guard modal, run the deferred dismissal/navigation, and consume the restored history entry cleanly so no extra phantom entry remains.

### 3. Browser Forward Resurrecting Dead Modals or Confirmations
- **Trap:** When a user opens `DeleteConfirmationModal` or `CharacterInspectorModal` (pushing `overlayDepth: 1`) and then closes it via `X`, `Escape`, or Back, the browser's Forward stack may still contain an entry with `overlayDepth: 1` (especially if the user closed via Back or navigated across routes). Pressing Forward later could re-open a confirmation modal or a modal for a deleted record.
- **Mitigation:**
  - Stamp every history state envelope with `{ __ccNav: 1, sessionId, route, overlayDepth, overlayId }`, where `sessionId` is a random per-page-load identifier.
  - On `popstate`, if `nextState.overlayDepth > currentStackLength` (i.e., moving Forward onto a stale overlay entry) or `nextState.sessionId !== currentSessionId` when `nextState.overlayDepth > 0`, **never** open an overlay. Immediately normalize the entry via `history.replaceState({ ...currentRouteState, overlayDepth: 0, overlayId: null }, "", routePath)` while still honoring real route transitions (`/` → `/campaigns/:id`).

### 4. Frontend Layer Boundaries (`.dependency-cruiser.cjs`) & Node-Only Vitest SSR Compatibility
- **Trap:** `frontend/.dependency-cruiser.cjs` strictly enforces:
  - `src/types/` has zero outgoing runtime dependencies (`no-types-outgoing`).
  - `src/utils/` may depend only on `src/types/` and sibling `src/utils/` (`no-utils-local-upward`).
  - `src/providers/` must not import `src/components/` or `src/hooks/` (`no-providers-to-ui`).
  - `src/hooks/` must not import `src/components/` (`no-hooks-to-components`).
  - `frontend/package.json` runs Vitest in a **Node-only environment** (`ReactDOMServer.renderToStaticMarkup`), and existing component tests (`ImageLightboxModal`, `GmTalkDrawer`, `ContextHealthModal`, `AgentChangesModal`, `LoreIndexModal`) render modal components directly without wrapping them in `App` providers.
- **Mitigation:**
  - Put route/envelope types in `src/types/navigation.ts` (leaf layer) and pure URL parsing/reconciliation logic in `src/utils/navigationHistory.ts` (imports only `src/types/`).
  - Put `NavigationHistoryContext`, `NavigationHistoryProvider`, and `useOptionalNavigationHistory` in `src/providers/NavigationHistoryContext.tsx` (zero imports from `components/` or `hooks/`).
  - Put `useOverlayBackHandler` in `src/hooks/useOverlayBackHandler.ts` (imports only `providers/` + `types/` + `react`), and make it **no-op safely when `NavigationHistoryProvider` is absent** so every standalone Vitest SSR render test passes untouched.
  - Register `layout.activeOverlayDrawer` (`"left"` / `"right"`) inside `App.tsx` via `useOverlayBackHandler` rather than importing navigation providers inside `useResponsiveCampaignLayout.ts`.

### 5. Playwright E2E Fixture Compatibility (`cantinaApiMock.ts`)
- **Trap:** `frontend/e2e/fixtures/cantinaApiMock.ts` (lines 726–732) sets `window.localStorage.setItem("cybercantina_active_campaign_id", "camp_1")` whenever `options.startInCampaign` is true, and existing E2E specs (`03` through `07`) call `page.goto("/")` expecting the app to auto-open `camp_1`. Removing silent auto-resume on `/` without updating the fixture would land those tests on Home instead of the campaign stage.
- **Mitigation:**
  - Update `installCantinaApiMock` in `cantinaApiMock.ts`: when `options.startInCampaign` is true, keep backward compatibility in the fixture's `addInitScript` by normalizing initial `/` loads to `/campaigns/camp_1` via `window.history.replaceState(null, "", "/campaigns/camp_1")` (while still allowing explicit `page.goto("/")` tests that do not set `startInCampaign` to land on Home).
  - Audit and run all 7 existing Playwright specs (`01`–`07`) plus a new `08-browser-navigation-and-back-stack.spec.ts` covering Workflows 1 & 2, deep-links, streaming guard, dirty-edit guard, and Forward behavior.

### 6. Missing Dirty-State Tracking in Several Editors & Wizards
- **Trap:** Currently only `WorldInspectorModal.tsx` (line 264) maintains an `isDirty` flag. `CharacterInspectorModal`, `PersonaEditorModal`, `NotesModal`, `CharacterWizardModal`, and `WorldWizardModal` do not expose an `isDirty` boolean. Hoisting all form fields up to `AppModals.tsx` would be invasive and error-prone.
- **Mitigation:**
  - Compute a lightweight deterministic dirty flag locally inside each editor/wizard by comparing serialized current state against an initial snapshot captured on mount/open (or `draft !== null` / modified seed inputs for wizards) and pass `{ isDirty }` directly to `useOverlayBackHandler` inside each component.
  - Reset the baseline snapshot whenever `onSaved` keeps the modal open (`closeModal = false` in `CharacterInspectorModal`, `WorldInspectorModal`, `PersonaEditorModal`, or `NotesModal` switching/saving notes).

### 7. Guard Modal Layering, `Escape` Precedence & Internal Sub-Modals
- **Trap:** Several components render secondary confirmation/picker modals inline (e.g., `WorldInspectorModal.tsx` lines 1512 & 1579, `AdminModal.tsx` line 447, `FeedbackModal.tsx` line 20 with `zIndex: 1200`). If `NavigationGuardModal` renders underneath them, or registers itself onto the browser history stack, pressing Back or `Escape` could trap the user or render behind an open modal.
- **Mitigation:**
  - Render `NavigationGuardModal` inside `NavigationHistoryProvider` (or `App.tsx`) at `z-index: 1300` (above `FeedbackModal` and all `.modal-backdrop` layers).
  - Never register `NavigationGuardModal` itself on the overlay history stack; bind `Escape` and backdrop click on `NavigationGuardModal` strictly to **Stay / Cancel**.
  - Register internal sub-modals (such as `WorldInspectorModal`'s inline confirmation dialogs and `AdminModal`'s sub-modal / `FeedbackModal`) as higher-order entries on `useOverlayBackHandler` so Back closes the sub-modal first rather than hitting the parent editor.

### 8. Auth Initialization & Deep-Link Race (`authChecking` / `loadWorkspaceData`)
- **Trap:** On initial load (`App.tsx` lines 428–445), `authChecking` starts `true` while `refreshAuthStatus()` and `loadWorkspaceData()` run asynchronously. If the user lands on `/campaigns/camp_1` while logged out, `AuthScreen` or `InitialSetupScreen` renders first. Naively syncing the URL to `/` because `bundle === null` during `authChecking` or `!currentUser` would erase `/campaigns/camp_1` before login completes.
- **Mitigation:**
  - Keep `window.location.pathname` untouched while `authChecking`, `setupRequired`, or `!currentUser` is active.
  - Read the desired route from `NavigationHistoryContext` inside `loadWorkspaceData()` once authentication succeeds and `campaigns` / `worlds` / `characters` are fetched:
    - If route is `/campaigns/:id`, attempt `loadCampaignBundle(id, wList, cList)`. On failure (404/403/missing), call `replaceRoute({ kind: "home" })` and show a dismissible notice banner.
    - If route is `/`, load Home cleanly (`setBundle(null)`) without reading `ACTIVE_CAMPAIGN_STORAGE_KEY`.
  - Wrap route-sync `popstate` transitions cleanly when `bundle?.campaign.id !== route.campaignId` so browser Back/Forward between `/` and `/campaigns/:id` stays idempotent and ignores stale async responses if the user presses Back again before `api.getCampaignState` resolves (via a monotonically increasing request nonce).
