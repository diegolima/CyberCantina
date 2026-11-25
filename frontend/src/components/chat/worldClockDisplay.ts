export interface SplitWorldClock {
  prefix: string;
  datePrefix: string;
  hourDigits: string;
  colon: string;
  suffix: string;
}

const CLOCK_TIME_RE = /(\d{1,2}):(\d{2})(?=:\d{2}|\s|$|[ap]\.?m\.?(?:\s|$))/gi;

/**
 * Splits the first valid HH:MM separator in a world timestamp so the colon
 * can animate cleanly and compact phones can hide any preceding date prefix
 * without disturbing custom calendars or fixed-width digits.
 */
export function splitWorldClockDisplay(timestamp: string): SplitWorldClock | null {
  const trimmed = timestamp.trim();
  if (!trimmed) return null;

  CLOCK_TIME_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CLOCK_TIME_RE.exec(trimmed)) !== null) {
    const idx = match.index;
    if (idx > 0 && !/[\s,T]/.test(trimmed[idx - 1])) {
      continue;
    }
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      continue;
    }
    const hourDigits = match[1];
    const colonIdx = idx + hourDigits.length;
    return {
      prefix: trimmed.slice(0, colonIdx),
      datePrefix: trimmed.slice(0, idx),
      hourDigits,
      colon: ":",
      suffix: trimmed.slice(colonIdx + 1),
    };
  }
  return null;
}
