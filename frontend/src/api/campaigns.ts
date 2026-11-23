import type {
  CampaignMajorEventUpdatePayload,
  CampaignRecord,
  CampaignStateBundle,
  CampaignWorldSettings,
  CharacterChoiceSet,
  ChoicePreviewResponse,
  CreateCampaignPayload,
  CreateNpcPartyPayload,
  DiceMode,
  ItemEquipActionPayload,
  LocationLoreNodeDraft,
  LocationOverrideOptions,
  MemoryShard,
  PersonaTurnStateSnapshot,
  TurnBookmarkSummaryResponse,
  TurnBookmarkUpdatePayload,
  TurnNodeRecord,
  WorldLoreNodeDraft,
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

  overrideLocation: (
    campaignId: string,
    locationId: string,
    options?: LocationOverrideOptions
  ) =>
    fetchJson<CampaignStateBundle>(
      `${API_BASE}/campaigns/${campaignId}/location-override`,
      {
        method: "POST",
        body: JSON.stringify({
          location_id: locationId,
          ...(options?.move_mode ? { move_mode: options.move_mode } : {}),
          ...(options?.accompanying_character_ids
            ? { accompanying_character_ids: options.accompanying_character_ids }
            : {}),
        }),
      }
    ),

  overrideCharacterLocation: (
    campaignId: string,
    characterId: string,
    locationId: string
  ) =>
    fetchJson<CampaignStateBundle>(
      `${API_BASE}/campaigns/${campaignId}/characters/${characterId}/location-override`,
      {
        method: "POST",
        body: JSON.stringify({ location_id: locationId }),
      }
    ),

  createNpcParty: (campaignId: string, payload: CreateNpcPartyPayload) =>
    fetchJson<CampaignStateBundle>(`${API_BASE}/campaigns/${campaignId}/parties`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  disbandParty: (campaignId: string, partyId: string) =>
    fetchJson<CampaignStateBundle>(
      `${API_BASE}/campaigns/${campaignId}/parties/${partyId}`,
      {
        method: "DELETE",
      }
    ),

  updateWorldSettings: (campaignId: string, worldSettings: CampaignWorldSettings) =>
    fetchJson<CampaignStateBundle>(
      `${API_BASE}/campaigns/${campaignId}/world-settings`,
      {
        method: "PATCH",
        body: JSON.stringify(worldSettings),
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

  updateCampaignWorldLore: (
    campaignId: string,
    loreNodes: WorldLoreNodeDraft[]
  ) =>
    fetchJson<CampaignStateBundle>(
      `${API_BASE}/campaigns/${campaignId}/lore`,
      {
        method: "PUT",
        body: JSON.stringify({ lore_nodes: loreNodes }),
      }
    ),

  toggleCampaignLoreReveal: (
    campaignId: string,
    loreId: string,
    revealed: boolean
  ) =>
    fetchJson<CampaignStateBundle>(
      `${API_BASE}/campaigns/${campaignId}/lore/${loreId}/reveal`,
      {
        method: "POST",
        body: JSON.stringify({ revealed }),
      }
    ),

  updateCampaignMajorEvent: (
    campaignId: string,
    turnId: string,
    payload: CampaignMajorEventUpdatePayload
  ) =>
    fetchJson<CampaignStateBundle>(
      `${API_BASE}/campaigns/${campaignId}/major-events/${turnId}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      }
    ),

  deleteCampaignMajorEvent: (campaignId: string, turnId: string) =>
    fetchJson<CampaignStateBundle>(
      `${API_BASE}/campaigns/${campaignId}/major-events/${turnId}`,
      {
        method: "DELETE",
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

  updateTurnBookmark: (
    campaignId: string,
    turnId: string,
    payload: TurnBookmarkUpdatePayload
  ) =>
    fetchJson<TurnNodeRecord>(
      `${API_BASE}/campaigns/${campaignId}/turns/${turnId}/bookmark`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      }
    ),

  summarizeTurnForBookmark: (
    campaignId: string,
    turnId: string,
    signal?: AbortSignal
  ) =>
    fetchJson<TurnBookmarkSummaryResponse>(
      `${API_BASE}/campaigns/${campaignId}/turns/${turnId}/bookmark-summary`,
      {
        method: "POST",
        signal,
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
