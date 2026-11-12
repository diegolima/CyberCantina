# Architectural Review & Edge Case Analysis
## Feature Requirements Document: Tiered Hierarchical Map Location Containers (Levels 0–4)

**Document Under Review:** [`FRD_LOCATION_CONTAINERS.md`](file:///home/diegolima/.gemini/antigravity/brain/b7ad659d-b708-4b04-b637-4c386c8170e1/FRD_LOCATION_CONTAINERS.md)  
**Target Systems:** CyberCantina Backend (`schemas`, `db/repository`, `db/vector_store`, `engine/phase2_context`, `engine/phase3_cognition`, `engine/phase5_clerk`, `routers/campaigns`, `services/import_export_service`), Frontend (`SpatialTopologyView`, `EntityEditorModals`, `LiveInspector`, `types`), SQLite Schema & Migrations.

---

## 1. Executive Verdict & Architectural Alignment

The FRD is **fundamentally sound, thoughtfully scoped, and adheres closely to CyberCantina's core engineering principles**. In particular:

1. **4-Zone KV-Cache Economy:**  
   Restricting lore strictly to Level 1, injecting organizational supernodes (Levels 2–4) only as lightweight breadcrumbs in Zone 4, and leaving Zone 1 static prefixes completely untouched during spatial movement prevents KV-cache invalidation traps.
2. **Elastic "Folders & Files" Hierarchy:**  
   Allowing Level 0 locations to exist as direct children of macro containers (e.g. open highways in districts) without forcing synthetic Level 1 wrappers avoids unnecessary entity sprawl and creator friction.
3. **Base World Immutability:**  
   Dynamically computing portal status across the active campaign branch rather than mutating base world SQLite rows preserves timeline rewinds (`delete_last_turn`) and multi-campaign tenancy.
4. **SQLite Table Recreation Discipline:**  
   Recognizing that SQLite cannot alter `CHECK` constraints with `ALTER TABLE` and specifying a full table recreation migration under `PRAGMA foreign_keys = OFF` avoids runtime `IntegrityError` failures.

However, a deep audit against the live codebase reveals **several critical architectural traps, subtle timing edge cases, and end-to-end synchronization gaps** that must be addressed in the FRD before implementation begins.

---

## 2. Critical Traps & Unforeseen Edge Cases

### 2.1 The LCA In-Memory Location Override Collision Trap
* **Location:** [`backend/app/routers/campaigns.py#L652-L665`](file:///home/diegolima/Git/cybercantina/backend/app/routers/campaigns.py#L652-L665) & FRD §5.3.1.
* **The Issue:**  
  FRD §5.3 specifies:
  > *When `req.override_location_id` is supplied:*  
  > * **Destination:** `req.override_location_id`.  
  > * **Origin:** `parent_turn.world_snapshot.active_location_id`.
  
  In [`campaigns.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/campaigns.py#L652-L665), before Phase 2 context assembly executes, `campaigns.py` explicitly mutates the parent turn's snapshot in-memory:
  ```python
  parent_active_loc_id = parent_turn.world_snapshot.active_location_id
  if req.override_location_id:
      ...
      parent_turn.world_snapshot.active_location_id = active_location.id # <--- MUTATED HERE
  ```
  If origin is resolved from `parent_turn.world_snapshot.active_location_id` after line 661, $\text{origin} == \text{destination}$, LCA delta will be empty, and arrival cues will silently fail to fire during director location overrides.
* **Required Fix:**  
  Origin must explicitly resolve from `parent_active_loc_id` (captured *prior* to line 661) whenever `req.override_location_id` is present.

---

### 2.2 Conflicting Entry vs. Exit Cues on Container-to-Container Moves
* **Location:** FRD §5.3.2 & §5.3.3.
* **The Issue:**  
  When a player moves directly from one Level 1 container to another (e.g. from `Afterlife Club` to `Lizzie's Bar` in the same or adjacent district), both `Exited: [Afterlife Club]` and `Entered: [Lizzie's Bar]` are non-empty.
  Under the current spec, the engine would emit both `<narrative_exit_cue>` and `<narrative_entry_cue>` consecutively in Zone 4:
  ```xml
  <narrative_exit_cue>The party just exited Afterlife Club onto Lizzie's Bar Entrance...</narrative_exit_cue>
  <narrative_entry_cue>The party is now inside Lizzie's Bar (hierarchy: ...)...</narrative_entry_cue>
  ```
  Small local models (Ollama 12B) frequently become confused by dual threshold instructions, spending narrative tokens recounting the departure rather than establishing presence in the newly entered location.
* **Required Fix:**  
  Enforce **Entry Precedence**: whenever `Entered` is non-empty, **suppress `<narrative_exit_cue>` entirely**. The `<narrative_exit_cue>` should fire *only* when exiting to an open, uncontained location or higher-level macro container where `Entered == empty`.

---

### 2.3 End-to-End Field Synchronization Gap for `is_exterior`
* **Location:** [`backend/app/prompts/defaults.py#L221`](file:///home/diegolima/Git/cybercantina/backend/app/prompts/defaults.py#L221), [`backend/app/engine/phase5_clerk.py#L989`](file:///home/diegolima/Git/cybercantina/backend/app/engine/phase5_clerk.py#L989), & FRD §4.4.
* **The Issue:**  
  The FRD adds `is_exterior: bool = False` to `ImprovisedLocationSpec` in Pydantic schemas. However, per the CyberCantina guideline on *End-to-End Field Synchronization*, changing a generated entity field requires synchronizing all layers.
  1. `DEFAULT_CLERK_POST_TURN_SYSTEM` in [`defaults.py#L221`](file:///home/diegolima/Git/cybercantina/backend/app/prompts/defaults.py#L221) explicitly describes `improvised_location` fields to the LLM. It currently omits `is_exterior`. Because `is_exterior` has a default value (`False`), Pydantic v2 omits it from the JSON Schema `required` list, so local grammar decoders will omit it unless explicitly instructed in the system prompt.
  2. The offline heuristic fallback `_heuristic_spatial_and_inventory_delta` in [`phase5_clerk.py#L989`](file:///home/diegolima/Git/cybercantina/backend/app/engine/phase5_clerk.py#L989) must also instantiate `is_exterior`.
* **Required Fix:**  
  Update `DEFAULT_CLERK_POST_TURN_SYSTEM` to include:
  `- is_exterior (boolean): true if the new room is outside the current building/compound; false if deeper inside.`
  and update the offline fallback generator accordingly.

---

### 2.4 Vector Cache Cleanup Omission in `update_world` (In-Place & Forking)
* **Location:** [`backend/app/db/repository.py#L2650`](file:///home/diegolima/Git/cybercantina/backend/app/db/repository.py#L2650) & FRD §6.3.1.
* **The Issue:**  
  The FRD updates vector cleanup in `prune_pending_deletion_worlds` (`repository.py#L3106`). However, in `update_world` (line 2650), when a world is updated in-place (`campaigns_using == 0`), the deletion query is:
  ```sql
  DELETE FROM vector_entries
  WHERE world_id = ?
    AND source_type IN ('lore', 'location_lore')
    AND (campaign_id IS NULL OR campaign_id = '')
  ```
  Because `'container_lore'` is missing from this list, any edited or deleted container lore leaves ghost embeddings in SQLite.
* **Required Fix:**  
  Add `'container_lore'` to the `source_type IN (...)` clause in both `repository.py#L2650` (in-place update) and `repository.py#L2730` (world forking).

---

### 2.5 SQL Parameter Tuple Mismatch in `VectorStore.search_memories`
* **Location:** [`backend/app/db/vector_store.py#L761-L776`](file:///home/diegolima/Git/cybercantina/backend/app/db/vector_store.py#L761-L776) & [`#L907`](file:///home/diegolima/Git/cybercantina/backend/app/db/vector_store.py#L907).
* **The Issue:**  
  FRD §6.1 specifies adding:
  ```sql
  OR (world_id = ? AND source_type = 'container_lore' AND (campaign_id IS NULL OR campaign_id = '' OR campaign_id = ?))
  ```
  to the `WHERE` clauses in `search_memories` and `search_memories_for_characters`.  
  This introduces **two additional `?` parameter placeholders** (`world_id` and `campaign_id`). The FRD does not specify updating the `params` tuple. If `params` is not updated, SQLite raises a fatal `sqlite3.ProgrammingError: Incorrect number of bindings supplied`.
* **Required Fix:**  
  Explicitly update `params` to include the extra `(world_id, campaign_id)` arguments.

---

### 2.6 Foreign Key Insertion Order in ZCC Staged Import
* **Location:** [`backend/app/services/import_export_service.py#L540-L555`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py#L540-L555) & FRD §6.3.4.
* **The Issue:**  
  In `commit_staged_import`, the current insertion sequence is:
  1. `worlds`
  2. `location_nodes`
  3. `location_edges`
  4. `lore_nodes`
  
  Because `location_nodes.container_id` references `location_containers(id)`, inserting `location_nodes` before `location_containers` triggers a fatal `sqlite3.IntegrityError: FOREIGN KEY constraint failed` when foreign keys are active.
* **Required Fix:**  
  Ensure `location_containers` (sorted topologically by `depth DESC`) are inserted **immediately after `worlds` and strictly before `location_nodes`**.

---

### 2.7 Container Lore Reassignment Invariant on Container Deletion
* **Location:** FRD §4.3.3 & §6.2.
* **The Issue:**  
  FRD §4.3 specifies that at the API level, deleting a container requires reassigning or unparenting child locations.  
  However, it does not define what happens to Level 1 container **lore**:
  - If a user deletes a Level 1 container and chooses to reassign children to a Level 2+ container (e.g. `District`), Level 2+ containers **cannot hold lore** (`validate_lore_depth` raises `ValueError`).
  - If child locations are unparented to the root, the container lore has no valid container or location parent.
* **Required Fix:**  
  When deleting a Level 1 container:
  1. Reassigning container lore to another container is permitted **only if the target container has `depth == 1`**.
  2. If children are unparented to root or reassigned to a macro container ($\text{depth} \ge 2$), the UI must prompt: *"Delete container lore, or convert non-secret entries into World Lore?"*.

---

### 2.8 Secret Lore Leak Prevention in Campaign Copy-on-Write Indexing
* **Location:** FRD §5.2.3, §5.2.7, & §6.2.
* **The Issue:**  
  FRD §5.2.3 requires secret container lore to be excluded from vector embeddings during base world creation. In §5.2.7, when a user updates container lore mid-campaign via `PUT /api/campaigns/{id}/containers/{cid}/lore`, the endpoint batch-upserts embeddings into `vector_entries`.
  If the endpoint does not filter out `category == "secret"`, mid-campaign container secrets will be indexed into the vector database and leaked via RAG semantic search.
* **Required Fix:**  
  Enforce `if node.category != "secret"` strictly inside the campaign CoW vector indexing loop.

---

### 2.9 Sub-Container Layout Anchor in `SpatialTopologyView`
* **Location:** [`frontend/src/components/SpatialTopologyView.tsx#L140-L143`](file:///home/diegolima/Git/cybercantina/frontend/src/components/SpatialTopologyView.tsx#L140-L143) & FRD §7.1.
* **The Issue:**  
  When drilling down into a container that does not contain the player's active location, line 141 falls back to `startId = locations[0].id` as the physics origin `(0, 0)`.
  If `locations[0]` is an arbitrary interior room (e.g. a back storage room), the entire map renders rotated around that arbitrary room, shifting orientation whenever rooms are edited.
* **Required Fix:**  
  In `computeFullMapCoords` for container drill-down views:
  Prioritize `activeLocId` if inside the container; otherwise, select the direct child location with `is_entry_exit == true` as `startId`; only fall back to `locations[0].id` if no entry portal exists.

---

### 2.10 UX Interaction: Single-Click Inspect vs. Double-Click Drill-Down
* **Location:** FRD §7.1 & §7.2.
* **The Issue:**  
  FRD §7.1 notes that container supernodes on macro maps are "clickable clusters".  
  In CyberCantina's UI architecture, single-clicking any node opens its inspection/edit drawer in the right panel. If single-clicking immediately navigates deeper into the container, creators cannot view or edit the macro container's ambiance, tags, or portals without navigating away from the parent map.
* **Required Fix:**  
  Standardize on:
  - **Single Click:** Selects the supernode, displaying its container metadata, direct portals, and child count in the sidebar drawer, with a prominent **"Enter Container ➔"** action button.
  - **Double Click (or Canvas Zoom):** Immediately drills down into the container.
  - **Breadcrumbs:** Clicking any ancestor in the breadcrumb bar immediately jumps to that level.

---

## 3. Recommended Adjustments to the FRD

Below is the concrete diff of updates to apply to `FRD_LOCATION_CONTAINERS.md`:

```markdown
### Summary of Specific Edits Required in FRD_LOCATION_CONTAINERS.md:

1. §4.3.3 Deletion Safety:
   Add explicit handling for Level 1 lore_nodes:
   "Container lore can only be reassigned to target containers with depth == 1.
    If children are moved to depth >= 2 or unparented to root, prompt creator
    to either delete the container lore or convert non-secret entries into World Lore."

2. §4.4 Improvised Exploration:
   Add prompt synchronization requirement:
   "Update DEFAULT_CLERK_POST_TURN_SYSTEM in backend/app/prompts/defaults.py
    and _heuristic_spatial_and_inventory_delta in backend/app/engine/phase5_clerk.py
    to include is_exterior description and fallback assignment."

3. §5.3.1 LCA Turn Timing Resolution:
   Update override origin resolution:
   "When req.override_location_id is supplied, resolve Origin from parent_active_loc_id
    (captured in campaigns.py prior to mutating parent_turn.world_snapshot.active_location_id)."

4. §5.3.2 LCA Entry/Exit Precedence:
   Add exit suppression rule:
   "When Entered is non-empty, suppress <narrative_exit_cue> entirely to prevent
    contradictory dual-threshold instructions for local models."

5. §6.1 Database Schema & Repository Updates:
   - In _migrate_lore_nodes_for_containers, add idempotency check:
     'if "container_id" in ddl_sql: return'.
   - Add 'CREATE INDEX IF NOT EXISTS idx_lore_nodes_container ON lore_nodes(container_id, campaign_id)'.
   - In VectorStore queries, explicitly specify updated params tuple with extra (world_id, campaign_id) bindings.
   - In CantinaRepository.update_world (both in-place line 2650 and forking line 2730),
     add 'container_lore' to vector_entries cleanup.

6. §6.2 Pydantic Schemas:
   In LocationContainer._bind_nested_container_lore, explicitly set
   patched["location_id"] = None to prevent dual-scope validation failures.
   In WorldRecord.validate_container_hierarchy, add check that each container has c.world_id == self.id.

7. §7.1 SpatialTopologyView UX:
   Specify startId priority in computeFullMapCoords (Active Location -> Entry Portal -> First Location)
   and define Single-Click (Inspect drawer) vs Double-Click / Enter Button (Drill-down).
```

---

## 4. Verification & Testing Matrix Additions

To ensure zero regressions across active campaigns, the following specific test cases should be added to the test suite:

| Test Case | Scope | Condition Verified |
| :--- | :--- | :--- |
| `test_lca_override_location_timing` | Backend | Verify that submitting a turn with `override_location_id` correctly computes the transition delta against `parent_active_loc_id` without collision. |
| `test_lca_entry_precedence_suppresses_exit` | Backend | Verify that moving between two Level 1 containers emits `<narrative_entry_cue>` and completely suppresses `<narrative_exit_cue>`. |
| `test_clerk_post_turn_prompt_exterior_sync` | Backend | Verify that `DEFAULT_CLERK_POST_TURN_SYSTEM` includes `is_exterior` instructions and `_heuristic_spatial_and_inventory_delta` returns `is_exterior=False`. |
| `test_vector_store_search_memories_bindings` | Backend | Verify that `search_memories` and `search_memories_for_characters` execute with `container_lore` bindings without raising `sqlite3.ProgrammingError`. |
| `test_update_world_in_place_vector_cleanup` | Backend | Verify that updating a world in-place purges obsolete `container_lore` entries from `vector_entries`. |
| `test_commit_staged_import_fk_order` | Backend | Verify that importing a `.zcc` archive with nested containers and locations inserts containers before locations under active foreign keys. |
| `test_container_deletion_lore_guardrail` | Backend | Verify that deleting a Level 1 container prevents reassigning container lore to a Level 2+ container. |
| `test_campaign_cow_container_lore_excludes_secrets` | Backend | Verify that `PUT /api/campaigns/{id}/containers/{cid}/lore` excludes secret container lore from vector embeddings. |
| `test_spatial_topology_anchor_portal_selection` | Frontend | Verify that drilling down into an unvisited container anchors `(0, 0)` on the entry/exit portal. |
