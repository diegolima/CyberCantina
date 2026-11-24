export const WALKING_METERS_PER_MINUTE = 70;
export const WALKING_KM_PER_HOUR = 4.2;
export const MAX_EDGE_DISTANCE_METERS = 100_000_000;
export const DEFAULT_INTERIOR_DISTANCE_METERS = 20;
export const DEFAULT_EXTERIOR_DISTANCE_METERS = 100;
export const DEFAULT_FALLBACK_DISTANCE_METERS = 50;
export const MIN_EDGE_SPEED_MODIFIER = 0.05;
export const MAX_EDGE_SPEED_MODIFIER = 100;
export const DEFAULT_EDGE_SPEED_MODIFIER = 1;
export const MAX_EDGE_OBSTACLES = 6;
export const MAX_EDGE_OBSTACLE_LENGTH = 48;
export const MAX_EDGE_TRAVEL_MODE_LENGTH = 40;

export type LinkSpeedPresetCategory = "terrain" | "foot" | "transit";

export interface LinkSpeedPreset {
  id: string;
  label: string;
  modeLabel: string | null;
  modifier: number;
  category: LinkSpeedPresetCategory;
}

export interface LinkSpeedPresetGroup {
  category: LinkSpeedPresetCategory;
  label: string;
  items: readonly LinkSpeedPreset[];
}

export const LINK_SPEED_PRESETS: readonly LinkSpeedPreset[] = [
  { id: "crawl", label: "Crawl / Tight", modeLabel: "Crawl / Tight", modifier: 0.25, category: "terrain" },
  { id: "swamp", label: "Swamp / Bog", modeLabel: "Swamp / Difficult Terrain", modifier: 0.3, category: "terrain" },
  { id: "swim", label: "Swim", modeLabel: "Swim", modifier: 0.4, category: "terrain" },
  { id: "steep", label: "Steep / Mountain", modeLabel: "Steep Climb", modifier: 0.6, category: "terrain" },
  { id: "walk", label: "Walking", modeLabel: null, modifier: 1, category: "foot" },
  { id: "sprint", label: "Sprint / March", modeLabel: "Sprint / March", modifier: 2, category: "foot" },
  { id: "mount", label: "Mount / Bike", modeLabel: "Mount / Bike", modifier: 3, category: "foot" },
  { id: "boat", label: "Boat / Sea", modeLabel: "Boat / Sea", modifier: 5, category: "transit" },
  { id: "vehicle", label: "Vehicle", modeLabel: "Vehicle", modifier: 10, category: "transit" },
  { id: "rail", label: "Rail / Transit", modeLabel: "Rail", modifier: 25, category: "transit" },
  { id: "air", label: "High-Speed / Air", modeLabel: "High-Speed Transit", modifier: 60, category: "transit" },
];

export const LINK_SPEED_PRESET_GROUPS: readonly LinkSpeedPresetGroup[] = [
  {
    category: "terrain",
    label: "Terrain & Slow",
    items: LINK_SPEED_PRESETS.filter((p) => p.category === "terrain"),
  },
  {
    category: "foot",
    label: "On Foot & Mounts",
    items: LINK_SPEED_PRESETS.filter((p) => p.category === "foot"),
  },
  {
    category: "transit",
    label: "Vehicles & Transit",
    items: LINK_SPEED_PRESETS.filter((p) => p.category === "transit"),
  },
];

/** Find the preset whose multiplier matches `speedModifier` within tolerance, or `null` for custom speeds. */
export function findMatchingSpeedPreset(
  speedModifier: number
): LinkSpeedPreset | null {
  const safeMod = clampEdgeSpeedModifier(speedModifier);
  return (
    LINK_SPEED_PRESETS.find((preset) => Math.abs(safeMod - preset.modifier) < 0.005) ??
    null
  );
}

/** Clamp a positive speed multiplier into `[0.05, 100]`, defaulting to `1`. */
export function clampEdgeSpeedModifier(
  raw: number,
  fallback: number = DEFAULT_EDGE_SPEED_MODIFIER
): number {
  const safeFallback =
    Number.isFinite(fallback) && fallback > 0
      ? Math.max(MIN_EDGE_SPEED_MODIFIER, Math.min(MAX_EDGE_SPEED_MODIFIER, fallback))
      : DEFAULT_EDGE_SPEED_MODIFIER;
  if (!Number.isFinite(raw) || raw <= 0) return Number(safeFallback.toFixed(4));
  const clamped = Math.max(MIN_EDGE_SPEED_MODIFIER, Math.min(MAX_EDGE_SPEED_MODIFIER, raw));
  return Number(clamped.toFixed(4));
}

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

/** Derive rounded integer travel minutes from distance and speed modifier (min 1). */
export function deriveTravelMinutes(
  distanceMeters: number,
  speedModifier: number = DEFAULT_EDGE_SPEED_MODIFIER
): number {
  const safeMeters = clampEdgeDistanceMeters(distanceMeters);
  const safeMod = clampEdgeSpeedModifier(speedModifier);
  return Math.max(1, Math.round(safeMeters / (WALKING_METERS_PER_MINUTE * safeMod)));
}

/** Derive rounded integer walking minutes at canonical 70 m/min (min 1). */
export function deriveWalkingMinutes(distanceMeters: number): number {
  return deriveTravelMinutes(distanceMeters, DEFAULT_EDGE_SPEED_MODIFIER);
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

/** Format a minute count into `< 1 min`, `~5 min`, `~1h`, or `~1h 15min`. */
export function formatMinutesCompact(mins: number, subHalfMinute = false): string {
  if (subHalfMinute) {
    return "< 1 min";
  }
  const safeMins = Math.max(1, Math.round(mins));
  if (safeMins < 60) {
    return `~${safeMins} min`;
  }
  const hours = Math.floor(safeMins / 60);
  const rem = safeMins % 60;
  return rem === 0 ? `~${hours}h` : `~${hours}h ${rem}min`;
}

/** Format speed-adjusted travel duration (`< 1 min`, `~5 min`, `~1h 15min`). */
export function formatTravelDuration(
  distanceMeters: number,
  speedModifier: number = DEFAULT_EDGE_SPEED_MODIFIER
): string {
  const safeMeters = clampEdgeDistanceMeters(distanceMeters);
  const safeMod = clampEdgeSpeedModifier(speedModifier);
  if (safeMeters / (WALKING_METERS_PER_MINUTE * safeMod) < 0.5) {
    return "< 1 min";
  }
  return formatMinutesCompact(deriveTravelMinutes(safeMeters, safeMod), false);
}

/** Format canonical walking duration (`< 1 min`, `~5 min`, `~1h`, `~1h 15min`). */
export function formatWalkingDuration(distanceMeters: number): string {
  return formatTravelDuration(distanceMeters, DEFAULT_EDGE_SPEED_MODIFIER);
}

/** Format effective speed in km/h (e.g. `1.3 km/h`, `4.2 km/h`, `105 km/h`). */
export function formatEffectiveSpeedKmh(speedModifier: number): string {
  const safeMod = clampEdgeSpeedModifier(speedModifier);
  const kmh = WALKING_KM_PER_HOUR * safeMod;
  if (kmh < 20) {
    return `${Number(kmh.toFixed(1))} km/h`;
  }
  return `${Math.round(kmh)} km/h`;
}

/** Format mode-aware exit duration phrase (`~5 min walk`, `~2 min via Rail`, `~18 min travel`). */
export function formatExitTravelPhrase(
  distanceMeters: number,
  speedModifier: number = DEFAULT_EDGE_SPEED_MODIFIER,
  travelMode?: string | null
): string {
  const safeMod = clampEdgeSpeedModifier(speedModifier);
  const dur = formatTravelDuration(distanceMeters, safeMod);
  const mode = (travelMode ?? "").trim();
  if (mode) {
    return `${dur} via ${mode}`;
  }
  if (Math.abs(safeMod - DEFAULT_EDGE_SPEED_MODIFIER) < 0.01) {
    return `${dur} walk`;
  }
  return `${dur} travel`;
}

/** Format single or range travel duration across an aggregated supernode bundle of edges. */
export function formatBundleTravelDuration(
  edges: ReadonlyArray<{ distance_meters: number; speed_modifier?: number }>
): string {
  if (edges.length === 0) return "~1 min";
  let minEdge = edges[0];
  let maxEdge = edges[0];
  let minRatio = Infinity;
  let maxRatio = -Infinity;
  for (const e of edges) {
    const safeM = clampEdgeDistanceMeters(e.distance_meters);
    const safeS = clampEdgeSpeedModifier(e.speed_modifier ?? 1);
    const ratio = safeM / (WALKING_METERS_PER_MINUTE * safeS);
    if (ratio < minRatio) {
      minRatio = ratio;
      minEdge = e;
    }
    if (ratio > maxRatio) {
      maxRatio = ratio;
      maxEdge = e;
    }
  }
  const minLabel = formatTravelDuration(minEdge.distance_meters, minEdge.speed_modifier ?? 1);
  const maxLabel = formatTravelDuration(maxEdge.distance_meters, maxEdge.speed_modifier ?? 1);
  if (minLabel === maxLabel) {
    return minLabel;
  }
  const loSubHalf = minRatio < 0.5;
  const hiMins = deriveTravelMinutes(maxEdge.distance_meters, maxEdge.speed_modifier ?? 1);
  if (loSubHalf && hiMins <= 1) {
    return "~1 min";
  }
  if (loSubHalf && hiMins < 60) {
    return `< 1-${hiMins} min`;
  }
  const loMins = deriveTravelMinutes(minEdge.distance_meters, minEdge.speed_modifier ?? 1);
  if (!loSubHalf && hiMins < 60) {
    return `~${loMins}-${hiMins} min`;
  }
  return `${minLabel}-${maxLabel.replace(/^~/, "")}`;
}

/** Format single or range walking duration for aggregated supernode bundles. */
export function formatBundleWalkingDuration(
  minMeters: number,
  maxMeters: number
): string {
  return formatBundleTravelDuration([
    { distance_meters: Math.min(minMeters, maxMeters), speed_modifier: 1 },
    { distance_meters: Math.max(minMeters, maxMeters), speed_modifier: 1 },
  ]);
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
