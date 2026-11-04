import { describe, expect, it } from "vitest";
import { LLMProvider, ProviderModelInfo, ProviderProbeResponse } from "../../../types";
import {
  filterByKind,
  modelAfterProviderChange,
  modelsForProvider,
  pickerIssues,
  sameModel,
} from "../modelPickerLogic";

const model = (name: string, is_embedding = false): ProviderModelInfo => ({
  name,
  size_mb: 1,
  parameter_size: "",
  quantization_level: "",
  family: "",
  is_embedding,
});

const provider = (over: Partial<LLMProvider> = {}): LLMProvider => ({
  id: "p1",
  name: "Home",
  type: "ollama",
  scope: "system",
  owner_id: null,
  color: "cyan",
  is_enabled: true,
  base_url: null,
  has_bearer_token: false,
  usable: true,
  unusable_reason: null,
  cached_models: [model("cached:1b")],
  last_probed_at: null,
  last_error_code: null,
  version: 1,
  created_at: "",
  updated_at: "",
  ...over,
});

const probe = (reachable: boolean, models: ProviderModelInfo[] = []): ProviderProbeResponse => ({
  provider_id: "p1",
  reachable,
  protocol: reachable ? "ollama_native" : null,
  models,
  chat_models: [],
  embedding_models: [],
  error_code: reachable ? null : "timeout",
  error: null,
  config_version: 1,
  probed_at: "",
  from_cache: false,
});

describe("modelsForProvider", () => {
  it("prefers live results, falls back to the cached catalog, then to nothing", () => {
    expect(modelsForProvider(provider(), probe(true, [model("live:8b")]))).toEqual({
      models: [model("live:8b")],
      source: "live",
    });
    expect(modelsForProvider(provider(), probe(false)).source).toBe("cached");
    expect(modelsForProvider(provider({ cached_models: [] }), undefined).source).toBe("none");
    expect(modelsForProvider(undefined, undefined).source).toBe("none");
  });
});

describe("selection rules", () => {
  const models = [model("llama3:8b"), model("nomic-embed-text:latest", true)];

  it("filters by kind unless 'show all' is on", () => {
    expect(filterByKind(models, "chat", false).map((m) => m.name)).toEqual(["llama3:8b"]);
    expect(filterByKind(models, "embedding", false).map((m) => m.name)).toEqual(["nomic-embed-text:latest"]);
    expect(filterByKind(models, "chat", true)).toHaveLength(2);
  });

  it("treats a bare name and ':latest' as the same model", () => {
    expect(sameModel("nomic-embed-text", "nomic-embed-text:latest")).toBe(true);
    expect(sameModel("llama3:8b", "llama3:70b")).toBe(false);
  });

  it("keeps the model on provider change only when the new provider has it, else clears (never replaces)", () => {
    expect(modelAfterProviderChange("llama3:8b", models)).toBe("llama3:8b");
    expect(modelAfterProviderChange("qwen2:7b", models)).toBe("");
    expect(modelAfterProviderChange("llama3:8b", [])).toBe("");
  });
});

describe("pickerIssues", () => {
  const models = [model("llama3:8b")];

  it("flags a missing provider, a disabled provider and an uninstalled saved model", () => {
    expect(pickerIssues({ providerId: "gone", model: "x" }, undefined, [], "none", undefined)).toEqual([
      { kind: "provider_missing", providerId: "gone" },
    ]);
    expect(
      pickerIssues({ providerId: "p1", model: "llama3:8b" }, provider({ is_enabled: false }), models, "live", true)
    ).toContainEqual({ kind: "provider_disabled", providerId: "p1" });
    expect(
      pickerIssues({ providerId: "p1", model: "ghost:1b" }, provider(), models, "live", true)
    ).toContainEqual({ kind: "model_not_in_provider", model: "ghost:1b" });
  });

  it("explains cached lists when the provider is unreachable and is quiet when everything is fine", () => {
    expect(
      pickerIssues({ providerId: "p1", model: "llama3:8b" }, provider(), models, "cached", false)
    ).toContainEqual({ kind: "provider_unreachable_cached", providerId: "p1" });
    expect(pickerIssues({ providerId: "p1", model: "llama3:8b" }, provider(), models, "live", true)).toEqual([]);
    expect(pickerIssues({ providerId: null, model: "" }, undefined, [], "none", undefined)).toEqual([]);
  });
});
