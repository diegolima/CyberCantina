---
feature: mobile-map-ux
target_version: 0.31.1
document_type: frd
status: completed
last_updated: 2026-11-23
---

# Feature Requirements Document (FRD)
## Mobile Spatial Topology Map UX & Touch Ergonomics

**Status:** Completed  
**Target Version:** CyberCantina v0.31.1  
**Depends On:**
- `0.9.0-location-containers` (Spatial Topology multi-depth projection & editing)
- `0.22.1-map-location-container-search` (Map toolbar search & quick focus)
- `0.29.1-styles-modularization-and-optimization` (Modular `styles/` tokens, `.ui-*` primitives & `css:audit`)

**Scope:**
- **Backend / Schemas / API:** **No changes required** (purely frontend layout, viewport math, pointer/touch gesture handling, and responsive map controls).
- **Frontend Map Components & Hooks:**
  - [`LiveInspector.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/LiveInspector.tsx) (portal-mounted full-screen mobile modal shell for `showFullMap` + background scroll containment)
  - [`InspectorLocationCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/inspector/InspectorLocationCard.tsx) (narrow-drawer header wrapping polish & clear expand affordance)
  - [`WorldInspectorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldInspectorModal.tsx) (responsive mobile full-height layout compatibility for embedded `SpatialTopologyView`)
  - [`SpatialTopologyView.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/SpatialTopologyView.tsx) (responsive single-canvas + docked Selection Peek Bar + expandable bottom-sheet layout replacing the fixed 2-column grid, smart `handleCenter` recovery, mobile Undo/validation placement, standalone `+` fallback, tap-to-select-first coordination)
  - [`SpatialTopologyCanvas.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/SpatialTopologyCanvas.tsx) (SVG-scale-corrected 1:1 Pointer-event panning, aspect-adaptive responsive `viewBox`, two-finger midpoint pinch-to-zoom, empty-canvas double-tap zoom, tap-to-select-first node/badge pan pass-through, universal floating bottom-right `Center` icon, consolidated desktop-only bottom-right zoom pill, collapsible `?` mobile legend, touch-safe inline edge editor, callout/selection suppression)
  - [`useTopologyPointerDrag.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/useTopologyPointerDrag.ts) (`pointerId`-scoped tracking, `pointercancel` cleanup, multi-touch pinch isolation)
  - [`TopologyHeaderToolbar.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/TopologyHeaderToolbar.tsx) (remove duplicate zoom bar & `Center` button on **all** viewports, compact single-row mobile header + expandable search, horizontally scrollable breadcrumbs)
  - [`MapPaletteBar.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapPaletteBar.tsx) (hide palette creation bar on small screens & when `isMutatingLocked`, relocate Undo & error-only validation pills)
  - [`MapDetailsDrawer.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDetailsDrawer.tsx) (mobile bottom-sheet drawer presentation + touch parity for context-menu/keyboard-only actions: Delete, Set Starting Location, Convert to Container, Move Out to Parent)
  - [`MapDialogs.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDialogs.tsx) & [`PortalPromotionModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/PortalPromotionModal.tsx) (scrollable inner dialog cards safe under mobile virtual keyboards + responsive `2×2` grid in `EmptyCanvasCreateModal`)
  - [`mapGeometry.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/mapGeometry.ts) / [`topologyProjection.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/topologyProjection.ts) (pure helpers for 1:1 SVG-scale pan math, responsive `viewBox` computation, pinch midpoint focal math, double-tap zoom cycle, tap-vs-pan classification, touch port hit radii)
- **Modular Stylesheets (`frontend/src/styles/`):**
  - [`06-inspector-and-lore.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles/06-inspector-and-lore.css), [`07-modals-and-forms.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles/07-modals-and-forms.css), [`13-parties-and-map-search.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles/13-parties-and-map-search.css), and [`15-responsive.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles/15-responsive.css) (aligned to canonical `620px` / `820px` / `1100px` breakpoints; mobile `16px` input font-size guard against iOS Safari auto-zoom)
- **Automated Tests:**
  - Unit & SSR tests in `frontend/src/components/__tests__/` (new mobile map gesture/math tests + updated [`mapSearch.test.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/__tests__/mapSearch.test.tsx), [`mapEditor.test.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/__tests__/mapEditor.test.tsx), [`locationContainers.test.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/__tests__/locationContainers.test.tsx))
  - Playwright mobile viewport E2E coverage in `frontend/e2e/` (`390×844` touch-enabled context)
- **User-Facing Documentation (required upon feature implementation):**
  - [`Live-Inspector-Map-and-Timeline.md`](file:///home/diegolima/Git/cybercantina-wiki/Live-Inspector-Map-and-Timeline.md)
  - [`Authoring-Worlds-Characters-and-Personas.md`](file:///home/diegolima/Git/cybercantina-wiki/Authoring-Worlds-Characters-and-Personas.md)

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
While CyberCantina's primary chat layout adapts cleanly to mobile screens via [`15-responsive.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles/15-responsive.css) and [`campaignLayout.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/utils/campaignLayout.ts), auditing the **Spatial Topology Map** (especially the expanded full-map modal in [`LiveInspector.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/LiveInspector.tsx#L400-L451)) revealed ten concrete usability, geometry, and DOM bugs on touch devices and narrow viewports (`<= 820px`):

1. **No Finger Panning & Wrong Pan Velocity on Narrow Screens:**
   - Canvas panning in [`SpatialTopologyCanvas.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/SpatialTopologyCanvas.tsx#L186-L241) and [L514-L556](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/SpatialTopologyCanvas.tsx#L514-L556) listens only to `onMouseDown` + `window` `mousemove`/`mouseup` and sets no `touch-action: none`, so mobile touch drags are hijacked by page scroll/overscroll.
   - Even after switching to pointer events, the existing pan formula (`origPanX + rawDx / z`) divides CSS pixels only by `zoom` and ignores the SVG `viewBox` scale factor (`Math.min(rect.width / 680, rect.height / 520)` ≈ `0.57` on a `390px` portrait phone), causing the map to move at ~57% of finger speed instead of tracking 1:1.
2. **Portrait Viewport Shrinking & Unreadable Touch Targets (`viewBox="-340 -260 680 520"`):**
   - Hardcoding a landscape `680×520` `viewBox` on a `390×700` portrait phone shrinks every element to `0.57×` scale: `36×36` location tiles become `~20.6px` (less than half of a `44px` touch target), `fontSize="10"` labels become `~5.7px`, and `PORT_HIT_RADIUS = 8` becomes a `4.6px` radius (`9.2px` diameter).
3. **Locked Nodes, Unselected Nodes & Distance Badges Stall Panning:**
   - `onPointerDown` on nodes/containers ([`SpatialTopologyCanvas.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/SpatialTopologyCanvas.tsx#L792-L798), [L1068-L1075](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/SpatialTopologyCanvas.tsx#L1068-L1075)) calls `e.stopPropagation()` and returns early when `isMutatingLocked` is `true`, and distance badges ([L687](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/SpatialTopologyCanvas.tsx#L687)) call `onMouseDown={(ev) => ev.stopPropagation()}`. Starting a finger swipe on any node or badge blocks panning.
   - [`useTopologyPointerDrag.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/useTopologyPointerDrag.ts#L216-L453) does not filter by `pointerId` or clean up on `pointercancel`, so multi-touch pinches or OS gestures corrupt active drags.
4. **Fixed Desktop Split Grid Clips the Details Drawer Off-Screen:**
   - [`SpatialTopologyView.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/SpatialTopologyView.tsx#L1189-L1198) hardcodes `gridTemplateColumns: "minmax(460px, 1.85fr) minmax(300px, 1fr)"` with `overflow: "hidden"` (**774px minimum width**), pushing [`MapDetailsDrawer.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDetailsDrawer.tsx) off-screen and clipping it on every phone and small tablet.
5. **Non-Full-Screen Modal & `.inspector--overlay` Stacking Context Trap:**
   - [`LiveInspector.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/LiveInspector.tsx#L400-L451) sizes the modal to `min(1100px, 95vw)` × `min(900px, 92vh)` with `16px` padding and renders it as a child of `<aside className="inspector inspector--overlay">` (`z-index: 40`, animated `transform`), trapping `z-index: 70` inside the inspector's stacking context instead of portaling cleanly to `document.body`.
6. **Redundant & Cluttered Chrome Across Header, Palette & Legend:**
   - Zoom controls are duplicated in [`TopologyHeaderToolbar.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/TopologyHeaderToolbar.tsx#L398-L474) and [`SpatialTopologyCanvas.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/SpatialTopologyCanvas.tsx#L1744-L1823).
   - `Center`, `Search`, `Re-imagine`, `Save`, `X`, `MapPaletteBar` (HTML5 `draggable` doesn't work on mobile, yet it also holds `Undo` and validation warnings), and the bottom-left legend (`"Middle-drag to pan · Double-click distance · Right-click for actions"`) consume most of the screen on narrow viewports.
7. **Inner Sub-Dialogs Overflow & Clip Under Mobile Keyboards:**
   - All 7 inner modals in [`MapDialogs.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDialogs.tsx) and [`PortalPromotionModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/PortalPromotionModal.tsx) are `position: absolute` inside `canvasWrapRef` (`overflow: hidden`) without scrollable card bodies (`max-height` / `overflow-y: auto`), and `EmptyCanvasCreateModal` ([L373](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDialogs.tsx#L373)) uses a cramped 4-column button grid.
8. **iOS Safari `< 16px` Input Auto-Zoom & Accidental Touch Callouts:**
   - Search and inline travel-time inputs render at `11.8px–12px`, causing iOS Safari to auto-zoom the entire viewport on focus; SVG canvas lacks `user-select: none` / `-webkit-touch-callout: none`, causing long touches to trigger text selection or Android `contextmenu`.
9. **Mouse-Only & Keyboard-Only Editing Actions:**
   - Delete Location/Container, Set Starting Location, Convert to Container, and Move Out to Parent only exist in `MapContextMenu` (`onContextMenu`) or keyboard `Delete`. Edge editing/deletion relies on `onDoubleClick` and mouse hover (`isEditorQuickDeleteEnabled`).
10. **Weak `Center` Recovery Across Containers & Extreme Zooms:**
    - `handleCenter` ([`SpatialTopologyView.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/SpatialTopologyView.tsx#L719-L728)) falls back to `{ x: 0, y: 0 }` whenever `activeLoc` is not in the currently viewed container and nothing is selected, and never normalizes extreme zoom levels (`35%` / `300%`).

### 1.2 Approved Design Decisions
The following design decisions are finalized for v0.31.1:
1. **Single Zoom Control Surface (All Viewports):** Remove the duplicate `[ - | 100% | + ]` zoom group and `Center` text button from [`TopologyHeaderToolbar.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/TopologyHeaderToolbar.tsx) across **all** viewports. Keep the single bottom-right canvas overlay cluster: `Center` icon (all viewports) + `[ − | 100% | + ]` zoom pill (desktop `> 820px` only; hidden on mobile `<= 820px`).
2. **Mobile Zoom Gesture Model:** **Two-finger pinch-to-zoom** (focal-point anchored at pinch midpoint) + **double-tap on empty canvas** (focal-point zoom toggle for one-handed use).
3. **Mobile Node Interaction Model (`tap-to-select-first`):** On touch/mobile, swiping over an unselected node/container/ghost pans the map; tapping selects it, reveals its enlarged compass ports + a compact docked **Selection Peek Bar** (keeping the node and its ports unobstructed!), and enables dragging that selected node or dragging any of its compass ports. Expanding the full `MapDetailsDrawer` bottom sheet is an explicit second step from the peek bar.

---

## 2. Scope, Boundaries & Core Invariants

1. **Frontend-Only & Layering Compliance:**
   - Zero backend Python, SQLite, or REST API changes.
   - Pure geometry/gesture helpers belong in [`mapGeometry.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/mapGeometry.ts) or [`topologyProjection.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/topologyProjection.ts) with no upward or circular imports (`npm --prefix frontend run arch:check`).
   - All pure helpers and SSR component renders must run cleanly in Vitest's Node-only environment (`ReactDOMServer.renderToStaticMarkup`, `typeof document !== "undefined"` portal guards).
2. **Modular CSS & Canonical Breakpoints:**
   - Follow [`frontend/AGENTS.md`](file:///home/diegolima/Git/cybercantina/frontend/AGENTS.md): place styles in `frontend/src/styles/` (`06-inspector-and-lore.css`, `07-modals-and-forms.css`, `13-parties-and-map-search.css`, `15-responsive.css`), reuse semantic CSS tokens from `00-tokens.css`, avoid `!important`, align breakpoints to `620px` / `820px` / `1100px`, and pass `npm --prefix frontend run css:audit`.
   - Move layout-critical dimensions (`gridTemplateColumns`, modal `width`/`height`/`padding`) out of inline `style` props into CSS classes so responsive media queries override them cleanly.
3. **Desktop Workflow Preservation:**
   - Desktop (`> 820px` with fine pointer) retains the side-by-side canvas + `MapDetailsDrawer` split, immediate mouse left-drag on nodes, mouse-wheel zoom, left/middle-drag panning, double-click container drill-in & distance editing, hover quick-delete `"X"`, right-click `MapContextMenu`, and `MapPaletteBar` drag-and-drop.
   - Moving `Center` into the bottom-right canvas corner and removing the duplicate header zoom bar apply cleanly across **both** desktop and mobile.
4. **Campaign Fog-of-War & Lock Invariants:**
   - Touch gestures, peek-bar quick actions, search, bottom-sheet inspection, and `+` fallbacks must strictly respect `mode`, `isMutatingLocked`, `unlockLore`, and `bundle.visible_locations`. Read-only campaign sessions must never expose edit/delete mutations.
5. **Dual-Host Compatibility (`LiveInspector` + `WorldInspectorModal`):**
   - `SpatialTopologyView` layout, touch gestures, toolbar consolidation, peek bar, and bottom-sheet drawer must work identically inside both `LiveInspector`'s full-screen map modal and `WorldInspectorModal`'s Map tab on mobile.

---

## 3. Functional Requirements

### FR-1: Portal-Mounted Full-Screen Expanded Map Modal (`LiveInspector.tsx`, `WorldInspectorModal.tsx`)
1. **Portal Escape & Full-Screen Mobile Shell (`LiveInspector.tsx`):**
   - Render the `showFullMap` modal backdrop via `createPortal(..., document.body)` (falling back to inline render during SSR when `typeof document === "undefined"`), escaping `.inspector--overlay`'s stacking context (`z-index: 40` / slide animation).
   - Replace inline modal sizing with `.map-fullscreen-modal-backdrop` and `.map-fullscreen-modal-panel`:
     - Desktop (`> 820px`): `width: min(1100px, 95vw)`, `height: min(900px, 92vh)`, `max-height: 92vh`, `padding: 16px`, rounded corners.
     - Mobile (`<= 820px`): `width: 100vw`, `height: 100dvh`, `max-width: 100vw`, `max-height: 100dvh`, `border-radius: 0`, `border: none`, `padding: max(8px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left))`, `overflow: hidden`, `overscroll-behavior: contain`.
   - Lock background `document.body` scroll while `showFullMap` is open on mobile so rubber-band scrolling never shifts the underlying chat/inspector.
2. **Always-Accessible Close Button & Unsaved-Changes Safety:**
   - Keep the top-right `X` close button (`handleCloseClick`) permanently visible with a `>= 36×36px` touch target on mobile.
   - Ensure clicking the modal backdrop on desktop also invokes the dirty-check guard (or routes through the same close confirmation) rather than silently discarding unsaved edits.
3. **`WorldInspectorModal` & `InspectorLocationCard` Alignment:**
   - Extend `.modal-panel--sheet-wide` in [`07-modals-and-forms.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles/07-modals-and-forms.css#L458-L465) to `<= 820px` (`width: 100vw; height: 100dvh; max-height: 100dvh; border-radius: 0; border: none`) so World Editor map authoring on phones/tablets gets full-screen real estate too.
   - Allow [`InspectorLocationCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/inspector/InspectorLocationCard.tsx#L161-L198)'s header (`Adjacent Map` / `World Sheet` / `Expand Map`) to wrap cleanly in narrow mobile inspector drawers without clipping buttons.

---

### FR-2: Single-Canvas Mobile Layout, Docked Selection Peek Bar & Bottom-Sheet Drawer
1. **Replace Fixed Inline Split Grid (`SpatialTopologyView.tsx`):**
   - Replace the inline `gridTemplateColumns: "minmax(460px, 1.85fr) minmax(300px, 1fr)"` container with `.map-topology-split`:
     - Desktop (`> 820px`): `display: grid; grid-template-columns: minmax(0, 1.85fr) minmax(300px, 1fr); gap: 14px;`.
     - Mobile (`<= 820px`): `display: flex; flex-direction: column; gap: 0; position: relative;` where the canvas wrapper (`flex: 1; min-height: 0;`) fills all remaining viewport height.
   - Hide the `"No Map Element Selected"` placeholder card completely on `<= 820px`.
2. **Two-Stage Mobile Selection UX (Peek Bar -> Expanded Bottom Sheet):**
   - Because mobile uses **tap-to-select-first**, selecting a node must **not** immediately cover the canvas with a `68dvh` drawer (which would block dragging the selected node or pulling from its bottom compass ports).
   - **Initial Mount on Mobile (`<= 820px`):** Open with `isMobileSheetExpanded = false` (and no full sheet covering the map).
   - **Stage 1 — Docked Selection Peek Bar:** When any location, container, or ghost node is selected on `<= 820px` (and the full sheet is collapsed), render a compact single-row **Selection Peek Bar** (`~56–62px` height) **docked as a flex footer immediately below `canvasWrapRef`**. Docking it below the canvas guarantees **zero collision** with floating bottom-left (`?` / `+`) and bottom-right (`Center`) controls!
     - Contents: element icon + truncated name + subtle status badge (`Current` / `L#` / `Ghost`) + 1-tap contextual primary action:
       - Location in campaign mode (when not current & `onOverrideLocation` exists): compact `"Move Here"` (`LocationOverrideButton`)
       - Container: compact `"Enter"` (`onDrillIntoContainer`)
       - Ghost node: compact `"Jump"` (`onJumpToContainer`)
       - Plus `"Details"` expand button (chevron-up) and `"×"` deselect button.
   - **Stage 2 — Expanded Bottom Sheet (`MapDetailsDrawer.tsx`):** Tapping `"Details"` (or the peek bar's title area) opens `MapDetailsDrawer` as a bottom-anchored overlay sheet (`position: fixed` or `absolute` over `.map-topology-split`, `max-height: 70dvh`, rounded top corners, sticky header with close `X` button, internal `overflow-y: auto; overscroll-behavior: contain`) with a tap-outside scrim that collapses back to the map.

---

### FR-3: 1:1 Touch Panning, Aspect-Adaptive `viewBox`, Pinch-to-Zoom, Double-Tap Zoom & `tap-to-select-first`
1. **Aspect-Adaptive `viewBox` & Portrait Legibility (`SpatialTopologyCanvas.tsx`, `mapGeometry.ts`):**
   - Measure the SVG container (`canvasWrapRef`) via `ResizeObserver` and compute a centered `viewBox` (`-vbW/2 -vbH/2 vbW vbH`) matching the canvas aspect ratio so portrait phones do **not** letterbox a `680×520` box to `0.57×` scale:
     - Keep `680×520` as the default fallback when container dimensions are unavailable (e.g., SSR / Node Vitest).
     - Anchor the base world density so nodes and labels stay crisp and tappable on portrait phones (e.g., maintaining `svgScale ≈ 1.0` CSS px per world unit at `zoom = 1` on narrow screens, or clamping `vbW`/`vbH` directly to container dimensions while keeping `(0, 0)` centered).
   - Verify `clientToWorldPoint` and `worldPointToWrapperPoint` in [`topologyProjection.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/topologyProjection.ts#L812-L892) continue to rely on `getScreenCTM()` in live browsers and stay consistent with the fallback dimensions in tests.
2. **1:1 Finger-Locked Pointer Panning (`SpatialTopologyCanvas.tsx`):**
   - Set `touch-action: none`, `user-select: none`, `-webkit-user-select: none`, and `-webkit-touch-callout: none` on the topology `<svg>`.
   - Migrate canvas panning from `onMouseDown`/`mousemove`/`mouseup` to Pointer Events (`onPointerDown` + `window` `pointermove`/`pointerup`/`pointercancel`), scoped to `activePanPointerId`.
   - Convert client pixel deltas (`rawDx`, `rawDy`) to SVG world units using the live SVG scale (`rawDx / (svgScale * zoom)`, `rawDy / (svgScale * zoom)`, computed via `getScreenCTM()` / `viewBox` ratio) so the map stays **glued 1:1 under the user's finger** at every screen size and zoom level.
   - Preserve desktop left-button and middle-button drag panning and wheel zoom.
3. **`tap-to-select-first` & Pass-Through Panning (Nodes, Containers, Ghosts & Distance Badges):**
   - Detect touch/mobile interaction via `ev.pointerType === "touch"` (or mobile viewport `<= 820px`).
   - **Locked nodes (`isMutatingLocked === true`) OR unselected nodes on touch (`tap-to-select-first`):**
     - Do **not** start `nodeDrag` or block canvas panning on `pointerdown`.
     - Track the pending tap target alongside canvas pan: if total pointer travel stays `<= 5px` on `pointerup`, treat it as a tap and select that location/container/ghost (showing its ports + Selection Peek Bar); if travel exceeds `> 5px`, seamlessly pan the canvas without changing selection.
   - **Already-selected node/container/ghost on touch (when `!isMutatingLocked`):**
     - Dragging starts `nodeDrag` normally so the user can reposition it or drop it into a container.
     - Pulling any of its 8 visible compass ports starts `linkDrag` (connecting to another node or dropping onto empty canvas to open `EmptyCanvasCreateModal`).
   - **Distance badges ([`SpatialTopologyCanvas.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/SpatialTopologyCanvas.tsx#L687)):**
     - Replace `onMouseDown={(ev) => ev.stopPropagation()}` with tap-vs-pan disambiguation so swipes starting on a badge pan smoothly instead of stalling.
4. **Two-Finger Midpoint Pinch-to-Zoom (`mapGeometry.ts` + `SpatialTopologyCanvas.tsx`):**
   - Maintain a `Map<number, { clientX: number; clientY: number }>` of active touch pointers on `<svg>`.
   - When 2 pointers become active:
     - Immediately cancel any active single-finger pan, `nodeDrag`, or `linkDrag` so nodes never jump.
     - Compute initial pointer distance `d0`, midpoint world coordinate `W_mid`, and initial `zoom0`.
     - On each move, compute `nextZoom = clampZoom(zoom0 * (dCurr / d0))` and solve `nextPan` so `W_mid` remains visually pinned under the current midpoint `(midX, midY)`.
   - When one finger lifts (2 -> 1 pointer), cleanly end or rebase the remaining pointer without snapping `pan` or `zoom`.
5. **Double-Tap on Empty Canvas to Zoom:**
   - Track the last confirmed empty-canvas tap (`timestamp`, `clientX`, `clientY`, `pointerType === "touch"`).
   - If a second empty-canvas tap occurs within `<= 300ms` and `<= 28px` distance (with zero dragging and no node/container/ghost/badge/overlay hit):
     - If `zoom < 1.5`, zoom in to `clampZoom(zoom + 0.75)` (or `1.75`) anchored around the tapped world coordinate.
     - If `zoom >= 1.5`, smoothly reset to `zoom = 1` anchored around the tapped point (or recentered).
   - Apply `touch-action: manipulation` on all floating HTML overlay buttons so rapid tapping never triggers browser page zoom.
6. **Pointer ID Isolation & Cancel Cleanup (`useTopologyPointerDrag.ts`):**
   - Store `pointerId` on `nodeDrag` and `linkDrag`; ignore `pointermove`/`pointerup` events from mismatched `pointerId`s.
   - Add `window` `pointercancel` (and `blur`) listeners to reset `nodeDrag`, `linkDrag`, and pan state cleanly when OS gestures or multi-touch interrupt a drag.
   - Suppress accidental touch-triggered `onContextMenu` on coarse pointers (`pointerType === "touch"` / `<= 820px`), while keeping desktop mouse right-click intact.

---

### FR-4: Universal Floating Bottom-Right `Center` Icon, Smart Recovery & Zoom Consolidation
1. **Remove Duplicate Header Zoom & `Center` Controls (`TopologyHeaderToolbar.tsx`):**
   - Remove the `Map zoom controls` (`[ - | 100% | + ]`) group and the `<Crosshair /> Center` button from `TopologyHeaderToolbar` on **all** viewports (removing unused `zoom`, `setZoom`, `handleCenter` props from `TopologyHeaderToolbarProps`).
2. **Floating Bottom-Right Canvas Cluster (`SpatialTopologyCanvas.tsx`):**
   - Render a clean bottom-right floating control stack (`right: 10px; bottom: 10px`):
     - **Floating `Center` icon button** (`Crosshair`, `aria-label="Center on Selected / Active Location"`, `title="Center on Selected / Active Location"`): visible on **all** viewports (`38×38px` touch target on `<= 820px`, `32×32px` on desktop).
     - **Floating Zoom Pill** (`data-testid="canvas-zoom-indicator"`, `[ − | 100% | + ]`): visible on desktop (`> 820px`), hidden on mobile (`<= 820px`) via CSS class (in favor of pinch-to-zoom + double-tap on empty canvas).
3. **Smart `handleCenter` Recovery (`SpatialTopologyView.tsx`):**
   - Resolve target in order:
     1. Selected container / selected location / selected ghost (if present in the current view's `fullMapCoords` / `ghostCoords`).
     2. `activeLoc` (if visible in current view) OR the visible ancestor container supernode that contains `activeLoc` (if viewing a parent container).
     3. If `activeLoc` is in a sibling/unrelated container not represented in the current view and nothing is selected, switch to `activeLoc`'s containing scope (`handleJumpToContainer`) and center on `activeLoc`.
   - If `zoom < 0.6` or `zoom > 2.2`, reset `zoom` to `1` alongside centering so lost/over-zoomed users immediately recover a readable view.

---

### FR-5: Compact Mobile Header Toolbar & Scrollable Breadcrumbs
1. **Single-Row Compact Mobile Header (`TopologyHeaderToolbar.tsx`):**
   - On `<= 820px` (and especially `<= 620px`), render a single compact top row:
     - Left: Compass icon + truncated title (`min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`).
     - Right: `Search` icon button (toggles an inline/expanded search bar row with auto-focus and clear/close button), compact `Save` button (only when `hasSaveMap && !isMutatingLocked`, icon + short label or icon when clean), compact `Re-imagine` icon button (editor mode only), and `X` close button (`>= 36×36px`).
   - Set `font-size: 16px` on the mobile search `<input>` (`<= 820px`) so iOS Safari never auto-zooms the page on focus, and clamp `.map-search-dropdown` to `max-width: calc(100vw - 16px)`.
2. **Single-Line Horizontally Scrollable Breadcrumbs:**
   - On `<= 820px`, style the breadcrumb bar with `flex-wrap: nowrap; overflow-x: auto; white-space: nowrap; scrollbar-width: none;` and auto-scroll the active leaf crumb into view so deep container hierarchies take only one compact horizontal strip.

---

### FR-6: Mobile Palette Suppression with Undo, Validation & Creation Fallbacks
1. **Hide Creation Palette on Mobile & Locked Views (`MapPaletteBar.tsx`):**
   - Hide the horizontal `MapPaletteBar` creation buttons (`+ Location`, `+ Passage Hub`, `+ Container`) on `<= 820px`, and hide creation buttons whenever `isMutatingLocked` is `true` across all viewports (eliminating an entire row of disabled buttons in read-only campaign views).
   - Hide the green `"All Paths Valid"` badge on `<= 820px`.
2. **Preserve `Undo` and Actionable Validation Pills on Mobile:**
   - Whenever `undoCount > 0 && !isMutatingLocked`, render a compact floating `Undo (N)` button in the top-left of the canvas on mobile (`<= 820px`).
   - Whenever `validationMessage || unreachableCount > 0`, render a compact amber warning button (`! N Unlinked` / error badge) in the top-left stack on mobile that still triggers `onFocusInvalid` on tap.
3. **Touch-Friendly Compass Ports & Compact `+` Creation Fallback:**
   - When a node or container is selected on touch/coarse pointers, increase the transparent port hit target (`PORT_TOUCH_HIT_RADIUS`, e.g., `14` SVG units vs desktop `8`) and push ports slightly outward (or keep visual rings clear) so dragging a port into empty space reliably opens `EmptyCanvasCreateModal` without accidentally dragging the node body.
   - When `!isMutatingLocked` on `<= 820px`, render a compact floating `+` button (bottom-left next to `?`) that opens a lightweight popover (`+ Location`, `+ Passage Hub`, `+ Container`) for standalone/unlinked creation or when all 8 ports on a node are occupied.

---

### FR-7: Collapsible Mobile Legend & Touch-Appropriate Copy
1. **Collapse Legend & Hide Desktop-Only Hints (`SpatialTopologyCanvas.tsx`):**
   - Hide the full bottom-left legend bar and mouse/keyboard hint string (`"Drag nodes · Middle-drag to pan · Drag ports to link · Double-click distance · Right-click for actions"`) on `<= 820px` (and hide mouse-only hint text whenever `@media (hover: none) and (pointer: coarse)`).
   - Render a compact circular `?` button (`aria-label="Toggle map legend"`, `36×36px`) at the bottom-left on mobile that toggles a compact, dismissible legend popover displaying node/badge symbols and accurate touch instructions (`Drag to pan · Pinch or double-tap to zoom · Tap node to select · Drag ports to link`).

---

### FR-8: Touch Parity for Editing Actions & Mobile-Safe Inner Dialogs
1. **Node/Container Action Parity in `MapDetailsDrawer.tsx`:**
   - When `!isMutatingLocked`, surface the actions currently exclusive to `MapContextMenu` or `Delete` key inside `MapDetailsDrawer` (e.g., a clean "Actions" footer/section or compact header action strip):
     - **Delete Location / Delete Container** (respecting `canDeleteLocation` / `canDeleteContainer`, showing disabled state + block reason caption when locked)
     - **Set as Starting Location** (`mode === "editor"` and `!is_starting_location`)
     - **Convert to Container (L1)** (`canConvertLocation`)
     - **Move Out to Parent** (`canMoveOutToParent`, removing the need to drag a node onto the breadcrumb bar on touch)
2. **Touch Edge Editing & Inline Overlay Hardening (`SpatialTopologyCanvas.tsx`):**
   - In `mode === "editor"` (`!isMutatingLocked`), allow **single-tapping** a distance badge on touch (`pointerType === "touch"` with movement `<= 5px`) to open `inline-edge-editor` or `MultiEdgePopover`.
   - In `inline-edge-editor`:
     - Stop `onPointerDown` propagation in addition to `onMouseDown` so tapping `−` / `+` / `<input>` never initiates a canvas pan.
     - Enlarge `−` / `+` stepper buttons on coarse pointers (`>= 30×30px`) and use `font-size: 16px` on mobile to prevent iOS Safari focus auto-zoom.
3. **Scrollable, Keyboard-Safe Inner Modals (`MapDialogs.tsx`, `PortalPromotionModal.tsx`):**
   - Ensure all inner modal cards (`PassageHubCollisionModal`, `EmptyCanvasCreateModal`, `GroupIntoContainerModal`, `StandaloneContainerCreateModal`, `MultiEdgePopover`, `PortalPromotionModal`, `MapIconBrowserModal`) constrain `max-height: calc(100% - 16px)` with `overflow-y: auto; overscroll-behavior: contain;` so submit buttons remain reachable even when a mobile virtual keyboard reduces viewport height.
   - Switch `EmptyCanvasCreateModal`'s 4-button kind selector (`gridTemplateColumns: "repeat(4, minmax(0, 1fr))"`) to a CSS class that wraps to `repeat(2, minmax(0, 1fr))` on `<= 620px`.

---

## 4. Edge Cases & Interaction Matrix

| Scenario | Expected Behavior |
| :--- | :--- |
| User drags one finger across empty canvas on a `390×844` portrait phone | Map pans 1:1 locked under the finger (corrected for SVG `viewBox` scale × `zoom`); page does not scroll or rubber-band (`touch-action: none`, `overscroll-behavior: contain`). |
| User drags one finger starting on an **unselected** node, container, ghost, or distance badge on mobile | Because `tap-to-select-first` applies on touch, travel `> 5px` pans the canvas smoothly without moving the node or changing selection. |
| User taps an unselected node (`<= 5px` movement) on mobile | Node becomes selected (halo + enlarged compass ports visible), and the compact **Selection Peek Bar** docks below the canvas without obscuring the node, its ports, or floating corner buttons. |
| User drags an **already-selected** node on mobile (unlocked editor) | Node drags cleanly to new coordinates (or onto a container to nest); dropping preserves Undo history. |
| User pulls a compass port on a selected node into empty space on mobile | `EmptyCanvasCreateModal` opens with a scrollable card and `2×2` kind selector; virtual keyboard never clips the submit button. |
| User pinches with two fingers while mid-pan or mid-node-drag | Single-pointer drag cancels cleanly (`pointercancel` / 2-pointer guard); map zooms anchored at the pinch midpoint within `[MIN_MAP_ZOOM, MAX_MAP_ZOOM]`. |
| User double-taps empty canvas on mobile | Zooms in around the tapped point (`zoom < 1.5` -> `zoom + 0.75` clamped) or resets to `100%` (`zoom >= 1.5`) without triggering browser page zoom. Double-tapping a node/button does not trigger canvas zoom. |
| User taps `Move Here` / `Enter` / `Jump` in the Selection Peek Bar | Executes immediately in 1 tap without expanding the full `MapDetailsDrawer` sheet. |
| User taps `Details` on the Selection Peek Bar | Expands `MapDetailsDrawer` as a scrollable bottom sheet (`max-height: 70dvh`) with full description, lore, exits, and (when unlocked) Delete / Convert / Move Out / Set Starting actions. |
| User opens `Expand Map` from `LiveInspector` overlay drawer on mobile | Modal portals to `document.body` at `100vw × 100dvh` above all drawers, with truncated single-row header, expandable search (`16px` input, no iOS zoom), and top-right `X` close button. |
| User pans far away, drills to another container, or zooms to `35%`, then taps bottom-right `Center` icon | Centers on selected node/active player (switching back to `activeLoc`'s container if nothing is selected and player isn't represented in current view) and normalizes extreme zoom back to `100%`. |
| User views the map on desktop (`> 820px`) | Header no longer shows duplicate zoom or `Center`; bottom-right canvas corner shows `Center` icon + `[ − | 100% | + ]` zoom pill; side-by-side split, immediate mouse node-drag, wheel zoom, hover quick-delete, right-click menu, and palette bar all work unchanged. |

---

## 5. Acceptance Criteria & Verification Matrix

### 5.1 Automated Test Criteria
1. **Pure Geometry & Gesture Helper Unit Tests (Node Vitest):**
   - 1:1 SVG-scale pan helper converts CSS pixel deltas into exact world-unit deltas across portrait (`390×700`) and desktop (`680×520`) viewports and arbitrary zoom levels.
   - Aspect-adaptive `viewBox` helper centers `(0, 0)` and preserves readable scale on portrait dimensions, falling back to `-340 -260 680 520` when dimensions are zero/missing.
   - Pinch midpoint focal math preserves the world point under the midpoint across zoom changes clamped to `[MIN_MAP_ZOOM, MAX_MAP_ZOOM]`.
   - Double-tap empty-canvas zoom helper toggles zoom-in / reset around the tapped world point and rejects taps spaced `> 300ms` or `> 28px` apart.
   - Tap-vs-pan classifier distinguishes `<= 5px` tap from `> 5px` pan, and enforces `tap-to-select-first` on touch pointers.
2. **Component & SSR Tests (`frontend/src/components/__tests__/`):**
   - [`mapSearch.test.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/__tests__/mapSearch.test.tsx) updated to reflect removal of the duplicate `Map zoom controls` group from `TopologyHeaderToolbar` while verifying the search combobox and backwards compatibility.
   - `SpatialTopologyView` uses `.map-topology-split` (no hardcoded `minmax(460px, 1.85fr)` inline grid), renders bottom-right `Center` icon (`aria-label="Center on Selected / Active Location"`), keeps `data-testid="canvas-zoom-indicator"` on the canvas overlay, and sets `touchAction: "none"` on `<svg>`.
   - `MapDetailsDrawer` renders touch-accessible Delete / Set Starting / Convert to Container / Move Out actions when unlocked, and hides/locks them when `isMutatingLocked === true`.
   - Regression checks pass in [`mapEditor.test.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/__tests__/mapEditor.test.tsx) and [`locationContainers.test.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/__tests__/locationContainers.test.tsx).
3. **Playwright Mobile E2E Tests (`frontend/e2e/` — `390×844`, `hasTouch: true`):**
   - Expanded map modal from `LiveInspector` opens full-screen (`100vw × 100dvh`) portaled above drawers with visible `X` close button and zero horizontal document overflow.
   - Touch drag starting on empty canvas **and** starting on an unselected/locked node pans the map 1:1 without scrolling the page.
   - Tapping a node opens the docked Selection Peek Bar without obscuring floating corner buttons; tapping `Details` opens the scrollable bottom sheet; tapping empty canvas dismisses it.
   - Double-tapping empty canvas zooms in/resets; tapping bottom-right `Center` recenters the viewport.
   - Desktop regression suite ([`03-spatial-topology-map-editor.spec.ts`](file:///home/diegolima/Git/cybercantina/frontend/e2e/03-spatial-topology-map-editor.spec.ts)) stays green.

### 5.2 Repository Verification Gates (Required on Implementation Completion)
- **Frontend architecture, CSS audit, build & unit tests:**
  ```bash
  npm --prefix frontend run arch:check && npm --prefix frontend run css:audit && npm --prefix frontend run build && npm --prefix frontend test
  ```
- **Playwright E2E tests (mobile + map editor):**
  ```bash
  npm --prefix frontend run typecheck:e2e && npm --prefix frontend run test:e2e
  ```
- **Architecture docs check (if modules/docstrings change):**
  ```bash
  backend/.venv/bin/python scripts/generate_arch_docs.py && backend/.venv/bin/python scripts/generate_arch_docs.py --check
  ```
- **User-facing documentation sync:**
  - Update [`Live-Inspector-Map-and-Timeline.md`](file:///home/diegolima/Git/cybercantina-wiki/Live-Inspector-Map-and-Timeline.md) and [`Authoring-Worlds-Characters-and-Personas.md`](file:///home/diegolima/Git/cybercantina-wiki/Authoring-Worlds-Characters-and-Personas.md) to document mobile full-screen map navigation, 1:1 touch panning, pinch & double-tap zoom, tap-to-select-first peek bar + bottom sheet, universal bottom-right `Center` icon, collapsible `?` legend, and drawer action parity; verify with `git -C ../cybercantina-wiki diff`.
