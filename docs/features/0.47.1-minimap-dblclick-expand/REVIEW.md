---
feature: minimap-dblclick-expand
target_version: 0.47.1
document_type: review
status: completed
last_updated: 2026-11-26
---

# Pre-Implementation Review — Minimap Double-Click / Double-Tap to Expand

## Key Architectural Traps & Mitigations

### 1. Initial Mount Focus vs. `externalFocusRequest` in `SpatialTopologyView.tsx`
- **Trap:** `LiveInspector.tsx` mounts `SpatialTopologyView` inside a conditional `{showFullMap && ...}` portal. On mount, `SpatialTopologyView` computes `initialFocus` via `resolveInitialMapFocus(propContainers, propLocations, activeLocationId)` (`SpatialTopologyView.tsx` lines 346–350) and initializes `selectedLocId` from `defaultSelectedLocationId` (lines 353–360). Meanwhile, `handleOpenFullMap` previously called `setSelectedLocId(activeLoc.id)` unconditionally before setting `showFullMap(true)`, which overwrote any selected neighbor and could not focus a container or cross-container location.
- **Mitigation:**
  - Replace the boolean-only open trigger in `LiveInspector.tsx` with an explicit open-intent state alongside `showFullMap` (e.g., `fullMapOpenIntent` covering `"empty" | "active" | "location" | "container"` with an incrementing `nonce`).
  - Pass `defaultSelectedLocationId={null}` when opened from empty space, `defaultSelectedLocationId={activeLoc.id}` when opened from `[↗ N]`, and pass `externalFocusRequest={{ kind: "location" | "container", id, nonce }}` when opened for a specific location or container.
  - Because `SpatialTopologyView` already processes `externalFocusRequest` in a `useEffect` (lines 985–1024)—jumping into `targetLoc.container_id ?? null` for locations or `targetCont.parent_container_id ?? null` for containers, clearing competing selections, and centering/panning onto the node—both same-container and cross-container targets work consistently with map search and World Codex "View on Map".
  - Reset `fullMapOpenIntent` cleanly when the modal closes so subsequent opens via `[↗ N]` never reuse a stale focus request.

### 2. Touch Double-Tap Reliability, Swipe/Scroll Interference & Synthetic `dblclick` Duplication
- **Trap:** Relying solely on React `onDoubleClick` fails inconsistently on mobile touch browsers (especially alongside `touch-action: manipulation`). Conversely, attaching naive `pointerup` double-tap logic on the minimap can conflict with `useDrawerSwipeDismiss` on the overlay `<aside>` in `LiveInspector.tsx` or fire twice when a browser emits both two touch `pointerup`s and a synthetic `dblclick`.
- **Mitigation:**
  - Track touch taps (`e.pointerType === "touch"`) per pointer ID from `pointerdown` -> `pointermove` (cancel candidate if moved beyond a small drag threshold, e.g. `10px`) -> `pointerup` / `pointercancel`.
  - Reuse `DOUBLE_TAP_MAX_MS` (`300`) and `DOUBLE_TAP_MAX_DIST_PX` (`28`) from `frontend/src/components/map/mapGeometry.ts` (matching `SpatialTopologyCanvas.tsx` lines 562–567), ensuring consecutive taps also match the same target key (`"empty"`, `"container"`, or `location:<id>`).
  - Record a short suppression timestamp (~400ms) when a touch double-tap triggers so any trailing synthetic `dblclick` is ignored.
  - Apply `touch-action: manipulation` and `user-select: none` on the minimap `<svg>` (`InspectorLocationCard.tsx` / `06-inspector-and-lore.css`).

### 3. SVG Event Bubbling & Active Container Pill Hit Target
- **Trap:** Currently in `InspectorLocationCard.tsx`, the top-left active container pill `<g>` has `pointerEvents="none"` (line 400), and location nodes only handle `onClick={() => setSelectedLocId(loc.id)}` (line 506). Adding `onDoubleClick` on the root `<svg>` without stopping propagation on nodes and the container pill will cause both element-level and empty-area handlers to fire. Moreover, `<g>` elements inside SVG have no intrinsic hover state unless styled via a CSS class.
- **Mitigation:**
  - Change the active container pill `<g>` to `pointerEvents="auto"` with a dedicated class (e.g., `.minimap-container-pill`) styled in `06-inspector-and-lore.css` for `cursor: zoom-in` and subtle hover highlight on its pill `<rect>`.
  - Handle target resolution cleanly (stopping propagation on node and container-pill double-click / touch double-tap events, or resolving the target via explicit target descriptors) so empty-area double-click only triggers when neither a node nor the container pill was targeted.
  - Keep the hub-and-spoke container envelope (`pointerEvents="none"`), compass rose (`pointerEvents="none"`), and 1-hop exit rays (`pointerEvents="none"`) non-interactive so they naturally fall through to empty-area expansion.

### 4. Mobile `< 620px` Bottom Sheet Auto-Expansion
- **Trap:** Opening the full map on mobile with a selected location or container could cover the canvas if `isMobileSheetExpanded` were set to `true`.
- **Mitigation:** `SpatialTopologyView.tsx` initializes `isMobileSheetExpanded` to `false` (line 411) and renders `map-mobile-peek-bar` whenever `hasDetailsOpen` is true and `!isMobileSheetExpanded` (lines 2088–2232). Passing `externalFocusRequest` leaves `isMobileSheetExpanded` as `false`, displaying the centered element plus the compact peek bar with 1-tap `Details` / `Move Here` / `Enter`.

### 5. Layer Boundaries & Node-Only Vitest Environment
- **Trap:** `frontend/package.json` runs Vitest in Node without `jsdom`. Any gesture helper using top-level `window` or `document` references, or violating `.dependency-cruiser.cjs` rules, will fail `npm --prefix frontend test` or `arch:check`.
- **Mitigation:**
  - Verify `components/inspector` -> `components/map` is already permitted in `frontend/.dependency-cruiser.cjs` (as documented in `docs/architecture/FRONTEND_GRAPH.md` and used by `InspectorLocationCard.tsx` importing `mapIcons.ts`).
  - Extract double-tap state transitions and open-intent resolution into pure TypeScript helpers (zero DOM globals) in `frontend/src/components/inspector/miniMapGeometry.ts` (or a sibling helper in `components/inspector/`), and test them directly alongside `ReactDOMServer.renderToStaticMarkup` assertions for `InspectorLocationCard` and `LiveInspector`.
