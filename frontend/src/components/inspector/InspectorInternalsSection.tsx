import React from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Cpu,
  Flag,
  Sparkles,
} from "lucide-react";
import type { CampaignStateBundle, RecalledMemoryItem } from "../../types";
import { InspectorSection } from "./InspectorPrimitives";

const RECALL_SOURCE_LABEL: Record<RecalledMemoryItem["source_type"], string> = {
  lore: "Lore",
  location_lore: "Loc Lore",
  container_lore: "Cont Lore",
  character_shard: "Shard",
  episodic_chunk: "Episode",
  item_lore: "Item",
};

const FLAG_PREVIEW_LIMIT = 12;

export interface InspectorInternalsSectionProps {
  bundle: CampaignStateBundle;
  turnsCount: number;
  indexedCount: number;
  sceneFlags: string[];
  recalledItems: RecalledMemoryItem[];
  flagsChanged: boolean;
  showAllFlags: boolean;
  setShowAllFlags: React.Dispatch<React.SetStateAction<boolean>>;
  expandedRecalls: Set<string>;
  toggleRecall: (key: string) => void;
  onOpenLoreIndex: () => void;
}

export const InspectorInternalsSection: React.FC<
  InspectorInternalsSectionProps
> = ({
  bundle,
  turnsCount,
  indexedCount,
  sceneFlags,
  recalledItems,
  flagsChanged,
  showAllFlags,
  setShowAllFlags,
  expandedRecalls,
  toggleRecall,
  onOpenLoreIndex,
}) => {
  return (
      <InspectorSection
        storageKey="internals"
        title="Internals"
        icon={<Cpu size={13} color="var(--accent-emerald)" />}
        meta={`${sceneFlags.length} flags · ${recalledItems.length} recalled`}
        changed={flagsChanged}
        changedTitle="Scene flags changed this turn"
      >
        <div className="internals-stats">
          {turnsCount} branch turns · {bundle.episodic_chunks.length} episodic chunks ·{" "}
          {indexedCount} indexed shards
        </div>

        <div className="internals-group">
          <div className="internals-group-label">
            <Flag size={11} /> Scene Flags ({sceneFlags.length})
          </div>
          {sceneFlags.length > 0 ? (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {(showAllFlags ? sceneFlags : sceneFlags.slice(0, FLAG_PREVIEW_LIMIT)).map(
                  (flag, i) => (
                    <span key={i} className="badge" style={{ fontSize: "0.68rem", padding: "2px 6px" }}>
                      {flag}
                    </span>
                  )
                )}
              </div>
              {sceneFlags.length > FLAG_PREVIEW_LIMIT && (
                <button
                  type="button"
                  className="exits-toggle"
                  aria-expanded={showAllFlags}
                  onClick={() => setShowAllFlags((v) => !v)}
                >
                  {showAllFlags ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  {showAllFlags
                    ? "Show fewer"
                    : `Show all ${sceneFlags.length} flags`}
                </button>
              )}
            </>
          ) : (
            <div className="inspector-empty">No active scene flags.</div>
          )}
        </div>

        <div className="internals-group">
          <div className="internals-group-label">
            <Sparkles size={11} /> Recalled Last Turn ({recalledItems.length})
          </div>
          {recalledItems.length > 0 ? (
            recalledItems.map((item, idx) => {
              const key = `${item.source_type}-${item.id}-${idx}`;
              const expanded = expandedRecalls.has(key);
              return (
                <button
                  type="button"
                  key={key}
                  className={`memory-item memory-item-${item.source_type} memory-item-clickable`}
                  aria-expanded={expanded}
                  onClick={() => toggleRecall(key)}
                  title={expanded ? "Collapse" : "Expand"}
                >
                  <div className="memory-item-head">
                    <strong>
                      [{RECALL_SOURCE_LABEL[item.source_type]}] {item.title}
                    </strong>
                    <span className="memory-item-score">{item.score.toFixed(2)}</span>
                  </div>
                  <div className={`memory-item-content ${expanded ? "" : "clamped"}`}>
                    {item.content}
                  </div>
                </button>
              );
            })
          ) : (
            <div className="inspector-empty">Nothing was recalled on the last turn.</div>
          )}
        </div>

        <button
          type="button"
          className="btn"
          style={{ padding: "5px 10px", fontSize: "0.72rem", alignSelf: "flex-start" }}
          onClick={onOpenLoreIndex}
        >
          <BookOpen size={12} />
          Browse Shards &amp; Lore Index ({indexedCount})
        </button>
      </InspectorSection>
  );
};
