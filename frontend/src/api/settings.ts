import type {
  AppSettings,
  OllamaStatusResponse,
  ProfileModelSettingsResponse,
  SettingsUpdateResponse,
  PromptEnrichRequest,
  PromptEnrichResponse,
  UserModelSettingsPayload,
} from "../types";
import { API_BASE, fetchJson } from "./client";

export const settingsApi = {
  getSettings: () => fetchJson<AppSettings>(`${API_BASE}/settings`),

  updateSettings: (settings: AppSettings) =>
    fetchJson<SettingsUpdateResponse>(`${API_BASE}/settings`, {
      method: "PUT",
      body: JSON.stringify(settings),
    }),

  getEmbeddingStatus: () =>
    fetchJson<{ fingerprint: string; stale_entries: number }>(
      `${API_BASE}/admin/embeddings/status`
    ),

  reindexEmbeddings: () =>
    fetchJson<{ reindexed: number }>(`${API_BASE}/admin/embeddings/reindex`, {
      method: "POST",
    }),

  getProfileModels: () =>
    fetchJson<ProfileModelSettingsResponse>(`${API_BASE}/profile/models`),

  updateProfileModels: (payload: UserModelSettingsPayload) =>
    fetchJson<ProfileModelSettingsResponse>(`${API_BASE}/profile/models`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  resetProfileModels: () =>
    fetchJson<ProfileModelSettingsResponse>(`${API_BASE}/profile/models`, {
      method: "DELETE",
    }),

  enrichPrompt: (req: PromptEnrichRequest, signal?: AbortSignal) =>
    fetchJson<PromptEnrichResponse>(`${API_BASE}/enrich`, {
      method: "POST",
      body: JSON.stringify(req),
      signal,
    }),

  getOllamaStatus: (baseUrl?: string) => {
    const q = baseUrl ? `?base_url=${encodeURIComponent(baseUrl)}` : "";
    return fetchJson<OllamaStatusResponse>(`${API_BASE}/ollama/status${q}`);
  },
};
