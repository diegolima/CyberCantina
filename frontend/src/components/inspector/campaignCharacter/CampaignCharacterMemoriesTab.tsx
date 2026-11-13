import React, { useEffect, useState } from "react";
import { Check, Database, Plus, Trash2 } from "lucide-react";
import { MemoryShard } from "../../../types";
import { TagChipsInput } from "../../TagChipsInput";

export interface CampaignCharacterMemoriesTabProps {
  characterId: string;
  initialShards: MemoryShard[];
  isActive: boolean;
  onMemoriesCountChange?: (count: number) => void;
  onSaveMemories: (characterId: string, shards: MemoryShard[]) => Promise<void>;
}

export const CampaignCharacterMemoriesTab: React.FC<CampaignCharacterMemoriesTabProps> = ({
  characterId,
  initialShards,
  isActive,
  onMemoriesCountChange,
  onSaveMemories,
}) => {
  const [memoryShards, setMemoryShards] = useState<MemoryShard[]>(() =>
    initialShards.map((m) => ({ ...m, keywords: [...m.keywords] }))
  );
  const [isMemoriesDirty, setIsMemoriesDirty] = useState(false);
  const [isSavingMemories, setIsSavingMemories] = useState(false);
  const [memorySaveSuccess, setMemorySaveSuccess] = useState(false);
  const [memoryError, setMemoryError] = useState<string | null>(null);

  useEffect(() => {
    if (!isMemoriesDirty) {
      setMemoryShards(
        initialShards.map((m) => ({ ...m, keywords: [...m.keywords] }))
      );
    }
  }, [initialShards, isMemoriesDirty]);

  useEffect(() => {
    onMemoriesCountChange?.(memoryShards.length);
  }, [memoryShards.length]);

  const handleSaveMemories = async () => {
    setIsSavingMemories(true);
    setMemoryError(null);
    setMemorySaveSuccess(false);
    try {
      await onSaveMemories(characterId, memoryShards);
      setIsMemoriesDirty(false);
      setMemorySaveSuccess(true);
      setTimeout(() => setMemorySaveSuccess(false), 3000);
    } catch (err) {
      setMemoryError(String(err));
    } finally {
      setIsSavingMemories(false);
    }
  };

  return (
          <div
            style={{
              display: isActive ? "flex" : "none",
              flexDirection: "column",
              gap: 14,
            }}
          >
            <div
              style={{
                fontSize: "0.76rem",
                color: "var(--text-secondary)",
                background: "var(--bg-card)",
                padding: "8px 12px",
                borderRadius: 6,
                border: "1px solid var(--border-subtle)",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <Database size={15} color="var(--accent-amber)" />
              <div>
                <strong>Campaign-Scoped Memory Shards.</strong> Edits apply to this campaign from the next turn onwards and do not alter the base character template.
              </div>
            </div>

            {memoryError && (
              <div
                style={{
                  fontSize: "0.75rem",
                  color: "#fda4af",
                  background: "rgba(244, 63, 94, 0.12)",
                  border: "1px solid rgba(244, 63, 94, 0.35)",
                  borderRadius: 6,
                  padding: "6px 10px",
                }}
              >
                {memoryError}
              </div>
            )}

            {memorySaveSuccess && (
              <div
                style={{
                  fontSize: "0.75rem",
                  color: "#6ee7b7",
                  background: "rgba(16, 185, 129, 0.12)",
                  border: "1px solid rgba(16, 185, 129, 0.35)",
                  borderRadius: 6,
                  padding: "6px 10px",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Check size={13} />
                Memories updated and re-indexed for this campaign! Applied from next turn onwards.
              </div>
            )}

            <div
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 8,
                padding: 12,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span className="sidebar-label">
                  Backstory Memory Shards — Hybrid GraphRAG ({memoryShards.length})
                </span>
                <button
                  type="button"
                  className="btn"
                  style={{ padding: "3px 8px", fontSize: "0.72rem" }}
                  onClick={() => {
                    setMemoryShards([
                      ...memoryShards,
                      {
                        title: "New Backstory Memory",
                        content: "Describe a key memory or secret...",
                        keywords: [],
                        emotional_weight: 0.7,
                      },
                    ]);
                    setIsMemoriesDirty(true);
                  }}
                >
                  <Plus size={12} /> Add Memory Shard
                </button>
              </div>

              {memoryShards.length === 0 ? (
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--text-muted)",
                    fontStyle: "italic",
                  }}
                >
                  No memory shards indexed for this character.
                </div>
              ) : (
                memoryShards.map((shard, idx) => {
                  const isEphemeral = shard.origin === "clerk_ephemeral";
                  const isPromoted = shard.origin === "clerk_promoted";
                  const isCompacted = shard.origin === "compacted";

                  return (
                  <div
                    key={shard.id || idx}
                    style={{
                      background: "var(--bg-panel)",
                      border: isEphemeral
                        ? "1px dashed rgba(245, 158, 11, 0.55)"
                        : "1px solid var(--border-subtle)",
                      borderRadius: 6,
                      padding: 10,
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: 6,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span
                          className="badge"
                          style={{
                            fontSize: "0.66rem",
                            padding: "1px 6px",
                            background: isEphemeral
                              ? "rgba(245, 158, 11, 0.16)"
                              : isPromoted || isCompacted
                                ? "rgba(16, 185, 129, 0.16)"
                                : "rgba(56, 189, 248, 0.14)",
                            color: isEphemeral
                              ? "var(--accent-amber)"
                              : isPromoted || isCompacted
                                ? "#6ee7b7"
                                : "#7dd3fc",
                            borderColor: isEphemeral
                              ? "rgba(245, 158, 11, 0.4)"
                              : isPromoted || isCompacted
                                ? "rgba(16, 185, 129, 0.4)"
                                : "rgba(56, 189, 248, 0.35)",
                          }}
                        >
                          {isEphemeral
                            ? "Ephemeral · Clerk-Extracted"
                            : isPromoted
                              ? "Promoted · Permanent"
                              : isCompacted
                                ? "Compacted · Permanent"
                                : "Backstory · Permanent"}
                        </span>
                        {shard.significance && (
                          <span
                            className="badge"
                            style={{
                              fontSize: "0.65rem",
                              padding: "1px 6px",
                              textTransform: "uppercase",
                              background: "rgba(168, 85, 247, 0.15)",
                              color: "#d8b4fe",
                              borderColor: "rgba(168, 85, 247, 0.35)",
                            }}
                          >
                            {shard.significance}
                          </span>
                        )}
                        {shard.created_at_depth != null && (
                          <span style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>
                            Turn {shard.created_at_depth}
                          </span>
                        )}
                      </div>

                      {isEphemeral && (
                        <button
                          type="button"
                          className="btn btn-amber"
                          style={{ padding: "2px 8px", fontSize: "0.68rem" }}
                          disabled={isSavingMemories}
                          onClick={async () => {
                            const next = [...memoryShards];
                            next[idx] = { ...next[idx], origin: "clerk_promoted" };
                            setMemoryShards(next);
                            setIsSavingMemories(true);
                            try {
                              await onSaveMemories(characterId, next);
                              setIsMemoriesDirty(false);
                              setMemorySaveSuccess(true);
                              setTimeout(() => setMemorySaveSuccess(false), 3000);
                            } catch (err) {
                              setMemoryError(String(err));
                            } finally {
                              setIsSavingMemories(false);
                            }
                          }}
                          title="Promote this ephemeral Clerk memory into a permanent character memory so it is never compacted away"
                        >
                          <Check size={11} /> Promote to Permanent
                        </button>
                      )}
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr auto",
                        gap: 8,
                        alignItems: "start",
                      }}
                    >
                      <div className="field-group">
                        <label>Shard Title</label>
                        <input
                          type="text"
                          className="field-input"
                          value={shard.title}
                          onChange={(e) => {
                            const next = [...memoryShards];
                            next[idx] = { ...next[idx], title: e.target.value };
                            setMemoryShards(next);
                            setIsMemoriesDirty(true);
                          }}
                        />
                      </div>

                      <div className="field-group">
                        <label>Trigger Keywords (min 1)</label>
                        <TagChipsInput
                          value={shard.keywords}
                          placeholder="Add keyword & press comma or Enter..."
                          accentVariant="violet"
                          onChange={(newKeywords) => {
                            const next = [...memoryShards];
                            next[idx] = {
                              ...next[idx],
                              keywords: newKeywords,
                            };
                            setMemoryShards(next);
                            setIsMemoriesDirty(true);
                          }}
                        />
                      </div>

                      <button
                        type="button"
                        className="item-remove-btn"
                        style={{ marginTop: 22 }}
                        onClick={() => {
                          setMemoryShards(
                            memoryShards.filter((_, i) => i !== idx)
                          );
                          setIsMemoriesDirty(true);
                        }}
                        title="Remove memory shard"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>

                    <div className="field-group">
                      <label>Memory Content</label>
                      <textarea
                        className="field-textarea"
                        rows={2}
                        value={shard.content}
                        onChange={(e) => {
                          const next = [...memoryShards];
                          next[idx] = { ...next[idx], content: e.target.value };
                          setMemoryShards(next);
                          setIsMemoriesDirty(true);
                        }}
                      />
                    </div>
                  </div>
                  );
                })
              )}

              {isMemoriesDirty && (
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
                  <button
                    type="button"
                    className="btn btn-amber"
                    onClick={handleSaveMemories}
                    disabled={isSavingMemories}
                  >
                    {isSavingMemories ? "Saving & Re-indexing..." : "Apply Memories Next Turn"}
                  </button>
                </div>
              )}
            </div>
          </div>
  );
};
