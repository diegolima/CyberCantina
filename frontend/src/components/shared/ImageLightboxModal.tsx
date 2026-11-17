import React, { useEffect } from "react";
import { X } from "lucide-react";

export interface ImageLightboxModalProps {
  url: string;
  label?: string;
  subtitle?: string;
  onClose: () => void;
}

/**
 * Reusable full-screen lightbox overlay for inspecting world, map, and arrival images.
 */
export const ImageLightboxModal: React.FC<ImageLightboxModalProps> = ({
  url,
  label,
  subtitle,
  onClose,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={label || "Image preview"}
      style={{ zIndex: 120, background: "rgba(5, 8, 16, 0.88)", padding: 20 }}
      onClick={onClose}
    >
      <div
        style={{
          position: "relative",
          maxWidth: "92vw",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="btn btn-sm"
          onClick={onClose}
          aria-label="Close image preview"
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            zIndex: 2,
            background: "rgba(15, 23, 42, 0.85)",
          }}
        >
          <X size={15} />
        </button>
        <img
          src={url}
          alt={label || "World scene image"}
          style={{
            maxWidth: "90vw",
            maxHeight: "80vh",
            borderRadius: 10,
            border: "1px solid var(--border-subtle)",
            objectFit: "contain",
            boxShadow: "0 18px 50px rgba(0, 0, 0, 0.65)",
          }}
        />
        {(label || subtitle) && (
          <div
            style={{
              textAlign: "center",
              color: "var(--text-primary)",
              fontSize: "0.84rem",
              fontWeight: 600,
              background: "rgba(15, 23, 42, 0.82)",
              padding: "6px 14px",
              borderRadius: 999,
              border: "1px solid var(--border-subtle)",
            }}
          >
            {label}
            {subtitle && (
              <span
                style={{
                  marginLeft: label ? 8 : 0,
                  color: "var(--text-secondary)",
                  fontWeight: 400,
                  fontSize: "0.76rem",
                }}
              >
                {subtitle}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
