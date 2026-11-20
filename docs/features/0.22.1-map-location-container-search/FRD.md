---
feature: map-location-container-search
target_version: 0.22.1
document_type: frd
status: completed
last_updated: 2026-11-20
---

# Feature Requirements Document (FRD)
## Spatial Topology Map Search & Quick Focus

**Status:** Completed  
**Target Version:** CyberCantina v0.22.1  
**Depends On:** `0.9.0-location-containers`, `0.11.1-starting-hub-container-focus`, `0.20.0-world-codex`  
**Scope:**
- **Backend / Schemas / API:** **No changes required** (all world/campaign locations and containers are already loaded client-side into `SpatialTopologyView` via `workingLocations` and `workingContainers`, with campaign fog-of-war already enforced by `bundle.visible_locations` and `bundle.containers`).
- **Frontend Pure Search & Ranking Helpers:**
  - New: `frontend/src/components/map/mapSearch.ts` (pure, Node-testable indexing, tiered name matching, breadcrumb path enrichment, and result sorting across `LocationNode` and `LocationContainer` lists)
- **Frontend Map Toolbar & Topology View:**
  - [`TopologyHeaderToolbar.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/TopologyHeaderToolbar.tsx) (add search combobox control immediately to the left of the Zoom/Center control cluster, plus header title truncation and optional active-container inspect action)
  - [`SpatialTopologyView.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/SpatialTopologyView.tsx) (stateful search query/dropdown lifecycle, deferred post-layout centering via `fullMapCoords`, inside-viewpoint container drilling, and location selection)
  - [`styles.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css) (compact map search input, ranked dropdown popover, kind/depth badges, and responsive toolbar rules)
- **Automated Tests:**
  - New: `frontend/src/components/__tests__/mapSearch.test.tsx` (pure unit tests for ranking, hierarchy breadcrumbs, duplicate names, and empty/edge inputs + SSR markup assertions for `TopologyHeaderToolbar` and `SpatialTopologyView`)
  - Updated: `frontend/e2e/03-spatial-topology-map-editor.spec.ts` (live Playwright interaction coverage for cross-container location jump, container inside viewpoint, `Delete` guard, and `Escape` dismissal)
  - Regression coverage in [`mapEditor.test.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/__tests__/mapEditor.test.tsx) and [`locationContainers.test.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/__tests__/locationContainers.test.tsx)
- **User-Facing Documentation (required upon feature implementation):**
  - [`Live-Inspector-Map-and-Timeline.md`](file:///home/diegolima/Git/cybercantina-wiki/Live-Inspector-Map-and-Timeline.md)
  - [`Authoring-Worlds-Characters-and-Personas.md`](file:///home/diegolima/Git/cybercantina-wiki/Authoring-Worlds-Characters-and-Personas.md)

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
In large multi-container worlds (Regions → Cities → Districts → Buildings), navigating the Spatial Topology Map inside the World Sheet ([`WorldInspectorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldInspectorModal.tsx#L843)) or the in-campaign Full Spatial Topology modal ([`LiveInspector.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/LiveInspector.tsx#L448)) requires manually panning or drilling down level by level through container supernodes and breadcrumbs.

While the **Codex** tab ([`WorldCodexTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldCodexTab.tsx)) already indexes locations and containers via `searchAllCodexEntries` and offers an `"Open on Map"` button, users working directly on the Map tab face three friction points:
1. **No In-Tab Map Search:** Users must leave the Map tab, switch to Codex, search, and jump back via `externalMapFocus` (and this fallback does not exist inside `LiveInspector`'s standalone Full Spatial Topology modal).
2. **Coordinate Fallthrough on Auto-Laid-Out Nodes:** Both `handleJumpToContainer` and `externalFocusRequest` in [`SpatialTopologyView.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/SpatialTopologyView.tsx#L625-L711) read `ui_x` / `ui_y` directly and reset `pan` to `{ x: 0, y: 0 }` when persisted coordinates are `null`, failing to center auto-laid-out locations positioned by `fullMapCoords`.
3. **Outside-Only Container Focus:** `externalFocusRequest` focuses a container from its parent view (`parent_container_id`) rather than stepping *inside* the container to reveal its contents.

### 1.2 Proposed Solution & Core Design Decisions
This feature adds a compact, keyboard-accessible **Map Search** combobox directly inside [`TopologyHeaderToolbar.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/TopologyHeaderToolbar.tsx) to the left of the Zoom/Center controls, incorporating the following refined design decisions:

1. **Unified Placement in `TopologyHeaderToolbar` (World Sheet + Campaign Full Map):**
   - Placing the search field in `TopologyHeaderToolbar` immediately left of the Zoom control group serves both the World Sheet Map tab and `LiveInspector`'s Full Spatial Topology modal consistently, with bounded input width and title ellipsis truncation so the toolbar remains balanced.
2. **Global Cross-Hierarchy Matching with Disambiguation:**
   - Queries match across **all** `workingLocations` and `workingContainers` at every depth (not just the currently visible container view), displaying kind/depth badges (`Location` / `Hub` / `L1`–`L4`) and ancestor breadcrumbs (`buildContainerBreadcrumb`) to distinguish identically named nodes across different regions or districts.
3. **Explicit Confirmation Only (No Auto-Jump on `onChange`):**
   - Focusing never triggers automatically while typing—even when the input string exactly equals a node's full name—preventing prefix traps (e.g., `"Market"` vs `"Market Square"`), arbitrary disambiguation on duplicate names, and jarring viewport jumps mid-typing. Navigation triggers strictly on **clicking a match** or pressing **`Enter`** (selecting the highlighted result, or the top-ranked/exact match).
4. **Deferred Auto-Layout-Safe Focusing:**
   - Focusing a location switches `currentContainerId` to its containing scope, selects the location (`selectedLocId`), resets zoom if needed or keeps zoom readable, and centers `pan` using the computed `fullMapCoords` after the new container projection renders—correctly centering nodes whose `ui_x` / `ui_y` are `null`.
5. **"Inside" Viewpoint for Containers:**
   - Focusing a container calls `drillIntoContainer(cont.id)` (setting `currentContainerId` to that container's ID and resetting pan/zoom to `{ x: 0, y: 0 }` / `100%`) so the user immediately sees the interior of the searched container (its direct locations and/or child container supernodes).

---

## 2. Scope, Boundaries & Core Invariants

1. **Frontend-Only Change & Layering Compliance:**
   - Zero backend Python, SQLite schema, or REST API modifications.
   - `frontend/src/components/map/mapSearch.ts` must remain pure TypeScript with no upward imports from `App.tsx` or circular dependencies, complying with [`frontend/.dependency-cruiser.cjs`](file:///home/diegolima/Git/cybercantina/frontend/.dependency-cruiser.cjs).
   - Pure helper logic and `ReactDOMServer.renderToStaticMarkup` rendering must work in Vitest's Node-only environment (`frontend/package.json`).
2. **Campaign Fog-of-War Preservation:**
   - Search operates exclusively over `workingLocations` and `workingContainers` already supplied to `SpatialTopologyView`. In campaign mode ([`App.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/App.tsx#L830-L835), [`LiveInspector.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/LiveInspector.tsx#L450-L452)), `locations` (`bundle.visible_locations`) and `containers` (`bundle.containers`) are already server-filtered to discovered/visible entities; search must never read unfiltered `campaignWorld` data.
3. **Read-Only / Non-Mutating Navigation:**
   - Searching, opening the dropdown, and focusing a location or container must **never** mutate `workingContainers`, `workingLocations`, `workingEdges`, `undoStack`, or `isDirty`.
4. **Keyboard Safety & Modal Isolation:**
   - The search field must render a native `<input>` so [`isEditableKeyboardTarget`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/mapGeometry.ts#L228-L246) continues to block `SpatialTopologyView`'s global `Delete` shortcut while typing or editing search text.
   - Pressing `Escape` inside the search field must `e.stopPropagation()` and dismiss the dropdown / clear the query cleanly without closing `WorldInspectorModal` or `LiveInspector`'s Full Spatial Topology modal.
5. **Hierarchy Projection Truthfulness for Containers:**
   - Adopting an "inside" viewpoint sets `currentContainerId = container.id`. Per [`projectTopologyForDepth`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/topologyProjection.ts#L327), L1 containers display their direct locations; L2–L4 containers display their direct child container cards (supernodes) and any direct locations at that level—never flattening deeper descendants into one canvas.

---

## 3. Functional Requirements

### FR-1: Toolbar Layout & Search Input (`TopologyHeaderToolbar.tsx`)

1. **Control Placement:**
   - Render the search combobox wrapper immediately to the **left** of the `Map zoom controls` (`role="group"`) and `Center` button inside the right-side toolbar cluster of [`TopologyHeaderToolbar.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/TopologyHeaderToolbar.tsx#L89-L176).
2. **Overflow & Responsive Sizing Guardrails:**
   - Give the left-side title span `minWidth: 0` with graceful truncation/wrapping control so adding the search input does not crush the header or force awkward multi-line fragmentation on standard desktop modal widths (`min(1100px, 95vw)` / World Sheet width).
   - Constrain the search input container width cleanly (e.g., `width: clamp(160px, 20vw, 230px)`, collapsing/wrapping cleanly on narrow screens) with a leading `Search` icon, placeholder `"Search locations & areas…"`, `aria-label="Search locations and containers"`, `role="combobox"`, and an inline clear (`×`) button when `query.length > 0`.
3. **Stale Dropdown Cleanup:**
   - Close the dropdown popover when clicking outside the search wrapper (or onto the canvas/palette/drawer), when pressing `Escape`, or after selecting a match.
   - Because `WorldInspectorModal` keeps the Map tab mounted via `display: activeTab === "map" ? "flex" : "none"` ([`WorldInspectorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldInspectorModal.tsx#L789)), closing the dropdown on outside click/blur ensures no floating menu persists across tab switches.

---

### FR-2: Search Indexing, Matching & Ranking (`mapSearch.ts`)

1. **Searchable Corpus:**
   - Index every entry in `workingLocations` and `workingContainers` regardless of `currentContainerId`.
   - Each searchable item produces a `MapSearchMatch`:
     - `key`: `"location:<id>"` or `"container:<id>"`
     - `kind`: `"location"` or `"container"`
     - `id`: node or container ID
     - `name`: trimmed display name (fallback `"Unnamed Location"` / `"Unnamed Area"`)
     - `isHub`: `Boolean(loc.is_hub)` (for locations)
     - `isStarting`: `Boolean(loc.is_starting_location)` (for locations)
     - `containerDepth`: `1 | 2 | 3 | 4` (for containers)
     - `breadcrumb`: result of `buildContainerBreadcrumb(parentId, workingContainers)` (`"Top-Level"` when at World Root, else `"Region › District …"`)
     - `matchTier`: `0 | 1 | 2 | 3`
2. **Matching & Tiered Ranking:**
   - Empty or whitespace-only query returns `[]` (no dropdown shown when blank).
   - Non-empty query `q = query.trim().toLowerCase()` matches **by name** (partial or full, case-insensitive) and ranks deterministically:
     - **Tier 0:** Exact name match (`name.toLowerCase() === q`)
     - **Tier 1:** Name starts with `q` (`name.toLowerCase().startsWith(q)`)
     - **Tier 2:** Any word in `name` starts with `q` (e.g., `"anchor"` matching `"The Rusty Anchor"`)
     - **Tier 3:** Substring match anywhere in `name` (`name.toLowerCase().includes(q)`)
   - Tie-break within the same tier alphabetically by `name`, then containers vs. locations consistently (or locations/containers sorted by `breadcrumb` + `id` for total determinism).
   - Cap rendered results or wrap the list in a scrollable container (`maxHeight: 280px`, `overflowY: "auto"`) so large worlds never overflow the modal viewport.

---

### FR-3: Match List Dropdown & Keyboard Interaction

1. **Dropdown Row Presentation:**
   - Render each `MapSearchMatch` as an interactive option (`role="option"`, `aria-selected={isHighlighted}`) showing:
     - **Line 1:** Node/Container name (with subtle status cue if it is the `Starting` or `Active` location, or `Current` if it is `currentContainerId`) + compact **kind/depth badge** (`Hub`, `Location`, or `L1`–`L4` badge styled with `CONTAINER_DEPTH_LABELS` title tooltip).
     - **Line 2:** Ancestor path (`breadcrumb`), e.g., `Top-Level` or `Valkyrie Sector › Dockside`.
   - When `query.trim().length > 0` and results are empty, display a compact non-interactive `"No matching locations or containers"` empty state inside the dropdown.
2. **Keyboard & Pointer Controls:**
   - `ArrowDown` / `ArrowUp`: Move `highlightedIndex` through the match list (wrapping cleanly). Defaults to `0` whenever `query` changes and results are non-empty.
   - `Enter`:
     - If the dropdown has results, `e.preventDefault()` and focus the currently highlighted match (index `0` if none explicitly moved).
     - **Never** auto-trigger navigation in `onChange` simply because the typed text equals a node's full name; `Enter` or clicking a match is always required.
   - `Escape`:
     - `e.preventDefault()` and `e.stopPropagation()`.
     - First press when dropdown is open or `query.length > 0`: closes dropdown and clears `query` (or closes dropdown first if preferred, clearing `query` on clear button / second `Escape`).
   - Clicking a match (`onMouseDown` with `e.preventDefault()` or `onClick` before blur dismisses the popover): immediately executes focus for that match and closes the dropdown.

---

### FR-4: Map Focusing & Container "Inside" Viewpoint (`SpatialTopologyView.tsx`)

1. **Focusing a Location (`kind === "location"`):**
   - Resolve `targetLoc = locationMap.get(match.id)`.
   - Determine target scope: `targetScopeId = targetLoc.container_id && containerMap.has(targetLoc.container_id) ? targetLoc.container_id : null`.
   - Set `currentContainerId(targetScopeId)` (if different), set `selectedLocId(targetLoc.id)`, clear `selectedContainerId(null)` and `selectedGhostLocId(null)`, dismiss `contextMenu` and `inlineEdgeEdit`, and reset `zoom` to `1` (or clamp to a readable minimum if zoomed out).
   - **Auto-Layout-Safe Centering:** Center the viewport (`setPan({ x: -pt.x, y: -pt.y })`) using `fullMapCoords[targetLoc.id]` **after** `projectedTopology` / `fullMapCoords` reflects `targetScopeId` (e.g., via a `pendingCenterTargetRef` flushed in `useEffect` once `fullMapCoords[targetId]` is available, falling back to `ui_x`/`ui_y` or `{ x: 0, y: 0 }`).
   - Update both search-triggered location focus and `handleJumpToContainer` / `externalFocusRequest` to share this centering path so auto-laid-out (`ui_x == null`) locations never snap to `{ 0, 0 }` erroneously.
2. **Focusing a Container (`kind === "container"` — "Inside" Viewpoint):**
   - Resolve `targetCont = containerMap.get(match.id)`.
   - Call `drillIntoContainer(targetCont.id)`—which sets `currentContainerId(targetCont.id)`, clears `selectedContainerId(null)`, `selectedGhostLocId(null)`, `contextMenu(null)`, `inlineEdgeEdit(null)`, resets `pan` to `{ x: 0, y: 0 }`, and resets `zoom` to `1`.
   - Also clear `selectedLocId(null)` so `MapDetailsDrawer` does not stay open on a stale location from a prior container scope.
   - **Re-selecting the already-active container** (`currentContainerId === targetCont.id`): still resets `pan` to `{ x: 0, y: 0 }`, `zoom` to `1`, and clears stale selection so the user gets immediate centering feedback.
   - **Breadcrumb Behavior:** Drilling inside clears `selectedContainerId` (closing the container's `MapDetailsDrawer`); existing breadcrumb navigation (`World Root › …`) remains unchanged, allowing users to step out one level via breadcrumbs if they wish to inspect the container card itself.
3. **Post-Selection Search Field State:**
   - On selection, close the dropdown, blur the input, and clear `query` (`""`) for quick successive jumps without leaving stale search text in the toolbar.

---

## 4. Edge Cases & Interaction Matrix

| Scenario | Expected Behavior |
| :--- | :--- |
| User types `"Market"` when both `"Market"` (L1 container) and `"Market Square"` (location) exist | Dropdown displays both items with `L1` vs `Location` badges and breadcrumbs; **no** viewport jump occurs until the user presses `Enter` or clicks a row. |
| Two locations named `"Courtyard"` exist in `"North Keep"` and `"South Villa"` | Both appear in the dropdown with distinct ancestor breadcrumbs (`North Keep` vs `South Villa`) so the user can pick the intended one. |
| User clicks a location inside a nested L1 container while viewing `World Root` | `currentContainerId` switches to that L1 container, `selectedLocId` selects the location (opening `MapDetailsDrawer`), and `pan` centers on `fullMapCoords[loc.id]` even if `ui_x`/`ui_y` are `null`. |
| User clicks an L1 container (`"The Rusty Anchor"`) | Map adopts the **inside** viewpoint (`currentContainerId = cont.id`), showing the locations inside `"The Rusty Anchor"` with `zoom = 1` and `pan = { x: 0, y: 0 }`. |
| User clicks an L2/L3/L4 container (`"Harbor District"`) | Map adopts the **inside** viewpoint (`currentContainerId = cont.id`), showing its direct child container supernodes and any direct locations at that depth; breadcrumbs update to `World Root › … › Harbor District (L2)`. |
| User clicks an empty container in Editor mode | Map drills inside (`currentContainerId = cont.id`) showing the empty interior canvas ready for `MapPaletteBar` additions. |
| User clicks the container they are already inside (`currentContainerId === cont.id`) | Dropdown closes and viewport recenters cleanly (`pan = { x: 0, y: 0 }`, `zoom = 1`). |
| User presses `Delete` or `Backspace` while typing in the search input | `isEditableKeyboardTarget` returns `true`; global node-deletion shortcut does **not** fire. |
| User presses `Escape` while search input is focused | `e.stopPropagation()` prevents closing `WorldInspectorModal` / `LiveInspector`; dropdown closes and query clears. |
| Campaign mode with undiscovered locations/containers | Search only indexes `workingLocations` (`bundle.visible_locations`) and `workingContainers` (`bundle.containers`), never revealing unvisited fog-of-war locations. |
| Unsaved map edits exist in Editor mode (`isDirty === true`) | Searching and jumping between containers reads `workingLocations`/`workingContainers` (including unsaved new/renamed nodes) without altering `isDirty` or `undoStack`. |
| Narrow modal / mobile viewport | Search input and Zoom/Center controls wrap cleanly within `TopologyHeaderToolbar` without overflowing horizontally; dropdown width clamps within viewport bounds. |

---

## 5. Acceptance Criteria & Verification Matrix

### 5.1 Automated Test Criteria
1. **Pure Search & Toolbar Unit/SSR Tests (`frontend/src/components/__tests__/mapSearch.test.tsx` — Node Vitest):**
   - `filterAndRankMapSearchResults` matches partial names across both `locations` and `containers` regardless of container depth, ranks exact > prefix > word-prefix > substring, and formats `breadcrumb` via `buildContainerBreadcrumb`.
   - Duplicate names across distinct containers produce distinct entries with accurate breadcrumbs and kind/depth labels (`Hub`, `Location`, `L1`–`L4`).
   - Empty/whitespace queries return `[]`; unmatched queries return `[]`.
   - `TopologyHeaderToolbar` SSR rendering (`ReactDOMServer.renderToStaticMarkup`) renders the search input (`role="combobox"`, `aria-label="Search locations and containers"`) before the `Map zoom controls` group, and renders matching dropdown options + empty state cleanly when passed/controlled.
2. **Focus & Container Inside-Viewpoint Behavior:**
   - Focusing a container selects `currentContainerId = cont.id` (inside viewpoint) and clears stale `selectedLocId`/`selectedContainerId`.
   - Focusing a location sets `currentContainerId = loc.container_id ?? null`, `selectedLocId = loc.id`, and resolves centering coordinates from `fullMapCoords` even when `loc.ui_x === null && loc.ui_y === null`.
   - Regression checks pass in [`mapEditor.test.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/__tests__/mapEditor.test.tsx) and [`locationContainers.test.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/__tests__/locationContainers.test.tsx).

### 5.2 Repository Verification Gates (Required on Implementation Completion)
- **Frontend architecture, build & tests:**
  ```bash
  npm --prefix frontend run arch:check && npm --prefix frontend run build && npm --prefix frontend test
  ```
- **Architecture docs check (since a new module `mapSearch.ts` is added):**
  ```bash
  backend/.venv/bin/python scripts/generate_arch_docs.py && backend/.venv/bin/python scripts/generate_arch_docs.py --check
  ```
- **User-facing documentation sync:**
  - Update [`Live-Inspector-Map-and-Timeline.md`](file:///home/diegolima/Git/cybercantina-wiki/Live-Inspector-Map-and-Timeline.md) and [`Authoring-Worlds-Characters-and-Personas.md`](file:///home/diegolima/Git/cybercantina-wiki/Authoring-Worlds-Characters-and-Personas.md) to document the Map toolbar search field, keyboard navigation (`↑`/`↓`/`Enter`/`Esc`), location centering, and container inside-viewpoint drilling; verify with `git -C ../cybercantina-wiki diff`.
