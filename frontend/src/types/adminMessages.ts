export type MessagePlacement = "login" | "home" | "both";
export type MessageUrgency = "info" | "warning" | "critical";
export type AdminMessageStatus = "live" | "scheduled" | "expired" | "deleted";

export interface PublicAdminMessage {
  id: string;
  revision: number;
  placement: MessagePlacement;
  title: string;
  message: string;
  urgency: MessageUrgency;
  dismissable: boolean;
  expires_at?: string | null;
}

export interface AdminMessageRecord extends PublicAdminMessage {
  starts_at?: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  status: AdminMessageStatus;
}

export interface AdminMessageWritePayload {
  placement: MessagePlacement;
  title: string;
  message: string;
  urgency: MessageUrgency;
  dismissable: boolean;
  starts_at: string | null;
  expires_at: string | null;
}

export interface AdminMessageListResponse {
  active: AdminMessageRecord[];
  archived: AdminMessageRecord[];
}
