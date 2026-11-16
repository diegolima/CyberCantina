import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteProviderCredential,
  getProviderCredential,
  hasProviderCredential,
  pruneMissingProviderCredentials,
  setProviderCredential,
} from "../credentialVault";
import {
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
});
