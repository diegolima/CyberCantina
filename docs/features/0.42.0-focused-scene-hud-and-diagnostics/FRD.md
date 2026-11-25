---
feature: focused-scene-hud-and-diagnostics
target_version: 0.42.0
document_type: frd
status: completed
last_updated: 2026-11-25
---

# Feature Requirements Document — v0.42.0 Focused Scene HUD & Consolidated Diagnostics

## 1. Overview & Motivation

Currently, the campaign workspace duplicates temporal metadata across panels and mixes diegetic scene awareness with engine-level debugging inside the right-hand `LiveInspector`:

- **Mixed-concern right pane (`LiveInspector.tsx`):** The 370 px right column currently stacks four different categories of UI: (1) a `World Clock` + `Turn #N` card (whose timestamp duplicates the top stage header), (2) the `Adjacent Map` spatial card, (3) a flat ungrouped list mixing a plain text-only `"You"` physical-stance strip with rich portrait NPC `CharacterRow` cards (including absent/elsewhere NPCs), and (4) an `Internals` diagnostics drawer + `LoreIndexModal` launcher.
- **Visual asymmetry & redundant badges:** The player's own physical strip lacks a portrait or card parity with NPC rows, while every co-present NPC card displays a redundant green `📍 Present` badge inside an already-present roster.
- **Header crowding vs. mobile loss:** On narrower desktops, `.stage-header-badges` shows a Location pill that duplicates the top of the right pane, while on compact phones (`<= 620px`) `.stage-header-badges { display: none; }` would completely hide the World Clock once the right-pane clock card is removed.
- **Subtle spoiler leak in `LoreIndexModal`:** `LoreIndexModal.tsx` currently skips `category === "secret"` on `location_lore` and `container_lore`, yet exposes raw `world.lore_nodes` (even unrevealed secrets and bypassing CoW campaign overrides in `bundle.world_lore_nodes`).

**Core UX Goal:** Focus the right pane strictly on an immersive in-world HUD of **`[Where is here]` (top, Spatial Map)** + **`[Who is here]` (bottom, Scene Presence)** in both Player Mode and GM Mode; consolidate temporal telemetry into a single compact top-bar instrument bezel; and consolidate under-the-hood engine diagnostics into a 3-tab `ContextHealthModal` with Codex-parity spoiler gating.

---

## 2. Agreed Product Decisions

### 2.1 Top-Bar Temporal Bezel (`[Clock | Turn #N]`)

- **Remove right-pane World Clock card:** Delete the top `World Clock` card from `LiveInspector.tsx`, elevating the Spatial Map card to the top of the right pane.
- **Unified dark bezel (`ChatStage.tsx` `.stage-header`):**
  - Replace the separate grey clock pill with a single unified dark-bezel cluster matching `.clock-display`'s visual identity (`--bg-deep`, `--amber-border-subtle`, monospace `tabular-nums`), scaled to compact stage-header proportions (`~0.78–0.84rem`).
  - Layout: **`[ClockIcon] <world_timestamp> | Turn #<depth>`** (with a subtle vertical hairline separator between timestamp and turn counter).
  - Left segment displays `bundle.current_world_snapshot.world_timestamp` in crisp amber (`--accent-amber` / `--amber-fg`).
  - Right segment displays `Turn #<N>` (using `lastBranchTurn?.depth_index ?? 0`) in muted secondary monospace (`--text-secondary`). On compact phones (`<= 620px`), abbreviate `Turn #N` to `#N` to preserve horizontal space.
- **Clickable Turn Shortcut:**
  - Make the `Turn #N` segment a `<button type="button">` that opens **Story & Timelines** (`onOpenStoryTimelines`) with a clear `title`/`aria-label` (e.g., `"Open Story & Timelines (Turn #N)"`). Fall back cleanly to a non-interactive `<span>` when `onOpenStoryTimelines` is omitted (e.g., isolated component tests).
- **Colon `:` Animation & Time-Advance Feedback:**
  - **Solid at rest:** Keep the `HH:MM` colon solid when idle—avoiding a continuous 1 Hz idle blink that implies real-time clock progression in a turn-based world and distracts during prose reading/writing.
  - **Streaming blink:** Blink the `HH:MM` colon via pure CSS `opacity` modulation **only while a turn is actively running** (`isBusy = isStreaming || isPhase4Running`).
  - **Advance flash:** Play a brief amber border/glow flash (`clockAdvanceFlash`) when `world_timestamp` actually changes within the same campaign after a turn resolves (never firing on initial mount or campaign switch).
  - **Calendar safety & reduced motion:** Match only an explicit `HH:MM` time separator (non-overlapping regex / linear parser) so custom non-`HH:MM` calendars supported by `backend/app/engine/world_clock.py` (e.g., `"3rd Moon of Frost"`, `"Day 4 (+15m)"`) render untouched with zero colon blink. Disable both colon blinking and advance flash under `@media (prefers-reduced-motion: reduce)`.

### 2.2 Top-Bar Responsive Layout & Location Badge Budget

- **Desktop / Tablet (`> 620px`):**
  - Hide the top-bar `[MapPin <active_location.name>]` pill whenever the right inspector pane is open (`isInspectorOpen === true`), because the Map card now owns the top of the right pane.
  - Show the top-bar Location pill when the right inspector pane is collapsed/hidden (`!isInspectorOpen`), keeping current room context visible without cluttering `.stage-header`.
- **Compact Phone (`<= 620px`):**
  - Hide the Location pill and `.stage-actor-tagline`, while **keeping the compact `[Clock | #N]` bezel visible** in `.stage-header` so phone users retain instant visibility into in-world time and turn depth after removing the right-pane clock card.

### 2.3 Right-Pane Top Map Card & Relocated Collapse/Close Control

- **Relocated inspector toggle:** Move the right pane's collapse/close button (`PanelRightClose` on desktop, `X` when `mode === "overlay"`, preserving `aria-expanded={mode !== "hidden"}` and `aria-controls={id}`) from the removed World Clock card into the top-right corner of `InspectorLocationCard`.
- **Single-line header ergonomics (370 px width):** Streamline `InspectorLocationCard`'s header row so title, actions, and close/collapse fit cleanly on one row without awkward wrapping:
  - Concise header label (e.g., `Map` / `Adjacent Map` with `<Compass />`, keeping exit count in the collapsible `Exits (N)` toggle or compact sub-label).
  - Compact `World` button (`<Globe />` + `"World"`, preserving `title="Open World Sheet & campaign World Settings"` and `aria-label="Open World Sheet & campaign World Settings"`).
  - Compact `Expand` button (`<Maximize2 />` + visible location count `N`, preserving `title="Expand full zoomable world map"` and `aria-label` containing `"Expand Map"`).
  - Collapse/close button anchored cleanly at the far right edge when `onClose` is provided.

### 2.4 Right-Pane Presence (`Here` + Collapsed `Elsewhere (N)`) & Persona Card Parity

Replace the unheaded player stance strip + flat mixed character list with two focused spatial sections below the Map card:

1. **`Here` (always expanded):**
   - Header bar: icon + **`Here`** + scene headcount (`1 + presentRows.length`).
   - **User Persona card (top entry):**
     - Uses the same compact horizontal card anatomy as `CharacterRow`: 34×34 circular portrait to the left of the name (resolved via `getEntityPrimaryImage("personas", persona)` with a `<User />` fallback icon when no portrait or no persona is attached) framed with a cyan accent ring (`--cyan-border`, matching `.user-prompt-avatar`), bold `0.86rem` name (`persona.name.trim()` or `"You"`).
     - **Visual distinction:** Render a subtle cyan **`You`** pill next to the persona name—omitted when the displayed name already falls back to `"You"` so it never reads `"You [You]"`.
     - **Non-nested interactive controls:**
       - Clicking the persona identity opens **Codex → Player Persona** (`onOpenPersonaInCodex`) when `bundle.campaign.persona_snapshot` is attached (non-clickable plain identity when `persona_snapshot === null`).
       - Keep the inline physical stance `Edit` button and `?` `MechanicsHelpButton` (`topicId="spatial-physical-stance"`) as **sibling buttons** on the right edge (never nested inside a `<button>`).
       - Clicking `Edit` expands the compact inline physical stance editor inside the card underneath the header row.
     - **Line 2 (Physical stance & position):** Show the stance pill + `physical_context` when established (`stance !== "unspecified"` or `physical_context.trim() !== ""`). When both are empty/unspecified, render a quiet muted `"Set stance"` cue instead of the noisy `"Unspecified"` pill + `"No active physical pose tracked yet."` sentence.
   - **Present NPC `CharacterRow` cards:**
     - Rendered below the User Persona card (primary character first among present NPCs, preserving existing sort order).
     - Suppress the redundant green `📍 Present` prefix inside `Here` (`showPresenceLabel={false}`), letting line 2 lead cleanly with `state.mood_label` (while retaining party role pills, active emotion badge, physical stance pill, change dot, composure meter, `MiniMoodBars`, and click-to-open-Codex behavior).
   - **Solo / empty room state:** When `presentRows.length === 0`, display a compact muted footer note (`"No other characters here"`).

2. **`Elsewhere (N)` (collapsed by default):**
   - Rendered as a collapsible `InspectorSection` (`storageKey="elsewhere"`, `defaultOpen={false}`) directly below `Here`, **omitted completely when `N === 0`**.
   - Off-scene NPC rows keep dimmed `.char-row-absent` styling and the `📍 Elsewhere · <LocationName>` label (`showPresenceLabel={true}`).

### 2.5 Consolidated 3-Tab `ContextHealthModal` & Codex-Parity Spoiler Gating

- **Strict `[Where] + [Who]` right pane:** Remove `InspectorInternalsSection` and the `LoreIndexModal` mount from `LiveInspector.tsx` completely—even when GM Mode is active—so the right inspector stays dedicated to Map + `Here` / `Elsewhere`.
- **3-Tab `ContextHealthModal` (`Telemetry` | `Scene & Recall` | `Lore Index`):**
  - Expanding `ContextHealthModal` instead of launching a nested `LoreIndexModal` eliminates modal stacking (`frontend/AGENTS.md` Section 6) and groups all engine diagnostics in one place.
  - **Tab 1 — `Telemetry` *(default)*:** Preserves the existing 4-zone token breakdown bar, summary stats, actionable recommendations, and per-phase expandable tables. At Turn #0 (`!telemetry || overallStatus === "idle"`), keep the tab bar accessible so users can immediately switch to `Scene & Recall` or `Lore Index`.
  - **Tab 2 — `Scene & Recall`:** Houses the relocated `Internals` runtime telemetry:
    - Summary line: branch turns count, episodic chunks count, and total visible indexed lore/shard entries.
    - Contextual `MechanicsHelpButton` for `topicId="memory-lore-flags"` (`"Lore Recall, Secrets & Scene Flags"`).
    - **Active / Turn Scene Flags:** Uses `modalTelemetryTurn?.world_snapshot.scene_flags ?? bundle.current_world_snapshot.scene_flags` with the `FLAG_PREVIEW_LIMIT = 12` `"Show all N flags"` / `"Show fewer"` toggle.
    - **Recalled Items (`recalled_items`):** Uses `modalTelemetryTurn?.recalled_items ?? []` (with turn-aware header `"Recalled on Turn #N"` when inspecting a historical turn vs. `"Recalled Last Turn"` on the active leaf), preserving color-coded source badges, similarity scores, and expandable text previews.
  - **Tab 3 — `Lore Index`:** Embeds the searchable, category-filterable Shards & Lore Index (`All`, `Shards`, `World`, `Containers`, `Locations`) directly inside `ContextHealthModal`, reading branch-scoped CoW world lore (`bundle.world_lore_nodes ?? world.lore_nodes`), `bundle.visible_locations`, `bundle.containers ?? world.containers`, and campaign character records.
- **Spoiler Gating in `Lore Index` (Codex Parity):**
  - Use `isSecretLoreRevealed` (`frontend/src/components/world/codexHelpers.ts`) across **all three lore scopes** (World Lore, Location Lore, and L1 Container Lore):
    - **GM Mode OFF (`unlockLore === false`):** Omit unrevealed `category === "secret"` entries from World, Location, and L1 Container lore (and exclude them from filter counts). Keep revealed secrets visible with a `Discovered` badge, and keep campaign character `memory_shards` visible (matching World Codex behavior).
    - **GM Mode ON (`unlockLore === true`):** Include all secret entries with a `Secret` badge (or `Discovered` if already revealed in play) and show a subtle `GM Mode · Secrets Unlocked` badge inside the index toolbar/header.

---

## 3. Core Invariants & Non-Goals

### Invariants
1. **Zero nested interactive elements:** Persona card Codex navigation and inline `Edit` / `?` controls are sibling `<button>`s, never nested.
2. **Zero stacked modals:** `LoreIndexPanel` renders inline inside `ContextHealthModal`'s 3rd tab; `ContextHealthModal` never opens `LoreIndexModal` on top of itself, and `MechanicsHelpButton` closes `ContextHealthModal` cleanly before routing to Codex Mechanics.
3. **Codex-identical spoiler boundaries:** No unrevealed `category === "secret"` lore from World, Location, or L1 Container scopes can appear in `Lore Index` when `unlock_lore` is false.
4. **Architecture & CSS compliance:** Zero runtime circular or cross-layer violations under `npm --prefix frontend run arch:check`, zero orphan CSS / undefined keyframes / `!important` under `npm --prefix frontend run css:audit`, and all new animations suppressed under `prefers-reduced-motion: reduce`.
5. **Turn-based clock fidelity:** Custom calendars never get spurious blinking colons; advance flash triggers only when `world_timestamp` changes within the same campaign.

### Non-Goals
- No backend API, SQLite schema, `.zcc` format, or turn-engine changes (purely frontend presentation, wiring, tests, and documentation).
- No changes to World Clock advancement logic (`backend/app/engine/world_clock.py`) or GM Mode backend spoiler gating (`gm_talk.py` / `gm_tools.py`).
- No removal of per-turn `RAG Injected: N shards` pills on `TurnCard` or per-turn Clerk diffs in `AgentChangesModal`.
