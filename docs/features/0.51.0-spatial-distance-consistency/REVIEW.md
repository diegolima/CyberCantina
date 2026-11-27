---
feature: spatial-distance-consistency
target_version: 0.51.0
document_type: review
status: completed
last_updated: 2026-11-27
---

# Pre-Implementation Review — Spatial Distance Consistency, Anchors & Overrides

## Architectural Traps & Mitigations

### 1. Circular Anchor / Outer-Scope Feedback Loops
- **Trap:** If *Sewers* contains *Tunnel 1-M* (anchored to *The Chop-Cathedral* in *Sector 9*) and *Sewer Entrance* (anchored to *The Sump-Well* in *The Neon Rust* inside *Sector 9*), solving *Sector 9* with *Sewers*' internal edges still present would pull *The Neon Rust* and *The Chop-Cathedral* toward *Tunnel 1-L ↔ Tunnel 1-M*'s stale `140m` length—corrupting the very anchors *Sewers* depends on.
- **Mitigation:** When `resolveOuterAnchorsForScope(scopeContainerId)` computes coordinates in an ancestor/LCA scope, it **strictly excludes** all edges internal to `scopeContainerId` (and its descendants) as well as cross-boundary edges terminating inside `scopeContainerId`. Outer geography always dictates inner anchor pins, never the reverse.

### 2. L1 Container Footprint Collapse vs. Internal Room Offsets
- **Trap:** In *The Green Lie*, *The Sump-Well* sits `NW 280m` from *Main Floor* inside *The Neon Rust*, while *Main Floor* sits `E 1500m` from *The Chop-Cathedral*. Including *The Sump-Well*'s `280m NW` room offset when projecting *Sector 9* shifts *Sewer Entrance*'s anchor by `~198m` relative to *Main Floor*, yielding `~1698m` instead of `1500m`.
- **Mitigation:** At any parent scope (`scopeContainerId`), child containers (such as L1 buildings) collapse to a single macro node (`cont:<container_id>`). All locations inside that child container map to that shared macro node at the parent scope, keeping building-interior offsets encapsulated inside the building while aligning *Sewer Entrance* cleanly with *The Neon Rust ↔ The Chop-Cathedral* (`1500m`).

### 3. Bidirectional Edge Pair Desync
- **Trap:** Updating `distance_mode` (e.g. `locked` or `non_euclidean`) or `is_vertical` on only the forward `LocationEdge` while leaving the reciprocal edge as `flexible` / horizontal causes conflicting constraints or inconsistent UI states depending on which direction is inspected.
- **Mitigation:** Mirror `distance_mode` and `is_vertical` symmetrically across bidirectional pairs in `useTopologyMutations.ts` (`handlePatchEdgePair`), `update_campaign_edge` (`update_reciprocal=True`), `update_campaign_map`, and `update_world`. On read/reduction in `spatialConsistency.ts`, treat `non_euclidean` > `locked` > `flexible` and `OR` `is_vertical` defensively while emitting an `asymmetric_pair` diagnostic if raw DB rows ever diverge.

### 4. Numerical Conditioning, Unanchored Components & Active-Set Oscillation
- **Trap:** Raw meter values range from `1m` to `100,000,000m`, so unnormalized weights can overflow or produce ill-conditioned matrices; unanchored connected components have a 2D translational nullspace; and naive unconstrained least-squares can propose negative or `0m` lengths when compass bearings conflict.
- **Mitigation:**
  - Normalize `α_e = (M / max(d_e^(0), 10))^2` using the scope's median edge length $M$.
  - Pin one deterministic root DOF to `(0, 0)` for any connected component without an outer anchor pin, and add Tikhonov regularization ($\epsilon = 10^{-8}$) in dense Cholesky.
  - Run an active-set clamping outer loop (capped at 8 passes) when any flexible $d_e^* < 1$; if a clamped edge retains residual above tolerance, classify it as `compass_conflict` (`error`) rather than emitting a bogus `1m` suggestion.

### 5. Dangling or Invalid `anchor_location_id` Lifecycle
- **Trap:** Deleting a target location, moving an anchored location to `World Root`, reparenting an anchored location into the same container (or ancestor/descendant) as its anchor, forking a world (`update_world` CoW), or importing a `.zcc` archive can leave stale or cyclic `anchor_location_id` references.
- **Mitigation:**
  - Enforce `isValidSpatialAnchor` (target must exist, `anchored.container_id != null`, target must sit strictly outside `anchored.container_id`'s container subtree) in both frontend mutations and backend validators (`schemas/world.py`, `campaign_map_update.py`, `worlds.py`).
  - Automatically clear `anchor_location_id` whenever a node moves to `World Root`, enters the same subtree as its target, or its target is deleted.
  - Remap `anchor_location_id` through `loc_id_map` on CoW world forks and `.zcc` imports.

### 6. Secret Edge Spoiler Leakage in Campaign Player Mode
- **Trap:** In Campaign mode with GM Mode OFF (`unlock_lore == False`), an undiscovered `is_secret` shortcut could trigger a `triangle_inequality` or `distance_mismatch` warning visible to the player, leaking the existence and distance of the hidden passage!
- **Mitigation:** In `spatialConsistency.ts`, when `mode === "campaign" && !unlockLore`, filter out undiscovered secret edges (`is_secret && !isEdgeRevealed(...)`) before building the solver graph, matching `topologyProjection.ts` visibility rules. Full hidden-edge checking runs in Editor mode and GM Mode (`unlock_lore == True`).

### 7. Auto-Sync Surprises, Non-Blocking Saves & Undo Ergonomics
- **Trap:** Silent mutations to other links on every keystroke or blocking map saves on unfinished WIP topologies would frustrate authors.
- **Mitigation:**
  - Consistency checks are strictly **non-blocking**—authors can always save a map with warnings or errors.
  - **Auto-Sync Unlocked Links** defaults to **OFF**, only adjusts `flexible` edges within the currently viewed scope, and commits both the user's edit and any auto-synced adjustments as **one atomic Undo snapshot** with a clear `statusNotice`.
  - **Preview Reconciliation** follows the same non-destructive Preview → Apply/Cancel pattern as Auto-Layout, pushing a single Undo snapshot on Apply.

### 8. Campaign Map Edit Permissions & Branch Safety
- **Trap:** `campaign_map_update.py` restricts modifying narrative fields on visited locations unless GM Mode (`unlock_lore`) is enabled, and `campaign_spatial_overrides` must preserve branch rewind/checkout isolation.
- **Mitigation:**
  - Store campaign branch `anchor_location_id` overrides inside `campaign_spatial_overrides.metadata_override_json` (`_apply_campaign_spatial_overrides` overlays them chronologically across `valid_turn_ids`).
  - Treat `anchor_location_id` as structural spatial metadata (alongside `ui_x`/`ui_y` and `is_entry_exit`) while respecting visited-edge restrictions in `campaign_map_update.py` (`gm_unlocked` gates modifying existing visited-endpoint edges, consistent with `distance_meters` / `speed_modifier`).

### 9. SQLite Migration, Layer Boundaries & Map Editor Contracts
- **Trap:** Existing `cybercantina.db` and `.zcc` files lack the new columns; `frontend/.dependency-cruiser.cjs` forbids upward imports from `types/`; `css:audit` rejects `!important`; Vitest runs in Node without `jsdom`; and `AGENTS.md` forbids `<input>` inside `<foreignObject>` or full-line red edge recoloring.
- **Mitigation:**
  - Add idempotent `ALTER TABLE` migrations + safe defaults in `schema_init.py` and Pydantic models.
  - Keep `DistanceMode` in `frontend/src/types/world.ts` and the pure solver in `frontend/src/components/map/spatialConsistency.ts`.
  - Style badges/banners with `00-tokens.css` variables and zero `!important`, using amber warning indicators on badges (never full-line red recoloring) and pure screen-space HTML popovers.
