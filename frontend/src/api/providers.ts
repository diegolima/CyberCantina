import type {
  ClientProbeReport,
  LocalRelayStatusResponse,
  LLMProvider,
  ProviderCreatePayload,
  ProviderDraft,
  ProviderProbeResponse,
  ProviderUpdatePayload,
} from "../types";
import { API_BASE, buildAuthHeaders, fetchJson, parseApiError } from "./client";

export const providersApi = {
  listProviders: (signal?: AbortSignal) =>
    fetchJson<LLMProvider[]>(`${API_BASE}/providers`, { signal }),

  createProvider: (payload: ProviderCreatePayload) =>
    fetchJson<LLMProvider>(`${API_BASE}/providers`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  updateProvider: (id: string, payload: ProviderUpdatePayload) =>
    fetchJson<LLMProvider>(`${API_BASE}/providers/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  deleteProvider: async (id: string) => {
    const res = await fetch(`${API_BASE}/providers/${id}`, {
      method: "DELETE",
      credentials: "include",
      headers: buildAuthHeaders(),
    });
    if (!res.ok) throw parseApiError(res.status, await res.text());
    return (await res.json()) as {
      status: string;
      id: string;
      reset_user_overrides: number;
    };
  },

  probeProvider: (id: string, opts?: { force?: boolean; signal?: AbortSignal }) =>
    fetchJson<ProviderProbeResponse>(
      `${API_BASE}/providers/${id}/probe${opts?.force ? "?force=true" : ""}`,
      { method: "POST", signal: opts?.signal }
    ),

  reportClientProbe: (id: string, report: ClientProbeReport, signal?: AbortSignal) =>
    fetchJson<ProviderProbeResponse>(`${API_BASE}/providers/${id}/client-probe`, {
      method: "POST",
      body: JSON.stringify(report),
      signal,
    }),

  getLocalRelayStatus: () =>
    fetchJson<LocalRelayStatusResponse>(`${API_BASE}/local-relay/status`),

  probeProviderDraft: (draft: ProviderDraft) =>
    fetchJson<ProviderProbeResponse>(`${API_BASE}/providers/probe-draft`, {
      method: "POST",
      body: JSON.stringify(draft),
    }),
};
