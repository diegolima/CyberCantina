---
feature: minimap-dblclick-expand
target_version: 0.47.1
document_type: frd
status: completed
last_updated: 2026-11-26
---

# Feature Requirements Document — Minimap Double-Click / Double-Tap to Expand

## 1. Overview & Motivation

In the campaign right-hand **Live Inspector** (`LiveInspector.tsx`), the 1-hop minimap inside `InspectorLocationCard.tsx` currently requires clicking the small `[↗ N]` header button (`handleOpenFullMap`) to open `SpatialTopologyView`. Additionally, `handleOpenFullMap` unconditionally resets `selectedLocId` to `activeLoc.id` before opening, discarding any adjacent neighbor the user was inspecting in the sidebar.

This feature adds direct double-click / double-tap expansion on the minimap SVG surface—both on empty space and on specific minimap elements—alongside keyboard/single-click parity in the selected-location preview card.

---

## 2. Agreed Product Decisions

### 2.1 Minimap Targets & Open Behavior

| Target | Single Click / Tap | Double Click / Double Tap | Expanded Map (`SpatialTopologyView`) State |
| :--- | :--- | :--- | :--- |
| **Empty minimap area** *(SVG background, amber active-container envelope, compass guide ring, exit rays & distance labels)* | No-op | Expand full map | Centered on `activeLoc`'s container scope with **nothing selected** (`defaultSelectedLocationId={null}`) for an unobstructed canvas. |
| **Location node** *(centered `activeLoc` or up to 8 1-hop neighbors)* | Select in sidebar preview card *(unchanged)* | Expand & focus location | Jumps to that location's container scope if outside `activeLoc`'s container, centers the real node, and selects it in the inspector. |
| **Top-left active container pill** (`L# · Name`, rendered when `activeCont` exists) | No-op | Expand & focus container | Opens the container's **parent scope** (`parent_container_id ?? null`), centers the container supernode, and selects it in the inspector *(matches World Codex "View on Map")*. |
| **Header `[↗ N]` button** | Expand full map *(unchanged)* | — | Centered on `activeLoc` with `activeLoc` selected *(unchanged)*. |
| **Selected-location preview card "Inspect on map" icon button** | Expand & focus `selectedLocation` | — | Same container-jump, centering, and inspector selection as double-clicking that location node *(single-click & keyboard parity)*. |

### 2.2 Desktop vs. Mobile (`< 620px`) Inspector Presentation
- **Desktop (`>= 620px`):**
  - Expanding on a **location node** or **active container pill** opens `MapDetailsDrawer` automatically with that element selected.
  - Expanding on an **empty minimap area** opens with nothing selected (showing the details placeholder).
- **Mobile (`< 620px`):**
  - Expanding on a **location node** or **active container pill** centers the element on the canvas and shows the compact bottom **peek bar** (`map-mobile-peek-bar`), leaving `isMobileSheetExpanded` as `false` so the details sheet does not cover the map on open (1 tap on the peek bar / **Details** opens the full sheet).
  - Expanding on an **empty minimap area** opens with no peek bar.

### 2.3 Discoverability & Visual Affordances
- **Empty minimap canvas:** `cursor: zoom-in` and SVG `<title>` tooltip (`"Double-click to expand full map"`).
- **Active container pill (`L# · Name`):** `cursor: zoom-in`, tooltip (`"Double-click to inspect container on full map"`), and subtle hover border/fill highlight via CSS.
- **Location nodes:** Retain `cursor: pointer` and expose a `<title>` tooltip hinting single-click preview + double-click to inspect on full map.
- **Selected-location preview card:** Add a compact icon button (`"Inspect on full map"`) next to the selected location's badge/override controls so keyboard and single-click users can expand directly onto `selectedLocation`.

### 2.4 Touch & Gesture Hygiene
- Apply `user-select: none` and `touch-action: manipulation` on the minimap `<svg>` (`InspectorLocationCard.tsx` / `06-inspector-and-lore.css`) to prevent accidental SVG label text selection on desktop double-click and native browser double-tap zoom on mobile.
- Implement pointer-based touch double-tap detection reusing `DOUBLE_TAP_MAX_MS` (`300ms`) and `DOUBLE_TAP_MAX_DIST_PX` (`28px`) from `frontend/src/components/map/mapGeometry.ts`.
- Cancel pending touch double-tap state whenever the pointer moves beyond drag threshold, triggers `pointercancel`, or scrolls—ensuring overlay drawer swipe-dismiss (`useDrawerSwipeDismiss` in `LiveInspector.tsx`) and vertical scrolling never misfire a map expansion.
- Deduplicate touch double-taps against any trailing synthetic `dblclick` browser event so `handleOpenFullMap` only fires once.

---

## 3. Out of Scope
- Making minimap exit rays, distance labels, or container envelope regions independently selectable or focusable (they remain treated as empty minimap space in v1).
- Displaying container details inside the right-hand sidebar preview card on single-click.
- Turning the spatial hierarchy breadcrumb strip below the minimap into interactive map-jump links.

---

## 4. Acceptance Criteria
1. Double-clicking or double-tapping an empty minimap area (including the amber container envelope or exit lines) opens `SpatialTopologyView` centered on `activeLoc`'s container scope with nothing selected (`MapDetailsDrawer` unselected placeholder on desktop; no peek bar on mobile).
2. Double-clicking or double-tapping a minimap location node (`activeLoc` or any 1-hop neighbor) opens `SpatialTopologyView` with that location centered and selected in the inspector—automatically jumping to the neighbor's container scope (or `[Outside]` root scope) if it differs from `activeLoc`'s container.
3. Double-clicking or double-tapping the top-left active container pill (`L# · Name`) opens `SpatialTopologyView` at that container's parent scope with the container supernode centered and selected in the inspector; single-clicking the pill remains a no-op.
4. Clicking the `[↗ N]` header button preserves its existing behavior (centered on `activeLoc` with `activeLoc` selected).
5. Clicking (or activating via keyboard) the "Inspect on map" icon button in the selected-location preview card opens `SpatialTopologyView` focused on `selectedLocation` identically to double-clicking that node.
6. On mobile (`< 620px`), opening on a focused element displays the compact `map-mobile-peek-bar` without auto-expanding the full details sheet (`isMobileSheetExpanded === false`), and swiping/dragging on the minimap never triggers a false double-tap expansion.
7. All existing and new frontend checks (`arch:check`, `css:audit`, `build`, `test`) pass cleanly.
