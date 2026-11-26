---
feature: browser-navigation
target_version: 0.45.0
document_type: frd
status: completed
last_updated: 2026-11-26
---

# Feature Requirements Document — v0.45.0 Browser Navigation & Overlay Back-Stack

## 1. Overview & Motivation

CyberCantina currently manages all screens, campaign views, drawers, and modals strictly inside React component state at a single URL (`/`), persisting the active campaign in `localStorage` (`cybercantina_active_campaign_id` in `frontend/src/App.tsx`). This creates two major navigation UX failures—most acutely on mobile devices using edge-swipe Back gestures, and also observable on desktop:

1. **Workflow 1 (Campaign → Browser Back exits the app):** A user opens Home (`/`), launches a campaign, and presses the browser Back button (or mobile Back gesture) expecting to return to Home. Instead, the browser navigates away from CyberCantina to whatever site was previously open in the tab.
2. **Workflow 2 (Modal / Drawer → Browser Back exits the app):** A user opens Home → taps Characters (`HomeEntityPickerModal`) → taps a character (`CharacterInspectorModal`), or opens a full-screen modal/drawer on mobile, and presses Back to dismiss the sheet. Because full-screen modals on mobile cover the viewport (making tap-outside backdrop dismissal unintuitive), users instinctively swipe Back—and get kicked out of CyberCantina entirely.

Additionally, storing the active campaign ID in `localStorage` causes two tabs to overwrite each other on reload, and silently auto-resuming the last campaign on `/` creates a fresh-tab Back trap where Home is never present in the tab's history stack.

Both `frontend/nginx.conf` (`try_files $uri $uri/ /index.html;`) and `frontend/vite.config.ts` already serve `index.html` for arbitrary client paths, so introducing real campaign URLs requires zero backend or reverse-proxy changes.

---

## 2. Agreed Product Decisions

### 2.1 Hybrid Architecture (Zero-Dependency)
- **Real URL paths for primary durable destinations:**
  - `/` → Home (`HomeScreen`)
  - `/campaigns/:id` → Active Campaign (`ChatStage` + `LiveInspector` + `AppSidebar`)
- **Zero-dependency History API implementation:** Implement routing and overlay coordination directly via the browser History API (`window.history`, `popstate`) using leaf types (`frontend/src/types/navigation.ts`), pure Vitest-testable helpers (`frontend/src/utils/navigationHistory.ts`), and a React provider (`frontend/src/providers/NavigationHistoryContext.tsx`) instead of adding `react-router-dom`.
- **Lighter history-state LIFO stack for ephemeral overlays:** Modals, Home entity pickers, confirmations, and mobile/tablet overlay drawers are tracked as depth layers in `history.state` across **all viewports** (`desktop`, `tablet`, and `mobile`) without cluttering the URL bar. Overlays register via an optional-context-safe `useOverlayBackHandler` hook so child-owned modals need no prop drilling through `App.tsx`.

### 2.2 Route Behavior, Deep-Linking & Removal of Silent Auto-Resume
- **No silent auto-resume on `/`:** Opening `/` in a new tab or bookmark always lands on Home (`HomeScreen`), eliminating `localStorage` multi-tab collisions and ensuring Home is naturally in the history stack before launching a campaign.
- **Direct reload & deep-linking on `/campaigns/:id`:** Refreshing `/campaigns/:id` or opening `/campaigns/:id` directly loads that campaign immediately, enabling independent multi-tab campaigns.
- **Unauthenticated deep-links:** Visiting `/campaigns/:id` while logged out preserves `/campaigns/:id` in the address bar across `AuthScreen` and `InitialSetupScreen`, loading the target campaign automatically once authentication succeeds and workspace catalogs finish loading.
- **Invalid, deleted, or inaccessible campaign IDs:** If `/campaigns/:id` fails to load (e.g., 404/403 or deleted campaign), fall back to `/` via `history.replaceState` and display a subtle non-blocking notice on Home.
- **Session & deletion resets:** Logging out, deleting the current user account, or deleting the currently open campaign clears active campaign state and resets the URL to `/` via `replaceState`.
- **In-app "Close Campaign":** Clicking Close Campaign in `AppSidebar` navigates to `/` via `pushState` (safe even when the tab started directly on `/campaigns/:id`, and allows Browser Forward to return to the campaign).

### 2.3 Active Streaming Guard on Campaign Exit
- **Guard during `isStreaming === true`:** Pressing browser Back from `/campaigns/:id` while an LLM turn is actively streaming re-pushes `/campaigns/:id` and opens `NavigationGuardModal` asking the user to stay or leave the campaign.
- **Background Phase 4 Clerk (`isPhase4Running === true`, `isStreaming === false`):** Allows Back to Home silently without blocking, matching the existing in-app "Close Campaign" behavior.

### 2.4 Centralized Overlay Back-Stack & Complete Surface Inventory
All interactive overlay layers register in a single centralized LIFO stack (ordered bottom-to-top) and unwind one layer per Back press across all viewports:

1. **Overlay drawers & flyouts:**
   - `AppSidebar` mobile/tablet overlay drawer (`layout.activeOverlayDrawer === "left"`)
   - `LiveInspector` mobile/tablet overlay drawer (`layout.activeOverlayDrawer === "right"`)
   - `NotesFlyout` (`App.tsx`)
   - `GmTalkDrawer` (`ChatStage.tsx`)
2. **Dismissible modals & pickers:**
   - `HomeEntityPickerModal` (`HomeScreen.tsx`)
   - `ExportBundleModal`, `ImportPreviewModal` (`HomeScreen.tsx`)
   - `NewCampaignModal`, `ProfileModal`, `AdminModal`, `DeleteConfirmationModal` (`AppModals.tsx`)
   - `StoryModal`, `PartyManagementModal`, `ExportCampaignModal` (`App.tsx`)
   - `ContextHealthModal`, `AgentChangesModal` (`ChatStage.tsx`)
   - `LiveInspector` fullscreen map modal (`LiveInspector.tsx`)
   - `LoreIndexModal` (`LoreIndexModal.tsx`)
   - `ImageLightboxModal` (`ImageLightboxModal.tsx`)
   - `FeedbackModal` (`FeedbackModal.tsx` / `AdminModal.tsx`)
3. **Dirty-aware editors & active wizards:**
   - `CharacterInspectorModal` (`CharacterInspectorModal.tsx`)
   - `WorldInspectorModal` — catalog, campaign, and wizard modes (`WorldInspectorModal.tsx`)
   - `PersonaEditorModal` (`PersonaEditorModal.tsx`)
   - `NotesModal` (`NotesDrawer.tsx`)
   - `CharacterWizardModal` (`WizardModals.tsx`)
   - `WorldWizardModal` (`WorldWizardModal.tsx`)

**Stack & transition rules:**
- **Stacked overlays:** Unwind strictly LIFO one layer per Back press (e.g., `HomeEntityPickerModal` → `DeleteConfirmationModal`; `NewCampaignModal` → `PersonaEditorModal`; `LiveInspector` drawer → fullscreen map or `ImageLightboxModal`; `CharacterInspectorModal` → `ImageLightboxModal`).
- **Swapped overlays in one commit:** When one overlay closes and another opens synchronously in the same action (e.g., `HomeEntityPickerModal` → `CharacterInspectorModal`, `StoryModal` → `WorldInspectorModal` Codex via `handleOpenMechanicsGuide`, `NotesFlyout` → `NotesModal`, or `HomeEntityPickerModal` → `+ New`), keep the same `overlayDepth` via `replaceState` rather than firing `back()` + `pushState()`.
- **Modal-to-route launches:** Launching a campaign from `NewCampaignModal` or `CharacterWizardModal` (`launchCampaignImmediately`) transitions via `replaceState` directly to `/campaigns/:id` with `overlayDepth: 0`, so pressing Back from the newly launched campaign returns cleanly to `/`.

### 2.5 Dirty-State & Wizard Discard Guard
- **Clean overlays close immediately:** Untouched editors (`isDirty === false`), read-only inspectors, and untouched wizard seed screens close immediately on Back.
- **Dirty editors & active wizards prompt before discarding:** If an editor (`CharacterInspectorModal`, `WorldInspectorModal`, `PersonaEditorModal`, `NotesModal`) has unsaved changes, or a wizard (`CharacterWizardModal`, `WorldWizardModal`) has a generated/edited draft or modified seed fields, Back re-pushes the interrupted overlay history entry and opens `NavigationGuardModal` (*"Discard unsaved changes?"* — **Stay** / **Discard**). Confirming **Discard** closes the overlay cleanly and unwinds its history entry.

### 2.6 Forward-Button Hygiene
- Every history state written by CyberCantina uses a structured envelope:
  `{ __ccNav: 1, sessionId, route, overlayDepth, overlayId }`.
- **Real routes work with Forward:** Pressing Back from `/campaigns/:id` to `/` and then pressing Forward returns to `/campaigns/:id` and loads that campaign.
- **Closed overlays never resurrect on Forward:** When an overlay is closed via `X`, `Escape`, backdrop click, Save, or Back, its history entry is popped or superseded. Any stale Forward entry carrying an `overlayDepth > 0` (either from a prior page session or without a matching active overlay in memory) is normalized immediately via `replaceState` to `overlayDepth: 0` on its `route` and never re-opens modals or confirmation dialogs.

---

## 3. Out of Scope

- Adding URL path routes for Home catalog pickers or entity sheets (`/characters`, `/characters/:id`, `/worlds/:id`, `/personas/:id`).
- Introducing third-party router packages (`react-router-dom`, `wouter`, etc.).
- Subpath reverse-proxy base-URL configuration (e.g., hosting CyberCantina under `/cantina/`).
- Persisting unsaved modal/wizard form drafts across full page reloads.

---

## 4. Core Invariants & Acceptance Criteria

1. **Workflow 1 fixed:** Opening `/` → launching any campaign changes URL to `/campaigns/:id` → pressing browser Back returns to `/` (Home) without leaving CyberCantina → pressing Forward re-opens `/campaigns/:id`.
2. **Workflow 2 fixed (all viewports):** Opening Home → Characters (`HomeEntityPickerModal`) → selecting a character (`CharacterInspectorModal`) → pressing Back closes `CharacterInspectorModal` and returns to Home (or unwinds stacked layers LIFO when nested, such as `HomeEntityPickerModal` → `DeleteConfirmationModal` or `LiveInspector` mobile drawer → `ImageLightboxModal`).
3. **Multi-tab & reload isolation:** Tab A at `/campaigns/camp_a` and Tab B at `/campaigns/camp_b` reload independently into their respective campaigns; Tab C at `/` stays on Home.
4. **Auth deep-link preservation:** Visiting `/campaigns/:id` while signed out keeps `/campaigns/:id` across login/setup and loads the campaign immediately after authentication.
5. **Invalid route fallback:** Navigating to `/campaigns/nonexistent` falls back to `/` via `replaceState` and shows a dismissible notice.
6. **Streaming & dirty-edit protection:** Pressing Back while `isStreaming` is true or while an editor/wizard is dirty prompts via `NavigationGuardModal` instead of silently losing stream context or unsaved edits; clean modals and background `isPhase4Running` exit silently.
7. **Forward hygiene:** Closing `DeleteConfirmationModal`, `CharacterWizardModal`, or any modal via `X`/`Escape`/backdrop/Back and then pressing Forward never re-opens dead overlays.
8. **SSR Vitest compatibility:** All existing `ReactDOMServer.renderToStaticMarkup` unit tests continue passing with zero provider wrappers required (`useOverlayBackHandler` is optional-context-safe).
