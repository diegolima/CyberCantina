import React, { useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Eye,
  EyeOff,
  MapPin,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import {
  CharacterRecord,
  LocationContainer,
  LocationNode,
  LoreNode,
  RecalledMemoryItem,
  WorldRecord,
} from "../../types";
import { useModalDialog } from "../../hooks/useModalDialog";
import { useOverlayBackHandler } from "../../hooks/useOverlayBackHandler";
import { isSecretLoreRevealed } from "../world/codexHelpers";

type IndexFilter =
  | "all"
  | "shards"
  | "world_lore"
  | "location_lore"
  | "container_lore";

export interface LoreIndexEntry {
  key: string;
  kind: "shard" | "world_lore" | "location_lore" | "container_lore";
  group: string;
  tag: string;
  title: string;
  content: string;
  tags?: string[];
  recalled: boolean;
  ambientActive?: boolean;
  isSecret?: boolean;
  isRevealed?: boolean;
}

type IndexEntry = LoreIndexEntry;

export interface BuildLoreIndexOptions {
  world: WorldRecord;
  /** Campaign Copy-on-Write world lore override when available (falls back to world.lore_nodes). */
  worldLoreNodes?: LoreNode[];
  characters: CharacterRecord[];
  /** Campaign-resolved visible locations (falls back to world.locations). */
  locations?: LocationNode[];
  /** Campaign-resolved containers including CoW container lore overrides (falls back to world.containers). */
  containers?: LocationContainer[];
  activeLocationId?: string;
  /** Items injected into the prompt on the inspected turn, highlighted in the list. */
  recalledItems: RecalledMemoryItem[];
  /** When false (Player Mode), unrevealed category="secret" lore entries are hidden. */
  unlockLore?: boolean;
  /** Secret lore IDs revealed on the active branch. */
  revealedLoreIds?: readonly string[];
}

export interface LoreIndexPanelProps {
  world: WorldRecord;
  worldLoreNodes?: LoreNode[];
  characters: CharacterRecord[];
  locations?: LocationNode[];
  containers?: LocationContainer[];
  activeLocationId?: string;
  recalledItems: RecalledMemoryItem[];
  unlockLore?: boolean;
  revealedLoreIds?: readonly string[];
  embedded?: boolean;
  autoFocusSearch?: boolean;
}

interface LoreIndexModalProps extends Omit<LoreIndexPanelProps, "embedded" | "autoFocusSearch"> {
  onClose: () => void;
}

const norm = (s: string) => s.trim().toLowerCase();

export function buildLoreIndexEntries(opts: BuildLoreIndexOptions): LoreIndexEntry[] {
  const {
    world,
    worldLoreNodes,
    characters,
    locations,
    containers,
    activeLocationId,
    recalledItems,
    unlockLore = false,
    revealedLoreIds = [],
  } = opts;
  const recalledLoreIds = new Set(
    recalledItems.filter((r) => r.source_type === "lore").map((r) => r.id)
  );
  const recalledLoreTitles = new Set(
    recalledItems.filter((r) => r.source_type === "lore").map((r) => norm(r.title))
  );
  const recalledLocLoreIds = new Set(
    recalledItems
      .filter((r) => r.source_type === "location_lore")
      .map((r) => r.id)
  );
  const recalledLocLoreTitles = new Set(
    recalledItems
      .filter((r) => r.source_type === "location_lore")
      .map((r) => norm(r.title))
  );
  const recalledContLoreIds = new Set(
    recalledItems
      .filter((r) => r.source_type === "container_lore")
      .map((r) => r.id)
  );
  const recalledContLoreTitles = new Set(
    recalledItems
      .filter((r) => r.source_type === "container_lore")
      .map((r) => norm(r.title))
  );
  const recalledShardTitles = new Set(
    recalledItems
      .filter((r) => r.source_type === "character_shard")
      .map((r) => norm(r.title))
  );

  const list: LoreIndexEntry[] = [];
  for (const ch of characters) {
    ch.memory_shards.forEach((shard, i) => {
      const tierLabel =
        shard.origin === "clerk_ephemeral"
          ? "Ephemeral"
          : shard.origin === "clerk_promoted"
            ? "Promoted"
            : shard.origin === "compacted"
              ? "Compacted"
              : "Shard";
      const tag = shard.significance
        ? `${tierLabel} · ${shard.significance}`
        : tierLabel;
      list.push({
        key: `shard-${ch.id}-${shard.id || i}`,
        kind: "shard",
        group: `${ch.name} — Memory Shards`,
        tag,
        title: shard.title,
        content: shard.content,
        recalled: recalledShardTitles.has(norm(shard.title)),
      });
    });
  }

  const effectiveWorldLore = worldLoreNodes ?? world.lore_nodes ?? [];
  for (const lore of effectiveWorldLore) {
    const isSecret = lore.category === "secret";
    const isRevealed = isSecret && isSecretLoreRevealed(lore, revealedLoreIds);
    if (isSecret && !unlockLore && !isRevealed) continue;
    list.push({
      key: `lore-${lore.id}`,
      kind: "world_lore",
      group: `${world.name} — World Lore`,
      tag: lore.category,
      title: lore.title,
      content: lore.content,
      tags: lore.entity_tags,
      recalled:
        recalledLoreIds.has(lore.id) || recalledLoreTitles.has(norm(lore.title)),
      isSecret,
      isRevealed,
    });
  }

  const resolvedLocations = locations ?? world.locations ?? [];
  for (const loc of resolvedLocations) {
    const isCurrent = loc.id === activeLocationId;
    for (const lore of loc.lore_nodes ?? []) {
      const isSecret = lore.category === "secret";
      const isRevealed = isSecret && isSecretLoreRevealed(lore, revealedLoreIds);
      if (isSecret && !unlockLore && !isRevealed) continue;
      const compositeTitle = `${loc.name} — ${lore.title}`;
      list.push({
        key: `loc-lore-${loc.id}-${lore.id}`,
        kind: "location_lore",
        group: `${loc.name}${isCurrent ? " (Current Location)" : ""} — Location Lore`,
        tag: lore.category,
        title: lore.title,
        content: lore.content,
        tags: lore.entity_tags,
        recalled:
          recalledLocLoreIds.has(lore.id) ||
          recalledLocLoreTitles.has(norm(lore.title)) ||
          recalledLocLoreTitles.has(norm(compositeTitle)),
        ambientActive: isCurrent,
        isSecret,
        isRevealed,
      });
    }
  }

  const resolvedContainers = containers ?? world.containers ?? [];
  const activeLoc = resolvedLocations.find((l) => l.id === activeLocationId);
  const activeContainerId = activeLoc?.container_id ?? null;
  for (const cont of resolvedContainers) {
    if (cont.depth !== 1) continue;
    const isActiveCont = cont.id === activeContainerId;
    for (const lore of cont.lore_nodes ?? []) {
      const isSecret = lore.category === "secret";
      const isRevealed = isSecret && isSecretLoreRevealed(lore, revealedLoreIds);
      if (isSecret && !unlockLore && !isRevealed) continue;
      const compositeTitle = `${cont.name} — ${lore.title}`;
      list.push({
        key: `cont-lore-${cont.id}-${lore.id}`,
        kind: "container_lore",
        group: `${cont.name}${isActiveCont ? " (Active Building/Container)" : ""} — Container Lore`,
        tag: lore.category,
        title: lore.title,
        content: lore.content,
        tags: lore.entity_tags,
        recalled:
          recalledContLoreIds.has(lore.id) ||
          recalledContLoreTitles.has(norm(lore.title)) ||
          recalledContLoreTitles.has(norm(compositeTitle)),
        ambientActive: isActiveCont,
        isSecret,
        isRevealed,
      });
    }
  }
  return list;
}

/** Searchable, spoiler-gated Shards & Lore Index panel (embeddable or standalone). */
export const LoreIndexPanel: React.FC<LoreIndexPanelProps> = ({
  world,
  worldLoreNodes,
  characters,
  locations,
  containers,
  activeLocationId,
  recalledItems,
  unlockLore = false,
  revealedLoreIds = [],
  embedded = false,
  autoFocusSearch = false,
}) => {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<IndexFilter>("all");

  const entries = useMemo<IndexEntry[]>(
    () =>
      buildLoreIndexEntries({
        world,
        worldLoreNodes,
        characters,
        locations,
        containers,
        activeLocationId,
        recalledItems,
        unlockLore,
        revealedLoreIds,
      }),
    [
      world,
      worldLoreNodes,
      characters,
      locations,
      containers,
      activeLocationId,
      recalledItems,
      unlockLore,
      revealedLoreIds,
    ]
  );

  const filtered = useMemo(() => {
    const q = norm(query);
    return entries.filter((e) => {
      if (filter === "shards" && e.kind !== "shard") return false;
      if (filter === "world_lore" && e.kind !== "world_lore") return false;
      if (filter === "location_lore" && e.kind !== "location_lore") return false;
      if (filter === "container_lore" && e.kind !== "container_lore") return false;
      if (!q) return true;
      return (
        e.title.toLowerCase().includes(q) ||
        e.content.toLowerCase().includes(q) ||
        e.tag.toLowerCase().includes(q) ||
        e.group.toLowerCase().includes(q) ||
        (e.tags ?? []).some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [entries, filter, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, IndexEntry[]>();
    for (const e of filtered) {
      if (!map.has(e.group)) map.set(e.group, []);
      map.get(e.group)!.push(e);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const shardCount = entries.filter((e) => e.kind === "shard").length;
  const worldLoreCount = entries.filter((e) => e.kind === "world_lore").length;
  const locationLoreCount = entries.filter((e) => e.kind === "location_lore").length;
  const containerLoreCount = entries.filter((e) => e.kind === "container_lore").length;

  return (
    <div className={embedded ? "lore-index-panel" : undefined}>
      <div
        className={`lore-index-toolbar${
          embedded ? " lore-index-toolbar--embedded" : ""
        }`}
      >
        <div className="lore-index-search-row">
          <div className="ui-search-wrap" style={{ flex: 1 }}>
            <Search size={13} className="ui-search-icon" />
            <input
              autoFocus={autoFocusSearch}
              className="ui-search-input"
              placeholder="Search titles, content, keywords, or locations..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {unlockLore && (
            <span
              className="lore-index-gm-pill"
              title="Unlock Lore & Secrets (GM Mode) is active — unrevealed secrets are visible."
            >
              <Eye size={11} />
              <span>GM Mode · Secrets Unlocked</span>
            </span>
          )}
        </div>
        <div className="lore-index-filters" role="tablist" aria-label="Lore index category filter">
          {(
            [
              ["all", `All (${entries.length})`],
              ["shards", `Shards (${shardCount})`],
              ["world_lore", `World (${worldLoreCount})`],
              ["container_lore", `Containers (${containerLoreCount})`],
              ["location_lore", `Locations (${locationLoreCount})`],
            ] as Array<[IndexFilter, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={filter === value}
              className={`lore-index-chip ${filter === value ? "active" : ""}`}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className={embedded ? "lore-index-panel-list" : "modal-body"}>
        {grouped.length === 0 && (
          <div className="inspector-empty">No entries match your search.</div>
        )}
        {grouped.map(([group, items]) => (
          <div key={group} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="sidebar-label" style={{ marginBottom: 2 }}>
              {group} ({items.length})
            </div>
            {items.map((item) => (
              <div
                key={item.key}
                className={`memory-item ${
                  item.kind === "shard"
                    ? "memory-item-shard"
                    : item.kind === "location_lore"
                      ? "memory-item-location_lore"
                      : item.kind === "container_lore"
                        ? "memory-item-container_lore"
                        : "memory-item-lore"
                }`}
              >
                <div className="memory-item-head">
                  <strong>
                    [{item.tag}] {item.title}
                  </strong>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    {item.isSecret && item.isRevealed && (
                      <span className="lore-index-discovered-badge">
                        <Eye size={10} /> Discovered
                      </span>
                    )}
                    {item.isSecret && !item.isRevealed && (
                      <span className="lore-index-secret-badge">
                        <EyeOff size={10} /> Secret
                      </span>
                    )}
                    {item.ambientActive && (
                      <span
                        className="badge"
                        style={{
                          fontSize: "0.62rem",
                          padding: "1px 6px",
                          borderColor: "rgba(245, 158, 11, 0.4)",
                          color: "var(--accent-amber)",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 3,
                        }}
                      >
                        <MapPin size={10} /> Active location
                      </span>
                    )}
                    {item.recalled && (
                      <span className="badge badge-rag" style={{ fontSize: "0.62rem", padding: "1px 6px" }}>
                        <Sparkles size={10} /> Recalled last turn
                      </span>
                    )}
                  </div>
                </div>
                <div className="memory-item-content">{item.content}</div>
                {item.tags && item.tags.length > 0 && (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 4,
                      marginTop: 5,
                    }}
                  >
                    {item.tags.map((tag) => (
                      <span
                        key={tag}
                        className="badge"
                        style={{ fontSize: "0.6rem", padding: "1px 5px" }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

/** Standalone modal wrapper around LoreIndexPanel for direct callers. */
export const LoreIndexModal: React.FC<LoreIndexModalProps> = ({
  world,
  worldLoreNodes,
  characters,
  locations,
  containers,
  activeLocationId,
  recalledItems,
  unlockLore = false,
  revealedLoreIds = [],
  onClose,
}) => {
  useOverlayBackHandler({
    id: "lore-index-modal",
    isOpen: true,
    priority: 10,
    onClose,
  });

  const dialogRef = useRef<HTMLDivElement | null>(null);
  useModalDialog({
    isOpen: true,
    onClose,
    dialogRef,
  });

  const visibleCount = useMemo(
    () =>
      buildLoreIndexEntries({
        world,
        worldLoreNodes,
        characters,
        locations,
        containers,
        activeLocationId,
        recalledItems,
        unlockLore,
        revealedLoreIds,
      }).length,
    [
      world,
      worldLoreNodes,
      characters,
      locations,
      containers,
      activeLocationId,
      recalledItems,
      unlockLore,
      revealedLoreIds,
    ]
  );

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 70 }}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="modal-panel"
        style={{ width: "min(860px, 94vw)" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Indexed Shards, World Lore & Location Lore"
      >
        <div className="modal-header">
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <BookOpen size={17} color="var(--accent-emerald)" />
            Indexed Shards, World &amp; Location Lore ({visibleCount})
          </span>
          <button
            type="button"
            className="btn"
            style={{ padding: "4px 8px" }}
            onClick={onClose}
            title="Close"
          >
            <X size={15} />
          </button>
        </div>

        <LoreIndexPanel
          world={world}
          worldLoreNodes={worldLoreNodes}
          characters={characters}
          locations={locations}
          containers={containers}
          activeLocationId={activeLocationId}
          recalledItems={recalledItems}
          unlockLore={unlockLore}
          revealedLoreIds={revealedLoreIds}
          autoFocusSearch
        />
      </div>
    </div>
  );
};
