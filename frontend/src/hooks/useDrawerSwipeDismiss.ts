import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import {
  computeDrawerSwipeOffset,
  shouldDismissDrawerSwipe,
  type DrawerSwipeAxis,
  type DrawerSwipeSide,
} from "../utils/drawerSwipe";

export interface UseDrawerSwipeDismissOptions {
  enabled: boolean;
  side: DrawerSwipeSide;
  onDismiss?: () => void;
}

export interface DrawerSwipeTouchHandlers {
  onTouchStart: (e: React.TouchEvent<HTMLElement>) => void;
  onTouchMove: (e: React.TouchEvent<HTMLElement>) => void;
  onTouchEnd: (e: React.TouchEvent<HTMLElement>) => void;
  onTouchCancel: () => void;
}

export interface UseDrawerSwipeDismissResult {
  swipeOffsetPx: number;
  isSwiping: boolean;
  touchHandlers: DrawerSwipeTouchHandlers;
}

function shouldIgnoreSwipeStart(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest("svg, input, select, textarea, [data-no-drawer-swipe='true']")
  );
}

/**
 * Tracks edge-directed horizontal touch swipes on mobile overlay drawers
 * (`AppSidebar` and `LiveInspector`) without interfering with vertical scrolling,
 * mini-map SVG gestures, or form controls.
 */
export function useDrawerSwipeDismiss({
  enabled,
  side,
  onDismiss,
}: UseDrawerSwipeDismissOptions): UseDrawerSwipeDismissResult {
  const [swipeOffsetPx, setSwipeOffsetPx] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);

  const gestureRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    startTime: number;
    lockedAxis: DrawerSwipeAxis;
    offsetPx: number;
  }>({
    active: false,
    startX: 0,
    startY: 0,
    startTime: 0,
    lockedAxis: "none",
    offsetPx: 0,
  });

  const resetGesture = useCallback(() => {
    gestureRef.current.active = false;
    gestureRef.current.lockedAxis = "none";
    gestureRef.current.offsetPx = 0;
    setSwipeOffsetPx(0);
    setIsSwiping(false);
  }, []);

  useEffect(() => {
    if (!enabled) {
      resetGesture();
    }
  }, [enabled, resetGesture]);

  const onTouchStart = useCallback(
    (e: React.TouchEvent<HTMLElement>) => {
      if (!enabled || e.touches.length !== 1) return;
      if (shouldIgnoreSwipeStart(e.target)) return;
      const touch = e.touches[0];
      gestureRef.current = {
        active: true,
        startX: touch.clientX,
        startY: touch.clientY,
        startTime: Date.now(),
        lockedAxis: "none",
        offsetPx: 0,
      };
    },
    [enabled]
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent<HTMLElement>) => {
      const g = gestureRef.current;
      if (!enabled || !g.active || e.touches.length !== 1) return;
      const touch = e.touches[0];
      const dx = touch.clientX - g.startX;
      const dy = touch.clientY - g.startY;
      const step = computeDrawerSwipeOffset(side, dx, dy, g.lockedAxis);
      g.lockedAxis = step.lockedAxis;
      g.offsetPx = step.offsetPx;
      if (step.lockedAxis === "horizontal") {
        setIsSwiping(true);
        setSwipeOffsetPx(step.offsetPx);
      } else if (step.lockedAxis === "vertical") {
        g.active = false;
        setIsSwiping(false);
        setSwipeOffsetPx(0);
      }
    },
    [enabled, side]
  );

  const onTouchEnd = useCallback(() => {
    const g = gestureRef.current;
    if (!g.active) {
      resetGesture();
      return;
    }
    const offset = g.offsetPx;
    const elapsedMs = Date.now() - g.startTime;
    const dismiss =
      g.lockedAxis === "horizontal" &&
      shouldDismissDrawerSwipe(side, offset, elapsedMs);
    resetGesture();
    if (dismiss) {
      onDismiss?.();
    }
  }, [onDismiss, resetGesture, side]);

  return {
    swipeOffsetPx,
    isSwiping,
    touchHandlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onTouchCancel: resetGesture,
    },
  };
}
