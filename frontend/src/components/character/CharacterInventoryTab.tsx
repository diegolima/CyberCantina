import React, { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  FileText,
  Lock,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  ItemFlag,
  ItemInstance,
  LoreNode,
  hasItemFlag,
} from "../../types";
import { ClickToEditField } from "../shared/ClickToEditField";

export interface CharacterInventoryTabProps {
  isActive: boolean;
  equipped: ItemInstance[];
  setEquipped: React.Dispatch<React.SetStateAction<ItemInstance[]>>;
  inventory: ItemInstance[];
  setInventory: React.Dispatch<React.SetStateAction<ItemInstance[]>>;
  worldId: string;
  selectedWorldArtifacts: LoreNode[];
  selectedWorldArtifactTitleMap: Map<string, string>;
  viewingHistory: boolean;
  markDirty: () => void;
}

export const CharacterInventoryTab: React.FC<CharacterInventoryTabProps> = ({
  isActive,
  equipped,
  setEquipped,
  inventory,
  setInventory,
  worldId,
  selectedWorldArtifacts,
  selectedWorldArtifactTitleMap,
  viewingHistory,
  markDirty,
}) => {
  const [expandedTemplateItemKey, setExpandedTemplateItemKey] = useState<string | null>(null);

  return (
          <div
            style={{
              display: isActive ? "flex" : "none",
              flexDirection: "column",
              gap: 14,
            }}
          >
            {/* Equipped Attire */}
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
                  Equipped Attire &amp; Gear ({equipped.length})
                </span>
                {!viewingHistory && (
                  <button
                    type="button"
                    className="btn"
                    style={{ padding: "3px 8px", fontSize: "0.72rem" }}
                    onClick={() => {
                      const newId = `tpl_eq_${Date.now()}`;
                      setEquipped([
                        ...equipped,
                        {
                          id: newId,
                          name: "New equipped attire",
                          note: "",
                          flags: [],
                          lore_id: null,
                        },
                      ]);
                      markDirty();
                    }}
                  >
                    <Plus size={12} /> Add Equipped
                  </button>
                )}
              </div>

              {equipped.length === 0 ? (
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--text-muted)",
                    fontStyle: "italic",
                  }}
                >
                  No starting attire or worn gear specified.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {equipped.map((item, idx) => {
                    const rowKey = `eq:${item.id || idx}`;
                    const isExpanded = expandedTemplateItemKey === rowKey;
                    const isPerm = hasItemFlag(item, "permanent");
                    const isArt = hasItemFlag(item, "artifact");
                    const hasNote = Boolean(item.note && item.note.trim());
                    return (
                      <div
                        key={rowKey}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                          padding: 6,
                          borderRadius: 6,
                          border: isExpanded
                            ? "1px solid var(--accent-amber)"
                            : "1px solid var(--border-subtle)",
                          background: "var(--bg-panel)",
                        }}
                      >
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: viewingHistory ? "1fr" : "1fr auto auto",
                            gap: 6,
                            alignItems: "center",
                          }}
                        >
                          <ClickToEditField
                            value={item.name}
                            readOnly={viewingHistory}
                            placeholder="e.g. Weathered leather duster"
                            onChange={(val) => {
                              const next = [...equipped];
                              next[idx] = { ...next[idx], name: val };
                              setEquipped(next);
                              markDirty();
                            }}
                          />
                          {!viewingHistory && (
                            <button
                              type="button"
                              className="btn"
                              style={{ padding: "4px 8px", fontSize: "0.7rem" }}
                              title="Edit starting item mini-lore & flags"
                              onClick={() =>
                                setExpandedTemplateItemKey(isExpanded ? null : rowKey)
                              }
                            >
                              {isPerm && <Lock size={10} color="#7dd3fc" />}
                              {isArt && <Sparkles size={10} color="#d8b4fe" />}
                              {hasNote && <FileText size={10} color="var(--accent-amber)" />}
                              <span>Lore &amp; Flags</span>
                              {isExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                            </button>
                          )}
                          {!viewingHistory && (
                            <button
                              type="button"
                              className="item-remove-btn"
                              onClick={() => {
                                setEquipped(equipped.filter((_, i) => i !== idx));
                                markDirty();
                              }}
                              title="Remove equipped item"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                        {(isPerm || isArt || hasNote) && !isExpanded && (
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingLeft: 4 }}>
                            {isPerm && (
                              <span className="item-flag-pill item-flag-permanent">
                                <Lock size={10} /> Permanent
                              </span>
                            )}
                            {isArt && (
                              <span className="item-flag-pill item-flag-artifact">
                                <Sparkles size={10} />{" "}
                                {item.lore_id && selectedWorldArtifactTitleMap.get(item.lore_id)
                                  ? `Artifact · ${selectedWorldArtifactTitleMap.get(item.lore_id)}`
                                  : "Artifact"}
                              </span>
                            )}
                            {hasNote && (
                              <span className="item-flag-pill item-flag-note" title={item.note}>
                                <FileText size={10} /> {item.note}
                              </span>
                            )}
                          </div>
                        )}
                        {isExpanded && !viewingHistory && (
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 8,
                              padding: "8px 6px 4px",
                              borderTop: "1px solid var(--border-subtle)",
                            }}
                          >
                            <div className="field-group">
                              <label>
                                Mini-Lore Note ({item.note.length}/300)
                              </label>
                              <textarea
                                className="field-textarea"
                                rows={2}
                                maxLength={300}
                                placeholder="Brief item history or sensory detail..."
                                value={item.note}
                                onChange={(e) => {
                                  const next = [...equipped];
                                  next[idx] = { ...next[idx], note: e.target.value };
                                  setEquipped(next);
                                  markDirty();
                                }}
                              />
                            </div>
                            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.75rem", cursor: "pointer" }}>
                                <input
                                  type="checkbox"
                                  checked={isPerm}
                                  onChange={(e) => {
                                    const nextFlags = e.target.checked
                                      ? Array.from(new Set<ItemFlag>([...item.flags, "permanent"]))
                                      : item.flags.filter((f) => f !== "permanent");
                                    const next = [...equipped];
                                    next[idx] = { ...next[idx], flags: nextFlags };
                                    setEquipped(next);
                                    markDirty();
                                  }}
                                />
                                <Lock size={11} color="#7dd3fc" /> Permanent
                              </label>
                              {worldId && selectedWorldArtifacts.length > 0 && (
                                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.75rem", cursor: "pointer" }}>
                                  <input
                                    type="checkbox"
                                    checked={isArt}
                                    onChange={(e) => {
                                      const checked = e.target.checked;
                                      const nextFlags = checked
                                        ? Array.from(new Set<ItemFlag>([...item.flags, "artifact"]))
                                        : item.flags.filter((f) => f !== "artifact");
                                      const next = [...equipped];
                                      next[idx] = {
                                        ...next[idx],
                                        flags: nextFlags,
                                        lore_id: checked
                                          ? item.lore_id || selectedWorldArtifacts[0].id
                                          : null,
                                      };
                                      setEquipped(next);
                                      markDirty();
                                    }}
                                  />
                                  <Sparkles size={11} color="#d8b4fe" /> World Artifact
                                </label>
                              )}
                              {isArt && worldId && selectedWorldArtifacts.length > 0 && (
                                <select
                                  className="field-select"
                                  style={{ width: "auto", minWidth: 200, fontSize: "0.74rem" }}
                                  value={item.lore_id || ""}
                                  onChange={(e) => {
                                    const next = [...equipped];
                                    next[idx] = { ...next[idx], lore_id: e.target.value || null };
                                    setEquipped(next);
                                    markDirty();
                                  }}
                                >
                                  {selectedWorldArtifacts.map((ln) => (
                                    <option key={ln.id} value={ln.id}>
                                      {ln.title}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Carried Inventory */}
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
                  Carried Inventory &amp; Objects ({inventory.length})
                </span>
                {!viewingHistory && (
                  <button
                    type="button"
                    className="btn"
                    style={{ padding: "3px 8px", fontSize: "0.72rem" }}
                    onClick={() => {
                      const newId = `tpl_inv_${Date.now()}`;
                      setInventory([
                        ...inventory,
                        {
                          id: newId,
                          name: "New carried item",
                          note: "",
                          flags: [],
                          lore_id: null,
                        },
                      ]);
                      markDirty();
                    }}
                  >
                    <Plus size={12} /> Add Item
                  </button>
                )}
              </div>

              {inventory.length === 0 ? (
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--text-muted)",
                    fontStyle: "italic",
                  }}
                >
                  No starting carried items specified.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {inventory.map((item, idx) => {
                    const rowKey = `inv:${item.id || idx}`;
                    const isExpanded = expandedTemplateItemKey === rowKey;
                    const isPerm = hasItemFlag(item, "permanent");
                    const isArt = hasItemFlag(item, "artifact");
                    const hasNote = Boolean(item.note && item.note.trim());
                    return (
                      <div
                        key={rowKey}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                          padding: 6,
                          borderRadius: 6,
                          border: isExpanded
                            ? "1px solid var(--accent-amber)"
                            : "1px solid var(--border-subtle)",
                          background: "var(--bg-panel)",
                        }}
                      >
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: viewingHistory ? "1fr" : "1fr auto auto",
                            gap: 6,
                            alignItems: "center",
                          }}
                        >
                          <ClickToEditField
                            value={item.name}
                            readOnly={viewingHistory}
                            placeholder="e.g. Diagnostic scanner or Keycard"
                            onChange={(val) => {
                              const next = [...inventory];
                              next[idx] = { ...next[idx], name: val };
                              setInventory(next);
                              markDirty();
                            }}
                          />
                          {!viewingHistory && (
                            <button
                              type="button"
                              className="btn"
                              style={{ padding: "4px 8px", fontSize: "0.7rem" }}
                              title="Edit starting item mini-lore & flags"
                              onClick={() =>
                                setExpandedTemplateItemKey(isExpanded ? null : rowKey)
                              }
                            >
                              {isPerm && <Lock size={10} color="#7dd3fc" />}
                              {isArt && <Sparkles size={10} color="#d8b4fe" />}
                              {hasNote && <FileText size={10} color="var(--accent-amber)" />}
                              <span>Lore &amp; Flags</span>
                              {isExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                            </button>
                          )}
                          {!viewingHistory && (
                            <button
                              type="button"
                              className="item-remove-btn"
                              onClick={() => {
                                setInventory(inventory.filter((_, i) => i !== idx));
                                markDirty();
                              }}
                              title="Remove item"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                        {(isPerm || isArt || hasNote) && !isExpanded && (
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingLeft: 4 }}>
                            {isPerm && (
                              <span className="item-flag-pill item-flag-permanent">
                                <Lock size={10} /> Permanent
                              </span>
                            )}
                            {isArt && (
                              <span className="item-flag-pill item-flag-artifact">
                                <Sparkles size={10} />{" "}
                                {item.lore_id && selectedWorldArtifactTitleMap.get(item.lore_id)
                                  ? `Artifact · ${selectedWorldArtifactTitleMap.get(item.lore_id)}`
                                  : "Artifact"}
                              </span>
                            )}
                            {hasNote && (
                              <span className="item-flag-pill item-flag-note" title={item.note}>
                                <FileText size={10} /> {item.note}
                              </span>
                            )}
                          </div>
                        )}
                        {isExpanded && !viewingHistory && (
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 8,
                              padding: "8px 6px 4px",
                              borderTop: "1px solid var(--border-subtle)",
                            }}
                          >
                            <div className="field-group">
                              <label>
                                Mini-Lore Note ({item.note.length}/300)
                              </label>
                              <textarea
                                className="field-textarea"
                                rows={2}
                                maxLength={300}
                                placeholder="Brief item history or sensory detail..."
                                value={item.note}
                                onChange={(e) => {
                                  const next = [...inventory];
                                  next[idx] = { ...next[idx], note: e.target.value };
                                  setInventory(next);
                                  markDirty();
                                }}
                              />
                            </div>
                            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.75rem", cursor: "pointer" }}>
                                <input
                                  type="checkbox"
                                  checked={isPerm}
                                  onChange={(e) => {
                                    const nextFlags = e.target.checked
                                      ? Array.from(new Set<ItemFlag>([...item.flags, "permanent"]))
                                      : item.flags.filter((f) => f !== "permanent");
                                    const next = [...inventory];
                                    next[idx] = { ...next[idx], flags: nextFlags };
                                    setInventory(next);
                                    markDirty();
                                  }}
                                />
                                <Lock size={11} color="#7dd3fc" /> Permanent
                              </label>
                              {worldId && selectedWorldArtifacts.length > 0 && (
                                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.75rem", cursor: "pointer" }}>
                                  <input
                                    type="checkbox"
                                    checked={isArt}
                                    onChange={(e) => {
                                      const checked = e.target.checked;
                                      const nextFlags = checked
                                        ? Array.from(new Set<ItemFlag>([...item.flags, "artifact"]))
                                        : item.flags.filter((f) => f !== "artifact");
                                      const next = [...inventory];
                                      next[idx] = {
                                        ...next[idx],
                                        flags: nextFlags,
                                        lore_id: checked
                                          ? item.lore_id || selectedWorldArtifacts[0].id
                                          : null,
                                      };
                                      setInventory(next);
                                      markDirty();
                                    }}
                                  />
                                  <Sparkles size={11} color="#d8b4fe" /> World Artifact
                                </label>
                              )}
                              {isArt && worldId && selectedWorldArtifacts.length > 0 && (
                                <select
                                  className="field-select"
                                  style={{ width: "auto", minWidth: 200, fontSize: "0.74rem" }}
                                  value={item.lore_id || ""}
                                  onChange={(e) => {
                                    const next = [...inventory];
                                    next[idx] = { ...next[idx], lore_id: e.target.value || null };
                                    setInventory(next);
                                    markDirty();
                                  }}
                                >
                                  {selectedWorldArtifacts.map((ln) => (
                                    <option key={ln.id} value={ln.id}>
                                      {ln.title}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
  );
};
