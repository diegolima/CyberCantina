import { describe, expect, it } from "vitest";
import { parseModelName } from "../modelFormatting";

describe("Model Deck helpers & state formatting", () => {
  it("formats vendor prefix and model name cleanly", () => {
    const actor = parseModelName("meta-llama/llama-3.3-70b-instruct:free");
    expect(actor.displayName).toBe("llama-3.3-70b-instruct");
    expect(actor.tag).toBe("free");
    expect(actor.vendor).toBe("meta-llama");
  });

  it("handles Ollama models with parameter tags", () => {
    const clerk = parseModelName("qwen2.5:14b");
    expect(clerk.displayName).toBe("qwen2.5");
    expect(clerk.tag).toBe("14b");
    expect(clerk.vendor).toBeUndefined();
  });

  it("handles models with :latest tags by dropping the tag", () => {
    const embedding = parseModelName("nomic-embed-text:latest");
    expect(embedding.displayName).toBe("nomic-embed-text");
    expect(embedding.tag).toBeUndefined();
  });
});
