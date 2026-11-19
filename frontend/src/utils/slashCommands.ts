import type {
  ActiveSlashCommand,
  PartySubcommandId,
  SlashCommandAccent,
  SlashCommandIconKey,
  SlashCommandId,
} from "../types";

export interface SlashSubcommandSpec {
  id: PartySubcommandId;
  label: string;
  syntax: string;
  shortSyntax: string;
  description: string;
  placeholder: string;
  example: string;
}

export interface SlashCommandSpec {
  id: SlashCommandId;
  name: string;
  aliases: readonly string[];
  iconKey: SlashCommandIconKey;
  accent: SlashCommandAccent;
  syntax: string;
  shortSyntax: string;
  description: string;
  placeholder: string;
  example: string;
  acceptsArgs: boolean;
  subcommands?: readonly SlashSubcommandSpec[];
}

export interface SlashCommandAvailabilityContext {
  presentCharacterCount: number;
  eligiblePartyInviteCount: number;
  inPlayerParty: boolean;
  isEditingTurn: boolean;
}

export interface SlashCommandAvailability {
  available: boolean;
  reason: string | null;
}

export interface SlashPickerItem {
  key: string;
  stage: "command" | "subcommand";
  commandId: SlashCommandId;
  subcommandId: PartySubcommandId | null;
  label: string;
  syntax: string;
  description: string;
  iconKey: SlashCommandIconKey;
  accent: SlashCommandAccent;
  matchedAlias: string | null;
  available: boolean;
  unavailableReason: string | null;
}

export interface SlashAutocompleteContext {
  stage: "command" | "subcommand";
  query: string;
  tokenStart: number;
  tokenEnd: number;
  items: SlashPickerItem[];
}

export interface ActiveSlashHint {
  syntax: string;
  example: string;
  placeholder: string;
  showStrip: boolean;
}

const PARTY_SUBCOMMANDS: readonly SlashSubcommandSpec[] = Object.freeze([
  {
    id: "disband",
    label: "disband",
    syntax: "/party disband [message]",
    shortSyntax: "[message]",
    description: "Dissolve your current party via an in-character turn",
    placeholder: "Optional parting words...",
    example: "/party disband We split up here",
  },
  {
    id: "invite",
    label: "invite",
    syntax: "/party invite [@Name ...] [message]",
    shortSyntax: "[@Name ...] [message]",
    description: "Invite specific co-located NPC(s), or everyone here if omitted",
    placeholder: "@Name ... or leave blank to invite everyone here...",
    example: "/party invite @Yulia Stick close",
  },
  {
    id: "kick",
    label: "kick",
    syntax: "/party kick @Name ... [message]",
    shortSyntax: "@Name ... [message]",
    description: "Remove one or more companions from your party",
    placeholder: "@Companion ... [optional parting words]",
    example: "/party kick @Yulia Wait back at the bar",
  },
  {
    id: "leave",
    label: "leave",
    syntax: "/party leave [message]",
    shortSyntax: "[message]",
    description: "Leave your current party via an in-character farewell turn",
    placeholder: "Optional parting words...",
    example: "/party leave I need to scout ahead alone",
  },
]);

/** Canonical slash commands ordered strictly alphabetically by name. */
export const SLASH_COMMANDS: readonly SlashCommandSpec[] = Object.freeze([
  {
    id: "choice",
    name: "choice",
    aliases: Object.freeze(["choices"]),
    iconKey: "list_checks",
    accent: "blue",
    syntax: "/choice [Name] [(DC N)]: Opt 1 [@gate] | Opt 2",
    shortSyntax: "[Name] [(DC N)]: Opt 1 [@gate] | Opt 2",
    description: "Stage Director Choices to guide an active character's cognition",
    placeholder: "Yulia (DC 14): Option 1 @success | Option 2 @fail",
    example: "/choice Yulia (DC 14): Bluff @success | Bolt @fail",
    acceptsArgs: true,
  },
  {
    id: "event",
    name: "event",
    aliases: Object.freeze(["complication"]),
    iconKey: "zap",
    accent: "amber",
    syntax: "/event [description]",
    shortSyntax: "[description]",
    description: "Introduce an unexpected external complication via the Narrator",
    placeholder: "Describe the unexpected complication (optional)...",
    example: "/event The catwalk power flickers out",
    acceptsArgs: true,
  },
  {
    id: "help",
    name: "help",
    aliases: Object.freeze([]),
    iconKey: "help_circle",
    accent: "cyan",
    syntax: "/help",
    shortSyntax: "",
    description: "Open the slash command and composer shortcut reference tray",
    placeholder: "Press Enter to open command reference...",
    example: "/help",
    acceptsArgs: false,
  },
  {
    id: "look",
    name: "look",
    aliases: Object.freeze(["scene", "describe"]),
    iconKey: "eye",
    accent: "cyan",
    syntax: "/look",
    shortSyntax: "",
    description: "Have the Narrator describe the current room and sensory markers",
    placeholder: "Press Enter to describe current scene...",
    example: "/look",
    acceptsArgs: false,
  },
  {
    id: "narrate",
    name: "narrate",
    aliases: Object.freeze(["direct", "custom"]),
    iconKey: "sparkles",
    accent: "amber",
    syntax: "/narrate [directive]",
    shortSyntax: "[directive]",
    description: "Direct the Narrator with custom guidance (blank opens directive tray)",
    placeholder: "Custom directive for the narrator (blank opens tray)...",
    example: "/narrate Focus on the rain drumming on the skylight",
    acceptsArgs: true,
  },
  {
    id: "party",
    name: "party",
    aliases: Object.freeze([]),
    iconKey: "users",
    accent: "violet",
    syntax: "/party [invite|kick|leave|disband] [@Name ...] [message]",
    shortSyntax: "[invite|kick|leave|disband] [@Name ...] [message]",
    description: "Invite co-located NPCs or manage your active party in-character",
    placeholder: "Subcommand (invite, kick, leave, disband), @Name, or invitation...",
    example: "/party invite @Yulia Watch my six",
    acceptsArgs: true,
    subcommands: PARTY_SUBCOMMANDS,
  },
  {
    id: "wait",
    name: "wait",
    aliases: Object.freeze(["pass"]),
    iconKey: "clock",
    accent: "amber",
    syntax: "/wait [duration or cue]",
    shortSyntax: "[duration or cue]",
    description: "Advance the World Clock without taking a character action",
    placeholder: "Duration or cue (e.g., 30m, 2h, until dawn)...",
    example: "/wait 30m",
    acceptsArgs: true,
  },
]);

const COMMAND_BY_ID: Record<SlashCommandId, SlashCommandSpec> = SLASH_COMMANDS.reduce(
  (acc, spec) => {
    acc[spec.id] = spec;
    return acc;
  },
  {} as Record<SlashCommandId, SlashCommandSpec>
);

const PARTY_SUB_BY_ID: Record<PartySubcommandId, SlashSubcommandSpec> =
  PARTY_SUBCOMMANDS.reduce((acc, sub) => {
    acc[sub.id] = sub;
    return acc;
  }, {} as Record<PartySubcommandId, SlashSubcommandSpec>);

const TOKEN_LOOKUP: Map<string, SlashCommandSpec> = (() => {
  const map = new Map<string, SlashCommandSpec>();
  for (const spec of SLASH_COMMANDS) {
    map.set(spec.name.toLowerCase(), spec);
    for (const alias of spec.aliases) {
      map.set(alias.toLowerCase(), spec);
    }
  }
  return map;
})();

export function getSlashCommandSpec(id: SlashCommandId): SlashCommandSpec {
  return COMMAND_BY_ID[id];
}

export function getPartySubcommandSpec(id: PartySubcommandId): SlashSubcommandSpec {
  return PARTY_SUB_BY_ID[id];
}

export function resolveSlashCommandToken(token: string): SlashCommandSpec | null {
  const cleaned = token.trim().replace(/^\/+/, "").toLowerCase();
  if (!cleaned) return null;
  return TOKEN_LOOKUP.get(cleaned) ?? null;
}

export function resolvePartySubcommandToken(token: string): SlashSubcommandSpec | null {
  const cleaned = token.trim().toLowerCase();
  if (
    cleaned === "disband" ||
    cleaned === "invite" ||
    cleaned === "kick" ||
    cleaned === "leave"
  ) {
    return PARTY_SUB_BY_ID[cleaned];
  }
  return null;
}

export function getCommandAvailability(
  id: SlashCommandId,
  ctx: SlashCommandAvailabilityContext
): SlashCommandAvailability {
  if (id === "choice") {
    if (ctx.presentCharacterCount === 0) {
      return { available: false, reason: "Requires someone present" };
    }
    if (ctx.isEditingTurn) {
      return { available: false, reason: "Unavailable while editing" };
    }
  } else if (id === "event" || id === "look" || id === "wait") {
    if (ctx.isEditingTurn) {
      return { available: false, reason: "Unavailable while editing" };
    }
  }
  return { available: true, reason: null };
}

export function getPartySubcommandAvailability(
  sub: PartySubcommandId,
  ctx: SlashCommandAvailabilityContext
): SlashCommandAvailability {
  if (sub === "disband" || sub === "kick" || sub === "leave") {
    if (!ctx.inPlayerParty) {
      return { available: false, reason: "Not in a party" };
    }
    return { available: true, reason: null };
  }
  if (ctx.presentCharacterCount === 0) {
    return { available: false, reason: "No characters present" };
  }
  if (ctx.eligiblePartyInviteCount === 0) {
    return { available: false, reason: "Everyone here is in party" };
  }
  return { available: true, reason: null };
}

export function getSlashCommandPrefix(active: ActiveSlashCommand | null): string {
  if (!active) return "";
  if (active.command === "party" && active.subcommand) {
    return `/party ${active.subcommand} `;
  }
  return `/${active.command} `;
}

export function formatActiveSlashCommand(
  active: ActiveSlashCommand | null,
  argText: string
): string {
  if (!active) return argText;
  const prefix = getSlashCommandPrefix(active);
  const trimmedArgs = argText.replace(/^\s+/, "");
  if (!trimmedArgs) {
    return prefix.trimEnd();
  }
  return `${prefix}${trimmedArgs}`;
}

export function getActiveSlashHint(
  active: ActiveSlashCommand | null
): ActiveSlashHint | null {
  if (!active) return null;
  if (active.command === "party" && active.subcommand) {
    const subSpec = PARTY_SUB_BY_ID[active.subcommand];
    return {
      syntax: subSpec.syntax,
      example: subSpec.example,
      placeholder: subSpec.placeholder,
      showStrip: true,
    };
  }
  const spec = COMMAND_BY_ID[active.command];
  return {
    syntax: spec.syntax,
    example: spec.example,
    placeholder: spec.placeholder,
    showStrip: spec.acceptsArgs,
  };
}

function buildCommandPickerItem(
  spec: SlashCommandSpec,
  matchedAlias: string | null,
  ctx: SlashCommandAvailabilityContext
): SlashPickerItem {
  const avail = getCommandAvailability(spec.id, ctx);
  return {
    key: `cmd:${spec.id}`,
    stage: "command",
    commandId: spec.id,
    subcommandId: null,
    label: spec.name,
    syntax: spec.shortSyntax,
    description: spec.description,
    iconKey: spec.iconKey,
    accent: spec.accent,
    matchedAlias,
    available: avail.available,
    unavailableReason: avail.reason,
  };
}

function buildSubcommandPickerItem(
  sub: SlashSubcommandSpec,
  ctx: SlashCommandAvailabilityContext
): SlashPickerItem {
  const avail = getPartySubcommandAvailability(sub.id, ctx);
  return {
    key: `sub:party:${sub.id}`,
    stage: "subcommand",
    commandId: "party",
    subcommandId: sub.id,
    label: sub.label,
    syntax: sub.shortSyntax,
    description: sub.description,
    iconKey: "users",
    accent: "violet",
    matchedAlias: null,
    available: avail.available,
    unavailableReason: avail.reason,
  };
}

function findStage1Items(
  query: string,
  ctx: SlashCommandAvailabilityContext
): SlashPickerItem[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return SLASH_COMMANDS.map((spec) => buildCommandPickerItem(spec, null, ctx));
  }

  const tier1: SlashPickerItem[] = [];
  const tier2: SlashPickerItem[] = [];
  const tier3: SlashPickerItem[] = [];
  const tier4: SlashPickerItem[] = [];

  for (const spec of SLASH_COMMANDS) {
    const nameLow = spec.name.toLowerCase();
    if (nameLow.startsWith(q)) {
      tier1.push(buildCommandPickerItem(spec, null, ctx));
      continue;
    }
    if (nameLow.includes(q)) {
      tier2.push(buildCommandPickerItem(spec, null, ctx));
      continue;
    }
    const aliasPrefix = spec.aliases.find((a) => a.toLowerCase().startsWith(q));
    if (aliasPrefix) {
      tier3.push(buildCommandPickerItem(spec, aliasPrefix, ctx));
      continue;
    }
    const aliasSub = spec.aliases.find((a) => a.toLowerCase().includes(q));
    if (aliasSub) {
      tier4.push(buildCommandPickerItem(spec, aliasSub, ctx));
    }
  }

  return [...tier1, ...tier2, ...tier3, ...tier4];
}

function findStage2Items(
  query: string,
  ctx: SlashCommandAvailabilityContext
): SlashPickerItem[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return PARTY_SUBCOMMANDS.map((sub) => buildSubcommandPickerItem(sub, ctx));
  }
  const tier1: SlashPickerItem[] = [];
  const tier2: SlashPickerItem[] = [];
  for (const sub of PARTY_SUBCOMMANDS) {
    const lbl = sub.label.toLowerCase();
    if (lbl.startsWith(q)) {
      tier1.push(buildSubcommandPickerItem(sub, ctx));
    } else if (lbl.includes(q)) {
      tier2.push(buildSubcommandPickerItem(sub, ctx));
    }
  }
  return [...tier1, ...tier2];
}

function computeTokenEnd(text: string, fromIdx: number): number {
  let idx = fromIdx;
  while (idx < text.length && !/\s/.test(text[idx])) {
    idx++;
  }
  return idx;
}

export function detectSlashAutocompleteContext(
  inputText: string,
  cursorPos: number,
  activeSlash: ActiveSlashCommand | null,
  ctx: SlashCommandAvailabilityContext
): SlashAutocompleteContext | null {
  const clampedCursor = Math.max(0, Math.min(cursorPos, inputText.length));
  const beforeCursor = inputText.slice(0, clampedCursor);
  if (beforeCursor.includes("\n")) {
    return null;
  }

  if (activeSlash === null) {
    const match = /^(\s*)\/([^\s]*)$/.exec(beforeCursor);
    if (!match) return null;
    const tokenStart = match[1].length;
    const query = match[2];
    const tokenEnd = computeTokenEnd(inputText, clampedCursor);
    const items = findStage1Items(query, ctx);
    if (items.length === 0) return null;
    return {
      stage: "command",
      query,
      tokenStart,
      tokenEnd,
      items,
    };
  }

  if (activeSlash.command === "party" && activeSlash.subcommand === null) {
    const match = /^(\s*)([^\s@]*)$/.exec(beforeCursor);
    if (!match) return null;
    const query = match[2];
    // Do not reopen Stage-2 if cursor sits at start of an existing @mention
    if (!query && /^\s*@/.test(inputText)) {
      return null;
    }
    const tokenStart = match[1].length;
    const tokenEnd = computeTokenEnd(inputText, clampedCursor);
    const items = findStage2Items(query, ctx);
    if (items.length === 0) return null;
    return {
      stage: "subcommand",
      query,
      tokenStart,
      tokenEnd,
      items,
    };
  }

  return null;
}

export function findFirstEnabledIndex(items: readonly SlashPickerItem[]): number {
  return items.findIndex((item) => item.available);
}

export function findNextEnabledIndex(
  items: readonly SlashPickerItem[],
  currentIndex: number,
  delta: 1 | -1
): number {
  if (items.length === 0) return -1;
  const hasEnabled = items.some((item) => item.available);
  if (!hasEnabled) return -1;

  let idx = currentIndex;
  if (idx < 0 || idx >= items.length) {
    idx = delta === 1 ? -1 : 0;
  }
  for (let step = 0; step < items.length; step++) {
    idx = (idx + delta + items.length) % items.length;
    if (items[idx].available) {
      return idx;
    }
  }
  return -1;
}

export function tryPromoteSlashInput(
  inputText: string,
  cursorPos: number,
  activeSlash: ActiveSlashCommand | null,
  ctx: SlashCommandAvailabilityContext
): { activeSlash: ActiveSlashCommand; nextText: string; nextCursorPos: number } | null {
  const clampedCursor = Math.max(0, Math.min(cursorPos, inputText.length));

  if (activeSlash === null) {
    const match = /^(\s*)\/([a-zA-Z]+)[ \t]+([\s\S]*)$/.exec(inputText);
    if (!match) return null;
    const consumedLen = match[0].length - match[3].length;
    if (clampedCursor < consumedLen) return null;

    const spec = resolveSlashCommandToken(match[2]);
    if (!spec || !getCommandAvailability(spec.id, ctx).available) {
      return null;
    }

    let promoted: ActiveSlashCommand = { command: spec.id, subcommand: null };
    let nextText = match[3];
    let nextCursorPos = Math.max(0, clampedCursor - consumedLen);

    if (spec.id === "party") {
      const subPromotion = tryPromoteSlashInput(
        nextText,
        nextCursorPos,
        promoted,
        ctx
      );
      if (subPromotion) {
        promoted = subPromotion.activeSlash;
        nextText = subPromotion.nextText;
        nextCursorPos = subPromotion.nextCursorPos;
      }
    }

    return { activeSlash: promoted, nextText, nextCursorPos };
  }

  if (activeSlash.command === "party" && activeSlash.subcommand === null) {
    const match = /^(\s*)(disband|invite|kick|leave)[ \t]+([\s\S]*)$/i.exec(
      inputText
    );
    if (!match) return null;
    const consumedLen = match[0].length - match[3].length;
    if (clampedCursor < consumedLen) return null;

    const subSpec = resolvePartySubcommandToken(match[2]);
    if (!subSpec || !getPartySubcommandAvailability(subSpec.id, ctx).available) {
      return null;
    }

    return {
      activeSlash: { command: "party", subcommand: subSpec.id },
      nextText: match[3],
      nextCursorPos: Math.max(0, clampedCursor - consumedLen),
    };
  }

  return null;
}

export function isExactZeroArgCommandText(
  inputText: string,
  ctx: SlashCommandAvailabilityContext
): SlashCommandId | null {
  const trimmed = inputText.trim();
  const match = /^\/([a-zA-Z]+)$/.exec(trimmed);
  if (!match) return null;
  const spec = resolveSlashCommandToken(match[1]);
  if (!spec || spec.acceptsArgs) return null;
  if (!getCommandAvailability(spec.id, ctx).available) return null;
  return spec.id;
}

export function validateSlashCommandInput(
  effectiveRawInput: string,
  activeSlash: ActiveSlashCommand | null,
  ctx: SlashCommandAvailabilityContext,
  opts?: { isSubmitting?: boolean }
): string | null {
  if (activeSlash !== null) {
    const cmdAvail = getCommandAvailability(activeSlash.command, ctx);
    if (!cmdAvail.available && cmdAvail.reason) {
      return `/${activeSlash.command}: ${cmdAvail.reason}`;
    }
    if (activeSlash.command === "party" && activeSlash.subcommand) {
      const subAvail = getPartySubcommandAvailability(activeSlash.subcommand, ctx);
      if (!subAvail.available && subAvail.reason) {
        return `/party ${activeSlash.subcommand}: ${subAvail.reason}`;
      }
    }
    return null;
  }

  const trimmed = effectiveRawInput.trimStart();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const match = /^\/([^\s]*)(\s[\s\S]*)?$/.exec(trimmed);
  const rawToken = match ? match[1] : "";
  const hasTrailingSpace = Boolean(match && match[2]);

  if (!rawToken) {
    return opts?.isSubmitting
      ? 'Unknown command "/". Type /help to see available commands.'
      : null;
  }

  const exact = resolveSlashCommandToken(rawToken);
  if (exact) {
    const cmdAvail = getCommandAvailability(exact.id, ctx);
    if (!cmdAvail.available && cmdAvail.reason) {
      return `/${exact.name}: ${cmdAvail.reason}`;
    }
    return null;
  }

  const hasStage1Candidate = findStage1Items(rawToken, ctx).length > 0;
  if (!hasTrailingSpace && !opts?.isSubmitting && hasStage1Candidate) {
    return null;
  }

  return `Unknown command "/${rawToken}". Type /help to see available commands.`;
}
