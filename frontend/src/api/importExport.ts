import type {
  ExportBundleRequest,
  ImportCommitRequest,
  ImportCommitResponse,
  ImportInspectResponse,
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

  exportCharacter: async (characterId: string, includeWorld: boolean = false) => {
    const { blob, filename } = await fetchBlob(
      `${API_BASE}/export/character/${encodeURIComponent(characterId)}?include_world=${includeWorld}`
    );
    triggerDownload(blob, filename || `character_${characterId}.zcc`);
    return blob;
  },

  exportWorld: async (worldId: string, includeCharacters: boolean = true) => {
    const { blob, filename } = await fetchBlob(
      `${API_BASE}/export/world/${encodeURIComponent(worldId)}?include_characters=${includeCharacters}`
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

  commitImport: (payload: ImportCommitRequest) => {
    return fetchJson<ImportCommitResponse>(`${API_BASE}/import/commit`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
};
