import type { CampaignStateBundle, LoreNode, MajorEventRecord } from "../../types";

export interface StoryMajorEventItem {
  key: string;
  turnId: string;
  turnDepthIndex: number;
  scope: "world" | "location";
  dateLabel: string;
  title: string;
  summary: string;
  keywords: string[];
  loreNodeId: string | null;
  locationId: string | null;
  locationName: string | null;
  previousDescription: string | null;
  updatedDescription: string | null;
  currentLocationTags: string[];
  tagsAdded: string[];
  tagsRemoved: string[];
}

export function buildStoryMajorEvents(
  bundle: CampaignStateBundle
): StoryMajorEventItem[] {
  const branchTurns = bundle.active_branch_turns ?? [];
  const turnById = new Map(branchTurns.map((t) => [t.id, t]));
  const locById = new Map(
    (bundle.visible_locations ?? []).map((loc) => [loc.id, loc])
  );
  if (bundle.active_location?.id && !locById.has(bundle.active_location.id)) {
    locById.set(bundle.active_location.id, bundle.active_location);
  }

  const activeWorldLore = bundle.world_lore_nodes ?? [];
  const hasWorldLoreList = Array.isArray(bundle.world_lore_nodes);
  const activeMajorLoreById = new Map<string, LoreNode>();
  const activeMajorLoreByOrigin = new Map<string, LoreNode>();
  const activeMajorLoreByTurn = new Map<string, LoreNode>();
  for (const ln of activeWorldLore) {
    if (!ln.is_major_event) continue;
    activeMajorLoreById.set(ln.id, ln);
    if (ln.origin_lore_id) {
      activeMajorLoreByOrigin.set(ln.origin_lore_id, ln);
    }
    if (ln.created_at_turn_id) {
      activeMajorLoreByTurn.set(ln.created_at_turn_id, ln);
    }
  }

  const items: StoryMajorEventItem[] = [];
  const consumedLoreIds = new Set<string>();

  for (const turn of branchTurns) {
    const me: MajorEventRecord | null | undefined = turn.post_turn?.major_event;
    if (!me || me.deleted) continue;

    if (me.scope === "world") {
      const liveLore =
        (me.lore_node_id
          ? activeMajorLoreById.get(me.lore_node_id) ??
            activeMajorLoreByOrigin.get(me.lore_node_id)
          : undefined) ?? activeMajorLoreByTurn.get(turn.id);

      // If world_lore_nodes was provided and the linked LoreNode was tombstoned/deleted, omit it
      if (hasWorldLoreList && me.lore_node_id && !liveLore) {
        continue;
      }
      if (liveLore) {
        consumedLoreIds.add(liveLore.id);
      }

      const loc = me.location_id ? locById.get(me.location_id) : undefined;
      items.push({
        key: `me:${turn.id}`,
        turnId: turn.id,
        turnDepthIndex: turn.depth_index,
        scope: "world",
        dateLabel: me.date_label || "",
        title: liveLore?.title ?? me.title,
        summary: liveLore?.content ?? me.summary,
        keywords: liveLore?.entity_tags ?? me.keywords ?? [],
        loreNodeId: liveLore?.id ?? me.lore_node_id ?? null,
        locationId: me.location_id ?? null,
        locationName: loc?.name ?? me.location_name ?? null,
        previousDescription: null,
        updatedDescription: null,
        currentLocationTags: [],
        tagsAdded: [],
        tagsRemoved: [],
      });
    } else {
      const loc = me.location_id ? locById.get(me.location_id) : undefined;
      items.push({
        key: `me:${turn.id}`,
        turnId: turn.id,
        turnDepthIndex: turn.depth_index,
        scope: "location",
        dateLabel: me.date_label || "",
        title: me.title,
        summary: me.summary,
        keywords: me.keywords ?? [],
        loreNodeId: null,
        locationId: me.location_id ?? null,
        locationName: loc?.name ?? me.location_name ?? null,
        previousDescription: me.previous_description ?? null,
        updatedDescription: me.updated_description ?? loc?.description ?? null,
        currentLocationTags: loc?.environmental_tags ?? [],
        tagsAdded: me.tags_added ?? [],
        tagsRemoved: me.tags_removed ?? [],
      });
    }
  }

  // Include any active-branch major-event LoreNodes not already paired with a turn post_turn.major_event
  for (const ln of activeWorldLore) {
    if (!ln.is_major_event || consumedLoreIds.has(ln.id)) continue;
    const turn = ln.created_at_turn_id
      ? turnById.get(ln.created_at_turn_id)
      : undefined;
    items.push({
      key: `lore:${ln.id}`,
      turnId: turn?.id ?? ln.created_at_turn_id ?? "",
      turnDepthIndex: turn?.depth_index ?? 0,
      scope: "world",
      dateLabel: "",
      title: ln.title,
      summary: ln.content,
      keywords: ln.entity_tags ?? [],
      loreNodeId: ln.id,
      locationId: null,
      locationName: null,
      previousDescription: null,
      updatedDescription: null,
      currentLocationTags: [],
      tagsAdded: [],
      tagsRemoved: [],
    });
  }

  items.sort((a, b) => {
    if (a.turnDepthIndex !== b.turnDepthIndex) {
      return a.turnDepthIndex - b.turnDepthIndex;
    }
    return a.key.localeCompare(b.key);
  });

  return items;
}
