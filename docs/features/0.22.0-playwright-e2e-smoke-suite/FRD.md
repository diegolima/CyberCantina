---
feature: playwright-e2e-smoke-suite
target_version: 0.22.0
document_type: frd
status: completed
last_updated: 2026-11-20
---

# Feature Requirements Document (FRD)
## Frontend Playwright End-to-End (E2E) Browser Smoke Suite

**Status:** Completed  
**Target Version:** CyberCantina v0.22.0  
**Depends On:** `0.21.1-slash-command-autocomplete`  
**Scope:**
- **Frontend Tooling & Configuration:**
  - [`frontend/package.json`](file:///home/diegolima/Git/cybercantina/frontend/package.json) (`@playwright/test` devDependency + `test:e2e`, `test:e2e:ui` scripts; explicit Vitest exclusion for `e2e/`)
  - [`frontend/vite.config.ts`](file:///home/diegolima/Git/cybercantina/frontend/vite.config.ts) (or `vitest.config.ts` so `vitest run` strictly scopes to `src/**/*.test.{ts,tsx}`)
  - New: `frontend/playwright.config.ts` (headless Chromium config with deterministic `webServer` startup, trace-on-failure, and zero-flake timeouts)
  - New: `frontend/tsconfig.e2e.json` (TypeScript project config covering `playwright.config.ts` and `e2e/**/*.ts` without polluting `tsconfig.json`'s `include: ["src"]` build graph)
- **Shared E2E Fixture & Route Interception Layer:**
  - New: `frontend/e2e/fixtures/cantinaApiMock.ts` (deterministic Playwright `page.route("**/api/**", ...)` harness providing seeded showcase worlds/characters/campaigns, stateful in-memory mutations, and framed SSE turn streams)
- **Playwright Smoke Specs (6 Focused Suites):**
  - New: `frontend/e2e/01-auth-and-home-catalog.spec.ts`
  - New: `frontend/e2e/02-character-and-world-authoring.spec.ts`
  - New: `frontend/e2e/03-spatial-topology-map-editor.spec.ts`
  - New: `frontend/e2e/04-slash-commands-and-mentions.spec.ts`
  - New: `frontend/e2e/05-campaign-turn-sse-and-branches.spec.ts`
  - New: `frontend/e2e/06-responsive-campaign-layout.spec.ts`
- **CI Integration:**
  - [`.github/workflows/ci.yml`](file:///home/diegolima/Git/cybercantina/.github/workflows/ci.yml) (install headless Chromium and run `npm --prefix frontend run test:e2e` inside the `frontend` job before `:alpha` Docker image builds)
- **User-Facing Documentation:**
  - **No wiki changes required** (internal test infrastructure and CI verification only; no end-user UI or workflow change).

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
CyberCantina's current frontend test suite ([`frontend/package.json`](file:///home/diegolima/Git/cybercantina/frontend/package.json#L11)) runs **Vitest in a Node-only environment** without `jsdom` or `@testing-library/react`. All 30 existing frontend test modules rely on pure helper unit tests (`mapGeometry.ts`, `topologyProjection.ts`, `slashCommands.ts`, `partyCommand.ts`) paired with stateless `ReactDOMServer.renderToStaticMarkup(...)` assertions.

While this architecture keeps unit tests ultra-fast (`~1.5s`), it leaves five high-risk browser blind spots untested:

1. **Stateful React Lifecycle & Event Propagation:**
   - `renderToStaticMarkup` only evaluates the initial synchronous render pass. It cannot test `useState` / `useEffect` transitions across user interactions, controlled cursor/selection restoration, `stopPropagation()` / `preventDefault()` guards, or multi-step modal dirty-state tracking.
2. **SVG Map Topology Canvas (`SpatialTopologyView` & `SpatialTopologyCanvas`):**
   - Complex browser interactions—such as screen-space HTML inline distance editors overlaid above zoomed/panned `<svg>` layers, `.select()` on mount, stepper `onMouseDown` focus preservation, hover quick-delete `"X"` hit targets on distance badges, single-snapshot `Ctrl+Z` Undo, and ignoring global `Delete` shortcuts when an `<input>` is focused—cannot be verified in Node.
3. **Composer Keyboard Ergonomics (`ChatComposer`, `SlashCommandPicker`, `CharacterMentionPicker`):**
   - Stage-1 `/` command autocomplete, Stage-2 `/party` subcommand transitions, `@` mention handoff, inline command pills (`[Users] party [kick]`), atomic `Backspace` at caret index `0`, and multi-layer `Escape` dismissal depend on real `<textarea>` `selectionStart`/`selectionEnd` and `keydown` event ordering.
4. **Live SSE Turn Streaming & Incremental DOM Updates (`streamCampaignTurn`):**
   - `ReadableStream` chunk decoding in [`frontend/src/api/stream.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/api/stream.ts), live token accumulation in [`LiveStreamingTurnCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/LiveStreamingTurnCard.tsx), and transition into a persisted [`TurnCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/TurnCard.tsx) with collapsible cognition and arrival cards are never exercised end-to-end in a real browser.
5. **Real Browser WebCrypto, Storage & Viewport Media Queries:**
   - Browser-resident encrypted provider credentials (`window.crypto.subtle` AES-GCM + `localStorage`/`IndexedDB`), `TagChipsInput` delimiter keystrokes, and responsive 3-pane desktop vs. mobile drawer breakpoints require an actual Chromium engine and layout viewport.

### 1.2 Proposed Solution
Introduce a **lean, deterministic 6-spec Playwright E2E smoke suite** (`frontend/e2e/`) running against headless Chromium:

1. **Network-Intercepted API & SSE Harness (`cantinaApiMock.ts`):**
   - Use Playwright's `page.route("**/api/**", ...)` to serve deterministic, stateful mock responses (seeded with *The Green Lie* and *Kira Vance* fixture shapes) and multi-frame `text/event-stream` responses. This eliminates LLM latency/flake and runs the entire 6-spec browser suite in **< 25 seconds**.
2. **6 High-Value Interactive Specs:**
   - Target the exact interactive journeys that `renderToStaticMarkup` cannot cover: (1) Auth, Admin Banners, Catalog & WebCrypto Credential Vault, (2) Character Inspector, `TagChipsInput` & World Codex Authoring, (3) SVG Map Topology Canvas & Inline Editors, (4) Slash Command Autocomplete, Inline Pills & `@Mentions`, (5) Live Campaign SSE Turn Streaming & Branch Switching, and (6) Responsive 3-Pane Campaign Layout & Mobile Drawers.
3. **Zero Interference with Existing Gates:**
   - Keep `frontend/e2e/` cleanly separated from `frontend/src/` so `vitest run`, `npm run arch:check` (`dependency-cruiser`), `tsc && vite build`, and `scripts/generate_arch_docs.py --check` continue operating unchanged.

---

## 2. Scope, Boundaries & Core Invariants

1. **Strict Separation Between Vitest (`src/**/*.test.*`) and Playwright (`e2e/**/*.spec.ts`):**
   - Vitest remains the fast Node-only unit/static-markup runner (`npm test`).
   - Playwright specs live exclusively in `frontend/e2e/**/*.spec.ts` and are invoked via `npm run test:e2e`.
   - `vite.config.ts` must explicitly configure `test.exclude` (or `test.include: ["src/**/*.test.{ts,tsx}"]`) so `vitest run` never attempts to import `@playwright/test`.
2. **Architecture Generator & `dependency-cruiser` Hygiene Invariant:**
   - [`scripts/generate_arch_docs.py`](file:///home/diegolima/Git/cybercantina/scripts/generate_arch_docs.py#L22) and [`frontend/.dependency-cruiser.cjs`](file:///home/diegolima/Git/cybercantina/frontend/.dependency-cruiser.cjs) scan `frontend/src/`. Placing E2E tests in `frontend/e2e/` and `frontend/playwright.config.ts` ensures zero drift in `docs/architecture/FRONTEND_GRAPH.md` or `CROSS_LAYER_MAP.md`.
3. **Deterministic Zero-Flake Execution (No External LLM or Live Network Dependencies):**
   - E2E smoke tests must never make external network requests or require a running Ollama/cloud LLM provider. All `/api/**` calls are intercepted via `cantinaApiMock.ts` with immediate, deterministic payloads and explicit request assertions.
   - Do **not** use arbitrary `page.waitForTimeout(ms)` sleeps; synchronize strictly on Playwright web-first assertions (`expect(locator).toBeVisible()`, `toHaveValue()`, `toHaveAttribute()`) and awaited route responses.
4. **Guardrail Verification Coverage:**
   - The smoke suite must explicitly assert key engineering guardrails from `AGENTS.md` in a real browser:
     - `TagChipsInput` preserves spaces while typing and commits chips on `Enter`, `,`, or `blur` (never erasing spaces on keystroke).
     - `SpatialTopologyCanvas` renders inline distance editors as HTML overlays outside SVG `<foreignObject>`, supports hover `"X"` quick-delete only in editor mode, and ignores global `Delete` keybindings when focus is inside an `<input>` or `<textarea>`.
     - `ChatComposer` commits valid `/commands` into non-rose semantic inline pills, supports atomic `Backspace` at cursor index `0`, and hard-blocks unknown `/commands` with `role="alert"` and a disabled `Send` button.

---

## 3. Functional Requirements

### FR-1: Playwright Runner & TypeScript Configuration (`frontend/`)

1. **`frontend/package.json` Scripts & Dependencies:**
   - Add `"@playwright/test"` to `devDependencies`.
   - Add scripts:
     - `"test:e2e": "playwright test"`
     - `"test:e2e:ui": "playwright test --ui"`
     - `"typecheck:e2e": "tsc -p tsconfig.e2e.json --noEmit"`
2. **`frontend/playwright.config.ts`:**
   - `testDir: "./e2e"`
   - `fullyParallel: true`, `forbidOnly: !!process.env.CI`, `retries: process.env.CI ? 1 : 0`
   - `use`:
     - `baseURL: "http://127.0.0.1:5173"`
     - `trace: "retain-on-failure"`
     - `screenshot: "only-on-failure"`
     - `viewport: { width: 1440, height: 900 }`
   - `projects`: single fast `chromium` project (`devices["Desktop Chrome"]`).
   - `webServer`:
     - `command: "npm run dev -- --host 127.0.0.1 --port 5173"`
     - `url: "http://127.0.0.1:5173"`
     - `reuseExistingServer: !process.env.CI`
     - `timeout: 30_000`
3. **`frontend/vite.config.ts` Vitest Scope Guard:**
   - Add `test: { include: ["src/**/*.test.{ts,tsx}"] }` so `npm test` (`vitest run`) only executes unit/component tests inside `src/` and ignores `e2e/`.
4. **`frontend/tsconfig.e2e.json`:**
   - Extends `./tsconfig.json` with `"include": ["playwright.config.ts", "e2e/**/*.ts"]` so E2E specs and fixtures remain strictly type-checked without affecting `vite build`.

---

### FR-2: Shared Stateful API & SSE Interception Harness (`frontend/e2e/fixtures/cantinaApiMock.ts`)

Create a reusable fixture helper `installCantinaApiMock(page, options?)` that intercepts `**/api/**` and maintains per-test in-memory state:

1. **Seeded Baseline State:**
   - Pre-populates a realistic multi-location world (*The Green Lie* subset: `Main Floor` inside container `The Neon Rust` -> `Sector 9: The Drain`, connected to `Ripperdoc Clinic` and `Cooling Tunnels`, plus public and secret lore nodes), two characters (*Kira Vance* and *Yulia Halim* with portraits, inventory items, and CARE state), one persona, and an active campaign bundle (`CampaignStateBundle`) with 2 historical turns.
2. **Configurable Auth & Admin Modes:**
   - Supports booting into:
     - `authMode: "authenticated"` (default: `/api/auth/status` + `/api/auth/me` return an authenticated user/admin right away so non-auth specs skip login boilerplate).
     - `authMode: "login_required"` (`/api/auth/status` returns `authenticated: false`, allowing Spec 1 to test login, setup, and login-screen admin announcements).
3. **Stateful Mutation Handlers:**
   - Records and applies mutations in memory during a test for:
     - `POST /api/auth/login` & `POST /api/auth/setup`
     - `PUT /api/characters/{id}` & `PUT /api/worlds/{id}` (supporting dirty-state clear and persisted re-reads)
     - `POST /api/campaigns` & `GET /api/campaigns/{id}/state`
     - `POST /api/campaigns/{id}/turns/stream` (delivers deterministic SSE frames: `phase1_complete`, `cognition_delta`, `cognition_complete`, `prose_delta`, `turn_saved`, `phase4_complete`)
     - `POST /api/campaigns/{id}/branches/checkout` & `DELETE /api/campaigns/{id}/turns/{turnId}`
   - Exposes `mock.requests` so tests can assert exact outbound payloads (e.g., submitted `TurnSubmitOptions`, `PartyActionSpec`, or updated world topology edges).

---

### FR-3: The 6 Playwright E2E Smoke Specifications (`frontend/e2e/`)

#### Spec 1: `01-auth-and-home-catalog.spec.ts` — Auth Gate, Admin Banners, Home Catalog & Browser Credential Vault
1. **Login Gate & Admin Announcements:**
   - Boot with `authMode: "login_required"` and a login-scoped `PublicAdminMessage`.
   - Verify [`AuthScreen.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AuthScreen.tsx) renders the announcement banner, password visibility toggle ([`PasswordField.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/PasswordField.tsx)), and validation state.
   - Submit credentials (`POST /api/auth/login`) and verify transition to [`HomeScreen.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/HomeScreen.tsx) with home-scoped admin banner dismissal persisted in `localStorage`.
2. **Home Catalog Filtering & Campaign Launch Modal:**
   - Search and filter Worlds and Characters on `HomeScreen`.
   - Open [`NewCampaignModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/NewCampaignModal.tsx), toggle `start_focus` (`World` vs. `Character`), and verify campaign creation navigates into the active campaign shell.
3. **Real Browser WebCrypto Credential Vault:**
   - Open Profile / Provider settings, store a browser-local provider API key using the real Chromium `window.crypto.subtle` vault, reload the page, and verify the key status remains present and unlocked/persistent without leaking plaintext in network calls.

#### Spec 2: `02-character-and-world-authoring.spec.ts` — Character Inspector, `TagChipsInput` & World Codex Authoring
1. **`CharacterInspectorModal` & `TagChipsInput` Guardrail:**
   - Open [`CharacterInspectorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/character/CharacterInspectorModal.tsx) from `HomeScreen`.
   - Navigate across tabs (`Base`, `Personality`, `Inventory`, `Memories`).
   - In a [`TagChipsInput.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/TagChipsInput.tsx) field, type a multi-word tag containing spaces (e.g., `"cybernetic arm"`): assert the space is **not** stripped while typing, press `Enter` (or `,`) to commit the chip, and press `Backspace` on an empty draft to remove a chip.
   - Click `+ Add` on inventory/memory items, verifying sticky header behavior and that newly appended entries scroll into view.
   - Save changes (`PUT /api/characters/{id}`) and verify the modal updates cleanly.
2. **`WorldInspectorModal` & `WorldCodexTab`:**
   - Open [`WorldInspectorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldInspectorModal.tsx) -> [`WorldCodexTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldCodexTab.tsx).
   - Filter lore nodes, add a new lore entry with secret gating, edit location details in [`CodexLocationDetail.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/CodexLocationDetail.tsx), and save (`PUT /api/worlds/{id}`).

#### Spec 3: `03-spatial-topology-map-editor.spec.ts` — Interactive SVG Map Topology Canvas (`SpatialTopologyView`)
1. **Canvas Node Selection & Details Drawer:**
   - Open [`WorldInspectorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldInspectorModal.tsx) on the **Map Topology** tab ([`SpatialTopologyView.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/SpatialTopologyView.tsx)).
   - Click a location node on [`SpatialTopologyCanvas.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/SpatialTopologyCanvas.tsx) and verify [`MapDetailsDrawer.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDetailsDrawer.tsx) opens with location properties and `MagicWandButton` (scoped to Level 0 Location / Level 1 Container only).
2. **Screen-Space Inline Distance Editor Overlay:**
   - Click an edge distance badge (`"5m"`) on the SVG canvas.
   - Verify the screen-space HTML inline editor overlay mounts outside SVG `<foreignObject>`, focuses its `<input>`, steps value via increment/decrement stepper buttons (`onMouseDown` preserves focus without dismissing the editor), and commits the updated distance (`"12m"`) on `Enter`.
3. **Focus Guard on Global `Delete` Shortcut:**
   - While focus is inside a drawer `<input>` or inline editor, press `Delete` / `Backspace` and assert the selected canvas location/container is **not** deleted.
4. **Hover `"X"` Quick-Delete, Block Notice & Single-Snapshot Undo (`Ctrl+Z`):**
   - Hover an edge distance badge in `mode === "editor"`, click its top-right `"X"` quick-delete control, and verify the edge is removed immediately without a confirmation modal.
   - Press `Ctrl+Z` (or click Undo in [`TopologyHeaderToolbar.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/TopologyHeaderToolbar.tsx)) and verify the deleted edge is restored in a single Undo snapshot.
   - Attempt to delete a protected starting hub or non-empty container when blocked and verify `statusNotice` surfaces the block reason.

#### Spec 4: `04-slash-commands-and-mentions.spec.ts` — Composer Slash Command Autocomplete, Inline Pills & `@Mention` Handoff
1. **Stage-1 `/` Autocomplete & Line-1 Anchor Invariant:**
   - In an active campaign ([`ChatComposer.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/ChatComposer.tsx)), type `/` at index `0`: verify [`SlashCommandPicker.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/SlashCommandPicker.tsx) opens with all 7 canonical commands in alphabetical order (`/choice`, `/event`, `/help`, `/look`, `/narrate`, `/party`, `/wait`).
   - Verify typing `Hello\n/` on line 2 does **not** open `SlashCommandPicker`.
2. **Inline Pill Commit, Stage-2 `/party` Subcommands & `@Mention` Handoff:**
   - Type `/party ` (or select `/party` with `Tab`): verify the leading `/party` converts into the accented inline command pill (`party`) before the `<textarea>`, and Stage-2 subcommand picker opens (`disband`, `invite`, `kick`, `leave`).
   - Select `invite` -> type `@` -> verify `SlashCommandPicker` yields to [`CharacterMentionPicker.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/CharacterMentionPicker.tsx), select `@Yulia Halim`, and verify the mention inserts cleanly into `<textarea>` while the `party [invite]` pill stays intact.
3. **Atomic `Backspace` at Index `0`:**
   - Move caret to index `0` of `<textarea>` (before `@Yulia Halim`). Press `Backspace` once: verify only the `[invite]` subcommand badge is removed while `@Yulia Halim` remains. Press `Backspace` a second time at index `0`: verify the `party` pill is removed while `@Yulia Halim` remains intact.
4. **Hard Block on Unknown `/command` & Ephemeral `/help` Tray:**
   - Type `/halp`: verify the `--accent-rose` error alert (`Unknown command "/halp". Type /help to see available commands.`) appears (`role="alert"`) and the `Send` button is disabled.
   - Run `/help`: verify [`SlashHelpTray.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/SlashHelpTray.tsx) opens above the composer without firing `POST /turns/stream`, and clicking a command row inserts its pill and closes the tray.

#### Spec 5: `05-campaign-turn-sse-and-branches.spec.ts` — Live Campaign SSE Turn Streaming, Cognition, Arrival Cards & Branch Swipes
1. **Live SSE Turn Stream Lifecycle:**
   - Type an in-character action in `ChatComposer` and press `Enter`.
   - Verify `POST /api/campaigns/{id}/turns/stream` is called and [`LiveStreamingTurnCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/LiveStreamingTurnCard.tsx) renders incremental cognition and prose deltas before seamlessly transitioning into a persisted [`TurnCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/TurnCard.tsx).
2. **Cognition Blocks & First-Visit Arrival Cards:**
   - Toggle the collapsible character/narrator cognition drawer on `TurnCard` and verify internal thought/intent fields render.
   - Verify [`ArrivalDescriptionCards.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/ArrivalDescriptionCards.tsx) / [`StandaloneArrivalCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/StandaloneArrivalCard.tsx) displays first-visit location/container arrival prose and media.
3. **Turn Edit / Swipe Branch & Rollback:**
   - Click Edit/Swipe on the latest turn, verify `stashedDraftRef` stashes any current composer draft and restores it on `Cancel`, or switches branch via `POST /api/campaigns/{id}/branches/checkout`.

#### Spec 6: `06-responsive-campaign-layout.spec.ts` — Responsive 3-Pane Campaign Layout & Mobile Drawers
1. **Desktop 3-Pane Shell (`1440×900`):**
   - Verify [`AppSidebar.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/AppSidebar.tsx), center [`ChatStage.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ChatStage.tsx), and right [`LiveInspector.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/LiveInspector.tsx) are simultaneously visible in docked desktop layout.
   - Open [`PartyManagementModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/party/PartyManagementModal.tsx) and [`NotesDrawer.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/NotesDrawer.tsx) flyout and verify keyboard `Escape` dismissal.
2. **Mobile / Narrow Viewport Slide-Over Drawers (`390×844`):**
   - Resize page viewport to `390×844` (`page.setViewportSize({ width: 390, height: 844 })`).
   - Verify sidebars collapse out of the main flow so `ChatStage` occupies full width without horizontal overflow.
   - Click the mobile navigation and inspector header toggles to open the left sidebar drawer and right live inspector drawer, and verify backdrop click / `Escape` closes each drawer cleanly.

---

### FR-4: Continuous Integration Gate ([`.github/workflows/ci.yml`](file:///home/diegolima/Git/cybercantina/.github/workflows/ci.yml))

Update the `frontend` job in [`.github/workflows/ci.yml`](file:///home/diegolima/Git/cybercantina/.github/workflows/ci.yml#L39-L54):
1. After `npm ci` and `npm --prefix frontend run arch:check && npm --prefix frontend run build && npm --prefix frontend test`:
   - Install headless Chromium with system dependencies:
     `npx --prefix frontend playwright install --with-deps chromium`
   - Type-check and execute the Playwright smoke suite:
     `npm --prefix frontend run typecheck:e2e && npm --prefix frontend run test:e2e`
2. Upload Playwright failure artifacts (`frontend/playwright-report/`, `frontend/test-results/`) via `actions/upload-artifact@v4` with `if: failure()` so any CI browser failure includes full trace and screenshot diagnostics.

---

## 4. Non-Functional Requirements & Guardrails

1. **Execution Speed Budget:**
   - The entire 6-spec Playwright suite (`npm --prefix frontend run test:e2e`) must complete in **< 25 seconds** locally and **< 60 seconds** in GitHub Actions CI (excluding initial Chromium binary download).
2. **Zero Console Error Policy:**
   - `cantinaApiMock.ts` should attach a `page.on("pageerror", ...)` listener failing the test if an uncaught React runtime exception occurs during any of the 6 smoke flows.
3. **Existing Gate Non-Regression:**
   - `npm --prefix frontend run arch:check`
   - `npm --prefix frontend run build`
   - `npm --prefix frontend test`
   - `backend/.venv/bin/python scripts/generate_arch_docs.py --check`
   must all pass with zero modifications to `docs/architecture/` output.

---

## 5. Acceptance Criteria & Verification Matrix

| ID | Criterion | Verification Method |
| :--- | :--- | :--- |
| **AC-1** | Playwright is configured in [`frontend/playwright.config.ts`](file:///home/diegolima/Git/cybercantina/frontend/playwright.config.ts) and [`frontend/tsconfig.e2e.json`](file:///home/diegolima/Git/cybercantina/frontend/tsconfig.e2e.json), while [`frontend/vite.config.ts`](file:///home/diegolima/Git/cybercantina/frontend/vite.config.ts) scopes Vitest strictly to `src/**/*.test.{ts,tsx}`. | `npm --prefix frontend test` + `npm --prefix frontend run typecheck:e2e` |
| **AC-2** | `frontend/e2e/fixtures/cantinaApiMock.ts` intercepts `**/api/**` and `**/turns/stream` deterministically with zero external network or live LLM calls, and asserts zero uncaught `pageerror` exceptions. | Code inspection + offline test execution |
| **AC-3** | All 6 Playwright smoke specs (`01` through `06`) pass in headless Chromium, covering Auth/Vault, Character/World Authoring & `TagChipsInput`, SVG Map Topology Editor & Inline Overlays, Slash Command Autocomplete & Atomic Backspace, Live SSE Turn Streaming & Branches, and Responsive Desktop/Mobile Drawers. | `npm --prefix frontend run test:e2e` |
| **AC-4** | [`.github/workflows/ci.yml`](file:///home/diegolima/Git/cybercantina/.github/workflows/ci.yml) runs `typecheck:e2e` and `test:e2e` in the `frontend` job before `docker` builds and uploads Playwright traces on failure. | Workflow YAML validation |
| **AC-5** | All repository gates (`ruff`, `tach`, `pytest`, `generate_arch_docs.py --check`, `arch:check`, `build`, `test`, `test:e2e`) pass cleanly. | Full CLI verification |
