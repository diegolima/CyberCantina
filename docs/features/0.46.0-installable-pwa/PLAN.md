---
feature: installable-pwa
target_version: 0.46.0
document_type: plan
status: completed
last_updated: 2026-11-26
---

# Implementation Plan — Installable App-Shell PWA

## Step 1: Feature Spec Package
- [x] Author `FRD.md` (`docs/features/TBD-installable-pwa/FRD.md`)
- [x] Author `REVIEW.md` (`docs/features/TBD-installable-pwa/REVIEW.md`)
- [x] Author `PLAN.md` (`docs/features/TBD-installable-pwa/PLAN.md`)

## Step 2: Brand Icons, Offline Fallback & HTML Meta Tags
- [x] Generate/add CyberCantina PWA icon assets in `frontend/public/icons/`:
  - `favicon.svg`
  - `icon-192.png` (192×192)
  - `icon-512.png` (512×512)
  - `icon-512-maskable.png` (512×512 maskable safe-zone)
  - `apple-touch-icon.png` (180×180)
- [x] Create self-contained dark-themed `frontend/public/offline.html` (*"Cannot reach CyberCantina server"* + Retry button)
- [x] Update `frontend/index.html` with `theme-color` (`#0b0e14`), `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style="black-translucent"`, `apple-mobile-web-app-title`, and icon `<link>` tags

## Step 3: Vite PWA Plugin & Service Worker Configuration
- [x] Add `vite-plugin-pwa` to `frontend/package.json` (`devDependencies`, updating `package-lock.json`)
- [x] Add `vite-plugin-pwa/client` type reference (in `frontend/tsconfig.json` or `frontend/src/vite-env.d.ts`)
- [x] Configure `VitePWA` in `frontend/vite.config.ts`:
  - `registerType: "prompt"`
  - Manifest metadata (`name`, `short_name`, `start_url: "/"`, `scope: "/"`, `display: "standalone"`, `background_color: "#0b0e14"`, `theme_color: "#0b0e14"`, icon entries)
  - Workbox `globPatterns` for static shell assets only (`js`, `css`, `html`, `svg`, `png`, `woff2`)
  - `navigateFallback: "/index.html"` with `navigateFallbackDenylist: [/^\/api\//, /^\/docs/, /^\/openapi\.json$/]`
  - Offline fallback handling for `offline.html` when server navigation fails
  - `devOptions: { enabled: false }`

## Step 4: Nginx Cache & MIME Configuration
- [x] Update `frontend/nginx.conf`:
  - Explicit `location = /manifest.webmanifest` with `default_type application/manifest+json;` and `Cache-Control: no-cache`
  - Explicit `Cache-Control: no-cache` on `/index.html`, `/sw.js`, `/registerSW.js`, and `/offline.html` (avoiding SPA HTML fallback on missing SW/manifest files)
  - Long-lived `Cache-Control: public, max-age=31536000, immutable` on `/assets/`

## Step 5: Leaf Types, Pure Helpers, Lifecycle Hook & UI Surfaces
- [x] Create `frontend/src/types/pwa.ts` (re-export from `frontend/src/types/index.ts`)
- [x] Create `frontend/src/utils/pwa.ts` with pure, Vitest-testable helpers (standalone detection, installability predicates, update banner state helpers)
- [x] Create `frontend/src/hooks/usePwaLifecycle.ts` wrapping `virtual:pwa-register` and `beforeinstallprompt` with SSR and secure-context guards
- [x] Create `frontend/src/components/shared/PwaUpdateBanner.tsx` (dismissible non-intrusive reload prompt respecting `isStreaming`, styled with `--accent-amber` / `--accent-cyan`, never `--accent-rose`)
- [x] Wire `usePwaLifecycle` and `PwaUpdateBanner` in `frontend/src/App.tsx` and surface optional **Install App** action on `HomeScreen.tsx` (shown only when installable and not standalone)
- [x] Add styles in `frontend/src/styles/` (`01-base-and-shell.css`, `02-primitives.css`, `15-responsive.css`) and audit `env(safe-area-inset-*)` padding for standalone mode

## Step 6: Unit Tests (Vitest) & Playwright E2E Verification
- [x] Add `frontend/src/utils/__tests__/pwa.test.ts` testing standalone detection, install prompt visibility predicates, and safe SSR/non-secure fallbacks
- [x] Add `frontend/src/components/__tests__/pwaUpdateBanner.test.tsx` verifying `ReactDOMServer.renderToStaticMarkup` rendering across idle and streaming states
- [x] Verify production build output (`dist/manifest.webmanifest`, `dist/sw.js`, icons, `offline.html`, and absence of `/api/` caching) and add E2E smoke coverage ensuring existing specs (`01`–`08`) remain unaffected

## Step 7: Planned User-Facing Wiki Updates (Deferred to Merge Time)
- [x] Inspect `../cybercantina-wiki/_Sidebar.md` and `../cybercantina-wiki/Home.md`, and apply updates at merge time to:
  - `../cybercantina-wiki/Installation-and-Setup.md` — Document installing CyberCantina as a desktop/mobile PWA, HTTPS requirement (`localhost`, Tailscale HTTPS, reverse proxy), and graceful fallback on plain HTTP LAN URLs
  - `../cybercantina-wiki/First-Campaign-and-Interface-Tour.md` — Document standalone window mode, offline server-unreachable screen, and the non-intrusive in-app update reload banner

## Step 8: Architecture Docs, Spec Finalization & Full Verification
- [x] Bootstrap worktree dependencies (`uv sync` / `npm ci` or `scripts/worktree.sh` if not yet bootstrapped) before running checks
- [x] Regenerate and verify architecture docs:
  `backend/.venv/bin/python scripts/generate_arch_docs.py && backend/.venv/bin/python scripts/generate_arch_docs.py --check`
- [x] Mark `FRD.md`, `REVIEW.md`, and `PLAN.md` `status: completed` with all boxes checked upon completion
- [x] Run full verification gates:
  - Backend: `cd backend && .venv/bin/ruff check app tests && .venv/bin/tach check` and `backend/.venv/bin/pytest backend/tests`
  - Frontend: `npm --prefix frontend run arch:check && npm --prefix frontend run css:audit && npm --prefix frontend run build && npm --prefix frontend test`
  - E2E: `npm --prefix frontend run typecheck:e2e && npm --prefix frontend run test:e2e`
