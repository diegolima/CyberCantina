import React, { useEffect, useMemo, useState } from "react";
import { BookOpen, ChevronDown, ChevronRight, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import {
  LOCATION_LORE_CATEGORIES,
  LocationLoreCategory,
  LocationLoreNodeDraft,
  LoreNode,
  MagicContextRef,
  WorldPromptContext,
} from "../../types";
import { useMagicWand } from "../../hooks/useMagicWand";
import { MagicWandButton } from "../MagicWandButton";
import { TagChipsInput, normalizeTagList } from "../TagChipsInput";

interface LoreContentFieldProps {
  value: string;
  onChange: (nextValue: string) => void;
  disabled: boolean;
  rows?: number;
  placeholder?: string;
  contextRef: MagicContextRef;
  contextKey: string;
  showWand: boolean;
}

const LoreContentField: React.FC<LoreContentFieldProps> = ({
  value,
  onChange,
  disabled,
  rows = 2,
  placeholder = "Lore details...",
  contextRef,
  contextKey,
  showWand,
}) => {
  const wand = useMagicWand({
    fieldRole: "lore_content",
    value,
    onChange,
    contextRef,
    contextKey,
    disabled: disabled || !showWand,
    singleLine: false,
    maxWords: 80,
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
        }}
      >
        <label style={{ fontSize: "0.68rem", color: "var(--text-secondary)", margin: 0 }}>
          Lore Details
        </label>
        {showWand && (
          <MagicWandButton
            wand={wand}
            isInputEmpty={!value.trim()}
            isSlashCommand={false}
            variant="compact"
            compactLabel="Draft Lore"
            iconAccent="amber"
          />
        )}
      </div>
      <textarea
        className="field-textarea"
        rows={rows}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
};

export interface MapLoreSectionProps {
  mode: "editor" | "campaign";
  isMutatingLocked: boolean;
  targetId: string;
  targetName: string;
  worldId: string;
  scopeLabel: string;
  emptyText: string;
  loreList: LoreNode[];
  canEditDraftLore: boolean;
  savedInDb: boolean;
  unlockLore?: boolean;
  revealedLoreIds?: readonly string[];
  worldContext?: WorldPromptContext;
  entityKind?: "location" | "container";
  parentContainerName?: string | null;
  targetSummary?: string | null;
  targetDescription?: string | null;
  targetTags?: readonly string[];
  onDraftUpdate?: (nextLore: LoreNode[]) => void;
  onCampaignSave?: (
    id: string,
    drafts: LocationLoreNodeDraft[]
  ) => Promise<void> | void;
  onToggleLoreReveal?: (
    loreId: string,
    revealed: boolean
  ) => Promise<void> | void;
}

function isSecretRevealed(
  lore: LoreNode,
  revealedLoreIds?: readonly string[]
): boolean {
  if (!revealedLoreIds || revealedLoreIds.length === 0) return false;
  const canonId = lore.origin_lore_id || lore.id;
  return revealedLoreIds.includes(canonId) || revealedLoreIds.includes(lore.id);
}

export const MapLoreSection: React.FC<MapLoreSectionProps> = ({
  mode,
  isMutatingLocked,
  targetId,
  targetName,
  worldId,
  scopeLabel,
  emptyText,
  loreList,
  canEditDraftLore,
  savedInDb,
  unlockLore = false,
  revealedLoreIds = [],
  worldContext,
  entityKind,
  parentContainerName,
  targetSummary,
  targetDescription,
  targetTags,
  onDraftUpdate,
  onCampaignSave,
  onToggleLoreReveal,
}) => {
  const canEditCampaignLore =
    mode === "campaign" && unlockLore && savedInDb && Boolean(onCampaignSave);
  const visibleLoreList =
    mode === "campaign" && !unlockLore
      ? loreList.filter(
          (ln) =>
            ln.category !== "secret" || isSecretRevealed(ln, revealedLoreIds)
        )
      : loreList;
  const [togglingRevealId, setTogglingRevealId] = useState<string | null>(null);
  const [expandedEditorLoreId, setExpandedEditorLoreId] = useState<string | null>(
    null
  );
  const [campLoreFormMode, setCampLoreFormMode] = useState<
    null | { mode: "add" } | { mode: "edit"; index: number }
  >(null);
  const [campLoreTitle, setCampLoreTitle] = useState("");
  const [campLoreCategory, setCampLoreCategory] =
    useState<LocationLoreCategory>("rumor");
  const [campLoreContent, setCampLoreContent] = useState("");
  const [campLoreTags, setCampLoreTags] = useState<string[]>([]);
  const [campLorePendingTagDraft, setCampLorePendingTagDraft] = useState("");
  const [campLoreError, setCampLoreError] = useState<string | null>(null);
  const [isSavingCampLore, setIsSavingCampLore] = useState(false);

  const resolvedEntityKind: "location" | "container" =
    entityKind ?? (scopeLabel.toLowerCase().includes("container") || scopeLabel.toLowerCase().includes("area") ? "container" : "location");

  const baseLoreContext = useMemo<
    Extract<MagicContextRef, { scope: "world_location" }>
  >(
    () => ({
      scope: "world_location",
      entity_kind: resolvedEntityKind,
      world_id: worldContext?.worldId || worldId || null,
      location_id: resolvedEntityKind === "location" ? targetId : null,
      world_name: worldContext?.worldName || null,
      genre: worldContext?.genre || null,
      tone: worldContext?.tone || null,
      setting_overview: worldContext?.settingOverview || null,
      parent_container_name: parentContainerName ?? null,
      location_name: targetName || null,
      location_summary: targetSummary ?? null,
      location_description: targetDescription ?? null,
      existing_tags: targetTags ? [...targetTags] : null,
    }),
    [
      resolvedEntityKind,
      worldContext,
      worldId,
      targetId,
      parentContainerName,
      targetName,
      targetSummary,
      targetDescription,
      targetTags,
    ]
  );

  useEffect(() => {
    setCampLoreFormMode(null);
    setCampLoreError(null);
    setCampLorePendingTagDraft("");
    setExpandedEditorLoreId(null);
  }, [targetId]);

    const updateDraftLoreAt = (idx: number, patch: Partial<LoreNode>) => {
      if (!onDraftUpdate) return;
      onDraftUpdate(loreList.map((item, i) => (i === idx ? { ...item, ...patch } : item)));
    };

    const handleAddDraftLore = () => {
      if (!onDraftUpdate) return;
      const newId = `new_lore_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      onDraftUpdate([
        ...loreList,
        {
          id: newId,
          world_id: worldId,
          location_id: scopeLabel.startsWith("Location") ? targetId : null,
          container_id: scopeLabel.startsWith("Container") ? targetId : null,
          title: "",
          category: "rumor",
          content: "",
          entity_tags: [],
        },
      ]);
      setExpandedEditorLoreId(newId);
    };

    const handleDeleteDraftLore = (idx: number) => {
      if (!onDraftUpdate) return;
      const removed = loreList[idx];
      onDraftUpdate(loreList.filter((_, i) => i !== idx));
      if (removed && expandedEditorLoreId === removed.id) {
        setExpandedEditorLoreId(null);
      }
    };

    const submitCampaignLoreForm = async () => {
      if (!onCampaignSave || !campLoreFormMode || isSavingCampLore) return;
      const trimmedTitle = campLoreTitle.trim();
      const trimmedContent = campLoreContent.trim();
      const pendingParts = campLorePendingTagDraft
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const effectiveTags = normalizeTagList(campLoreTags, pendingParts);

      if (!trimmedTitle) {
        setCampLoreError("Lore title is required.");
        return;
      }
      if (!trimmedContent) {
        setCampLoreError("Lore content is required.");
        return;
      }
      if (effectiveTags.length === 0) {
        setCampLoreError("At least 1 trigger keyword is required.");
        return;
      }

      const baseDrafts: LocationLoreNodeDraft[] = loreList.map((ln) => ({
        id: ln.id,
        title: ln.title,
        category: LOCATION_LORE_CATEGORIES.includes(
          ln.category as LocationLoreCategory
        )
          ? (ln.category as LocationLoreCategory)
          : "rumor",
        content: ln.content,
        entity_tags: [...ln.entity_tags],
      }));

      if (campLoreFormMode.mode === "add") {
        baseDrafts.push({
          title: trimmedTitle,
          category: campLoreCategory,
          content: trimmedContent,
          entity_tags: effectiveTags,
        });
      } else {
        const existingId = loreList[campLoreFormMode.index]?.id ?? null;
        baseDrafts[campLoreFormMode.index] = {
          id: existingId,
          title: trimmedTitle,
          category: campLoreCategory,
          content: trimmedContent,
          entity_tags: effectiveTags,
        };
      }

      setIsSavingCampLore(true);
      setCampLoreError(null);
      try {
        await onCampaignSave(targetId, baseDrafts);
        setCampLoreFormMode(null);
        setCampLorePendingTagDraft("");
      } catch (err: unknown) {
        setCampLoreError(err instanceof Error ? err.message : "Failed to save lore.");
      } finally {
        setIsSavingCampLore(false);
      }
    };

    const handleDeleteCampaignLore = async (idx: number) => {
      if (!onCampaignSave || isSavingCampLore || isMutatingLocked) return;
      const remaining: LocationLoreNodeDraft[] = loreList
        .filter((_, i) => i !== idx)
        .map((ln) => ({
          id: ln.id,
          title: ln.title,
          category: LOCATION_LORE_CATEGORIES.includes(
            ln.category as LocationLoreCategory
          )
            ? (ln.category as LocationLoreCategory)
            : "rumor",
          content: ln.content,
          entity_tags: [...ln.entity_tags],
        }));

      setIsSavingCampLore(true);
      setCampLoreError(null);
      try {
        await onCampaignSave(targetId, remaining);
        if (campLoreFormMode?.mode === "edit" && campLoreFormMode.index === idx) {
          setCampLoreFormMode(null);
        }
      } catch (err: unknown) {
        setCampLoreError(err instanceof Error ? err.message : "Failed to delete lore.");
      } finally {
        setIsSavingCampLore(false);
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
          }}
        >
          <span
            className="cog-step-label"
            style={{ display: "inline-flex", alignItems: "center", gap: 5, marginBottom: 0 }}
          >
            <BookOpen size={12} color="var(--accent-cyan)" />
            {scopeLabel} ({visibleLoreList.length})
          </span>

          {canEditDraftLore && onDraftUpdate && (
            <button
              type="button"
              className="btn"
              style={{ padding: "3px 8px", fontSize: "0.7rem" }}
              onClick={handleAddDraftLore}
            >
              <Plus size={11} /> Add Lore
            </button>
          )}

          {canEditCampaignLore && !campLoreFormMode && (
            <button
              type="button"
              className="btn"
              style={{ padding: "3px 8px", fontSize: "0.7rem" }}
              disabled={isMutatingLocked || isSavingCampLore}
              onClick={() => {
                setCampLoreFormMode({ mode: "add" });
                setCampLoreTitle("");
                setCampLoreCategory("rumor");
                setCampLoreContent("");
                setCampLoreTags([]);
                setCampLorePendingTagDraft("");
                setCampLoreError(null);
              }}
            >
              <Plus size={11} /> Add Lore
            </button>
          )}
        </div>

        {mode === "campaign" && unlockLore && !savedInDb && (
          <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontStyle: "italic" }}>
            Save the map first to attach persistent campaign lore to this new node.
          </div>
        )}

        {campLoreError && mode === "campaign" && !campLoreFormMode && (
          <div style={{ fontSize: "0.71rem", color: "#fda4af" }}>{campLoreError}</div>
        )}

        {canEditCampaignLore && campLoreFormMode && (
          <div
            style={{
              border: "1px solid rgba(6, 182, 212, 0.45)",
              borderRadius: 6,
              padding: 9,
              background: "var(--bg-panel)",
              display: "flex",
              flexDirection: "column",
              gap: 7,
            }}
          >
            <div style={{ fontSize: "0.74rem", fontWeight: 700, color: "var(--accent-cyan)" }}>
              {campLoreFormMode.mode === "add"
                ? `New Lore for ${targetName}`
                : "Edit Lore"}
            </div>
            <input
              className="field-input"
              placeholder="Title"
              value={campLoreTitle}
              disabled={isSavingCampLore || isMutatingLocked}
              onChange={(e) => setCampLoreTitle(e.target.value)}
            />
            <select
              className="field-select"
              value={campLoreCategory}
              disabled={isSavingCampLore || isMutatingLocked}
              onChange={(e) => setCampLoreCategory(e.target.value as LocationLoreCategory)}
            >
              {LOCATION_LORE_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
            <LoreContentField
              value={campLoreContent}
              onChange={setCampLoreContent}
              disabled={isSavingCampLore || isMutatingLocked}
              rows={2}
              placeholder="Lore details..."
              showWand={canEditCampaignLore && !isMutatingLocked}
              contextKey={`camp-lore:${targetId}:${
                campLoreFormMode.mode === "edit" ? campLoreFormMode.index : "add"
              }`}
              contextRef={{
                ...baseLoreContext,
                lore_title: campLoreTitle.trim() || null,
                lore_category: campLoreCategory,
                lore_tags: campLoreTags,
              }}
            />
            <TagChipsInput
              value={campLoreTags}
              onChange={setCampLoreTags}
              onDraftChange={setCampLorePendingTagDraft}
              disabled={isSavingCampLore || isMutatingLocked}
              accentVariant={campLoreCategory === "secret" ? "amber" : "cyan"}
            />
            {campLoreError && (
              <div style={{ fontSize: "0.7rem", color: "#fda4af" }}>{campLoreError}</div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
              <button
                type="button"
                className="btn"
                style={{ padding: "3px 9px", fontSize: "0.72rem" }}
                onClick={() => {
                  setCampLoreFormMode(null);
                  setCampLoreError(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-cyan"
                style={{ padding: "3px 10px", fontSize: "0.72rem" }}
                disabled={isSavingCampLore || isMutatingLocked}
                onClick={submitCampaignLoreForm}
              >
                {isSavingCampLore ? "Saving..." : "Save Lore"}
              </button>
            </div>
          </div>
        )}

        {visibleLoreList.length === 0 ? (
          <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontStyle: "italic" }}>
            {emptyText}
          </div>
        ) : canEditDraftLore && onDraftUpdate ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {loreList.map((ln, idx) => {
              const isExpanded = expandedEditorLoreId === ln.id;
              return (
                <div
                  key={ln.id}
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
                      onClick={() => setExpandedEditorLoreId(isExpanded ? null : ln.id)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--text-primary)",
                        fontSize: "0.74rem",
                        fontWeight: 600,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        padding: 0,
                      }}
                    >
                      {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      <span>{ln.title.trim() || "Untitled Lore"}</span>
                    </button>
                    <button
                      type="button"
                      className="item-remove-btn"
                      onClick={() => handleDeleteDraftLore(idx)}
                      title="Delete lore entry"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>

                  {isExpanded && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <input
                        className="field-input"
                        placeholder="Lore title (required)"
                        value={ln.title}
                        onChange={(e) => updateDraftLoreAt(idx, { title: e.target.value })}
                      />
                      <select
                        className="field-select"
                        value={ln.category}
                        onChange={(e) =>
                          updateDraftLoreAt(idx, {
                            category: e.target.value as LocationLoreCategory,
                          })
                        }
                      >
                        {LOCATION_LORE_CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                      </select>
                      <LoreContentField
                        value={ln.content}
                        onChange={(nextVal) =>
                          updateDraftLoreAt(idx, { content: nextVal })
                        }
                        disabled={isMutatingLocked}
                        rows={2}
                        placeholder="Lore details..."
                        showWand={canEditDraftLore && !isMutatingLocked}
                        contextKey={`draft-lore:${targetId}:${ln.id}`}
                        contextRef={{
                          ...baseLoreContext,
                          lore_title: ln.title.trim() || null,
                          lore_category: ln.category,
                          lore_tags: ln.entity_tags,
                        }}
                      />
                      <TagChipsInput
                        value={ln.entity_tags}
                        accentVariant={ln.category === "secret" ? "amber" : "cyan"}
                        onChange={(tags) => updateDraftLoreAt(idx, { entity_tags: tags })}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {visibleLoreList.map((ln, idx) => {
              const revealed =
                ln.category === "secret"
                  ? isSecretRevealed(ln, revealedLoreIds)
                  : false;
              const isToggling = togglingRevealId === ln.id;
              return (
              <div
                key={ln.id}
                style={{
                  background: "var(--bg-panel)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: 6,
                  padding: "6px 8px",
                  fontSize: "0.73rem",
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
                  <span style={{ fontWeight: 700, color: "var(--text-primary)", display: "inline-flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                    {ln.title}
                    <span className={`badge lore-cat-badge--${ln.category}`}>{ln.category}</span>
                    {mode === "campaign" && ln.category === "secret" && (
                      <span
                        className={`badge ${
                          revealed ? "codex-badge--emerald" : "codex-badge--amber"
                        }`}
                        style={{ fontSize: "0.62rem" }}
                      >
                        {revealed ? "Discovered" : "Hidden (GM)"}
                      </span>
                    )}
                  </span>
                  {canEditCampaignLore && (
                    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      {ln.category === "secret" && onToggleLoreReveal && (
                        <button
                          type="button"
                          className="btn"
                          style={{ padding: "1px 6px", fontSize: "0.66rem", display: "inline-flex", alignItems: "center", gap: 3 }}
                          disabled={isMutatingLocked || isSavingCampLore || isToggling}
                          onClick={async () => {
                            setTogglingRevealId(ln.id);
                            setCampLoreError(null);
                            try {
                              await onToggleLoreReveal(ln.id, !revealed);
                            } catch (err: unknown) {
                              setCampLoreError(
                                err instanceof Error ? err.message : "Failed to update secret visibility."
                              );
                            } finally {
                              setTogglingRevealId(null);
                            }
                          }}
                          title={revealed ? "Mark this secret hidden again" : "Mark this secret discovered"}
                        >
                          {revealed ? <EyeOff size={10} /> : <Eye size={10} />}
                          {revealed ? "Mark Hidden" : "Mark Revealed"}
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: "1px 6px", fontSize: "0.66rem" }}
                        disabled={isMutatingLocked || isSavingCampLore}
                        onClick={() => {
                          setCampLoreFormMode({ mode: "edit", index: idx });
                          setCampLoreTitle(ln.title);
                          setCampLoreCategory(
                            LOCATION_LORE_CATEGORIES.includes(
                              ln.category as LocationLoreCategory
                            )
                              ? (ln.category as LocationLoreCategory)
                              : "rumor"
                          );
                          setCampLoreContent(ln.content);
                          setCampLoreTags([...ln.entity_tags]);
                          setCampLorePendingTagDraft("");
                          setCampLoreError(null);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="item-remove-btn"
                        disabled={isMutatingLocked || isSavingCampLore}
                        onClick={() => handleDeleteCampaignLore(idx)}
                        title="Delete lore entry"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  )}
                </div>
                <div style={{ color: "var(--text-secondary)", marginTop: 3, lineHeight: 1.4 }}>
                  {ln.content}
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>
    );
};
