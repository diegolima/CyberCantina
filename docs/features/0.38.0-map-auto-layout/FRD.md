---
feature: map-auto-layout
target_version: 0.38.0
document_type: frd
status: completed
last_updated: 2026-11-24
---

# Feature Requirements Document (FRD)
## Scoped Map Auto-Layout with Non-Destructive Preview

**Status:** Completed (`v0.38.0`)  
**Target Version:** CyberCantina v0.38.0  
**Depends On:**
- [v0.10.0 Interactive Spatial Topology Map Editor](file:///home/diegolima/Git/cybercantina/docs/features/0.10.0-interactive-map-editor/FRD.md)
- [v0.11.2 Stable Canvas & Ghost Portals](file:///home/diegolima/Git/cybercantina/docs/features/0.11.2-stable-canvas-and-ghost-portals/FRD.md)
- [v0.31.0 Campaign Lore, GM Mode & Major Events](file:///home/diegolima/Git/cybercantina/docs/features/0.31.0-campaign-lore-gm-mode-and-major-events/FRD.md)
- [v0.31.1 Mobile Map UX](file:///home/diegolima/Git/cybercantina/docs/features/0.31.1-mobile-map-ux/FRD.md)
- [v0.36.0 Metric Spatial Edge Distances](file:///home/diegolima/Git/cybercantina/docs/features/0.36.0-metric-spatial-distances/FRD.md)
- [v0.37.0 First-Class Map Links](file:///home/diegolima/Git/cybercantina/docs/features/0.37.0-first-class-map-links/FRD.md)

**Expected Scope:**
- **Frontend Pure Layout Engine & Viewport Helpers:**
  - `frontend/src/components/map/mapAutoLayout.ts` (new pure module: edge reduction, log-compressed distance scaling, compass-guided BFS seed, stress/spring refinement, AABB overlap separation, disconnected component packing, and viewport fit calculation)
  - [`frontend/src/components/map/topologyProjection.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/topologyProjection.ts) (read-only consumption of `ProjectedDepthTopology`, `COMPASS_ANGLES`, `OPPOSITE_COMPASS`, `computeGhostNodeCoords`)
- **Frontend Map UI & State:**
  - [`frontend/src/components/SpatialTopologyView.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/SpatialTopologyView.tsx) (preview state lifecycle, camera auto-fit/restore, mutation gating during preview, container-navigation auto-cancel, single-snapshot `Undo`-backed Apply)
  - [`frontend/src/components/map/TopologyHeaderToolbar.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/TopologyHeaderToolbar.tsx) (Auto-Layout trigger button on desktop and mobile)
  - [`frontend/src/components/map/SpatialTopologyCanvas.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/SpatialTopologyCanvas.tsx) (floating top-center Preview banner with Apply / Reset actions)
  - [`frontend/src/styles/13-parties-and-map-search.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles/13-parties-and-map-search.css) and [`frontend/src/styles/15-responsive.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles/15-responsive.css) (preview bar styling and responsive toolbar icon-only rules)
- **Backend Changes:** None required. Existing `ui_x`/`ui_y` and `ghost_coords` persistence in World Editor save and Campaign `update_campaign_map` (`campaign_spatial_overrides`) already supports scoped coordinate updates and turn-anchored branch safety.
- **Tests:**
  - `frontend/src/components/__tests__/mapAutoLayout.test.tsx` (unit tests for layout math, secret/aggregated edge weighting, disconnected components, AABB separation, viewport fit, and SSR component rendering for permission gating & preview banner)
- **User-Facing Wiki Documentation:**
  - [`../cybercantina-wiki/Authoring-Worlds-Characters-and-Personas.md`](file:///home/diegolima/Git/cybercantina-wiki/Authoring-Worlds-Characters-and-Personas.md)
  - [`../cybercantina-wiki/Live-Inspector-Map-and-Timeline.md`](file:///home/diegolima/Git/cybercantina-wiki/Live-Inspector-Map-and-Timeline.md)

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
CyberCantina worlds often grow organically—via AI generation, SillyTavern/JSON imports, or incremental manual additions—leaving `ui_x`/`ui_y` coordinates either tangled, overlapping, or misaligned with actual link compass directions (`compass_direction`) and metric separation (`distance_meters`). While [`computeFullMapCoords`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/topologyProjection.ts#L735-L860) auto-places *unpinned* (`ui_x == null`) nodes using a fixed `175px` radial step, it never re-arranges already-pinned nodes, ignores `distance_meters`, and uses uniform radial spacing that overlaps wide container cards (`148×50`).

Authors and GMs need a safe, deterministic way to automatically arrange the **current map view** according to exit compass directions and metric distances—without clobbering carefully arranged interiors at other hierarchy depths or leaking hidden secret passages in regular campaign play.

### 1.2 Goals
1. Provide a one-click **Auto-Layout** preview action that positions elements in the **current depth view only** using their exit compass directions and log-compressed metric distances.
2. Keep the preview **non-destructive**: users can pan, zoom, and inspect the proposed layout, then explicitly **Apply** (committing to the map draft as a single Undo-able action) or **Reset** (reverting immediately to prior positions and camera framing).
3. Preserve all other hierarchy levels: arranging the World Root never modifies interior coordinates inside containers, and arranging an interior container never modifies ancestor or sibling levels.
4. Enforce spoiler safety: make Auto-Layout available only in the **World Editor** (`mode === "editor"`) or in **Campaigns with GM Mode unlocked** (`unlockLore === true`), and never while streaming/mutating is locked.

### 1.3 Non-Goals
- Multi-level or recursive whole-world auto-layout (explicitly out of scope; layout is strictly scoped to `currentContainerId`).
- Live tuning sliders, density presets, or interactive node dragging while in Preview mode (v1 uses a single deterministic layout with minimal Apply/Reset controls).
- Modifying edge `compass_direction`, `distance_meters`, or container membership (Auto-Layout changes visual coordinates only).
- Persisting directly to the backend on Apply (Apply commits to the existing draft/undo lifecycle; users still persist via **Save Map** / World Editor save).

---

## 2. Permissions & Availability Rules

### 2.1 Visibility & Eligibility
The **Auto-Layout** trigger button is rendered if and only if:
```ts
const canAutoLayout = (mode === "editor" || unlockLore) && !isMutatingLocked;
```
- **Outside campaigns (`WorldInspectorModal` in World Editor):** `mode === "editor"` → **Available** (unless `isMutatingLocked` is true).
- **Inside campaigns with GM Mode unlocked (`LiveInspector` full map and `WorldInspectorModal` campaign view):** `mode === "campaign" && unlockLore === true` → **Available** (unless streaming/Phase 4 locks `isMutatingLocked`).
- **Inside campaigns without GM Mode (`unlockLore === false`):** **Hidden**, preventing players from inferring undiscovered secret passages or scrambling GM-authored layouts.

### 2.2 Disabled States
When visible, the Auto-Layout trigger is disabled when:
- The current view has fewer than 2 visible nodes (`visibleLocations.length + visibleSupernodes.length < 2`) **and** no ghost external nodes (`ghostExternalNodes.length === 0`), or
- A save operation is currently in progress (`effectiveSaving === true`).

While Preview is active, clicking the Auto-Layout button again acts as a no-op (or highlights the active preview state); Apply and Reset live in the canvas preview bar.

---

## 3. Scoped Layout Algorithm (`computeScopedAutoLayout`)

All layout math lives in a pure, deterministic, Node-testable module `frontend/src/components/map/mapAutoLayout.ts`.

### 3.1 Inputs & Scope
Inputs are derived strictly from the active `ProjectedDepthTopology` (`projectedTopology`):
- **Visible Nodes:**
  - `projectedTopology.visibleLocations` (each with footprint `halfW: 54, halfH: 34`, matching `visibleFootprints`)
  - `projectedTopology.visibleSupernodes` (each with footprint `halfW: CONTAINER_CARD_HALF_W + 6, halfH: CONTAINER_CARD_HALF_H + 8`, i.e., `80 × 33`)
- **Visible Edges:** `projectedTopology.projectedEdges` (both direct location–location edges and aggregated container/supernode edges)
- **Anchor Node:** `projectedTopology.anchorNodeId` (active location/supernode, else portal, else first visible node)
- **Ghost External Nodes (non-root views only):** `projectedTopology.ghostExternalNodes` and `projectedTopology.ghostEdges`

No locations or containers outside `projectedTopology.visibleLocations` and `projectedTopology.visibleSupernodes` are read for coordinate mutation.

### 3.2 Edge Reduction & Secret Weighting
Multiple directed/parallel/aggregated edges can exist between the same unordered node pair `{u, v}` (e.g., reciprocal `A → B` and `B → A`, or multiple passages between two container supernodes).
1. Collect all underlying `LocationEdge`s connecting visible node `u` and visible node `v` (flattening `groupedEdges ?? [rawEdge]`), tagging each with its orientation (`u → v` vs `v → u`).
2. **Secret-edge precedence:** If the pair has at least one non-secret edge (`!edge.is_secret`), filter to **non-secret edges only** when computing the representative distance and direction. Fall back to secret edges only when the pair is connected exclusively by secret passages.
3. **Representative distance:** Use the minimum `distance_meters` among the selected candidate edges for `{u, v}`.
4. **Representative compass direction (from `u` to `v`):**
   - For each candidate edge, resolve its compass direction (`edge.compass_direction`, falling back to `inferCompassDirection(null, edge.direction_label)`).
   - If the edge runs `v → u`, invert via `OPPOSITE_COMPASS[dir]` so all vectors are oriented `u → v`.
   - Sum unit vectors `(cos(COMPASS_ANGLES[dir]), sin(COMPASS_ANGLES[dir]))` across candidates; if the resultant magnitude is non-zero (`> 1e-4`), use `Math.atan2(sumY, sumX)`; otherwise fall back to the first candidate's angle.

### 3.3 Log-Compressed Distance Scaling
Because `distance_meters` spans `[1m, 100,000,000m]`:
- Compute per-edge target length in SVG world units using a monotonic log-compressed curve clamped to `[MIN_TARGET_SPAN, MAX_TARGET_SPAN]` (`[150, 460]` SVG units), adjusted for endpoint footprints so wide supernode cards have extra horizontal/vertical clearance:
  ```ts
  // Normalize relative to interior reference scale (20m) so 20m -> ~160, 100m -> ~220, 1km -> ~310, 20km+ -> ~430–460
  const rawSpan = MIN_TARGET_SPAN + 44 * Math.log1p(Math.max(0, distanceMeters - 10) / 25);
  const clampedSpan = Math.min(MAX_TARGET_SPAN, Math.max(MIN_TARGET_SPAN, rawSpan));
  ```
- Additionally enforce a per-pair minimum clearance based on the two endpoint footprints along the target direction ray (`exitDist(u) + exitDist(v) + EDGE_CLEARANCE_PAD`, e.g., `68px` so distance badges remain legible and unclipped).

### 3.4 Multi-Phase Deterministic Placement
1. **Connected Component Partitioning:**
   - Partition visible nodes into connected components over the reduced undirected edges.
   - Order components deterministically: component containing `anchorNodeId` first, then descending by component size, then lexicographically by smallest node ID.
2. **Phase A — Compass-Guided BFS Seed (per component):**
   - Pick the component root (`anchorNodeId` for the primary component; otherwise highest-degree node, tie-broken by ID) and place it at `(0, 0)`.
   - Traverse BFS from the root; for each unplaced neighbor `v` of `u`, place `v` at `pos[u] + (cos(angle_uv), sin(angle_uv)) * targetLen_uv`.
3. **Phase B — Directional Stress / Spring Refinement (per component):**
   - Run a fixed number of deterministic iterations (e.g., `60` iterations with linear step decay) where each reduced edge `{u, v}` pulls endpoints toward the ideal offset vector `(cos(angle_uv) * targetLen_uv, sin(angle_uv) * targetLen_uv)` while keeping the component root anchored.
   - This resolves cycles and multi-path triangulation conflicts smoothly without distorting tree branches.
4. **Phase C — Box-Aware AABB Overlap Separation (per component):**
   - Run deterministic iterative AABB separation using each node's actual footprint (`visibleFootprints[id]` + padding `24px`), pushing overlapping boxes apart along the minimum-penetration axis (with deterministic tie-breaking by node ID if centers coincide).
   - Keep the component root pinned (or re-center the component around `(0, 0)` afterward).
5. **Phase D — Disconnected Component Packing:**
   - If multiple components exist (e.g., unlinked nodes or interior rooms connected only via an exterior street), compute each component's bounding box (including node footprints) and pack secondary components cleanly to the right / in a tidy multi-row shelf around the primary component with `72px` inter-component margin.
6. **Rounding & Ghost External Nodes:**
   - Round all resulting node `{ x, y }` coordinates to integers.
   - When `currentContainerId !== null`, compute preview ghost coordinates via `computeGhostNodeCoords(ghostExternalNodes, ghostEdges, previewCoords, undefined, visibleFootprints)` (passing `undefined` for `overrides` so ghosts re-align cleanly with the new interior positions).

### 3.5 Viewport Auto-Fit Calculation (`computeViewportFitForCoords`)
Compute `{ pan, zoom }` that frames the bounding box of all previewed visible nodes **and** previewed ghost nodes inside the current SVG viewBox (`viewBox.width × viewBox.height`) with comfortable padding (e.g., `64px` margin on desktop, `36px` on mobile), clamped to `[MIN_MAP_ZOOM, MAX_MAP_ZOOM]` (`[0.35, 3]`, capped at `1.15` on fit so small 2-node maps don't over-zoom).

---

## 4. Preview, Apply & Reset UX Flow

### 4.1 Toolbar Trigger (`TopologyHeaderToolbar.tsx`)
- Add an **Auto-Layout** button in `TopologyHeaderToolbar` (using a clean Lucide layout icon such as `LayoutGrid` or `Network` with cyan/neutral styling—never rose/red).
- Desktop: icon + `"Auto-Layout"` label (`map-toolbar-btn-label`).
- Mobile (`isMobileViewport`): compact icon-only button matching the mobile toolbar pattern.
- Clicking **Auto-Layout** computes the preview coordinates, snapshots the current `{ pan, zoom }`, sets `autoLayoutPreview`, auto-fits the camera, and closes any open context menu or inline edge editor.

### 4.2 Floating Canvas Preview Bar (`SpatialTopologyCanvas.tsx`)
When `autoLayoutPreview` is active, render a minimal floating bar at the top-center of the canvas (`map-auto-layout-preview-bar`):
- Status indicator: `"Auto-Layout Preview (Current View)"`
- **Apply** button (primary cyan/amber accent, `Check` icon)
- **Reset** button (neutral button, `RotateCcw` icon)
- Keyboard shortcut: pressing `Escape` while preview is active (and no higher-priority overlay/search dropdown is open) triggers **Reset**.

### 4.3 Read-Only Inspection Rules During Preview
While `autoLayoutPreview !== null`:
- **Allowed:** Panning, zooming, Center button, clicking nodes/containers/ghosts/edges to inspect details in `MapDetailsDrawer`.
- **Locked (`effectiveMutatingLocked = isMutatingLocked || isPreviewingAutoLayout`):**
  - Dragging nodes/containers/ghosts, dragging link ports, dropping from `MapPaletteBar`, quick-add buttons, `Delete` key, `Undo`, inline distance editing, drawer destructive/structural mutations, and **Save Map** are disabled.
- **Automatic Cancel on Navigation:**
  - Any action that changes `currentContainerId`—drilling into a container, clicking a breadcrumb, jumping to an external container from a ghost node, or selecting a search result in another container—automatically cancels/clears `autoLayoutPreview` before navigating.
- **External Prop / Lock Safety:**
  - If `isMutatingLocked` flips to `true` (e.g., turn streaming starts) or `unlockLore` flips to `false` in campaign mode while previewing, automatically cancel `autoLayoutPreview` and restore the prior camera.

### 4.4 Apply & Reset Semantics
- **Reset:**
  - Clears `autoLayoutPreview` (zero graph mutations; `effectiveDirty` and `undoStack` remain untouched).
  - Restores the pre-preview `{ pan, zoom }`.
- **Apply:**
  - Builds `nextGraph` from the current working graph by updating:
    - `ui_x` / `ui_y` **only** for `workingLocations` present in `autoLayoutPreview.coords`
    - `ui_x` / `ui_y` **only** for `workingContainers` present in `autoLayoutPreview.coords`
    - If `currentContainerId !== null`, clears `ghost_coords: {}` on `currentScopeContainer` so external ghost portals persist in their freshly aligned auto-placed positions.
  - Calls `commitNextGraph(nextGraph, true)` so the entire layout change is pushed onto `undoStack` as a **single Undo-able snapshot**.
  - Clears `autoLayoutPreview` and **keeps** the fitted camera.
  - Sets `statusNotice` (e.g., `"Applied auto-layout to current view. Save Map to persist."`).

---

## 5. Acceptance Criteria

1. **Permission Gating:**
   - Auto-Layout button is visible in World Editor (`mode="editor"`).
   - Auto-Layout button is visible in Campaign Full Map (`LiveInspector`) and Campaign World Sheet (`WorldInspectorModal`) **only** when `unlockLore === true` and `!isMutatingLocked`.
   - Auto-Layout button is hidden when `mode === "campaign" && !unlockLore`.
2. **Non-Destructive Preview & Reset:**
   - Clicking Auto-Layout renders the proposed layout immediately without marking the map dirty or pushing to `undoStack`.
   - Panning/zooming works during preview; node dragging, linking, palette adds, and `Save Map` are disabled.
   - Clicking **Reset** (or pressing `Escape`) restores exact prior node positions and exact prior `{ pan, zoom }`.
3. **Scoped Apply & Undo:**
   - Clicking **Apply** updates `ui_x`/`ui_y` **only** for visible locations and direct child containers of `currentContainerId`; all ancestor and descendant coordinates remain byte-for-byte unchanged.
   - Inside a container view, **Apply** clears saved `ghost_coords` on `currentContainerId` so ghost portals align with the new interior layout.
   - Clicking **Undo** (or `Ctrl+Z`) immediately after **Apply** reverts all applied coordinates (and restored `ghost_coords`) in one step.
4. **Algorithm Quality:**
   - Mixed distances (`20m` vs `20km`) preserve relative short < medium < long ordering while staying within readable bounds (`150–460` SVG units).
   - Wide container supernodes (`148×50`) do not overlap each other or location tiles after layout.
   - Secret passages do not override non-secret direction/distance between connected nodes, but still place secret-only nodes cleanly.
   - Disconnected components (e.g., interior rooms only linked via outside) pack cleanly without overlapping.
5. **Navigation Safety:**
   - Drilling into a container, clicking a breadcrumb, or jumping via search during Preview automatically cancels Preview without mutating the graph.
6. **Verification Suite:**
   - `npm --prefix frontend run arch:check && npm --prefix frontend run css:audit && npm --prefix frontend run build && npm --prefix frontend test` all pass.
   - Architecture docs (`scripts/generate_arch_docs.py --check`) and sibling wiki docs (`../cybercantina-wiki`) updated and verified.
