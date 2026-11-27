import React, { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export interface SplitSaveButtonProps {
  label: React.ReactNode;
  saveAndCloseLabel?: string;
  variantClass?: string;
  buttonClassName?: string;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
  menuAlign?: "left" | "right";
  menuDirection?: "down" | "up";
  onSave: () => Promise<unknown> | unknown;
  onSaveAndClose?: () => Promise<unknown> | unknown;
  testId?: string;
}

export const SplitSaveButton: React.FC<SplitSaveButtonProps> = ({
  label,
  saveAndCloseLabel = "Save & Close",
  variantClass = "btn-amber",
  buttonClassName = "",
  disabled = false,
  title,
  ariaLabel,
  menuAlign = "right",
  menuDirection = "down",
  onSave,
  onSaveAndClose,
  testId,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  useEffect(() => {
    if (disabled && menuOpen) {
      setMenuOpen(false);
    }
  }, [disabled, menuOpen]);

  useEffect(() => {
    if (!menuOpen || typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const handlePointerDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [menuOpen]);

  if (!onSaveAndClose) {
    return (
      <button
        type="button"
        className={`btn ${variantClass} ${buttonClassName}`.trim()}
        disabled={disabled}
        title={title}
        aria-label={ariaLabel}
        data-testid={testId}
        onClick={() => {
          void onSave();
        }}
      >
        {label}
      </button>
    );
  }

  return (
    <div ref={wrapRef} className="ui-split-btn">
      <button
        type="button"
        className={`btn ui-split-btn__main ${variantClass} ${buttonClassName}`.trim()}
        disabled={disabled}
        title={title}
        aria-label={ariaLabel}
        data-testid={testId}
        onClick={() => {
          setMenuOpen(false);
          void onSave();
        }}
      >
        {label}
      </button>
      <button
        type="button"
        className={`btn ui-split-btn__toggle ${variantClass}`.trim()}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? menuId : undefined}
        aria-label="More save options"
        title="More save options"
        data-testid={testId ? `${testId}-toggle` : undefined}
        onClick={() => setMenuOpen((v) => !v)}
      >
        <ChevronDown size={13} />
      </button>

      {menuOpen && !disabled && (
        <div
          id={menuId}
          role="menu"
          className={`ui-split-btn__menu ui-split-btn__menu--${menuDirection} ui-split-btn__menu--${menuAlign}`}
        >
          <button
            type="button"
            role="menuitem"
            className="ui-split-btn__item"
            data-testid={testId ? `${testId}-save-and-close` : undefined}
            onClick={() => {
              setMenuOpen(false);
              void onSaveAndClose();
            }}
          >
            <Check size={13} />
            <span>{saveAndCloseLabel}</span>
          </button>
        </div>
      )}
    </div>
  );
};
