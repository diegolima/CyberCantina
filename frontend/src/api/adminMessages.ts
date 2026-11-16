import type {
  AdminMessageListResponse,
  AdminMessageRecord,
  AdminMessageWritePayload,
  MessageUrgency,
  PublicAdminMessage,
} from "../types";
import { API_BASE, fetchJson } from "./client";

export const adminMessagesApi = {
  getHomeMessages: () =>
    fetchJson<PublicAdminMessage[]>(`${API_BASE}/messages/home`),

  adminListMessages: () =>
    fetchJson<AdminMessageListResponse>(`${API_BASE}/admin/messages`),

  adminCreateMessage: (payload: AdminMessageWritePayload) =>
    fetchJson<AdminMessageRecord>(`${API_BASE}/admin/messages`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  adminUpdateMessage: (messageId: string, payload: AdminMessageWritePayload) =>
    fetchJson<AdminMessageRecord>(
      `${API_BASE}/admin/messages/${encodeURIComponent(messageId)}`,
      {
        method: "PUT",
        body: JSON.stringify(payload),
      }
    ),

  adminDeleteMessage: (messageId: string) =>
    fetchJson<{ status: string; id: string }>(
      `${API_BASE}/admin/messages/${encodeURIComponent(messageId)}`,
      {
        method: "DELETE",
      }
    ),

  adminReorderMessages: (urgency: MessageUrgency, orderedIds: string[]) =>
    fetchJson<AdminMessageRecord[]>(`${API_BASE}/admin/messages/reorder`, {
      method: "PUT",
      body: JSON.stringify({ urgency, ordered_ids: orderedIds }),
    }),
};
