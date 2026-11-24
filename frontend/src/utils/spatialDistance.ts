export const WALKING_METERS_PER_MINUTE = 70;
export const MAX_EDGE_DISTANCE_METERS = 100_000_000;
export const DEFAULT_INTERIOR_DISTANCE_METERS = 20;
export const DEFAULT_EXTERIOR_DISTANCE_METERS = 100;
export const DEFAULT_FALLBACK_DISTANCE_METERS = 50;

/** Clamp an integer meter distance into `[1, MAX_EDGE_DISTANCE_METERS]`. */
export function clampEdgeDistanceMeters(
  meters: number,
  fallback: number = DEFAULT_FALLBACK_DISTANCE_METERS
): number {
  const safeFallback = Math.max(
    1,
    Math.min(MAX_EDGE_DISTANCE_METERS, Math.round(fallback) || DEFAULT_FALLBACK_DISTANCE_METERS)
  );
  if (!Number.isFinite(meters)) return safeFallback;
  const rounded = Math.round(meters);
  if (rounded <= 0) return 1;
  return Math.min(MAX_EDGE_DISTANCE_METERS, rounded);
}

/** Derive rounded integer walking minutes at canonical 70 m/min (min 1). */
export function deriveWalkingMinutes(distanceMeters: number): number {
  const safeMeters = clampEdgeDistanceMeters(distanceMeters);
  return Math.max(1, Math.round(safeMeters / WALKING_METERS_PER_MINUTE));
}

/** Format meters compactly (`350m`, `1km`, `1.4km`, `125km`). */
export function formatDistanceCompact(distanceMeters: number): string {
  const safeMeters = clampEdgeDistanceMeters(distanceMeters);
  if (safeMeters < 1000) {
    return `${safeMeters}m`;
  }
  if (safeMeters < 100_000) {
    return `${Number((safeMeters / 1000).toFixed(1))}km`;
  }
  return `${Math.round(safeMeters / 1000)}km`;
}

/** Format canonical walking duration (`< 1 min`, `~5 min`, `~1h`, `~1h 15min`). */
export function formatWalkingDuration(distanceMeters: number): string {
  const safeMeters = clampEdgeDistanceMeters(distanceMeters);
  if (safeMeters < 35) {
    return "< 1 min";
  }
  const mins = deriveWalkingMinutes(safeMeters);
  if (mins < 60) {
    return `~${mins} min`;
  }
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem === 0 ? `~${hours}h` : `~${hours}h ${rem}min`;
}

/** Format single or range walking duration for aggregated supernode bundles. */
export function formatBundleWalkingDuration(
  minMeters: number,
  maxMeters: number
): string {
  const lo = Math.min(minMeters, maxMeters);
  const hi = Math.max(minMeters, maxMeters);
  const minLabel = formatWalkingDuration(lo);
  const maxLabel = formatWalkingDuration(hi);
  if (minLabel === maxLabel) {
    return minLabel;
  }
  const hiMins = deriveWalkingMinutes(hi);
  if (lo < 35 && hiMins <= 1) {
    return "~1 min";
  }
  if (lo < 35 && hiMins < 60) {
    return `< 1-${hiMins} min`;
  }
  const loMins = deriveWalkingMinutes(lo);
  if (lo >= 35 && hiMins < 60) {
    return `~${loMins}-${hiMins} min`;
  }
  return `${minLabel}-${maxLabel.replace(/^~/, "")}`;
}

/** Determine adaptive stepper increment by distance magnitude (`±5`, `±25`, `±100`, `±500`, or `±1` when fine). */
export function getAdaptiveDistanceStep(meters: number, fine = false): number {
  if (fine) return 1;
  const safeMeters = clampEdgeDistanceMeters(meters);
  if (safeMeters < 100) return 5;
  if (safeMeters < 1000) return 25;
  if (safeMeters < 10_000) return 100;
  return 500;
}

/** Filter raw edge distance input while preserving decimal points and `k`/`m` unit suffixes (e.g. `1.5km`). */
export function sanitizeEdgeDistanceInput(raw: string): string {
  let out = "";
  let seenDot = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch >= "0" && ch <= "9") {
      out += ch;
    } else if (ch === "." && !seenDot) {
      seenDot = true;
      out += ch;
    } else if (
      ch === "k" ||
      ch === "K" ||
      ch === "m" ||
      ch === "M" ||
      (ch === " " && out.length > 0 && !out.endsWith(" "))
    ) {
      out += ch.toLowerCase();
    }
  }
  return out;
}

/**
 * Parse an inline/popover distance draft (`"350"`, `"350m"`, `"1.5km"`, `"2 km"`).
 * Returns `null` when blank or unparseable so callers can preserve existing distance.
 */
export function parseCommittedEdgeDistance(rawDraft: string): number | null {
  const trimmed = rawDraft.trim().toLowerCase();
  if (!trimmed) return null;

  let multiplier = 1;
  let numStr = trimmed;
  if (trimmed.endsWith("km")) {
    multiplier = 1000;
    numStr = trimmed.slice(0, -2).trim();
  } else if (trimmed.endsWith("k")) {
    multiplier = 1000;
    numStr = trimmed.slice(0, -1).trim();
  } else if (trimmed.endsWith("m")) {
    numStr = trimmed.slice(0, -1).trim();
  }

  if (!numStr || !/^\d+(?:\.\d+)?$/.test(numStr)) {
    return null;
  }
  const parsed = Number(numStr) * multiplier;
  if (!Number.isFinite(parsed)) return null;
  return clampEdgeDistanceMeters(parsed);
}

/**
 * Step an inline/popover edge distance draft using adaptive magnitude increments
 * (or `±1m` when `fine` is true), falling back to `fallbackMeters` if blank/invalid.
 */
export function stepEdgeDistanceDraft(
  rawDraft: string,
  direction: 1 | -1,
  fallbackMeters: number = DEFAULT_FALLBACK_DISTANCE_METERS,
  fine = false
): string {
  const parsed = parseCommittedEdgeDistance(rawDraft);
  const base = parsed ?? clampEdgeDistanceMeters(fallbackMeters);
  const probe = direction < 0 ? Math.max(1, base - 1) : base;
  const step = getAdaptiveDistanceStep(probe, fine);
  return String(clampEdgeDistanceMeters(base + direction * step));
}
