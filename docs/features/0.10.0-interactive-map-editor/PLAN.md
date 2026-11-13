---
feature: interactive-map-editor
target_version: 0.10.0
document_type: plan
status: draft
last_updated: 2026-11-13
---

# Implementation Plan & Verification Matrix
## Interactive Map Editor (`v0.10.0`)

**Related Documents:** [FRD.md](./FRD.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) · [REVIEW.md](./REVIEW.md)

---

## Phase 1: Database Schema, Migrations & Core Schemas
1. **SQLite Schema & Idempotent Migration ([schema.sql](file:///home/diegolima/Git/cybercantina/backend/app/db/schema.sql), [repository.py](file:///home/diegolima/Git/cybercantina/backend/app/db/repository.py)):**
   - Add `ui_x`, `ui_y`, `icon`, `created_at_turn_id` to `location_containers`.
   - Add `ui_x`, `ui_y`, `icon`, `superseded_at_turn_id` to `location_nodes`.
   - Add `visited_location_ids_json` to `world_state_snapshots`.
   - Create `campaign_spatial_overrides` table + index.
   - Implement idempotent `init_db` column migrations and one-shot `visited_locations_backfilled_v1` backfill for existing campaigns.
2. **Pydantic Models ([world.py](file:///home/diegolima/Git/cybercantina/backend/app/schemas/world.py), [turn.py](file:///home/diegolima/Git/cybercantina/backend/app/schemas/turn.py), [enrich.py](file:///home/diegolima/Git/cybercantina/backend/app/schemas/enrich.py)):**
   - Extend `LocationContainer`, `LocationNode`, `WorldStateSnapshot`, and add `CampaignMapUpdatePayload`.
   - Add bidirectional `validate_world_reachability` helper.
   - Extend `EnrichFieldRole` (`"location_tags"`) and `WorldLocationEnrichContextRef` draft fields.
   - Verify `WizardLocationNodeLLMOutput`, `LocationNodeDraft`, and `ImprovisedLocationSpec` do **not** expose `icon`, `ui_x`, or `ui_y`.
3. **Import/Export ([import_export_service.py](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py)):**
   - Update `commit_staged_import` `INSERT`s for `location_containers` and `location_nodes` to persist `ui_x`, `ui_y`, and `icon`.

## Phase 2: Repository Branch-Safe Operations & Routers
1. **Repository Read/Write Paths ([repository.py](file:///home/diegolima/Git/cybercantina/backend/app/db/repository.py)):**
   - Update `_row_to_container`, `_row_to_location`, `_row_to_turn_node`, `update_world`, and `get_world` (filtering `location_containers.created_at_turn_id`, `location_nodes.superseded_at_turn_id`, and applying `campaign_spatial_overrides` chronologically).
   - Update `create_campaign`, `save_turn_node`, `update_turn_post_clerk`, `override_campaign_location`, `delete_last_turn`, and `get_campaign_state_bundle` for visited tracking and override/container cleanup.
   - Implement `update_campaign_map` enforcing visited protections, saved-container immutability, ancestor-containment monotonicity, depth rules, and reachability.
2. **Routers ([worlds.py](file:///home/diegolima/Git/cybercantina/backend/app/routers/worlds.py), [campaigns.py](file:///home/diegolima/Git/cybercantina/backend/app/routers/campaigns.py), [enrich.py](file:///home/diegolima/Git/cybercantina/backend/app/routers/enrich.py)):**
   - Enforce reachability on `PUT /api/worlds/{world_id}`.
   - Add `PUT /api/campaigns/{campaign_id}/map`.
   - Update `/api/enrich` to use `eff_actor`, honor `WorldLocationEnrichContextRef` draft fields with `owner_id` scoping, handle `"location_tags"` via `complete_structured`, sanitize logs, and sanitize 500 error details.
   - Update `phase5_clerk.py` to preserve `visited_location_ids` when committing post-turn snapshots.

## Phase 3: Frontend Types, API, Magic Wand & Validation Helpers
1. **Types & API ([types.ts](file:///home/diegolima/Git/cybercantina/frontend/src/types.ts), [api.ts](file:///home/diegolima/Git/cybercantina/frontend/src/api.ts)):**
   - Sync `LocationNode`, `LocationContainer`, `WorldStateSnapshot`, `EnrichFieldRole`, `MagicContextRef`, and add `api.updateCampaignMap`.
2. **Magic Wand ([MagicWandButton.tsx](file:///home/diegolima/Git/cybercantina/frontend/src/components/MagicWandButton.tsx), [useMagicWand.ts](file:///home/diegolima/Git/cybercantina/frontend/src/hooks/useMagicWand.ts)):**
   - Add `variant="compact"` inline icon mode with spinner, cancel, and Revert/dismiss controls.
3. **Map Utilities (`frontend/src/components/map/`):**
   - `mapIcons.ts`: Curated Lucide location/container/hub icon registry + defaults.
   - `mapValidation.ts`: Extract `validateContainersState`, `getDescendantContainerIds`, bidirectional `computeUnreachableLocationIds`, `isValidContainerDrop`, and `checkVisitedAncestorContainment`.

## Phase 4: Interactive Drag-and-Drop Canvas & Unified Save Flow
1. **Canvas Rendering & Interactions ([SpatialTopologyView.tsx](file:///home/diegolima/Git/cybercantina/frontend/src/components/SpatialTopologyView.tsx)):**
   - Update `computeFullMapCoords` to preserve pinned `(ui_x, ui_y)` coordinates and auto-place only `null` nodes.
   - Render rounded Level 0 tiles with icons, amber starting/active rings, cyan portal badges, purple Passage Hub diamonds/octagons, double-bordered Container cards, unlinked warning states, and unvisited indicators.
   - Add 8 compass link ports per element, drag-to-connect with Passage Hub collision modal, drag-link-to-empty-canvas creation dialog (Location / Passage Hub / Container / Cancel), and draggable palette bar.
   - Add inline double-click edge distance editing (plus multi-edge aggregated popover) and right-click context menus for locations, containers, edges, and empty canvas.
   - Implement node/container dragging with valid/invalid drop-zone feedback, Location-on-Location Container Name modal, immediate Location/Container-into-Container move + Undo stack, and click-vs-drag threshold (`5px`) + click-empty-canvas to hide details.
   - Add compact Magic Wand buttons next to Sensory Description and Environmental Tags labels in the details pane, and enforce Campaign read-only locks on visited narrative fields.
   - Add unified dirty indicator, connectivity warning banner, and Save button UX.
2. **World Editor, Mini-Map & Campaign Integration ([EntityEditorModals.tsx](file:///home/diegolima/Git/cybercantina/frontend/src/components/EntityEditorModals.tsx), [LiveInspector.tsx](file:///home/diegolima/Git/cybercantina/frontend/src/components/LiveInspector.tsx), [App.tsx](file:///home/diegolima/Git/cybercantina/frontend/src/App.tsx)):**
   - Remove `WorldContainersTab.tsx` and the `Containers` tab from `EntityEditorModals.tsx` (migrating unit test imports in [locationContainers.test.tsx](file:///home/diegolima/Git/cybercantina/frontend/src/components/__tests__/locationContainers.test.tsx)).
   - Upgrade the `LiveInspector.tsx` right-pane 1-hop mini-map and selected-node summary card to render user-selected icons, Passage Hub junctions, cyan portal badges, unvisited markers, active container boundary context, and cross-boundary neighbor container badges using shared `mapIcons.ts` / node glyph helpers.
   - Wire `LiveInspector` / `App.tsx` to `PUT /api/campaigns/{campaign_id}/map` with unsaved-changes confirmation on modal close.

## Phase 5: Verification Matrix
- **Backend Automated Tests (`backend/.venv/bin/pytest backend/tests`):**
  - `test_db_migration_marks_existing_campaign_locations_visited`
  - `test_campaign_map_visited_tracking_and_unvisited_deletion_branch_safe`
  - `test_campaign_map_container_creation_and_visited_containment_rules`
  - `test_campaign_map_saved_container_delete_blocked_and_rewind_removes`
  - `test_campaign_map_cosmetic_vs_narrative_locks_and_branch_isolation`
  - `test_world_and_campaign_reachability_validation_rejects_disconnected_or_one_way_dead_end`
  - `test_enrich_uses_actor_model_draft_context_and_location_tags`
  - `test_zcc_export_import_preserves_ui_coords_and_icons`
- **Frontend Build & Tests (`npm --prefix frontend run build && npm --prefix frontend test`):**
  - `computeFullMapCoords` partial pinning (pinned coords preserved, `null` coords auto-placed).
  - Bidirectional reachability detector flagging disconnected & one-way dead-end nodes.
  - Depth & visited-containment drop validation helpers.
  - Render smoke tests for Level 0 tile, Passage Hub, Container supernode, compact `MagicWandButton`, and `LiveInspector` right-pane mini-map (icons, hubs, portals, and cross-boundary container badges).
