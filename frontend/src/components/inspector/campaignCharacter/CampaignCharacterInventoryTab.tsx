import React, { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  CircleMinus,
  CirclePlus,
  FileText,
  Lock,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  CharacterRecord,
  ItemEquipActionPayload,
  ItemFlag,
  ItemInstance,
  LoreNode,
  hasItemFlag,
} from "../../../types";

export interface CampaignCharacterInventoryTabProps {
  character: CharacterRecord;
  equippedList: ItemInstance[];
  inventoryList: ItemInstance[];
  worldArtifactNodes: LoreNode[];
  activeWorldName?: string;
  isMutatingLocked: boolean;
  initialExpandedItemId: string | null;
  isActive: boolean;
  onItemAction: (payload: ItemEquipActionPayload) => Promise<void> | void;
}

export const CampaignCharacterInventoryTab: React.FC<CampaignCharacterInventoryTabProps> = ({
  character,
  equippedList,
  inventoryList,
  worldArtifactNodes,
  activeWorldName,
  isMutatingLocked,
  initialExpandedItemId,
  isActive,
  onItemAction,
}) => {
  const [newItemName, setNewItemName] = useState("");
  const [newItemTarget, setNewItemTarget] = useState<"inventory" | "equipped">("inventory");
  const [isSubmittingItem, setIsSubmittingItem] = useState(false);

  const [expandedItemId, setExpandedItemId] = useState<string | null>(initialExpandedItemId);
  const [editItemName, setEditItemName] = useState("");
  const [editItemNote, setEditItemNote] = useState("");
  const [editIsPermanent, setEditIsPermanent] = useState(false);
  const [editIsArtifact, setEditIsArtifact] = useState(false);
  const [editLoreId, setEditLoreId] = useState<string>("");
  const [isSavingItemEdit, setIsSavingItemEdit] = useState(false);
  const [itemError, setItemError] = useState<string | null>(null);
  const [itemSaveSuccess, setItemSaveSuccess] = useState<string | null>(null);

  const allItems = useMemo(
    () => [...equippedList, ...inventoryList],
    [equippedList, inventoryList]
  );
  const artifactTitleById = useMemo(
    () => new Map(worldArtifactNodes.map((ln) => [ln.id, ln.title])),
    [worldArtifactNodes]
  );

  const populateItemEditor = (item: ItemInstance) => {
    setExpandedItemId(item.id);
    setEditItemName(item.name);
    setEditItemNote(item.note || "");
    setEditIsPermanent(hasItemFlag(item, "permanent"));
    const isArt = hasItemFlag(item, "artifact");
    setEditIsArtifact(isArt);
    setEditLoreId(
      item.lore_id ||
        (isArt && worldArtifactNodes.length > 0 ? worldArtifactNodes[0].id : "")
    );
    setItemError(null);
  };


  useEffect(() => {
    if (!initialExpandedItemId) return;
    const match = allItems.find((it) => it.id === initialExpandedItemId);
    if (match) {
      populateItemEditor(match);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialExpandedItemId]);

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newItemName.trim();
    if (!clean || isMutatingLocked) return;
    setIsSubmittingItem(true);
    setItemError(null);
    try {
      await onItemAction({
        character_id: character.id,
        item: clean,
        action: "add",
        target: newItemTarget,
      });
      setNewItemName("");
    } catch (err: any) {
      setItemError(err?.message || String(err));
    } finally {
      setIsSubmittingItem(false);
    }
  };

  const handleToggleExpandItem = (item: ItemInstance) => {
    if (expandedItemId === item.id) {
      setExpandedItemId(null);
      setItemError(null);
      return;
    }
    populateItemEditor(item);
  };

  const handleSaveItemUpdate = async (item: ItemInstance) => {
    const trimmedName = editItemName.trim();
    if (!trimmedName) {
      setItemError("Item name cannot be empty.");
      return;
    }
    if (editItemNote.trim().length > 300) {
      setItemError("Mini-lore note cannot exceed 300 characters.");
      return;
    }
    if (editIsArtifact && !editLoreId) {
      setItemError(
        "Please select a World Artifact Lore entry when marking an item as an Artifact."
      );
      return;
    }

    const nextFlags: ItemFlag[] = [];
    if (editIsPermanent) nextFlags.push("permanent");
    if (editIsArtifact) nextFlags.push("artifact");

    setIsSavingItemEdit(true);
    setItemError(null);
    try {
      await onItemAction({
        character_id: character.id,
        item: item.name,
        item_id: item.id,
        action: "update",
        new_name: trimmedName,
        note: editItemNote.trim(),
        flags: nextFlags,
        lore_id: editIsArtifact ? editLoreId : null,
      });
      setExpandedItemId(null);
      setItemSaveSuccess(`Saved "${trimmedName}" details.`);
      setTimeout(() => setItemSaveSuccess(null), 2600);
    } catch (err: any) {
      setItemError(err?.message || String(err));
    } finally {
      setIsSavingItemEdit(false);
    }
  };

  const handleRemoveItem = async (item: ItemInstance) => {
    if (isMutatingLocked) return;
    if (
      hasItemFlag(item, "permanent") &&
      !window.confirm(
        `"${item.name}" is marked Permanent. Remove it from ${character.name}'s inventory anyway?`
      )
    ) {
      return;
    }
    setItemError(null);
    if (expandedItemId === item.id) {
      setExpandedItemId(null);
    }
    await onItemAction({
      character_id: character.id,
      item: item.name,
      item_id: item.id,
      action: "remove",
    });
  };

  const renderItemCard = (
    item: ItemInstance,
    bucket: "equipped" | "inventory"
  ) => {
    const isExpanded = expandedItemId === item.id;
    const isPerm = hasItemFlag(item, "permanent");
    const isArt = hasItemFlag(item, "artifact");
    const linkedTitle = item.lore_id ? artifactTitleById.get(item.lore_id) : undefined;
    const hasNote = Boolean(item.note && item.note.trim());

    return (
      <div
        key={item.id}
        style={{
          display: "flex",
          flexDirection: "column",
          background:
            bucket === "equipped"
              ? "rgba(245, 158, 11, 0.08)"
              : "var(--bg-panel)",
          border:
            isExpanded
              ? "1px solid var(--accent-amber)"
              : bucket === "equipped"
                ? "1px solid rgba(245, 158, 11, 0.35)"
                : "1px solid var(--border-subtle)",
          borderRadius: 6,
          fontSize: "0.8rem",
          overflow: "hidden",
        }}
      >
        {/* Main clickable item row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            padding: "7px 10px",
            cursor: "pointer",
          }}
          onClick={() => handleToggleExpandItem(item)}
          title="Click to edit mini-lore note and item flags"
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span
                style={{
                  fontWeight: bucket === "equipped" ? 600 : 500,
                  color:
                    bucket === "equipped"
                      ? "var(--accent-amber)"
                      : "var(--text-primary)",
                }}
              >
                {item.name}
              </span>
              {isPerm && (
                <span
                  className="item-flag-pill item-flag-permanent"
                  title="Permanent: Clerk & NPC agents cannot automatically discard or steal this item"
                >
                  <Lock size={10} /> Permanent
                </span>
              )}
              {isArt && (
                <span
                  className="item-flag-pill item-flag-artifact"
                  title={
                    linkedTitle
                      ? `Linked to World Artifact: ${linkedTitle}`
                      : "Linked to World Artifact Lore"
                  }
                >
                  <Sparkles size={10} />{" "}
                  {linkedTitle ? `Artifact · ${linkedTitle}` : "Artifact"}
                </span>
              )}
              {hasNote && !isExpanded && (
                <span
                  className="item-flag-pill item-flag-note"
                  title={item.note}
                >
                  <FileText size={10} /> Lore Note
                </span>
              )}
            </div>
            {hasNote && !isExpanded && (
              <div
                style={{
                  fontSize: "0.73rem",
                  color: "var(--text-secondary)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {item.note}
              </div>
            )}
          </div>

          <div
            style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="btn"
              style={{ padding: "3px 7px", fontSize: "0.71rem" }}
              title={isExpanded ? "Collapse editor" : "Edit item lore & flags"}
              onClick={() => handleToggleExpandItem(item)}
            >
              <Pencil size={11} />
              {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
            {bucket === "equipped" ? (
              <button
                type="button"
                className="btn"
                style={{ padding: "3px 8px", fontSize: "0.72rem" }}
                disabled={isMutatingLocked}
                title={
                  isMutatingLocked
                    ? "Locked while turn/Clerk is running"
                    : "Unequip (move to carried inventory)"
                }
                onClick={() =>
                  onItemAction({
                    character_id: character.id,
                    item: item.name,
                    item_id: item.id,
                    action: "unequip",
                  })
                }
              >
                <CircleMinus size={12} /> Unequip
              </button>
            ) : (
              <button
                type="button"
                className="btn"
                style={{ padding: "3px 8px", fontSize: "0.72rem" }}
                disabled={isMutatingLocked}
                title={
                  isMutatingLocked
                    ? "Locked while turn/Clerk is running"
                    : "Equip (move to equipped gear)"
                }
                onClick={() =>
                  onItemAction({
                    character_id: character.id,
                    item: item.name,
                    item_id: item.id,
                    action: "equip",
                  })
                }
              >
                <CirclePlus size={12} /> Equip
              </button>
            )}
            <button
              type="button"
              className="item-remove-btn"
              disabled={isMutatingLocked}
              title={
                isMutatingLocked
                  ? "Locked while turn/Clerk is running"
                  : "Remove (delete item)"
              }
              onClick={() => handleRemoveItem(item)}
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {/* Inline Mini-Lore & Flags Editor */}
        {isExpanded && (
          <div
            style={{
              padding: "10px 12px 12px",
              borderTop: "1px solid var(--border-subtle)",
              background: "rgba(0, 0, 0, 0.24)",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div className="field-group">
              <label>Item Name</label>
              <input
                type="text"
                className="field-input"
                value={editItemName}
                maxLength={120}
                disabled={isSavingItemEdit || isMutatingLocked}
                onChange={(e) => setEditItemName(e.target.value)}
              />
            </div>

            <div className="field-group">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <label>
                  Mini-Lore Note{" "}
                  <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
                    (recalled conditionally when item is mentioned &amp; absent from recent turns)
                  </span>
                </label>
                <span
                  style={{
                    fontSize: "0.68rem",
                    color:
                      editItemNote.length > 280
                        ? "var(--accent-amber)"
                        : "var(--text-muted)",
                  }}
                >
                  {editItemNote.length}/300
                </span>
              </div>
              <textarea
                className="field-textarea"
                rows={2}
                maxLength={300}
                placeholder="e.g. Tarnished silver heirloom left by her mother; smells faintly of cedar..."
                value={editItemNote}
                disabled={isSavingItemEdit || isMutatingLocked}
                onChange={(e) => setEditItemNote(e.target.value)}
              />
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
              }}
            >
              <label
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  padding: "8px 10px",
                  borderRadius: 6,
                  border: editIsPermanent
                    ? "1px solid rgba(56, 189, 248, 0.45)"
                    : "1px solid var(--border-subtle)",
                  background: editIsPermanent
                    ? "rgba(56, 189, 248, 0.08)"
                    : "var(--bg-card)",
                  cursor: isMutatingLocked ? "not-allowed" : "pointer",
                  fontSize: "0.75rem",
                }}
              >
                <input
                  type="checkbox"
                  checked={editIsPermanent}
                  disabled={isSavingItemEdit || isMutatingLocked}
                  onChange={(e) => setEditIsPermanent(e.target.checked)}
                  style={{ marginTop: 2 }}
                />
                <div>
                  <div
                    style={{
                      fontWeight: 600,
                      color: editIsPermanent ? "#7dd3fc" : "var(--text-primary)",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <Lock size={11} /> Permanent
                  </div>
                  <div style={{ fontSize: "0.69rem", color: "var(--text-muted)", marginTop: 2 }}>
                    Prevents Clerk or NPC agents from automatically discarding or stealing this item.
                  </div>
                </div>
              </label>

              <label
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  padding: "8px 10px",
                  borderRadius: 6,
                  border: editIsArtifact
                    ? "1px solid rgba(168, 85, 247, 0.5)"
                    : "1px solid var(--border-subtle)",
                  background: editIsArtifact
                    ? "rgba(168, 85, 247, 0.09)"
                    : "var(--bg-card)",
                  cursor: isMutatingLocked ? "not-allowed" : "pointer",
                  fontSize: "0.75rem",
                }}
              >
                <input
                  type="checkbox"
                  checked={editIsArtifact}
                  disabled={isSavingItemEdit || isMutatingLocked}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setEditIsArtifact(checked);
                    if (checked && !editLoreId && worldArtifactNodes.length > 0) {
                      setEditLoreId(worldArtifactNodes[0].id);
                    }
                    if (!checked) {
                      setEditLoreId("");
                    }
                  }}
                  style={{ marginTop: 2 }}
                />
                <div>
                  <div
                    style={{
                      fontWeight: 600,
                      color: editIsArtifact ? "#d8b4fe" : "var(--text-primary)",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <Sparkles size={11} /> World Artifact
                  </div>
                  <div style={{ fontSize: "0.69rem", color: "var(--text-muted)", marginTop: 2 }}>
                    Links this item to a major World Lore artifact entry (transferable unless also Permanent).
                  </div>
                </div>
              </label>
            </div>

            {editIsArtifact && (
              <div className="field-group">
                <label>Linked World Artifact Lore Entry</label>
                {worldArtifactNodes.length === 0 ? (
                  <div
                    style={{
                      fontSize: "0.74rem",
                      color: "var(--accent-amber)",
                      background: "rgba(245, 158, 11, 0.1)",
                      border: "1px solid rgba(245, 158, 11, 0.35)",
                      borderRadius: 6,
                      padding: "7px 10px",
                    }}
                  >
                    No <code>artifact</code> entries exist in{" "}
                    <strong>{activeWorldName || "this world"}</strong>&apos;s World Lore yet. Create a World Lore entry with category{" "}
                    <strong>artifact</strong> in the World Sheet first.
                  </div>
                ) : (
                  <select
                    className="field-select"
                    value={editLoreId}
                    disabled={isSavingItemEdit || isMutatingLocked}
                    onChange={(e) => setEditLoreId(e.target.value)}
                  >
                    <option value="">— Select World Artifact Lore —</option>
                    {worldArtifactNodes.map((ln) => (
                      <option key={ln.id} value={ln.id}>
                        {ln.title}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                marginTop: 2,
              }}
            >
              <button
                type="button"
                className="btn"
                style={{ padding: "4px 10px", fontSize: "0.74rem" }}
                disabled={isSavingItemEdit}
                onClick={() => {
                  setExpandedItemId(null);
                  setItemError(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-amber"
                style={{ padding: "4px 12px", fontSize: "0.74rem" }}
                disabled={
                  isSavingItemEdit ||
                  isMutatingLocked ||
                  (editIsArtifact && (!editLoreId || worldArtifactNodes.length === 0))
                }
                onClick={() => handleSaveItemUpdate(item)}
              >
                <Check size={12} />{" "}
                {isSavingItemEdit ? "Saving..." : "Save Item Lore"}
              </button>
            </div>
          </div>
        )}
      </div>
    );
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
              }}
            >
              <strong>Campaign Equipment &amp; Inventory.</strong> Click any item to attach a brief mini-lore note (injected only when relevant and absent from recent context) or set <strong>Permanent</strong> / <strong>World Artifact</strong> flags.
            </div>

            {itemError && (
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
                {itemError}
              </div>
            )}

            {itemSaveSuccess && (
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
                {itemSaveSuccess}
              </div>
            )}

            {/* Quick Add Item Form */}
            <form
              onSubmit={handleAddItem}
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 8,
                padding: "10px 12px",
                display: "flex",
                gap: 8,
                alignItems: "center",
              }}
            >
              <input
                type="text"
                className="field-input"
                placeholder="Add item name (e.g. Tarnished Locket, Plasma cutter)..."
                value={newItemName}
                disabled={isMutatingLocked}
                onChange={(e) => setNewItemName(e.target.value)}
                style={{ flex: 1 }}
              />
              <select
                className="field-select"
                value={newItemTarget}
                disabled={isMutatingLocked}
                onChange={(e) =>
                  setNewItemTarget(e.target.value as "inventory" | "equipped")
                }
                style={{ width: "130px" }}
              >
                <option value="inventory">Carried</option>
                <option value="equipped">Equipped</option>
              </select>
              <button
                type="submit"
                className="btn btn-amber"
                disabled={!newItemName.trim() || isSubmittingItem || isMutatingLocked}
                style={{ whiteSpace: "nowrap" }}
              >
                <Plus size={13} /> Add Item
              </button>
            </form>

            {/* Equipped Gear Section */}
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
                  Equipped Attire &amp; Gear ({equippedList.length})
                </span>
              </div>

              {equippedList.length === 0 ? (
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--text-muted)",
                    fontStyle: "italic",
                  }}
                >
                  No items currently equipped.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {equippedList.map((item) => renderItemCard(item, "equipped"))}
                </div>
              )}
            </div>

            {/* Carried Inventory Section */}
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
                  Carried Inventory &amp; Objects ({inventoryList.length})
                </span>
              </div>

              {inventoryList.length === 0 ? (
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--text-muted)",
                    fontStyle: "italic",
                  }}
                >
                  No items in carried inventory.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {inventoryList.map((item) => renderItemCard(item, "inventory"))}
                </div>
              )}
            </div>
          </div>
  );
};
