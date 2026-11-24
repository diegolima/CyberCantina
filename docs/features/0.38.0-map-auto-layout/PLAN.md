---
feature: map-auto-layout
target_version: 0.38.0
document_type: plan
status: completed
last_updated: 2026-11-24
---

# Implementation Plan — v0.38.0 Scoped Map Auto-Layout

## Stage 0: Feature Package Lifecycle Artifacts
- [x] Author `FRD.md`
- [x] Author `REVIEW.md`
- [x] Author `PLAN.md`

## Stage 1: Pure Scoped Auto-Layout Engine & Camera Fit Helper
- [x] Create `frontend/src/components/map/mapAutoLayout.ts` with:
  - [x] Edge reduction per unordered visible node pair (flattening `groupedEdges`, preferring non-secret edges over secret edges, inverting `OPPOSITE_COMPASS` on reverse orientation, vector-averaging directions, taking min `distance_meters`)
  - [x] Monotonic log-compressed distance scaling (`150–460` SVG units) with footprint-aware minimum clearance
  - [x] Connected component partitioning & deterministic ordering (anchor component first)
  - [x] Phase A: Compass-guided BFS seed from component root
  - [x] Phase B: Deterministic directional stress/spring refinement for cycles and multi-path distances
  - [x] Phase C: Box-aware AABB overlap separation using `visibleFootprints`
  - [x] Phase D: Clean side-by-side shelf packing for disconnected components
  - [x] `computeViewportFitForCoords` helper returning clamped `{ pan, zoom }` for node + ghost bounding box

## Stage 2: Preview Lifecycle, Toolbar Trigger & Canvas Preview Bar
- [x] Update [`frontend/src/components/SpatialTopologyView.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/SpatialTopologyView.tsx):
  - [x] Gate `canAutoLayout = (mode === "editor" || unlockLore) && !isMutatingLocked`
  - [x] Add `autoLayoutPreview` state (`coords`, `priorPan`, `priorZoom`, `containerId`)
  - [x] Override `fullMapCoords` and `ghostCoords` (ignoring saved `currentGhostOverrides`) while previewing
  - [x] Compute and apply viewport auto-fit on Preview; restore `priorPan`/`priorZoom` on Reset; keep fitted camera on Apply
  - [x] Derive `effectiveMutatingLocked = isMutatingLocked || Boolean(autoLayoutPreview)` for canvas/palette/drawer/toolbar mutations and `Save Map`
  - [x] Auto-cancel preview on container navigation (`drillIntoContainer`, `handleJumpToContainer`), `Escape` key, or when `isMutatingLocked` / `unlockLore` invalidates eligibility
  - [x] Implement **Apply** via `commitNextGraph(nextGraph, true)` updating only scoped visible locations/containers and clearing `currentScopeContainer.ghost_coords` (single `undoStack` snapshot)
- [x] Update [`frontend/src/components/map/TopologyHeaderToolbar.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/TopologyHeaderToolbar.tsx) to render the **Auto-Layout** button (icon + label on desktop, icon-only on mobile, disabled when `< 2` visible nodes and no ghosts or saving)
- [x] Update [`frontend/src/components/map/SpatialTopologyCanvas.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/SpatialTopologyCanvas.tsx) to render the floating top-center Preview bar (`Auto-Layout Preview (Current View)` + **Apply** + **Reset**)
- [x] Add modular styles to [`frontend/src/styles/13-parties-and-map-search.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles/13-parties-and-map-search.css) and [`frontend/src/styles/15-responsive.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles/15-responsive.css)

## Stage 3: Tests & Verification
- [x] Add `frontend/src/components/__tests__/mapAutoLayout.test.tsx`:
  - [x] Unit tests for log-compressed distance monotonicity (`20m` < `200m` < `20km` within clamped band)
  - [x] Unit tests for compass orientation (N/E/S/W + reciprocal inversion), cycle refinement, and AABB non-overlap on wide container supernodes
  - [x] Unit tests for secret-edge weighting (non-secret preferred; secret fallback when secret-only)
  - [x] Unit tests for disconnected component packing and `computeViewportFitForCoords`
  - [x] SSR render tests verifying Auto-Layout button visibility (`editor`, `campaign` + `unlockLore=true` vs `unlockLore=false`, `isMutatingLocked=true`) and Preview bar markup
- [x] Run `npm --prefix frontend run arch:check && npm --prefix frontend run css:audit && npm --prefix frontend run build && npm --prefix frontend test`
- [x] Regenerate and verify architecture docs: `backend/.venv/bin/python scripts/generate_arch_docs.py && backend/.venv/bin/python scripts/generate_arch_docs.py --check`

## Stage 4: User-Facing Wiki Documentation & Lifecycle Closure
- [x] Update [`../cybercantina-wiki/Authoring-Worlds-Characters-and-Personas.md`](file:///home/diegolima/Git/cybercantina-wiki/Authoring-Worlds-Characters-and-Personas.md) and [`../cybercantina-wiki/Live-Inspector-Map-and-Timeline.md`](file:///home/diegolima/Git/cybercantina-wiki/Live-Inspector-Map-and-Timeline.md) and verify with `git -C ../cybercantina-wiki diff`
- [x] Update `FRD.md` and `PLAN.md` statuses to `completed`
