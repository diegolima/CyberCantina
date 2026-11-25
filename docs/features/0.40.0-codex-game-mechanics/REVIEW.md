---
feature: codex-game-mechanics
target_version: 0.40.0
document_type: review
status: completed
last_updated: 2026-11-25
---

# Pre-Implementation Review — v0.40.0 Codex Game Mechanics Reference

## Key Architectural Traps & Mitigations

### 1. Leaf Contract Layering (`dependency-cruiser` / `arch:check`)
- **Context:** `frontend/.dependency-cruiser.cjs` enforces strict unidirectional layering (`no-circular` excluding `type-only`, `no-types-outgoing` forbidding `src/types/` from importing outside `src/types/`, and `no-hooks-to-components`). Meanwhile, contextual `?` triggers live across `chat/`, `map/`, `party/`, `story/`, `inspector/`, and `world/`, and shared mechanics constants live in `src/types/affective.ts`, `src/utils/slashCommands.ts`, `src/utils/spatialDistance.ts`, `src/components/map/topologyProjection.ts`, and `src/components/chat/contextHealthHelpers.ts`.
- **Note on Existing Module:** `frontend/src/types/mechanics.ts` already exists (holding `DiceMode`, `ChoiceGate`, `PreTurnAnalysis`, etc.) and is re-exported by `frontend/src/types/index.ts`.
- **Mitigation:**
  - Define `MechanicsTopicId`, `MechanicsSubcategoryId`, and `CodexReturnTarget` inside `frontend/src/types/mechanics.ts` (importing nothing outside `src/types/`, keeping `no-types-outgoing` satisfied).
  - Keep `CodexFocusRequest` extended in `WorldCodexTab.tsx` (or promoted into `src/types/mechanics.ts` as a pure type if needed by `App.tsx`) using `import type`.
  - Keep `mechanicsCatalog.ts` and `mechanicsHelpers.ts` under `frontend/src/components/world/mechanics/` importing only `src/types/`, `src/utils/`, `topologyProjection.ts`, and `contextHealthHelpers.ts`—never importing `WorldCodexTab` or `App.tsx`—guaranteeing zero circular dependencies.

### 2. Modal Stacking & `WorldInspectorModal` Remount Key Trap (`App.tsx:981`)
- **Trap:** In `frontend/src/App.tsx`, `WorldInspectorModal` is currently mounted with:
  ```tsx
  key={`${bundle.campaign.id}:${campaignWorldSheetTab}`}
  ```
  If an internal jump from **Map** or **World Settings** updates `campaignWorldSheetTab` from `"map"` or `"settings"` to `"codex"` on the parent, React **unmounts and remounts** `WorldInspectorModal`, wiping any unsaved map edits, pending drafts, or scroll/selection state!
- **Trap 2 (External Modal Stacking):** `StoryModal`, `PartyManagementModal`, and `ContextHealthModal` are independent overlays. Opening `WorldInspectorModal` while one of them stays mounted would cause stacked modals and competing `Escape` handlers.
- **Mitigation:**
  - **Internal `WorldInspectorModal` jumps (`Map`, `World Settings`, `Major Characters` → `Game Mechanics`):** Handle tab switching and focus **internally inside `WorldInspectorModal` / `WorldCodexTab`** without mutating `campaignWorldSheetTab` in `App.tsx`. Pass `onOpenMechanicsHelp(topicId, returnTarget)` from `WorldInspectorModal` into `WorldSettings` and `SpatialTopologyView` (`MapDetailsDrawer` → `MapLinkInspectorSection`), switching `activeTab` to `"codex"` and setting `codexFocusRequest` + `returnTarget` (`{ kind: "tab", tab: "settings" | "map", label: "World Settings" | "Map" }` or `{ kind: "character", characterId, subtab, label }`). Clicking **`← Return to ...`** switches back without losing modal drafts.
  - **External campaign jumps (`ContextHealthModal`, `LiveInspector`, `ChatComposer`, `DirectorChoicesDrawer`, `PartyManagementModal`, `StoryModal`, `GmTalkDrawer`):** Route through one `handleOpenMechanicsGuide(topicId: MechanicsTopicId)` callback in `App.tsx` that cleanly closes transient modals (`setStoryModalTab(null)`, `setIsPartyModalOpen(false)`, and having `ContextHealthModal` call `onClose()` before `onOpenMechanicsHelp`) and opens `WorldInspectorModal` on `"codex"` with `{ kind: "mechanics", topicId, nonce }`. When `WorldInspectorModal` is opened via `Expand Map` inside `LiveInspector` (not `WorldInspectorModal` itself), `SpatialTopologyView` closes its own expanded overlay before calling `onOpenMechanicsHelp`.

### 3. Zero Contamination of World Canon, Counts, Validation & Exports
- **Trap:** `CODEX_SECTIONS` in `codexHelpers.ts` currently assumes every non-special section is an `EditableCodexSectionId` backed by `lore_nodes` (`countInvalidWorldLoreBySection`, `filterAndRankWorldLore`, `isEditableCodexSection`, `handleAddLoreEntry`). Adding `"mechanics"` blindly to `EditableCodexSectionId` or `WorldLoreCategory` would inject fake entries into validation, `World Codex (N)` counts, or `.zcc` exports.
- **Mitigation:**
  - Add `"mechanics"` to `CodexSectionId` (with `isSpecial: true`, `campaignOnly: false`, `categories: []`) **or** keep `WORLD_CODEX_HUB_SECTIONS` (the 6 world/campaign cards) explicitly separated from `MECHANICS_SECTION_META`, so `hubSectionData` keeps the exact 3×2 grid and the Game Mechanics shelf renders deterministically below it.
  - Ensure `isEditableCodexSection("mechanics") === false`, `countInvalidWorldLoreBySection` ignores it, `World Codex (${loreNodes.length})` and `WorldInspectorModal`'s Codex tab badge count only `loreNodes.length`, and `handleAddLoreEntry` stays hidden whenever `activeSection === "mechanics"`.

### 4. Global Codex Search Partitioning & Keyboard Navigation
- **Trap:** Mixing mechanics hits into the same flat `matchThreeTier` sort as `lore_nodes` causes system documentation to outrank in-world lore (e.g., searching `"threat"` matching `"Prompt Threat"` / `"Threat"` in CARE). Conversely, completely omitting mechanics from Global Search hides answers when users search `"composure"` or `"d20"` from the Codex Hub.
- **Mitigation:**
  - Keep `searchAllCodexEntries` returning in-world hits first, followed by a separate partitioned `searchMechanicsArticles(query)` list rendered under an explicit **`Game Mechanics (N)`** divider header in the Global Search left pane.
  - Derive `visibleRowKeys` as `[...worldHits.map((h) => h.key), ...mechanicsHits.map((h) => h.key)]` so `ArrowUp`/`ArrowDown` keyboard navigation and default right-pane selection seamlessly cross from world hits into mechanics hits without special-casing key handlers.

### 5. Single-Source-of-Truth Constant Reuse vs. Documentation Drift
- **Trap:** Hardcoding duplicated numbers or labels in prose paragraphs guarantees drift the next time a preset, slash command, or speed modifier is tuned.
- **Mitigation:**
  - Import live typed metadata directly into `mechanicsCatalog.ts`:
    - `TEMPERAMENT_ARCHETYPE_OPTIONS` (`frontend/src/types/affective.ts`) for all 6 archetype labels, summaries, and `Under the Hood` parameters (`relational_inertia`, `negativity_ratio`, `composure_resilience`, default worldview).
    - `SLASH_COMMANDS` (`frontend/src/utils/slashCommands.ts`) for Narrator, `/party`, `/choice`, and `/gm` command syntaxes/aliases.
    - `WALKING_METERS_PER_MINUTE`, `MIN_EDGE_SPEED_MODIFIER`, `MAX_EDGE_SPEED_MODIFIER`, and `LINK_SPEED_PRESET_GROUPS` (`frontend/src/utils/spatialDistance.ts`) for link travel speed bands and clock floor examples.
    - `CONTAINER_DEPTH_LABELS` (`frontend/src/components/map/topologyProjection.ts`) for Levels 1–4 container hierarchy labels.
    - `PHASE_DISPLAY_META` (`frontend/src/components/chat/contextHealthHelpers.ts`) for P1/P3/P4/P5 Context Health labels.
  - Keep backend CARE half-lives (`30m` threat, `45m` arousal, `3h` dominance, `4h` composure rest, `6h` valence, `14d` bond anchor, `35%` somatic leakage threshold) and d20 outcome margin thresholds (`nat 1` / `<= -6`, `-5..-3`, `-2..-1`, `0..+4`, `nat 20` / `>= +5`) scoped inside clean structured rows / `Under the Hood` drawers matching `backend/app/engine/affective/models.py` and `backend/app/engine/phase1_pre.py`.

### 6. Contextual `?` Button Ergonomics & Visual Restraint
- **Trap:** Adding 12 bright `?` icons across dense cards can create visual noise or trigger accidental parent clicks (for example, inside `CampaignCharacterStateTab` where bond cards are clickable toggles, or inside `InspectorSection` collapsible headers).
- **Mitigation:**
  - Style `MechanicsHelpButton` (`.ui-mechanics-help-btn`) with muted low-contrast resting opacity (`var(--text-muted)`), compact circular/icon hit target (`18–20px` visual, comfortable click area), and subtle cyan highlight on hover/focus-visible.
  - Always call `e.stopPropagation()` inside `MechanicsHelpButton`'s `onClick` so clicking `?` inside a collapsible header (like `InspectorInternalsSection`'s `InspectorSection` or a `Dyadic Relational Bonds` header) never toggles the accordion or submits a form (`type="button"`).
  - Never render `?` inside `<button>` elements (invalid nested interactive HTML — place `?` as a sibling button inside a flex header wrapper whenever the adjacent control is a `<button>`).

### 7. Modular CSS, Semantic Colors & `css:audit` Hygiene
- **Context:** `frontend/src/styles.css` enforces ordered imports (`02-primitives.css` → `12-world-codex.css` → `15-responsive.css`), and `npm --prefix frontend run css:audit` fails on unused/orphan selectors.
- **Mitigation:**
  - Place `.ui-mechanics-help-btn` in `02-primitives.css`, all `.codex-mechanics-*` / `.codex-hub-shelf*` / `.codex-pill-divider` classes in `12-world-codex.css`, and responsive adjustments (breakpoints aligned to `620px`, `820px`, `1100px`) in `15-responsive.css`.
  - Reserve `--accent-rose` strictly for negative poles, grievance, or failure tiers; use `--accent-cyan`, `--accent-emerald`, `--accent-amber`, and `--accent-violet` consistently with existing Codex badges.

### 8. Node-Only Vitest Verification
- **Context:** `frontend/package.json` runs Vitest in pure Node without `jsdom` or `@testing-library/react`.
- **Mitigation:**
  - Keep catalog lookup, 2-level tree construction, category filtering, auto-expansion, and Global Search partitioning in pure TypeScript helpers (`mechanicsHelpers.ts`) testable directly in Node.
  - Pair pure helper tests with `ReactDOMServer.renderToStaticMarkup` assertions covering the Codex Hub shelf, `Game Mechanics` 2-pane tree + detail + `Under the Hood` drawer, separated Global Search groups, `← Return to ...` button, and contextual `MechanicsHelpButton` rendering across target surfaces.
