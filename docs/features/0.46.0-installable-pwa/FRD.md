---
feature: installable-pwa
target_version: 0.46.0
document_type: frd
status: completed
last_updated: 2026-11-26
---

# Feature Requirements Document — Installable App-Shell PWA

## 1. Overview & Motivation

CyberCantina already ships key mobile and responsive foundations:
- `viewport-fit=cover` in `frontend/index.html`
- Three-tier responsive layouts (`620px` compact phone, `820px` mobile, `1100px` tablet) with collapsible rails and overlay drawers in `frontend/src/styles/15-responsive.css`
- Real campaign URLs (`/`, `/campaigns/:id`) and a LIFO overlay back-stack (`v0.45.0`) so browser and mobile edge-swipe Back gestures work naturally inside the app

However, CyberCantina currently lacks a Web App Manifest, brand icon set, offline fallback page, and Service Worker. As a result, users cannot install CyberCantina as a standalone desktop window or mobile home-screen app, repeat shell loads do not benefit from static bundle precaching, and unreachable self-hosted servers show the generic browser error page instead of a branded retry screen.

Because CyberCantina's campaigns, CARE affective state, RAG memory, character media, and even browser-local `@mlc-ai/web-llm` inference (relayed through `/api/local-relay/ws`) depend on the FastAPI backend, this feature intentionally scopes CyberCantina as a **lightweight installable app-shell PWA** rather than an offline-first application.

---

## 2. Agreed Product Decisions

### 2.1 App-Shell Manifest & Brand Icons
- **Web App Manifest (`manifest.webmanifest`):**
  - `name`: `"CyberCantina — Agentic AI Roleplay Studio"`
  - `short_name`: `"CyberCantina"`
  - `start_url`: `"/"`
  - `scope`: `"/"`
  - `display`: `"standalone"`
  - `background_color`: `"#0b0e14"` (matches `--bg-deep` in `frontend/src/styles/00-tokens.css`)
  - `theme_color`: `"#0b0e14"`
- **Brand Icon Set (`frontend/public/icons/`):**
  - `favicon.svg` (scalable SVG icon)
  - `icon-192.png` (192×192 standard app icon)
  - `icon-512.png` (512×512 standard app icon)
  - `icon-512-maskable.png` (512×512 maskable icon with safe-zone padding)
  - `apple-touch-icon.png` (180×180 iOS home-screen icon)
- **HTML `<head>` Meta Tags (`frontend/index.html`):**
  - `<meta name="theme-color" content="#0b0e14" />`
  - `<meta name="apple-mobile-web-app-capable" content="yes" />`
  - `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />`
  - `<meta name="apple-mobile-web-app-title" content="CyberCantina" />`
  - Icon `<link>` tags for SVG favicon and `apple-touch-icon`.

### 2.2 Static-Shell-Only Service Worker (`vite-plugin-pwa`)
- **Build integration:** Use `vite-plugin-pwa` configured in `frontend/vite.config.ts` with `registerType: "prompt"`.
- **Static shell precaching only:** Precache only Vite-built static app-shell assets (`js`, `css`, `svg`, `png`, `woff2`, `index.html`, `offline.html`).
- **Strict `/api/*` & backend doc bypass:**
  - Exclude `/api/`, `/docs`, and `/openapi.json` from Workbox navigation fallback (`navigateFallbackDenylist: [/^\/api\//, /^\/docs/, /^\/openapi\.json$/]`).
  - Do not register any runtime caching rules on `/api/*` (`NetworkOnly` / bypassed) so SSE turn streaming (`/api/`), the browser-local inference WebSocket relay (`/api/local-relay/ws`), auth session cookies, and mutable character media are never cached or buffered by the Service Worker.
- **Dev mode safety:** Keep `devOptions.enabled: false` so `vite dev` and Playwright E2E dev runs are unaffected by an active Service Worker.

### 2.3 Offline Server-Unreachable Fallback Page
- Provide a self-contained, dark-themed `frontend/public/offline.html` precached with the app shell.
- When the user navigates while the self-hosted CyberCantina backend or network is unreachable, display *"Cannot reach CyberCantina server"* with a clear **Retry** button (`window.location.reload()`) instead of a generic browser offline error page.

### 2.4 Non-Intrusive Update Prompt (`registerType: "prompt"`)
- **Zero forced mid-turn or mid-edit reloads:** Never call `skipWaiting()` automatically on deployment.
- Render a dismissible update banner (`frontend/src/components/shared/PwaUpdateBanner.tsx`, styled with `--accent-amber` / `--accent-cyan`, never `--accent-rose`) when an updated Service Worker is waiting.
- Let the user click **Reload** when ready; when `isStreaming` is active, show a subtle cue or defer prompting/emphasize waiting until the turn finishes so an active stream or unsaved edit is never interrupted.

### 2.5 Optional Install Affordance
- Add leaf types (`frontend/src/types/pwa.ts`), pure helper predicates (`frontend/src/utils/pwa.ts`), and a lifecycle hook (`frontend/src/hooks/usePwaLifecycle.ts`) that captures `beforeinstallprompt` and detects `display-mode: standalone`.
- Surface an unobtrusive **Install App** action (e.g., on `HomeScreen` / profile menu) only when the browser reports the app is installable and not already running in standalone mode.
- Degrade as a silent no-op on unsupported browsers (e.g., Firefox desktop, Safari without `beforeinstallprompt`), already-installed standalone windows, and non-secure plain-HTTP LAN origins.

### 2.6 Nginx Cache & MIME Hygiene (`frontend/nginx.conf`)
- Serve `index.html`, `sw.js`, `registerSW.js`, `manifest.webmanifest`, and `offline.html` with `Cache-Control: no-cache` so browsers always revalidate the app shell and Service Worker manifest against newly deployed containers.
- Serve Vite content-hashed `/assets/*` with long-lived `Cache-Control: public, max-age=31536000, immutable`.
- Serve `/manifest.webmanifest` with explicit `default_type application/manifest+json;` so Nginx does not fall back to `application/octet-stream`.

### 2.7 Standalone Safe-Area Audit
- Audit `env(safe-area-inset-top)`, `env(safe-area-inset-bottom)`, `env(safe-area-inset-left)`, and `env(safe-area-inset-right)` in `frontend/src/styles/01-base-and-shell.css` and `frontend/src/styles/15-responsive.css` to ensure notched/home-indicator devices render cleanly in `display: standalone` with `black-translucent` status bar styling.

---

## 3. Out of Scope

- Offline campaign gameplay, IndexedDB caching of turns, characters, worlds, or media assets.
- Web Push notifications or Background Sync queues.
- OS-level `.zcc` `file_handlers` manifest registration (candidate for a future follow-up).
- Native mobile app wrappers (Capacitor, Cordova, Electron) or automated TLS/HTTPS certificate provisioning for self-hosted Docker setups.

---

## 4. Core Invariants & Acceptance Criteria

1. **Valid Manifest & Icons:** Production builds emit `manifest.webmanifest` and all required PNG/SVG icons (`192`, `512`, `512-maskable`, `apple-touch-icon`, `favicon.svg`) with matching `#0b0e14` theme/background colors.
2. **Strict Backend & Stream Isolation:** `/api/*` (including SSE streams, `/api/local-relay/ws`, auth endpoints, and character media), `/docs`, and `/openapi.json` are strictly excluded from Service Worker caching and `navigateFallback`.
3. **Safe Update Lifecycle:** `registerType: "prompt"` is enforced; deploying a new build surfaces `PwaUpdateBanner` without interrupting an active LLM stream or dirty editor state.
4. **Nginx Header Compliance:** `frontend/nginx.conf` returns `Cache-Control: no-cache` for `index.html`, `sw.js`, `registerSW.js`, `manifest.webmanifest`, and `offline.html`, `application/manifest+json` for `manifest.webmanifest`, and `immutable` caching for `/assets/*`.
5. **Graceful Plain-HTTP Degradation:** Visiting CyberCantina over plain `http://<lan-ip>` or in an environment without `navigator.serviceWorker` produces zero runtime errors and hides unsupported install controls cleanly.
6. **Architecture & Verification Compliance:** Pure helpers and components respect `frontend/.dependency-cruiser.cjs` layer rules (`npm --prefix frontend run arch:check`), `css:audit`, `build`, Node-only Vitest SSR tests, and Playwright E2E checks pass.
