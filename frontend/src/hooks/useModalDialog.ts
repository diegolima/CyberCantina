import { useEffect, useId, useRef } from "react";

const openDialogStack: string[] = [];

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const nodes = Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
  );
  return nodes.filter((el) => {
    if (el.hasAttribute("disabled") || el.getAttribute("aria-hidden") === "true") {
      return false;
    }
    if (el === document.activeElement) return true;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }
    return el.getClientRects().length > 0;
  });
}

export interface UseModalDialogOptions {
  isOpen?: boolean;
  onClose?: () => void;
  disableEscape?: boolean;
  dialogRef: React.RefObject<HTMLElement | null>;
}

/**
 * Stack-aware, SSR-safe dialog accessibility hook:
 * - Maintains a module-level stack so nested dialogs never fight over focus or Escape.
 * - Traps Tab / Shift+Tab within the topmost dialog.
 * - Routes Escape to `onClose` for the topmost dialog (unless `disableEscape`).
 * - Restores focus to the triggering element on close.
 */
export function useModalDialog({
  isOpen = true,
  onClose,
  disableEscape = false,
  dialogRef,
}: UseModalDialogOptions): void {
  const dialogId = useId();
  const onCloseRef = useRef(onClose);
  const disableEscapeRef = useRef(disableEscape);
  onCloseRef.current = onClose;
  disableEscapeRef.current = disableEscape;

  useEffect(() => {
    if (!isOpen || typeof document === "undefined") return;

    openDialogStack.push(dialogId);
    const previousActive =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const container = dialogRef.current;
    if (container && !container.contains(document.activeElement)) {
      const focusable = getFocusableElements(container);
      if (focusable.length > 0) {
        focusable[0].focus();
      } else {
        container.focus();
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (openDialogStack[openDialogStack.length - 1] !== dialogId) return;

      if (e.key === "Escape") {
        if (!disableEscapeRef.current && onCloseRef.current) {
          e.preventDefault();
          e.stopPropagation();
          onCloseRef.current();
        }
        return;
      }

      if (e.key !== "Tab") return;
      const panel = dialogRef.current;
      if (!panel) return;
      const focusable = getFocusableElements(panel);
      if (focusable.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (!panel.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }

      if (e.shiftKey) {
        if (active === first || active === panel) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      const idx = openDialogStack.lastIndexOf(dialogId);
      if (idx !== -1) {
        openDialogStack.splice(idx, 1);
      }
      if (previousActive && previousActive.isConnected) {
        previousActive.focus();
      }
    };
  }, [dialogId, dialogRef, isOpen]);
}
