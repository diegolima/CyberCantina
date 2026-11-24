---
feature: first-class-map-links
target_version: 0.37.0
document_type: plan
status: completed
last_updated: 2026-11-24
---

# Implementation Plan — v0.37.0 First-Class Map Links

## Stage 0: Feature Package Lifecycle Artifacts
- [x] Author `FRD.md`
- [x] Author `REVIEW.md`
- [x] Author `PLAN.md`

## Stage 1: Backend Schema, DB Migration, Showcase Audit & `.zcc` Compatibility
- [x] Add speed/obstacle constants & helpers (`MIN_EDGE_SPEED_MODIFIER`, `MAX_EDGE_SPEED_MODIFIER`, `MAX_EDGE_OBSTACLES`, `normalize_edge_speed_modifier`, `normalize_edge_obstacles`, `derive_travel_minutes`, `format_travel_duration`, `format_exit_travel_phrase`) in `backend/app/schemas/world.py`
- [x] Replace `is_locked_or_hidden` with `speed_modifier`, `travel_mode`, `obstacles`, `is_blocked`, `is_secret` (with legacy `is_locked_or_hidden` → `is_blocked` `@model_validator(mode="before")` coercion) in `LocationEdgeDraft`, `LocationEdge`, `NeighborLocationView`, and `CANONICAL_LOCATION_EDGE_KEYS` (`backend/app/schemas/world.py`)
- [x] Add `revealed_edge_ids: list[str] = Field(default_factory=list)` to `WorldStateSnapshot` in `backend/app/schemas/turn.py`
- [x] Update `location_edges` and `world_state_snapshots` DDL in `backend/app/db/schema.sql` and add idempotent startup migrations in `backend/app/db/repos/schema_init.py` (table rebuild for `location_edges` mapping `is_locked_or_hidden` → `is_blocked`, plus `ALTER TABLE` for `revealed_edge_ids_json`)
- [x] Audit and update `backend/app/db/showcase_data/the_green_lie/world.json` (assign accurate `is_blocked` vs. `is_secret` and transit `speed_modifier`/`travel_mode` where fitting) and update `backend/app/db/seed.py` (preserving `SHOWCASE_SEED_VERSION = 2`)
- [x] Update `.zcc` export & import in `backend/app/services/import_export_service.py` and `backend/app/services/zcc_campaign_io.py` to round-trip all new edge fields and `revealed_edge_ids` with legacy `is_locked_or_hidden` fallback

## Stage 2: Backend Repositories, Spoiler Filtering & Campaign API Endpoints
- [x] Update SQL read/write queries and mappers in `backend/app/db/repos/{worlds.py,world_locations.py,campaign_spatial.py,campaign_map_update.py}` to persist `speed_modifier`, `travel_mode`, `obstacles_json`, `is_blocked`, and `is_secret`
- [x] Implement monotonic `revealed_edge_ids` inheritance, persistence, and canonical endpoint-pair / CoW ID remapping in `backend/app/db/repos/turns.py`, `campaign_spatial.py`, and `campaign_map_update.py`
- [x] Enforce spoiler filtering in `get_campaign_state` (`turns.py`) so undiscovered secret edges are stripped from `neighbors` (always) and from `world_edges` when `not unlock_lore`, AND protect omitted undiscovered secret edges from deletion during player-mode `PUT /api/campaigns/{campaign_id}/map` saves (`campaign_map_update.py`)
- [x] Expand `PATCH /api/campaigns/{campaign_id}/edges/{edge_id}` (`schemas_and_gate.py`, `spatial_routes.py`, `campaign_spatial.py`) to update `distance_meters`, `speed_modifier`, `travel_mode`, `obstacles`, `is_blocked`, `is_secret` (GM-Mode gated), and `direction_label` / `reciprocal_direction_label` branch-safely
- [x] Add `POST /api/campaigns/{campaign_id}/edges/{edge_id}/reveal` (`schemas_and_gate.py`, `spatial_routes.py`, `campaign_spatial.py`) gated by GM Mode (`unlock_lore`) to manually reveal or re-hide a secret link pair on the active branch

## Stage 3: Simulation Engine, Secret Discovery Pipeline, Prompts & World Wizard
- [x] Implement deterministic `select_newly_discovered_secret_edges(...)` (in `backend/app/engine/context/lore_scope.py`) supporting both succeeding discovery/keyword rolls (`dice_mode != "disabled"`) and diceless search-intent discovery (`dice_mode == "disabled"`)
- [x] Wire secret-edge partitioning and same-turn discovery reveal in `backend/app/routers/campaign_routes/turn_streaming.py`, `backend/app/engine/context/assembler.py`, and `backend/app/engine/context/zone4_ephemeral.py` (mode-aware travel phrasing, obstacle chips, `| BLOCKED`, and `| NEWLY DISCOVERED SECRET PASSAGE`)
- [x] Update Phase 5 Clerk (`backend/app/engine/clerk/pipeline.py` & `heuristics.py`) to: (a) persist newly discovered secret edge pairs into `WorldStateSnapshot.revealed_edge_ids`, (b) render mode-aware travel durations / obstacles / `BLOCKED` in `neighbor_options`, and (c) apply `derive_travel_minutes(nb.distance_meters, nb.speed_modifier)` as a deterministic floor on `elapsed_minutes` when `transition_type == "move_existing"`
- [x] Apply GM-Mode / discovery spoiler gating for secret links and expose new link metadata in `backend/app/engine/gm_talk.py` and `backend/app/engine/gm_tools.py`
- [x] Update World Wizard & Reimagine Map prompts (`backend/app/prompts/defaults.py`) and offline fallbacks (`backend/app/wizards/world_wizard.py`) to emit `speed_modifier`, `travel_mode`, `obstacles`, `is_blocked`, and `is_secret`

## Stage 4: Frontend Types, Helpers, API Client & Non-Map Surfaces
- [x] Update `LocationEdge`, `LocationEdgeDraft`, `NeighborLocationView`, and `WorldStateSnapshot` in `frontend/src/types/{world.ts,turn.ts}` and `frontend/src/components/world/worldDraftMappers.ts`
- [x] Add `LINK_SPEED_PRESETS`, `clampEdgeSpeedModifier`, `deriveTravelMinutes`, `formatTravelDuration`, `formatEffectiveSpeedKmh`, `formatTravelSummary`, and speed-aware `formatBundleTravelDuration` in `frontend/src/utils/spatialDistance.ts`
- [x] Update `frontend/src/api/campaigns.ts` for expanded `PATCH /edges/{edge_id}` payload and new `POST /edges/{edge_id}/reveal` client helper
- [x] Update `ChatComposer.tsx` and `InspectorLocationCard.tsx` to display speed-adjusted travel times/modes, `Blocked` indicator, and obstacle hints on visible exits

## Stage 5: Map Canvas First-Class Links & Element Inspector (`MapDetailsDrawer`)
- [x] Update `frontend/src/components/map/topologyProjection.ts` to filter undiscovered secret edges before supernode bundle aggregation when `!unlockLore`, compute speed-adjusted bundle duration ranges, and carry `is_blocked`, `is_secret`, `is_discovered`, `speed_modifier`, `travel_mode`, and `obstacles` on projected edges
- [x] Add unified `selectedEdgeSelection` (`pair` | `bundle`) state and edge property mutation/reveal handlers in `SpatialTopologyView.tsx` and `frontend/src/components/map/useTopologyMutations.ts` (including Undo-backed `Delete` key support for selected links in editor mode)
- [x] Upgrade `SpatialTopologyCanvas.tsx` with wide transparent hit-targets for single-click link selection (desktop + mobile `pendingTapTargetRef`), selected-link highlight, blocked styling, GM-Mode dashed-violet ghost styling (`EyeOff` badge) for undiscovered secret links, and speed-aware badge duration previews
- [x] Implement the **Link Pair Inspector** and **Supernode Bundle List** views inside `frontend/src/components/map/MapDetailsDrawer.tsx` (`MapLinkInspectorSection.tsx`: distance + steppers, speed modifier + preset pills + travel mode + live time/km/h readout, A→B / B→A labels, `TagChipsInput` obstacles, Blocked & Secret toggles, and GM-Mode Reveal/Re-hide button)
- [x] Retire `MultiEdgePopover` from `MapDialogs.tsx` / `SpatialTopologyView.tsx` and update `MapDialogs.tsx` context menu + `PortalPromotionModal.tsx` for `is_blocked` / `is_secret` and speed/obstacle defaults; add clean token-based styles in `frontend/src/styles/06-inspector-and-lore.css`

## Stage 6: Verification, Architecture Docs & Wiki
- [x] Add/update backend tests covering: SQLite `is_locked_or_hidden` migration & `revealed_edge_ids_json`, `.zcc` legacy round-trip, CoW edge edit preserving reveal state, player-mode map save preserving hidden secret edges, same-turn dice + diceless secret link discovery, Phase 5 Clerk travel-time floor, GM Talk spoiler gating, and GM-Mode permission boundaries (`ruff check`, `tach check`, `pytest`)
- [x] Add/update frontend unit/markup tests (`mapEditor.test.tsx`, `locationContainers.test.tsx`, `mapMobileGestures.test.tsx`, `mapSearch.test.tsx`, and `firstClassMapLinks.test.tsx`) and run `arch:check`, `css:audit`, `build`, `test`
- [x] Regenerate and verify architecture docs (`backend/.venv/bin/python scripts/generate_arch_docs.py && backend/.venv/bin/python scripts/generate_arch_docs.py --check`)
- [x] Update user-facing guides in `../cybercantina-wiki` (`Authoring-Worlds-Characters-and-Personas.md`, `Live-Inspector-Map-and-Timeline.md`, `Playing-Directing-and-Mechanics.md`, `Importing-and-Exporting.md`) and verify with `git -C ../cybercantina-wiki diff`
- [x] Update `FRD.md`, `REVIEW.md`, and `PLAN.md` statuses to `completed`
