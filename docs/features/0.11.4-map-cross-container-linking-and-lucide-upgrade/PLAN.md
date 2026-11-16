---
feature: map-cross-container-linking-and-lucide-upgrade
target_version: 0.11.4
document_type: plan
status: completed
last_updated: 2026-11-16
---

# Implementation Plan (`v0.11.4`)

1. [x] Upgrade `lucide-react` in `frontend/package.json` (`^1.73.0`) and `frontend/package-lock.json` via `npm --prefix frontend install lucide-react@^1.73.0`.
2. [x] Expand `frontend/src/components/map/mapIcons.ts` with 12 verified `1.73.0` icons (`houses`, `barrel`, `bridge`, `lighthouse`, `cable-car`, `tower-control`, `tent-tree`, `dam`, `drone`, `tombstone`, `binoculars`, `bow-arrow`) and smart inference cues in `inferMapIconKey`.
3. [x] Add pure topology helpers in `frontend/src/components/map/topologyProjection.ts`: `resolveAutoTargetSlot`, `getLocationOccupiedPorts`, `buildContainerBreadcrumb`, and `explicitTargetSlot` field on `PromotionPromptState`.
4. [x] Update `frontend/src/components/map/useTopologyPointerDrag.ts` (`hitTestTopologyPortAt`) and `frontend/src/components/map/SpatialTopologyCanvas.tsx` to hit-test and hover-highlight container perimeter ports (`CONTAINER_CARD_HALF_W + 7`, `CONTAINER_CARD_HALF_H + 7`).
5. [x] Update `frontend/src/components/map/useTopologyMutations.ts`:
   - Honor `targetDirection` in `executeDirectEdgeCreation` via shared `buildBidirectionalEdgePair`.
   - Resolve `Auto` target slot via nearest free port (`resolveAutoTargetSlot`), open `PortalPromotionModal` on container card-body drops (even 1-location containers), and preserve `promoteIds` in `PassageHubCollisionState` / `handleConfirmHubCollision`.
   - Accept `travelMinutes` in `initiateConnection` and handle `"existing"` link creation inside `handleLinkExistingFromEmptyCanvas`.
6. [x] Create reusable `frontend/src/components/map/TargetEdgeSelector.tsx` and update `frontend/src/components/map/PortalPromotionModal.tsx` with optional Target Edge (`Auto (<slot>)` + 8 compass pills with occupied-port status) and travel minutes controls.
7. [x] Update `frontend/src/components/map/MapDialogs.tsx` (`EmptyCanvasCreateModal`) with the 4th `"Existing"` location tab (searchable cross-container location list with breadcrumbs, already-linked indicators, travel minutes, and optional Target Edge selector), and wire props in `frontend/src/components/SpatialTopologyView.tsx`.
8. [x] Add unit & SSR tests in `frontend/src/components/__tests__/mapEditor.test.tsx` and run all required verification commands.
