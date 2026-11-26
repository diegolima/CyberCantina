import { describe, expect, it } from "vitest";
import type { CharacterRecord, PartyRecord } from "../../types";
import { USER_PARTY_MEMBER_ID } from "../../types";
import {
  applyPartyMentionSelection,
  detectPartyMentionContext,
} from "../partyCommand";
import {
  detectSlashAutocompleteContext,
  findFirstEnabledIndex,
  findNextEnabledIndex,
  formatActiveSlashCommand,
  getActiveSlashHint,
  getLocationSearchCooldownRemaining,
  getSlashCommandPrefix,
  isExactZeroArgCommandText,
  SEARCH_COOLDOWN_TURNS,
  SLASH_COMMANDS,
  tryPromoteSlashInput,
  validateSlashCommandInput,
  type SlashCommandAvailabilityContext,
} from "../slashCommands";

const DEFAULT_CTX: SlashCommandAvailabilityContext = {
  presentCharacterCount: 2,
  eligiblePartyInviteCount: 1,
  inPlayerParty: true,
  isEditingTurn: false,
};

function makeChar(id: string, name: string): CharacterRecord {
  return {
    id,
    version: 1,
    name,
    tagline: "Runner",
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

describe("slashCommands registry & autocomplete", () => {
  it("orders canonical commands and /party subcommands strictly alphabetically", () => {
    expect(SLASH_COMMANDS.map((c) => c.name)).toEqual([
      "choice",
      "event",
      "gm",
      "help",
      "look",
      "narrate",
      "party",
      "search",
      "wait",
    ]);
    const partySpec = SLASH_COMMANDS.find((c) => c.id === "party");
    expect(partySpec?.subcommands?.map((s) => s.id)).toEqual([
      "disband",
      "invite",
      "kick",
      "leave",
    ]);
  });

  it("triggers Stage-1 only on line 1 and ranks prefix matches before alias matches", () => {
    const emptyQuery = detectSlashAutocompleteContext("/", 1, null, DEFAULT_CTX);
    expect(emptyQuery?.stage).toBe("command");
    expect(emptyQuery?.items.map((i) => i.label)).toEqual([
      "choice",
      "event",
      "gm",
      "help",
      "look",
      "narrate",
      "party",
      "search",
      "wait",
    ]);

    const cQuery = detectSlashAutocompleteContext("/c", 2, null, DEFAULT_CTX);
    expect(cQuery?.items[0].label).toBe("choice");
    expect(cQuery?.items.slice(1).map((i) => i.label)).toEqual([
      "search",
      "event",
      "narrate",
      "gm",
      "look",
    ]);
    expect(cQuery?.items[2].matchedAlias).toBe("complication");
    expect(cQuery?.items[3].matchedAlias).toBe("custom");
    expect(cQuery?.items[4].matchedAlias).toBe("neuromancer");
    expect(cQuery?.items[5].matchedAlias).toBe("scene");

    const descQuery = detectSlashAutocompleteContext(
      "/desc",
      5,
      null,
      DEFAULT_CTX
    );
    expect(descQuery?.items).toHaveLength(1);
    expect(descQuery?.items[0].label).toBe("look");
    expect(descQuery?.items[0].matchedAlias).toBe("describe");

    // Line 2+ and mid-sentence slashes must not trigger Stage-1
    expect(
      detectSlashAutocompleteContext("@Yulia: hi\n/", 12, null, DEFAULT_CTX)
    ).toBeNull();
    expect(
      detectSlashAutocompleteContext("I check /look", 13, null, DEFAULT_CTX)
    ).toBeNull();
    // Unmatched query hides picker
    expect(
      detectSlashAutocompleteContext("/halp", 5, null, DEFAULT_CTX)
    ).toBeNull();
  });

  it("handles Stage-2 /party subcommands, @ handoff, and free-text pitch tolerance", () => {
    const stage2Empty = detectSlashAutocompleteContext(
      "",
      0,
      { command: "party", subcommand: null },
      DEFAULT_CTX
    );
    expect(stage2Empty?.stage).toBe("subcommand");
    expect(stage2Empty?.items.map((i) => i.label)).toEqual([
      "disband",
      "invite",
      "kick",
      "leave",
    ]);

    const stage2Kick = detectSlashAutocompleteContext(
      "ki",
      2,
      { command: "party", subcommand: null },
      DEFAULT_CTX
    );
    expect(stage2Kick?.items.map((i) => i.label)).toEqual(["kick"]);

    // Hand off immediately when @ is typed or already present
    expect(
      detectSlashAutocompleteContext(
        "@",
        1,
        { command: "party", subcommand: null },
        DEFAULT_CTX
      )
    ).toBeNull();
    expect(
      detectSlashAutocompleteContext(
        "",
        0,
        { command: "party", subcommand: null },
        DEFAULT_CTX
      )
    ).not.toBeNull();
    expect(
      detectSlashAutocompleteContext(
        "@Yulia",
        0,
        { command: "party", subcommand: null },
        DEFAULT_CTX
      )
    ).toBeNull();

    // Free-text shorthand pitch silently closes Stage-2 without error
    expect(
      detectSlashAutocompleteContext(
        "Stick close",
        11,
        { command: "party", subcommand: null },
        DEFAULT_CTX
      )
    ).toBeNull();
  });

  it("evaluates contextual availability and skips disabled items in navigation", () => {
    const soloNoPartyCtx: SlashCommandAvailabilityContext = {
      presentCharacterCount: 0,
      eligiblePartyInviteCount: 0,
      inPlayerParty: false,
      isEditingTurn: false,
    };
    const stage1Solo = detectSlashAutocompleteContext(
      "/",
      1,
      null,
      soloNoPartyCtx
    )!;
    const choiceItem = stage1Solo.items.find((i) => i.commandId === "choice");
    expect(choiceItem?.available).toBe(false);
    expect(choiceItem?.unavailableReason).toBe("Requires someone present");

    // First enabled skips /choice (index 0) and lands on /event (index 1)
    const lastIdx = stage1Solo.items.length - 1;
    expect(findFirstEnabledIndex(stage1Solo.items)).toBe(1);
    expect(findNextEnabledIndex(stage1Solo.items, lastIdx, 1)).toBe(1);
    expect(findNextEnabledIndex(stage1Solo.items, 1, -1)).toBe(lastIdx);

    const stage2Solo = detectSlashAutocompleteContext(
      "",
      0,
      { command: "party", subcommand: null },
      soloNoPartyCtx
    )!;
    expect(stage2Solo.items.every((i) => !i.available)).toBe(true);
    expect(findNextEnabledIndex(stage2Solo.items, 0, 1)).toBe(-1);

    const editCtx: SlashCommandAvailabilityContext = {
      ...DEFAULT_CTX,
      isEditingTurn: true,
    };
    const stage1Edit = detectSlashAutocompleteContext("/", 1, null, editCtx)!;
    expect(
      stage1Edit.items
        .filter((i) => i.available)
        .map((i) => i.commandId)
    ).toEqual(["gm", "help", "narrate", "party"]);
  });

  it("promotes space-committed aliases and pasted two-stage /party prefixes", () => {
    const passPromoted = tryPromoteSlashInput(
      "/pass 30m",
      6,
      null,
      DEFAULT_CTX
    );
    expect(passPromoted).toEqual({
      activeSlash: { command: "wait", subcommand: null },
      nextText: "30m",
      nextCursorPos: 0,
    });

    const pastedPartyKick = tryPromoteSlashInput(
      "/party kick @Yulia Wait here",
      28,
      null,
      DEFAULT_CTX
    );
    expect(pastedPartyKick).toEqual({
      activeSlash: { command: "party", subcommand: "kick" },
      nextText: "@Yulia Wait here",
      nextCursorPos: 16,
    });

    // Does not promote mid-token when cursor sits inside command word
    expect(
      tryPromoteSlashInput("/party foo", 3, null, DEFAULT_CTX)
    ).toBeNull();

    // Refuses to promote unavailable command
    const soloCtx: SlashCommandAvailabilityContext = {
      presentCharacterCount: 0,
      eligiblePartyInviteCount: 0,
      inPlayerParty: false,
      isEditingTurn: false,
    };
    expect(
      tryPromoteSlashInput("/choice Yulia: A | B", 8, null, soloCtx)
    ).toBeNull();

    expect(isExactZeroArgCommandText("/help", DEFAULT_CTX)).toBe("help");
    expect(isExactZeroArgCommandText("/scene", DEFAULT_CTX)).toBe("look");
    expect(isExactZeroArgCommandText("/party", DEFAULT_CTX)).toBeNull();
    expect(
      isExactZeroArgCommandText("/look", { ...DEFAULT_CTX, isEditingTurn: true })
    ).toBeNull();
  });

  it("bridges cursor offsets cleanly with partyCommand @mention helpers", () => {
    const yulia = makeChar("c1", "Yulia Halim");
    const nyx = makeChar("c2", "Nyx");
    const party: PartyRecord = {
      id: "p1",
      name: "Strike Team",
      member_ids: [USER_PARTY_MEMBER_ID, "c1"],
      leader_id: USER_PARTY_MEMBER_ID,
      formed_at_turn_id: "t0",
      location_id: "loc1",
    };

    const activeKick = { command: "party" as const, subcommand: "kick" as const };
    const prefix = getSlashCommandPrefix(activeKick);
    expect(prefix).toBe("/party kick ");

    const localInput = "@Yu";
    const ctx = detectPartyMentionContext(
      prefix + localInput,
      prefix.length + localInput.length,
      {
        allCharacters: [yulia, nyx],
        presentCharacterIds: ["c1", "c2"],
        activeParties: [party],
      }
    );
    expect(ctx?.mode).toBe("party_kick");
    const localStart = (ctx?.triggerStart ?? 0) - prefix.length;
    expect(localStart).toBe(0);

    const applied = applyPartyMentionSelection(
      localInput,
      localInput.length,
      localStart,
      "Yulia Halim"
    );
    expect(applied.nextText).toBe("@Yulia Halim ");
    expect(
      formatActiveSlashCommand(activeKick, applied.nextText)
    ).toBe("/party kick @Yulia Halim ");
  });

  it("validates unknown slash commands with anti-flicker while preserving /party shorthand", () => {
    // Valid partial prefixes don't flash red while typing
    expect(validateSlashCommandInput("/", null, DEFAULT_CTX)).toBeNull();
    expect(validateSlashCommandInput("/p", null, DEFAULT_CTX)).toBeNull();
    expect(validateSlashCommandInput("/pa", null, DEFAULT_CTX)).toBeNull();

    // Partial prefix on submit hard-blocks
    expect(
      validateSlashCommandInput("/lo", null, DEFAULT_CTX, {
        isSubmitting: true,
      })
    ).toBe('Unknown command "/lo". Type /help to see available commands.');

    // Unrecognized tokens and trailing-space typos hard-block immediately
    expect(validateSlashCommandInput("/halp", null, DEFAULT_CTX)).toBe(
      'Unknown command "/halp". Type /help to see available commands.'
    );
    expect(validateSlashCommandInput("/foo bar", null, DEFAULT_CTX)).toBe(
      'Unknown command "/foo". Type /help to see available commands.'
    );

    // Line 2+ / is ignored
    expect(validateSlashCommandInput("Hello\n/halp", null, DEFAULT_CTX)).toBeNull();

    // Contextual unavailability blocks exact /choice in solo room
    const soloCtx: SlashCommandAvailabilityContext = {
      presentCharacterCount: 0,
      eligiblePartyInviteCount: 0,
      inPlayerParty: false,
      isEditingTurn: false,
    };
    expect(validateSlashCommandInput("/choice", null, soloCtx)).toBe(
      "/choice: Requires someone present"
    );

    // Shorthand invite pitch under active /party pill is never flagged as unknown
    expect(
      validateSlashCommandInput(
        "/party Stick close through the catwalk",
        { command: "party", subcommand: null },
        DEFAULT_CTX
      )
    ).toBeNull();

    // Syntax hints: 0-arg hides strip, parameterized shows strip
    expect(
      getActiveSlashHint({ command: "look", subcommand: null })?.showStrip
    ).toBe(false);
    expect(
      getActiveSlashHint({ command: "choice", subcommand: null })?.showStrip
    ).toBe(true);
    expect(
      getActiveSlashHint({ command: "search", subcommand: null })?.showStrip
    ).toBe(true);
  });

  it("enforces /search per-room cooldown and GM Mode bypass", () => {
    const snapshot = {
      location_search_last_turn_depth: { loc_a: 3 },
    };
    expect(SEARCH_COOLDOWN_TURNS).toBe(5);
    expect(getLocationSearchCooldownRemaining(snapshot, "loc_a", 4, false)).toBe(4);
    expect(getLocationSearchCooldownRemaining(snapshot, "loc_a", 7, false)).toBe(1);
    expect(getLocationSearchCooldownRemaining(snapshot, "loc_a", 8, false)).toBe(0);
    // Different room is unaffected
    expect(getLocationSearchCooldownRemaining(snapshot, "loc_b", 4, false)).toBe(0);
    // GM Mode bypasses cooldown immediately
    expect(getLocationSearchCooldownRemaining(snapshot, "loc_a", 4, true)).toBe(0);

    const cooldownCtx: SlashCommandAvailabilityContext = {
      ...DEFAULT_CTX,
      searchCooldownRemaining: 3,
    };
    const stage1Cooldown = detectSlashAutocompleteContext("/", 1, null, cooldownCtx)!;
    const searchItem = stage1Cooldown.items.find((i) => i.commandId === "search");
    expect(searchItem?.available).toBe(false);
    expect(searchItem?.unavailableReason).toBe(
      "Room searched recently (3 turns remaining)"
    );
    expect(validateSlashCommandInput("/search behind desk", null, cooldownCtx)).toBe(
      "/search: Room searched recently (3 turns remaining)"
    );
    expect(
      validateSlashCommandInput("/search behind desk", null, {
        ...DEFAULT_CTX,
        searchCooldownRemaining: 0,
      })
    ).toBeNull();
  });
});
