---
feature: codex-game-mechanics
target_version: 0.40.0
document_type: plan
status: completed
last_updated: 2026-11-25
---

# Implementation Plan — v0.40.0 Codex Game Mechanics Reference

## Stage 0: Feature Package Lifecycle Artifacts
- [x] Author `FRD.md`
- [x] Author `REVIEW.md`
- [x] Author `PLAN.md`

## Stage 1: Leaf Types, Static Mechanics Catalog & Pure Helpers
- [x] Extend `frontend/src/types/mechanics.ts` (re-exported via `frontend/src/types/index.ts`) with leaf contracts:
  - [x] `MechanicsSubcategoryId` (`"care" | "dice" | "directing" | "spatial" | "memory" | "timelines" | "gm"`)
  - [x] `MechanicsTopicId` (23 union slugs across all 7 subcategories)
  - [x] `CodexReturnTarget` (discriminated union for returning to a character dossier subtab or `WorldInspectorModal` tab)
- [x] Create `frontend/src/components/world/mechanics/mechanicsCatalog.ts`:
  - [x] Define `MechanicsSubcategoryMeta`, `MechanicsScaleRow`, `MechanicsUnderTheHoodSpec`, and `MechanicsArticle` interfaces.
  - [x] Define `MECHANICS_SUBCATEGORIES` (7 subcategories with display labels, icons/accents, and brief descriptions).
  - [x] Author all 23 concise, 4-part `MECHANICS_ARTICLES` entries (`inOneLine`, `scales`, `howItChanges`, `effectOnPlay`, optional `underTheHood`, `relatedTopicIds`, `keywords`):
    - [x] `care` (5): `care-overview`, `care-worldview-temperament`, `care-mood-composure`, `care-scene-appraisal`, `care-dyadic-bonds` (importing `TEMPERAMENT_ARCHETYPE_OPTIONS`).
    - [x] `dice` (3): `dice-modes`, `dice-outcome-tiers`, `dice-director-choices`.
    - [x] `directing` (3): `directing-whispers-privacy`, `directing-narrator-clock`, `directing-knowledge-gossip` (importing `SLASH_COMMANDS`).
    - [x] `spatial` (3): `spatial-parties`, `spatial-hierarchy-portals`, `spatial-links-travel` (importing `CONTAINER_DEPTH_LABELS`, `WALKING_METERS_PER_MINUTE`, `LINK_SPEED_PRESET_GROUPS`).
    - [x] `memory` (3): `memory-3-tier`, `memory-context-health`, `memory-lore-flags` (importing `PHASE_DISPLAY_META`).
    - [x] `timelines` (3): `timelines-branching`, `timelines-graph-bookmarks`, `timelines-major-events`.
    - [x] `gm` (3): `gm-neuromancer`, `gm-mode`, `gm-overrides-locks`.
- [x] Create `frontend/src/components/world/mechanics/mechanicsHelpers.ts`:
  - [x] `buildMechanicsTree(query?: string)` returning grouped 2-level tree nodes (`subcategory` + `article` leaves) and `autoExpandedSubcategoryIds` matching `Locations` tree ergonomics.
  - [x] `flattenVisibleMechanicsTree(roots, expandedIds)` for deterministic keyboard `ArrowUp`/`ArrowDown` traversal and default selection.
  - [x] `searchMechanicsArticles(query)` returning `Title` / `Keyword` / `Content` match tiers cleanly separated from world canon.
  - [x] `getMechanicsArticle(topicId)` lookup helper.

## Stage 2: Mechanics Detail View & `WorldCodexTab` Integration
- [x] Create `frontend/src/components/world/mechanics/CodexMechanicsDetail.tsx`:
  - [x] Header with subcategory breadcrumb, accent badge, title, and **In One Line** lead summary.
  - [x] 4-part structured cards: *Metrics, Modes & Scales* (accent-coded rows/badges), *How It Changes*, and *Effect on Play*.
  - [x] Optional collapsible **`Under the Hood`** inline drawer (collapsed by default, matching `Creator Notes` / `Opening Scene` toggle UX).
  - [x] Clickable **`Related Topics`** chips calling `onSelectTopic(topicId)`.
- [x] Update `frontend/src/components/world/codexHelpers.ts`:
  - [x] Add `"mechanics"` to `CodexSectionId` while keeping `CODEX_SECTIONS` (6 world/campaign cards) preserving the 3×2 world grid and `isEditableCodexSection("mechanics") === false`.
  - [x] Ensure `countInvalidWorldLoreBySection`, `lore_nodes` counts, and world edits never touch `"mechanics"`.
- [x] Update `frontend/src/components/world/WorldCodexTab.tsx`:
  - [x] Render the full-width **`Game Mechanics`** (`Reference`) Hub shelf beneath `.codex-hub-grid` with subcategory quick-jump chips (enabled across all modes: `campaign`, `inspector`, `wizard`).
  - [x] Render the **`Game Mechanics`** pill in `.codex-section-pills` after a subtle `.codex-pill-divider`.
  - [x] Render the 2-level collapsible tree, `Expand All` / `Collapse All` toolbar, and scoped filter input in the left pane (`care` expanded and `care-overview` selected by default).
  - [x] Render matching mechanics hits in a separate **`Game Mechanics (N)`** group below in-world hits in Global Search, keeping `visibleRowKeys` unified for `ArrowUp`/`ArrowDown`.
  - [x] Extend `CodexFocusRequest` to support `{ kind: "mechanics"; topicId: MechanicsTopicId; returnTarget?: CodexReturnTarget | null; nonce: number }` and render a **`← Return to <Context>`** topbar button when a `returnTarget` is active.

## Stage 3: Reusable Contextual `?` Help Button & Cross-App Deep-Linking
- [x] Create `frontend/src/components/shared/MechanicsHelpButton.tsx` (`type="button"`, `HelpCircle` icon, `e.preventDefault(); e.stopPropagation()`).
- [x] Wire Codex-internal & `WorldInspectorModal` triggers (in-place switching with `returnTarget`, zero draft loss):
  - [x] `frontend/src/components/world/codexCharacter/CampaignCharacterStateTab.tsx` (PAD & Composure → `care-mood-composure`, `Layer 3 · Scene Appraisal` → `care-scene-appraisal`, `Layer 1 · Active Worldview` → `care-worldview-temperament`, `Layer 4 · Dyadic Relational Bonds` → `care-dyadic-bonds`, `Knowledge of You` → `directing-knowledge-gossip`).
  - [x] `frontend/src/components/world/CodexCharacterDetail.tsx` (`Personality` → `Baseline Psyche & Emotional Defaults` → `care-worldview-temperament`).
  - [x] `frontend/src/components/world/WorldInspectorModal.tsx` (`World Settings` → `Unlock Lore & Secrets (GM Mode)` → `gm-mode` with `returnTarget` to `"settings"`; internal `Map` → `SpatialTopologyView` link inspector → `spatial-links-travel` with `returnTarget` to `"map"`).
- [x] Wire external campaign triggers cleanly via `handleOpenMechanicsGuide(topicId)` in `frontend/src/App.tsx`:
  - [x] `frontend/src/components/chat/ContextHealthModal.tsx` (header → `memory-context-health`, closes modal before opening Codex).
  - [x] `frontend/src/components/inspector/InspectorPrimitives.tsx`, `InspectorInternalsSection.tsx` & `LiveInspector.tsx` (header → `memory-lore-flags`; sibling button placement beside collapsible header button so `<button>` is never nested inside `<button>`).
  - [x] `frontend/src/components/chat/DirectorChoicesDrawer.tsx` (`dice-director-choices`) & `ChatComposer.tsx` (compact `?` next to Dice Mode toggle → `dice-modes`), threaded via `ChatStage.tsx` (`chatHelpers.tsx`).
  - [x] `frontend/src/components/party/PartyManagementModal.tsx` (header → `spatial-parties`, closes modal before opening Codex).
  - [x] `frontend/src/components/story/StoryModal.tsx` (header → tab-aware `memory-3-tier` / `timelines-major-events` / `timelines-branching` / `timelines-graph-bookmarks`, closes modal before opening Codex).
  - [x] `frontend/src/components/chat/GmTalkDrawer.tsx` (header → `gm-neuromancer`, minimizes drawer before opening Codex).
  - [x] `frontend/src/components/map/MapLinkInspectorSection.tsx` → `MapDetailsDrawer.tsx` → `SpatialTopologyView.tsx` (`Speed Modifier` / `Secret Passage` → `spatial-links-travel`, closing expanded map overlay when invoked from `LiveInspector`).

## Stage 4: Modular Stylesheets & Responsive Polish
- [x] Update `frontend/src/styles/02-primitives.css`: add `.ui-mechanics-help-btn` resting/hover/focus-visible styles.
- [x] Update `frontend/src/styles/06-inspector-and-lore.css`: add `.inspector-section-header-row` and `.inspector-section-header-action`.
- [x] Update `frontend/src/styles/12-world-codex.css`: add `.codex-hub-shelf*`, `.codex-pill-divider`, `.codex-search-group-header`, and `.codex-mechanics-*` styles (structured cards, scale grids, collapsible `Under the Hood` drawer, related-topic chips).
- [x] Update `frontend/src/styles/15-responsive.css`: adjust hub shelf, scale grid, and pill divider spacing across `820px` and `620px` breakpoints.

## Stage 5: Tests & Full Verification Suite
- [x] Create `frontend/src/components/__tests__/codexGameMechanics.test.tsx`:
  - [x] Verify all 7 subcategories and 23 `MechanicsTopicId` entries exist with non-empty 4-part copy and zero dangling `relatedTopicIds`.
  - [x] Verify `buildMechanicsTree` filtering & auto-expansion, `flattenVisibleMechanicsTree`, and Global Search grouping (world hits before `Game Mechanics (N)`).
  - [x] Verify `ReactDOMServer.renderToStaticMarkup` rendering for:
    - Codex Hub (3×2 grid + `Game Mechanics` shelf in both Campaign and World Edit modes, `World Codex (N)` excludes mechanics).
    - `Game Mechanics` 2-pane view (tree, `CARE` expanded by default, `CodexMechanicsDetail`, `Under the Hood` drawer, related chips, `← Return to ...` button).
    - Global Search partitioned order (world hits before `Game Mechanics (N)`).
    - `MechanicsHelpButton` on `CampaignCharacterStateTab`, `CodexCharacterDetail`, `ContextHealthModal`, `PartyManagementModal`, `StoryModal`, `DirectorChoicesDrawer`, `ChatComposer`, `GmTalkDrawer`, `InspectorInternalsSection`, `MapLinkInspectorSection`, and `WorldInspectorModal` (`Settings`).
- [x] Verify `frontend/src/components/__tests__/worldCodex.test.tsx` remains green cleanly without breaking existing assertions.
- [x] Run all verification checks:
  - [x] `npm --prefix frontend run arch:check`
  - [x] `npm --prefix frontend run css:audit`
  - [x] `npm --prefix frontend run build && npm --prefix frontend run typecheck:e2e`
  - [x] `npm --prefix frontend test`
  - [x] `backend/.venv/bin/python scripts/generate_arch_docs.py && backend/.venv/bin/python scripts/generate_arch_docs.py --check`

## Stage 6: User-Facing Wiki Documentation & Lifecycle Closure
- [x] Update `../cybercantina-wiki/First-Campaign-and-Interface-Tour.md` (document the Codex `Game Mechanics` reference shelf).
- [x] Update `../cybercantina-wiki/Live-Inspector-Map-and-Timeline.md` (document contextual `?` deep-links on CARE/Codex Character dossiers, `Internals`, `Map Link Inspector`, and `Story`).
- [x] Update `../cybercantina-wiki/Playing-Directing-and-Mechanics.md` (note the in-campaign `Game Mechanics` reference and contextual `?` buttons across Composer/Choices/Party/GM Talk/Context Health).
- [x] Update `../cybercantina-wiki/Context-Sizing-and-Performance.md` (note the contextual `?` trigger in `Context Health`).
- [x] Verify wiki diff with `git -C ../cybercantina-wiki diff`.
- [x] Mark all checkboxes `[x]` and update `status: completed` across `FRD.md`, `REVIEW.md`, and `PLAN.md`.
