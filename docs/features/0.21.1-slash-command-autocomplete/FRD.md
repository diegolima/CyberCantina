---
feature: slash-command-autocomplete
target_version: 0.21.1
document_type: frd
status: completed
last_updated: 2026-11-19
---

# Feature Requirements Document (FRD)
## Slash Command Autocomplete, Inline Command Pills & `/help` Reference Tray

**Status:** Completed  
**Target Version:** CyberCantina v0.21.1  
**Depends On:** `0.21.0-parties`  
**Scope:**
- **Backend / Schemas / API:** **No changes required** (slash shortcuts resolve client-side in [`ChatStage.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ChatStage.tsx#L803-L882), and `/party` already submits `PartyActionSpec` on `TurnRequest`).
- **Frontend Types & Pure Registry / Helpers:**
  - [`turn.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/turn.ts#L287-L288) (extend `ComposerTrayId` with `"slash_help"`, plus shared slash pill / registry DTO types if needed in leaf layer)
  - New: `frontend/src/utils/slashCommands.ts` (single-source-of-truth canonical command registry, Stage-1 & Stage-2 autocomplete context/matching, inline pill parsing/formatting, hard-block validation)
  - Integration with [`choiceCommand.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/utils/choiceCommand.ts) and [`partyCommand.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/utils/partyCommand.ts)
- **Frontend Chat Composer & UI Components:**
  - [`ChatStage.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ChatStage.tsx), [`ChatComposer.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/ChatComposer.tsx), [`CharacterMentionPicker.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/CharacterMentionPicker.tsx), [`styles.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css)
  - New: `frontend/src/components/chat/SlashCommandPicker.tsx` (Stage-1 `/` command & Stage-2 subcommand autocomplete popover)
  - New: `frontend/src/components/chat/SlashHelpTray.tsx` (above-composer `/help` reference tray)
- **Automated Tests:**
  - New: `frontend/src/utils/__tests__/slashCommands.test.ts`
  - New: `frontend/src/components/__tests__/slashCommandUi.test.tsx`
  - Regression coverage in [`partyCommand.test.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/utils/__tests__/partyCommand.test.ts) and [`partyUi.test.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/__tests__/partyUi.test.tsx)
- **User-Facing Documentation (required upon feature implementation):**
  - [`Playing-Directing-and-Mechanics.md`](file:///home/diegolima/Git/cybercantina-wiki/Playing-Directing-and-Mechanics.md)
  - [`First-Campaign-and-Interface-Tour.md`](file:///home/diegolima/Git/cybercantina-wiki/First-Campaign-and-Interface-Tour.md)

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
CyberCantina already supports a rich set of composer slash commands, yet players currently encounter four major usability gaps:

1. **Hidden Discoverability & Scattered Definitions:**
   - The composer actually supports **6 canonical slash commands** (`/choice`, `/event`, `/look`, `/narrate`, `/party`, `/wait`) and **7 aliases** (`/choices`, `/complication`, `/scene`, `/describe`, `/direct`, `/custom`, `/pass`), currently scattered across [`ChatStage.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ChatStage.tsx#L803-L882), [`choiceCommand.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/utils/choiceCommand.ts), [`partyCommand.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/utils/partyCommand.ts), and Narrator menu / textarea hints in [`ChatComposer.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/ChatComposer.tsx#L373-L374).
   - Typing `/` surfaces no autocomplete menu, and there is no `/help` command to inspect available commands or syntax in-app.
2. **Silent Typo Footgun (`onSendTurn` Fallthrough):**
   - In [`ChatStage.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ChatStage.tsx#L803-L882), any unrecognized `/command` (e.g., `/halp`, `/loook`, `/partytime`) silently falls past the `if (raw.startsWith("/"))` branches into `onSendTurn`, sending literal slash text to the LLM as in-character action/dialogue and persisting an unwanted turn node.
3. **Vanishing Parameter Syntax Guidance:**
   - Complex commands such as `/choice [Name] [(DC N)]: Opt 1 [@gate] | Opt 2`, `/party [invite|kick|leave|disband] [@Name ...] [message]`, and `/wait [30m|2h|until dawn]` require specific delimiters, subcommands, or units that users forget as soon as they start typing arguments.
4. **No Visual Confirmation or Fast Dismissal in the Composer:**
   - Valid `/commands` look identical to plain prose inside the composer textarea, giving no visual confirmation that a command was recognized (nor differentiating valid commands from typos) and requiring character-by-character deletion to cancel a command.

### 1.2 Proposed Solution & Locked Design Decisions
This feature introduces a unified, single-source-of-truth slash command UX built around the following locked design decisions:

1. **Above-Composer `/help` Tray (Decision 1):**
   - Running `/help` opens an ephemeral above-composer tray (`activeTray === "slash_help"`) styled to match [`DirectorChoicesDrawer.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/DirectorChoicesDrawer.tsx), listing every canonical command, alias, syntax pattern, `/party` subcommand, and clickable quick-insert shortcut without creating a database turn.
2. **Hard Block on Unrecognized `/commands` (Decision 2):**
   - Typing an invalid or incomplete leading `/command` disables `Send`, prevents `Enter` submission, and displays a clear error banner (`role="alert"`) directing the user to `/help`—eliminating accidental LLM turns on command typos.
3. **Stage-1 + Stage-2 Autocomplete & Persistent Syntax Hints (Decision 3):**
   - Typing `/` at the start of the composer opens an alphabetically ordered **Stage-1** command popover with `↑`/`↓`/`Tab`/`Enter`/click selection and alias-aware filtering.
   - Committing `/party` transitions seamlessly into **Stage-2** subcommand autocomplete (`disband`, `invite`, `kick`, `leave`) and hands off to the existing [`CharacterMentionPicker.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/CharacterMentionPicker.tsx) once `@` is typed, while a compact 1-line syntax hint strip remains visible while entering arguments.
4. **Highlighted Inline Command Pill, Semantic Icon & Atomic Backspace:**
   - A committed valid command renders as a highlighted inline pill immediately before the native `<textarea>`, replacing the leading `/` character with the command's semantic icon (e.g., `[Users] party`, `[Users] party [kick]`, `[Eye] look`).
   - Pressing `Backspace` at cursor index `0` inside the `<textarea>` atomically removes the active subcommand badge first (if present), or the entire command pill in one keystroke—preserving any typed argument text.

---

## 2. Scope, Boundaries & Core Invariants

1. **Frontend-Only Change:**
   - Zero backend Python, SQLite schema, or REST API modifications. Existing `parse_party_slash_command` in `backend/app/engine/parties.py` continues validating submitted `/party` payloads identically.
2. **Single Source of Truth & `dependency-cruiser` Layering Invariant:**
   - `frontend/src/utils/slashCommands.ts` is the sole authoritative definition for canonical slash commands, aliases, Stage-2 subcommands, parameter syntax strings, descriptions, and contextual availability rules—driving Stage-1/Stage-2 autocomplete, inline pill rendering metadata, persistent syntax hints, `/help`, hard-block validation, and [`ChatStage.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ChatStage.tsx#L803-L882) `handleSend` dispatch.
   - Per [`frontend/.dependency-cruiser.cjs`](file:///home/diegolima/Git/cybercantina/frontend/.dependency-cruiser.cjs#L38-L47) (`no-utils-local-upward`), `src/utils/` cannot import React components or UI libraries like `lucide-react` components directly if mapped via JSX; `slashCommands.ts` **must** remain framework-agnostic pure TypeScript using a semantic `SlashCommandIconKey` union (with Lucide icon mapping isolated inside `frontend/src/components/chat/`), and [`turn.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/turn.ts) **must** remain a pure leaf layer (`no-types-outgoing`).
3. **Start-of-Input Anchor Invariant:**
   - In [`ChatStage.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ChatStage.tsx#L804), [`choiceCommand.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/utils/choiceCommand.ts#L17), [`partyCommand.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/utils/partyCommand.ts#L31), and [`ChatComposer.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/ChatComposer.tsx#L453), slash commands are recognized **only at index 0 of the entire composer input** (ignoring leading whitespace, never on line 2+).
   - Consequently, Stage-1 `/` autocomplete **must only trigger on line 1** (when there is no `\n` before the leading `/`), preventing users from inserting a command on line 2+ below dialogue or `@Name:` whispers where it would be sent as literal prose.
4. **Native `<textarea>` Preservation Invariant:**
   - Do **not** replace the composer `<textarea>` with `contenteditable` or a transparent-textarea mirror backdrop (swapping `/` for an SVG icon shifts horizontal width and breaks 1:1 caret synchronization).
   - Keep the native `<textarea>` intact inside a wrapping `.composer-input-wrapper` flex container alongside the rendered command pill, and compute `effectiveRawInput` via a pure helper (`formatActiveSlashCommand(activeSlash, argText)`) so native undo/redo, IME input, `MagicWandButton`, `parseChoiceSlashCommand`, `parsePartySlashCommand`, and `detectPartyMentionContext` continue operating cleanly.
5. **Ephemeral Zero-Turn `/help` Invariant:**
   - `/help` is strictly local UI navigation (`setActiveTray("slash_help")`). It **must never** call `onSendTurn`, never create a persisted `TurnNodeRecord`, never reset `editingTurn`, and never enter the 4-zone LLM context.
6. **Popover Mutual Exclusion & `Escape` Priority Stack Invariant:**
   - `SlashCommandPicker` and [`CharacterMentionPicker.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/CharacterMentionPicker.tsx) share the popover anchor above `.composer-input-wrapper` ([`.mention-picker-popover`](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L5339-L5352)) and **must never be open simultaneously** (`mentionPickerOpen` takes priority when an active `@` whisper or `/party ... @` mention context is active).
   - Pressing `Escape` resolves in deterministic top-down order:
     1. Close `CharacterMentionPicker` (if open)
     2. Dismiss `SlashCommandPicker` (if open, until input/cursor changes)
     3. Close `activePopover` (`narrator` / `exits`, restoring trigger focus)
     4. Close `activeTray` (including `"slash_help"`, `"choices"`, `"pass_time"`, `"custom_directive"`)
     5. Cancel `editingTurn`
7. **Semantic Accent Invariant:**
   - Reserve `--accent-rose` / red strictly for hard-block unknown-command errors and `partySlashWarning` alerts. Valid committed command pills **must** use non-error semantic accents (specifically, `/event` uses `--accent-amber` with a `Zap` icon rather than red so a valid `/event` pill never reads as an error state).

---

## 3. Functional Requirements

### FR-1: Canonical Slash Command Registry (`frontend/src/utils/slashCommands.ts`)

1. **Canonical Command Definitions (Initial Alphabetical Order):**
   - Define `SLASH_COMMANDS` sorted alphabetically by canonical `name` (without leading `/`):

| Order | Canonical | Aliases | Icon Key | Pill Accent | Parameter Syntax | Behavior & Contextual Availability |
| :---: | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `/choice` | `/choices` | `list_checks` | `blue` | `/choice [Name] [(DC N)]: Opt 1 [@gate] \| Opt 2` | Stages Director Choices for an NPC and opens Choices tray. Unavailable when `presentCharacters.length === 0` or during `editingTurn`. |
| 2 | `/event` | `/complication` | `zap` | `amber` | `/event [description]` | Invokes Narrator `complication` mode (optional custom detail). Unavailable during `editingTurn` (targets branch leaf). |
| 3 | `/help` | — | `help_circle` | `cyan` | `/help` | Opens the above-composer `/help` reference tray (`slash_help`). Always available (including solo rooms & `editingTurn`). |
| 4 | `/look` | `/scene`, `/describe` | `eye` | `cyan` | `/look` | Invokes Narrator `describe` mode (0 arguments). Unavailable during `editingTurn`. |
| 5 | `/narrate` | `/direct`, `/custom` | `sparkles` | `amber` | `/narrate [directive]` | Sends Narrator `custom` directive turn, or opens `custom_directive` tray when bare. Available during `editingTurn` (creates swipe branch via `editingTurn.parent_turn_id`). |
| 6 | `/party` | — | `users` | `violet` | `/party [subcommand] [@Name ...] [message]` | Submits in-character party action turn (`invite`, `kick`, `leave`, `disband`, or shorthand `/party [@Name ...] [message]`). Always visible; subcommands reflect current party/room state. |
| 7 | `/wait` | `/pass` | `clock` | `amber` | `/wait [duration or cue]` | Advances World Clock (`30m`, `2h`, `until dawn`). Unavailable during `editingTurn`. |

2. **Stage-2 Subcommands for `/party` (Initial Alphabetical Order):**
   - `disband` — `/party disband [message]` — Dissolve your current party via an in-character turn. Unavailable when `!inPlayerParty` (`"Not in a party"`).
   - `invite` — `/party invite [@Name ...] [message]` — Invite specific co-located NPC(s), or all eligible co-located NPCs if omitted. Unavailable when `presentCharacterIds.length === 0` (`"No characters present"`) or `eligibleInviteCount === 0` (`"Everyone here is in party"`).
   - `kick` — `/party kick @Name ... [message]` — Dismiss one or more companions from your party. Unavailable when `!inPlayerParty` (`"Not in a party"`).
   - `leave` — `/party leave [message]` — Leave your current party in-character. Unavailable when `!inPlayerParty` (`"Not in a party"`).

3. **Centralized Dispatch Alignment (`ChatStage.tsx`):**
   - [`ChatStage.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ChatStage.tsx#L803-L882) `handleSend` **must** resolve the canonical command from `slashCommands.ts` (instead of maintaining separate hardcoded alias comparisons for `look`/`scene`/`describe`, `wait`/`pass`, `event`/`complication`, `narrate`/`direct`/`custom`) and route `"help"` to opening `activeTray = "slash_help"`.

---

### FR-2: Stage-1 `/` & Stage-2 Subcommand Autocomplete (`SlashCommandPicker.tsx`)

1. **Stage-1 Trigger & Filtering Rules:**
   - **Trigger condition:** Only when `activeSlash === null`, `!mentionPickerOpen`, `editingTurn === null || ...` (still allows `/help`, `/narrate`, `/party`), and the text before the cursor contains no `\n` and matches `^\s*/([^\s]*)$` (where `$1` is the `query`).
   - **Empty query (`/`):** Return all 7 canonical commands in strict **alphabetical order** (`/choice`, `/event`, `/help`, `/look`, `/narrate`, `/party`, `/wait`).
   - **Non-empty query (`/<q>`):** Match case-insensitively across canonical names and aliases, ranked in deterministic tiers (alphabetical within each tier):
     1. Canonical name starts with `<q>` (e.g., `/c` puts `/choice` above alias matches `/complication` or `/custom`).
     2. Canonical name contains `<q>`.
     3. Any alias starts with `<q>` (displaying an `alias: /<alias>` badge on the row, e.g., `/desc` → `/look` with `alias: /describe`).
     4. Any alias contains `<q>`.
   - Dismissing via `Escape` suppresses reopening until `inputText` or cursor position changes.

2. **Stage-2 Subcommand Trigger & Handoff (`/party`):**
   - **Trigger condition:** Only when `activeSlash?.command === "party"`, `activeSlash.subcommand === null`, `!mentionPickerOpen`, and the argument text before the cursor contains no `\n`, does not start with `@`, and consists of a single token with no trailing space (`^\s*([^\s@]*)$`).
   - **Empty sub-query:** List `disband`, `invite`, `kick`, `leave` in strict **alphabetical order**.
   - **Typing sub-query:** Filter subcommands by prefix/substring match.
   - **Seamless Handoff & Shorthand Tolerance:**
     - As soon as the user types `@` (e.g., `[Users] party` `@`), Stage-2 closes immediately and [`detectPartyMentionContext`](file:///home/diegolima/Git/cybercantina/frontend/src/utils/partyCommand.ts#L324-L436) opens [`CharacterMentionPicker.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/CharacterMentionPicker.tsx) in `party_invite` mode.
     - As soon as the user types text that matches zero subcommands (e.g., shorthand invite pitch `"Let's stick together"` or `"We..."` once past `"w"`/`"e"`), Stage-2 closes quietly with **no** error state.

3. **Contextual Availability & Disabled Item Handling:**
   - Commands or subcommands unavailable in the current scene/state (e.g., `/choice` in a solo room; `/party leave|kick|disband` when not in a party; `/look` while `editingTurn` is active) stay **visible** in the list for discoverability, rendered dimmed with `aria-disabled="true"` and a concise reason badge (e.g., `Requires someone present`, `Not in a party`, `Everyone here is in party`, `Unavailable while editing`).
   - Disabled items **cannot** be committed via click, `Tab`, or `Enter`.
   - `ArrowUp` / `ArrowDown` wrap around and skip disabled items whenever at least one enabled item exists in the filtered list (initial `selectedIndex` defaults to the first enabled item).

4. **Keyboard & Pointer Controls + Popover Layout:**
   - `ArrowDown` / `ArrowUp`: move selection (wrapping, skipping disabled rows).
   - `Tab` or `Enter` (without `Shift`): `e.preventDefault()`, commit the highlighted command (Stage-1) or subcommand (Stage-2).
   - `Escape`: `e.preventDefault()`, dismiss picker without clearing text.
   - Row `onMouseDown`: `e.preventDefault()` (so textarea retains focus) and commit immediately.
   - Popover anchors above `.composer-input-wrapper` using `.mention-picker-popover` styling widened to `min(480px, 95vw)` so syntax snippets (`[Name] [(DC N)]: Opt 1 | Opt 2`) remain readable without aggressive truncation; header displays context title (`Slash Commands` or `/party Subcommands`) and shortcut hint (`Tab or Enter to select`).

---

### FR-3: Highlighted Inline Command Pill, Semantic Icon & Atomic Backspace

1. **Inline Pill Visual Representation:**
   - When a valid command is committed (`activeSlash !== null`), `.composer-input-wrapper` renders an accented inline pill immediately before the native `<textarea>` inside a wrapping flex row (`flex-wrap: wrap`, `align-items: center` / `flex-start` for multi-line args):
     - **Stage-1 Pill:** Renders the command's semantic Lucide icon (`size={13}`) **replacing the `/` character**, followed by the canonical command name (e.g., `party`, `choice`, `look`) and a compact `×` clear button (`aria-label="Remove /<command> command"`).
     - **Stage-2 Subcommand Segment:** When `activeSlash.subcommand` is set (e.g., `kick`), render a linked secondary badge right beside the command pill (`[Users] party` `[kick] ×`).
     - Styling uses subtle translucent accent borders/fills keyed by the command's non-error `accent` (`cyan`, `blue`, `amber`, `violet`)—visibly distinguishing a valid active command from ordinary prose and from `--accent-rose` errors.
   - Note for `ChatComposer.tsx` padding: ensure `.composer-textarea` inside a pill-enabled `.composer-input-wrapper` reserves clean bottom clearance (`padding-bottom` or flex positioning) so [`MagicWandButton`](file:///home/diegolima/Git/cybercantina/frontend/src/components/MagicWandButton.tsx) in `.composer-wand-slot` does not overlap short single-line argument text.

2. **Commit & Normalization Triggers (Transitioning Raw Text → Pill):**
   - **Picker Selection (`Tab`, `Enter`, or click):**
     - Stage-1 selection sets `activeSlash = { command, subcommand: null }` and strips the leading `/query` from `inputText` (preserving any text after the cursor).
     - Stage-2 selection sets `activeSlash = { command: "party", subcommand }` and strips the leading subcommand query from `inputText` (keeping `argText` cleanly positioned for `@` mention or trailing message).
   - **Space-Triggered Commit & Alias Normalization:**
     - Typing a space immediately after an exact leading canonical command or alias (e.g., `/party `, `/pass `, `/describe `, `/choices `) commits the **canonical** Stage-1 pill (`[Users] party`, `[Clock] wait`, `[Eye] look`, `[ListChecks] choice`) and leaves `inputText` empty (or holds remaining trailing text).
     - While `activeSlash` is `{ command: "party", subcommand: null }`, typing a space immediately after an exact Stage-2 subcommand token (`invite `, `kick `, `leave `, `disband `) promotes `subcommand` into the Stage-2 badge (`[Users] party` `[kick]`) and clears that token from `inputText`.
   - **Paste / Hydration Normalization:**
     - Pasting text starting with `/validcmd ...` (or hydrating via [`handleStartEdit`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ChatStage.tsx#L993-L1043) / `/help` quick-insert) extracts the canonical Stage-1 (+ optional Stage-2) prefix into `activeSlash` and places remaining arguments in `inputText`.
   - **Partial Uncommitted Text:**
     - Incomplete prefixes such as `/`, `/p`, or `/par` remain plain text in `<textarea>` until committed so character-by-character Backspace works normally while typing.

3. **0-Argument Direct Execution (`/look`, `/help`):**
   - If the user types `/look`, `/scene`, `/describe`, or `/help` **without** pressing Space or Tab and presses `Enter`, it executes immediately (same as before).
   - If committed as a pill (`[Eye] look` or `[HelpCircle] help`), pressing `Enter` or clicking `Send` executes the command even when `inputText` is empty (`Send` button enabled whenever `activeSlash` requires 0 args or is bare `/party`, `/narrate`, `/event`).

4. **Atomic Backspace Semantics:**
   - When the `<textarea>` has a collapsed cursor at index `0` (`selectionStart === 0 && selectionEnd === 0`) and the user presses `Backspace` (without modifier keys):
     - **Case A (`activeSlash.subcommand !== null`):** Call `e.preventDefault()` and remove **only** `subcommand` (`{ command: "party", subcommand: null }`), preserving any remaining `inputText` (e.g., typed `@Kira` or farewell message) and allowing Stage-2 autocomplete to reopen if `inputText` is empty.
     - **Case B (`activeSlash.subcommand === null` and `activeSlash !== null`):** Call `e.preventDefault()` and remove the entire `activeSlash` pill (`activeSlash = null`), returning to normal prose/command input while preserving any existing `inputText` arguments safely.
     - **Case C (non-empty text selection spanning `0..N`, e.g., `Ctrl+A` then `Backspace`):** Let the browser/controlled handler clear `inputText` first; only clear `activeSlash` if `inputText` was already empty (`inputText === ""`) or via the pill's `×` button so `Ctrl+A` + `Backspace` does not surprisingly strip the pill before clearing args, or clears both cleanly if `inputText` is already empty.
   - Clicking the pill's `×` button clears `activeSlash` completely (`null`), preserves any typed `inputText`, and focuses the `<textarea>`.

5. **Downstream Composer Synchronization (`ChatStage.tsx`):**
   - Compute `effectiveRawInput = formatActiveSlashCommand(activeSlash, inputText)` (e.g., `"/party kick @Yulia Halim"` or `"/choice Yulia: Opt 1 | Opt 2"`).
   - Wire `effectiveRawInput` into:
     - `partyCommandState` (`isPartySlashCommand` / `parsePartySlashCommand`)
     - `choiceSlashWarning`
     - `MagicWandButton` (`isSlashCommand={Boolean(activeSlash) || inputText.trim().startsWith("/")}`)
     - `handleSend` (and `Send` button disabled checks)
   - **Cursor-Offset Bridge for `/party ... @` Mentions:**
     - `detectPartyMentionContext` expects the full string including `/party [subcmd] `. Compute `prefix = getSlashCommandPrefix(activeSlash)` (`"/party "` or `"/party kick "`) and pass `(prefix + inputText, prefix.length + cursorPos)` to `detectPartyMentionContext`; when `handleSelectMention` runs, map `triggerStart` and `nextCursorPos` back by subtracting `prefix.length` so `@Yulia Halim ` inserts cleanly inside `inputText` while `[Users] party` stays in the pill.
   - **Lifecycle Reset & Edit-Mode Stash:**
     - Include `activeSlash` in `stashedDraftRef` ([`ChatStage.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ChatStage.tsx#L84-L89)) during `handleStartEdit` / `handleCancelEdit`.
     - Reset `activeSlash = null` on successful turn send, 0-arg shortcut execution, `handleQuickExit`, campaign/branch switch (`useEffect` on `[bundle.campaign.id, lastBranchTurn?.id]`), and `handleCancelEdit` fallback.

---

### FR-4: Persistent Inline Parameter Syntax Hint Bar & Dynamic Placeholder

1. **1-Line Inline Syntax Hint Strip:**
   - When `activeSlash !== null` and the active command (or subcommand) accepts parameters (`/choice`, `/event`, `/narrate`, `/party`, `/wait`), render a compact 1-line hint strip inside `.composer-card` right above `.composer-footer` displaying:
     - Parameter signature in monospace (e.g., `[Name] [(DC N)]: Opt 1 [@gate] | Opt 2`)
     - Brief contextual example (e.g., `Example: /choice Yulia (DC 14): Bluff @success | Bolt @fail`, or subcommand-specific syntax when `subcommand` is active, e.g., `@Companion1 [@Companion2] [optional farewell]`).
2. **Banner Priority Order (Prevent Vertical Bloat):**
   - Render at most **one** status strip between `.composer-input-wrapper` and `.composer-footer`, prioritized highest-to-lowest:
     1. Unknown/invalid slash command hard-block alert (`--accent-rose`, `role="alert"`)
     2. `partySlashWarning` (`--accent-rose`, `role="alert"`)
     3. `choiceSlashWarning` (`--accent-amber`)
     4. Active command inline parameter syntax hint (subtle cyan/muted info strip)
3. **Dynamic Textarea Placeholder:**
   - When `activeSlash` is active, replace the generic idle placeholder with an argument-focused placeholder:
     - `/look`, `/help`: `"Press Enter to run..."`
     - `/choice`: `"Yulia (DC 14): Option 1 @success | Option 2 @fail"`
     - `/wait`: `"Duration or cue (e.g., 30m, 2h, until dawn)..."`
     - `/event`: `"Describe the unexpected complication (optional)..."`
     - `/narrate`: `"Custom directive for the narrator (blank opens tray)..."`
     - `/party` (no subcommand): `"Subcommand (invite, kick, leave, disband), @Name, or invitation..."`
     - `/party invite`: `"@Name ... or leave blank to invite everyone here..."`
     - `/party kick`: `"@Companion ... [optional parting words]"`
     - `/party leave` / `/party disband`: `"Optional parting words..."`
   - When `activeSlash === null` and idle, simplify the default composer placeholder in [`ChatComposer.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/ChatComposer.tsx#L372-L375) to mention `/` commands and `@` whispers concisely (e.g., `... (Type / for commands, @ for whispers)`).

---

### FR-5: Hard Block on Unrecognized `/commands`

1. **Detection & Error Message:**
   - Inspect `effectiveRawInput` via a pure helper `validateSlashCommandInput(effectiveRawInput, activeSlash, context)` in `slashCommands.ts`.
   - When an unrecognized leading `/token` is detected, display a `--accent-rose` `.party-slash-warning`-style banner (`role="alert"`) reading:
     `Unknown command "/<token>". Type /help to see available commands.`
   - Disable the `Send` button (`Boolean(slashHardError)`) and short-circuit `handleSend` before `onSendTurn` so an unrecognized slash input can **never** be sent as an IC turn.
2. **Anti-Flicker Rule While Typing:**
   - While `activeSlash === null` and the user is still typing a single line-1 token with **no trailing whitespace** (e.g., `/`, `/l`, `/lo`, `/p`, `/par`), if **at least 1 canonical command or alias** matches as a Stage-1 autocomplete candidate (`matches.length > 0`), suppress the inline hard-block banner so typing valid commands never flashes red.
   - However, if the user presses **`Enter`** while an incomplete partial token like `/lo` is in the textarea (for example, after dismissing the autocomplete picker with `Escape`), `handleSend` **must** hard-block and surface the unknown-command error rather than submitting `"/lo"` to the LLM.
3. **Immediate Trigger Conditions:**
   - **Zero autocomplete matches:** Leading `/token` has `matches.length === 0` (e.g., `/halp`, `/xyz`, `/status`).
   - **Space after unrecognized token:** User typed whitespace after an invalid token (e.g., `/foo bar`).
   - **Disabled command unavailable in current context:** e.g., running `/choice` in a solo room (`presentCharacters.length === 0`) or `/look` while `editingTurn` is active surfaces the command's specific availability reason and blocks invalid execution rather than leaking `"/choice ..."` as IC speech.
4. **Explicit Non-Regression Guard for `/party` Shorthand:**
   - Free-text words following a committed `[Users] party` pill (or raw `/party Stick close`) are valid invitation messages per [`parsePartySlashCommand`](file:///home/diegolima/Git/cybercantina/frontend/src/utils/partyCommand.ts#L299-L321) and **must never** trigger the unknown-command hard block (validation of `/party` targets/state continues through `partyCommandState.error`).

---

### FR-6: `/help` Above-Composer Reference Tray (`SlashHelpTray.tsx`)

1. **Tray Integration & Lifecycle:**
   - Extend [`ComposerTrayId`](file:///home/diegolima/Git/cybercantina/frontend/src/types/turn.ts#L288) to `"none" | "pass_time" | "custom_directive" | "choices" | "slash_help"`.
   - Submitting `/help` (via `Enter`, pill + `Enter`, or `Send`) clears `activeSlash` and `inputText`, closes `activePopover`, resets `magicWand`, and sets `activeTray("slash_help")`.
   - Render `<SlashHelpTray>` inside `<form className="composer-bar">` in the exact tray slot above `.composer-card` used by `DirectorChoicesDrawer` (`activeTray === "slash_help"`).
   - Supports `Escape` dismissal (via existing [`ChatStage.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ChatStage.tsx#L160-L173) / [`ChatComposer.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/ChatComposer.tsx#L421-L426) `activeTray !== "none"` handlers), a header `×` close button, and automatic reset on campaign/branch change.
2. **Tray Contents & Interactive Quick-Insert:**
   - **Header:** Icon (`HelpCircle`), title `"Slash Commands & Composer Shortcuts"`, close button (`×`).
   - **Command Directory (Alphabetical):** Lists all 7 canonical commands from `SLASH_COMMANDS` with:
     - Semantic icon, canonical `/command` label, and subtle alias pills (when aliases exist)
     - Parameter syntax & concise description
     - Nested subcommand pills under `/party` (`disband`, `invite`, `kick`, `leave`) with individual availability states
   - **Click-to-Insert:** Clicking any available command row (or `/party` subcommand pill) closes `"slash_help"`, sets `activeSlash` to that command (+ subcommand), preserves or clears blank `inputText`, and focuses the `<textarea>` so the user can immediately type parameters or press `Enter`. Unavailable commands/subcommands appear dimmed with their contextual reason and cannot be inserted.
   - **Compact "Also in Composer" Footer:** Documents non-slash composer features:
     - `@Character: "spoken" sensory` — Private in-location whisper or off-site comms
     - Choice gate tags: `@any`, `@crit` / `@critical`, `@success` / `@pass`, `@fail` / `@failure`, `@critfail` / `@botch`

---

## 4. Edge Cases & Interaction Matrix

| Scenario | Expected Behavior |
| :--- | :--- |
| Typing `/` on line 2+ (e.g., after `@Yulia: "Hi"\n/`) | Stage-1 `/` picker does **not** open; `/` remains literal text and sends normally as part of the message. |
| Typing `/scene ` or `/pass ` | Trailing space commits the canonical pill (`[Eye] look` or `[Clock] wait`) rather than keeping the alias string. |
| Typing `/party ` then pressing `Tab` on `kick` | Transitions smoothly from `[Users] party` to `[Users] party` `[kick]`, updates syntax hint to `@Companion ...`, and opens `CharacterMentionPicker` (`party_kick`) as soon as `@` is typed. |
| Typing `/party Let's stick close` | Once `"Let's"` stops matching `leave` (e.g., at `"Le"` -> `"Let"`), Stage-2 picker closes cleanly without error; message submits as a shorthand invite pitch to all eligible co-located NPCs. |
| Typing `/look` and pressing `Enter` immediately (no Space/Tab) | Stage-1 highlights `/look`; `Enter` either commits or executes cleanly without sending `"/look"` as IC prose. **Specifically:** if the Stage-1 picker is open and `/look` is exact + 0-arg, pressing `Enter` commits `[Eye] look` (or if user pressed `Esc` and hits `Enter` on `/look`, `handleSend` executes `describe` immediately—never IC prose). *(Implementation detail: committing on first `Enter` from the picker avoids accidental one-tap LLM turns on `/event` or `/party`; once `[Eye] look` pill is active, `Enter` executes immediately.)* |
| Cursor at index `0` with `[Users] party` `[kick]` and `@Yulia` in textarea; press `Backspace` | First `Backspace` removes only `[kick]` → `[Users] party` + `@Yulia`. Second `Backspace` removes `[Users] party` → `@Yulia`. Typed text is preserved. |
| Cursor at index `0` with `[Users] party` and empty textarea; press `Backspace` | Removes `[Users] party` pill in one keystroke, returning to empty textarea. |
| `Ctrl+A` + `Backspace` inside textarea when `activeSlash` is set and args exist | Clears selected `inputText` arguments first while keeping the command pill; pressing `Backspace` once more (at empty index `0`) removes the pill. |
| Multi-picker collision (`/party @`) | `mentionPickerOpen` (`party_invite`) is active; `SlashCommandPicker` stays closed. |
| `Escape` key layering | Closes `CharacterMentionPicker` → `SlashCommandPicker` → `activePopover` → `activeTray` (`slash_help` etc.) → `editingTurn`, one layer per keypress. |
| `handleStartEdit` / `handleCancelEdit` | Stashes `activeSlash` alongside `inputText`, `diceMode`, `diceOverride`, and `stagedChoices`, and restores it on `Cancel`. |
| `MagicWandButton` while command pill is active | Receives `isSlashCommand={true}` and remains disabled (`"AI enhancement unavailable for slash commands"`). |
| Narrow / mobile viewport (`<= 640px`) | `.composer-input-wrapper` flex-wraps gracefully so long argument text flows neatly onto the line below the command pill without horizontal overflow; `SlashCommandPicker` (`min(480px, 95vw)`) and `SlashHelpTray` remain scrollable within viewport bounds. |

---

## 5. Acceptance Criteria & Verification Matrix

### 5.1 Automated Test Criteria
1. **Pure Registry & Parser Unit Tests (`frontend/src/utils/__tests__/slashCommands.test.ts` — Node Vitest):**
   - `SLASH_COMMANDS` is strictly sorted alphabetically (`choice`, `event`, `help`, `look`, `narrate`, `party`, `wait`), and `/party` subcommands are sorted alphabetically (`disband`, `invite`, `kick`, `leave`).
   - Stage-1 detection triggers **only** at line 1 start of input (rejects line 2+ `/` and mid-sentence `/`), ranks canonical prefix matches before substring/alias matches, and exposes alias metadata when matched via alias.
   - Stage-2 detection triggers for `/party` when `subcommand === null`, filters subcommands alphabetically/by prefix, yields to `@` handoff, and returns `null` (without error) on free-text shorthand pitches.
   - Contextual availability disables `/choice` when `presentCount === 0`, disables `/party leave|kick|disband` when `!inPlayerParty`, disables `/party invite` when `eligibleInviteCount === 0`, and disables non-branching narrator shortcuts during `editingTurn` while keeping `/help`, `/narrate`, and `/party` available.
   - Space/paste commit helpers normalize aliases (`/pass ` → `wait`, `/scene ` → `look`) and extract Stage-2 `/party <subcommand> ` cleanly.
   - `formatActiveSlashCommand` + `getSlashCommandPrefix` round-trip accurately with `detectPartyMentionContext` and `applyPartyMentionSelection` cursor offsets (regression check alongside [`partyCommand.test.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/utils/__tests__/partyCommand.test.ts)).
   - Hard-block validator (`validateSlashCommandInput`) suppresses red errors during valid Stage-1 prefixes (`/`, `/p`, `/pa`), flags 0-match tokens (`/halp`), flags space-delimited invalid tokens (`/foo bar`), blocks incomplete tokens on submit (`/lo`), and never flags `/party <pitch>` shorthand.

2. **UI Rendering Tests (`frontend/src/components/__tests__/slashCommandUi.test.tsx` — `ReactDOMServer.renderToStaticMarkup`):**
   - `SlashCommandPicker` renders Stage-1 items alphabetically with icons, parameter syntax, alias badges, and `aria-disabled="true"` availability reasons; renders Stage-2 `/party` subcommands cleanly.
   - `ChatComposer` renders the inline command pill (semantic icon without leading `/`, optional subcommand segment, `×` clear button), persistent 1-line syntax hint strip, hard-block `role="alert"` error banner (with `Send` disabled), and hides the syntax hint when a higher-priority error alert is active.
   - `SlashHelpTray` renders when `activeTray === "slash_help"` with all 7 canonical commands in alphabetical order, aliases, `/party` subcommands, dimmed unavailable reasons, and `"Also in Composer"` `@Name:` / gate-tag reference.

### 5.2 Repository Verification Gates (Required on Implementation Completion)
- **Frontend architecture, build & tests:**
  ```bash
  npm --prefix frontend run arch:check && npm --prefix frontend run build && npm --prefix frontend test
  ```
- **Architecture docs check (if modules or edges changed):**
  ```bash
  backend/.venv/bin/python scripts/generate_arch_docs.py && backend/.venv/bin/python scripts/generate_arch_docs.py --check
  ```
- **User-facing documentation sync:**
  - Update [`Playing-Directing-and-Mechanics.md`](file:///home/diegolima/Git/cybercantina-wiki/Playing-Directing-and-Mechanics.md) and [`First-Campaign-and-Interface-Tour.md`](file:///home/diegolima/Git/cybercantina-wiki/First-Campaign-and-Interface-Tour.md) to document `/` command autocomplete, `/party` subcommand completion, inline command pills + atomic Backspace, `/help` tray, and unknown-command validation; verify with `git -C ../cybercantina-wiki diff`.
