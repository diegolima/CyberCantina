import type { PersonaCreatePayload, PersonaRecord, PersonaUpdatePayload } from "../types";
import { API_BASE, fetchJson } from "./client";

export const personasApi = {
  listPersonas: () => fetchJson<PersonaRecord[]>(`${API_BASE}/personas`),

  getPersona: (personaId: string) =>
    fetchJson<PersonaRecord>(`${API_BASE}/personas/${personaId}`),

  createPersona: (payload: PersonaCreatePayload) =>
    fetchJson<PersonaRecord>(`${API_BASE}/personas`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  updatePersona: (personaId: string, payload: PersonaUpdatePayload) =>
    fetchJson<PersonaRecord>(`${API_BASE}/personas/${personaId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  deletePersona: (personaId: string) =>
    fetchJson<{ status: string; persona_id: string }>(
      `${API_BASE}/personas/${personaId}`,
      {
        method: "DELETE",
      }
    ),

  uploadPersonaPortrait: (personaId: string, fileBlob: Blob) => {
    const formData = new FormData();
    formData.append("file", fileBlob, "portrait.webp");
    return fetchJson<PersonaRecord>(`${API_BASE}/personas/${personaId}/portrait`, {
      method: "POST",
      body: formData,
    });
  },

  deletePersonaPortrait: (personaId: string) =>
    fetchJson<PersonaRecord>(`${API_BASE}/personas/${personaId}/portrait`, {
      method: "DELETE",
    }),

  uploadPersonaGalleryImage: (personaId: string, file: File, caption?: string) => {
    const formData = new FormData();
    formData.append("file", file);
    if (caption) {
      formData.append("caption", caption);
    }
    return fetchJson<PersonaRecord>(`${API_BASE}/personas/${personaId}/gallery`, {
      method: "POST",
      body: formData,
    });
  },

  deletePersonaGalleryImage: (personaId: string, imageId: string) =>
    fetchJson<PersonaRecord>(`${API_BASE}/personas/${personaId}/gallery/${imageId}`, {
      method: "DELETE",
    }),
};
