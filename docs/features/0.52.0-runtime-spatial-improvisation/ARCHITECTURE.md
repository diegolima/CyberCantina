---
feature: runtime-spatial-improvisation
target_version: 0.52.0
document_type: architecture
status: completed
last_updated: 2026-11-27
---

# Technical Architecture — Runtime Spatial Improvisation & Link Discovery

## 1. Pure Spatial Geometry & Travel Cue Engine (`backend/app/engine/spatial_geometry.py`)

Create a focused, dependency-light module importing only stdlib (`math`, `re`, `heapq`, `dataclasses`) and `app.schemas.world` / `app.schemas.affective` so it complies cleanly with `tach.toml` (`app.engine.*`):

1. **`COMPASS_UNIT_VECTORS`**: Exact match to `frontend/src/components/map/spatialConsistency.ts` (`N: (0,1)`, `NE: (√½, √½)`, ..., `NW: (-√½, √½)`), plus `vector_to_compass(dx, dy) -> CompassDirection`.
2. **2D Coordinate & Scope Projection (`compute_visible_scope_positions`)**:
   - Filters `world.edges` strictly to edges **visible on the current state**: when `not gm_unlocked`, excludes any edge with `is_secret == True` unless its `id` is in `revealed_edge_ids` or its canonical undirected endpoint pair was revealed.
   - Uses Union-Find to contract `is_vertical` edges into shared horizontal positions and collapses child containers to their macro centroid/origin relative to `active_location`'s scope (matching v0.51.0 `spatialConsistency.ts` horizontal projection semantics via BFS spanning tree + averaged loop positions for connected components).
   - Exposes `estimate_euclidean_offset(from_id, to_id, world, revealed_edge_ids) -> GeometricOffset | None`: returns `{distance_meters, bearing, dx, dy, is_connected_2d}`. Returns `None` if either endpoint lies in a disconnected 2D component or only connects through `non_euclidean` / hidden `secret` edges.
3. **Shortest Visible Path (`find_shortest_visible_path`)**:
   - Dijkstra over visible edges weighting hops by `travel_minutes` (secondary tie-breaker: hop count).
   - Returns `{path_node_ids, hop_count, total_distance_meters, total_travel_minutes}` for multi-hop `move_existing`.
4. **Spoiler-Safe Candidate Selection (`select_candidate_known_locations`)**:
   - Excludes `active_location_id` and direct 1-hop visible neighbor IDs.
   - Keeps locations matching **any** of:
     - `loc.id in visited_location_ids`
     - `loc.is_starting_location`
     - Reachable in `1 < hops <= 3` along visible non-secret (or revealed) edges.
   - Sorts by `(is_visited_or_start desc, shortest_hops asc, name asc)` and caps at `20` entries, attaching shortest hop count and `estimate_euclidean_offset` (when connected horizontally).
5. **ReDoS-Safe Travel Cue Parser (`extract_travel_cues`)**:
   - Parses explicit distance (`400m`, `500 meters`, `1.5 km`), explicit walking/travel time (`10 minutes`, `half an hour`, `2 hours`), mode/speed hints (`sprint`/`run`/`dash` → `2.0x`, `bike`/`horse`/`mount` → `3.0x`, `car`/`truck`/`drive` → `10.0x`), vertical hints (`stairs`, `ladder`, `hatch`, `shaft`, `elevator`, `basement`, `downstairs`, `upstairs` → `is_vertical = True`), and non-Euclidean hints (`portal`, `wormhole`, `rift`, `teleport`, `folded space` → `distance_mode = "non_euclidean"`).
   - Uses bounded non-overlapping regexes (`\d{1,5}(?:\.\d{1,2})?` + bounded word gaps, zero nested `.*?` quantifiers) verified against Py/Polynomial-ReDoS patterns.

---

## 2. Schema Contracts (`backend/app/schemas/turn.py`)

1. **`ImprovisedLocationSpec`**:
   - Add `distance_mode: EdgeDistanceMode = "flexible"` and `is_vertical: bool = False` (both normalized via `@field_validator`, coerced safely for older JSON without warnings, and included in `json_schema_extra["required"]` for local 12B grammar reliability).
2. **`ImprovisedLinkSpec`** *(new)*:
   - Fields:
     - `to_location_id: str`
     - `entry_direction_label: str = "Direct route"`
     - `return_direction_label: str = "Back the way you came"`
     - `compass_direction: CompassDirection = "N"`
     - `distance_meters: int = Field(default=DEFAULT_EXTERIOR_DISTANCE_METERS, ge=1, le=MAX_EDGE_DISTANCE_METERS)`
     - `speed_modifier: float = Field(default=DEFAULT_EDGE_SPEED_MODIFIER, ge=MIN_EDGE_SPEED_MODIFIER, le=MAX_EDGE_SPEED_MODIFIER)`
     - `travel_mode: str | None = None`
     - `distance_mode: EdgeDistanceMode = "flexible"`
     - `is_vertical: bool = False`
     - `clamped_from_meters: int | None = None` *(audit metadata recorded when 2D geometry clamping adjusted the raw distance)*
   - Enforces `required=list(properties.keys())` in `json_schema_extra` (`distance_mode`, `is_vertical`, `speed_modifier`, etc. never omitted during generation).
3. **`PreTurnAnalysis` / `PreTurnLLMOutput`**:
   - Expand `spatial_intent: Literal["stay", "move_known", "explore_new", "connect_existing"] = "stay"`.
4. **`WorldPostTurnDelta` & `PostTurnStateDelta`**:
   - Expand `transition_type: Literal["stay", "move_existing", "improvise_new", "connect_existing"] = "stay"`.
   - Add `improvised_link: ImprovisedLinkSpec | None = None` and optional audit list `traversed_location_ids: list[str] = Field(default_factory=list)` for multi-hop `move_existing` telemetry & `AgentChangesModal`.
   - Keep `WorldPostTurnDelta` top-level `required` behavior compatible; `improvised_link` stays nullable (`None` on `stay`/`move_existing`/`improvise_new`).

---

## 3. Repository Layer (`backend/app/db/repos/world_locations.py`)

1. **`add_improvised_location(...)`**:
   - Pass `distance_mode=spec.distance_mode` and `is_vertical=spec.is_vertical` into both forward and reciprocal `_insert_edge_row` calls (replacing implicit defaults while preserving existing signature compatibility).
2. **`add_improvised_link(...)`** *(new)*:
   - Parameters: `world_id`, `from_location_id`, `to_location_id`, `created_at_turn_id`, `spec: ImprovisedLinkSpec`, `valid_turn_ids: set[str] | None = None`.
   - Validates `from_location_id != to_location_id` and both exist on `valid_turn_ids`.
   - Checks active neighbors on `valid_turn_ids`:
     - If a **visible** edge `(from_location_id -> to_location_id)` already exists, returns `(existing_edge, created=False)` without duplicating it.
   - Assigns independent free compass slots (`pick_available_compass_direction`) on `from_location_id` (`fwd_dir`) and `to_location_id` (`OPPOSITE_COMPASS[fwd_dir]` or nearest free slot on `to_location_id`).
   - Inserts forward and reciprocal edges inside one transaction with `created_at_turn_id`, `distance_meters`, `speed_modifier`, `travel_mode`, `distance_mode`, and `is_vertical`.
   - Note on 8-neighbor overflow: mirrors `connect_campaign_locations` when both nodes have `< 8` distinct neighbors; if `from_location_id` already has `>= 8` neighbors, delegates through existing Passage Hub overflow helper (or picks the least-loaded free slot if hub routing applies) so no node exceeds 8 direct slots cleanly.

---

## 4. Pipeline Flow (Phase 1 -> Phase 4 -> Phase 5 Clerk)

```
User message ("I walk 5 minutes back to the plaza")
   │
   ▼
Phase 1 (phase1_pre.py):
  - Shows Adjacent Exits + Other Known Locations (capped 20, spoiler-filtered)
  - Heuristic detects non-adjacent known match:
      * retrace keywords ("back through", "retrace") -> spatial_intent="move_known"
      * direct shortcut/walk to non-adjacent known    -> spatial_intent="connect_existing"
   │
   ▼
Phase 5 World Clerk (clerk/pipeline.py + spatial_geometry.py):
  - Prompt shows Known Exits + Other Known Locations (with hops + ~783m SE geometry hint)
  - Explicit 70 m/min walking pace rule in clerk_post_turn_system
  │
  ├─► Case A: transition_type == "improvise_new"
  │     1. Duplicate-name guard checks visible neighbors + eligible known locations
  │        -> coerces to move_existing or connect_existing if matched!
  │     2. Otherwise extracts travel cues -> aligns distance_meters with stated time/distance
  │     3. Persists node + edges (including distance_mode, is_vertical) via add_improvised_location
  │     4. Sets min_travel_minutes = derive_travel_minutes(distance_meters, speed_modifier)
  │
  ├─► Case B: transition_type == "connect_existing"
  │     1. Verifies target_location_id in eligible known locations (not behind hidden secret)
  │     2. If 1-hop visible edge already exists -> falls back cleanly to move_existing
  │     3. Computes geometric offset via estimate_euclidean_offset(active_id, target_id)
  │        - If Euclidean & !non_euclidean & !is_vertical:
  │            clamps distance_meters = offset.distance_meters, sets compass_direction = offset.bearing,
  │            records clamped_from_meters if adjusted!
  │     4. Persists bidirectional edges via add_improvised_link
  │     5. Sets min_travel_minutes = derive_travel_minutes(final_distance_meters, speed_modifier)
  │
  └─► Case C: transition_type == "move_existing"
        1. If target in 1-hop neighbors -> single-hop transition (existing behavior)
        2. Else if target reachable via shortest visible path in eligible known locations ->
             multi-hop transition: sums hop travel durations for min_travel_minutes,
             records traversed_location_ids + visited_container_ids without creating new edges
```

---

## 5. Frontend & Reference Catalog Updates

- `frontend/src/types/turn.ts`: Add `ImprovisedLinkSpec`, expand `transition_type` / `spatial_intent` union to include `"connect_existing"`, add `distance_mode` / `is_vertical` on `ImprovisedLocationSpec`, add `improvised_link` & `traversed_location_ids` on `PostTurnStateDelta`.
- `frontend/src/components/inspector/AgentChangesModal.tsx`: Render `connect_existing` card (`Linked new route to <Target>` + compass bearing, metric distance, `Locked`/`Non-Euclidean`/`Vertical` pills, and amber `Geometry Clamped (from Xm)` badge when `clamped_from_meters` is set) plus multi-hop `traversed_location_ids` breadcrumb chips cleanly.
- `frontend/src/components/world/mechanics/mechanicsCatalog.ts` + `backend/app/reference/game_mechanics_catalog.json`: Document runtime link improvisation, 70 m/min alignment, geometry clamping on non-adjacent shortcuts, and multi-hop backtracking in `spatial-links-travel`.
