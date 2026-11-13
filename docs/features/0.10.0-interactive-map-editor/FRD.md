---
feature: interactive-map-editor
target_version: 0.10.0
document_type: frd
status: draft
last_updated: 2026-11-13
---

# Feature Requirements Document (FRD)
## Interactive Drag-and-Drop Map Editor, Branch-Safe Campaign Map Editing & AI Field Enrichment

**Status:** Draft  
**Target Version:** CyberCantina v0.10.0  
**Scope:** Backend (`schemas`, `db/schema.sql`, `db/repository`, `routers/worlds`, `routers/campaigns`, `routers/enrich`, `engine/phase5_clerk`, `services/import_export_service`), Frontend (`SpatialTopologyView`, `EntityEditorModals`, `LiveInspector`, `MagicWandButton`, `useMagicWand`, `types`, `api`), Deprecation of `WorldContainersTab`.

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
CyberCantina’s spatial topology view (`SpatialTopologyView`) currently operates primarily through nested forms and sidebar buttons (`Create Link`, `Connect Room`, `Delete`, `Convert to Container`, `Connected Exits`), while container management lives in a separate World Editor tab (`WorldContainersTab`). Additionally:
1. **Asymmetric World vs. Campaign UX:** World Editor stages changes asynchronously before saving, whereas Campaign mode fires immediate REST calls per edge/room action with no unified Save flow, no location removal, and no structural container management.
2. **Ephemeral Layout & Uniform Nodes:** Canvas coordinates are recalculated on every render by `computeFullMapCoords`, and all Level 0 nodes render as plain dots without domain icons.
3. **Manual Prose & Tag Authoring:** Location Sensory Descriptions and Environmental Tags lack inline AI enrichment, and `/api/enrich` currently routes through the Clerk profile instead of the creative Main Actor model and fails to read unsaved draft context.

### 1.2 Proposed Solution
Unify World Editor and Campaign Map editing around an **interactive, asynchronous drag-and-drop canvas** with:
- **Staged Asynchronous Editing & Unified Save Bar** across both Editor and Campaign modes.
- **Persisted Layout (`ui_x`, `ui_y`) & User-Selected Icons (`icon`)**, falling back to `computeFullMapCoords` only for `null`-coordinate nodes.
- **Distinct Node Geometry** (Level 0 rounded tiles with icons, amber starting/active highlights, cyan portal badges, purple Passage Hub junctions, double-bordered Level 1–4 Container cards).
- **Direct Canvas Manipulation:** Draggable palette (`+ Location`, `+ Passage Hub`, `+ Container`), 8 compass **link nodes** per element with drag-to-connect & automatic **Passage Hub** collision offers, drag-to-empty-canvas creation dialog, inline double-click edge distance editing, right-click context menus, and drag-onto-node/container grouping with depth & visited-location enforcement.
- **Branch-Safe Campaign Consistency:** Per-branch `is_visited` tracking (with DB migration marking existing campaign locations as visited), branch-safe deletion of unvisited locations, cosmetic-only editing (`icon`, `ui_x`, `ui_y`) on visited locations, strict ancestor-containment preservation on visited locations, and turn-scoped campaign containers.
- **Main-Model Magic Wand Enrichment:** Compact inline wand buttons beside Sensory Description and Environmental Tags using `eff_actor` and draft-aware `WorldLocationEnrichContextRef`.
- **UI Simplification:** Deprecate and remove the standalone `Containers` tab (`WorldContainersTab`) once the map canvas supports all container workflows.

---

## 2. Core Architectural Principles & Invariants

> [!IMPORTANT]
> **Parity With Explicit Campaign Guardrails:**  
> Editor mode and Campaign mode share the exact same canvas layout, interactions, staged dirty state, connectivity validation, and Save button UX. Campaign mode adds *only* historical-consistency restrictions (visited-location protection, saved-container immutability, and branch-scoped persistence).

1. **Graph Reachability Invariant (Save Gate):**
   - Temporary unlinked or disconnected nodes **are permitted** during staged editing and must be clearly highlighted with a warning indicator.
   - **Saving is blocked** (both in the UI and backend validation) until **every** location in the world/branch has a valid path **to and from** the Starting Hub (`is_starting_location`).
2. **Strict Container Depth Monotonicity (`parent.depth > child.depth`):**
   - Level 0 locations may reside at World Root or inside any Level 1–4 container.
   - Containers (`depth` 1–4) may only sit inside containers of strictly higher `depth`. Same-level or higher-into-lower drops are visually flagged as invalid and snap back on drop.
   - Level 1 containers cannot contain sub-containers (minimum container depth is 1).
3. **LLM Grammar Isolation:**
   - `icon`, `ui_x`, and `ui_y` must **never** be added to `WizardLocationNodeLLMOutput`, `ImprovisedLocationSpec`, or wizard/clerk prompts. Generated locations default to `null` (rendered with default icon and auto-positioned via `computeFullMapCoords`).
4. **Branch-Safe Campaign Isolation:**
   - Editing a map during an active campaign **must never** mutate the shared base world (`worlds`, base `location_nodes`, base `location_containers`, base `location_edges`) or leak across timeline branches (`turn_nodes`) or other campaigns.
5. **Visited Breadcrumb Monotonicity (Campaign Mode):**
   - Once a Level 0 location has been visited on the active branch (`is_visited == true`), its narrative identity (`name`, `summary`, `description`, `environmental_tags`, `starting_message`, `is_hub`) is read-only, it cannot be deleted, and **none of its existing ancestor containers may be removed from its hierarchy** (preventing contradictory `<hierarchy>` breadcrumb regressions).
   - A visited location *may* still be wrapped inside a finer-grained container (e.g., placing an uncontained or Level 2-contained visited room into a new or existing Level 1 building inside that Level 2 container) or have its ancestor container wrapped inside a higher-level macro container.

---

## 3. Functional Requirements

### 3.1 Persisted Coordinates, Icons & Export/Import
- **Optional Fields on `LocationNode` and `LocationContainer`:**
  - `ui_x: float | None = None`
  - `ui_y: float | None = None`
  - `icon: str | None = None`
- **Partial Auto-Layout Fallback:**
  - `computeFullMapCoords` pins every element with non-null `(ui_x, ui_y)` at its persisted position and automatically lays out only elements with `null` coordinates (such as World Wizard drafts, Phase 5 Clerk improvised rooms, legacy worlds, or freshly reparented elements).
- **Curated Location Icon Picker:**
  - Users can pick from a curated set of location-relevant Lucide icons (e.g., buildings, houses, stores, warehouses, castles, forests, mountains, streets/roads, waterways, sci-fi terminals, taverns/dining, docks/ships, transit, hazards, portals) in the right details pane (or reset to Default).
  - Unset `icon` (`null`) renders the role default: standard room pin/door for Level 0, `GitBranch` for Passage Hubs, and depth-appropriate landmark/map/globe icon for Containers.
- **`.zcc` Export & Import:**
  - Exporting a world includes `ui_x`, `ui_y`, and `icon` on all locations and containers.
  - Importing a `.zcc` archive persists `ui_x`, `ui_y`, and `icon` into SQLite.

### 3.2 Visual Hierarchy & Canvas Distinction
| Element | Geometry & Styling | Badges / Highlights |
| :--- | :--- | :--- |
| **Location (Level 0)** | Rounded node tile/badge (`~40×40` rounded card) displaying user-selected icon + name label | **Amber highlight** for `is_starting_location` (Editor) and active turn location `activeLocationId` (Campaign, plus subtle star on `is_starting_location`). **Cyan portal diamond/door badge** when `is_entry_exit` (static or dynamic cross-boundary). **Warning badge/outline** if unreachable from Starting Hub. **Subtle unvisited badge** in Campaign mode when `!is_visited`. |
| **Passage Hub (`is_hub = true`)** | Distinct junction geometry (smaller purple-accented diamond/octagon or pill junction) with `GitBranch`/crossroads badge | Purple highlight; cyan portal badge if cross-boundary. |
| **Container (`LocationContainer`, Levels 1–4)** | Layered/double-bordered card with user-selected icon, name, `L1`–`L4` depth badge, descendant room count, and external portal count | Amber highlight if containing the active turn location; double-click or right-click → *Enter Container* to drill down; breadcrumb bar to navigate back up. |

### 3.3 Canvas Interactions, Selection & Details Pane
1. **Left Click vs. Drag:**
   - Pointer movement `< 5px` registers as **Left Click**: selects the element and opens the right-hand details pane.
   - Clicking empty canvas (`< 5px`) **deselects** the current element and **hides** the details pane.
   - Pointer movement `>= 5px` drags the node (`ui_x`, `ui_y`) or pans the canvas.
2. **Removed from Details Pane:**
   - **Delete** (moved to right-click context menu).
   - **Convert to Container** (moved to right-click context menu).
   - **Create Link / Connect Existing Room forms** (replaced by dragging from compass link nodes).
   - **Connected Exits list** (edge distances moved directly onto link lines; edge deletion/editing moved to link-line double-click and right-click).
3. **Link Nodes & Passage Hub Auto-Offer:**
   - Each Level 0 tile, Passage Hub, and Container card exposes **8 compass link ports** (`N`, `NE`, `E`, `SE`, `S`, `SW`, `W`, `NW`), showing occupied vs. available status on hover or while linking.
   - **Port-to-Port Drag:** Dragging from a source element's link port to a target element's free link port creates the connection (with Portal Promotion prompt if crossing a Level 1 boundary, and room selector if connecting to/from a Container supernode).
   - **Link Port Collision:** Attempting to connect a second link to an already-occupied link port prompts the user to **create a Passage Hub** (or route through the existing Passage Hub at that port).
     - **Confirm:** Inserts/reuses the Passage Hub, rewires the existing edge through the hub, and connects the new link.
     - **Decline:** Cancels without creating any link.
   - **Drag Link to Empty Canvas:** Releasing a link drag on empty canvas opens a compact creation dialog: **Create Location**, **Create Passage Hub**, **Create Container** (creating a container + initial `is_entry_exit` portal room inside it, disabled inside Level 1), or **Cancel**.
4. **Distances & Edge Interaction:**
   - All projected link lines display a distance pill (`{travel_minutes}m`).
   - **Double-clicking** the distance pill opens an inline numeric editor (`1–240` min) right on the line (for multi-edge aggregated container lines, opens a compact picker listing the underlying edges).
   - **Right-clicking** a link line opens a context menu: *Edit Distance*, *Edit Passage Label / Lock*, *Delete Link*.
5. **Draggable Palette Bar:**
   - A compact canvas palette provides draggable chips: `+ Location`, `+ Passage Hub`, `+ Container` (disabled inside Level 1). Dropping onto empty canvas creates the element at `(ui_x, ui_y)`.
6. **Right-Click Context Menus:**
   - **Location:** Set as Starting Hub *(Editor)*, Override Current Location Here *(Campaign)*, Toggle Passage Hub *(Editor or unvisited Campaign)*, Toggle Entry/Exit Portal *(when inside container)*, Convert to Container *(Editor, or Campaign when rules allow wrapping)*, Move to Parent / Root *(subject to visited containment rules)*, Delete Location *(Editor, or Campaign only when `!is_visited && !is_starting_location && id != activeLocationId && noCharactersHere`)*.
   - **Container:** Enter Container, Delete Container *(Editor only with child-reassignment/lore-disposal modal; in Campaign mode, only removable if unsaved in current staging session and contains no visited locations)*.
   - **Empty Canvas:** `+ Add Location Here`, `+ Add Passage Hub Here`, `+ Add Container Here` *(if `depth != 1`)*, `Reset Auto-Layout`.

### 3.4 Drag-and-Drop Container Grouping & Depth Rules
- **Location (L0) onto Location (L0):**
  - Allowed at World Root or inside `depth >= 2` containers (disallowed inside `depth == 1`).
  - Displays a **Name New Container** modal (name defaulting to target location’s name, plus depth selector `1..parentDepth-1` defaulting to `1`, Confirm & Cancel).
  - **Confirm:** Creates the container at the target’s canvas position, moves both locations inside it (resetting their inner `(ui_x, ui_y)` to `null`), and preserves external connectivity.
  - **Cancel:** Moves the dragged location back to its pre-drag `(ui_x, ui_y)`.
- **Location (L0) onto Existing Container (L1–L4):**
  - Valid if allowed by Campaign visited-containment rules (see §2.5).
  - Moves the location into the container **immediately** and surfaces an **Undo** action so the user can revert the move with one click.
- **Container (`dA`) onto Container (`dB`):**
  - Valid strictly when `dA < dB` (e.g., L1 into L2). Same-level (`dA == dB`) and higher-into-lower (`dA > dB`) are invalid.
  - Moves immediately with **Undo** support.
- **Container onto Location (L0):** Invalid.
- **Visual Invalid-Drop Feedback:** Hovering over an invalid drop target highlights it in rose/red with a clear depth/visited reason badge. Releasing over an invalid target snaps the dragged element back to its original `(ui_x, ui_y)`.

### 3.5 Campaign Mode Rules & Branch Safety
1. **Visited Flag & Migration:**
   - Locations track branch-scoped `is_visited`.
   - DB migration marks all pre-existing locations in existing campaigns as visited so historical campaigns remain consistent.
   - Newly added or improvised rooms start unvisited (`is_visited = false`) until the party enters them (via turn movement, Clerk transition, or `override_location_id`).
2. **Deletion:**
   - Unvisited locations may be deleted in Campaign mode (branch-safely via `superseded_at_turn_id` or hard deletion if created on `active_leaf_turn_id`).
   - Visited locations, active locations, starting locations, and locations occupied by characters cannot be deleted.
   - Containers containing visited locations cannot be removed. Once a container has been **saved** during a campaign, it cannot be removed via the UI—only returning to an earlier turn before the container existed (timeline checkout or `delete_last_turn`) removes it.
3. **Containment & Editing:**
   - Visited locations **cannot** be removed from or moved out of any container they already belonged to.
   - Visited locations **can** be placed inside a finer-grained container (e.g., wrapping an uncontained or L2-contained visited location inside a L1 container), and existing containers **can** be wrapped into higher-level containers (`L1 -> L2`), preserving all prior ancestor breadcrumbs.
   - During campaigns, **cosmetic properties** (`icon`, `ui_x`, `ui_y`) are editable on **all** locations and containers (visited or unvisited). **Semantic/narrative fields** (`name`, `summary`, `description`, `environmental_tags`, `starting_message`, `is_hub`) are locked on visited locations and saved containers, and editable on unvisited locations and newly staged containers.

### 3.6 Magic Wand Enrichment Upgrades
- **Main Model (`eff_actor`) Routing:** All creative roles in `/api/enrich` switch from `eff_clerk` to `eff_actor`.
- **Draft-Aware Context (`WorldLocationEnrichContextRef`):**
  - Extend with optional draft fields: `world_name`, `genre`, `tone`, `setting_overview`, `location_name`, `location_summary`, `location_description`, `existing_tags`.
  - Backend uses supplied draft values first and falls back to DB lookup (`world_id`, `location_id`) only when fields are omitted—allowing enrichment on unsaved nodes and edited drafts before clicking Save.
- **Environmental Tags Role (`location_tags`):**
  - Add `"location_tags"` to `EnrichFieldRole`. Uses `complete_structured` with a `list[str]` schema and `required_properties` to generate/enrich concise ambient tags grounded in the location’s name and description.
- **Compact Icon Button Variant (`MagicWandButton`):**
  - Add a compact inline wand icon variant (`--accent-amber` / `--accent-violet` + `Sparkles`/`Wand2`, spinner/cancel while generating, and compact `RotateCcw` Revert + dismiss `×` via `useMagicWand`) placed right next to the **Sensory Description** and **Environmental Tags** labels.

### 3.7 Campaign Right-Pane Mini-Map (`LiveInspector.tsx`)
The 1-hop centered mini-map in the campaign right inspector must use the same visual language as the full map canvas so all new spatial elements remain legible at a glance:
- **Location Icons & Tiles:** Render compact rounded node tiles displaying each location's user-selected `icon` (or default icon), with **amber** highlight on `activeLoc`.
- **Passage Hubs (`is_hub = true`):** Render with the distinct purple diamond/octagon junction geometry and `GitBranch` badge.
- **Entry/Exit Portals (`is_entry_exit` or cross-boundary):** Render a compact cyan portal diamond/door badge.
- **Visited vs. Unvisited Cue:** Subtle indicator on unvisited 1-hop neighbors (`!loc.is_visited`).
- **Container Visualization:**
  - When `activeLoc` resides inside a container, display the active container context frame/pill on the mini-map (icon + `L{depth}` + name).
  - When a 1-hop neighbor belongs to a **different** container (`nb.destination.container_id !== activeLoc.container_id`), render a dashed cross-boundary link and a compact container indicator/chip on that neighbor (showing its parent container's icon, `L{depth}` badge, and name—or root exit cue when stepping outside to World Root).
- **Selected Node Card:** Update the selected-location summary card below the mini-map to display the location's selected icon, `[Entry/Exit Portal]`, `[Unvisited]`, and its container badge (`L{depth} · Container Name`).

### 3.8 World Editor Simplification
- Remove the standalone **Containers** tab (`WorldContainersTab`) from `EntityEditorModals.tsx` once the drag-and-drop map canvas provides full container creation, nesting, editing, Level 1 lore editing, and deletion.

---

## 4. Non-Goals (Out of Scope for v0.10.0)
- Adding `icon` or `ui_x`/`ui_y` generation to the World Wizard or Phase 5 Clerk LLM schemas.
- Multi-select lasso/box-selection batch operations (single-element drag and drop covers all v0.10.0 grouping flows).
- Real-time collaborative multi-user map locking.
