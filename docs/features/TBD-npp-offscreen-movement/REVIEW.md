---
feature: npp-offscreen-movement
target_version: TBD
document_type: review
status: draft
last_updated: 2026-11-24
---

# Pre-Implementation Review — NPP Off-Screen Movement & Navigation Engine (`TBD`)

## Key Architectural Traps & Mitigations

1. **Off-Screen `CharacterStateSnapshot` Desync Breaking Strict Co-Location (CRITICAL):**
   - **Trap:** In `backend/app/engine/clerk/pipeline.py`, Phase 5 Clerk currently writes new `CharacterStateSnapshot` rows only for `scene_characters` (and remote-whispered characters). If the off-screen movement engine updates `PartyRecord.location_id` from `A` to `B` without writing new `CharacterStateSnapshot` rows for each NPP member (`current_location_id = B`), then on the next turn `resolve_character_previous_state` still returns `A`, causing `reconcile_parties_strict_colocation` in `backend/app/engine/parties.py` to disband or snap the party back to `A`.
   - **Mitigation:** After `advance_all_offscreen_npp_movements` runs in Phase 5 Clerk, iterate every member of every moved NPP not already in `updated_states_by_char`, resolve their previous state via `resolve_character_previous_state`, project their CARE state to `new_campaign_elapsed`, and persist a new `CharacterStateSnapshot` with `current_location_id = party.location_id`. Add an integration test verifying a multi-turn off-screen move survives subsequent turns without party disbandment.

2. **`in_transit` Members Leaking Into Departure-Room `scene_characters` (CRITICAL):**
   - **Trap:** Because `PartyRecord.location_id` and `CharacterStateSnapshot.current_location_id` remain anchored to the departure node `A` while `movement_plan.in_transit == True` (to preserve DB foreign keys), naive room-presence queries (`char_loc == active_location.id`) will treat an already-departed NPP as physically standing in room `A` if the player visits `A` mid-journey!
   - **Mitigation:** Centralize an `is_character_in_transit(character_id, parties)` helper in `backend/app/engine/parties.py` (or `movement.py`) and filter out `in_transit` characters everywhere active-room `scene_characters` are computed (`turn_streaming.py`, `turns.py`, `assembler.py`, and frontend room-presence lists). Also verify that `reconcile_parties_strict_colocation` preserves `movement_plan` intact on unchanged/transit parties rather than dropping unknown fields when reconstructing `PartyRecord`.

3. **Short-Link Loop Iteration Explosion on Large Time Skips (CRITICAL):**
   - **Trap:** `location_edges` allows `distance_meters >= 1` and `speed_modifier <= 100.0`, yielding a minimum theoretical leg duration of `1 / 7000 ≈ 0.000143` minutes. If a 2-stop looping NPP runs across a 24-hour (`1440 min`) time skip via naive leg-by-leg stepping, the loop would execute **10,000,000+ iterations**, hanging the turn stream.
   - **Mitigation:**
     - Enforce a small positive floor `MIN_EFFECTIVE_LEG_MINUTES = 0.01` per leg.
     - For cyclic loops (`plan.loop == True`, `len(targets) >= 2`) whose full cycle does not contain `player_location_id`, compute `total_cycle_minutes` once and fast-forward `remaining_minutes %= total_cycle_minutes` before stepping.
     - Add a hard `MAX_TICK_STEPS = 512` circuit breaker so even pathological non-looping graphs can never stall the event loop.

4. **Player Interception vs. On-Scene Turn Ordering Race:**
   - **Trap A:** If an NPP is already co-located with the player at `start_location_id` (and `not in_transit`), ticking them in the off-screen engine would silently teleport them out of the room mid-conversation.
   - **Trap B:** If the player moves from `X` to `Y` on Turn N, and an off-screen NPP moves from `Z` through `Y` to `W` on Turn N, checking interception against `start_location_id` (`X`) instead of `new_location_id` (`Y`) would miss the rendezvous at `Y`.
   - **Mitigation:**
     - Skip any NPP whose start-of-turn `location_id == start_location_id` and `not in_transit`.
     - Run `advance_all_offscreen_npp_movements` *after* `new_location_id` and `turn_elapsed` are finalized, and pass `player_location_id = new_location_id` as the interception halt target.
     - When halted at `new_location_id`, set `status = "paused_on_scene"`, `in_transit = False`, `leg_elapsed_minutes = 0.0`, and emit `PartyMovementEvent(kind="arrived_at_player_location")`. On a later turn after the player leaves `new_location_id`, automatically resume `paused_on_scene -> moving`.

5. **Spoiler Leakage of Undiscovered Secret Links via NPP Routes (CRITICAL):**
   - **Trap:** An NPP with `known_secret_links` can legitimately route through an `is_secret=True` edge that the player has not discovered yet (`not in revealed_edge_ids`). If `get_campaign_state` returns the raw `PartyRecord.movement_plan` (including `known_secret_links` and `waypoints` across that secret edge) when `unlock_lore == False`, the player can inspect network payloads or UI tooltips to discover hidden passages.
   - **Mitigation:**
     - Filter `PartyRecord.movement_plan` server-side in `get_campaign_state` (`backend/app/db/repos/turns.py`) and in GM Talk/Tools (`gm_talk.py`, `gm_tools.py`) whenever `not unlock_lore`: strip `known_secret_links`, truncate `waypoints` prior to any undiscovered secret edge, and mask `next_waypoint_id` if currently `in_transit` on an undiscovered secret edge.
     - Gate setting/updating `known_secret_links` in `PATCH /parties/{party_id}/movement-plan` and `POST /parties` with `unlock_lore == True` (`403 Forbidden` otherwise).

6. **CoW Edge Supersession Invalidating Route Overrides:**
   - **Trap:** Live campaign map edits (`PATCH /edges/{id}`, `PUT /map`) use Copy-on-Write supersession, minting new `edge_id` strings. Pinning routes or overrides to `edge_id`s would break active NPP movement whenever a user edits a link's distance, obstacles, or label.
   - **Mitigation:** Store `waypoints` as `list[str]` of `location_id`s and `known_secret_links` / `bypass_blocked_links` as `MovementLinkOverride(from_location_id, to_location_id, bidirectional)`. Resolve active branch edges dynamically by `(from_location_id, to_location_id)` at route-build and tick time.

7. **Mid-Transit Edge Deletion / Blockage:**
   - **Trap:** A user or GM can block (`is_blocked = True`) or delete the very edge `(u -> v)` that an NPP is currently `in_transit` on.
   - **Mitigation:** At the start of `advance_movement_plan`, validate that `(waypoints[0], waypoints[1])` still exists and is eligible. If not, safely revert `in_transit = False`, `leg_elapsed_minutes = 0.0` at `waypoints[0]` (the departure node), and run deterministic rerouting from `waypoints[0]` to `target_location_ids[target_index]`. If no alternate path exists, mark `status = "blocked"` with a clear `status_reason`.

8. **Architecture Layering, Facades & Frontend Node-Only Vitest:**
   - **Trap:** Placing Dijkstra/tick logic inside `backend/app/schemas/` would bloat leaf schemas or pull engine dependencies upward (violating `tach.toml`), while adding DOM-dependent SVG measurement code in frontend route overlays would break Node-only Vitest.
   - **Mitigation:** Keep pure DTOs (`MovementPlan`, `MovementLinkOverride`, `PartyMovementEvent`) in `backend/app/schemas/party.py` (leaf layer) and all graph/tick algorithms in `backend/app/engine/movement.py`. Keep frontend route/transit projection helpers pure in `frontend/src/components/map/topologyProjection.ts` so they are unit-testable in Node Vitest alongside `ReactDOMServer.renderToStaticMarkup` checks.
