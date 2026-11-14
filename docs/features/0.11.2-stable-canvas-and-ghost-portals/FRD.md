---
feature: stable-canvas-and-ghost-portals
target_version: 0.11.2
document_type: frd
status: draft
last_updated: 2026-11-14
---

# Feature Requirements Document (FRD)
## Selection-Stable Canvas Layout & Shared Ghost Portal Visualization

**Status:** Draft  
**Target Version:** CyberCantina v0.11.2  
**Scope:**
- Frontend Topology State & Projection (`frontend/src/components/SpatialTopologyView.tsx`, `frontend/src/components/map/topologyProjection.ts`, `frontend/src/components/map/useTopologyPointerDrag.ts`)
- Frontend SVG Canvas & Details Drawer (`frontend/src/components/map/SpatialTopologyCanvas.tsx`, `frontend/src/components/map/MapDetailsDrawer.tsx`)
- Frontend Tests (`frontend/src/components/__tests__/locationContainers.test.tsx`, `frontend/src/components/__tests__/mapEditor.test.tsx`)

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
Two remaining interaction friction points affect multi-container map editing in `SpatialTopologyView`:

1. **Viewport Jumps on Selection Cause Double-Clicks to Miss Containers & Nodes:**
   - Although selection handlers in [`useTopologyPointerDrag.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/useTopologyPointerDrag.ts#L230-L242) do not mutate `pan`, clicking an unselected container or location toggles `hasDetailsOpen` (`Boolean(selectedLocation || selectedContainer)`) in [`SpatialTopologyView.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/SpatialTopologyView.tsx#L833-L843) from `gridTemplateColumns: "1fr"` to `"minmax(460px, 1.85fr) minmax(300px, 1fr)"`.
   - Mounting the right-hand details column shrinks the `<svg>` container width by ~300+ px between Click 1 (`pointerup`) and Click 2 (`dblclick`). Because `<svg viewBox="-340 -260 680 520">` defaults to `preserveAspectRatio="xMidYMid meet"`, shrinking the `<svg>` width shifts the projected canvas origin sideways under the stationary pointer—so the second click misses the container card and fails to drill into it.
   - Any future or implicit selection-driven re-centering produces the same hostile UX.

2. **Invisible Cross-Boundary Edges & Destinations Inside Drilled-Down Containers:**
   - Inside any container (`currentContainerId !== null`), [`projectTopologyForDepth`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/topologyProjection.ts#L379-L398) records outgoing external edges in `externalPortalsByLocationId`, while excluding them from `projectedEdges`.
   - On the canvas, [`SpatialTopologyCanvas.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/SpatialTopologyCanvas.tsx#L1051-L1066) shows only tiny static `↗ DestinationName` text beneath the portal, and [`MapDetailsDrawer.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDetailsDrawer.tsx#L993-L1017) renders a read-only `External Boundary Links` box that advises *"edit distance/delete directly on edge labels!"* even though no clickable edge line or distance badge exists on the canvas while drilled down.
   - Users cannot visually trace where portals lead, organize external landing stubs around their room layout, or easily sever external links without drilling back out to an ancestor depth.

### 1.2 Proposed Solution
1. **Invariant Canvas Geometry & Zero Auto-Pan on Selection (`FR-1`):** Keep `<svg>` container bounds completely stable when opening, switching, or closing [`MapDetailsDrawer`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDetailsDrawer.tsx), and enforce that element selection never triggers `setPan`.
2. **Shared Ghost Portal Links & Ghost External Nodes (`FR-2`):** Project cross-boundary portal connections in drilled-down views as dotted/faded ghost edge lines (with interactive distance badges and hover `"X"` quick-delete controls) terminating at **one shared ghost external node per unique external destination location**, locally draggable for view organization without corrupting the external node's home coordinates.
3. **Ghost Safety Guards, Read-Only Preview & Drawer Link Removal (`FR-3`):** Enforce non-destructive read-only boundaries on ghost nodes, synchronize Undo-backed edge removal so deleting all external links to a destination removes its ghost node, and add inline link-removal buttons in the drawer's `External Boundary Links` list.

---

## 2. Scope, Boundaries & Core Invariants

1. **No Backend Schema Changes Required:**
   - External ghost nodes and their drilled-down canvas offsets are a pure projection/UI concern (`topologyProjection.ts` + component state). `LocationNode.ui_x` / `ui_y` remain strictly owned by each node's home container view.
2. **One Shared Ghost Node Per Unique External Destination Location:**
   - Within a given drilled-down view (`currentContainerId`), if two or more distinct portals connect to the **same** external `LocationNode`, render **one shared ghost node** keyed by `externalLocId`, with separate ghost edge lines converging from each connecting portal onto that shared ghost node.
3. **Single-Snapshot Undo & Deletion Distinction:**
   - Deleting a ghost link via canvas `"X"` badge, `Delete` key (when the ghost edge is selected), or drawer `"Remove"` button calls [`filterEdgesAfterDeletion`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/topologyProjection.ts#L807-L825) cleanly with a single Undo snapshot and removes both directional halves (outgoing + reverse edge) when symmetric.
   - Pressing `Delete` on a selected **ghost node** must **never** delete the underlying real `LocationNode`.
4. **No DOM Reflow During Double-Click:**
   - Selecting or deselecting any node, container, ghost node, or edge must leave the SVG element's width, height, `viewBox`, and `pan` unchanged.

---

## 3. Functional Requirements & Edge Cases

### FR-1: Selection-Stable Canvas Layout & No Selection Auto-Centering
**Requirement:** Selecting or deselecting any map element must never shift the visual position of elements under the pointer.

- **Invariant Split Layout (`frontend/src/components/SpatialTopologyView.tsx`):**
  - Replace the conditional `"minmax(460px, 1.85fr) minmax(300px, 1fr)"` vs `"1fr"` grid toggle tied to `hasDetailsOpen` with a layout whose canvas column width never changes on selection/deselection:
    - Render the right-hand details column permanently alongside the canvas (showing a lightweight placeholder panel when nothing is selected, e.g., *"Click a location, container, or link to inspect"*), **OR** mount [`MapDetailsDrawer`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDetailsDrawer.tsx) as a right-docked floating overlay panel inside the canvas wrapper so `<svg>` pixel bounds remain constant.
  - Ensure opening a ghost preview, node details, or closing details (`onClose`) triggers zero `<svg>` width change and zero SVG `viewBox` center shift.
- **No Auto-Pan on Selection:**
  - Verify [`useTopologyPointerDrag.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/useTopologyPointerDrag.ts) and [`SpatialTopologyView.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/SpatialTopologyView.tsx) never call `setPan` in response to `setSelectedLocId`, `setSelectedContainerId`, or `selectedGhostLocId`.
  - Keep camera panning explicitly scoped to initial mount ([`resolveInitialMapFocus`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/topologyProjection.ts#L837)), the toolbar **Center** button (`handleCenter`), and validation **Focus** (`handleFocusInvalid`).
- **Edge Cases:**
  - Double-clicking an unselected container card when `selectedLocId === null && selectedContainerId === null` must hit the container card reliably on Click 2 and execute `drillIntoContainer(sn.container.id)`.
  - Clicking empty background to deselect must not shift nearby container cards or nodes horizontally.

---

### FR-2: Shared Ghost External Nodes & Cross-Boundary Links in Drilled-Down Views
**Requirement:** When drilled inside a container (`currentContainerId !== null`), cross-boundary outgoing/incoming connections to external locations must be rendered on the canvas as dotted/faded ghost links ending at a shared ghost representation of each external location.

- **Projection Data Model (`frontend/src/components/map/topologyProjection.ts`):**
  - Extend [`ProjectedDepthTopology`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/topologyProjection.ts#L191-L203) with:
    - `ghostExternalNodes: ProjectedGhostExternalNode[]` — deduplicated by `destination.id`:
      - `destination: LocationNode`
      - `destinationContainerName: string` (`"World Root"` if `destination.container_id == null`, else container name)
      - `connectedPortalIds: string[]` (unique visible portal location IDs in the current view linked to `destination.id`)
    - `ghostEdges: ProjectedGhostEdge[]` — cross-boundary edges connecting a visible location (`sourceNodeId`, kind `"location"`) to a ghost external node (`targetGhostId = destination.id`), carrying `rawEdge`, `compass_direction`, `travel_minutes`, and `is_locked_or_hidden`.
  - **Shared Ghost Rule:** Group external destinations strictly by `destination.id`. If Portal A and Portal B inside `currentContainerId` both link to External Location X, `ghostExternalNodes` emits **one** entry for Location X, and `ghostEdges` emits both edges pointing to Location X.
  - **Root-View Invariant:** At `currentContainerId === null` (World Root), all locations live at root or inside root supernodes, so `ghostExternalNodes` and `ghostEdges` are always empty `[]`.

- **Default Ghost Placement & Ephemeral Organizing (`topologyProjection.ts`, `SpatialTopologyView.tsx`, `useTopologyPointerDrag.ts`):**
  - Compute default ghost coordinates purely from the connecting visible portal(s):
    - Single connecting portal: project outward from the portal's coordinate along the edge's `compass_direction` vector (`~125px` radius, falling back to an unoccupied slot if another node/ghost already sits within collision radius).
    - Multiple connecting portals (shared ghost node): compute the midpoint/centroid of the outgoing directional targets from those portals and apply collision de-overlapping against visible nodes.
  - **Local Ephemeral Dragging:** Allow the user to drag any ghost node on the canvas in the current drilled-down view to organize spacing:
    - Store dragged ghost coordinates in **ephemeral component state** keyed by `${currentContainerId}:${destination.id}` (e.g., `ghostCoordsByView: Record<string, { x: number; y: number }>`).
    - **Must NEVER write to `destination.ui_x` or `destination.ui_y`**, ensuring the external node's layout in its own home container stays completely untouched.
    - Note: Should a user also want a way to reset ghost positions, moving a portal or clicking **Reset Auto-Layout** on the ghost clears its ephemeral entry back to computed placement.

- **Ghost Visual Styling (`frontend/src/components/map/SpatialTopologyCanvas.tsx`):**
  - **Ghost Edge Lines & Badges:**
    - Render on a dedicated/ordered edge layer (`data-layer="edge-lines"` / `data-layer="edge-badges"`) with a **dashed/dotted** stroke (`strokeDasharray="5 4"`) and muted cyan/slate opacity (`opacity ~0.55–0.7`) so cross-boundary edges are immediately distinguishable from solid intra-container edges.
    - Clip line endpoints cleanly to the portal perimeter and ghost node perimeter using `computeEdgeClippedSegment`.
    - Render the standard opaque distance badge (`{travelMinutes}m` + lock indicator) at the midpoint, supporting:
      - Inline travel-minutes editing on double-click (`mode === "editor"`, `!isMutatingLocked`), keeping existing edge edit behavior.
      - Hover quick-delete `"X"` badge button strictly in `mode === "editor"` (`!isMutatingLocked`), matching v0.10.2 edge badge contracts.
  - **Ghost External Node:**
    - Render with dashed outline (`strokeDasharray="4 3"`), reduced fill opacity (`~0.55–0.65`), translucent cyan/slate tint, an `ExternalLink` / `DoorOpen` or mapped icon badge, primary label (`destination.name`), and secondary muted subtitle (`destinationContainerName` or `World Root`).
    - Omit the 8 compass link ports on ghost nodes in this version so link-creation stays anchored to real nodes in the current view (avoiding ambiguity about cross-container port drops).

---

### FR-3: Read-Only Ghost Guardrails, Link Removal Sync & Drawer Fallback
**Requirement:** Ghost nodes must protect the external destination from accidental edits/deletion while making external link inspection and removal effortless.

- **Non-Editable / Non-Deletable Ghost Node Guards (`SpatialTopologyView.tsx`, `useTopologyPointerDrag.ts`, `MapDetailsDrawer.tsx`):**
  - Dragging a ghost node onto a visible container card or breadcrumb must **not** reparent the external location (`isValidContainerDrop` / pointer-up drop handlers ignore `draggedKind === "ghost"`).
  - Pressing `Delete` / `Backspace` while a ghost node is selected must **not** delete `destination`: emit a clear `statusNotice` (e.g., `"External ghost nodes are read-only here — delete the dashed boundary link line instead, or jump to its home container."`).
  - Clicking a ghost node selects it cleanly without opening editable name/summary/description/lore inputs for the external location. Instead, [`MapDetailsDrawer`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDetailsDrawer.tsx) displays a **Read-Only External Destination** preview panel with:
    - Destination name, summary snippet, and home container badge (`destinationContainerName` / `World Root`).
    - List of active boundary link(s) connecting portals in the current view to this external node, each with an inline **"Remove"** button (`mode === "editor"` and `!isMutatingLocked`).
    - A **"Jump to Container"** button calling `drillIntoContainer(destination.container_id ?? null)` and selecting `destination.id` (double-clicking the ghost node may also invoke this jump cleanly).
- **Ghost Cleanup on Link Deletion:**
  - Clicking the hover `"X"` quick-delete button on any ghost edge (or clicking **"Remove"** in `MapDetailsDrawer` under either `External Boundary Links` on a portal node or the ghost preview) calls `handleDeleteEdge(edge.id)` (which uses `filterEdgesAfterDeletion` to remove the edge and its reverse pair in one Undo snapshot).
  - Because `ghostExternalNodes` and `ghostEdges` derive reactively from `workingEdges`:
    - Removing one of two links to a shared ghost removes only that dotted line while keeping the shared ghost node anchored by the remaining link.
    - Removing the **last** link to an external destination removes both the ghost link and the ghost external node immediately, and clears `selectedGhostLocId` if it was selected.
    - Undoing (`Ctrl/Cmd+Z` / Undo button) restores the edge(s), ghost link, and shared ghost node identically.
- **Inline Removal in Portal `External Boundary Links` (`MapDetailsDrawer.tsx`):**
  - Update the `External Boundary Links` section (`MapDetailsDrawer.tsx:994-1017`) to include an inline `"X"` / **Remove link** button beside each listed boundary link in `mode === "editor"` (`!isMutatingLocked`), alongside clicking the row to highlight/focus or double-check travel minutes.
- **Note on World-to-Container Portals Beyond L1 (Macro Views):**
  - What if an edge connects a visible L0 node inside an `L2` district directly to a node inside an *adjacent* sibling `L1` building that is visible as a **supernode** on the `L2` canvas?
    - Those edges ALREADY project in [`projectTopologyForDepth`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/topologyProjection.ts#L400-L449) as normal/aggregated edges between the L0 node and the sibling `L1` supernode card! Ghost nodes must **only** appear for edges whose `to_location_id` has **no** visible representation (`!toVis`) at `currentContainerId`, preventing duplicate rendering with visible sibling supernodes.

---

## 4. Non-Goals (Out of Scope for v0.11.2)
- Persisting per-view custom ghost `(x, y)` coordinates in the backend SQLite `location_nodes` table (ghost offsets remain ephemeral/computed in frontend session state).
- Drawing 8 compass link ports on ghost nodes to originate *new* cross-boundary links directly from a ghost (users continue initiating cross-boundary links from ancestor views or visible nodes).
- Rendering ghost nodes for **container-to-container aggregated exits** where neither endpoint is a visible L0 node in the current view (Wait: at `currentContainerId !== null`, `fromVis` can only be a visible L0 location or a visible child supernode card; supernode-to-external exits remain summarized by `{sn.externalPortalsCount} portals` on the supernode card, while L0-to-external portals emit ghost links and shared ghost nodes).

---

## 5. Verification Matrix
Before completion, implementation must satisfy:
- **Frontend Checks (`npm --prefix frontend run arch:check && npm --prefix frontend run build && npm --prefix frontend test`):**
  - **Invariant Layout Tests:** Assert in [`SpatialTopologyView.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/SpatialTopologyView.tsx) / SSR render assertions that selection state (`defaultSelectedLocationId={null}` vs selected node/container) does not collapse/expand a `gridTemplateColumns` split column in a way that shifts the `<svg>` container width.
  - **Projection Tests (`topologyProjection.ts`):**
    - Drilled into a container (`cont_club`) with 1 portal linking out (`Main Floor -> Canal Junction`), `ghostExternalNodes` contains `1` shared ghost for `Canal Junction` and `ghostEdges` contains `1` cross-boundary edge.
    - Drilled into a container where **two distinct portals** (`Main Floor` and `Back Door`) connect to the **same** external location (`Canal Junction`), `ghostExternalNodes` still contains **only 1 shared ghost** for `Canal Junction`, with `connectedPortalIds` of length `2` and `2` entries in `ghostEdges`.
    - Deleting `1` of the `2` links keeps the shared ghost node and `1` ghost edge; deleting the `2nd` link removes both `ghostEdges` and the shared ghost node cleanly.
    - When `destination` lies inside a visible child supernode at the current depth (`toVis` exists), **no** duplicate ghost node is created.
    - When `currentContainerId === null` (World Root), `ghostExternalNodes` and `ghostEdges` are empty.
  - **SSR & Guardrail Tests (`locationContainers.test.tsx`, `mapEditor.test.tsx`):**
    - `SpatialTopologyView` drilled into `cont_club` renders dashed ghost link markup (`stroke-dasharray`), ghost destination name (`Canal Junction`), its home container subtitle (`Watson District`), and hover badge/delete support in `mode="editor"`.
    - Selecting a ghost renders read-only external info + `"Jump to"` + `"Remove"` controls in `MapDetailsDrawer` (without editable narrative inputs or `Entry/Exit Portal` toggle), and `External Boundary Links` on a portal renders removable link controls in `mode="editor"`.
    - Dragging a ghost updates ephemeral view coordinates without mutating any `LocationNode.ui_x` / `ui_y` inside the world graph.
- **Architecture Docs Sync:**
  - `backend/.venv/bin/python scripts/generate_arch_docs.py --check`
