---
feature: map-cross-container-linking-and-lucide-upgrade
target_version: 0.11.4
document_type: frd
status: approved
last_updated: 2026-11-16
---

# Feature Requirements Document (FRD)
## Cross-Container Link-to-Existing, Optional Target Port Selection & `lucide-react@1.73.0` Upgrade

**Status:** Approved  
**Target Version:** CyberCantina v0.11.4  
**Scope:**
- Frontend Canvas Drag & Hit-Testing ([`useTopologyPointerDrag.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/useTopologyPointerDrag.ts), [`SpatialTopologyCanvas.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/SpatialTopologyCanvas.tsx))
- Frontend Connection & Edge Mutations ([`useTopologyMutations.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/useTopologyMutations.ts), [`topologyProjection.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/topologyProjection.ts))
- Frontend Connection Dialogs ([`MapDialogs.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDialogs.tsx), [`PortalPromotionModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/PortalPromotionModal.tsx))
- Frontend Dependencies & Icon Registry ([`package.json`](file:///home/diegolima/Git/cybercantina/frontend/package.json), [`mapIcons.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/mapIcons.ts))
- Frontend Tests (`frontend/src/components/__tests__/mapEditor.test.tsx`)

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
1. **Linking Across Containers Requires Navigating Scope or Using Drawer Workarounds:**
   - Currently, dragging a compass link onto empty canvas space in [`useTopologyPointerDrag`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/useTopologyPointerDrag.ts#L368-L386) opens [`EmptyCanvasCreateModal`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDialogs.tsx#L230-L360), which **only** supports creating a brand-new `location`, `hub`, or `container` in `currentContainerId`.
   - When the intended destination already exists inside another container (or at a different hierarchy level and is therefore not visible on the current canvas), the user cannot connect to it from the link drag gesture.
2. **Target Compass Edge Is Hardcoded / Unselectable on Container & Explicit Port Drops:**
   - Container supernodes render 8 perimeter compass ports for *outgoing* drags in [`SpatialTopologyCanvas`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/SpatialTopologyCanvas.tsx#L849-L886), yet [`hitTestPortAt`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/useTopologyPointerDrag.ts#L133-L157) only hit-tests ports on `visibleLocations` and falls back to `hitTestNodeAt` (`explicitTargetSlot: undefined`) for containers.
   - More critically, [`executeDirectEdgeCreation`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/useTopologyMutations.ts#L345-L398) ignores any explicit target port (`const revSlot = OPPOSITE_COMPASS[direction]`), so even when [`initiateConnection`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/useTopologyMutations.ts#L462-L477) checks `opts.explicitTargetSlot` for collision, the created reverse edge still overwrites the slot with `OPPOSITE_COMPASS[direction]`.
   - In [`PortalPromotionModal`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/PortalPromotionModal.tsx#L83-L120), when connecting to a multi-location container, the user can pick *which* interior location to target, but has no optional control over *which compass edge/port* on that target location the return link uses—and single-location containers with an existing `[Entry/Exit Portal]` bypass the modal completely.
3. **Settlement Cluster Icon (`Houses`) Unavailable on `lucide-react@^0.378.0`:**
   - Villages, hamlets, townships, and residential clusters currently fall back to single-dwelling `Home` (`home`) or urban `Building`/`Building2` in [`MAP_ICON_OPTIONS`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/mapIcons.ts#L168-L213) because `Houses` did not exist in `lucide-react@0.378.0`.
   - Verified against `lucide-react@1.73.0`: `Houses` (plus `Bridge`, `Barrel`, `Tombstone`, `Binoculars`, `BowArrow`, `Fence`, etc.) is now exported, while maintaining `sideEffects: false`, React 18 compatibility (`^16.5.1 || ^17.0.0 || ^18.0.0 || ^19.0.0`), and all **197** symbols currently imported across `frontend/src/`.

### 1.2 Proposed Solution
1. **Link-to-Existing Mode on Empty-Canvas Link Drop (`FR-1`):** Add an `"Existing Location"` option inside [`EmptyCanvasCreateModal`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDialogs.tsx#L230-L360) so dragging a link into empty space can either create a new element *or* search and link to any existing location across the entire world hierarchy (with container breadcrumb display and cross-boundary portal handling).
2. **Optional Target Compass Edge Selection & Reverse-Slot Fidelity (`FR-2`):** Fix [`executeDirectEdgeCreation`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/useTopologyMutations.ts#L345-L398) to honor an optional `targetDirection` (defaulting to automatic resolution), expose an optional target-edge selector (`Auto` or explicit `N/NE/E/SE/S/SW/W/NW` with occupied-port indicators) when linking to a container or existing location, and allow dropping onto container perimeter port dots to pre-select that port.
3. **`lucide-react` Upgrade (`^0.378.0` → `^1.73.0`) & `houses` Settlement Icon (`FR-3`):** Upgrade `lucide-react`, register `"houses"` (`Houses`) in [`MAP_ICON_OPTIONS`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/mapIcons.ts#L168) under `settlement` with settlement/village inference cues in [`inferMapIconKey`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/mapIcons.ts#L1464-L1555), and optionally adopt select newly unlocked worldbuilding icons.

---

## 2. Scope, Boundaries & Core Invariants

1. **Zero Backend or Database Schema Changes:**
   - Bidirectional connections continue to persist as paired [`LocationEdge`](file:///home/diegolima/Git/cybercantina/frontend/src/types/world.ts#L88-L100) records (`from_location_id`, `to_location_id`, `compass_direction`, `travel_minutes`, `is_locked_or_hidden`).
2. **Single-Snapshot Undo & Collision Safety:**
   - All newly created edges and portal promotions (`is_entry_exit: true`) commit atomically via `commitNextGraph` / `executeDirectEdgeCreation`.
   - Selecting (or auto-resolving) an already-occupied compass slot on either the source or target location must continue routing through [`PassageHubCollisionModal`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDialogs.tsx#L65) rather than silently double-booking a compass slot.
3. **Strict Optionality for Target Edge Selection:**
   - Leaving target edge on **Auto** (the default) must require **zero extra decisions** and behave seamlessly with existing quick-connect workflows.
4. **Backward Compatibility & Tree-Shaking Invariant:**
   - Keep all 125 existing icon keys in [`MAP_ICON_OPTIONS`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/mapIcons.ts#L168) unchanged.
   - Continue using explicit named imports from `"lucide-react"` (no wildcard `import *`) and confirm `npm --prefix frontend run build`, `test`, and `arch:check` pass cleanly after upgrading to `^1.73.0`.

---

## 3. Functional Requirements

### FR-1: Empty-Canvas Link Drop — "Existing Location" Target Mode

- **Trigger:** Dragging from a location or container compass port (`linkDrag`) and releasing on empty canvas (`!dropTarget && distance > 14px`) opens [`EmptyCanvasCreateModal`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDialogs.tsx#L230).
- **Mode Selector:** Expand the modal's target kind tabs from 3 (`Location`, `Passage Hub`, `Container`) to **4**, adding **`Existing Location`** (e.g., `mode: "location" | "hub" | "container" | "existing"`).
- **Searchable Cross-Container Location Picker:**
  - Lists eligible `workingLocations` across the **entire world** (including locations inside collapsed Level 1–4 containers and outside `currentContainerId`), excluding the resolved `sourceLoc.id`.
  - Displays each candidate's **name**, **container hierarchy breadcrumb** (e.g., `Region › District` or `Top-Level`), whether it is already an `[Entry/Exit Portal]` or `[Hub]`, and whether it is **already linked** to `sourceLoc` (disabled or flagged with `"Already linked"` so identical duplicate edges cannot be submitted).
  - Supports instant client-side text filtering by location name or container path; groups or prioritizes cross-container / unlinked targets cleanly.
- **Connection Parameters & Pipeline Reuse:**
  - Includes `Travel Time (min)` input (default `2`) and an **optional Target Edge (`Auto` + 8 compass directions)** selector (shared with `FR-2`).
  - On submit, routes through [`initiateConnection`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/useTopologyMutations.ts#L402) (supporting travel minutes + optional explicit target slot) so:
    - Cross-boundary connections automatically compute `computePromotionCandidates(...)` and open [`PortalPromotionModal`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/PortalPromotionModal.tsx#L28) if interior nodes need `[Entry/Exit Portal]` promotion (preserving travel minutes and any chosen target slot).
    - Source or target port collisions open [`PassageHubCollisionModal`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDialogs.tsx#L65).
    - Unblocked same-scope or already-promoted connections commit immediately with one Undo snapshot.

### FR-2: Optional Target Edge / Compass Port Selection & Reverse-Slot Fidelity

- **Reverse Edge Slot Fix (`executeDirectEdgeCreation`):**
  - Update [`executeDirectEdgeCreation`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/useTopologyMutations.ts#L345-L398) to accept an optional `targetDirection?: CompassDirection` (or `options` parameter) alongside `direction` (source slot).
  - The forward edge uses `compass_direction: direction`; the reverse edge uses `compass_direction: targetDirection ?? OPPOSITE_COMPASS[direction]`.
  - Propagate `targetDirection` through [`PromotionPromptState`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/topologyProjection.ts#L686-L696) so explicit port drops and modal selections are never discarded when portal promotion runs.
- **Smart Automatic Target Edge Resolution (When `Auto` / Nothing Is Chosen):**
  - When no explicit target port is chosen (`explicitTargetSlot === undefined`), resolve `targetDirection` automatically via a pure helper using `OPPOSITE_COMPASS[sourceSlot]` first, then scanning outward in `COMPASS_ORDER` by angular distance (`[0, +1, -1, +2, -2, +3, -3, +4]`) to pick the **nearest unoccupied compass port** on the target location.
  - Display the resolved automatic slot clearly inside the modal's default button/chip (e.g., `Auto (E)` or `Auto (NE — nearest free)`), updating live if the user switches the target location.
  - Only trigger [`PassageHubCollisionModal`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDialogs.tsx#L65) on `Auto` if **all 8** target ports are occupied (or when the *source* port `sourceSlot` is already occupied, or when an *explicitly* chosen target port is occupied).
- **Optional Target Edge Selector When Linking to a Container:**
  - When a user drags a link onto a **container supernode**:
    1. **Container Body Drop Opens Confirmation Modal:** Dropping onto a container's **card body** (`explicitTargetSlot === undefined`) **always** opens [`PortalPromotionModal`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/PortalPromotionModal.tsx#L28) — even for single-location containers whose location is already marked `[Entry/Exit Portal]` — so the user always has access to the optional Target Edge selector (and travel minutes) while still confirming in 1 click (`Confirm & Connect`) with `Auto` selected by default.
    2. **Perimeter Port Drop (Direct Canvas Fast-Path):** Extend [`hitTestPortAt`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/useTopologyPointerDrag.ts#L133-L157) to also hit-test the 8 rendered compass ports around `projectedTopology.visibleSupernodes` (with hover feedback in [`SpatialTopologyCanvas`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/SpatialTopologyCanvas.tsx#L851-L885)). Dropping directly onto a container perimeter port pre-selects `explicitTargetSlot` (fast-connecting immediately if only 1 already-promoted location exists inside the container and no portal promotions are required, or opening [`PortalPromotionModal`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/PortalPromotionModal.tsx#L28) with that port pre-selected otherwise).
    3. **Modal Target Edge Controls & Live Occupied-Port Awareness:** Inside [`PortalPromotionModal`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/PortalPromotionModal.tsx#L28) (and `FR-1` `"Existing Location"` mode), provide an `Auto` toggle + 8 compact compass buttons (`N / NE / E / SE / S / SW / W / NW`), annotating occupied ports on the currently chosen `toLocation` (showing which connected destination occupies each slot) and recomputing dynamically whenever the target location dropdown changes.
- **Target Port Collision Handling:**
  - If the user explicitly chooses a target slot inside the modal that is already occupied on `toLocation`, check collision on confirm and transition cleanly into [`PassageHubCollisionModal`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDialogs.tsx#L65) (preserving any `promoteIds` portal promotions chosen in the prior step), while warning inline (`"Occupied by <Location> — will insert Passage Hub"`) before confirm.

### FR-3: Upgrade `lucide-react` (`^0.378.0` → `^1.73.0`) & Expand Curated Map Icons

- **Package Upgrade:**
  - Bump `"lucide-react": "^1.73.0"` in [`frontend/package.json`](file:///home/diegolima/Git/cybercantina/frontend/package.json) and update `frontend/package-lock.json`.
  - Verify TypeScript compilation (`tsc`), Vite production bundle (`vite build`), dependency-cruiser (`arch:check`), and all Vitest suites (`vitest run`), ensuring zero regressions across all 197 existing `lucide-react` imports (including `LucideIcon`, `Home`, `Wand2`, `Waves`, etc.).
- **Add `houses` Icon to Settlement Category:**
  - Import `Houses` from `"lucide-react"` in [`mapIcons.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/mapIcons.ts).
  - Add entry in `MAP_ICON_OPTIONS` under `category: "settlement"`:
    - `key`: `"houses"`, `label`: `"Village / Hamlet"`, `Icon`: `Houses`
    - `keywords`: `["village", "hamlet", "houses", "town", "township", "settlement", "cluster", "neighborhood", "cottages", "suburb"]`
    - `genres`: `["fantasy", "modern", "horror"]`, `scales`: `["container", "location", "hub"]`
  - Add smart icon inference rule in [`inferMapIconKey`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/mapIcons.ts#L1477-L1540) ahead of single `"home"` matching for `["village", "hamlet", "township", "settlement", "neighborhood", "cottages"]`.
- **Included `lucide-react@1.73.0` Worldbuilding Icon Additions (`125` → `137` Icons):**
  All 12 net-new icons below were verified against `lucide-react@1.73.0` exports and confirmed absent from the existing 125-icon [`MAP_ICON_OPTIONS`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/mapIcons.ts#L168) catalog:
  - **`settlement` (`+2` → 29):**
    - `houses` (`Houses`) — *Village / Hamlet*
    - `barrel` (`Barrel`) — *Cellar / Supply Hold* (cellars, taverns, dockside cargo, breweries)
  - **`transit` (`+4` → 24):**
    - `bridge` (`Bridge`) — *Bridge / Crossing* (bridges, aqueducts, overpasses, spans)
    - `lighthouse` (`Lighthouse`) — *Lighthouse / Beacon* (coastal beacons, signal towers)
    - `cable-car` (`CableCar`) — *Cable Car / Skyway* (mountain lifts, urban skyways, trams)
    - `tower-control` (`TowerControl`) — *Control / Watch Tower* (airports, starports, signal towers)
  - **`wilderness` (`+2` → 24):**
    - `tent-tree` (`TentTree`) — *Forest Camp / Outpost* (ranger camps, woodland bivouacs)
    - `dam` (`Dam`) — *Dam / Canal Lock* (hydro dams, floodgates, sluices)
  - **`scifi` (`+1` → 21):**
    - `drone` (`Drone`) — *Drone Bay / Hangar* (automated bays, recon pads)
  - **`arcana` (`+1` → 19):**
    - `tombstone` (`Tombstone`) — *Graveyard / Memorial* (cemeteries, barrows, shrines)
  - **`hazard` (`+2` → 20):**
    - `binoculars` (`Binoculars`) — *Lookout / Recon Post* (watchposts, sniper nests, overlooks)
    - `bow-arrow` (`BowArrow`) — *Hunting Lodge / Range* (archery ranges, ranger lodges)
  - Also add corresponding keyword cues to [`inferMapIconKey`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/mapIcons.ts#L1477-L1540) (e.g., `bridge`/`viaduct`/`overpass` → `"bridge"`, `lighthouse` → `"lighthouse"`, `graveyard`/`cemetery` → `"tombstone"` ahead of `"shovel"`, `village`/`hamlet`/`settlement` → `"houses"`, `lookout`/`overlook` → `"binoculars"`).

---

## 4. Edge Cases & UX Constraints

1. **Duplicate Edge Guard in Empty-Canvas `Existing Location` Mode:**
   - Both direct same-direction and opposite-direction edges (`workingEdges.some(...)`) are treated as already linked; candidates already linked to `sourceLoc` must be visually flagged and non-selectable in [`EmptyCanvasCreateModal`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDialogs.tsx#L230) rather than waiting until submit to fail with a status banner.
2. **Container Source (`sourceKind === "container"`) Empty-Canvas Drop:**
   - Consistent with existing [`handleConfirmEmptyCanvasCreate`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/useTopologyMutations.ts#L765-L780), dragging from a container supernode resolves its gateway/first interior location as `sourceLoc`. In `"existing"` mode, excluding `sourceLoc.id` (and optionally showing a subtitle `From <Container> via <sourceLoc.name>`) keeps cross-container provenance transparent.
3. **Self-Contained Container Cycle / Empty Container:**
   - Empty target containers still cannot be connected (`Cannot connect to an empty container — add a location or sub-container inside it first.`).
4. **Cross-Boundary Bidirectional Integrity:**
   - When connecting `sourceLoc` inside Container A to an existing or container-hosted `toLocation` inside Container B (or L0 to nested L2/L3), [`computePromotionCandidates`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/topologyProjection.ts#L698) returns **all** unpromoted `is_entry_exit: false` ancestors' entry locations on both source and destination sides as before.
5. **Single-Container Collision + Portal Promotion Ordering:**
   - If [`PortalPromotionModal`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/PortalPromotionModal.tsx) allows choosing a target slot that collides on the chosen `toLocation`, passing `promoteIds` into `PassageHubCollisionModal` (or preventing collision unless explicitly handled) must not lose the user's portal promotion selection.
6. **Vitest Node-Only Environment:**
   - Pure helper logic (target edge auto-resolution, occupied slot calculation, existing-location search/filtering, and icon inference) should live in pure TypeScript helpers (`mapIcons.ts`, `topologyProjection.ts`, or `mapValidation.ts`) alongside `renderToStaticMarkup` assertions in `mapEditor.test.tsx`.

---

## 5. Acceptance Criteria & Verification Matrix

| ID | Criterion | Verification Method |
| :--- | :--- | :--- |
| **AC-1** | Dragging a link into empty space lets the user toggle `"Existing Location"`, search locations from other containers with container breadcrumbs, set travel minutes, and create a valid link (triggering portal promotion if cross-boundary). | Unit/UI render tests + manual canvas verification |
| **AC-2** | Locations already linked to `sourceLoc` (or `sourceLoc` itself) cannot be double-linked from the empty-canvas `"Existing Location"` picker. | Unit/UI test |
| **AC-3** | Dragging a link onto a container **body** opens [`PortalPromotionModal`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/PortalPromotionModal.tsx#L28) (even for 1-location containers) with optional Target Edge (`Auto` + `N..NW`) and occupied-port indicators; `Auto` picks the nearest free port around `OPPOSITE_COMPASS[sourceSlot]`, and explicit selection writes `edge_rev.compass_direction` to the chosen slot. | `useTopologyMutations` / `executeDirectEdgeCreation` unit test + `PortalPromotionModal` SSR test |
| **AC-4** | Dragging onto a container perimeter port dot highlights the port on hover and pre-fills `explicitTargetSlot` (fast-connecting if 1 already-promoted location exists inside, or opening the modal pre-selected otherwise). | `hitTestPortAt` unit test |
| **AC-5** | `lucide-react` is upgraded to `^1.73.0`, all 12 new curated icons (including `Houses` under `settlement`) are registered (`137` total), and `inferMapIconKey` resolves `"Oakbrook Village"` / `"Mossy Hamlet"` to `"houses"`. | `mapIcons` unit test |
| **AC-6** | `npm --prefix frontend run arch:check`, `npm --prefix frontend run build`, and `npm --prefix frontend test` all pass with zero warnings/errors. | CLI gate |

---

## 6. Resolved Design Decisions

1. **`Auto` Target Edge on Occupied Opposite Port → Pick Nearest Free Port:** When `Auto` is used and `OPPOSITE_COMPASS[sourceSlot]` is already occupied on the target location, automatically select the nearest unoccupied compass slot in `COMPASS_ORDER` around the preferred opposite direction, only escalating to `PassageHubCollisionModal` if all 8 target ports are full (or on source-port / explicit-port collisions).
2. **Single-Location Container Body Drops → Always Show Confirmation Modal:** Dropping onto a container supernode **body** always opens the confirmation modal so the user can adjust travel time and optionally select a Target Edge, whereas dropping directly onto a container's perimeter port dot acts as the fast-path when no location disambiguation or portal promotion is needed.
3. **Curated `1.73.0` Icon Expansion → Include Relevant Icons:** Upgrade `lucide-react` to `^1.73.0` and add **12** verified worldbuilding icons (`Houses`, `Barrel`, `Bridge`, `Lighthouse`, `CableCar`, `TowerControl`, `TentTree`, `Dam`, `Drone`, `Tombstone`, `Binoculars`, `BowArrow`) across the 6 existing categories (`125` → `137` icons).
