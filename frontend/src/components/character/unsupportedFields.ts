import type { CharacterRecord } from "../../types";
import {
  appendLegacyText,
  filterRemainingUnsupportedFields,
  formatUnsupportedValueText,
  mergeUniqueStrings,
  normalizeUnsupportedRecord,
} from "../../utils/unsupportedFields";

export { filterRemainingUnsupportedFields, formatUnsupportedValueText };

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
  const result = normalizeUnsupportedRecord(record.unsupported_fields);

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

export function mergeUniqueDistinctiveFeatures(
  existing: string[],
  additions: unknown
): string[] {
  return mergeUniqueStrings(existing, additions);
}

export function appendLegacyBio(currentBio: string, legacyText: string): string {
  return appendLegacyText(currentBio, legacyText);
}
