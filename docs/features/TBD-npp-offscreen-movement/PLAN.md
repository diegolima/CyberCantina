---
feature: npp-offscreen-movement
target_version: TBD
document_type: plan
status: draft
last_updated: 2026-11-24
---

# Implementation Plan — NPP Off-Screen Movement & Navigation Engine (`TBD`)

## Stage 0: Feature Package Lifecycle Artifacts
- [x] Author `FRD.md`
- [x] Author `REVIEW.md`
- [x] Author `PLAN.md`

## Stage 1: Leaf Schemas & Pure Deterministic Navigation Engine
- [ ] Add `MovementLinkOverride`, `MovementPlanStatus`, `MovementPlan`, and `PartyMovementEvent` to `backend/app/schemas/party.py`; attach optional `movement_plan: MovementPlan | None = None` to `PartyRecord` and `movement_events: list[PartyMovementEvent]` to `PartyEventDelta` (re-exporting cleanly via `backend/app/schemas/turn.py` if needed)
- [ ] Implement `backend/app/engine/movement.py`:
  - `is_edge_eligible(...)` enforcing default exclusion of `is_blocked`/`is_secret` and explicit `known_secret_links` / `bypass_blocked_links` endpoint-pair overrides (isolated from `revealed_edge_ids`)
  - `compute_edge_travel_minutes(...)` (`distance_meters / (70.0 * speed_modifier * party_speed_modifier)`) and `compute_edge_routing_weight(...)` (`+15%` soft penalty per obstacle)
  - `compute_shortest_path(...)` (directed Dijkstra)
  - `build_movement_plan(...)` (multi-stop & cyclic loop initialization, unreachable `blocked` status)
  - `advance_movement_plan(...)` (node-anchored `in_transit` accumulator, multi-leg surplus carryover, `dwell_minutes` countdown, cyclic loop modulo fast-forward + `MAX_TICK_STEPS` guard, player-location interception halt -> `paused_on_scene`, mid-route & mid-transit dynamic rerouting)
  - `advance_all_offscreen_npp_movements(...)` (skipping on-screen NPPs and `turn_elapsed <= 0` turns)
  - `mask_movement_plan_for_player(...)` (stripping `known_secret_links` and masking undiscovered secret segments when `not unlock_lore`)
- [ ] Add `is_character_in_transit(...)` helper and preserve `movement_plan` across party reconciliation in `backend/app/engine/parties.py`

## Stage 2: Phase 5 Clerk Integration, Room Presence & Zone 4 Arrival Cues
- [ ] Wire `advance_all_offscreen_npp_movements(...)` into `backend/app/engine/clerk/pipeline.py` after `resolve_phase5_spatial_and_parties` and `turn_elapsed` are finalized
- [ ] Materialize updated `CharacterStateSnapshot` rows (with `current_location_id = new_party_loc` and projected CARE state via `project_care_to_minute`) for every member of an off-screen NPP that changed location during the turn
- [ ] Filter `in_transit` NPP members out of active-room `scene_characters` resolution (`turn_streaming.py`, `turns.py`, `assembler.py`)
- [ ] Inject concise `Recent Arrivals` cue in `backend/app/engine/context/zone4_ephemeral.py` when the prior turn's `party_event_delta.movement_events` records an `arrived_at_player_location` event for a co-located NPP

## Stage 3: Campaign API, Spoiler Filtering, `.zcc` & GM Talk
- [ ] Add `PartyMovementPlanUpdateRequest` in `backend/app/routers/campaign_routes/schemas_and_gate.py` and `PATCH /api/campaigns/{campaign_id}/parties/{party_id}/movement-plan` in `backend/app/routers/campaign_routes/crud_and_state.py` (rejecting player party `422`, validating locations `422`, and gating `known_secret_links` behind `unlock_lore` `403`)
- [ ] Extend `POST /api/campaigns/{campaign_id}/parties` (`PartyCreateRequest`) with optional initial `movement_plan` (enforcing the same GM-Mode gate for `known_secret_links`)
- [ ] Apply `mask_movement_plan_for_player(...)` in `get_campaign_state` (`backend/app/db/repos/turns.py`) when `not unlock_lore`
- [ ] Verify `PartyRecord.movement_plan` round-trips cleanly in `backend/app/services/zcc_campaign_io.py` (with backward-compatible `None` default for older `.zcc` archives)
- [ ] Expose spoiler-safe NPP route & transit summaries in `backend/app/engine/gm_talk.py` and `backend/app/engine/gm_tools.py`

## Stage 4: Frontend Types, API Client, Party Modal & Map/Inspector UI
- [ ] Add `MovementLinkOverride`, `MovementPlan`, `PartyMovementEvent`, and `PartyRecord.movement_plan` to `frontend/src/types/party.ts` (or `turn.ts`) and add `updateCampaignPartyMovementPlan` to `frontend/src/api/campaigns.ts`
- [ ] Add collapsible **Movement Plan / Route** editor & live status badges to `frontend/src/components/party/PartyManagementModal.tsx` (target stop list, loop toggle, dwell minutes, speed multiplier, `bypass_blocked_links`, GM-Mode-only `known_secret_links`, Save/Clear actions)
- [ ] Update `frontend/src/components/map/topologyProjection.ts`, `SpatialTopologyCanvas.tsx`, `SpatialTopologyView.tsx`, and `MapDetailsDrawer.tsx`:
  - Exclude `in_transit` NPP members from departure-node room presence counts/badges
  - In GM Mode (`unlock_lore`), render dashed NPP route overlays and in-transit edge progress pills at `progress_ratio` along `(u -> v)`
  - In Player Mode (`!unlock_lore`), show non-secret transit status without rendering hidden routes or leaking undiscovered secret links
  - Add token-based styles in `frontend/src/styles/06-inspector-and-lore.css` (no `!important`)

## Stage 5: Verification, Architecture Docs & Wiki
- [ ] Add comprehensive backend tests (`backend/tests/test_npp_movement.py`):
  - Directed Dijkstra (speed modifiers, `+15%` obstacle tie-breaking, blocked/secret exclusion, separate `known_secret_links` / `bypass_blocked_links` overrides, isolation from `revealed_edge_ids`)
  - Partial-edge `in_transit` accumulation, multi-leg carryover, `dwell_minutes`, cyclic loop modulo fast-forward on `1440 min` time skip
  - On-screen skip, player interception halt -> `paused_on_scene` -> Zone 4 arrival cue -> auto-resume after player leaves
  - Mid-route & mid-transit dynamic blockage/deletion rerouting and `blocked` fallback, CoW edge supersession resilience
  - Off-screen `CharacterStateSnapshot` materialization + `reconcile_parties_strict_colocation` stability + branch rewind
  - API permission gate (`403` for `known_secret_links` in Player Mode), `get_campaign_state` & GM Talk spoiler masking, `.zcc` round-trip
- [ ] Run backend checks: `cd backend && .venv/bin/ruff check app tests && .venv/bin/tach check` and `backend/.venv/bin/pytest backend/tests`
- [ ] Add frontend unit/markup tests (`frontend/src/components/__tests__/nppMovement.test.tsx`) and run `arch:check`, `css:audit`, `build`, `test`
- [ ] Regenerate & verify architecture docs: `backend/.venv/bin/python scripts/generate_arch_docs.py && backend/.venv/bin/python scripts/generate_arch_docs.py --check`
- [ ] Update user-facing guides in `../cybercantina-wiki` (`Playing-Directing-and-Mechanics.md`, `Live-Inspector-Map-and-Timeline.md`, `Importing-and-Exporting.md`) and verify with `git -C ../cybercantina-wiki diff`
- [ ] Update `FRD.md`, `REVIEW.md`, and `PLAN.md` statuses to `completed`
