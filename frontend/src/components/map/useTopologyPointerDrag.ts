import React, { useCallback, useEffect } from "react";
import type {
  CompassDirection,
  LocationContainer,
  LocationNode,
} from "../../types";
import {
  CONTAINER_HIT_HALF_H,
  CONTAINER_HIT_HALF_W,
  LOCATION_PORT_RADIUS,
  PORT_HIT_RADIUS,
  PORT_TOUCH_HIT_RADIUS,
  TAP_MOVE_THRESHOLD_PX,
  getContainerPortPoint,
} from "./mapGeometry";
import type { EmptyCanvasLinkState, GroupIntoContainerState } from "./MapDialogs";
import { isValidContainerDrop } from "./mapValidation";
import {
  COMPASS_ANGLES,
  COMPASS_ORDER,
  DEFAULT_EXTERIOR_DISTANCE_METERS,
  DEFAULT_FALLBACK_DISTANCE_METERS,
  DEFAULT_INTERIOR_DISTANCE_METERS,
  clientToWorldPoint,
  type LinkDragState,
  type NodeDragState,
  type ProjectedDepthTopology,
} from "./topologyProjection";

/** Pure world-space hit-test for visible container cards and location/hub nodes. */
export function hitTestTopologyNodeAt(
  wx: number,
  wy: number,
  projectedTopology: Pick<ProjectedDepthTopology, "visibleSupernodes" | "visibleLocations">,
  fullMapCoords: Record<string, { x: number; y: number }>,
  excludeKey?: { kind: "location" | "container"; id: string }
): { kind: "location" | "container"; id: string } | null {
  for (const sn of projectedTopology.visibleSupernodes) {
    if (
      excludeKey?.kind === "container" &&
      excludeKey.id === sn.container.id
    ) {
      continue;
    }
    const pt = fullMapCoords[sn.container.id];
    if (!pt) continue;
    if (
      Math.abs(wx - pt.x) <= CONTAINER_HIT_HALF_W &&
      Math.abs(wy - pt.y) <= CONTAINER_HIT_HALF_H
    ) {
      return { kind: "container", id: sn.container.id };
    }
  }
  for (const loc of projectedTopology.visibleLocations) {
    if (excludeKey?.kind === "location" && excludeKey.id === loc.id) {
      continue;
    }
    const pt = fullMapCoords[loc.id];
    if (!pt) continue;
    const radius = loc.is_hub ? 20 : 23;
    if (Math.hypot(wx - pt.x, wy - pt.y) <= radius) {
      return { kind: "location", id: loc.id };
    }
  }
  return null;
}

/**
 * Hit-test compass port dots (on both location nodes and container supernode perimeters)
 * before falling back to card/node body hits (which carry no explicit slot).
 */
export function hitTestTopologyPortAt(
  wx: number,
  wy: number,
  projectedTopology: Pick<ProjectedDepthTopology, "visibleSupernodes" | "visibleLocations">,
  fullMapCoords: Record<string, { x: number; y: number }>,
  excludeKind: "location" | "container",
  excludeId: string,
  portHitRadius: number = PORT_HIT_RADIUS
): { kind: "location" | "container"; id: string; slot?: CompassDirection } | null {
  const hitRadius = portHitRadius + 1;
  for (const loc of projectedTopology.visibleLocations) {
    if (excludeKind === "location" && loc.id === excludeId) continue;
    const pt = fullMapCoords[loc.id];
    if (!pt) continue;
    for (const slot of COMPASS_ORDER) {
      const a = COMPASS_ANGLES[slot];
      const px = pt.x + Math.cos(a) * LOCATION_PORT_RADIUS;
      const py = pt.y + Math.sin(a) * LOCATION_PORT_RADIUS;
      if (Math.hypot(wx - px, wy - py) <= hitRadius) {
        return { kind: "location", id: loc.id, slot };
      }
    }
  }
  for (const sn of projectedTopology.visibleSupernodes) {
    if (excludeKind === "container" && sn.container.id === excludeId) continue;
    const pt = fullMapCoords[sn.container.id];
    if (!pt) continue;
    for (const slot of COMPASS_ORDER) {
      const portPt = getContainerPortPoint(pt, COMPASS_ANGLES[slot]);
      if (Math.hypot(wx - portPt.x, wy - portPt.y) <= hitRadius) {
        return { kind: "container", id: sn.container.id, slot };
      }
    }
  }
  const bodyHit = hitTestTopologyNodeAt(wx, wy, projectedTopology, fullMapCoords, {
    kind: excludeKind,
    id: excludeId,
  });
  return bodyHit ? { kind: bodyHit.kind, id: bodyHit.id } : null;
}

/** Persist a discrete open-canvas node drop with undo support when coordinates changed. */
export function commitCanvasDropCoordinates(params: {
  kind: "location" | "container";
  id: string;
  x: number;
  y: number;
  locationMap: Map<string, LocationNode>;
  containerMap: Map<string, LocationContainer>;
  patchLocation: (
    locId: string,
    patch: Partial<LocationNode>,
    pushUndo?: boolean
  ) => void;
  patchContainer: (
    contId: string,
    patch: Partial<LocationContainer>,
    pushUndo?: boolean
  ) => void;
}): boolean {
  const {
    kind,
    id,
    x,
    y,
    locationMap,
    containerMap,
    patchLocation,
    patchContainer,
  } = params;
  const prev =
    kind === "location" ? locationMap.get(id) : containerMap.get(id);
  if (prev && prev.ui_x === x && prev.ui_y === y) {
    return false;
  }
  if (kind === "location") {
    patchLocation(id, { ui_x: x, ui_y: y }, true);
  } else {
    patchContainer(id, { ui_x: x, ui_y: y }, true);
  }
  return true;
}

export interface UseTopologyPointerDragParams {
  nodeDrag: NodeDragState | null;
  setNodeDrag: React.Dispatch<React.SetStateAction<NodeDragState | null>>;
  linkDrag: LinkDragState | null;
  setLinkDrag: React.Dispatch<React.SetStateAction<LinkDragState | null>>;
  pan: { x: number; y: number };
  zoom: number;
  svgRef: React.RefObject<SVGSVGElement | null>;
  viewportGroupRef: React.RefObject<SVGGElement | null>;
  projectedTopology: ProjectedDepthTopology;
  fullMapCoords: Record<string, { x: number; y: number }>;
  currentContainerId: string | null;
  workingContainers: LocationContainer[];
  workingLocations: LocationNode[];
  mode: "editor" | "campaign";
  propContainers: LocationContainer[];
  propLocations: LocationNode[];
  locationMap: Map<string, LocationNode>;
  containerMap: Map<string, LocationContainer>;
  setSelectedContainerId: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedLocId: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedGhostLocId: React.Dispatch<React.SetStateAction<string | null>>;
  onMoveGhostNode: (externalLocId: string, x: number, y: number) => void;
  setStatusNotice: React.Dispatch<React.SetStateAction<string | null>>;
  setGroupModal: React.Dispatch<React.SetStateAction<GroupIntoContainerState | null>>;
  setEmptyCanvasModal: React.Dispatch<React.SetStateAction<EmptyCanvasLinkState | null>>;
  executeImmediateContainerMove: (
    kind: "location" | "container",
    id: string,
    targetContainerId: string | null
  ) => void;
  patchLocation: (
    locId: string,
    patch: Partial<LocationNode>,
    pushUndo?: boolean
  ) => void;
  patchContainer: (
    contId: string,
    patch: Partial<LocationContainer>,
    pushUndo?: boolean
  ) => void;
  initiateConnection: (params: {
    sourceKind: "location" | "container";
    sourceId: string;
    sourceSlot: CompassDirection;
    targetKind: "location" | "container";
    targetId: string;
    explicitTargetSlot?: CompassDirection;
  }) => void;
  canAddContainerHere: boolean;
  availableContainerDepthsHere: Array<1 | 2 | 3 | 4>;
}

export function useTopologyPointerDrag({
  nodeDrag,
  setNodeDrag,
  linkDrag,
  setLinkDrag,
  pan,
  zoom,
  svgRef,
  viewportGroupRef,
  projectedTopology,
  fullMapCoords,
  currentContainerId,
  workingContainers,
  workingLocations,
  mode,
  propContainers,
  propLocations,
  locationMap,
  containerMap,
  setSelectedContainerId,
  setSelectedLocId,
  setSelectedGhostLocId,
  onMoveGhostNode,
  setStatusNotice,
  setGroupModal,
  setEmptyCanvasModal,
  executeImmediateContainerMove,
  patchLocation,
  patchContainer,
  initiateConnection,
  canAddContainerHere,
  availableContainerDepthsHere,
}: UseTopologyPointerDragParams) {
  // Hit-testing helper in world coords
  const hitTestNodeAt = useCallback(
    (
      wx: number,
      wy: number,
      excludeKey?: { kind: "location" | "container"; id: string }
    ): { kind: "location" | "container"; id: string } | null =>
      hitTestTopologyNodeAt(wx, wy, projectedTopology, fullMapCoords, excludeKey),
    [projectedTopology, fullMapCoords]
  );

  // Hit-test compass port dots during link drag
  const hitTestPortAt = useCallback(
    (
      wx: number,
      wy: number,
      excludeKind: "location" | "container",
      excludeId: string,
      portHitRadius?: number
    ): { kind: "location" | "container"; id: string; slot?: CompassDirection } | null =>
      hitTestTopologyPortAt(
        wx,
        wy,
        projectedTopology,
        fullMapCoords,
        excludeKind,
        excludeId,
        portHitRadius
      ),
    [projectedTopology, fullMapCoords]
  );

  // Global window pointer move / up / cancel listeners for nodeDrag & linkDrag
  useEffect(() => {
    if (!nodeDrag && !linkDrag) return;

    const handleMove = (ev: PointerEvent) => {
      const wpt = clientToWorldPoint(
        ev.clientX,
        ev.clientY,
        svgRef.current,
        viewportGroupRef.current,
        pan,
        zoom
      );

      if (
        nodeDrag &&
        (nodeDrag.pointerId === undefined || ev.pointerId === nodeDrag.pointerId)
      ) {
        const distPx = Math.hypot(
          ev.clientX - nodeDrag.startClientX,
          ev.clientY - nodeDrag.startClientY
        );
        const hasMoved = nodeDrag.hasMoved || distPx > TAP_MOVE_THRESHOLD_PX;
        const currX = Math.round(wpt.x - nodeDrag.pointerOffsetX);
        const currY = Math.round(wpt.y - nodeDrag.pointerOffsetY);

        let hoverTarget: typeof nodeDrag.hoverTarget = null;
        if (hasMoved && nodeDrag.kind !== "ghost") {
          const hit = hitTestNodeAt(currX, currY, {
            kind: nodeDrag.kind,
            id: nodeDrag.id,
          });
          if (hit) {
            const check = isValidContainerDrop({
              draggedKind: nodeDrag.kind,
              draggedId: nodeDrag.id,
              targetKind: hit.kind,
              targetId: hit.id,
              currentContainerId,
              containers: workingContainers,
              locations: workingLocations,
              campaignMode: mode === "campaign",
              originalContainers: propContainers,
              originalLocations: propLocations,
            });
            hoverTarget = {
              kind: hit.kind,
              id: hit.id,
              valid: check.valid,
              reason: check.reason,
            };
          }
        }
        setNodeDrag((prev) =>
          prev ? { ...prev, currX, currY, hasMoved, hoverTarget } : null
        );
      }

      if (
        linkDrag &&
        (linkDrag.pointerId === undefined || ev.pointerId === linkDrag.pointerId)
      ) {
        const hitRadius =
          linkDrag.pointerType === "touch"
            ? PORT_TOUCH_HIT_RADIUS
            : PORT_HIT_RADIUS;
        const portHit = hitTestPortAt(
          wpt.x,
          wpt.y,
          linkDrag.sourceKind,
          linkDrag.sourceId,
          hitRadius
        );
        setLinkDrag((prev) =>
          prev
            ? {
                ...prev,
                currX: wpt.x,
                currY: wpt.y,
                hoverTarget: portHit,
              }
            : null
        );
      }
    };

    const handleUp = (ev: PointerEvent) => {
      if (
        nodeDrag &&
        (nodeDrag.pointerId === undefined || ev.pointerId === nodeDrag.pointerId)
      ) {
        if (!nodeDrag.hasMoved) {
          // Treat as Left Click -> select & inspect
          if (nodeDrag.kind === "location") {
            setSelectedContainerId(null);
            setSelectedGhostLocId(null);
            setSelectedLocId(nodeDrag.id);
          } else if (nodeDrag.kind === "ghost") {
            setSelectedContainerId(null);
            setSelectedLocId(null);
            setSelectedGhostLocId(nodeDrag.id);
          } else {
            setSelectedGhostLocId(null);
            setSelectedContainerId(nodeDrag.id);
          }
          setNodeDrag(null);
          return;
        }

        if (nodeDrag.kind === "ghost") {
          onMoveGhostNode(nodeDrag.id, nodeDrag.currX, nodeDrag.currY);
          setNodeDrag(null);
          return;
        }

        // Check if released over a breadcrumb drop zone first
        const el =
          typeof document !== "undefined"
            ? document.elementFromPoint(ev.clientX, ev.clientY)
            : null;
        const crumbEl = el?.closest?.("[data-breadcrumb-drop]");
        if (crumbEl) {
          const targetCidRaw = crumbEl.getAttribute("data-breadcrumb-drop");
          const targetCid = targetCidRaw === "__root__" ? null : targetCidRaw;
          if (targetCid !== currentContainerId) {
            const check = isValidContainerDrop({
              draggedKind: nodeDrag.kind,
              draggedId: nodeDrag.id,
              targetKind: targetCid ? "container" : "root",
              targetId: targetCid ?? undefined,
              currentContainerId: targetCid,
              containers: workingContainers,
              locations: workingLocations,
              campaignMode: mode === "campaign",
              originalContainers: propContainers,
              originalLocations: propLocations,
            });
            if (check.valid) {
              executeImmediateContainerMove(
                nodeDrag.kind,
                nodeDrag.id,
                targetCid
              );
            } else {
              setStatusNotice(check.reason || "Cannot move element out here.");
            }
            setNodeDrag(null);
            return;
          }
        }

        const ht = nodeDrag.hoverTarget;
        if (ht) {
          if (!ht.valid) {
            // Invalid drop target -> snap back cleanly
            setStatusNotice(
              ht.reason || "Invalid drop target under container depth rules."
            );
            setNodeDrag(null);
            return;
          }

          if (ht.kind === "container") {
            executeImmediateContainerMove(nodeDrag.kind, nodeDrag.id, ht.id);
            setNodeDrag(null);
            return;
          }

          // Valid L0-on-L0 drop -> open Container Name confirmation modal
          if (ht.kind === "location" && nodeDrag.kind === "location") {
            const draggedLoc = locationMap.get(nodeDrag.id);
            const targetLoc = locationMap.get(ht.id);
            if (draggedLoc && targetLoc) {
              setGroupModal({
                draggedLoc,
                targetLoc,
                parentContainerId: currentContainerId,
              });
            }
            setNodeDrag(null);
            return;
          }
        }

        // Dropped onto open canvas -> persist new coordinates with undo support
        commitCanvasDropCoordinates({
          kind: nodeDrag.kind,
          id: nodeDrag.id,
          x: nodeDrag.currX,
          y: nodeDrag.currY,
          locationMap,
          containerMap,
          patchLocation,
          patchContainer,
        });
        setNodeDrag(null);
      }

      if (
        linkDrag &&
        (linkDrag.pointerId === undefined || ev.pointerId === linkDrag.pointerId)
      ) {
        const wpt = clientToWorldPoint(
          ev.clientX,
          ev.clientY,
          svgRef.current,
          viewportGroupRef.current,
          pan,
          zoom
        );
        const hitRadius =
          linkDrag.pointerType === "touch"
            ? PORT_TOUCH_HIT_RADIUS
            : PORT_HIT_RADIUS;
        const dropTarget = hitTestPortAt(
          wpt.x,
          wpt.y,
          linkDrag.sourceKind,
          linkDrag.sourceId,
          hitRadius
        );
        if (dropTarget) {
          initiateConnection({
            sourceKind: linkDrag.sourceKind,
            sourceId: linkDrag.sourceId,
            sourceSlot: linkDrag.sourceSlot,
            targetKind: dropTarget.kind,
            targetId: dropTarget.id,
            explicitTargetSlot: dropTarget.slot,
          });
        } else if (
          Math.hypot(linkDrag.currX - linkDrag.startX, linkDrag.currY - linkDrag.startY) >
          14
        ) {
          const srcLoc =
            linkDrag.sourceKind === "location"
              ? locationMap.get(linkDrag.sourceId)
              : undefined;
          const srcName =
            linkDrag.sourceKind === "location"
              ? srcLoc?.name ?? "Location"
              : containerMap.get(linkDrag.sourceId)?.name ?? "Container";
          const defaultDistanceMeters =
            linkDrag.sourceKind === "container"
              ? DEFAULT_EXTERIOR_DISTANCE_METERS
              : srcLoc?.container_id
              ? DEFAULT_INTERIOR_DISTANCE_METERS
              : DEFAULT_FALLBACK_DISTANCE_METERS;
          setEmptyCanvasModal({
            sourceKind: linkDrag.sourceKind,
            sourceId: linkDrag.sourceId,
            sourceName: srcName,
            sourceSlot: linkDrag.sourceSlot,
            dropX: Math.round(wpt.x),
            dropY: Math.round(wpt.y),
            canCreateContainer: canAddContainerHere,
            availableDepths: availableContainerDepthsHere,
            defaultDistanceMeters,
          });
        }
        setLinkDrag(null);
      }
    };

    const handleCancel = (ev?: PointerEvent) => {
      if (
        nodeDrag &&
        (!ev || nodeDrag.pointerId === undefined || ev.pointerId === nodeDrag.pointerId)
      ) {
        setNodeDrag(null);
      }
      if (
        linkDrag &&
        (!ev || linkDrag.pointerId === undefined || ev.pointerId === linkDrag.pointerId)
      ) {
        setLinkDrag(null);
      }
    };

    const handleBlur = () => handleCancel();

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleCancel);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleCancel);
      window.removeEventListener("blur", handleBlur);
    };
  }, [
    nodeDrag,
    linkDrag,
    pan,
    zoom,
    hitTestNodeAt,
    hitTestPortAt,
    currentContainerId,
    workingContainers,
    workingLocations,
    mode,
    propContainers,
    propLocations,
    executeImmediateContainerMove,
    onMoveGhostNode,
    setSelectedGhostLocId,
    locationMap,
    containerMap,
    patchLocation,
    patchContainer,
    initiateConnection,
    canAddContainerHere,
    availableContainerDepthsHere,
  ]);

  return { hitTestNodeAt, hitTestPortAt };
}
