---
feature: runtime-spatial-improvisation
target_version: 0.52.0
document_type: frd
status: completed
last_updated: 2026-11-27
---

# Feature Requirements Document — Runtime Spatial Improvisation & Link Discovery

## 1. Overview & Motivation

CyberCantina v0.51.0 introduced map-authoring spatial distance consistency, external anchors, and link constraint modes (`flexible`, `locked`, `non_euclidean`, `is_vertical`). However, during **live campaign play**, runtime spatial improvisation via Phase 1 Pre-Turn Analysis and Phase 5 World Clerk has two structural gaps illustrated by a simple 4-turn walk:

1. **Turn 0:** Player starts on the **Plaza**.
2. **Turn 1 (`move_existing`):** Player walks 5 minutes West (`350m` at `70 m/min`) to the **Bar**.
3. **Turn 2 (`improvise_new`):** Player says *"I walk 10 minutes north into the street"*, improvising a **Street** node North of the **Bar**.
   - Currently, the Clerk prompt gives only coarse ranges (`80-500m`) without stating the `70 m/min` walking conversion, `pipeline.py` only enforces the `min_travel_minutes` travel-time floor on `move_existing` (skipping `improvise_new`), and the heuristic fallback ignores explicit time/distance cues and hardcodes `100m` / `4 min`.
4. **Turn 3 (returning to Plaza):** At the **Street**, the player says *"I walk 5 minutes back to the plaza"*.
   - Currently, the Clerk only sees 1-hop `Known Exits` (`Bar`), cannot tell **Plaza** already exists, and `WorldPostTurnDelta.transition_type` only allows `"stay" | "move_existing" | "improvise_new"`. The player either stays stuck at `Street` (when `target_location_id` fails the 1-hop neighbor guard) or spawns a disconnected duplicate `"Plaza"` node.
   - Furthermore, linking `Street ↔ Plaza` directly at 5 minutes (`350m`) conflicts with the existing 2D map geometry (`Bar` sits `350m W` of `Plaza` and `Street` sits `700m N` of `Bar`, making `Street ↔ Plaza` $\sqrt{350^2 + 700^2} \approx 783\text{m SE}$, ~11 min walking).

---

## 2. Functional Requirements

### FR-1: Accurate Distance & Clock Alignment on `improvise_new`
1. **Prompt Guidance (`clerk_post_turn_system`):** Explicitly specify the base walking pace rule (`70 m/min ≈ 4.2 km/h`, e.g., `5 min walk ≈ 350m`, `10 min walk ≈ 700m`) alongside sprint/mount/vehicle pace multipliers, and document optional `is_vertical` (ladders, stairs, hatches, elevators) and `distance_mode` (`"flexible"` default; `"non_euclidean"` strictly for supernatural portals/folded space).
2. **Deterministic Walk-Cue Alignment:** When the player message explicitly states a walking/travel duration (`"10 minutes"`, `"half an hour"`, etc.) or distance (`"400m"`, `"1.2 km"`):
   - Parse explicit distance/duration cues deterministically via a ReDoS-safe parser (`extract_travel_cues`).
   - Derive/align `ImprovisedLocationSpec.distance_meters` when omitted, default-valued, or contradicted by an explicit stated duration/distance under normal walking pace (respecting speed modifiers when running/driving/riding).
3. **Travel-Time Clock Floor on `improvise_new`:** Apply the same `min_travel_minutes` speed-adjusted floor (`derive_travel_minutes(distance_meters, speed_modifier)`) in `clerk/pipeline.py` for `improvise_new` as already enforced for `move_existing`.
4. **Offline Heuristic Fallback Parity (`clerk/heuristics.py`):** Use `extract_travel_cues` to populate `distance_meters` and `elapsed_minutes` instead of hardcoding `100m`/`20m` and `4 min`.
5. **`is_vertical` & `distance_mode` Support:** Allow `ImprovisedLocationSpec` to carry optional `is_vertical: bool = False` and `distance_mode: EdgeDistanceMode = "flexible"` so newly improvised vertical shafts/ladders or portals persist accurate edge flags via `add_improvised_location`.

### FR-2: Spoiler-Safe Known Non-Adjacent Location Awareness
1. Expose a compact, token-bounded `Other Known Locations` list (capped at `20` entries, excluding current room and 1-hop `Known Exits`) to Phase 1 and Phase 5 World Clerk prompts whenever non-adjacent eligible locations exist.
2. **Eligibility Filter:** Include an existing location **only if**:
   - It is in `visited_location_ids`, OR `is_starting_location`, OR reachable within `<= 3` hops from `active_location` strictly along **non-secret or already-revealed** edges.
   - **Never** expose locations only reachable behind unrevealed `is_secret` edges—preserving full Player Mode anti-spoiler guarantees.
3. Each entry provides: `id`, `name`, container breadcrumb (if any), shortest visible hop count, and (when reachable in the same 2D horizontal frame) implied compass bearing & Euclidean straight-line distance from `active_location` (e.g., `id='loc_plaza': Plaza (2 hops away; ~783m SE straight-line)`).

### FR-3: Non-Adjacent Transitions (`connect_existing` and Multi-Hop `move_existing`)
Add `"connect_existing"` to `WorldPostTurnDelta.transition_type`, `PostTurnStateDelta.transition_type`, and `PreTurnAnalysis.spatial_intent` (plus optional `"connect_existing"` handling cleanly across Phase 1 & Phase 5):

1. **`connect_existing` (`ImprovisedLinkSpec`):**
   - Used when narrative prose establishes a **new direct route, alley, door, shortcut, staircase, or portal** from `active_location` to an existing non-adjacent known location (`target_location_id`).
   - Persists bidirectional branch-scoped edges (`created_at_turn_id = completed_turn.id`) via `repo.add_improvised_link(...)`, assigning independent free compass ports on both endpoints cleanly without violating 8-neighbor caps.
   - **2D Geometry Clamping (Approved Rule):** Unless `distance_mode == "non_euclidean"`, `is_vertical == True`, or the two locations sit in disconnected/unresolvable 2D components, **clamp `distance_meters` to the geometrically implied 2D Euclidean distance** between `active_location` and `target_location_id` (e.g., `783m SE` for `Street ↔ Plaza` even when the user wrote *"I walk 5 minutes back to the plaza"*):
     - Automatically re-aligns `compass_direction` to the 2D geometric bearing (`SE`) when conflicting.
     - Computes `min_travel_minutes` from the clamped `distance_meters` and the link's `speed_modifier` (preserving faster travel time when narrative/speed modifier explicitly describes sprinting, cycling, transit, or vehicles, while clamping walking trips accurately to ~11 min).
     - Only bypasses Euclidean clamping when narrative explicitly describes a **magic portal, teleport, or spatial anomaly** (`distance_mode = "non_euclidean"`) or pure **vertical climb/drop** (`is_vertical = True`).
2. **Multi-Hop `move_existing` (Retracing Existing Routes Without Creating a Shortcut):**
   - Used when narrative prose shows the protagonist **walking back/along already mapped streets or rooms** (e.g., *"I walk back through the bar to the plaza"*) rather than discovering/opening a new shortcut.
   - `clerk/pipeline.py` accepts `world_delta.target_location_id` when it is reachable along **visible non-secret (or revealed) edges** from `active_location` (via shortest path Dijkstra on the visible graph):
     - Moves `active_location_id` to `target_location_id` **without creating any new edge**.
     - Computes `min_travel_minutes` from the **sum of visible path hop durations** (`sum(distance_meters / (70 * speed_modifier))`) along the shortest path.
     - Appends intermediate traversed locations (and their containers, if newly crossed) to `visited_location_ids` and `visited_container_ids`.

### FR-4: Deterministic Duplicate-Location Prevention Guard
When the Clerk emits `transition_type == "improvise_new"` and `improvised_location.name` matches (case-insensitive normalized name match, stripping leading `"the "`) either:
- An existing 1-hop visible neighbor: coerce deterministically to `move_existing` (`target_location_id = neighbor.destination.id`).
- An eligible known non-adjacent location (not behind an unrevealed secret-only boundary): coerce deterministically to `connect_existing` (with geometry clamping applied) or multi-hop `move_existing` when text cues indicate retracing a known path (`"back through"`, `"retrace"`, `"return along"`), preventing duplicate nodes like a second `"Plaza"`.

### FR-5: Party Followers, Timeline Rewind Safety & UI Visibility
1. **Party & NPC Resolution:** Co-traveling party/following NPCs in `parties.py` resolve cleanly to the destination node for both `connect_existing` and multi-hop `move_existing` (since `new_player_location_id` is passed cleanly), while non-adjacent independent NPC transitions remain blocked unless explicitly permitted.
2. **Timeline Branch & Swipe Safety:** Improvised links carry `created_at_turn_id = completed_turn.id` and `superseded_at_turn_id = NULL`, so deleting/rewinding turns or importing `.zcc` v2 campaign snapshots removes or preserves them identically to improvised rooms.
3. **Secret-Link Protection:** If `target_location_id` only connects to `active_location` via an unrevealed `is_secret` edge, `add_improvised_link` skips creating a duplicate parallel link only when a **visible** edge exists, OR better: if an existing edge already connects `(from_location_id, to_location_id)`, `connect_existing` treats unrevealed secret edges cautiously—if a visible edge already exists, it coerces to `move_existing`; if the Clerk legitimately improvises a public route to a visited destination, creating the public edge respects campaign isolation while never revealing the base-world `is_secret` edge.
4. **UI Audit Modal (`AgentChangesModal.tsx`) & In-App Codex:** Display `connect_existing` cleanly with compass bearing, metric distance, `Locked` / `Non-Euclidean` / `Vertical` pills, and an indicator when geometry clamping adjusted the distance (e.g., `Clamped to 783m geometry`), and sync `mechanicsCatalog.ts` + `game_mechanics_catalog.json`.

---

## 3. Non-Goals
- Mutating pre-authored `location_edges` distances at runtime (only newly improvised runtime links are clamped/created).
- Allowing AI clerks to teleport players across completely hidden unvisited map regions gated strictly by unrevealed secrets.
- Modifying Zone 1 static system prompts or affecting turn token caching.
