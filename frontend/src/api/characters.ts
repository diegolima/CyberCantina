import type {
  CharacterRecord,
  CharacterSeedUpdateResponse,
  CharacterVersionSummary,
  CharacterWizardDraft,
  CharacterWizardSeed,
  GalleryMediaImpactResponse,
  SeedUpdateRequest,
  SillyTavernImportResponse,
} from "../types";
import { API_BASE, fetchJson } from "./client";

export const charactersApi = {
  listCharacters: () => fetchJson<CharacterRecord[]>(`${API_BASE}/characters`),

  getCharacter: (characterId: string) =>
    fetchJson<CharacterRecord>(`${API_BASE}/characters/${characterId}`),

  listCharacterVersions: (characterId: string) =>
    fetchJson<CharacterVersionSummary[]>(
      `${API_BASE}/characters/${characterId}/versions`
    ),

  getCharacterVersion: (characterId: string, version: number) =>
    fetchJson<CharacterRecord>(
      `${API_BASE}/characters/${characterId}/versions/${version}`
    ),

  restoreCharacterVersion: (characterId: string, version: number) =>
    fetchJson<CharacterRecord>(
      `${API_BASE}/characters/${characterId}/versions/${version}/restore`,
      {
        method: "POST",
      }
    ),

  draftCharacter: (seed: CharacterWizardSeed) =>
    fetchJson<CharacterWizardDraft>(`${API_BASE}/wizards/character/draft`, {
      method: "POST",
      body: JSON.stringify(seed),
    }),

  importSillyTavernCard: (
    file: File,
    autoGenerateWorld: boolean = true,
    worldId?: string | null
  ) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("auto_generate_world", String(autoGenerateWorld));
    if (worldId) {
      formData.append("world_id", worldId);
    }
    return fetchJson<SillyTavernImportResponse>(
      `${API_BASE}/wizards/character/import-sillytavern`,
      {
        method: "POST",
        body: formData,
      }
    );
  },

  commitCharacter: (
    draft: CharacterWizardDraft,
    worldId?: string | null,
    characterId?: string | null
  ) =>
    fetchJson<CharacterRecord>(`${API_BASE}/wizards/character/commit`, {
      method: "POST",
      body: JSON.stringify({
        draft,
        world_id: worldId ?? null,
        character_id: characterId ?? null,
      }),
    }),

  extractCharacterFeatures: (
    characterBio: string,
    existingFeatures: string[]
  ) =>
    fetchJson<{
      extracted_features: string[];
      rewritten_bio: string;
    }>(`${API_BASE}/wizards/character/extract-features`, {
      method: "POST",
      body: JSON.stringify({
        character_bio: characterBio,
        existing_features: existingFeatures,
      }),
    }),

  extractCharacterPersonaTraits: (
    corePersona: string,
    existingMoralCode: string[],
    existingQuirksFlaws: string[]
  ) =>
    fetchJson<{
      extracted_moral_code: string[];
      extracted_quirks_flaws: string[];
      rewritten_core_persona: string;
    }>(`${API_BASE}/wizards/character/extract-persona-traits`, {
      method: "POST",
      body: JSON.stringify({
        core_persona: corePersona,
        existing_moral_code: existingMoralCode,
        existing_quirks_flaws: existingQuirksFlaws,
      }),
    }),

  extractCharacterQuirks: (
    corePersona: string,
    existingQuirks: string[]
  ) =>
    fetchJson<{
      extracted_quirks: string[];
      rewritten_core_persona: string;
    }>(`${API_BASE}/wizards/character/extract-quirks`, {
      method: "POST",
      body: JSON.stringify({
        core_persona: corePersona,
        existing_quirks: existingQuirks,
      }),
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

  uploadCharacterPortrait: (
    characterId: string,
    emotion: string,
    file: File | Blob
  ) => {
    const formData = new FormData();
    formData.append("file", file);
    return fetchJson<CharacterRecord>(
      `${API_BASE}/characters/${characterId}/portraits/${emotion}`,
      {
        method: "POST",
        body: formData,
      }
    );
  },

  deleteCharacterPortrait: (characterId: string, emotion: string) =>
    fetchJson<CharacterRecord>(
      `${API_BASE}/characters/${characterId}/portraits/${emotion}`,
      {
        method: "DELETE",
      }
    ),

  uploadCharacterGalleryImage: (
    characterId: string,
    file: File | Blob,
    caption?: string
  ) => {
    const formData = new FormData();
    formData.append("file", file);
    if (caption) {
      formData.append("caption", caption);
    }
    return fetchJson<CharacterRecord>(
      `${API_BASE}/characters/${characterId}/gallery`,
      {
        method: "POST",
        body: formData,
      }
    );
  },

  deleteCharacterGalleryImage: (characterId: string, imageId: string) =>
    fetchJson<CharacterRecord>(
      `${API_BASE}/characters/${characterId}/gallery/${imageId}`,
      {
        method: "DELETE",
      }
    ),

  getCharacterGalleryImpact: (characterId: string, imageId: string) =>
    fetchJson<GalleryMediaImpactResponse>(
      `${API_BASE}/characters/${characterId}/gallery/${encodeURIComponent(imageId)}/impact`
    ),

  uploadCharacterGalleryVideo: (
    characterId: string,
    file: File | Blob,
    caption?: string,
    linkedImageId?: string | null
  ) => {
    const formData = new FormData();
    formData.append("file", file);
    if (caption && caption.trim()) {
      formData.append("caption", caption.trim());
    }
    if (linkedImageId) {
      formData.append("linked_image_id", linkedImageId);
    }
    return fetchJson<CharacterRecord>(
      `${API_BASE}/characters/${characterId}/gallery/videos`,
      {
        method: "POST",
        body: formData,
      }
    );
  },

  deleteCharacterGalleryVideo: (characterId: string, imageId: string) =>
    fetchJson<CharacterRecord>(
      `${API_BASE}/characters/${characterId}/gallery/${encodeURIComponent(imageId)}/video`,
      {
        method: "DELETE",
      }
    ),

  updateSeededCharacter: (characterId: string, payload: SeedUpdateRequest) =>
    fetchJson<CharacterSeedUpdateResponse>(
      `${API_BASE}/characters/${characterId}/seed-update`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    ),

  dismissCharacterSeedUpdate: (characterId: string) =>
    fetchJson<CharacterRecord>(
      `${API_BASE}/characters/${characterId}/seed-update/dismiss`,
      {
        method: "POST",
      }
    ),
};
