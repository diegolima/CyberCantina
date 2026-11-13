import type {
  CampaignRecord,
  PromptDefaultsResponse,
  PromptPresetCreatePayload,
  PromptPresetRecord,
  PromptPresetUpdatePayload,
} from "../types";
import { API_BASE, fetchJson } from "./client";

export const promptsApi = {
  getPromptDefaults: () =>
    fetchJson<PromptDefaultsResponse>(`${API_BASE}/prompts/defaults`),

  listPromptPresets: () =>
    fetchJson<PromptPresetRecord[]>(`${API_BASE}/prompts/presets`),

  getPromptPreset: (id: string) =>
    fetchJson<PromptPresetRecord>(`${API_BASE}/prompts/presets/${id}`),

  createPromptPreset: (payload: PromptPresetCreatePayload) =>
    fetchJson<PromptPresetRecord>(`${API_BASE}/prompts/presets`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  updatePromptPreset: (id: string, payload: PromptPresetUpdatePayload) =>
    fetchJson<PromptPresetRecord>(`${API_BASE}/prompts/presets/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  deletePromptPreset: (id: string) =>
    fetchJson<{ status: string; id: string }>(`${API_BASE}/prompts/presets/${id}`, {
      method: "DELETE",
    }),

  resetPromptPreset: (id: string) =>
    fetchJson<PromptPresetRecord>(`${API_BASE}/prompts/presets/${id}/reset`, {
      method: "POST",
    }),

  getActivePromptPreset: () =>
    fetchJson<{ active_prompt_preset_id: string | null }>(`${API_BASE}/prompts/active`),

  setActivePromptPreset: (presetId: string | null) =>
    fetchJson<{ status: string; active_prompt_preset_id: string | null }>(
      `${API_BASE}/prompts/active`,
      {
        method: "PUT",
        body: JSON.stringify({ preset_id: presetId }),
      }
    ),

  setCampaignPromptPreset: (campaignId: string, presetId: string | null) =>
    fetchJson<CampaignRecord>(`${API_BASE}/campaigns/${campaignId}/prompt-preset`, {
      method: "PUT",
      body: JSON.stringify({ preset_id: presetId }),
    }),
};
