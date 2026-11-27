---
feature: ux-and-wand-polish
target_version: 0.50.0
document_type: plan
status: completed
last_updated: 2026-11-27
---

# Implementation Plan — Home Mobile Header, Map Stay-Open Save & Magic Wand Prompt Polish

## Step 1: Feature Spec Package & Worktree
- [x] Create isolated worktree `.worktrees/ux-and-wand-polish` on branch `feat/ux-and-wand-polish`
- [x] Author `FRD.md` (`docs/features/TBD-ux-and-wand-polish/FRD.md`)
- [x] Author `REVIEW.md` (`docs/features/TBD-ux-and-wand-polish/REVIEW.md`)
- [x] Author `PLAN.md` (`docs/features/TBD-ux-and-wand-polish/PLAN.md`)
- [x] Receive explicit user approval before editing production code

## Step 2: Home Page Small-Screen Navbar (`HomeScreen.tsx`, `10-home.css`, `15-responsive.css`)
- [x] Update `frontend/src/components/HomeScreen.tsx` navbar markup:
  - Wrap `CYBERCANTINA` brand text in a responsive class (e.g., `.home-nav-brand-text`) while keeping accessible label on `.home-nav-brand`
  - Wrap button text labels (`Install App`, `Notes`, `Admin Area`) in `.home-nav-btn-label` spans (preserving `title` / `aria-label` and `.home-nav-badge` count) and add classes for profile name truncation (`.home-nav-profile-name`) and role pill (`.home-nav-profile-role`)
- [x] Update `frontend/src/styles/10-home.css` and `frontend/src/styles/15-responsive.css` (without `!important`):
  - At `<= 820px`: reduce `.home-navbar` horizontal padding and gaps, enforce `white-space: nowrap`, cap `.home-nav-profile-name` with ellipsis
  - At `<= 620px`: hide `.home-nav-brand-text`, `.home-nav-btn-label`, and `.home-nav-profile-role`, tighten icon-button padding (`32px–34px`), and configure `.home-nav-actions` as a `flex: 1; min-width: 0; overflow-x: auto; scrollbar-width: none` flex row with `flex-shrink: 0` items and a subtle right-edge fade mask for extreme narrow/zoomed screens (`<= 320px`)

## Step 3: Stay-Open Save & "Save & Close" Split Button
- [x] Create a reusable, Node-SSR-safe `SplitSaveButton` component (e.g., `frontend/src/components/shared/SplitSaveButton.tsx`) and `.ui-split-btn*` styles in `frontend/src/styles/02-primitives.css` (plus responsive/toolbar sizing in `09-spatial-topology.css` / `15-responsive.css`):
  - Primary click runs `onSave`; chevron `▾` (`>= 32px` touch target) toggles a popover menu with `Save & Close`
  - Handles outside-click and `Escape` dismissal (`stopPropagation()` when menu is open so parent modal doesn't close) inside `useEffect`
  - Falls back to a plain button when `onSaveAndClose` is omitted
- [x] Update `frontend/src/components/map/TopologyHeaderToolbar.tsx` and `frontend/src/components/SpatialTopologyView.tsx`:
  - Have `handleSaveClick` return `Promise<boolean>`
  - Add `onSaveAndClose` support to `TopologyHeaderToolbar` when `onClose` is available (`LiveInspector` fullscreen map and `WorldInspectorModal`)
  - Ensure prop reconciliation in `SpatialTopologyView` preserves `pan`, `zoom`, `currentContainerId`, and remaps selected IDs cleanly after stay-open saves
- [x] Update `frontend/src/components/world/WorldInspectorModal.tsx`, `frontend/src/components/AppModals.tsx`, and `frontend/src/App.tsx`:
  - Have `WorldInspectorModal.handleSave()` return `Promise<boolean>` and pass `onSaved(updated, false)` in `inspector` and `campaign` modes so primary `Save Changes` and `Save Map` both stay open (preserving `mode="wizard"` commit-and-exit)
  - Reconcile `activeWorldId`, `containers`, `locations`, `edges`, `loreNodes`, and `isDirty = false` from `updated` on stay-open save without remounting the modal
  - Wire `Save & Close` split button on `WorldInspectorModal` footer (`mode !== "wizard"`) and pass `onRequestClose={requestClose}` into `SpatialTopologyView` so map toolbar `Save & Close` saves the map and runs `requestClose()` (respecting dirty guard in campaign mode)

## Step 4: Backend Magic Wand & Wizard Prompt Improvements
- [x] Update `backend/app/schemas/enrich.py`:
  - Add `"location_summary"` to `EnrichFieldRole`
  - Add optional `parent_container_name: str | None = None`, `lore_title: str | None = None`, `lore_category: str | None = None`, and `lore_tags: list[str] | None = None` to `WorldLocationEnrichContextRef`
- [x] Update `backend/app/routers/enrich.py`:
  - **`location_description` (Location & Level-1 Container):** rewrite system + role-specific user prompt to demand 2–3 concrete, ambient present-tense sentences in a single paragraph (~30–55 words) strictly describing permanent physical space and atmosphere—no characters, dialogue, transient events, or second-person instructions; include `parent_container_name` when present; use `temperature=0.55` for spatial descriptions/summaries
  - **`location_summary`:** add strict 1-sentence (`<= 18 words`) adjacent-exit preview prompt (no dialogue/characters)
  - **`lore_content`:** pass `lore_title`, `lore_category`, `lore_tags` and target 2–4 concise, concrete in-universe sentences
  - **`location_tags`:** replace cyberpunk-skewed examples with genre-neutral sensory axes, eliminate duplicate `existing_tags` injection, and clamp strictly to `3–6` concise tags (`deduped[:6]`)
  - **`player_turn_prompt`:** resolve actual co-present NPCs at `target_loc_id` (`override_location_id` or `leaf_turn.world_snapshot.active_location_id`) instead of hardcoding `campaign.character_id`; handle solo rooms cleanly; include player persona name if available; take a word/sentence-bounded tail of recent prose; add explicit `"auto"` rewrite guidance preserving user intent without inventing actions/NPC reactions; tighten empty-draft target length
  - **`narrator_directive` & `character_persona`:** tighten prompts and add explicit `"auto"` polish rules
  - **Sanitization & Token Floor:** collapse multi-paragraph output to single paragraph for `location_description` / `location_summary`, strip accidental outer quotes, and enforce `max_tokens = max(req.max_words * 4, 320)` so thinking models never truncate inside `<think>` blocks
- [x] Update `backend/app/prompts/defaults.py`:
  - Tighten `DEFAULT_WIZARD_WORLD_SYSTEM` and `DEFAULT_WIZARD_MAP_REIMAGINE_SYSTEM` location `description` requirement from `"3-4 sentence"` to `"2-3 concise, concrete sensory sentences describing the permanent physical space and ambient atmosphere (present tense; no characters, dialogue, or transient events)"`

## Step 5: Frontend Magic Wand Wiring
- [x] Update `frontend/src/types/turn.ts` to mirror `location_summary` and the new optional `WorldLocationEnrichContextRef` fields
- [x] Update `frontend/src/components/map/MapDetailsDrawer.tsx`:
  - Lower `descriptionWand` `maxWords` from `120` to `55` and populate `parent_container_name` from `allContainers`
  - Add `summaryWand` (`location_summary`, `singleLine: true`, `maxWords: 20`) next to `1-Sentence Exit Hook / Summary` for Level 0 locations
  - Pass `worldContext` and optional `parentContainerName` to `MapLoreSection`
- [x] Update `frontend/src/components/map/MapLoreSection.tsx` (extracting a small hook-safe `LoreContentField` subcomponent for draft rows):
  - Wire `MagicWandButton` (`lore_content`, `maxWords: 80`) to both draft editor lore rows and the campaign GM lore form (never when locked/read-only)
- [x] Update `frontend/src/components/world/WorldInspectorModal.tsx`, `frontend/src/components/world/WorldCodexTab.tsx`, and `frontend/src/components/world/CodexLocationDetail.tsx`:
  - Thread `worldContext` down to `WorldCodexTab` -> `CodexLocationDetail` -> `MapLoreSection`
  - Wire `MagicWandButton` (`lore_content`, `maxWords: 80`, `location_id: null`) to editable World Codex lore entry content fields (inspector mode & unlocked GM Mode only; never static Game Mechanics or read-only campaign views)

## Step 6: Unit & Integration Tests
- [x] Add/update backend tests in `backend/tests/` covering `enrich.py`:
  - Tightened `location_description` / `location_summary` prompts, single-paragraph + quote stripping, `parent_container_name` injection, and thinking-token `max_tokens` floor
  - `location_tags` deduplication, genre-neutral guidance, and 6-tag cap
  - `player_turn_prompt` multi-NPC co-presence resolution, solo-room handling, and non-empty `"auto"` rewrite prompt
  - `lore_content` with lore metadata
- [x] Add/update frontend Vitest tests covering:
  - `HomeScreen` compact navbar classes/aria labels
  - `SplitSaveButton`, `TopologyHeaderToolbar` (`Save Map` + `Save & Close` menu), and `WorldInspectorModal` stay-open save / `Save & Close` behavior
  - `MapDetailsDrawer` (`summaryWand`, `descriptionWand` `maxWords: 55`), `MapLoreSection`, and `WorldCodexTab` Magic Wand rendering in editable vs. locked/read-only states

## Step 7: Planned User-Facing Wiki Updates (Deferred to Merge Time)
- [x] Inspect `../cybercantina-wiki/_Sidebar.md` and `../cybercantina-wiki/Home.md`, and apply updates at merge time to:
  - `../cybercantina-wiki/First-Campaign-and-Interface-Tour.md` — Document compact mobile Home header controls.
  - `../cybercantina-wiki/Authoring-Worlds-Characters-and-Personas.md` — Document stay-open `Save` + `Save & Close` split button in the World Sheet / Map Editor, and Magic Wand buttons on Location Summary, Sensory Description, and World/Location Lore.
  - `../cybercantina-wiki/Live-Inspector-Map-and-Timeline.md` — Document stay-open `Save Map` + `Save & Close` in the fullscreen Map Modal and GM Mode lore Magic Wand.
  - `../cybercantina-wiki/Playing-Directing-and-Mechanics.md` — Note context-aware co-present NPC Magic Wand drafting in the campaign composer.

## Step 8: Architecture Docs, Spec Finalization & Full Verification
- [x] Regenerate and verify architecture docs:
  `backend/.venv/bin/python scripts/generate_arch_docs.py && backend/.venv/bin/python scripts/generate_arch_docs.py --check`
- [x] Mark `FRD.md`, `REVIEW.md`, and `PLAN.md` `status: completed` with all boxes checked upon merge
- [x] Run full verification gates inside `.worktrees/ux-and-wand-polish`:
  - Backend: `cd backend && .venv/bin/ruff check app tests && .venv/bin/tach check` and `backend/.venv/bin/pytest backend/tests`
  - Frontend: `npm --prefix frontend run arch:check && npm --prefix frontend run css:audit && npm --prefix frontend run build && npm --prefix frontend test`
