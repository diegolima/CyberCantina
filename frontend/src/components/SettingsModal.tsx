import React, { useEffect, useState } from "react";
import { Check, RefreshCw, Server, Settings, X } from "lucide-react";
import { api } from "../api";
import { AppSettings, OllamaStatusResponse } from "../types";

interface SettingsModalProps {
  initialSettings: AppSettings;
  onClose: () => void;
  onSaved: (updated: AppSettings) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  initialSettings,
  onClose,
  onSaved,
}) => {
  const [form, setForm] = useState<AppSettings>(initialSettings);
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatusResponse | null>(
    null
  );
  const [probing, setProbing] = useState(false);
  const [saving, setSaving] = useState(false);

  const probeOllama = async (urlToProbe?: string) => {
    setProbing(true);
    try {
      const status = await api.getOllamaStatus(
        urlToProbe ?? form.actor_profile.base_url
      );
      setOllamaStatus(status);
      if (status.reachable && status.chat_models.length > 0) {
        setForm((prev) => {
          const next = { ...prev };
          if (!status.chat_models.includes(prev.actor_profile.model)) {
            next.actor_profile = {
              ...prev.actor_profile,
              model: status.chat_models[0],
            };
          }
          if (!status.chat_models.includes(prev.clerk_profile.model)) {
            next.clerk_profile = {
              ...prev.clerk_profile,
              model: status.chat_models[0],
            };
          }
          return next;
        });
      }
    } finally {
      setProbing(false);
    }
  };

  useEffect(() => {
    probeOllama(initialSettings.actor_profile.base_url);
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await api.updateSettings(form);
      onSaved(updated);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const chatModels = ollamaStatus?.models.filter((m) => !m.is_embedding) ?? [];

  return (
    <div className="modal-backdrop">
      <div className="modal-panel">
        <div className="modal-header">
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Settings size={18} color="var(--accent-amber)" />
            Ollama & 3-Tier Memory Settings
          </span>
          <button type="button" className="btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <form className="modal-body" onSubmit={handleSave}>
          {/* Live Ollama Discovery Banner */}
          <div
            style={{
              background: ollamaStatus?.reachable
                ? "rgba(16, 185, 129, 0.1)"
                : "rgba(244, 63, 94, 0.1)",
              border: `1px solid ${
                ollamaStatus?.reachable
                  ? "rgba(16, 185, 129, 0.4)"
                  : "rgba(244, 63, 94, 0.4)"
              }`,
              borderRadius: 8,
              padding: "10px 14px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Server
                size={18}
                color={
                  ollamaStatus?.reachable
                    ? "var(--accent-emerald)"
                    : "var(--accent-rose)"
                }
              />
              <div style={{ fontSize: "0.8rem" }}>
                {ollamaStatus?.reachable ? (
                  <>
                    <strong style={{ color: "#6ee7b7" }}>
                      Ollama Connected ({ollamaStatus.ollama_root_url})
                    </strong>
                    <div style={{ color: "var(--text-secondary)", fontSize: "0.74rem" }}>
                      {ollamaStatus.chat_models.length} chat model(s) &{" "}
                      {ollamaStatus.embedding_models.length} embedding model(s) installed locally
                    </div>
                  </>
                ) : (
                  <>
                    <strong style={{ color: "#fda4af" }}>
                      Ollama Unreachable ({ollamaStatus?.ollama_root_url ?? form.actor_profile.base_url})
                    </strong>
                    <div style={{ color: "var(--text-secondary)", fontSize: "0.74rem" }}>
                      {ollamaStatus?.error || "Make sure `ollama serve` is running."}
                    </div>
                  </>
                )}
              </div>
            </div>

            <button
              type="button"
              className="btn"
              onClick={() => probeOllama(form.actor_profile.base_url)}
              disabled={probing}
            >
              <RefreshCw size={13} />
              {probing ? "Probing..." : "Refresh Models"}
            </button>
          </div>

          <div className="sidebar-label" style={{ color: "var(--accent-amber)" }}>
            1. Primary Actor Model (Phase 3 &lt;cognition&gt; + Narrative Prose)
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1.6fr", gap: 10 }}>
            <div className="field-group">
              <label>Ollama Server URL</label>
              <input
                className="field-input"
                value={form.actor_profile.base_url}
                onChange={(e) =>
                  setForm({
                    ...form,
                    actor_profile: { ...form.actor_profile, base_url: e.target.value },
                  })
                }
              />
            </div>
            <div className="field-group">
              <label>Actor Ollama Model</label>
              {chatModels.length > 0 ? (
                <select
                  className="field-select"
                  value={form.actor_profile.model}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      actor_profile: { ...form.actor_profile, model: e.target.value },
                    })
                  }
                >
                  {chatModels.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name}{" "}
                      {m.parameter_size ? `(${m.parameter_size}` : ""}
                      {m.quantization_level ? `, ${m.quantization_level})` : m.parameter_size ? ")" : ""}{" "}
                      — {m.size_mb} MB
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="field-input"
                  value={form.actor_profile.model}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      actor_profile: { ...form.actor_profile, model: e.target.value },
                    })
                  }
                />
              )}
            </div>
          </div>

          <div className="sidebar-label" style={{ color: "var(--accent-cyan)", marginTop: 6 }}>
            2. Auxiliary Clerk Model (Phase 1 Pre-Turn Analysis & Phase 4 State/Summary Clerk)
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1.6fr", gap: 10 }}>
            <div className="field-group">
              <label>Clerk Server URL</label>
              <input
                className="field-input"
                value={form.clerk_profile.base_url}
                onChange={(e) =>
                  setForm({
                    ...form,
                    clerk_profile: { ...form.clerk_profile, base_url: e.target.value },
                  })
                }
              />
            </div>
            <div className="field-group">
              <label>Clerk Ollama Model (Can match Actor or use a smaller fast model)</label>
              {chatModels.length > 0 ? (
                <select
                  className="field-select"
                  value={form.clerk_profile.model}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      clerk_profile: { ...form.clerk_profile, model: e.target.value },
                    })
                  }
                >
                  {chatModels.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name}{" "}
                      {m.parameter_size ? `(${m.parameter_size}` : ""}
                      {m.quantization_level ? `, ${m.quantization_level})` : m.parameter_size ? ")" : ""}{" "}
                      — {m.size_mb} MB
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="field-input"
                  value={form.clerk_profile.model}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      clerk_profile: { ...form.clerk_profile, model: e.target.value },
                    })
                  }
                />
              )}
            </div>
          </div>


          <div className="field-group" style={{ marginTop: 8 }}>
            <label>Character Agent Dispatch Mode</label>
            <select
              className="field-select"
              value={form.agent_dispatch_mode ?? "sequential"}
              onChange={(e) =>
                setForm({
                  ...form,
                  agent_dispatch_mode: e.target.value as "sequential" | "parallel",
                })
              }
            >
              <option value="sequential">Sequential — One-at-a-Time (Recommended for Single Local GPU / Ollama)</option>
              <option value="parallel">Parallel — Concurrent asyncio.gather (Cloud APIs / Multi-Slot vLLM)</option>
            </select>
          </div>

          <div className="sidebar-label" style={{ color: "var(--accent-emerald)", marginTop: 6 }}>
            3. Semantic Vector Store & 3-Tier Context Window
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
            <div className="field-group">
              <label>Embedding Engine</label>
              <select
                className="field-select"
                value={form.embedding_profile.mode}
                onChange={(e) =>
                  setForm({
                    ...form,
                    embedding_profile: {
                      ...form.embedding_profile,
                      mode: e.target.value as AppSettings["embedding_profile"]["mode"],
                    },
                  })
                }
              >
                <option value="local_hash">Local Feature Hash (0 VRAM)</option>
                <option value="openai_compat">Ollama /api/embed</option>
                <option value="fastembed">Local ONNX FastEmbed</option>
              </select>
            </div>
            <div className="field-group">
              <label>Zone 3 Working Turns (N)</label>
              <input
                type="number"
                min={4}
                max={64}
                className="field-input"
                value={form.memory_config.working_memory_turns}
                onChange={(e) =>
                  setForm({
                    ...form,
                    memory_config: {
                      ...form.memory_config,
                      working_memory_turns: Number(e.target.value),
                    },
                  })
                }
              />
            </div>
            <div className="field-group">
              <label>Zone 2 Chunk Size (K)</label>
              <input
                type="number"
                min={2}
                max={32}
                className="field-input"
                value={form.memory_config.episodic_chunk_size}
                onChange={(e) =>
                  setForm({
                    ...form,
                    memory_config: {
                      ...form.memory_config,
                      episodic_chunk_size: Number(e.target.value),
                    },
                  })
                }
              />
            </div>
            <div className="field-group">
              <label>Max Scene Flags (FIFO)</label>
              <input
                type="number"
                min={1}
                max={50}
                className="field-input"
                value={form.memory_config.max_scene_flags ?? 10}
                onChange={(e) =>
                  setForm({
                    ...form,
                    memory_config: {
                      ...form.memory_config,
                      max_scene_flags: Number(e.target.value) || 10,
                    },
                  })
                }
              />
            </div>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.82rem", marginTop: 4 }}>
            <input
              type="checkbox"
              checked={form.allow_offline_fallback}
              onChange={(e) =>
                setForm({ ...form, allow_offline_fallback: e.target.checked })
              }
            />
            Allow heuristic offline fallback if Ollama is unreachable (uncheck to require live Ollama responses)
          </label>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-amber" disabled={saving}>
              <Check size={15} />
              {saving ? "Saving..." : "Save Configuration"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
