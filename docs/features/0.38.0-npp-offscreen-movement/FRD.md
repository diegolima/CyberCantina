---
feature: npp-offscreen-movement
target_version: 0.38.0
document_type: frd
status: draft
last_updated: 2026-11-24
---

# Feature Requirements Document (FRD)
## Non-Player Party (NPP) Off-Screen Movement & Navigation Engine

**Status:** Draft (`v0.38.0`)  
**Target Version:** CyberCantina v0.38.0  
**Depends On:**
- [v0.37.0 First-Class Map Links](file:///home/diegolima/Git/cybercantina/docs/features/0.37.0-first-class-map-links/FRD.md)
- [v0.36.0 Metric Spatial Edge Distances](file:///home/diegolima/Git/cybercantina/docs/features/0.36.0-metric-spatial-distances/FRD.md)
- [v0.21.0 Traveling Parties](file:///home/diegolima/Git/cybercantina/docs/features/0.21.0-parties/FRD.md)
- [v0.31.0 Campaign Lore, GM Mode & Major Events](file:///home/diegolima/Git/cybercantina/docs/features/0.31.0-campaign-lore-gm-mode-and-major-events/FRD.md)
- [v0.34.0 GM Talk Agentic Tools](file:///home/diegolima/Git/cybercantina/docs/features/0.34.0-gm-agentic-tools/FRD.md)

**Out of Scope (Explicitly Deferred to a Follow-Up Feature):**
- Autonomous LLM goal generation / dynamic re-planning during on-scene turns.
- Off-screen NPC-vs-NPC encounters, off-screen combat, or off-screen dialogue simulation.
- Solo NPC off-screen movement (though the core navigation schemas and pure engine functions are decoupled from `PartyRecord` so solo NPCs can reuse them later without rewriting the engine).

**Expected Scope:**
- **Backend Schemas, Navigation Engine & Turn Pipeline:**
  - [`backend/app/schemas/party.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/party.py) (standalone `MovementLinkOverride`, `MovementPlan`, `RouteProgress`, `PartyMovementEvent`, attached optionally to `PartyRecord` and `PartyEventDelta`)
  - `backend/app/engine/movement.py` *(new pure deterministic navigation & time-tick module)*
  - [`backend/app/engine/parties.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/parties.py) (exclude `in_transit` NPP members from departure-room presence; preserve `movement_plan` across reconciliation)
  - [`backend/app/engine/clerk/pipeline.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/clerk/pipeline.py) (post-turn off-screen NPP tick + off-screen `CharacterStateSnapshot` materialization + CARE projection)
  - [`backend/app/engine/context/zone4_ephemeral.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/zone4_ephemeral.py) & [`backend/app/engine/context/assembler.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/assembler.py) (room-presence filtering for `in_transit` NPPs + deterministic arrival notice when an off-screen NPP enters `active_location_id`)
  - [`backend/app/engine/gm_talk.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/gm_talk.py) & [`backend/app/engine/gm_tools.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/gm_tools.py) (spoiler-safe NPP route & transit inspection)
- **Backend Persistence, API & `.zcc` Serialization:**
  - [`backend/app/db/repos/turns.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/turns.py) (spoiler-filtering NPP secret-link route segments in `get_campaign_state` when `not unlock_lore`; filtering `in_transit` members from active-room queries)
  - [`backend/app/db/repos/campaigns.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/campaigns.py) (or party repo helper for creating/updating NPP `movement_plan`)
  - [`backend/app/routers/campaign_routes/schemas_and_gate.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/campaign_routes/schemas_and_gate.py) & [`backend/app/routers/campaign_routes/crud_and_state.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/campaign_routes/crud_and_state.py) (`PATCH /api/campaigns/{campaign_id}/parties/{party_id}/movement-plan`, plus optional initial `movement_plan` on `POST /api/campaigns/{campaign_id}/parties`)
  - [`backend/app/services/zcc_campaign_io.py`](file:///home/diegolima/Git/cybercantina/backend/app/services/zcc_campaign_io.py) (clean round-trip verification of `PartyRecord.movement_plan`)
- **Frontend Types, API, Party Modal & Map/Inspector Visualization:**
  - [`frontend/src/types/party.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/party.ts) (or `turn.ts`), [`frontend/src/api/campaigns.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/api/campaigns.ts)
  - [`frontend/src/components/party/PartyManagementModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/party/PartyManagementModal.tsx) (NPP route builder: target stops, loop toggle, dwell minutes, `bypass_blocked_links`, and GM-Mode-only `known_secret_links`, plus live route preview/status)
  - [`frontend/src/components/SpatialTopologyView.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/SpatialTopologyView.tsx), [`frontend/src/components/map/SpatialTopologyCanvas.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/SpatialTopologyCanvas.tsx), [`frontend/src/components/map/MapDetailsDrawer.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDetailsDrawer.tsx) (GM-Mode route overlay & in-transit edge marker; Player-Mode non-secret transit status without secret-link leakage)
  - [`frontend/src/styles/`](file:///home/diegolima/Git/cybercantina/frontend/src/styles/06-inspector-and-lore.css)
- **User-Facing Wiki Documentation:** [`../cybercantina-wiki`](file:///home/diegolima/Git/cybercantina-wiki/Home.md) (`Playing-Directing-and-Mechanics.md`, `Live-Inspector-Map-and-Timeline.md`, `Importing-and-Exporting.md`)

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
Non-player parties (NPPs) currently remain frozen at their last recorded location whenever they are off-screen. Even though `v0.36.0` introduced physical metric distances (`distance_meters`) and `v0.37.0` added first-class map links (`speed_modifier`, `obstacles`, `is_blocked`, `is_secret`, and a deterministic Clerk travel-time floor), there is no deterministic navigation engine to move off-screen NPPs across the world graph as campaign time advances.

### 1.2 Proposed Solution
Introduce a **zero-LLM, deterministic Off-Screen Movement & Navigation Engine** (`backend/app/engine/movement.py`) driven purely by `turn_elapsed` minutes during Phase 5 Clerk:
- **Directed Shortest-Time Pathfinding (Dijkstra):** Computes optimal multi-waypoint routes between one or more target locations using physical travel time (`distance_meters / (70.0 * speed_modifier * party_speed_modifier)`) with a small soft routing penalty (`+15%` per obstacle) so NPPs prefer clear roads when travel times are similar.
- **Explicit Override Semantics:** Excludes `is_blocked` and `is_secret` links by default, while supporting two explicit, CoW-safe endpoint-pair override lists—`known_secret_links` (secrets this NPP knows) and `bypass_blocked_links` (barriers this NPP can cross)—strictly isolated from player-discovered `revealed_edge_ids`.
- **Node-Anchored `in_transit` Progression:** Accumulates fractional progress (`leg_elapsed_minutes`) across turns without teleporting. Once `leg_elapsed_minutes > 0`, the NPP is marked `in_transit = True` (preserving `location_id` on the departure node for DB/FK integrity while excluding them from room presence at the departure node until arrival).
- **Multi-Leg & Cyclic Loop Support:** Carries surplus elapsed time into subsequent waypoints, supports cyclic loops (`A -> B -> C -> A`, reducing to `A <-> B` for 2 stops) with optional `dwell_minutes` pauses at target stops, and uses modulo fast-forwarding on long time skips to prevent iteration explosions.
- **Player Interception & Dynamic Rerouting:** Skips NPPs already on-screen, halts off-screen NPPs if their path reaches the player's `new_location_id` (emitting an arrival notice for the next turn), and auto-reroutes deterministically if a link/node ahead is blocked or deleted mid-campaign.
- **Branch-Safe Persistence & Spoiler-Safe UI:** Stores `movement_plan` directly on `PartyRecord` inside `WorldStateSnapshot.parties` (branch-safe and `.zcc`-portable), materializes updated `CharacterStateSnapshot` rows for moved off-screen members, and exposes route controls in the Party Modal plus spoiler-safe Map/Inspector & GM Talk visibility.

---

## 2. Core Invariants

1. **Zero-LLM Navigation Invariant:**
   - Route calculation, waypoint advancement, dwell countdowns, rerouting, and loop wrapping execute deterministically in pure Python (`backend/app/engine/movement.py`) with zero LLM calls.
2. **Branch & Timeline Reproducibility Invariant (Hard):**
   - All NPP movement plans and transit progress live on `PartyRecord.movement_plan` inside `WorldStateSnapshot.parties` (serialized per turn). Rewinding, deleting a turn, or checking out another branch restores every NPP's exact route, `in_transit` state, and leg progress automatically.
3. **Node-Anchored `in_transit` & Room Presence Invariant (Hard):**
   - `PartyRecord.location_id` and each member's `CharacterStateSnapshot.current_location_id` always reference a valid `location_nodes.id` (the last reached waypoint / departure node).
   - When `movement_plan.in_transit == True` (i.e., `leg_elapsed_minutes > 0` while advancing along `waypoints[0] -> waypoints[1]`), the NPP's members are **not** considered co-present in `location_id` for scene assembly (`scene_characters`), Phase 1/2/3/4 prompts, or player-room checks.
   - Upon completing a leg (`leg_elapsed_minutes >= leg_duration_minutes`), `location_id` advances to `waypoints[1]`, `in_transit` resets to `False` (unless surplus time immediately begins the next leg), and updated `CharacterStateSnapshot` rows are persisted for all NPP members.
4. **On-Scene Supremacy & Player Interception Invariant (Hard):**
   - **Already on-screen:** Any NPP whose `location_id == start_location_id` (and `not in_transit`) at the start of the turn is **never** ticked by the off-screen movement engine; on-scene turn logic governs them.
   - **Interception:** If an off-screen NPP arrives at `new_location_id` (the player's post-turn active location) during the turn's elapsed-time tick—whether as an intermediate waypoint or a target stop—its tick **halts immediately** at `new_location_id` (`in_transit = False`, `leg_elapsed_minutes = 0.0`, remaining surplus time discarded), its plan pauses while co-located, and a `PartyMovementEvent(kind="arrived_at_player_location", ...)` is emitted so the next turn's Zone 4 context informs the Narrator/Characters of the arrival.
   - **Static / Zero-Time Turns:** When `turn_elapsed <= 0` (e.g., `[Describe]` turns), the movement engine is a strict no-op.
5. **CoW-Resilient Endpoint-Pair Identity Invariant:**
   - Routes (`waypoints`) and overrides (`known_secret_links`, `bypass_blocked_links`) are keyed by `location_id` and `(from_location_id, to_location_id)` pairs—never raw `edge_id`s—so live campaign map edits (`PATCH /edges/{id}`, `PUT /map`) that mint CoW replacement `edge_id`s never break active routes or overrides.
6. **Routing Cost vs. Physical Travel Time Invariant:**
   - **Edge eligibility:** Directed edge `u -> v` is eligible iff:
     - `(not edge.is_blocked) or ((u, v) in bypass_blocked_links)` AND
     - `(not edge.is_secret) or ((u, v) in known_secret_links)`.
     - Player-discovered `WorldStateSnapshot.revealed_edge_ids` is **never** automatically granted to NPPs.
   - **Physical leg duration (minutes):**
     $$\text{duration}(e) = \frac{e.\text{distance\_meters}}{70.0 \times e.\text{speed\_modifier} \times \text{party\_speed\_modifier}}$$
   - **Dijkstra routing weight:**
     $$\text{weight}(e) = \text{duration}(e) \times \bigl(1.0 + 0.15 \times \min(\text{len}(e.\text{obstacles}), 6)\bigr)$$
     Obstacles bias route selection away from hazards when travel times are similar, while actual elapsed time consumed during ticking remains exact physical $\text{duration}(e)$.
7. **Spoiler Gating & Permission Boundary Invariant (Hard):**
   - **Operational editing (`target_location_ids`, `loop`, `dwell_minutes`, `party_speed_modifier`, `bypass_blocked_links`):** Editable in both Player Mode (`unlock_lore = False`) and GM Mode (`unlock_lore = True`) via the Party Modal / API (matching existing `POST /parties` creation permissions).
   - **Secret overrides (`known_secret_links`):** Strictly **GM Mode (`unlock_lore = True`) only** (`403 Forbidden` in Player Mode).
   - **Player-Mode State Projection (`get_campaign_state`, Map, Inspector, GM Talk):** When `not unlock_lore`, any `known_secret_links` entries and any planned/active route segments traversing an undiscovered secret link (`is_secret=True` and not in `revealed_edge_ids`) are **stripped/masked** server-side so NPP movement never leaks hidden map topology. Full route overlays and in-transit edge paths render in GM Mode; Player Mode displays non-secret transit status only.

---

## 3. Functional Requirements

### FR-1: Decoupled Movement Schemas (`backend/app/schemas/party.py`)
Define standalone, Pydantic v2 leaf models (reusable by solo NPCs in the future):
- `MovementLinkOverride(BaseModel)`:
  - `from_location_id: str`
  - `to_location_id: str`
  - `bidirectional: bool = True` *(when `True`, matches both `(u, v)` and `(v, u)`)*
- `MovementPlanStatus = Literal["moving", "dwelling", "arrived", "paused_on_scene", "blocked"]`
- `MovementPlan(BaseModel)`:
  - **Configuration (Intent):**
    - `target_location_ids: list[str]` *(ordered 1+ target stops; consecutive duplicates collapsed)*
    - `loop: bool = False` *(when `True` and `len(target_location_ids) >= 2`, wraps cyclically `targets[-1] -> targets[0]`)*
    - `dwell_minutes: int = Field(default=0, ge=0, le=10080)` *(optional pause at each reached target stop)*
    - `party_speed_modifier: float = Field(default=1.0, ge=0.25, le=10.0)` *(default `1.0`; extensible hook for wounded/mounted parties)*
    - `known_secret_links: list[MovementLinkOverride] = Field(default_factory=list)`
    - `bypass_blocked_links: list[MovementLinkOverride] = Field(default_factory=list)`
  - **Runtime Progress State:**
    - `status: MovementPlanStatus = "moving"`
    - `status_reason: str | None = None` *(e.g. `"Path to Vault Core blocked"`, `"Arrived at player's location"`)*
    - `target_index: int = Field(default=0, ge=0)` *(index into `target_location_ids` currently being pursued)*
    - `waypoints: list[str] = Field(default_factory=list)` *(expanded directed node path `[current_node, ..., next_target_stop]`)*
    - `leg_elapsed_minutes: float = Field(default=0.0, ge=0.0)` *(accumulated time along `waypoints[0] -> waypoints[1]`)*
    - `dwell_remaining_minutes: float = Field(default=0.0, ge=0.0)` *(remaining pause at current target stop)*
    - `in_transit: bool = False` *(true iff actively mid-edge between `waypoints[0]` and `waypoints[1]` with `leg_elapsed_minutes > 0`)*
- Attach `movement_plan: MovementPlan | None = None` to `PartyRecord` (defaults to `None` for full backward compatibility with existing snapshots and `.zcc` archives).
- Add `PartyMovementEvent(BaseModel)` and `movement_events: list[PartyMovementEvent] = Field(default_factory=list)` to `PartyEventDelta`:
  - `party_id: str`, `party_name: str`, `kind: Literal["moved", "in_transit", "arrived_destination", "arrived_at_player_location", "rerouted", "blocked"]`
  - `from_location_id: str`, `to_location_id: str`, `next_waypoint_id: str | None = None`, `progress_ratio: float | None = None`, `note: str = ""`

### FR-2: Pure Deterministic Navigation & Tick Engine (`backend/app/engine/movement.py`)
Implement pure, side-effect-free functions operating on active branch `LocationNode`s and directed `LocationEdge`s:
1. **`compute_shortest_path(...)` (Directed Dijkstra):**
   - Inputs: `start_location_id`, `goal_location_id`, `edges`, `known_secret_links`, `bypass_blocked_links`, `party_speed_modifier`.
   - Builds directed adjacency list picking the lowest-weight eligible edge for each `(u, v)` pair (if parallel edges ever exist).
   - Uses `weight(e) = duration(e) * (1.0 + 0.15 * min(len(e.obstacles), 6))`.
   - Returns `(waypoints: list[str], total_duration_minutes: float) | None`.
2. **`build_movement_plan(...)`:**
   - Given `current_location_id`, `target_location_ids`, `loop`, `dwell_minutes`, `party_speed_modifier`, and override lists:
   - Computes initial `waypoints` from `current_location_id` to `target_location_ids[0]` (if already at `target_location_ids[0]`: for non-looping single-stop plans marks `status="arrived"`; for multi-stop/looping advances to the next stop).
   - If unreachable, returns plan with `status="blocked"` and descriptive `status_reason`.
3. **`advance_movement_plan(...)`:**
   - Inputs: `current_location_id`, `plan: MovementPlan`, `elapsed_minutes: float`, `edges`, `valid_location_ids: set[str]`, `player_location_id: str | None`.
   - Behavior:
     - **Skip guards:** Returns unchanged if `elapsed_minutes <= 0`, `plan.status in ("arrived", "blocked")`, or if the party is already on-screen at `player_location_id` (`not plan.in_transit`).
     - **Resuming after player leaves:** If `plan.status == "paused_on_scene"` and `current_location_id != player_location_id`, transitions back to `"moving"` (recomputing `waypoints` if needed) before ticking.
     - **Mid-edge invalidation check:** If `plan.in_transit` and the current edge `(waypoints[0], waypoints[1])` is now missing, deleted, or newly ineligible (blocked/secret without override), reset `in_transit = False`, `leg_elapsed_minutes = 0.0` (safely returning to `waypoints[0]`), and trigger deterministic rerouting from `waypoints[0]`.
     - **Dwell countdown:** If `dwell_remaining_minutes > 0`, consume `min(remaining, dwell_remaining_minutes)` first; if still dwelling, remain at `current_location_id` (`status="dwelling"`, `in_transit=False`).
     - **Closed-loop fast-forward (anti-spin guard):** If `plan.loop` is `True`, `len(plan.target_location_ids) >= 2`, and the full computed loop cycle does **not** contain `player_location_id`, compute `total_cycle_minutes` (sum of all leg durations + `dwell_minutes` per stop). If `total_cycle_minutes > 0` and `remaining >= total_cycle_minutes`, reduce `remaining %= total_cycle_minutes` before stepping. Enforce a hard safety cap (`MAX_TICK_STEPS = 512`) and minimum positive leg floor (`MIN_EFFECTIVE_LEG_MINUTES = 0.01`) so degenerate graphs can never infinite-loop.
     - **Step loop:** While `remaining > 0`:
       - Ensure `waypoints` has at least 2 nodes; if missing or next edge `(u, v)` is ineligible/deleted, **auto-reroute** from `u` to `target_location_ids[target_index]`. If rerouting fails, set `status="blocked"`, `in_transit=False`, `leg_elapsed_minutes=0.0`, emit `"blocked"` event, and break.
       - Compute `leg_cost = max(MIN_EFFECTIVE_LEG_MINUTES, duration(u -> v))` and `needed = max(0.0, leg_cost - leg_elapsed_minutes)`.
       - If `remaining < needed`:
         - `leg_elapsed_minutes += remaining`, `in_transit = True`, `status = "moving"`, `remaining = 0`, break.
       - Else (`remaining >= needed`):
         - `remaining -= needed`, advance `current_location_id = v`, pop `waypoints[0]`, reset `leg_elapsed_minutes = 0.0`, `in_transit = False`.
         - **Player interception check:** If `v == player_location_id`: set `status = "paused_on_scene"`, `status_reason = "Arrived at player's location"`, emit `"arrived_at_player_location"`, and break immediately!
         - **Target stop arrival check:** If `len(waypoints) == 1` (reached `target_location_ids[target_index]`):
           - If last stop and `not plan.loop`: set `status = "arrived"`, `waypoints = [v]`, emit `"arrived_destination"`, break.
           - Else advance `target_index = (target_index + 1) % len(target_location_ids)`, compute next leg `waypoints` from `v` to `target_location_ids[target_index]` (if unreachable, `status = "blocked"`, break), and if `plan.dwell_minutes > 0`, set `dwell_remaining_minutes = float(plan.dwell_minutes)` and consume dwell time before continuing.
4. **`advance_all_offscreen_npp_movements(...)`:**
   - Iterates all NPC-only parties (`USER_PARTY_MEMBER_ID not in p.member_ids`) with a `movement_plan` that were **not** on-screen at `start_location_id` (unless `in_transit=True`), runs `advance_movement_plan`, and returns `(updated_parties, moved_member_locations, movement_events)`.

### FR-3: Phase 5 Clerk Integration & Off-Screen `CharacterStateSnapshot` Materialization
- In [`backend/app/engine/clerk/pipeline.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/clerk/pipeline.py):
  - After `resolve_phase5_spatial_and_parties` and `turn_elapsed` are finalized (using active branch `world_rec.edges` and `world_rec.locations`), invoke `advance_all_offscreen_npp_movements(...)` passing `start_location_id=active_location.id`, `player_location_id=new_location_id`, `elapsed_minutes=turn_elapsed`.
  - Update `updated_world_snapshot.parties` with the ticked `PartyRecord`s and attach `movement_events` onto `party_event_delta`.
  - **Off-screen member snapshot materialization:** For every character whose location changed due to off-screen NPP movement (and who is not already in `updated_states_by_char`), load their `prev_state = resolve_character_previous_state(prior_branch_turns, char, active_location.id)`, project their CARE state to `new_campaign_elapsed` via `project_care_to_minute`, and write a new `CharacterStateSnapshot` with `current_location_id = new_party_loc` into `updated_states_by_char` so `character_states` and `PartyRecord.location_id` stay strictly synchronized on the branch.
- **Room Presence & Zone 4 Arrival Notice:**
  - Wherever `scene_characters` (characters present at `active_location_id`) are resolved (`turn_streaming.py`, `turns.py`, `assembler.py`), exclude any character belonging to a party with `party.movement_plan and party.movement_plan.in_transit`.
  - In [`zone4_ephemeral.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/zone4_ephemeral.py): when the prior turn's `post_turn_delta.party_event_delta.movement_events` contains an `"arrived_at_player_location"` event for a party now co-located at `active_location_id`, inject a concise 1-line arrival cue (e.g., `Recent Arrivals: <Party Name> (<members>) just arrived from <origin>.`) so Phase 3/4 narrate their entrance naturally.

### FR-4: Campaign API, Permission Boundaries, `.zcc` & GM Talk
- **Update Party Movement Plan (`PATCH /api/campaigns/{campaign_id}/parties/{party_id}/movement-plan`):**
  - Request: `PartyMovementPlanUpdateRequest`:
    - `target_location_ids: list[str]` (empty list or explicit `clear: bool = True` clears `movement_plan` back to `None`)
    - `loop: bool = False`
    - `dwell_minutes: int = 0`
    - `party_speed_modifier: float = 1.0`
    - `bypass_blocked_links: list[MovementLinkOverride] = []`
    - `known_secret_links: list[MovementLinkOverride] = []` *(requires GM Mode `unlock_lore = True`; returns `403` in Player Mode)*
  - Rejects attempts to assign a movement plan to the player's party (`422`).
  - Validates all `target_location_ids` exist on the active branch (`422` otherwise).
  - Computes the initial route via `build_movement_plan(...)`, persists on the active leaf turn's `world_state_snapshots.parties_json`, and returns `CampaignStateBundle`.
- **Optional Plan on Creation (`POST /api/campaigns/{campaign_id}/parties`):**
  - Extend `PartyCreateRequest` with optional `movement_plan: PartyMovementPlanUpdateRequest | None = None` (enforcing the same GM-Mode gate for `known_secret_links`).
- **Spoiler-Safe State Projection (`backend/app/db/repos/turns.py`):**
  - In `get_campaign_state`, when `not unlock_lore`:
    - Strip `known_secret_links` from returned `PartyRecord.movement_plan`.
    - Check if any leg `(u, v)` in `movement_plan.waypoints` uses an undiscovered secret edge (`is_secret=True` and not in `effective_revealed_edge_ids`): if so, mask/truncate the exposed `waypoints` before that secret leg (and if currently `in_transit` on an undiscovered secret edge, keep `in_transit=True` with masked next-waypoint so the UI shows `"In transit"` without revealing the hidden destination or secret link).
- **`.zcc` Campaign Export/Import (`zcc_campaign_io.py`):**
  - Verify `PartyRecord.movement_plan` round-trips cleanly in `WorldStateSnapshot.parties` with backward-compatible `movement_plan = None` default for older `.zcc` archives.
- **GM Talk & GM Tools (`gm_talk.py`, `gm_tools.py`):**
  - Expose NPP `movement_plan` summary (status, current stop / next waypoint, ETA, loop flag) in GM Talk party context and read-only party/location lookups, applying the same `unlock_lore` spoiler masking for undiscovered secret segments.

### FR-5: Frontend Party Modal & Map/Inspector UI
- **Party Management Modal (`PartyManagementModal.tsx`):**
  - Add a collapsible **"Movement Plan / Route"** section on each NPC-only party card (and optionally during NPC party creation):
    - Ordered target location picker (add/remove/reorder stops from active world locations).
    - Loop toggle (`Loop route`), optional `Dwell (min)` numeric input, and optional `Speed` multiplier.
    - Blocked-link bypass selector (`bypass_blocked_links`, showing currently blocked links).
    - **GM Mode (`unlock_lore`) only:** Secret-link knowledge selector (`known_secret_links`, showing secret links).
    - Live status badge (`Moving`, `In Transit · 45%`, `Dwelling · 12m left`, `Arrived`, `Paused on Scene`, `Blocked`) and `Save Route` / `Clear Route` actions.
- **Map Canvas & Details Drawer (`SpatialTopologyView.tsx`, `SpatialTopologyCanvas.tsx`, `MapDetailsDrawer.tsx`):**
  - **GM Mode (`unlock_lore = True`):**
    - Render subtle dashed route path overlays for NPPs with active movement plans (highlighting when an NPP or its departure/destination node is selected), plus an **in-transit badge/pill** positioned at `progress_ratio` along the active edge `(waypoints[0] -> waypoints[1])`.
    - Show full NPP route details in `MapDetailsDrawer` when inspecting a location with an assigned/departing/arriving NPP.
  - **Player Mode (`unlock_lore = False`):**
    - Do **not** draw full off-screen route overlays or any segment traversing an undiscovered secret link.
    - Show non-secret current/in-transit status cleanly (and hide `in_transit` NPP members from the departure room's present-character list so the map matches room presence).

---

## 4. Acceptance Criteria
1. **Pathfinding:** Given a directed graph with varying `distance_meters`, `speed_modifier`, `obstacles`, `is_blocked`, and `is_secret`, `compute_shortest_path` selects the lowest weighted travel-time path, avoids blocked/secret edges by default, and respects `known_secret_links` and `bypass_blocked_links` without inheriting `revealed_edge_ids`.
2. **Multi-Turn & Multi-Leg Advancement:** Short turns accumulate `leg_elapsed_minutes` with `in_transit=True` (excluding members from departure-room presence); long turns step across multiple waypoints and carry surplus time forward accurately.
3. **Player Interception:** An off-screen NPP whose route passes through `new_location_id` halts at `new_location_id` (`status="paused_on_scene"`, `in_transit=False`), emits an arrival event for Zone 4, and resumes automatically on a later turn once the player leaves.
4. **Loop & Time-Skip Safety:** A cyclic 2-stop or 3-stop loop with `dwell_minutes` advances cleanly across a 24-hour (`1440 min`) time skip in bounded O(stops) time with zero infinite-loop risk.
5. **Dynamic Map Edits & Branch Rewind:** Blocking or deleting an upcoming link triggers deterministic rerouting (or `status="blocked"` if unreachable); editing a link via CoW supersession does not break overrides or routes; rewinding a turn restores prior NPP position and transit progress.
6. **Snapshot Sync:** Moving an off-screen NPP persists synchronized `CharacterStateSnapshot` rows for every member so `reconcile_parties_strict_colocation` never splits or reverts the party.
7. **Spoiler Gating:** In Player Mode (`unlock_lore=False`), `known_secret_links` edits return `403`, and `get_campaign_state`, Map UI, and GM Talk never leak undiscovered secret edges via NPP routes.
