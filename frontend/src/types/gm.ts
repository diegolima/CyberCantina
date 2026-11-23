export type GmModelRole = "primary" | "clerk";

export type GmMentionKind =
  | "character"
  | "persona"
  | "lore"
  | "location"
  | "container"
  | "turn";

export type GmMentionCategory =
  | "characters"
  | "lore"
  | "locations"
  | "containers"
  | "turns";

export interface GmMentionRef {
  kind: GmMentionKind;
  id: string;
  label: string;
}

export interface GmMentionCandidate {
  kind: GmMentionKind;
  category: GmMentionCategory;
  id: string;
  label: string;
  subtitle: string;
  badge: string;
}

export interface GmSourceRef {
  kind: string;
  id: string;
  label: string;
}

export interface GmChatMessage {
  id: string;
  campaign_id: string;
  anchor_turn_id: string | null;
  role: "user" | "assistant";
  content: string;
  mentions: GmMentionRef[];
  sources: GmSourceRef[];
  created_at: string;
}

export interface GmMessagesResponse {
  messages: GmChatMessage[];
  unlock_lore: boolean;
  gm_model_role: GmModelRole;
  gm_model_name: string;
  gm_temperature: number;
  gm_max_tokens: number;
}

export interface GmMentionsResponse {
  items: GmMentionCandidate[];
}

export interface GmStreamMetaEvent {
  unlock_lore: boolean;
  model_role: GmModelRole;
  model: string;
  temperature: number;
  max_tokens: number;
  pinned_mentions: GmSourceRef[];
  retrieved_sources: GmSourceRef[];
}

export interface GmStreamDoneEvent {
  user_message: GmChatMessage;
  assistant_message: GmChatMessage;
}
