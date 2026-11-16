---
feature: canonical-character-export-and-legacy-field-cleanup
target_version: 0.13.1
document_type: frd
status: draft
last_updated: 2026-11-16
---

# Feature Requirements Document (FRD)
## Canonical Character Schema, "Unsupported" Tab & `.zcc` Forward-Compatibility

**Status:** Draft  
**Target Version:** CyberCantina v0.13.1  
**Scope:**
- Backend Persistence & Migrations ([`backend/app/db/schema.sql`](file:///home/diegolima/Git/cybercantina/backend/app/db/schema.sql), [`backend/app/db/repos/schema_init.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/schema_init.py), [`backend/app/db/repos/characters.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/characters.py), [`backend/app/db/repos/character_versions.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/character_versions.py), [`backend/app/db/seed.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/seed.py))
- Backend Character & Import/Export Schemas ([`backend/app/schemas/character.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/character.py), [`backend/app/schemas/import_export.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/import_export.py))
- Backend Prompt Context & Wizards ([`backend/app/engine/context/zone1_static.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/zone1_static.py), [`backend/app/wizards/char_gen/draft_pipeline.py`](file:///home/diegolima/Git/cybercantina/backend/app/wizards/char_gen/draft_pipeline.py), [`backend/app/wizards/char_gen/inference.py`](file:///home/diegolima/Git/cybercantina/backend/app/wizards/char_gen/inference.py), [`backend/app/wizards/sillytavern_distiller.py`](file:///home/diegolima/Git/cybercantina/backend/app/wizards/sillytavern_distiller.py), [`backend/app/prompts/defaults.py`](file:///home/diegolima/Git/cybercantina/backend/app/prompts/defaults.py))
- Backend Import/Export Service ([`backend/app/services/import_export_service.py`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py))
- Frontend Character UI, Import Preview & Types ([`frontend/src/types/character.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/character.ts), [`frontend/src/types/importExport.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/importExport.ts), [`frontend/src/components/character/CharacterInspectorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/character/CharacterInspectorModal.tsx), [`frontend/src/components/character/CharacterBaseTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/character/CharacterBaseTab.tsx), [`frontend/src/components/character/CharacterAppearanceTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/character/CharacterAppearanceTab.tsx), new `CharacterUnsupportedTab.tsx`, [`frontend/src/components/ImportPreviewModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ImportPreviewModal.tsx), [`frontend/src/components/WizardModals.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/WizardModals.tsx))
- Automated Tests (`backend/tests/`, `frontend/src/`)

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
CyberCantina's character model previously included `physical_appearance` and `modifications`, which have since been superseded in the UI by `character_bio`, `build_and_height`, `distinctive_features`, `posture`, `mannerisms`, and `visual_aesthetic`. At the same time, `.zcc` packages lack forward-compatibility when imported into an older CyberCantina instance whose character schema does not recognize newer fields.

This produces five concrete issues:

1. **Hidden & Duplicated Fields Leak into `.zcc` Exports:**
   - [`build_zcc_export`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py#L154) serializes `char.model_dump()` verbatim into `characters.json`, exporting `physical_appearance` and `modifications: []` even though neither is editable or visible in the character inspector.
   - [`CharacterInspectorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/character/CharacterInspectorModal.tsx#L401-L402), [`CharacterBaseTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/character/CharacterBaseTab.tsx#L168-L171), and [`CharacterWizardDraft._sanitize_and_sync_fields`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/character.py#L973-L976) actively mirror `character_bio` into `physical_appearance` (and because `CharacterRecord` and `CharacterUpdatePayload` inherit from `CharacterWizardDraft`, this runs on reads, updates, and `.zcc` imports alike).

2. **Startup & Seed Contamination (`schema_init.py` and `seed.py`):**
   - [`schema_init.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/schema_init.py#L1158-L1173) runs on every `init_db()` startup and overwrites `physical_appearance = ''` with a synthetic fallback string, and lines 1129–1133 backfill `char_kira_vance.physical_appearance`. Left unchanged, restarting the server would re-populate `physical_appearance` on every canonical character.
   - [`seed.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/seed.py#L222-L234) still seeds *Kira Vance* using `physical_appearance` without canonical fields (`character_bio`, demographics, `distinctive_features`, etc.).

3. **Silent `Bio:` Suppression in Zone 1 System Prompts:**
   - [`build_zone1_static_system_prompt`](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/zone1_static.py#L203-L204) checks `if character.character_bio and character.character_bio != character.physical_appearance:`. Because UI saves and `_sanitize_and_sync_fields` set `character_bio == physical_appearance`, **every saved or wizard-generated character with structured appearance fields silently loses `Bio:` from Zone 1**.

4. **Silent Data Loss for Future `.zcc` Fields:**
   - [`commit_staged_import`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py#L949-L997) constructs `CharacterWizardDraft(...)` from a fixed list of known keys, silently discarding any unrecognized fields from a `.zcc` exported by a newer CyberCantina version.

5. **No Non-Destructive Review & Cleanup UI:**
   - Users importing a legacy `.zcc` or a future-version `.zcc` need a unified place to inspect unsupported/deprecated data as read-only without being forced to migrate everything before saving edits on other tabs, and to delete individual unsupported fields when ready.

### 1.2 Proposed Solution
Introduce a dedicated **`unsupported_fields`** container (`unsupported_fields_json` in SQLite) paired with a conditional **`Unsupported`** tab in [`CharacterInspectorModal`](file:///home/diegolima/Git/cybercantina/frontend/src/components/character/CharacterInspectorModal.tsx):

1. **Hide When Empty, Show Conditional `Unsupported` Tab When Populated:**
   - Clean/canonical characters (including old save-mirroring duplicates where `physical_appearance == character_bio`) have `unsupported_fields = {}`, so the **`Unsupported`** tab is completely absent from the character sheet and no legacy keys appear in `.zcc` exports.
   - Characters carrying deprecated legacy values (distinct `physical_appearance`, non-empty `modifications`) or unrecognized future `.zcc` keys display a conditional **`Unsupported`** tab (with an item-count badge) showing every entry read-only, clearly labeled as **`Deprecated`** or **`Unsupported / Future`**.
2. **Preserve Across Saves, Exclude From LLM Context:**
   - Saving edits on other tabs (e.g., `tagline`, `tags`, `portraits`) preserves `unsupported_fields` intact so users are never forced to migrate all fields immediately.
   - Entries in `unsupported_fields` are **never** injected into Zone 1, Zone 2, embeddings, or mention matching.
   - Running campaigns remain unaffected via CyberCantina's Copy-on-Write (CoW) character isolation: untouched characters pinned by active campaigns keep their original DB row (`physical_appearance` / `modifications` columns intact if any), while editing/saving forks a new character row for future campaigns without breaking the running campaign.
3. **Read-Only + Migration Helpers + Explicit Per-Field Deletion:**
   - Every entry on the `Unsupported` tab is read-only with a **Copy** button (plus **Copy to Bio** / **Move to Distinctive Features & Remove** helpers for known deprecated fields) and a staged per-field **Delete** button (with **Undo** before clicking **Save Changes**).
   - Once deleted and saved, those keys vanish from `Unsupported` and are omitted from subsequent `.zcc` exports.
4. **Clean Up Root Causes:**
   - Stop all `character_bio -> physical_appearance` mirroring across UI, schemas, and wizards; fix `schema_init.py` and `seed.py`; and fix `Bio:` suppression in `zone1_static.py`.

> [!NOTE]
> **Deferred Scope (Explicitly Excluded from v0.13.1):**
> - **SQLite `DROP COLUMN` migration:** Retain `physical_appearance` and `modifications_json` columns in `backend/app/db/schema.sql` and `character_versions` snapshots so running campaigns pinned to untouched legacy rows and historical version views continue working with zero breakage.
> - **Player Personas (`PersonaRecord`) & Worlds (`WorldRecord`):** `PersonaEditorModal.tsx` and `backend/app/schemas/persona.py` still intentionally use `physical_appearance` as a fallback, and `unsupported_fields` forward-compatibility is scoped to `CharacterRecord` / `characters.json` in `v0.13.1` (worlds/personas can adopt the same pattern later if desired).
> - **Breaking Structural Mutations in Future `.zcc` Formats:** `unsupported_fields` preserves *additive* unknown top-level character keys; breaking type changes inside existing core fields (e.g., `baseline_psyche`) or future `format_version > 1` archives are outside additive field preservation.

---

## 2. Scope, Boundaries & Core Invariants

1. **Conditional `Unsupported` Tab Visibility:**
   - The **`Unsupported`** tab in [`CharacterInspectorModal`](file:///home/diegolima/Git/cybercantina/frontend/src/components/character/CharacterInspectorModal.tsx) must be **completely hidden** unless the loaded character (or historical snapshot) has at least one entry in `unsupported_fields` or an unmigrated legacy column (`physical_appearance` non-empty and `!= character_bio`, or `modifications` non-empty).
2. **No Hidden Duplication or Startup Re-Injection:**
   - Saving a character via `PUT /api/characters/{id}`, creating one via wizard/seed, or restarting the backend (`init_db()`) must **never** copy `character_bio` into `physical_appearance` or write synthetic `physical_appearance` strings.
   - Pure duplication artifacts (`physical_appearance.strip() == character_bio.strip()`) from prior saves are treated as canonical: hidden in the UI, omitted from `.zcc` exports, and cleared (`physical_appearance = ""`) on save.
3. **Campaign Immutability & Running Campaign Safety:**
   - Existing running campaigns are pinned to their original `characters` row via Copy-on-Write forking ([`character_versions.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/character_versions.py#L292-L460)) and never mutate in place when a character is edited.
   - Moving legacy fields (`physical_appearance`, `modifications`) into `unsupported_fields` happens on **`.zcc` import** and **explicit save (`PUT /api/characters/{id}`)**—never via an in-place DB migration that would alter rows pinned by active campaigns.
   - Untouched legacy rows pinned by running campaigns continue receiving legacy `zone1_static.py` fallbacks if their old columns are non-empty, whereas `unsupported_fields` is **never** injected into LLM context.
4. **Read-Only + Non-Destructive Preservation Until Deleted:**
   - Unsupported fields are strictly **read-only** in the UI (never directly editable).
   - Saving edits on other tabs preserves `unsupported_fields` untouched; fields are removed **only** when the user explicitly deletes them (and clicks **Save Changes**).
5. **`.zcc` Export Round-Trip & Collision Safety:**
   - [`build_zcc_export`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py#L148-L205) omits empty/duplicate `physical_appearance` and empty `modifications`, and merges `unsupported_fields` back onto the top level of each character entry in `characters.json`—**skipping any key name that collides with a canonical `CharacterRecord` field**.
6. **Untrusted Extension Payload Safety:**
   - Bound `unsupported_fields` collected during `.zcc` import (e.g., max `64` keys, max `64 KB` serialized JSON per character, max nesting depth `8`) and render values in React strictly as escaped plain text / formatted JSON (never `dangerouslySetInnerHTML`).
7. **Module Boundary Compliance:**
   - Backend imports must pass `tach check` (`backend/tach.toml`), frontend imports must pass `npm --prefix frontend run arch:check`, and architecture docs must stay in sync (`scripts/generate_arch_docs.py --check`).

---

## 3. Functional Requirements & Edge Cases

### FR-1: `unsupported_fields` Storage, Schema Separation & Backfill/Seed Cleanup
**Requirement:** Add `unsupported_fields_json` persistence, decouple `CharacterRecord` reads from draft-only mutators, and fix `schema_init.py` / `seed.py`.

- **Database Schema & Migration ([`schema.sql`](file:///home/diegolima/Git/cybercantina/backend/app/db/schema.sql#L145-L182), [`schema_init.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/schema_init.py)):**
  - Add `unsupported_fields_json TEXT NOT NULL DEFAULT '{}'` to `characters` in `schema.sql` and via additive `ALTER TABLE` migration in `schema_init.py`.
  - Remove the `UPDATE characters SET physical_appearance = ... WHERE id = 'char_kira_vance'` backfill ([`schema_init.py` lines 1129–1133](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/schema_init.py#L1129-L1133)).
  - Update the pre-existing character backfill ([`schema_init.py` lines 1158–1173](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/schema_init.py#L1158-L1173)) to only backfill `character_bio` when `character_bio = '' AND physical_appearance = ''` (and `initial_message` when empty)—never writing to `physical_appearance` on startup.
- **Seed Data Cleanup ([`backend/app/db/seed.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/seed.py#L222-L250)):**
  - Update the seeded *Kira Vance* `CharacterWizardDraft` to populate canonical fields (`character_bio`, `species`, `sex`, `pronouns`, `age`, `build_and_height`, `distinctive_features`, `posture`, `mannerisms`, `visual_aesthetic`, `personality_traits`, `moral_code`, `quirks_flaws`, `communication_style`) with `physical_appearance=""`, `modifications=[]`, and `unsupported_fields={}`.
- **Schema Separation ([`backend/app/schemas/character.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/character.py#L758-L1044)):**
  - Add `unsupported_fields: dict[str, Any] = Field(default_factory=dict)` to `CharacterWizardDraft`, `CharacterRecord`, and `CharacterUpdatePayload`.
  - Decouple **`CharacterRecord`** (read model) from draft-only mutators so `get_character()` and `get_character_version()` perform **no** cross-field copying (`physical_appearance <-> character_bio`) and **no** auto-merging (`modifications -> distinctive_features`) on read.
  - **`CharacterWizardLLMOutput.to_draft()`** (AI wizards & LLM SillyTavern distillation):
    - If `character_bio` is empty and `physical_appearance` is non-empty, promote into `character_bio`.
    - Merge any LLM `modifications` into `distinctive_features`.
    - Emit canonical drafts with `physical_appearance=""`, `modifications=[]`, and `unsupported_fields={}`.
  - **`CharacterWizardDraft` & `CharacterUpdatePayload`** (`.zcc` import, manual wizard, and `PUT /api/characters/{id}`):
    - **Never** copy `character_bio` into `physical_appearance`.
    - Strip any key inside `unsupported_fields` whose name matches a canonical `CharacterRecord` attribute (except moving legacy `physical_appearance` / `modifications` there explicitly via the canonicalization rule below).
    - Normalize pure duplicate `physical_appearance.strip() == character_bio.strip()` to `physical_appearance = ""`.
    - On **`.zcc` import** and **`PUT /api/characters/{id}`** save:
      - If distinct `physical_appearance` (`!= character_bio`) is present and non-empty, store it under `unsupported_fields["physical_appearance"]` and clear `physical_appearance = ""` on the new/forked record (unless the user deleted it in the UI, in which case neither column nor `unsupported_fields` contains it).
      - If `modifications` is non-empty, store it under `unsupported_fields["modifications"]` and clear `modifications = []` on the new/forked record (unless deleted or moved by the user in the UI).
- **Repository Persistence ([`characters.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/characters.py), [`character_versions.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/character_versions.py)):**
  - Read/write `unsupported_fields_json` across `create_character_from_draft`, `get_character`, `update_character` (both in-place and CoW fork paths), `character_versions` snapshots, and `restore_character_version`.
  - In `get_character` ([`characters.py` lines 405–410](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/characters.py#L405-L410)), read `row["character_bio"]` directly without aliasing `row["physical_appearance"]` onto `character_bio`.

---

### FR-2: Frontend Conditional `Unsupported` Tab & Read-Only Migration/Delete UX
**Requirement:** Replace scattered legacy UI with a single conditional `Unsupported` tab that is hidden unless needed, read-only, non-destructive across saves, and supports per-field deletion.

- **Active Unsupported State Construction (`CharacterInspectorModal.tsx`):**
  - When loading `latestCharacter` or a version snapshot (`snap` / `updated`), assemble `unsupportedFields: Record<string, unknown>` from:
    1. All entries in `record.unsupported_fields ?? {}`.
    2. For **untouched legacy DB rows** (not yet re-saved under `v0.13.1`):
       - If `(record.physical_appearance ?? "").trim()` is non-empty AND `!== (record.character_bio ?? "").trim()` (and not already in `unsupported_fields`), surface `physical_appearance` in `unsupportedFields`. (If `=== character_bio`, treat as a mirroring duplicate and hide it.)
       - If `(record.modifications ?? []).length > 0` (and not already in `unsupported_fields`), surface `modifications` in `unsupportedFields` without auto-merging into `distinctiveFeatures`.
- **Conditional Tab Visibility & Tab Bar Behavior:**
  - **Hide Completely When Empty:** If `Object.keys(unsupportedFields).length === 0` (and no fields are staged for deletion during the current edit session), the **`Unsupported`** tab button and panel do **not** render at all.
  - **When Present:** Render the **`Unsupported`** tab button (e.g., amber `AlertTriangle` / `Archive` icon + `Unsupported` label + count badge of remaining active entries) in `.modal-tabs` (ensuring `.modal-tabs` handles horizontal scroll/wrap cleanly).
  - **Staged Removal + Safe Tab Exit:**
    - Deleting an entry marks it as `pendingDeletion` in local UI state (calling `markDirty()`), displaying a compact `"Removed (pending Save)"` row with an **Undo** button so the tab doesn't yank itself away while the user is looking at it.
    - Clicking **Save Changes** commits `unsupported_fields` with deleted keys omitted (and `physical_appearance: ""`, `modifications: []`); if zero entries remain after Save, reset `activeTab` to `"base"` so the tab disappears cleanly. Closing/canceling the modal discards staged deletions.
- **Read-Only `CharacterUnsupportedTab.tsx` Presentation:**
  - Top notice banner explaining:
    *"These fields come from an older CyberCantina schema or a newer version not supported by this server. They are preserved on save and export, but are **not** included in AI roleplay context. Copy any details you want into supported tabs, or delete fields when ready."*
  - Render each key-value entry in its own read-only card:
    - **Badge:** **`Deprecated`** (for known legacy keys `physical_appearance`, `modifications`) or **`Unsupported`** (for unrecognized/future keys).
    - **Content:** Read-only selectable text (`<textarea readOnly>` for strings, read-only chips for string arrays, or read-only pretty-printed JSON `<pre>` for objects/numbers/booleans).
    - **Actions (when `!readOnly`):**
      - For all entries: **Copy** (to clipboard) and staged **Delete** (`--accent-rose` / `Trash2` button).
      - Convenience helpers for known deprecated keys:
        - `physical_appearance`: **Copy to Bio** (if `characterBio` is empty) or **Append to Bio** (if `characterBio` is non-empty) — never auto-deletes `physical_appearance` on copy, plus optional **Move to Bio & Delete**.
        - `modifications`: **Move to Distinctive Features & Delete** (deduplicated case-insensitively).
    - **Read-Only Mode (`readOnly === true`, historical version inspection):** Render all entries in `Unsupported` with their badges, hiding mutation/delete controls.
- **Stop Active Mirroring on Canonical Tabs:**
  - In [`CharacterBaseTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/character/CharacterBaseTab.tsx#L168-L171) and [`CharacterAppearanceTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/character/CharacterAppearanceTab.tsx#L71-L88): bio edits and AI rewrites update `character_bio` only (never `physical_appearance`).
  - In [`CharacterInspectorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/character/CharacterInspectorModal.tsx#L398-L412): `handleSave` submits `character_bio: characterBio.trim()`, `physical_appearance: ""`, `modifications: []`, and `unsupported_fields: remainingUnsupportedFields` (excluding keys staged for deletion).
  - In [`WizardModals.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/WizardModals.tsx#L116-L125) and [`frontend/src/types/character.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/character.ts#L193-L202): add `unsupported_fields?: Record<string, unknown>`, make `physical_appearance?: string` optional, and stop setting `physical_appearance` in manual wizard draft payloads.

---

### FR-3: Wizard & SillyTavern Pipeline Alignment
**Requirement:** Ensure AI character generation, heuristic fallback, and SillyTavern distillation write to canonical fields (`character_bio`, `distinctive_features`) without populating `physical_appearance`, `modifications`, or `unsupported_fields`.

- **In [`draft_pipeline.py`](file:///home/diegolima/Git/cybercantina/backend/app/wizards/char_gen/draft_pipeline.py#L130-L430):**
  - Stop synthesizing a fallback `physical_appearance` string; construct `CharacterWizardDraft` with `physical_appearance=""` and `modifications=[]`.
- **In [`inference.py`](file:///home/diegolima/Git/cybercantina/backend/app/wizards/char_gen/inference.py#L487-L501):**
  - Populate `character_bio` only and set `physical_appearance=""`, `modifications=[]`.
- **In [`sillytavern_distiller.py`](file:///home/diegolima/Git/cybercantina/backend/app/wizards/sillytavern_distiller.py#L253-L335):**
  - Populate `character_bio` in `_fallback_sillytavern_distillation` with `physical_appearance=""`, and validate `draft.character_bio` against `fallback.character_bio` in `distill_sillytavern_card`.
- **In [`defaults.py`](file:///home/diegolima/Git/cybercantina/backend/app/prompts/defaults.py):**
  - Align single-pass/SillyTavern wizard prompt instructions with `character_bio` + `distinctive_features` + `build_and_height` without encouraging redundant `physical_appearance` duplication.

---

### FR-4: Zone 1 Prompt Context Isolation & Running-Campaign Safety (`backend/app/engine/context/zone1_static.py`)
**Requirement:** Fix `Bio:` suppression, guarantee `unsupported_fields` is never injected into prompts, and keep untouched legacy rows pinned by running campaigns working safely.

- **In [`build_zone1_static_system_prompt`](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/zone1_static.py#L184-L234):**
  - Always emit `Bio: {character.character_bio}` when `character.character_bio.strip()` is non-empty—remove the `and character.character_bio != character.physical_appearance` check ([line 203](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/zone1_static.py#L203)).
  - **Strict Context Exclusion:** **Never** read or inject `character.unsupported_fields` into Zone 1 (or Zone 2 / VectorStore / mentions).
  - **Running-Campaign Fallback Only:** Keep `if not appearance_parts and character.physical_appearance.strip() and character.physical_appearance.strip() != character.character_bio.strip():` solely for untouched legacy rows pinned by already-running campaigns whose old columns are still non-empty.
  - For custom prompt presets referencing `{physical_appearance}` ([line 229](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/zone1_static.py#L229)): pass `character.physical_appearance or ", ".join(character.distinctive_features) or character.character_bio` so custom presets don't render blank placeholders.
- **In [`build_zone1_ensemble_system_prompt`](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/zone1_static.py#L263-L276):**
  - Deduplicate `c.modifications` against `c.distinctive_features` (for untouched legacy rows only), guard `c.physical_appearance` fallback against duplicating `c.character_bio`, and never inject `c.unsupported_fields`.

---

### FR-5: `.zcc` Import/Export Forward-Compatibility & Hygiene (`backend/app/services/import_export_service.py`)
**Requirement:** Preserve unknown/future `.zcc` keys and distinct legacy fields in `unsupported_fields`, notify the user on inspect, and round-trip cleanly on export without leaking hidden empty/duplicate legacy fields.

- **Inspect Notification ([`inspect_uploaded_file`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py#L257-L468), [`ImportPreviewModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ImportPreviewModal.tsx)):**
  - Detect any unrecognized top-level character keys (keys outside `CharacterRecord.model_fields` and metadata keys `id`, `world_id`, `pending_deletion`, `version`, `created_at`) or distinct legacy `physical_appearance` / non-empty `modifications`.
  - Populate `ImportInspectResponse.warnings` (already present on [`ImportInspectResponse`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/import_export.py#L84)) with a concise non-blocking notice (e.g., *"Character 'X' contains unsupported or deprecated fields (e.g. foo, bar). They will be preserved read-only under the Unsupported tab and excluded from AI roleplay context."*) and display `warnings` in [`ImportPreviewModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ImportPreviewModal.tsx).
- **Import Ingestion ([`commit_staged_import`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py#L949-L997)):**
  - Collect all unrecognized top-level keys from each character dict `c` into `unsupported_fields` (enforcing bounded limits: max `64` keys, max `64 KB` JSON size, max depth `8`, raising HTTP 400 on abuse).
  - If `c.get("physical_appearance")` is non-empty and differs from `c.get("character_bio")`, store it in `unsupported_fields["physical_appearance"]` (do **not** store if it equals `character_bio`).
  - If `c.get("modifications")` is non-empty, store it in `unsupported_fields["modifications"]`.
  - Pass `physical_appearance=""`, `modifications=[]`, and `unsupported_fields=...` to `CharacterWizardDraft`.
- **Export Serialization ([`build_zcc_export`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py#L148-L205)):**
  - Omit `unsupported_fields` wrapper key itself from `characters.json`; instead, re-emit each entry of `char.unsupported_fields` at the top level of `char_data` **only if the key does not collide with any canonical `CharacterRecord` key**.
  - Omit `physical_appearance` when empty or `== char.character_bio` (unless preserved inside `unsupported_fields`).
  - Omit `modifications` when empty (unless preserved inside `unsupported_fields`).
  - Result: canonical characters export with zero `physical_appearance`, `modifications`, or `unsupported_fields` keys; characters with unremoved future/legacy fields round-trip those fields at top level cleanly until deleted.

---

## 4. Non-Functional Requirements & Backward Compatibility

1. **Running Campaign Safety:**
   - Unmodified legacy characters pinned by active campaigns retain their original DB row (`physical_appearance` / `modifications` untouched); editing via `CharacterInspectorModal` triggers Copy-on-Write forking (`character_versions.py`), so running campaigns never lose context mid-play.
2. **Database & Snapshot Safety:**
   - Existing SQLite rows and `character_versions` snapshots remain readable without `DROP COLUMN`; inspecting/restoring an older snapshot surfaces its `unsupported_fields` (or legacy columns) read-only in the `Unsupported` tab.
3. **Security & Rendering Hygiene:**
   - Render `unsupported_fields` values strictly as escaped text/JSON in React (never `dangerouslySetInnerHTML`); enforce size/key/depth limits on import.
4. **Legacy Test Suite Alignment:**
   - Update existing test assertions coupled to old mirroring/auto-merge behavior ([`test_character_attributes_and_versions.py`](file:///home/diegolima/Git/cybercantina/backend/tests/test_character_attributes_and_versions.py#L487-L584), [`test_sillytavern_import.py`](file:///home/diegolima/Git/cybercantina/backend/tests/test_sillytavern_import.py#L162-L163), [`test_engine_and_branches.py`](file:///home/diegolima/Git/cybercantina/backend/tests/test_engine_and_branches.py#L898), and [`test_import_export.py`](file:///home/diegolima/Git/cybercantina/backend/tests/test_import_export.py#L502-L570)) alongside new tests for `unsupported_fields` persistence, future-`.zcc` round-tripping, CoW running-campaign safety, and Zone 1 exclusion.

---

## 5. Resolved Design Decisions

1. **Dedicated Conditional `Unsupported` Tab Over Per-Tab Inline Notices:**
   - **Decision:** Consolidate deprecated legacy fields (`physical_appearance`, `modifications`) and unknown future `.zcc` fields into one conditional **`Unsupported`** tab (hidden when empty) rather than scattering warnings across `Base` and `Appearance`. Keep one-click Copy/Move helpers on known legacy cards so users don't lose workflow speed across tabs.
2. **`unsupported_fields_json` Bag for Future `.zcc` Resilience & Non-Destructive Saves:**
   - **Decision:** Store unknown top-level `.zcc` keys (and legacy fields moved on import/save) in `unsupported_fields_json`, re-emitting non-colliding keys at top level on `.zcc` export and preserving them across saves of other tabs until explicitly deleted.
3. **Move on Import/Save (Not Startup DB Migration) to Protect Running Campaigns:**
   - **Decision:** Keep `schema_init.py` non-destructive for existing `characters` rows (only fixing the buggy `physical_appearance` backfill); move legacy fields into `unsupported_fields` on `.zcc` import or explicit UI save (which CoW-forks if used by active campaigns), ensuring running campaigns pinned to untouched legacy rows never break.
4. **Automatic Cleanup of Pure Duplication Artifacts (`physical_appearance == character_bio`):**
   - **Decision:** Treat exact `physical_appearance == character_bio` duplicates from the prior UI mirroring bug as canonical (do not move them to `unsupported_fields`, do not show the `Unsupported` tab, clear `physical_appearance = ""` on save, and omit on `.zcc` export).

---

## 6. Acceptance Criteria

- [ ] **Hidden by Default:** Newly created characters (including seeded *Kira Vance* on fresh installs) and canonical characters (including prior `physical_appearance == character_bio` duplicates) do **not** show the `Unsupported` tab and export without `physical_appearance`, `modifications`, or `unsupported_fields` keys.
- [ ] **Conditional `Unsupported` Tab & Read-Only UX:** Characters imported from legacy `.zcc` packages (distinct `physical_appearance` / non-empty `modifications`) or future `.zcc` packages (unrecognized keys), as well as untouched legacy DB characters, show the **`Unsupported`** tab with item count badge and read-only cards labeled **`Deprecated`** or **`Unsupported`**.
- [ ] **Preserved Across Unrelated Saves:** Editing `tagline`, `tags`, or other tabs and saving preserves all `unsupported_fields` untouched without injecting them into Zone 1 prompts or embeddings.
- [ ] **Migration Helpers & Staged Deletion:** Known deprecated cards provide Copy/Append/Move helpers; clicking **Delete** on any unsupported card stages removal with **Undo** until **Save Changes**; saving removes those keys from `Unsupported` (resetting `activeTab` to `"base"` if none remain) and omits them from future `.zcc` exports.
- [ ] **Future `.zcc` Round-Trip & Preview Warning:** Inspecting a `.zcc` with unknown character keys surfaces a non-blocking warning in `ImportPreviewModal`, importing stores them in `unsupported_fields_json` (within size/depth bounds), and re-exporting emits them at top level in `characters.json` without colliding with canonical keys.
- [ ] **Running Campaign Isolation:** Editing and saving a legacy character used by an active campaign CoW-forks a new character row without altering the running campaign's pinned character or breaking its Zone 1 prompt.
- [ ] **Startup Backfill & Zone 1 `Bio:` Fix:** Restarting (`init_db()`) never populates `physical_appearance` on canonical characters; `build_zone1_static_system_prompt` always renders `Bio: <character_bio>` when non-empty and never injects `unsupported_fields`.
- [ ] **Checks Pass:**
  - Backend: `cd backend && .venv/bin/ruff check app tests && .venv/bin/tach check` and `backend/.venv/bin/pytest backend/tests` pass.
  - Frontend: `npm --prefix frontend run arch:check && npm --prefix frontend run build && npm --prefix frontend test` pass.
  - Docs: `backend/.venv/bin/python scripts/generate_arch_docs.py --check` passes.
