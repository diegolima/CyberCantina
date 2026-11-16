---
feature: strict-entry-exit-portal-badges
target_version: 0.11.5
document_type: review
status: approved
last_updated: 2026-11-16
---

# Pre-Implementation Review (`v0.11.5`)

## Architectural & Dependency Checks
- **Frontend Module Graph (`frontend/.dependency-cruiser.cjs`)**:
  - `computeDynamicPortalIds(locations, edges?)` remains exported from [`topologyProjection.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/topologyProjection.ts#L310-L336) with zero new imports or signature breaks for [`LiveInspector`](file:///home/diegolima/Git/cybercantina/frontend/src/components/LiveInspector.tsx#L299) or [`projectTopologyForDepth`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/topologyProjection.ts#L356).
- **Backend Module Graph (`backend/tach.toml`)**:
  - Changes in [`turns.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/turns.py#L994-L1014) only remove the post-hydration dynamic `cross_boundary_loc_ids` overwrite loop inside `get_campaign_state_bundle`; no module imports or schemas change.

## Edge Cases & Pitfalls Verified
1. **World Editor vs. Campaign Mode Consistency**:
   - In [`turns.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/turns.py#L994-L1014), `get_campaign_state_bundle` previously re-flipped `loc.is_entry_exit = True` on both endpoints of any cross-container edge (`visible_locations`, `active_location`, `neighbor_locations`). Removing that loop guarantees Campaign Map and `LiveInspector` match base `location_nodes.is_entry_exit` (plus explicit `campaign_location_overrides.is_entry_exit`) cleanly.
2. **Root-Level Normalization Invariant**:
   - Uncontained locations (`container_id == null`) must never display portal badges even if legacy fixture data contains `is_entry_exit: true`. Filtering on `Boolean(loc.container_id && loc.is_entry_exit)` inside `computeDynamicPortalIds` preserves consistency with [`MapDetailsDrawer`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDetailsDrawer.tsx#L1484-L1509), [`worldDraftMappers.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/worldDraftMappers.ts#L64), and backend [`LocationNodeCommitDraft`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/world.py#L548-L556).
3. **Ghost External Nodes & `↗` Exits Unaffected**:
   - `projectTopologyForDepth` computes `externalPortalsByLocationId`, `ghostExternalNodes`, and `ghostEdges` from edges (`fromVis && !toVis`), independent of `dynamicPortalIds`. Unmarked nodes with cross-boundary links continue showing their dashed ghost connections while omitting false Portal badges.
4. **Synthetic Overflow Passage Hubs**:
   - In [`world_locations.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/world_locations.py#L467-L495), synthetic overflow Passage Hubs already persist `is_entry_exit = 1` directly into `location_nodes` when `hub_crosses_boundary` is true, so [`test_location_containers.py#L753`](file:///home/diegolima/Git/cybercantina/backend/tests/test_location_containers.py#L753) remains satisfied without `turns.py` dynamic synthesis.
5. **Existing Regression Test Update**:
   - [`test_location_containers.py#L755-L774`](file:///home/diegolima/Git/cybercantina/backend/tests/test_location_containers.py#L755-L774) explicitly asserted the legacy `turns.py` dynamic synthesis after `connect_campaign_locations`; it must be updated to assert that `vis_vip.is_entry_exit` remains `False` unless explicitly marked.
