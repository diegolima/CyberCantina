---
feature: map-icon-library-and-picker
target_version: 0.11.3
document_type: plan
status: completed
last_updated: 2026-11-15
---

# Implementation Plan (`v0.11.3`)

1. [x] Expand `frontend/src/components/map/mapIcons.ts` with 125 verified Lucide icons across 6 categories plus `filterMapIcons`, `getSuggestedMapIcons`, and `inferMapIconKey`.
2. [x] Harden `isEditableKeyboardTarget` in `frontend/src/components/map/mapGeometry.ts` with `[aria-modal='true']`.
3. [x] Add `MapIconBrowserModal` to `frontend/src/components/map/MapDialogs.tsx`.
4. [x] Upgrade `MapIconPicker` inside `frontend/src/components/map/MapDetailsDrawer.tsx` with search, category pills, `Used in World` + `Suggested` strips, hover label footer, and `Browse All` trigger.
5. [x] Wire `usedMapIconKeys` and `iconBrowserTarget` in `frontend/src/components/SpatialTopologyView.tsx`.
6. [x] Wire `inferMapIconKey` into `frontend/src/components/map/useTopologyMutations.ts` and `frontend/src/components/world/worldDraftMappers.ts`.
7. [x] Add unit + SSR component tests in `frontend/src/components/__tests__/mapEditor.test.tsx`.
8. [x] Run frontend, backend, and architecture doc verification checks.
