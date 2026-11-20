import type {
  AnyLoreCategory,
  CampaignStateBundle,
  CharacterRecord,
  CharacterStateSnapshot,
  LocationContainer,
  LocationNode,
  LoreNode,
  PersonaRecord,
  WorldLoreCategory,
} from "../../types";
import { containerHasVisitedDescendants } from "../map/mapValidation";
import { CONTAINER_DEPTH_LABELS } from "../map/topologyProjection";

export type CodexSectionId =
  | "history_culture"
  | "factions_figures"
  | "locations"
  | "items_artifacts"
  | "major_characters"
  | "rumors_threats";

export type EditableCodexSectionId =
  | "history_culture"
  | "factions_figures"
  | "items_artifacts"
  | "rumors_threats";

export type CodexSearchMatchTier = 1 | 2 | 3;

export interface CodexSectionMeta {
  id: CodexSectionId;
  label: string;
  description: string;
  accentColor: string;
  categories: WorldLoreCategory[];
  defaultCategory?: WorldLoreCategory;
  isSpecial: boolean;
  campaignOnly: boolean;
}

export const CODEX_SECTIONS: readonly CodexSectionMeta[] = [
  {
    id: "history_culture",
    label: "History & Culture",
    description: "Timelines, eras, traditions, laws, and cultural norms.",
    accentColor: "var(--accent-emerald)",
    categories: ["history", "culture"],
    defaultCategory: "history",
    isSpecial: false,
    campaignOnly: false,
  },
  {
    id: "factions_figures",
    label: "Factions & Figures",
    description: "Guilds, syndicates, governments, and notable background figures.",
    accentColor: "var(--accent-violet)",
    categories: ["faction", "figure"],
    defaultCategory: "faction",
    isSpecial: false,
    campaignOnly: false,
  },
  {
    id: "locations",
    label: "Locations",
    description: "Hierarchical atlas of mapped regions, buildings, and sites.",
    accentColor: "var(--accent-cyan)",
    categories: [],
    isSpecial: true,
    campaignOnly: false,
  },
  {
    id: "items_artifacts",
    label: "Items & Artifacts",
    description: "Plot-driving relics and legendary items linkable to character gear.",
    accentColor: "var(--accent-amber)",
    categories: ["artifact"],
    defaultCategory: "artifact",
    isSpecial: false,
    campaignOnly: false,
  },
  {
    id: "major_characters",
    label: "Major Characters",
    description: "Player persona and active campaign participants.",
    accentColor: "var(--accent-cyan)",
    categories: [],
    isSpecial: true,
    campaignOnly: true,
  },
  {
    id: "rumors_threats",
    label: "Rumors & Threats",
    description: "Whispers, unverified leads, hostile forces, plagues, and hazards.",
    accentColor: "var(--accent-amber)",
    categories: ["rumor", "threat"],
    defaultCategory: "rumor",
    isSpecial: false,
    campaignOnly: false,
  },
] as const;

const CATEGORY_TO_SECTION: Record<WorldLoreCategory, EditableCodexSectionId> = {
  history: "history_culture",
  culture: "history_culture",
  faction: "factions_figures",
  figure: "factions_figures",
  artifact: "items_artifacts",
  rumor: "rumors_threats",
  threat: "rumors_threats",
};

const CATEGORY_LABELS: Record<AnyLoreCategory, string> = {
  history: "History",
  culture: "Culture",
  faction: "Faction",
  figure: "Figure",
  artifact: "Artifact",
  rumor: "Rumor",
  threat: "Threat",
  secret: "Secret",
};

export interface CodexCampaignCharacterEntry {
  record: CharacterRecord;
  state?: CharacterStateSnapshot;
  isPresent?: boolean;
  elsewhereLocationName?: string;
  isPrimary?: boolean;
}

export interface CodexSearchHit {
  key: string;
  id: string;
  kind: "lore" | "location" | "container" | "persona" | "character";
  sectionId: CodexSectionId;
  title: string;
  subtitle?: string;
  badgeLabel: string;
  badgeClass: string;
  matchTier: CodexSearchMatchTier | 0;
  isInvalid?: boolean;
  lore?: LoreNode;
  location?: LocationNode;
  container?: LocationContainer;
  persona?: PersonaRecord;
  characterEntry?: CodexCampaignCharacterEntry;
}

export interface CodexLocationTreeNode {
  key: string;
  kind: "container" | "location";
  id: string;
  name: string;
  depth: number;
  localLoreCount: number;
  container?: LocationContainer;
  location?: LocationNode;
  children: CodexLocationTreeNode[];
  matchesDirect: boolean;
  hasMatchingDescendant: boolean;
  matchTier: CodexSearchMatchTier | 0;
}

export interface CodexLocationTreeResult {
  roots: CodexLocationTreeNode[];
  autoExpandedContainerIds: Set<string>;
}

export interface CodexMajorCharacterItem {
  key: string;
  kind: "persona" | "character";
  id: string;
  title: string;
  matchTier: CodexSearchMatchTier | 0;
  persona?: PersonaRecord;
  characterEntry?: CodexCampaignCharacterEntry;
}

export function getCodexSectionMeta(sectionId: CodexSectionId): CodexSectionMeta {
  return CODEX_SECTIONS.find((s) => s.id === sectionId) ?? CODEX_SECTIONS[0];
}

export function isEditableCodexSection(
  sectionId: CodexSectionId
): sectionId is EditableCodexSectionId {
  return (
    sectionId === "history_culture" ||
    sectionId === "factions_figures" ||
    sectionId === "items_artifacts" ||
    sectionId === "rumors_threats"
  );
}

export function getCodexSectionForCategory(
  category: AnyLoreCategory | string
): EditableCodexSectionId {
  if (category in CATEGORY_TO_SECTION) {
    return CATEGORY_TO_SECTION[category as WorldLoreCategory];
  }
  return "factions_figures";
}

export function getLoreCategoryLabel(category: AnyLoreCategory | string): string {
  if (category in CATEGORY_LABELS) {
    return CATEGORY_LABELS[category as AnyLoreCategory];
  }
  return String(category || "Lore");
}

export function getLoreDisplayTitle(title: string | undefined | null): string {
  const trimmed = (title ?? "").trim();
  return trimmed || "Untitled Entry";
}

export function compareCodexTitles(
  aTitle: string | undefined | null,
  bTitle: string | undefined | null,
  aId = "",
  bId = ""
): number {
  const cmp = getLoreDisplayTitle(aTitle).localeCompare(
    getLoreDisplayTitle(bTitle),
    undefined,
    { sensitivity: "base" }
  );
  if (cmp !== 0) return cmp;
  return aId.localeCompare(bId);
}

export function parsePendingTagDraft(raw: string | undefined | null): string[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(/[,;\n]+/)
    .map((s) => s.replace(/\s+/g, " ").trim().slice(0, 64))
    .filter(Boolean);
}

export function flushWorldLoreTags(
  existing: readonly string[] | undefined | null,
  pendingRaw?: string | null,
  maxTags = 20,
  maxTagLength = 64
): string[] {
  const additions = parsePendingTagDraft(pendingRaw);
  const result: string[] = [];
  const seenLower = new Set<string>();
  for (const item of [...(existing ?? []), ...additions]) {
    const cleaned = item.replace(/\s+/g, " ").trim().slice(0, maxTagLength);
    if (!cleaned) continue;
    const low = cleaned.toLowerCase();
    if (seenLower.has(low)) continue;
    seenLower.add(low);
    result.push(cleaned);
    if (result.length >= maxTags) break;
  }
  return result;
}

export function getWorldLoreValidationErrors(
  lore: LoreNode,
  pendingDraft?: string
): { title: boolean; content: boolean; keywords: boolean; valid: boolean } {
  const effectiveTags = flushWorldLoreTags(lore.entity_tags, pendingDraft);
  const titleMissing = !lore.title.trim();
  const contentMissing = !lore.content.trim();
  const keywordsMissing = effectiveTags.length === 0;
  return {
    title: titleMissing,
    content: contentMissing,
    keywords: keywordsMissing,
    valid: !titleMissing && !contentMissing && !keywordsMissing,
  };
}

export function isWorldLoreEntryValid(
  lore: LoreNode,
  pendingDraft?: string
): boolean {
  return getWorldLoreValidationErrors(lore, pendingDraft).valid;
}

export function countInvalidWorldLoreBySection(
  loreNodes: readonly LoreNode[],
  pendingDrafts: Record<string, string> = {}
): Record<EditableCodexSectionId, number> {
  const counts: Record<EditableCodexSectionId, number> = {
    history_culture: 0,
    factions_figures: 0,
    items_artifacts: 0,
    rumors_threats: 0,
  };
  for (const lore of loreNodes) {
    if (!isWorldLoreEntryValid(lore, pendingDrafts[lore.id])) {
      counts[getCodexSectionForCategory(lore.category)] += 1;
    }
  }
  return counts;
}

export function getVisibleScopedLore(
  loreNodes: readonly LoreNode[] | undefined | null,
  isCampaignMode: boolean
): LoreNode[] {
  if (!loreNodes || loreNodes.length === 0) return [];
  if (!isCampaignMode) return [...loreNodes];
  return loreNodes.filter((ln) => ln.category !== "secret");
}

function matchThreeTier(
  q: string,
  titleStrings: readonly (string | undefined | null)[],
  keywordStrings: readonly (string | undefined | null)[],
  contentStrings: readonly (string | undefined | null)[]
): CodexSearchMatchTier | null {
  if (!q) return null;
  if (titleStrings.some((s) => (s ?? "").toLowerCase().includes(q))) {
    return 1;
  }
  if (keywordStrings.some((s) => (s ?? "").toLowerCase().includes(q))) {
    return 2;
  }
  if (contentStrings.some((s) => (s ?? "").toLowerCase().includes(q))) {
    return 3;
  }
  return null;
}

function applyFrozenOrder<T extends { id: string }>(
  items: T[],
  frozenOrderIds: readonly string[] | null | undefined,
  defaultSort: (a: T, b: T) => number
): T[] {
  if (!frozenOrderIds || frozenOrderIds.length === 0) {
    return [...items].sort(defaultSort);
  }
  const rankById = new Map<string, number>();
  frozenOrderIds.forEach((id, idx) => rankById.set(id, idx));
  return [...items].sort((a, b) => {
    const ra = rankById.get(a.id);
    const rb = rankById.get(b.id);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return defaultSort(a, b);
  });
}

export function filterAndRankWorldLore(
  loreNodes: readonly LoreNode[],
  opts: {
    sectionId?: EditableCodexSectionId;
    query?: string;
    pendingDrafts?: Record<string, string>;
    frozenOrderIds?: readonly string[] | null;
  } = {}
): Array<{ lore: LoreNode; matchTier: CodexSearchMatchTier | 0; isInvalid: boolean }> {
  const { sectionId, query = "", pendingDrafts = {}, frozenOrderIds } = opts;
  const q = query.trim().toLowerCase();

  const scoped = sectionId
    ? loreNodes.filter((ln) => getCodexSectionForCategory(ln.category) === sectionId)
    : [...loreNodes];

  const matched: Array<{
    id: string;
    lore: LoreNode;
    matchTier: CodexSearchMatchTier | 0;
    isInvalid: boolean;
  }> = [];

  for (const lore of scoped) {
    const isInvalid = !isWorldLoreEntryValid(lore, pendingDrafts[lore.id]);
    if (!q) {
      matched.push({ id: lore.id, lore, matchTier: 0, isInvalid });
      continue;
    }
    const keywords = flushWorldLoreTags(lore.entity_tags, pendingDrafts[lore.id]);
    const tier = matchThreeTier(q, [lore.title], keywords, [lore.content]);
    if (tier !== null) {
      matched.push({ id: lore.id, lore, matchTier: tier, isInvalid });
    }
  }

  return applyFrozenOrder(matched, frozenOrderIds, (a, b) => {
    if (a.matchTier !== b.matchTier) return a.matchTier - b.matchTier;
    return compareCodexTitles(a.lore.title, b.lore.title, a.lore.id, b.lore.id);
  }).map(({ lore, matchTier, isInvalid }) => ({ lore, matchTier, isInvalid }));
}

export function searchAllCodexEntries(opts: {
  loreNodes: readonly LoreNode[];
  containers: readonly LocationContainer[];
  locations: readonly LocationNode[];
  activePersona?: PersonaRecord | null;
  campaignCharacters?: readonly CodexCampaignCharacterEntry[];
  pendingDrafts?: Record<string, string>;
  query: string;
  isCampaignMode: boolean;
  frozenOrderIds?: readonly string[] | null;
}): CodexSearchHit[] {
  const {
    loreNodes,
    containers,
    locations,
    activePersona,
    campaignCharacters = [],
    pendingDrafts = {},
    query,
    isCampaignMode,
    frozenOrderIds,
  } = opts;
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const hits: CodexSearchHit[] = [];

  for (const lore of loreNodes) {
    const keywords = isCampaignMode
      ? lore.entity_tags
      : flushWorldLoreTags(lore.entity_tags, pendingDrafts[lore.id]);
    const tier = matchThreeTier(q, [lore.title], keywords, [lore.content]);
    if (tier === null) continue;
    const sectionId = getCodexSectionForCategory(lore.category);
    hits.push({
      key: `lore:${lore.id}`,
      id: lore.id,
      kind: "lore",
      sectionId,
      title: getLoreDisplayTitle(lore.title),
      subtitle: getCodexSectionMeta(sectionId).label,
      badgeLabel: getLoreCategoryLabel(lore.category),
      badgeClass: `lore-cat-badge--${lore.category}`,
      matchTier: tier,
      isInvalid: isCampaignMode
        ? false
        : !isWorldLoreEntryValid(lore, pendingDrafts[lore.id]),
      lore,
    });
  }

  for (const cont of containers) {
    const localLore =
      cont.depth === 1 ? getVisibleScopedLore(cont.lore_nodes, isCampaignMode) : [];
    const contentFields = [
      cont.description,
      ...localLore.flatMap((ln) => [ln.title, ...ln.entity_tags, ln.content]),
    ];
    const tier = matchThreeTier(
      q,
      [cont.name],
      cont.environmental_tags ?? [],
      contentFields
    );
    if (tier === null) continue;
    const depthLabel = CONTAINER_DEPTH_LABELS[cont.depth] ?? `Level ${cont.depth}`;
    hits.push({
      key: `container:${cont.id}`,
      id: cont.id,
      kind: "container",
      sectionId: "locations",
      title: cont.name.trim() || "Unnamed Area",
      subtitle: `Locations · L${cont.depth} ${depthLabel}`,
      badgeLabel: `Area L${cont.depth}`,
      badgeClass: "codex-badge--location",
      matchTier: tier,
      container: cont,
    });
  }

  for (const loc of locations) {
    const localLore = getVisibleScopedLore(loc.lore_nodes, isCampaignMode);
    const contentFields = [
      loc.summary,
      loc.description,
      ...localLore.flatMap((ln) => [ln.title, ...ln.entity_tags, ln.content]),
    ];
    const tier = matchThreeTier(
      q,
      [loc.name],
      loc.environmental_tags ?? [],
      contentFields
    );
    if (tier === null) continue;
    hits.push({
      key: `location:${loc.id}`,
      id: loc.id,
      kind: "location",
      sectionId: "locations",
      title: loc.name.trim() || "Unnamed Location",
      subtitle: "Locations",
      badgeLabel: "Location",
      badgeClass: "codex-badge--location",
      matchTier: tier,
      location: loc,
    });
  }

  if (isCampaignMode) {
    if (activePersona) {
      const tier = matchThreeTier(
        q,
        [activePersona.name],
        activePersona.tags ?? [],
        [activePersona.tagline, activePersona.persona_bio, activePersona.species]
      );
      if (tier !== null) {
        hits.push({
          key: `persona:${activePersona.id}`,
          id: `persona:${activePersona.id}`,
          kind: "persona",
          sectionId: "major_characters",
          title: activePersona.name,
          subtitle: "Major Characters",
          badgeLabel: "Persona",
          badgeClass: "codex-badge--persona",
          matchTier: tier,
          persona: activePersona,
        });
      }
    }

    for (const entry of campaignCharacters) {
      const rec = entry.record;
      // Campaign spoiler exclusion: only match public/canonical fields, never GM internals
      const tier = matchThreeTier(
        q,
        [rec.name],
        [...(rec.tags ?? []), ...(rec.communication_style ?? [])],
        [rec.tagline, rec.character_bio, rec.species]
      );
      if (tier === null) continue;
      hits.push({
        key: `character:${rec.id}`,
        id: rec.id,
        kind: "character",
        sectionId: "major_characters",
        title: rec.name,
        subtitle: "Major Characters",
        badgeLabel: "Character",
        badgeClass: "codex-badge--character",
        matchTier: tier,
        characterEntry: entry,
      });
    }
  }

  return applyFrozenOrder(hits, frozenOrderIds, (a, b) => {
    if (a.matchTier !== b.matchTier) return a.matchTier - b.matchTier;
    return compareCodexTitles(a.title, b.title, a.key, b.key);
  });
}

export function buildCodexLocationTree(
  containers: readonly LocationContainer[],
  locations: readonly LocationNode[],
  opts: { query?: string; isCampaignMode: boolean }
): CodexLocationTreeResult {
  const { query = "", isCampaignMode } = opts;
  const q = query.trim().toLowerCase();

  const containerById = new Map<string, LocationContainer>();
  for (const cont of containers) {
    containerById.set(cont.id, cont);
  }

  const childrenContainersByParent = new Map<string | null, LocationContainer[]>();
  const isReachableWithoutCycle = (startId: string): boolean => {
    const visited = new Set<string>([startId]);
    let curr = containerById.get(startId)?.parent_container_id ?? null;
    while (curr && containerById.has(curr)) {
      if (visited.has(curr)) return false;
      visited.add(curr);
      curr = containerById.get(curr)?.parent_container_id ?? null;
    }
    return true;
  };

  // Detect any cyclic parent pointers and break them safely to root
  const safeParentByContId = new Map<string, string | null>();
  for (const cont of containers) {
    const rawParent = cont.parent_container_id ?? null;
    if (!rawParent || rawParent === cont.id || !containerById.has(rawParent)) {
      safeParentByContId.set(cont.id, null);
    } else if (!isReachableWithoutCycle(cont.id)) {
      // Break cycle deterministically by promoting lowest depth / lexicographical ID to root
      safeParentByContId.set(cont.id, null);
    } else {
      safeParentByContId.set(cont.id, rawParent);
    }
  }

  for (const cont of containers) {
    const parentId = safeParentByContId.get(cont.id) ?? null;
    if (!childrenContainersByParent.has(parentId)) {
      childrenContainersByParent.set(parentId, []);
    }
    childrenContainersByParent.get(parentId)!.push(cont);
  }

  const locationsByContainer = new Map<string | null, LocationNode[]>();
  for (const loc of locations) {
    const cid =
      loc.container_id && containerById.has(loc.container_id)
        ? loc.container_id
        : null;
    if (!locationsByContainer.has(cid)) {
      locationsByContainer.set(cid, []);
    }
    locationsByContainer.get(cid)!.push(loc);
  }

  const autoExpandedContainerIds = new Set<string>();
  const builtContainerIds = new Set<string>();

  const buildLocationNode = (loc: LocationNode): CodexLocationTreeNode => {
    const localLore = getVisibleScopedLore(loc.lore_nodes, isCampaignMode);
    const tier = q
      ? matchThreeTier(
          q,
          [loc.name],
          loc.environmental_tags ?? [],
          [
            loc.summary,
            loc.description,
            ...localLore.flatMap((ln) => [ln.title, ...ln.entity_tags, ln.content]),
          ]
        )
      : null;
    return {
      key: `location:${loc.id}`,
      kind: "location",
      id: loc.id,
      name: loc.name,
      depth: 0,
      localLoreCount: localLore.length,
      location: loc,
      children: [],
      matchesDirect: q ? tier !== null : true,
      hasMatchingDescendant: false,
      matchTier: tier ?? 0,
    };
  };

  const buildContainerNode = (cont: LocationContainer): CodexLocationTreeNode | null => {
    if (builtContainerIds.has(cont.id)) return null;
    builtContainerIds.add(cont.id);

    const childConts = (childrenContainersByParent.get(cont.id) ?? [])
      .slice()
      .sort((a, b) => compareCodexTitles(a.name, b.name, a.id, b.id));
    const childLocs = (locationsByContainer.get(cont.id) ?? [])
      .slice()
      .sort((a, b) => compareCodexTitles(a.name, b.name, a.id, b.id));

    const children: CodexLocationTreeNode[] = [];
    for (const cc of childConts) {
      const built = buildContainerNode(cc);
      if (built) children.push(built);
    }
    for (const cl of childLocs) {
      const built = buildLocationNode(cl);
      if (!q || built.matchesDirect) {
        children.push(built);
      }
    }

    children.sort((a, b) => compareCodexTitles(a.name, b.name, a.key, b.key));

    const localLore =
      cont.depth === 1 ? getVisibleScopedLore(cont.lore_nodes, isCampaignMode) : [];
    const tier = q
      ? matchThreeTier(
          q,
          [cont.name],
          cont.environmental_tags ?? [],
          [
            cont.description,
            ...localLore.flatMap((ln) => [ln.title, ...ln.entity_tags, ln.content]),
          ]
        )
      : null;
    const matchesDirect = q ? tier !== null : true;
    const hasMatchingDescendant = q
      ? children.some((c) => c.matchesDirect || c.hasMatchingDescendant)
      : children.length > 0;

    if (q && !matchesDirect && !hasMatchingDescendant) {
      return null;
    }
    if (q && hasMatchingDescendant) {
      autoExpandedContainerIds.add(cont.id);
    }

    return {
      key: `container:${cont.id}`,
      kind: "container",
      id: cont.id,
      name: cont.name,
      depth: cont.depth,
      localLoreCount: localLore.length,
      container: cont,
      children,
      matchesDirect,
      hasMatchingDescendant,
      matchTier: tier ?? 0,
    };
  };

  const rootContainers = (childrenContainersByParent.get(null) ?? [])
    .slice()
    .sort((a, b) => compareCodexTitles(a.name, b.name, a.id, b.id));
  const rootLocations = (locationsByContainer.get(null) ?? [])
    .slice()
    .sort((a, b) => compareCodexTitles(a.name, b.name, a.id, b.id));

  const roots: CodexLocationTreeNode[] = [];
  for (const rc of rootContainers) {
    const built = buildContainerNode(rc);
    if (built) roots.push(built);
  }
  for (const rl of rootLocations) {
    const built = buildLocationNode(rl);
    if (!q || built.matchesDirect) {
      roots.push(built);
    }
  }
  roots.sort((a, b) => compareCodexTitles(a.name, b.name, a.key, b.key));

  return { roots, autoExpandedContainerIds };
}

export function flattenVisibleLocationTree(
  roots: readonly CodexLocationTreeNode[],
  expandedIds: ReadonlySet<string>
): CodexLocationTreeNode[] {
  const flat: CodexLocationTreeNode[] = [];
  const visit = (nodes: readonly CodexLocationTreeNode[]) => {
    for (const node of nodes) {
      flat.push(node);
      if (node.kind === "container" && expandedIds.has(node.id)) {
        visit(node.children);
      }
    }
  };
  visit(roots);
  return flat;
}

export function collectAllContainerIds(
  roots: readonly CodexLocationTreeNode[]
): string[] {
  const ids: string[] = [];
  const visit = (nodes: readonly CodexLocationTreeNode[]) => {
    for (const node of nodes) {
      if (node.kind === "container") {
        ids.push(node.id);
        visit(node.children);
      }
    }
  };
  visit(roots);
  return ids;
}

export function isCodexLocationImageVisible(
  loc: LocationNode,
  isCampaignMode: boolean
): boolean {
  if (!loc.image_url) return false;
  if (!isCampaignMode) return true;
  return Boolean(loc.is_visited);
}

export function isCodexContainerImageVisible(
  cont: LocationContainer,
  containers: readonly LocationContainer[],
  locations: readonly LocationNode[],
  visitedContainerIds: readonly string[],
  isCampaignMode: boolean
): boolean {
  if (!cont.image_url) return false;
  if (!isCampaignMode) return true;
  return (
    visitedContainerIds.includes(cont.id) ||
    containerHasVisitedDescendants(
      cont.id,
      containers as LocationContainer[],
      locations as LocationNode[]
    )
  );
}

export function buildCodexMajorCharacterList(
  activePersona: PersonaRecord | null | undefined,
  campaignCharacters: readonly CodexCampaignCharacterEntry[],
  query = ""
): CodexMajorCharacterItem[] {
  const q = query.trim().toLowerCase();
  const items: CodexMajorCharacterItem[] = [];

  if (activePersona) {
    const tier = q
      ? matchThreeTier(
          q,
          [activePersona.name],
          activePersona.tags ?? [],
          [activePersona.tagline, activePersona.persona_bio, activePersona.species]
        )
      : null;
    if (!q || tier !== null) {
      items.push({
        key: `persona:${activePersona.id}`,
        kind: "persona",
        id: `persona:${activePersona.id}`,
        title: activePersona.name,
        matchTier: tier ?? 0,
        persona: activePersona,
      });
    }
  }

  const charItems: CodexMajorCharacterItem[] = [];
  for (const entry of campaignCharacters) {
    const rec = entry.record;
    const tier = q
      ? matchThreeTier(
          q,
          [rec.name],
          [...(rec.tags ?? []), ...(rec.communication_style ?? [])],
          [rec.tagline, rec.character_bio, rec.species]
        )
      : null;
    if (q && tier === null) continue;
    charItems.push({
      key: `character:${rec.id}`,
      kind: "character",
      id: rec.id,
      title: rec.name,
      matchTier: tier ?? 0,
      characterEntry: entry,
    });
  }

  charItems.sort((a, b) => {
    if (a.matchTier !== b.matchTier) return a.matchTier - b.matchTier;
    return compareCodexTitles(a.title, b.title, a.id, b.id);
  });

  return [...items, ...charItems];
}

/** Resolve active campaign participant entries from CampaignStateBundle + catalog records. */
export function buildCampaignCharacterEntries(
  bundle: CampaignStateBundle,
  primaryCharacter: CharacterRecord,
  participants?: readonly CharacterRecord[]
): CodexCampaignCharacterEntry[] {
  const byId = new Map<string, CharacterRecord>();
  for (const c of participants ?? []) byId.set(c.id, c);
  byId.set(primaryCharacter.id, primaryCharacter);

  const ids = bundle.campaign.participant_character_ids?.length
    ? bundle.campaign.participant_character_ids
    : [bundle.campaign.character_id];
  const orderedIds = [
    primaryCharacter.id,
    ...ids.filter((id) => id !== primaryCharacter.id),
  ];
  const hasExplicitPresentIds = bundle.present_character_ids !== undefined;
  const presentIds = new Set(bundle.present_character_ids ?? []);
  const locNames = new Map(
    bundle.visible_locations.map((l) => [l.id, l.name])
  );
  const activeLocId = bundle.active_location.id;

  return orderedIds.flatMap((id) => {
    const record = bundle.character_records?.[id] ?? byId.get(id);
    const state =
      bundle.character_states?.[id] ??
      (id === primaryCharacter.id ? bundle.current_character_state : undefined);
    if (!record || !state) return [];
    const isPresent = hasExplicitPresentIds
      ? presentIds.has(id)
      : state.current_location_id === activeLocId;
    return [
      {
        record,
        state,
        isPresent,
        elsewhereLocationName: locNames.get(state.current_location_id),
        isPrimary: record.id === primaryCharacter.id,
      },
    ];
  });
}
