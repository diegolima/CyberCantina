import type { PersonaRecord } from "../types/persona";
import type { WorldRecord } from "../types/world";

export const DEPRECATED_PERSONA_KEYS = new Set<string>(["physical_appearance"]);

export const DEPRECATED_WORLD_KEYS = new Set<string>([
  "global_rules.narrative_style",
  "global_rules.sensory_profile",
  "global_rules.taboos_and_limits",
]);

export function normalizeUnsupportedRecord(
  rawExt: Record<string, unknown> | undefined | null
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (!rawExt) return result;
  for (const [key, val] of Object.entries(rawExt)) {
    if (val === undefined || val === null) continue;
    if (typeof val === "string" && !val.trim()) continue;
    if (Array.isArray(val) && val.length === 0) continue;
    result[key] = val;
  }
  return result;
}

export function buildPersonaUnsupportedFieldsState(
  record: Pick<PersonaRecord, "persona_bio" | "physical_appearance" | "unsupported_fields">
): Record<string, unknown> {
  const result = normalizeUnsupportedRecord(record.unsupported_fields);
  const bioNorm = (record.persona_bio ?? "").trim();
  const physNorm = (record.physical_appearance ?? "").trim();
  if (physNorm && physNorm !== bioNorm && !("physical_appearance" in result)) {
    result.physical_appearance = physNorm;
  }
  return result;
}

export function buildWorldUnsupportedFieldsState(
  record: Pick<WorldRecord, "unsupported_fields">
): Record<string, unknown> {
  return normalizeUnsupportedRecord(record.unsupported_fields);
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

export function mergeUniqueStrings(
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

export function appendLegacyText(currentText: string, legacyText: string): string {
  const cleanLegacy = legacyText.trim();
  if (!cleanLegacy) return currentText;
  const cleanCurrent = currentText.trim();
  if (!cleanCurrent) return cleanLegacy;
  return `${cleanCurrent}\n\n${cleanLegacy}`;
}
