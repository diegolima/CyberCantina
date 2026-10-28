import React, { useEffect, useMemo, useState } from "react";
import { BookOpen, Search, Sparkles, X } from "lucide-react";
import { CharacterRecord, RecalledMemoryItem, WorldRecord } from "../../types";

type IndexFilter = "all" | "shards" | "lore";

interface IndexEntry {
  key: string;
  kind: "shard" | "lore";
  group: string;
  tag: string;
  title: string;
  content: string;
  recalled: boolean;
}

interface LoreIndexModalProps {
  world: WorldRecord;
  characters: CharacterRecord[];
  /** Items injected into the prompt on the latest turn, highlighted in the list. */
  recalledItems: RecalledMemoryItem[];
  onClose: () => void;
}

const norm = (s: string) => s.trim().toLowerCase();

/** Searchable modal listing the full static RAG index (character shards + world lore). */
export const LoreIndexModal: React.FC<LoreIndexModalProps> = ({
  world,
  characters,
  recalledItems,
  onClose,
}) => {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<IndexFilter>("all");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const entries = useMemo<IndexEntry[]>(() => {
    const recalledLoreIds = new Set(
      recalledItems.filter((r) => r.source_type === "lore").map((r) => r.id)
    );
    const recalledLoreTitles = new Set(
      recalledItems.filter((r) => r.source_type === "lore").map((r) => norm(r.title))
    );
    const recalledShardTitles = new Set(
      recalledItems
        .filter((r) => r.source_type === "character_shard")
        .map((r) => norm(r.title))
    );

    const list: IndexEntry[] = [];
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
    for (const lore of world.lore_nodes) {
      list.push({
        key: `lore-${lore.id}`,
        kind: "lore",
        group: `${world.name} — World Lore`,
        tag: lore.category,
        title: lore.title,
        content: lore.content,
        recalled:
          recalledLoreIds.has(lore.id) || recalledLoreTitles.has(norm(lore.title)),
      });
    }
    return list;
  }, [characters, world, recalledItems]);

  const filtered = useMemo(() => {
    const q = norm(query);
    return entries.filter((e) => {
      if (filter === "shards" && e.kind !== "shard") return false;
      if (filter === "lore" && e.kind !== "lore") return false;
      if (!q) return true;
      return (
        e.title.toLowerCase().includes(q) ||
        e.content.toLowerCase().includes(q) ||
        e.tag.toLowerCase().includes(q)
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
  const loreCount = entries.length - shardCount;

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 70 }}>
      <div
        className="modal-panel"
        style={{ width: "min(820px, 94vw)" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Indexed Character Shards & World Lore"
      >
        <div className="modal-header">
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <BookOpen size={17} color="var(--accent-emerald)" />
            Indexed Character Shards &amp; World Lore ({entries.length})
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

        <div className="lore-index-toolbar">
          <div className="sidebar-search-wrap" style={{ flex: 1 }}>
            <Search size={13} className="sidebar-search-icon" />
            <input
              autoFocus
              className="sidebar-search-input"
              placeholder="Search titles, content or categories..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="lore-index-filters" role="tablist">
            {(
              [
                ["all", `All (${entries.length})`],
                ["shards", `Shards (${shardCount})`],
                ["lore", `Lore (${loreCount})`],
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

        <div className="modal-body">
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
                  className={`memory-item ${item.kind === "shard" ? "memory-item-shard" : "memory-item-lore"}`}
                >
                  <div className="memory-item-head">
                    <strong>
                      [{item.tag}] {item.title}
                    </strong>
                    {item.recalled && (
                      <span className="badge badge-rag" style={{ fontSize: "0.62rem", padding: "1px 6px" }}>
                        <Sparkles size={10} /> Recalled last turn
                      </span>
                    )}
                  </div>
                  <div className="memory-item-content">{item.content}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
