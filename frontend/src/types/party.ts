export const USER_PARTY_MEMBER_ID = "user" as const;

export type TravelIntent = "default" | "stay_behind" | "follow_player";
export type PartyInviteDecision = "accept" | "refuse";
export type PartyActionKind = "invite" | "leave" | "kick" | "disband";
export type PartyActionSource = "slash_command" | "party_modal";
export type LocationOverrideMoveMode = "party" | "alone" | "subset";

export interface PartyRecord {
  id: string;
  name: string;
  member_ids: string[];
  leader_id: string;
  location_id: string;
  shared_goal?: string | null;
  formed_at_turn_id?: string | null;
}

export interface PartyActionSpec {
  kind: PartyActionKind;
  target_character_ids: string[];
  message?: string | null;
  source?: PartyActionSource;
}

export interface PartyInviteOutcome {
  character_id: string;
  character_name: string;
  decision: PartyInviteDecision;
  reason: string;
  joined_party_id?: string | null;
}

export interface PartyEventDelta {
  action_kind?: PartyActionKind | null;
  invite_outcomes: PartyInviteOutcome[];
  formed_party_ids: string[];
  updated_party_ids: string[];
  disbanded_party_ids: string[];
  departed_member_ids: string[];
  stayed_behind_ids: string[];
  followed_player_ids: string[];
  notes: string[];
}

export interface CreateNpcPartyPayload {
  member_ids: string[];
  name?: string | null;
  shared_goal?: string | null;
}

export interface LocationOverrideOptions {
  move_mode?: LocationOverrideMoveMode;
  accompanying_character_ids?: string[];
}
