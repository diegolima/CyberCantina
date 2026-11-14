import {
  LOCATION_LORE_CATEGORIES,
  WORLD_LORE_CATEGORIES,
} from "../../types";
import type {
  CompassDirection,
  LocationContainer,
  LocationEdge,
  LocationEdgeDraft,
  LocationLoreCategory,
  LocationNode,
  LocationNodeDraft,
  LoreNode,
  WorldGlobalRules,
  WorldLoreCategory,
  WorldRecord,
  WorldWizardDraft,
} from "../../types";
import {
  OPPOSITE_COMPASS,
  inferCompassDirection,
  pickCompassSlot,
} from "../SpatialTopologyView";

export function mapDraftToNodesAndEdges(
  draft: {
    locations: LocationNodeDraft[];
    edges: LocationEdgeDraft[];
  },
  worldId: string
): { locations: LocationNode[]; edges: LocationEdge[] } {
  const usedIds = new Set<string>();
  const keyToId = new Map<string, string>();
  const nameToId = new Map<string, string>();

  const firstStartIdx = draft.locations.findIndex(
    (loc) => loc.is_starting_location
  );
  const startIdx = firstStartIdx >= 0 ? firstStartIdx : 0;

  const locations: LocationNode[] = draft.locations.map((loc, idx) => {
    const rawKey = (loc.key || "").trim();
    let id = rawKey || `loc_${idx}`;
    while (usedIds.has(id)) {
      id = `${rawKey || "loc"}_${idx}_${Math.random().toString(36).slice(2, 6)}`;
    }
    usedIds.add(id);
    if (rawKey && !keyToId.has(rawKey)) {
      keyToId.set(rawKey, id);
    }
    keyToId.set(id, id);
    if (loc.name) {
      nameToId.set(loc.name.trim().toLowerCase(), id);
    }

    const isStart = idx === startIdx;
    const containerId = loc.container_id ?? null;
    return {
      id,
      world_id: worldId,
      container_id: containerId,
      is_entry_exit: containerId ? Boolean(loc.is_entry_exit) : false,
      name: loc.name,
      summary: loc.summary,
      description: loc.description,
      environmental_tags: [...(loc.environmental_tags ?? [])],
      is_starting_location: isStart,
      is_hub: Boolean(loc.is_hub),
      starting_message: loc.starting_message ?? "",
      ui_x: loc.ui_x ?? null,
      ui_y: loc.ui_y ?? null,
      icon: loc.icon ?? null,
      lore_nodes: (loc.lore_nodes ?? []).map((ln, lIdx) => ({
        id: ln.id || `draft_loc_lore_${idx}_${lIdx}`,
        world_id: worldId,
        location_id: id,
        title: ln.title,
        category: LOCATION_LORE_CATEGORIES.includes(
          ln.category as LocationLoreCategory
        )
          ? (ln.category as LocationLoreCategory)
          : "rumor",
        content: ln.content,
        entity_tags: [...(ln.entity_tags ?? [])],
      })),
    };
  });

  const resolveLocId = (keyOrName: string): string | undefined => {
    const trimmed = (keyOrName || "").trim();
    return keyToId.get(trimmed) ?? nameToId.get(trimmed.toLowerCase());
  };

  const occupiedFrom = new Map<string, Set<CompassDirection>>();
  const edges: LocationEdge[] = [];
  const hasDirectedPair = (fromId: string, toId: string) =>
    edges.some(
      (e) => e.from_location_id === fromId && e.to_location_id === toId
    );

  draft.edges.forEach((edge, idx) => {
    const fromId = resolveLocId(edge.from_key);
    const toId = resolveLocId(edge.to_key);
    if (!fromId || !toId || fromId === toId) return;

    let fromOcc = occupiedFrom.get(fromId);
    if (!fromOcc) {
      fromOcc = new Set<CompassDirection>();
      occupiedFrom.set(fromId, fromOcc);
    }
    const preferredDir = inferCompassDirection(
      edge.compass_direction,
      edge.direction_label
    );
    const fwdDir = pickCompassSlot(preferredDir, fromOcc);

    if (!hasDirectedPair(fromId, toId)) {
      fromOcc.add(fwdDir);
      edges.push({
        id: `edge_${idx}_fwd_${Math.random().toString(36).slice(2, 6)}`,
        world_id: worldId,
        from_location_id: fromId,
        to_location_id: toId,
        direction_label: edge.direction_label || "Passage",
        compass_direction: fwdDir,
        travel_minutes: edge.travel_minutes ?? 1,
        is_locked_or_hidden: Boolean(edge.is_locked_or_hidden),
      });
    }

    if (edge.bidirectional !== false && !hasDirectedPair(toId, fromId)) {
      let toOcc = occupiedFrom.get(toId);
      if (!toOcc) {
        toOcc = new Set<CompassDirection>();
        occupiedFrom.set(toId, toOcc);
      }
      const revDir = pickCompassSlot(OPPOSITE_COMPASS[fwdDir], toOcc);
      toOcc.add(revDir);
      const fromLocName =
        locations.find((l) => l.id === fromId)?.name ?? edge.from_key;
      edges.push({
        id: `edge_${idx}_rev_${Math.random().toString(36).slice(2, 6)}`,
        world_id: worldId,
        from_location_id: toId,
        to_location_id: fromId,
        direction_label:
          edge.reverse_direction_label || `Return to ${fromLocName}`,
        compass_direction: revDir,
        travel_minutes: edge.travel_minutes ?? 1,
        is_locked_or_hidden: Boolean(edge.is_locked_or_hidden),
      });
    }
  });

  return { locations, edges };
}

export function draftToWorldRecord(draft: WorldWizardDraft): WorldRecord {
  const draftWorldId = "draft_world";
  const { locations, edges } = mapDraftToNodesAndEdges(draft, draftWorldId);

  const containers: LocationContainer[] = (draft.containers ?? []).map(
    (cont, idx) => ({
      id: cont.id || `cont_${idx}`,
      world_id: draftWorldId,
      parent_container_id: cont.parent_container_id ?? null,
      depth: cont.depth,
      name: cont.name,
      description: cont.description ?? "",
      environmental_tags: [...(cont.environmental_tags ?? [])],
      ui_x: cont.ui_x ?? null,
      ui_y: cont.ui_y ?? null,
      icon: cont.icon ?? null,
      lore_nodes:
        cont.depth === 1
          ? (cont.lore_nodes ?? []).map((ln, lIdx) => ({
              id: ln.id || `draft_cont_lore_${idx}_${lIdx}`,
              world_id: draftWorldId,
              container_id: cont.id || `cont_${idx}`,
              title: ln.title,
              category: LOCATION_LORE_CATEGORIES.includes(
                ln.category as LocationLoreCategory
              )
                ? (ln.category as LocationLoreCategory)
                : "rumor",
              content: ln.content,
              entity_tags: [...(ln.entity_tags ?? [])],
            }))
          : [],
    })
  );

  const lore_nodes: LoreNode[] = (draft.lore_nodes ?? []).map((lore, idx) => ({
    id: lore.id || `draft_lore_${idx}`,
    world_id: draftWorldId,
    title: lore.title,
    category: WORLD_LORE_CATEGORIES.includes(lore.category as WorldLoreCategory)
      ? (lore.category as WorldLoreCategory)
      : "faction",
    content: lore.content,
    entity_tags: [...(lore.entity_tags ?? [])],
  }));

  return {
    id: draftWorldId,
    name: draft.name,
    global_rules: { ...draft.global_rules },
    created_at: new Date().toISOString(),
    containers,
    locations,
    edges,
    lore_nodes,
  };
}

export function worldStateToDraft(state: {
  name: string;
  global_rules: WorldGlobalRules;
  containers?: LocationContainer[];
  locations: LocationNode[];
  edges: LocationEdge[];
  lore_nodes: LoreNode[];
}): WorldWizardDraft {
  const validCategories = new Set<string>(WORLD_LORE_CATEGORIES);
  const hasStart = state.locations.some((l) => l.is_starting_location);
  return {
    name: state.name.trim() || "Untitled World",
    global_rules: state.global_rules,
    containers: (state.containers ?? []).map((cont) => ({
      id: cont.id,
      parent_container_id: cont.parent_container_id ?? null,
      depth: cont.depth,
      name: cont.name.trim(),
      description: (cont.description ?? "").trim(),
      environmental_tags: [...(cont.environmental_tags ?? [])],
      ui_x: cont.ui_x ?? null,
      ui_y: cont.ui_y ?? null,
      icon: cont.icon ?? null,
      lore_nodes:
        cont.depth === 1
          ? (cont.lore_nodes ?? []).map((ln) => ({
              id: ln.id,
              title: ln.title.trim(),
              category: LOCATION_LORE_CATEGORIES.includes(
                ln.category as LocationLoreCategory
              )
                ? (ln.category as LocationLoreCategory)
                : "rumor",
              content: ln.content.trim(),
              entity_tags: [...(ln.entity_tags ?? [])],
            }))
          : [],
    })),
    locations: state.locations.map((loc, idx) => ({
      key: loc.id || `loc_${idx}`,
      container_id: loc.container_id ?? null,
      is_entry_exit: loc.container_id ? Boolean(loc.is_entry_exit) : false,
      name: loc.name.trim() || `Location ${idx + 1}`,
      summary: loc.summary.trim() || loc.name.trim() || `Location ${idx + 1}`,
      description:
        loc.description.trim() || loc.summary.trim() || loc.name.trim(),
      environmental_tags: loc.environmental_tags,
      is_starting_location: hasStart
        ? Boolean(loc.is_starting_location)
        : idx === 0,
      is_hub: Boolean(loc.is_hub),
      starting_message: loc.starting_message ?? "",
      ui_x: loc.ui_x ?? null,
      ui_y: loc.ui_y ?? null,
      icon: loc.icon ?? null,
      lore_nodes: (loc.lore_nodes ?? []).map((ln) => ({
        id: ln.id,
        title: ln.title.trim(),
        category: LOCATION_LORE_CATEGORIES.includes(
          ln.category as LocationLoreCategory
        )
          ? (ln.category as LocationLoreCategory)
          : "rumor",
        content: ln.content.trim(),
        entity_tags: ln.entity_tags,
      })),
    })),
    edges: state.edges.map((edge) => ({
      from_key: edge.from_location_id,
      to_key: edge.to_location_id,
      direction_label: edge.direction_label,
      reverse_direction_label: "",
      compass_direction: edge.compass_direction ?? null,
      travel_minutes: edge.travel_minutes,
      is_locked_or_hidden: Boolean(edge.is_locked_or_hidden),
      bidirectional: false,
    })),
    lore_nodes: state.lore_nodes.map((lore) => ({
      id: lore.id,
      title: lore.title.trim() || "Untitled Lore",
      category: (validCategories.has(lore.category)
        ? lore.category
        : "faction") as WorldLoreCategory,
      content: lore.content.trim(),
      entity_tags: lore.entity_tags,
    })),
  };
}
