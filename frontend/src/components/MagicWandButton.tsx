import React from "react";
import { RefreshCw, RotateCcw, Sparkles, Wand2, X } from "lucide-react";
import { UseMagicWandReturn } from "../types";

export interface MagicWandButtonProps {
  wand: UseMagicWandReturn;
  isInputEmpty: boolean;
  isSlashCommand: boolean;
  shortcutLabel?: string;
  variant?: "pill" | "compact";
  compactLabel?: string;
  iconAccent?: "amber" | "violet";
}

export const MagicWandButton: React.FC<MagicWandButtonProps> = ({
  wand,
  isInputEmpty,
  isSlashCommand,
  shortcutLabel = "Alt+Shift+E",
  variant = "pill",
  compactLabel = "AI assist",
  iconAccent = "amber",
}) => {
  const {
    status,
    error,
    canEnrich,
    canRevert,
    isDirtyAfterApply,
    triggerEnrich,
    cancelEnrich,
    revert,
    dismissUndo,
  } = wand;

  const accentVar = iconAccent === "violet" ? "var(--accent-violet)" : "var(--accent-amber)";

  if (variant === "compact") {
    if (status === "enriching") {
      return (
        <span className="magic-wand-active-bar compact">
          <RefreshCw size={11} className="spin-slow" color={accentVar} />
          <span style={{ fontSize: "0.68rem", color: "var(--text-secondary)" }}>Generating...</span>
          <button
            type="button"
            className="btn magic-wand-cancel-btn"
            onClick={cancelEnrich}
            title="Cancel AI generation"
            aria-label="Cancel AI generation"
          >
            <X size={11} />
          </button>
        </span>
      );
    }

    if (canRevert) {
      return (
        <span className="magic-wand-revert-bar compact">
          <button
            type="button"
            className="btn magic-wand-revert-btn"
            onClick={revert}
            title="Revert to previous value"
          >
            <RotateCcw size={11} />
            <span>Undo</span>
          </button>
          <button
            type="button"
            className="btn magic-wand-dismiss-btn"
            onClick={dismissUndo}
            title="Keep value and dismiss undo"
            aria-label="Dismiss undo"
          >
            <X size={11} />
          </button>
        </span>
      );
    }

    const compactTooltip = error
      ? `AI assist error: ${error}`
      : isInputEmpty
      ? `${compactLabel}: Generate with AI`
      : `${compactLabel}: Enhance with AI`;

    return (
      <span className="magic-wand-trigger-container compact">
        <button
          type="button"
          className={`btn magic-wand-icon-btn ${iconAccent === "violet" ? "accent-violet" : "accent-amber"} ${status === "error" ? "has-error" : ""}`}
          disabled={!canEnrich}
          onClick={() => triggerEnrich("auto")}
          title={compactTooltip}
          aria-label={compactTooltip}
        >
          <Wand2 size={12} color={accentVar} />
        </button>
      </span>
    );
  }

  if (status === "enriching") {
    return (
      <div className="magic-wand-active-bar">
        <span className="magic-wand-loading-badge">
          <RefreshCw size={11} className="spin-slow" />
          <span>Generating prose...</span>
        </span>
        <button
          type="button"
          className="btn magic-wand-cancel-btn"
          onClick={cancelEnrich}
          title="Cancel AI generation"
        >
          <X size={11} />
        </button>
      </div>
    );
  }

  if (canRevert) {
    return (
      <div className="magic-wand-revert-bar">
        <span className="magic-wand-applied-badge">
          <Sparkles size={11} color="var(--accent-amber)" />
          <span>Enhanced{isDirtyAfterApply ? " (edited)" : ""}</span>
        </span>
        <button
          type="button"
          className="btn magic-wand-revert-btn"
          onClick={revert}
          title="Revert to your original text"
        >
          <RotateCcw size={11} />
          <span>Revert</span>
        </button>
        <button
          type="button"
          className="btn magic-wand-dismiss-btn"
          onClick={dismissUndo}
          title="Keep this text and dismiss undo"
        >
          <X size={11} />
        </button>
      </div>
    );
  }

  const tooltip = isSlashCommand
    ? "AI enhancement unavailable for slash commands"
    : isInputEmpty
    ? `Inspire: Draft a roleplay action based on scene (${shortcutLabel})`
    : `Enhance: Polish roleplay prompt (${shortcutLabel})`;

  return (
    <div className="magic-wand-trigger-container">
      {error && (
        <span className="magic-wand-error" title={error}>
          Enrichment failed
        </span>
      )}
      <button
        type="button"
        className={`btn magic-wand-btn ${status === "error" ? "has-error" : ""}`}
        disabled={!canEnrich}
        onClick={() => triggerEnrich("auto")}
        title={tooltip}
      >
        <Sparkles size={12} color="var(--accent-amber)" />
        <span>{isInputEmpty ? "Inspire" : "Enhance"}</span>
      </button>
    </div>
  );
};
