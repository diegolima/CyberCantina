import { LLMProvider, ProviderModelInfo, ProviderProbeResponse } from "../../types";

export type ModelKind = "chat" | "embedding";

export interface RoleSelection {
  providerId: string | null;
  model: string;
}

export type PickerIssue =
  | { kind: "provider_missing"; providerId: string }
  | { kind: "provider_disabled"; providerId: string }
  | { kind: "provider_unusable"; providerId: string }
  | { kind: "provider_unreachable_cached"; providerId: string }
  | { kind: "model_not_in_provider"; model: string };

export type ModelSource = "live" | "cached" | "none";

/** Live probe results win when the provider is reachable; otherwise fall back to the cached catalog. */
export function modelsForProvider(
  provider: LLMProvider | undefined,
  live: ProviderProbeResponse | undefined
): { models: ProviderModelInfo[]; source: ModelSource } {
  if (!provider) return { models: [], source: "none" };
  if (live?.reachable) return { models: live.models, source: "live" };
  if (provider.cached_models.length > 0) return { models: provider.cached_models, source: "cached" };
  return { models: [], source: "none" };
}

export function filterByKind(
  models: ProviderModelInfo[],
  kind: ModelKind,
  showAll: boolean
): ProviderModelInfo[] {
  if (showAll) return models;
  return models.filter((m) => (kind === "embedding" ? m.is_embedding : !m.is_embedding));
}

/** Names with and without the implicit ":latest" tag are treated as the same model. */
export function sameModel(a: string, b: string): boolean {
  const norm = (n: string) => (n.includes(":") ? n : `${n}:latest`);
  return norm(a) === norm(b);
}

/**
 * A provider change keeps the model only if the new provider lists it, otherwise clears it so the
 * form is invalid until the user chooses one. A selection is never silently replaced.
 */
export function modelAfterProviderChange(currentModel: string, newProviderModels: ProviderModelInfo[]): string {
  const match = newProviderModels.find((m) => sameModel(m.name, currentModel));
  return match ? match.name : "";
}

export function pickerIssues(
  value: RoleSelection,
  provider: LLMProvider | undefined,
  models: ProviderModelInfo[],
  source: ModelSource,
  providerReachable: boolean | undefined
): PickerIssue[] {
  const issues: PickerIssue[] = [];
  if (!value.providerId) return issues;
  if (!provider) {
    issues.push({ kind: "provider_missing", providerId: value.providerId });
    return issues;
  }
  if (!provider.is_enabled) issues.push({ kind: "provider_disabled", providerId: provider.id });
  else if (!provider.usable) issues.push({ kind: "provider_unusable", providerId: provider.id });
  if (source === "cached" && providerReachable === false) {
    issues.push({ kind: "provider_unreachable_cached", providerId: provider.id });
  }
  if (value.model && models.length > 0 && !models.some((m) => sameModel(m.name, value.model))) {
    issues.push({ kind: "model_not_in_provider", model: value.model });
  }
  return issues;
}

export function describeIssue(issue: PickerIssue): string {
  switch (issue.kind) {
    case "provider_missing":
      return "The saved provider no longer exists. Choose another provider.";
    case "provider_disabled":
      return "This provider is disabled.";
    case "provider_unusable":
      return "This provider is currently not usable.";
    case "provider_unreachable_cached":
      return "Provider unreachable; showing the last known model list.";
    case "model_not_in_provider":
      return `Model "${issue.model}" was not found on this provider.`;
  }
}
