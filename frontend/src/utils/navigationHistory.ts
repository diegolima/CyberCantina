import type { AppRoute, HistoryNavState } from "../types";

export type OverlayReconcileAction =
  | { kind: "noop" }
  | { kind: "push"; count: number }
  | { kind: "replace" }
  | { kind: "pop"; delta: number };

const CAMPAIGN_PATH_PREFIX = "/campaigns/";

/**
 * Parses a browser pathname into a canonical AppRoute.
 * Matches `/campaigns/:id` (with optional trailing slash) and falls back to `{ kind: "home" }`
 * for `/` or any unrecognized/incomplete path.
 */
export function parseAppRoute(pathname: string): AppRoute {
  const clean = (pathname || "/").split("?")[0].split("#")[0];
  if (!clean.startsWith(CAMPAIGN_PATH_PREFIX)) {
    return { kind: "home" };
  }
  const rest = clean.slice(CAMPAIGN_PATH_PREFIX.length).replace(/\/+$/, "");
  if (!rest || rest.includes("/")) {
    return { kind: "home" };
  }
  try {
    const decoded = decodeURIComponent(rest).trim();
    if (!decoded) return { kind: "home" };
    return { kind: "campaign", campaignId: decoded };
  } catch {
    return { kind: "home" };
  }
}

export function formatAppRoute(route: AppRoute): string {
  if (route.kind === "home") {
    return "/";
  }
  return `${CAMPAIGN_PATH_PREFIX}${encodeURIComponent(route.campaignId)}`;
}

export function routesEqual(a: AppRoute, b: AppRoute): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "home") return true;
  return b.kind === "campaign" && a.campaignId === b.campaignId;
}

let navSessionSeq = 0;

export function createNavSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `ccnav_${hex}`;
  }
  navSessionSeq += 1;
  return `ccnav_${Date.now().toString(36)}_${navSessionSeq.toString(36)}`;
}

export function buildHistoryNavState(
  sessionId: string,
  route: AppRoute,
  overlayDepth: number,
  overlayId: string | null
): HistoryNavState {
  const safeDepth = Number.isInteger(overlayDepth) && overlayDepth >= 0 ? overlayDepth : 0;
  return {
    __ccNav: 1,
    sessionId,
    route: route.kind === "campaign" ? { kind: "campaign", campaignId: route.campaignId } : { kind: "home" },
    overlayDepth: safeDepth,
    overlayId: safeDepth > 0 ? overlayId : null,
  };
}

function isValidAppRoute(raw: unknown): raw is AppRoute {
  if (!raw || typeof raw !== "object") return false;
  const candidate = raw as Record<string, unknown>;
  if (candidate.kind === "home") return true;
  if (
    candidate.kind === "campaign" &&
    typeof candidate.campaignId === "string" &&
    candidate.campaignId.trim().length > 0
  ) {
    return true;
  }
  return false;
}

export function parseHistoryNavState(raw: unknown): HistoryNavState | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj.__ccNav !== 1) return null;
  if (typeof obj.sessionId !== "string" || obj.sessionId.length === 0) return null;
  if (!isValidAppRoute(obj.route)) return null;
  if (
    typeof obj.overlayDepth !== "number" ||
    !Number.isInteger(obj.overlayDepth) ||
    obj.overlayDepth < 0
  ) {
    return null;
  }
  if (obj.overlayId !== null && typeof obj.overlayId !== "string") return null;
  return {
    __ccNav: 1,
    sessionId: obj.sessionId,
    route:
      obj.route.kind === "campaign"
        ? { kind: "campaign", campaignId: obj.route.campaignId }
        : { kind: "home" },
    overlayDepth: obj.overlayDepth,
    overlayId: obj.overlayId,
  };
}

export function sortOverlayStack<T extends { priority?: number; seq: number }>(
  items: readonly T[]
): T[] {
  return [...items].sort((a, b) => {
    const pDiff = (a.priority ?? 0) - (b.priority ?? 0);
    if (pDiff !== 0) return pDiff;
    return a.seq - b.seq;
  });
}

export function computeOverlayReconcileAction(
  committedDepth: number,
  targetDepth: number
): OverlayReconcileAction {
  if (targetDepth > committedDepth) {
    return { kind: "push", count: targetDepth - committedDepth };
  }
  if (targetDepth < committedDepth) {
    return { kind: "pop", delta: committedDepth - targetDepth };
  }
  if (targetDepth > 0) {
    return { kind: "replace" };
  }
  return { kind: "noop" };
}

export function isStaleForwardOverlayState(
  nextState: HistoryNavState | null,
  currentSessionId: string,
  committedDepth: number,
  activeOverlayCount: number
): boolean {
  if (!nextState || nextState.overlayDepth <= 0) {
    return false;
  }
  return (
    nextState.sessionId !== currentSessionId ||
    nextState.overlayDepth > committedDepth ||
    activeOverlayCount === 0
  );
}
