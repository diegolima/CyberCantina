---
feature: ux-resilience-polish
target_version: 0.47.0
document_type: review
status: completed
last_updated: 2026-11-26
---

# Pre-Implementation Review — UX, Accessibility & Stream Resilience Polish

## Key Architectural Traps & Mitigations

### 1. Phase 5 (`isPhase4Running`) DB Commit Shield vs. Stop Button
- **Trap:** In `backend/app/routers/campaign_routes/turn_streaming.py`, once `turn_saved` is emitted, the turn node is already persisted in SQLite and Phase 5 post-turn clerks run under `await asyncio.shield(worker_task)` to protect SQLite transactions. If the frontend allows aborting the SSE `fetch` during `isPhase4Running`, the backend keeps running to completion while the UI drops `phase5_complete`, leaving the client stuck with provisional CARE state and `phase5_pending: true` telemetry.
- **Mitigation:**
  - Enable the composer **Stop** button **only** while `isStreaming === true` (pre-`turn_saved`, Phases 1–4).
  - Once `turn_saved` arrives and `isPhase4Running === true`, render a disabled **"Finalizing…"** state on the action button rather than Stop.
  - On the backend, remove `asyncio.shield` from Phase 3 `p3_task` (which performs zero SQLite writes) so client disconnect cancels `p3_task` immediately, and catch `asyncio.CancelledError` cleanly in `_sse_generator` (matching `gm_routes.py`), while retaining `await asyncio.shield(worker_task)` on Phase 5.

### 2. Duplicate Turns on Post-`turn_saved` Retry & Non-LLM Error Conflation
- **Trap:** Currently, `useCampaignTurnActions.ts` funnels location overrides, physical state overrides, and party create/disband errors into `streamError`, causing `ChatStage.tsx` to label them `"Ollama / LLM Error:"` with `"Configure Ollama Models"`. Furthermore, offering **Retry** or auto-restoring the draft on a Phase 5 error (after `turn_saved`) would cause the user to re-submit and create a duplicate sibling turn.
- **Mitigation:**
  - Replace the plain `string | null` `streamError` state (or pair it) with a structured error record carrying `kind: "turn_pre_save" | "turn_post_save" | "action"`, `message`, `retryable`, and `failedTurnOpts`.
  - Render **Retry**, **Model Settings**, and draft auto-restore strictly for `turn_pre_save` failures.
  - Render `turn_post_save` and `action` errors with Dismiss only (labeled **"Turn Finalization Error:"** / **"Action Error:"**).

### 3. Draft Restoration Clobbering New User Input
- **Trap:** If a user sends a turn, starts typing a follow-up note in the composer while streaming, and then either clicks Stop or hits a pre-save error, unconditionally overwriting `inputText` / `activeSlash` / `stagedChoices` will destroy what they typed while waiting.
- **Mitigation:**
  - Snapshot the full composer draft (`inputText`, `activeSlash`, `diceMode`, `diceOverride`, `stagedChoices`) alongside `TurnSubmitOptions` at send time.
  - On clean Stop or `turn_pre_save` error, auto-restore the snapshot **only if** the composer is still empty (`!inputText.trim() && activeSlash === null && Object.keys(stagedChoices).length === 0`).

### 4. Stacked Modal Focus Traps Fighting Each Other
- **Trap:** CyberCantina mounts nested modals simultaneously (`ProfileModal` -> `FeedbackModal`, `PersonaEditorModal` -> `NavigationGuardModal`, `WorldInspectorModal` -> `ExportDialog` / `ReimagineModal`, `AdminModal` -> `FeedbackModal`). Independent focus traps listening on `document` will battle over `focus()` in infinite loops, and `Escape` listeners will close both parent and child at once.
- **Mitigation:**
  - Maintain a lightweight module-level stack of open modal dialog IDs inside `useModalDialog.ts`.
  - Only the **topmost** modal in the stack handles `Tab` / `Shift+Tab` focus wrapping, focus-outside containment, and `Escape` dismissal.
  - Restore focus to the stored `previousActiveElement` on unmount only if that element is still connected in `document`.

### 5. Node-Only Vitest SSR Safety & `.dependency-cruiser.cjs` Layer Boundaries
- **Trap:** `frontend/package.json` runs Vitest in a Node-only environment (`ReactDOMServer.renderToStaticMarkup`) without `jsdom`. Any top-level reference to `window` or `document` in `useModalDialog`, `NavigationHistoryContext`, or `ServerUnreachableScreen`, or upward imports from `src/types/` / `src/utils/` into `hooks/` / `components/`, will break unit tests or `npm --prefix frontend run arch:check`.
- **Mitigation:**
  - Keep all `document` / `window` / `HTMLElement` interactions strictly inside `useEffect` and event callbacks.
  - Place any new structured error or modal types in `frontend/src/types/` (re-exported via `src/types/index.ts`), and pure helpers in `frontend/src/utils/`.

### 6. SPA Deep-Link Safety on Workbox `navigateFallback`
- **Trap:** Switching `workbox.navigateFallback` from `"/index.html"` to `"/offline.html"` breaks reloading `/campaigns/:id` even when the user is online, because Workbox serves `navigateFallback` from precache for every matched navigation. Additionally, when nginx is up and FastAPI is down (502/503), `index.html` still loads 200 OK and only `/api/auth/status` fails.
- **Mitigation:**
  - Keep `workbox.navigateFallback: "/index.html"` in `frontend/vite.config.ts`.
  - Handle startup failures in `App.tsx` by distinguishing network/5xx errors from 401 / `{ authenticated: false }`, rendering `ServerUnreachableScreen` (with Retry + `online` event auto-retry) for both offline and backend-down cases.
  - Remove unused `frontend/public/offline.html` and clean up `vite.config.ts` and `nginx.conf` so no dead precache entry remains.

### 7. `PersonaEditorModal` Immediate Media Persistence vs. `isDirty`
- **Trap:** `PersonaMediaTab` uploads and deletes portraits/gallery items immediately against the backend API, yet `PersonaEditorModal.tsx` includes `portraitUrl` and `gallery` inside `currentSnapshot`. Uploading a portrait and then clicking X/backdrop/Back falsely triggers `"Discard unsaved persona changes?"`.
- **Mitigation:**
  - Omit `portraitUrl` and `gallery` from `currentSnapshot` so `isDirty` reflects only unsaved form fields (`name`, `tagline`, `species`, `age`, `sex`, `pronouns`, `personaBio`, `tags`, `buildAndHeight`, `distinctiveFeatures`, `loreEntries`, `equipped`, `inventory`, `stagedUnsupportedDeletes`).

### 8. iOS `16px` Input Sizing on Compact 2-Column Mobile Grids
- **Trap:** Raising `.field-input`, `.form-input`, `.field-input--compact`, and `.tag-chips-inline-input` to `16px` under `@media (max-width: 820px)` can cause horizontal overflow inside narrow 2-column grids (such as `PersonaEditorModal`'s `1fr 1fr` demographics grid) or compact composer controls if `min-width: 0` or padding isn't respected.
- **Mitigation:**
  - Verify `min-width: 0` on grid children and flex inputs, test compact rows in `15-responsive.css` without using `!important`, and pass `npm --prefix frontend run css:audit`.

### 9. `NewCampaignModal` Step 2 Character Selection Double-Toggle
- **Trap:** In `NewCampaignModal.tsx`, each character row `<div onClick={() => handleToggleChar(char.id)}>` contains `<input type="checkbox" onChange={() => {}} />`. Replacing the no-op `onChange` naively without stopping click propagation on the `<input>` causes mouse clicks on the checkbox to fire both `onChange` and the parent `onClick`, immediately toggling twice.
- **Mitigation:**
  - Either use `e.stopPropagation()` on the checkbox `onClick` alongside `onChange={() => handleToggleChar(char.id)}`, or convert the row into a `<button>` / `<label>` with a single unified toggle handler so mouse, touch, and keyboard `Spacebar` all toggle once reliably.
