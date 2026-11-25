import type {
  GmMentionCandidate,
  GmMentionCategory,
  GmMentionRef,
} from "../types";

export const GM_NAME = "Neuromancer";
export const GM_GREETING_MESSAGE =
  "Hello, I'm Neuromancer, Cybercantina's GM. You can ask me anything about the ongoing campaign.";
export const MAX_GM_PINNED_MENTIONS = 10;

export interface GmMentionCategorySpec {
  id: GmMentionCategory;
  label: string;
  description: string;
  prefix: string;
}

export const GM_MENTION_CATEGORIES: readonly GmMentionCategorySpec[] =
  Object.freeze([
    {
      id: "characters",
      label: "Characters",
      description: "Party members, campaign NPCs & your persona",
      prefix: "@characters:",
    },
    {
      id: "lore",
      label: "Lore",
      description: "World Codex, location & container lore",
      prefix: "@lore:",
    },
    {
      id: "locations",
      label: "Locations",
      description: "Browse world & campaign locations",
      prefix: "@locations:",
    },
    {
      id: "containers",
      label: "Containers",
      description: "Browse rooms, buildings & nested areas",
      prefix: "@containers:",
    },
    {
      id: "turns",
      label: "Turns",
      description: "Reference turns along the active branch",
      prefix: "@turns:",
    },
    {
      id: "mechanics",
      label: "Mechanics",
      description: "CyberCantina rules, CARE, d20, travel & memory",
      prefix: "@mechanics:",
    },
  ]);

export interface GmMentionTrigger {
  mode: "browse" | "category" | "search";
  category?: GmMentionCategory;
  query: string;
  tokenStart: number;
  tokenEnd: number;
}

const CATEGORY_PREFIX_RE =
  /^(characters|lore|locations|containers|turns|mechanics):([\s\S]*)$/i;

function isWordBoundaryBeforeAt(ch: string | undefined): boolean {
  if (!ch) return true;
  return /[\s(\["']/.test(ch);
}

function isCompletedPinnedTokenAt(
  text: string,
  atIdx: number,
  cursorPos: number,
  pinnedMentions: readonly GmMentionRef[]
): boolean {
  const afterAt = text.slice(atIdx + 1);
  for (const ref of pinnedMentions) {
    if (!ref.label) continue;
    if (afterAt.startsWith(ref.label)) {
      const tokenEnd = atIdx + 1 + ref.label.length;
      const nextCh = text[tokenEnd];
      const hasDelimiter = !nextCh || /[\s.,!?;:)\]"']/.test(nextCh);
      if (hasDelimiter && cursorPos > tokenEnd) {
        return true;
      }
    }
  }
  return false;
}

/** Detect an active `@` Browse / `@category:` / live-search trigger at `cursorPos`. */
export function detectGmMentionTrigger(
  text: string,
  cursorPos: number,
  pinnedMentions: readonly GmMentionRef[] = []
): GmMentionTrigger | null {
  const clamped = Math.max(0, Math.min(cursorPos, text.length));
  const beforeCursor = text.slice(0, clamped);
  const lastNewline = beforeCursor.lastIndexOf("\n");
  const lineStart = lastNewline === -1 ? 0 : lastNewline + 1;

  for (let i = clamped - 1; i >= lineStart; i--) {
    if (text[i] !== "@") continue;
    if (!isWordBoundaryBeforeAt(i > 0 ? text[i - 1] : undefined)) {
      continue;
    }
    if (isCompletedPinnedTokenAt(text, i, clamped, pinnedMentions)) {
      return null;
    }

    const rawQuery = text.slice(i + 1, clamped);
    if (rawQuery.includes("\n")) return null;

    let tokenEnd = clamped;
    while (tokenEnd < text.length && !/[\s\n]/.test(text[tokenEnd])) {
      tokenEnd++;
    }

    const catMatch = CATEGORY_PREFIX_RE.exec(rawQuery);
    if (catMatch) {
      return {
        mode: "category",
        category: catMatch[1].toLowerCase() as GmMentionCategory,
        query: catMatch[2],
        tokenStart: i,
        tokenEnd,
      };
    }

    if (rawQuery.length === 0) {
      return {
        mode: "browse",
        query: "",
        tokenStart: i,
        tokenEnd,
      };
    }

    // Limit multi-word free typing after '@' so stale '@' earlier in a long paragraph doesn't hold the popover open.
    if (rawQuery.length > 40) {
      return null;
    }

    return {
      mode: "search",
      query: rawQuery,
      tokenStart: i,
      tokenEnd,
    };
  }
  return null;
}

/** Replace active `@...` token with `@<category>:` so the player enters Stage 2 category search. */
export function applyCategoryDrilldown(
  text: string,
  trigger: GmMentionTrigger,
  category: GmMentionCategory
): { nextText: string; nextCursorPos: number } {
  const prefix = `@${category}:`;
  const before = text.slice(0, trigger.tokenStart);
  const after = text.slice(trigger.tokenEnd);
  const nextText = `${before}${prefix}${after}`;
  return {
    nextText,
    nextCursorPos: before.length + prefix.length,
  };
}

/** Detect `Backspace` immediately after `@<category>:` so it pops cleanly back to `@` Browse mode. */
export function shouldPopCategoryToBrowse(
  text: string,
  cursorPos: number
): { nextText: string; nextCursorPos: number } | null {
  const clamped = Math.max(0, Math.min(cursorPos, text.length));
  const before = text.slice(0, clamped);
  const match =
    /(?:^|[\s(\["'])(@(?:characters|lore|locations|containers|turns|mechanics):)$/i.exec(
      before
    );
  if (!match) return null;
  const fullPrefix = match[1];
  const start = clamped - fullPrefix.length;
  const nextText = `${text.slice(0, start)}@${text.slice(clamped)}`;
  return {
    nextText,
    nextCursorPos: start + 1,
  };
}

/** Insert the selected candidate as `@<Label> ` and return its structured `GmMentionRef`. */
export function insertGmMentionToken(
  text: string,
  trigger: GmMentionTrigger,
  candidate: GmMentionCandidate
): {
  nextText: string;
  nextCursorPos: number;
  mentionRef: GmMentionRef;
} {
  const token = `@${candidate.label}`;
  const before = text.slice(0, trigger.tokenStart);
  const after = text.slice(trigger.tokenEnd);
  const needsTrailingSpace = after.length === 0 || !/^\s/.test(after);
  const inserted = needsTrailingSpace ? `${token} ` : token;
  const nextText = `${before}${inserted}${after}`;
  return {
    nextText,
    nextCursorPos: before.length + inserted.length,
    mentionRef: {
      kind: candidate.kind,
      id: candidate.id,
      label: candidate.label,
    },
  };
}

/** Deduplicate and prune pinned mentions whose `@<label>` token was removed from `text`. */
export function syncPinnedMentionsWithText(
  text: string,
  pinnedMentions: readonly GmMentionRef[]
): GmMentionRef[] {
  const seen = new Set<string>();
  const kept: GmMentionRef[] = [];
  for (const ref of pinnedMentions) {
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) continue;
    if (!text.includes(`@${ref.label}`)) continue;
    seen.add(key);
    kept.push(ref);
    if (kept.length >= MAX_GM_PINNED_MENTIONS) break;
  }
  return kept;
}

/** Remove a mention chip (and optionally its `@<label>` token from the draft text). */
export function removePinnedMentionFromDraft(
  text: string,
  pinnedMentions: readonly GmMentionRef[],
  target: GmMentionRef
): { nextText: string; nextMentions: GmMentionRef[] } {
  const nextMentions = pinnedMentions.filter(
    (m) => !(m.kind === target.kind && m.id === target.id)
  );
  const token = `@${target.label}`;
  let nextText = text;
  const idx = nextText.indexOf(token);
  if (idx !== -1) {
    const afterStart = idx + token.length;
    const eatTrailingSpace = nextText[afterStart] === " " ? 1 : 0;
    nextText = `${nextText.slice(0, idx)}${nextText.slice(afterStart + eatTrailingSpace)}`;
  }
  return {
    nextText,
    nextMentions,
  };
}
