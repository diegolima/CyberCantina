import { describe, expect, it } from "vitest";
import { parseModelName, roleDisplayMeta } from "../modelFormatting";

describe("parseModelName", () => {
  it("handles empty or null inputs gracefully", () => {
    expect(parseModelName("")).toEqual({ displayName: "None selected", raw: "" });
    expect(parseModelName(null)).toEqual({ displayName: "None selected", raw: "" });
    expect(parseModelName(undefined)).toEqual({ displayName: "None selected", raw: "" });
  });

  it("extracts vendor and drops :latest tag", () => {
    const res = parseModelName("meta-llama/llama-3.1-8b:latest");
    expect(res).toEqual({
      vendor: "meta-llama",
      displayName: "llama-3.1-8b",
      tag: undefined,
      raw: "meta-llama/llama-3.1-8b:latest",
    });
  });

  it("preserves specific tags like 7b and free", () => {
    const res1 = parseModelName("qwen2.5:7b");
    expect(res1).toEqual({
      vendor: undefined,
      displayName: "qwen2.5",
      tag: "7b",
      raw: "qwen2.5:7b",
    });

    const res2 = parseModelName("meta-llama/llama-3.3-70b-instruct:free");
    expect(res2).toEqual({
      vendor: "meta-llama",
      displayName: "llama-3.3-70b-instruct",
      tag: "free",
      raw: "meta-llama/llama-3.3-70b-instruct:free",
    });
  });

  it("handles complex quant tags with underscores and dashes", () => {
    const res = parseModelName("bartowski/Llama-3.2-3B-Instruct-GGUF:Q4_K_M");
    expect(res).toEqual({
      vendor: "bartowski",
      displayName: "Llama-3.2-3B-Instruct-GGUF",
      tag: "Q4_K_M",
      raw: "bartowski/Llama-3.2-3B-Instruct-GGUF:Q4_K_M",
    });
  });

  it("handles model names with no vendor and no tag", () => {
    const res = parseModelName("mistral-small");
    expect(res).toEqual({
      vendor: undefined,
      displayName: "mistral-small",
      tag: undefined,
      raw: "mistral-small",
    });
  });
});

describe("roleDisplayMeta", () => {
  it("provides correct meta for actor, clerk, vectors", () => {
    expect(roleDisplayMeta("actor").title).toBe("Primary");
    expect(roleDisplayMeta("clerk").title).toBe("Auxiliary");
    expect(roleDisplayMeta("vectors").title).toBe("Vectors");
    expect(roleDisplayMeta("embedding").title).toBe("Vectors");
  });
});
