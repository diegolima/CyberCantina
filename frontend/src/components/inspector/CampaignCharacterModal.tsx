import React, { useState, useEffect, useMemo } from "react";
import {
  Activity,
  Brain,
  Check,
  ChevronDown,
  ChevronUp,
  CircleMinus,
  CirclePlus,
  Clock,
  Database,
  Eye,
  FileText,
  HeartPulse,
  Image as ImageIcon,
  Lock,
  MapPin,
  Maximize2,
  MessageSquare,
  Package,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  User,
  Users,
  X,
} from "lucide-react";
import {
  CharacterRecord,
  CharacterStateSnapshot,
  GalleryImage,
  ItemEquipActionPayload,
  ItemFlag,
  ItemInstance,
  MemoryShard,
  WorldRecord,
  getTemperamentPresetMeta,
  hasItemFlag,
  splitLegacyWornItems,
} from "../../types";
import { getCharacterEmotionPortrait } from "../../utils/entityImages";
import { BASIC_EMOTIONS } from "../EntityEditorModals";
import { CommaSeparatedInput } from "../CommaSeparatedInput";
import {
  CharacterBaseTab,
  CharacterAppearanceTab,
  CharacterPersonalityTab,
  CharacterVoiceTab,
} from "../character";

type CampaignTab =
  | "base"
  | "appearance"
  | "personality"
  | "voice"
  | "memories"
  | "inventory"
  | "current"
  | "media";

interface CampaignCharacterModalProps {
  character: CharacterRecord;
  state: CharacterStateSnapshot;
  isPresent: boolean;
  elsewhereLocationName?: string;
  campaignId: string;
  campaignWorld?: WorldRecord;
  worlds?: WorldRecord[];
  initialTab?: CampaignTab;
  initialExpandedItemId?: string | null;
  isMutatingLocked?: boolean;
  characterNameMap?: Record<string, string>;
  onClose: () => void;
  onItemAction: (payload: ItemEquipActionPayload) => Promise<void> | void;
  onSaveMemories: (characterId: string, shards: MemoryShard[]) => Promise<void>;
}

export const CampaignCharacterModal: React.FC<CampaignCharacterModalProps> = ({
  character,
  state,
  isPresent,
  elsewhereLocationName,
  campaignId: _campaignId,
  campaignWorld,
  worlds = [],
  initialTab = "current",
  initialExpandedItemId = null,
  isMutatingLocked = false,
  characterNameMap = {},
  onClose,
  onItemAction,
  onSaveMemories,
}) => {
  // Default to "current" tab per user preference (unless opened via item click)
  const [activeTab, setActiveTab] = useState<CampaignTab>(initialTab);
  const [activeMediaSubTab, setActiveMediaSubTab] = useState<"portraits" | "gallery">("portraits");
  const [lightboxImage, setLightboxImage] = useState<GalleryImage | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setLightboxImage(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Editable memory shards state
  const [memoryShards, setMemoryShards] = useState<MemoryShard[]>(() =>
    character.memory_shards.map((m) => ({ ...m, keywords: [...m.keywords] }))
  );
  const [isMemoriesDirty, setIsMemoriesDirty] = useState(false);
  const [isSavingMemories, setIsSavingMemories] = useState(false);
  const [memorySaveSuccess, setMemorySaveSuccess] = useState(false);
  const [memoryError, setMemoryError] = useState<string | null>(null);

  // New item inputs
  const [newItemName, setNewItemName] = useState("");
  const [newItemTarget, setNewItemTarget] = useState<"inventory" | "equipped">("inventory");
  const [isSubmittingItem, setIsSubmittingItem] = useState(false);

  // Inline item lore & flags editor state
  const [expandedItemId, setExpandedItemId] = useState<string | null>(initialExpandedItemId);
  const [editItemName, setEditItemName] = useState("");
  const [editItemNote, setEditItemNote] = useState("");
  const [editIsPermanent, setEditIsPermanent] = useState(false);
  const [editIsArtifact, setEditIsArtifact] = useState(false);
  const [editLoreId, setEditLoreId] = useState<string>("");
  const [isSavingItemEdit, setIsSavingItemEdit] = useState(false);
  const [itemError, setItemError] = useState<string | null>(null);
  const [itemSaveSuccess, setItemSaveSuccess] = useState<string | null>(null);

  // Sync memory shards if character record changes externally
  useEffect(() => {
    if (!isMemoriesDirty) {
      setMemoryShards(
        character.memory_shards.map((m) => ({ ...m, keywords: [...m.keywords] }))
      );
    }
  }, [character.memory_shards, isMemoriesDirty]);

  // Derived inventory & equipped lists from live snapshot
  const { equippedList, inventoryList } = useMemo(
    () => splitLegacyWornItems(state.equipped, state.inventory),
    [state.equipped, state.inventory]
  );

  const allItems = useMemo(
    () => [...equippedList, ...inventoryList],
    [equippedList, inventoryList]
  );

  const valencePct = Math.round(((state.valence + 1) / 2) * 100);
  const arousalPct = Math.round(state.arousal * 100);
  const care = state.care_state ?? null;
  const dominancePct = care ? Math.round(((care.dominance + 1) / 2) * 100) : 50;
  const composurePct = care ? Math.round(care.composure * 100) : 82;
  const activeEmotion = care?.active_emotion ?? "default";
  const livePortraitUrl = getCharacterEmotionPortrait(character, activeEmotion);
  const temperamentMeta = getTemperamentPresetMeta(
    character.baseline_psyche.temperament?.archetype
  );
  const relationships = Object.entries(state.relationship_notes || {});
  const homeWorld = worlds.find((w) => w.id === character.world_id);
  const activeWorld = campaignWorld ?? homeWorld;

  const worldArtifactNodes = useMemo(
    () =>
      (activeWorld?.lore_nodes ?? []).filter(
        (ln) => ln.category === "artifact" && !ln.location_id
      ),
    [activeWorld]
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
    setActiveTab("inventory");
    const match = allItems.find((it) => it.id === initialExpandedItemId);
    if (match) {
      populateItemEditor(match);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialExpandedItemId]);

  const handleSaveMemories = async () => {
    setIsSavingMemories(true);
    setMemoryError(null);
    setMemorySaveSuccess(false);
    try {
      await onSaveMemories(character.id, memoryShards);
      setIsMemoriesDirty(false);
      setMemorySaveSuccess(true);
      setTimeout(() => setMemorySaveSuccess(false), 3000);
    } catch (err) {
      setMemoryError(String(err));
    } finally {
      setIsSavingMemories(false);
    }
  };

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
                    <strong>{activeWorld?.name || "this world"}</strong>&apos;s World Lore yet. Create a World Lore entry with category{" "}
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
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 85 }}>
      <div
        className="modal-panel"
        style={{ width: "min(860px, 95vw)", maxHeight: "92vh", display: "flex", flexDirection: "column" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
            {livePortraitUrl ? (
              <img
                src={livePortraitUrl}
                alt={`${character.name} (${activeEmotion})`}
                title={`Expression: ${activeEmotion}`}
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: "50%",
                  objectFit: "cover",
                  border: "1px solid var(--border-subtle)",
                }}
              />
            ) : (
              <Users size={18} color="var(--accent-amber)" />
            )}
            <span style={{ fontWeight: 700 }}>{character.name}</span>
            <span style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>
              · Character Dossier
            </span>
            <span
              className="badge"
              style={{ fontSize: "0.68rem", padding: "2px 6px" }}
              title={temperamentMeta.summary}
            >
              {temperamentMeta.label}
            </span>
            {!isPresent && (
              <span
                className="badge"
                style={{
                  fontSize: "0.7rem",
                  padding: "2px 6px",
                  background: "rgba(168, 85, 247, 0.15)",
                  borderColor: "rgba(168, 85, 247, 0.4)",
                  color: "#c084fc",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <MapPin size={10} />
                Elsewhere{elsewhereLocationName ? `: ${elsewhereLocationName}` : ""}
              </span>
            )}
          </span>
          <button type="button" className="btn" onClick={onClose} aria-label="Close dialog">
            <X size={15} />
          </button>
        </div>

        {/* Tab Navigation: Standard order preserved, Current opened by default */}
        <div className="modal-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "base"}
            className={`modal-tab-btn ${activeTab === "base" ? "active" : ""}`}
            onClick={() => setActiveTab("base")}
          >
            <User size={14} />
            <span>Base</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "appearance"}
            className={`modal-tab-btn ${activeTab === "appearance" ? "active" : ""}`}
            onClick={() => setActiveTab("appearance")}
          >
            <Eye size={14} />
            <span>Appearance</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "personality"}
            className={`modal-tab-btn ${activeTab === "personality" ? "active" : ""}`}
            onClick={() => setActiveTab("personality")}
          >
            <Brain size={14} />
            <span>Personality</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "voice"}
            className={`modal-tab-btn ${activeTab === "voice" ? "active" : ""}`}
            onClick={() => setActiveTab("voice")}
          >
            <MessageSquare size={14} />
            <span>Voice & Dialogue</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "memories"}
            className={`modal-tab-btn ${activeTab === "memories" ? "active" : ""}`}
            onClick={() => setActiveTab("memories")}
          >
            <Database size={14} />
            <span>Memories</span>
            <span className="modal-tab-badge">{memoryShards.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "inventory"}
            className={`modal-tab-btn ${activeTab === "inventory" ? "active" : ""}`}
            onClick={() => setActiveTab("inventory")}
          >
            <Package size={14} />
            <span>Inventory</span>
            <span className="modal-tab-badge">
              {equippedList.length + inventoryList.length}
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "current"}
            className={`modal-tab-btn ${activeTab === "current" ? "active" : ""}`}
            onClick={() => setActiveTab("current")}
          >
            <Activity size={14} color={activeTab === "current" ? "var(--accent-amber)" : undefined} />
            <span>Current</span>
            <span
              className="modal-tab-badge"
              style={{
                background: "rgba(245, 158, 11, 0.2)",
                color: "var(--accent-amber)",
                borderColor: "rgba(245, 158, 11, 0.4)",
              }}
            >
              Live
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "media"}
            className={`modal-tab-btn ${activeTab === "media" ? "active" : ""}`}
            onClick={() => setActiveTab("media")}
          >
            <ImageIcon size={14} />
            <span>Media</span>
            <span className="modal-tab-badge">
              {Object.keys(character.portraits ?? {}).length + (character.gallery ?? []).length}
            </span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="modal-body" style={{ overflowY: "auto", flex: 1 }}>
          {/* ========================================================================= */}
          {/* 1. Base Tab (Read-Only Reference)                                         */}
          {/* ========================================================================= */}
          <div
            style={{
              display: activeTab === "base" ? "flex" : "none",
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
              <strong>Campaign Dossier · Read-Only Base Reference.</strong> These static traits define the character&apos;s baseline anatomy and opening scenario.
            </div>

            <CharacterBaseTab
              data={character}
              readOnly={true}
              worlds={worlds}
            />
          </div>

          {/* ========================================================================= */}
          {/* 2. Appearance Tab (Read-Only Reference)                                   */}
          {/* ========================================================================= */}
          <div
            style={{
              display: activeTab === "appearance" ? "flex" : "none",
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
              <strong>Campaign Dossier · Read-Only Appearance Reference.</strong> Distinctive features, posture, mannerisms, and visual aesthetic.
            </div>

            <CharacterAppearanceTab
              data={character}
              readOnly={true}
            />
          </div>

          {/* ========================================================================= */}
          {/* 3. Personality Tab (Read-Only Reference)                                  */}
          {/* ========================================================================= */}
          <div
            style={{
              display: activeTab === "personality" ? "flex" : "none",
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
              <strong>Campaign Dossier · Read-Only Personality Reference.</strong> Core persona, behavioral traits, moral code, and motivational baselines.
            </div>

            <CharacterPersonalityTab
              data={character}
              readOnly={true}
            />
          </div>

          {/* ========================================================================= */}
          {/* 4. Voice & Dialogue Tab (Read-Only Reference)                             */}
          {/* ========================================================================= */}
          <div
            style={{
              display: activeTab === "voice" ? "flex" : "none",
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
              <strong>Campaign Dossier · Read-Only Voice Reference.</strong> Communication style keywords and dialogue context snippets.
            </div>

            <CharacterVoiceTab
              data={character}
              readOnly={true}
            />
          </div>

          {/* ========================================================================= */}
          {/* 3. Memories Tab (Editable, Campaign-Scoped, Applied Next Turn)            */}
          {/* ========================================================================= */}
          <div
            style={{
              display: activeTab === "memories" ? "flex" : "none",
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
                              await onSaveMemories(character.id, next);
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
                        <label>Trigger Keywords (comma-separated)</label>
                        <CommaSeparatedInput
                          className="field-input"
                          value={shard.keywords}
                          placeholder="e.g. dragon, betrayal, upper spire"
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

          {/* ========================================================================= */}
          {/* 4. Inventory Tab (Equip / Unequip / Remove / Add / Item Lore & Flags)     */}
          {/* ========================================================================= */}
          <div
            style={{
              display: activeTab === "inventory" ? "flex" : "none",
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

          {/* ========================================================================= */}
          {/* 5. Current Tab (New Live Psychological & Cognitive State - Default)      */}
          {/* ========================================================================= */}
          <div
            style={{
              display: activeTab === "current" ? "flex" : "none",
              flexDirection: "column",
              gap: 14,
            }}
          >
            {/* Status & Emotional Overview Banner */}
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
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    className="badge"
                    style={{
                      background: isPresent
                        ? "rgba(16, 185, 129, 0.15)"
                        : "rgba(168, 85, 247, 0.15)",
                      borderColor: isPresent
                        ? "rgba(16, 185, 129, 0.4)"
                        : "rgba(168, 85, 247, 0.4)",
                      color: isPresent ? "#6ee7b7" : "#c084fc",
                    }}
                  >
                    <MapPin size={11} style={{ marginRight: 4 }} />
                    {isPresent
                      ? "Present in Active Scene"
                      : `Elsewhere: ${elsewhereLocationName || "Unknown"}`}
                  </span>
                  <span
                    className="badge"
                    style={{
                      background: "rgba(245, 158, 11, 0.15)",
                      borderColor: "rgba(245, 158, 11, 0.4)",
                      color: "var(--accent-amber)",
                    }}
                  >
                    Mood: {state.mood_label || "Neutral"}
                  </span>
                  {activeEmotion !== "default" && (
                    <span
                      className="badge"
                      style={{ textTransform: "capitalize" }}
                    >
                      Expression: {activeEmotion}
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: "0.72rem",
                    color: "var(--text-muted)",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <Clock size={12} />
                  Turn ID: {state.turn_id}
                </div>
              </div>

              {care?.outward_demeanor && (
                <div
                  style={{
                    fontSize: "0.78rem",
                    color: "var(--text-secondary)",
                    fontStyle: "italic",
                    background: "var(--bg-panel)",
                    padding: "6px 10px",
                    borderRadius: 6,
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  <strong>Outward Demeanor:</strong> {care.outward_demeanor}
                </div>
              )}

              {/* Layer 2: PAD + Composure Emotional Meters */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                  marginTop: 4,
                }}
              >
                <div className="meter-row">
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: "0.73rem",
                      marginBottom: 4,
                    }}
                  >
                    <span>Valence (Distressed ↔ Warm)</span>
                    <span style={{ fontWeight: 600 }}>
                      {state.valence >= 0
                        ? `+${state.valence.toFixed(2)}`
                        : state.valence.toFixed(2)}
                    </span>
                  </div>
                  <div className="meter-track">
                    <div
                      className="meter-fill"
                      style={{
                        width: `${valencePct}%`,
                        background:
                          state.valence >= 0
                            ? "var(--accent-emerald)"
                            : "var(--accent-rose)",
                      }}
                    />
                  </div>
                </div>

                <div className="meter-row">
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: "0.73rem",
                      marginBottom: 4,
                    }}
                  >
                    <span>Arousal / Tension</span>
                    <span style={{ fontWeight: 600 }}>{state.arousal.toFixed(2)}</span>
                  </div>
                  <div className="meter-track">
                    <div
                      className="meter-fill"
                      style={{
                        width: `${arousalPct}%`,
                        background: "var(--accent-amber)",
                      }}
                    />
                  </div>
                </div>

                {care && (
                  <>
                    <div className="meter-row">
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: "0.73rem",
                          marginBottom: 4,
                        }}
                      >
                        <span>Dominance (Cornered ↔ Commanding)</span>
                        <span style={{ fontWeight: 600 }}>
                          {care.dominance >= 0
                            ? `+${care.dominance.toFixed(2)}`
                            : care.dominance.toFixed(2)}
                        </span>
                      </div>
                      <div className="meter-track">
                        <div
                          className="meter-fill"
                          style={{
                            width: `${dominancePct}%`,
                            background: "var(--accent-cyan)",
                          }}
                        />
                      </div>
                    </div>

                    <div className="meter-row">
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: "0.73rem",
                          marginBottom: 4,
                        }}
                      >
                        <span>Composure &amp; Emotional Mask</span>
                        <span style={{ fontWeight: 600 }}>{composurePct}%</span>
                      </div>
                      <div className="meter-track">
                        <div
                          className="meter-fill"
                          style={{
                            width: `${composurePct}%`,
                            background:
                              care.composure >= 0.45
                                ? "#a78bfa"
                                : "var(--accent-rose)",
                          }}
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Layer 3 & Layer 1: Situational Appraisal & Active Worldview */}
            {care && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
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
                    gap: 8,
                  }}
                >
                  <div className="sidebar-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Brain size={13} color="var(--accent-amber)" />
                    Layer 3 · Scene Appraisal
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: "0.74rem" }}>
                    <div>
                      <span style={{ color: "var(--text-muted)" }}>Threat: </span>
                      <strong>{Math.round(care.appraisal.threat * 100)}%</strong>
                    </div>
                    <div>
                      <span style={{ color: "var(--text-muted)" }}>Coping: </span>
                      <strong>
                        {care.appraisal.coping >= 0
                          ? `+${care.appraisal.coping.toFixed(2)}`
                          : care.appraisal.coping.toFixed(2)}
                      </strong>
                    </div>
                    <div>
                      <span style={{ color: "var(--text-muted)" }}>Goal Fit: </span>
                      <strong>
                        {care.appraisal.goal_congruence >= 0
                          ? `+${care.appraisal.goal_congruence.toFixed(2)}`
                          : care.appraisal.goal_congruence.toFixed(2)}
                      </strong>
                    </div>
                    <div>
                      <span style={{ color: "var(--text-muted)" }}>Surprise: </span>
                      <strong>{Math.round(care.appraisal.ambiguity * 100)}%</strong>
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    background: "var(--bg-card)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: 8,
                    padding: 12,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <div className="sidebar-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <HeartPulse size={13} color="#ec4899" />
                    Layer 1 · Active Worldview
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, fontSize: "0.74rem" }}>
                    <div>
                      <div style={{ color: "var(--text-muted)", fontSize: "0.69rem" }}>Benevolence</div>
                      <strong>
                        {care.active_worldview.benevolence >= 0
                          ? `+${care.active_worldview.benevolence.toFixed(2)}`
                          : care.active_worldview.benevolence.toFixed(2)}
                      </strong>
                    </div>
                    <div>
                      <div style={{ color: "var(--text-muted)", fontSize: "0.69rem" }}>Belonging</div>
                      <strong>
                        {care.active_worldview.belonging >= 0
                          ? `+${care.active_worldview.belonging.toFixed(2)}`
                          : care.active_worldview.belonging.toFixed(2)}
                      </strong>
                    </div>
                    <div>
                      <div style={{ color: "var(--text-muted)", fontSize: "0.69rem" }}>Agency</div>
                      <strong>
                        {care.active_worldview.agency >= 0
                          ? `+${care.active_worldview.agency.toFixed(2)}`
                          : care.active_worldview.agency.toFixed(2)}
                      </strong>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Active Scene Want */}
            <div
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 8,
                padding: 12,
              }}
            >
              <div
                className="sidebar-label"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: 6,
                }}
              >
                <Activity size={13} color="var(--accent-emerald)" />
                Active Scene Want
              </div>
              <div
                style={{
                  fontSize: "0.82rem",
                  lineHeight: 1.5,
                  color: "var(--text-primary)",
                  background: "var(--bg-panel)",
                  padding: "8px 12px",
                  borderRadius: 6,
                  border: "1px solid var(--border-subtle)",
                }}
              >
                {state.active_want || (
                  <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
                    Observing the scene carefully.
                  </span>
                )}
              </div>
            </div>

            {/* Active Tactical Plan */}
            <div
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 8,
                padding: 12,
              }}
            >
              <div
                className="sidebar-label"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: 6,
                }}
              >
                <Activity size={13} color="var(--accent-cyan)" />
                Active Tactical Plan
              </div>
              <div
                style={{
                  fontSize: "0.82rem",
                  lineHeight: 1.5,
                  color: "var(--text-primary)",
                  background: "var(--bg-panel)",
                  padding: "8px 12px",
                  borderRadius: 6,
                  border: "1px solid var(--border-subtle)",
                }}
              >
                {state.active_plan || (
                  <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
                    Waiting for the other speaker to move or reply.
                  </span>
                )}
              </div>
            </div>

            {/* Layer 4: Dyadic Relational Matrix & Trust Notes */}
            <div
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 8,
                padding: 12,
              }}
            >
              <div
                className="sidebar-label"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: 8,
                }}
              >
                <Users size={13} color="var(--accent-violet)" />
                Layer 4 · Dyadic Relational Bonds (
                {care
                  ? Object.keys(care.relations || {}).length
                  : relationships.length}
                )
              </div>

              {care && Object.keys(care.relations || {}).length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {Object.entries(care.relations).map(([target, edge]) => {
                    const displayTarget =
                      target === "user"
                        ? "Player (You)"
                        : characterNameMap[target] || target;
                    const renderMiniAxis = (label: string, val: number) => {
                      const pct = Math.round(((val + 1) / 2) * 100);
                      return (
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.69rem" }}>
                            <span style={{ color: "var(--text-muted)" }}>{label}</span>
                            <span>{val >= 0 ? `+${val.toFixed(2)}` : val.toFixed(2)}</span>
                          </div>
                          <div className="meter-track" style={{ height: 4 }}>
                            <div
                              className="meter-fill"
                              style={{
                                width: `${pct}%`,
                                background:
                                  val >= 0.05
                                    ? "var(--accent-emerald)"
                                    : val <= -0.05
                                    ? "var(--accent-rose)"
                                    : "var(--text-muted)",
                              }}
                            />
                          </div>
                        </div>
                      );
                    };
                    return (
                      <div
                        key={target}
                        style={{
                          background: "var(--bg-panel)",
                          border: "1px solid var(--border-subtle)",
                          borderRadius: 6,
                          padding: "9px 11px",
                          fontSize: "0.78rem",
                          display: "flex",
                          flexDirection: "column",
                          gap: 8,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                          <strong style={{ color: "#c4b5fd" }}>{displayTarget}</strong>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {edge.grievance >= 0.15 && (
                              <span
                                className="badge"
                                style={{
                                  fontSize: "0.66rem",
                                  padding: "1px 6px",
                                  borderColor: "rgba(244, 63, 94, 0.45)",
                                  color: "#fda4af",
                                }}
                              >
                                Grievance: {Math.round(edge.grievance * 100)}%
                              </span>
                            )}
                            {Math.abs(edge.obligation) >= 0.15 && (
                              <span
                                className="badge"
                                style={{
                                  fontSize: "0.66rem",
                                  padding: "1px 6px",
                                  borderColor: "rgba(245, 158, 11, 0.45)",
                                  color: "var(--accent-amber)",
                                }}
                              >
                                {edge.obligation > 0
                                  ? `Indebted (+${edge.obligation.toFixed(2)})`
                                  : `Owed Debt (${edge.obligation.toFixed(2)})`}
                              </span>
                            )}
                          </div>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
                          {renderMiniAxis("Warmth", edge.warmth)}
                          {renderMiniAxis("Trust", edge.trust)}
                          {renderMiniAxis("Respect", edge.respect)}
                          {renderMiniAxis("Power", edge.power)}
                        </div>
                        {(edge.episodic_note || state.relationship_notes?.[target]) && (
                          <div style={{ color: "var(--text-secondary)", fontSize: "0.76rem" }}>
                            {edge.episodic_note || state.relationship_notes?.[target]}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : relationships.length === 0 ? (
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--text-muted)",
                    fontStyle: "italic",
                  }}
                >
                  No specific relationship or trust notes recorded yet.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {relationships.map(([target, note]) => {
                    const displayTarget =
                      target === "user"
                        ? "Player"
                        : characterNameMap[target] || target;
                    return (
                      <div
                        key={target}
                        style={{
                          background: "var(--bg-panel)",
                          border: "1px solid var(--border-subtle)",
                          borderRadius: 6,
                          padding: "8px 10px",
                          fontSize: "0.78rem",
                        }}
                      >
                        <strong style={{ color: "#c4b5fd" }}>
                          {displayTarget}:
                        </strong>{" "}
                        <span>{note}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Core Drive & Fear Reminder */}
            <div
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 8,
                padding: 12,
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              <div>
                <div className="sidebar-label" style={{ marginBottom: 4 }}>
                  Core Drive
                </div>
                <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>
                  {character.baseline_psyche.core_drive}
                </div>
              </div>
              <div>
                <div className="sidebar-label" style={{ marginBottom: 4 }}>
                  Core Fear
                </div>
                <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>
                  {character.baseline_psyche.core_fear}
                </div>
              </div>
            </div>
          </div>

          {/* ========================================================================= */}
          {/* 6. Media Tab (Portraits & Photo Album - View Mode)                        */}
          {/* ========================================================================= */}
          <div
            style={{
              display: activeTab === "media" ? "flex" : "none",
              flexDirection: "column",
              gap: 16,
            }}
          >
            {/* Subtabs Switcher */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                borderBottom: "1px solid var(--border-subtle)",
                paddingBottom: 10,
              }}
            >
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className={`btn btn-sm ${
                    activeMediaSubTab === "portraits" ? "btn-amber" : ""
                  }`}
                  onClick={() => setActiveMediaSubTab("portraits")}
                >
                  <User size={13} />
                  <span>
                    Portraits ({Object.keys(character.portraits ?? {}).length}/8)
                  </span>
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${
                    activeMediaSubTab === "gallery" ? "btn-amber" : ""
                  }`}
                  onClick={() => setActiveMediaSubTab("gallery")}
                >
                  <ImageIcon size={13} />
                  <span>
                    Photo Album ({(character.gallery ?? []).length})
                  </span>
                </button>
              </div>
            </div>

            {/* Portraits Subtab */}
            {activeMediaSubTab === "portraits" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div
                  style={{
                    fontSize: "0.78rem",
                    color: "var(--text-secondary)",
                    lineHeight: 1.4,
                  }}
                >
                  Character portrait emotional expressions. Edit or upload additional expressions in the main Character Sheet.
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
                    gap: 14,
                  }}
                >
                  {BASIC_EMOTIONS.map(({ key, label, description }) => {
                    const portraitUrl = character.portraits?.[key];
                    return (
                      <div
                        key={key}
                        style={{
                          background: "var(--bg-card)",
                          border: "1px solid var(--border-subtle)",
                          borderRadius: 8,
                          padding: "12px 8px",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          gap: 8,
                          textAlign: "center",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: 2,
                          }}
                        >
                          <span
                            style={{
                              fontSize: "0.75rem",
                              fontWeight: 700,
                              textTransform: "uppercase",
                              letterSpacing: "0.05em",
                              color: portraitUrl
                                ? "var(--accent-amber)"
                                : "var(--text-secondary)",
                            }}
                          >
                            {label}
                          </span>
                          <span
                            style={{
                              fontSize: "0.68rem",
                              color: "var(--text-muted)",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              maxWidth: 110,
                            }}
                            title={description}
                          >
                            {description}
                          </span>
                        </div>

                        <div
                          style={{
                            position: "relative",
                            width: 86,
                            height: 86,
                            borderRadius: "50%",
                            overflow: "hidden",
                            border: portraitUrl
                              ? "2px solid var(--accent-amber)"
                              : "2px dashed var(--border-subtle)",
                            background: "rgba(0, 0, 0, 0.4)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            boxShadow: portraitUrl
                              ? "0 0 12px rgba(245, 158, 11, 0.15)"
                              : "none",
                          }}
                        >
                          {portraitUrl ? (
                            <img
                              src={portraitUrl}
                              alt={label}
                              style={{
                                width: "100%",
                                height: "100%",
                                objectFit: "cover",
                              }}
                            />
                          ) : (
                            <User
                              size={30}
                              style={{ color: "var(--text-muted)", opacity: 0.5 }}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Photo Album Subtab */}
            {activeMediaSubTab === "gallery" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {(!character.gallery || character.gallery.length === 0) ? (
                  <div
                    style={{
                      padding: "36px 16px",
                      textAlign: "center",
                      border: "1px dashed var(--border-subtle)",
                      borderRadius: 8,
                      color: "var(--text-muted)",
                      fontSize: "0.82rem",
                    }}
                  >
                    <ImageIcon size={32} style={{ margin: "0 auto 8px", opacity: 0.4 }} />
                    <div>No photos in this character's album yet.</div>
                  </div>
                ) : (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(135px, 1fr))",
                      gap: 12,
                    }}
                  >
                    {character.gallery.map((img) => (
                      <div
                        key={img.id}
                        style={{
                          position: "relative",
                          aspectRatio: "1 / 1",
                          borderRadius: 8,
                          overflow: "hidden",
                          background: "rgba(0, 0, 0, 0.4)",
                          border: "1px solid var(--border-subtle)",
                          cursor: "pointer",
                        }}
                        onClick={() => setLightboxImage(img)}
                      >
                        <img
                          src={img.url}
                          alt={img.caption || "Character Photo"}
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                          }}
                        />

                        {img.caption && (
                          <div
                            style={{
                              position: "absolute",
                              bottom: 0,
                              left: 0,
                              right: 0,
                              background:
                                "linear-gradient(transparent, rgba(0, 0, 0, 0.85))",
                              padding: "12px 6px 4px",
                              fontSize: "0.7rem",
                              color: "#fff",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {img.caption}
                          </div>
                        )}

                        <div
                          style={{
                            position: "absolute",
                            top: 6,
                            right: 6,
                            background: "rgba(0,0,0,0.6)",
                            borderRadius: 4,
                            padding: 3,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "rgba(255,255,255,0.8)",
                          }}
                        >
                          <Maximize2 size={12} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: "10px 16px",
            borderTop: "1px solid var(--border-subtle)",
            display: "flex",
            justifyContent: "flex-end",
            background: "var(--bg-panel)",
            borderBottomLeftRadius: 10,
            borderBottomRightRadius: 10,
          }}
        >
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>

        {/* Lightbox Modal Overlay */}
        {lightboxImage && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0, 0, 0, 0.9)",
              backdropFilter: "blur(6px)",
              zIndex: 10000,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
            }}
            onClick={() => setLightboxImage(null)}
          >
            <div
              style={{
                position: "relative",
                maxWidth: "92vw",
                maxHeight: "85vh",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="btn"
                style={{
                  position: "absolute",
                  top: -42,
                  right: 0,
                  background: "rgba(0,0,0,0.6)",
                  color: "#fff",
                  border: "1px solid rgba(255,255,255,0.2)",
                  borderRadius: "50%",
                  width: 34,
                  height: 34,
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                }}
                onClick={() => setLightboxImage(null)}
              >
                <X size={18} />
              </button>

              <img
                src={lightboxImage.url}
                alt={lightboxImage.caption || "Character Photo"}
                style={{
                  maxWidth: "100%",
                  maxHeight: "75vh",
                  objectFit: "contain",
                  borderRadius: 8,
                  border: "1px solid var(--border-subtle)",
                  boxShadow: "0 10px 40px rgba(0,0,0,0.8)",
                }}
              />

              <div
                style={{
                  marginTop: 12,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  color: "var(--text-secondary)",
                  fontSize: "0.82rem",
                }}
              >
                <span>
                  {lightboxImage.caption || (
                    <span style={{ fontStyle: "italic", opacity: 0.6 }}>
                      No caption
                    </span>
                  )}
                </span>
                <span style={{ fontSize: "0.75rem", opacity: 0.7 }}>
                  {new Date(lightboxImage.created_at).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
