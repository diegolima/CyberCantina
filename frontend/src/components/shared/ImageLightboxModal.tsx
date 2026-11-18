import React, { useEffect } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

export interface ImageLightboxModalProps {
  url: string;
  label?: string;
  subtitle?: string;
  counterText?: string;
  onPrev?: () => void;
  onNext?: () => void;
  onImageError?: () => void;
  onClose: () => void;
}

/**
 * Reusable full-screen lightbox overlay for inspecting world, map, and arrival images.
 */
export const ImageLightboxModal: React.FC<ImageLightboxModalProps> = ({
  url,
  label,
  subtitle,
  counterText,
  onPrev,
  onNext,
  onImageError,
  onClose,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === "ArrowLeft" && onPrev) {
        e.preventDefault();
        e.stopPropagation();
        onPrev();
        return;
      }
      if (e.key === "ArrowRight" && onNext) {
        e.preventDefault();
        e.stopPropagation();
        onNext();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, onPrev, onNext]);

  const navBtnStyle: React.CSSProperties = {
    position: "absolute",
    top: "50%",
    transform: "translateY(-50%)",
    zIndex: 2,
    background: "rgba(15, 23, 42, 0.85)",
    borderRadius: 999,
    width: 36,
    height: 36,
    padding: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };

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
            zIndex: 3,
            background: "rgba(15, 23, 42, 0.85)",
          }}
        >
          <X size={15} />
        </button>

        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {onPrev && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={onPrev}
              aria-label="Previous image"
              style={{ ...navBtnStyle, left: 10 }}
            >
              <ChevronLeft size={18} />
            </button>
          )}
          <img
            src={url}
            alt={label || "World scene image"}
            onError={onImageError}
            style={{
              maxWidth: "90vw",
              maxHeight: "80vh",
              borderRadius: 10,
              border: "1px solid var(--border-subtle)",
              objectFit: "contain",
              boxShadow: "0 18px 50px rgba(0, 0, 0, 0.65)",
            }}
          />
          {onNext && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={onNext}
              aria-label="Next image"
              style={{ ...navBtnStyle, right: 10 }}
            >
              <ChevronRight size={18} />
            </button>
          )}
        </div>

        {(label || subtitle || counterText) && (
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
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            {label && <span>{label}</span>}
            {subtitle && (
              <span
                style={{
                  color: "var(--text-secondary)",
                  fontWeight: 400,
                  fontSize: "0.76rem",
                }}
              >
                {subtitle}
              </span>
            )}
            {counterText && (
              <span
                style={{
                  color: "#6ee7b7",
                  fontWeight: 600,
                  fontSize: "0.74rem",
                }}
              >
                {counterText}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
