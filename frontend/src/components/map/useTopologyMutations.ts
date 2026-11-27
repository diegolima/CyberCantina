import React, { useCallback, useMemo } from "react";
import type {
  CompassDirection,
  EdgeDistanceMode,
  LocationContainer,
  LocationEdge,
  LocationNode,
} from "../../types";
import {
  computeReconciliationPlan,
  isValidSpatialAnchor,
  type ReconciliationAdjustment,
} from "./spatialConsistency";
import type {
  EmptyCanvasLinkState,
  GroupIntoContainerState,
  PassageHubCollisionState,
  StandaloneContainerCreateState,
} from "./MapDialogs";
import { getDefaultMapIconKey, inferMapIconKey } from "./mapIcons";
import type { PaletteItemKind } from "./MapPaletteBar";
import {
  containerHasVisitedDescendants,
  getDescendantContainerIds,
  isValidContainerDrop,
  validateVisitedAncestorContainment,
} from "./mapValidation";
import {
  MAX_EDGE_OBSTACLES,
  MAX_EDGE_OBSTACLE_LENGTH,
  MAX_EDGE_TRAVEL_MODE_LENGTH,
  clampEdgeSpeedModifier,
} from "../../utils/spatialDistance";
import {
  DEFAULT_EXTERIOR_DISTANCE_METERS,
  DEFAULT_FALLBACK_DISTANCE_METERS,
  DEFAULT_INTERIOR_DISTANCE_METERS,
  OPPOSITE_COMPASS,
  clampEdgeDistanceMeters,
  compassFromVector,
  computePromotionCandidates,
  filterEdgesAfterDeletion,
  makeUniqueId,
  pickCompassSlot,
  resolveAutoTargetSlot,
  syncEdgeLabelsForLocationRename,
  type GraphSnapshot,
  type ProjectedDepthTopology,
  type PromotionPromptState,
} from "./topologyProjection";

export interface EdgePairPatch {
  distance_meters?: number;
  speed_modifier?: number;
  travel_mode?: string | null;
  obstacles?: string[];
  is_blocked?: boolean;
  is_secret?: boolean;
  distance_mode?: EdgeDistanceMode;
  is_vertical?: boolean;
  direction_label?: string;
  reciprocal_direction_label?: string;
  compass_direction?: CompassDirection;
  reciprocal_compass_direction?: CompassDirection;
}

/** Clear invalid or dangling `anchor_location_id` references after deletes or container moves. */
export function sanitizeSnapshotAnchors(
  containers: readonly LocationContainer[],
  locations: readonly LocationNode[]
): LocationNode[] {
  let changed = false;
  const next = locations.map((loc) => {
    if (!loc.anchor_location_id) return loc;
    const check = isValidSpatialAnchor(
      loc,
      loc.anchor_location_id,
      containers,
      locations
    );
    if (!check.valid) {
      changed = true;
      return { ...loc, anchor_location_id: null };
    }
    return loc;
  });
  return changed ? next : (locations as LocationNode[]);
}

/** Apply proposed flexible distance adjustments across primary and reciprocal edges. */
export function applyAdjustmentsToEdges(
  edges: readonly LocationEdge[],
  adjustments: readonly ReconciliationAdjustment[]
): { edges: LocationEdge[]; adjustedPairs: number } {
  if (adjustments.length === 0) {
    return { edges: edges as LocationEdge[], adjustedPairs: 0 };
  }
  const targetMetersByEdgeId = new Map<string, number>();
  for (const adj of adjustments) {
    targetMetersByEdgeId.set(adj.edgeId, adj.proposedMeters);
    if (adj.reciprocalEdgeId) {
      targetMetersByEdgeId.set(adj.reciprocalEdgeId, adj.proposedMeters);
    }
  }
  let anyChanged = false;
  const nextEdges = edges.map((e) => {
    const nextMeters = targetMetersByEdgeId.get(e.id);
    if (nextMeters !== undefined && nextMeters !== e.distance_meters) {
      anyChanged = true;
      return { ...e, distance_meters: nextMeters };
    }
    return e;
  });
  return {
    edges: anyChanged ? nextEdges : (edges as LocationEdge[]),
    adjustedPairs: anyChanged ? adjustments.length : 0,
  };
}

/**
 * Pure helper to move a single directed edge's outgoing compass port to an empty slot
 * on its source location without touching the reciprocal edge.
 */
export function reassignEdgeCompassSlot(
  edges: LocationEdge[],
  edgeId: string,
  nextSlot: CompassDirection
): {
  edges: LocationEdge[];
  changed: boolean;
  reason?: string;
} {
  const target = edges.find((e) => e.id === edgeId);
  if (!target) {
    return { edges, changed: false, reason: "Link no longer exists." };
  }
  if (target.compass_direction === nextSlot) {
    return { edges, changed: false };
  }
  const conflict = edges.find(
    (e) =>
      e.id !== edgeId &&
      e.from_location_id === target.from_location_id &&
      e.compass_direction === nextSlot
  );
  if (conflict) {
    return {
      edges,
      changed: false,
      reason: `Port ${nextSlot} is already occupied — choose an empty port.`,
    };
  }
  return {
    changed: true,
    edges: edges.map((e) =>
      e.id === edgeId ? { ...e, compass_direction: nextSlot } : e
    ),
  };
}

function normalizeObstacleList(raw: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const cleaned = entry
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_EDGE_OBSTACLE_LENGTH);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= MAX_EDGE_OBSTACLES) break;
  }
  return out;
}

function normalizeTravelModeInput(raw: string | null): string | null {
  if (raw === null) return null;
  const cleaned = raw.replace(/\s+/g, " ").trim().slice(0, MAX_EDGE_TRAVEL_MODE_LENGTH);
  return cleaned || null;
}

/** Resolve a node or container supernode to its active gateway location and candidate members. */
export function resolveNodeConnectionEndpoint(params: {
  kind: "location" | "container";
  id: string;
  locationMap: Map<string, LocationNode>;
  containerMap: Map<string, LocationContainer>;
  workingContainers: LocationContainer[];
  workingLocations: LocationNode[];
  dynamicPortalIds: Set<string>;
}): {
  loc: LocationNode | null;
  container: LocationContainer | null;
  candidates: LocationNode[];
} {
  const {
    kind,
    id,
    locationMap,
    containerMap,
    workingContainers,
    workingLocations,
    dynamicPortalIds,
  } = params;
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
    inside.find((l) => dynamicPortalIds.has(l.id)) ?? inside[0] ?? null;
  return {
    loc: portal,
    container: containerMap.get(id) ?? null,
    candidates: inside,
  };
}

/** Build the forward/reverse LocationEdge pair respecting an explicit or auto-resolved target slot. */
export function buildBidirectionalEdgePair(params: {
  worldId: string;
  fromLoc: LocationNode;
  toLoc: LocationNode;
  direction: CompassDirection;
  targetDirection?: CompassDirection;
  distanceMeters: number;
  bidirectional: boolean;
}): LocationEdge[] {
  const {
    worldId,
    fromLoc,
    toLoc,
    direction,
    targetDirection,
    distanceMeters,
    bidirectional,
  } = params;
  const revSlot = targetDirection ?? OPPOSITE_COMPASS[direction];
  const edges: LocationEdge[] = [
    {
      id: makeUniqueId("edge_fwd"),
      world_id: worldId,
      from_location_id: fromLoc.id,
      to_location_id: toLoc.id,
      direction_label: `Passage to ${toLoc.name}`,
      compass_direction: direction,
      distance_meters: distanceMeters,
      speed_modifier: 1,
      travel_mode: null,
      obstacles: [],
      is_blocked: false,
      is_secret: false,
    },
  ];
  if (bidirectional) {
    edges.push({
      id: makeUniqueId("edge_rev"),
      world_id: worldId,
      from_location_id: toLoc.id,
      to_location_id: fromLoc.id,
      direction_label: `Return to ${fromLoc.name}`,
      compass_direction: revSlot,
      distance_meters: distanceMeters,
      speed_modifier: 1,
      travel_mode: null,
      obstacles: [],
      is_blocked: false,
      is_secret: false,
    });
  }
  return edges;
}

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
  onEdgesRemoved?: (removedIds: Set<string>) => void;
  setPromotionPrompt: React.Dispatch<
    React.SetStateAction<PromotionPromptState | null>
  >;
  autoSyncConsistency?: boolean;
  unlockLore?: boolean;
  revealedEdgeIds?: readonly string[];
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
  onEdgesRemoved,
  setPromotionPrompt,
  autoSyncConsistency = false,
  unlockLore = false,
  revealedEdgeIds = [],
}: UseTopologyMutationsParams) {
  const commitGraphWithConsistencyAutoSync = useCallback(
    (
      next: GraphSnapshot,
      pushUndo = true,
      changedEdgeIds: readonly string[] = []
    ) => {
      const cleanedLocs = sanitizeSnapshotAnchors(next.containers, next.locations);
      const sanitized: GraphSnapshot =
        cleanedLocs === next.locations ? next : { ...next, locations: cleanedLocs };

      if (!autoSyncConsistency) {
        commitNextGraph(sanitized, pushUndo);
        return 0;
      }
      const plan = computeReconciliationPlan({
        scopeContainerId: currentContainerId,
        containers: sanitized.containers,
        locations: sanitized.locations,
        edges: sanitized.edges,
        options: {
          mode,
          unlockLore,
          revealedEdgeIds,
          changedEdgeIds,
        },
      });
      if (plan.length === 0) {
        commitNextGraph(sanitized, pushUndo);
        return 0;
      }
      const { edges: syncedEdges, adjustedPairs } = applyAdjustmentsToEdges(
        sanitized.edges,
        plan
      );
      commitNextGraph(
        adjustedPairs > 0 ? { ...sanitized, edges: syncedEdges } : sanitized,
        pushUndo
      );
      if (adjustedPairs > 0) {
        setStatusNotice(
          `Auto-synced ${adjustedPairs} unlocked link${adjustedPairs === 1 ? "" : "s"} — Undo to revert.`
        );
      }
      return adjustedPairs;
    },
    [
      autoSyncConsistency,
      commitNextGraph,
      currentContainerId,
      mode,
      unlockLore,
      revealedEdgeIds,
      setStatusNotice,
    ]
  );

  const patchLocation = useCallback(
    (locId: string, patch: Partial<LocationNode>, pushUndo = false) => {
      const oldLoc = locationMap.get(locId);
      const nextLocs = workingLocations.map((l) =>
        l.id === locId ? { ...l, ...patch } : l
      );
      const nextEdges =
        oldLoc && patch.name !== undefined && patch.name.trim() !== ""
          ? syncEdgeLabelsForLocationRename(
              workingEdges,
              locId,
              oldLoc.name,
              patch.name
            )
          : workingEdges;
      const anchorChanged = Object.prototype.hasOwnProperty.call(
        patch,
        "anchor_location_id"
      );
      if (anchorChanged) {
        commitGraphWithConsistencyAutoSync(
          {
            containers: workingContainers,
            locations: nextLocs,
            edges: nextEdges,
          },
          true
        );
        return;
      }
      commitNextGraph(
        {
          containers: workingContainers,
          locations: nextLocs,
          edges: nextEdges,
        },
        pushUndo
      );
    },
    [
      locationMap,
      workingLocations,
      workingContainers,
      workingEdges,
      commitNextGraph,
      commitGraphWithConsistencyAutoSync,
    ]
  );

  const patchContainer = useCallback(
    (contId: string, patch: Partial<LocationContainer>, pushUndo = false) => {
      const nextConts = workingContainers.map((c) =>
        c.id === contId ? { ...c, ...patch } : c
      );
      commitNextGraph(
        {
          containers: nextConts,
          locations: workingLocations,
          edges: workingEdges,
        },
        pushUndo
      );
    },
    [workingContainers, workingLocations, workingEdges, commitNextGraph]
  );

  const resetCoordinates = useCallback(
    (kind: "location" | "container", id: string) => {
      if (kind === "location") {
        const prev = locationMap.get(id);
        if (prev && prev.ui_x == null && prev.ui_y == null) return;
        patchLocation(id, { ui_x: null, ui_y: null }, true);
      } else {
        const prev = containerMap.get(id);
        if (prev && prev.ui_x == null && prev.ui_y == null) return;
        patchContainer(id, { ui_x: null, ui_y: null }, true);
      }
    },
    [locationMap, containerMap, patchLocation, patchContainer]
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
        icon: inferMapIconKey({
          kind: "container",
          depth: opts.depth,
          name: opts.name,
        }),
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
          props: [],
          icon: inferMapIconKey({
            kind: "location",
            name: `${newCont.name} Entrance`,
            tags: ["entrance"],
          }),
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
        props: [],
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
      distanceMeters: number,
      bidirectional: boolean,
      promoteIds: Set<string>,
      overrideLocations?: LocationNode[],
      overrideContainers?: LocationContainer[],
      targetDirection?: CompassDirection
    ) => {
      const baseLocs = overrideLocations ?? workingLocations;
      const baseConts = overrideContainers ?? workingContainers;
      const nextLocs =
        promoteIds.size > 0
          ? baseLocs.map((l) =>
              promoteIds.has(l.id) ? { ...l, is_entry_exit: true } : l
            )
          : baseLocs;

      const newEdges = buildBidirectionalEdgePair({
        worldId,
        fromLoc,
        toLoc,
        direction,
        targetDirection,
        distanceMeters,
        bidirectional,
      });

      commitNextGraph({
        containers: baseConts,
        locations: nextLocs,
        edges: [...workingEdges, ...newEdges],
      });
      setPromotionPrompt(null);
    },
    [workingLocations, workingContainers, workingEdges, worldId, commitNextGraph, setPromotionPrompt]
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
      distanceMeters?: number;
    }) => {
      const srcInfo = resolveNodeConnectionEndpoint({
        kind: opts.sourceKind,
        id: opts.sourceId,
        locationMap,
        containerMap,
        workingContainers,
        workingLocations,
        dynamicPortalIds: projectedTopology.dynamicPortalIds,
      });
      const tgtInfo = resolveNodeConnectionEndpoint({
        kind: opts.targetKind,
        id: opts.targetId,
        locationMap,
        containerMap,
        workingContainers,
        workingLocations,
        dynamicPortalIds: projectedTopology.dynamicPortalIds,
      });
      if (!srcInfo.loc || !tgtInfo.loc) {
        setStatusNotice(
          "Cannot connect to an empty container — add a location or sub-container inside it first."
        );
        return;
      }
      if (srcInfo.loc.id === tgtInfo.loc.id) return;

      const defaultMeters =
        srcInfo.loc.container_id &&
        srcInfo.loc.container_id === tgtInfo.loc.container_id
          ? DEFAULT_INTERIOR_DISTANCE_METERS
          : srcInfo.loc.container_id !== tgtInfo.loc.container_id ||
            opts.sourceKind === "container" ||
            opts.targetKind === "container" ||
            srcInfo.loc.is_hub ||
            tgtInfo.loc.is_hub
          ? DEFAULT_EXTERIOR_DISTANCE_METERS
          : DEFAULT_FALLBACK_DISTANCE_METERS;
      const distanceMeters = clampEdgeDistanceMeters(
        opts.distanceMeters ?? defaultMeters,
        defaultMeters
      );

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
      const targetOccupiedSet =
        occupiedSlotsByLocId.get(tgtInfo.loc.id) ?? new Set<CompassDirection>();
      const resolvedTarget = resolveAutoTargetSlot(
        opts.sourceSlot,
        targetOccupiedSet,
        opts.explicitTargetSlot
      );

      // Check compass port collision on source upfront (or explicit target on direct path)
      const srcExistingEdge = workingEdges.find(
        (e) =>
          e.from_location_id === srcInfo.loc!.id &&
          e.compass_direction === opts.sourceSlot
      );
      const isContainerBodyDrop =
        opts.targetKind === "container" && !opts.explicitTargetSlot;
      const candidates = computePromotionCandidates(
        srcInfo.loc,
        tgtInfo.loc,
        containerMap,
        projectedTopology.dynamicPortalIds
      );
      const needsModal =
        isContainerBodyDrop ||
        (tgtInfo.container != null && tgtInfo.candidates.length > 1) ||
        candidates.length > 0;

      const tgtExistingEdge =
        !needsModal && resolvedTarget.collides
          ? workingEdges.find(
              (e) =>
                e.from_location_id === tgtInfo.loc!.id &&
                e.compass_direction === resolvedTarget.slot
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
        setHubCollisionModal({
          sourceNodeId: srcInfo.loc.id,
          sourceName: srcInfo.loc.name,
          sourceSlot: opts.sourceSlot,
          targetNodeId: tgtInfo.loc.id,
          targetName: tgtInfo.loc.name,
          targetSlot: resolvedTarget.slot,
          collidingSide,
          occupiedByName: occOther,
          suggestedHubName: `${
            collidingSide === "target" ? tgtInfo.loc.name : srcInfo.loc.name
          } — Junction`,
          distanceMeters,
          x: Math.round((srcPt.x + tgtPt.x) / 2),
          y: Math.round((srcPt.y + tgtPt.y) / 2),
        });
        return;
      }

      if (needsModal) {
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
          explicitTargetSlot: opts.explicitTargetSlot,
          distanceMeters,
          bidirectional: true,
          candidates,
        });
        return;
      }

      executeDirectEdgeCreation(
        srcInfo.loc,
        tgtInfo.loc,
        opts.sourceSlot,
        distanceMeters,
        true,
        new Set(),
        undefined,
        undefined,
        resolvedTarget.slot
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
      occupiedSlotsByLocId,
      executeDirectEdgeCreation,
      setStatusNotice,
      setHubCollisionModal,
      setPromotionPrompt,
    ]
  );

  // Confirm handler for PortalPromotionModal (checks target collision after target location/slot pick)
  const handleConfirmPortalPrompt = useCallback(
    (
      fromLoc: LocationNode,
      toLoc: LocationNode,
      direction: CompassDirection,
      distanceMeters: number,
      bidirectional: boolean,
      promoteIds: Set<string>,
      explicitTargetSlot?: CompassDirection
    ) => {
      const targetOccupiedSet =
        occupiedSlotsByLocId.get(toLoc.id) ?? new Set<CompassDirection>();
      const resolvedTarget = resolveAutoTargetSlot(
        direction,
        targetOccupiedSet,
        explicitTargetSlot
      );
      if (resolvedTarget.collides) {
        const occEdge = workingEdges.find(
          (e) =>
            e.from_location_id === toLoc.id &&
            e.compass_direction === resolvedTarget.slot
        );
        const occOther = occEdge
          ? locationMap.get(occEdge.to_location_id)?.name ?? "another location"
          : "another location";
        const srcPt =
          fullMapCoords[fromLoc.id] ??
          fullMapCoords[fromLoc.container_id ?? ""] ?? { x: 0, y: 0 };
        const tgtPt =
          fullMapCoords[toLoc.id] ??
          fullMapCoords[toLoc.container_id ?? ""] ?? { x: 100, y: 0 };
        setPromotionPrompt(null);
        setHubCollisionModal({
          sourceNodeId: fromLoc.id,
          sourceName: fromLoc.name,
          sourceSlot: direction,
          targetNodeId: toLoc.id,
          targetName: toLoc.name,
          targetSlot: resolvedTarget.slot,
          collidingSide: "target",
          occupiedByName: occOther,
          suggestedHubName: `${toLoc.name} — Junction`,
          distanceMeters,
          x: Math.round((srcPt.x + tgtPt.x) / 2),
          y: Math.round((srcPt.y + tgtPt.y) / 2),
          promoteIds: promoteIds.size > 0 ? Array.from(promoteIds) : undefined,
        });
        return;
      }

      executeDirectEdgeCreation(
        fromLoc,
        toLoc,
        direction,
        distanceMeters,
        bidirectional,
        promoteIds,
        undefined,
        undefined,
        resolvedTarget.slot
      );
    },
    [
      occupiedSlotsByLocId,
      workingEdges,
      locationMap,
      fullMapCoords,
      setPromotionPrompt,
      setHubCollisionModal,
      executeDirectEdgeCreation,
    ]
  );

  // Confirm Passage Hub insertion on colliding port
  const handleConfirmHubCollision = useCallback(
    (hubName: string, distanceMeters: number) => {
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
        props: [],
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
            distance_meters: DEFAULT_INTERIOR_DISTANCE_METERS,
            speed_modifier: 1,
            travel_mode: null,
            obstacles: [],
            is_blocked: false,
            is_secret: false,
          },
          {
            id: makeUniqueId("edge_hub_out"),
            world_id: worldId,
            from_location_id: hubId,
            to_location_id: anchorNode.id,
            direction_label: `Return to ${anchorNode.name}`,
            compass_direction: backToAnchorSlot,
            distance_meters: DEFAULT_INTERIOR_DISTANCE_METERS,
            speed_modifier: 1,
            travel_mode: null,
            obstacles: [],
            is_blocked: false,
            is_secret: false,
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
            distance_meters: existingFwd.distance_meters,
            speed_modifier: existingFwd.speed_modifier ?? 1,
            travel_mode: existingFwd.travel_mode ?? null,
            obstacles: [...(existingFwd.obstacles ?? [])],
            is_blocked: Boolean(existingFwd.is_blocked),
            is_secret: Boolean(existingFwd.is_secret),
          },
          {
            id: makeUniqueId("edge_old_rev"),
            world_id: worldId,
            from_location_id: oldDestId,
            to_location_id: hubId,
            direction_label: `Return to ${hubName}`,
            compass_direction: origRevSlot,
            distance_meters: existingFwd.distance_meters,
            speed_modifier: existingFwd.speed_modifier ?? 1,
            travel_mode: existingFwd.travel_mode ?? null,
            obstacles: [...(existingFwd.obstacles ?? [])],
            is_blocked: Boolean(existingFwd.is_blocked),
            is_secret: Boolean(existingFwd.is_secret),
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
            distance_meters: DEFAULT_INTERIOR_DISTANCE_METERS,
            speed_modifier: 1,
            travel_mode: null,
            obstacles: [],
            is_blocked: false,
            is_secret: false,
          },
          {
            id: makeUniqueId("edge_ha"),
            world_id: worldId,
            from_location_id: hubId,
            to_location_id: anchorNode.id,
            direction_label: `Return to ${anchorNode.name}`,
            compass_direction: backToAnchorSlot,
            distance_meters: DEFAULT_INTERIOR_DISTANCE_METERS,
            speed_modifier: 1,
            travel_mode: null,
            obstacles: [],
            is_blocked: false,
            is_secret: false,
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
          distance_meters: distanceMeters,
          speed_modifier: 1,
          travel_mode: null,
          obstacles: [],
          is_blocked: false,
          is_secret: false,
        },
        {
          id: makeUniqueId("edge_peer_rev"),
          world_id: worldId,
          from_location_id: peerNode.id,
          to_location_id: hubId,
          direction_label: `To ${hubName}`,
          compass_direction: slotFromPeer,
          distance_meters: distanceMeters,
          speed_modifier: 1,
          travel_mode: null,
          obstacles: [],
          is_blocked: false,
          is_secret: false,
        }
      );

      const promoteSet = new Set(st.promoteIds ?? []);
      const isHubBoundaryPortal = Boolean(
        hubAnchorContainerId &&
          promoteSet.size > 0 &&
          (st.collidingSide === "target"
            ? (srcLoc.container_id ?? null) !== hubAnchorContainerId
            : (tgtLoc.container_id ?? null) !== hubAnchorContainerId)
      );
      const baseLocations =
        promoteSet.size > 0
          ? workingLocations.map((l) =>
              promoteSet.has(l.id) ? { ...l, is_entry_exit: true } : l
            )
          : workingLocations;

      commitNextGraph({
        containers: workingContainers,
        locations: [
          ...baseLocations,
          isHubBoundaryPortal ? { ...hubNode, is_entry_exit: true } : hubNode,
        ],
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
      distanceMeters: number;
      containerDepth?: 1 | 2 | 3 | 4;
    }) => {
      if (!emptyCanvasModal) return;
      const st = emptyCanvasModal;

      const sourceLoc = resolveNodeConnectionEndpoint({
        kind: st.sourceKind,
        id: st.sourceId,
        locationMap,
        containerMap,
        workingContainers,
        workingLocations,
        dynamicPortalIds: projectedTopology.dynamicPortalIds,
      }).loc;
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
          icon: inferMapIconKey({
            kind: "container",
            depth,
            name: opts.name,
          }),
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
          props: [],
          icon: inferMapIconKey({
            kind: "location",
            name: `${opts.name} Entrance`,
            tags: ["entrance"],
          }),
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
          clampEdgeDistanceMeters(opts.distanceMeters, DEFAULT_EXTERIOR_DISTANCE_METERS),
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
        props: [],
        ui_x: Math.round(st.dropX),
        ui_y: Math.round(st.dropY),
        icon: inferMapIconKey({
          kind: isHub ? "hub" : "location",
          name: opts.name,
          tags: isHub ? ["corridor"] : [],
        }),
      };

      executeDirectEdgeCreation(
        sourceLoc,
        newLoc,
        st.sourceSlot,
        clampEdgeDistanceMeters(
          opts.distanceMeters,
          currentContainerId
            ? DEFAULT_INTERIOR_DISTANCE_METERS
            : DEFAULT_FALLBACK_DISTANCE_METERS
        ),
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
      containerMap,
      workingContainers,
      workingLocations,
      projectedTopology.dynamicPortalIds,
      worldId,
      currentContainerId,
      executeDirectEdgeCreation,
    ]
  );

  // Confirm linking to an existing location across the world from empty-canvas drop
  const handleLinkExistingFromEmptyCanvas = useCallback(
    (opts: {
      targetLocationId: string;
      distanceMeters: number;
      targetSlot?: CompassDirection;
    }) => {
      if (!emptyCanvasModal) return;
      const st = emptyCanvasModal;
      setEmptyCanvasModal(null);
      initiateConnection({
        sourceKind: st.sourceKind,
        sourceId: st.sourceId,
        sourceSlot: st.sourceSlot,
        targetKind: "location",
        targetId: opts.targetLocationId,
        explicitTargetSlot: opts.targetSlot,
        distanceMeters: opts.distanceMeters,
      });
    },
    [emptyCanvasModal, setEmptyCanvasModal, initiateConnection]
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
        icon: inferMapIconKey({
          kind: "container",
          depth: 1,
          name: containerName,
          tags: targetLoc.environmental_tags ?? [],
        }),
      };

      const nextLocs = sanitizeSnapshotAnchors(
        [...workingContainers, newCont],
        workingLocations.map((l) => {
          if (l.id === draggedLoc.id || l.id === targetLoc.id) {
            return { ...l, container_id: contId, ui_x: null, ui_y: null };
          }
          return l;
        })
      );
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
        const nextLocs = sanitizeSnapshotAnchors(
          workingContainers,
          workingLocations.map((l) =>
            l.id === draggedId
              ? {
                  ...l,
                  container_id: targetContainerId,
                  is_entry_exit: targetContainerId ? l.is_entry_exit : false,
                  ui_x: null,
                  ui_y: null,
                }
              : l
          )
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
        const nextLocs = sanitizeSnapshotAnchors(nextConts, workingLocations);
        commitNextGraph({
          containers: nextConts,
          locations: nextLocs,
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
      const nextLocs = sanitizeSnapshotAnchors(
        workingContainers,
        workingLocations.filter((l) => l.id !== locId)
      );
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
      const nextLocs = sanitizeSnapshotAnchors(
        nextConts,
        workingLocations.map((l) =>
          l.container_id === contId
            ? {
                ...l,
                container_id: nextParent,
                is_entry_exit: nextParent ? l.is_entry_exit : false,
                ui_x: null,
                ui_y: null,
              }
            : l
        )
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
        icon:
          loc.icon &&
          loc.icon !== getDefaultMapIconKey(loc.is_hub ? "hub" : "location")
            ? loc.icon
            : inferMapIconKey({
                kind: "container",
                depth: 1,
                name: loc.name,
                tags: loc.environmental_tags ?? [],
              }),
      };
      const convertedName = keepVisitedImmutable ? loc.name : `${loc.name} Entrance`;
      const nextLocs = workingLocations.map((l) =>
        l.id === locId
          ? {
              ...l,
              container_id: contId,
              is_entry_exit: true,
              name: convertedName,
              lore_nodes: keepVisitedImmutable ? l.lore_nodes : [],
              ui_x: null,
              ui_y: null,
            }
          : l
      );
      const nextEdges = keepVisitedImmutable
        ? workingEdges
        : syncEdgeLabelsForLocationRename(
            workingEdges,
            locId,
            loc.name,
            convertedName
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
        edges: nextEdges,
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

  const handlePatchEdgePair = useCallback(
    (edgeId: string, patch: EdgePairPatch) => {
      if (isMutatingLocked) return;
      const target = workingEdges.find((e) => e.id === edgeId);
      if (!target) return;

      const isReciprocal = (e: LocationEdge) =>
        e.from_location_id === target.to_location_id &&
        e.to_location_id === target.from_location_id;

      const nextDistance =
        patch.distance_meters !== undefined
          ? clampEdgeDistanceMeters(patch.distance_meters, target.distance_meters)
          : undefined;
      const nextSpeed =
        patch.speed_modifier !== undefined
          ? clampEdgeSpeedModifier(patch.speed_modifier, target.speed_modifier)
          : undefined;
      const hasTravelMode = Object.prototype.hasOwnProperty.call(patch, "travel_mode");
      const nextTravelMode = hasTravelMode
        ? normalizeTravelModeInput(patch.travel_mode ?? null)
        : undefined;
      const nextObstacles =
        patch.obstacles !== undefined ? normalizeObstacleList(patch.obstacles) : undefined;
      const nextPrimaryLabel =
        patch.direction_label !== undefined ? patch.direction_label.trim() : undefined;
      const nextReciprocalLabel =
        patch.reciprocal_direction_label !== undefined
          ? patch.reciprocal_direction_label.trim()
          : undefined;

      let changed = false;
      const nextEdges = workingEdges.map((e) => {
        const isPrimary = e.id === edgeId;
        const isRev = !isPrimary && isReciprocal(e);
        if (!isPrimary && !isRev) return e;

        const updated: LocationEdge = { ...e };
        let itemChanged = false;

        if (nextDistance !== undefined && updated.distance_meters !== nextDistance) {
          updated.distance_meters = nextDistance;
          itemChanged = true;
        }
        if (nextSpeed !== undefined && Math.abs(updated.speed_modifier - nextSpeed) > 1e-6) {
          updated.speed_modifier = nextSpeed;
          itemChanged = true;
        }
        if (hasTravelMode && (updated.travel_mode ?? null) !== nextTravelMode) {
          updated.travel_mode = nextTravelMode ?? null;
          itemChanged = true;
        }
        if (nextObstacles !== undefined) {
          const prevObs = updated.obstacles ?? [];
          if (
            prevObs.length !== nextObstacles.length ||
            prevObs.some((val, idx) => val !== nextObstacles[idx])
          ) {
            updated.obstacles = nextObstacles;
            itemChanged = true;
          }
        }
        if (patch.is_blocked !== undefined && updated.is_blocked !== patch.is_blocked) {
          updated.is_blocked = patch.is_blocked;
          itemChanged = true;
        }
        if (patch.is_secret !== undefined && updated.is_secret !== patch.is_secret) {
          updated.is_secret = patch.is_secret;
          itemChanged = true;
        }
        if (
          patch.distance_mode !== undefined &&
          (updated.distance_mode ?? "flexible") !== patch.distance_mode
        ) {
          updated.distance_mode = patch.distance_mode;
          itemChanged = true;
        }
        if (
          patch.is_vertical !== undefined &&
          Boolean(updated.is_vertical) !== Boolean(patch.is_vertical)
        ) {
          updated.is_vertical = Boolean(patch.is_vertical);
          itemChanged = true;
        }
        if (isPrimary && nextPrimaryLabel && updated.direction_label !== nextPrimaryLabel) {
          updated.direction_label = nextPrimaryLabel;
          itemChanged = true;
        }
        if (isRev && nextReciprocalLabel && updated.direction_label !== nextReciprocalLabel) {
          updated.direction_label = nextReciprocalLabel;
          itemChanged = true;
        }
        if (
          isPrimary &&
          patch.compass_direction !== undefined &&
          updated.compass_direction !== patch.compass_direction
        ) {
          const slotConflict = workingEdges.some(
            (other) =>
              other.id !== updated.id &&
              other.from_location_id === updated.from_location_id &&
              other.compass_direction === patch.compass_direction
          );
          if (!slotConflict) {
            updated.compass_direction = patch.compass_direction;
            itemChanged = true;
          } else {
            setStatusNotice(
              `Port ${patch.compass_direction} is already occupied — choose an empty port.`
            );
          }
        }
        if (
          isRev &&
          patch.reciprocal_compass_direction !== undefined &&
          updated.compass_direction !== patch.reciprocal_compass_direction
        ) {
          const slotConflict = workingEdges.some(
            (other) =>
              other.id !== updated.id &&
              other.from_location_id === updated.from_location_id &&
              other.compass_direction === patch.reciprocal_compass_direction
          );
          if (!slotConflict) {
            updated.compass_direction = patch.reciprocal_compass_direction;
            itemChanged = true;
          } else {
            setStatusNotice(
              `Port ${patch.reciprocal_compass_direction} is already occupied — choose an empty port.`
            );
          }
        }

        if (itemChanged) {
          changed = true;
          return updated;
        }
        return e;
      });

      if (!changed) return;
      const affectsConsistency =
        patch.distance_meters !== undefined ||
        patch.distance_mode !== undefined ||
        patch.is_vertical !== undefined ||
        patch.compass_direction !== undefined ||
        patch.reciprocal_compass_direction !== undefined;
      if (affectsConsistency) {
        commitGraphWithConsistencyAutoSync(
          {
            containers: workingContainers,
            locations: workingLocations,
            edges: nextEdges,
          },
          true,
          [edgeId]
        );
      } else {
        commitNextGraph({
          containers: workingContainers,
          locations: workingLocations,
          edges: nextEdges,
        });
      }
    },
    [
      isMutatingLocked,
      workingEdges,
      workingContainers,
      workingLocations,
      commitNextGraph,
      commitGraphWithConsistencyAutoSync,
      setStatusNotice,
    ]
  );

  const handleUpdateEdgeDistance = useCallback(
    (edgeId: string, distanceMeters: number) => {
      handlePatchEdgePair(edgeId, { distance_meters: distanceMeters });
    },
    [handlePatchEdgePair]
  );

  const handleToggleEdgeBlocked = useCallback(
    (edgeId: string) => {
      const target = workingEdges.find((e) => e.id === edgeId);
      if (!target) return;
      handlePatchEdgePair(edgeId, { is_blocked: !target.is_blocked });
    },
    [workingEdges, handlePatchEdgePair]
  );

  const handleToggleEdgeSecret = useCallback(
    (edgeId: string) => {
      const target = workingEdges.find((e) => e.id === edgeId);
      if (!target) return;
      handlePatchEdgePair(edgeId, { is_secret: !target.is_secret });
    },
    [workingEdges, handlePatchEdgePair]
  );

  const handleUpdateEdgeLabel = useCallback(
    (edgeId: string, directionLabel: string) => {
      handlePatchEdgePair(edgeId, { direction_label: directionLabel });
    },
    [handlePatchEdgePair]
  );

  const handleReassignEdgeSlot = useCallback(
    (edgeId: string, nextSlot: CompassDirection): boolean => {
      if (isMutatingLocked) return false;
      const result = reassignEdgeCompassSlot(workingEdges, edgeId, nextSlot);
      if (!result.changed) {
        if (result.reason) {
          setStatusNotice(result.reason);
        }
        return false;
      }
      commitGraphWithConsistencyAutoSync(
        {
          containers: workingContainers,
          locations: workingLocations,
          edges: result.edges,
        },
        true,
        [edgeId]
      );
      return true;
    },
    [
      isMutatingLocked,
      workingEdges,
      workingContainers,
      workingLocations,
      commitGraphWithConsistencyAutoSync,
      setStatusNotice,
    ]
  );

  const applyReconciliationAdjustments = useCallback(
    (adjustments: readonly ReconciliationAdjustment[]) => {
      if (isMutatingLocked || adjustments.length === 0) return 0;
      const { edges: nextEdges, adjustedPairs } = applyAdjustmentsToEdges(
        workingEdges,
        adjustments
      );
      if (adjustedPairs === 0) return 0;
      commitNextGraph({
        containers: workingContainers,
        locations: workingLocations,
        edges: nextEdges,
      });
      setStatusNotice(
        `Reconciled ${adjustedPairs} link distance${adjustedPairs === 1 ? "" : "s"} — Undo to revert.`
      );
      return adjustedPairs;
    },
    [
      isMutatingLocked,
      workingEdges,
      workingContainers,
      workingLocations,
      commitNextGraph,
      setStatusNotice,
    ]
  );

  const canDeleteEdge = useCallback(
    (edgeId: string): { allowed: boolean; reason?: string } => {
      if (mode !== "editor") {
        return {
          allowed: false,
          reason: "Links can only be deleted in the World Editor.",
        };
      }
      if (!workingEdges.some((e) => e.id === edgeId)) {
        return { allowed: false, reason: "Link no longer exists." };
      }
      return { allowed: true };
    },
    [mode, workingEdges]
  );

  const deleteEdgeIds = useCallback(
    (edgeIds: string[]) => {
      const nextEdges = filterEdgesAfterDeletion(workingEdges, edgeIds);
      if (nextEdges === workingEdges) return;
      commitNextGraph({
        containers: workingContainers,
        locations: workingLocations,
        edges: nextEdges,
      });
      const removedIds = new Set(
        workingEdges
          .filter((e) => !nextEdges.includes(e))
          .map((e) => e.id)
      );
      onEdgesRemoved?.(removedIds);
    },
    [workingEdges, workingContainers, workingLocations, commitNextGraph, onEdgesRemoved]
  );

  const handleDeleteEdge = useCallback(
    (edgeId: string) => {
      deleteEdgeIds([edgeId]);
    },
    [deleteEdgeIds]
  );

  const handleDeleteEdgeGroup = useCallback(
    (edgeIds: string[]) => {
      deleteEdgeIds(edgeIds);
    },
    [deleteEdgeIds]
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
    handleConfirmPortalPrompt,
    handleConfirmHubCollision,
    handleConfirmEmptyCanvasCreate,
    handleLinkExistingFromEmptyCanvas,
    handleConfirmGroupIntoContainer,
    executeImmediateContainerMove,
    canDeleteLocation,
    canDeleteContainer,
    canConvertLocation,
    canMoveOutToParent,
    canDeleteEdge,
    handleDeleteLocation,
    handleDeleteContainer,
    handleConvertLocationToContainer,
    handleSetStartingLocation,
    handlePatchEdgePair,
    handleReassignEdgeSlot,
    handleUpdateEdgeDistance,
    handleUpdateEdgeLabel,
    handleToggleEdgeBlocked,
    handleToggleEdgeSecret,
    handleDeleteEdge,
    handleDeleteEdgeGroup,
    applyReconciliationAdjustments,
  };
}
