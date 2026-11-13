---
feature: map-editor-ergonomics
target_version: 0.10.2
document_type: frd
status: completed
last_updated: 2026-11-13
---

# Feature Requirements Document (FRD)
## Map Editor Ergonomics: Reliable Inline Time Editing, L1 Container Magic Wand, Keyboard Deletion & World-Editor Link Quick-Delete

**Status:** Completed  
**Target Version:** CyberCantina v0.10.2  
**Scope:**
- Frontend Map UI & Hooks (`frontend/src/components/SpatialTopologyView.tsx`, `frontend/src/components/map/SpatialTopologyCanvas.tsx`, `frontend/src/components/map/MapDetailsDrawer.tsx`, `frontend/src/components/map/useTopologyMutations.ts`, `frontend/src/hooks/useMagicWand.ts`, `frontend/src/types/`)
- Backend Enrichment Schema & Router (`backend/app/schemas/enrich.py`, `backend/app/routers/enrich.py`)
- Frontend & Backend Unit Tests (`frontend/src/components/__tests__/mapEditor.test.tsx`, `backend/tests/`)

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
Follow-up testing after the v0.10.1 map UX polish uncovered several editing bugs and workflow friction points across link editing, container authoring, and graph manipulation:

1. **Inline Link Time Input Fails Selection, Live Display, and Arrow Stepping:**
   - Double-clicking an edge or distance badge focuses the `<foreignObject>` `<input type="number">` via `autoFocus` without selecting the text, forcing users to manually highlight/backspace digits before typing.
   - Typing new digits updates React state (`inlineEdgeEdit.value`) and saves on blur/`Enter`, yet fails to reliably repaint inside the zoomed SVG `<g transform="scale(...) translate(...)">` `<foreignObject>` box (`56×24`).
   - Clicking the `<input type="number">` up/down spinner arrows bubbles `mousedown` (`button === 0`) up to `<svg onMouseDown>` and triggers `finishPan` on `mouseup`, calling `setInlineEdgeEdit(null)` immediately and dismissing the editor on the first click.
2. **Missing Magic Wand on Level 1 Containers:** Level 0 locations expose AI Magic Wand buttons for `Atmospheric Description` and `Environmental Tags` (`MapDetailsDrawer.tsx`), whereas Level 1 containers (`depth === 1`, Building / Landmark) expose the exact same fields and `MapLoreSection` without Magic Wand support.
3. **No Keyboard `Delete` Action on Map Canvas:** Users can select locations, hubs, and containers on the canvas, but must open the context menu or drawer to delete them rather than pressing `Delete`.
4. **Slow Link Deletion in World Editor:** Removing links currently requires right-clicking the link or badge to open the context menu (or opening `MultiEdgePopover` on aggregated container links).

### 1.2 Proposed Solution
Deliver a targeted editing ergonomics release (v0.10.2) that replaces the flaky SVG `<foreignObject>` inline editor with a proper screen-space HTML overlay, extends Magic Wand enrichment exclusively to Level 0 locations and Level 1 containers, binds `Delete` safely to node/container removal backed by the existing Undo stack, and adds a World-Editor-only hover quick-delete button (`"X"`) for both single links and aggregated container bundles.

> [!NOTE]
> **Deferred Scope (`TODO.md`):**
> Switching distances from minutes (`travel_minutes`) to meters (`1 min = 70m`), removing the `240` cap across backend/frontend schemas, and click-to-convert walking-time previews are intentionally **excluded** from v0.10.2 and tracked in `TODO.md` under **Spatial Topology & World Simulation** for separate architectural design.

---

## 2. Scope, Boundaries & Core Invariants

1. **Existing `travel_minutes` Contract Preserved:**
   - Link weights remain integer minutes clamped to `[1, 240]` in `useTopologyMutations.ts`, `MapDialogs.tsx`, and backend schemas until the metric-distance migration lands.
2. **Magic Wand Scope Boundary:**
   - Available **strictly** on **Level 0 Locations** and **Level 1 (`depth === 1`) Containers**.
   - Must **not** appear on higher-level macro containers (`depth >= 2`: District, City, Region/Realm).
3. **Undo-Backed Deletion Policy:**
   - All node, container, and link deletions triggered via `Delete` or the quick-delete `"X"` rely on the existing `commitNextGraph` Undo stack—no blocking confirmation modals.
4. **Mode Boundary for Hover Quick-Delete (`"X"`):**
   - Rendered **only in World Editor mode** (`mode === "editor"` and `!isMutatingLocked`). Never shown in Campaign Mode (`mode === "campaign"`), avoiding visited-location and rewind-boundary edge deletion conflicts on hover.
5. **Save-Gate Path Invariants Unchanged:**
   - Deleting any link or aggregated link bundle is permitted interactively during editing, while `SpatialTopologyView` continues blocking `Save Map` (`hasBlockingErrors`) whenever any location loses bidirectional reachability from the Starting Location.

---

## 3. Functional Requirements & Edge Cases

### FR-1: Reliable Inline Link Travel-Time Editor (`SpatialTopologyCanvas.tsx`)
**Requirement:** Double-clicking a link line or distance badge (or choosing "Edit Distance" in the context menu) must open an inline numeric editor whose current value is selected by default, displays typed characters and stepped values immediately, and commits reliably on blur or `Enter`.

- **HTML Overlay Instead of SVG `<foreignObject>`:**
  - Replace the `<foreignObject>` `<input>` inside `<g data-layer="inline-edge-editor">` with an absolutely positioned HTML overlay inside `canvasWrapRef` (mapped from canvas `(midX, midY)` to wrapper pixel coordinates using SVG CTM / `(pan, zoom)`), or keep overlay position synchronized on `zoom`/`pan`/node coordinate updates.
  - This eliminates browser compositing/repaint failures of `<input>` controls nested inside SVG `<g transform="scale(...) translate(...)">` and keeps editor dimensions crisp at any zoom (`35%`–`300%`).
- **Auto-Select on Open:**
  - Select the entire value (`input.select()`) automatically on mount/focus (keyed by `inlineEdgeEdit.edgeId`) so users can type replacement digits immediately after double-clicking without clicking again.
- **Event Isolation (Fix Spinner / Arrow Dismissal):**
  - Call `e.stopPropagation()` on `onMouseDown`, `onClick`, and `onDoubleClick` of the inline editor wrapper/controls so pointer interactions never bubble to `<svg onMouseDown>` or trigger `finishPan`'s click-to-dismiss `setInlineEdgeEdit(null)`.
- **Visible Stepping Controls & Keyboard Arrows:**
  - Provide crisp, legible numeric stepping via `-` / `+` stepper buttons (or full-width numeric input with `ArrowUp` / `ArrowDown` stepping) that visibly update the displayed value without blurring/closing the editor.
  - Clicking outside the editor (or pressing `Enter`) commits the clamped `[1, 240]` integer via `handleUpdateEdgeDistance` and closes the editor; pressing `Escape` cancels and discards uncommitted edits.
- **Edge Cases:**
  - **Empty or Invalid Input on Blur/`Enter`:** If the field is cleared (`""`) or `NaN` when committed, fall back gracefully to the edge's prior `travel_minutes` (or clamp valid integers into `[1, 240]`) rather than corrupting state.
  - **Clicking Stepper Buttons vs. `onBlur`:** Moving focus from the `<input>` to an inline `-` / `+` button inside the same overlay container must **not** prematurely treat focus change as an outside blur that closes the editor (`relatedTarget` / container `onBlur` guard).
  - **Aggregated Bundles:** Double-clicking an aggregated container badge continues opening `MultiEdgePopover` rather than the single-value inline overlay.

---

### FR-2: Magic Wand AI Enrichment for Level 1 (`depth === 1`) Containers
**Requirement:** Expose `MagicWandButton` on **Atmospheric Description** and **Environmental Tags** for Level 1 (`depth === 1`) containers in `MapDetailsDrawer.tsx`, matching the authoring experience on Level 0 locations.

- **Strict Tier Visibility:**
  - Render Magic Wand buttons in `MapDetailsDrawer.tsx` **only** when `selectedLocation` is active (Level 0) OR `selectedContainer?.depth === 1` (Level 1 Building / Landmark).
  - Omit Magic Wand controls for `selectedContainer.depth >= 2` (Levels 2–4).
- **Drawer Wiring & Locking (`MapDetailsDrawer.tsx`):**
  - Wire `descriptionWand` (`fieldRole: "location_description"`, multiline) and `tagsWand` (`fieldRole: "location_tags"`, `singleLine: true`, comma-separated `string` ↔ `TagChipsInput` `string[]` bridge) for `selectedContainer` when `selectedContainer.depth === 1`.
  - Pass a stable container-scoped `contextKey` (e.g., `cont:${selectedContainer.id}`) to `useMagicWand` so selecting a different container aborts in-flight requests and resets Undo snapshots.
  - Disable both wands whenever `isContNarrativeLocked` is `true` (Campaign Mode container holding visited descendant locations) or when `selectedContainer.name.trim().length === 0` if required.
- **Backend Container Context Framing (`backend/app/schemas/enrich.py`, `backend/app/routers/enrich.py`):**
  - Extend `WorldLocationEnrichContextRef` with an optional `entity_kind: Literal["location", "container"] = "location"` (and optional `child_names: list[str] | None = None` or container summary context) so Level 1 containers are framed in the prompt as buildings/landmarks encompassing interior spots rather than single rooms, while keeping all existing Level 0 calls backwards-compatible.
  - Keep `Tags` output deterministic via existing `LocationTagsEnrichOutput` structured extraction and comma-tag deduplication in `routers/enrich.py`.

---

### FR-3: Keyboard `Delete` Removal for Selected Locations, Hubs & Containers
**Requirement:** Pressing the `Delete` key while a Location, Passage Hub, or Container is selected on the map must remove the selected entity (subject to existing graph/campaign permission checks), relying on the Undo stack for recovery.

- **Selection Target Resolution:**
  - When `selectedLocId` is set (covers both Level 0 Locations and Passage Hubs where `is_hub === true`), invoke `handleDeleteLocation(selectedLocId)`.
  - When `selectedContainerId` is set, invoke `handleDeleteContainer(selectedContainerId)`.
- **Permission Checks & User Feedback:**
  - Evaluate `canDeleteLocation` / `canDeleteContainer` prior to deletion:
    - If disallowed (e.g., last remaining location, `is_starting_location`, `is_visited` in Campaign Mode, baseline campaign container, or container with visited descendants), **do not delete**; surface `check.reason` in `statusNotice` (`setStatusNotice`) so the user understands why the action was blocked.
    - If allowed, perform the deletion immediately without a confirmation dialog and rely on `Undo` (`commitNextGraph` snapshot + status notice).
- **Input-Focus & Modal Safety Guards (Critical Edge Cases):**
  - Ignore `keydown` when `e.key !== "Delete"`, when modifier keys are held (`e.ctrlKey || e.metaKey || e.altKey`), or during repeat (`e.repeat`).
  - Ignore when `isMutatingLocked` or `effectiveSaving` is `true`.
  - Ignore when any modal or inline editor is open (`inlineEdgeEdit`, `contextMenu`, `groupModal`, `hubCollisionModal`, `emptyCanvasModal`, `standaloneContainerModal`, `multiEdgeModalEdges`, `promotionPrompt`).
  - Ignore whenever `e.target` or `document.activeElement` is an editable element (`INPUT`, `TEXTAREA`, `SELECT`, `[contenteditable="true"]`, or inside `.tag-chips-container` input), so pressing `Delete` inside `MapDetailsDrawer` or search inputs never deletes the selected canvas node.

---

### FR-4: Hover Quick-Delete (`X`) on Links in World Editor Mode
**Requirement:** In World Editor mode (`mode === "editor"`), hovering any projected link line (single edge or aggregated container bundle) displays a red circled `"X"` button for one-click link deletion, subject to existing path reachability validation before saving.

- **Mode & State Eligibility:**
  - Render the hover hit-target and red circled `"X"` **only** when `mode === "editor"` and `!isMutatingLocked`.
  - Never render quick-delete controls while `inlineEdgeEdit`, `nodeDrag`, `linkDrag`, or `isPanning` is active, or when `contextMenu` is open.
- **Generous Hit Area & Anti-Flicker Grouping:**
  - Pair each visible edge `<line>` with an invisible wider hit-target `<line stroke="transparent" strokeWidth={14} />` so thin edges (`1.5–2.8px`) are easy to hover across zoom levels.
  - Track `hoveredEdgeId` across a shared hover group containing both the hit-target line and the red circled `"X"` button (with a clean pointer target so moving the cursor from the edge onto `"X"` does not fire `onMouseLeave` and unmount `"X"` prematurely).
  - Position the small red circled `"X"` on the top-right corner of the distance badge (without recoloring the link line itself) so normal clicks/double-clicks on the distance badge remain unobstructed while avoiding distracting full-line highlights.
  - Style the button with `--accent-rose` (`#f43f5e`) matching destructive-action semantic guidelines, and call `e.stopPropagation()` on `onMouseDown` / `onClick` so clicking `"X"` does not pan or clear selection unexpectedly.
- **Single Edges vs. Aggregated Container Bundles:**
  - **Single Edge (`!edge.isAggregated`):** Clicking `"X"` calls `handleDeleteEdge(edge.rawEdge.id)` (deleting both the forward edge and its bidirectional reverse edge in one Undo step).
  - **Aggregated Bundle (`edge.isAggregated && edge.groupedEdges`):** Clicking `"X"` invokes a batch delete handler (e.g., `handleDeleteEdgeGroup(edge.groupedEdges.map((ge) => ge.id))`) that deletes **all underlying grouped edges and their symmetric reverse edges** in a **single atomic `commitNextGraph` / Undo snapshot**—never looping `handleDeleteEdge` into N separate Undo steps.
- **Path Rules & Save Gating:**
  - Quick-deleting an edge or bundle is allowed immediately during editing even if it temporarily disconnects a subgraph; `SpatialTopologyView` immediately updates `reachabilityReport` / `validationSummary` / unreachable node highlights and disables `Save Map` (`hasBlockingErrors`) until the user reconnects the graph or clicks `Undo`.
- **De-duplication on Bidirectional Visual Edges:**
  - Render at most one quick-delete `"X"` per projected visual link (using the same deduplication rule as distance badges so bidirectional overlays don't stack duplicate `"X"` buttons).

---

## 4. Non-Goals (Out of Scope for v0.10.2)
- Metric unit conversion (`1 min = 70m`), removing the `240` cap, or click-to-convert walking time popovers (tracked in `TODO.md`).
- Adding Magic Wand support to Level 2–4 macro containers.
- Enabling hover quick-delete `"X"` on links in Campaign Mode.
- Changing `Delete` behavior to support `Backspace` or multi-node marquee selection.

---

## 5. Verification Matrix
Before completion, implementation must satisfy:
- **Backend Checks (`cd backend && .venv/bin/ruff check app tests && .venv/bin/tach check` and `.venv/bin/pytest backend/tests`):**
  - `enrich.py` tests covering `entity_kind="container"` prompt framing and existing `location_description` / `location_tags` parity.
- **Frontend Checks (`npm --prefix frontend run arch:check && npm --prefix frontend run build && npm --prefix frontend test`):**
  - Inline edge editor tests: double-click opens HTML overlay with value selected, stepping `+`/`-` or `ArrowUp`/`ArrowDown` updates displayed value without dismissing on `mouseup`, typing commits on `Enter`/`onBlur` within `[1, 240]`, and `Escape` cancels cleanly.
  - Drawer tests: Magic Wand buttons appear on Level 0 Locations and Level 1 Containers (`depth === 1`), stay hidden on Levels 2–4, and respect `isContNarrativeLocked`.
  - Keyboard `Delete` tests: deletes selected Location, Hub, or Container cleanly and supports single-click Undo; blocks disallowed deletions (`is_starting_location`, `is_visited`, baseline containers) with `statusNotice`; ignores `Delete` while typing in inputs/textareas or inside modals.
  - World Editor hover quick-delete `"X"` tests: appears only in `mode === "editor"`, deletes single edges and aggregated bundles in one atomic Undo step, preserves `Save Map` blocking when locations become unreachable, and is absent in `mode === "campaign"`.
- **Architecture Docs Sync (if module signatures/routes/schemas changed):**
  - `backend/.venv/bin/python scripts/generate_arch_docs.py --check`
