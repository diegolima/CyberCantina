import type { CharacterRecord } from "../../types";

export const DEPRECATED_CHARACTER_KEYS = new Set<string>([
  "physical_appearance",
  "modifications",
]);

export function isDeprecatedLegacyKey(key: string): boolean {
  return DEPRECATED_CHARACTER_KEYS.has(key);
}

/**
 * Assemble active unsupported/deprecated fields from a loaded CharacterRecord,
 * ignoring pure mirroring duplicates (physical_appearance === character_bio).
 */
export function buildUnsupportedFieldsState(
  record: Pick<
    CharacterRecord,
    "character_bio" | "physical_appearance" | "modifications" | "unsupported_fields"
  >
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const rawExt = record.unsupported_fields ?? {};
  for (const [key, val] of Object.entries(rawExt)) {
    if (val === undefined || val === null) continue;
    if (typeof val === "string" && !val.trim()) continue;
    if (Array.isArray(val) && val.length === 0) continue;
    result[key] = val;
  }

  const bioNorm = (record.character_bio ?? "").trim();
  const physNorm = (record.physical_appearance ?? "").trim();
  if (physNorm && physNorm !== bioNorm && !("physical_appearance" in result)) {
    result.physical_appearance = physNorm;
  }

  const mods = (record.modifications ?? [])
    .map((m) => (typeof m === "string" ? m.trim() : ""))
    .filter(Boolean);
  if (mods.length > 0 && !("modifications" in result)) {
    result.modifications = mods;
  }

  return result;
}

export function filterRemainingUnsupportedFields(
  fields: Record<string, unknown>,
  stagedDeletes: Set<string>
): Record<string, unknown> {
  const remaining: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(fields)) {
    if (!stagedDeletes.has(key)) {
      remaining[key] = val;
    }
  }
  return remaining;
}

export function formatUnsupportedValueText(val: unknown): string {
  if (typeof val === "string") return val;
  if (Array.isArray(val)) {
    if (val.every((item) => typeof item === "string")) {
      return (val as string[]).join(", ");
    }
    return JSON.stringify(val, null, 2);
  }
  if (typeof val === "number" || typeof val === "boolean") {
    return String(val);
  }
  return JSON.stringify(val, null, 2) ?? "";
}

export function mergeUniqueDistinctiveFeatures(
  existing: string[],
  additions: unknown
): string[] {
  if (!Array.isArray(additions)) return existing;
  const seen = new Set(existing.map((f) => f.trim().toLowerCase()));
  const merged = [...existing];
  for (const item of additions) {
    if (typeof item !== "string") continue;
    const clean = item.trim();
    if (!clean) continue;
    const lower = clean.toLowerCase();
    if (!seen.has(lower)) {
      merged.push(clean);
      seen.add(lower);
    }
  }
  return merged;
}

export function appendLegacyBio(currentBio: string, legacyText: string): string {
  const cleanLegacy = legacyText.trim();
  if (!cleanLegacy) return currentBio;
  const cleanCurrent = currentBio.trim();
  if (!cleanCurrent) return cleanLegacy;
  return `${cleanCurrent}\n\n${cleanLegacy}`;
}
