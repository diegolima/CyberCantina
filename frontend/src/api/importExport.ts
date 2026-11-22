import type {
  ExportBundleRequest,
  ExportCampaignRequest,
  ImportCommitRequest,
  ImportCommitResponse,
  ImportInspectResponse,
  ImportUnlockRequest,
} from "../types";
import {
  API_BASE,
  fetchJson,
  fetchBlob,
  triggerDownload,
} from "./client";

export const importExportApi = {
  exportBundle: async (payload: ExportBundleRequest) => {
    const { blob, filename } = await fetchBlob(`${API_BASE}/export/bundle`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    triggerDownload(blob, filename || `${payload.bundle_name || "cybercantina_export"}.zcc`);
    return blob;
  },

  exportCampaign: async (campaignId: string, payload: ExportCampaignRequest) => {
    const { blob, filename } = await fetchBlob(
      `${API_BASE}/export/campaign/${encodeURIComponent(campaignId)}`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    );
    triggerDownload(blob, filename || `campaign_${campaignId}.zcc`);
    return blob;
  },

  exportCharacter: async (
    characterId: string,
    includeWorld: boolean = false,
    includeVideos: boolean = false,
    password?: string | null
  ) => {
    const url = `${API_BASE}/export/character/${encodeURIComponent(characterId)}`;
    const { blob, filename } = password
      ? await fetchBlob(url, {
          method: "POST",
          body: JSON.stringify({
            include_world: includeWorld,
            include_videos: includeVideos,
            password,
          }),
        })
      : await fetchBlob(
          `${url}?include_world=${includeWorld}&include_videos=${includeVideos}`
        );
    triggerDownload(blob, filename || `character_${characterId}.zcc`);
    return blob;
  },

  exportWorld: async (
    worldId: string,
    includeCharacters: boolean = true,
    includeMedia: boolean = true,
    includeVideos: boolean = false,
    password?: string | null
  ) => {
    const url = `${API_BASE}/export/world/${encodeURIComponent(worldId)}`;
    const { blob, filename } = password
      ? await fetchBlob(url, {
          method: "POST",
          body: JSON.stringify({
            include_characters: includeCharacters,
            include_media: includeMedia,
            include_videos: includeVideos,
            password,
          }),
        })
      : await fetchBlob(
          `${url}?include_characters=${includeCharacters}&include_media=${includeMedia}&include_videos=${includeVideos}`
        );
    triggerDownload(blob, filename || `world_${worldId}.zcc`);
    return blob;
  },

  inspectImport: (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return fetchJson<ImportInspectResponse>(`${API_BASE}/import/inspect`, {
      method: "POST",
      body: formData,
    });
  },

  unlockImport: (payload: ImportUnlockRequest) => {
    return fetchJson<ImportInspectResponse>(`${API_BASE}/import/unlock`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  commitImport: (payload: ImportCommitRequest) => {
    return fetchJson<ImportCommitResponse>(`${API_BASE}/import/commit`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
};
