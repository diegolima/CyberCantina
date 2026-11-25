import { describe, expect, it } from "vitest";
import type { GmMentionCandidate, GmMentionRef } from "../../types";
import {
  GM_GREETING_MESSAGE,
  GM_MENTION_CATEGORIES,
  applyCategoryDrilldown,
  detectGmMentionTrigger,
  insertGmMentionToken,
  removePinnedMentionFromDraft,
  shouldPopCategoryToBrowse,
  syncPinnedMentionsWithText,
} from "../gmMentions";

describe("gmMentions helpers", () => {
  it("defines Neuromancer greeting and all 6 Browse categories", () => {
    expect(GM_GREETING_MESSAGE).toContain("Neuromancer");
    expect(GM_MENTION_CATEGORIES.map((c) => c.id)).toEqual([
      "characters",
      "lore",
      "locations",
      "containers",
      "turns",
      "mechanics",
    ]);
  });

  it("detects Browse, Category drill-down (including @mechanics:), and Unified Live Search triggers", () => {
    const browse = detectGmMentionTrigger("Tell me about @", 15);
    expect(browse).toEqual({
      mode: "browse",
      query: "",
      tokenStart: 14,
      tokenEnd: 15,
    });

    const cat = detectGmMentionTrigger("What happened in @turns:2", 25);
    expect(cat).toEqual({
      mode: "category",
      category: "turns",
      query: "2",
      tokenStart: 17,
      tokenEnd: 25,
    });

    const mechCat = detectGmMentionTrigger("Explain @mechanics:d20", 22);
    expect(mechCat).toEqual({
      mode: "category",
      category: "mechanics",
      query: "d20",
      tokenStart: 8,
      tokenEnd: 22,
    });

    const search = detectGmMentionTrigger("Who is @kira", 12);
    expect(search).toEqual({
      mode: "search",
      query: "kira",
      tokenStart: 7,
      tokenEnd: 12,
    });

    // Does not trigger mid-word (e.g. email address)
    expect(detectGmMentionTrigger("user@example.com", 16)).toBeNull();
  });

  it("suppresses re-triggering for already completed pinned tokens", () => {
    const pinned: GmMentionRef[] = [
      { kind: "turn", id: "turn_2", label: "Turn 2" },
    ];
    expect(
      detectGmMentionTrigger("What happened in @Turn 2 and after?", 37, pinned)
    ).toBeNull();
  });

  it("drills down into @category: and pops back to @ Browse on Backspace", () => {
    const trigger = detectGmMentionTrigger("Check @", 7)!;
    const drilled = applyCategoryDrilldown("Check @", trigger, "lore");
    expect(drilled).toEqual({
      nextText: "Check @lore:",
      nextCursorPos: 12,
    });

    const popped = shouldPopCategoryToBrowse(
      drilled.nextText,
      drilled.nextCursorPos
    );
    expect(popped).toEqual({
      nextText: "Check @",
      nextCursorPos: 7,
    });

    expect(shouldPopCategoryToBrowse("Check @lore:blackout", 20)).toBeNull();

    const mechTrigger = detectGmMentionTrigger("Check @", 7)!;
    const mechDrilled = applyCategoryDrilldown("Check @", mechTrigger, "mechanics");
    expect(mechDrilled).toEqual({
      nextText: "Check @mechanics:",
      nextCursorPos: 17,
    });
    expect(
      shouldPopCategoryToBrowse(mechDrilled.nextText, mechDrilled.nextCursorPos)
    ).toEqual({
      nextText: "Check @",
      nextCursorPos: 7,
    });
  });

  it("inserts structured tokens (including umbrella @Mechanics and specific rules), syncs with text edits, and removes chips cleanly", () => {
    const trigger = detectGmMentionTrigger("Explain @heli", 13)!;
    const cand: GmMentionCandidate = {
      kind: "lore",
      category: "lore",
      id: "lore_1",
      label: "Helios Blackout",
      subtitle: "Grid outage",
      badge: "World · History",
    };
    const inserted = insertGmMentionToken("Explain @heli", trigger, cand);
    expect(inserted.nextText).toBe("Explain @Helios Blackout ");
    expect(inserted.mentionRef).toEqual({
      kind: "lore",
      id: "lore_1",
      label: "Helios Blackout",
    });

    const syncedKeep = syncPinnedMentionsWithText(inserted.nextText, [
      inserted.mentionRef,
      { kind: "character", id: "char_2", label: "Kira" },
    ]);
    expect(syncedKeep).toEqual([inserted.mentionRef]);

    const removed = removePinnedMentionFromDraft(
      inserted.nextText,
      syncedKeep,
      inserted.mentionRef
    );
    expect(removed.nextText).toBe("Explain ");
    expect(removed.nextMentions).toEqual([]);

    const umbrellaTrigger = detectGmMentionTrigger("Ask @mech", 9)!;
    const umbrellaIns = insertGmMentionToken("Ask @mech", umbrellaTrigger, {
      kind: "mechanic",
      category: "mechanics",
      id: "__all__",
      label: "Mechanics",
      subtitle: "All rules",
      badge: "All Rules",
    });
    expect(umbrellaIns.nextText).toBe("Ask @Mechanics ");
    expect(umbrellaIns.mentionRef).toEqual({
      kind: "mechanic",
      id: "__all__",
      label: "Mechanics",
    });
  });
});
