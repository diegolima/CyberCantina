import { LocationContainer, LocationEdge, LocationNode } from "../../types";

export interface ReachabilityReport {
  startingLocationId: string | null;
  forwardReachableIds: string[];
  reverseReachableIds: string[];
  unreachableIds: string[];
  starterError: string | null;
}

/** Collect a container ID plus all transitive child container IDs. */
export function getDescendantContainerIds(
  rootId: string,
  containers: LocationContainer[]
): Set<string> {
  const result = new Set<string>([rootId]);
  const childrenByParent = new Map<string, string[]>();
  for (const c of containers) {
    if (c.parent_container_id) {
      const list = childrenByParent.get(c.parent_container_id) ?? [];
      list.push(c.id);
      childrenByParent.set(c.parent_container_id, list);
    }
  }
  const queue = [rootId];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    for (const cid of childrenByParent.get(curr) ?? []) {
      if (!result.has(cid)) {
        result.add(cid);
        queue.push(cid);
      }
    }
  }
  return result;
}

/** Validate container hierarchy invariants (unique IDs, parent depth > child depth, no cycles). */
export function validateContainersState(
  containers: LocationContainer[],
  locations: LocationNode[]
): string[] {
  const errors: string[] = [];
  const byId = new Map<string, LocationContainer>();

  for (const c of containers) {
    if (byId.has(c.id)) {
      errors.push(`Duplicate container ID '${c.id}'.`);
    }
    byId.set(c.id, c);
  }

  for (const c of containers) {
    if (!c.name.trim()) {
      errors.push("A container is missing a name.");
    }
    if (c.parent_container_id) {
      const parent = byId.get(c.parent_container_id);
      if (!parent) {
        errors.push(`Container "${c.name}" references a missing parent container.`);
      } else if (parent.depth <= c.depth) {
        errors.push(
          `Container "${c.name}" (Level ${c.depth}) cannot sit inside "${parent.name}" (Level ${parent.depth}).`
        );
      }
    }
    if (c.depth > 1 && c.lore_nodes && c.lore_nodes.length > 0) {
      errors.push(
        `Container "${c.name}" (Level ${c.depth}) has lore entries, which are only allowed on Level 1 containers.`
      );
    }
  }

  for (const c of containers) {
    const seen = new Set<string>();
    let curr: LocationContainer | undefined = c;
    while (curr?.parent_container_id) {
      if (seen.has(curr.id)) {
        errors.push(`Hierarchy cycle detected involving "${curr.name}".`);
        break;
      }
      seen.add(curr.id);
      curr = byId.get(curr.parent_container_id);
    }
  }

  for (const loc of locations) {
    if (loc.container_id && !byId.has(loc.container_id)) {
      errors.push(`Location "${loc.name}" references a missing container.`);
    }
  }

  return errors;
}

/** Compute bidirectional reachability from the Starting Location across all active edges. */
export function computeUnreachableLocationIds(
  locations: LocationNode[],
  edges: LocationEdge[]
): ReachabilityReport {
  if (locations.length === 0) {
    return {
      startingLocationId: null,
      forwardReachableIds: [],
      reverseReachableIds: [],
      unreachableIds: [],
      starterError: "Map must contain at least one location.",
    };
  }

  const starters = locations.filter((l) => l.is_starting_location);
  if (starters.length !== 1) {
    return {
      startingLocationId: starters[0]?.id ?? null,
      forwardReachableIds: [],
      reverseReachableIds: [],
      unreachableIds: locations.map((l) => l.id),
      starterError:
        starters.length === 0
          ? "Mark one location as the Starting Location."
          : `Multiple Starting Locations selected (${starters.length}).`,
    };
  }

  const startId = starters[0].id;
  const locIds = new Set(locations.map((l) => l.id));
  const fwd = new Map<string, string[]>();
  const rev = new Map<string, string[]>();
  for (const id of locIds) {
    fwd.set(id, []);
    rev.set(id, []);
  }
  for (const e of edges) {
    if (locIds.has(e.from_location_id) && locIds.has(e.to_location_id)) {
      fwd.get(e.from_location_id)!.push(e.to_location_id);
      rev.get(e.to_location_id)!.push(e.from_location_id);
    }
  }

  const bfs = (adj: Map<string, string[]>): Set<string> => {
    const visited = new Set<string>([startId]);
    const queue = [startId];
    for (let i = 0; i < queue.length; i++) {
      const curr = queue[i];
      for (const nxt of adj.get(curr) ?? []) {
        if (!visited.has(nxt)) {
          visited.add(nxt);
          queue.push(nxt);
        }
      }
    }
    return visited;
  };

  const fwdVisited = bfs(fwd);
  const revVisited = bfs(rev);
  const unreachableIds = locations
    .filter((l) => !fwdVisited.has(l.id) || !revVisited.has(l.id))
    .map((l) => l.id);

  return {
    startingLocationId: startId,
    forwardReachableIds: Array.from(fwdVisited),
    reverseReachableIds: Array.from(revVisited),
    unreachableIds,
    starterError: null,
  };
}

/** Return inner-to-outer ancestor container IDs starting from startContainerId. */
export function getContainerAncestorChain(
  startContainerId: string | null | undefined,
  containers: LocationContainer[]
): string[] {
  const byId = new Map(containers.map((c) => [c.id, c]));
  const chain: string[] = [];
  const seen = new Set<string>();
  let curr = startContainerId ?? null;
  while (curr && !seen.has(curr)) {
    const c = byId.get(curr);
    if (!c) break;
    seen.add(curr);
    chain.push(curr);
    curr = c.parent_container_id ?? null;
  }
  return chain;
}

export function isSubsequence(oldSeq: string[], newSeq: string[]): boolean {
  let idx = 0;
  for (const item of newSeq) {
    if (idx < oldSeq.length && item === oldSeq[idx]) {
      idx += 1;
    }
  }
  return idx === oldSeq.length;
}

/** Check campaign-mode ancestor monotonicity for a visited location. */
export function validateVisitedAncestorContainment(
  oldContainerId: string | null | undefined,
  oldContainers: LocationContainer[],
  newContainerId: string | null | undefined,
  newContainers: LocationContainer[]
): { valid: boolean; reason?: string } {
  const oldChain = getContainerAncestorChain(oldContainerId, oldContainers);
  const newChain = getContainerAncestorChain(newContainerId, newContainers);
  if (!isSubsequence(oldChain, newChain)) {
    return {
      valid: false,
      reason:
        "Visited locations cannot leave an existing container (you may wrap them into a finer nested container).",
    };
  }
  return { valid: true };
}

/** Check whether a container transitively holds any visited location. */
export function containerHasVisitedDescendants(
  containerId: string,
  containers: LocationContainer[],
  locations: LocationNode[]
): boolean {
  const subIds = getDescendantContainerIds(containerId, containers);
  return locations.some(
    (loc) => Boolean(loc.is_visited) && loc.container_id != null && subIds.has(loc.container_id)
  );
}

export interface DropValidationResult {
  valid: boolean;
  reason?: string;
}

/** Validate dragging a Location (L0) or Container onto a target Location, Container, or Root view. */
export function isValidContainerDrop(params: {
  draggedKind: "location" | "container";
  draggedId: string;
  targetKind: "location" | "container" | "root";
  targetId?: string;
  currentContainerId: string | null;
  containers: LocationContainer[];
  locations: LocationNode[];
  campaignMode?: boolean;
  originalContainers?: LocationContainer[];
  originalLocations?: LocationNode[];
}): DropValidationResult {
  const {
    draggedKind,
    draggedId,
    targetKind,
    targetId,
    currentContainerId,
    containers,
    locations,
    campaignMode = false,
    originalContainers = containers,
    originalLocations = locations,
  } = params;

  const contById = new Map(containers.map((c) => [c.id, c]));
  const locById = new Map(locations.map((l) => [l.id, l]));
  const origLocById = new Map(originalLocations.map((l) => [l.id, l]));

  if (draggedId === targetId) {
    return { valid: false, reason: "Cannot drop an element onto itself." };
  }

  if (draggedKind === "location") {
    const draggedLoc = locById.get(draggedId);
    if (!draggedLoc) return { valid: false, reason: "Location not found." };

    let nextContainerId: string | null = currentContainerId;
    let simulatedContainers = containers;

    if (targetKind === "location") {
      const targetLoc = targetId ? locById.get(targetId) : undefined;
      if (!targetLoc) return { valid: false, reason: "Target location not found." };
      const parentCont = targetLoc.container_id ? contById.get(targetLoc.container_id) : undefined;
      if (parentCont && parentCont.depth <= 1) {
        return {
          valid: false,
          reason: `Cannot group inside Level 1 container "${parentCont.name}".`,
        };
      }
      const syntheticL1Id = "__drop_preview_l1__";
      simulatedContainers = [
        ...containers,
        {
          id: syntheticL1Id,
          world_id: draggedLoc.world_id,
          parent_container_id: targetLoc.container_id ?? null,
          depth: 1,
          name: targetLoc.name,
          description: "",
          environmental_tags: [],
        },
      ];
      nextContainerId = syntheticL1Id;

      if (campaignMode && origLocById.get(targetLoc.id)?.is_visited) {
        const origTgt = origLocById.get(targetLoc.id)!;
        const tgtCheck = validateVisitedAncestorContainment(
          origTgt.container_id,
          originalContainers,
          syntheticL1Id,
          simulatedContainers
        );
        if (!tgtCheck.valid) return tgtCheck;
      }
    } else if (targetKind === "container") {
      const targetCont = targetId ? contById.get(targetId) : undefined;
      if (!targetCont) return { valid: false, reason: "Target container not found." };
      nextContainerId = targetCont.id;
    } else {
      nextContainerId = currentContainerId;
    }

    if (campaignMode && origLocById.get(draggedLoc.id)?.is_visited) {
      const origDragged = origLocById.get(draggedLoc.id)!;
      return validateVisitedAncestorContainment(
        origDragged.container_id,
        originalContainers,
        nextContainerId,
        simulatedContainers
      );
    }
    return { valid: true };
  }

  // Dragging a container
  const draggedCont = contById.get(draggedId);
  if (!draggedCont) return { valid: false, reason: "Container not found." };

  if (targetKind === "location") {
    return {
      valid: false,
      reason: "Containers cannot be dropped onto a Level 0 location.",
    };
  }

  let nextParentId: string | null = currentContainerId;
  if (targetKind === "container") {
    const targetCont = targetId ? contById.get(targetId) : undefined;
    if (!targetCont) return { valid: false, reason: "Target container not found." };
    const descendants = getDescendantContainerIds(draggedCont.id, containers);
    if (descendants.has(targetCont.id)) {
      return { valid: false, reason: "Cannot move a container into its own descendant." };
    }
    if (draggedCont.depth >= targetCont.depth) {
      return {
        valid: false,
        reason: `Level ${draggedCont.depth} "${draggedCont.name}" cannot fit inside Level ${targetCont.depth} "${targetCont.name}".`,
      };
    }
    nextParentId = targetCont.id;
  }

  if (campaignMode) {
    const subtreeIds = getDescendantContainerIds(draggedCont.id, containers);
    const simulatedContainers = containers.map((c) =>
      c.id === draggedCont.id ? { ...c, parent_container_id: nextParentId } : c
    );
    for (const origLoc of originalLocations) {
      if (!origLoc.is_visited) continue;
      const currLoc = locById.get(origLoc.id);
      if (!currLoc?.container_id || !subtreeIds.has(currLoc.container_id)) continue;
      const check = validateVisitedAncestorContainment(
        origLoc.container_id,
        originalContainers,
        currLoc.container_id,
        simulatedContainers
      );
      if (!check.valid) return check;
    }
  }

  return { valid: true };
}
