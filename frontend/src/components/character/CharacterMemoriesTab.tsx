import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { MemoryShard } from "../../types";
import { TagChipsInput } from "../TagChipsInput";
import { ClickToEditField } from "../shared/ClickToEditField";

export interface CharacterMemoriesTabProps {
  isActive: boolean;
  memoryShards: MemoryShard[];
  viewingHistory: boolean;
  markDirty: () => void;
  setMemoryShards: React.Dispatch<React.SetStateAction<MemoryShard[]>>;
}

export const CharacterMemoriesTab: React.FC<CharacterMemoriesTabProps> = ({
  isActive,
  memoryShards,
  viewingHistory,
  markDirty,
  setMemoryShards,
}) => {
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
                {!viewingHistory && (
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
                      markDirty();
                    }}
                  >
                    <Plus size={12} /> Add Memory Shard
                  </button>
                )}
              </div>

              {memoryShards.length === 0 ? (
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--text-muted)",
                    fontStyle: "italic",
                  }}
                >
                  No backstory memory shards indexed. Add shards to anchor GraphRAG retrieval during narrative turns.
                </div>
              ) : (
                memoryShards.map((shard, idx) => (
                  <div
                    key={idx}
                    style={{
                      background: "var(--bg-panel)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: 6,
                      padding: 10,
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: viewingHistory ? "1fr 1fr" : "1fr 1fr auto",
                        gap: 8,
                        alignItems: "start",
                      }}
                    >
                      <ClickToEditField
                        label="Shard Title"
                        value={shard.title}
                        readOnly={viewingHistory}
                        onChange={(val) => {
                          const next = [...memoryShards];
                          next[idx] = { ...next[idx], title: val };
                          setMemoryShards(next);
                          markDirty();
                        }}
                      />
                      <div className="field-group">
                        <label>Trigger Keywords (min 1)</label>
                        {viewingHistory ? (
                          <div className="editable-field-box read-only" style={{ cursor: "default", display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {shard.keywords.length > 0 ? (
                              shard.keywords.map((kw, ki) => (
                                <span key={ki} className="badge" style={{ fontSize: "0.72rem", padding: "2px 6px" }}>
                                  {kw}
                                </span>
                              ))
                            ) : (
                              <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>—</span>
                            )}
                          </div>
                        ) : (
                          <TagChipsInput
                            value={shard.keywords}
                            placeholder="Add keyword & press comma or Enter..."
                            accentVariant="violet"
                            onChange={(nextKw) => {
                              const next = [...memoryShards];
                              next[idx] = {
                                ...next[idx],
                                keywords: nextKw,
                              };
                              setMemoryShards(next);
                              markDirty();
                            }}
                          />
                        )}
                      </div>
                      {!viewingHistory && (
                        <button
                          type="button"
                          className="item-remove-btn"
                          style={{ marginTop: 22 }}
                          onClick={() => {
                            setMemoryShards(
                              memoryShards.filter((_, i) => i !== idx)
                            );
                            markDirty();
                          }}
                          title="Remove memory shard"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>

                    <ClickToEditField
                      label="Memory Content"
                      value={shard.content}
                      readOnly={viewingHistory}
                      multiline
                      rows={2}
                      onChange={(val) => {
                        const next = [...memoryShards];
                        next[idx] = { ...next[idx], content: val };
                        setMemoryShards(next);
                        markDirty();
                      }}
                    />
                  </div>
                ))
              )}
            </div>
          </div>
  );
};
