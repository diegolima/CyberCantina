import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  BookPlus,
  CheckCircle2,
  Loader2,
  XCircle,
} from "lucide-react";
import {
  WORLD_LORE_CATEGORIES,
  type GmCodexProposal,
  type WorldLoreCategory,
  type WorldLoreNodeDraft,
} from "../../types";
import { normalizeTagList, TagChipsInput } from "../TagChipsInput";
import { getLoreCategoryLabel } from "../world/codexHelpers";

export interface GmCodexProposalCardProps {
  proposal: GmCodexProposal;
  unlockLore: boolean;
  isBusy?: boolean;
  error?: string | null;
  onConfirm?: (draft: WorldLoreNodeDraft, replaceLoreId: string | null) => void;
  onCancel?: () => void;
  onOpenCodex?: () => void;
}

function mergePendingTag(tags: string[], pendingDraft: string): string[] {
  const trimmed = pendingDraft.trim();
  if (!trimmed) return tags;
  const parts = trimmed
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? normalizeTagList(tags, parts, 20, 64) : tags;
}

export const GmCodexProposalCard: React.FC<GmCodexProposalCardProps> = ({
  proposal,
  unlockLore,
  isBusy = false,
  error = null,
  onConfirm,
  onCancel,
  onOpenCodex,
}) => {
  const [title, setTitle] = useState(proposal.draft.title);
  const [category, setCategory] = useState<WorldLoreCategory>(proposal.draft.category);
  const [entityTags, setEntityTags] = useState<string[]>(proposal.draft.entity_tags);
  const [pendingTagDraft, setPendingTagDraft] = useState("");
  const [content, setContent] = useState(proposal.draft.content);
  const [replaceLoreId, setReplaceLoreId] = useState<string>(
    proposal.replace_lore_id ?? ""
  );
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setTitle(proposal.draft.title);
    setCategory(proposal.draft.category);
    setEntityTags(proposal.draft.entity_tags);
    setPendingTagDraft("");
    setContent(proposal.draft.content);
    setReplaceLoreId(proposal.replace_lore_id ?? "");
    setLocalError(null);
  }, [proposal.id, proposal.draft, proposal.replace_lore_id]);

  if (proposal.status === "confirmed") {
    return (
      <div className="gm-codex-proposal-card gm-codex-proposal-card--confirmed">
        <div className="gm-codex-proposal-status-row">
          <CheckCircle2 size={14} color="var(--accent-emerald)" />
          <span className="gm-codex-proposal-status-text">
            Saved to World Codex · <strong>{proposal.draft.title}</strong>
          </span>
          <span className={`lore-cat-badge lore-cat-badge--${proposal.draft.category}`}>
            {getLoreCategoryLabel(proposal.draft.category)}
          </span>
          {onOpenCodex && (
            <button
              type="button"
              className="btn gm-codex-open-btn"
              onClick={onOpenCodex}
            >
              <BookOpen size={12} />
              <span>Open Codex</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  if (proposal.status === "cancelled") {
    return (
      <div className="gm-codex-proposal-card gm-codex-proposal-card--cancelled">
        <div className="gm-codex-proposal-status-row">
          <XCircle size={13} />
          <span className="gm-codex-proposal-status-text">
            Codex proposal dismissed ({proposal.draft.title})
          </span>
        </div>
      </div>
    );
  }

  const mergedTags = mergePendingTag(entityTags, pendingTagDraft);
  const trimmedTitle = title.trim();
  const trimmedContent = content.trim();

  const validationProblem = !trimmedTitle
    ? "Title is required."
    : mergedTags.length === 0
      ? "At least 1 keyword tag is required."
      : !trimmedContent
        ? "Entry content cannot be empty."
        : null;

  const displayError = error || localError;

  const handleConfirmClick = () => {
    if (isBusy) return;
    if (validationProblem) {
      setLocalError(validationProblem);
      return;
    }
    setLocalError(null);
    onConfirm?.(
      {
        id: replaceLoreId || null,
        title: trimmedTitle,
        category,
        content: trimmedContent,
        entity_tags: mergedTags,
      },
      replaceLoreId || null
    );
  };

  return (
    <div className="gm-codex-proposal-card" role="region" aria-label="Proposed World Codex Entry">
      <div className="gm-codex-proposal-head">
        <div className="gm-codex-proposal-title-row">
          <BookPlus size={14} color="var(--accent-amber)" />
          <strong>Proposed World Codex Entry</strong>
        </div>
        {proposal.source_turns.length > 0 && (
          <span
            className="gm-codex-provenance-pill"
            title="Reference only — turn numbers are not saved inside the Codex entry text."
          >
            Grounded in {proposal.source_turns.length === 1 ? "Turn" : "Turns"}{" "}
            {proposal.source_turns.join(", ")}
          </span>
        )}
      </div>

      {proposal.duplicate_matches.length > 0 && (
        <div className="gm-codex-proposal-dupes">
          <div className="gm-codex-dupes-header">
            <AlertTriangle size={13} />
            <span>Similar World Codex entries already exist:</span>
          </div>
          <div className="gm-codex-dupes-options">
            <label className="gm-codex-dupe-option">
              <input
                type="radio"
                name={`codex-mode-${proposal.id}`}
                checked={replaceLoreId === ""}
                disabled={isBusy}
                onChange={() => setReplaceLoreId("")}
              />
              <span>Create as new entry</span>
            </label>
            {proposal.duplicate_matches.map((match) => {
              const blockedByGmMode = match.is_base_world && !unlockLore;
              return (
                <label
                  key={match.id}
                  className={`gm-codex-dupe-option ${blockedByGmMode ? "is-disabled" : ""}`}
                  title={
                    blockedByGmMode
                      ? "Enable Unlock Lore & Secrets (GM Mode) in World Settings to overwrite pre-existing base-world Codex entries."
                      : match.match_reason
                  }
                >
                  <input
                    type="radio"
                    name={`codex-mode-${proposal.id}`}
                    checked={replaceLoreId === match.id}
                    disabled={isBusy || blockedByGmMode}
                    onChange={() => setReplaceLoreId(match.id)}
                  />
                  <span>
                    Update existing: <strong>{match.title}</strong>
                    {match.match_reason ? ` (${match.match_reason})` : ""}
                    {blockedByGmMode ? " — requires GM Mode" : ""}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      <div className="gm-codex-proposal-grid">
        <label className="gm-codex-proposal-field">
          <span>Title</span>
          <input
            type="text"
            value={title}
            maxLength={120}
            disabled={isBusy}
            onChange={(e) => {
              setTitle(e.target.value);
              if (localError) setLocalError(null);
            }}
            placeholder="Entry title..."
          />
        </label>

        <label className="gm-codex-proposal-field">
          <span>Category</span>
          <select
            value={category}
            disabled={isBusy}
            onChange={(e) => setCategory(e.target.value as WorldLoreCategory)}
          >
            {WORLD_LORE_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {getLoreCategoryLabel(cat)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="gm-codex-proposal-field">
        <span>Keywords / Tags</span>
        <TagChipsInput
          value={entityTags}
          onChange={(next) => {
            setEntityTags(next);
            if (localError) setLocalError(null);
          }}
          onDraftChange={setPendingTagDraft}
          disabled={isBusy}
          maxTags={20}
          accentVariant="amber"
          required
          placeholder="Add keyword & press Enter..."
        />
      </div>

      <label className="gm-codex-proposal-field">
        <div className="gm-codex-field-label-row">
          <span>In-Universe Description</span>
          <span className="gm-codex-char-count">{content.length} / 2000</span>
        </div>
        <textarea
          value={content}
          maxLength={2000}
          rows={4}
          disabled={isBusy}
          onChange={(e) => {
            setContent(e.target.value);
            if (localError) setLocalError(null);
          }}
          placeholder="Concise in-universe Codex description..."
        />
      </label>

      {displayError && (
        <div className="gm-codex-proposal-error" role="alert">
          {displayError}
        </div>
      )}

      <div className="gm-codex-proposal-footer">
        <button
          type="button"
          className="btn gm-codex-cancel-btn"
          disabled={isBusy}
          onClick={() => onCancel?.()}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-amber gm-codex-confirm-btn"
          disabled={isBusy || Boolean(validationProblem)}
          onClick={handleConfirmClick}
        >
          {isBusy ? (
            <>
              <Loader2 size={13} className="spinning" />
              <span>Saving…</span>
            </>
          ) : (
            <>
              <CheckCircle2 size={13} />
              <span>{replaceLoreId ? "Update Codex Entry" : "Confirm & Add to Codex"}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
