---
feature: map-edge-label-sync-and-editing
target_version: 0.14.1
document_type: frd
status: completed
last_updated: 2026-11-16
---

# Feature Requirements Document (FRD)
## Map Edge Label Auto-Sync, Manual Editing & Canvas Overlay/Bundle Consistency

**Status:** Completed  
**Target Version:** CyberCantina v0.14.1  
**Scope:**
- Frontend Map Mutations & Pure Projection Helpers ([`useTopologyMutations.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/useTopologyMutations.ts), [`topologyProjection.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/topologyProjection.ts))
- Frontend Map Canvas, View, Context Menu, Popover & Drawer ([`SpatialTopologyView.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/SpatialTopologyView.tsx), [`SpatialTopologyCanvas.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/SpatialTopologyCanvas.tsx), [`MapDialogs.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDialogs.tsx), [`MapDetailsDrawer.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDetailsDrawer.tsx))
- Backend Draft-to-World Edge Fallback ([`worlds.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/worlds.py))
- Frontend & Backend Tests (`frontend/src/components/__tests__/mapEditor.test.tsx`, `frontend/src/components/__tests__/locationContainers.test.tsx`, `backend/tests/`)

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
Code review of the spatial topology editor and inspection of an exported world (`The_Green_Lie.zcc`) uncovered two classes of edge-label defects:

1. **Stale `direction_label` Strings Left Behind on Locations Renamed or Converted After Linking:**
   - Edge creation in [`buildBidirectionalEdgePair`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/useTopologyMutations.ts#L79-L123) and [`handleConfirmHubCollision`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/useTopologyMutations.ts#L718-L927) bakes location names at creation time into `direction_label` (e.g., `"Passage to New Location 30"`, `"Passage to Sewers Entrance"`, `"Return to The Caissons"`).
   - Renaming a location via **Location Name** in [`MapDetailsDrawer`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDetailsDrawer.tsx#L1449-L1459) → [`patchLocation`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/useTopologyMutations.ts#L204-L219) updates `workingLocations` while leaving `workingEdges` untouched.
   - Converting a non-visited location into a Level 1 container via [`handleConvertLocationToContainer`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/useTopologyMutations.ts#L1381-L1466) renames the node to `` `${loc.name} Entrance` `` ([line 1426](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/useTopologyMutations.ts#L1426)) while leaving `workingEdges` untouched ([line 1449](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/useTopologyMutations.ts#L1449)).
   - There is **no UI** to inspect `direction_label` on normal L0–L0 or external boundary edges, and **no UI** anywhere on the map to edit `direction_label` (even [`MultiEdgePopover`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDialogs.tsx#L1643) renders it read-only), yet stale labels propagate directly into gameplay UI ([`InspectorLocationCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/inspector/InspectorLocationCard.tsx#L518)) and LLM turn prompts ([`phase1_pre.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/phase1_pre.py#L824)).
   - Additionally, backend [`create_world_from_draft`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/worlds.py#L329) falls back to `f"Return to {edge.from_key}"` instead of the resolved location display `name` when `reverse_direction_label` is empty/omitted.

2. **Canvas Distance-Badge, Inline-Overlay & Aggregated-Bundle Desynchronization:**
   - [`handleUndo`](file:///home/diegolima/Git/cybercantina/frontend/src/components/SpatialTopologyView.tsx#L235-L247) does not clear `inlineEdgeEdit` (or `contextMenu`), and [`activeInlineEdge`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/SpatialTopologyCanvas.tsx#L382-L396) continues rendering the floating overlay at stale `midX`/`midY` if the underlying edge is undone or deleted.
   - [`inlineOverlayPoint`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/SpatialTopologyCanvas.tsx#L449-L460) calls [`worldPointToWrapperPoint`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/topologyProjection.ts#L850-L892), which reads `viewportGroupRef.current.getScreenCTM()` during render — lagging one render frame behind if `pan` or `zoom` changes while `inlineEdgeEdit` is open.
   - In [`projectTopologyForDepth`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/topologyProjection.ts#L536-L569), aggregated container-to-container edges create separate `contA => contB` and `contB => contA` entries. Because [`showLabel`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/SpatialTopologyCanvas.tsx#L304-L310) hides `sourceNodeId > targetNodeId` (while SVG Layer 1 paints both lines stacked at identical coordinates), asymmetric `travel_minutes`, passage counts (`· N`), or `🔒` locks on the suppressed direction are hidden, double-clicking only opens `MultiEdgePopover` for one direction's `groupedEdges`, and right-clicking only targets `edge.rawEdge.id` (`group.edges[0]`).
   - [`MultiEdgePopover`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDialogs.tsx#L1547-L1558) flushes uncommitted rows in a synchronous `for` loop calling `onUpdateDistance`, which closes over the same `workingEdges` snapshot if more than one row has pending edits.

### 1.2 Proposed Solution
1. **Auto-Sync Default Template `direction_label` Strings (`FR-1`):** Automatically update auto-generated template edge labels (`"Passage to <Name>"`, `"Return to <Name>"`, `"To <Name>"`, `"Back to <Name>"`, `"Return passage to <Name>"`) when a location is renamed or converted to a container, without ever altering custom user/AI-authored passage labels.
2. **UI Inspection & Editing for `direction_label` (`FR-2`):** Expose directional `direction_label` viewing and editing in the edge context menu / passage editor popover, `MultiEdgePopover`, `MapDetailsDrawer`, and canvas hover tooltips.
3. **Backend Draft Reverse-Label Fallback Fix (`FR-3`):** Resolve `from_loc.name` instead of `edge.from_key` in [`create_world_from_draft`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/worlds.py#L329).
4. **Canvas Inline Editor & Aggregated Edge Consistency (`FR-4`):** Clear `inlineEdgeEdit` when Undo runs or the edge disappears from `workingEdges`, keep overlay coordinates synchronized with live `pan`/`zoom`, unify bidirectional aggregated supernode badge summaries & popovers, and batch `MultiEdgePopover` close commits.

---

## 2. Scope, Boundaries & Core Invariants

1. **Preserve Custom / Evocative Passage Labels:**
   - Auto-syncing on location rename or container conversion **must only** rewrite `direction_label` values that match an auto-generated template targeting `locationId` and referencing `oldName` (literal, case-insensitive match on `<prefix><oldName>`).
   - Custom labels (e.g., `"Lead-lined curtain behind the bar"`, `"Rusty maintenance ladder"`) must remain untouched unless the user explicitly edits them.
2. **Directional Independence of `direction_label`:**
   - Unlike `travel_minutes` and `is_locked_or_hidden` (which are kept symmetric between `A -> B` and `B -> A` by [`handleUpdateEdgeDistance`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/useTopologyMutations.ts#L1484-L1506) and [`handleToggleEdgeLocked`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/useTopologyMutations.ts#L1508-L1530)), `direction_label` is inherently **directional** (`A -> B` vs. `B -> A`). Manual edits to one edge's `direction_label` must **not** overwrite the reciprocal edge's `direction_label`.
3. **No Silent Mutation of Saved Worlds on Load:**
   - Loading an existing world or `.zcc` archive must not silently rewrite stored `direction_label` strings on open; existing stale labels are repaired either via live rename/conversion or explicitly through the new UI controls.
4. **Campaign Mode Safety:**
   - [`update_campaign_map`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/campaign_map_update.py#L510-L542) already supports persisting `direction_label` changes across branch-safe turns. In campaign mode, visited locations remain locked against renaming, while edge edits respect `isMutatingLocked`.
5. **No New Database Schema Changes & SSR Test Compatibility:**
   - All changes operate on existing `LocationEdge.direction_label`, `LocationNode`, and `LocationContainer` fields.
   - Standalone `ReactDOMServer.renderToStaticMarkup(<SpatialTopologyCanvas ... />)` tests (e.g., [`mapEditor.test.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/__tests__/mapEditor.test.tsx#L877-L898)) that pass synthetic `inlineEdgeEdit` or `MultiEdgePopover` props must continue rendering cleanly.

---

## 3. Functional Requirements

### FR-1: Auto-Sync Auto-Generated `direction_label` on Location Rename & Container Conversion

- **Pure Label-Sync Helper ([`topologyProjection.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/topologyProjection.ts)):**
  - Add a pure helper `syncEdgeLabelsForLocationRename(edges, locationId, oldName, newName)`:
    - Normalize `oldTrimmed = oldName.trim()` and `newTrimmed = newName.trim()`. If either is empty or `oldTrimmed === newTrimmed`, return `edges` unchanged (returning the original array reference when no edge changes so callers preserve referential stability).
    - Scope strictly to incoming edges targeting `locationId` (`edge.to_location_id === locationId`), because all auto-generated templates name the destination node.
    - Match **only** literal prefix + `oldTrimmed` (case-insensitive, **no unescaped `RegExp`**, so names containing `(`, `)`, `.`, `+`, `[`, `]`, or `/` match safely without regex errors or ReDoS):
      - `"Passage to "` → `` `Passage to ${newTrimmed}` ``
      - `"Return to "` → `` `Return to ${newTrimmed}` ``
      - `"To "` → `` `To ${newTrimmed}` ``
      - `"Back to "` → `` `Back to ${newTrimmed}` ``
      - `"Return passage to "` → `` `Return passage to ${newTrimmed}` ``
    - Preserve the exact matched prefix capitalization and leave all non-matching (custom) `direction_label` values untouched.
- **Controlled-Input Keystroke Safety (`MapDetailsDrawer` + `patchLocation`):**
  - Because [`MapDetailsDrawer`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDetailsDrawer.tsx#L1451-L1458) updates `Location Name` live on `onChange`, clearing the input (`"New Location 30"` → `""` → `"Tunnel 1-L"`) must not break template matching, persist an empty `LocationNode.name`, or desync across Undo:
    - Hold a local `nameDraft` string in `MapDetailsDrawer` synchronized from `selectedLocation.id` / `selectedLocation.name` via `useEffect` (so Undo or external updates immediately refresh the input).
    - On `onChange`: always update `nameDraft`. If `e.target.value.trim() !== ""`, immediately call `onPatchLocation(selectedLocation.id, { name: e.target.value })` (so clicking Save without blurring never misses the latest name, and trailing spaces do not trigger spurious syncs because `oldTrimmed === newTrimmed`). If `e.target.value.trim() === ""`, keep `nameDraft` visually empty while **not** writing an empty string to `workingLocations` — preserving `selectedLocation.name` (`"New Location 30"`) until the user types a non-empty character.
    - On `onBlur`: if `nameDraft.trim() === ""`, revert `nameDraft` back to `selectedLocation.name`; otherwise trim `nameDraft` if needed.
    - Inside [`patchLocation`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/useTopologyMutations.ts#L204-L219), whenever `patch.name !== undefined` and `patch.name.trim() !== ""`, compute `nextEdges = syncEdgeLabelsForLocationRename(workingEdges, locId, targetLoc.name, patch.name)` and commit both `locations` and `edges` together (still with `pushUndo = false` per keystroke to match existing typing behavior).
- **Container Conversion Hook ([`handleConvertLocationToContainer`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/useTopologyMutations.ts#L1381-L1466)):**
  - When `keepVisitedImmutable === false` and the location is renamed from `loc.name` to `` `${loc.name} Entrance` `` ([line 1426](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/useTopologyMutations.ts#L1426)), apply `syncEdgeLabelsForLocationRename(workingEdges, locId, loc.name, `${loc.name} Entrance`)` inside the same `commitNextGraph` call so existing edges stay synchronized with the portal's new name (and Undo reverts both together).
- **Passage Hub Insertion Hook ([`handleConfirmHubCollision`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/useTopologyMutations.ts#L718-L927)):**
  - Ensure `hub -> oldDest` preserves `existingFwd.direction_label` when non-empty and falls back to `` `Passage to ${oldDest?.name ?? "Wing"}` `` when empty.

### FR-2: View & Edit `direction_label` in the Map UI

- **Mutation Handlers ([`useTopologyMutations.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/useTopologyMutations.ts)):**
  - Add `handleUpdateEdgeLabel(edgeId: string, directionLabel: string)`:
    - Updates `direction_label` on `edgeId` **only** (never mutating the reciprocal edge's `direction_label`).
    - Trims whitespace and ignores empty/whitespace-only submissions (preserving the prior label).
    - Commits via `commitNextGraph` with Undo support.
  - Add `handleCommitEdgeEdits(updates: Array<{ edgeId: string; travelMinutes?: number; directionLabel?: string }>)` (for `FR-4` batch flush on `MultiEdgePopover` close):
    - Applies all distance updates (preserving bidirectional `travel_minutes` symmetry) and directional label updates in a **single** `commitNextGraph` snapshot so multi-row edits never overwrite each other via stale closures.
- **Passage / Edge Details Editor (`MapDialogs.tsx` & `MapContextMenu`):**
  - Extend [`MultiEdgePopover`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDialogs.tsx#L1494-L1730) so each directed edge row supports editing both `direction_label` and `travel_minutes`:
    - Replace the read-only `[{e.compass_direction || "?"}] {e.direction_label}` display ([line 1643](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDialogs.tsx#L1643)) with a compact `[DIR]` compass badge + controlled text `<input aria-label="Passage label for <from> to <to>">` for `e.direction_label`.
    - `Enter` commits that row's label; `Escape` reverts that row's draft to `e.direction_label` (`stopPropagation()`); `onBlur` commits if non-empty and changed, or reverts to `e.direction_label` if blank.
    - When `isMutatingLocked` is true (e.g., turn streaming in campaign mode), disable inputs and mutating buttons cleanly.
  - Extend [`MapContextMenu`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDialogs.tsx#L1429-L1480) for `target.kind === "edge"`:
    - Add `"Edit Passage Labels & Details..."` (opening `MultiEdgePopover` with both the clicked edge and its reciprocal edge if present, or all edges in the bundle for aggregated supernode edges).
    - Keep `"Edit Travel Minutes"` (inline fast-edit), `"Mark Locked / Hidden"` / `"Mark Accessible"`, and `"Delete Passage"` for single links.
  - Keep double-clicking a single L0–L0 distance badge bound to `inlineEdgeEdit` for fast distance editing, and add an SVG `<title>` on edge hit-targets/badges showing the passage label(s) on hover.
- **Details Drawer Visibility ([`MapDetailsDrawer.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDetailsDrawer.tsx)):**
  - Include `directionLabel: string` in `ExternalPortalEntry` ([lines 60–67](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDetailsDrawer.tsx#L60-L67)) and display each link's `direction_label` in **External Boundary Links** ([lines 1608–1660](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDetailsDrawer.tsx#L1608-L1660)) and **Connected Portals Here** on Ghost nodes ([lines 891–927](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDetailsDrawer.tsx#L891-L927)).
  - Add an optional `onInspectEdgePair?: (edgeIds: string[]) => void` prop so clicking an Edit button on any external boundary link or ghost portal row opens `MultiEdgePopover` with both directed edges (`A -> B` and `B -> A`, when present) between those two endpoints.

### FR-3: Backend `create_world_from_draft` Reverse-Label Fallback Fix

- In [`create_world_from_draft`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/worlds.py#L190-L335):
  - Build `key_to_loc_name: dict[str, str]` alongside `key_to_loc_id` when inserting `draft.locations`.
  - Use `edge.direction_label.strip() or f"Passage to {key_to_loc_name.get(edge.to_key, edge.to_key)}"` for forward edges ([line 303](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/worlds.py#L303)), and `edge.reverse_direction_label.strip() or f"Return to {key_to_loc_name.get(edge.from_key, edge.from_key)}"` for reverse edges ([line 329](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/worlds.py#L329)), matching frontend [`mapDraftToNodesAndEdges`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/worldDraftMappers.ts#L148-L160).

### FR-4: Canvas Inline Editor & Aggregated Edge Badge Consistency

- **Prevent Orphaned / Lagging `inlineEdgeEdit` Overlay:**
  - Clear `inlineEdgeEdit` and `contextMenu` inside [`handleUndo`](file:///home/diegolima/Git/cybercantina/frontend/src/components/SpatialTopologyView.tsx#L235-L247), edge deletion handlers, and location deletion handlers.
  - Add a `useEffect` in [`SpatialTopologyView`](file:///home/diegolima/Git/cybercantina/frontend/src/components/SpatialTopologyView.tsx) that sets `inlineEdgeEdit` to `null` whenever `inlineEdgeEdit.edgeId` no longer exists in `workingEdges` or `projectedTopology` (keeping the SSR fallback inside [`activeInlineEdge`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/SpatialTopologyCanvas.tsx#L382-L396) intact so standalone canvas unit tests with synthetic edge IDs continue to pass).
  - Ensure [`inlineOverlayPoint`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/SpatialTopologyCanvas.tsx#L449-L460) tracks live `pan` and `zoom` without a 1-frame `getScreenCTM()` lag (compute directly from `svgRect` + `pan` + `zoom` using the `viewBox="-340 -260 680 520"` `xMidYMid meet` transform, or refresh after DOM commit).
- **Bidirectional Aggregated Supernode Badges & Actions:**
  - Add a pure helper in [`topologyProjection.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/topologyProjection.ts) (e.g., `resolveBidirectionalProjectedBundle(edge, projectedEdges)`) that merges `contA => contB` and `contB => contA` for any aggregated supernode pair:
    - `allEdges`: union of `groupedEdges` from both directions, sorted deterministically (e.g., `from_location_id`, then `to_location_id`, then `id`).
    - `passagePairCount`: number of distinct **undirected** endpoint pairs `{from_location_id, to_location_id}` across `allEdges` (so 1 bidirectional passage `A <-> B` counts as `1` and omits `· 1`, while 2 distinct cross-boundary links count as `2` and display `· 2`).
    - `minTravelMinutes`: `Math.min(...allEdges.map((e) => e.travel_minutes))`.
    - `containsLockedEdge`: `allEdges.some((e) => e.is_locked_or_hidden)`.
  - Use this merged bundle for:
    - The visible canvas badge (`labelText` shows `${minTravelMinutes}m` + `${passagePairCount > 1 ? ` · ${passagePairCount}` : ""}` + `${containsLockedEdge ? " 🔒" : ""}`).
    - Double-clicking an aggregated badge: open `MultiEdgePopover` with `allEdges` when `passagePairCount > 1` (or open `inlineEdgeEdit` for fast distance editing when `passagePairCount <= 1`).
    - Right-clicking an aggregated edge (`openContextMenuAt` on both Layer 1 lines and Layer 2 badges): pass `groupedEdgeIds` when `passagePairCount > 1` so `MapContextMenu` offers `"Manage Boundary Passages (${passagePairCount})..."` and `"Delete All ${passagePairCount} Passages"`, rather than acting only on `group.edges[0]`.
    - Quick-delete `"X"` on Layer 4: delete `allEdges.map((e) => e.id)` via `handleDeleteEdgeGroup`.
- **Safe Multi-Row Commit in `MultiEdgePopover`:**
  - In [`handleClosePopover`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDialogs.tsx#L1547-L1558), collect all dirty `travel_minutes` and `direction_label` drafts across `edges` and flush them through a single `onCommitEdgeEdits` call (falling back to single-row callbacks if an external test mounts `MultiEdgePopover` without `onCommitEdgeEdits`).

---

## 4. Edge Cases & UX Constraints

1. **Sequential Renames & Special Characters in Location Names:**
   - Creating a container `"Sewers"` (portal `"Sewers Entrance"`), linking it, renaming `"Sewers Entrance"` → `"Passage (1-M)"`, and later renaming `"Passage (1-M)"` → `"Tunnel 1-M"` must update `"Passage to Sewers Entrance"` → `"Passage to Passage (1-M)"` → `"Passage to Tunnel 1-M"` cleanly without regex escaping issues, and remain reversible via Undo.
2. **Duplicate Bidirectional Pairs (`A -> B` and `B -> A`):**
   - Renaming `A` from `"Old A"` to `"New A"` updates `"Return to Old A"` on `B -> A` (`to_location_id === A.id`) to `"Return to New A"` without altering `"Passage to B"` on `A -> B`.
3. **Self-Clearing Input During Live Typing:**
   - Selecting all text in the `Location Name` input and pressing `Backspace` before typing a new name must not write an empty `name: ""` into `workingLocations`, must not corrupt `direction_label` into `"Passage to "`, and must revert cleanly on blur if left blank.
4. **Ghost Portal Edge Editing:**
   - `selectedGhostEdges` in [`MapDetailsDrawer`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDetailsDrawer.tsx#L730-L735) deduplicates the list to one row per `portalLocationId`; clicking Edit on that row must include **all** edges in `selectedGhostEdges` matching `portalLocationId` (both outgoing and incoming) when opening `MultiEdgePopover`.
5. **Read-Only / Campaign Visited Locks:**
   - In campaign mode, visited locations have their `Location Name` disabled in `MapDetailsDrawer`; `direction_label` edits on edges in campaign mode must respect `isMutatingLocked` and route cleanly through `update_campaign_map`.
6. **Vitest Node-Only Environment:**
   - Pure label-sync, template-matching, and bidirectional bundle aggregation helpers must live in `topologyProjection.ts` so they can be unit-tested directly in Vitest without DOM dependencies, paired with `ReactDOMServer.renderToStaticMarkup` checks in `mapEditor.test.tsx`.

---

## 5. Acceptance Criteria & Verification Matrix

| ID | Criterion | Verification Method |
| :--- | :--- | :--- |
| **AC-1** | Renaming a location (`patchLocation` + `MapDetailsDrawer` clearing input to `""` then typing a new name, including names with regex characters like `(` / `)`) updates all incoming auto-generated template `direction_label`s (`Passage to`, `Return to`, `To`, `Back to`, `Return passage to`) while leaving custom labels intact. | Unit tests on `syncEdgeLabelsForLocationRename` and `patchLocation` in `mapEditor.test.tsx`. |
| **AC-2** | Converting a non-visited location to a container (`handleConvertLocationToContainer`) updates incoming template edge labels to `<Name> Entrance` in the same Undo snapshot. | Unit test in `locationContainers.test.tsx` / `mapEditor.test.tsx` verifying convert + Undo. |
| **AC-3** | Users can inspect and edit `direction_label` per directed edge via `MultiEdgePopover` (from `MapContextMenu`, aggregated badge double-click, and `MapDetailsDrawer` external/ghost links) without overwriting the reciprocal edge's `direction_label`, and blank label edits revert safely. | Static markup + mutation tests in `mapEditor.test.tsx`; manual check in World Editor & Campaign Map modal. |
| **AC-4** | Backend `create_world_from_draft` resolves `from_loc.name` (not `edge.from_key`) for omitted/blank `reverse_direction_label` and `to_loc.name` for blank `direction_label`. | Pytest unit test in `backend/tests/` verifying `LocationEdgeDraft(from_key="loc_0", to_key="loc_1", reverse_direction_label="")` produces `"Return to <Name>"`. |
| **AC-5** | Clicking Undo or deleting an edge while `inlineEdgeEdit` is open clears `inlineEdgeEdit` and `contextMenu` in `SpatialTopologyView`, standalone SSR `SpatialTopologyCanvas` tests keep passing, and `inlineOverlayPoint` aligns immediately on `pan`/`zoom` changes. | Unit test on `SpatialTopologyView` / `worldPointToWrapperPoint` math and existing SSR assertions in `mapEditor.test.tsx`. |
| **AC-6** | Aggregated supernode badges reflect locked edges, min travel minutes, and undirected passage pair counts across both `contA => contB` and `contB => contA` (omitting `· 1` for a single bidirectional pair), right-clicking/double-clicking exposes the full bundle, and `MultiEdgePopover` flushes multi-row label/distance edits in one atomic commit. | Unit tests on `resolveBidirectionalProjectedBundle` & `MultiEdgePopover` batch commit in `locationContainers.test.tsx` / `mapEditor.test.tsx`. |
| **AC-7** | All required backend, frontend, and architecture checks pass (`ruff`, `tach`, `pytest`, `arch:check`, `build`, `vitest`, `generate_arch_docs.py --check`). | CI / local verification suite. |
