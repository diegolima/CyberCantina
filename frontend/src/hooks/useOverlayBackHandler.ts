import { useCallback, useEffect, useRef } from "react";
import { useOptionalNavigationHistory } from "../providers/NavigationHistoryContext";
import type { OverlayBackGuard } from "../types";

export interface UseOverlayBackHandlerOptions {
  id: string;
  isOpen: boolean;
  onClose: () => void;
  priority?: number;
  isDirty?: boolean;
  guard?: OverlayBackGuard;
}

export interface UseOverlayBackHandlerResult {
  requestClose: () => void;
}

/**
 * Registers an open overlay (modal, picker, confirmation, or mobile drawer)
 * with the centralized browser Back-stack coordinator.
 *
 * Returns `requestClose()` which honors `isDirty` (surfacing `NavigationGuardModal`
 * before closing) when invoked from backdrop clicks, X/Cancel buttons, or Escape.
 * Safely no-ops when rendered outside NavigationHistoryProvider (e.g., SSR unit tests).
 */
export function useOverlayBackHandler({
  id,
  isOpen,
  onClose,
  priority = 0,
  isDirty = false,
  guard,
}: UseOverlayBackHandlerOptions): UseOverlayBackHandlerResult {
  const nav = useOptionalNavigationHistory();
  const seqRef = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  const isDirtyRef = useRef(isDirty);
  const guardRef = useRef(guard);

  onCloseRef.current = onClose;
  isDirtyRef.current = isDirty;
  guardRef.current = guard;

  useEffect(() => {
    if (!nav || !isOpen) return;
    const seq = nav.registerOverlay({
      id,
      priority,
      isDirty: isDirtyRef.current,
      guard: guardRef.current,
      onClose: () => onCloseRef.current(),
    });
    seqRef.current = seq;
    return () => {
      nav.unregisterOverlay(seq);
      if (seqRef.current === seq) {
        seqRef.current = null;
      }
    };
  }, [nav, id, isOpen, priority]);

  useEffect(() => {
    if (!nav || !isOpen || seqRef.current === null) return;
    nav.updateOverlay(seqRef.current, {
      isDirty,
      guard,
    });
  }, [nav, isOpen, isDirty, guard]);

  const requestClose = useCallback(() => {
    if (nav && seqRef.current !== null) {
      nav.requestOverlayClose(seqRef.current);
      return;
    }
    onCloseRef.current();
  }, [nav]);

  return { requestClose };
}
