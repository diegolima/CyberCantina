---
feature: metric-spatial-distances
target_version: 0.36.0
document_type: plan
status: completed
last_updated: 2026-11-24
---

# Implementation Plan — v0.36.0 Metric Spatial Edge Distances

## Stage 0: Feature Package Lifecycle Artifacts
- [x] Author `FRD.md`
- [x] Author `REVIEW.md`
- [x] Author `PLAN.md`

## Stage 1: Backend Schema, DB Migration & Showcase Seed
- [x] Add `WALKING_METERS_PER_MINUTE = 70`, `MAX_EDGE_DISTANCE_METERS = 100_000_000`, context defaults (`20` interior / `100` exterior / `50` fallback), `derive_walking_minutes`, `format_distance_meters`, and `format_walking_duration` in `backend/app/schemas/world.py`
- [x] Replace `travel_minutes` with `distance_meters` (plus `@model_validator(mode="before")` legacy `travel_minutes * 70` coercion) in `LocationEdgeDraft`, `LocationEdge`, `NeighborLocationView` (`backend/app/schemas/world.py`), and `ImprovisedLocationSpec` (`backend/app/schemas/turn.py`)
- [x] Update `location_edges` DDL in `backend/app/db/schema.sql` and add idempotent table-rebuild migration (`travel_minutes * 70` -> `distance_meters`) in `backend/app/db/repos/schema_init.py`
- [x] Convert `backend/app/db/showcase_data/the_green_lie/world.json` edges to `distance_meters` (`* 70`) while preserving `SHOWCASE_SEED_VERSION = 2` in `backend/app/db/seed.py` (with `travel_minutes * 70` import fallback)
- [x] Update SQL & model mapping in `backend/app/db/repos/{worlds.py,world_locations.py,campaign_spatial.py,campaign_map_update.py}` (removing `240` cap, applying context-aware defaults)
- [x] Update `.zcc` / archive export & import in `backend/app/services/{import_export_service.py,zcc_campaign_io.py}` to emit `distance_meters` and accept legacy `travel_minutes * 70`

## Stage 2: Backend API Routes, Prompts & Simulation Engine
- [x] Update `LinkedLocationCreateRequest`, `CampaignEdgeCreateRequest`, `CampaignEdgeDistanceUpdateRequest` in `backend/app/routers/campaign_routes/schemas_and_gate.py` (with legacy `travel_minutes` input fallback, removing `240` cap) and wire `distance_meters` in `spatial_routes.py`
- [x] Update exit rendering to `[<dist>, <walk> walk]` in `backend/app/engine/context/zone4_ephemeral.py` and `backend/app/engine/clerk/pipeline.py`
- [x] Update `backend/app/engine/clerk/heuristics.py` to derive move duration via `derive_walking_minutes(nb.distance_meters)` (`max(2, derived + 1)`, clamped to `MAX_TURN_ELAPSED_MINUTES_SANITY`) and context-aware improvised defaults (`20m` interior / `100m` exterior)
- [x] Update `DEFAULT_CLERK_POST_TURN_SYSTEM`, `DEFAULT_WIZARD_WORLD_SYSTEM`, and `DEFAULT_WIZARD_MAP_REIMAGINE_SYSTEM` in `backend/app/prompts/defaults.py` plus offline wizard fallbacks in `backend/app/wizards/world_wizard.py`

## Stage 3: Frontend Types, Helpers & Non-Map UI
- [x] Replace `travel_minutes` with `distance_meters` in `frontend/src/types/{world.ts,turn.ts}`, `frontend/src/api/campaigns.ts`, and `frontend/src/components/world/worldDraftMappers.ts`
- [x] Implement metric conversion/formatting/adaptive-stepper/input helpers (`deriveWalkingMinutes`, `formatDistanceCompact`, `formatWalkingDuration`, `getAdaptiveDistanceStep`, `parseCommittedEdgeDistance`, `stepEdgeDistanceDraft`, `sanitizeEdgeDistanceInput`) and update `ProjectedTopologyEdge` / `BidirectionalProjectedBundle` in `frontend/src/components/map/topologyProjection.ts`
- [x] Remove `240` cap and wire context-aware defaults (`20m` / `100m` / `50m`) in `frontend/src/components/map/useTopologyMutations.ts`, `MapDialogs.tsx`, and `PortalPromotionModal.tsx`
- [x] Update `ChatComposer.tsx`, `InspectorLocationCard.tsx`, and `MapDetailsDrawer.tsx` to display `distance (~time)` unambiguously (`m`/`km` vs `min`/`h`)

## Stage 4: Map Canvas Badge Preview & Adaptive Inline Editor
- [x] Add `previewTimePairKeys` click-to-convert walking-time toggle on `SpatialTopologyCanvas.tsx` distance badges (single-edge + aggregated bundle min/range formatting, double-click inline editor isolation, and mobile `campaign` vs `editor` tap handling without canvas deselection)
- [x] Update screen-space inline editor overlay and `MultiEdgePopover` (`SpatialTopologyCanvas.tsx`, `MapDialogs.tsx`) with live walking-time preview, adaptive `±5/±25/±100/±500` steppers (`Shift` for `±1m`), and `1.5km` shorthand parsing
- [x] Update `SpatialTopologyView.tsx` and `worldDraftMappers.ts` wiring and `frontend/src/styles/` if any inline preview badge/hint styling is needed

## Stage 5: Verification, Architecture Docs & Wiki
- [x] Add/update backend tests (`backend/tests/test_spatial_edges.py`, DB migration test, heuristic clock test, `.zcc` legacy compatibility test, prompt/wizard schema tests) and run `ruff check`, `tach check`, `pytest`
- [x] Add/update frontend unit/markup tests (`frontend/src/components/__tests__/mapEditor.test.tsx`, `locationContainers.test.tsx`, `mapMobileGestures.test.tsx`, `mapSearch.test.tsx`) and `frontend/e2e/03-spatial-topology-map-editor.spec.ts` as needed; run `arch:check`, `css:audit`, `build`, `test`
- [x] Regenerate and verify architecture docs (`scripts/generate_arch_docs.py --check`)
- [x] Update user-facing guides in `../cybercantina-wiki` (`git -C ../cybercantina-wiki diff`)
- [x] Finalize `FRD.md` / `PLAN.md` statuses
