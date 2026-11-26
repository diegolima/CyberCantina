import React, { useEffect } from "react";
import { AlertTriangle, X } from "lucide-react";
import type { NavigationGuardPrompt } from "../../types";

export interface NavigationGuardModalProps {
  prompt: NavigationGuardPrompt | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export const NavigationGuardModal: React.FC<NavigationGuardModalProps> = ({
  prompt,
  onConfirm,
  onCancel,
}) => {
  useEffect(() => {
    if (!prompt || typeof window === "undefined") return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [prompt, onCancel]);

  if (!prompt) return null;

  return (
    <div
      className="modal-backdrop nav-guard-backdrop"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="nav-guard-title"
    >
      <div
        className="modal-panel nav-guard-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <span id="nav-guard-title" className="nav-guard-title">
            <AlertTriangle size={18} />
            {prompt.title}
          </span>
          <button
            type="button"
            className="btn"
            onClick={onCancel}
            aria-label="Close"
          >
            <X size={15} />
          </button>
        </div>

        <div className="modal-body nav-guard-body">
          <p>{prompt.message}</p>
        </div>

        <div className="nav-guard-footer">
          <button
            type="button"
            className="btn"
            onClick={onCancel}
            autoFocus
          >
            {prompt.cancelLabel}
          </button>
          <button
            type="button"
            className="btn nav-guard-confirm-btn"
            onClick={onConfirm}
          >
            {prompt.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
