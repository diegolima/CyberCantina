---
feature: focused-scene-hud-and-diagnostics
target_version: 0.42.0
document_type: review
status: completed
last_updated: 2026-11-25
---

# Pre-Implementation Review — v0.42.0 Focused Scene HUD & Consolidated Diagnostics

## Key Architectural Traps & Mitigations

### 1. `ChatStage` Missing `world` Prop & Copy-on-Write `world_lore_nodes` Drift (`App.tsx:800-835`, `LoreIndexModal.tsx:120`)
- **Trap:** `App.tsx:800-835` passes `bundle` and `character` to `ChatStage`, whereas `world={campaignWorld}` is currently only passed to `LiveInspector` (`App.tsx:945`). Meanwhile, `LoreIndexModal.tsx:120` currently iterates over `world.lore_nodes` directly rather than preferring campaign-scoped Copy-on-Write overrides (`bundle.world_lore_nodes`). Moving the Lore Index into `ContextHealthModal` (owned by `ChatStage`) without fixing both would break World Lore indexing or show stale base-world lore instead of GM/Clerk campaign edits.
- **Mitigation:**
  - Add optional `world?: WorldRecord | null` to `ChatStageProps` (`frontend/src/components/chat/chatHelpers.tsx`) and pass `world={campaignWorld}` from `App.tsx`.
  - In `buildLoreIndexEntries`, accept optional `worldLoreNodes?: LoreNode[]` and resolve `worldLoreNodes ?? world.lore_nodes` (passing `bundle.world_lore_nodes ?? world?.lore_nodes`), matching `WorldInspectorModal` at `App.tsx:1010`.

### 2. Missing `"persona"` Branch in `CodexFocusRequest` (`WorldCodexTab.tsx:84-97, 337-384`)
- **Trap:** `WorldCodexTab.tsx:747-753` already supports `kind: "persona"` in `CodexReturnTarget`, and `buildCodexMajorCharacterList` renders `persona:<id>` keys—yet `CodexFocusRequest` (`WorldCodexTab.tsx:84-97`) only defines `lore`, `character`, and `mechanics`. Clicking the Persona card in `Here` to open Codex → Player Persona would silently fail unless `CodexFocusRequest` handles `"persona"` in both initial mount and updates.
- **Mitigation:**
  - Extend `CodexFocusRequest` with `| { kind: "persona"; personaId: string; nonce: number }`.
  - Handle `externalFocusRequest.kind === "persona"` in initial `activeSection` / `selectedEntryKey` state (`WorldCodexTab.tsx:203-232`) and inside the `externalFocusRequest` `useEffect` (`WorldCodexTab.tsx:337-384`), setting `activeSection = "major_characters"`, `selectedEntryKey = \`persona:\${externalFocusRequest.personaId}\``, and clearing queries/charFocusTarget.
  - Wire `onOpenPersonaInCodex?: (personaId: string) => void` from `App.tsx` (calling `layout.closeOverlays()`, setting `codexFocusRequest`, and setting `campaignWorldSheetTab("codex")`) down to `LiveInspector`.

### 3. Nested `<button>` Accessibility & Event-Bubbling Trap on the Persona Card (`PhysicalStateControl.tsx:88-220`)
- **Trap:** `CharacterRow.tsx:52-161` wraps the entire NPC card inside one `<button>`. Copying that wrapper around `PhysicalStateControl` would nest the inline stance `Edit` button and `MechanicsHelpButton` (`?`) inside a parent `<button>`, violating HTML semantics, `frontend/AGENTS.md` Section 6, and React hydration/SSR validity.
- **Mitigation:**
  - Structure the Persona card top row as a non-interactive flex container:
    - Left identity slot: when `persona_snapshot` is attached and `onOpenPersona` is provided, render a `<button type="button" className="inspector-persona-link">` containing the 34×34 avatar + name + `You` pill + stance/context line; when `persona_snapshot === null`, render a non-interactive `<div className="inspector-persona-identity">`.
    - Right action slot: render the sibling `Edit` button and `?` `MechanicsHelpButton` outside the identity button (`display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0;`).
    - Expand the inline `physical-state-editor--compact` form below the row when `isEditing` is true.

### 4. World Clock Colon Matching, Custom Calendars & Zero-Jitter Blink (`world_clock.py:17-78`)
- **Trap:** `backend/app/engine/world_clock.py` supports `%Y-%m-%d %H:%M`, `%Y-%m-%d %H:%M:%S`, and arbitrary custom calendar strings (`"Day 4 (+15m)"`, `"3rd Moon of Frost"`). Running a naive `str.replace(":", ...)` or regex with overlapping quantifiers could either blink non-time colons or trigger `py/polynomial-redos`-style backtracking concerns, and toggling `display: none` or swapping `:` with space would jitter monospace spacing.
- **Mitigation:**
  - Implement a small pure helper `splitWorldClockDisplay(timestamp: string)` using a single unambiguous pattern matching `HH:MM` (e.g., `(?:^|\s|T)(\d{1,2}):(\d{2})(?=:\d{2}|\s|$)`—note linear bounded digits `\d{1,2}` and `\d{2}`) returning `{ prefix, colon: ":", suffix } | null`.
  - When matched, render `{prefix}<span className={isBusy ? "stage-clock-colon stage-clock-colon--blinking" : "stage-clock-colon"}>:</span>{suffix}`.
  - Animate `opacity` only (`@keyframes clockColonBlink` between `1` and `0.2`) so `tabular-nums` layout width stays completely fixed, and fall back to rendering `timestamp` verbatim when `splitWorldClockDisplay` returns `null`.

### 5. Clock Advance Flash False Positives (`ChatStage.tsx`)
- **Trap:** A naive `useEffect` watching `bundle.current_world_snapshot.world_timestamp` fires when opening a campaign for the first time, switching between campaigns, or checking out a different branch.
- **Mitigation:**
  - Track `prevClockRef = useRef({ campaignId: bundle.campaign.id, timestamp: worldTimestamp })`.
  - Trigger `setClockFlash(true)` (cleared after ~900 ms) **only** when `prevClockRef.current.campaignId === bundle.campaign.id` **and** `prevClockRef.current.timestamp !== worldTimestamp` **and** `!isBusy` (or right when streaming finishes and timestamp changed), updating `prevClockRef` on every change and clearing timers on unmount.

### 6. `Here` vs `Elsewhere` Sorting, Primary Character & Solo Edge Cases (`LiveInspector.tsx:152-172`, `CharacterRow.tsx:120-139`)
- **Trap:** In `LiveInspector.tsx:171`, `characterRows` currently concatenates `[...present, ...absent]` into a single list. When split into `Here` and `Elsewhere`:
  - `Here` includes the Player Persona card + `presentRows` (so its count is `1 + presentRows.length`). If `presentRows` is empty (Solo room), `Here` still renders the Player card + a quiet `"No other characters here"` note.
  - Inside `Here`, suppressing `📍 Present` (`showPresenceLabel={false}`) removes the leading `Present · ` separator—so `CharacterRow.tsx:120-138` must omit the `·` separator bullet as well, rendering `state.mood_label` cleanly as the sole status item on that line!
  - In `Elsewhere (N)`, `absentRows` still pass `showPresenceLabel={true}` so `Elsewhere · <RoomName>` remains visible, and the `InspectorSection` is omitted altogether when `absentRows.length === 0`.

### 7. Historical Turn Telemetry vs. Active Leaf State in `ContextHealthModal` (`ChatStage.tsx:135-145, 1970-1980`)
- **Trap:** `ChatStage.tsx` opens `ContextHealthModal` from two entry points:
  1. The top-bar `ContextHealthPill` (`inspectedTelemetryTurnId = null` → active leaf turn).
  2. Any historical `TurnCard` Prose Model Pill (`inspectedTelemetryTurnId = turn.id`).
  If `Scene & Recall` hardcodes `bundle.current_world_snapshot.scene_flags` or always says `"Recalled Last Turn"`, inspecting Turn #2 will misalign flags/recalls with the Turn #2 telemetry! Also, leaving `activeTab` stuck on `"lore_index"` after closing and reopening on a turn's `ContextHealthPill` hurts discoverability.
- **Mitigation:**
  - Derive `inspectedTurn = modalTelemetryTurn` and pass `inspectedTurn`, `bundle`, `world`, and `characters` (from `buildCampaignCharacterEntries` or `bundle.character_records` + `character`) into `ContextHealthModal`.
  - In `Scene & Recall`, read `recalledItems = inspectedTurn?.recalled_items ?? []` and `sceneFlags = inspectedTurn?.world_snapshot?.scene_flags ?? bundle.current_world_snapshot.scene_flags`, displaying `"Recalled on Turn #N"` when inspecting a non-leaf turn (`inspectedTurn.id !== lastTurn?.id`) and `"Recalled Last Turn"` for the active leaf.
  - Reset `activeTab` to `"telemetry"` via `useEffect` whenever `isOpen` changes from `false` to `true` (or `inspectedTelemetryTurnId` changes).
  - Never block the modal tab bar when `!telemetry || overallStatus === "idle"` (Turn #0): show the idle empty state inside the `Telemetry` tab panel while keeping `Scene & Recall` and `Lore Index` interactive.

### 8. `LoreIndexPanel` Dependency-Cruiser Layering & `LoreIndexModal` Compatibility (`frontend/.dependency-cruiser.cjs`)
- **Trap:** `ContextHealthModal.tsx` lives under `frontend/src/components/chat/` while `LoreIndexModal.tsx` lives under `frontend/src/components/inspector/`, and `locationContainers.test.tsx` imports `LoreIndexModal` and `buildLoreIndexEntries` directly from `../inspector/LoreIndexModal`. Meanwhile, `LoreIndexPanel` needs `isSecretLoreRevealed` from `../world/codexHelpers` (check for any `world` → `chat` imports that could create a cycle under `no-circular`).
- **Mitigation:**
  - Verify `world/codexHelpers.ts` only imports from `../../types` and `../../utils/...` (never `components/chat/` or `components/inspector/`).
  - House the refactored pure `buildLoreIndexEntries` (with `unlockLore`, `revealedLoreIds`, and `worldLoreNodes` support) + reusable `LoreIndexPanel` cleanly (either inside `components/inspector/LoreIndexModal.tsx`—making `LoreIndexModal` a thin modal wrapper around `LoreIndexPanel`—or in `components/shared/LoreIndexPanel.tsx` re-exported from `LoreIndexModal.tsx` so `locationContainers.test.tsx` keeps working smoothly while new spoiler-gating tests exercise the shared logic).
  - Run `npm --prefix frontend run arch:check` immediately after wiring imports to verify zero circular or upward dependency edges.

### 9. Mobile Header Budget & Inspector Header Wrapping (`04-chat-and-turns.css`, `06-inspector-and-lore.css`, `15-responsive.css`)
- **Trap 1:** `15-responsive.css:500-503` currently hides `.stage-header-badges` completely at `@media (max-width: 620px)`. Moving the clock out of `LiveInspector` without updating that rule leaves mobile phone users with zero clock or turn indicator.
- **Trap 2:** Putting `Adjacent Map (N/8 exits)` + `World Sheet` + `Expand Map (N)` + `PanelRightClose` in `InspectorLocationCard`'s header row at 370 px width will wrap onto 2–3 lines or overflow horizontally.
- **Trap 3:** Leaving unused `.clock-display`, `.internals-*`, or replaced `.inspector-player-physical-*` rules in CSS fails `npm --prefix frontend run css:audit` (orphan selector check).
- **Mitigation:**
  - In `15-responsive.css` (`<= 620px`), hide `.stage-location-badge` and `.stage-actor-tagline` rather than hiding the whole `.stage-header-badges` container, and compact `.stage-clock-cluster` padding/font-size + shorten `"Turn #N"` label via a `.stage-turn-word` span hidden at `<= 620px`.
  - In `InspectorLocationCard.tsx`, use a clean single-line header (`flex-wrap: nowrap`): concise label (`Map` / `Adjacent Map`), compact `World` button, compact `Expand (N)` button, and the relocated collapse/close button.
  - Define `@keyframes clockColonBlink` and `@keyframes clockAdvanceFlash` in `00-tokens.css`, disable them under `@media (prefers-reduced-motion: reduce)` in `15-responsive.css`, remove obsolete CSS selectors, and run `npm --prefix frontend run css:audit`.

### 10. Impacted Existing Vitest Suites & Doc Sync
- **Tests requiring intentional updates alongside new coverage:**
  - `frontend/src/components/__tests__/branchGraphAndStory.test.tsx:441-442` (`expect(inspectorHtml).toContain("World Clock")` / `"Internals"` → assert `LiveInspector` no longer renders them and renders `"Here"` instead; assert clock/turn cluster in `ChatStage`).
  - `frontend/src/components/__tests__/responsiveCampaignPanels.test.tsx:273, 295` (`"stage-header-badges"`, `"World Sheet"` → assert desktop Location badge hides when `isInspectorOpen={true}` and shows when `false`, `[Clock | #N]` renders, and `InspectorLocationCard` preserves accessible `"World Sheet"` title/aria-label).
  - `frontend/src/components/__tests__/physicalStance.test.tsx:310` (`inspector-player-physical-label">You</span>` → update to new `Here` Persona card selector/markup while verifying both attached-persona portrait/Codex-link and no-persona `"You"` fallback).
  - `frontend/src/components/__tests__/codexGameMechanics.test.tsx:19, 474, 484` (replace `InspectorInternalsSection` assertion with `ContextHealthModal` `Scene & Recall` tab `MechanicsHelpButton` check, plus `Here` persona `?` check).
  - `frontend/src/components/__tests__/locationContainers.test.tsx:35, 473` (keep `LoreIndexModal` / `LoreIndexPanel` + `buildLoreIndexEntries` compatibility and add tests for GM Mode OFF vs ON secret filtering on World, Location, and L1 Container lore).
  - `frontend/src/components/__tests__/contextHealth.test.tsx` (add coverage for the 3 tabs, Turn #0 accessibility, and historical turn flags/recalls).
  - `frontend/src/components/__tests__/tabbedSheetModals.test.tsx` (verify `CodexFocusRequest` `kind: "persona"` focuses Player Persona in Codex).
- **In-app Mechanics & Wiki Sync:**
  - Update `mechanicsCatalog.ts` (`spatial-physical-stance`, `memory-context-health`, `memory-lore-flags`, `gm-mode`) and `../cybercantina-wiki` (`First-Campaign-and-Interface-Tour.md`, `Live-Inspector-Map-and-Timeline.md`, `Context-Sizing-and-Performance.md`, `Playing-Directing-and-Mechanics.md`) as part of implementation completion.
