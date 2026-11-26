import { useEffect, useRef } from "react";
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

/**
 * Registers an open overlay (modal, picker, confirmation, or mobile drawer)
 * with the centralized browser Back-stack coordinator.
 *
 * Safely no-ops when rendered outside NavigationHistoryProvider (e.g., SSR unit tests).
 */
export function useOverlayBackHandler({
  id,
  isOpen,
  onClose,
  priority = 0,
  isDirty = false,
  guard,
}: UseOverlayBackHandlerOptions): void {
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
}
