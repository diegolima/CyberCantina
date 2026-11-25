import React, { useEffect, useState } from "react";
import { Activity, Check, Edit3, RotateCcw, X } from "lucide-react";
import {
  MAX_PHYSICAL_CONTEXT_LENGTH,
  MechanicsTopicId,
  PHYSICAL_STANCE_OPTIONS,
  PhysicalStance,
  PhysicalStateOverridePayload,
  getPhysicalStanceMeta,
  isPhysicalStateEstablished,
} from "../../types";
import { MechanicsHelpButton } from "./MechanicsHelpButton";

export interface PhysicalStateControlProps {
  /** Display label for accessible form controls (e.g. "You" or character name). */
  label: string;
  /** Optional header title shown in Codex card variant. */
  headerTitle?: string;
  stance?: PhysicalStance | null;
  context?: string | null;
  variant?: "inspector" | "codex";
  isMutatingLocked?: boolean;
  onSave?: (payload: PhysicalStateOverridePayload) => Promise<void> | void;
  onOpenMechanicsHelp?: (topicId: MechanicsTopicId) => void;
}

/** Shared inline display & override editor for live NPC or Player physical stance and context. */
export const PhysicalStateControl: React.FC<PhysicalStateControlProps> = ({
  label,
  headerTitle = "Physical Stance & Position",
  stance,
  context,
  variant = "codex",
  isMutatingLocked = false,
  onSave,
  onOpenMechanicsHelp,
}) => {
  const effectiveStance: PhysicalStance = stance ?? "unspecified";
  const effectiveContext = (context ?? "").trim();
  const stanceMeta = getPhysicalStanceMeta(effectiveStance);
  const established = isPhysicalStateEstablished(effectiveStance, effectiveContext);

  const [isEditing, setIsEditing] = useState(false);
  const [draftStance, setDraftStance] = useState<PhysicalStance>(effectiveStance);
  const [draftContext, setDraftContext] = useState(effectiveContext);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!isEditing) {
      setDraftStance(effectiveStance);
      setDraftContext(effectiveContext);
      setSaveError(null);
    }
  }, [effectiveStance, effectiveContext, isEditing]);

  const canEdit = Boolean(onSave) && !isMutatingLocked && !isSaving;

  const handleOpenEdit = () => {
    if (!canEdit) return;
    setDraftStance(effectiveStance);
    setDraftContext(effectiveContext);
    setSaveError(null);
    setIsEditing(true);
  };

  const handleCommit = async (payload: PhysicalStateOverridePayload) => {
    if (!onSave || isMutatingLocked || isSaving) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await onSave(payload);
      setIsEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to update physical state.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setDraftStance(effectiveStance);
    setDraftContext(effectiveContext);
    setSaveError(null);
    setIsEditing(false);
  };

  if (variant === "inspector") {
    return (
      <div className="inspector-player-physical">
        <div className="inspector-player-physical-top">
          <div className="inspector-player-physical-identity">
            <span className="inspector-player-physical-label">{label}</span>
            <span
              className={`physical-stance-pill physical-stance-pill--${stanceMeta.tone}`}
              title={stanceMeta.shortHint}
            >
              {stanceMeta.label}
            </span>
            <MechanicsHelpButton
              topicId="spatial-physical-stance"
              label="Physical Stance & Motion Continuity"
              onOpenHelp={onOpenMechanicsHelp}
              size={12}
            />
          </div>
          {onSave && !isEditing && (
            <button
              type="button"
              className="btn btn-ghost inspector-player-physical-edit-btn"
              disabled={!canEdit}
              onClick={handleOpenEdit}
              aria-label={`Edit ${label} physical stance`}
              title={
                isMutatingLocked
                  ? "Wait for the current turn to finish"
                  : `Edit ${label} physical stance & position`
              }
            >
              <Edit3 size={11} />
              <span>Edit</span>
            </button>
          )}
        </div>

        {!isEditing && (
          <div
            className={`inspector-player-physical-context ${
              effectiveContext ? "" : "inspector-player-physical-context--empty"
            }`}
          >
            {effectiveContext ||
              (established ? "No extra position note." : "No active physical pose tracked yet.")}
          </div>
        )}

        {isEditing && (
          <div className="physical-state-editor physical-state-editor--compact">
            <div className="physical-state-editor-row">
              <select
                aria-label={`${label} physical stance`}
                className="field-select physical-state-select"
                value={draftStance}
                disabled={isMutatingLocked || isSaving}
                onChange={(e) => setDraftStance(e.target.value as PhysicalStance)}
              >
                {PHYSICAL_STANCE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <input
                type="text"
                aria-label={`${label} physical position context`}
                className="field-input physical-state-input"
                maxLength={MAX_PHYSICAL_CONTEXT_LENGTH}
                value={draftContext}
                disabled={isMutatingLocked || isSaving}
                placeholder="Orientation, cover, hands (e.g. on stomach behind crate)"
                onChange={(e) => setDraftContext(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleCommit({
                      physical_stance: draftStance,
                      physical_context: draftContext.trim(),
                    });
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    handleCancel();
                  }
                }}
              />
            </div>
            <div className="physical-state-editor-actions">
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={isMutatingLocked || isSaving}
                onClick={() =>
                  void handleCommit({
                    physical_stance: draftStance,
                    physical_context: draftContext.trim(),
                  })
                }
              >
                <Check size={11} />
                <span>{isSaving ? "Saving..." : "Save"}</span>
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={isMutatingLocked || isSaving}
                title="Clear to Unspecified"
                onClick={() =>
                  void handleCommit({
                    physical_stance: "unspecified",
                    physical_context: "",
                  })
                }
              >
                <RotateCcw size={11} />
                <span>Reset</span>
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                disabled={isSaving}
                onClick={handleCancel}
              >
                <X size={11} />
                <span>Cancel</span>
              </button>
            </div>
            {saveError && <div className="physical-state-error">{saveError}</div>}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="codex-section-card codex-physical-card">
      <div className="codex-physical-header">
        <div className="codex-section-label" style={{ marginBottom: 0 }}>
          <Activity size={12} color="var(--accent-cyan)" />
          <span>{headerTitle}</span>
          <MechanicsHelpButton
            topicId="spatial-physical-stance"
            label="Physical Stance & Motion Continuity"
            onOpenHelp={onOpenMechanicsHelp}
          />
        </div>
        {onSave && !isEditing && (
          <button
            type="button"
            className="btn btn-sm"
            disabled={!canEdit}
            onClick={handleOpenEdit}
            aria-label={`Edit ${label} physical stance`}
          >
            <Edit3 size={11} />
            <span>Override</span>
          </button>
        )}
      </div>

      {!isEditing && (
        <div className="codex-physical-summary">
          <span
            className={`physical-stance-pill physical-stance-pill--${stanceMeta.tone}`}
            title={stanceMeta.shortHint}
          >
            {stanceMeta.label}
          </span>
          <span
            className={
              effectiveContext
                ? "codex-physical-context"
                : "codex-physical-context codex-physical-context--empty"
            }
          >
            {effectiveContext ||
              (established
                ? stanceMeta.shortHint
                : "No explicit stance or micro-position recorded yet.")}
          </span>
        </div>
      )}

      {isEditing && (
        <div className="physical-state-editor">
          <div className="physical-state-editor-row">
            <select
              aria-label={`${label} physical stance`}
              className="field-select physical-state-select"
              value={draftStance}
              disabled={isMutatingLocked || isSaving}
              onChange={(e) => setDraftStance(e.target.value as PhysicalStance)}
            >
              {PHYSICAL_STANCE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label} — {opt.shortHint}
                </option>
              ))}
            </select>
            <input
              type="text"
              aria-label={`${label} physical position context`}
              className="field-input physical-state-input"
              maxLength={MAX_PHYSICAL_CONTEXT_LENGTH}
              value={draftContext}
              disabled={isMutatingLocked || isSaving}
              placeholder="Orientation, cover, hands/contact (<= 120 chars)"
              onChange={(e) => setDraftContext(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleCommit({
                    physical_stance: draftStance,
                    physical_context: draftContext.trim(),
                  });
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  handleCancel();
                }
              }}
            />
          </div>
          <div className="physical-state-editor-actions">
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={isMutatingLocked || isSaving}
              onClick={() =>
                void handleCommit({
                  physical_stance: draftStance,
                  physical_context: draftContext.trim(),
                })
              }
            >
              <Check size={11} />
              <span>{isSaving ? "Saving..." : "Save Override"}</span>
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={isMutatingLocked || isSaving}
              title="Reset to Unspecified"
              onClick={() =>
                void handleCommit({
                  physical_stance: "unspecified",
                  physical_context: "",
                })
              }
            >
              <RotateCcw size={11} />
              <span>Reset</span>
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              disabled={isSaving}
              onClick={handleCancel}
            >
              <X size={11} />
              <span>Cancel</span>
            </button>
          </div>
          {saveError && <div className="physical-state-error">{saveError}</div>}
        </div>
      )}
    </div>
  );
};
