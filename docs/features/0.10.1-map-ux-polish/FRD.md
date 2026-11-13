---
feature: map-ux-polish
target_version: 0.10.1
document_type: frd
status: completed
last_updated: 2026-11-13
---

# Feature Requirements Document (FRD)
## Spatial Topology Map UX Polish, Geometry Clarity & Container Creation Ergonomics

**Status:** Completed  
**Target Version:** CyberCantina v0.10.1  
**Scope:** Frontend Map & Inspector UI (`frontend/src/components/SpatialTopologyView.tsx`, `frontend/src/components/map/*`, `frontend/src/components/inspector/{AgentChangesModal,LoreIndexModal}.tsx`, `frontend/src/components/world/WorldInspectorModal.tsx`, and map unit tests in `frontend/src/components/__tests__/`).

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
Following the v0.10.0 interactive map editor rollout, real-world usage exposed eight concrete UX, visual-clarity, and interaction defects in `SpatialTopologyView` and its child map modules:

1. **Link Lines Bleed Behind Distance Badges:** Distance badges use `fillOpacity={0.9}` (`SpatialTopologyCanvas.tsx`) and render inside the same per-edge `<g>` loop as `<line>` elements, allowing both a badge's own line and subsequent crossing lines in the SVG array to draw through/over travel-time text.
2. **Outdated `"room"` Terminology:** Although CyberCantina's spatial graph now spans interiors, streets, districts, cities, and realms (`Location` / `LocationContainer`), UI labels and map module symbols still intermittently refer to `"room"` / `"rooms"`.
3. **Center-to-Center Link Lines:** Links currently connect node center coordinates `(p1 -> p2)`, causing lines to show through translucent node fills, obscure directional flow, and place distance midpoints awkwardly close to or inside wide `148×50` container supernodes.
4. **Unreachable Hover Link Ports:** Location compass ports sit at radius `26px` around a `36×36` tile (`18px` half-size), and container ports sit `7px` outside the `148×50` card. Crossing the `3–5px` SVG background gap triggers `onMouseLeave` on the node `<g>`, unmounting the port circles before the user can click them.
5. **No Middle-Button Panning:** Canvas panning only accepts `e.button === 0` on empty space; middle-mouse dragging (`e.button === 1`) is ignored and triggers browser autoscroll/paste.
6. **Stuck Grabbing Cursor:** `SpatialTopologyCanvas` derives `style.cursor` from `panDragRef.current.active`, which is mutated on `onMouseUp` / `onMouseLeave` without triggering a React re-render—leaving the closed-hand `"grabbing"` cursor stuck until an unrelated state update occurs.
7. **Hidden Higher-Level Containers:** Palette `+ Container` (`createStandaloneAt`), Location-on-Location grouping (`GroupIntoContainerModal`), and context-menu `Convert to Container` all hardcode `depth: 1`. Only `EmptyCanvasCreateModal` exposes a `Level` `<select>` (with cryptic `L1`–`L4` labels), making Level 2–4 macro containers practically undiscoverable.
8. **Buried Zoom Indicator:** Zoom percentage is embedded inside the `Center (100%)` button (`TopologyHeaderToolbar.tsx`), visually hiding the readout while wheel-zooming and coupling pan centering with zoom reset.

### 1.2 Proposed Solution
Deliver a focused frontend UX polish pass across the map canvas, toolbar, dialogs, and terminology without altering database schemas, backend APIs, or persisted world/campaign invariants.

---

## 2. Scope, Boundaries & Core Invariants

> [!IMPORTANT]
> **Frontend-Only Contract Boundary:**  
> All improvements in this specification must preserve existing SQLite schemas, REST payloads (`LocationNode`, `LocationContainer`, `LocationEdge`), Campaign Mode visited-location protections, and backend prompt contracts.

1. **Preserved Graph & Campaign Invariants:**
   - Bidirectional graph reachability save-gating, strict container depth monotonicity (`parent.depth > child.depth`), visited-location narrative immutability, and ancestor breadcrumb monotonicity remain unchanged.
2. **Persisted Identifier & Enum Stability (Terminology Boundary):**
   - Renaming `"room"` → `"location"` applies to **user-facing UI copy**, **map-internal TypeScript symbols/types**, and **frontend map tests**.
   - It **must NOT** rename serialized API/DB enum literals such as `VisibilityScope = "public_room" | "local_whisper" | "remote_comm"` (`frontend/src/types/affective.ts`, `backend/app/schemas/affective.py`), seed/world IDs (`backroom_clinic`, `private_backroom`), or character-authored narrative prose.
   - Backend LLM prompt templates (`backend/app/prompts/defaults.py`, `backend/app/engine/cognition/runner.py`, `zone4_ephemeral.py`) are out of scope for v0.10.1.
3. **Architecture & Facade Compliance:**
   - All changes stay within existing modular boundaries under `frontend/src/components/map/`, `frontend/src/components/SpatialTopologyView.tsx`, and inspector/world modals, passing `npm --prefix frontend run arch:check`, `build`, and `test`.

---

## 3. Functional Requirements & Edge Cases

### FR-1: Opaque Distance Badges & Layered Edge Rendering
**Requirement:** Distance badges (`{travel_minutes}m`) on link lines must never have link lines drawn through or over them.

- **Opaque Fill:** Set the distance badge `<rect>` fill to solid `var(--bg-deep, #0b0e14)` with `fillOpacity={1}` (removing `0.9` opacity).
- **Two-Pass SVG Layering:** Separate edge rendering inside `<g ref={viewportGroupRef}>` into distinct visual layers in bottom-to-top paint order:
  1. **Layer 1 — Link Lines:** All projected edge `<line>` elements + active rubber-band `linkDrag` line.
  2. **Layer 2 — Distance Badges:** All non-editing distance `<g>` badge pills.
  3. **Layer 3 — Nodes & Containers:** All container supernodes, location tiles, and passage hubs (so nodes always take visual priority over lines and distant edge badges if crowded).
  4. **Layer 4 — Active Inline Editor:** Any active `inlineEdgeEdit` `<foreignObject>` numeric `<input>` so inline distance editing is never occluded by adjacent nodes.
- **Dynamic / Sufficient Badge Width:** Size the badge `<rect>` to fit longer aggregated/locked labels (e.g., `120m · 4 🔒`) without text overflowing the box border; preserve existing bidirectional label deduplication (`edge.sourceNodeId <= edge.targetNodeId || !reverseExists`).
- **Scope Boundary:** Applies to `SpatialTopologyCanvas.tsx`. The 1-hop mini-map in `InspectorLocationCard.tsx` is out of scope for v0.10.1 unless badge readability regresses there.

---

### FR-2: Eliminate `"room"` References for Locations
**Requirement:** Replace `"room"` / `"rooms"` terminology with `"location"` / `"locations"` across UI copy, tooltips, notices, and map-module TypeScript symbols.

- **UI Copy Targets:**
  - `SpatialTopologyCanvas.tsx`: `{sn.descendantLocationCount} locations` (replacing `rooms`).
  - `MapDetailsDrawer.tsx`: `Locations:`, `Visited location — ...`, `adjacent locations`, `this location`.
  - `MapPaletteBar.tsx`: `+ Location` and `+ Container` tooltips (`Level 0 location`, `entry location`).
  - `MapDialogs.tsx` & `PortalPromotionModal.tsx`: `entry location`, `interior location(s)`, `another location`.
  - `useTopologyMutations.ts` & `useTopologyPointerDrag.ts`: status notices, default descriptions (`adjoining locations`, `Cannot convert location`), and fallback source label (`"Location"`).
  - `WorldInspectorModal.tsx`, `LoreIndexModal.tsx`, `AgentChangesModal.tsx`: `location-specific lore`, `locations`, `Current Location`, `Active location`, `adjacent location`.
- **Internal Code Symbol Targets:**
  - Rename `PromotionPromptState` fields (`targetContainerForRoomPick` → `targetContainerForLocationPick`, `targetRoomCandidates` → `targetLocationCandidates`, `chosenTargetRoomId` → `chosenTargetLocationId`) across `topologyProjection.ts`, `useTopologyMutations.ts`, `PortalPromotionModal.tsx`, and tests (`locationContainers.test.tsx`, `mapEditor.test.tsx`).
- **Edge Cases & Boundaries:**
  - Preserve `"public_room"` in `VisibilityScope` comparisons (`ev.visibility !== "public_room"`).
  - Keep `MapDetailsDrawer` copy accurate for Passage Hubs (`is_hub`) vs. standard Locations where hub-specific phrasing is already used.

---

### FR-3: Perimeter Edge-Snapped Links & Opaque Node Backing
**Requirement:** Link `<line>` segments must terminate at each endpoint's visible perimeter edge along the connecting ray rather than at node centers.

- **Geometric Ray-Perimeter Clipping:** For each projected edge `(p1 -> p2)`, compute the clipped endpoints `(e1, e2)` using exact shape geometry along the unit vector `u = (p2 - p1) / dist`:
  - **Location Tile (`36×36`, `rx=10`):** Ray-to-rounded-rectangle intersection (half-extents `18 × 18`, corner radius `10`).
  - **Passage Hub (`octagon`, `r=17`):** Ray-to-regular-octagon (or `r=17` radial) intersection.
  - **Container Supernode (`148×50`, `rx=8`):** Ray-to-rounded-rectangle intersection (half-extents `74 × 25`, corner radius `8`).
- **Why Ray Clipping (vs. Stored Compass Slot Anchoring):** Snapping to the geometric ray keeps lines straight and non-overlapping even if the user drags a node to a different quadrant without modifying `compass_direction`.
- **Opaque Node Backing:** Render an opaque `#0b0e14` backing shape behind translucent `rgba(...)` location/hub fills so crossing edges passing behind a node never bleed through behind its icon.
- **Label Halo:** Add a crisp `--bg-deep` stroke halo (`paintOrder="stroke"`, `stroke="#0b0e14"`, `strokeWidth={3}`) or compact pill behind node name/portal text labels (`pt.y + 30`, `pt.y + 41`) so South-exiting edges remain legible underneath labels.
- **Edge Cases:**
  - **Coincident or Overlapping Nodes (`dist === 0` or `t1 + t2 >= dist`):** Guard against `0/0` (`NaN`) and inverted lines; if the clipped segment collapses (`dist <= t1 + t2`), fall back cleanly (skip or clamp to midpoint) without distorting the badge position.
  - **Badge Midpoint Placement:** Compute the distance badge anchor `(midX, midY)` as the midpoint of the **clipped visible segment** `((e1.x + e2.x) / 2, (e1.y + e2.y) / 2)` instead of `(p1 + p2) / 2`, so links between a wide `148×50` container and a `36×36` location center their badge in the visible gap between borders. (Use the same clipped midpoint when opening `inlineEdgeEdit` from the edge context menu.)

---

### FR-4: Expanded Hover Hit-Box & Port Clickability
**Requirement:** Moving the pointer from a node body onto any of its 8 compass link ports must never cause the ports to disappear prematurely.

- **Continuous Hover Buffer:** Inside each node/container `<g>`, render a transparent hover-capture shape (`fill="transparent"`, `pointerEvents="all"`) spanning the node body plus its port ring:
  - Locations & Passage Hubs: `<circle r={34} />` centered at `pt` (covering ports at `r = 26` + port radius).
  - Containers: `<rect width={cardW + 24} height={cardH + 24} rx={12} />` centered at `pt` (covering ports at `cardW/2 + 7`, `cardH/2 + 7`).
- **Event Isolation (Critical Edge Case):**
  - Move node-drag `onPointerDown` **off the outer `<g>` and onto the visible node body shape** (location tile `<rect>`, hub `<polygon>`, container `<rect>`).
  - Keep `onMouseEnter` / `onMouseLeave` on `<g>` (with `onContextMenu` on the visible node body or `<g>` as appropriate), so clicking inside the empty transparent margin around a node does **not** accidentally initiate a node drag or block canvas panning.
- **Generous Port Hit Targets:** Pair each visible port dot (`r = 3.4–5.2`) with an invisible `r = 8` hit-target `<circle fill="transparent" />` (aligning with `hitTestPortAt`'s `9px` snap radius in `useTopologyPointerDrag.ts`) so ports remain easy to click even at minimum zoom (`0.35`).
- **Overlapping Neighbor Edge Case:** When two nodes' hover buffers overlap, moving from node A's buffer directly onto node B must switch `hoveredNodeKey` to B cleanly (`onMouseLeave` keeps the `curr === key ? null : curr` guard so A's leave event cannot clear B's hover).

---

### FR-5: Middle-Button Map Dragging
**Requirement:** Users must be able to pan the map canvas by dragging with the middle mouse button (`button === 1`), anywhere on the canvas.

- **Trigger Anywhere:** Allow `e.button === 1` to initiate panning in `SpatialTopologyCanvas` even when the cursor starts over a node, container, port, or edge (while still blocking panning if `nodeDrag` or `linkDrag` is actively in progress).
- **Browser Default Suppression:** Call `e.preventDefault()` on `onMouseDown` when `e.button === 1` (and suppress `onAuxClick` for `button === 1`) to prevent browser autoscroll icons, tab-paste, or middle-click scrolling on Linux/Windows.
- **Selection Preservation:** Only run empty-canvas deselection (`setSelectedLocId(null)`, `setSelectedContainerId(null)`, closing context menu/inline edit) on `e.button === 0` clicks with movement `<= 4px`—never on middle-clicks.

---

### FR-6: Reliable Pan Cursor State Reset (`grabbing` → `grab`)
**Requirement:** Releasing the mouse button after panning must immediately restore the cursor from closed hand (`grabbing`) to open hand (`grab`) (or the hovered element's cursor).

- **Reactive State:** Store active pan status in React state (`isPanning: boolean`) alongside `panDragRef` coordinates so releasing the mouse button always triggers a re-render, even if the user clicked and released without moving the mouse.
- **Window-Level Release Handling:** Attach `window` `mousemove`, `mouseup`, and `blur` listeners whenever `isPanning` is `true` (matching `useTopologyPointerDrag.ts`):
  - Dragging outside the `<svg>` boundary continues panning smoothly until the button is released.
  - Releasing the mouse outside the `<svg>` or browser window cleanly clears `isPanning` and `panDragRef.current.active` without leaving the cursor or pan stuck.
- **Cursor Precedence:**
  - `nodeDrag?.hasMoved` → `"grabbing"`
  - `linkDrag` → `"crosshair"`
  - `isPanning` → `"grabbing"`
  - Default `<svg>` → `"grab"` (with `"pointer"` on interactive node/container/edge/badge targets and `"crosshair"` on link ports when not actively dragging/panning).

---

### FR-7: Container Level Selection Prompt (Lore vs. Higher-Level Macro Containers)
**Requirement:** Creating a container from the Palette (click or drag-drop) must prompt the user to choose between a Lore container (Level 1) and valid higher-level containers (Levels 2–4), with clear domain descriptions.

- **When to Prompt:**
  - **2+ Valid Depths (`availableContainerDepthsHere.length > 1`):** Trigger a **Create Container** modal when clicking or dropping `+ Container` from `MapPaletteBar` (at World Root or inside Level 3/4 containers).
  - **Single Valid Depth (`availableContainerDepthsHere = [1]`, i.e., inside Level 2):** Skip the depth-choice modal (or create Level 1 directly as today) so users aren't forced through a redundant 1-option prompt.
  - **0 Valid Depths (`availableContainerDepthsHere.length === 0`, i.e., inside Level 1):** Keep `+ Container` disabled with explanatory tooltip (`"Level 1 containers cannot hold nested containers"`).
- **Modal Design & Clarity:**
  - Clearly separate the two architectural tiers using `CONTAINER_DEPTH_LABELS`:
    1. **Lore Container — Level 1 (`Building / Landmark`):** Holds Level 0 Locations and supports scoped **Container Lore & Secrets**.
    2. **Higher-Level Macro Containers (no container-level lore; organize sub-containers & areas):**
       - **Level 2 — District / Zone**
       - **Level 3 — City / Settlement**
       - **Level 4 — Region / Planet / Realm**
  - Disable/omit any depth `>= currentContainer.depth` to enforce `parent.depth > child.depth`.
  - Provide a **Name** field (with sensible depth-aware placeholder/default) and an **"Include initial entry location"** toggle (checked by default for Level 1 so the container is immediately connectable; optional for Levels 2–4 so users can either link to it immediately or create an organizational wrapper to drag existing buildings/districts into).
  - **Empty Macro Container Guardrail:** If a user creates a Level 2–4 container *without* an initial location, show a subtle hint or keep existing `initiateConnection` guard (`"Cannot connect to an empty container — add a location or sub-container inside it first"`).
- **Modal Consistency Across Other Creation Flows:**
  - Update `EmptyCanvasCreateModal` (`MapDialogs.tsx`) so its `Level` selector shows full descriptive labels (`L1 — Building / Landmark (Lore)`, `L2 — District / Zone`, etc.) instead of bare `L1`–`L4`.
  - Keep `GroupIntoContainerModal` (Location-on-Location drop) and right-click `Convert to Container` defaulting to Level 1 (`Building / Landmark`), since wrapping Level 0 locations into a Level 1 landmark is their primary intent; optionally allow selecting higher valid depths if desired without complicating the default one-click flow.
- **Campaign Mode Edge Case:**
  - In Campaign Mode, creating Level 2–4 containers must behave identically to Level 1 staged containers (editable until saved, branch-scoped `created_at_turn_id` on save, and valid targets for wrapping existing lower-level containers or unvisited locations).

---

### FR-8: Dedicated, Decoupled Zoom Indicator & Controls
**Requirement:** Display a clear, independent zoom indicator on the map, decoupled from the `Center` button.

- **Decoupled Controls:**
  - Remove `({Math.round(zoom * 100)}%)` from the `Center` button label in `TopologyHeaderToolbar.tsx` (`Center` should simply read `Center`).
  - Display a dedicated zoom indicator pill—either as `[ZoomOut] [100%] [ZoomIn]` in `TopologyHeaderToolbar.tsx` and/or a compact bottom-right canvas HUD pill mirroring the bottom-left legend in `SpatialTopologyCanvas.tsx`.
  - Clicking the percentage indicator resets **zoom only** to `100%` (`setZoom(1)`), preserving the user's current `pan`.
  - Clicking **`Center`** centers `pan` on the selected/active node **without overwriting the user's current zoom level** (unlike current `handleCenter`, which resets `setZoom(1)`).
- **Edge Cases & Bounds:**
  - Clamp zoom across all inputs (mouse wheel, toolbar buttons, HUD reset) strictly to `[0.35, 3.0]` (`35%`–`300%`).
  - Disable Zoom Out at `<= 0.35` and Zoom In at `>= 3.0` (`disabled` state + clear tooltip).
  - Ensure `Center` works cleanly when no node is selected and `activeLoc` is absent (resetting pan to `{ x: 0, y: 0 }`).

---

## 4. Non-Goals (Out of Scope for v0.10.1)
- Modifying SQLite schema, backend Python endpoints, or `.zcc` export/import formats.
- Renaming persisted `"public_room"` visibility enum values or editing backend LLM cognition/prompt templates.
- Auto-updating stored `compass_direction` values on edges when users drag nodes to new canvas positions.
- Adding zoom-to-cursor focal anchoring (unless trivially included, standard center-origin zoom behavior remains acceptable as long as indicator & bounds are accurate).

---

## 5. Verification Matrix
Before completion, implementation must satisfy:
- **Static & Architecture Checks:**
  - `npm --prefix frontend run arch:check`
  - `npm --prefix frontend run build`
- **Automated Frontend Tests (`npm --prefix frontend test`):**
  - Updated terminology assertions in `mapEditor.test.tsx` and `locationContainers.test.tsx`.
  - Unit tests for ray-perimeter edge clipping (`location` rounded-rect, `hub` octagon, `container` card, and coincident/overlapping node guards).
  - Interaction tests covering: container depth prompt opening when `availableContainerDepthsHere.length > 1` (and skipping when only L1 is valid), decoupled zoom reset vs. `Center` pan behavior, `isPanning` cursor reset on `mouseup` / `blur`, middle-button pan initiation without deselection, and port/hover event isolation (clicking hover buffer does not trigger node drag).
- **Manual / Visual Smoke Checks:**
  - Crossing edges never paint over any distance badge; short container-to-location links center badges cleanly between clipped borders.
  - Hovering a node and moving smoothly onto any of its 8 compass ports keeps ports visible and clickable at `35%`, `100%`, and `200%` zoom.
  - Middle-dragging over nodes or empty canvas pans cleanly without autoscroll and returns cursor to open hand on release.
