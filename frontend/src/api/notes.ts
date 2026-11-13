import type { CreateNotePayload, UpdateNotePayload, UserNote } from "../types";
import { API_BASE, fetchJson } from "./client";

export const notesApi = {
  listNotes: () => fetchJson<UserNote[]>(`${API_BASE}/notes`),

  createNote: (payload: CreateNotePayload) =>
    fetchJson<UserNote>(`${API_BASE}/notes`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getNote: (noteId: string) =>
    fetchJson<UserNote>(`${API_BASE}/notes/${encodeURIComponent(noteId)}`),

  updateNote: (noteId: string, payload: UpdateNotePayload) =>
    fetchJson<UserNote>(`${API_BASE}/notes/${encodeURIComponent(noteId)}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  deleteNote: (noteId: string) =>
    fetchJson<{ status: string; id: string }>(
      `${API_BASE}/notes/${encodeURIComponent(noteId)}`,
      {
        method: "DELETE",
      }
    ),
};
