---
feature: metric-spatial-distances
target_version: 0.36.0
document_type: review
status: completed
last_updated: 2026-11-24
---

# Pre-Implementation Review — v0.36.0 Metric Spatial Edge Distances

## Key Architectural Traps & Mitigations

1. **Avoiding `70x` Clock Inflation in LLM & Heuristic Simulation:**
   - **Trap:** Replacing `travel_minutes` with `distance_meters` in `zone4_ephemeral.py` or `clerk/pipeline.py` as bare `{n.distance_meters}m` (or letting `heuristics.py` consume `distance_meters` directly) would cause 12B local models or offline heuristics to interpret `700m` as `700 minutes` (~12 hours) per room transition.
   - **Mitigation:** `zone4_ephemeral.py` and `clerk/pipeline.py` must format exits with **both** physical distance and derived walking duration (e.g., `[700m, ~10 min walk]`), and `clerk/heuristics.py` must route through `derive_walking_minutes(nb.distance_meters)` (`max(2, derived + 1)`) clamped to `MAX_TURN_ELAPSED_MINUTES_SANITY`.

2. **Double-Multiplication Risk on Legacy Migration & `.zcc` Import:**
   - **Trap:** An unconditional `* 70` transform during import or schema migration would multiply already-metric `distance_meters` values by 70, turning `700m` into `49km`.
   - **Mitigation:** In `schema_init.py`, only backfill `distance_meters = MAX(1, COALESCE(travel_minutes, 1) * 70)` when migrating a `location_edges` table that lacks `distance_meters` and still has `travel_minutes`. In `.zcc` / JSON import (`import_export_service.py`, `zcc_campaign_io.py`, `seed.py`) and Pydantic `@model_validator(mode="before")` shims, prefer `distance_meters` verbatim whenever present and apply `travel_minutes * 70` **only** when `distance_meters` is absent/`None`.

3. **SQLite `location_edges` Table Rebuild Safety:**
   - **Trap:** Dropping `travel_minutes` or rebuilding `location_edges` in `schema_init.py` must preserve `idx_location_edges_from` and foreign-key cascade behavior (`worlds(id)`, `location_nodes(id)`) without triggering cascade deletes while copying rows.
   - **Mitigation:** Follow `schema_init.py`'s existing migration guard (`PRAGMA foreign_keys = OFF` during table rebuild inside transaction, re-create `idx_location_edges_from`, restore `PRAGMA foreign_keys = ON`) and test migration against a pre-v0.36.0 SQLite DB fixture containing `location_edges.travel_minutes`.

4. **Custom User Prompt Presets Still Referencing `travel_minutes`:**
   - **Trap:** Users with saved custom prompt presets in SQLite (`prompt_presets`) for `clerk_post_turn` or `world_wizard` may still ask the LLM to emit `travel_minutes` inside `improvised_location` or `LocationEdgeDraft`.
   - **Mitigation:** Keep a `@model_validator(mode="before")` legacy fallback on `ImprovisedLocationSpec` and `LocationEdgeDraft` that maps `travel_minutes` -> `distance_meters` (`* 70`) if the LLM emits the legacy key, and update `defaults.py` prompts + `required_properties` for `complete_structured`.

5. **Map Badge Single-Click vs. Double-Click & Mobile Deselection Races (`SpatialTopologyCanvas.tsx`):**
   - **Trap A (Desktop):** Toggling badge text on single-click changes `badgeWidth` (`350m` -> `~5 min`), which could shift hit bounds or collide with `onDoubleClick` inline editing if not anchored carefully.
   - **Trap B (Mobile Campaign Mode):** In `SpatialTopologyCanvas.tsx`, `finishGesture` deselects the active node whenever `pendingTapTargetRef.current` is `null`. Currently `mode !== "editor"` does not set `pendingTapTargetRef.current` on badge `onPointerDown`, so tapping a badge in campaign mode would deselect the active node.
   - **Mitigation:**
     - Stop pointer/click propagation on the badge `<g>` on desktop and toggle `pairKey` in `previewTimePairKeys`. Keep `inlineEdgeEdit` anchored to `(clipped.midX, clipped.midY)` and open cleanly on `onDoubleClick` (and Layer 4 quick-delete `"X"` recomputes `qx = clipped.midX + badgeWidth / 2 - 1` from the active `badgeWidth`).
     - On mobile/touch, set `pendingTapTargetRef.current` for badges in **both** modes: `{ kind: "edge", openEditor }` in editable `editor` mode, and `{ kind: "edge-preview", pairKey }` in `campaign`/locked mode so tapping a badge never falls through to empty-canvas deselection.

6. **Layer Boundaries, Facade Parity & CSS Discipline:**
   - **Trap:** Importing backend schema helpers across prohibited `tach.toml` boundaries or adding new UI helpers that violate `.dependency-cruiser.cjs` (`arch:check`).
   - **Mitigation:** Keep canonical distance constants/formatters in leaf schema/helper modules (`backend/app/schemas/world.py` and `frontend/src/components/map/topologyProjection.ts` or a leaf helper imported there), keep all `SpatialTopologyCanvas.tsx` / `MapDialogs.tsx` changes aligned with `css:audit`, and re-export any new/updated symbols through existing facades if referenced externally.
