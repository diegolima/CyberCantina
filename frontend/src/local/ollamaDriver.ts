import { ProviderModelInfo } from "../types";
import { BrowserOllamaProbeOutcome, RelayDriverResult, RelayLlmRequest } from "./types";

const EMBED_KEYWORDS = [
  "embed",
  "minilm",
  "bge-",
  "nomic-embed",
  "mxbai-embed",
  "arctic-embed",
];

function isEmbeddingName(name: string): boolean {
  const lower = name.toLowerCase();
  return EMBED_KEYWORDS.some((kw) => lower.includes(kw));
}

export function normalizeOllamaRoot(rawUrl: string | undefined): string {
  let cleaned = (rawUrl || "http://localhost:11434").trim().replace(/\/+$/, "");
  if (cleaned.endsWith("/v1")) cleaned = cleaned.slice(0, -3).replace(/\/+$/, "");
  if (cleaned.endsWith("/api")) cleaned = cleaned.slice(0, -4).replace(/\/+$/, "");
  return cleaned || "http://localhost:11434";
}

function loopbackFetchInit(init: RequestInit): RequestInit {
  // targetAddressSpace is part of the Local Network Access spec (Chrome/Firefox).
  return {
    ...init,
    mode: "cors",
    credentials: "omit",
    targetAddressSpace: "loopback",
  } as RequestInit;
}

function parseOllamaTags(payload: any): ProviderModelInfo[] {
  const raw = Array.isArray(payload?.models) ? payload.models : [];
  return raw
    .filter((m: any) => typeof m?.name === "string" && m.name.trim())
    .map((m: any) => {
      const name = String(m.name);
      const sizeBytes = typeof m.size === "number" ? m.size : 0;
      const details = m.details && typeof m.details === "object" ? m.details : {};
      return {
        name,
        size_mb: Math.round(sizeBytes / (1024 * 1024)),
        parameter_size: String(details.parameter_size || ""),
        quantization_level: String(details.quantization_level || ""),
        family: String(details.family || ""),
        is_embedding: isEmbeddingName(name),
      };
    });
}

function parseOpenAiModels(payload: any): ProviderModelInfo[] {
  const raw = Array.isArray(payload?.data) ? payload.data : [];
  return raw
    .filter((m: any) => typeof m?.id === "string" && m.id.trim())
    .map((m: any) => {
      const name = String(m.id);
      return {
        name,
        size_mb: 0,
        parameter_size: "",
        quantization_level: "",
        family: "",
        is_embedding: isEmbeddingName(name),
      };
    });
}

export async function probeBrowserOllama(
  baseUrl?: string,
  signal?: AbortSignal
): Promise<BrowserOllamaProbeOutcome> {
  const root = normalizeOllamaRoot(baseUrl);
  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => timeoutCtrl.abort(), 5000);
  const combinedSignal =
    signal && typeof (AbortSignal as any).any === "function"
      ? (AbortSignal as any).any([signal, timeoutCtrl.signal])
      : timeoutCtrl.signal;

  try {
    const resp = await fetch(`${root}/api/tags`, loopbackFetchInit({ method: "GET", signal: combinedSignal }));
    if (resp.ok) {
      const data = await resp.json();
      return {
        reachable: true,
        protocol: "ollama_native",
        models: parseOllamaTags(data),
        error_code: null,
        error: null,
      };
    }
    if (resp.status === 404) {
      const oaiResp = await fetch(
        `${root}/v1/models`,
        loopbackFetchInit({ method: "GET", signal: combinedSignal })
      );
      if (oaiResp.ok) {
        const data = await oaiResp.json();
        return {
          reachable: true,
          protocol: "openai_compat",
          models: parseOpenAiModels(data),
          error_code: null,
          error: null,
        };
      }
      return {
        reachable: false,
        protocol: null,
        models: [],
        error_code: "not_found",
        error: `HTTP ${oaiResp.status} from ${root}`,
      };
    }
    return {
      reachable: false,
      protocol: null,
      models: [],
      error_code: "bad_payload",
      error: `Ollama returned HTTP ${resp.status}.`,
    };
  } catch (err: any) {
    if (err?.name === "AbortError") {
      return {
        reachable: false,
        protocol: null,
        models: [],
        error_code: "timeout",
        error: `Timed out reaching ${root}.`,
      };
    }
    const isNetworkCors = err instanceof TypeError;
    return {
      reachable: false,
      protocol: null,
      models: [],
      error_code: "connect_refused",
      error: isNetworkCors
        ? `Browser blocked or could not reach ${root}. Ensure Ollama is running with OLLAMA_ORIGINS="${window.location.origin}" and Local Network Access is allowed.`
        : err?.message || `Could not reach ${root}.`,
      needsCorsOrLnaSetup: isNetworkCors,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function runBrowserOllamaChat(
  req: RelayLlmRequest,
  onChunk: (delta: string) => void,
  signal?: AbortSignal
): Promise<RelayDriverResult> {
  const root = normalizeOllamaRoot(req.base_url);
  const url = `${root}/api/chat`;
  const opts: Record<string, unknown> = {
    temperature: req.options.temperature,
    num_predict: req.options.max_tokens,
  };
  if (req.options.context_size != null) {
    opts.num_ctx = req.options.context_size;
  }

  const basePayload: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
    stream: req.mode === "stream",
    think: false,
    keep_alive: req.options.keep_alive ?? "30m",
    options: opts,
  };
  if (req.options.json_schema) {
    basePayload.format = req.options.json_schema;
  } else if (req.options.json_mode) {
    basePayload.format = "json";
  }

  const postChat = async (payload: Record<string, unknown>) =>
    fetch(
      url,
      loopbackFetchInit({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal,
      })
    );

  let resp = await postChat(basePayload);
  if (resp.status === 400) {
    const retryPayload = { ...basePayload };
    delete retryPayload.think;
    if (req.mode === "complete") {
      retryPayload.options = {
        ...opts,
        num_predict: Math.max(req.options.max_tokens * 3, 4096),
      };
    }
    resp = await postChat(retryPayload);
  }

  if (resp.status === 404) {
    const errText = await resp.text();
    if (errText.toLowerCase().includes("model") && errText.toLowerCase().includes("not found")) {
      throw new Error(
        `Ollama model '${req.model}' is not installed locally. Run \`ollama pull ${req.model}\` or select an installed model.`
      );
    }
    throw new Error(`Ollama endpoint ${url} returned 404: ${errText}`);
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Local Ollama error (HTTP ${resp.status}): ${errText || resp.statusText}`);
  }

  if (req.mode === "stream") {
    if (!resp.body) {
      throw new Error("Ollama streaming response had no body.");
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullContent = "";
    let doneReason: string | null = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIdx = buffer.indexOf("\n");
      while (newlineIdx !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (line) {
          try {
            const chunk = JSON.parse(line);
            const delta = chunk?.message?.content;
            if (typeof delta === "string" && delta.length > 0) {
              fullContent += delta;
              onChunk(delta);
            }
            if (chunk?.done) {
              doneReason = chunk?.done_reason || null;
              return { content: fullContent, done_reason: doneReason };
            }
          } catch {
            // ignore partial/malformed NDJSON line
          }
        }
        newlineIdx = buffer.indexOf("\n");
      }
    }
    if (buffer.trim()) {
      try {
        const chunk = JSON.parse(buffer.trim());
        const delta = chunk?.message?.content;
        if (typeof delta === "string" && delta.length > 0) {
          fullContent += delta;
          onChunk(delta);
        }
        doneReason = chunk?.done_reason || doneReason;
      } catch {
        // ignore trailing partial bytes
      }
    }
    return { content: fullContent, done_reason: doneReason };
  }

  const data = await resp.json();
  const msg = data?.message || {};
  const content = String(msg.content || "").trim();
  const thinking = String(msg.thinking || "").trim();
  if (content) {
    return { content, thinking, done_reason: data?.done_reason || null };
  }

  if (req.options.json_schema || data?.done_reason === "length") {
    const fallbackPayload: Record<string, unknown> = {
      ...basePayload,
      options: {
        ...opts,
        num_predict: Math.max(req.options.max_tokens * 3, 4096),
      },
    };
    if (req.options.json_schema) {
      fallbackPayload.format = "json";
    }
    const retryResp = await postChat(fallbackPayload);
    if (retryResp.ok) {
      const retryData = await retryResp.json();
      const retryMsg = retryData?.message || {};
      const retryContent = String(retryMsg.content || "").trim();
      if (retryContent) {
        return {
          content: retryContent,
          thinking: String(retryMsg.thinking || "").trim(),
          done_reason: retryData?.done_reason || null,
        };
      }
      const retryThinking = String(retryMsg.thinking || "").trim();
      if (retryThinking.includes("{")) {
        return { content: "", thinking: retryThinking, done_reason: retryData?.done_reason || null };
      }
    }
  }

  return { content, thinking, done_reason: data?.done_reason || null };
}
