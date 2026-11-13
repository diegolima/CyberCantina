import type {
  CampaignStateBundle,
  LocationContainer,
  LocationEdge,
  LocationNode,
  WorldMapDraft,
  WorldMapReimagineRequest,
  WorldRecord,
  WorldWizardDraft,
  WorldWizardSeed,
} from "../types";
import { API_BASE, fetchJson } from "./client";

export const worldsApi = {
  listWorlds: () => fetchJson<WorldRecord[]>(`${API_BASE}/worlds`),

  getWorld: (worldId: string) => fetchJson<WorldRecord>(`${API_BASE}/worlds/${worldId}`),

  draftWorld: (seed: WorldWizardSeed) =>
    fetchJson<WorldWizardDraft>(`${API_BASE}/wizards/world/draft`, {
      method: "POST",
      body: JSON.stringify(seed),
    }),

  reimagineWorldMap: (req: WorldMapReimagineRequest) =>
    fetchJson<WorldMapDraft>(`${API_BASE}/wizards/world/reimagine-map`, {
      method: "POST",
      body: JSON.stringify(req),
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
      "name" | "global_rules" | "containers" | "locations" | "edges" | "lore_nodes"
    >
  ) =>
    fetchJson<WorldRecord>(`${API_BASE}/worlds/${worldId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  updateCampaignMap: (
    campaignId: string,
    payload: {
      containers: LocationContainer[];
      locations: LocationNode[];
      edges: LocationEdge[];
    }
  ) =>
    fetchJson<CampaignStateBundle>(`${API_BASE}/campaigns/${campaignId}/map`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  deleteWorldContainer: (
    worldId: string,
    containerId: string,
    opts?: {
      reassign_to_container_id?: string | null;
      unparent_children?: boolean;
      lore_disposal?: "delete" | "reassign" | "promote_to_world";
    }
  ) => {
    const params = new URLSearchParams();
    if (opts?.reassign_to_container_id) {
      params.set("reassign_to_container_id", opts.reassign_to_container_id);
    }
    if (opts?.unparent_children) {
      params.set("unparent_children", "true");
    }
    if (opts?.lore_disposal) {
      params.set("lore_disposal", opts.lore_disposal);
    }
    const qs = params.toString();
    return fetchJson<WorldRecord>(
      `${API_BASE}/worlds/${worldId}/containers/${containerId}${qs ? `?${qs}` : ""}`,
      {
        method: "DELETE",
      }
    );
  },

  convertLocationToContainer: (
    worldId: string,
    locationId: string,
    payload: {
      container_name: string;
      container_depth?: 1 | 2 | 3 | 4;
      parent_container_id?: string | null;
      initial_interior_name?: string;
      initial_interior_summary?: string;
      initial_interior_description?: string;
      migrate_lore_to_container?: boolean;
    }
  ) =>
    fetchJson<WorldRecord>(
      `${API_BASE}/worlds/${worldId}/locations/${locationId}/convert-to-container`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    ),

  deleteWorld: (worldId: string) =>
    fetchJson<{
      world_id: string;
      pending_deletion: boolean;
      campaigns_using: number;
    }>(`${API_BASE}/worlds/${worldId}`, {
      method: "DELETE",
    }),
};
