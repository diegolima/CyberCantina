---
feature: ux-and-wand-polish
target_version: 0.50.0
document_type: frd
status: completed
last_updated: 2026-11-27
---

# Feature Requirements Document — Home Mobile Header, Map Stay-Open Save & Magic Wand Prompt Polish

## 1. Overview & Motivation

Four related UX and AI-authoring friction points degrade usability across mobile navigation, iterative map authoring, and Magic Wand text generation:
1. **Home Page Header Overflow on Small Devices:** `.home-navbar` in `frontend/src/components/HomeScreen.tsx` displays `CYBERCANTINA` alongside up to five action items (`Install App`, `Notes` + badge, `Admin Area`, the untruncated user profile chip + role pill, and `Sign Out`) with zero responsive rules in `10-home.css` or `15-responsive.css`. On narrow viewports, right-hand actions clip off-screen and are unreachable.
2. **Map Editor Closing on Save:** Out-of-campaign `WorldInspectorModal` calls `onSaved(updated)` with default `closeModal = true` when `SpatialTopologyView` invokes `Save Map` or the modal footer invokes `Save Changes`, discarding pan/zoom/drill-down state on every checkpoint save. Meanwhile, `LiveInspector` fullscreen map stays open on `Save Map` but offers no one-click `Save & Close` shortcut.
3. **Bloated / Unfocused Magic Wand Location Descriptions:** `backend/app/routers/enrich.py` (`location_description`) pairs `maxWords: 120` (`MapDetailsDrawer.tsx`) with a generic `"scene context"` user prompt, causing even frontier models to emit multi-paragraph micro-stories, phantom NPCs, spoken dialogue, and second-person gameplay rules instead of 2–3 concrete, ambient sentences describing the permanent physical space.
4. **Inconsistent Magic Wand Coverage & Prompt Quality:**
   - `player_turn_prompt` hardcodes `campaign.character_id` instead of checking who is actually present at the active/override location, truncates `raw_prose[-300:]` mid-word, and leaves `"auto"` non-empty rewrite guidance blank.
   - `location_tags` uses cyberpunk-skewed examples (`Flickering Neon`, `Ozone Hum`), duplicates existing tags in context, and slices `[:8]` despite asking for `3–6`.
   - High-value authoring fields (`Location Summary`, Location/Container Lore content, and World Codex Lore content) lack Magic Wand buttons even though `lore_content` already exists in the backend schema.
   - World Wizard (`DEFAULT_WIZARD_WORLD_SYSTEM`, `DEFAULT_WIZARD_MAP_REIMAGINE_SYSTEM`) still requests `"3-4 sentence"` location descriptions.

---

## 2. Agreed Product Decisions

### 2.1 Home Page Small-Screen Navbar (`HomeScreen.tsx`, `10-home.css`, `15-responsive.css`)
- **Tablet / Compact Breakpoint (`<= 820px`):**
  - Reduce `.home-navbar` horizontal padding (`16px`) and action gap (`6px–8px`), keep `white-space: nowrap`, and constrain the profile display name with `max-width` + `text-overflow: ellipsis`.
- **Compact Phone Breakpoint (`<= 620px`):**
  - Hide the `CYBERCANTINA` wordmark text while keeping the `<Flame />` icon (`aria-label="CyberCantina"` / `.sr-only` text for screen readers).
  - Collapse `Install App`, `Notes` (keeping its count badge), `Admin Area`, and `Sign Out` buttons to compact icon-only controls (`32px–34px` touch-friendly height, retaining accessible `title` and `aria-label`).
  - Truncate the profile chip username (`max-width: 84px`, ellipsis) and hide the redundant role pill so all five action controls fit cleanly within a `360px` viewport without horizontal scrolling.
  - Configure `.home-nav-actions` as a `flex: 1; min-width: 0; overflow-x: auto; scrollbar-width: none;` container with `flex-shrink: 0` items and a subtle right-edge fade mask (`mask-image` / gradient) as an automatic safety net for ultra-narrow (`<= 320px`) or zoomed viewports.
  - Zero `!important` declarations (`css:audit` compliant).

### 2.2 Stay-Open Save & "Save & Close" Split Button (`TopologyHeaderToolbar.tsx`, `SpatialTopologyView.tsx`, `WorldInspectorModal.tsx`, `LiveInspector.tsx`, `AppModals.tsx`, `App.tsx`)
- **Primary `Save` Stays Open Everywhere (Non-Wizard):**
  - Out-of-campaign `WorldInspectorModal` (`mode="inspector"`): both `Save Map` in `TopologyHeaderToolbar` and `Save Changes` in the modal footer persist via `onSaved(updated, false)` and keep the editor open.
  - In-campaign `WorldInspectorModal` (`mode="campaign"`): footer `Save Changes` persists campaign settings / GM lore via `onSaved(world, false)` and keeps the modal open; `Save Map` in `TopologyHeaderToolbar` continues to persist campaign map edits in place.
  - In-campaign fullscreen map (`LiveInspector.tsx` -> `SpatialTopologyView`): `Save Map` continues to persist in place without closing.
  - `WorldWizardModal` (`mode="wizard"`): `"Commit World & Spatial Graph"` remains a single commit-and-exit action (no split button).
- **Split Button (`Save` | `▾` -> `Save & Close`):**
  - Render a reusable split-action control (`.ui-split-btn` / `SplitSaveButton` or toolbar/footer integration) on:
    1. `TopologyHeaderToolbar` whenever a close callback is present (`LiveInspector` fullscreen map and `WorldInspectorModal` when `onRequestClose` / `onClose` is wired), alongside the primary `Save Map` action.
    2. `WorldInspectorModal` footer (`mode !== "wizard"`), alongside `Save Changes`.
  - Selecting **`Save & Close`** saves first and closes **only if** the save succeeds (`handleSave` returns `Promise<boolean>` / `onSaveMap` resolves without error). Validation or network failures keep the modal open and display the error.
  - In `WorldInspectorModal` campaign mode, triggering `Save & Close` from the map toolbar saves the map and invokes `requestClose()` so any unsaved World Settings or Codex edits still pass through the dirty-close guard (`NavigationGuardModal`).
  - Both halves of the split button share the disabled state (`!dirty`, `hasBlockingErrors`, `saving`, `isMutatingLocked`), and the chevron trigger exposes `aria-haspopup="menu"`, `aria-expanded`, `Escape` / outside-click dismissal, and a touch-safe `>= 32px` hit target on mobile.
- **Reconciliation on Stay-Open Save (`WorldInspectorModal.tsx`, `SpatialTopologyView.tsx`):**
  - When `WorldInspectorModal` stays open after saving (`onSaved(updated, false)`), update `activeWorldId = updated.id` (supporting silent CoW world versioning), refresh `containers`, `locations`, `edges`, `loreNodes`, and `media` from `updated` (replacing `new_*` IDs with server-assigned canonical IDs), and reset `isDirty = false` without unmounting `SpatialTopologyView` or resetting user pan/zoom/current container.

### 2.3 Tightened Spatial Descriptions & Code-Managed Magic Wand Prompts (`backend/app/routers/enrich.py`, `backend/app/schemas/enrich.py`, `backend/app/prompts/defaults.py`)
- **Code-Managed Prompts:** Keep Magic Wand prompts concise and code-managed in `backend/app/routers/enrich.py` (not exposed as user-editable Prompt Presets).
- **Location & Level-1 Container Sensory Descriptions (`location_description`):**
  - Target **2–3 concrete, ambient sentences in a single paragraph (~30–55 words)** (`maxWords: 55` in `MapDetailsDrawer.tsx`, `temperature: 0.55`).
  - Enforce present-tense, static spatial reference framing: permanent physical layout, materials, lighting, and ambient sensory atmosphere (sight, sound, scent, air). Explicitly exclude characters/NPCs, spoken dialogue, transient events, and second-person directives (`"you..."`).
  - For Level-1 containers (`entity_kind="container"`), describe the exterior threshold and overall atmosphere; use `child_names` only to infer the landmark's character without listing individual interior rooms.
  - Add optional `parent_container_name: str | None = None` to `WorldLocationEnrichContextRef` (`backend/app/schemas/enrich.py`, `frontend/src/types/turn.ts`) and populate it from `MapDetailsDrawer.tsx` so nested locations remain anchored inside their parent area/building.
  - Replace the shared `"Draft a compelling starting draft from scratch based on the following scene context"` user prompt with role-specific instructions so spatial fields never receive live-scene storytelling cues.
  - Deterministic sanitization: collapse newlines into a single paragraph for spatial descriptions/summaries and strip accidental outer quotation marks; enforce a thinking-safe token floor (`max_tokens = max(req.max_words * 4, 320)`) so reasoning models emitting `<think>...</think>` blocks are never truncated into blank output.
- **Wizard Alignment (`backend/app/prompts/defaults.py`):**
  - Update `DEFAULT_WIZARD_WORLD_SYSTEM` and `DEFAULT_WIZARD_MAP_REIMAGINE_SYSTEM` location `description` guidance from `"3-4 sentence sensory description"` to `"2-3 concise, concrete sensory sentences describing the permanent physical space and ambient atmosphere (present tense; no characters, dialogue, or transient events)"`.

### 2.4 Existing Magic Wand Audit Fixes & New Authoring Triggers
- **Keep Single-Click Wand UX:** Retain the single-click `MagicWandButton` interaction everywhere (no Polish/Expand/Concise mode dropdown).
- **`player_turn_prompt` Fixes (`backend/app/routers/enrich.py`):**
  - Resolve co-present NPCs accurately at `target_loc_id` (`override_location_id` or `leaf_turn.world_snapshot.active_location_id`) from `branch_turns` / `world_snapshot` / character turn states rather than hardcoding `campaign.character_id`. Handle solo rooms (0 NPCs present) and multi-character rooms cleanly.
  - Include player persona name/tagline when present, and slice recent `raw_prose` on clean word/sentence boundaries (~600 chars) instead of raw `[-300:]`.
  - Add explicit `"auto"` rewrite guidance when `current_text` is non-empty: preserve the player's exact intent, actions, and spoken lines while polishing phrasing and `*action*` / `"dialogue"` formatting—never inventing unrequested actions, items, or NPC responses. Tighten empty-draft generation to 1–3 concise sentences (~20–55 words).
- **`location_tags` Fixes (`backend/app/routers/enrich.py`):**
  - Remove cyberpunk-biased tag examples (`Flickering Neon`, `Ozone Hum`) in favor of genre-neutral sensory axes (lighting, sound, air/scent, surface/material, atmosphere).
  - Do not duplicate `existing_tags` in both `=== CONTEXT ===` and `=== EXISTING TAGS ===`.
  - Clamp parsed tags strictly to `3–6` concise tags (`deduped[:6]`, dropping empty/overlong sentence-like tags).
- **New Magic Wand Triggers:**
  1. **`location_summary` (`MapDetailsDrawer.tsx`, Level 0 locations only):** Compact wand next to `1-Sentence Exit Hook / Summary` (`singleLine: true`, `maxWords: 20`), producing 1 concrete sentence (`<= 18 words`) suitable as an adjacent-exit preview without characters or dialogue.
  2. **Location & Level-1 Container Lore `content` (`MapLoreSection.tsx`, `CodexLocationDetail.tsx`, `MapDetailsDrawer.tsx`):** Compact wand next to the Lore details `<textarea>` in both draft editor mode and campaign GM edit mode (never when locked/read-only), wired to `lore_content` (`maxWords: 80`, 2–4 concise in-universe sentences) with `lore_title`, `lore_category`, and `lore_tags` passed on `WorldLocationEnrichContextRef`.
  3. **World Codex Lore `content` (`WorldCodexTab.tsx`):** Compact wand next to editable World Codex lore entry `content` `<textarea>` (both `inspector` mode and campaign `GM Mode` when unlocked; never on static Game Mechanics or read-only campaign views), using `lore_content` (`scope: "world_location"`, `location_id: null`, `maxWords: 80`) with `worldContext` and lore metadata.
- **Reserve Roles Alignment (`narrator_directive`, `character_persona`):** Tighten `narrator_directive` and `character_persona` prompts in `enrich.py` with explicit non-empty `"auto"` polish rules and clear length/perspective constraints.

---

## 3. Out of Scope
- Exposing Magic Wand prompts in Admin/User Prompt Presets UI (`prompts/defaults.py`).
- Multi-mode (Polish / Expand / Concise) dropdown menus on `MagicWandButton`.
- Adding a Magic Wand to `Starting Message (Turn 0 Atmosphere)` in `MapDetailsDrawer.tsx`.
- Converting `WorldWizardModal` `"Commit World & Spatial Graph"` into a stay-open split button.
