---
feature: installable-pwa
target_version: 0.46.0
document_type: review
status: completed
last_updated: 2026-11-26
---

# Pre-Implementation Review — Installable App-Shell PWA

## Key Architectural Traps & Mitigations

### 1. SSE Streaming (`/api/*`) & WebSocket Relay (`/api/local-relay/ws`) Interception
- **Trap:** Workbox's default `navigateFallback` or overly broad runtime caching patterns can intercept `/api/*`, `/docs`, or `/openapi.json` requests, break Server-Sent Events (SSE) turn streaming by buffering responses, interfere with `/api/local-relay/ws` WebSocket upgrades, or serve stale auth/media responses.
- **Mitigation:**
  - Configure `navigateFallback: "/index.html"` with `navigateFallbackDenylist: [/^\/api\//, /^\/docs/, /^\/openapi\.json$/]`.
  - Define **zero** Workbox `runtimeCaching` rules for `/api/*` (leave backend calls completely untouched by the Service Worker).
  - Verify in production build / E2E inspection that the generated `sw.js` precaches only static shell assets and excludes `/api/` routes.

### 2. Stale Frontend / Backend Schema Mismatch After Deploy
- **Trap:** In Docker/Nginx deployments (like `cybercantina-alpha`), if Nginx caches `sw.js`, `registerSW.js`, or `index.html` with default headers, returning users can stay pinned to an older precached frontend bundle after the backend API has updated.
- **Mitigation:**
  - Configure explicit `Cache-Control: no-cache` headers in `frontend/nginx.conf` for `/index.html`, `/sw.js`, `/registerSW.js`, `/manifest.webmanifest`, and `/offline.html`.
  - Pair with `registerType: "prompt"` and a visible `PwaUpdateBanner` so users are immediately notified when a new frontend deploy is ready.

### 3. Forced Reloads Mid-Turn or Mid-Edit
- **Trap:** Using `registerType: "autoUpdate"` with `skipWaiting: true` and `clientsClaim: true` causes the browser to reload or swap assets mid-session, aborting an active SSE turn stream or discarding unsaved edits in `CharacterInspectorModal`, `WorldInspectorModal`, `PersonaEditorModal`, or wizards.
- **Mitigation:**
  - Strictly use `registerType: "prompt"` (never auto-skip-waiting).
  - Activate the waiting Service Worker only when the user explicitly clicks **Reload** in `PwaUpdateBanner` (and surface a gentle indicator if `isStreaming` is true so users know a turn is still finishing).

### 4. Nginx `.webmanifest` MIME Type & Missing-Asset SPA Fallback
- **Trap:** `nginx:stable-alpine` default `mime.types` may omit `.webmanifest` (serving it as `application/octet-stream`, which fails or warns on Chromium installability audits), and the catch-all `location / { try_files $uri $uri/ /index.html; }` can accidentally serve `index.html` for a missing `sw.js` during edge cases.
- **Mitigation:**
  - Add an explicit exact-match block `location = /manifest.webmanifest` with `default_type application/manifest+json;` and `add_header Cache-Control "no-cache";`.
  - Add explicit blocks for `sw.js`, `registerSW.js`, `offline.html`, and `index.html` with `Cache-Control: no-cache`, and keep `try_files $uri =404;` for SW/manifest assets rather than falling back to `index.html`.

### 5. Self-Hosted Plain HTTP LAN (`http://192.168.x.x`) & Secure Context Guards
- **Trap:** Service Workers and `beforeinstallprompt` only exist in secure contexts (`https://` or `http://localhost`). Self-hosters accessing CyberCantina over plain `http://192.168.x.x` on a home LAN have `navigator.serviceWorker === undefined`; unguarded access throws runtime exceptions.
- **Mitigation:**
  - Guard all Service Worker registration, `matchMedia("(display-mode: standalone)")`, and `beforeinstallprompt` listeners behind `typeof window !== "undefined"` and `"serviceWorker" in navigator` checks inside `src/hooks/usePwaLifecycle.ts` and `src/utils/pwa.ts`.
  - Document the HTTPS requirement (localhost, Tailscale HTTPS, or reverse proxy) clearly in the wiki so plain-HTTP LAN behavior is expected and transparent.

### 6. Frontend Architecture Boundaries (`.dependency-cruiser.cjs`) & Node-Only Vitest SSR
- **Trap:** `frontend/.dependency-cruiser.cjs` forbids `src/utils/` from importing `hooks/`, `providers/`, or virtual Vite runtime modules that pull in browser-only APIs, and `vitest` runs in a Node-only environment (`ReactDOMServer.renderToStaticMarkup`) without `window` or `navigator`. Importing `virtual:pwa-register` directly in utilities or components would break dependency rules or SSR unit tests.
- **Mitigation:**
  - Place leaf types (`PwaUpdateStatus`, `PwaInstallState`, `BeforeInstallPromptEvent`) in `frontend/src/types/pwa.ts`.
  - Place pure, environment-agnostic state helpers (e.g., `isStandaloneDisplayMode`, `shouldShowInstallPrompt`, `formatUpdateBannerCopy`) in `frontend/src/utils/pwa.ts` (importing only `src/types/`).
  - Isolate `virtual:pwa-register` dynamic/effect registration inside `frontend/src/hooks/usePwaLifecycle.ts` with `typeof window !== "undefined"` guards.
  - Keep `PwaUpdateBanner.tsx` in `frontend/src/components/shared/` as a pure presentational component easily tested via `ReactDOMServer.renderToStaticMarkup`.

### 7. Playwright E2E Test Interference
- **Trap:** Existing Playwright specs (`01`–`08`) mock API routes via `page.route(...)` against the Vite dev server or preview server. An active Service Worker in dev mode could intercept or cache responses across test steps.
- **Mitigation:**
  - Keep `devOptions.enabled: false` in `vite-plugin-pwa` so Vite dev mode never registers a Service Worker during standard `01`–`08` E2E runs.
  - Test manifest and Service Worker output specifically against the production `dist/` bundle (and optionally a dedicated Playwright smoke spec or preview check) without affecting existing mocks.

### 8. iOS Safari Standalone Safe-Area & Background Stream Suspension
- **Trap:** With `apple-mobile-web-app-status-bar-style="black-translucent"`, the iOS status bar overlaps the top viewport unless top/bottom/side safe-area insets are respected. Additionally, iOS suspends backgrounded standalone PWAs aggressively, which can interrupt long-running SSE streams when switching apps.
- **Mitigation:**
  - Audit `env(safe-area-inset-top)`, `env(safe-area-inset-bottom)`, `env(safe-area-inset-left)`, and `env(safe-area-inset-right)` in `frontend/src/styles/01-base-and-shell.css` and `frontend/src/styles/15-responsive.css` (header bars, mobile composer, overlay drawers).
  - Ensure existing SSE stream abort/disconnect handling surfaces a clean recoverable error when iOS resumes from background suspension, and document the iOS backgrounding behavior in the wiki.
