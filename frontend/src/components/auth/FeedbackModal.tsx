import React from "react";
import { AlertTriangle, Check } from "lucide-react";

export interface FeedbackModalProps {
  type: "success" | "error";
  title: string;
  message: string;
  onConfirm: () => void;
  confirmLabel?: string;
}

export const FeedbackModal: React.FC<FeedbackModalProps> = ({
  type,
  title,
  message,
  onConfirm,
  confirmLabel = "OK",
}) => {
  return (
    <div className="modal-backdrop" style={{ zIndex: 1200 }}>
      <div className="modal-panel" style={{ maxWidth: 460, padding: 0 }}>
        <div
          className="modal-header"
          style={{
            borderColor:
              type === "error"
                ? "rgba(244, 63, 94, 0.4)"
                : "rgba(16, 185, 129, 0.4)",
          }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              color:
                type === "error" ? "#fda4af" : "var(--accent-emerald)",
            }}
          >
            {type === "error" ? (
              <AlertTriangle size={18} />
            ) : (
              <Check size={18} />
            )}
            {title}
          </span>
        </div>
        <div
          className="modal-body"
          style={{
            padding: "20px",
            fontSize: "0.88rem",
            lineHeight: 1.55,
            color: "var(--text-secondary)",
          }}
        >
          {message}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            padding: "12px 20px",
            borderTop: "1px solid var(--border-subtle)",
            background: "var(--bg-deep)",
          }}
        >
          <button
            type="button"
            className={`btn ${type === "error" ? "btn-danger" : "btn-amber"}`}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
