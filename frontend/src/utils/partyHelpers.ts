import {
  USER_PARTY_MEMBER_ID,
  type CampaignStateBundle,
  type NeighborLocationView,
  type PartyRecord,
  type WorldStateSnapshot,
} from "../types";

export function getActiveParties(
  source?:
    | Pick<CampaignStateBundle, "current_world_snapshot">
    | Pick<WorldStateSnapshot, "parties">
    | PartyRecord[]
    | null
): PartyRecord[] {
  if (!source) return [];
  if (Array.isArray(source)) return source;
  if ("current_world_snapshot" in source) {
    return source.current_world_snapshot?.parties ?? [];
  }
  return source.parties ?? [];
}

export function getPlayerParty(parties: PartyRecord[]): PartyRecord | null {
  return parties.find((p) => p.member_ids.includes(USER_PARTY_MEMBER_ID)) ?? null;
}

export function getNpcOnlyParties(parties: PartyRecord[]): PartyRecord[] {
  return parties.filter((p) => !p.member_ids.includes(USER_PARTY_MEMBER_ID));
}

export function getCharacterParty(
  parties: PartyRecord[],
  characterId: string
): PartyRecord | null {
  return parties.find((p) => p.member_ids.includes(characterId)) ?? null;
}

export function getCoLocatedPlayerPartyNpcs(
  parties: PartyRecord[],
  activeLocationId: string
): string[] {
  const playerParty = getPlayerParty(parties);
  if (!playerParty || playerParty.location_id !== activeLocationId) {
    return [];
  }
  return playerParty.member_ids.filter((id) => id !== USER_PARTY_MEMBER_ID);
}

export function formatQuickExitMessage(
  nb: Pick<NeighborLocationView, "direction_label" | "destination">,
  hasCoLocatedParty: boolean
): string {
  const dir = nb.direction_label.toLowerCase();
  return hasCoLocatedParty
    ? `Let's head through the ${dir} into ${nb.destination.name}.`
    : `I head through the ${dir} into ${nb.destination.name}.`;
}

export function getLocationOverridePrimaryLabel(hasCoLocatedParty: boolean): string {
  return hasCoLocatedParty ? "Move Party Here" : "Move Scene Here (Override)";
}
