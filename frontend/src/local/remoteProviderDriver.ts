import type {
  ProbeErrorCode,
  ProviderModelInfo,
  ProviderProbeResponse,
  ProviderType,
} from "../types";
import type { RelayDriverResult, RelayLlmRequest } from "./types";

const EMBED_KEYWORDS = [
  "embed",
  "minilm",
  "bge-",
  "nomic-embed",
  "mxbai-embed",
  "arctic-embed",
  "embedding",
];

function isEmbeddingName(name: string): boolean {
  const lower = name.toLowerCase();
  return EMBED_KEYWORDS.some((kw) => lower.includes(kw));
}

export class RemoteDriverError extends Error {
  code: ProbeErrorCode | "inference_failed" | "model_not_found";
  constructor(
    code: ProbeErrorCode | "inference_failed" | "model_not_found",
    message: string
  ) {
    super(message);
    this.name = "RemoteDriverError";
    this.code = code;
  }
}

function isBlockedLiteralHost(host: string): boolean {
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (bare === "0.0.0.0" || bare === "::" || bare === "0:0:0:0:0:0:0:0") {
    return true;
  }
  if (bare.startsWith("169.254.") || /^fe[89ab][0-9a-f]:/i.test(bare)) {
    return true;
  }
  // WHATWG URL normalizes IPv4-mapped IPv6 literals to ::ffff:XXXX:YYYY
  if (bare === "::ffff:0:0" || /^::ffff:a9fe:/i.test(bare)) {
    return true;
  }
  return false;
}

export function normalizeRemoteBaseUrl(
  type: ProviderType | "ollama" | "openrouter" | "aihorde",
  rawUrl?: string | null
): string {
  const trimmed = (rawUrl ?? "").trim();
  if (!trimmed) {
    if (type === "openrouter") {
      return "https://openrouter.ai/api/v1";
    }
    if (type === "aihorde") {
      return "https://oai.stablehorde.net/v1";
    }
    throw new RemoteDriverError("invalid_url", "Server URL is required.");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new RemoteDriverError("invalid_url", "Server URL is not a valid URL.");
  }

  if (type === "openrouter" || type === "aihorde") {
    if (parsed.protocol !== "https:") {
      throw new RemoteDriverError("invalid_url", "Cloud provider URL must use https://.");
    }
  } else if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new RemoteDriverError("invalid_url", "Server URL must use http:// or https://.");
  }
  const protocol = parsed.protocol === "https:" ? "https:" : "http:";

  if (parsed.username || parsed.password) {
    throw new RemoteDriverError(
      "invalid_url",
      "Credentials in the URL are not allowed; use the API key field."
    );
  }
  if (parsed.search || parsed.hash) {
    throw new RemoteDriverError(
      "invalid_url",
      "Server URL must not contain a query string or fragment."
    );
  }

  const host = parsed.hostname.toLowerCase();
  if (!host) {
    throw new RemoteDriverError("invalid_url", "Server URL has no host.");
  }
  if (isBlockedLiteralHost(host)) {
    throw new RemoteDriverError(
      "blocked_by_policy",
      "Link-local, metadata, or unspecified addresses are not allowed."
    );
  }

  let portSuffix = "";
  if (parsed.port) {
    const portNum = Number.parseInt(parsed.port, 10);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535 || String(portNum) !== parsed.port) {
      throw new RemoteDriverError("invalid_url", "Server URL has an invalid port.");
    }
    portSuffix = `:${portNum}`;
  }

  const schemeEnd = trimmed.indexOf("://");
  const afterScheme = schemeEnd >= 0 ? trimmed.slice(schemeEnd + 3) : "";
  const pathStart = afterScheme.search(/[/?#]/);
  const rawPath = pathStart >= 0 ? afterScheme.slice(pathStart).split(/[?#]/, 1)[0] : "";
  const segments = rawPath.split("/");
  if (
    segments.some((seg) => {
      const lower = seg.toLowerCase();
      return (
        lower === "." ||
        lower === ".." ||
        lower === "%2e" ||
        lower === "%2e%2e" ||
        lower === ".%2e" ||
        lower === "%2e."
      );
    })
  ) {
    throw new RemoteDriverError("invalid_url", "Server URL must not contain path traversal segments.");
  }

  let path = parsed.pathname.replace(/\/+$/, "");
  if (type === "openrouter") {
    if (!path) {
      path = "/api/v1";
    }
  } else if (type === "aihorde") {
    if (!path || !path.endsWith("/v1")) {
      path = path ? `${path}/v1` : "/v1";
    }
  } else {
    if (path.endsWith("/v1")) {
      path = path.slice(0, -3).replace(/\/+$/, "");
    } else if (path.endsWith("/api")) {
      path = path.slice(0, -4).replace(/\/+$/, "");
    }
  }

  return `${protocol}//${host}${portSuffix}${path}`;
}

function bearerHeaders(token?: string | null): Record<string, string> {
  const clean = (token ?? "").trim();
  return clean ? { Authorization: `Bearer ${clean}` } : {};
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

function parseOpenRouterModels(payload: any): ProviderModelInfo[] {
  const raw = Array.isArray(payload?.data) ? payload.data : [];
  return raw
    .filter((item: any) => typeof item?.id === "string" && item.id.trim())
    .map((item: any) => {
      const modelId = String(item.id);
      const modality = String(item?.architecture?.modality || "");
      const isEmbed =
        modality.toLowerCase().includes("embedding") || isEmbeddingName(modelId);
      const ctx = item?.context_length;
      const paramSize =
        typeof ctx === "number" && ctx > 0 ? `${Math.floor(ctx / 1000)}k ctx` : "";
      const family = modelId.includes("/") ? modelId.split("/")[0] : "";
      return {
        name: modelId,
        size_mb: 0,
        parameter_size: paramSize,
        quantization_level: "",
        family,
        is_embedding: isEmbed,
      };
    });
}

function parseAiHordeModels(payload: any): ProviderModelInfo[] {
  const raw = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload)
      ? payload
      : [];
  const models: ProviderModelInfo[] = [];
  for (const item of raw) {
    const id = typeof item === "string" ? item : String(item?.id || item?.name || "");
    if (!id.trim()) continue;
    const workers = typeof item?.workers === "number" ? item.workers : 0;
    const queued = typeof item?.queued === "number" ? item.queued : 0;
    models.push({
      name: id,
      size_mb: 0,
      parameter_size: workers > 0 ? `${workers} worker${workers === 1 ? "" : "s"}` : "",
      quantization_level: "",
      family: id.includes("/") ? id.split("/")[0] : "",
      is_embedding: isEmbeddingName(id),
      workers,
      queued,
    });
  }
  return models;
}

function buildProbeResponse(opts: {
  providerId?: string | null;
  reachable: boolean;
  protocol: "ollama_native" | "openai_compat" | null;
  models: ProviderModelInfo[];
  errorCode: ProbeErrorCode | null;
  error: string | null;
  configVersion?: number;
}): ProviderProbeResponse {
  return {
    provider_id: opts.providerId ?? null,
    reachable: opts.reachable,
    protocol: opts.protocol,
    models: opts.models,
    chat_models: opts.models.filter((m) => !m.is_embedding).map((m) => m.name),
    embedding_models: opts.models.filter((m) => m.is_embedding).map((m) => m.name),
    error_code: opts.errorCode,
    error: opts.error,
    config_version: opts.configVersion ?? 0,
    probed_at: new Date().toISOString(),
    from_cache: false,
  };
}

function classifyFetchError(
  err: unknown,
  rootUrl: string
): { code: ProbeErrorCode; message: string } {
  if (err && typeof err === "object" && (err as { name?: string }).name === "AbortError") {
    return { code: "timeout", message: `Timed out reaching ${rootUrl}.` };
  }
  if (err instanceof TypeError) {
    return {
      code: "cors_or_network_error",
      message: `Browser blocked or could not reach ${rootUrl}. Check network connectivity, HTTPS/Mixed Content, and CORS configuration.`,
    };
  }
  return {
    code: "unknown",
    message: err instanceof Error ? err.message : `Could not reach ${rootUrl}.`,
  };
}

export async function probeRemoteProvider(opts: {
  type: "ollama" | "openrouter" | "aihorde";
  baseUrl?: string | null;
  token?: string | null;
  requireToken?: boolean;
  providerId?: string | null;
  configVersion?: number;
  signal?: AbortSignal;
}): Promise<ProviderProbeResponse> {
  let root: string;
  try {
    root = normalizeRemoteBaseUrl(opts.type, opts.baseUrl);
  } catch (err) {
    const code = err instanceof RemoteDriverError ? err.code : "invalid_url";
    const message = err instanceof Error ? err.message : "Invalid server URL.";
    return buildProbeResponse({
      providerId: opts.providerId,
      reachable: false,
      protocol: null,
      models: [],
      errorCode: code === "blocked_by_policy" ? "blocked_by_policy" : "invalid_url",
      error: message,
      configVersion: opts.configVersion,
    });
  }
  const cleanToken = (opts.token ?? "").trim();

  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => timeoutCtrl.abort(), 5000);
  const combinedSignal =
    opts.signal && typeof (AbortSignal as any).any === "function"
      ? (AbortSignal as any).any([opts.signal, timeoutCtrl.signal])
      : timeoutCtrl.signal;

  try {
    if (opts.type === "openrouter") {
      if (!cleanToken) {
        return buildProbeResponse({
          providerId: opts.providerId,
          reachable: false,
          protocol: null,
          models: [],
          errorCode: "browser_credential_missing",
          error: "OpenRouter API key is missing in this browser.",
          configVersion: opts.configVersion,
        });
      }
      const authResp = await fetch(`${root}/auth/key`, {
        method: "GET",
        headers: bearerHeaders(cleanToken),
        signal: combinedSignal,
      });
      if (authResp.status === 401) {
        return buildProbeResponse({
          providerId: opts.providerId,
          reachable: false,
          protocol: null,
          models: [],
          errorCode: "unauthorized",
          error: "Invalid OpenRouter API key.",
          configVersion: opts.configVersion,
        });
      }
      if (authResp.status === 403) {
        return buildProbeResponse({
          providerId: opts.providerId,
          reachable: false,
          protocol: null,
          models: [],
          errorCode: "forbidden",
          error: "OpenRouter API key forbidden or restricted.",
          configVersion: opts.configVersion,
        });
      }
      if (!authResp.ok) {
        return buildProbeResponse({
          providerId: opts.providerId,
          reachable: false,
          protocol: null,
          models: [],
          errorCode: "unknown",
          error: `HTTP ${authResp.status}`,
          configVersion: opts.configVersion,
        });
      }
      let models: ProviderModelInfo[] = [];
      try {
        const modelsResp = await fetch(`${root}/models`, {
          method: "GET",
          signal: combinedSignal,
        });
        if (modelsResp.ok) {
          models = parseOpenRouterModels(await modelsResp.json());
        }
      } catch {
        // Key check succeeded; model list fallback handled by server catalog if available.
      }
      return buildProbeResponse({
        providerId: opts.providerId,
        reachable: true,
        protocol: "openai_compat",
        models,
        errorCode: null,
        error: null,
        configVersion: opts.configVersion,
      });
    }

    if (opts.type === "aihorde") {
      if (opts.requireToken && !cleanToken) {
        return buildProbeResponse({
          providerId: opts.providerId,
          reachable: false,
          protocol: null,
          models: [],
          errorCode: "browser_credential_missing",
          error: "AI Horde API key is missing in this browser.",
          configVersion: opts.configVersion,
        });
      }
      const effectiveToken = cleanToken || "0000000000";
      const resp = await fetch(`${root}/models`, {
        method: "GET",
        headers: bearerHeaders(effectiveToken),
        signal: combinedSignal,
      });
      if (resp.ok) {
        try {
          const models = parseAiHordeModels(await resp.json());
          return buildProbeResponse({
            providerId: opts.providerId,
            reachable: true,
            protocol: "openai_compat",
            models,
            errorCode: null,
            error: null,
            configVersion: opts.configVersion,
          });
        } catch {
          return buildProbeResponse({
            providerId: opts.providerId,
            reachable: false,
            protocol: null,
            models: [],
            errorCode: "bad_payload",
            error: "AI Horde returned a non-JSON model list.",
            configVersion: opts.configVersion,
          });
        }
      }
      if (resp.status === 401) {
        return buildProbeResponse({
          providerId: opts.providerId,
          reachable: false,
          protocol: null,
          models: [],
          errorCode: "unauthorized",
          error: "Invalid AI Horde API key.",
          configVersion: opts.configVersion,
        });
      }
      if (resp.status === 403) {
        return buildProbeResponse({
          providerId: opts.providerId,
          reachable: false,
          protocol: null,
          models: [],
          errorCode: "forbidden",
          error: "AI Horde access forbidden.",
          configVersion: opts.configVersion,
        });
      }
      return buildProbeResponse({
        providerId: opts.providerId,
        reachable: false,
        protocol: null,
        models: [],
        errorCode: resp.status === 502 ? "connect_refused" : "unknown",
        error: `HTTP ${resp.status}`,
        configVersion: opts.configVersion,
      });
    }

    // Remote Ollama (native /api/tags, then /v1/models)
    const headers = bearerHeaders(cleanToken);
    const resp = await fetch(`${root}/api/tags`, {
      method: "GET",
      headers,
      signal: combinedSignal,
    });
    if (resp.ok) {
      return buildProbeResponse({
        providerId: opts.providerId,
        reachable: true,
        protocol: "ollama_native",
        models: parseOllamaTags(await resp.json()),
        errorCode: null,
        error: null,
        configVersion: opts.configVersion,
      });
    }
    if (resp.status === 401 || resp.status === 403) {
      return buildProbeResponse({
        providerId: opts.providerId,
        reachable: false,
        protocol: null,
        models: [],
        errorCode: resp.status === 401 ? "unauthorized" : "forbidden",
        error: `HTTP ${resp.status}`,
        configVersion: opts.configVersion,
      });
    }
    if (resp.status === 404) {
      const oaiResp = await fetch(`${root}/v1/models`, {
        method: "GET",
        headers,
        signal: combinedSignal,
      });
      if (oaiResp.ok) {
        return buildProbeResponse({
          providerId: opts.providerId,
          reachable: true,
          protocol: "openai_compat",
          models: parseOpenAiModels(await oaiResp.json()),
          errorCode: null,
          error: null,
          configVersion: opts.configVersion,
        });
      }
      if (oaiResp.status === 401 || oaiResp.status === 403) {
        return buildProbeResponse({
          providerId: opts.providerId,
          reachable: false,
          protocol: null,
          models: [],
          errorCode: oaiResp.status === 401 ? "unauthorized" : "forbidden",
          error: `HTTP ${oaiResp.status}`,
          configVersion: opts.configVersion,
        });
      }
      return buildProbeResponse({
        providerId: opts.providerId,
        reachable: false,
        protocol: null,
        models: [],
        errorCode: "not_found",
        error: "Neither /api/tags nor /v1/models was found.",
        configVersion: opts.configVersion,
      });
    }
    return buildProbeResponse({
      providerId: opts.providerId,
      reachable: false,
      protocol: null,
      models: [],
      errorCode: "unknown",
      error: `HTTP ${resp.status}`,
      configVersion: opts.configVersion,
    });
  } catch (err) {
    const classified = classifyFetchError(err, root);
    return buildProbeResponse({
      providerId: opts.providerId,
      reachable: false,
      protocol: null,
      models: [],
      errorCode: classified.code,
      error: classified.message,
      configVersion: opts.configVersion,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readSseStream(
  resp: Response,
  onChunk: (delta: string) => void
): Promise<RelayDriverResult> {
  if (!resp.body) {
    throw new RemoteDriverError("inference_failed", "Streaming response had no body.");
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullContent = "";

  const processLine = (rawLine: string) => {
    const line = rawLine.trim();
    if (!line || !line.startsWith("data:")) return;
    const dataStr = line.slice("data:".length).trim();
    if (dataStr === "[DONE]") return;
    try {
      const chunk = JSON.parse(dataStr);
      const delta = chunk?.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta.length > 0) {
        fullContent += delta;
        onChunk(delta);
      }
    } catch {
      // ignore partial JSON chunks
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl = buffer.indexOf("\n");
    while (nl !== -1) {
      processLine(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      nl = buffer.indexOf("\n");
    }
  }
  if (buffer.trim()) processLine(buffer);
  return { content: fullContent, done_reason: null };
}

async function readOllamaNdjsonStream(
  resp: Response,
  onChunk: (delta: string) => void
): Promise<RelayDriverResult> {
  if (!resp.body) {
    throw new RemoteDriverError("inference_failed", "Ollama streaming response had no body.");
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
    let nl = buffer.indexOf("\n");
    while (nl !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) {
        try {
          const chunk = JSON.parse(line);
          const delta = chunk?.message?.content;
          if (typeof delta === "string" && delta.length > 0) {
            fullContent += delta;
            onChunk(delta);
          }
          if (chunk?.done) {
            return { content: fullContent, done_reason: chunk?.done_reason || null };
          }
        } catch {
          // ignore partial NDJSON line
        }
      }
      nl = buffer.indexOf("\n");
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
      // ignore trailing bytes
    }
  }
  return { content: fullContent, done_reason: doneReason };
}

async function getAiHordeFallbackModel(
  rootUrl: string,
  headers: Record<string, string>,
  excludeModel: string,
  signal?: AbortSignal
): Promise<string | null> {
  try {
    const resp = await fetch(`${rootUrl}/models`, { method: "GET", headers, signal });
    if (resp.ok) {
      const models = parseAiHordeModels(await resp.json());
      const alt = models.find((m) => m.name !== excludeModel);
      return alt ? alt.name : null;
    }
  } catch {
    // ignore fallback fetch errors
  }
  return null;
}

export async function runRemoteProviderChat(
  req: RelayLlmRequest,
  token: string | null,
  onChunk: (delta: string) => void,
  signal?: AbortSignal
): Promise<RelayDriverResult> {
  const driver = req.driver as "ollama" | "openrouter" | "aihorde";
  const root = normalizeRemoteBaseUrl(driver, req.base_url);
  const cleanToken = (token ?? "").trim();

  if ((driver === "openrouter" || driver === "aihorde") && !cleanToken) {
    throw new RemoteDriverError(
      "browser_credential_missing",
      `No ${driver === "openrouter" ? "OpenRouter" : "AI Horde"} credential is stored in this browser.`
    );
  }

  try {
    // Remote Ollama: try native /api/chat first, falling back to /v1/chat/completions.
    if (driver === "ollama") {
      const authHeaders = bearerHeaders(cleanToken);
      const nativeUrl = `${root}/api/chat`;
      const opts: Record<string, unknown> = {
        temperature: req.options.temperature,
        num_predict: req.options.max_tokens,
      };
      if (req.options.context_size != null) {
        opts.num_ctx = req.options.context_size;
      }
      const nativePayload: Record<string, unknown> = {
        model: req.model,
        messages: req.messages,
        stream: req.mode === "stream",
        think: false,
        keep_alive: req.options.keep_alive ?? "30m",
        options: opts,
      };
      if (req.options.json_schema) {
        nativePayload.format = req.options.json_schema;
      } else if (req.options.json_mode) {
        nativePayload.format = "json";
      }
      const postNative = (payload: Record<string, unknown>) =>
        fetch(nativeUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify(payload),
          signal,
        });

      let nativeResp = await postNative(nativePayload);
      if (nativeResp.status === 400) {
        const retryPayload = { ...nativePayload };
        delete retryPayload.think;
        if (req.mode === "complete") {
          retryPayload.options = {
            ...opts,
            num_predict: Math.max(req.options.max_tokens * 3, 4096),
          };
        }
        nativeResp = await postNative(retryPayload);
      }

      if (nativeResp.status === 401 || nativeResp.status === 403) {
        throw new RemoteDriverError(
          nativeResp.status === 401 ? "unauthorized" : "forbidden",
          `Ollama rejected credentials (HTTP ${nativeResp.status}).`
        );
      }

      if (nativeResp.ok) {
        if (req.mode === "stream") {
          return await readOllamaNdjsonStream(nativeResp, onChunk);
        }
        const data = await nativeResp.json();
        const msg = data?.message || {};
        const content = String(msg.content || "").trim();
        const thinking = String(msg.thinking || "").trim();
        if (content) {
          return { content, thinking, done_reason: data?.done_reason || null };
        }
        if (req.options.json_schema || data?.done_reason === "length") {
          const fallbackPayload: Record<string, unknown> = {
            ...nativePayload,
            options: { ...opts, num_predict: Math.max(req.options.max_tokens * 3, 4096) },
          };
          if (req.options.json_schema) fallbackPayload.format = "json";
          const retryResp = await postNative(fallbackPayload);
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
          }
        }
        return { content, thinking, done_reason: data?.done_reason || null };
      }

      if (nativeResp.status === 404) {
        const errText = await nativeResp.text();
        if (errText.toLowerCase().includes("model") && errText.toLowerCase().includes("not found")) {
          throw new RemoteDriverError(
            "model_not_found",
            `Ollama model '${req.model}' is not installed on ${root}.`
          );
        }
      }
      // Otherwise fall through to OpenAI-compatible /v1/chat/completions.
    }

    const v1Url =
      driver === "openrouter" || driver === "aihorde"
        ? `${root}/chat/completions`
        : `${root}/v1/chat/completions`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...bearerHeaders(cleanToken || (driver === "ollama" ? "ollama" : "")),
    };
    const maxTokens =
      driver === "aihorde" ? Math.max(req.options.max_tokens, 16) : req.options.max_tokens;
    const basePayload: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
      temperature: req.options.temperature,
      max_tokens: maxTokens,
      stream: req.mode === "stream",
    };
    if (req.mode === "complete" && (req.options.json_mode || req.options.json_schema)) {
      basePayload.response_format = { type: "json_object" };
    }
    if (driver === "openrouter" && req.options.disable_reasoning) {
      basePayload.reasoning = { effort: "none" };
    } else if (driver === "aihorde" && req.options.disable_reasoning) {
      basePayload.reasoning_effort = "none";
    }

    const postOai = (payload: Record<string, unknown>) =>
      fetch(v1Url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal,
      });

    let activePayload = { ...basePayload };
    let resp = await postOai(activePayload);

    if (resp.status === 400) {
      const errText = (await resp.text().catch(() => "")).toLowerCase();
      if (driver === "openrouter" && activePayload.reasoning && errText.includes("reasoning")) {
        activePayload = { ...activePayload, reasoning: { exclude: true } };
        resp = await postOai(activePayload);
        if (resp.status === 400) {
          const retry2 = { ...activePayload };
          delete retry2.reasoning;
          resp = await postOai(retry2);
        }
      } else if (driver === "aihorde" && "reasoning_effort" in activePayload) {
        const retryPayload = { ...activePayload };
        delete retryPayload.reasoning_effort;
        resp = await postOai(retryPayload);
      }
    }

    if (driver === "aihorde" && (resp.status === 404 || resp.status === 403)) {
      const errText = (await resp.text().catch(() => "")).toLowerCase();
      if (
        errText.includes("unknownchatmodel") ||
        errText.includes("noeligibleworker") ||
        errText.includes("model")
      ) {
        const fallback = await getAiHordeFallbackModel(root, headers, req.model, signal);
        if (fallback) {
          resp = await postOai({ ...activePayload, model: fallback });
        }
      }
    }

    if (resp.status === 401 || resp.status === 403) {
      throw new RemoteDriverError(
        resp.status === 401 ? "unauthorized" : "forbidden",
        `Provider rejected credentials (HTTP ${resp.status}).`
      );
    }
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new RemoteDriverError(
        "inference_failed",
        `Provider error (HTTP ${resp.status}): ${errText || resp.statusText}`
      );
    }

    if (req.mode === "stream") {
      return await readSseStream(resp, onChunk);
    }

    const data = await resp.json();
    const choiceMsg = data?.choices?.[0]?.message ?? {};
    const content = String(
      choiceMsg.content || choiceMsg.reasoning_content || choiceMsg.reasoning || ""
    );
    return { content, done_reason: data?.choices?.[0]?.finish_reason || null };
  } catch (err) {
    if (err instanceof RemoteDriverError) throw err;
    if (err instanceof TypeError) {
      throw new RemoteDriverError(
        "cors_or_network_error",
        `Browser blocked or could not reach ${root}. Check network connectivity, HTTPS/Mixed Content, and CORS.`
      );
    }
    throw err;
  }
}
