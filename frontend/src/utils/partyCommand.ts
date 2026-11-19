import {
  USER_PARTY_MEMBER_ID,
  type CharacterRecord,
  type PartyActionSpec,
  type PartyRecord,
} from "../types";
import { getPlayerParty } from "./partyHelpers";

export interface PartyCommandParseContext {
  allCharacters: CharacterRecord[];
  presentCharacterIds: Set<string> | string[];
  activeParties: PartyRecord[];
  locationNameById?: Record<string, string>;
  charLocations?: Record<string, string>;
}

export interface PartyCommandParseResult {
  action: PartyActionSpec | null;
  error: string | null;
}

export interface PartyMentionContext {
  mode: "party_invite" | "party_kick";
  query: string;
  triggerStart: number;
  candidates: CharacterRecord[];
}

export function isPartySlashCommand(rawText: string): boolean {
  const trimmed = (rawText || "").trim();
  return /^\/party(?=\s|$)/i.test(trimmed);
}

function matchAtTargetPrefix(
  bodyAfterAt: string,
  characters: CharacterRecord[]
): { matched: CharacterRecord | null; rest: string; error: string | null } {
  const sorted = [...characters].sort(
    (a, b) => b.name.trim().length - a.name.trim().length
  );
  const bodyLow = bodyAfterAt.toLowerCase();

  for (const ch of sorted) {
    const cname = ch.name.trim();
    if (!cname) continue;
    const clen = cname.length;
    if (bodyLow.startsWith(cname.toLowerCase())) {
      const nextCh = bodyAfterAt[clen];
      if (
        clen === bodyAfterAt.length ||
        /\s/.test(nextCh) ||
        nextCh === "," ||
        nextCh === ";" ||
        nextCh === ":"
      ) {
        const rest = bodyAfterAt.slice(clen).replace(/^[ ,;:\t]+/, "");
        return { matched: ch, rest, error: null };
      }
    }
  }

  const tokMatch = /^([^\s,;:@]+)(.*)$/s.exec(bodyAfterAt);
  const token = tokMatch ? tokMatch[1] : "";
  const restAfterToken = (tokMatch ? tokMatch[2] : "").replace(/^[ ,;:\t]+/, "");
  const tokenLow = token.toLowerCase();
  if (tokenLow) {
    const firstMatches = characters.filter((ch) => {
      const first = ch.name.trim().split(/\s+/)[0];
      return Boolean(first && first.toLowerCase() === tokenLow);
    });
    if (firstMatches.length === 1) {
      return { matched: firstMatches[0], rest: restAfterToken, error: null };
    }
    if (firstMatches.length > 1) {
      const namesList = firstMatches.map((c) => c.name).join(", ");
      return {
        matched: null,
        rest: "",
        error: `Ambiguous character name '@${token}' (matches ${namesList}); use the full @Full Name.`,
      };
    }
  }

  const badLabel =
    token || (bodyAfterAt.trim() ? bodyAfterAt.trim().split(/\s+/)[0] : "");
  return {
    matched: null,
    rest: "",
    error: `Unknown character '@${badLabel}' — use @ autocomplete to pick an exact character.`,
  };
}

function extractChainedAtTargets(
  body: string,
  characters: CharacterRecord[]
): { targets: CharacterRecord[]; trailing: string | null; error: string | null } {
  const targets: CharacterRecord[] = [];
  const seenIds = new Set<string>();
  let cursor = body.trimStart();

  while (cursor.startsWith("@")) {
    const { matched, rest, error } = matchAtTargetPrefix(cursor.slice(1), characters);
    if (error || !matched) {
      return { targets: [], trailing: null, error };
    }
    if (!seenIds.has(matched.id)) {
      seenIds.add(matched.id);
      targets.push(matched);
    }
    cursor = rest.trimStart();
  }

  const trailing = cursor.trim() || null;
  return { targets, trailing, error: null };
}

export function parsePartySlashCommand(
  rawText: string,
  ctx: PartyCommandParseContext
): PartyCommandParseResult {
  if (!isPartySlashCommand(rawText)) {
    return { action: null, error: null };
  }

  const trimmed = rawText.trim();
  const afterCmd = trimmed.slice("/party".length).trimStart();
  const presentSet = new Set(ctx.presentCharacterIds);
  const playerParty = getPlayerParty(ctx.activeParties);
  const partyMemberIds = new Set(
    playerParty
      ? playerParty.member_ids.filter((id) => id !== USER_PARTY_MEMBER_ID)
      : []
  );

  if (!afterCmd) {
    const eligible = [...presentSet].filter((cid) => !partyMemberIds.has(cid));
    if (presentSet.size === 0) {
      return {
        action: null,
        error: "No characters are present in this location to invite.",
      };
    }
    if (eligible.length === 0) {
      return {
        action: null,
        error: "Everyone present in this location is already in your party.",
      };
    }
    return {
      action: {
        kind: "invite",
        target_character_ids: eligible,
        source: "slash_command",
      },
      error: null,
    };
  }

  const subMatch = /^(leave|kick|disband|invite)(?=\s|$)(.*)$/is.exec(afterCmd);
  const subCmd = subMatch ? subMatch[1].toLowerCase() : "invite";
  const restBody = (subMatch ? subMatch[2] : afterCmd).trimStart();

  if (subCmd === "leave") {
    if (!playerParty) {
      return { action: null, error: "You are not currently in a party." };
    }
    return {
      action: {
        kind: "leave",
        target_character_ids: [],
        message: restBody.trim() || null,
        source: "slash_command",
      },
      error: null,
    };
  }

  if (subCmd === "disband") {
    if (!playerParty) {
      return { action: null, error: "You are not currently in a party." };
    }
    return {
      action: {
        kind: "disband",
        target_character_ids: [],
        message: restBody.trim() || null,
        source: "slash_command",
      },
      error: null,
    };
  }

  if (subCmd === "kick") {
    if (!playerParty) {
      return { action: null, error: "You are not currently in a party." };
    }
    if (!restBody.startsWith("@")) {
      return {
        action: null,
        error: "Specify which companion to remove using /party kick @Character Name.",
      };
    }
    const { targets, trailing, error } = extractChainedAtTargets(
      restBody,
      ctx.allCharacters
    );
    if (error) {
      return { action: null, error };
    }
    if (targets.length === 0) {
      return {
        action: null,
        error: "Specify at least one @Character Name to remove from your party.",
      };
    }
    for (const ch of targets) {
      if (!partyMemberIds.has(ch.id)) {
        return {
          action: null,
          error: `${ch.name} is not currently in your party.`,
        };
      }
    }
    return {
      action: {
        kind: "kick",
        target_character_ids: targets.map((c) => c.id),
        message: trailing,
        source: "slash_command",
      },
      error: null,
    };
  }

  // invite (explicit or shorthand `/party ...`)
  if (!restBody) {
    const eligible = [...presentSet].filter((cid) => !partyMemberIds.has(cid));
    if (presentSet.size === 0) {
      return {
        action: null,
        error: "No characters are present in this location to invite.",
      };
    }
    if (eligible.length === 0) {
      return {
        action: null,
        error: "Everyone present in this location is already in your party.",
      };
    }
    return {
      action: {
        kind: "invite",
        target_character_ids: eligible,
        source: "slash_command",
      },
      error: null,
    };
  }

  if (restBody.startsWith("@")) {
    const { targets, trailing, error } = extractChainedAtTargets(
      restBody,
      ctx.allCharacters
    );
    if (error) {
      return { action: null, error };
    }
    if (targets.length === 0) {
      return {
        action: null,
        error: "Specify a valid @Character Name to invite.",
      };
    }
    for (const ch of targets) {
      if (partyMemberIds.has(ch.id)) {
        return { action: null, error: `${ch.name} is already in your party.` };
      }
      if (!presentSet.has(ch.id)) {
        const locId = ctx.charLocations?.[ch.id];
        const locLabel = locId ? ctx.locationNameById?.[locId] ?? "" : "";
        const locSuffix = locLabel ? ` (currently in ${locLabel})` : "";
        return {
          action: null,
          error: `${ch.name} is not present in this location${locSuffix} to invite.`,
        };
      }
    }
    return {
      action: {
        kind: "invite",
        target_character_ids: targets.map((c) => c.id),
        message: trailing,
        source: "slash_command",
      },
      error: null,
    };
  }

  // Invite all co-located non-party NPCs with optional invitation message
  const eligible = [...presentSet].filter((cid) => !partyMemberIds.has(cid));
  if (presentSet.size === 0) {
    return {
      action: null,
      error: "No characters are present in this location to invite.",
    };
  }
  if (eligible.length === 0) {
    return {
      action: null,
      error: "Everyone present in this location is already in your party.",
    };
  }
  return {
    action: {
      kind: "invite",
      target_character_ids: eligible,
      message: restBody.trim() || null,
      source: "slash_command",
    },
    error: null,
  };
}

export function detectPartyMentionContext(
  text: string,
  cursorPos: number,
  ctx: Pick<
    PartyCommandParseContext,
    "allCharacters" | "presentCharacterIds" | "activeParties"
  >
): PartyMentionContext | null {
  const clampedCursor = Math.max(0, Math.min(cursorPos, text.length));
  const beforeCursor = text.slice(0, clampedCursor);
  if (!isPartySlashCommand(beforeCursor)) {
    return null;
  }

  const leadingWsLen = beforeCursor.length - beforeCursor.trimStart().length;
  const trimmedBefore = beforeCursor.slice(leadingWsLen);
  const afterParty = trimmedBefore.slice("/party".length);
  if (!afterParty || !/^\s/.test(afterParty)) {
    return null;
  }
  const afterPartyTrimmed = afterParty.trimStart();
  const subMatch = /^(leave|kick|disband|invite)(?=\s|$)(.*)$/is.exec(
    afterPartyTrimmed
  );
  const subCmd = subMatch ? subMatch[1].toLowerCase() : "invite";
  if (subCmd === "leave" || subCmd === "disband") {
    return null;
  }
  const bodyAfterSub = (subMatch ? subMatch[2] : afterPartyTrimmed).trimStart();
  if (!bodyAfterSub.startsWith("@")) {
    return null;
  }

  // Consume already-completed `@Character ` prefixes in bodyAfterSub so we only trigger on active `@...`
  const alreadySelectedIds = new Set<string>();
  let remaining = bodyAfterSub;
  while (remaining.startsWith("@")) {
    const bodyLow = remaining.slice(1).toLowerCase();
    const sorted = [...ctx.allCharacters].sort(
      (a, b) => b.name.trim().length - a.name.trim().length
    );
    let consumed = false;
    for (const ch of sorted) {
      const cname = ch.name.trim();
      if (!cname) continue;
      if (bodyLow.startsWith(cname.toLowerCase())) {
        const afterName = remaining.slice(1 + cname.length);
        // Completed only if followed by whitespace / separator so typing doesn't close mid-name
        if (afterName.length > 0 && /^[\s,;:]/.test(afterName[0])) {
          alreadySelectedIds.add(ch.id);
          remaining = afterName.replace(/^[ ,;:\t]+/, "");
          consumed = true;
          break;
        }
      }
    }
    if (!consumed) {
      const tokMatch = /^([^\s,;:@]+)([ ,;:\t]+)(.*)$/s.exec(remaining.slice(1));
      if (tokMatch) {
        const tokLow = tokMatch[1].toLowerCase();
        const firstMatches = ctx.allCharacters.filter((ch) => {
          const first = ch.name.trim().split(/\s+/)[0];
          return Boolean(first && first.toLowerCase() === tokLow);
        });
        if (firstMatches.length === 1) {
          alreadySelectedIds.add(firstMatches[0].id);
          remaining = tokMatch[3];
          consumed = true;
        }
      }
    }
    if (!consumed) break;
  }

  if (!remaining.startsWith("@")) {
    return null;
  }
  const query = remaining.slice(1);
  if (query.includes(":") || query.includes("\n")) {
    return null;
  }

  const triggerStart = beforeCursor.length - remaining.length;
  const presentSet = new Set(ctx.presentCharacterIds);
  const playerParty = getPlayerParty(ctx.activeParties);
  const partyMemberIds = new Set(
    playerParty
      ? playerParty.member_ids.filter((id) => id !== USER_PARTY_MEMBER_ID)
      : []
  );

  const mode: "party_invite" | "party_kick" =
    subCmd === "kick" ? "party_kick" : "party_invite";
  const pool = ctx.allCharacters.filter((ch) => {
    if (alreadySelectedIds.has(ch.id)) return false;
    if (mode === "party_kick") {
      return partyMemberIds.has(ch.id);
    }
    return presentSet.has(ch.id) && !partyMemberIds.has(ch.id);
  });

  const qLow = query.trim().toLowerCase();
  const candidates = qLow
    ? pool.filter((ch) => ch.name.toLowerCase().includes(qLow))
    : pool;

  return {
    mode,
    query,
    triggerStart,
    candidates,
  };
}

export function applyPartyMentionSelection(
  text: string,
  cursorPos: number,
  triggerStart: number,
  characterName: string
): { nextText: string; nextCursorPos: number } {
  const before = text.slice(0, triggerStart);
  const after = text.slice(cursorPos);
  const insertion = `@${characterName} `;
  const cleanAfter = after.startsWith(" ") ? after.slice(1) : after;
  const nextText = `${before}${insertion}${cleanAfter}`;
  const nextCursorPos = before.length + insertion.length;
  return { nextText, nextCursorPos };
}

export function formatPartyActionBadgeLabel(
  action: PartyActionSpec,
  nameMap?: Record<string, string>
): string {
  if (action.kind === "invite") {
    if (action.target_character_ids.length === 1 && nameMap) {
      const targetName = nameMap[action.target_character_ids[0]];
      if (targetName) return `Party Invite · ${targetName}`;
    }
    return "Party Invite";
  }
  if (action.kind === "leave") return "Left Party";
  if (action.kind === "kick") {
    if (action.target_character_ids.length === 1 && nameMap) {
      const targetName = nameMap[action.target_character_ids[0]];
      if (targetName) return `Removed ${targetName}`;
    }
    return "Removed from Party";
  }
  return "Disbanded Party";
}

export function formatPartyActionTurnMessage(
  action: PartyActionSpec,
  nameMap?: Record<string, string>
): string {
  const names = nameMap ?? {};
  const labels = action.target_character_ids.map((cid) => names[cid] || cid);
  const pitch = action.message?.trim() ? ` — "${action.message.trim()}"` : "";
  if (action.kind === "invite") {
    return labels.length > 0
      ? `[Party Invite to ${labels.join(", ")}]${pitch}`
      : `[Party Invite to everyone here]${pitch}`;
  }
  if (action.kind === "leave") {
    return `[Leave Party]${pitch}`;
  }
  if (action.kind === "kick") {
    const who = labels.length > 0 ? labels.join(", ") : "companion";
    return `[Dismissed ${who} from Party]${pitch}`;
  }
  return `[Disband Party]${pitch}`;
}
