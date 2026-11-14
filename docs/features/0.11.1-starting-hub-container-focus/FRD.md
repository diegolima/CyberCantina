---
feature: starting-hub-container-focus
target_version: 0.11.1
document_type: frd
status: draft
last_updated: 2026-11-14
---

# Feature Requirements Document (FRD)
## Contained Starting Hubs, Wizard Container Commit Parity & Initial Editor Focus

**Status:** Draft  
**Target Version:** CyberCantina v0.11.1  
**Scope:**
- Frontend Wizard & Map Mappers (`frontend/src/types/world.ts`, `frontend/src/components/world/worldDraftMappers.ts`, `frontend/src/components/wizard/WorldWizardModal.tsx`, `frontend/src/components/world/WorldInspectorModal.tsx`)
- Frontend Topology Canvas & Details Drawer (`frontend/src/components/SpatialTopologyView.tsx`, `frontend/src/components/map/TopologyHeaderToolbar.tsx`, `frontend/src/components/map/MapDetailsDrawer.tsx`)
- Backend Wizard Schemas, Embeddings & Persistence (`backend/app/schemas/world.py`, `backend/app/db/repos/worlds.py`, `backend/app/routers/worlds.py`)
- Frontend & Backend Tests (`frontend/src/components/__tests__/`, `backend/tests/`)

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
Although CyberCantina's underlying world schema (`WorldUpdatePayload`) and 5-phase simulation engine already support placing the Starting Hub (`is_starting_location = true`) inside a Level 1–4 container and marking it as an Entry/Exit Portal (`is_entry_exit = true`), three UX and persistence defects break this workflow in practice:

1. **World Wizard Commit Silently Discards Containers & Spatial Metadata:**
   - When a user generates a world in `WorldWizardModal` (`mode="wizard"` inside `WorldInspectorModal`), adds a container (e.g. Level 1), moves the Starting Hub inside it, toggles **Entry/Exit Portal**, and clicks **Commit World & Spatial Graph** (or **Save Map**), [`WorldWizardModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/wizard/WorldWizardModal.tsx#L80-L83) converts state via [`worldStateToDraft`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/worldDraftMappers.ts#L177-L233) before calling `api.commitWorld`.
   - `worldStateToDraft`, [`WorldWizardDraft`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/world.py#L503-L510), [`LocationNodeDraft`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/world.py#L442-L466), and [`WorldsMixin.create_world_from_draft`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/worlds.py#L122-L312) all predate v0.9.0 containers. Consequently, `containers`, `container_id`, `is_entry_exit`, `ui_x`, `ui_y`, and `icon` (plus Level 1 container lore) are silently dropped—leaving the Starting Hub back at World Root with the container lost.
2. **Map Opens at World Root Instead of Focusing the Starting Hub's Container & Level:**
   - [`SpatialTopologyView`](file:///home/diegolima/Git/cybercantina/frontend/src/components/SpatialTopologyView.tsx#L241-L248) always initializes `currentContainerId` to `null` (World Root) and `pan` to `{ x: 0, y: 0 }`.
   - When the Starting Hub resides inside a Level 1–4 container, opening the map editor hides the Starting Hub behind its ancestor supernode card instead of focusing the container level where the Starting Hub actually sits.
3. **Misleading Editor Copy & Ambiguous Contained-Starter Feedback:**
   - When the Starting Hub sits inside a container in World Editor mode, `WorldInspectorModal` sets `activeLocationId` to the Starting Hub, causing `projectTopologyForDepth` to set `hasActivePlayer = true` on its ancestor supernode and [`MapDetailsDrawer.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDetailsDrawer.tsx#L490-L494) to display **`· Party Present`** while authoring a world with no campaign.

### 1.2 Proposed Solution
1. **Extend the World Wizard Commit Pipeline (`FR-1`):** Add optional container and spatial-node fields to `WorldWizardDraft` / `LocationNodeDraft` (while keeping LLM-facing `WizardLocationNodeLLMOutput` flat), preserve them in `worldStateToDraft` / `draftToWorldRecord`, and persist them in `WorldsMixin.create_world_from_draft` / `acreate_world_from_draft`.
2. **Auto-Focus the Starting Hub's Container Level on Map Open (`FR-2`):** Initialize `SpatialTopologyView` to drill into `activeLoc.container_id ?? null` and center `pan` on `activeLoc` on initial mount without altering `zoom` or disrupting hidden-tab rendering.
3. **Polish Contained Starting Hub & Portal UX (`FR-3`):** Fix the editor-mode `"· Party Present"` badge to `"· Contains Starting Hub"` and guarantee single-node or multi-node contained starting hubs marked `is_entry_exit = true` commit and render cleanly.

---

## 2. Scope, Boundaries & Core Invariants

1. **LLM Wizard Generation Remains Flat:**
   - [`WizardLocationNodeLLMOutput`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/world.py#L406-L439) and `_WizardWorldLLMOutput` in [`backend/app/wizards/world_wizard.py`](file:///home/diegolima/Git/cybercantina/backend/app/wizards/world_wizard.py#L28-L45) **must remain flat** (no container fields) so constrained JSON schemas for local 12B models remain unaffected.
   - All new container/spatial fields on `LocationNodeDraft` and `WorldWizardDraft` **must be optional with safe defaults** (`default=None`, `default=False`, `default_factory=list`) for 100% backwards compatibility with existing drafts, `.zcc` imports, and `CharacterWizard` auto-generated worlds.
2. **Entry/Exit Portals Remain Scoped to Contained Locations:**
   - A Starting Hub inside any container (`container_id != null`) **may** be marked `is_entry_exit = true`.
   - Root-level locations (`container_id == null`) **must remain ineligible** for `is_entry_exit = true` (checkbox hidden in `MapDetailsDrawer`; moving a location to World Root clears `is_entry_exit = false`), because portals represent container boundaries and Phase 5 `is_exterior` transitions.
3. **One-Time Initial Focus (No Camera Hijacking):**
   - Drilling into the Starting Hub's container and centering `pan` must occur **only on component initialization**—never re-running on graph edits (`onChangeGraph`), container moves, or saving.
4. **Zero Hidden-Tab DOM Dependency:**
   - Because `WorldInspectorModal` renders the Map tab inside `display: none` while on the Base tab, initial container focus and `pan` centering must rely solely on data coordinates (`ui_x`, `ui_y`, or `{ 0, 0 }`) and never read `svgRef.getBoundingClientRect()` on mount.

---

## 3. Functional Requirements & Edge Cases

### FR-1: Lossless Container & Portal Persistence in World Wizard Commit
**Requirement:** All map edits performed during the World Wizard review step (`WorldInspectorModal` with `mode="wizard"`)—including creating Level 1–4 containers, moving the Starting Hub or other locations into containers, toggling `is_entry_exit`, authoring Level 1 container lore, pinning coordinates (`ui_x`, `ui_y`), and picking custom `icon` keys—must persist identically when committed via `POST /api/wizards/world/commit`.

- **Schema & Type Extensions (`backend/app/schemas/world.py`, `frontend/src/types/world.ts`):**
  - Extend `LocationNodeDraft` (Python & TypeScript) with optional fields:
    - `container_id: str | None = None` (draft container `key`/`id` reference)
    - `is_entry_exit: bool = False`
    - `ui_x: float | None = None`
    - `ui_y: float | None = None`
    - `icon: str | None = None`
  - Add `LocationContainerDraft` (Python & TypeScript) with:
    - `key: str` (or `id: str` slug/client ID used to wire `parent_container_key` / `container_id` during commit)
    - `parent_container_key: str | None = None` (or `parent_container_id`—align naming consistently across `LocationNodeDraft.container_id` and `LocationContainerDraft`)
    - `depth: int` (`ge=1, le=4`)
    - `name: str` (`min_length=1, max_length=160`)
    - `description: str = ""`
    - `environmental_tags: list[str] = Field(default_factory=list)`
    - `ui_x: float | None = None`
    - `ui_y: float | None = None`
    - `icon: str | None = None`
    - `lore_nodes: list[LocationLoreNodeDraft] = Field(default_factory=list)` (validator rejecting non-empty `lore_nodes` when `depth > 1`, matching `LocationContainer.validate_lore_depth`).
  - Extend `WorldWizardDraft` (Python & TypeScript) with `containers: list[LocationContainerDraft] = Field(default_factory=list)`.
  - Fix [`WorldInspectorModalProps.onCommitDraft`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldInspectorModal.tsx#L44-L50) TypeScript signature to explicitly include `containers: LocationContainer[]`.
- **Frontend Draft Round-Trip (`frontend/src/components/world/worldDraftMappers.ts`):**
  - Update `worldStateToDraft` to serialize `state.containers` (including sanitized `lore_nodes` only for `depth === 1`) and preserve `container_id`, `is_entry_exit`, `ui_x`, `ui_y`, and `icon` on each location.
  - Update `draftToWorldRecord` / `mapDraftToNodesAndEdges` so `draft.containers` and location `container_id`, `is_entry_exit`, `ui_x`, `ui_y`, `icon` are hydrated if present (keeping `draft.containers ?? []` safe when absent).
  - Ensure `WorldWizardModal` uses the updated `onCommitDraft` payload directly without stripping container fields.
- **Backend Commit Persistence & Embeddings (`backend/app/db/repos/worlds.py`):**
  - In `WorldsMixin.create_world_from_draft`:
    - Validate container hierarchy integrity (unique keys/IDs, valid `parent_container_id` references, strict `parent.depth > child.depth`, no cycles, valid `loc.container_id` references) before inserting.
    - Insert `draft.containers` into `location_containers` sorted by `depth DESC` (parents before children), minting fresh `cont_<hex>` IDs and maintaining a `draft_key -> persisted_cont_id` map.
    - Persist Level 1 container `lore_nodes` into `lore_nodes` (`container_id = mapped_cont_id, location_id = NULL, campaign_id = NULL`) and index non-secret entries in `vector_store` with `source_type="container_lore"`.
    - Insert `draft.locations` with `container_id` (remapped via `cont_id_map`), `is_entry_exit`, `ui_x`, `ui_y`, and `icon`.
  - In `WorldsMixin.acreate_world_from_draft`:
    - Pre-compute embeddings for non-secret Level 1 container lore (`source_type="container_lore"`) alongside world and location lore so commit makes zero synchronous embedding calls inside the SQLite transaction.
- **Edge Cases:**
  - **Empty `containers` (LLM-only or unmodified wizard draft):** Must behave identically to current behavior with zero validation regressions.
  - **Single-Location Contained World (Repro Case):** Deleting all locations except the Starting Hub, adding an L1 container, placing the Starting Hub inside it, marking `is_entry_exit = true`, and committing must succeed and reopen with the L1 container intact and the Starting Hub inside it (`container_id != null`, `is_entry_exit == true`, `is_starting_location == true`).
  - **Starting Hub Inside Nested L2–L4 Hierarchy:** If the Starting Hub sits inside `L3 > L2 > L1`, all ancestor containers and their `parent_container_id` links must persist in proper topological order.
  - **Back-to-Seed Navigation in `WorldWizardModal`:** If the user triggers `Re-imagine Map` inside `WorldInspectorModal`, ensure stale containers are either cleared or cleanly handled rather than silently orphaned if all locations are replaced (or document/retain empty containers explicitly).

---

### FR-2: Initial Container Focus & Starting Hub Centering on Map Open
**Requirement:** Opening the Spatial Topology map in World Editor mode (`mode="editor"`) must automatically open at the container level containing the Starting Hub (`currentContainerId = startLoc.container_id ?? null`) and center the canvas viewport on the Starting Hub.

- **Initial Container Level Resolution (`frontend/src/components/SpatialTopologyView.tsx`):**
  - Derive the initial focus location on mount from `activeLocationId` -> fallback to `is_starting_location` -> fallback to `propLocations[0]`.
  - Initialize `currentContainerId` to that location's `container_id` **iff** `container_id` exists in `propContainers`; otherwise initialize to `null` (World Root).
  - Initialize `selectedLocId`: preserve existing `defaultSelectedLocationId` semantics (`null` hides drawer if explicitly requested; otherwise selects `initialFocusLoc.id`).
- **Initial Viewport Centering (`pan` & `zoom`):**
  - Initialize `zoom` to `1` (100%) so neighboring rooms, portals, and links remain readable around the focal node.
  - Initialize `pan`:
    - If `initialFocusLoc` has finite pinned `(ui_x, ui_y)` coordinates, initialize `pan` to `{ x: -initialFocusLoc.ui_x, y: -initialFocusLoc.ui_y }`.
    - Otherwise initialize `pan` to `{ x: 0, y: 0 }` (matching `computeFullMapCoords`, which places `anchorNodeId` at `{ x: 0, y: 0 }`).
  - Note: Do **not** depend on `svgRef.getBoundingClientRect()`, because `WorldInspectorModal` mounts `SpatialTopologyView` inside a hidden (`display: none`) tab on open.
- **Campaign Mode Parity (`LiveInspector.tsx`):**
  - When `SpatialTopologyView` is opened in Campaign Mode (`mode="campaign"`), `activeLocationId` is `bundle.active_location.id`. Using the same initial `currentContainerId = initialFocusLoc?.container_id ?? null` and `pan` centering ensures opening the Full Spatial Topology modal during gameplay also focuses the room/building the party is currently in rather than dropping the player at World Root.
  - (Optional configurability: expose an optional `initialContainerFocus?: "active" | "root"` prop on `SpatialTopologyView` defaulting to `"active"` so tests or future callers can opt out cleanly.)
- **Breadcrumb Orientation Cue (`TopologyHeaderToolbar.tsx`):**
  - Whenever `currentContainerId !== null`, ensure the breadcrumb trail (`World Root > ... > Active Container`) clearly indicates the nested focus and provides a one-click jump back to `World Root` or any ancestor container.
- **Edge Cases:**
  - **Starting Hub at World Root (`container_id == null`):** `currentContainerId` initializes to `null`; behavior matches current World Root open.
  - **Dangling / Missing `container_id`:** Fall back safely to `currentContainerId = null`.
  - **Dragging Starting Hub or Reassigning Starting Location While Open:** `currentContainerId` and `pan` must **not** jump unexpectedly when the user edits `locations` or `containers`. (Keep the existing safeguard that falls back to `null` only if the *currently viewed* `currentContainerId` is deleted.)
  - **Switching Tabs in `WorldInspectorModal`:** Because `SpatialTopologyView` stays mounted across Base/Map/Lore tab switches, user pan/zoom/drill-down navigation within the Map tab is preserved while switching tabs.

---

### FR-3: Editor Mode Labels & Entry/Exit Portal Behavior for Contained Starting Hubs
**Requirement:** Contained Starting Hubs must display accurate editor-mode terminology and support `is_entry_exit` portal toggling seamlessly without campaign-specific wording or false blockers.

- **Editor-Mode Container Badge (`frontend/src/components/map/MapDetailsDrawer.tsx`):**
  - In the container stats summary bar (`containerStats`), replace `"· Party Present"` when `mode === "editor"` with **`"· Contains Starting Hub"`** (retaining `"· Party Present"` strictly for `mode === "campaign"`).
- **Entry/Exit Portal Support on Starting Hubs (`MapDetailsDrawer.tsx`, `SpatialTopologyCanvas.tsx`, `mapValidation.ts`):**
  - Confirm `Entry/Exit Portal` checkbox in `MapDetailsDrawer` remains enabled for any location with `Boolean(selectedLocation.container_id)` (including `is_starting_location === true`) in `mode === "editor"`.
  - Keep root-level locations (`container_id == null`) excluded from `is_entry_exit` (checkbox hidden; moving out to World Root clears `is_entry_exit = false`).
  - Verify `SpatialTopologyCanvas` renders both the amber Starting Hub styling (`isAnchorOrStart`) and the cyan `DoorOpen` portal diamond badge simultaneously without visual overlap or clipping when a Starting Hub inside a container has `is_entry_exit = true`.
  - Verify single-node worlds (`1` contained Starting Hub with `is_entry_exit = true`, `0` edges) pass both client validation (`computeUnreachableLocationIds`, `validateContainersState`) and server validation (`validate_world_reachability`, `validate_container_hierarchy_integrity`).

---

## 4. Non-Goals (Out of Scope for v0.11.1)
- Generating containers or `container_id` assignments automatically via the LLM inside `generate_world_draft` / `reimagine_world_map` (`WizardLocationNodeLLMOutput` remains flat).
- Allowing `is_entry_exit = true` on World Root (`container_id == null`) locations.
- Changing `travel_minutes` to metric `distance_meters` (tracked separately in `TODO.md`).
- Adding new Turn 0 container prose templates in `campaigns.py` (can be evaluated separately if needed).

---

## 5. Verification Matrix
Before completion, implementation must satisfy:
- **Backend Checks (`cd backend && .venv/bin/ruff check app tests && .venv/bin/tach check` and `backend/.venv/bin/pytest backend/tests`):**
  - Unit/integration tests for `POST /api/wizards/world/commit` (`create_world_from_draft` / `acreate_world_from_draft`):
    - Reproduces the exact user flow (1 starting location inside an L1 container with `is_entry_exit = True`, plus optional L1 container lore, `ui_x`/`ui_y`, `icon`) and verifies `get_world` returns the container, `loc.container_id`, `loc.is_entry_exit == True`, `loc.is_starting_location == True`, and indexed `container_lore` vectors.
    - Verifies nested L2->L1 container hierarchy commit remapping and cycle/depth rejection.
    - Verifies backwards compatibility when committing a flat `WorldWizardDraft` without `containers` (e.g., direct LLM draft or `CharacterWizard` auto-world).
- **Frontend Checks (`npm --prefix frontend run arch:check && npm --prefix frontend run build && npm --prefix frontend test`):**
  - `worldDraftMappers` tests: `worldStateToDraft` and `draftToWorldRecord` round-trip `containers`, `container_id`, `is_entry_exit`, `ui_x`, `ui_y`, `icon`, and L1 container lore without loss.
  - `SpatialTopologyView` / `WorldInspectorModal` tests:
    - Opening in `mode="editor"` when the Starting Hub is inside a container initializes at that container level (`currentContainerId === startLoc.container_id`) and renders the Starting Hub node directly (not only the root container card), while centering `pan` on pinned `(ui_x, ui_y)` if set.
    - Opening when the Starting Hub is at World Root initializes at `currentContainerId === null`.
    - Editing/moving the Starting Hub after mount does not unexpectedly hijack `currentContainerId`.
  - `MapDetailsDrawer` tests:
    - Selecting a container holding the Starting Hub renders `"Contains Starting Hub"` in `mode="editor"` and `"Party Present"` in `mode="campaign"`.
    - Selecting a contained Starting Hub exposes and toggles `"Entry/Exit Portal"`, while a root-level Starting Hub does not.
- **Architecture Docs Sync (if schemas or module exports change):**
  - `backend/.venv/bin/python scripts/generate_arch_docs.py --check`
