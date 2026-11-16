---
feature: map-cross-container-linking-and-lucide-upgrade
target_version: 0.11.4
document_type: review
status: approved
last_updated: 2026-11-16
---

# Pre-Implementation Review (`v0.11.4`)

## Architectural & Dependency Checks
- **Frontend Dependency Graph (`frontend/.dependency-cruiser.cjs`)**:
  - `topologyProjection.ts` remains a pure helper module importing only `../../types` and `./mapValidation`. Placing `resolveAutoTargetSlot`, `buildContainerBreadcrumb`, and `getLocationOccupiedPorts` in `topologyProjection.ts` introduces zero new module edges.
  - `MapDialogs.tsx` and `PortalPromotionModal.tsx` already import from `./topologyProjection`; `useTopologyPointerDrag.ts` already imports container geometry/constants from `./mapGeometry` and `./topologyProjection`. No circular imports are added.
  - `mapIcons.ts` imports solely from `"lucide-react"`.

## Edge Cases & Pitfalls Verified
1. **Reverse-Edge Compass Slot Dropped in `executeDirectEdgeCreation`**:
   - Currently, [`executeDirectEdgeCreation`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/useTopologyMutations.ts#L345-L398) hardcodes `const revSlot = OPPOSITE_COMPASS[direction]`. Fixing it to accept `targetDirection?: CompassDirection` (defaulting via `targetDirection ?? OPPOSITE_COMPASS[direction]`) and carrying `targetDirection?: CompassDirection` on `PromotionPromptState` ensures both `Auto` (nearest free port) and explicit port choices persist accurately on `edge_rev`.
2. **Escalating From `PortalPromotionModal` to `PassageHubCollisionModal` Without Dropping Promotions**:
   - If the user clicks `Confirm & Connect` inside `PortalPromotionModal` with an *explicit* target port that is already occupied (or `Auto` when all 8 target ports are full), escalating to `PassageHubCollisionModal` could silently lose checked `promoteIds`.
   - Fix: carry `promoteIds?: string[]` on `PassageHubCollisionState` so [`handleConfirmHubCollision`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/useTopologyMutations.ts#L561) applies `is_entry_exit: true` atomically alongside the new Passage Hub and edges.
3. **Container Perimeter Port Hit-Testing Order vs. Card Body Bounds**:
   - In [`SpatialTopologyCanvas`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/SpatialTopologyCanvas.tsx#L851-L854), container perimeter port dots sit at `(pt.x + cos(a) * (CONTAINER_CARD_HALF_W + 7), pt.y + sin(a) * (CONTAINER_CARD_HALF_H + 7))`, placing diagonal dots (`NE`, `SE`, `SW`, `NW`) inside `hitTestNodeAt`'s `76 x 28` container rectangle.
   - Fix: [`hitTestPortAt`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/useTopologyPointerDrag.ts#L133-L157) must test container perimeter port dots **before** `hitTestNodeAt` falls back to container body hits. Also check source-node exclusion (`!(excludeKind === "container" && excludeId === sn.container.id)`).
4. **Preventing Target-Slot & Source-Slot Overlap During `Auto` Resolution**:
   - `resolveAutoTargetSlot(sourceSlot, targetOccupied)` uses existing [`pickCompassSlot`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/topologyProjection.ts#L119-L136) starting at `OPPOSITE_COMPASS[sourceSlot]`. It only signals collision when all 8 compass slots on `targetLoc` are occupied. Source-slot occupation (`srcExistingEdge`) continues to route immediately into `PassageHubCollisionModal` before modal selection.
5. **Dual Mode Travel Minutes & Empty-Canvas Target Exclusion**:
   - `initiateConnection` must accept optional `travelMinutes` (default `2`) so `"Existing Location"` links submitted from [`EmptyCanvasCreateModal`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDialogs.tsx#L230) preserve user-entered travel minutes through both direct edge commits and `PortalPromotionModal`.
   - Existing targets already linked to `sourceLoc` (in either direction) are flagged `"Already linked"` and disabled in the list so invalid double-edges cannot be submitted.
6. **`lucide-react@^1.73.0` Verification & Existing Aliases**:
   - Verified against the published `1.73.0` tarball: `sideEffects: false`, `peerDependencies` compatible with React `^18.3.1`, and all 197 currently imported symbols (196 components + `LucideIcon` type) resolve cleanly.
   - All 12 new worldbuilding icons (`Houses`, `Barrel`, `Bridge`, `Lighthouse`, `CableCar`, `TowerControl`, `TentTree`, `Dam`, `Drone`, `Tombstone`, `Binoculars`, `BowArrow`) exist in `1.73.0` and do not collide with any existing keys (`Fence` is skipped as already present).
   - Keep `isEditableKeyboardTarget` (`[aria-modal='true']`) and all existing Vitest SSR prop contracts intact (make new props on `EmptyCanvasCreateModalProps` and `PortalPromotionModalProps` optional with safe defaults).
