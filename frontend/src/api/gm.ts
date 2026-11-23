import type {
  CampaignWorldLoreEntryUpsertResponse,
  GmCodexDraftResponse,
  GmCodexProposal,
  GmMentionCategory,
  GmMentionRef,
  GmMentionsResponse,
  GmMessagesResponse,
  GmStreamCodexProposalEvent,
  GmStreamDoneEvent,
  GmStreamMetaEvent,
  WorldLoreNodeDraft,
} from "../types";
import {
  API_BASE,
  buildAuthHeaders,
  fetchJson,
  notifyUnauthorized,
  parseApiErrorText,
} from "./client";

export interface GmStreamCallbacks {
  onMeta?: (meta: GmStreamMetaEvent) => void;
  onToken?: (delta: string) => void;
  onCodexProposal?: (event: GmStreamCodexProposalEvent) => void;
  onDone?: (data: GmStreamDoneEvent) => void;
  onError?: (detail: string) => void;
}

export const gmApi = {
  getGmMessages: (campaignId: string) =>
    fetchJson<GmMessagesResponse>(
      `${API_BASE}/campaigns/${encodeURIComponent(campaignId)}/gm/messages`
    ),

  clearGmMessages: (campaignId: string) =>
    fetchJson<{ cleared: boolean; deleted: number }>(
      `${API_BASE}/campaigns/${encodeURIComponent(campaignId)}/gm/messages`,
      { method: "DELETE" }
    ),

  searchGmMentions: (
    campaignId: string,
    params?: {
      category?: GmMentionCategory;
      q?: string;
      limit?: number;
    },
    signal?: AbortSignal
  ) => {
    const qs = new URLSearchParams();
    if (params?.category) qs.set("category", params.category);
    if (params?.q) qs.set("q", params.q);
    if (params?.limit !== undefined) qs.set("limit", String(params.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return fetchJson<GmMentionsResponse>(
      `${API_BASE}/campaigns/${encodeURIComponent(campaignId)}/gm/mentions${suffix}`,
      { signal }
    );
  },

  streamGmChat: async (
    campaignId: string,
    payload: { message: string; mentions: GmMentionRef[] },
    callbacks: GmStreamCallbacks,
    signal?: AbortSignal
  ): Promise<void> => {
    const response = await fetch(
      `${API_BASE}/campaigns/${encodeURIComponent(campaignId)}/gm/chat`,
      {
        method: "POST",
        credentials: "include",
        headers: buildAuthHeaders(),
        body: JSON.stringify(payload),
        signal,
      }
    );

    if (!response.ok || !response.body) {
      const text = await response.text();
      if (response.status === 401) {
        notifyUnauthorized();
      }
      throw new Error(
        `GM stream failed (${response.status}): ${parseApiErrorText(response.status, text)}`
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        if (!block.trim()) continue;
        let eventName = "message";
        let dataJson = "";
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) {
            eventName = line.slice("event:".length).trim();
          } else if (line.startsWith("data:")) {
            dataJson += line.slice("data:".length).trim();
          }
        }
        if (!dataJson) continue;
        const parsed = JSON.parse(dataJson);

        switch (eventName) {
          case "meta":
            callbacks.onMeta?.(parsed as GmStreamMetaEvent);
            break;
          case "token":
            if (typeof parsed?.text === "string") {
              callbacks.onToken?.(parsed.text);
            }
            break;
          case "codex_proposal":
            callbacks.onCodexProposal?.(parsed as GmStreamCodexProposalEvent);
            break;
          case "done":
            callbacks.onDone?.(parsed as GmStreamDoneEvent);
            break;
          case "error":
            callbacks.onError?.(
              typeof parsed?.detail === "string"
                ? parsed.detail
                : "Neuromancer encountered an error."
            );
            break;
        }
      }
    }
  },

  draftGmCodexEntry: (
    campaignId: string,
    payload: { message_id?: string; instruction?: string }
  ) =>
    fetchJson<GmCodexDraftResponse>(
      `${API_BASE}/campaigns/${encodeURIComponent(campaignId)}/gm/codex-draft`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    ),

  saveCampaignWorldLoreEntry: (
    campaignId: string,
    payload: {
      draft: WorldLoreNodeDraft;
      replace_lore_id?: string | null;
      proposal_message_id?: string | null;
      proposal_id?: string | null;
    }
  ) =>
    fetchJson<CampaignWorldLoreEntryUpsertResponse>(
      `${API_BASE}/campaigns/${encodeURIComponent(campaignId)}/lore/entries`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    ),

  cancelGmProposal: (campaignId: string, proposalId: string) =>
    fetchJson<{ proposal: GmCodexProposal }>(
      `${API_BASE}/campaigns/${encodeURIComponent(campaignId)}/gm/proposals/${encodeURIComponent(
        proposalId
      )}`,
      {
        method: "PATCH",
        body: JSON.stringify({ status: "cancelled" }),
      }
    ),
};
