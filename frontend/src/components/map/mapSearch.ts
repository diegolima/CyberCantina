import type { LocationContainer, LocationNode } from "../../types";
import {
  CONTAINER_DEPTH_LABELS,
  buildContainerBreadcrumb,
} from "./topologyProjection";

export type MapSearchMatchTier = 0 | 1 | 2 | 3;

export interface MapSearchMatch {
  key: string;
  kind: "location" | "container";
  id: string;
  name: string;
  isHub: boolean;
  isStarting: boolean;
  containerDepth?: 1 | 2 | 3 | 4;
  depthLabel?: string;
  breadcrumb: string;
  matchTier: MapSearchMatchTier;
}

export interface FilterMapSearchOptions {
  query: string;
  locations: readonly LocationNode[];
  containers: readonly LocationContainer[];
}

/**
 * Score how closely a node or container name matches a lowercased query:
 * 0 = exact match, 1 = name prefix, 2 = word prefix, 3 = substring, null = no match.
 */
export function scoreNameMatch(
  rawName: string,
  queryLower: string
): MapSearchMatchTier | null {
  if (!queryLower) return null;
  const nameLower = rawName.trim().toLowerCase();
  if (!nameLower) return null;
  if (nameLower === queryLower) return 0;
  if (nameLower.startsWith(queryLower)) return 1;

  const words = nameLower.split(/[\s\-_/.,:()]+/);
  for (const word of words) {
    if (word && word.startsWith(queryLower)) {
      return 2;
    }
  }
  if (nameLower.includes(queryLower)) return 3;
  return null;
}

/**
 * Search and deterministically rank all locations and containers across every
 * hierarchy depth for the Spatial Topology toolbar combobox.
 */
export function filterAndRankMapSearchResults({
  query,
  locations,
  containers,
}: FilterMapSearchOptions): MapSearchMatch[] {
  const queryLower = query.trim().toLowerCase();
  if (!queryLower) return [];

  const containerList = containers as LocationContainer[];
  const containerIds = new Set(containerList.map((c) => c.id));
  const results: MapSearchMatch[] = [];

  for (const cont of containerList) {
    const displayName = cont.name.trim() || "Unnamed Area";
    const tier = scoreNameMatch(displayName, queryLower);
    if (tier === null) continue;
    const parentId =
      cont.parent_container_id && containerIds.has(cont.parent_container_id)
        ? cont.parent_container_id
        : null;
    results.push({
      key: `container:${cont.id}`,
      kind: "container",
      id: cont.id,
      name: displayName,
      isHub: false,
      isStarting: false,
      containerDepth: cont.depth,
      depthLabel: CONTAINER_DEPTH_LABELS[cont.depth] ?? `Level ${cont.depth}`,
      breadcrumb: buildContainerBreadcrumb(parentId, containerList),
      matchTier: tier,
    });
  }

  for (const loc of locations) {
    const displayName = loc.name.trim() || "Unnamed Location";
    const tier = scoreNameMatch(displayName, queryLower);
    if (tier === null) continue;
    const parentId =
      loc.container_id && containerIds.has(loc.container_id)
        ? loc.container_id
        : null;
    results.push({
      key: `location:${loc.id}`,
      kind: "location",
      id: loc.id,
      name: displayName,
      isHub: Boolean(loc.is_hub),
      isStarting: Boolean(loc.is_starting_location),
      breadcrumb: buildContainerBreadcrumb(parentId, containerList),
      matchTier: tier,
    });
  }

  results.sort((a, b) => {
    if (a.matchTier !== b.matchTier) return a.matchTier - b.matchTier;
    const byName = a.name.localeCompare(b.name, undefined, {
      sensitivity: "base",
    });
    if (byName !== 0) return byName;
    if (a.kind !== b.kind) return a.kind === "container" ? -1 : 1;
    const byBreadcrumb = a.breadcrumb.localeCompare(b.breadcrumb, undefined, {
      sensitivity: "base",
    });
    if (byBreadcrumb !== 0) return byBreadcrumb;
    return a.id.localeCompare(b.id);
  });

  return results;
}
