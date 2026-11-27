---
feature: spatial-distance-consistency
target_version: 0.51.0
document_type: plan
status: completed
last_updated: 2026-11-27
---

# Implementation Plan — Spatial Distance Consistency, Anchors & Overrides

## Step 1: Feature Spec Package
- [x] Create isolated worktree `.worktrees/spatial-distance-consistency` on branch `feat/spatial-distance-consistency`
- [x] Author `FRD.md` (`docs/features/TBD-spatial-distance-consistency/FRD.md`)
- [x] Author `ARCHITECTURE.md` (`docs/features/TBD-spatial-distance-consistency/ARCHITECTURE.md`)
- [x] Author `REVIEW.md` (`docs/features/TBD-spatial-distance-consistency/REVIEW.md`)
- [x] Author `PLAN.md` (`docs/features/TBD-spatial-distance-consistency/PLAN.md`)
- [x] Obtain explicit user approval before writing production code

## Step 2: Database Schema, Migrations & Backend Pydantic Contracts
- [x] Update `backend/app/db/schema.sql`:
  - Add `anchor_location_id TEXT NULL` to `location_nodes`
  - Add `distance_mode TEXT NOT NULL DEFAULT 'flexible' CHECK(distance_mode IN ('flexible', 'locked', 'non_euclidean'))` and `is_vertical INTEGER NOT NULL DEFAULT 0 CHECK(is_vertical IN (0, 1))` to `location_edges`
- [x] Update `backend/app/db/repos/schema_init.py`:
  - Add idempotent `ALTER TABLE` migrations for `location_nodes.anchor_location_id`, `location_edges.distance_mode`, and `location_edges.is_vertical`
  - Keep table-rebuild migration blocks in parity with `schema.sql`
- [x] Update `backend/app/schemas/world.py`:
  - Add `EdgeDistanceMode`, `VALID_EDGE_DISTANCE_MODES`, `normalize_edge_distance_mode`, `normalize_edge_is_vertical`
  - Add `distance_mode` & `is_vertical` to `LocationEdge`, `LocationEdgeDraft`, and `NeighborLocationView` (with legacy coercion in `resolve_legacy_edge_flags`)
  - Add `anchor_location_id: str | None = None` to `LocationNode` and `LocationNodeCommitDraft`
  - Add `validate_spatial_anchors_integrity` helper to sanitize invalid/same-container/self-referential anchors

## Step 3: Backend Repositories, API Routes & `.zcc` Import/Export
- [x] Update `backend/app/db/repos/{worlds,world_locations,campaign_spatial,campaign_map_update}.py`:
  - Hydrate, persist, and CoW-remap `anchor_location_id`, `distance_mode`, and `is_vertical`
  - Support branch-safe `anchor_location_id` overrides in `campaign_spatial_overrides.metadata_override_json`
  - Mirror `distance_mode` & `is_vertical` on reciprocal edges in `update_campaign_edge`
- [x] Update `backend/app/routers/campaign_routes/{schemas_and_gate,spatial_routes}.py`:
  - Accept & forward `distance_mode` and `is_vertical` in `POST /api/campaigns/{id}/edges` and `PATCH /api/campaigns/{id}/edges/{edge_id}`
- [x] Update `backend/app/services/{import_export_service,zcc_campaign_io}.py`:
  - Export/import `anchor_location_id` (remapped via `loc_id_map`) and `distance_mode` / `is_vertical` with backwards-compatible defaults for legacy `.zcc` files

## Step 4: Pure Frontend 2D Spatial Consistency & Reconciliation Solver
- [x] Create `frontend/src/components/map/spatialConsistency.ts`:
  - 8-way compass unit vectors, bidirectional pair reduction, and asymmetry checks
  - Secret-edge visibility filtering for Campaign Player mode
  - Scoped graph projection with L1/child-container footprint collapse and strict outer-scope exclusion (no circular feedback)
  - Recursive LCA outer-scope anchor resolution (physical edge offset, vertical 0-horizontal offset, and reference-only pin)
  - Vertical edge Union-Find contraction
  - Fixed-distance weighted least-squares residual checks + per-edge alternate-path Dijkstra triangle-inequality checks
  - Schur-complement reconciliation solver with dense Cholesky, scale-invariant weights, active-set clamping (max 8 passes), and `compass_conflict` / `overconstrained_locked` classification
- [x] Create unit test suite `frontend/src/components/map/__tests__/spatialConsistency.test.ts`:
  - Exact **The Green Lie** *Sector 9* + *Sewers* scenario (*Sewer Entrance* anchored to *The Sump-Well* via vertical 25m hatch, *Tunnel 1-M* anchored to *The Chop-Cathedral* via N 1000m, resolving *Tunnel 1-L ↔ Tunnel 1-M* `140m → 1500m` and *Tunnel 2-L ↔ Tunnel 2-M* `210m → 1500m`)
  - Locked edge preservation & `overconstrained_locked` detection
  - `non_euclidean` portal exemption (triangle inequality & loop bypass)
  - `is_vertical` zero horizontal offset with gameplay meters preserved
  - Reference-only anchor (no edge), compass conflict detection, asymmetric pair detection, and Campaign Player mode secret-edge hiding

## Step 5: Frontend Types, Projection, Mutations & Auto-Sync
- [x] Update `frontend/src/types/world.ts`: add `EdgeDistanceMode`, `anchor_location_id`, `distance_mode`, `is_vertical`
- [x] Update `frontend/src/components/map/topologyProjection.ts`: propagate new fields through `cloneGraph`, `areGraphSnapshotsEqual`, `ProjectedTopologyEdge`, `ProjectedGhostEdge`
- [x] Update `frontend/src/components/map/useTopologyMutations.ts`:
  - Mirror `distance_mode` and `is_vertical` in `EdgePairPatch`
  - Clear dangling/invalid `anchor_location_id` on node delete, move-to-root, or container drop
  - Implement atomic Undo-backed `applyReconciliationAdjustments` and optional `Auto-Sync Unlocked Links` hook

## Step 6: Frontend Authoring UI & Styles
- [x] Update `frontend/src/components/map/MapLinkInspectorSection.tsx`:
  - Distance Rule segmented control (`Flexible` | `Locked` | `Non-Euclidean`), `Vertical Transition` toggle, and inline discrepancy banner (`Apply Suggested` / `Mark Non-Euclidean`)
- [x] Update `frontend/src/components/map/MapDetailsDrawer.tsx`:
  - External Spatial Anchor picker on containerized Level 0 locations (Connected External Locations + Other External Locations), Clear button, and resolved offset summary
- [x] Create `frontend/src/components/map/MapConsistencyPanel.tsx` and update `TopologyHeaderToolbar.tsx` + `SpatialTopologyView.tsx` + `SpatialTopologyCanvas.tsx` + `MapDialogs.tsx`:
  - Toolbar `Consistency` button with live issue badge, diagnostic panel, `Preview Reconciliation` (canvas badge diffs + Apply/Cancel banner), and `Auto-Sync Unlocked Links` toggle (default OFF)
  - Canvas anchor pin badge, edge mode/vertical/warning badge indicators, and Ghost External Node / Portal context-menu anchor shortcut
- [x] Add modular CSS in `frontend/src/styles/` using `00-tokens.css` variables and zero `!important`

## Step 7: In-App Game Mechanics Codex & Planned Wiki Updates
- [x] Update `frontend/src/components/world/mechanics/mechanicsCatalog.ts` (`spatial-links-travel` / `map-containers` entries) to document Distance Rules (`Flexible`, `Locked`, `Non-Euclidean`), Vertical Transitions, External Spatial Anchors, and Consistency Reconciliation
- [x] Record planned `../cybercantina-wiki` updates (to be applied, reviewed, and committed at merge time):
  - `../cybercantina-wiki/Authoring-Worlds-Characters-and-Personas.md` — External Spatial Anchors, Distance Rules (`Flexible` / `Locked` / `Non-Euclidean`), Vertical Transitions, and Consistency Reconciliation / Auto-Sync
  - `../cybercantina-wiki/Live-Inspector-Map-and-Timeline.md` — Consistency status panel, Preview Reconciliation, anchor pin & link constraint badges in Live Map / GM Mode
  - `../cybercantina-wiki/Importing-and-Exporting.md` — `.zcc` persistence & backwards compatibility for `anchor_location_id`, `distance_mode`, and `is_vertical`

## Step 8: Verification Gates & Architecture Docs
- [x] Add backend pytest coverage for schema migrations, world/campaign persistence, branch overrides, edge mirror updates, anchor validation/cleanup, and `.zcc` round-trip
- [x] Run backend checks: `cd backend && .venv/bin/ruff check app tests && .venv/bin/tach check` and `backend/.venv/bin/pytest backend/tests`
- [x] Run frontend checks: `npm --prefix frontend run arch:check && npm --prefix frontend run css:audit && npm --prefix frontend run build && npm --prefix frontend test`
- [x] Regenerate and verify architecture docs: `backend/.venv/bin/python scripts/generate_arch_docs.py && backend/.venv/bin/python scripts/generate_arch_docs.py --check`
