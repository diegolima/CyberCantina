---
feature: runtime-spatial-improvisation
target_version: 0.52.0
document_type: plan
status: completed
last_updated: 2026-11-27
---

# Implementation Plan — Runtime Spatial Improvisation & Link Discovery

## Step 1: Feature Spec Package
- [x] Create isolated worktree `.worktrees/runtime-spatial-improvisation` on branch `feat/runtime-spatial-improvisation`
- [x] Author `FRD.md` (`docs/features/TBD-runtime-spatial-improvisation/FRD.md`)
- [x] Author `ARCHITECTURE.md` (`docs/features/TBD-runtime-spatial-improvisation/ARCHITECTURE.md`)
- [x] Author `REVIEW.md` (`docs/features/TBD-runtime-spatial-improvisation/REVIEW.md`)
- [x] Author `PLAN.md` (`docs/features/TBD-runtime-spatial-improvisation/PLAN.md`)
- [x] Obtain explicit user approval before writing production code

## Step 2: Pure Geometry & Travel Cue Engine + Schema Updates
- [x] Create `backend/app/engine/spatial_geometry.py`:
  - `extract_travel_cues(text)` (ReDoS-safe parser for explicit duration, explicit distance, speed/pace cues, vertical hints, non-Euclidean/portal hints)
  - `compute_visible_scope_positions(...)` (8-way compass vectors, L1 footprint collapse, vertical contraction, secret-edge filtering)
  - `estimate_euclidean_offset(...)` and `find_shortest_visible_path(...)`
  - `select_candidate_known_locations(...)` (visited, starting, or `<= 3` visible hops, capped `<= 20`)
- [x] Update `backend/app/schemas/turn.py`:
  - Add `distance_mode` and `is_vertical` to `ImprovisedLocationSpec`
  - Add `ImprovisedLinkSpec` with explicit `required` JSON schema keys and optional `clamped_from_meters`
  - Expand `PreTurnAnalysis`/`PreTurnLLMOutput` (`spatial_intent`) and `WorldPostTurnDelta`/`PostTurnStateDelta` (`transition_type`, `improvised_link`, `traversed_location_ids`)

## Step 3: Repository Persistence (`world_locations.py`) & Prompts (`defaults.py`)
- [x] Update `backend/app/db/repos/world_locations.py`:
  - Persist `distance_mode` and `is_vertical` inside `add_improvised_location`
  - Implement `add_improvised_link` (idempotency check on existing visible edge, independent free compass slots on both endpoints, `created_at_turn_id` branch scoping, `.zcc` v2 compatibility)
- [x] Update `backend/app/prompts/defaults.py`:
  - `DEFAULT_CLERK_PRE_TURN_SYSTEM`: support `connect_existing` alongside `move_known` / `explore_new`
  - `DEFAULT_CLERK_POST_TURN_SYSTEM`: add `70 m/min` walking conversion rule, `Other Known Locations` instructions (`connect_existing` vs retracing `move_existing`), `is_vertical`, and `distance_mode` guidance

## Step 4: Phase 1, Phase 4 & Phase 5 Pipeline Integration
- [x] Update `backend/app/engine/phase1_pre.py`:
  - Inject compact `Other Known Locations` list into user prompt
  - Extend offline heuristic to detect retracing vs direct connecting to known non-adjacent locations
- [x] Update `backend/app/engine/phase4_prose.py`:
  - Support `connect_existing` deterministic offline prose templates
- [x] Update `backend/app/engine/clerk/heuristics.py`:
  - Parse walk duration/distance/pace/vertical/portal cues in offline `improvise_new` fallback instead of hardcoding `100m`/`20m` and `4 min`
  - Handle `spatial_intent == "connect_existing"` in offline fallback
- [x] Update `backend/app/engine/clerk/pipeline.py`:
  - Inject `Other Known Locations` (with shortest hops and 2D geometry hints) into `world_user_prompt`
  - Apply deterministic duplicate-name guard on `improvise_new`
  - Apply explicit walk cue distance alignment + enforced `min_travel_minutes` clock floor on `improvise_new`
  - Execute `connect_existing` with 2D Euclidean clamping (when `distance_mode != "non_euclidean"` & `not is_vertical` & connected horizontally), `add_improvised_link`, and speed-adjusted clock floor
  - Execute multi-hop `move_existing` along shortest visible path without adding new edges, summing hop durations and updating `visited_location_ids` / `visited_container_ids`

## Step 5: Frontend Types, Audit Modal & Mechanics Reference Sync
- [x] Update `frontend/src/types/turn.ts` (`ImprovisedLinkSpec`, `connect_existing`, `traversed_location_ids`)
- [x] Update `frontend/src/components/inspector/AgentChangesModal.tsx` (render `connect_existing`, clamping pill, `is_vertical`/`distance_mode`, and multi-hop traversed path)
- [x] Update `frontend/src/components/world/mechanics/mechanicsCatalog.ts` & `backend/app/reference/game_mechanics_catalog.json`

## Step 6: Tests & Verification Gates
- [x] Add backend unit & integration tests (`backend/tests/test_runtime_spatial_improvisation.py`):
  - Full 4-turn **Plaza → Bar (`W`, 5 min / `350m`) → Street (`N`, 10 min / `700m`, `improvise_new`) → Plaza** scenario verifying:
    - Walk cue distance & clock floor on `improvise_new` (`700m`, `>= 10 min`)
    - Direct shortcut `connect_existing` clamping (`350m` input → `~783m SE`, `~11 min`) vs non-Euclidean portal exemption vs vertical transition
    - Retracing multi-hop `move_existing` (moves without adding new edge, marks `Bar` & `Plaza` visited, sums hop durations)
    - Duplicate-location prevention when Clerk tries to re-improvise `"Plaza"`
    - Spoiler isolation (hidden `is_secret` targets excluded from `Other Known Locations` & Dijkstra)
    - Timeline rewind / branch delete cleanup removing improvised links cleanly
- [x] Add frontend Vitest SSR coverage (`frontend/src/components/__tests__/runtimeSpatialImprovisation.test.tsx`)
- [x] Run backend verification: `cd backend && .venv/bin/ruff check app tests && .venv/bin/tach check && .venv/bin/pytest -p no:tach tests`
- [x] Run frontend verification: `npm --prefix frontend run arch:check && npm --prefix frontend run css:audit && npm --prefix frontend run build && npm --prefix frontend test`
- [x] Regenerate and verify architecture docs: `backend/.venv/bin/python scripts/generate_arch_docs.py && backend/.venv/bin/python scripts/generate_arch_docs.py --check`

## Step 7: Planned Wiki Updates (Deferred Until Merge)
- [x] Record planned `../cybercantina-wiki` updates to apply at merge time:
  - `../cybercantina-wiki/Playing-Directing-and-Mechanics.md` — Runtime location/link improvisation (`70 m/min` walk alignment, returning/connecting to known rooms, geometry clamping vs `Non-Euclidean` / `Vertical` links)
  - `../cybercantina-wiki/Live-Inspector-Map-and-Timeline.md` — Agent Changes inspection of `connect_existing`, geometry clamping notices, and multi-hop travel logs
