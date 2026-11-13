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
};
