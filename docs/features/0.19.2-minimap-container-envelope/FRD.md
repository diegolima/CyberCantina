---
feature: minimap-container-envelope
target_version: 0.19.2
document_type: frd
status: completed
last_updated: 2026-11-18
---

# Feature Requirements Document (FRD)
## Mini-Map Hub-and-Spoke Container Envelope, Color Grouping & Genre-Neutral Boundary Markers

**Status:** Completed  
**Target Version:** CyberCantina v0.19.2  
**Scope:**
- Frontend Inspector & Mini-Map Rendering ([`LiveInspector.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/LiveInspector.tsx), [`InspectorLocationCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/inspector/InspectorLocationCard.tsx), and a new pure geometry helper module `frontend/src/components/inspector/miniMapGeometry.ts`)
- Frontend Tests ([`mapEditor.test.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/__tests__/mapEditor.test.tsx) and/or dedicated mini-map geometry/SSR unit tests)
- Backend Persistence, Schemas & API: **No changes required** (`CampaignStateBundle` already supplies `active_location`, `neighbor_locations`, and `containers`)

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
In the current right-pane Adjacent Map ([`InspectorLocationCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/inspector/InspectorLocationCard.tsx#L113-L359)), the active location's immediate container (`activeLoc.container_id`, rendered as `L{activeCont.depth} · {activeCont.name}`) is drawn as a **fixed-size `82×66` dashed rectangle** centered tightly around `miniMapCenter` (`(165, 95)`), while all 1-hop adjacent locations (`immediateNeighbors`) are placed on an outer `rx=102, ry=66` compass ellipse ([`LiveInspector.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/LiveInspector.tsx#L296-L310)).

This creates four concrete readability defects:
1. **False Spatial Exclusion:** Adjacent locations that belong to the **same** container as `activeLoc` sit completely outside the `82×66` container rectangle, visually implying they are outside the building/zone/settlement.
2. **No Color Grouping Between Inside and Outside Nodes:** `activeLoc` and its container box use amber (`#f59e0b` / `#fbbf24`), whereas *every* adjacent node—inside or outside the container—uses the identical cyan palette (`#0891b2` / `#67e8f9`). Without Gestalt color grouping, inside neighbors read as external.
3. **Weak & Incomplete Container-Crossing Cues:**
   - Edges that cross container boundaries (`crossesContainer`) only swap a `2px` `#06b6d4` solid line for a `#22d3ee` `2 2` dotted line ([`InspectorLocationCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/inspector/InspectorLocationCard.tsx#L193-L211)), which is barely legible and visually competes with `4 3` locked/hidden edge dashing.
   - The `[ContainerName]` external sub-label (`diffCont`, [lines 236–241](file:///home/diegolima/Git/cybercantina/frontend/src/components/inspector/InspectorLocationCard.tsx#L236-L241)) requires `loc.container_id` to be truthy, so when `activeLoc` is inside a container and an exit leads to an uncontained root location (`loc.container_id == null`), no external indicator appears beneath that node.
4. **Tight Vertical Bounds & Label Collisions:** In the `330×195` SVG `viewBox`, `N` (`y=29`) and `S` (`y=161`, label `y=179`) sit directly against the `N` (`y=14`) and `S` (`y=189`) compass rose letters, leaving no vertical headroom for an enveloping container outline or `[diffCont]` sub-labels, while the floating `L{depth} · {name}` label at `(128, 51)` sits directly across the `N` edge line.

### 1.2 Proposed Solution
1. **Hub-and-Spoke SVG `<mask>` Capsule Union (`FR-1` & `FR-2`):**
   - Replace the static `82×66` center box with a continuous, non-rectangular **hub-and-spoke capsule union** constructed via an SVG `<mask>` combining a center hub around `miniMapCenter` and rounded spoke capsules extending to every adjacent location sharing `activeLoc.container_id`.
   - Expand the SVG vertical headroom (`viewBox="0 0 330 236"`, `miniMapCenter = (165, 118)`, `rx = 102`, `ry = 72`), share layout constants from `miniMapGeometry.ts` between `LiveInspector.tsx` and `InspectorLocationCard.tsx`, and relocate the `L{depth} · {name}` container pill to a fixed top-left corner anchor.
2. **Gestalt Color Grouping (`FR-3`):**
   - Style same-container non-hub neighbor nodes in a cohesive secondary warm-amber palette so they perceptually group with `activeLoc` and the container envelope, while preserving hub purple (`#a855f7`) and reserving cool cyan strictly for external locations.
3. **Genre-Neutral Boundary Markers & Uncontained Exit Labeling (`FR-4`):**
   - Render a crisp, genre-neutral perpendicular boundary marker (threshold gate tick) across every `crossesContainer` edge at an unobstructed pixel-safe point along the ray—working equally well for fantasy dungeons, cyberpunk megablocks, starships, or wilderness zones.
   - Surface an explicit `[Outside]` label under uncontained (`container_id == null`) adjacent locations whenever `activeLoc` belongs to a resolved container.

---

## 2. Scope, Boundaries & Core Invariants

1. **Pure SVG / Frontend-Only Change:**
   - Zero backend, database, or API changes. Uses existing `activeLoc.container_id`, `immediateNeighbors`, and `containerMap` props.
2. **True Compass Fidelity Preserved:**
   - Neighbors must continue using `pickCompassSlot` and `COMPASS_ANGLES` without reordering or clustering slots by container, so compass directions (`N`, `NE`, `E`, etc.) always remain spatially trustworthy.
3. **Depth-Agnostic & Hierarchical Containment (`L1`–`L4`):**
   - `activeLoc.container_id` may reference a container at any depth (`1` Building/Landmark, `2` District/Zone, `3` City/Settlement, or `4` Region/Planet/Realm per [`CONTAINER_DEPTH_LABELS`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/topologyProjection.ts#L218-L223)).
   - Containment membership is **ancestor-inclusive downward**: an adjacent location is inside `activeCont` if its `container_id` equals `activeCont.id` **or** walks upward via `parent_container_id` (cycle-guarded) to `activeCont.id`. Thus an `L3` City encloses adjacent locations in nested `L2` Districts or `L1` Buildings inside that City, whereas an `L1` Building encloses only locations within that same `L1` (excluding sibling `L1`s under the same `L2`/`L3` and excluding parent `L2`/`L3` exteriors).
   - If `activeLoc.container_id` is set but missing from `containerMap` (`activeCont === null`, e.g., partial/legacy bundle), omit the container envelope, corner pill, and same-container amber recoloring cleanly rather than rendering an unlabeled amber zone or crashing.
4. **Genre-Neutral Visual Vocabulary:**
   - Boundary markers, exterior tags, and envelope geometry must use abstract spatial notation (geometric ticks/gates, clean labels) rather than genre-bound icons (e.g., wooden doors or sci-fi airlocks).
5. **Pointer & Accessibility Safety:**
   - Backdrop envelope layers, SVG `<mask>` target `<rect>`s, compass guide rings, and boundary markers must set `pointerEvents="none"` so node `<g onClick>` targets are never blocked.
   - Any `<defs>` / `<mask>` IDs inside `InspectorLocationCard.tsx` must derive from `React.useId()` with colons stripped (e.g., `const uid = useId().replace(/:/g, "")`) so multiple rendered instances never collide in DOM ID lookup or `url(#...)` references.
6. **SSR & Architecture Compliance:**
   - All helper logic must live in pure TypeScript (`miniMapGeometry.ts`) compatible with Node-only Vitest `ReactDOMServer.renderToStaticMarkup` tests and `dependency-cruiser` (`npm --prefix frontend run arch:check`).

---

## 3. Functional Requirements

### FR-1: Hub-and-Spoke SVG `<mask>` Container Envelope

When `activeCont` (`activeLoc.container_id ? containerMap.get(activeLoc.container_id) ?? null : null`) is resolved:

1. **Same-Container Membership Set:**
   - Compute `sameContainerIds`: all `nb.destination.id` in `immediateNeighbors` where `isSameContainerLocation(nb.destination.container_id, activeCont.id, containerMap)` is `true` (exact container match or descendant via `parent_container_id`).
   - Degrades naturally across all cardinalities:
     - **0 inside neighbors:** Renders only the center hub capsule around `miniMapCenter` (matching the standalone-room case cleanly).
     - **1–7 inside neighbors (including non-adjacent/alternating compass slots):** Renders the center hub merged seamlessly with rounded capsule arms reaching each inside neighbor while excluding every external neighbor—avoiding self-intersecting concave polygons or pinched "starfish" vertices.
     - **8 inside neighbors:** Envelopes the full ring cleanly without internal seam lines.

2. **Two-Mask Silhouette Construction (Outer Perimeter Band + Interior Tint):**
   - Geometry constants (radii in SVG units):
     - `ENVELOPE_HUB_RADIUS = 22` (comfortably clears `activeLoc`'s `24×24` box and `r=16` selection ring)
     - `ENVELOPE_ARM_RADIUS = 14` (`strokeWidth = 28` with `strokeLinecap="round"`, narrower than `R_hub` and `R_tip` to keep midpoint space clean while linking lobes smoothly)
     - `ENVELOPE_TIP_RADIUS = 20` (clears neighbor `20×20` box, `r=14` selection ring, and maintains `>= 25px` clearance from any neighboring outside slot even on the tightest 45° `W`↔`NW` pair)
     - `ENVELOPE_BORDER_WIDTH = 1.5`
   - Define two `<mask>` elements in `<defs>` with `maskUnits="userSpaceOnUse" x={0} y={0} width={MINI_MAP_WIDTH} height={MINI_MAP_HEIGHT}`:
     - **`fillMask` (union interior):** Black `<rect>` background, with white shapes at base radii (`r = R_hub`, `strokeWidth = 2 * R_arm`, `r = R_tip`). Used to paint a `<rect>` (`pointerEvents="none"`) with subtle amber interior tint (`rgba(245, 158, 11, 0.06)`).
     - **`borderMask` (continuous perimeter band):** Black `<rect>` background, with white shapes expanded by `B` (`r = R_hub + B`, `strokeWidth = 2 * (R_arm + B)`, `r = R_tip + B`), overlaid with the identical union drawn in **black** at base radii (`r = R_hub`, `strokeWidth = 2 * R_arm`, `r = R_tip`). Note that `<line>` `strokeWidth` represents **diameter**, so expanding radius by `B` requires `+ 2 * B` on `strokeWidth` to match the `+ B` radial expansion on `<circle>` endcaps.
     - Painting a `<rect>` (`pointerEvents="none"`) through `borderMask` with `rgba(245, 158, 11, 0.42)` produces a uniform `1.5px` outer contour around the merged silhouette with **zero** internal overlap lines.
   - *Design Note on Perimeter Stroke:* Using a continuous translucent perimeter band (`borderMask`) is preferred over a dashed polygon hull because it stays crisp at tight angles and avoids competing with `4 3` dashed locked/hidden edges and `2 2` unvisited node borders.
   - Render the envelope layer **behind** the compass guide ring, edges, and nodes.

---

### FR-2: Mini-Map Viewport Headroom, Single-Source Geometry & Fixed Container Pill

1. **Single-Source Geometry Constants (`miniMapGeometry.ts`):**
   - Both [`LiveInspector.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/LiveInspector.tsx) and [`InspectorLocationCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/inspector/InspectorLocationCard.tsx) must import `MINI_MAP_WIDTH = 330`, `MINI_MAP_HEIGHT = 236`, `MINI_MAP_CENTER = { x: 165, y: 118 }`, `MINI_MAP_RX = 102`, and `MINI_MAP_RY = 72` from `miniMapGeometry.ts` so neighbor coordinates and the compass guide `<ellipse>` never drift.
   - Render the `<svg>` with `width="100%"`, `viewBox="0 0 330 236"`, and `style={{ display: "block", width: "100%", height: "auto", maxHeight: 236, ... }}` (or `height={236}` matching current layout behavior, preserving `xMidYMid meet` aspect scaling inside `.inspector--overlay` on narrow viewports).
   - Verified clearances with `ry = 72` and `center.y = 118`:
     - `N` node at `(165, 46)`: `R_tip = 20` lobe top is `y = 26` (`14px` below `N` compass label at `y = 12`); `N` `shortName` (`y = 64`) and external `[diffCont]` (`y = 73`) retain `26px` vertical gap before `activeLoc` selection ring (`y = 102`).
     - `S` node at `(165, 190)`: `R_tip = 20` lobe bottom is `y = 210` and external `[diffCont]` baseline is `y = 217`, staying cleanly clear of `S` compass label at `y = 231`; gap between `activeLoc`'s `shortName` (`y = 139`) and `S` selection ring (`y = 176`) is `34px`.

2. **Fixed Top-Left Corner Container Pill:**
   - Replace the floating `x=128, y=51` label with a fixed top-left SVG pill inside the canvas (`x=6, y=6`, `height=17`, `rx=5`), backdrop `rgba(15, 23, 42, 0.88)` (or `#0f172a` at `0.88` opacity) with `stroke="rgba(245, 158, 11, 0.35)"`.
   - Render `ContIcon` + `L{activeCont.depth} · {truncatedName}` (truncating `activeCont.name` at `> 12` chars to `slice(0, 11) + "…"`, keeping width `~90–105px` well clear of `N` lobe `x >= 145` and `NW` lobe `y >= 47` and preserving existing [`mapEditor.test.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/__tests__/mapEditor.test.tsx#L681) `"L1 · Afterlife C"` assertions).
   - Include an SVG `<title>` inside the pill group displaying the full untruncated `L{activeCont.depth} · {activeCont.name}` string on hover.

3. **Label Readability Over Envelope Edges & Lines:**
   - Apply a dark text halo (`paintOrder: "stroke"`, `stroke: "#0b0e14"`, `strokeWidth: 3`, `strokeLinejoin: "round"`) on node names (`shortName`), external labels, and edge midpoint labels so wide horizontal names (up to 16 chars) remain legible wherever they cross the container perimeter or edge lines.

---

### FR-3: Gestalt Color Grouping (Same-Container vs. External Nodes)

Apply explicit color precedence aligned with [`SpatialTopologyCanvas.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/SpatialTopologyCanvas.tsx#L988-L1018):

1. **Primary Focal Node (`isCurrent === true`):**
   - Retains highest visual emphasis regardless of `is_hub`: `rgba(245, 158, 11, 0.25)` fill, `#f59e0b` stroke, `#fbbf24` icon and bold label.
2. **Hub Nodes (`!isCurrent && loc.is_hub === true`):**
   - Preserve the octagonal `<polygon>` silhouette and app-wide purple hub identity (`#a855f7` stroke, `rgba(168, 85, 247, 0.24)` fill, `#e9d5ff` icon) whether inside or outside the active container; enclosure inside the amber envelope conveys container membership without breaking hub color recognition.
   - If `isSelected` on a same-container hub, use `#fbbf24` for the dashed selection circle; otherwise `#38bdf8`.
3. **Same-Container Non-Hub Nodes (`!isCurrent && !loc.is_hub && isSameContainer && activeCont !== null`):**
   - Shift from cyan to a **secondary warm-amber palette**:
     - Fill: `rgba(245, 158, 11, 0.11)`
     - Stroke: `#fbbf24` when `isSelected`, `#d97706` otherwise
     - Icon: `#fbbf24`
     - Label (`shortName`): `#fde68a` (or `#fbbf24` when `isSelected`)
     - Selection dashed circle: `#fbbf24`
4. **External Non-Hub Nodes (different `container_id`, `container_id == null`, or `activeCont === null`):**
   - Retain **cool cyan**: `#0f172a` fill, `#22d3ee` stroke when `isSelected` / `#0891b2` otherwise, `#67e8f9` icon, `#cbd5e1` label, `#38bdf8` selection circle.
5. **Preserved Per-Node Modifiers:**
   - Unvisited (`loc.is_visited === false`) continues applying `opacity: 0.78` (unless `isSelected`) and `strokeDasharray="2 2"` across all groups.
   - Portal diamond (`isPortal`) continues rendering at `(pt.x + 11, pt.y - 10)` unchanged.

---

### FR-4: Genre-Neutral Boundary Markers & Uncontained Exit Labels

1. **Genre-Neutral Boundary Marker on `crossesContainer` Edges:**
   - Triggered by `doesEdgeCrossContainer(nb.destination.container_id, activeLoc.container_id, containerMap)`: `true` when leaving `activeCont` (destination is outside `activeCont`'s descendant subtree, including `null`) or when entering a contained destination from uncontained (`null`) space. Internal edges into nested `L1`/`L2` descendants of `activeCont` do **not** trigger an envelope-exit gate.
   - **Anisotropic Clear-Gap Placement (`computeBoundaryMarkerTicks`):**
     - Because the compass ellipse has unequal ray lengths (`62–72px` vertical vs `102px` horizontal) and `activeLoc`/`N` labels hang below their icons along vertical rays, do **not** use a naive fixed parametric `t` (which would land inside `R_hub` or collide with `activeLoc`'s own name on `S`).
     - Instead, `computeBoundaryMarkerTicks(p1, p2, slot)` computes the ray unit vector `(ux, uy)` and places the threshold gate in the unobstructed gap along the segment:
       - Keep the marker outside `activeLoc`'s footprint (including `activeLoc`'s bottom label clearance on `S`/`SE`/`SW`, e.g., `d >= 30px` on `S` and `>= 26px` elsewhere) and clear of `p2`'s icon + selection ring (`d <= dist - 22px`, and clear of `N`'s `[diffCont]` label when `slot === "N"`).
       - Position the `{nb.slot} · {nb.travel_minutes}m` text label so it never overlaps the threshold gate: on horizontal/diagonal rays (`E`, `W`, `NE`, `NW`, `SE`, `SW`), `y = midY - 4` sits above the line while the gate straddles the line; on vertical rays (`N`, `S`), offset the edge text slightly horizontally (`x = midX + 7, textAnchor = "start"`) so the vertical edge line itself remains clear for the perpendicular threshold gate.
   - **Visual Representation (Genre-Neutral Threshold Gate):**
     - Render a `3px`-wide dark break (`stroke="#0b0e14"`, `strokeWidth={4}`) along the ray at the crossing center, flanked by two parallel **perpendicular threshold bars** (`10px` total span perpendicular to `(ux, uy)`, `strokeWidth={1.75}`), `pointerEvents="none"`.
     - Color: `#fbbf24` when `activeCont !== null` (visually echoing the amber container perimeter being crossed), or `#22d3ee` when `activeCont === null` and the edge enters a contained destination.
   - **Edge Dashing De-Confliction:**
     - Reserve `strokeDasharray="4 3"` strictly for `nb.is_locked_or_hidden`.
     - Unlocked `crossesContainer` edges render as solid `#22d3ee` lines (with the threshold gate explicitly marking the container boundary), eliminating the ambiguous `2 2` vs `4 3` dash collision.

2. **Explicit Label for Uncontained Exits (`[Outside]`):**
   - Replace the truthy-only `diffCont` guard in [`InspectorLocationCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/inspector/InspectorLocationCard.tsx#L236-L241) with `resolveExternalContainerLabel(loc, activeLoc.container_id ?? null, containerMap)`:
     - When `!isCurrent && (loc.container_id ?? null) !== (activeLoc.container_id ?? null)`:
       - If `loc.container_id` resolves in `containerMap`: return `[${truncatedContainerName}]` (`> 13` chars → `slice(0, 12) + "…"`, preserving `[Watson Distr…]` compatibility).
       - Else if `activeLoc.container_id != null && loc.container_id == null`: return `"[Outside]"`.
       - Else (dangling missing `container_id` not in `containerMap`): return `null`.
   - Render sub-labels at `pt.y + 27` with dark text halo: warm amber (`#fde68a`) when the neighbor sits in a nested descendant sub-container inside `activeCont` (e.g., an `L1` building inside an `L3` city), and cool cyan (`#67e8f9`) when the neighbor is outside `activeCont`.

---

## 4. Proposed Module & Test Structure

1. **Pure Helper Module (`frontend/src/components/inspector/miniMapGeometry.ts`):**
   - Export layout and envelope constants (`MINI_MAP_WIDTH`, `MINI_MAP_HEIGHT`, `MINI_MAP_CENTER`, `MINI_MAP_RX`, `MINI_MAP_RY`, `ENVELOPE_HUB_RADIUS`, `ENVELOPE_ARM_RADIUS`, `ENVELOPE_TIP_RADIUS`, `ENVELOPE_BORDER_WIDTH`).
   - Export pure functions:
     - `isSameContainerLocation(locContainerId, activeContainerId)`
     - `doesEdgeCrossContainer(destContainerId, activeContainerId)`
     - `resolveExternalContainerLabel(loc, activeContainerId, containerMap)`
     - `computeBoundaryMarkerTicks(p1, p2, slot)` → returns `{ bar1, bar2, gap }` segment coordinates in SVG space.
   - Keeps [`InspectorLocationCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/inspector/InspectorLocationCard.tsx) declarative and easy to unit-test in Node without `jsdom`.

2. **Verification Matrix:**
   - **Unit tests (`miniMapGeometry.test.ts` or inside `mapEditor.test.tsx`):**
     - `isSameContainerLocation` & `doesEdgeCrossContainer` across: both null, both matching, two different containers, contained → null, null → contained.
     - `resolveExternalContainerLabel` returns `"[Outside]"` for `contained → null`, `"[ContainerName]"` for `contained → other` / `null → contained`, and `null` for same-container or unresolved dangling container IDs.
     - `computeBoundaryMarkerTicks` produces orthogonal perpendicular bars (`dot(bar, ray) ≈ 0`) across all 8 compass directions (`N`, `NE`, `E`, `SE`, `S`, `SW`, `W`, `NW`), clears both node bounds and `R_hub`, and clears `activeLoc` bottom label on `S`.
   - **SSR / Component tests (`mapEditor.test.tsx`):**
     - Assert `<mask` elements with `maskUnits="userSpaceOnUse"` and spoke `<line` capsules render when `activeLoc` has `>= 1` same-container neighbor, render hub-only mask when `0` neighbors share the container, and omit the `<mask>` envelope when `activeLoc.container_id == null` or missing from `containerMap`.
     - Assert alternating inside/outside neighbor layouts render distinct amber vs. cyan non-hub node strokes, preserve purple `#a855f7` hub styling, display `[Outside]` for uncontained exits, render threshold gate `<line>` ticks on crossing edges, use unique sanitized mask IDs across multiple renders, and preserve `L1 · Afterlife C` + `[Watson Distr` assertions.
   - **Required Workspace Checks:**
     - `npm --prefix frontend run arch:check`
     - `npm --prefix frontend run build`
     - `npm --prefix frontend test`
