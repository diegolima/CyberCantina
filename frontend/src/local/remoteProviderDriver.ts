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
  code: ProbeErrorCode | "inference_failed" | "model_not_found" | "tools_unsupported";
  constructor(
    code: ProbeErrorCode | "inference_failed" | "model_not_found" | "tools_unsupported",
    message: string
  ) {
    super(message);
    this.name = "RemoteDriverError";
    this.code = code;
  }
}

function isToolsUnsupportedErrorText(errLower: string): boolean {
  return (
    errLower.includes("does not support tools") ||
    errLower.includes("support tool") ||
    errLower.includes("tools is not supported") ||
    errLower.includes("tools are not supported") ||
    errLower.includes("tool calling is not supported") ||
    errLower.includes("does not support function") ||
    errLower.includes("tool_choice")
  );
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

export type OpenAiCompatDriverType = "openai_compat" | "openrouter" | "aihorde" | "nanogpt";
export type RemoteProviderDriverType = "ollama" | OpenAiCompatDriverType;

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
  const seen = new Set<string>();
  const models: ProviderModelInfo[] = [];
  for (const m of raw) {
    const name = typeof m?.id === "string" ? m.id.trim() : "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    models.push({
      name,
      size_mb: 0,
      parameter_size: "",
      quantization_level: "",
      family: name.includes("/") ? name.split("/")[0] : "",
      is_embedding: isEmbeddingName(name),
    });
  }
  return models;
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

function parseNanoGptModels(chatPayload: any, embedPayload?: any): ProviderModelInfo[] {
  const seen = new Set<string>();
  const models: ProviderModelInfo[] = [];
  const chatRaw = Array.isArray(chatPayload?.data) ? chatPayload.data : [];
  for (const item of chatRaw) {
    const id = typeof item?.id === "string" ? item.id.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push({
      name: id,
      size_mb: 0,
      parameter_size: "",
      quantization_level: "",
      family: id.includes("/") ? id.split("/")[0] : "",
      is_embedding: isEmbeddingName(id),
    });
  }
  const embedRaw = Array.isArray(embedPayload?.data) ? embedPayload.data : [];
  for (const item of embedRaw) {
    const id = typeof item?.id === "string" ? item.id.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push({
      name: id,
      size_mb: 0,
      parameter_size: "",
      quantization_level: "",
      family: id.includes("/") ? id.split("/")[0] : "",
      is_embedding: true,
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

interface ProbeContext {
  root: string;
  cleanToken: string;
  requireToken?: boolean;
  providerId?: string | null;
  configVersion?: number;
  signal: AbortSignal;
}

/**
 * Base adapter for any OpenAI-compatible HTTP API (/models, /chat/completions).
 * Provider-specific adapters (OpenRouter, NanoGPT, AI Horde) extend this class.
 */
class OpenAiCompatAdapter {
  readonly type: OpenAiCompatDriverType = "openai_compat";
  readonly label: string = "OpenAI API";
  readonly defaultBaseUrl: string | null = null;
  readonly requireHttps: boolean = false;
  readonly requiresBrowserChatToken: boolean = false;
  readonly minMaxTokens: number | null = null;

  normalizePath(path: string): string {
    return path || "/v1";
  }

  parseModels(payload: any): ProviderModelInfo[] {
    return parseOpenAiModels(payload);
  }

  protected mapProbeHttpError(
    status: number,
    ctx: ProbeContext
  ): ProviderProbeResponse {
    if (status === 401) {
      return buildProbeResponse({
        providerId: ctx.providerId,
        reachable: false,
        protocol: null,
        models: [],
        errorCode: "unauthorized",
        error: `Invalid ${this.label} API key.`,
        configVersion: ctx.configVersion,
      });
    }
    if (status === 403) {
      return buildProbeResponse({
        providerId: ctx.providerId,
        reachable: false,
        protocol: null,
        models: [],
        errorCode: "forbidden",
        error: `${this.label} access forbidden.`,
        configVersion: ctx.configVersion,
      });
    }
    if (status === 404) {
      return buildProbeResponse({
        providerId: ctx.providerId,
        reachable: false,
        protocol: null,
        models: [],
        errorCode: "not_found",
        error: `${this.label} /models endpoint was not found.`,
        configVersion: ctx.configVersion,
      });
    }
    return buildProbeResponse({
      providerId: ctx.providerId,
      reachable: false,
      protocol: null,
      models: [],
      errorCode: status === 502 ? "connect_refused" : "unknown",
      error: `HTTP ${status}`,
      configVersion: ctx.configVersion,
    });
  }

  async probe(ctx: ProbeContext): Promise<ProviderProbeResponse> {
    const resp = await fetch(`${ctx.root}/models`, {
      method: "GET",
      headers: bearerHeaders(ctx.cleanToken),
      signal: ctx.signal,
    });
    if (resp.ok) {
      let payload: any;
      try {
        payload = await resp.json();
      } catch {
        return buildProbeResponse({
          providerId: ctx.providerId,
          reachable: false,
          protocol: null,
          models: [],
          errorCode: "bad_payload",
          error: `${this.label} returned a non-JSON model list.`,
          configVersion: ctx.configVersion,
        });
      }
      if (!payload || !Array.isArray(payload.data)) {
        return buildProbeResponse({
          providerId: ctx.providerId,
          reachable: false,
          protocol: null,
          models: [],
          errorCode: "bad_payload",
          error: `${this.label} returned an unexpected model list.`,
          configVersion: ctx.configVersion,
        });
      }
      return buildProbeResponse({
        providerId: ctx.providerId,
        reachable: true,
        protocol: "openai_compat",
        models: this.parseModels(payload),
        errorCode: null,
        error: null,
        configVersion: ctx.configVersion,
      });
    }
    return this.mapProbeHttpError(resp.status, ctx);
  }

  buildChatPayload(req: RelayLlmRequest): Record<string, unknown> {
    const maxTokens = this.minMaxTokens
      ? Math.max(req.options.max_tokens, this.minMaxTokens)
      : req.options.max_tokens;
    const payload: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
      temperature: req.options.temperature,
      max_tokens: maxTokens,
      stream: req.mode === "stream",
    };
    if (req.mode === "complete" && req.options.tools && req.options.tools.length > 0) {
      payload.tools = req.options.tools;
      payload.tool_choice = "auto";
    } else if (req.mode === "complete" && (req.options.json_mode || req.options.json_schema)) {
      payload.response_format = { type: "json_object" };
    }
    if (req.options.disable_reasoning) {
      this.applyDisableReasoning(payload);
    }
    return payload;
  }

  applyDisableReasoning(_payload: Record<string, unknown>): void {
    // Generic OpenAI-compatible APIs do not accept non-standard reasoning params.
  }

  async retryBadRequest(
    _activePayload: Record<string, unknown>,
    _errTextLower: string,
    _postOai: (payload: Record<string, unknown>) => Promise<Response>
  ): Promise<{ resp: Response; payload: Record<string, unknown> } | null> {
    return null;
  }

  async resolveModelFallback(
    _root: string,
    _headers: Record<string, string>,
    _model: string,
    _status: number,
    _errTextLower: string,
    _signal?: AbortSignal
  ): Promise<string | null> {
    return null;
  }
}

class ReasoningObjectOpenAiAdapter extends OpenAiCompatAdapter {
  override readonly requireHttps: boolean = true;
  override readonly requiresBrowserChatToken: boolean = true;

  override normalizePath(path: string): string {
    return path || "/api/v1";
  }

  override applyDisableReasoning(payload: Record<string, unknown>): void {
    payload.reasoning = { effort: "none" };
  }

  override async retryBadRequest(
    activePayload: Record<string, unknown>,
    errTextLower: string,
    postOai: (payload: Record<string, unknown>) => Promise<Response>
  ): Promise<{ resp: Response; payload: Record<string, unknown> } | null> {
    if (!activePayload.reasoning || !errTextLower.includes("reasoning")) {
      return null;
    }
    const retry1: Record<string, unknown> = { ...activePayload, reasoning: { exclude: true } };
    let resp = await postOai(retry1);
    if (resp.status === 400) {
      const retry2: Record<string, unknown> = { ...retry1 };
      delete retry2.reasoning;
      resp = await postOai(retry2);
      return { resp, payload: retry2 };
    }
    return { resp, payload: retry1 };
  }
}

class OpenRouterAdapter extends ReasoningObjectOpenAiAdapter {
  override readonly type: OpenAiCompatDriverType = "openrouter";
  override readonly label: string = "OpenRouter";
  override readonly defaultBaseUrl: string = "https://openrouter.ai/api/v1";

  override async probe(ctx: ProbeContext): Promise<ProviderProbeResponse> {
    if (!ctx.cleanToken) {
      return buildProbeResponse({
        providerId: ctx.providerId,
        reachable: false,
        protocol: null,
        models: [],
        errorCode: "browser_credential_missing",
        error: "OpenRouter API key is missing in this browser.",
        configVersion: ctx.configVersion,
      });
    }
    const authResp = await fetch(`${ctx.root}/auth/key`, {
      method: "GET",
      headers: bearerHeaders(ctx.cleanToken),
      signal: ctx.signal,
    });
    if (authResp.status === 401) {
      return buildProbeResponse({
        providerId: ctx.providerId,
        reachable: false,
        protocol: null,
        models: [],
        errorCode: "unauthorized",
        error: "Invalid OpenRouter API key.",
        configVersion: ctx.configVersion,
      });
    }
    if (authResp.status === 403) {
      return buildProbeResponse({
        providerId: ctx.providerId,
        reachable: false,
        protocol: null,
        models: [],
        errorCode: "forbidden",
        error: "OpenRouter API key forbidden or restricted.",
        configVersion: ctx.configVersion,
      });
    }
    if (!authResp.ok) {
      return buildProbeResponse({
        providerId: ctx.providerId,
        reachable: false,
        protocol: null,
        models: [],
        errorCode: "unknown",
        error: `HTTP ${authResp.status}`,
        configVersion: ctx.configVersion,
      });
    }
    let models: ProviderModelInfo[] = [];
    try {
      const modelsResp = await fetch(`${ctx.root}/models`, {
        method: "GET",
        signal: ctx.signal,
      });
      if (modelsResp.ok) {
        models = parseOpenRouterModels(await modelsResp.json());
      }
    } catch {
      // Key check succeeded; model list fallback handled by server catalog if available.
    }
    return buildProbeResponse({
      providerId: ctx.providerId,
      reachable: true,
      protocol: "openai_compat",
      models,
      errorCode: null,
      error: null,
      configVersion: ctx.configVersion,
    });
  }
}

class NanoGptAdapter extends ReasoningObjectOpenAiAdapter {
  override readonly type: OpenAiCompatDriverType = "nanogpt";
  override readonly label: string = "NanoGPT";
  override readonly defaultBaseUrl: string = "https://nano-gpt.com/api/v1";

  override async probe(ctx: ProbeContext): Promise<ProviderProbeResponse> {
    // Reachability-only probe: /models is public and does not verify the API key.
    const headers = bearerHeaders(ctx.cleanToken);
    const resp = await fetch(`${ctx.root}/models`, {
      method: "GET",
      headers,
      signal: ctx.signal,
    });
    if (resp.ok) {
      let chatPayload: any;
      try {
        chatPayload = await resp.json();
      } catch {
        return buildProbeResponse({
          providerId: ctx.providerId,
          reachable: false,
          protocol: null,
          models: [],
          errorCode: "bad_payload",
          error: "NanoGPT returned a non-JSON model list.",
          configVersion: ctx.configVersion,
        });
      }
      if (!chatPayload || !Array.isArray(chatPayload.data)) {
        return buildProbeResponse({
          providerId: ctx.providerId,
          reachable: false,
          protocol: null,
          models: [],
          errorCode: "bad_payload",
          error: "NanoGPT returned an unexpected model list.",
          configVersion: ctx.configVersion,
        });
      }
      let embedPayload: any = null;
      try {
        const embedResp = await fetch(`${ctx.root}/embedding-models`, {
          method: "GET",
          headers,
          signal: ctx.signal,
        });
        if (embedResp.ok) {
          embedPayload = await embedResp.json();
        }
      } catch {
        // Embedding catalog is supplemental to chat model discovery.
      }
      return buildProbeResponse({
        providerId: ctx.providerId,
        reachable: true,
        protocol: "openai_compat",
        models: parseNanoGptModels(chatPayload, embedPayload),
        errorCode: null,
        error: null,
        configVersion: ctx.configVersion,
      });
    }
    return this.mapProbeHttpError(resp.status, ctx);
  }
}

class AiHordeAdapter extends OpenAiCompatAdapter {
  override readonly type: OpenAiCompatDriverType = "aihorde";
  override readonly label: string = "AI Horde";
  override readonly defaultBaseUrl: string = "https://oai.stablehorde.net/v1";
  override readonly requireHttps: boolean = true;
  override readonly requiresBrowserChatToken: boolean = true;
  override readonly minMaxTokens: number = 16;

  override normalizePath(path: string): string {
    if (!path || !path.endsWith("/v1")) {
      return path ? `${path}/v1` : "/v1";
    }
    return path;
  }

  override parseModels(payload: any): ProviderModelInfo[] {
    return parseAiHordeModels(payload);
  }

  override async probe(ctx: ProbeContext): Promise<ProviderProbeResponse> {
    if (ctx.requireToken && !ctx.cleanToken) {
      return buildProbeResponse({
        providerId: ctx.providerId,
        reachable: false,
        protocol: null,
        models: [],
        errorCode: "browser_credential_missing",
        error: "AI Horde API key is missing in this browser.",
        configVersion: ctx.configVersion,
      });
    }
    const effectiveToken = ctx.cleanToken || "0000000000";
    const resp = await fetch(`${ctx.root}/models`, {
      method: "GET",
      headers: bearerHeaders(effectiveToken),
      signal: ctx.signal,
    });
    if (resp.ok) {
      try {
        const models = this.parseModels(await resp.json());
        return buildProbeResponse({
          providerId: ctx.providerId,
          reachable: true,
          protocol: "openai_compat",
          models,
          errorCode: null,
          error: null,
          configVersion: ctx.configVersion,
        });
      } catch {
        return buildProbeResponse({
          providerId: ctx.providerId,
          reachable: false,
          protocol: null,
          models: [],
          errorCode: "bad_payload",
          error: "AI Horde returned a non-JSON model list.",
          configVersion: ctx.configVersion,
        });
      }
    }
    return this.mapProbeHttpError(resp.status, ctx);
  }

  override applyDisableReasoning(payload: Record<string, unknown>): void {
    payload.reasoning_effort = "none";
  }

  override async retryBadRequest(
    activePayload: Record<string, unknown>,
    _errTextLower: string,
    postOai: (payload: Record<string, unknown>) => Promise<Response>
  ): Promise<{ resp: Response; payload: Record<string, unknown> } | null> {
    if (!("reasoning_effort" in activePayload)) {
      return null;
    }
    const retryPayload = { ...activePayload };
    delete retryPayload.reasoning_effort;
    const resp = await postOai(retryPayload);
    return { resp, payload: retryPayload };
  }

  override async resolveModelFallback(
    root: string,
    headers: Record<string, string>,
    model: string,
    status: number,
    errTextLower: string,
    signal?: AbortSignal
  ): Promise<string | null> {
    if (status !== 404 && status !== 403) return null;
    if (
      !errTextLower.includes("unknownchatmodel") &&
      !errTextLower.includes("noeligibleworker") &&
      !errTextLower.includes("model")
    ) {
      return null;
    }
    try {
      const resp = await fetch(`${root}/models`, { method: "GET", headers, signal });
      if (resp.ok) {
        const models = this.parseModels(await resp.json());
        const alt = models.find((m) => m.name !== model);
        return alt ? alt.name : null;
      }
    } catch {
      // ignore fallback fetch errors
    }
    return null;
  }
}

const DEFAULT_OPENAI_COMPAT_ADAPTER = new OpenAiCompatAdapter();

const OPENAI_COMPAT_ADAPTERS: Record<OpenAiCompatDriverType, OpenAiCompatAdapter> = {
  openai_compat: DEFAULT_OPENAI_COMPAT_ADAPTER,
  openrouter: new OpenRouterAdapter(),
  nanogpt: new NanoGptAdapter(),
  aihorde: new AiHordeAdapter(),
};

function getOpenAiCompatAdapter(
  type: ProviderType | RemoteProviderDriverType
): OpenAiCompatAdapter | null {
  return (OPENAI_COMPAT_ADAPTERS as Record<string, OpenAiCompatAdapter | undefined>)[type] ?? null;
}

export function normalizeRemoteBaseUrl(
  type: ProviderType | RemoteProviderDriverType,
  rawUrl?: string | null
): string {
  const adapter = getOpenAiCompatAdapter(type);
  const trimmed = (rawUrl ?? "").trim();
  if (!trimmed) {
    if (adapter?.defaultBaseUrl) {
      return adapter.defaultBaseUrl;
    }
    throw new RemoteDriverError("invalid_url", "Server URL is required.");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new RemoteDriverError("invalid_url", "Server URL is not a valid URL.");
  }

  if (adapter?.requireHttps) {
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
    if (
      !Number.isInteger(portNum) ||
      portNum < 1 ||
      portNum > 65535 ||
      String(portNum) !== parsed.port
    ) {
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
  if (adapter) {
    path = adapter.normalizePath(path);
  } else {
    if (path.endsWith("/v1")) {
      path = path.slice(0, -3).replace(/\/+$/, "");
    } else if (path.endsWith("/api")) {
      path = path.slice(0, -4).replace(/\/+$/, "");
    }
  }

  return `${protocol}//${host}${portSuffix}${path}`;
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
  type: RemoteProviderDriverType;
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
    const adapter = getOpenAiCompatAdapter(opts.type);
    if (adapter) {
      return await adapter.probe({
        root,
        cleanToken,
        requireToken: opts.requireToken,
        providerId: opts.providerId,
        configVersion: opts.configVersion,
        signal: combinedSignal,
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
  let promptTokens: number | null = null;
  let completionTokens: number | null = null;
  let finishReason: string | null = null;

  const processLine = (rawLine: string) => {
    const line = rawLine.trim();
    if (!line || !line.startsWith("data:")) return;
    const dataStr = line.slice("data:".length).trim();
    if (dataStr === "[DONE]") return;
    try {
      const chunk = JSON.parse(dataStr);
      const usage = chunk?.usage;
      if (usage && typeof usage === "object") {
        if (typeof usage.prompt_tokens === "number") promptTokens = usage.prompt_tokens;
        if (typeof usage.completion_tokens === "number") completionTokens = usage.completion_tokens;
      }
      const fr = chunk?.choices?.[0]?.finish_reason;
      if (typeof fr === "string" && fr) {
        finishReason = fr;
      }
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
  return {
    content: fullContent,
    done_reason: finishReason,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
  };
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
            return {
              content: fullContent,
              done_reason: chunk?.done_reason || null,
              prompt_tokens: typeof chunk?.prompt_eval_count === "number" ? chunk.prompt_eval_count : null,
              completion_tokens: typeof chunk?.eval_count === "number" ? chunk.eval_count : null,
            };
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

export async function runRemoteProviderChat(
  req: RelayLlmRequest,
  token: string | null,
  onChunk: (delta: string) => void,
  signal?: AbortSignal
): Promise<RelayDriverResult> {
  const driver = req.driver as RemoteProviderDriverType;
  const adapter = getOpenAiCompatAdapter(driver);
  const root = normalizeRemoteBaseUrl(driver, req.base_url);
  const cleanToken = (token ?? "").trim();

  if (adapter?.requiresBrowserChatToken && !cleanToken) {
    throw new RemoteDriverError(
      "browser_credential_missing",
      `No ${adapter.label} credential is stored in this browser.`
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
      if (req.options.tools && req.options.tools.length > 0 && req.mode === "complete") {
        nativePayload.tools = req.options.tools;
      } else if (req.options.json_schema) {
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
        const native400 = (await nativeResp.text().catch(() => "")).toLowerCase();
        if (isToolsUnsupportedErrorText(native400)) {
          throw new RemoteDriverError(
            "tools_unsupported",
            `Ollama model '${req.model}' does not support native tools.`
          );
        }
        const retryPayload = { ...nativePayload };
        delete retryPayload.think;
        if (req.mode === "complete") {
          retryPayload.options = {
            ...opts,
            num_predict: Math.max(req.options.max_tokens * 3, 4096),
          };
        }
        nativeResp = await postNative(retryPayload);
        if (nativeResp.status === 400) {
          const retry400 = (await nativeResp.text().catch(() => "")).toLowerCase();
          if (isToolsUnsupportedErrorText(retry400)) {
            throw new RemoteDriverError(
              "tools_unsupported",
              `Ollama model '${req.model}' does not support native tools.`
            );
          }
        }
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
        const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : undefined;
        if (content || (toolCalls && toolCalls.length > 0)) {
          return {
            content,
            thinking,
            done_reason: data?.done_reason || null,
            tool_calls: toolCalls,
          };
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

    const activeAdapter = adapter ?? DEFAULT_OPENAI_COMPAT_ADAPTER;
    const v1Url = adapter ? `${root}/chat/completions` : `${root}/v1/chat/completions`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...bearerHeaders(cleanToken || (driver === "ollama" ? "ollama" : "")),
    };
    const basePayload = activeAdapter.buildChatPayload(req);

    const postOai = (payload: Record<string, unknown>) =>
      fetch(v1Url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal,
      });

    let activePayload = { ...basePayload };
    let resp = await postOai(activePayload);
    let cachedErrText = "";

    if (resp.status === 400 || resp.status === 422) {
      cachedErrText = await resp.text().catch(() => "");
      const errLower = cachedErrText.toLowerCase();
      if (isToolsUnsupportedErrorText(errLower)) {
        throw new RemoteDriverError(
          "tools_unsupported",
          `Provider model '${req.model}' does not support native tools.`
        );
      }
      if (resp.status === 400) {
        const retried = await activeAdapter.retryBadRequest(activePayload, errLower, postOai);
        if (retried) {
          resp = retried.resp;
          activePayload = retried.payload;
          cachedErrText = "";
        }
      }
    }

    if (resp.status === 404 || resp.status === 403) {
      cachedErrText = await resp.text().catch(() => "");
      const errLower = cachedErrText.toLowerCase();
      const fallback = await activeAdapter.resolveModelFallback(
        root,
        headers,
        req.model,
        resp.status,
        errLower,
        signal
      );
      if (fallback) {
        resp = await postOai({ ...activePayload, model: fallback });
        cachedErrText = "";
      }
    }

    if (resp.status === 401 || resp.status === 403) {
      throw new RemoteDriverError(
        resp.status === 401 ? "unauthorized" : "forbidden",
        `Provider rejected credentials (HTTP ${resp.status}).`
      );
    }
    if (!resp.ok) {
      const errText = cachedErrText || (await resp.text().catch(() => ""));
      if ((resp.status === 400 || resp.status === 422) && isToolsUnsupportedErrorText(errText.toLowerCase())) {
        throw new RemoteDriverError(
          "tools_unsupported",
          `Provider model '${req.model}' does not support native tools.`
        );
      }
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
    const usage = data?.usage;
    const toolCalls = Array.isArray(choiceMsg.tool_calls) ? choiceMsg.tool_calls : undefined;
    return {
      content,
      done_reason: data?.choices?.[0]?.finish_reason || null,
      prompt_tokens: typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : null,
      completion_tokens: typeof usage?.completion_tokens === "number" ? usage.completion_tokens : null,
      tool_calls: toolCalls,
    };
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
