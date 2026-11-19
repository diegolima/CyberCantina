import { describe, expect, it } from "vitest";
import { USER_PARTY_MEMBER_ID, type PartyRecord } from "../../types";
import {
  formatQuickExitMessage,
  getActiveParties,
  getCharacterParty,
  getCoLocatedPlayerPartyNpcs,
  getLocationOverridePrimaryLabel,
  getNpcOnlyParties,
  getPlayerParty,
} from "../partyHelpers";

const PLAYER_PARTY: PartyRecord = {
  id: "party_player",
  name: "Your Party",
  member_ids: [USER_PARTY_MEMBER_ID, "char_kira"],
  leader_id: USER_PARTY_MEMBER_ID,
  location_id: "loc_main",
};

const NPC_PARTY: PartyRecord = {
  id: "party_npc",
  name: "Syndicate Pair",
  member_ids: ["char_nyx", "char_viktor"],
  leader_id: "char_viktor",
  location_id: "loc_catwalk",
};

describe("partyHelpers", () => {
  it("extracts active, player, npc-only, character, and co-located NPC lists", () => {
    const parties = getActiveParties({
      current_world_snapshot: {
        turn_id: "t1",
        world_timestamp: "Day 1",
        active_location_id: "loc_main",
        scene_flags: [],
        parties: [PLAYER_PARTY, NPC_PARTY],
      },
    });
    expect(parties).toHaveLength(2);
    expect(getPlayerParty(parties)?.id).toBe("party_player");
    expect(getNpcOnlyParties(parties).map((p) => p.id)).toEqual(["party_npc"]);
    expect(getCharacterParty(parties, "char_kira")?.id).toBe("party_player");
    expect(getCharacterParty(parties, "char_missing")).toBeNull();
    expect(getCoLocatedPlayerPartyNpcs(parties, "loc_main")).toEqual([
      "char_kira",
    ]);
    expect(getCoLocatedPlayerPartyNpcs(parties, "loc_catwalk")).toEqual([]);
  });

  it("adapts quick-exit phrasing and location override labels for party state", () => {
    const exit = {
      direction_label: "Catwalk Stair",
      destination: {
        id: "loc_catwalk",
        world_id: "w1",
        name: "The Catwalk",
        summary: "",
        description: "",
        environmental_tags: [],
        is_starting_location: false,
      },
    };
    expect(formatQuickExitMessage(exit, false)).toBe(
      "I head through the catwalk stair into The Catwalk."
    );
    expect(formatQuickExitMessage(exit, true)).toBe(
      "Let's head through the catwalk stair into The Catwalk."
    );
    expect(getLocationOverridePrimaryLabel(false)).toBe(
      "Move Scene Here (Override)"
    );
    expect(getLocationOverridePrimaryLabel(true)).toBe("Move Party Here");
  });
});
