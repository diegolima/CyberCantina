---
feature: map-auto-layout
target_version: 0.38.0
document_type: review
status: approved
last_updated: 2026-11-24
---

# Pre-Implementation Review — v0.38.0 Scoped Map Auto-Layout

## Key Architectural Traps & Mitigations

1. **Scale Extremes & Wide Container Supernodes:**
   - `distance_meters` spans `1m` to `100,000,000m`, while `LOCATION_TILE_SIZE` is `36×36` and `CONTAINER_CARD_W × CONTAINER_CARD_H` is `148×50`.
   - Linear pixel scaling or fixed radial repulsion (`minDist = 115`, as in `computeFullMapCoords`) will either collapse short links or horizontally overlap container cards.
   - **Mitigation:** Use a monotonic log-compressed curve clamped to `[150, 460]` SVG units plus footprint-aware edge clearance and iterative AABB overlap separation using the same footprints as `visibleFootprints` in `SpatialTopologyView.tsx`.

2. **Aggregated Supernode Edges & Secret Precedence:**
   - `projectTopologyForDepth` aggregates cross-boundary links into `ProjectedTopologyEdge` (`isAggregated: true`) using `first.compass_direction` and `minMeters`, which can accidentally pick a secret passage or a reverse-oriented edge.
   - **Mitigation:** Reduce edges directly from `pe.groupedEdges ?? [pe.rawEdge]` per unordered visible node pair `{u, v}`, preferring non-secret edges when any exist and orienting reverse edges via `OPPOSITE_COMPASS`.

3. **Preview Mode vs. `isMutatingLocked` & `Save Map`:**
   - Allowing node drags, palette drops, `Delete`, `Undo`, or `Save Map` during Preview creates ambiguous state transitions when the user clicks **Reset**.
   - **Mitigation:** Derive `effectiveMutatingLocked = isMutatingLocked || Boolean(autoLayoutPreview)` for canvas/palette/drawer/toolbar mutation controls, while keeping Pan, Zoom, Center, and node/edge selection active. Auto-cancel preview if `currentContainerId` changes, `isMutatingLocked` becomes `true`, or `unlockLore` is revoked in campaign mode.

4. **Asymmetry Between `LiveInspector` and `WorldInspectorModal` Permissions:**
   - `WorldInspectorModal` sets `isMutatingLocked = true` when `isCampaignMode && !campaignUnlockLore`, whereas `LiveInspector` passes `isMutatingLocked = isStreaming || isPhase4Running` (allowing manual coordinate drags even without GM Mode).
   - **Mitigation:** Gate Auto-Layout visibility and execution explicitly on `(mode === "editor" || unlockLore) && !isMutatingLocked` inside `SpatialTopologyView`, ensuring identical spoiler-safe behavior on both map surfaces.

5. **Ghost External Nodes (`ghost_coords`) Alignment:**
   - Inside a container view, previously dragged ghost portals have persisted `ghost_coords` on `currentScopeContainer`. If left pinned during preview or after apply, ghosts will sit far from the newly positioned interior portals.
   - **Mitigation:** During Preview, call `computeGhostNodeCoords(..., undefined, visibleFootprints)` against `previewCoords` so ghosts align live; on **Apply**, clear `ghost_coords: {}` on `currentScopeContainer` in the same `commitNextGraph(..., true)` snapshot so `Undo` restores prior ghost positions too.

6. **Layering, Node-Only Vitest & CSS Hygiene:**
   - Keep `frontend/src/components/map/mapAutoLayout.ts` pure and free of DOM/React imports so it passes `arch:check` (no runtime cycles) and can be exhaustively unit-tested under Node-only Vitest alongside `ReactDOMServer.renderToStaticMarkup` assertions.
   - Place new styles in `frontend/src/styles/13-parties-and-map-search.css` and responsive overrides in `frontend/src/styles/15-responsive.css` (last), referencing every added class in TSX so `npm --prefix frontend run css:audit` stays green.
   - Avoid using `--accent-rose` / red for Auto-Layout buttons or the Preview banner; reserve rose strictly for errors and destructive actions.
