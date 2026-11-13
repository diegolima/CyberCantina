import React from "react";
import { Check } from "lucide-react";
import { AppSettings } from "../../types";
import { ModelDeck } from "../models/ModelDeck";
import {
  DEFAULT_ACTOR_CONTEXT_SIZE,
  DEFAULT_CLERK_CONTEXT_SIZE,
} from "../models/modelLimits";
import { useProviders } from "../providers/ProvidersContext";

export interface AdminModelsTabProps {
  appSettingsForm: AppSettings | null;
  setAppSettingsForm: React.Dispatch<React.SetStateAction<AppSettings | null>>;
  savingSettings: boolean;
  modelsDeckInvalid: number;
  setModelsDeckInvalid: (count: number) => void;
  staleEmbeddings: number;
  reindexing: boolean;
  handleReindex: () => Promise<void>;
  handleSaveSettings: (e: React.FormEvent) => Promise<void>;
}

export const AdminModelsTab: React.FC<AdminModelsTabProps> = ({
  appSettingsForm,
  setAppSettingsForm,
  savingSettings,
  modelsDeckInvalid,
  setModelsDeckInvalid,
  staleEmbeddings,
  reindexing,
  handleReindex,
  handleSaveSettings,
}) => {
  const providerStore = useProviders();

  return (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {!appSettingsForm ? (
                <div
                  style={{
                    padding: "24px 0",
                    textAlign: "center",
                    color: "var(--text-secondary)",
                    fontSize: "0.85rem",
                  }}
                >
                  Loading system model configuration...
                </div>
              ) : (
                <form
                  onSubmit={handleSaveSettings}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 14,
                  }}
                >
                  <div className="provider-note">
                    Servers, URLs and tokens are managed in the <strong>Providers</strong> tab. Here you choose
                    which provider and model each role uses.
                    {providerStore.providers.length === 0 && !providerStore.loading && (
                      <> No providers exist yet: add one first.</>
                    )}
                  </div>

                  <ModelDeck
                    scope="admin"
                    actorSelection={{
                      providerId: appSettingsForm.actor_profile.provider_id ?? null,
                      model: appSettingsForm.actor_profile.model,
                    }}
                    onActorSelection={(sel) =>
                      setAppSettingsForm({
                        ...appSettingsForm,
                        actor_profile: {
                          ...appSettingsForm.actor_profile,
                          provider_id: sel.providerId,
                          model: sel.model,
                        },
                      })
                    }
                    actorTemp={appSettingsForm.actor_profile.temperature}
                    onActorTemp={(v) =>
                      setAppSettingsForm({
                        ...appSettingsForm,
                        actor_profile: { ...appSettingsForm.actor_profile, temperature: v },
                      })
                    }
                    actorTokens={appSettingsForm.actor_profile.max_tokens}
                    onActorTokens={(v) =>
                      setAppSettingsForm({
                        ...appSettingsForm,
                        actor_profile: { ...appSettingsForm.actor_profile, max_tokens: v },
                      })
                    }
                    actorKeepAlive={appSettingsForm.actor_profile.keep_alive_minutes ?? 30}
                    onActorKeepAlive={(v) =>
                      setAppSettingsForm({
                        ...appSettingsForm,
                        actor_profile: { ...appSettingsForm.actor_profile, keep_alive_minutes: v },
                      })
                    }
                    actorContextSize={appSettingsForm.actor_profile.context_size ?? DEFAULT_ACTOR_CONTEXT_SIZE}
                    onActorContextSize={(v) =>
                      setAppSettingsForm({
                        ...appSettingsForm,
                        actor_profile: { ...appSettingsForm.actor_profile, context_size: v },
                      })
                    }
                    clerkSelection={{
                      providerId: appSettingsForm.clerk_profile.provider_id ?? null,
                      model: appSettingsForm.clerk_profile.model,
                    }}
                    onClerkSelection={(sel) => {
                      const newProv = sel.providerId ? providerStore.byId(sel.providerId) : null;
                      const isOllama =
                        !newProv || newProv.type === "ollama" || newProv.type === "browser_ollama";
                      setAppSettingsForm({
                        ...appSettingsForm,
                        clerk_profile: {
                          ...appSettingsForm.clerk_profile,
                          provider_id: sel.providerId,
                          model: sel.model,
                          run_on_cpu: isOllama ? appSettingsForm.clerk_profile.run_on_cpu : false,
                        },
                      });
                    }}
                    clerkTemp={appSettingsForm.clerk_profile.temperature}
                    onClerkTemp={(v) =>
                      setAppSettingsForm({
                        ...appSettingsForm,
                        clerk_profile: { ...appSettingsForm.clerk_profile, temperature: v },
                      })
                    }
                    clerkTokens={appSettingsForm.clerk_profile.max_tokens}
                    onClerkTokens={(v) =>
                      setAppSettingsForm({
                        ...appSettingsForm,
                        clerk_profile: { ...appSettingsForm.clerk_profile, max_tokens: v },
                      })
                    }
                    clerkKeepAlive={appSettingsForm.clerk_profile.keep_alive_minutes ?? 30}
                    onClerkKeepAlive={(v) =>
                      setAppSettingsForm({
                        ...appSettingsForm,
                        clerk_profile: { ...appSettingsForm.clerk_profile, keep_alive_minutes: v },
                      })
                    }
                    clerkContextSize={appSettingsForm.clerk_profile.context_size ?? DEFAULT_CLERK_CONTEXT_SIZE}
                    onClerkContextSize={(v) =>
                      setAppSettingsForm({
                        ...appSettingsForm,
                        clerk_profile: { ...appSettingsForm.clerk_profile, context_size: v },
                      })
                    }
                    clerkMirrorsActor={!!appSettingsForm.clerk_mirrors_actor}
                    onToggleClerkMirror={(val) =>
                      setAppSettingsForm({
                        ...appSettingsForm,
                        clerk_mirrors_actor: val,
                      })
                    }
                    clerkRunOnCpu={!!appSettingsForm.clerk_profile.run_on_cpu}
                    onToggleClerkRunOnCpu={(val) =>
                      setAppSettingsForm({
                        ...appSettingsForm,
                        clerk_profile: {
                          ...appSettingsForm.clerk_profile,
                          run_on_cpu: val,
                        },
                      })
                    }
                    vectorMode={appSettingsForm.embedding_profile.mode}
                    onChangeVectorMode={(mode) =>
                      setAppSettingsForm({
                        ...appSettingsForm,
                        embedding_profile: {
                          ...appSettingsForm.embedding_profile,
                          mode,
                        },
                      })
                    }
                    vectorSelection={{
                      providerId: appSettingsForm.embedding_profile.provider_id ?? null,
                      model: appSettingsForm.embedding_profile.model,
                    }}
                    onVectorSelection={(sel) =>
                      setAppSettingsForm({
                        ...appSettingsForm,
                        embedding_profile: {
                          ...appSettingsForm.embedding_profile,
                          provider_id: sel.providerId,
                          model: sel.model,
                        },
                      })
                    }
                    workingMemoryTurns={appSettingsForm.memory_config.working_memory_turns}
                    onWorkingMemoryTurns={(v) =>
                      setAppSettingsForm({
                        ...appSettingsForm,
                        memory_config: { ...appSettingsForm.memory_config, working_memory_turns: v },
                      })
                    }
                    episodicChunkSize={appSettingsForm.memory_config.episodic_chunk_size}
                    onEpisodicChunkSize={(v) =>
                      setAppSettingsForm({
                        ...appSettingsForm,
                        memory_config: { ...appSettingsForm.memory_config, episodic_chunk_size: v },
                      })
                    }
                    maxSceneFlags={appSettingsForm.memory_config.max_scene_flags ?? 10}
                    onMaxSceneFlags={(v) =>
                      setAppSettingsForm({
                        ...appSettingsForm,
                        memory_config: { ...appSettingsForm.memory_config, max_scene_flags: v },
                      })
                    }
                    ephemeralLifespan={appSettingsForm.memory_config.ephemeral_memory_lifespan_turns ?? 40}
                    onEphemeralLifespan={(v) =>
                      setAppSettingsForm({
                        ...appSettingsForm,
                        memory_config: { ...appSettingsForm.memory_config, ephemeral_memory_lifespan_turns: v },
                      })
                    }
                    minWorkingMemoryTurns={appSettingsForm.memory_config.min_working_memory_turns ?? 4}
                    onMinWorkingMemoryTurns={(v) =>
                      setAppSettingsForm({
                        ...appSettingsForm,
                        memory_config: { ...appSettingsForm.memory_config, min_working_memory_turns: v },
                      })
                    }
                    lodSummaryChunks={appSettingsForm.memory_config.lod_summary_chunks ?? 6}
                    onLodSummaryChunks={(v) =>
                      setAppSettingsForm({
                        ...appSettingsForm,
                        memory_config: { ...appSettingsForm.memory_config, lod_summary_chunks: v },
                      })
                    }
                    lodImportanceBonus={appSettingsForm.memory_config.lod_importance_bonus ?? 2}
                    onLodImportanceBonus={(v) =>
                      setAppSettingsForm({
                        ...appSettingsForm,
                        memory_config: { ...appSettingsForm.memory_config, lod_importance_bonus: v },
                      })
                    }
                    zone2BudgetSharePct={appSettingsForm.memory_config.zone2_budget_share_pct ?? 45}
                    onZone2BudgetSharePct={(v) =>
                      setAppSettingsForm({
                        ...appSettingsForm,
                        memory_config: { ...appSettingsForm.memory_config, zone2_budget_share_pct: v },
                      })
                    }
                    recallBudgetProseTokens={appSettingsForm.memory_config.recall_budget_prose_tokens ?? 450}
                    onRecallBudgetProseTokens={(v) =>
                      setAppSettingsForm({
                        ...appSettingsForm,
                        memory_config: { ...appSettingsForm.memory_config, recall_budget_prose_tokens: v },
                      })
                    }
                    recallBudgetCognitionTokens={appSettingsForm.memory_config.recall_budget_cognition_tokens ?? 220}
                    onRecallBudgetCognitionTokens={(v) =>
                      setAppSettingsForm({
                        ...appSettingsForm,
                        memory_config: { ...appSettingsForm.memory_config, recall_budget_cognition_tokens: v },
                      })
                    }
                    staleEmbeddingsCount={staleEmbeddings}
                    reindexing={reindexing}
                    onReindex={handleReindex}
                    onInvalidChange={setModelsDeckInvalid}
                  />

                  {/* LLM Resilience (governs Actor/Clerk failure handling, not embeddings) */}
                  <div className="model-role-card">
                    <div className="model-role-title">LLM Resilience & Fallback</div>
                    <label className="provider-inline-check" style={{ fontSize: "0.82rem" }}>
                      <input
                        type="checkbox"
                        checked={appSettingsForm.allow_offline_fallback}
                        onChange={(e) =>
                          setAppSettingsForm({
                            ...appSettingsForm,
                            allow_offline_fallback: e.target.checked,
                          })
                        }
                      />
                      Allow heuristic offline simulation if a provider is unreachable
                    </label>
                    <div className="form-hint" style={{ fontSize: "0.74rem" }}>
                      When off, a failing provider produces an error instead of simulated output. A model is never
                      silently re-routed to a different provider.
                    </div>
                  </div>

                  {/* Provider & model override policies */}
                  <div
                    className="model-role-card"
                    style={{
                      background: appSettingsForm.allow_user_providers
                        ? "rgba(16, 185, 129, 0.08)"
                        : "var(--bg-card)",
                    }}
                  >
                    <div className="model-role-title">User policies</div>
                    <label className="provider-inline-check" style={{ fontSize: "0.84rem" }}>
                      <input
                        type="checkbox"
                        checked={!!appSettingsForm.allow_user_providers}
                        onChange={(e) =>
                          setAppSettingsForm({
                            ...appSettingsForm,
                            allow_user_providers: e.target.checked,
                            allow_user_model_overrides: e.target.checked
                              ? true
                              : appSettingsForm.allow_user_model_overrides,
                          })
                        }
                      />
                      <strong>Allow users to add their own providers (BYOP)</strong>
                    </label>
                    <div className="form-hint" style={{ fontSize: "0.74rem", paddingLeft: 22 }}>
                      Personal providers are private to their owner and cannot target local or private-network
                      addresses. System providers stay available to everyone.
                    </div>

                    <label className="provider-inline-check" style={{ fontSize: "0.84rem" }}>
                      <input
                        type="checkbox"
                        checked={
                          !!appSettingsForm.allow_user_providers ||
                          appSettingsForm.allow_user_model_overrides
                        }
                        disabled={!!appSettingsForm.allow_user_providers}
                        onChange={(e) =>
                          setAppSettingsForm({
                            ...appSettingsForm,
                            allow_user_model_overrides: e.target.checked,
                          })
                        }
                      />
                      <strong>Allow per-user model overrides</strong>
                      {appSettingsForm.allow_user_providers && (
                        <span className="scope-badge scope-badge--system">Locked on (required by BYOP)</span>
                      )}
                    </label>
                    <div className="form-hint" style={{ fontSize: "0.74rem", paddingLeft: 22 }}>
                      Users can pick their own provider, model and sampling in Profile → Models. When off, the
                      defaults above apply to everyone.
                    </div>
                  </div>

                  {/* Character Agent Dispatch Mode */}
                  <div
                    style={{
                      background: "var(--bg-card)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: 8,
                      padding: 14,
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    <label
                      style={{
                        fontWeight: 600,
                        fontSize: "0.86rem",
                        color: "var(--text-primary)",
                      }}
                    >
                      Character Agent Dispatch Mode
                    </label>
                    <select
                      className="field-select"
                      value={appSettingsForm.agent_dispatch_mode ?? "sequential"}
                      onChange={(e) =>
                        setAppSettingsForm({
                          ...appSettingsForm,
                          agent_dispatch_mode: e.target.value as "sequential" | "parallel",
                        })
                      }
                    >
                      <option value="sequential">
                        Sequential — One Agent at a Time (Recommended for Single Local GPU / Ollama)
                      </option>
                      <option value="parallel">
                        Parallel — Concurrent Dispatch (Cloud APIs / Multi-Slot vLLM)
                      </option>
                    </select>
                    <p
                      style={{
                        fontSize: "0.76rem",
                        color: "var(--text-secondary)",
                        margin: 0,
                      }}
                    >
                      Controls whether per-character state agents execute one-by-one (avoiding queue timeouts on single-GPU setups) or concurrently via asyncio.gather.
                    </p>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: 10,
                      marginTop: 4,
                    }}
                  >
                    <button
                      type="submit"
                      className="btn btn-amber"
                      disabled={
                        savingSettings ||
                        modelsDeckInvalid > 0 ||
                        (providerStore.providers.length > 0 &&
                          (!appSettingsForm.actor_profile.provider_id ||
                            !appSettingsForm.actor_profile.model ||
                            (!appSettingsForm.clerk_mirrors_actor &&
                              (!appSettingsForm.clerk_profile.provider_id ||
                                !appSettingsForm.clerk_profile.model))))
                      }
                    >
                      <Check size={14} />
                      <span>
                        {savingSettings
                          ? "Saving Settings..."
                          : "Save System Model Settings"}
                      </span>
                    </button>
                  </div>
                </form>
              )}
            </div>
  );
};
