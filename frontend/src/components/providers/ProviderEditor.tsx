import React, { useState } from "react";
import { AlertTriangle, Check, Loader2, Plug, Trash2 } from "lucide-react";
import { ApiError, api } from "../../api";
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
  const existing = props.mode === "edit" ? props.provider : null;
  const deleteOnly = props.mode === "edit" && props.deleteOnly;

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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [blockers, setBlockers] = useState<ProviderReference[]>([]);

  const urlMissing = providerType === "ollama" && url.trim() === "";
  const tokenMissing = providerType === "openrouter" && props.mode === "create" && !token.trim();
  const hostChanged =
    !!existing &&
    existing.base_url !== null &&
    hostOf(url) !== null &&
    hostOf(url) !== hostOf(existing.base_url);
  const tokenRequired = hostChanged && !!existing?.has_bearer_token && !token && !clearToken;
  const canSave = !urlMissing && !tokenMissing && !saving && !tokenRequired && (props.mode === "create" || name.trim() !== "");

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const effectiveUrl = url.trim() || (providerType === "openrouter" ? "https://openrouter.ai/api/v1" : "");
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
      const effectiveUrl = url.trim() || (providerType === "openrouter" ? "https://openrouter.ai/api/v1" : "");
      if (props.mode === "create") {
        await store.create({
          name: name.trim() || null,
          type: providerType,
          scope: props.scope,
          color,
          is_enabled: enabled,
          settings: { base_url: effectiveUrl, bearer_token: token || null },
        });
      } else {
        const p = props.provider;
        await store.update(p.id, {
          expected_version: p.version,
          name: name.trim() !== p.name ? name.trim() : undefined,
          color: color !== p.color ? color : undefined,
          is_enabled: enabled !== p.is_enabled ? enabled : undefined,
          base_url: url.trim() !== (p.base_url ?? "") ? (effectiveUrl || undefined) : undefined,
          bearer_token: token || undefined,
          clear_bearer_token: clearToken || undefined,
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
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="button"
            disabled={deleteOnly || props.mode === "edit"}
            className={`btn ${providerType === "ollama" ? "btn--primary" : "btn--subtle"}`}
            style={{ flex: 1, padding: "7px 12px", fontSize: "0.82rem" }}
            onClick={() => {
              setProviderType("ollama");
              if (!name || name === "OpenRouter") setName("");
              if (url === "https://openrouter.ai/api/v1") setUrl("");
            }}
          >
            Ollama (Local / Self-hosted)
          </button>
          <button
            type="button"
            disabled={deleteOnly || props.mode === "edit"}
            className={`btn ${providerType === "openrouter" ? "btn--primary" : "btn--subtle"}`}
            style={{ flex: 1, padding: "7px 12px", fontSize: "0.82rem" }}
            onClick={() => {
              setProviderType("openrouter");
              if (!name || name === "Ollama") setName("OpenRouter");
              if (!url) setUrl("https://openrouter.ai/api/v1");
            }}
          >
            OpenRouter (Cloud API)
          </button>
        </div>
      </div>

      <div className="grid-2">
        <div className="form-group">
          <label className="form-label">Name</label>
          <input
            className="form-input"
            value={name}
            disabled={deleteOnly}
            placeholder={props.mode === "create" ? (providerType === "openrouter" ? "Defaults to “OpenRouter”" : "Defaults to “Ollama”") : undefined}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label className="form-label">
            Server URL {providerType === "openrouter" && <span className="form-hint">(default: openrouter.ai/api/v1)</span>}
          </label>
          <input
            className="form-input"
            value={url}
            disabled={deleteOnly}
            placeholder={providerType === "openrouter" ? "https://openrouter.ai/api/v1" : "http://localhost:11434"}
            onChange={(e) => setUrl(e.target.value)}
            aria-invalid={urlMissing}
          />
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">
          {providerType === "openrouter" ? "OpenRouter API Key" : "Bearer token"}{" "}
          <span className="form-hint">
            {providerType === "openrouter" ? "(required, sk-or-v1-...)" : "(optional, for hosted/cloud endpoints)"}
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
