---
feature: stabilized-tabbed-sheet-modals
target_version: 0.25.1
document_type: frd
status: completed
last_updated: 2026-11-20
---

# Feature Requirements Document (FRD)
## Stabilized Tabbed Sheet Modals & Persona Sheet Naming Consistency

**Status:** Completed  
**Target Version:** CyberCantina v0.25.1  
**Depends On:** `0.25.0-profile-modal-ux-redesign`  
**Scope:**
- **Backend / Schemas / API:** **No changes required** (purely frontend layout, CSS primitives, ARIA tab semantics, and modal header naming).
- **Frontend Styling (`frontend/src/styles.css`):**
  - Introduce shared `.modal-panel--sheet` (`width: min(880px, 95vw); max-width: 880px; height: min(760px, 88vh)`) and `.modal-panel--sheet-wide` (`width: min(1120px, 96vw); max-width: 1120px; height: min(820px, 88vh)`) modal frame primitives (migrating `.profile-modal-panel` or sharing the same pattern).
  - Add responsive mobile overrides (`@media (max-width: 640px)`) and centered/framed empty-state alignment inside fixed-height sheet bodies.
- **Frontend Tabbed Sheet Components:**
  - [`WorldInspectorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldInspectorModal.tsx) (used for Home catalog editing, in-campaign World Sheet, and `WorldWizardModal` `mode="wizard"`)
  - [`CharacterInspectorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/character/CharacterInspectorModal.tsx) (out-of-campaign Character Sheet)
  - [`CampaignCharacterModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/inspector/CampaignCharacterModal.tsx) (in-campaign Character Sheet)
  - [`PersonaEditorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/PersonaEditorModal.tsx) (rename title to **`Persona Sheet`** while preserving state badges/subtitles)
  - [`AdminModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AdminModal.tsx) (lock dimensions, add ARIA tablist/tab attributes, clear transient banners on tab switch)
- **Automated Tests:**
  - New: `frontend/src/components/__tests__/tabbedSheetModals.test.tsx` (`ReactDOMServer.renderToStaticMarkup` assertions across all 5 sheet modals)
  - Playwright E2E bounding-box stability checks across World Sheet, Character Sheet, Persona Sheet, and Admin Settings in [`frontend/e2e/`](file:///home/diegolima/Git/cybercantina/frontend/e2e)
- **User-Facing Documentation (verify/update upon implementation):**
  - Check [`First-Campaign-and-Interface-Tour.md`](file:///home/diegolima/Git/cybercantina-wiki/First-Campaign-and-Interface-Tour.md), [`Live-Inspector-Map-and-Timeline.md`](file:///home/diegolima/Git/cybercantina-wiki/Live-Inspector-Map-and-Timeline.md), and [`Authentication-Multi-User-and-Security.md`](file:///home/diegolima/Git/cybercantina-wiki/Authentication-Multi-User-and-Security.md) if any references to `"Edit Persona"` or `"Character Dossier"` appear.

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
In v0.25.0, [`ProfileModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/ProfileModal.tsx) adopted a fixed-dimension frame (`.profile-modal-panel`) so switching tabs never shifts the modal width or jumps the header/tab bar vertically. The remaining multi-tab inspector and management modals still suffer from inconsistent sizing, layout jumping, and naming drift:

1. **Multi-Step Width Snapping & Vertical Jumps (`AdminModal`, `WorldInspectorModal`):**
   - [`AdminModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AdminModal.tsx#L212-L231) switches `maxWidth` between `740px` (`Users`, `Providers`) and `880px` (`Models`, `Prompts & Presets`, `Server Configuration`, `Communication`) with no fixed height.
   - [`WorldInspectorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldInspectorModal.tsx#L545-L557) jumps across three widths (`860px` on `Base`/`Media`/`Settings` → `980px` on `Codex` → `1120px` on `Map`), and only the `Map` tab fixes a tall height (`height: calc(88vh - 220px)`), causing the modal header and tabs to shift up and down between tabs across catalog, campaign, and wizard modes.
2. **Vertical Height Jumping & Cross-Mode Drift (`CharacterInspectorModal`, `CampaignCharacterModal`, `PersonaEditorModal`):**
   - [`CharacterInspectorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/character/CharacterInspectorModal.tsx#L576-L580) (`min(820px, 95vw)`), [`CampaignCharacterModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/inspector/CampaignCharacterModal.tsx#L131-L135) (`min(860px, 95vw)`, `maxHeight: 92vh`), and [`PersonaEditorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/PersonaEditorModal.tsx#L296-L300) (`min(820px, 95vw)`) have no fixed height. Switching between sparse tabs (e.g., empty `Memories`, `Inventory`, `Media`, or `Unsupported`) and dense tabs (`Base`, `Personality`) jumps the modal frame vertically inside the flex-centered `.modal-backdrop`.
   - In [`PersonaEditorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/PersonaEditorModal.tsx#L423-L427), `<form>` wraps both `.modal-body` and `.modal-footer` without `min-height: 0`, risking footer clipping if panel height is constrained naively.
3. **Header Naming Drift (`PersonaEditorModal`, `CampaignCharacterModal`):**
   - World and out-of-campaign Character modals are titled **`World Sheet`** and **`Character Sheet`**, whereas [`PersonaEditorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/PersonaEditorModal.tsx#L305-L313) uses `"Edit Persona: ..."` / `"Create Player Persona"` and [`CampaignCharacterModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/inspector/CampaignCharacterModal.tsx#L155-L158) uses `"<Name> · Character Dossier"`.

### 1.2 Proposed Solution
1. **Shared Fixed-Dimension Sheet Primitives (`.modal-panel--sheet` & `.modal-panel--sheet-wide`):**
   - Standardize standard multi-tab sheets (`ProfileModal`, `AdminModal`, `CharacterInspectorModal`, `CampaignCharacterModal`, `PersonaEditorModal`) on **`.modal-panel--sheet`** (`min(880px, 95vw) × min(760px, 88vh)`).
   - Standardize **`WorldInspectorModal`** across all tabs and modes (`inspector`, `campaign`, `wizard`) on **`.modal-panel--sheet-wide`** (`min(1120px, 96vw) × min(820px, 88vh)`), keeping the `Map` canvas and `Codex` 2-pane view spacious without width snapping.
2. **Scoped Exclusion Boundary (No Blind Application to Compact/Inline Tab Layouts):**
   - Explicitly exclude compact auth modals ([`AuthScreen.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AuthScreen.tsx) `maxWidth: 440px`) and embedded step-2 preview tabs inside [`WizardModals.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/WizardModals.tsx#L428) from `.modal-panel--sheet` expansion.
3. **Flex-Scroll Hygiene & Footer Pinning:**
   - Ensure `.modal-panel--sheet` / `.modal-panel--sheet-wide` keep `.modal-header`, `.modal-tabs`, and `.modal-footer` pinned while `.modal-body` scrolls internally (`flex: 1; min-height: 0; overflow-y: auto`), including `min-height: 0` on the `<form>` wrapper in `PersonaEditorModal`.
4. **Sheet Title Harmonization:**
   - Rename `PersonaEditorModal`'s header to **`Persona Sheet`** (preserving contextual subtitles/badges for `Default · Read Only`, `Cloned from Default`, `<Persona Name>`, and `New Persona`) and align `CampaignCharacterModal` to **`Character Sheet`** alongside the character name and portrait.

---

## 2. Scope, Boundaries & Core Invariants

1. **Zero Backend or Data Model Changes:**
   - No backend endpoints, Pydantic schemas, or SQLite tables change.
2. **Exclusion Boundary for Non-Sheet `.modal-tabs`:**
   - [`AuthScreen.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AuthScreen.tsx#L122) (`440px` login/register card) and [`WizardModals.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/WizardModals.tsx#L428) (nested draft-preview tabs inside Character Wizard) **must not** adopt `880px`/`1120px` sheet classes.
3. **World Sheet `1120px` Width & `Map` Canvas Invariant:**
   - [`WorldInspectorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldInspectorModal.tsx) **must** keep `width: min(1120px, 96vw)` uniformly across every tab (`Base`, `Media`, `Codex`, `Map`, `Settings`, `Unsupported`) and every mode (`inspector`, `campaign`, `wizard`) so `SpatialTopologyView` and `WorldCodexTab` never feel cramped or snap horizontally.
   - Inside `.modal-body`, the `Map` tab wrapper must stretch cleanly to fill the fixed modal body height (`flex: 1; min-height: 0; height: 100%;`) without creating double vertical scrollbars or overflowing `.modal-footer`.
4. **Persona Sheet `<form>` Flex-Confinement Invariant:**
   - In [`PersonaEditorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/PersonaEditorModal.tsx#L423-L427), the `<form>` wrapping `.modal-body` and `.modal-footer` **must** specify `minHeight: 0` alongside `display: flex; flexDirection: column; flex: 1; overflow: hidden;` so `.modal-body` absorbs scroll overflow and `.modal-footer` (`Save` / `Delete` / `Set as Default`) never clips off-screen.
5. **Existing Test & Selector Compatibility:**
   - Preserve `"World Sheet"` text in `WorldInspectorModal` (asserted in [`responsiveCampaignPanels.test.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/__tests__/responsiveCampaignPanels.test.tsx#L295)) and keep all existing tab names, `role="tab"`, and form button labels intact.
   - When adding `role="tablist"` / `role="tab"` / `aria-selected` to `AdminModal.tsx`, check and update any Playwright/Vitest button-role selectors targeting Admin tabs if needed.

---

## 3. Functional Requirements

### FR-1: Shared CSS Sheet Primitives (`frontend/src/styles.css`)

1. **`.modal-panel--sheet` (Standard Tabbed Sheets):**
   - `width: min(880px, 95vw);`
   - `max-width: 880px;`
   - `height: min(760px, 88vh);`
   - Mobile (`@media (max-width: 640px)`): `width: 96vw; height: 92vh;`
2. **`.modal-panel--sheet-wide` (World Sheet):**
   - `width: min(1120px, 96vw);`
   - `max-width: 1120px;`
   - `height: min(820px, 88vh);`
   - Mobile (`@media (max-width: 640px)`): `width: 96vw; height: 92vh;`
3. **Internal Flex-Scroll & Pinned Chrome:**
   - Both `.modal-panel--sheet` and `.modal-panel--sheet-wide` ensure direct `.modal-body` (and `.modal-sheet-form > .modal-body`) use `flex: 1; min-height: 0; overflow-y: auto;`, while `.modal-header`, `.modal-tabs`, and `.modal-footer` carry `flex-shrink: 0;`.
   - Harmonize `.profile-modal-panel` with `.modal-panel--sheet` (or keep `.profile-modal-panel` aligned at `880px × min(740px–760px, 88vh)` without changing `ProfileModal` behavior).

---

### FR-2: Modal-by-Modal Adoption Matrix

| Modal Component | Surfaces Covered | Panel Modifier | Header Title Standardization | Additional UX Fixes |
| :--- | :--- | :--- | :--- | :--- |
| [`WorldInspectorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldInspectorModal.tsx) | Home Catalog, Campaign World Sheet, World Wizard Draft (`mode="wizard"`) | `.modal-panel--sheet-wide` (`min(1120px, 96vw) × min(820px, 88vh)`) | Keep **`World Sheet`** (plus existing `1.2 Wizard Draft` pill / world context) | Remove `activeTab`-dependent width inline styles & `transition: "width 0.2s ease"`; update `Map` tab container from `height: "calc(88vh - 220px)"` to `flex: 1; minHeight: 0; height: "100%"`. |
| [`CharacterInspectorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/character/CharacterInspectorModal.tsx) | Home Catalog Character Sheet | `.modal-panel--sheet` (`min(880px, 95vw) × min(760px, 88vh)`) | Keep **`Character Sheet`** (plus version badge & history selector) | Remove inline `width: "min(820px, 95vw)"`; keep `.modal-footer` pinned. |
| [`CampaignCharacterModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/inspector/CampaignCharacterModal.tsx) | In-Campaign Character Sheet (`LiveInspector`) | `.modal-panel--sheet` (`min(880px, 95vw) × min(760px, 88vh)`) | Align subtitle from `· Character Dossier` to **`· Character Sheet`** alongside portrait, name, temperament badge, and party pills | Remove inline `width` / `maxHeight: "92vh"`; use standard `.modal-footer` pinning. |
| [`PersonaEditorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/PersonaEditorModal.tsx) | Home Catalog Persona Sheet (Create / Edit / Clone / Read-Only Default) | `.modal-panel--sheet` (`min(880px, 95vw) × min(760px, 88vh)`) | Rename to **`Persona Sheet`** with contextual state text/badge (`New Persona`, `<persona.name>`, `Default · Read Only`, `Cloned from Default`) | Remove inline `width: "min(820px, 95vw)"`; add `minHeight: 0` on `<form>` wrapping `.modal-body` and `.modal-footer`. |
| [`AdminModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AdminModal.tsx) | Admin Settings | `.modal-panel--sheet` (`min(880px, 95vw) × min(760px, 88vh)`) | Keep **`Admin Settings`** | Remove conditional `740`/`880` `maxWidth` & `transition`; add `role="tablist"` / `role="tab"` / `aria-selected`; clear `statusMsg` / `errorMsg` on tab change. |

---

### FR-3: Sparse & Empty-State Presentation Inside Fixed-Height Sheets

1. **Balanced Empty States:**
   - On tabs that can be empty (e.g., `Memories`, `Inventory`, `Media`, or `Unsupported` when empty), ensure empty-state messages sit cleanly inside a framed/centered empty state rather than looking stranded against an empty `760px` container, while keeping existing test-asserted strings intact.
2. **Keep Scroll-to-Top or Clean Reset on Tab Switch (Optional Check):**
   - Ensure switching tabs does not leave stale error banners (`AdminModal`) or cause `.modal-tabs` buttons to wrap awkwardly across viewports.

---

## 4. Edge Cases & Interaction Matrix

| Scenario | Expected Behavior |
| :--- | :--- |
| Switching across `Base` → `Media` → `Codex` → `Map` → `Settings` in `WorldInspectorModal` (Home or Campaign) | Outer `.modal-panel` stays exactly `min(1120px, 96vw)` × `min(820px, 88vh)`; `Map` canvas fills the body height cleanly with no double scrollbar or clipped footer. |
| Opening `WorldInspectorModal` inside `WorldWizardModal` (`mode="wizard"`) | Renders at the same stabilized `1120px` sheet size with `1.2 Wizard Draft` badge and footer controls pinned. |
| Switching from an empty `Memories` tab to `Personality` in `CharacterInspectorModal` / `CampaignCharacterModal` | Outer frame stays `min(880px, 95vw)` × `min(760px, 88vh)`; `.modal-footer` remains fixed at the bottom. |
| Opening `PersonaEditorModal` in all 4 modes (Create, Edit, Cloned from Default, Read-Only Default) | Header displays **`Persona Sheet`** with clear mode indicator (`New Persona`, persona name, `Cloned from Default`, or `Default · Read Only`); `<form>` scrolls `.modal-body` internally without clipping `.modal-footer`. |
| Switching across `Users` → `Providers` → `Models` → `Prompts & Presets` → `Server Configuration` → `Communication` in `AdminModal` | Modal never snaps between `740px` and `880px` or jumps vertically; stale `statusMsg`/`errorMsg` alerts clear when changing tabs. |
| Narrow mobile viewport (`<= 640px`) | Both `.modal-panel--sheet` and `.modal-panel--sheet-wide` expand to `96vw × 92vh`, `.modal-tabs` scroll horizontally via `overflow-x: auto`, and `.modal-footer` remains visible. |
| Opening `AuthScreen` (`Sign In` / `Create Account`) or `CharacterWizardModal` | Remains compact (`440px` for `AuthScreen`; wizard dimensions unchanged); unaffected by `.modal-panel--sheet`. |

---

## 5. Acceptance Criteria & Verification Matrix

### 5.1 Automated Test Criteria
1. **SSR Component Tests (`frontend/src/components/__tests__/tabbedSheetModals.test.tsx`):**
   - `WorldInspectorModal` (across `inspector`, `campaign`, and `wizard` modes, and across `base`, `codex`, `map` tabs) renders `.modal-panel--sheet-wide` with no `transition: width` or `860px`/`980px` inline width shifts.
   - `CharacterInspectorModal`, `CampaignCharacterModal`, `PersonaEditorModal`, and `AdminModal` render `.modal-panel--sheet` with no conditional `maxWidth` / `width` inline overrides.
   - `PersonaEditorModal` header contains `Persona Sheet` across create, edit, clone, and read-only default modes; `CampaignCharacterModal` header contains `Character Sheet`; `AdminModal` renders `role="tablist"`, `role="tab"`, and `aria-selected`.
   - `AuthScreen` retains `maxWidth: 440` and does **not** carry `.modal-panel--sheet`.
2. **Playwright E2E Verification (`frontend/e2e/`):**
   - Assert identical `boundingBox()` (`width`, `height`, `x`, `y`) when switching tabs inside `WorldInspectorModal`, `CharacterInspectorModal` / `CampaignCharacterModal`, `PersonaEditorModal`, and `AdminModal` (and verify no existing E2E specs break from `AdminModal` `role="tab"` or `Persona Sheet` header rename).

### 5.2 Repository Verification Gates (Required on Implementation Completion)
- **Frontend architecture, build, unit tests & Playwright E2E:**
  ```bash
  npm --prefix frontend run arch:check && npm --prefix frontend run build && npm --prefix frontend test
  npm --prefix frontend run typecheck:e2e && npm --prefix frontend run test:e2e
  ```
- **Architecture docs check (if modules or exports change):**
  ```bash
  backend/.venv/bin/python scripts/generate_arch_docs.py && backend/.venv/bin/python scripts/generate_arch_docs.py --check
  ```
- **User-facing documentation check:**
  - Verify whether any pages in `../cybercantina-wiki` reference old names (`Edit Persona`, `Character Dossier`, etc.) and update if needed.
