export type DrawerSwipeSide = "left" | "right";
export type DrawerSwipeAxis = "none" | "horizontal" | "vertical";

export const DRAWER_SWIPE_LOCK_PX = 12;
export const DRAWER_SWIPE_DISMISS_PX = 64;
export const DRAWER_SWIPE_VELOCITY_PX_PER_MS = 0.45;

export interface DrawerSwipeStep {
  lockedAxis: DrawerSwipeAxis;
  offsetPx: number;
}

/**
 * Resolves axis locking and clamped dismiss offset for a mobile overlay drawer
 * gesture while yielding immediately to vertical drawer scrolling.
 */
export function computeDrawerSwipeOffset(
  side: DrawerSwipeSide,
  dx: number,
  dy: number,
  lockedAxis: DrawerSwipeAxis
): DrawerSwipeStep {
  let nextAxis = lockedAxis;

  if (nextAxis === "none") {
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    if (absY >= DRAWER_SWIPE_LOCK_PX && absY >= absX) {
      nextAxis = "vertical";
    } else if (absX >= DRAWER_SWIPE_LOCK_PX && absX > absY * 1.25) {
      const towardEdge =
        side === "left" ? dx < -DRAWER_SWIPE_LOCK_PX : dx > DRAWER_SWIPE_LOCK_PX;
      nextAxis = towardEdge ? "horizontal" : "vertical";
    }
  }

  if (nextAxis !== "horizontal") {
    return { lockedAxis: nextAxis, offsetPx: 0 };
  }

  const offsetPx = side === "left" ? Math.min(0, dx) : Math.max(0, dx);
  return { lockedAxis: nextAxis, offsetPx };
}

/**
 * True when the drawer was dragged far enough (or flicked fast enough toward the
 * dismiss edge) to close the overlay.
 */
export function shouldDismissDrawerSwipe(
  side: DrawerSwipeSide,
  offsetPx: number,
  elapsedMs: number
): boolean {
  const directionalDist = side === "left" ? -offsetPx : offsetPx;
  if (directionalDist <= 0) return false;
  if (directionalDist >= DRAWER_SWIPE_DISMISS_PX) return true;
  if (directionalDist >= DRAWER_SWIPE_DISMISS_PX / 2) {
    const velocity = directionalDist / Math.max(1, elapsedMs);
    return velocity >= DRAWER_SWIPE_VELOCITY_PX_PER_MS;
  }
  return false;
}
