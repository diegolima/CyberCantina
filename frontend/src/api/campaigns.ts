import type {
  CampaignRecord,
  CampaignStateBundle,
  CharacterChoiceSet,
  ChoicePreviewResponse,
  CreateCampaignPayload,
  DiceMode,
  ItemEquipActionPayload,
  LocationLoreNodeDraft,
  MemoryShard,
  PersonaTurnStateSnapshot,
} from "../types";
import { API_BASE, fetchJson } from "./client";

export const campaignsApi = {
  listCampaigns: () => fetchJson<CampaignRecord[]>(`${API_BASE}/campaigns`),

  createCampaign: (payload: CreateCampaignPayload) =>
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

  getCampaignPersonaState: (campaignId: string) =>
    fetchJson<PersonaTurnStateSnapshot | null>(
      `${API_BASE}/campaigns/${campaignId}/persona-state`
    ),

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

  toggleItemEquip: (campaignId: string, payload: ItemEquipActionPayload) =>
    fetchJson<CampaignStateBundle>(
      `${API_BASE}/campaigns/${campaignId}/item-equip`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    ),

  updateCampaignCharacterMemories: (
    campaignId: string,
    characterId: string,
    memoryShards: MemoryShard[]
  ) =>
    fetchJson<CampaignStateBundle>(
      `${API_BASE}/campaigns/${campaignId}/characters/${characterId}/memories`,
      {
        method: "POST",
        body: JSON.stringify({ memory_shards: memoryShards }),
      }
    ),

  updateCampaignLocationLore: (
    campaignId: string,
    locationId: string,
    loreNodes: LocationLoreNodeDraft[]
  ) =>
    fetchJson<CampaignStateBundle>(
      `${API_BASE}/campaigns/${campaignId}/locations/${locationId}/lore`,
      {
        method: "PUT",
        body: JSON.stringify({ lore_nodes: loreNodes }),
      }
    ),

  updateCampaignContainerLore: (
    campaignId: string,
    containerId: string,
    loreNodes: LocationLoreNodeDraft[]
  ) =>
    fetchJson<CampaignStateBundle>(
      `${API_BASE}/campaigns/${campaignId}/containers/${containerId}/lore`,
      {
        method: "PUT",
        body: JSON.stringify({ lore_nodes: loreNodes }),
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

  connectCampaignLocations: (
    campaignId: string,
    payload: {
      from_location_id: string;
      to_location_id: string;
      direction_label?: string;
      compass_direction: string;
      travel_minutes: number;
      bidirectional?: boolean;
    }
  ) =>
    fetchJson<CampaignStateBundle>(`${API_BASE}/campaigns/${campaignId}/edges`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  updateCampaignEdgeDistance: (
    campaignId: string,
    edgeId: string,
    travelMinutes: number,
    updateReciprocal: boolean = true
  ) =>
    fetchJson<CampaignStateBundle>(
      `${API_BASE}/campaigns/${campaignId}/edges/${edgeId}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          travel_minutes: travelMinutes,
          update_reciprocal: updateReciprocal,
        }),
      }
    ),

  removeCampaignEdge: (
    campaignId: string,
    edgeId: string,
    removeReciprocal: boolean = true
  ) =>
    fetchJson<CampaignStateBundle>(
      `${API_BASE}/campaigns/${campaignId}/edges/${edgeId}?remove_reciprocal=${removeReciprocal}`,
      {
        method: "DELETE",
      }
    ),

  deleteLastTurn: (campaignId: string) =>
    fetchJson<CampaignStateBundle>(
      `${API_BASE}/campaigns/${campaignId}/turns/last`,
      {
        method: "DELETE",
      }
    ),

  previewChoices: (
    req: {
      choice_set: CharacterChoiceSet;
      dice_mode?: DiceMode;
      manual_dice_override?: number | null;
    },
    signal?: AbortSignal
  ) =>
    fetchJson<ChoicePreviewResponse>(`${API_BASE}/mechanics/choice-preview`, {
      method: "POST",
      body: JSON.stringify(req),
      signal,
    }),
};
