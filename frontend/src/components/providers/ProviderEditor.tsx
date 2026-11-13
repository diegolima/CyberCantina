import React, { useEffect, useState } from "react";
import { AlertTriangle, Check, Copy, Loader2, Plug, Trash2 } from "lucide-react";
import { ApiError, api } from "../../api";
import { probeBrowserOllama } from "../../local/ollamaDriver";
import { checkWebGpuAdapter, getWebGpuModelInfos } from "../../local/webgpuCatalog";
import { useOptionalLocalRelay } from "../../providers/LocalRelayContext";
import {
  LLMProvider,
  ProviderColor,
  ProviderProbeResponse,
  ProviderReference,
  ProviderScope,
  ProviderType,
} from "../../types";
import { PROVIDER_COLORS, ProviderColorPill, describeProbeError } from "./ProviderBadges";
import { useProviders } from "./ProvidersContext";

type EditorProps =
  | { mode: "edit"; provider: LLMProvider; deleteOnly?: boolean; onDone: () => void }
  | { mode: "create"; scope: ProviderScope; onDone: () => void };

const PRESET_CLOUD_HOSTS = new Set(["openrouter.ai", "oai.stablehorde.net"]);

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

  const [providerType, setProviderType] = useState<ProviderType>(existing?.type ?? "ollama");
  const [name, setName] = useState(existing?.name ?? "");
  const [url, setUrl] = useState(existing?.base_url ?? "");
  const [token, setToken] = useState("");
  const [clearToken, setClearToken] = useState(false);
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
  const tokenMissing = providerType === "openrouter" && props.mode === "create" && !token.trim();
  const hostChanged =
    !!existing &&
    !isBrowserLocal &&
    existing.base_url !== null &&
    hostOf(url) !== null &&
    hostOf(url) !== hostOf(existing.base_url);
  const tokenRequired = hostChanged && !!existing?.has_bearer_token && !token && !clearToken;
  const canSave = !urlMissing && !tokenMissing && !saving && !tokenRequired && (props.mode === "create" || name.trim() !== "");

  const defaultUrlFor = (ptype: ProviderType): string => {
    if (ptype === "openrouter") return "https://openrouter.ai/api/v1";
    if (ptype === "aihorde") return "https://oai.stablehorde.net/v1";
    if (ptype === "browser_ollama") return "http://localhost:11434";
    if (ptype === "webgpu") return "webgpu://browser";
    return "";
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
      if (props.mode === "create") {
        await store.create({
          name: name.trim() || null,
          type: providerType,
          scope,
          color,
          is_enabled: enabled,
          settings: {
            base_url: effectiveUrl,
            bearer_token: isBrowserLocal ? null : token || null,
          },
        });
      } else {
        const p = props.provider;
        await store.update(p.id, {
          expected_version: p.version,
          name: name.trim() !== p.name ? name.trim() : undefined,
          color: color !== p.color ? color : undefined,
          is_enabled: enabled !== p.is_enabled ? enabled : undefined,
          base_url:
            !isWebGpu && url.trim() !== (p.base_url ?? "")
              ? effectiveUrl || undefined
              : undefined,
          bearer_token: isBrowserLocal ? undefined : token || undefined,
          clear_bearer_token: isBrowserLocal ? undefined : clearToken || undefined,
        });
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
            onClick={() => {
              setProviderType("ollama");
              setTestResult(null);
              setNeedsCorsSetup(false);
              if (["OpenRouter", "AI Horde", "Local Ollama (Browser)", "Browser WebGPU"].includes(name)) setName("");
              if (url === "https://openrouter.ai/api/v1" || url === "https://oai.stablehorde.net/v1" || url === "webgpu://browser") setUrl("");
            }}
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
                onClick={() => {
                  setProviderType("browser_ollama");
                  setTestResult(null);
                  setNeedsCorsSetup(false);
                  if (!name || ["Ollama", "OpenRouter", "AI Horde", "Browser WebGPU"].includes(name)) {
                    setName("Local Ollama (Browser)");
                  }
                  if (isPresetCloudOrSentinelUrl(url)) {
                    setUrl("http://localhost:11434");
                  }
                }}
              >
                {scope === "system" ? "Local Ollama (User's Browser)" : "Local Ollama (Browser)"}
              </button>
              <button
                type="button"
                disabled={deleteOnly || props.mode === "edit"}
                className={`btn ${providerType === "webgpu" ? "btn--primary" : "btn--subtle"}`}
                style={{ padding: "7px 10px", fontSize: "0.8rem" }}
                onClick={() => {
                  setProviderType("webgpu");
                  setTestResult(null);
                  setNeedsCorsSetup(false);
                  if (!name || ["Ollama", "OpenRouter", "AI Horde", "Local Ollama (Browser)"].includes(name)) {
                    setName("Browser WebGPU");
                  }
                  setUrl("webgpu://browser");
                }}
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
            onClick={() => {
              setProviderType("openrouter");
              setTestResult(null);
              setNeedsCorsSetup(false);
              if (!name || ["Ollama", "AI Horde", "Local Ollama (Browser)", "Browser WebGPU"].includes(name)) setName("OpenRouter");
              if (!url || url === "https://oai.stablehorde.net/v1" || url === "webgpu://browser" || url === "http://localhost:11434") {
                setUrl("https://openrouter.ai/api/v1");
              }
            }}
          >
            OpenRouter (Cloud API)
          </button>
          <button
            type="button"
            disabled={deleteOnly || props.mode === "edit"}
            className={`btn ${providerType === "aihorde" ? "btn--primary" : "btn--subtle"}`}
            style={{ padding: "7px 10px", fontSize: "0.8rem" }}
            onClick={() => {
              setProviderType("aihorde");
              setTestResult(null);
              setNeedsCorsSetup(false);
              if (!name || ["Ollama", "OpenRouter", "Local Ollama (Browser)", "Browser WebGPU"].includes(name)) setName("AI Horde");
              if (!url || url === "https://openrouter.ai/api/v1" || url === "webgpu://browser" || url === "http://localhost:11434") {
                setUrl("https://oai.stablehorde.net/v1");
              }
            }}
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
          <label className="form-label">
            {providerType === "openrouter"
              ? "OpenRouter API Key"
              : providerType === "aihorde"
              ? "AI Horde API Key"
              : "Bearer token"}{" "}
            <span className="form-hint">
              {providerType === "openrouter"
                ? "(required, sk-or-v1-...)"
                : providerType === "aihorde"
                ? "(optional, defaults to anonymous 0000000000)"
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
              existing?.has_bearer_token
                ? "•••••••• saved. Type to replace"
                : providerType === "openrouter"
                ? "sk-or-v1-..."
                : providerType === "aihorde"
                ? "Leave blank to use anonymous key (0000000000)"
                : "Leave empty if not needed"
            }
            onChange={(e) => setToken(e.target.value)}
          />
          {existing?.has_bearer_token && (
            <label className="provider-inline-check">
              <input
                type="checkbox"
                checked={clearToken}
                disabled={deleteOnly}
                onChange={(e) => {
                  setClearToken(e.target.checked);
                  if (e.target.checked) setToken("");
                }}
              />
              Remove the saved token
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
