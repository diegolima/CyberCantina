---
feature: strict-entry-exit-portal-badges
target_version: 0.11.5
document_type: plan
status: completed
last_updated: 2026-11-16
---

# Implementation Plan (`v0.11.5`)

1. [x] Update `computeDynamicPortalIds` in `frontend/src/components/map/topologyProjection.ts` to include only containerized locations with `is_entry_exit === true` (`Boolean(loc.container_id && loc.is_entry_exit)`), removing edge-based portal synthesis.
2. [x] Remove the `cross_boundary_loc_ids` dynamic portal overwrite loop from `get_campaign_state_bundle` in `backend/app/db/repos/turns.py`.
3. [x] Update `backend/tests/test_location_containers.py` (lines 755–774 + verify parent-container unmarked nodes like `Watson Overpass` preserve `is_entry_exit = False`).
4. [x] Add frontend unit + SSR regression tests in `frontend/src/components/__tests__/locationContainers.test.tsx` and `frontend/src/components/__tests__/mapEditor.test.tsx`.
5. [x] Run all backend (`ruff check app tests`, `tach check`, `pytest tests`) and frontend (`arch:check`, `build`, `test`) verification gates plus `generate_arch_docs.py --check`.
