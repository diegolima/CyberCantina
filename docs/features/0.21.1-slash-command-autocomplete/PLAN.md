---
feature: slash-command-autocomplete
target_version: 0.21.1
document_type: plan
status: completed
last_updated: 2026-11-19
---

# Execution Plan — Slash Command Autocomplete, Inline Pills & `/help` Tray (`v0.21.1`)

**Feature Spec:** [FRD.md](file:///home/diegolima/Git/cybercantina/docs/features/0.21.1-slash-command-autocomplete/FRD.md)

## Implementation Checklist — Completed

- [x] **1. Leaf Types Layer (`frontend/src/types/turn.ts`)**
  - [x] Extended `ComposerTrayId` with `"slash_help"`.
  - [x] Added `SlashCommandId`, `PartySubcommandId`, `SlashCommandIconKey`, `SlashCommandAccent`, and `ActiveSlashCommand` leaf types.

- [x] **2. Pure Slash Command Registry & Helpers (`frontend/src/utils/slashCommands.ts`)**
  - [x] Defined canonical `SLASH_COMMANDS` registry ordered alphabetically (`choice`, `event`, `help`, `look`, `narrate`, `party`, `wait`) with aliases, semantic icon keys, non-error accents, parameter syntax, placeholders, examples, and alphabetical `/party` subcommands (`disband`, `invite`, `kick`, `leave`).
  - [x] Implemented `getCommandAvailability` and `getPartySubcommandAvailability` for solo rooms, party membership state, and `editingTurn` mode.
  - [x] Implemented `detectSlashAutocompleteContext` (line-1 Stage-1 `/` trigger with 4-tier prefix/alias ranking; Stage-2 `/party` subcommand trigger with `@` handoff and free-text pitch tolerance) plus `findFirstEnabledIndex` / `findNextEnabledIndex`.
  - [x] Implemented `tryPromoteSlashInput` (space/paste commit, alias normalization, two-stage `/party <subcommand>` promotion), `isExactZeroArgCommandText`, `getSlashCommandPrefix`, `formatActiveSlashCommand`, `getActiveSlashHint`, and `validateSlashCommandInput` (anti-flicker + hard-block validation).

- [x] **3. New Chat Components (`frontend/src/components/chat/`)**
  - [x] Created `SlashCommandPicker.tsx` (Stage-1/Stage-2 popover + shared `SlashCommandIcon` mapper, alias badges, `aria-disabled` reasons, outside-click dismissal).
  - [x] Created `SlashHelpTray.tsx` (above-composer reference tray matching `DirectorChoicesDrawer`, clickable command & `/party` subcommand rows, `"Also in Composer"` `@Name:` & gate-tag reference).

- [x] **4. Composer Integration & Styling**
  - [x] Updated `ChatComposer.tsx` with `<SlashHelpTray>`, `<SlashCommandPicker>`, highlighted inline command pill (semantic icon replacing `/`, subcommand badge, `×` clear button), two-step atomic `Backspace` at cursor `0`, priority status strip (`slashHardError` → `partySlashWarning` → `choiceSlashWarning` → `slashSyntaxHint`), dynamic placeholder, and `Send` / `MagicWandButton` integration.
  - [x] Updated `ChatStage.tsx` with `activeSlash` state, cursor-offset bridging into `detectPartyMentionContext` / `applyPartyMentionSelection`, `handleComposerInputChange` / `handleSelectSlashItem` / `handleBackspaceSlashPill` / `handleInsertSlashFromHelp`, guarded `Escape` layering, `useMagicWand` + `decomposeClientUserMessage` safeguards, `handleSend` registry dispatch + hard block, and `editingTurn` stash/restore + lifecycle resets.
  - [x] Added responsive styles for `.composer-slash-pill*`, `.composer-slash-hint`, `.slash-picker-popover*`, and `.slash-help-tray*` in `frontend/src/styles.css`.

- [x] **5. Automated Tests, Architecture Docs & User Wiki**
  - [x] Added `frontend/src/utils/__tests__/slashCommands.test.ts` and `frontend/src/components/__tests__/slashCommandUi.test.tsx`.
  - [x] Updated `../cybercantina-wiki/Playing-Directing-and-Mechanics.md` and `../cybercantina-wiki/First-Campaign-and-Interface-Tour.md`.
  - [x] Verified `npm --prefix frontend run arch:check && npm --prefix frontend run build && npm --prefix frontend test`, `generate_arch_docs.py --check`, and `git -C ../cybercantina-wiki diff`.
