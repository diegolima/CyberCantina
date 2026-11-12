import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeOllamaRoot, probeBrowserOllama, runBrowserOllamaChat } from "../ollamaDriver";
import { clampWebGpuContext, getWebGpuModelInfos } from "../webgpuCatalog";

describe("webgpuCatalog", () => {
  it("clamps oversized context sizes based on the selected model", () => {
    const small = clampWebGpuContext(12288, "Qwen2.5-3B-Instruct-q4f16_1-MLC");
    expect(small).toEqual({ effectiveContext: 4096, clamped: true, maxContext: 4096 });

    const medium = clampWebGpuContext(12288, "Qwen2.5-7B-Instruct-q4f16_1-MLC");
    expect(medium).toEqual({ effectiveContext: 8192, clamped: true, maxContext: 8192 });

    const exact = clampWebGpuContext(4096, "Qwen2.5-3B-Instruct-q4f16_1-MLC");
    expect(exact).toEqual({ effectiveContext: 4096, clamped: false, maxContext: 4096 });
  });

  it("exposes curated WebGPU model metadata for the picker", () => {
    const models = getWebGpuModelInfos();
    expect(models.length).toBeGreaterThanOrEqual(8);
    expect(models.every((m) => !m.is_embedding && m.size_mb > 0)).toBe(true);
  });
});

describe("ollamaDriver", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes /v1 and /api suffixes", () => {
    expect(normalizeOllamaRoot("http://localhost:11434/v1/")).toBe("http://localhost:11434");
    expect(normalizeOllamaRoot("http://127.0.0.1:11434/api")).toBe("http://127.0.0.1:11434");
  });

  it("probes /api/tags and flags TypeError as CORS/LNA setup needed", async () => {
    const okFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          models: [
            { name: "llama3.1:8b", size: 4 * 1024 * 1024 * 1024, details: { parameter_size: "8B", family: "llama" } },
            { name: "nomic-embed-text:latest", size: 274 * 1024 * 1024, details: { family: "bert" } },
          ],
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", okFetch);

    const ok = await probeBrowserOllama("http://localhost:11434");
    expect(ok.reachable).toBe(true);
    expect(ok.protocol).toBe("ollama_native");
    expect(ok.models.map((m) => [m.name, m.is_embedding])).toEqual([
      ["llama3.1:8b", false],
      ["nomic-embed-text:latest", true],
    ]);

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    vi.stubGlobal("window", { location: { origin: "https://cantina.example.com" } });
    const blocked = await probeBrowserOllama("http://localhost:11434");
    expect(blocked.reachable).toBe(false);
    expect(blocked.needsCorsOrLnaSetup).toBe(true);
  });

  it("streams NDJSON lines and retries without think on HTTP 400", async () => {
    const encoder = new TextEncoder();
    const streamBody = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('{"message":{"content":"Hello "},"done":false}\n'));
        controller.enqueue(encoder.encode('{"message":{"content":"browser!"},"done":true,"done_reason":"stop"}\n'));
        controller.close();
      },
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("unknown field think", { status: 400 }))
      .mockResolvedValueOnce(new Response(streamBody, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const chunks: string[] = [];
    const res = await runBrowserOllamaChat(
      {
        type: "llm.request",
        request_id: "r1",
        driver: "browser_ollama",
        mode: "stream",
        base_url: "http://localhost:11434",
        model: "llama3.1:8b",
        messages: [{ role: "user", content: "hi" }],
        options: { temperature: 0.7, max_tokens: 256, context_size: 8192 },
      },
      (delta) => chunks.push(delta)
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(secondBody.think).toBeUndefined();
    expect(secondBody.options.num_ctx).toBe(8192);
    expect(chunks.join("")).toBe("Hello browser!");
    expect(res.content).toBe("Hello browser!");
  });
});
