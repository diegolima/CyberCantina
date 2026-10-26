import {
  AppSettings,
  CampaignRecord,
  CampaignStateBundle,
  CharacterRecord,
  CharacterWizardDraft,
  CharacterWizardSeed,
  CognitionBlock,
  OllamaStatusResponse,
  PreTurnAnalysis,
  RecalledMemoryItem,
  TurnNodeRecord,
  WorldRecord,
  WorldWizardDraft,
  WorldWizardSeed,
} from "./types";

const API_BASE = "/api";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`API Error (${res.status}): ${errText}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getSettings: () => fetchJson<AppSettings>(`${API_BASE}/settings`),
  updateSettings: (settings: AppSettings) =>
    fetchJson<AppSettings>(`${API_BASE}/settings`, {
      method: "PUT",
      body: JSON.stringify(settings),
    }),
  getOllamaStatus: (baseUrl?: string) => {
    const q = baseUrl ? `?base_url=${encodeURIComponent(baseUrl)}` : "";
    return fetchJson<OllamaStatusResponse>(`${API_BASE}/ollama/status${q}`);
  },

  listWorlds: () => fetchJson<WorldRecord[]>(`${API_BASE}/worlds`),
  getWorld: (worldId: string) => fetchJson<WorldRecord>(`${API_BASE}/worlds/${worldId}`),
  draftWorld: (seed: WorldWizardSeed) =>
    fetchJson<WorldWizardDraft>(`${API_BASE}/wizards/world/draft`, {
      method: "POST",
      body: JSON.stringify(seed),
    }),
  commitWorld: (draft: WorldWizardDraft) =>
    fetchJson<WorldRecord>(`${API_BASE}/wizards/world/commit`, {
      method: "POST",
      body: JSON.stringify(draft),
    }),
  updateWorld: (
    worldId: string,
    payload: Pick<
      WorldRecord,
      "name" | "global_rules" | "locations" | "edges" | "lore_nodes"
    >
  ) =>
    fetchJson<WorldRecord>(`${API_BASE}/worlds/${worldId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  deleteWorld: (worldId: string) =>
    fetchJson<{
      world_id: string;
      pending_deletion: boolean;
      campaigns_using: number;
    }>(`${API_BASE}/worlds/${worldId}`, {
      method: "DELETE",
    }),

  listCharacters: () => fetchJson<CharacterRecord[]>(`${API_BASE}/characters`),
  getCharacter: (characterId: string) =>
    fetchJson<CharacterRecord>(`${API_BASE}/characters/${characterId}`),
  draftCharacter: (seed: CharacterWizardSeed) =>
    fetchJson<CharacterWizardDraft>(`${API_BASE}/wizards/character/draft`, {
      method: "POST",
      body: JSON.stringify(seed),
    }),
  commitCharacter: (draft: CharacterWizardDraft, worldId?: string | null) =>
    fetchJson<CharacterRecord>(`${API_BASE}/wizards/character/commit`, {
      method: "POST",
      body: JSON.stringify({ draft, world_id: worldId ?? null }),
    }),
  updateCharacter: (
    characterId: string,
    payload: CharacterWizardDraft & { world_id?: string | null }
  ) =>
    fetchJson<CharacterRecord>(`${API_BASE}/characters/${characterId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  deleteCharacter: (characterId: string) =>
    fetchJson<{
      character_id: string;
      pending_deletion: boolean;
      campaigns_using: number;
    }>(`${API_BASE}/characters/${characterId}`, {
      method: "DELETE",
    }),

  listCampaigns: () => fetchJson<CampaignRecord[]>(`${API_BASE}/campaigns`),
  createCampaign: (payload: {
    name: string;
    world_id: string;
    character_id: string;
    opening_prose?: string;
  }) =>
    fetchJson<CampaignStateBundle>(`${API_BASE}/campaigns`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  deleteCampaign: (campaignId: string) =>
    fetchJson<{ status: string; campaign_id: string }>(
      `${API_BASE}/campaigns/${campaignId}`,
      {
        method: "DELETE",
      }
    ),
  getCampaignState: (campaignId: string) =>
    fetchJson<CampaignStateBundle>(`${API_BASE}/campaigns/${campaignId}/state`),
  checkoutBranch: (campaignId: string, turnId: string) =>
    fetchJson<CampaignStateBundle>(`${API_BASE}/campaigns/${campaignId}/checkout`, {
      method: "POST",
      body: JSON.stringify({ turn_id: turnId }),
    }),
  overrideLocation: (campaignId: string, locationId: string) =>
    fetchJson<CampaignStateBundle>(
      `${API_BASE}/campaigns/${campaignId}/location-override`,
      {
        method: "POST",
        body: JSON.stringify({ location_id: locationId }),
      }
    ),
  createLinkedLocation: (
    campaignId: string,
    payload: {
      from_location_id: string;
      name: string;
      compass_direction: string;
      travel_minutes: number;
      description: string;
      environmental_tags: string[];
    }
  ) =>
    fetchJson<CampaignStateBundle>(`${API_BASE}/campaigns/${campaignId}/locations`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  deleteLastTurn: (campaignId: string) =>
    fetchJson<CampaignStateBundle>(
      `${API_BASE}/campaigns/${campaignId}/turns/last`,
      {
        method: "DELETE",
      }
    ),
};

export interface TurnStreamCallbacks {
  onPhase1Complete?: (data: {
    pre_turn: PreTurnAnalysis;
    recalled_items: RecalledMemoryItem[];
  }) => void;
  onCognitionDelta?: (rawBuffer: string) => void;
  onCognitionComplete?: (cognition: CognitionBlock) => void;
  onProseDelta?: (delta: string) => void;
  onTurnSaved?: (turn: TurnNodeRecord) => void;
  onPhase4Complete?: (data: {
    turn: TurnNodeRecord;
    state_bundle: CampaignStateBundle;
  }) => void;
  onError?: (err: string) => void;
}

export async function streamCampaignTurn(
  campaignId: string,
  payload: {
    user_message: string;
    parent_turn_id?: string | null;
    manual_dice_override?: number | null;
    override_location_id?: string | null;
  },
  callbacks: TurnStreamCallbacks
): Promise<void> {
  const response = await fetch(`${API_BASE}/campaigns/${campaignId}/turns/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok || !response.body) {
    const text = await response.text();
    throw new Error(`Stream failed (${response.status}): ${text}`);
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
        case "phase1_complete":
          callbacks.onPhase1Complete?.(parsed);
          break;
        case "cognition_delta":
          callbacks.onCognitionDelta?.(parsed.raw_buffer);
          break;
        case "cognition_complete":
          callbacks.onCognitionComplete?.(parsed);
          break;
        case "prose_delta":
          callbacks.onProseDelta?.(parsed.delta);
          break;
        case "turn_saved":
          callbacks.onTurnSaved?.(parsed);
          break;
        case "phase4_complete":
          callbacks.onPhase4Complete?.(parsed);
          break;
        case "error":
          callbacks.onError?.(parsed.error || "Unknown stream error");
          break;
      }
    }
  }
}
