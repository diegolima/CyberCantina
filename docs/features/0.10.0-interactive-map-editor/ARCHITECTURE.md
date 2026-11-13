---
feature: interactive-map-editor
target_version: 0.10.0
document_type: architecture
status: draft
last_updated: 2026-11-13
---

# Technical Architecture Specification
## Interactive Map Editor, Branch-Safe Campaign Map Persistence & Enrichment

**Related Documents:** [FRD.md](./FRD.md) · [REVIEW.md](./REVIEW.md) · [PLAN.md](./PLAN.md)

---

## 1. Database Schema & Migrations ([schema.sql](file:///home/diegolima/Git/cybercantina/backend/app/db/schema.sql) & [repository.py](file:///home/diegolima/Git/cybercantina/backend/app/db/repository.py))

### 1.1 Columns Added to Existing Tables
1. **`location_containers`**
   - `ui_x REAL NULL`
   - `ui_y REAL NULL`
   - `icon TEXT NULL`
   - `created_at_turn_id TEXT NULL` (for branch-safe campaign container creation)
2. **`location_nodes`**
   - `ui_x REAL NULL`
   - `ui_y REAL NULL`
   - `icon TEXT NULL`
   - `superseded_at_turn_id TEXT NULL` (for branch-safe deletion of unvisited locations during campaigns, mirroring `location_edges.superseded_at_turn_id`)
3. **`world_state_snapshots`**
   - `visited_location_ids_json TEXT NOT NULL DEFAULT '[]'`

### 1.2 New Branch-Scoped Spatial Override Table
To keep base `worlds`, `location_nodes`, and `location_containers` strictly immutable during active campaigns while supporting branch-safe cosmetic edits (`icon`, `ui_x`, `ui_y`) and branch-safe container reparenting (`container_id`, `parent_container_id`):

```sql
CREATE TABLE IF NOT EXISTS campaign_spatial_overrides (
    turn_id TEXT NOT NULL REFERENCES turn_nodes(id) ON DELETE CASCADE,
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    entity_kind TEXT NOT NULL CHECK (entity_kind IN ('location', 'container')),
    entity_id TEXT NOT NULL,
    parent_id TEXT NULL,          -- location.container_id or container.parent_container_id (when parent_overridden = 1)
    parent_overridden INTEGER NOT NULL DEFAULT 0 CHECK (parent_overridden IN (0, 1)),
    icon TEXT NULL,
    icon_overridden INTEGER NOT NULL DEFAULT 0 CHECK (icon_overridden IN (0, 1)),
    ui_x REAL NULL,
    ui_y REAL NULL,
    coords_overridden INTEGER NOT NULL DEFAULT 0 CHECK (coords_overridden IN (0, 1)),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (turn_id, entity_kind, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_spatial_overrides_campaign
    ON campaign_spatial_overrides(campaign_id, turn_id);
```

**Why this table works seamlessly with CyberCantina's branching engine:**
- `ON DELETE CASCADE` on `turn_id REFERENCES turn_nodes(id)` means [`delete_last_turn`](file:///home/diegolima/Git/cybercantina/backend/app/db/repository.py#L7137) automatically cleans up overrides from deleted turns/swipes.
- `get_world(..., valid_turn_ids=..., campaign_id=...)` queries `campaign_spatial_overrides` where `campaign_id = ?` and `turn_id IN valid_turn_ids`, ordered chronologically along `branch_turns`, overlaying `container_id`, `parent_container_id`, `icon`, `ui_x`, `ui_y` onto the returned `WorldRecord`.
- Multiple campaigns sharing `world_id` and alternate branches within the same campaign remain 100% isolated.

### 1.3 Idempotent Migration in [`CantinaRepository.init_db`](file:///home/diegolima/Git/cybercantina/backend/app/db/repository.py#L561)
1. Check `PRAGMA table_info(...)` and run `ALTER TABLE` for:
   - `location_containers`: `ui_x`, `ui_y`, `icon`, `created_at_turn_id`
   - `location_nodes`: `ui_x`, `ui_y`, `icon`, `superseded_at_turn_id`
   - `world_state_snapshots`: `visited_location_ids_json`
2. Create `campaign_spatial_overrides` and `idx_spatial_overrides_campaign` if missing.
3. **One-shot Visited Backfill (keyed via `app_meta` e.g. `visited_locations_backfilled_v1`):**
   - For every existing campaign row, collect all `location_nodes.id` where `world_id = campaign.world_id` (and `created_at_turn_id IS NULL` or in that snapshot's branch turns) and union with `world_state_snapshots.active_location_id`.
   - Write the resulting JSON array into `world_state_snapshots.visited_location_ids_json` for every existing snapshot of that campaign so backwards compatibility is preserved without marking future newly added locations as visited.

---

## 2. Pydantic Schemas & TypeScript Types

### 2.1 Spatial Schemas ([backend/app/schemas/world.py](file:///home/diegolima/Git/cybercantina/backend/app/schemas/world.py) & [frontend/src/types.ts](file:///home/diegolima/Git/cybercantina/frontend/src/types.ts))
- **`LocationContainer`:**
  - Add `created_at_turn_id: str | None = None`, `ui_x: float | None = None`, `ui_y: float | None = None`, `icon: str | None = None`.
- **`LocationNode`:**
  - Add `superseded_at_turn_id: str | None = None`, `ui_x: float | None = None`, `ui_y: float | None = None`, `icon: str | None = None`, `is_visited: bool = False` (computed dynamically on campaign bundles; defaults `False` on base worlds).
- **LLM Schemas Unchanged:** `WizardLocationNodeLLMOutput`, `LocationNodeDraft`, and `ImprovisedLocationSpec` explicitly omit `icon`, `ui_x`, and `ui_y`.
- **Graph Connectivity Validator (`validate_world_reachability`):**
  - Added to [`backend/app/schemas/world.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/world.py) and invoked in [`WorldUpdatePayload`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/world.py#L800-L822) and campaign map commit:
    - Finds `starting_hub` (`is_starting_location == True`, falling back to `locations[0]` if present).
    - Runs forward BFS (`from -> to`) from `starting_hub.id` **and** reverse BFS (`to -> from`) from `starting_hub.id` over active edges.
    - Raises `ValueError` if any location cannot both be reached from and return to `starting_hub.id`.

### 2.2 Snapshot & Campaign Map Sync Schemas ([backend/app/schemas/turn.py](file:///home/diegolima/Git/cybercantina/backend/app/schemas/turn.py))
- **`WorldStateSnapshot`:**
  - Add `visited_location_ids: list[str] = Field(default_factory=list)`.
- **`CampaignMapUpdatePayload` (new):**
  - `containers: list[LocationContainer] = Field(default_factory=list)`
  - `locations: list[LocationNode] = Field(default_factory=list)`
  - `edges: list[LocationEdge] = Field(default_factory=list)`

### 2.3 Enrichment Schemas ([backend/app/schemas/enrich.py](file:///home/diegolima/Git/cybercantina/backend/app/schemas/enrich.py))
- **`EnrichFieldRole`:** Add `"location_tags"`.
- **`WorldLocationEnrichContextRef`:**
  ```python
  class WorldLocationEnrichContextRef(BaseModel):
      scope: Literal["world_location"] = "world_location"
      world_id: str | None = None
      location_id: str | None = None
      world_name: str | None = None
      genre: str | None = None
      tone: str | None = None
      setting_overview: str | None = None
      location_name: str | None = None
      location_summary: str | None = None
      location_description: str | None = None
      existing_tags: list[str] | None = None
  ```
- **Structured Tags Output Schema:**
  ```python
  class _LocationTagsLLMOutput(BaseModel):
      model_config = ConfigDict(
          json_schema_extra=lambda schema: schema.update(
              required=list(schema.get("properties", {}).keys())
          )
      )
      tags: list[str] = Field(
          default_factory=list,
          description="4-7 concise sensory/environmental tags for this location.",
      )
  ```

---

## 3. Backend APIs & Repository Operations

### 3.1 World Update ([routers/worlds.py](file:///home/diegolima/Git/cybercantina/backend/app/routers/worlds.py#L88-L100) & [`update_world`](file:///home/diegolima/Git/cybercantina/backend/app/db/repository.py#L2689))
- `PUT /api/worlds/{world_id}` validates container hierarchy + bidirectional reachability to Starting Hub, then persists `ui_x`, `ui_y`, and `icon` on `location_containers` and `location_nodes`.

### 3.2 Atomic Batch Campaign Map Sync (`PUT /api/campaigns/{campaign_id}/map`)
Replaces piecemeal immediate map edits in Campaign mode with a single branch-safe atomic commit (`CantinaRepository.update_campaign_map`):
1. Resolve `campaign`, `branch_turns`, `valid_turn_ids`, `leaf_turn`, and `current_world = get_world(campaign.world_id, valid_turn_ids=valid_turn_ids, campaign_id=campaign.id)`.
2. Compute `visited_ids = set(leaf_turn.world_snapshot.visited_location_ids) | {leaf_turn.world_snapshot.active_location_id}`.
3. **Validate Campaign Rules against `current_world`:**
   - **Reachability:** Every surviving location must have a forward and reverse path to `starting_hub`.
   - **Container Hierarchy:** `validate_container_hierarchy_integrity(...)`.
   - **Saved Container Immutability:** Every container present in `current_world.containers` must remain present in `payload.containers`.
   - **Container Depth & Non-Removal of Visited Containers:** No new/unsaved container with visited descendants may be missing.
   - **Visited Location Protections:** Every `loc` with `loc.id in visited_ids`:
     - Must still exist in `payload.locations`.
     - Must retain identical `name`, `summary`, `description`, `environmental_tags`, `starting_message`, `is_hub`, `is_starting_location`.
     - Must satisfy **Ancestor Containment Monotonicity**: every container ID in `ancestor_chain(old_loc.container_id, current_world.containers)` must appear in `ancestor_chain(new_loc.container_id, payload.containers)`.
   - **Unvisited Location Deletion:** Any `old_loc` in `current_world.locations` omitted from `payload.locations` must satisfy `old_loc.id not in visited_ids`, `not old_loc.is_starting_location`, `old_loc.id != leaf_turn.world_snapshot.active_location_id`, and no leaf-turn `character_states` currently located there.
     - If `old_loc.created_at_turn_id == leaf_turn.id`, hard-delete `location_nodes` (and incident edges).
     - Otherwise, set `superseded_at_turn_id = leaf_turn.id` on `location_nodes` (and supersede its incident edges).
4. **Apply Diffs Atomically (`BEGIN IMMEDIATE`):**
   - **New Containers** (`id.startswith("new_")` or not in `current_world`): Insert into `location_containers` with `created_at_turn_id = leaf_turn.id`, mapping temporary `new_*` IDs to `cont_<hex>` IDs.
   - **New Unvisited Locations:** Insert into `location_nodes` with `created_at_turn_id = leaf_turn.id`, mapping temporary `new_*` IDs to `loc_<hex>` IDs.
   - **Updated Unvisited Locations:** If `loc.created_at_turn_id == leaf_turn.id`, update directly; if inherited/earlier turn, update unvisited semantic fields? *(Wait: only locations created on `leaf_turn.id` can be updated in place cleanly, OR branch-safe metadata overrides! Note: for inherited unvisited base-world rooms, either restrict narrative edits to `created_at_turn_id` or store optional narrative fields in `campaign_spatial_overrides` too — storing `name/summary/description/tags` override columns or only superseding unvisited `location_nodes`? No — `location_nodes.id` must stay stable, so either add optional narrative override JSON on `campaign_spatial_overrides` for inherited unvisited rooms, or clearly support it on `campaign_spatial_overrides`!)*
   - **Cosmetic & Reparenting Deltas:** Upsert rows in `campaign_spatial_overrides` keyed by `(leaf_turn.id, entity_kind, entity_id)` whenever `container_id`/`parent_container_id`, `icon`, or `(ui_x, ui_y)` differs from the resolved prior state.
   - **Edges:** Diff `current_world.edges` vs `payload.edges` (remapping `new_*` IDs): delete edges created on `leaf_turn.id`, supersede earlier-turn removed/modified edges (`superseded_at_turn_id = leaf_turn.id`), and insert newly added/modified edges with `created_at_turn_id = leaf_turn.id`.
5. Return updated `CampaignStateBundle`.

### 3.3 Visited Accumulation Across Turn Lifecycle
- [`create_campaign`](file:///home/diegolima/Git/cybercantina/backend/app/db/repository.py#L5746): Turn 0 `root_snapshot.visited_location_ids = [primary_loc_id]` (plus any starting character locations).
- [`campaigns.py` Turn Submit](file:///home/diegolima/Git/cybercantina/backend/app/routers/campaigns.py#L1118): Seed `initial_world_snapshot.visited_location_ids` from `parent_turn.world_snapshot.visited_location_ids | {active_location.id}`.
- [`update_turn_post_clerk`](file:///home/diegolima/Git/cybercantina/backend/app/db/repository.py#L6637) & [`phase5_clerk.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/phase5_clerk.py#L1801): Monotonically union `existing_visited | {updated_world_snapshot.active_location_id}` so Clerk movement adds newly entered rooms and never drops prior visited IDs.
- [`override_campaign_location`](file:///home/diegolima/Git/cybercantina/backend/app/db/repository.py#L7240): Union `target_loc.id` into `leaf_turn.world_snapshot.visited_location_ids_json`.

### 3.4 Enrichment Endpoint ([routers/enrich.py](file:///home/diegolima/Git/cybercantina/backend/app/routers/enrich.py))
- Replace `eff_clerk` with `eff_actor` across all `EnrichFieldRole`s.
- In `scope == "world_location"`:
  - Only fetch `repo.get_world(world_id)` when `world_id` is provided and any world metadata (`world_name`, `genre`, `tone`, `setting_overview`) is omitted.
  - Only fetch `repo.get_location(location_id)` when `location_id` is provided, non-draft (`not location_id.startswith("new_")`), and location fields are omitted.
  - For `field_role == "location_tags"`: call `llm_client.complete_structured` with `_LocationTagsLLMOutput` and `required_properties=["tags"]`, deterministically strip HTML/thinking tags, normalize/deduplicate against `existing_tags`, and return comma-joined tags in `enriched_text` (or `enriched_tags`).

---

## 4. Frontend Component Architecture

1. **[SpatialTopologyView.tsx](file:///home/diegolima/Git/cybercantina/frontend/src/components/SpatialTopologyView.tsx)** (decomposed cleanly with focused sub-modules/helpers under `frontend/src/components/map/` if size warrants):
   - **`mapIcons.ts`**: Canonical icon registry mapping string keys (`"building"`, `"city"`, `"forest"`, `"street"`, etc.) to `lucide-react` components + category labels + defaults per entity type (`location`, `hub`, `container_L1..L4`).
   - **`mapValidation.ts`**: Shared pure graph/hierarchy validators (`validateContainersState`, `getDescendantContainerIds`, `computeUnreachableLocationIds` bidirectional BFS, `canMoveVisitedLocation`, `isValidContainerDrop`).
   - **Canvas Interaction State:**
     - `dragNodeState`: tracks node/container drag origin `(origX, origY)`, pointer threshold (`>= 5px`), hovered drop target (`valid` vs `invalid` + reason).
     - `linkDragState`: tracks source element + compass port (`N..NW`), live SVG rubber-band bezier/line to cursor, hovered target port, and collision detection.
     - `contextMenu`: `{ x, y, target: { kind: "location" | "container" | "edge" | "canvas", ... } }`.
     - `selectedElement`: `null` by default (hides right details pane when clicking empty canvas).
     - `undoStack`: lightweight action stack supporting 1-click Undo for immediate container-drop moves (and optionally other staged moves).
   - **Unified Header/Footer Bar:** Dirty badge, unreachable-node warning chip, Undo button, Discard/Cancel, and **Save** button wired to `onSave` in both modes.
2. **[MagicWandButton.tsx](file:///home/diegolima/Git/cybercantina/frontend/src/components/MagicWandButton.tsx) & [useMagicWand.ts](file:///home/diegolima/Git/cybercantina/frontend/src/hooks/useMagicWand.ts):**
   - Add `variant?: "pill" | "compact"` to `MagicWandButtonProps`.
   - Use compact variant beside Sensory Description and Environmental Tags in `SpatialTopologyView` details pane, passing `contextKey={`${worldId}:${selectedLocation.id}`}` and draft `WorldLocationEnrichContextRef`.
3. **[EntityEditorModals.tsx](file:///home/diegolima/Git/cybercantina/frontend/src/components/EntityEditorModals.tsx) & [LiveInspector.tsx](file:///home/diegolima/Git/cybercantina/frontend/src/components/LiveInspector.tsx):**
   - Remove `WorldContainersTab` and the `Containers` tab from `EntityEditorModals.tsx`.
   - Wire `LiveInspector` full-map modal to staged `onSaveCampaignMap` (`PUT /api/campaigns/{id}/map`) with unsaved-changes guard on close.
   - Upgrade the centered 1-hop mini-map SVG (`330 × 195`) and selected-location card in `LiveInspector.tsx` to share `mapIcons.ts` and compact node/hub/portal/container SVG renderers (rendering location icons, purple Passage Hub junctions, cyan portal badges, unvisited indicators, active container frame, and cross-boundary container badges on adjacent exits).
