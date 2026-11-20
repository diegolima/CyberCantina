---
feature: profile-modal-ux-redesign
target_version: 0.25.0
document_type: frd
status: completed
last_updated: 2026-11-20
---

# Feature Requirements Document (FRD)
## User Profile Modal Reorganization, Auto-Save Preferences & Zone Behavior Cards

**Status:** Completed  
**Target Version:** CyberCantina v0.25.0  
**Depends On:** `0.12.1-auth-ux-styling-and-a11y`, `0.12.0-browser-provider-credentials`  
**Scope:**
- **Backend / Schemas / API:** **No changes required** (`PUT /api/profile/models`, `DELETE /api/profile/models`, `GET /api/profile/models`, and `PATCH /api/profile` already support all fields including `delegate_cognition_to_clerk` via [`UserModelSettingsPayload`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/auth.py#L154-L169) and [`ProfileModelSettingsResponse`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/auth.py#L187-L215)).
- **Frontend Components & Styling:**
  - [`ProfileModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/ProfileModal.tsx) (tab consolidation, default tab routing, fixed modal dimensions, tab-switch alert reset)
  - [`ProfileAccountTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/ProfileAccountTab.tsx) (host merged `Account Identity` card at top of Account tab)
  - [`ProfilePreferencesTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/ProfilePreferencesTab.tsx) (sub-tab reordering, smart default sub-tab, auto-save pipeline, per-field reset icons, 4-card Behavior layout, `delegate_cognition_to_clerk` control)
  - [`AppSidebar.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/AppSidebar.tsx) & [`App.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/App.tsx) (update `setProfileInitialTab` callers from `"identity"` to `"preferences"`)
  - [`IntegerField.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/models/IntegerField.tsx) & [`NumericSliderField.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/models/NumericSliderField.tsx) (optional inline reset-icon slot / commit-on-release hooks if shared, or thin wrapper in `ProfilePreferencesTab`)
  - [`styles.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css) (stable modal sizing classes, Behavior 2-column zone cards, inline save-status pill, per-field reset button)
- **Automated Tests:**
  - [`serverConfigAndAuth.test.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/__tests__/serverConfigAndAuth.test.tsx) and/or new `frontend/src/components/__tests__/profileModalUi.test.tsx` (`ReactDOMServer.renderToStaticMarkup` + helper unit tests)
- **User-Facing Documentation (required upon feature implementation):**
  - [`Authentication-Multi-User-and-Security.md`](file:///home/diegolima/Git/cybercantina-wiki/Authentication-Multi-User-and-Security.md)
  - [`First-Campaign-and-Interface-Tour.md`](file:///home/diegolima/Git/cybercantina-wiki/First-Campaign-and-Interface-Tour.md)
  - [`Providers-Models-and-Embeddings.md`](file:///home/diegolima/Git/cybercantina-wiki/Providers-Models-and-Embeddings.md)

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
The User Profile & Preferences modal ([`ProfileModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/ProfileModal.tsx), [`ProfilePreferencesTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/ProfilePreferencesTab.tsx)) currently suffers from five usability problems:

1. **Inverted Tab Priority & Fragmented `Identity` Tab:**
   - Top-level tabs are ordered `Identity -> Account -> Preferences`, and both [`AppSidebar.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/AppSidebar.tsx#L188-L190) and [`App.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/App.tsx#L733-L737) default to `"identity"`. Users opening their profile to adjust AI settings land on a tiny 2-field form (`Username` + `Display Name`) instead of `Preferences`.
   - Keeping `Identity` as its own standalone tab leaves that tab nearly empty while `Account` holds all remaining profile management cards.
2. **Backwards Preferences Sub-Tab Order:**
   - Preferences sub-tabs are ordered `Behavior -> Prompts & Presets -> Models -> Providers` and default to `"behavior"`. This is the exact reverse of both user setup flow and [`AdminModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AdminModal.tsx#L254-L293) (`Users -> Providers -> Models -> Prompts & Presets -> ...`), dropping players into low-level token and LOD tuning before provider/model selection.
3. **Inconsistent Manual Save Friction & Missing `delegate_cognition_to_clerk` UI:**
   - `Providers` and `Prompts & Presets` persist immediately per action, whereas `Models` and `Behavior` share one React form that requires clicking a bottom `Save Preferences` / `Save My Model Overrides` button. Users routinely change a slider or number, switch tabs or close the modal, and lose unsaved edits.
   - Every Behavior description redundantly prints `(System Default: X)`, adding visual clutter, while `delegate_cognition_to_clerk` is wired in React state and API payloads ([`ProfilePreferencesTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/ProfilePreferencesTab.tsx#L63)) without a visible UI control.
4. **Unstructured Technical Dump in `Behavior`:**
   - Ten settings are stacked as raw `Zone 2` / `Zone 3` / `Zone 4` / `Phase 3` inputs and two differently styled `<select>` controls, forcing players to parse internal prompt-zone architecture just to tune memory length or turn processing.
5. **Disorienting Modal Jumping Across Tabs:**
   - [`ProfileModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/ProfileModal.tsx#L111-L124) dynamically toggles `maxWidth` between `660px` and `880px`, and [`.modal-panel`](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L2265-L2274) has no fixed height inside a flex-centered `.modal-backdrop`. Switching tabs visibly snaps the modal width and shifts the header/tabs vertically up and down on screen.

### 1.2 Proposed Solution
1. **Top-Level Consolidation (`Preferences -> Account`):**
   - Put **`Preferences`** first (and make it the default tab), merge `Account Identity` into the top of **`Account`**, and preserve `"identity"` as a backward-compatible prop alias routing to `"account"`.
2. **Dependency-Ordered Preferences (`Providers -> Models -> Prompts & Presets -> Behavior`):**
   - Reorder Preferences sub-tabs to match setup flow and `AdminModal`, defaulting to `"providers"` when personal providers are allowed (`allow_user_providers === true`) and `"models"` when personal providers are disabled.
3. **Auto-Save on Commit + Per-Field Reset Icons:**
   - Eliminate manual `Save` buttons on `Models` and `Behavior`, auto-persisting valid committed changes via `PUT /api/profile/models` with a subtle inline `Saving…` / `Saved` status indicator and per-field `RotateCcw` reset-to-default buttons (moving default values into hover tooltips).
4. **4-Card Zone Grouping with Friendly Nomenclature + `delegate_cognition_to_clerk`:**
   - Group Behavior settings into 4 static, cleanly styled section cards (`Recent Dialogue`, `Story Recaps`, `Long-Term Recall`, `Scene State & Turn Engine`) with friendly field labels, `(Zone N)` continuity in card subtitles, and the newly exposed `Delegate Cognition to Clerk` toggle.
5. **Stable Fixed-Dimension Modal Frame:**
   - Lock a single width (`min(880px, 95vw)`) and consistent height (`min(740px, 88vh)`) with internal `.modal-body` scrolling so the modal frame, header, and tab bars remain stationary across all tab transitions.

---

## 2. Scope, Boundaries & Core Invariants

1. **Frontend-Only Scope (Zero API or Schema Changes):**
   - Continue using existing `GET /api/profile/models`, `PUT /api/profile/models`, `DELETE /api/profile/models`, and `PATCH /api/profile` endpoints without altering [`UserModelSettingsPayload`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/auth.py#L154-L169) or SQLite tables.
2. **Backward-Compatible `initialTab` / `initialSubTab` Contract:**
   - [`ProfileModalProps`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/ProfileModal.tsx#L17-L28) must continue accepting `initialTab="identity" | "account" | "preferences" | "models" | "prompts" | "behavior"` and `initialSubTab="providers" | "models" | "prompts" | "behavior"`.
   - Passing `initialTab="identity"` must resolve to active top-level tab `"account"`, and passing `"models"` / `"prompts"` / `"behavior"` must resolve to `"preferences"` with the corresponding sub-tab active.
3. **Accurate Zone & Engine Taxonomy Invariant:**
   - Behavior cards must accurately reflect backend prompt/engine placement rather than mislabeling settings:
     - `max_scene_flags` belongs to **Scene State & Turn Engine** (Zone 4 `<scene_flags>` world snapshot state, not Zone 3 Working Memory).
     - `recall_budget_prose_tokens` (Zone 4 / Phase 4) and `recall_budget_cognition_tokens` (Phase 3) belong together under **Long-Term Recall** (vector memory & lore recall budgets), not split across `"Current Scene"` and `"Cognition"`.
4. **No Accidental Partial-Input Persistence Invariant (Auto-Save Safety):**
   - Auto-save must **never** fire on intermediate invalid or partial numeric keystrokes (e.g., clearing a box or typing `"2"` while entering `"24"` when `min = 4`), nor fire `PUT /api/profile/models` while `modelsDeckInvalid > 0` or while Actor/Clerk provider+model selection is incomplete when providers exist.
   - Numeric inputs in `Behavior` must use commit-safe editing ([`IntegerField.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/models/IntegerField.tsx) with blur/Enter/valid-draft semantics and debounced/settled persistence) rather than raw `parseInt(e.target.value) || fallback`.
5. **Admin Lock Enforcement Invariant:**
   - When `allow_user_model_overrides === false`, all `Models` and `Behavior` controls (including per-field reset icons and `Reset All to Defaults`) remain disabled/read-only, the `Locked` badge stays visible, and no `PUT /api/profile/models` or `DELETE /api/profile/models` mutation may fire.
6. **Clean Account Error/Status Isolation Invariant:**
   - Transient `statusMsg` and `errorMsg` alerts (e.g., from saving Display Name, Password, or Passkeys, or failed auto-saves) must clear automatically when switching top-level tabs or Preferences sub-tabs so stale banners never bleed into unrelated tabs or shift body scroll offsets.

---

## 3. Functional Requirements

### FR-1: Top-Level Tab Consolidation & Default Entry Points

1. **Tab Order & Removal of Standalone `Identity` Tab:**
   - Render exactly two top-level tabs in [`ProfileModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/ProfileModal.tsx):
     1. **`Preferences`** (`Sliders` icon, plus `Locked` badge when `!allow_user_model_overrides`)
     2. **`Account`** (`User` / `Lock` icon)
   - Default `getInitialTab()` to `"preferences"` whenever `initialTab` is omitted.
   - Route `initialTab === "identity"` or `"account"` to `"account"`.
2. **Caller Updates:**
   - Update [`AppSidebar.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/AppSidebar.tsx#L188-L190) (both rail icon button and expanded sidebar user card at lines 189 and 381) and [`App.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/App.tsx#L733-L737) (`onOpenProfile`) to set `profileInitialTab("preferences")` instead of `"identity"`.
   - Preserve [`App.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/App.tsx#L174-L177) (`handleOpenModelSettings` -> `"models"`) and [`App.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/App.tsx#L746-L750) (`onOpenProviders` -> `"preferences"` + `"providers"`).
3. **Merge `Account Identity` into `ProfileAccountTab.tsx`:**
   - Move the `Account Identity` card (role pill `ADMIN`/`USER`, read-only `Username`, editable `Display Name` + `Save` button) from `ProfileModal.tsx` into the top of [`ProfileAccountTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/ProfileAccountTab.tsx), directly above `Media Storage & Activity`.
   - `Account Identity` retains its explicit `Save` button for `Display Name` (explicit submission is appropriate here alongside Password and Passkeys on the `Account` tab).

---

### FR-2: Preferences Sub-Tab Ordering & Smart Default Sub-Tab

1. **Sub-Tab Sequence (`ProfilePreferencesTab.tsx`):**
   - Render Preferences sub-tabs in this exact order:
     1. **`Providers`** (`Server` icon; displays `Locked` badge when `modelSettings && !modelSettings.allow_user_providers`)
     2. **`Models`** (`Cpu` icon; displays `Locked` badge when `modelSettings && !modelSettings.allow_user_model_overrides`)
     3. **`Prompts & Presets`** (`FileText` icon)
     4. **`Behavior`** (`Activity` icon; displays `Locked` badge when `modelSettings && !modelSettings.allow_user_model_overrides`, optional for visual consistency with `Models`)
2. **Default Sub-Tab Resolution:**
   - If `initialSubTab` or an explicit `initialTab` (`"models" | "prompts" | "behavior"`) is provided, honor it immediately.
   - If opened generically to `"preferences"` (no sub-tab specified):
     - Initialize to `"providers"` when `allow_user_providers` is `true` (or while loading if providers are expected), and switch/default to `"models"` when `modelSettings.allow_user_providers === false` (unless the user already clicked a sub-tab manually before settings finished loading).

---

### FR-3: Auto-Save Persistence & Per-Field Reset Controls (`Models` & `Behavior`)

1. **Remove Manual Form Submit Buttons:**
   - Remove the bottom `Save Preferences` button from the `Behavior` view and `Save My Model Overrides` button from the `Models` view in [`ProfilePreferencesTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/ProfilePreferencesTab.tsx).
   - Remove `<form onSubmit={handleSaveModelOverrides}>` wrappers (or keep non-submitting containers) so pressing `Enter` in an input commits the field without triggering a page reload or form submit jump.
2. **Auto-Save Execution & Debounce Rules:**
   - Track a serialized snapshot or pending change trigger across `Models` + `Behavior` fields.
   - **Immediate save (short ~150ms–300ms coalesce):** Discrete selections (`<select>` dropdowns, toggles/checkboxes like `clerk_mirrors_actor`, `clerk_run_on_cpu`, `delegate_cognition_to_clerk`, provider/model selection changes, per-field reset clicks).
   - **Commit-settled save (~350ms–500ms debounce or on blur/pointer-up):** Numeric inputs (`IntegerField` in `Behavior` and `ModelDeck` keep-alive/context/token fields) and slider drags (`NumericSliderField` temperature/max_tokens) so dragging a slider or typing digits does not flood `PUT /api/profile/models`.
   - **Validation Gate:** Skip auto-save while `modelLoading`, `!modelSettings?.allow_user_model_overrides`, `modelsDeckInvalid > 0`, or when `providerStore.providers.length > 0` and required Actor/Clerk provider+model selections are incomplete.
   - **Race-Safe Sequencing:** Guard concurrent saves (e.g., monotonic save sequence counter or queued latest-payload flush) so an older slow `PUT /api/profile/models` response never overwrites newer local edits.
3. **Inline Save Status Bar (Zero Layout Shift):**
   - Reserve a compact, fixed-height status strip in the Preferences sub-tab header row (right-aligned alongside the sub-tab buttons) or persistent footer bar showing:
     - `Saving…` (subtle muted/amber spinner or label) while a `PUT` / `DELETE` is in flight
     - `Saved` (subtle emerald check, fading after ~2s) after persistence succeeds
     - Inline `Error` state if `PUT /api/profile/models` fails, surfacing `errorMsg` cleanly
     - `Reset All to Defaults` secondary button when `modelSettings?.has_override` is `true` and `allow_user_model_overrides` is `true`.
4. **Per-Field Reset-to-Default Icon Buttons:**
   - Remove `(System Default: ...)` / `(Default: ...)` text from every Behavior field helper description so descriptions focus purely on **what the setting does**.
   - Place a compact `RotateCcw` (`size={13}`) icon button in each Behavior field's label header row:
     - **Visibility / State:** Rendered (or visibly enabled) when the field's current value differs from `modelSettings.default_*` (when equal to system default, either hide it cleanly or keep a low-opacity `disabled` placeholder so label rows don't shift horizontally).
     - **Tooltip & Accessibility:** `aria-label="Reset <Field Label> to default (<defaultValue>)"` and `title="Reset to system default (<defaultValue>)"`.
     - **Action:** Sets the field back to `modelSettings.default_*` and triggers the normal auto-save flow.
   - Keep `ModelCard`'s existing per-card `Reset to default` (`RotateCcw`) action in `Models`, wired so clicking `Reset Actor` or `Reset Clerk` also auto-saves.

---

### FR-4: Behavior Tab Redesign — 4 Static Zone & Engine Cards

1. **Card Grid Layout (Static Cards, No Nested Sub-Tabs):**
   - Render 4 always-visible section cards in a responsive 2-column grid (`.behavior-cards-grid`, collapsing to 1 column below `720px`).
   - Each card header follows a calm, scannable pattern inspired by [`PromptRoleCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/prompts/PromptRoleCard.tsx):
     - Semantic Lucide icon in a subtle tinted icon box + **User-Friendly Title** + **Technical Subtitle** (carrying `(Zone N)` / phase tags for continuity with `LiveInspector` and the Wiki).
   - Remove redundant `Zone N` / `Phase 3` prefixes from individual field labels inside the cards.

2. **Exact Card Taxonomy & Field Mapping:**

| Card Title & Icon | Subtitle | Field Label | Payload Key & Bounds (`default`) | Helper Description (No Default Text) |
| :--- | :--- | :--- | :--- | :--- |
| **Recent Dialogue** (`MessageSquare`) | `Working Memory · Zone 3` | **Verbatim Turns (N)** | `working_memory_turns` (`4–64`, `12`) | Number of recent turns kept verbatim before older dialogue condenses into recaps. |
| | | **Min Protected Turns** | `min_working_memory_turns` (`1–32`, `4`) | Floor of verbatim recent turns protected from overflow trimming before recaps degrade. |
| **Story Recaps** (`ScrollText`) | `Episodic Summaries · Zone 2` | **Full Summary Chunks** | `lod_summary_chunks` (`1–32`, `6`) | Newest or pivotal recaps kept as full paragraphs before older ones shrink to 1-line synopses. |
| | | **High-Salience Bonus** | `lod_importance_bonus` (`0–10`, `2`) | Extra retention priority given to pivotal high-salience (`≥8`) story recaps. |
| | | **History Budget Share (%)** | `zone2_budget_share_pct` (`10–80`, `45`) | Maximum share of available history token budget allocated to story recaps. |
| **Long-Term Recall** (`Database` / `Brain`) | `Vector Memory & Lore` | **Story Prose Recall Budget (tokens)** | `recall_budget_prose_tokens` (`100–2000`, `450`) | Token budget for recalled memories and lorebook entries injected into Phase 4 prose (`Zone 4`). |
| | | **Character Cognition Recall Budget (tokens)** | `recall_budget_cognition_tokens` (`60–1000`, `220`) | Token budget for private memories recalled during Phase 3 character cognition. |
| **Scene State & Turn Engine** (`Cpu` / `Sliders`) | `Simulation & Pipeline · Zone 4` | **Max Active Scene Flags** | `max_scene_flags` (`1–50`, `10`) | Sliding FIFO cap on active scene condition flags tracked in world snapshots. |
| | | **Character Agent Dispatch Mode** | `agent_dispatch_mode` (`sequential \| parallel`, `sequential`) | Sequential avoids local GPU contention; Parallel runs ensemble characters concurrently. |
| | | **Persona Disclosure Detection Strategy** | `persona_disclosure_mode` (`llm_intent \| token_matching \| hybrid`, `llm_intent`) | Controls how player persona secrets and revelations are detected each turn. |
| | | **Delegate Cognition to Clerk** | `delegate_cognition_to_clerk` (`boolean`, `false`) | Run Phase 3 character inner-thought cognition on the lighter Clerk model instead of the Actor model. |

3. **Uniform Control Styling:**
   - Replace `ProfilePreferencesTab.tsx`'s mismatched inline wrapper styles (e.g., lines 632–698 where one `<select>` has a translucent card box and the other does not) with uniform `.field-group` / `.form-group` rows inside each Behavior card.
   - Render `Delegate Cognition to Clerk` as a clean labeled checkbox/toggle row with helper text and its own per-field `RotateCcw` reset icon when overridden from `default_delegate_cognition_to_clerk`.

---

### FR-5: Stable Modal Dimensions & Internal Scrolling

1. **Fixed Width & Height on `ProfileModal`:**
   - Remove `isWideTab` conditional width switching in [`ProfileModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/ProfileModal.tsx#L111-L124).
   - Apply a consistent modal panel class (e.g., `.profile-modal-panel`) with:
     - `width: min(880px, 95vw);`
     - `max-width: 880px;`
     - `height: min(740px, 88vh);` (on narrow mobile viewports `<= 640px`, `width: 96vw; height: 92vh;` so small screens use available space without overflow).
   - Ensure `.modal-body` uses `flex: 1; min-height: 0; overflow-y: auto;` so the modal header, top-level tabs, and Preferences sub-tabs stay anchored at fixed screen coordinates across every tab switch.
2. **Tab-Switch Alert Reset:**
   - Switching `activeTab` or `activePrefTab` clears transient `statusMsg` and `errorMsg` in `ProfileModal` so alerts from one tab do not remain visible or shift content on another tab.

---

## 4. Edge Cases & Interaction Matrix

| Scenario | Expected Behavior |
| :--- | :--- |
| Opening Profile from sidebar card or rail icon | Opens directly on **`Preferences`** → **`Providers`** (if `allow_user_providers` is true) or **`Models`** (if `allow_user_providers` is false). |
| Legacy caller passes `initialTab="identity"` | Opens **`Account`** tab with `Account Identity` card at the top. |
| Legacy caller passes `initialTab="models"` / `"prompts"` / `"behavior"` | Opens **`Preferences`** with the matching sub-tab active. |
| User types `"2"` while changing `Verbatim Turns (N)` from `12` to `24` (`min = 4`) | `IntegerField` shows invalid outline while `"2"` is incomplete and **does not** auto-save `"2"` or clamp to `4`; once `"24"` is typed/blurred, valid `24` commits and auto-saves. |
| User clears `Verbatim Turns (N)` and blurs | `IntegerField` reverts draft back to previous valid committed value; no spurious API call fires. |
| User edits `Behavior` while `Models` has an invalid/incomplete selection (`modelsDeckInvalid > 0`) | Auto-save does not send invalid payload; displays a clear inline notice pointing to the invalid `Models` setting so the user knows why persistence is paused. |
| User edits `Behavior` field to match system default manually | Per-field `RotateCcw` reset button disables/hides once value equals `default_*`. |
| User clicks per-field `RotateCcw` reset icon | Immediately restores that single field to `modelSettings.default_*` (tooltip value) and auto-saves; other modified fields remain untouched. |
| User clicks `Reset All to Defaults` | Calls `DELETE /api/profile/models` (`api.resetProfileModels()`), resets all `Models` + `Behavior` fields to `default_*`, and updates inline status to `Saved` / `Reverted to defaults`. |
| Admin sets `allow_user_model_overrides = false` | `Preferences` tab and `Models`/`Behavior` sub-tabs show `Locked` badge; all `Models` & `Behavior` controls and reset icons are disabled; auto-save never triggers. |
| Switching rapidly between `Preferences` (`Providers`, `Models`, `Prompts & Presets`, `Behavior`) and `Account` | Modal outer frame (`880px` × `min(740px, 88vh)`) stays completely stationary; only `.modal-body` scrolls. |

---

## 5. Acceptance Criteria & Verification Matrix

### 5.1 Automated Test Criteria
1. **Profile Modal Tab Order, Defaults & Merged Identity (`ReactDOMServer.renderToStaticMarkup`):**
   - `ProfileModal` renders top-level tabs in order `Preferences`, `Account` (no `Identity` top-level tab).
   - Default render opens `Preferences` with sub-tabs ordered `Providers`, `Models`, `Prompts & Presets`, `Behavior`.
   - `initialTab="identity"` or `"account"` renders `Account Identity` (`Username` + `Display Name`) inside `ProfileAccountTab`.
   - Modal panel applies stable sizing class/styles without `isWideTab` width branching (`660` vs `880`).
2. **Behavior Cards, `delegate_cognition_to_clerk` & Per-Field Reset Icons:**
   - Renders all 4 section cards (`Recent Dialogue`, `Story Recaps`, `Long-Term Recall`, `Scene State & Turn Engine`) with their exact assigned fields (verifying `Max Active Scene Flags` and `Delegate Cognition to Clerk` appear under `Scene State & Turn Engine`, and both recall budgets appear under `Long-Term Recall`).
   - Manual `Save Preferences` / `Save My Model Overrides` submit buttons are absent; per-field `RotateCcw` reset buttons appear with `title` containing the system default when overridden and are disabled/hidden when `allow_user_model_overrides === false`.
3. **Auto-Save Guard Logic (Pure Helper Unit Tests):**
   - Validate pure helper functions for payload dirty-checking, smart default sub-tab selection (`allow_user_providers` true vs false), and auto-save gating when `modelsDeckInvalid > 0` or provider/model selection is incomplete.

### 5.2 Repository Verification Gates (Required on Implementation Completion)
- **Frontend architecture, build & tests:**
  ```bash
  npm --prefix frontend run arch:check && npm --prefix frontend run build && npm --prefix frontend test
  ```
- **Architecture docs check (if modules or exports change):**
  ```bash
  backend/.venv/bin/python scripts/generate_arch_docs.py && backend/.venv/bin/python scripts/generate_arch_docs.py --check
  ```
- **User-facing documentation sync:**
  - Update [`Authentication-Multi-User-and-Security.md`](file:///home/diegolima/Git/cybercantina-wiki/Authentication-Multi-User-and-Security.md), [`First-Campaign-and-Interface-Tour.md`](file:///home/diegolima/Git/cybercantina-wiki/First-Campaign-and-Interface-Tour.md), and [`Providers-Models-and-Embeddings.md`](file:///home/diegolima/Git/cybercantina-wiki/Providers-Models-and-Embeddings.md) to reflect the `Preferences -> Account` layout, `Providers -> Models -> Prompts & Presets -> Behavior` order, auto-save + per-field reset icons, 4-card Behavior grouping, and `Delegate Cognition to Clerk` setting; verify with `git -C ../cybercantina-wiki diff`.
