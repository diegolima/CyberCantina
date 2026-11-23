---
feature: mobile-map-ux
target_version: 0.31.1
document_type: plan
status: completed
last_updated: 2026-11-23
---

# Implementation Plan & Progress Tracker
## Mobile Spatial Topology Map UX & Touch Ergonomics (`v0.31.1`)

**FRD:** [FRD.md](file:///home/diegolima/Git/cybercantina/docs/features/0.31.1-mobile-map-ux/FRD.md)

## Implementation Checklist

- [x] **1. Pure Geometry, Viewport & Touch Math** ([`mapGeometry.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/mapGeometry.ts), [`topologyProjection.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/topologyProjection.ts))
  - Added `computeResponsiveViewBox`, `computeSvgClientScale`, `computePanDeltaWorld`, `computePinchZoomPan`, `computeDoubleTapZoomPan`, `shouldDeferNodeDragToTapFirst`, and `PORT_TOUCH_HIT_RADIUS`.
  - Added `pointerId` / `pointerType` to `NodeDragState` and `LinkDragState`, plus `viewBox` fallback support in `clientToWorldPoint` / `worldPointToWrapperPoint`.
- [x] **2. Multi-Touch Pointer Lifecycle & Canvas Overlays** ([`useTopologyPointerDrag.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/useTopologyPointerDrag.ts), [`SpatialTopologyCanvas.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/SpatialTopologyCanvas.tsx))
  - Scoped drag listeners by `pointerId` with `pointercancel` and `blur` cleanup.
  - Added `ResizeObserver` aspect-adaptive `viewBox`, `touch-action: none`, 1:1 SVG-scale pointer panning, two-finger midpoint pinch-to-zoom, empty-canvas double-tap focal zoom, and `tap-to-select-first` pass-through panning on nodes/containers/ghosts/badges.
  - Added universal floating bottom-right `Center` icon button, desktop-only zoom pill, mobile `?` legend toggle, mobile `+` creation FAB, top-left mobile `Undo` / validation pills, and touch-hardened `inline-edge-editor` & `data-edge-quick-delete` `onPointerDown` guards.
- [x] **3. Toolbar, Palette, Peek Bar & Layout** ([`TopologyHeaderToolbar.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/TopologyHeaderToolbar.tsx), [`MapPaletteBar.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapPaletteBar.tsx), [`SpatialTopologyView.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/SpatialTopologyView.tsx))
  - Removed duplicate header zoom controls and `Center` button across all viewports; added compact single-row mobile header with expandable search and horizontally scrollable breadcrumbs.
  - Replaced inline `minmax(460px, 1.85fr) minmax(300px, 1fr)` grid with `.map-topology-split`, docked Selection Peek Bar, and expandable mobile bottom sheet.
  - Upgraded `handleCenter` to walk ancestor containers, jump to `activeLoc` when needed, and normalize extreme zoom levels.
- [x] **4. Drawer Action Parity & Keyboard-Safe Sub-Dialogs** ([`MapDetailsDrawer.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDetailsDrawer.tsx), [`MapDialogs.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDialogs.tsx), [`PortalPromotionModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/PortalPromotionModal.tsx))
  - Added touch-accessible Location & Container Actions (Set Starting Location, Convert to Container, Move Out to Parent, Delete) inside `MapDetailsDrawer`.
  - Made all 7 inner sub-dialogs scrollable under mobile keyboards and wrapped `EmptyCanvasCreateModal`'s kind selector to `2×2` at `<= 620px`.
- [x] **5. Full-Screen Portal Modal & Modular CSS** ([`LiveInspector.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/LiveInspector.tsx), [`InspectorLocationCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/inspector/InspectorLocationCard.tsx), [`07-modals-and-forms.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles/07-modals-and-forms.css), [`13-parties-and-map-search.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles/13-parties-and-map-search.css), [`15-responsive.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles/15-responsive.css))
  - Portaled `showFullMap` to `document.body` at `100vw × 100dvh` on mobile with body scroll lock and `16px` input font-size guard against iOS Safari auto-zoom.
- [x] **6. Automated Tests & User-Facing Wiki Sync**
  - Added [`mapMobileGestures.test.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/__tests__/mapMobileGestures.test.tsx) and [`07-mobile-map-ux.spec.ts`](file:///home/diegolima/Git/cybercantina/frontend/e2e/07-mobile-map-ux.spec.ts); updated [`mapSearch.test.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/__tests__/mapSearch.test.tsx), [`mapEditor.test.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/__tests__/mapEditor.test.tsx), [`locationContainers.test.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/__tests__/locationContainers.test.tsx), and [`03-spatial-topology-map-editor.spec.ts`](file:///home/diegolima/Git/cybercantina/frontend/e2e/03-spatial-topology-map-editor.spec.ts).
  - Updated [`Live-Inspector-Map-and-Timeline.md`](file:///home/diegolima/Git/cybercantina-wiki/Live-Inspector-Map-and-Timeline.md) and [`Authoring-Worlds-Characters-and-Personas.md`](file:///home/diegolima/Git/cybercantina-wiki/Authoring-Worlds-Characters-and-Personas.md).
