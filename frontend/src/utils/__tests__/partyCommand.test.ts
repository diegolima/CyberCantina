import { describe, expect, it } from "vitest";
import type { CharacterRecord, PartyRecord } from "../../types";
import {
  applyPartyMentionSelection,
  detectPartyMentionContext,
  formatPartyActionBadgeLabel,
  formatPartyActionTurnMessage,
  isPartySlashCommand,
  parsePartySlashCommand,
} from "../partyCommand";

function makeChar(id: string, name: string, tagline = ""): CharacterRecord {
  return {
    id,
    version: 1,
    name,
    tagline,
    physical_appearance: "",
    core_persona: "",
    communication_style: [],
    quirks_flaws: [],
    moral_code: [],
    baseline_psyche: {
      mood_label: "Calm",
      valence: 0,
      arousal: 0.4,
      core_drive: "Survive",
      core_fear: "Betrayal",
      default_want: "Watch",
      default_plan: "Stay alert",
    },
    voice_anchors: [],
    equipped: [],
    inventory: [],
    memory_shards: [],
    initial_message: "",
    tags: [],
    creator: "test",
    creator_notes: "",
    portraits: {},
    gallery: [],
    created_at: "2026-01-01T00:00:00Z",
  };
}

const KIRA = makeChar("char_kira", "Kira Vance", "Signal Broker");
const NYX = makeChar("char_nyx", "Nyx", "Netrunner");
const VIKTOR_V = makeChar("char_viktor_v", "Viktor Vane", "Merc");
const VIKTOR_K = makeChar("char_viktor_k", "Viktor K", "Fixer");
const ALL_CHARS = [KIRA, NYX, VIKTOR_V, VIKTOR_K];

describe("partyCommand parser & autocomplete", () => {
  it("recognizes /party commands case-insensitively", () => {
    expect(isPartySlashCommand("/party")).toBe(true);
    expect(isPartySlashCommand("  /PARTY @Kira")).toBe(true);
    expect(isPartySlashCommand("/partytime")).toBe(false);
    expect(isPartySlashCommand("Let's form a /party")).toBe(false);
  });

  it("parses invite-all, invite with pitch, full-name @Name, first-name @First, and chained @ targets", () => {
    const bare = parsePartySlashCommand("/party", {
      allCharacters: ALL_CHARS,
      presentCharacterIds: [KIRA.id, NYX.id],
      activeParties: [],
    });
    expect(bare.error).toBeNull();
    expect(bare.action).toEqual({
      kind: "invite",
      target_character_ids: [KIRA.id, NYX.id],
      source: "slash_command",
    });

    const pitch = parsePartySlashCommand("/party We stick together down below", {
      allCharacters: ALL_CHARS,
      presentCharacterIds: [KIRA.id, NYX.id],
      activeParties: [],
    });
    expect(pitch.error).toBeNull();
    expect(pitch.action?.message).toBe("We stick together down below");
    expect(pitch.action?.target_character_ids).toEqual([KIRA.id, NYX.id]);

    const multiWord = parsePartySlashCommand("/party @Kira Vance watch my six", {
      allCharacters: ALL_CHARS,
      presentCharacterIds: [KIRA.id, NYX.id],
      activeParties: [],
    });
    expect(multiWord.error).toBeNull();
    expect(multiWord.action?.target_character_ids).toEqual([KIRA.id]);
    expect(multiWord.action?.message).toBe("watch my six");

    const canonicalMulti = parsePartySlashCommand(
      "/party invite @Kira @Nyx double time",
      {
        allCharacters: ALL_CHARS,
        presentCharacterIds: [KIRA.id, NYX.id],
        activeParties: [],
      }
    );
    expect(canonicalMulti.error).toBeNull();
    expect(canonicalMulti.action?.target_character_ids).toEqual([
      KIRA.id,
      NYX.id,
    ]);
    expect(canonicalMulti.action?.message).toBe("double time");
  });

  it("never falls back to invite-all on invalid, ambiguous, off-site, or already-member targets", () => {
    const unknown = parsePartySlashCommand("/party @Ghost", {
      allCharacters: ALL_CHARS,
      presentCharacterIds: [KIRA.id, NYX.id],
      activeParties: [],
    });
    expect(unknown.action).toBeNull();
    expect(unknown.error).toContain("Unknown character '@Ghost'");

    const ambiguous = parsePartySlashCommand("/party @Viktor", {
      allCharacters: ALL_CHARS,
      presentCharacterIds: [KIRA.id, VIKTOR_V.id, VIKTOR_K.id],
      activeParties: [],
    });
    expect(ambiguous.action).toBeNull();
    expect(ambiguous.error).toContain("Ambiguous character name '@Viktor'");

    const offSite = parsePartySlashCommand("/party @Nyx join us", {
      allCharacters: ALL_CHARS,
      presentCharacterIds: [KIRA.id],
      activeParties: [],
      locationNameById: { loc_bar: "Main Bar", loc_cat: "Catwalk" },
      charLocations: { [NYX.id]: "loc_cat" },
    });
    expect(offSite.action).toBeNull();
    expect(offSite.error).toContain("not present in this location");
    expect(offSite.error).toContain("Catwalk");

    const party: PartyRecord = {
      id: "p_1",
      name: "Your Party",
      member_ids: ["user", KIRA.id],
      leader_id: "user",
      location_id: "loc_bar",
    };
    const alreadyMember = parsePartySlashCommand("/party @Kira Vance", {
      allCharacters: ALL_CHARS,
      presentCharacterIds: [KIRA.id, NYX.id],
      activeParties: [party],
    });
    expect(alreadyMember.action).toBeNull();
    expect(alreadyMember.error).toContain("already in your party");

    const emptyRoom = parsePartySlashCommand("/party", {
      allCharacters: ALL_CHARS,
      presentCharacterIds: [],
      activeParties: [],
    });
    expect(emptyRoom.action).toBeNull();
    expect(emptyRoom.error).toContain("No characters are present");
  });

  it("parses leave, kick, and disband strictly", () => {
    const notInParty = parsePartySlashCommand("/party leave", {
      allCharacters: ALL_CHARS,
      presentCharacterIds: [KIRA.id],
      activeParties: [],
    });
    expect(notInParty.error).toContain("not currently in a party");

    const party: PartyRecord = {
      id: "p_1",
      name: "Your Party",
      member_ids: ["user", KIRA.id],
      leader_id: "user",
      location_id: "loc_bar",
    };
    const badKick = parsePartySlashCommand("/party kick @Nyx", {
      allCharacters: ALL_CHARS,
      presentCharacterIds: [KIRA.id, NYX.id],
      activeParties: [party],
    });
    expect(badKick.action).toBeNull();
    expect(badKick.error).toContain("Nyx is not currently in your party");

    const goodKick = parsePartySlashCommand("/party kick @Kira Vance bye", {
      allCharacters: ALL_CHARS,
      presentCharacterIds: [KIRA.id, NYX.id],
      activeParties: [party],
    });
    expect(goodKick.error).toBeNull();
    expect(goodKick.action).toEqual({
      kind: "kick",
      target_character_ids: [KIRA.id],
      message: "bye",
      source: "slash_command",
    });

    const goodLeave = parsePartySlashCommand("/party leave good luck", {
      allCharacters: ALL_CHARS,
      presentCharacterIds: [KIRA.id],
      activeParties: [party],
    });
    expect(goodLeave.action?.kind).toBe("leave");
    expect(goodLeave.action?.message).toBe("good luck");

    const goodDisband = parsePartySlashCommand("/party disband", {
      allCharacters: ALL_CHARS,
      presentCharacterIds: [KIRA.id],
      activeParties: [party],
    });
    expect(goodDisband.action?.kind).toBe("disband");
  });

  it("provides context-scoped @ autocomplete and inserts @Name without colon", () => {
    const party: PartyRecord = {
      id: "p_1",
      name: "Your Party",
      member_ids: ["user", KIRA.id],
      leader_id: "user",
      location_id: "loc_bar",
    };

    const inviteCtx = detectPartyMentionContext("/party @", 8, {
      allCharacters: ALL_CHARS,
      presentCharacterIds: [KIRA.id, NYX.id],
      activeParties: [party],
    });
    expect(inviteCtx?.mode).toBe("party_invite");
    expect(inviteCtx?.candidates.map((c) => c.id)).toEqual([NYX.id]);

    const kickCtx = detectPartyMentionContext("/party kick @Ki", 15, {
      allCharacters: ALL_CHARS,
      presentCharacterIds: [KIRA.id, NYX.id],
      activeParties: [party],
    });
    expect(kickCtx?.mode).toBe("party_kick");
    expect(kickCtx?.candidates.map((c) => c.id)).toEqual([KIRA.id]);

    const secondTargetCtx = detectPartyMentionContext("/party @Kira @", 14, {
      allCharacters: ALL_CHARS,
      presentCharacterIds: [KIRA.id, NYX.id],
      activeParties: [],
    });
    expect(secondTargetCtx?.candidates.map((c) => c.id)).toEqual([NYX.id]);

    expect(
      detectPartyMentionContext("/party leave @Kira", 18, {
        allCharacters: ALL_CHARS,
        presentCharacterIds: [KIRA.id],
        activeParties: [party],
      })
    ).toBeNull();

    const applied = applyPartyMentionSelection("/party @Ki", 10, 7, "Kira Vance");
    expect(applied.nextText).toBe("/party @Kira Vance ");
    expect(applied.nextCursorPos).toBe("/party @Kira Vance ".length);

    expect(
      formatPartyActionBadgeLabel(
        { kind: "invite", target_character_ids: [KIRA.id] },
        { [KIRA.id]: "Kira Vance" }
      )
    ).toBe("Party Invite · Kira Vance");
    expect(
      formatPartyActionTurnMessage(
        { kind: "leave", target_character_ids: [], message: "See you around" }
      )
    ).toBe('[Leave Party] — "See you around"');
  });
});
