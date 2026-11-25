import type { MechanicsSubcategoryId, MechanicsTopicId } from "../../../types";
import {
  MECHANICS_ARTICLES,
  MECHANICS_SUBCATEGORIES,
  type MechanicsArticle,
  type MechanicsSubcategoryMeta,
} from "./mechanicsCatalog";

export const DEFAULT_MECHANICS_SUBCATEGORY_ID: MechanicsSubcategoryId = "care";
export const DEFAULT_MECHANICS_TOPIC_ID: MechanicsTopicId = "care-overview";

export interface MechanicsTreeArticleNode {
  key: string;
  kind: "article";
  topicId: MechanicsTopicId;
  title: string;
  subcategoryId: MechanicsSubcategoryId;
  article: MechanicsArticle;
  matchTier: 0 | 1 | 2 | 3;
}

export interface MechanicsTreeGroupNode {
  key: string;
  kind: "subcategory";
  subcategoryId: MechanicsSubcategoryId;
  subcategory: MechanicsSubcategoryMeta;
  children: MechanicsTreeArticleNode[];
  matchesDirect: boolean;
  hasMatchingDescendant: boolean;
}

export interface MechanicsTreeResult {
  roots: MechanicsTreeGroupNode[];
  autoExpandedSubcategoryIds: Set<MechanicsSubcategoryId>;
}

export interface MechanicsSearchHit {
  key: string;
  topicId: MechanicsTopicId;
  title: string;
  subcategoryId: MechanicsSubcategoryId;
  subcategoryLabel: string;
  badgeLabel: string;
  matchTier: 1 | 2 | 3;
  article: MechanicsArticle;
}

const SUBCATEGORY_BY_ID = new Map<MechanicsSubcategoryId, MechanicsSubcategoryMeta>(
  MECHANICS_SUBCATEGORIES.map((s) => [s.id, s])
);

const ARTICLE_BY_ID = new Map<MechanicsTopicId, MechanicsArticle>(
  MECHANICS_ARTICLES.map((a) => [a.id, a])
);

const CATALOG_INDEX_BY_ID = new Map<MechanicsTopicId, number>(
  MECHANICS_ARTICLES.map((a, idx) => [a.id, idx])
);

export function getMechanicsSubcategoryMeta(
  id: MechanicsSubcategoryId
): MechanicsSubcategoryMeta {
  return SUBCATEGORY_BY_ID.get(id) ?? MECHANICS_SUBCATEGORIES[0];
}

export function getMechanicsArticle(
  topicId: MechanicsTopicId | string | null | undefined
): MechanicsArticle | undefined {
  if (!topicId) return undefined;
  return ARTICLE_BY_ID.get(topicId as MechanicsTopicId);
}

export function extractMechanicsTopicIdFromKey(
  key: string | null | undefined
): MechanicsTopicId | null {
  if (!key || !key.startsWith("mechanics:")) return null;
  const raw = key.slice("mechanics:".length);
  return ARTICLE_BY_ID.has(raw as MechanicsTopicId)
    ? (raw as MechanicsTopicId)
    : null;
}

export const ORDERED_MECHANICS_ARTICLES: readonly MechanicsArticle[] =
  MECHANICS_SUBCATEGORIES.flatMap((subcat) =>
    MECHANICS_ARTICLES.filter((a) => a.subcategoryId === subcat.id)
  );

/**
 * Returns the previous and next Game Mechanics guides in subcategory reading order
 * for compact mobile reader pagination.
 */
export function getAdjacentMechanicsTopics(topicId: MechanicsTopicId): {
  prev: MechanicsArticle | null;
  next: MechanicsArticle | null;
} {
  const idx = ORDERED_MECHANICS_ARTICLES.findIndex((a) => a.id === topicId);
  if (idx === -1) return { prev: null, next: null };
  return {
    prev: idx > 0 ? ORDERED_MECHANICS_ARTICLES[idx - 1] : null,
    next:
      idx < ORDERED_MECHANICS_ARTICLES.length - 1
        ? ORDERED_MECHANICS_ARTICLES[idx + 1]
        : null,
  };
}

function matchArticleThreeTier(
  q: string,
  article: MechanicsArticle,
  subcategory: MechanicsSubcategoryMeta
): 1 | 2 | 3 | null {
  if (!q) return null;
  const titleFields = [article.title, article.shortTitle ?? ""];
  if (titleFields.some((s) => s.toLowerCase().includes(q))) {
    return 1;
  }
  const keywordFields = [
    ...article.keywords,
    subcategory.label,
    subcategory.shortLabel,
  ];
  if (keywordFields.some((s) => s.toLowerCase().includes(q))) {
    return 2;
  }
  const contentFields = [
    article.inOneLine,
    ...(article.scales ?? []).flatMap((sc) => [sc.label, sc.rangeOrTag, sc.meaning]),
    ...article.howItChanges,
    ...article.effectOnPlay,
    ...(article.underTheHood
      ? [
          article.underTheHood.summary,
          ...article.underTheHood.items.flatMap((it) => [
            it.label,
            it.value,
            it.detail ?? "",
          ]),
        ]
      : []),
  ];
  if (contentFields.some((s) => s.toLowerCase().includes(q))) {
    return 3;
  }
  return null;
}

/** Build the 2-level Game Mechanics tree (Subcategory Group -> Article Leaves). */
export function buildMechanicsTree(query = ""): MechanicsTreeResult {
  const q = query.trim().toLowerCase();
  const autoExpandedSubcategoryIds = new Set<MechanicsSubcategoryId>();
  const roots: MechanicsTreeGroupNode[] = [];

  for (const subcat of MECHANICS_SUBCATEGORIES) {
    const articles = MECHANICS_ARTICLES.filter(
      (a) => a.subcategoryId === subcat.id
    );
    const subcatMatches = q
      ? subcat.label.toLowerCase().includes(q) ||
        subcat.shortLabel.toLowerCase().includes(q) ||
        subcat.description.toLowerCase().includes(q)
      : false;

    const children: MechanicsTreeArticleNode[] = [];
    for (const article of articles) {
      const tier = q ? matchArticleThreeTier(q, article, subcat) : null;
      if (q && tier === null && !subcatMatches) {
        continue;
      }
      children.push({
        key: `mechanics:${article.id}`,
        kind: "article",
        topicId: article.id,
        title: article.shortTitle ?? article.title,
        subcategoryId: subcat.id,
        article,
        matchTier: tier ?? (subcatMatches ? 2 : 0),
      });
    }

    if (q && children.length === 0) {
      continue;
    }

    if (q && children.length > 0) {
      autoExpandedSubcategoryIds.add(subcat.id);
    }

    roots.push({
      key: `mechanics-group:${subcat.id}`,
      kind: "subcategory",
      subcategoryId: subcat.id,
      subcategory: subcat,
      children,
      matchesDirect: q ? subcatMatches : true,
      hasMatchingDescendant: children.length > 0,
    });
  }

  return { roots, autoExpandedSubcategoryIds };
}

/** Flatten currently expanded Mechanics articles for keyboard traversal and selection. */
export function flattenVisibleMechanicsTree(
  roots: readonly MechanicsTreeGroupNode[],
  expandedSubcategoryIds: ReadonlySet<MechanicsSubcategoryId>
): MechanicsTreeArticleNode[] {
  const flat: MechanicsTreeArticleNode[] = [];
  for (const group of roots) {
    if (expandedSubcategoryIds.has(group.subcategoryId)) {
      for (const child of group.children) {
        flat.push(child);
      }
    }
  }
  return flat;
}

export function collectAllMechanicsSubcategoryIds(
  roots: readonly MechanicsTreeGroupNode[]
): MechanicsSubcategoryId[] {
  return roots.map((g) => g.subcategoryId);
}

/** Search Game Mechanics entries separately so Global Search keeps world lore ranked first. */
export function searchMechanicsArticles(query: string): MechanicsSearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const hits: MechanicsSearchHit[] = [];
  for (const article of MECHANICS_ARTICLES) {
    const subcat = getMechanicsSubcategoryMeta(article.subcategoryId);
    const tier = matchArticleThreeTier(q, article, subcat);
    if (tier === null) continue;
    hits.push({
      key: `mechanics:${article.id}`,
      topicId: article.id,
      title: article.title,
      subcategoryId: article.subcategoryId,
      subcategoryLabel: subcat.label,
      badgeLabel: subcat.shortLabel,
      matchTier: tier,
      article,
    });
  }

  hits.sort((a, b) => {
    if (a.matchTier !== b.matchTier) return a.matchTier - b.matchTier;
    return (
      (CATALOG_INDEX_BY_ID.get(a.topicId) ?? 0) -
      (CATALOG_INDEX_BY_ID.get(b.topicId) ?? 0)
    );
  });

  return hits;
}
