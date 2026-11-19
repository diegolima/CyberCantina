---
feature: playwright-e2e-smoke-suite
target_version: 0.22.0
document_type: review
status: approved
last_updated: 2026-11-20
---

# Pre-Implementation Architectural Review
## Frontend Playwright End-to-End (E2E) Browser Smoke Suite (`v0.22.0`)

## 1. Architectural Traps & Mitigations

### Trap 1: Vitest & Playwright Runner Collision
- **Risk**: By default, `vitest run` searches for `**/*.{test,spec}.?(c|m)[jt]s?(x)`. If Playwright files in `frontend/e2e/*.spec.ts` are discovered by Vitest, `npm test` fails immediately with `Playwright Test needs to be invoked via 'npx playwright test'`.
- **Mitigation**: Explicitly configure `test.include: ["src/**/*.test.{ts,tsx}"]` and `test.exclude: ["e2e/**", "node_modules/**", "dist/**"]` in [`frontend/vite.config.ts`](file:///home/diegolima/Git/cybercantina/frontend/vite.config.ts).

### Trap 2: Architecture Docs Generator & `dependency-cruiser` Drift
- **Risk**: [`scripts/generate_arch_docs.py`](file:///home/diegolima/Git/cybercantina/scripts/generate_arch_docs.py) and [`frontend/.dependency-cruiser.cjs`](file:///home/diegolima/Git/cybercantina/frontend/.dependency-cruiser.cjs) inspect `frontend/src/`. Placing E2E utilities inside `frontend/src/` would add test-only nodes to `docs/architecture/FRONTEND_GRAPH.md` and `CROSS_LAYER_MAP.md`.
- **Mitigation**: Keep all Playwright specs, fixtures, and config outside `frontend/src/` (`frontend/e2e/` and `frontend/playwright.config.ts`) and type-check them via a dedicated [`frontend/tsconfig.e2e.json`](file:///home/diegolima/Git/cybercantina/frontend/tsconfig.e2e.json) (`npm run typecheck:e2e`).

### Trap 3: Unhandled Background API Calls During App Bootstrap
- **Risk**: When [`App.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/App.tsx) mounts, `refreshAuthStatus()` and `loadWorkspaceData()` fire parallel requests (`/api/auth/status`, `/api/campaigns`, `/api/worlds`, `/api/characters`, `/api/settings`, `/api/notes`, `/api/personas`, `/api/profile/models`, `/api/admin/messages/home`), and `ProvidersProvider` or modals may query `/api/providers` and `/api/prompts`. If any `/api/**` request falls through to Vite's proxy (`localhost:8000`) when no backend is running, Vite logs proxy errors or returns `500`, causing console noise or race conditions.
- **Mitigation**: `installCantinaApiMock(page)` registers a catch-all `page.route("**/api/**", ...)` handler that fulfills every known endpoint from in-memory state and fails loudly on any unexpected unmocked `/api/` path so missing stubs are caught immediately.

### Trap 4: SSE Stream Framing in `streamCampaignTurn`
- **Risk**: [`frontend/src/api/stream.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/api/stream.ts) parses `text/event-stream` frames delimited by `\n\n` with `event: <name>\ndata: <json>`. If `turn_saved` or `phase4_complete` omits required `CampaignStateBundle` fields (`active_branch_turns`, `all_turn_nodes`, `current_world_snapshot`, `character_states`), `useCampaignTurnActions` will throw during state reconciliation.
- **Mitigation**: Build complete, schema-faithful `TurnNodeRecord` and `CampaignStateBundle` objects inside `cantinaApiMock.ts` when responding to `POST /api/campaigns/{id}/turns/stream`, and keep the in-memory campaign bundle synchronized so subsequent `GET /api/campaigns/{id}/state` or branch checkout calls see the newly appended turn.

### Trap 5: SVG Canvas Coordinate & Inline Overlay Interaction
- **Risk**: `SpatialTopologyCanvas` renders nodes inside a transformed `<svg>` and mounts the inline distance editor as an HTML overlay when a distance badge (`g.topology-distance-badge`) is clicked.
- **Mitigation**: Use semantic selectors (`[data-node-id="..."]`, `.topology-distance-badge`, `.topology-inline-distance-editor`, `.topology-badge-delete-btn`) and Playwright's real pointer hover/click actions rather than brittle pixel coordinates.
