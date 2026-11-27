import React, { useMemo } from "react";
import { AlertCircle, Copy, Info, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import type {
  LoreNode,
  MagicContextRef,
  WorldLoreCategory,
  WorldPromptContext,
} from "../../types";
import { useMagicWand } from "../../hooks/useMagicWand";
import { MagicWandButton } from "../MagicWandButton";
import { TagChipsInput } from "../TagChipsInput";
import {
  CODEX_SECTIONS,
  getCodexSectionForCategory,
  getLoreCategoryLabel,
  getWorldLoreValidationErrors,
} from "./codexHelpers";

interface CodexLoreEditorProps {
  lore: LoreNode;
  pendingTagDraft: string;
  isCampaignMode: boolean;
  worldId?: string;
  worldContext?: WorldPromptContext;
  titleInputRef?: React.RefObject<HTMLInputElement>;
  reclassifiedNotice?: {
    fromSectionLabel: string;
    toSectionLabel: string;
    previousCategory: WorldLoreCategory;
  } | null;
  artifactUnlinkNotice?: string | null;
  onDismissMoveNotice?: () => void;
  onUndoCategoryMove?: (previousCategory: WorldLoreCategory) => void;
  onTitleFocus?: () => void;
  onTitleBlur?: () => void;
  onChangeTitle: (nextTitle: string) => void;
  onChangeCategory: (nextCategory: WorldLoreCategory) => void;
  onDraftTagsChange: (draft: string) => void;
  onChangeTags: (nextTags: string[]) => void;
  onChangeContent: (nextContent: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export const CodexLoreEditor: React.FC<CodexLoreEditorProps> = ({
  lore,
  pendingTagDraft,
  isCampaignMode,
  worldId,
  worldContext,
  titleInputRef,
  reclassifiedNotice,
  artifactUnlinkNotice,
  onDismissMoveNotice,
  onUndoCategoryMove,
  onTitleFocus,
  onTitleBlur,
  onChangeTitle,
  onChangeCategory,
  onDraftTagsChange,
  onChangeTags,
  onChangeContent,
  onDuplicate,
  onDelete,
}) => {
  const validation = getWorldLoreValidationErrors(lore, pendingTagDraft);
  const activeSectionId = getCodexSectionForCategory(lore.category);
  const editableSections = CODEX_SECTIONS.filter((s) => !s.isSpecial);

  const loreContextRef = useMemo<MagicContextRef>(
    () => ({
      scope: "world_location",
      entity_kind: "location",
      world_id: worldContext?.worldId || worldId || lore.world_id || null,
      location_id: null,
      world_name: worldContext?.worldName || null,
      genre: worldContext?.genre || null,
      tone: worldContext?.tone || null,
      setting_overview: worldContext?.settingOverview || null,
      location_name: null,
      lore_title: lore.title.trim() || null,
      lore_category: lore.category,
      lore_tags: lore.entity_tags,
    }),
    [worldContext, worldId, lore.world_id, lore.title, lore.category, lore.entity_tags]
  );

  const contentWand = useMagicWand({
    fieldRole: "lore_content",
    value: lore.content,
    onChange: onChangeContent,
    contextRef: loreContextRef,
    contextKey: `codex-lore:${lore.id}`,
    disabled: isCampaignMode,
    singleLine: false,
    maxWords: 80,
  });

  if (isCampaignMode) {
    return (
      <div className="codex-detail-stack">
        <div className="codex-detail-header">
          <div style={{ minWidth: 0 }}>
            <div className="codex-detail-title-row">
              <h3 className="codex-detail-title">{lore.title}</h3>
            </div>
            <div className="codex-badge-row">
              <span className={`lore-cat-badge lore-cat-badge--${lore.category}`}>
                {getLoreCategoryLabel(lore.category)}
              </span>
            </div>
          </div>
        </div>

        <div className="codex-section-card">
          <div className="codex-section-label">Lore Content</div>
          <p className="codex-prose-text" style={{ whiteSpace: "pre-wrap" }}>
            {lore.content}
          </p>
        </div>

        <div className="codex-section-card">
          <div className="codex-section-label">Trigger Keywords</div>
          <div className="codex-chip-list">
            {lore.entity_tags.map((tag) => (
              <span key={tag} className="badge codex-tag-chip">
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="codex-detail-stack">
      {reclassifiedNotice && (
        <div className="codex-inline-notice">
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Info size={13} color="var(--accent-cyan)" />
            <span>
              Moved from <strong>{reclassifiedNotice.fromSectionLabel}</strong> to{" "}
              <strong>{reclassifiedNotice.toSectionLabel}</strong>.
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {onUndoCategoryMove && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => onUndoCategoryMove(reclassifiedNotice.previousCategory)}
              >
                <RotateCcw size={11} /> Undo
              </button>
            )}
            {onDismissMoveNotice && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={onDismissMoveNotice}
              >
                Dismiss
              </button>
            )}
          </div>
        </div>
      )}

      {artifactUnlinkNotice && (
        <div className="codex-inline-notice codex-inline-notice--amber">
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <AlertCircle size={13} color="var(--accent-amber)" />
            <span>{artifactUnlinkNotice}</span>
          </div>
        </div>
      )}

      {activeSectionId === "items_artifacts" && (
        <div className="codex-artifact-hint">
          <Sparkles size={13} color="var(--accent-amber)" />
          <span>
            Entries in <strong>Items &amp; Artifacts</strong> can be linked directly to character inventory items as World Artifacts.
          </span>
        </div>
      )}

      <div className="codex-editor-grid">
        <div className="field-group">
          <label htmlFor={`codex-title-${lore.id}`}>
            Lore Title <span style={{ color: "var(--text-muted)" }}>({lore.title.length}/120)</span>
          </label>
          <input
            ref={titleInputRef}
            id={`codex-title-${lore.id}`}
            type="text"
            className="field-input"
            maxLength={120}
            placeholder="Entry title..."
            value={lore.title}
            onFocus={onTitleFocus}
            onBlur={onTitleBlur}
            onChange={(e) => onChangeTitle(e.target.value)}
            style={
              validation.title
                ? { borderColor: "rgba(244, 63, 94, 0.7)" }
                : undefined
            }
          />
          {validation.title && (
            <span className="codex-field-error">Title required</span>
          )}
        </div>

        <div className="field-group">
          <label htmlFor={`codex-cat-${lore.id}`}>Category</label>
          <select
            id={`codex-cat-${lore.id}`}
            className="field-select"
            value={lore.category}
            onChange={(e) => onChangeCategory(e.target.value as WorldLoreCategory)}
          >
            {editableSections.map((sec) => (
              <optgroup key={sec.id} label={sec.label}>
                {sec.categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {getLoreCategoryLabel(cat)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      </div>

      <div className="field-group">
        <label>Trigger Keywords (min 1)</label>
        <TagChipsInput
          value={lore.entity_tags}
          accentVariant="violet"
          placeholder="Add keyword & press Enter..."
          helperText="Keywords trigger GraphRAG recall when mentioned in play."
          onDraftChange={onDraftTagsChange}
          onChange={onChangeTags}
        />
        {validation.keywords && (
          <span className="codex-field-error">Add at least 1 trigger keyword</span>
        )}
      </div>

      <div className="field-group">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label htmlFor={`codex-content-${lore.id}`} style={{ margin: 0 }}>
              Lore Content
            </label>
            <MagicWandButton
              wand={contentWand}
              isInputEmpty={!lore.content.trim()}
              isSlashCommand={false}
              variant="compact"
              compactLabel="Draft Lore"
              iconAccent="amber"
            />
          </div>
          <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
            {lore.content.length} / 2000
          </span>
        </div>
        <textarea
          id={`codex-content-${lore.id}`}
          className="field-textarea"
          rows={7}
          maxLength={2000}
          placeholder="Describe origins, significance, and impact on the world..."
          value={lore.content}
          onChange={(e) => onChangeContent(e.target.value)}
          style={
            validation.content
              ? { borderColor: "rgba(244, 63, 94, 0.7)" }
              : undefined
          }
        />
        {validation.content && (
          <span className="codex-field-error">Content required</span>
        )}
      </div>

      <div className="codex-editor-footer">
        <button
          type="button"
          className="btn btn-sm"
          onClick={onDuplicate}
          title="Duplicate this lore entry"
        >
          <Copy size={13} /> Duplicate
        </button>
        <button
          type="button"
          className="btn btn-sm"
          style={{
            color: "#fda4af",
            borderColor: "rgba(244, 63, 94, 0.4)",
          }}
          onClick={onDelete}
          title="Delete this lore entry"
        >
          <Trash2 size={13} /> Delete
        </button>
      </div>
    </div>
  );
};
