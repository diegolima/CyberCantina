import React, { useRef } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useModalDialog } from "../../hooks/useModalDialog";
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
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useModalDialog({
    isOpen: Boolean(prompt),
    onClose: onCancel,
    dialogRef,
  });

  if (!prompt) return null;

  return (
    <div
      className="modal-backdrop nav-guard-backdrop"
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="nav-guard-title"
        tabIndex={-1}
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
