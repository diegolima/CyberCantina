---
feature: interactive-map-editor
target_version: 0.10.0
document_type: review
status: draft
last_updated: 2026-11-13
---

# Architectural Review & Edge Case Analysis
## Interactive Map Editor, Branch-Safe Campaign Map Persistence & AI Field Enrichment

**Documents Under Review:** [FRD.md](./FRD.md) · [ARCHITECTURE.md](./ARCHITECTURE.md)  
**Target Systems:** SQLite Migrations, `CantinaRepository`, `world.py` / `turn.py` / `enrich.py` Schemas, `routers/{worlds,campaigns,enrich}.py`, `import_export_service.py`, `phase5_clerk.py`, Frontend `SpatialTopologyView`, `EntityEditorModals`, `LiveInspector`, `MagicWandButton`.

---

## 1. Executive Verdict

The combined design successfully unifies Editor and Campaign map UX around a staged, branch-safe drag-and-drop canvas while keeping LLM grammar decoding (`WizardLocationNodeLLMOutput`, `ImprovisedLocationSpec`) isolated from cosmetic fields.

Auditing the proposed requirements against the live CyberCantina codebase reveals **9 concrete architectural traps and subtle edge cases** that must be handled explicitly during implementation.

---

## 2. Critical Traps & Edge Cases

### 2.1 `update_turn_post_clerk` Visited-Set Wipe Trap
* **Location:** [`backend/app/engine/phase5_clerk.py#L1801-L1807`](file:///home/diegolima/Git/cybercantina/backend/app/engine/phase5_clerk.py#L1801-L1807) & [`backend/app/db/repository.py#L6664-L6677`](file:///home/diegolima/Git/cybercantina/backend/app/db/repository.py#L6664-L6677).
* **The Issue:** `phase5_clerk.py` constructs a fresh `WorldStateSnapshot` (`updated_world_snapshot = WorldStateSnapshot(...)`) and passes it to `repo.update_turn_post_clerk`, which overwrites `world_state_snapshots` columns. If `phase5_clerk.py` or `update_turn_post_clerk` omits `visited_location_ids`, every Clerk update would erase the branch's visited history.
* **Required Fix:** In `update_turn_post_clerk`, read the existing `visited_location_ids_json` on `turn_id` and store the monotonic union `existing_visited | set(updated_world_snapshot.visited_location_ids) | {updated_world_snapshot.active_location_id}` (and initialize from `completed_turn.world_snapshot.visited_location_ids` in `phase5_clerk.py`).

### 2.2 Campaign Reparenting of Base-World Locations Dangling on Rewind
* **Location:** [`backend/app/schemas/world.py#L744-L748`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/world.py#L744-L748) & [`backend/app/db/repository.py#L2638-L2654`](file:///home/diegolima/Git/cybercantina/backend/app/db/repository.py#L2638-L2654).
* **The Issue:** If Turn 5 creates `cont_new` (`created_at_turn_id = turn_5`) and directly updates `loc_base.container_id = "cont_new"` on `location_nodes`, then switching to an earlier branch (Turns 0–4) filters out `cont_new` while `loc_base.container_id` still points to `"cont_new"`, triggering a fatal `ValueError` in `validate_container_hierarchy_integrity`.
* **Required Fix:** Never mutate `location_nodes.container_id` or `location_containers.parent_container_id` on base/prior-turn rows during a campaign; persist all campaign-mode reparenting and cosmetic changes in `campaign_spatial_overrides` anchored to `leaf_turn.id`.

### 2.3 Editing Inherited Unvisited Base-World Locations in Campaign Mode
* **Location:** `location_nodes` vs. `campaign_spatial_overrides`.
* **The Issue:** A campaign created on an existing multi-room world can have base-world rooms (`created_at_turn_id IS NULL`) that have **not** been visited yet (`is_visited == False`). Under the rules, unvisited rooms are editable, **but** mutating `location_nodes.name/description/environmental_tags` in place would corrupt other campaigns sharing `world_id` and earlier timeline branches.
* **Required Fix:** Either extend `campaign_spatial_overrides` with optional `metadata_override_json` for unvisited inherited nodes (reverted cleanly on rewind via `ON DELETE CASCADE`), or supersede-and-replace only if no turns reference the ID. Using `metadata_override_json` on `campaign_spatial_overrides` keeps `location_nodes.id` invariant and 100% branch-safe.

### 2.4 Existing Backend Test Fixtures vs. Strict `WorldUpdatePayload` Reachability
* **Location:** [`backend/app/schemas/world.py#L800-L822`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/world.py#L800-L822) & `backend/tests/`.
* **The Issue:** Adding bidirectional graph reachability validation unconditionally inside `WorldUpdatePayload`'s `@model_validator` could break existing unit tests that construct minimal `WorldUpdatePayload` fixtures without full return edges.
* **Required Fix:** Audit existing `WorldUpdatePayload` usages in `backend/tests/` first. Enforce bidirectional reachability on `PUT /api/worlds/{world_id}` and `PUT /api/campaigns/{campaign_id}/map` (and check whether any existing test fixtures use one-way or disconnected test edges so they can be updated cleanly or tested explicitly).

### 2.5 `.zcc` Import Silently Dropping Coordinates & Icons
* **Location:** [`backend/app/services/import_export_service.py#L569-L651`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py#L569-L651).
* **The Issue:** `build_zcc_export` calls `WorldRecord.model_dump()`, which automatically exports new fields, whereas `commit_staged_import` uses explicit `INSERT INTO location_containers (...)` and `INSERT INTO location_nodes (...)` column lists. Without updating those `INSERT` statements, imported `.zcc` worlds would lose `ui_x`, `ui_y`, and `icon`.
* **Required Fix:** Update both `INSERT` statements in `commit_staged_import` to persist `ui_x`, `ui_y`, and `icon`.

### 2.6 Partial Pinning & Reparented Coordinate Drift in `computeFullMapCoords`
* **Location:** [`frontend/src/components/SpatialTopologyView.tsx#L449-L555`](file:///home/diegolima/Git/cybercantina/frontend/src/components/SpatialTopologyView.tsx#L449-L555).
* **The Issue:**
  1. If a map has 5 pinned rooms (`ui_x/ui_y` set) and 1 newly improvised Clerk room (`ui_x/ui_y == null`), running the existing repulsion loop across all nodes would push the pinned rooms out of their saved positions.
  2. When a user drags a room from Root into a Container (or vice versa), its old `(ui_x, ui_y)` belongs to the previous container's canvas space and may land off-screen or collide inside the new depth.
* **Required Fix:** Keep non-null `(ui_x, ui_y)` nodes strictly fixed during `computeFullMapCoords` repulsion (only displacing `null`-coordinate nodes), and reset `ui_x = null, ui_y = null` whenever an element’s `container_id` / `parent_container_id` changes.

### 2.7 Aggregated Container Edge Double-Click Ambiguity
* **Location:** [`SpatialTopologyView.tsx#L236-L447`](file:///home/diegolima/Git/cybercantina/frontend/src/components/SpatialTopologyView.tsx#L236-L447) (`projectTopologyForDepth`).
* **The Issue:** At macro depths, a single projected line between Container A and Container B (`edge.isAggregated == true`) can aggregate multiple underlying Level 0 edges with different `travel_minutes`.
* **Required Fix:** Retain the list of underlying `LocationEdge`s on `ProjectedTopologyEdge` (e.g., `underlyingEdges: LocationEdge[]`). Double-clicking a 1-edge line opens the inline distance input directly; double-clicking a multi-edge aggregated line opens a small inline popover listing each underlying edge (`Room X → Room Y: [5]m`) so the user edits the exact passage.

### 2.8 Pointer Click vs. Drag vs. SVG Pan Disambiguation
* **Location:** [`SpatialTopologyView.tsx#L2243-L2275`](file:///home/diegolima/Git/cybercantina/frontend/src/components/SpatialTopologyView.tsx#L2243-L2275).
* **The Issue:** Enabling node dragging, link-port dragging, and canvas click-to-deselect on the same SVG causes accidental selections after a drag or accidental deselections after panning.
* **Required Fix:** Track `pointerDownPos` and only fire **Left Click** (select element) or **Empty Canvas Click** (deselect & hide details) on `mouseup` when `Math.hypot(dx, dy) < 5` in screen pixels. Suppress `onClick` handlers when a drag or link-drag occurred.

### 2.9 `WorldLocationEnrichContextRef` Auth & Draft Ownership Hygiene
* **Location:** [`backend/app/routers/enrich.py#L102-L132`](file:///home/diegolima/Git/cybercantina/backend/app/routers/enrich.py#L102-L132).
* **The Issue:** When `world_id` is supplied, `repo.get_world(world_id)` currently omits `owner_id=current_user.id`! Furthermore, when enriching an unsaved `new_loc_*` node, `repo.get_location(location_id)` raises `KeyError`, and raw `str(exc)` is currently returned in line 193 (`HTTPException(status_code=500, detail=f"AI enrichment failed: {exc}")` — violating stack-trace exposure hygiene in global rules).
* **Required Fix:** Pass `owner_id=current_user.id` when `world_id` is looked up in DB, skip `get_location` when draft fields are provided or ID starts with `new_`, sanitize any dynamic log strings via `sanitize_log_value`, and return a safe non-leaking error message on 500s.

---

## 3. Recommended Verification Focus

| Area | Critical Invariant to Test |
| :--- | :--- |
| **DB Migration** | Pre-existing campaigns have all visible locations marked visited; newly improvised/added rooms afterward start unvisited. |
| **Branch Safety** | Creating a container, wrapping a visited room, and editing an icon on Branch A leaves Branch B and shared campaigns unaffected after rewind / `delete_last_turn`. |
| **Visited Containment** | Wrapping visited `L0` into `L1` (from Root or `L2`) succeeds; moving visited `L0` out of `L1` fails with HTTP 400. |
| **Reachability Gate** | Saving with an unreachable or one-way-dead-end room fails in both UI and backend (`PUT /worlds/{id}` & `PUT /campaigns/{id}/map`). |
| **Enrichment** | `/api/enrich` uses `eff_actor`, honors draft fields without DB `location_id`, and returns clean `location_tags` list via `complete_structured`. |
| **ZCC Round-Trip** | Exported `.zcc` preserves `ui_x`, `ui_y`, and `icon` across re-import. |
