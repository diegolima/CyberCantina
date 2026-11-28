import React, { useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, ArrowUpCircle, CopyPlus, RotateCcw, X } from "lucide-react";
import { useModalDialog } from "../hooks/useModalDialog";
import type { SeedUpdateInfo, SeedUpdateMode } from "../types";

export interface SeedUpdateModalProps {
  entityKind: "world" | "character";
  entityName: string;
  seedUpdate: SeedUpdateInfo;
  busy?: boolean;
  error?: string | null;
  onConfirm: (mode: SeedUpdateMode, copyName?: string) => void;
  onDismissVersion: () => void;
  onClose: () => void;
}

export const SeedUpdateModal: React.FC<SeedUpdateModalProps> = ({
  entityKind,
  entityName,
  seedUpdate,
  busy = false,
  error = null,
  onConfirm,
  onDismissVersion,
  onClose,
}) => {
  const defaultCopyName = `${entityName} (Custom Copy)`;
  const [copyName, setCopyName] = useState(defaultCopyName);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const copyInputId = useId();

  useEffect(() => {
    setCopyName(`${entityName} (Custom Copy)`);
  }, [entityName, seedUpdate.seed_key, seedUpdate.latest_version]);

  useModalDialog({
    isOpen: true,
    onClose,
    dialogRef,
    disableEscape: busy,
  });

  const entityLabel = entityKind === "world" ? "World" : "Character";
  const isModified = seedUpdate.seed_modified;

  return (
    <div
      className="modal-backdrop seed-update-modal-backdrop"
      onClick={() => !busy && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="modal-panel seed-update-modal-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="seed-update-modal-title-row">
            <ArrowUpCircle
              size={18}
              color={
                entityKind === "world"
                  ? "var(--accent-cyan)"
                  : "var(--accent-amber)"
              }
            />
            <span id={titleId} className="seed-update-modal-title">
              Update {entityName}
            </span>
            <span
              className={`seed-update-version-pill ${
                entityKind === "world" ? "is-cyan" : "is-amber"
              }`}
            >
              v{seedUpdate.current_version} → v{seedUpdate.latest_version}
            </span>
          </div>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={onClose}
            aria-label="Close modal"
          >
            <X size={15} />
          </button>
        </div>

        <div className="modal-body seed-update-modal-body">
          {seedUpdate.changelog && (
            <div className="seed-update-changelog-box">
              <div className="seed-update-section-label">What&apos;s new</div>
              <p className="seed-update-changelog-text">{seedUpdate.changelog}</p>
            </div>
          )}

          {isModified ? (
            <div className="seed-update-callout is-modified">
              <AlertTriangle size={16} color="var(--accent-amber)" />
              <div>
                <strong>Manual edits detected.</strong> You can keep your edited{" "}
                {entityLabel.toLowerCase()} as a standalone copy while installing
                the updated built-in seed, or replace it directly.
              </div>
            </div>
          ) : (
            <p className="seed-update-plain-text">
              This built-in {entityLabel.toLowerCase()} has no manual edits and
              will be updated cleanly to version {seedUpdate.latest_version}.
            </p>
          )}

          {isModified && (
            <div className="seed-update-copy-field">
              <label htmlFor={copyInputId} className="seed-update-section-label">
                Saved copy name
              </label>
              <input
                id={copyInputId}
                type="text"
                className="field-input"
                value={copyName}
                maxLength={160}
                disabled={busy}
                placeholder={defaultCopyName}
                onChange={(e) => setCopyName(e.target.value)}
              />
            </div>
          )}

          {isModified && seedUpdate.has_custom_media && (
            <div className="seed-update-callout is-warning">
              <AlertTriangle size={15} color="var(--accent-rose)" />
              <div>
                Custom uploaded media is attached to this{" "}
                {entityLabel.toLowerCase()}.{" "}
                <strong>Save Copy &amp; Update</strong> keeps all custom media on
                your copy; <strong>Replace &amp; Discard Edits</strong> drops it.
              </div>
            </div>
          )}

          {entityKind === "world" &&
            (seedUpdate.linked_characters_count ?? 0) > 0 && (
              <div className="seed-update-meta-note">
                {isModified
                  ? "Custom or edited linked characters stay on your saved copy; unmodified built-in characters move to the updated world with artifact links remapped."
                  : `${seedUpdate.linked_characters_count} linked character${
                      seedUpdate.linked_characters_count === 1 ? "" : "s"
                    } will remain linked with artifact lore references remapped automatically.`}
              </div>
            )}

          {seedUpdate.active_campaigns_count > 0 && (
            <div className="seed-update-meta-note">
              {seedUpdate.active_campaigns_count} active campaign
              {seedUpdate.active_campaigns_count === 1 ? "" : "s"} currently use
              this {entityLabel.toLowerCase()} and will remain safely untouched on
              their existing snapshot.
            </div>
          )}

          {error && <div className="seed-update-error">{error}</div>}
        </div>

        <div className="modal-footer seed-update-modal-footer">
          {isModified ? (
            <>
              <button
                type="button"
                className="btn btn-ghost btn-sm seed-update-skip-btn"
                disabled={busy}
                onClick={onDismissVersion}
              >
                Skip v{seedUpdate.latest_version}
              </button>
              <div className="seed-update-footer-actions">
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={onClose}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn seed-update-discard-btn"
                  disabled={busy}
                  onClick={() => onConfirm("replace")}
                >
                  <RotateCcw size={14} />
                  <span>{busy ? "Updating..." : "Replace & Discard Edits"}</span>
                </button>
                <button
                  type="button"
                  className={`btn ${
                    entityKind === "world" ? "seed-update-cyan-btn" : "btn-amber"
                  }`}
                  disabled={busy}
                  onClick={() =>
                    onConfirm("copy_and_update", copyName.trim() || undefined)
                  }
                >
                  <CopyPlus size={14} />
                  <span>{busy ? "Saving Copy..." : "Save Copy & Update"}</span>
                </button>
              </div>
            </>
          ) : (
            <div className="seed-update-footer-actions">
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`btn ${
                  entityKind === "world" ? "seed-update-cyan-btn" : "btn-amber"
                }`}
                disabled={busy}
                onClick={() => onConfirm("replace")}
              >
                <ArrowUpCircle size={14} />
                <span>{busy ? "Updating..." : `Update ${entityLabel}`}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
