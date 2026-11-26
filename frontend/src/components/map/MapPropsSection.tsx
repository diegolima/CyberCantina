import React, { useEffect, useRef, useState } from "react";
import {
  ArrowRightLeft,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Package,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { ItemFlag, LocationProp, LoreNode } from "../../types";

export interface PropTransferTarget {
  id: string;
  label: string;
}

export interface MapPropsSectionProps {
  mode: "editor" | "campaign";
  isMutatingLocked: boolean;
  locationId: string;
  locationName: string;
  propsList: LocationProp[];
  savedInDb: boolean;
  worldArtifactLore?: LoreNode[];
  unlockLore?: boolean;
  revealedPropIds?: readonly string[];
  onDraftUpdate?: (nextProps: LocationProp[]) => void;
  onCampaignSave?: (
    locationId: string,
    props: LocationProp[]
  ) => Promise<void> | void;
  onTogglePropReveal?: (
    propId: string,
    revealed: boolean
  ) => Promise<void> | void;
  onTransferProp?: (
    propId: string,
    holderId: string
  ) => Promise<void> | void;
  transferTargets?: PropTransferTarget[];
}

const DEFAULT_TRANSFER_TARGETS: PropTransferTarget[] = [
  { id: "player", label: "Player" },
];

function isPropRevealed(
  prop: LocationProp,
  revealedPropIds?: readonly string[]
): boolean {
  if (!prop.is_hidden) return true;
  if (!prop.id || !revealedPropIds || revealedPropIds.length === 0) {
    return false;
  }
  return revealedPropIds.includes(prop.id);
}

function toggleItemFlag(flags: ItemFlag[], flag: ItemFlag): ItemFlag[] {
  if (flags.includes(flag)) {
    return flags.filter((f) => f !== flag);
  }
  return [...flags, flag];
}

export const MapPropsSection: React.FC<MapPropsSectionProps> = ({
  mode,
  isMutatingLocked,
  locationId,
  locationName,
  propsList,
  savedInDb,
  worldArtifactLore = [],
  unlockLore = false,
  revealedPropIds = [],
  onDraftUpdate,
  onCampaignSave,
  onTogglePropReveal,
  onTransferProp,
  transferTargets = DEFAULT_TRANSFER_TARGETS,
}) => {
  const artifactOptions = worldArtifactLore.filter(
    (ln) => ln.category === "artifact"
  );
  const effectiveTransferTargets =
    transferTargets.length > 0 ? transferTargets : DEFAULT_TRANSFER_TARGETS;

  const canEditDraftProps = mode === "editor" && Boolean(onDraftUpdate);
  const canEditCampaignProps =
    mode === "campaign" &&
    unlockLore &&
    savedInDb &&
    Boolean(onCampaignSave);

  const visibleProps =
    mode === "campaign" && !unlockLore
      ? propsList.filter((p) => isPropRevealed(p, revealedPropIds))
      : propsList;

  const [expandedEditorPropId, setExpandedEditorPropId] = useState<
    string | null
  >(null);
  const [focusPropId, setFocusPropId] = useState<string | null>(null);
  const propInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const propCardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const [togglingRevealId, setTogglingRevealId] = useState<string | null>(null);
  const [transferringPropId, setTransferringPropId] = useState<string | null>(
    null
  );
  const [transferHolderByPropId, setTransferHolderByPropId] = useState<
    Record<string, string>
  >({});

  const [campFormMode, setCampFormMode] = useState<
    null | { mode: "add" } | { mode: "edit"; index: number }
  >(null);
  const [campPropName, setCampPropName] = useState("");
  const [campPropNote, setCampPropNote] = useState("");
  const [campPropHidden, setCampPropHidden] = useState(false);
  const [campPropFlags, setCampPropFlags] = useState<ItemFlag[]>([]);
  const [campPropLoreId, setCampPropLoreId] = useState<string>("");
  const [campPropError, setCampPropError] = useState<string | null>(null);
  const [isSavingCampProp, setIsSavingCampProp] = useState(false);

  useEffect(() => {
    setCampFormMode(null);
    setCampPropError(null);
    setExpandedEditorPropId(null);
    setFocusPropId(null);
  }, [locationId]);

  useEffect(() => {
    if (!focusPropId) return;
    const cardEl = propCardRefs.current[focusPropId];
    if (cardEl && typeof cardEl.scrollIntoView === "function") {
      cardEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    const inputEl = propInputRefs.current[focusPropId];
    if (inputEl && typeof inputEl.focus === "function") {
      inputEl.focus();
    }
    setFocusPropId(null);
  }, [focusPropId, propsList.length]);

  const artifactTitleById = new Map<string, string>();
  for (const art of artifactOptions) {
    artifactTitleById.set(art.id, art.title);
    if (art.origin_lore_id) {
      artifactTitleById.set(art.origin_lore_id, art.title);
    }
  }

  const updateDraftPropAt = (idx: number, patch: Partial<LocationProp>) => {
    if (!onDraftUpdate) return;
    onDraftUpdate(
      propsList.map((item, i) => (i === idx ? { ...item, ...patch } : item))
    );
  };

  const handleAddDraftProp = () => {
    if (!onDraftUpdate) return;
    const newId = `prop_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    onDraftUpdate([
      ...propsList,
      {
        id: newId,
        name: "",
        note: "",
        flags: [],
        lore_id: null,
        is_hidden: false,
      },
    ]);
    setExpandedEditorPropId(newId);
    setFocusPropId(newId);
  };

  const handleDeleteDraftProp = (idx: number) => {
    if (!onDraftUpdate) return;
    const removed = propsList[idx];
    onDraftUpdate(propsList.filter((_, i) => i !== idx));
    if (removed && expandedEditorPropId === (removed.id || String(idx))) {
      setExpandedEditorPropId(null);
    }
  };

  const submitCampaignPropForm = async () => {
    if (!onCampaignSave || !campFormMode || isSavingCampProp) return;
    const trimmedName = campPropName.trim();
    if (!trimmedName) {
      setCampPropError("Prop name is required.");
      return;
    }

    const baseList: LocationProp[] = propsList.map((p) => ({
      ...p,
      flags: [...(p.flags ?? [])],
    }));

    if (campFormMode.mode === "add") {
      baseList.push({
        name: trimmedName,
        note: campPropNote.trim(),
        flags: [...campPropFlags],
        lore_id: campPropLoreId || null,
        is_hidden: campPropHidden,
      });
    } else {
      const existing = propsList[campFormMode.index];
      baseList[campFormMode.index] = {
        ...(existing || {}),
        id: existing?.id,
        auto_spawned: existing?.auto_spawned,
        name: trimmedName,
        note: campPropNote.trim(),
        flags: [...campPropFlags],
        lore_id: campPropLoreId || null,
        is_hidden: campPropHidden,
      };
    }

    setIsSavingCampProp(true);
    setCampPropError(null);
    try {
      await onCampaignSave(locationId, baseList);
      setCampFormMode(null);
    } catch (err: unknown) {
      setCampPropError(
        err instanceof Error ? err.message : "Failed to save location props."
      );
    } finally {
      setIsSavingCampProp(false);
    }
  };

  const handleDeleteCampaignProp = async (idx: number) => {
    if (!onCampaignSave || isSavingCampProp || isMutatingLocked) return;
    const remaining = propsList
      .filter((_, i) => i !== idx)
      .map((p) => ({ ...p, flags: [...(p.flags ?? [])] }));
    setIsSavingCampProp(true);
    setCampPropError(null);
    try {
      await onCampaignSave(locationId, remaining);
      if (campFormMode?.mode === "edit" && campFormMode.index === idx) {
        setCampFormMode(null);
      }
    } catch (err: unknown) {
      setCampPropError(
        err instanceof Error ? err.message : "Failed to delete prop."
      );
    } finally {
      setIsSavingCampProp(false);
    }
  };

  return (
    <div
      style={{
        borderTop: "1px solid var(--border-subtle)",
        paddingTop: 10,
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
          gap: 8,
          position: "sticky",
          top: 0,
          background: "var(--bg-surface)",
          zIndex: 2,
          paddingBottom: 2,
        }}
      >
        <span
          className="cog-step-label"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            marginBottom: 0,
          }}
        >
          <Package size={12} color="var(--accent-amber)" />
          Location Props ({visibleProps.length})
        </span>

        {canEditDraftProps && (
          <button
            type="button"
            className="btn"
            style={{ padding: "3px 8px", fontSize: "0.7rem" }}
            disabled={isMutatingLocked}
            onClick={handleAddDraftProp}
          >
            <Plus size={11} /> Add Prop
          </button>
        )}

        {canEditCampaignProps && !campFormMode && (
          <button
            type="button"
            className="btn"
            style={{ padding: "3px 8px", fontSize: "0.7rem" }}
            disabled={isMutatingLocked || isSavingCampProp}
            onClick={() => {
              setCampFormMode({ mode: "add" });
              setCampPropName("");
              setCampPropNote("");
              setCampPropHidden(false);
              setCampPropFlags([]);
              setCampPropLoreId("");
              setCampPropError(null);
            }}
          >
            <Plus size={11} /> Add Prop
          </button>
        )}
      </div>

      {mode === "campaign" && unlockLore && !savedInDb && (
        <div
          style={{
            fontSize: "0.7rem",
            color: "var(--text-muted)",
            fontStyle: "italic",
          }}
        >
          Save the map first to manage persistent props on this location.
        </div>
      )}

      {campPropError && mode === "campaign" && !campFormMode && (
        <div style={{ fontSize: "0.71rem", color: "#fda4af" }}>
          {campPropError}
        </div>
      )}

      {canEditCampaignProps && campFormMode && (
        <div
          style={{
            border: "1px solid var(--amber-border)",
            borderRadius: 6,
            padding: 9,
            background: "var(--bg-panel)",
            display: "flex",
            flexDirection: "column",
            gap: 7,
          }}
        >
          <div
            style={{
              fontSize: "0.74rem",
              fontWeight: 700,
              color: "var(--accent-amber)",
            }}
          >
            {campFormMode.mode === "add"
              ? `New Prop in ${locationName}`
              : "Edit Prop"}
          </div>
          <input
            className="field-input"
            placeholder="Prop name (required)"
            value={campPropName}
            disabled={isSavingCampProp || isMutatingLocked}
            onChange={(e) => setCampPropName(e.target.value)}
          />
          <textarea
            className="field-textarea"
            rows={2}
            placeholder="Brief description, clue, or usage hint..."
            value={campPropNote}
            disabled={isSavingCampProp || isMutatingLocked}
            onChange={(e) => setCampPropNote(e.target.value)}
          />
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              fontSize: "0.72rem",
              color: "var(--text-secondary)",
            }}
          >
            <label
              style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }}
            >
              <input
                type="checkbox"
                checked={campPropHidden}
                disabled={isSavingCampProp || isMutatingLocked}
                onChange={(e) => setCampPropHidden(e.target.checked)}
              />
              <span>Hidden</span>
            </label>
            <label
              style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }}
            >
              <input
                type="checkbox"
                checked={campPropFlags.includes("artifact")}
                disabled={isSavingCampProp || isMutatingLocked}
                onChange={() =>
                  setCampPropFlags((prev) => toggleItemFlag(prev, "artifact"))
                }
              />
              <span>Artifact</span>
            </label>
            <label
              style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }}
            >
              <input
                type="checkbox"
                checked={campPropFlags.includes("permanent")}
                disabled={isSavingCampProp || isMutatingLocked}
                onChange={() =>
                  setCampPropFlags((prev) => toggleItemFlag(prev, "permanent"))
                }
              />
              <span>Permanent</span>
            </label>
          </div>
          {artifactOptions.length > 0 && (
            <select
              className="field-select"
              value={campPropLoreId}
              disabled={isSavingCampProp || isMutatingLocked}
              onChange={(e) => setCampPropLoreId(e.target.value)}
            >
              <option value="">No linked Codex artifact</option>
              {artifactOptions.map((art) => (
                <option key={art.id} value={art.id}>
                  Artifact: {art.title}
                </option>
              ))}
            </select>
          )}
          {campPropError && (
            <div style={{ fontSize: "0.7rem", color: "#fda4af" }}>
              {campPropError}
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
            <button
              type="button"
              className="btn"
              style={{ padding: "3px 9px", fontSize: "0.72rem" }}
              onClick={() => {
                setCampFormMode(null);
                setCampPropError(null);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-amber"
              style={{ padding: "3px 10px", fontSize: "0.72rem" }}
              disabled={isSavingCampProp || isMutatingLocked}
              onClick={submitCampaignPropForm}
            >
              {isSavingCampProp ? "Saving..." : "Save Prop"}
            </button>
          </div>
        </div>
      )}

      {visibleProps.length === 0 ? (
        <div
          style={{
            fontSize: "0.72rem",
            color: "var(--text-muted)",
            fontStyle: "italic",
          }}
        >
          No tracked props in this location.
        </div>
      ) : canEditDraftProps ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {propsList.map((prop, idx) => {
            const propKey = prop.id || `draft_prop_${idx}`;
            const isExpanded = expandedEditorPropId === propKey;
            const flags = prop.flags ?? [];
            return (
              <div
                key={propKey}
                ref={(el) => {
                  propCardRefs.current[propKey] = el;
                }}
                style={{
                  background: "var(--bg-panel)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: 6,
                  padding: "6px 8px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 6,
                  }}
                >
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedEditorPropId(isExpanded ? null : propKey)
                    }
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--text-primary)",
                      fontSize: "0.74rem",
                      fontWeight: 600,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      padding: 0,
                      flexWrap: "wrap",
                      textAlign: "left",
                    }}
                  >
                    {isExpanded ? (
                      <ChevronDown size={12} />
                    ) : (
                      <ChevronRight size={12} />
                    )}
                    <span>{prop.name.trim() || "Untitled Prop"}</span>
                    {prop.is_hidden && (
                      <span
                        className="badge codex-badge--amber"
                        style={{ fontSize: "0.6rem" }}
                      >
                        Hidden
                      </span>
                    )}
                    {flags.includes("artifact") && (
                      <span
                        className="badge lore-cat-badge--artifact"
                        style={{ fontSize: "0.6rem" }}
                      >
                        artifact
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    className="item-remove-btn"
                    disabled={isMutatingLocked}
                    onClick={() => handleDeleteDraftProp(idx)}
                    title="Delete prop"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>

                {isExpanded && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    <input
                      ref={(el) => {
                        propInputRefs.current[propKey] = el;
                      }}
                      className="field-input"
                      placeholder="Prop name (required)"
                      value={prop.name}
                      disabled={isMutatingLocked}
                      onChange={(e) =>
                        updateDraftPropAt(idx, { name: e.target.value })
                      }
                    />
                    <textarea
                      className="field-textarea"
                      rows={2}
                      placeholder="Brief item description, clue, or usage hint..."
                      value={prop.note}
                      disabled={isMutatingLocked}
                      onChange={(e) =>
                        updateDraftPropAt(idx, { note: e.target.value })
                      }
                    />
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 10,
                        fontSize: "0.72rem",
                        color: "var(--text-secondary)",
                      }}
                    >
                      <label
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(prop.is_hidden)}
                          disabled={isMutatingLocked}
                          onChange={(e) =>
                            updateDraftPropAt(idx, {
                              is_hidden: e.target.checked,
                            })
                          }
                        />
                        <span>Hidden</span>
                      </label>
                      <label
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={flags.includes("artifact")}
                          disabled={isMutatingLocked}
                          onChange={() =>
                            updateDraftPropAt(idx, {
                              flags: toggleItemFlag(flags, "artifact"),
                            })
                          }
                        />
                        <span>Artifact</span>
                      </label>
                      <label
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={flags.includes("permanent")}
                          disabled={isMutatingLocked}
                          onChange={() =>
                            updateDraftPropAt(idx, {
                              flags: toggleItemFlag(flags, "permanent"),
                            })
                          }
                        />
                        <span>Permanent</span>
                      </label>
                    </div>
                    {artifactOptions.length > 0 && (
                      <select
                        className="field-select"
                        value={prop.lore_id ?? ""}
                        disabled={isMutatingLocked}
                        onChange={(e) =>
                          updateDraftPropAt(idx, {
                            lore_id: e.target.value || null,
                          })
                        }
                      >
                        <option value="">No linked Codex artifact</option>
                        {artifactOptions.map((art) => (
                          <option key={art.id} value={art.id}>
                            Artifact: {art.title}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {visibleProps.map((prop, idx) => {
            const propKey = prop.id || `camp_prop_${idx}`;
            const revealed = isPropRevealed(prop, revealedPropIds);
            const flags = prop.flags ?? [];
            const linkedArtifactTitle = prop.lore_id
              ? artifactTitleById.get(prop.lore_id)
              : undefined;
            const isToggling = Boolean(prop.id && togglingRevealId === prop.id);
            const isTransferring = Boolean(
              prop.id && transferringPropId === prop.id
            );
            const selectedHolderId =
              transferHolderByPropId[propKey] ??
              effectiveTransferTargets[0]?.id ??
              "player";

            return (
              <div
                key={propKey}
                style={{
                  background: "var(--bg-panel)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: 6,
                  padding: "6px 8px",
                  fontSize: "0.73rem",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 6,
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    style={{
                      fontWeight: 700,
                      color: "var(--text-primary)",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      flexWrap: "wrap",
                    }}
                  >
                    {prop.name}
                    {prop.is_hidden && (
                      <span
                        className={`badge ${
                          revealed ? "codex-badge--emerald" : "codex-badge--amber"
                        }`}
                        style={{ fontSize: "0.61rem" }}
                      >
                        {revealed ? "Discovered" : "Hidden (GM)"}
                      </span>
                    )}
                    {prop.auto_spawned && (
                      <span
                        className="badge"
                        style={{
                          fontSize: "0.61rem",
                          background: "var(--cyan-bg)",
                          color: "var(--accent-cyan)",
                          border: "1px solid var(--cyan-border)",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 3,
                        }}
                      >
                        <Sparkles size={9} />
                        Auto-spawned
                      </span>
                    )}
                    {flags.map((flag) => (
                      <span
                        key={flag}
                        className={`badge ${
                          flag === "artifact"
                            ? "lore-cat-badge--artifact"
                            : "codex-badge--violet"
                        }`}
                        style={{ fontSize: "0.6rem" }}
                      >
                        {flag}
                      </span>
                    ))}
                  </span>

                  {canEditCampaignProps && (
                    <div
                      style={{
                        display: "flex",
                        gap: 4,
                        alignItems: "center",
                        flexWrap: "wrap",
                      }}
                    >
                      {prop.is_hidden && prop.id && onTogglePropReveal && (
                        <button
                          type="button"
                          className="btn"
                          style={{
                            padding: "1px 6px",
                            fontSize: "0.66rem",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 3,
                          }}
                          disabled={
                            isMutatingLocked ||
                            isSavingCampProp ||
                            isToggling ||
                            isTransferring
                          }
                          onClick={async () => {
                            if (!prop.id) return;
                            setTogglingRevealId(prop.id);
                            setCampPropError(null);
                            try {
                              await onTogglePropReveal(
                                prop.id,
                                !revealedPropIds.includes(prop.id)
                              );
                            } catch (err: unknown) {
                              setCampPropError(
                                err instanceof Error
                                  ? err.message
                                  : "Failed to update prop visibility."
                              );
                            } finally {
                              setTogglingRevealId(null);
                            }
                          }}
                          title={
                            revealedPropIds.includes(prop.id)
                              ? "Mark prop hidden again"
                              : "Reveal prop in room"
                          }
                        >
                          {revealedPropIds.includes(prop.id) ? (
                            <EyeOff size={10} />
                          ) : (
                            <Eye size={10} />
                          )}
                          {revealedPropIds.includes(prop.id)
                            ? "Hide"
                            : "Reveal"}
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: "1px 6px", fontSize: "0.66rem" }}
                        disabled={
                          isMutatingLocked || isSavingCampProp || isTransferring
                        }
                        onClick={() => {
                          setCampFormMode({ mode: "edit", index: idx });
                          setCampPropName(prop.name);
                          setCampPropNote(prop.note || "");
                          setCampPropHidden(Boolean(prop.is_hidden));
                          setCampPropFlags([...(prop.flags ?? [])]);
                          setCampPropLoreId(prop.lore_id ?? "");
                          setCampPropError(null);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="item-remove-btn"
                        disabled={
                          isMutatingLocked || isSavingCampProp || isTransferring
                        }
                        onClick={() => handleDeleteCampaignProp(idx)}
                        title="Delete prop"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  )}
                </div>

                {prop.note && (
                  <div
                    style={{
                      color: "var(--text-secondary)",
                      lineHeight: 1.4,
                    }}
                  >
                    {prop.note}
                  </div>
                )}

                {linkedArtifactTitle && (
                  <div
                    style={{
                      fontSize: "0.68rem",
                      color: "var(--accent-amber)",
                    }}
                  >
                    Linked Artifact: {linkedArtifactTitle}
                  </div>
                )}

                {canEditCampaignProps && prop.id && onTransferProp && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      marginTop: 2,
                      flexWrap: "wrap",
                    }}
                  >
                    <select
                      className="field-select"
                      aria-label={`Transfer ${prop.name} to`}
                      style={{
                        flex: 1,
                        minWidth: 110,
                        padding: "2px 6px",
                        fontSize: "0.69rem",
                      }}
                      value={selectedHolderId}
                      disabled={
                        isMutatingLocked || isSavingCampProp || isTransferring
                      }
                      onChange={(e) =>
                        setTransferHolderByPropId((prev) => ({
                          ...prev,
                          [propKey]: e.target.value,
                        }))
                      }
                    >
                      {effectiveTransferTargets.map((target) => (
                        <option key={target.id} value={target.id}>
                          {target.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn"
                      style={{
                        padding: "2px 7px",
                        fontSize: "0.67rem",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                      disabled={
                        isMutatingLocked || isSavingCampProp || isTransferring
                      }
                      onClick={async () => {
                        if (!prop.id) return;
                        setTransferringPropId(prop.id);
                        setCampPropError(null);
                        try {
                          await onTransferProp(prop.id, selectedHolderId);
                        } catch (err: unknown) {
                          setCampPropError(
                            err instanceof Error
                              ? err.message
                              : "Failed to transfer prop."
                          );
                        } finally {
                          setTransferringPropId(null);
                        }
                      }}
                    >
                      <ArrowRightLeft size={10} />
                      {isTransferring ? "Moving..." : "Transfer"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
