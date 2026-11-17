import React, { useEffect, useState } from "react";
import { AlertTriangle, Check, Copy, Loader2, Plug, Trash2 } from "lucide-react";
import { ApiError, api } from "../../api";
import {
  deleteProviderCredential,
  getProviderCredential,
  setProviderCredential,
} from "../../local/credentialVault";
import { probeBrowserOllama } from "../../local/ollamaDriver";
import {
  probeRemoteProvider,
  RemoteProviderDriverType,
} from "../../local/remoteProviderDriver";
import { checkWebGpuAdapter, getWebGpuModelInfos } from "../../local/webgpuCatalog";
import { useOptionalLocalRelay } from "../../providers/LocalRelayContext";
import {
  LLMProvider,
  ProviderColor,
  ProviderCredentialStoreMode,
  ProviderProbeResponse,
  ProviderReference,
  ProviderScope,
  ProviderType,
} from "../../types";
import { PROVIDER_COLORS, ProviderColorPill, describeProbeError } from "./ProviderBadges";
import { useProviders } from "./ProvidersContext";

type EditorProps =
  | {
      mode: "edit";
      provider: LLMProvider;
      credentialStoreMode?: ProviderCredentialStoreMode;
      deleteOnly?: boolean;
      onDone: () => void;
    }
  | {
      mode: "create";
      scope: ProviderScope;
      credentialStoreMode?: ProviderCredentialStoreMode;
      onDone: () => void;
    };

const PRESET_CLOUD_HOSTS = new Set([
  "openrouter.ai",
  "oai.stablehorde.net",
  "nano-gpt.com",
  "api.nano-gpt.com",
]);

const DEFAULT_URL_BY_TYPE: Record<ProviderType, string> = {
  ollama: "",
  openrouter: "https://openrouter.ai/api/v1",
  aihorde: "https://oai.stablehorde.net/v1",
  nanogpt: "https://nano-gpt.com/api/v1",
  browser_ollama: "http://localhost:11434",
  webgpu: "webgpu://browser",
};

const DEFAULT_NAME_BY_TYPE: Record<ProviderType, string> = {
  ollama: "",
  openrouter: "OpenRouter",
  aihorde: "AI Horde",
  nanogpt: "NanoGPT",
  browser_ollama: "Local Ollama (Browser)",
  webgpu: "Browser WebGPU",
};

const PRESET_NAMES = new Set([
  "Ollama",
  "OpenRouter",
  "AI Horde",
  "NanoGPT",
  "Local Ollama (Browser)",
  "Browser WebGPU",
]);

const PRESET_URLS = new Set([
  "https://openrouter.ai/api/v1",
  "https://oai.stablehorde.net/v1",
  "https://nano-gpt.com/api/v1",
  "https://api.nano-gpt.com/api/v1",
  "http://localhost:11434",
  "webgpu://browser",
]);

function isPresetCloudOrSentinelUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "webgpu://browser") return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" && PRESET_CLOUD_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function hostOf(raw: string): string | null {
  try {
    return new URL(raw.trim()).host.toLowerCase();
  } catch {
    return null;
  }
}

function describeReference(ref: ProviderReference): string {
  if (ref.kind === "user_override") return `${ref.user_count} user override(s) (will reset to defaults)`;
  if (ref.kind === "embedding") return "the embedding engine";
  return `the ${ref.role ?? "model"} role`;
}

/** Create / edit form for one provider. Saves and deletes commit immediately. */
export const ProviderEditor: React.FC<EditorProps> = (props) => {
  const store = useProviders();
  const relay = useOptionalLocalRelay();
  const existing = props.mode === "edit" ? props.provider : null;
  const deleteOnly = props.mode === "edit" && props.deleteOnly;
  const scope: ProviderScope = existing ? existing.scope : (props as { scope: ProviderScope }).scope;
  const credentialStoreMode: ProviderCredentialStoreMode =
    props.credentialStoreMode ?? "prefer_server";
  const initialStoreInBrowser =
    scope === "user" &&
    (credentialStoreMode === "browser_only"
      ? true
      : credentialStoreMode === "server_only"
        ? false
        : existing
          ? existing.credential_storage === "browser"
          : credentialStoreMode === "prefer_browser");

  const [providerType, setProviderType] = useState<ProviderType>(existing?.type ?? "ollama");
  const [name, setName] = useState(existing?.name ?? "");
  const [url, setUrl] = useState(existing?.base_url ?? "");
  const [token, setToken] = useState("");
  const [clearToken, setClearToken] = useState(false);
  const [storeInBrowser, setStoreInBrowser] = useState(initialStoreInBrowser);
  const [color, setColor] = useState<ProviderColor>(existing?.color ?? "neutral");
  const [enabled, setEnabled] = useState(existing?.is_enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ProviderProbeResponse | null>(null);
  const [needsCorsSetup, setNeedsCorsSetup] = useState(false);
  const [webgpuCheck, setWebgpuCheck] = useState<{ supported: boolean; reason?: string } | null>(null);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [blockers, setBlockers] = useState<ProviderReference[]>([]);

  const isWebGpu = providerType === "webgpu";
  const isBrowserOllama = providerType === "browser_ollama";
  const isBrowserLocal = isWebGpu || isBrowserOllama;
  const showBrowserTypes = true;
  const showBrowserCredentialOption = !isBrowserLocal && scope === "user";
  const browserCheckDisabled =
    deleteOnly ||
    credentialStoreMode === "server_only" ||
    credentialStoreMode === "browser_only";
  const effectiveStoreInBrowser = showBrowserCredentialOption
    ? credentialStoreMode === "browser_only"
      ? true
      : credentialStoreMode === "server_only"
        ? false
        : storeInBrowser
    : false;
  const isPausedBrowserUnderServerOnly =
    props.mode === "edit" &&
    showBrowserCredentialOption &&
    existing?.credential_storage === "browser" &&
    credentialStoreMode === "server_only";
  const vaultToken = existing
    ? getProviderCredential(relay?.currentUserId, existing.id)
    : null;
  const hasExistingBrowserToken = Boolean(
    existing?.credential_storage === "browser" && vaultToken
  );
  const hasExistingServerToken = Boolean(
    existing?.credential_storage !== "browser" && existing?.has_bearer_token
  );
  const effectiveHasSavedToken = effectiveStoreInBrowser
    ? hasExistingBrowserToken
    : hasExistingServerToken;
  const isRemoteHttpMixedContent = (() => {
    if (
      !effectiveStoreInBrowser ||
      providerType !== "ollama" ||
      typeof window === "undefined" ||
      window.location.protocol !== "https:"
    ) {
      return false;
    }
    try {
      const parsed = new URL(url.trim());
      const host = parsed.hostname.toLowerCase();
      return (
        parsed.protocol === "http:" &&
        host !== "localhost" &&
        host !== "127.0.0.1" &&
        host !== "[::1]"
      );
    } catch {
      return false;
    }
  })();

  useEffect(() => {
    if (!isWebGpu) return;
    let cancelled = false;
    void checkWebGpuAdapter().then((res) => {
      if (!cancelled) setWebgpuCheck(res);
    });
    return () => {
      cancelled = true;
    };
  }, [isWebGpu]);

  const urlMissing = providerType === "ollama" && url.trim() === "";
  const canReuseExistingOrVaultOpenRouterKey =
    props.mode === "edit" &&
    (effectiveStoreInBrowser
      ? hasExistingBrowserToken
      : existing?.credential_storage === "browser"
        ? isPausedBrowserUnderServerOnly || Boolean(vaultToken)
        : hasExistingServerToken);
  const tokenMissing =
    (providerType === "openrouter" ||
      providerType === "nanogpt" ||
      (providerType === "aihorde" && effectiveStoreInBrowser)) &&
    !token.trim() &&
    !canReuseExistingOrVaultOpenRouterKey;
  const hostChanged =
    !!existing &&
    !isBrowserLocal &&
    existing.base_url !== null &&
    hostOf(url) !== null &&
    hostOf(url) !== hostOf(existing.base_url);
  const tokenRequired =
    hostChanged && effectiveHasSavedToken && !token && !clearToken;
  const canSave = !urlMissing && !tokenMissing && !saving && !tokenRequired && (props.mode === "create" || name.trim() !== "");

  const defaultUrlFor = (ptype: ProviderType): string => DEFAULT_URL_BY_TYPE[ptype] ?? "";

  const selectProviderType = (nextType: ProviderType) => {
    setProviderType(nextType);
    setTestResult(null);
    setNeedsCorsSetup(false);
    if (!name || PRESET_NAMES.has(name)) {
      setName(DEFAULT_NAME_BY_TYPE[nextType]);
    }
    if (nextType === "webgpu") {
      setUrl(DEFAULT_URL_BY_TYPE.webgpu);
    } else if (!url || PRESET_URLS.has(url) || isPresetCloudOrSentinelUrl(url)) {
      setUrl(DEFAULT_URL_BY_TYPE[nextType]);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setNeedsCorsSetup(false);
    setError(null);
    try {
      const effectiveUrl = url.trim() || defaultUrlFor(providerType);
      if (isBrowserOllama) {
        relay?.ensureConnected();
        const localRes = await probeBrowserOllama(effectiveUrl);
        setNeedsCorsSetup(Boolean(localRes.needsCorsOrLnaSetup));
        if (existing) {
          const synced = await api.reportClientProbe(existing.id, {
            reachable: localRes.reachable,
            protocol: localRes.protocol,
            models: localRes.models,
            error_code: localRes.error_code,
            error: localRes.error,
          });
          setTestResult(synced);
        } else {
          setTestResult({
            provider_id: null,
            reachable: localRes.reachable,
            protocol: localRes.protocol,
            models: localRes.models,
            chat_models: localRes.models.filter((m) => !m.is_embedding).map((m) => m.name),
            embedding_models: localRes.models.filter((m) => m.is_embedding).map((m) => m.name),
            error_code: localRes.error_code,
            error: localRes.error,
            config_version: 0,
            probed_at: new Date().toISOString(),
            from_cache: false,
          });
        }
        return;
      }
      if (isWebGpu) {
        relay?.ensureConnected();
        const check = await checkWebGpuAdapter();
        setWebgpuCheck(check);
        const models = check.supported ? getWebGpuModelInfos() : [];
        if (existing) {
          const synced = await api.reportClientProbe(existing.id, {
            reachable: check.supported,
            protocol: check.supported ? "openai_compat" : null,
            models,
            error_code: check.supported ? null : "webgpu_unsupported",
            error: check.supported ? null : check.reason || "WebGPU is unavailable.",
          });
          setTestResult(synced);
        } else {
          setTestResult({
            provider_id: null,
            reachable: check.supported,
            protocol: check.supported ? "openai_compat" : null,
            models,
            chat_models: models.map((m) => m.name),
            embedding_models: [],
            error_code: check.supported ? null : "webgpu_unsupported",
            error: check.supported ? null : check.reason || "WebGPU is unavailable.",
            config_version: 0,
            probed_at: new Date().toISOString(),
            from_cache: false,
          });
        }
        return;
      }
      if (effectiveStoreInBrowser) {
        relay?.ensureConnected();
        const candidateToken =
          token.trim() ||
          (existing?.credential_storage === "browser" ? vaultToken : null);
        const localRes = await probeRemoteProvider({
          type: providerType as RemoteProviderDriverType,
          baseUrl: effectiveUrl,
          token: candidateToken,
          requireToken:
            providerType === "openrouter" || providerType === "aihorde",
          providerId: existing?.id ?? null,
          configVersion: existing?.version ?? 0,
        });
        if (existing && existing.credential_storage === "browser") {
          const synced = await api.reportClientProbe(existing.id, {
            reachable: localRes.reachable,
            protocol: localRes.protocol,
            models: localRes.models,
            error_code: localRes.error_code,
            error: localRes.error,
          });
          setTestResult(synced);
        } else {
          setTestResult(localRes);
        }
        return;
      }
      const result = await api.probeProviderDraft({
        provider_id: existing?.id ?? null,
        type: providerType,
        base_url: effectiveUrl,
        bearer_token: token || null,
      });
      setTestResult(result);
    } catch (err: any) {
      setError(err?.message || "Connection test failed.");
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setConflict(false);
    try {
      const effectiveUrl = url.trim() || defaultUrlFor(providerType);
      const userId = relay?.currentUserId;
      if (props.mode === "create") {
        const created = await store.create({
          name: name.trim() || null,
          type: providerType,
          scope,
          color,
          is_enabled: enabled,
          credential_storage: effectiveStoreInBrowser ? "browser" : "server",
          settings: {
            base_url: effectiveUrl,
            bearer_token:
              isBrowserLocal || effectiveStoreInBrowser ? null : token || null,
          },
        });
        if (effectiveStoreInBrowser) {
          relay?.ensureConnected();
          if (token.trim()) {
            setProviderCredential(userId, created.id, token.trim());
          }
          void relay?.refreshProviders();
        }
      } else {
        const p = props.provider;
        if (showBrowserCredentialOption && effectiveStoreInBrowser) {
          relay?.ensureConnected();
          const updated = await store.update(p.id, {
            expected_version: p.version,
            name: name.trim() !== p.name ? name.trim() : undefined,
            color: color !== p.color ? color : undefined,
            is_enabled: enabled !== p.is_enabled ? enabled : undefined,
            base_url:
              !isWebGpu && url.trim() !== (p.base_url ?? "")
                ? effectiveUrl || undefined
                : undefined,
            clear_bearer_token: p.has_bearer_token ? true : undefined,
            credential_storage: "browser",
          });
          if (clearToken) {
            deleteProviderCredential(userId, updated.id);
          } else if (token.trim()) {
            setProviderCredential(userId, updated.id, token.trim());
          } else if (p.credential_storage !== "browser") {
            deleteProviderCredential(userId, updated.id);
          }
          void relay?.refreshProviders();
        } else if (isPausedBrowserUnderServerOnly && !token.trim()) {
          // Preserve paused browser state when only editing metadata under server_only.
          await store.update(p.id, {
            expected_version: p.version,
            name: name.trim() !== p.name ? name.trim() : undefined,
            color: color !== p.color ? color : undefined,
            is_enabled: enabled !== p.is_enabled ? enabled : undefined,
            base_url:
              !isWebGpu && url.trim() !== (p.base_url ?? "")
                ? effectiveUrl || undefined
                : undefined,
          });
        } else {
          const migrationToken =
            !token.trim() &&
            p.credential_storage === "browser" &&
            !isPausedBrowserUnderServerOnly
              ? vaultToken || ""
              : token.trim();
          const updated = await store.update(p.id, {
            expected_version: p.version,
            name: name.trim() !== p.name ? name.trim() : undefined,
            color: color !== p.color ? color : undefined,
            is_enabled: enabled !== p.is_enabled ? enabled : undefined,
            base_url:
              !isWebGpu && url.trim() !== (p.base_url ?? "")
                ? effectiveUrl || undefined
                : undefined,
            bearer_token: isBrowserLocal
              ? undefined
              : migrationToken || undefined,
            clear_bearer_token: isBrowserLocal
              ? undefined
              : clearToken || undefined,
            credential_storage: isBrowserLocal ? undefined : "server",
          });
          if (showBrowserCredentialOption) {
            deleteProviderCredential(userId, updated.id);
            void relay?.refreshProviders();
          }
        }
      }
      props.onDone();
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.status === 409 && apiErr.references?.length) {
        setBlockers(apiErr.references);
      } else if (apiErr.status === 409 && /changed elsewhere/i.test(apiErr.message)) {
        setConflict(true);
      }
      setError(apiErr.message || "Saving the provider failed.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (props.mode !== "edit") return;
    setSaving(true);
    setError(null);
    try {
      await store.remove(props.provider.id);
      props.onDone();
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.references?.length) setBlockers(apiErr.references);
      setError(apiErr.message || "Deleting the provider failed.");
      setConfirmDelete(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="provider-editor">
      {deleteOnly && (
        <div className="provider-note">
          Personal providers are currently disabled by the administrator. You can still delete this one.
        </div>
      )}

      <div className="form-group">
        <label className="form-label">Provider Type</label>
        <div className="provider-type-grid">
          <button
            type="button"
            disabled={deleteOnly || props.mode === "edit"}
            className={`btn ${providerType === "ollama" ? "btn--primary" : "btn--subtle"}`}
            style={{ padding: "7px 10px", fontSize: "0.8rem" }}
            onClick={() => selectProviderType("ollama")}
          >
            Ollama (Host Server)
          </button>
          {showBrowserTypes && (
            <>
              <button
                type="button"
                disabled={deleteOnly || props.mode === "edit"}
                className={`btn ${providerType === "browser_ollama" ? "btn--primary" : "btn--subtle"}`}
                style={{ padding: "7px 10px", fontSize: "0.8rem" }}
                onClick={() => selectProviderType("browser_ollama")}
              >
                {scope === "system" ? "Local Ollama (User's Browser)" : "Local Ollama (Browser)"}
              </button>
              <button
                type="button"
                disabled={deleteOnly || props.mode === "edit"}
                className={`btn ${providerType === "webgpu" ? "btn--primary" : "btn--subtle"}`}
                style={{ padding: "7px 10px", fontSize: "0.8rem" }}
                onClick={() => selectProviderType("webgpu")}
              >
                In-Browser WebGPU
              </button>
            </>
          )}
          <button
            type="button"
            disabled={deleteOnly || props.mode === "edit"}
            className={`btn ${providerType === "openrouter" ? "btn--primary" : "btn--subtle"}`}
            style={{ padding: "7px 10px", fontSize: "0.8rem" }}
            onClick={() => selectProviderType("openrouter")}
          >
            OpenRouter (Cloud API)
          </button>
          <button
            type="button"
            disabled={deleteOnly || props.mode === "edit"}
            className={`btn ${providerType === "nanogpt" ? "btn--primary" : "btn--subtle"}`}
            style={{ padding: "7px 10px", fontSize: "0.8rem" }}
            onClick={() => selectProviderType("nanogpt")}
          >
            NanoGPT (Cloud API)
          </button>
          <button
            type="button"
            disabled={deleteOnly || props.mode === "edit"}
            className={`btn ${providerType === "aihorde" ? "btn--primary" : "btn--subtle"}`}
            style={{ padding: "7px 10px", fontSize: "0.8rem" }}
            onClick={() => selectProviderType("aihorde")}
          >
            AI Horde (Crowdsourced)
          </button>
        </div>
      </div>

      <div className={isWebGpu ? "" : "grid-2"}>
        <div className="form-group">
          <label className="form-label">Name</label>
          <input
            className="form-input"
            value={name}
            disabled={deleteOnly}
            placeholder={
              props.mode === "create"
                ? providerType === "openrouter"
                  ? "Defaults to “OpenRouter”"
                  : providerType === "nanogpt"
                  ? "Defaults to “NanoGPT”"
                  : providerType === "aihorde"
                  ? "Defaults to “AI Horde”"
                  : providerType === "browser_ollama"
                  ? "Defaults to “Local Ollama (Browser)”"
                  : providerType === "webgpu"
                  ? "Defaults to “Browser WebGPU”"
                  : "Defaults to “Ollama”"
                : undefined
            }
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {!isWebGpu && (
          <div className="form-group">
            <label className="form-label">
              {isBrowserOllama ? "Local Ollama URL" : "Server URL"}{" "}
              {providerType === "openrouter" ? (
                <span className="form-hint">(default: openrouter.ai/api/v1)</span>
              ) : providerType === "nanogpt" ? (
                <span className="form-hint">(default: nano-gpt.com/api/v1)</span>
              ) : providerType === "aihorde" ? (
                <span className="form-hint">(default: oai.stablehorde.net/v1)</span>
              ) : isBrowserOllama ? (
                <span className="form-hint">(loopback only: localhost or 127.0.0.1)</span>
              ) : null}
            </label>
            <input
              className="form-input"
              value={url}
              disabled={deleteOnly || providerType === "aihorde"}
              placeholder={
                providerType === "openrouter"
                  ? "https://openrouter.ai/api/v1"
                  : providerType === "nanogpt"
                  ? "https://nano-gpt.com/api/v1"
                  : providerType === "aihorde"
                  ? "https://oai.stablehorde.net/v1"
                  : "http://localhost:11434"
              }
              onChange={(e) => setUrl(e.target.value)}
              aria-invalid={urlMissing}
            />
          </div>
        )}
      </div>

      {isWebGpu && (
        <div className="provider-note" style={{ marginBottom: 12 }}>
          <div>
            <strong>Zero-install WebGPU inference:</strong> runs quantized 1.7B–8B models directly inside
            your browser via WebLLM. First load downloads 1.8–5.7 GB into browser cache, and context
            windows are automatically clamped to 4k–8k tokens per model to fit GPU memory.
          </div>
          {webgpuCheck && (
            <div style={{ marginTop: 6, color: webgpuCheck.supported ? "var(--accent-emerald)" : "var(--accent-amber)" }}>
              {webgpuCheck.supported
                ? "✓ WebGPU adapter detected in this browser."
                : `⚠ ${webgpuCheck.reason}`}
            </div>
          )}
        </div>
      )}

      {isBrowserOllama && (
        <div className="provider-note" style={{ marginBottom: 12 }}>
          <div>
            <strong>Local GPU via Browser Relay:</strong> your browser connects directly to Ollama on
            this computer and relays tokens while this tab stays open. Requires{" "}
            <code>OLLAMA_ORIGINS="{typeof window !== "undefined" ? window.location.origin : "*"}"</code>{" "}
            and clicking <strong>Allow</strong> on the browser&apos;s Local Network Access prompt.
          </div>
        </div>
      )}

      {!isBrowserLocal && (
        <div className="form-group">
          {isPausedBrowserUnderServerOnly && (
            <div className="provider-warning" role="status" style={{ marginBottom: 8 }}>
              <AlertTriangle size={13} /> Browser-stored credentials are currently disabled by the
              administrator. Enter a key below to store it on the server, or wait until browser
              storage is re-enabled.
            </div>
          )}
          <label className="form-label">
            {providerType === "openrouter"
              ? "OpenRouter API Key"
              : providerType === "nanogpt"
              ? "NanoGPT API Key"
              : providerType === "aihorde"
              ? "AI Horde API Key"
              : "Bearer token"}{" "}
            <span className="form-hint">
              {providerType === "openrouter"
                ? "(required, sk-or-v1-...)"
                : providerType === "nanogpt"
                ? "(required)"
                : providerType === "aihorde"
                ? effectiveStoreInBrowser
                  ? "(required when stored in browser)"
                  : "(optional, defaults to anonymous 0000000000)"
                : "(optional, for hosted/cloud endpoints)"}
            </span>
          </label>
          <input
            type="password"
            autoComplete="new-password"
            className="form-input"
            value={token}
            disabled={deleteOnly || clearToken}
            placeholder={
              effectiveHasSavedToken
                ? effectiveStoreInBrowser
                  ? "•••••••• saved in this browser. Type to replace"
                  : "•••••••• saved. Type to replace"
                : props.mode === "edit" &&
                    existing?.credential_storage === "browser" &&
                    effectiveStoreInBrowser
                  ? "No key saved in this browser — enter key"
                  : props.mode === "edit" &&
                      existing?.credential_storage !== "browser" &&
                      effectiveStoreInBrowser &&
                      existing?.has_bearer_token
                    ? "Re-enter key to store in this browser"
                    : providerType === "openrouter"
                      ? "sk-or-v1-..."
                      : providerType === "nanogpt"
                        ? "Enter your NanoGPT API key"
                        : providerType === "aihorde"
                          ? effectiveStoreInBrowser
                            ? "Enter your AI Horde API key"
                            : "Leave blank to use anonymous key (0000000000)"
                          : "Leave empty if not needed"
            }
            onChange={(e) => setToken(e.target.value)}
          />
          {showBrowserCredentialOption && (
            <label
              className="provider-inline-check"
              style={{
                marginTop: 6,
                opacity: browserCheckDisabled ? 0.72 : 1,
              }}
            >
              <input
                type="checkbox"
                checked={effectiveStoreInBrowser}
                disabled={browserCheckDisabled}
                onChange={(e) => {
                  setStoreInBrowser(e.target.checked);
                  setTestResult(null);
                }}
              />
              <span>
                Store in Browser only{" "}
                <span className="form-hint">
                  {credentialStoreMode === "server_only"
                    ? "(disabled by administrator: server storage only)"
                    : credentialStoreMode === "browser_only"
                      ? "(enforced by administrator)"
                      : "(key stays in this browser; requests run directly from your browser)"}
                </span>
              </span>
            </label>
          )}
          {props.mode === "edit" &&
            existing?.credential_storage !== "browser" &&
            effectiveStoreInBrowser &&
            existing?.has_bearer_token && (
              <div className="form-hint" style={{ marginTop: 4 }}>
                The existing server-stored key cannot be retrieved; enter it above to move it to
                this browser (saving clears the server copy).
              </div>
            )}
          {isRemoteHttpMixedContent && (
            <div className="provider-warning" role="status" style={{ marginTop: 6 }}>
              <AlertTriangle size={13} /> This page is loaded over HTTPS; browsers block direct{" "}
              <code>http://</code> requests to non-loopback Ollama servers. Use an{" "}
              <code>https://</code> reverse proxy with <code>OLLAMA_ORIGINS</code> CORS enabled.
            </div>
          )}
          {effectiveHasSavedToken && (
            <label className="provider-inline-check" style={{ marginTop: 4 }}>
              <input
                type="checkbox"
                checked={clearToken}
                disabled={deleteOnly}
                onChange={(e) => {
                  setClearToken(e.target.checked);
                  if (e.target.checked) setToken("");
                }}
              />
              {effectiveStoreInBrowser ? "Remove the browser-saved token" : "Remove the saved token"}
            </label>
          )}
          {tokenRequired && (
            <div className="provider-warning" role="alert">
              <AlertTriangle size={13} /> The server host changed. For safety, enter the token again or remove it, so
              the saved token is never sent to a different server.
            </div>
          )}
        </div>
      )}

      <div className="form-group">
        <label className="form-label">Colour</label>
        <div className="provider-color-picker" role="radiogroup" aria-label="Provider colour">
          {PROVIDER_COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={color === c.value}
              disabled={deleteOnly}
              className={`provider-color-option ${color === c.value ? "selected" : ""}`}
              onClick={() => setColor(c.value)}
            >
              <ProviderColorPill color={c.value}>{c.label}</ProviderColorPill>
            </button>
          ))}
        </div>
      </div>

      <label className="provider-inline-check">
        <input
          type="checkbox"
          checked={enabled}
          disabled={deleteOnly}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        Enabled (selectable for models)
      </label>

      {testResult && (
        <div
          className={`provider-test-result ${testResult.reachable ? "ok" : "fail"}`}
          role="status"
        >
          {testResult.reachable ? (
            <>
              <Check size={13} /> Connected ({testResult.protocol === "openai_compat" ? "OpenAI-compatible" : "Ollama"}):{" "}
              {testResult.chat_models.length} chat model(s), {testResult.embedding_models.length} embedding
              model(s).
              {providerType === "nanogpt" && (
                <span> (Reachability &amp; catalog verified; API key is checked on first turn.)</span>
              )}
            </>
          ) : (
            <>
              <AlertTriangle size={13} /> {describeProbeError(testResult.error_code)}
              {testResult.error ? ` (${testResult.error})` : ""}
            </>
          )}
        </div>
      )}

      {needsCorsSetup && isBrowserOllama && (
        <div className="provider-note" style={{ marginTop: 8, fontSize: "0.75rem" }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            Ollama CORS / Browser Access Setup
          </div>
          <div style={{ marginBottom: 6 }}>
            If Ollama is running, allow this origin and restart Ollama (also allow the browser&apos;s
            Local Network Access prompt and disable localhost blocking in ad-blockers):
          </div>
          {[
            {
              label: "macOS",
              cmd: `launchctl setenv OLLAMA_ORIGINS "${typeof window !== "undefined" ? window.location.origin : "*"}"`,
            },
            {
              label: "Linux (systemd)",
              cmd: `OLLAMA_ORIGINS="${typeof window !== "undefined" ? window.location.origin : "*"}" ollama serve`,
            },
            {
              label: "Windows (PowerShell)",
              cmd: `$env:OLLAMA_ORIGINS="${typeof window !== "undefined" ? window.location.origin : "*"}"; ollama serve`,
            },
          ].map((item) => (
            <div
              key={item.label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginTop: 4,
              }}
            >
              <span style={{ minWidth: 115, color: "var(--text-muted)" }}>{item.label}:</span>
              <code style={{ flex: 1, overflowX: "auto", padding: "2px 6px" }}>{item.cmd}</code>
              <button
                type="button"
                className="btn btn-sm"
                style={{ padding: "2px 6px" }}
                onClick={() => {
                  void navigator.clipboard?.writeText(item.cmd);
                  setCopiedCmd(item.label);
                  window.setTimeout(() => setCopiedCmd(null), 1500);
                }}
                title={`Copy ${item.label} command`}
              >
                {copiedCmd === item.label ? <Check size={12} /> : <Copy size={12} />}
              </button>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="auth-alert auth-alert-error" role="alert">
          <AlertTriangle size={14} />
          <span>{error}</span>
        </div>
      )}
      {blockers.length > 0 && (
        <ul className="provider-blockers">
          {blockers.map((b, i) => (
            <li key={i}>Used by {describeReference(b)}</li>
          ))}
        </ul>
      )}
      {conflict && (
        <button type="button" className="btn btn-sm" onClick={() => void store.refresh().then(props.onDone)}>
          Reload provider
        </button>
      )}

      <div className="provider-editor-actions">
        <div>
          {props.mode === "edit" &&
            (confirmDelete ? (
              <span className="provider-confirm">
                Delete “{props.provider.name}”?{" "}
                <button type="button" className="btn btn-danger btn-sm" disabled={saving} onClick={handleDelete}>
                  Yes, delete
                </button>{" "}
                <button type="button" className="btn btn-sm" onClick={() => setConfirmDelete(false)}>
                  Keep
                </button>
              </span>
            ) : (
              <button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={13} /> Delete
              </button>
            ))}
        </div>
        <div className="provider-editor-actions-right">
          {!deleteOnly && (
            <button
              type="button"
              className="btn btn-sm"
              disabled={testing || urlMissing}
              onClick={handleTest}
              title="Check the connection with the values above, before saving"
            >
              {testing ? <Loader2 size={13} className="spin" /> : <Plug size={13} />} Test connection
            </button>
          )}
          <button type="button" className="btn btn-sm" onClick={props.onDone}>
            {props.mode === "create" ? "Cancel" : "Close"}
          </button>
          {!deleteOnly && (
            <button type="button" className="btn btn-amber btn-sm" disabled={!canSave} onClick={handleSave}>
              <Check size={13} /> {saving ? "Saving…" : props.mode === "create" ? "Add provider" : "Save"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
