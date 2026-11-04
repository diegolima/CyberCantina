/** Pure math for NumericSliderField: parsing, clamping, snapping and (log) track positions. */

export type SliderScale = "linear" | "log";

export interface Notch {
  value: number;
  label: string;
}

export interface SliderSpec {
  /** Typed values are clamped/validated against these. */
  hardMin: number;
  hardMax: number;
  /** The slider thumb never leaves this range, even for out-of-range typed values. */
  trackMin: number;
  trackMax: number;
  /** Linear: snap increment. Log: rounding granularity between notches. */
  step: number;
  /** Decimal places kept (0 = integers). */
  precision: number;
  scale: SliderScale;
  notches: Notch[];
}

/** Fraction of the log-distance within which dragging snaps onto a notch. */
const NOTCH_SNAP_LOG_DISTANCE = 0.04;

export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

export function roundTo(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function formatValue(value: number, precision: number): string {
  return precision <= 0 ? String(Math.round(value)) : String(roundTo(value, precision));
}

/**
 * Parse what the user typed. Returns null (do not commit) for empty text, NaN or values outside the
 * hard bounds. Intermediate text such as "0." parses fine so typing decimals is never blocked.
 */
export function parseDraft(text: string, spec: SliderSpec): number | null {
  const trimmed = text.trim().replace(",", ".");
  if (trimmed === "" || trimmed === "-" || trimmed === ".") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  const rounded = roundTo(n, spec.precision);
  if (rounded < spec.hardMin || rounded > spec.hardMax) return null;
  return rounded;
}

export function isOutsideTrack(value: number, spec: SliderSpec): boolean {
  return value < spec.trackMin || value > spec.trackMax;
}

/** Normalised 0..1 thumb position; values outside the track clamp to the nearest end. */
export function valueToPosition(value: number, spec: SliderSpec): number {
  const v = clamp(value, spec.trackMin, spec.trackMax);
  if (spec.trackMax === spec.trackMin) return 0;
  if (spec.scale === "log") {
    return Math.log(v / spec.trackMin) / Math.log(spec.trackMax / spec.trackMin);
  }
  return (v - spec.trackMin) / (spec.trackMax - spec.trackMin);
}

/** Convert a 0..1 slider position into a snapped value inside the track. */
export function positionToValue(position: number, spec: SliderSpec): number {
  const p = clamp(position, 0, 1);
  if (spec.scale === "log") {
    const raw = spec.trackMin * Math.pow(spec.trackMax / spec.trackMin, p);
    for (const notch of spec.notches) {
      if (Math.abs(Math.log(raw / notch.value)) < NOTCH_SNAP_LOG_DISTANCE) return notch.value;
    }
    const snapped = Math.round(raw / spec.step) * spec.step;
    return roundTo(clamp(snapped, spec.trackMin, spec.trackMax), spec.precision);
  }
  const raw = spec.trackMin + p * (spec.trackMax - spec.trackMin);
  const snapped = Math.round((raw - spec.trackMin) / spec.step) * spec.step + spec.trackMin;
  return roundTo(clamp(snapped, spec.trackMin, spec.trackMax), spec.precision);
}
