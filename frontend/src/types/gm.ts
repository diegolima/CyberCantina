import type { CampaignStateBundle } from "./turn";
import type { WorldLoreCategory, WorldLoreNodeDraft } from "./world";

export type GmModelRole = "primary" | "clerk";

export type GmCodexProposalStatus = "pending" | "confirmed" | "cancelled";

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

export interface GmCodexDuplicateMatch {
  id: string;
  title: string;
  category: WorldLoreCategory;
  is_base_world: boolean;
  match_reason: string;
}

export interface GmCodexProposal {
  id: string;
  status: GmCodexProposalStatus;
  draft: WorldLoreNodeDraft;
  source_turns: number[];
  duplicate_matches: GmCodexDuplicateMatch[];
  replace_lore_id?: string | null;
  saved_lore_id?: string | null;
  created_at: string;
}

export interface GmCodexDraftResponse {
  message_id: string;
  proposal: GmCodexProposal;
}

export interface GmStreamCodexProposalEvent {
  message_id: string;
  proposal: GmCodexProposal;
}

export interface CampaignWorldLoreEntryUpsertResponse {
  bundle: CampaignStateBundle;
  saved_lore_id: string;
  proposal?: GmCodexProposal | null;
}

export interface GmChatMessage {
  id: string;
  campaign_id: string;
  anchor_turn_id: string | null;
  role: "user" | "assistant";
  content: string;
  mentions: GmMentionRef[];
  sources: GmSourceRef[];
  proposals?: GmCodexProposal[];
  created_at: string;
}

export interface GmMessagesResponse {
  messages: GmChatMessage[];
  unlock_lore: boolean;
  gm_model_role: GmModelRole;
  gm_model_name: string;
  gm_temperature: number;
  gm_max_tokens: number;
  gm_tools_enabled?: boolean;
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
  tools_enabled?: boolean;
  pinned_mentions: GmSourceRef[];
  retrieved_sources: GmSourceRef[];
}

export interface GmStreamToolStatusEvent {
  tool_name: string;
  label: string;
  phase: "running" | "done";
}

export interface GmStreamNoticeEvent {
  detail: string;
}

export interface GmStreamDoneEvent {
  user_message: GmChatMessage;
  assistant_message: GmChatMessage;
}
