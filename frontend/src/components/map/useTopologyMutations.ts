import React, { useCallback, useMemo } from "react";
import type {
  CompassDirection,
  LocationContainer,
  LocationEdge,
  LocationNode,
} from "../../types";
import type {
  EmptyCanvasLinkState,
  GroupIntoContainerState,
  PassageHubCollisionState,
  StandaloneContainerCreateState,
} from "./MapDialogs";
import { getDefaultMapIconKey } from "./mapIcons";
import type { PaletteItemKind } from "./MapPaletteBar";
import {
  containerHasVisitedDescendants,
  getDescendantContainerIds,
  isValidContainerDrop,
  validateVisitedAncestorContainment,
} from "./mapValidation";
import {
  OPPOSITE_COMPASS,
  compassFromVector,
  computePromotionCandidates,
  makeUniqueId,
  pickCompassSlot,
  type GraphSnapshot,
  type ProjectedDepthTopology,
  type PromotionPromptState,
} from "./topologyProjection";

export interface UseTopologyMutationsParams {
  worldId: string;
  mode: "editor" | "campaign";
  propContainers: LocationContainer[];
  propLocations: LocationNode[];
  workingContainers: LocationContainer[];
  workingLocations: LocationNode[];
  workingEdges: LocationEdge[];
  baselineContainerIds: Set<string>;
  currentContainerId: string | null;
  containerMap: Map<string, LocationContainer>;
  locationMap: Map<string, LocationNode>;
  occupiedSlotsByLocId: Map<string, Set<CompassDirection>>;
  projectedTopology: ProjectedDepthTopology;
  fullMapCoords: Record<string, { x: number; y: number }>;
  selectedLocId: string | null;
  selectedContainerId: string | null;
  isMutatingLocked: boolean;
  commitNextGraph: (next: GraphSnapshot, pushUndo?: boolean) => void;
  setSelectedContainerId: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedLocId: React.Dispatch<React.SetStateAction<string | null>>;
  setStatusNotice: React.Dispatch<React.SetStateAction<string | null>>;
  hubCollisionModal: PassageHubCollisionState | null;
  setHubCollisionModal: React.Dispatch<
    React.SetStateAction<PassageHubCollisionState | null>
  >;
  emptyCanvasModal: EmptyCanvasLinkState | null;
  setEmptyCanvasModal: React.Dispatch<
    React.SetStateAction<EmptyCanvasLinkState | null>
  >;
  groupModal: GroupIntoContainerState | null;
  setGroupModal: React.Dispatch<
    React.SetStateAction<GroupIntoContainerState | null>
  >;
  standaloneContainerModal: StandaloneContainerCreateState | null;
  setStandaloneContainerModal: React.Dispatch<
    React.SetStateAction<StandaloneContainerCreateState | null>
  >;
  setMultiEdgeModalEdges: React.Dispatch<
    React.SetStateAction<LocationEdge[] | null>
  >;
  setPromotionPrompt: React.Dispatch<
    React.SetStateAction<PromotionPromptState | null>
  >;
}

export function useTopologyMutations({
  worldId,
  mode,
  propContainers,
  propLocations,
  workingContainers,
  workingLocations,
  workingEdges,
  baselineContainerIds,
  currentContainerId,
  containerMap,
  locationMap,
  occupiedSlotsByLocId,
  projectedTopology,
  fullMapCoords,
  selectedLocId,
  selectedContainerId,
  isMutatingLocked,
  commitNextGraph,
  setSelectedContainerId,
  setSelectedLocId,
  setStatusNotice,
  hubCollisionModal,
  setHubCollisionModal,
  emptyCanvasModal,
  setEmptyCanvasModal,
  groupModal,
  setGroupModal,
  standaloneContainerModal,
  setStandaloneContainerModal,
  setMultiEdgeModalEdges,
  setPromotionPrompt,
}: UseTopologyMutationsParams) {
  const patchLocation = useCallback(
    (locId: string, patch: Partial<LocationNode>) => {
      const nextLocs = workingLocations.map((l) =>
        l.id === locId ? { ...l, ...patch } : l
      );
      commitNextGraph(
        {
          containers: workingContainers,
          locations: nextLocs,
          edges: workingEdges,
        },
        false
      );
    },
    [workingLocations, workingContainers, workingEdges, commitNextGraph]
  );

  const patchContainer = useCallback(
    (contId: string, patch: Partial<LocationContainer>) => {
      const nextConts = workingContainers.map((c) =>
        c.id === contId ? { ...c, ...patch } : c
      );
      commitNextGraph(
        {
          containers: nextConts,
          locations: workingLocations,
          edges: workingEdges,
        },
        false
      );
    },
    [workingContainers, workingLocations, workingEdges, commitNextGraph]
  );

  const resetCoordinates = useCallback(
    (kind: "location" | "container", id: string) => {
      if (kind === "location") {
        patchLocation(id, { ui_x: null, ui_y: null });
      } else {
        patchContainer(id, { ui_x: null, ui_y: null });
      }
    },
    [patchLocation, patchContainer]
  );

  const availableContainerDepthsHere = useMemo<Array<1 | 2 | 3 | 4>>(() => {
    if (!currentContainerId) return [1, 2, 3, 4];
    const curr = containerMap.get(currentContainerId);
    if (!curr) return [1, 2, 3, 4];
    return ([1, 2, 3, 4] as Array<1 | 2 | 3 | 4>).filter(
      (d) => d < curr.depth
    );
  }, [currentContainerId, containerMap]);

  const canAddContainerHere = availableContainerDepthsHere.length > 0;

  const commitStandaloneContainer = useCallback(
    (opts: {
      name: string;
      depth: 1 | 2 | 3 | 4;
      x: number;
      y: number;
      parentContainerId: string | null;
      createEntryLocation: boolean;
    }) => {
      const contId = makeUniqueId("new_cont");
      const newCont: LocationContainer = {
        id: contId,
        world_id: worldId,
        parent_container_id: opts.parentContainerId,
        depth: opts.depth,
        name: opts.name,
        description: "A newly added region or structure awaiting refinement.",
        environmental_tags: [],
        lore_nodes: [],
        ui_x: Math.round(opts.x),
        ui_y: Math.round(opts.y),
        icon: getDefaultMapIconKey("container", opts.depth),
      };

      const nextLocs = [...workingLocations];
      if (opts.createEntryLocation) {
        const portalId = makeUniqueId("new_loc");
        nextLocs.push({
          id: portalId,
          world_id: worldId,
          container_id: contId,
          is_entry_exit: true,
          name: `${newCont.name} Entrance`,
          summary: "Entryway into this area.",
          description:
            "The main threshold connecting this area to neighboring paths.",
          environmental_tags: ["entrance"],
          is_starting_location: false,
          is_hub: false,
          is_visited: false,
          icon: getDefaultMapIconKey("location"),
        });
      }

      commitNextGraph({
        containers: [...workingContainers, newCont],
        locations: nextLocs,
        edges: workingEdges,
      });
      setSelectedContainerId(contId);
      setSelectedLocId(null);
      setStatusNotice(
        opts.createEntryLocation
          ? `Added unlinked L${opts.depth} container "${newCont.name}" — connect a passage to save.`
          : `Added L${opts.depth} macro container "${newCont.name}" — drag locations or sub-containers into it.`
      );
    },
    [
      worldId,
      workingLocations,
      workingContainers,
      workingEdges,
      commitNextGraph,
      setSelectedContainerId,
      setSelectedLocId,
      setStatusNotice,
    ]
  );

  const createStandaloneAt = useCallback(
    (kind: PaletteItemKind, x: number, y: number) => {
      if (isMutatingLocked) return;
      if (kind === "container" && !canAddContainerHere) {
        setStatusNotice("Level 1 containers cannot hold nested containers.");
        return;
      }

      if (kind === "container") {
        if (availableContainerDepthsHere.length > 1) {
          setStandaloneContainerModal({
            x: Math.round(x),
            y: Math.round(y),
            parentContainerId: currentContainerId,
            availableDepths: availableContainerDepthsHere,
          });
          return;
        }
        const depth = availableContainerDepthsHere[0] ?? 1;
        const contCount = workingContainers.length + 1;
        commitStandaloneContainer({
          name: `New Container ${contCount}`,
          depth,
          x,
          y,
          parentContainerId: currentContainerId,
          createEntryLocation: true,
        });
        return;
      }

      const locId = makeUniqueId("new_loc");
      const isHub = kind === "hub";
      const idx = workingLocations.length + 1;
      const newLoc: LocationNode = {
        id: locId,
        world_id: worldId,
        container_id: currentContainerId,
        is_entry_exit: false,
        name: isHub ? `Junction ${idx}` : `New Location ${idx}`,
        summary: isHub ? "Connecting passage junction." : "Newly placed area.",
        description: isHub
          ? "A connecting thoroughfare branching toward adjoining locations."
          : "A newly charted area ready for sensory details.",
        environmental_tags: isHub ? ["corridor"] : [],
        is_starting_location: false,
        is_hub: isHub,
        is_visited: false,
        ui_x: Math.round(x),
        ui_y: Math.round(y),
        icon: getDefaultMapIconKey(isHub ? "hub" : "location"),
      };
      commitNextGraph({
        containers: workingContainers,
        locations: [...workingLocations, newLoc],
        edges: workingEdges,
      });
      setSelectedContainerId(null);
      setSelectedLocId(locId);
      setStatusNotice(
        `Added unlinked "${newLoc.name}" — drag a link port to connect it before saving.`
      );
    },
    [
      isMutatingLocked,
      canAddContainerHere,
      availableContainerDepthsHere,
      workingContainers,
      workingLocations,
      workingEdges,
      worldId,
      currentContainerId,
      commitStandaloneContainer,
      commitNextGraph,
      setStandaloneContainerModal,
    ]
  );

  const handleConfirmStandaloneContainerCreate = useCallback(
    (opts: {
      name: string;
      depth: 1 | 2 | 3 | 4;
      createEntryLocation: boolean;
    }) => {
      if (!standaloneContainerModal) return;
      commitStandaloneContainer({
        name: opts.name,
        depth: opts.depth,
        x: standaloneContainerModal.x,
        y: standaloneContainerModal.y,
        parentContainerId: standaloneContainerModal.parentContainerId,
        createEntryLocation: opts.createEntryLocation,
      });
      setStandaloneContainerModal(null);
    },
    [standaloneContainerModal, commitStandaloneContainer, setStandaloneContainerModal]
  );

  // Execute direct bidirectional edge creation (applying optional L1 portal promotions)
  const executeDirectEdgeCreation = useCallback(
    (
      fromLoc: LocationNode,
      toLoc: LocationNode,
      direction: CompassDirection,
      travelMinutes: number,
      bidirectional: boolean,
      promoteIds: Set<string>,
      overrideLocations?: LocationNode[],
      overrideContainers?: LocationContainer[]
    ) => {
      const baseLocs = overrideLocations ?? workingLocations;
      const baseConts = overrideContainers ?? workingContainers;
      const nextLocs =
        promoteIds.size > 0
          ? baseLocs.map((l) =>
              promoteIds.has(l.id) ? { ...l, is_entry_exit: true } : l
            )
          : baseLocs;

      const revSlot = OPPOSITE_COMPASS[direction];
      const newEdges: LocationEdge[] = [
        {
          id: makeUniqueId("edge_fwd"),
          world_id: worldId,
          from_location_id: fromLoc.id,
          to_location_id: toLoc.id,
          direction_label: `Passage to ${toLoc.name}`,
          compass_direction: direction,
          travel_minutes: travelMinutes,
          is_locked_or_hidden: false,
        },
      ];
      if (bidirectional) {
        newEdges.push({
          id: makeUniqueId("edge_rev"),
          world_id: worldId,
          from_location_id: toLoc.id,
          to_location_id: fromLoc.id,
          direction_label: `Return to ${fromLoc.name}`,
          compass_direction: revSlot,
          travel_minutes: travelMinutes,
          is_locked_or_hidden: false,
        });
      }

      commitNextGraph({
        containers: baseConts,
        locations: nextLocs,
        edges: [...workingEdges, ...newEdges],
      });
      setPromotionPrompt(null);
    },
    [workingLocations, workingContainers, workingEdges, worldId, commitNextGraph]
  );

  // Resolve connecting a source L0 location and target visible entity (L0 or Container supernode)
  const initiateConnection = useCallback(
    (opts: {
      sourceKind: "location" | "container";
      sourceId: string;
      sourceSlot: CompassDirection;
      targetKind: "location" | "container";
      targetId: string;
      explicitTargetSlot?: CompassDirection;
    }) => {
      const resolveLocFromNode = (
        kind: "location" | "container",
        id: string
      ): { loc: LocationNode | null; container: LocationContainer | null; candidates: LocationNode[] } => {
        if (kind === "location") {
          return {
            loc: locationMap.get(id) ?? null,
            container: null,
            candidates: [],
          };
        }
        const subIds = getDescendantContainerIds(id, workingContainers);
        const inside = workingLocations.filter(
          (l) => l.container_id != null && subIds.has(l.container_id)
        );
        const portal =
          inside.find((l) => projectedTopology.dynamicPortalIds.has(l.id)) ??
          inside[0] ??
          null;
        return {
          loc: portal,
          container: containerMap.get(id) ?? null,
          candidates: inside,
        };
      };

      const srcInfo = resolveLocFromNode(opts.sourceKind, opts.sourceId);
      const tgtInfo = resolveLocFromNode(opts.targetKind, opts.targetId);
      if (!srcInfo.loc || !tgtInfo.loc) {
        setStatusNotice(
          "Cannot connect to an empty container — add a location or sub-container inside it first."
        );
        return;
      }
      if (srcInfo.loc.id === tgtInfo.loc.id) return;

      // Avoid duplicate identical direct edges
      const alreadyConnected = workingEdges.some(
        (e) =>
          (e.from_location_id === srcInfo.loc!.id &&
            e.to_location_id === tgtInfo.loc!.id) ||
          (e.from_location_id === tgtInfo.loc!.id &&
            e.to_location_id === srcInfo.loc!.id)
      );
      if (alreadyConnected) {
        setStatusNotice("Those locations are already linked.");
        return;
      }

      const srcPt = fullMapCoords[opts.sourceId] ?? { x: 0, y: 0 };
      const tgtPt = fullMapCoords[opts.targetId] ?? { x: 100, y: 0 };
      const targetSlot =
        opts.explicitTargetSlot ?? OPPOSITE_COMPASS[opts.sourceSlot];

      // Check compass port collision on source or explicit target port
      const srcExistingEdge = workingEdges.find(
        (e) =>
          e.from_location_id === srcInfo.loc!.id &&
          e.compass_direction === opts.sourceSlot
      );
      const tgtExistingEdge = opts.explicitTargetSlot
        ? workingEdges.find(
            (e) =>
              e.from_location_id === tgtInfo.loc!.id &&
              e.compass_direction === opts.explicitTargetSlot
          )
        : undefined;

      if (srcExistingEdge || tgtExistingEdge) {
        const collidingSide =
          srcExistingEdge && tgtExistingEdge
            ? "both"
            : tgtExistingEdge
            ? "target"
            : "source";
        const occEdge = srcExistingEdge || tgtExistingEdge!;
        const occOther =
          locationMap.get(occEdge.to_location_id)?.name ?? "another location";
        const hubAnchor = collidingSide === "target" ? srcInfo.loc : tgtInfo.loc;
        setHubCollisionModal({
          sourceNodeId: srcInfo.loc.id,
          sourceName: srcInfo.loc.name,
          sourceSlot: opts.sourceSlot,
          targetNodeId: tgtInfo.loc.id,
          targetName: tgtInfo.loc.name,
          targetSlot,
          collidingSide,
          occupiedByName: occOther,
          suggestedHubName: `${
            collidingSide === "target" ? tgtInfo.loc.name : srcInfo.loc.name
          } — Junction`,
          travelMinutes: 2,
          x: Math.round((srcPt.x + tgtPt.x) / 2),
          y: Math.round((srcPt.y + tgtPt.y) / 2),
          // Unused variable guard: hubAnchor kept for clarity
          ...(hubAnchor ? {} : {}),
        });
        return;
      }

      // If cross-container or multi-location target container needs location pick / portal promotion
      const candidates = computePromotionCandidates(
        srcInfo.loc,
        tgtInfo.loc,
        containerMap,
        projectedTopology.dynamicPortalIds
      );
      if (
        (tgtInfo.container && tgtInfo.candidates.length > 1) ||
        candidates.length > 0
      ) {
        setPromotionPrompt({
          fromLocation: srcInfo.loc,
          toLocation: tgtInfo.loc,
          targetContainerForLocationPick:
            tgtInfo.container && tgtInfo.candidates.length > 1
              ? tgtInfo.container
              : null,
          targetLocationCandidates: tgtInfo.candidates,
          chosenTargetLocationId: tgtInfo.loc.id,
          direction: opts.sourceSlot,
          travelMinutes: 2,
          bidirectional: true,
          candidates,
        });
        return;
      }

      executeDirectEdgeCreation(
        srcInfo.loc,
        tgtInfo.loc,
        opts.sourceSlot,
        2,
        true,
        new Set()
      );
    },
    [
      locationMap,
      workingContainers,
      workingLocations,
      workingEdges,
      projectedTopology.dynamicPortalIds,
      containerMap,
      fullMapCoords,
      executeDirectEdgeCreation,
    ]
  );

  // Confirm Passage Hub insertion on colliding port
  const handleConfirmHubCollision = useCallback(
    (hubName: string, travelMinutes: number) => {
      if (!hubCollisionModal) return;
      const st = hubCollisionModal;
      const srcLoc = locationMap.get(st.sourceNodeId);
      const tgtLoc = locationMap.get(st.targetNodeId);
      if (!srcLoc || !tgtLoc) {
        setHubCollisionModal(null);
        return;
      }

      const hubAnchorContainerId =
        st.collidingSide === "target"
          ? tgtLoc.container_id ?? null
          : srcLoc.container_id ?? null;

      const hubId = makeUniqueId("new_hub");
      const hubNode: LocationNode = {
        id: hubId,
        world_id: worldId,
        container_id: hubAnchorContainerId,
        is_entry_exit: false,
        name: hubName,
        summary: "Connecting corridor junction.",
        description:
          "A multi-way transit junction linking adjoining locations and wings.",
        environmental_tags: ["corridor", "junction"],
        is_starting_location: false,
        is_hub: true,
        is_visited: false,
        ui_x: st.x,
        ui_y: st.y,
        icon: getDefaultMapIconKey("hub"),
      };

      // Find which existing edge(s) occupied the colliding slot
      const anchorNode = st.collidingSide === "target" ? tgtLoc : srcLoc;
      const anchorSlot =
        st.collidingSide === "target" ? st.targetSlot : st.sourceSlot;
      const peerNode = st.collidingSide === "target" ? srcLoc : tgtLoc;

      const existingFwd = workingEdges.find(
        (e) =>
          e.from_location_id === anchorNode.id &&
          e.compass_direction === anchorSlot
      );

      let nextEdges = [...workingEdges];
      const hubOccupied = new Set<CompassDirection>();
      const backToAnchorSlot = OPPOSITE_COMPASS[anchorSlot];
      hubOccupied.add(backToAnchorSlot);

      if (existingFwd) {
        const oldDestId = existingFwd.to_location_id;
        const oldDest = locationMap.get(oldDestId);
        // Remove old direct edge + reverse counterpart
        nextEdges = nextEdges.filter(
          (e) =>
            e.id !== existingFwd.id &&
            !(
              e.from_location_id === oldDestId &&
              e.to_location_id === anchorNode.id
            )
        );
        // Link Anchor <-> Hub on anchorSlot
        nextEdges.push(
          {
            id: makeUniqueId("edge_hub_in"),
            world_id: worldId,
            from_location_id: anchorNode.id,
            to_location_id: hubId,
            direction_label: `To ${hubName}`,
            compass_direction: anchorSlot,
            travel_minutes: 1,
            is_locked_or_hidden: false,
          },
          {
            id: makeUniqueId("edge_hub_out"),
            world_id: worldId,
            from_location_id: hubId,
            to_location_id: anchorNode.id,
            direction_label: `Return to ${anchorNode.name}`,
            compass_direction: backToAnchorSlot,
            travel_minutes: 1,
            is_locked_or_hidden: false,
          }
        );

        // Reconnect Hub <-> oldDest
        const slotToOldDest = pickCompassSlot(anchorSlot, hubOccupied);
        hubOccupied.add(slotToOldDest);
        const origRevSlot = OPPOSITE_COMPASS[slotToOldDest];
        nextEdges.push(
          {
            id: makeUniqueId("edge_old_fwd"),
            world_id: worldId,
            from_location_id: hubId,
            to_location_id: oldDestId,
            direction_label:
              existingFwd.direction_label || `To ${oldDest?.name ?? "Wing"}`,
            compass_direction: slotToOldDest,
            travel_minutes: existingFwd.travel_minutes,
            is_locked_or_hidden: existingFwd.is_locked_or_hidden,
          },
          {
            id: makeUniqueId("edge_old_rev"),
            world_id: worldId,
            from_location_id: oldDestId,
            to_location_id: hubId,
            direction_label: `Return to ${hubName}`,
            compass_direction: origRevSlot,
            travel_minutes: existingFwd.travel_minutes,
            is_locked_or_hidden: existingFwd.is_locked_or_hidden,
          }
        );
      } else {
        nextEdges.push(
          {
            id: makeUniqueId("edge_ah"),
            world_id: worldId,
            from_location_id: anchorNode.id,
            to_location_id: hubId,
            direction_label: `To ${hubName}`,
            compass_direction: anchorSlot,
            travel_minutes: 1,
            is_locked_or_hidden: false,
          },
          {
            id: makeUniqueId("edge_ha"),
            world_id: worldId,
            from_location_id: hubId,
            to_location_id: anchorNode.id,
            direction_label: `Return to ${anchorNode.name}`,
            compass_direction: backToAnchorSlot,
            travel_minutes: 1,
            is_locked_or_hidden: false,
          }
        );
      }

      // Connect Hub <-> Peer
      const pPeer = fullMapCoords[peerNode.id] ?? { x: 0, y: 0 };
      const rawPeerDir = compassFromVector(pPeer.x - st.x, pPeer.y - st.y);
      const slotToPeer = pickCompassSlot(rawPeerDir, hubOccupied);
      hubOccupied.add(slotToPeer);
      const peerUsed = occupiedSlotsByLocId.get(peerNode.id) ?? new Set();
      const slotFromPeer = pickCompassSlot(OPPOSITE_COMPASS[slotToPeer], peerUsed);
      nextEdges.push(
        {
          id: makeUniqueId("edge_peer_fwd"),
          world_id: worldId,
          from_location_id: hubId,
          to_location_id: peerNode.id,
          direction_label: `To ${peerNode.name}`,
          compass_direction: slotToPeer,
          travel_minutes: travelMinutes,
          is_locked_or_hidden: false,
        },
        {
          id: makeUniqueId("edge_peer_rev"),
          world_id: worldId,
          from_location_id: peerNode.id,
          to_location_id: hubId,
          direction_label: `To ${hubName}`,
          compass_direction: slotFromPeer,
          travel_minutes: travelMinutes,
          is_locked_or_hidden: false,
        }
      );

      commitNextGraph({
        containers: workingContainers,
        locations: [...workingLocations, hubNode],
        edges: nextEdges,
      });
      setHubCollisionModal(null);
      setSelectedContainerId(null);
      setSelectedLocId(hubId);
      setStatusNotice(`Created Passage Hub "${hubName}" branching both paths.`);
    },
    [
      hubCollisionModal,
      locationMap,
      worldId,
      workingEdges,
      workingContainers,
      workingLocations,
      fullMapCoords,
      occupiedSlotsByLocId,
      commitNextGraph,
    ]
  );

  // Confirm creating a brand-new element connected from empty-canvas drop
  const handleConfirmEmptyCanvasCreate = useCallback(
    (opts: {
      kind: "location" | "hub" | "container";
      name: string;
      travelMinutes: number;
      containerDepth?: 1 | 2 | 3 | 4;
    }) => {
      if (!emptyCanvasModal) return;
      const st = emptyCanvasModal;

      let sourceLoc: LocationNode | undefined;
      if (st.sourceKind === "location") {
        sourceLoc = locationMap.get(st.sourceId);
      } else {
        const subIds = getDescendantContainerIds(st.sourceId, workingContainers);
        const inside = workingLocations.filter(
          (l) => l.container_id != null && subIds.has(l.container_id)
        );
        sourceLoc =
          inside.find((l) => projectedTopology.dynamicPortalIds.has(l.id)) ??
          inside[0];
      }
      if (!sourceLoc) {
        setEmptyCanvasModal(null);
        return;
      }

      if (opts.kind === "container") {
        const contId = makeUniqueId("new_cont");
        const portalId = makeUniqueId("new_loc");
        const depth = opts.containerDepth ?? 1;
        const newCont: LocationContainer = {
          id: contId,
          world_id: worldId,
          parent_container_id: currentContainerId,
          depth,
          name: opts.name,
          description: "A newly added structure.",
          environmental_tags: [],
          lore_nodes: [],
          ui_x: Math.round(st.dropX),
          ui_y: Math.round(st.dropY),
          icon: getDefaultMapIconKey("container", depth),
        };
        const portalLoc: LocationNode = {
          id: portalId,
          world_id: worldId,
          container_id: contId,
          is_entry_exit: true,
          name: `${opts.name} Entrance`,
          summary: `Entrance into ${opts.name}.`,
          description: `The gateway leading into ${opts.name}.`,
          environmental_tags: ["entrance"],
          is_starting_location: false,
          is_hub: false,
          is_visited: false,
          icon: getDefaultMapIconKey("location"),
        };
        const updatedSource =
          sourceLoc.container_id && !sourceLoc.is_entry_exit
            ? { ...sourceLoc, is_entry_exit: true }
            : sourceLoc;
        const nextLocs = workingLocations
          .map((l) => (l.id === sourceLoc!.id ? updatedSource : l))
          .concat(portalLoc);

        executeDirectEdgeCreation(
          updatedSource,
          portalLoc,
          st.sourceSlot,
          opts.travelMinutes,
          true,
          new Set(),
          nextLocs,
          [...workingContainers, newCont]
        );
        setSelectedContainerId(contId);
        setSelectedLocId(null);
        setEmptyCanvasModal(null);
        return;
      }

      const isHub = opts.kind === "hub";
      const newLocId = makeUniqueId(isHub ? "new_hub" : "new_loc");
      const newLoc: LocationNode = {
        id: newLocId,
        world_id: worldId,
        container_id: currentContainerId,
        is_entry_exit: false,
        name: opts.name,
        summary: isHub ? "Passage junction." : opts.name,
        description: isHub
          ? "A connecting corridor junction linking adjoining locations."
          : "A newly connected location awaiting description.",
        environmental_tags: isHub ? ["corridor"] : [],
        is_starting_location: false,
        is_hub: isHub,
        is_visited: false,
        ui_x: Math.round(st.dropX),
        ui_y: Math.round(st.dropY),
        icon: getDefaultMapIconKey(isHub ? "hub" : "location"),
      };

      executeDirectEdgeCreation(
        sourceLoc,
        newLoc,
        st.sourceSlot,
        opts.travelMinutes,
        true,
        new Set(),
        [...workingLocations, newLoc],
        workingContainers
      );
      setSelectedContainerId(null);
      setSelectedLocId(newLocId);
      setEmptyCanvasModal(null);
    },
    [
      emptyCanvasModal,
      locationMap,
      workingContainers,
      workingLocations,
      projectedTopology.dynamicPortalIds,
      worldId,
      currentContainerId,
      executeDirectEdgeCreation,
    ]
  );

  // Confirm grouping L0 onto L0 into a new Level 1 container
  const handleConfirmGroupIntoContainer = useCallback(
    (containerName: string) => {
      if (!groupModal) return;
      const { draggedLoc, targetLoc, parentContainerId } = groupModal;
      const contId = makeUniqueId("new_cont");
      const targetPt = fullMapCoords[targetLoc.id] ?? { x: 0, y: 0 };
      const newCont: LocationContainer = {
        id: contId,
        world_id: worldId,
        parent_container_id: parentContainerId,
        depth: 1,
        name: containerName,
        description: `${targetLoc.name} and ${draggedLoc.name}.`,
        environmental_tags: [...(targetLoc.environmental_tags ?? [])],
        lore_nodes: [],
        ui_x: Math.round(targetPt.x),
        ui_y: Math.round(targetPt.y),
        icon: getDefaultMapIconKey("container", 1),
      };

      const nextLocs = workingLocations.map((l) => {
        if (l.id === draggedLoc.id || l.id === targetLoc.id) {
          return { ...l, container_id: contId, ui_x: null, ui_y: null };
        }
        return l;
      });
      commitNextGraph({
        containers: [...workingContainers, newCont],
        locations: nextLocs,
        edges: workingEdges,
      });
      setGroupModal(null);
      setSelectedLocId(null);
      setSelectedContainerId(contId);
      setStatusNotice(`Grouped "${draggedLoc.name}" & "${targetLoc.name}" inside "${containerName}".`);
    },
    [
      groupModal,
      fullMapCoords,
      worldId,
      workingLocations,
      workingContainers,
      workingEdges,
      commitNextGraph,
    ]
  );

  // Move element immediately onto existing container
  const executeImmediateContainerMove = useCallback(
    (
      draggedKind: "location" | "container",
      draggedId: string,
      targetContainerId: string | null
    ) => {
      if (draggedKind === "location") {
        const nextLocs = workingLocations.map((l) =>
          l.id === draggedId
            ? {
                ...l,
                container_id: targetContainerId,
                is_entry_exit: targetContainerId ? l.is_entry_exit : false,
                ui_x: null,
                ui_y: null,
              }
            : l
        );
        commitNextGraph({
          containers: workingContainers,
          locations: nextLocs,
          edges: workingEdges,
        });
      } else {
        const nextConts = workingContainers.map((c) =>
          c.id === draggedId
            ? { ...c, parent_container_id: targetContainerId, ui_x: null, ui_y: null }
            : c
        );
        commitNextGraph({
          containers: nextConts,
          locations: workingLocations,
          edges: workingEdges,
        });
      }
      const targetName = targetContainerId
        ? containerMap.get(targetContainerId)?.name ?? "container"
        : "World Root";
      setStatusNotice(`Moved into "${targetName}" (click Undo to revert).`);
    },
    [
      workingLocations,
      workingContainers,
      workingEdges,
      containerMap,
      commitNextGraph,
    ]
  );

  // Permission helpers for Context Menu & Drag validation
  const canDeleteLocation = useCallback(
    (locId: string): { allowed: boolean; reason?: string } => {
      if (workingLocations.length <= 1) {
        return { allowed: false, reason: "Map must keep at least one location." };
      }
      const loc = locationMap.get(locId);
      if (!loc) return { allowed: false };
      if (loc.is_starting_location) {
        return {
          allowed: false,
          reason: "Reassign Starting Location before deleting this location.",
        };
      }
      if (mode === "campaign" && loc.is_visited) {
        return {
          allowed: false,
          reason: "Visited campaign locations cannot be removed.",
        };
      }
      return { allowed: true };
    },
    [workingLocations.length, locationMap, mode]
  );

  const canDeleteContainer = useCallback(
    (contId: string): { allowed: boolean; reason?: string } => {
      if (mode === "campaign") {
        if (baselineContainerIds.has(contId)) {
          return {
            allowed: false,
            reason:
              "Saved containers cannot be removed mid-campaign; rewind to a turn before it existed.",
          };
        }
        if (
          containerHasVisitedDescendants(
            contId,
            workingContainers,
            workingLocations
          )
        ) {
          return {
            allowed: false,
            reason: "Containers holding visited locations cannot be removed.",
          };
        }
      }
      return { allowed: true };
    },
    [mode, baselineContainerIds, workingContainers, workingLocations]
  );

  const canConvertLocation = useCallback(
    (locId: string): { allowed: boolean; reason?: string } => {
      const loc = locationMap.get(locId);
      if (!loc) return { allowed: false };
      const parentCont = loc.container_id
        ? containerMap.get(loc.container_id)
        : undefined;
      if (parentCont && parentCont.depth <= 1) {
        return {
          allowed: false,
          reason: "Locations inside a Level 1 container are already at the deepest container tier.",
        };
      }
      return { allowed: true };
    },
    [locationMap, containerMap]
  );

  const canMoveOutToParent = useCallback(
    (
      kind: "location" | "container",
      id: string
    ): { allowed: boolean; parentLabel: string; reason?: string } => {
      const parentContId =
        kind === "location"
          ? locationMap.get(id)?.container_id
          : containerMap.get(id)?.parent_container_id;
      const grandParentId = parentContId
        ? containerMap.get(parentContId)?.parent_container_id ?? null
        : null;
      const parentLabel = grandParentId
        ? containerMap.get(grandParentId)?.name ?? "Parent Container"
        : "World Root";

      const check = isValidContainerDrop({
        draggedKind: kind,
        draggedId: id,
        targetKind: grandParentId ? "container" : "root",
        targetId: grandParentId ?? undefined,
        currentContainerId: grandParentId,
        containers: workingContainers,
        locations: workingLocations,
        campaignMode: mode === "campaign",
        originalContainers: propContainers,
        originalLocations: propLocations,
      });
      return { allowed: check.valid, parentLabel, reason: check.reason };
    },
    [
      locationMap,
      containerMap,
      workingContainers,
      workingLocations,
      mode,
      propContainers,
      propLocations,
    ]
  );

  // Context menu action handlers
  const handleDeleteLocation = useCallback(
    (locId: string) => {
      const check = canDeleteLocation(locId);
      if (!check.allowed) {
        setStatusNotice(check.reason || "Cannot delete this location.");
        return;
      }
      const nextLocs = workingLocations.filter((l) => l.id !== locId);
      const nextEdges = workingEdges.filter(
        (e) => e.from_location_id !== locId && e.to_location_id !== locId
      );
      if (selectedLocId === locId) setSelectedLocId(null);
      commitNextGraph({
        containers: workingContainers,
        locations: nextLocs,
        edges: nextEdges,
      });
    },
    [
      canDeleteLocation,
      workingLocations,
      workingEdges,
      workingContainers,
      selectedLocId,
      commitNextGraph,
    ]
  );

  const handleDeleteContainer = useCallback(
    (contId: string) => {
      const check = canDeleteContainer(contId);
      if (!check.allowed) {
        setStatusNotice(check.reason || "Cannot remove this container.");
        return;
      }
      const target = containerMap.get(contId);
      const nextParent = target?.parent_container_id ?? null;
      const nextConts = workingContainers
        .filter((c) => c.id !== contId)
        .map((c) =>
          c.parent_container_id === contId
            ? { ...c, parent_container_id: nextParent, ui_x: null, ui_y: null }
            : c
        );
      const nextLocs = workingLocations.map((l) =>
        l.container_id === contId
          ? {
              ...l,
              container_id: nextParent,
              is_entry_exit: nextParent ? l.is_entry_exit : false,
              ui_x: null,
              ui_y: null,
            }
          : l
      );
      if (selectedContainerId === contId) setSelectedContainerId(null);
      commitNextGraph({
        containers: nextConts,
        locations: nextLocs,
        edges: workingEdges,
      });
    },
    [
      canDeleteContainer,
      containerMap,
      workingContainers,
      workingLocations,
      workingEdges,
      selectedContainerId,
      commitNextGraph,
    ]
  );

  const handleConvertLocationToContainer = useCallback(
    (locId: string) => {
      const loc = locationMap.get(locId);
      if (!loc) return;
      const check = canConvertLocation(locId);
      if (!check.allowed) {
        setStatusNotice(check.reason || "Cannot convert location.");
        return;
      }
      const keepVisitedImmutable = mode === "campaign" && Boolean(loc.is_visited);
      const contId = makeUniqueId("new_cont");
      const newCont: LocationContainer = {
        id: contId,
        world_id: worldId,
        parent_container_id: loc.container_id ?? null,
        depth: 1,
        name: loc.name,
        description: loc.description || loc.summary || "",
        environmental_tags: [...(loc.environmental_tags ?? [])],
        lore_nodes: keepVisitedImmutable
          ? []
          : (loc.lore_nodes ?? []).map((ln) => ({
              ...ln,
              location_id: null,
              container_id: contId,
            })),
        ui_x: loc.ui_x ?? null,
        ui_y: loc.ui_y ?? null,
        icon: getDefaultMapIconKey("container", 1),
      };
      const nextLocs = workingLocations.map((l) =>
        l.id === locId
          ? {
              ...l,
              container_id: contId,
              is_entry_exit: true,
              name: keepVisitedImmutable ? l.name : `${loc.name} Entrance`,
              lore_nodes: keepVisitedImmutable ? l.lore_nodes : [],
              ui_x: null,
              ui_y: null,
            }
          : l
      );
      // Verify visited containment monotonicity in campaign mode
      if (mode === "campaign" && loc.is_visited) {
        const checkCont = validateVisitedAncestorContainment(
          propLocations.find((p) => p.id === locId)?.container_id,
          propContainers,
          contId,
          [...workingContainers, newCont]
        );
        if (!checkCont.valid) {
          setStatusNotice(checkCont.reason || "Invalid containment change.");
          return;
        }
      }
      commitNextGraph({
        containers: [...workingContainers, newCont],
        locations: nextLocs,
        edges: workingEdges,
      });
      setSelectedLocId(null);
      setSelectedContainerId(contId);
    },
    [
      locationMap,
      canConvertLocation,
      worldId,
      workingLocations,
      mode,
      propLocations,
      propContainers,
      workingContainers,
      workingEdges,
      commitNextGraph,
    ]
  );

  const handleSetStartingLocation = useCallback(
    (locId: string) => {
      if (mode === "campaign") return;
      const nextLocs = workingLocations.map((l) => ({
        ...l,
        is_starting_location: l.id === locId,
      }));
      commitNextGraph({
        containers: workingContainers,
        locations: nextLocs,
        edges: workingEdges,
      });
    },
    [mode, workingLocations, workingContainers, workingEdges, commitNextGraph]
  );

  const handleUpdateEdgeDistance = useCallback(
    (edgeId: string, minutes: number) => {
      const target = workingEdges.find((e) => e.id === edgeId);
      if (!target) return;
      const clamped = Math.max(1, Math.min(240, Math.round(minutes) || 1));
      const nextEdges = workingEdges.map((e) => {
        if (
          e.id === edgeId ||
          (e.from_location_id === target.to_location_id &&
            e.to_location_id === target.from_location_id)
        ) {
          return { ...e, travel_minutes: clamped };
        }
        return e;
      });
      commitNextGraph({
        containers: workingContainers,
        locations: workingLocations,
        edges: nextEdges,
      });
    },
    [workingEdges, workingContainers, workingLocations, commitNextGraph]
  );

  const handleToggleEdgeLocked = useCallback(
    (edgeId: string) => {
      const target = workingEdges.find((e) => e.id === edgeId);
      if (!target) return;
      const nextVal = !target.is_locked_or_hidden;
      const nextEdges = workingEdges.map((e) => {
        if (
          e.id === edgeId ||
          (e.from_location_id === target.to_location_id &&
            e.to_location_id === target.from_location_id)
        ) {
          return { ...e, is_locked_or_hidden: nextVal };
        }
        return e;
      });
      commitNextGraph({
        containers: workingContainers,
        locations: workingLocations,
        edges: nextEdges,
      });
    },
    [workingEdges, workingContainers, workingLocations, commitNextGraph]
  );

  const handleDeleteEdge = useCallback(
    (edgeId: string) => {
      const target = workingEdges.find((e) => e.id === edgeId);
      if (!target) return;
      const nextEdges = workingEdges.filter(
        (e) =>
          e.id !== edgeId &&
          !(
            e.from_location_id === target.to_location_id &&
            e.to_location_id === target.from_location_id
          )
      );
      commitNextGraph({
        containers: workingContainers,
        locations: workingLocations,
        edges: nextEdges,
      });
      setMultiEdgeModalEdges((prev) =>
        prev
          ? prev.filter(
              (e) =>
                e.id !== edgeId &&
                !(
                  e.from_location_id === target.to_location_id &&
                  e.to_location_id === target.from_location_id
                )
            )
          : null
      );
    },
    [workingEdges, workingContainers, workingLocations, commitNextGraph]
  );

  return {
    patchLocation,
    patchContainer,
    resetCoordinates,
    availableContainerDepthsHere,
    canAddContainerHere,
    createStandaloneAt,
    handleConfirmStandaloneContainerCreate,
    executeDirectEdgeCreation,
    initiateConnection,
    handleConfirmHubCollision,
    handleConfirmEmptyCanvasCreate,
    handleConfirmGroupIntoContainer,
    executeImmediateContainerMove,
    canDeleteLocation,
    canDeleteContainer,
    canConvertLocation,
    canMoveOutToParent,
    handleDeleteLocation,
    handleDeleteContainer,
    handleConvertLocationToContainer,
    handleSetStartingLocation,
    handleUpdateEdgeDistance,
    handleToggleEdgeLocked,
    handleDeleteEdge,
  };
}
