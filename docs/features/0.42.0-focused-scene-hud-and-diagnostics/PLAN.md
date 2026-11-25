---
feature: focused-scene-hud-and-diagnostics
target_version: 0.42.0
document_type: plan
status: completed
last_updated: 2026-11-25
---

# Implementation Plan — v0.42.0 Focused Scene HUD & Consolidated Diagnostics

## Phase 0: Feature Package Lifecycle Artifacts
- [x] Author `FRD.md` (`status: completed`)
- [x] Author `REVIEW.md` (`status: completed`)
- [x] Author `PLAN.md` (`status: completed`)
- [x] Review & approve specification before starting Phase 1

## Phase 1: Top-Bar Temporal Bezel & Responsive Stage Header
- [x] Add pure clock display helper `splitWorldClockDisplay(timestamp: string)` (e.g., in `frontend/src/components/chat/worldClockDisplay.ts` or `chatHelpers.tsx`):
  - [x] Match only an explicit `HH:MM` time separator (handling `YYYY-MM-DD HH:MM`, `HH:MM:SS`, and ISO `T` separators cleanly).
  - [x] Return `null` for custom non-`HH:MM` calendars (`"3rd Moon of Frost"`, `"Day 4 (+15m)"`) so they render untouched without blinking.
- [x] Update `ChatStageProps` (`frontend/src/components/chat/chatHelpers.tsx`) and `App.tsx`:
  - [x] Add optional `world?: WorldRecord | null` to `ChatStageProps` and pass `world={campaignWorld}` from `App.tsx`.
- [x] Update `ChatStage.tsx` `.stage-header`:
  - [x] Render the unified dark-bezel `.stage-clock-cluster` displaying the amber timestamp on the left and muted secondary `Turn #N` on the right.
  - [x] Blink the `HH:MM` colon via `.stage-clock-colon--blinking` **only while `isBusy` (`isStreaming || isPhase4Running`) is true**.
  - [x] Add a `useRef<{ campaignId: string; timestamp: string }>` guard to trigger a brief `.stage-clock-cluster--flash` amber pulse only when `world_timestamp` changes within the same campaign (never on mount or campaign switch), cleaning up timers on unmount.
  - [x] Render the `Turn #N` segment as a clickable `<button>` invoking `onOpenStoryTimelines` when provided (with `.stage-turn-word` span hidden on `<= 620px` so mobile shows `#N`), falling back to a `<span>` when omitted.
  - [x] Conditionally render the top-bar `[MapPin Active Location]` pill only when `!isInspectorOpen` on desktop/tablet, and mark it `.stage-location-badge`.
- [x] Update CSS (`00-tokens.css`, `04-chat-and-turns.css`, `15-responsive.css`):
  - [x] Add `@keyframes clockColonBlink` and `@keyframes clockAdvanceFlash` in `00-tokens.css`.
  - [x] Add `.stage-clock-cluster`, `.stage-clock-time`, `.stage-clock-colon`, `.stage-clock-colon--blinking`, `.stage-clock-cluster--flash`, `.stage-clock-divider`, `.stage-turn-btn`, `.stage-turn-word`, and `.stage-location-badge` in `04-chat-and-turns.css`.
  - [x] In `15-responsive.css` (`@media (max-width: 620px)`), hide `.stage-location-badge` and `.stage-actor-tagline` instead of hiding `.stage-header-badges` so `[Clock | #N]` remains visible on compact phones; suppress new animations inside `@media (prefers-reduced-motion: reduce)`.

## Phase 2: Right-Pane Map Card Header & Relocated Close/Collapse Control
- [x] Update `LiveInspector.tsx`:
  - [x] Remove the `World Clock` card completely.
  - [x] Pass `mode`, `onClose`, and `panelId={id}` into `InspectorLocationCard`.
- [x] Update `InspectorLocationCard.tsx`:
  - [x] Relocate the collapse/close `<button>` (`PanelRightClose` / `X`, preserving `aria-expanded={mode !== "hidden"}`, `aria-controls={panelId}`, and `"Collapse inspector"` / `"Close inspector"` labels) into the Map card's top-right corner.
  - [x] Streamline the Map card header onto a clean single line inside 370 px (`Map` / `Adjacent Map` label, compact `World` button with accessible `"Open World Sheet & campaign World Settings"` label/title, compact `Expand` + `N` button with accessible `"Expand Map"` title, and collapse/close button).

## Phase 3: `Here` / `Elsewhere (N)` Sections & Persona Card Parity
- [x] Extend `CodexFocusRequest` in `frontend/src/components/world/WorldCodexTab.tsx`:
  - [x] Add `| { kind: "persona"; personaId: string; nonce: number }` to `CodexFocusRequest`.
  - [x] Handle `kind === "persona"` in initial state (`activeSection = "major_characters"`, `selectedEntryKey = \`persona:\${id}\``) and inside the `externalFocusRequest` `useEffect`.
- [x] Wire `onOpenPersonaInCodex?: (personaId: string) => void` in `App.tsx` → `LiveInspector.tsx`.
- [x] Upgrade Player card & `CharacterRow`:
  - [x] Refactor `PhysicalStateControl.tsx` (`variant="inspector"`)—or extract a focused `InspectorPersonaCard.tsx` sharing the compact stance editor—with:
    - [x] 34×34 left circular avatar via `getEntityPrimaryImage("personas", persona)` with cyan ring (`--cyan-border`) and `<User />` fallback icon.
    - [x] Bold `0.86rem` name (`persona.name.trim()` or `"You"`) + subtle cyan `You` pill (omitted when name is already `"You"`).
    - [x] Sibling Codex navigation button on the persona identity (only when `persona` is attached and `onOpenPersona` is provided), alongside sibling `Edit` and `?` `MechanicsHelpButton` controls (zero nested `<button>`s).
    - [x] Compact line-2 stance summary showing stance pill + `physical_context`, or a quiet `"Set stance"` cue when `unspecified` + empty; inline stance editor expanding cleanly below on `Edit`.
  - [x] Add `showPresenceLabel?: boolean` (default `true`) to `CharacterRow.tsx`; when `false` (inside `Here`), omit the `📍 Present` badge and `·` separator so line 2 leads cleanly with `state.mood_label`.
- [x] Partition `LiveInspector.tsx` presence below the Map card:
  - [x] Render always-open `Here` section (`Here` + count `1 + presentRows.length`) containing the User Persona card followed by present `CharacterRow` cards (with `"No other characters here"` muted note when `presentRows.length === 0`).
  - [x] Render collapsed-by-default `Elsewhere` `InspectorSection` (`storageKey="elsewhere"`, `defaultOpen={false}`, count `absentRows.length`) directly below `Here`, **omitted entirely when `absentRows.length === 0`**.
- [x] Update `06-inspector-and-lore.css` for `Here` header, persona card parity, and clean removal of obsolete `.clock-display` / `.internals-*` / replaced `.inspector-player-physical-*` rules.

## Phase 4: 3-Tab `ContextHealthModal` & Spoiler-Gated `Lore Index`
- [x] Refactor `LoreIndexModal.tsx` / extract shared `LoreIndexPanel.tsx`:
  - [x] Move/extend `buildLoreIndexEntries` to accept `worldLoreNodes?: LoreNode[]`, `unlockLore?: boolean`, and `revealedLoreIds?: readonly string[]`.
  - [x] Enforce Codex-parity secret filtering via `isSecretLoreRevealed` (`codexHelpers.ts`) across **World Lore**, **Location Lore**, and **L1 Container Lore**: hide unrevealed `category === "secret"` entries when `!unlockLore`, surface revealed secrets with a `Discovered` badge, and show unrevealed secrets with a `Secret` badge when `unlockLore === true`.
  - [x] Render `LoreIndexPanel` cleanly without modal chrome so it embeds directly inside `ContextHealthModal` (optionally preserving `LoreIndexModal` as a thin wrapper for backward test compatibility or migrating tests cleanly).
- [x] Expand `ContextHealthModal.tsx` into 3 tabs (`Telemetry` | `Scene & Recall` | `Lore Index`):
  - [x] Accept `bundle`, `world`, `characters`, and `inspectedTurn` props from `ChatStage.tsx`.
  - [x] Keep the tab bar accessible even at Turn #0 (`telemetry === null`); reset `activeTab` to `"telemetry"` whenever `isOpen` opens or the inspected turn changes.
  - [x] **`Telemetry` tab:** Existing 4-zone breakdown, summary bar, recommendations, and phase call tables.
  - [x] **`Scene & Recall` tab:** Branch turn/chunk/index stats, `MechanicsHelpButton` (`memory-lore-flags`), turn-scoped Scene Flags (with `FLAG_PREVIEW_LIMIT = 12` toggle), and expandable Recalled Items (`"Recalled on Turn #N"` vs `"Recalled Last Turn"`).
  - [x] **`Lore Index` tab:** Embedded `LoreIndexPanel` using `bundle.world_lore_nodes ?? world?.lore_nodes`, `bundle.visible_locations`, `bundle.containers ?? world?.containers`, `activeLocationId`, `recalledItems`, `unlockLore`, and `revealedLoreIds`, plus a subtle `GM Mode · Secrets Unlocked` badge when `unlockLore` is active.
- [x] Clean up `LiveInspector.tsx`:
  - [x] Remove `InspectorInternalsSection`, `LoreIndexModal`, and their state/imports from `LiveInspector.tsx`.
  - [x] Retire `InspectorInternalsSection.tsx` if unused and remove unused CSS selectors.
- [x] Add styling for `ContextHealthModal` tabs, `Scene & Recall` panel, and embedded `LoreIndexPanel` in `04-chat-and-turns.css` / `06-inspector-and-lore.css`.

## Phase 5: Automated Tests, Architecture Docs, Mechanics & Wiki Sync
- [x] Update existing Vitest suites and add targeted new test coverage:
  - [x] `branchGraphAndStory.test.tsx`: assert `World Clock` and `Internals` are removed from `LiveInspector`, `Here` renders in `LiveInspector`, and `[Clock | Turn #N]` renders in `ChatStage`.
  - [x] `responsiveCampaignPanels.test.tsx`: assert desktop Location badge hides when `isInspectorOpen={true}` and shows when `false`, compact `[Clock | #N]` renders in `ChatStage`, and `InspectorLocationCard` retains accessible `"World Sheet"` trigger.
  - [x] `physicalStance.test.tsx`: assert Persona card portrait, conditional `You` pill, sibling `Edit`/`?` controls (no nested `<button>`), Codex persona link, `"Set stance"` quiet cue, suppressed `Present` pill inside `Here`, `"No other characters here"` solo hint, and `Elsewhere (N)` partitioning.
  - [x] `codexGameMechanics.test.tsx`: verify `ContextHealthModal`'s `Scene & Recall` tab and Persona card render their `MechanicsHelpButton` links cleanly.
  - [x] `locationContainers.test.tsx`: add assertions verifying GM Mode OFF hides unrevealed `secret` entries across World, Location, and L1 Container lore while showing revealed `Discovered` secrets and NPC shards, and GM Mode ON exposes all secrets with `Secret` badge.
  - [x] `contextHealth.test.tsx`: test all 3 `ContextHealthModal` tabs (`Telemetry`, `Scene & Recall`, `Lore Index`), Turn #0 non-blocking tabs, and historical turn flags/recalls.
  - [x] `tabbedSheetModals.test.tsx`: verify `CodexFocusRequest` `kind: "persona"` focuses Player Persona in `WorldCodexTab`.
  - [x] Add unit tests for `splitWorldClockDisplay` (canonical `YYYY-MM-DD HH:MM`, `HH:MM:SS`, ISO `T`, and custom non-`HH:MM` calendars) and streaming colon blink class in `ChatStage`.
- [x] Update in-app Game Mechanics (`frontend/src/components/world/mechanics/mechanicsCatalog.ts`):
  - [x] Sync `spatial-physical-stance`, `memory-context-health`, `memory-lore-flags`, and `gm-mode` descriptions to reflect the `Here` Persona card, top-bar clock/turn bezel, and 3-tab `ContextHealthModal`.
- [x] Update sibling user-facing wiki (`../cybercantina-wiki`):
  - [x] `First-Campaign-and-Interface-Tour.md`
  - [x] `Live-Inspector-Map-and-Timeline.md`
  - [x] `Context-Sizing-and-Performance.md`
  - [x] `Playing-Directing-and-Mechanics.md`
  - [x] Verify with `git -C ../cybercantina-wiki diff`.
- [x] Run full verification suite & update feature docs to `status: completed`:
  - [x] `npm --prefix frontend run arch:check`
  - [x] `npm --prefix frontend run css:audit`
  - [x] `npm --prefix frontend run build`
  - [x] `npm --prefix frontend test`
  - [x] `backend/.venv/bin/python scripts/generate_arch_docs.py && backend/.venv/bin/python scripts/generate_arch_docs.py --check`
  - [x] Mark all Phase 0–5 checkboxes `[x]` and update `status: completed` across `FRD.md`, `REVIEW.md`, and `PLAN.md`.
