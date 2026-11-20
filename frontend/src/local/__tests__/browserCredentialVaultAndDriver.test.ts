import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteProviderCredential,
  getProviderCredential,
  hasProviderCredential,
  pruneMissingProviderCredentials,
  setProviderCredential,
} from "../credentialVault";
import {
  normalizeRemoteBaseUrl,
  probeRemoteProvider,
  RemoteDriverError,
  runRemoteProviderChat,
} from "../remoteProviderDriver";

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

describe("credentialVault", () => {
  beforeEach(() => {
    const storage = createMemoryStorage();
    vi.stubGlobal("window", { localStorage: storage, location: { origin: "https://app.test" } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("isolates credentials per user and provider", () => {
    setProviderCredential("user_a", "prov_1", "sk-alice");
    setProviderCredential("user_b", "prov_1", "sk-bob");

    expect(getProviderCredential("user_a", "prov_1")).toBe("sk-alice");
    expect(getProviderCredential("user_b", "prov_1")).toBe("sk-bob");
    expect(hasProviderCredential("user_a", "prov_1")).toBe(true);
    expect(hasProviderCredential("user_c", "prov_1")).toBe(false);

    deleteProviderCredential("user_a", "prov_1");
    expect(getProviderCredential("user_a", "prov_1")).toBeNull();
    expect(getProviderCredential("user_b", "prov_1")).toBe("sk-bob");
  });

  it("prunes only deleted providers and preserves keys for existing paused providers", () => {
    setProviderCredential("user_a", "prov_keep", "sk-keep");
    setProviderCredential("user_a", "prov_deleted", "sk-deleted");
    setProviderCredential("user_b", "prov_deleted", "sk-other-user");

    pruneMissingProviderCredentials("user_a", new Set(["prov_keep"]));

    expect(getProviderCredential("user_a", "prov_keep")).toBe("sk-keep");
    expect(getProviderCredential("user_a", "prov_deleted")).toBeNull();
    expect(getProviderCredential("user_b", "prov_deleted")).toBe("sk-other-user");
  });
});

describe("remoteProviderDriver", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("probes OpenRouter via /auth/key and /models with Bearer token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { label: "ok" } }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: "anthropic/claude-sonnet-4", context_length: 200000 }],
          }),
          { status: 200 }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await probeRemoteProvider({
      type: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      token: "sk-or-test",
    });

    expect(res.reachable).toBe(true);
    expect(res.protocol).toBe("openai_compat");
    expect(res.chat_models).toEqual(["anthropic/claude-sonnet-4"]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/auth/key");
    expect(fetchMock.mock.calls[0][1].headers).toEqual({
      Authorization: "Bearer sk-or-test",
    });
  });

  it("refuses silent AI Horde anonymous fallback when browser token is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const probe = await probeRemoteProvider({
      type: "aihorde",
      baseUrl: "https://oai.stablehorde.net/v1",
      token: null,
      requireToken: true,
    });
    expect(probe.reachable).toBe(false);
    expect(probe.error_code).toBe("browser_credential_missing");
    expect(fetchMock).not.toHaveBeenCalled();

    await expect(
      runRemoteProviderChat(
        {
          type: "llm.request",
          request_id: "r-horde",
          driver: "aihorde",
          provider_id: "prov_h",
          mode: "complete",
          base_url: "https://oai.stablehorde.net/v1",
          model: "koboldcpp/test",
          messages: [{ role: "user", content: "hi" }],
          options: { temperature: 0.7, max_tokens: 64 },
        },
        null,
        () => {}
      )
    ).rejects.toMatchObject({ code: "browser_credential_missing" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("classifies TypeError as cors_or_network_error on remote probe", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const res = await probeRemoteProvider({
      type: "ollama",
      baseUrl: "https://ollama.example.com",
      token: "tok-123",
    });
    expect(res.reachable).toBe(false);
    expect(res.error_code).toBe("cors_or_network_error");
  });

  it("streams OpenRouter SSE deltas directly from browser", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"browser!"}}]}\n\n'));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const chunks: string[] = [];
    const res = await runRemoteProviderChat(
      {
        type: "llm.request",
        request_id: "r-or",
        driver: "openrouter",
        provider_id: "prov_or",
        mode: "stream",
        base_url: "https://openrouter.ai/api/v1",
        model: "openai/gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }],
        options: { temperature: 0.7, max_tokens: 128, disable_reasoning: true },
      },
      "sk-or-live",
      (d) => chunks.push(d)
    );

    expect(chunks.join("")).toBe("Hello browser!");
    expect(res.content).toBe("Hello browser!");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer sk-or-live");
  });

  it("throws RemoteDriverError on OpenRouter 401", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 })));
    await expect(
      runRemoteProviderChat(
        {
          type: "llm.request",
          request_id: "r-401",
          driver: "openrouter",
          provider_id: "prov_or",
          mode: "complete",
          base_url: "https://openrouter.ai/api/v1",
          model: "openai/gpt-4o-mini",
          messages: [{ role: "user", content: "hi" }],
          options: { temperature: 0.7, max_tokens: 128 },
        },
        "sk-bad",
        () => {}
      )
    ).rejects.toBeInstanceOf(RemoteDriverError);
  });

  it("probes NanoGPT for reachability without requiring a token and merges embedding models", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: [{ id: "openai/gpt-5" }, { id: "deepseek/deepseek-r1:fast" }] }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: [{ id: "cohere/embed-5-fast" }] }),
          { status: 200 }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await probeRemoteProvider({
      type: "nanogpt",
      baseUrl: "https://nano-gpt.com/api/v1",
      token: null,
    });

    expect(res.reachable).toBe(true);
    expect(res.protocol).toBe("openai_compat");
    expect(res.chat_models).toEqual(["openai/gpt-5", "deepseek/deepseek-r1:fast"]);
    expect(res.embedding_models).toEqual(["cohere/embed-5-fast"]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://nano-gpt.com/api/v1/models");
    expect(fetchMock.mock.calls[1][0]).toBe("https://nano-gpt.com/api/v1/embedding-models");
  });

  it("streams NanoGPT SSE deltas and requires a browser token for chat", async () => {
    await expect(
      runRemoteProviderChat(
        {
          type: "llm.request",
          request_id: "r-ng-missing",
          driver: "nanogpt",
          provider_id: "prov_ng",
          mode: "complete",
          base_url: "https://nano-gpt.com/api/v1",
          model: "openai/gpt-5",
          messages: [{ role: "user", content: "hi" }],
          options: { temperature: 0.7, max_tokens: 64 },
        },
        null,
        () => {}
      )
    ).rejects.toMatchObject({ code: "browser_credential_missing" });

    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Nano "}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"GPT"}}]}\n\n'));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const chunks: string[] = [];
    const res = await runRemoteProviderChat(
      {
        type: "llm.request",
        request_id: "r-ng-stream",
        driver: "nanogpt",
        provider_id: "prov_ng",
        mode: "stream",
        base_url: "https://api.nano-gpt.com",
        model: "openai/gpt-5",
        messages: [{ role: "user", content: "hi" }],
        options: { temperature: 0.7, max_tokens: 128, disable_reasoning: true },
      },
      "ng-live",
      (d) => chunks.push(d)
    );

    expect(chunks.join("")).toBe("Nano GPT");
    expect(res.content).toBe("Nano GPT");
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.nano-gpt.com/api/v1/chat/completions");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer ng-live");
  });

  it("probes and streams generic OpenAI-compatible providers with or without an API key", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              { id: "gpt-4o-mini" },
              { id: "text-embedding-3-small" },
            ],
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          'data: {"choices":[{"delta":{"content":"Generic "}}]}\n\ndata: {"choices":[{"delta":{"content":"OpenAI"}}]}\n\ndata: [DONE]\n\n',
          { status: 200, headers: { "Content-Type": "text/event-stream" } }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    // Probe without token (e.g. local llama.cpp / LM Studio)
    const probe = await probeRemoteProvider({
      type: "openai_compat",
      baseUrl: "http://localhost:1234",
      token: null,
    });
    expect(probe.reachable).toBe(true);
    expect(probe.protocol).toBe("openai_compat");
    expect(probe.chat_models).toEqual(["gpt-4o-mini"]);
    expect(probe.embedding_models).toEqual(["text-embedding-3-small"]);
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:1234/v1/models");
    expect(fetchMock.mock.calls[0][1].headers).toEqual({});

    // Stream without token (does not throw browser_credential_missing)
    const chunks: string[] = [];
    const res = await runRemoteProviderChat(
      {
        type: "llm.request",
        request_id: "r-oai-1",
        driver: "openai_compat",
        provider_id: "prov_oai",
        mode: "stream",
        base_url: "https://api.groq.com/openai/v1",
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: "hello" }],
        options: { temperature: 0.7, max_tokens: 64, disable_reasoning: true },
      },
      null,
      (delta) => chunks.push(delta)
    );
    expect(chunks.join("")).toBe("Generic OpenAI");
    expect(res.content).toBe("Generic OpenAI");
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.groq.com/openai/v1/chat/completions");
    const sentBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(sentBody.reasoning).toBeUndefined();
    expect(sentBody.reasoning_effort).toBeUndefined();
  });

  it("normalizes valid remote URLs and rejects unsafe schemes, credentials, queries, fragments, traversal, and metadata IPs", async () => {
    expect(normalizeRemoteBaseUrl("openai_compat", "https://api.openai.com")).toBe("https://api.openai.com/v1");
    expect(normalizeRemoteBaseUrl("openai_compat", "https://api.groq.com/openai/v1/")).toBe(
      "https://api.groq.com/openai/v1"
    );
    expect(normalizeRemoteBaseUrl("openai_compat", "http://localhost:1234")).toBe("http://localhost:1234/v1");
    expect(normalizeRemoteBaseUrl("openrouter", "")).toBe("https://openrouter.ai/api/v1");
    expect(normalizeRemoteBaseUrl("openrouter", "https://openrouter.ai")).toBe("https://openrouter.ai/api/v1");
    expect(normalizeRemoteBaseUrl("nanogpt", "")).toBe("https://nano-gpt.com/api/v1");
    expect(normalizeRemoteBaseUrl("nanogpt", "https://api.nano-gpt.com")).toBe("https://api.nano-gpt.com/api/v1");
    expect(normalizeRemoteBaseUrl("aihorde", "https://oai.stablehorde.net")).toBe("https://oai.stablehorde.net/v1");
    expect(normalizeRemoteBaseUrl("ollama", "https://ollama.example.com:8443/v1/")).toBe(
      "https://ollama.example.com:8443"
    );
    expect(normalizeRemoteBaseUrl("ollama", "http://192.168.1.50:11434/api")).toBe(
      "http://192.168.1.50:11434"
    );

    const invalidCases: Array<{
      type: "ollama" | "openai_compat" | "openrouter" | "aihorde" | "nanogpt";
      url: string;
    }> = [
      { type: "ollama", url: "" },
      { type: "openai_compat", url: "" },
      { type: "ollama", url: "not-a-url" },
      { type: "ollama", url: "javascript:alert(1)" },
      { type: "ollama", url: "ftp://ollama.example.com" },
      { type: "openrouter", url: "http://openrouter.ai/api/v1" },
      { type: "nanogpt", url: "http://nano-gpt.com/api/v1" },
      { type: "aihorde", url: "http://oai.stablehorde.net/v1" },
      { type: "ollama", url: "https://user:pass@ollama.example.com" },
      { type: "openrouter", url: "https://openrouter.ai/api/v1?x=1" },
      { type: "openrouter", url: "https://openrouter.ai/api/v1#frag" },
      { type: "nanogpt", url: "https://nano-gpt.com/api/v1?x=1" },
      { type: "ollama", url: "https://ollama.example.com/../secret" },
      { type: "ollama", url: "http://169.254.169.254/latest/meta-data" },
      { type: "ollama", url: "http://0.0.0.0:11434" },
      { type: "ollama", url: "http://[::ffff:169.254.169.254]:11434" },
      { type: "ollama", url: "http://[fe80::1]:11434" },
    ];

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    for (const c of invalidCases) {
      expect(() => normalizeRemoteBaseUrl(c.type, c.url)).toThrow(RemoteDriverError);

      const probe = await probeRemoteProvider({
        type: c.type,
        baseUrl: c.url,
        token: "tok-secret",
      });
      expect(probe.reachable).toBe(false);
      expect(["invalid_url", "blocked_by_policy"]).toContain(probe.error_code);

      await expect(
        runRemoteProviderChat(
          {
            type: "llm.request",
            request_id: "r-bad-url",
            driver: c.type,
            provider_id: "prov_bad",
            mode: "complete",
            base_url: c.url,
            model: "test-model",
            messages: [{ role: "user", content: "hi" }],
            options: { temperature: 0.7, max_tokens: 64 },
          },
          "tok-secret",
          () => {}
        )
      ).rejects.toBeInstanceOf(RemoteDriverError);
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
