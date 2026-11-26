---
feature: minimap-dblclick-expand
target_version: 0.47.1
document_type: plan
status: completed
last_updated: 2026-11-26
---

# Implementation Plan — Minimap Double-Click / Double-Tap to Expand

## Step 1: Feature Spec Package
- [x] Create isolated worktree `.worktrees/minimap-dblclick-expand` on branch `feat/minimap-dblclick-expand`
- [x] Author `FRD.md` (`docs/features/TBD-minimap-dblclick-expand/FRD.md`)
- [x] Author `REVIEW.md` (`docs/features/TBD-minimap-dblclick-expand/REVIEW.md`)
- [x] Author `PLAN.md` (`docs/features/TBD-minimap-dblclick-expand/PLAN.md`)

## Step 2: Pure Gesture & Open-Intent Helpers
- [x] Add pure touch double-tap state helper & open-intent types (reusing `DOUBLE_TAP_MAX_MS` and `DOUBLE_TAP_MAX_DIST_PX` from `frontend/src/components/map/mapGeometry.ts`) in `frontend/src/components/inspector/miniMapGeometry.ts`:
  - Track touch `pointerdown` -> `pointermove` drag cancellation -> `pointerup` double-tap matching across same target key (`"empty"`, `"container"`, `location:<id>`)
  - Track synthetic `dblclick` suppression window after a touch double-tap fires

## Step 3: Full-Map Open Intent Wiring (`LiveInspector.tsx`)
- [x] Update `LiveInspector.tsx`:
  - Replace bare `handleOpenFullMap` reset behavior with structured open intent state (`"empty"` | `"active"` | `{ kind: "location"; id: string }` | `{ kind: "container"; id: string }`)
  - Keep `[↗ N]` header button opening centered on `activeLoc` with `activeLoc` selected
  - Pass `defaultSelectedLocationId={null}` when opened from empty minimap area, and `externalFocusRequest` (`kind: "location" | "container"`, `id`, `nonce`) when opened from a node, container pill, or preview-card "Inspect on map" button
  - Clear open-intent state cleanly when `SpatialTopologyView` closes

## Step 4: Minimap Interactions, Affordances & Preview Parity (`InspectorLocationCard.tsx` + CSS)
- [x] Update `frontend/src/components/inspector/InspectorLocationCard.tsx`:
  - Add `user-select: none`, `touch-action: manipulation`, `cursor: zoom-in`, tooltip (`"Double-click to expand full map"`), and double-click / touch double-tap handlers on the minimap `<svg>` for empty-area expansion
  - Wire double-click / touch double-tap handlers (with propagation stopped) on location node `<g>` elements, keeping single-click `setSelectedLocId(loc.id)` instant and adding helpful `<title>` tooltips
  - Enable `pointerEvents="auto"` on the top-left active container pill `<g>` with `.minimap-container-pill` styling (`cursor: zoom-in`, hover highlight, tooltip `"Double-click to inspect container on full map"`) and double-click / touch double-tap expansion (single-click remains no-op)
  - Add a compact keyboard-accessible **"Inspect on full map"** icon button in the selected-location preview card (`selectedLocation`) calling the location-focus open handler
- [x] Update `frontend/src/styles/06-inspector-and-lore.css`:
  - Add `.inspector-minimap-svg` (`user-select: none`, `touch-action: manipulation`, `cursor: zoom-in`) and `.minimap-container-pill` hover/cursor rules without `!important`

## Step 5: Automated Tests
- [x] Add/update Vitest tests in `frontend/src/components/__tests__/minimapDblClickExpand.test.tsx`:
  - Unit tests for pure touch double-tap helper: matching same-target double-tap within `DOUBLE_TAP_MAX_MS`/`DOUBLE_TAP_MAX_DIST_PX`, rejecting mismatched targets (e.g. node then empty area), cancelling on drag/scroll movement or `pointercancel`, and synthetic `dblclick` deduplication
  - SSR markup tests via `ReactDOMServer.renderToStaticMarkup` verifying `InspectorLocationCard` renders empty-area tooltip/class, interactive container pill class/title, location node tooltips, and the preview card's "Inspect on full map" button, plus `LiveInspector` wiring

## Step 6: Verification & Architecture Check
- [x] Verify architecture docs (`backend/.venv/bin/python scripts/generate_arch_docs.py --check`)
- [x] Run full frontend checks inside `.worktrees/minimap-dblclick-expand`:
  - `npm --prefix frontend run arch:check && npm --prefix frontend run css:audit && npm --prefix frontend run build && npm --prefix frontend test`

## Step 7: Planned User-Facing Wiki Updates
- [x] Inspect and update `../cybercantina-wiki/Live-Inspector-Map-and-Timeline.md` (Section `2. Map & Full Spatial Topology` -> `1-Hop Mini-Map`): document double-clicking/double-tapping empty minimap space (opens unobstructed full map), location nodes (jumps/centers/inspects location), active container pill (opens parent scope with container selected), and the preview card's **Inspect on full map** button.
- [x] Check `../cybercantina-wiki/First-Campaign-and-Interface-Tour.md` (no minimap section present; no edit needed).
