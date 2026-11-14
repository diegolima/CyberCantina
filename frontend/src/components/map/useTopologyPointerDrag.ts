import React, { useCallback, useEffect } from "react";
import type {
  CompassDirection,
  LocationContainer,
  LocationNode,
} from "../../types";
import type { EmptyCanvasLinkState, GroupIntoContainerState } from "./MapDialogs";
import { isValidContainerDrop } from "./mapValidation";
import {
  COMPASS_ANGLES,
  COMPASS_ORDER,
  clientToWorldPoint,
  type LinkDragState,
  type NodeDragState,
  type ProjectedDepthTopology,
} from "./topologyProjection";

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
  patchLocation: (locId: string, patch: Partial<LocationNode>) => void;
  patchContainer: (contId: string, patch: Partial<LocationContainer>) => void;
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
    ): { kind: "location" | "container"; id: string } | null => {
      for (const sn of projectedTopology.visibleSupernodes) {
        if (
          excludeKey?.kind === "container" &&
          excludeKey.id === sn.container.id
        ) {
          continue;
        }
        const pt = fullMapCoords[sn.container.id];
        if (!pt) continue;
        if (Math.abs(wx - pt.x) <= 76 && Math.abs(wy - pt.y) <= 28) {
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
    },
    [projectedTopology, fullMapCoords]
  );

  // Hit-test compass port dots during link drag
  const hitTestPortAt = useCallback(
    (
      wx: number,
      wy: number,
      excludeKind: "location" | "container",
      excludeId: string
    ): { kind: "location" | "container"; id: string; slot?: CompassDirection } | null => {
      for (const loc of projectedTopology.visibleLocations) {
        if (excludeKind === "location" && loc.id === excludeId) continue;
        const pt = fullMapCoords[loc.id];
        if (!pt) continue;
        for (const slot of COMPASS_ORDER) {
          const a = COMPASS_ANGLES[slot];
          const px = pt.x + Math.cos(a) * 26;
          const py = pt.y + Math.sin(a) * 26;
          if (Math.hypot(wx - px, wy - py) <= 9) {
            return { kind: "location", id: loc.id, slot };
          }
        }
      }
      const bodyHit = hitTestNodeAt(wx, wy, { kind: excludeKind, id: excludeId });
      return bodyHit ? { kind: bodyHit.kind, id: bodyHit.id } : null;
    },
    [projectedTopology.visibleLocations, fullMapCoords, hitTestNodeAt]
  );

  // Global window pointer move / up listeners for nodeDrag & linkDrag
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

      if (nodeDrag) {
        const distPx = Math.hypot(
          ev.clientX - nodeDrag.startClientX,
          ev.clientY - nodeDrag.startClientY
        );
        const hasMoved = nodeDrag.hasMoved || distPx > 5;
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

      if (linkDrag) {
        const portHit = hitTestPortAt(
          wpt.x,
          wpt.y,
          linkDrag.sourceKind,
          linkDrag.sourceId
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
      if (nodeDrag) {
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

        // Dropped onto open canvas -> persist new coordinates
        if (nodeDrag.kind === "location") {
          patchLocation(nodeDrag.id, {
            ui_x: nodeDrag.currX,
            ui_y: nodeDrag.currY,
          });
        } else {
          patchContainer(nodeDrag.id, {
            ui_x: nodeDrag.currX,
            ui_y: nodeDrag.currY,
          });
        }
        setNodeDrag(null);
      }

      if (linkDrag) {
        const wpt = clientToWorldPoint(
          ev.clientX,
          ev.clientY,
          svgRef.current,
          viewportGroupRef.current,
          pan,
          zoom
        );
        const dropTarget = hitTestPortAt(
          wpt.x,
          wpt.y,
          linkDrag.sourceKind,
          linkDrag.sourceId
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
          const srcName =
            linkDrag.sourceKind === "location"
              ? locationMap.get(linkDrag.sourceId)?.name ?? "Location"
              : containerMap.get(linkDrag.sourceId)?.name ?? "Container";
          setEmptyCanvasModal({
            sourceKind: linkDrag.sourceKind,
            sourceId: linkDrag.sourceId,
            sourceName: srcName,
            sourceSlot: linkDrag.sourceSlot,
            dropX: Math.round(wpt.x),
            dropY: Math.round(wpt.y),
            canCreateContainer: canAddContainerHere,
            availableDepths: availableContainerDepthsHere,
          });
        }
        setLinkDrag(null);
      }
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
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
