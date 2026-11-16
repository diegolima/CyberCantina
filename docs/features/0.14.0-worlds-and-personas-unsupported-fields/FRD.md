---
feature: worlds-and-personas-unsupported-fields
target_version: 0.14.0
document_type: frd
status: draft
last_updated: 2026-11-16
---

# Feature Requirements Document (FRD)
## Canonical World & Persona Schemas, Conditional "Unsupported" Tabs & `.zcc` Forward-Compatibility

**Status:** Draft  
**Target Version:** CyberCantina v0.14.0  
**Depends On:** `0.13.1-canonical-character-export-and-legacy-field-cleanup`  
**Scope:**
- Shared Unsupported-Fields Utilities ([`backend/app/schemas/`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/), new `frontend/src/components/shared/UnsupportedFieldsTab.tsx`, [`frontend/src/components/character/CharacterUnsupportedTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/character/CharacterUnsupportedTab.tsx))
- Backend Persistence & Migrations ([`backend/app/db/schema.sql`](file:///home/diegolima/Git/cybercantina/backend/app/db/schema.sql), [`backend/app/db/repos/schema_init.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/schema_init.py), [`backend/app/db/repos/personas.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/personas.py), [`backend/app/db/repos/worlds.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/worlds.py), [`backend/app/db/repos/world_locations.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/world_locations.py), [`backend/app/db/repos/campaigns.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/campaigns.py))
- Backend Schemas & Zone 1 Context ([`backend/app/schemas/persona.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/persona.py), [`backend/app/schemas/world.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/world.py), [`backend/app/engine/context/zone1_static.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/zone1_static.py))
- Backend Import/Export Service ([`backend/app/services/import_export_service.py`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py))
- Frontend Persona & World UI & API ([`frontend/src/api/worlds.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/api/worlds.ts), [`frontend/src/types/persona.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/persona.ts), [`frontend/src/types/world.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/world.ts), [`frontend/src/components/PersonaEditorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/PersonaEditorModal.tsx), [`frontend/src/components/world/WorldInspectorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldInspectorModal.tsx), [`frontend/src/components/ImportPreviewModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ImportPreviewModal.tsx), [`frontend/src/components/HomeEntityPickerModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/HomeEntityPickerModal.tsx), [`frontend/src/components/NewCampaignModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/NewCampaignModal.tsx), [`frontend/src/components/ExportBundleModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ExportBundleModal.tsx))
- Automated Tests (`backend/tests/`, `frontend/src/`)

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
In `v0.13.1`, CyberCantina introduced `unsupported_fields` (`unsupported_fields_json`), a conditional read-only **`Unsupported`** tab, Zone 1 prompt isolation, and `.zcc` forward/backward-compatibility hygiene for **Characters**. **Personas** and **Worlds** in `.zcc` archives still suffer from the same structural gaps:

1. **Personas — Hidden Legacy `physical_appearance` & No Future-Key Resilience:**
   - [`PersonaEditorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/PersonaEditorModal.tsx#L193) exposes **no** visible editor for `physical_appearance`, yet silently re-submits `persona?.physical_appearance ?? ""` on save—preserving hidden uneditable data in SQLite and `.zcc` `personas.json` exports without giving users any way to view, migrate, or delete it.
   - [`build_zcc_export`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py#L228) exports `physical_appearance: ""` on every persona even when empty.
   - [`commit_staged_import`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py#L878-L895) constructs `PersonaCreatePayload(...)` with explicit known keys only, silently dropping any unrecognized/future top-level keys from `personas.json`.

2. **Worlds — Silent Dropping of Legacy `global_rules` & Future `.zcc` Attributes:**
   - Legacy worlds and older `.zcc` exports can carry deprecated `WorldGlobalRules` keys (such as `narrative_style`, `sensory_profile`, `taboos_and_limits`) or unrecognized keys inside `global_rules`, as well as unrecognized top-level keys on a world entry in `worlds.json`.
   - [`commit_staged_import`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py#L656-L657) writes raw `w.get("global_rules", {})` into `worlds.global_rules_json`, which [`get_world`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/worlds.py#L620) then validates with `WorldGlobalRules` (`extra="ignore"`), silently hiding and then permanently wiping any unrecognized `global_rules` keys on `update_world`—while top-level unknown keys in `worlds.json` are discarded immediately during import.
   - [`WorldInspectorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldInspectorModal.tsx) has no mechanism to surface deprecated or future world attributes read-only for review, migration, or explicit deletion.

3. **Inconsistent `.zcc` Inspect Warnings:**
   - [`inspect_uploaded_file`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py#L428-L445) currently checks and warns on unsupported/deprecated keys for `characters.json` only, silently ignoring unsupported keys in `worlds.json` and `personas.json`.

### 1.2 Proposed Solution
Extend the exact `0.13.1` **`unsupported_fields`** + conditional **`Unsupported`** tab architecture uniformly across **Personas** and **Worlds**, extracting shared backend/frontend helpers so all three entity types share one DRY implementation:

1. **Shared Backend Extension-Field Helpers (`backend/app/schemas/`):**
   - Extract `sanitize_unsupported_fields`, bounds constants (`MAX_UNSUPPORTED_KEYS = 64`, `MAX_UNSUPPORTED_BYTES = 64 * 1024`, `MAX_UNSUPPORTED_DEPTH = 8`), and canonical key collision filtering into a shared leaf helper module (`backend/app/schemas/unsupported.py`, re-exported from `schemas/character.py` as needed so `tach check` stays clean).
2. **Personas (`personas.unsupported_fields_json` + Conditional Tab in `PersonaEditorModal`):**
   - Add `unsupported_fields_json TEXT NOT NULL DEFAULT '{}'` to `personas`.
   - Move distinct legacy `physical_appearance` (`!= persona_bio`) and unrecognized top-level keys from `.zcc` `personas.json` into `unsupported_fields` on import or explicit persona save (clearing `physical_appearance = ""`).
   - Running campaigns remain untouched because `campaigns.persona_snapshot_json` snapshots the `PersonaRecord` at campaign launch.
   - Add a conditional **`Unsupported`** tab to [`PersonaEditorModal`](file:///home/diegolima/Git/cybercantina/frontend/src/components/PersonaEditorModal.tsx) (hidden when empty; read-only on default `"User"` persona) with `Deprecated` / `Unsupported` badges, **Copy**, **Copy/Append to Bio** / **Move to Bio & Delete**, and staged **Delete** / **Undo**.
3. **Worlds (`worlds.unsupported_fields_json` + Conditional Tab in `WorldInspectorModal`):**
   - Add `unsupported_fields_json TEXT NOT NULL DEFAULT '{}'` to `worlds`.
   - Capture unrecognized top-level keys from `worlds.json` and unrecognized/deprecated keys inside `global_rules` (stored deterministically under dotted keys `"global_rules.<key>"`, e.g. `"global_rules.narrative_style"`, `"global_rules.sensory_profile"`, `"global_rules.taboos_and_limits"`) into `unsupported_fields` on `.zcc` import and on `get_world()` / `update_world()` reads/writes.
   - Running campaigns remain unaffected via Copy-on-Write world forking in [`worlds.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/worlds.py#L718-L738).
   - Add a conditional **`Unsupported`** tab to [`WorldInspectorModal`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldInspectorModal.tsx) (hidden when empty and in wizard mode unless populated; read-only in `mode === "campaign"`) with `Deprecated` / `Unsupported` badges, **Copy**, **Append to Tone** / **Append to World Rules** helpers, and staged **Delete** / **Undo**.
4. **Shared Frontend `UnsupportedFieldsTab` Component:**
   - Extract the generic read-only card & staged-delete UI from `CharacterUnsupportedTab.tsx` into a shared component (`frontend/src/components/shared/UnsupportedFieldsTab.tsx`) used by Characters, Personas, and Worlds, preserving entity-specific migration action slots and theme accent colors (`amber`, `emerald`, `cyan`).

> [!NOTE]
> **Deferred Scope (Explicitly Excluded from v0.14.0):**
> - **World Sub-Entity Extension Columns (`location_nodes`, `location_containers`, `location_edges`, `lore_nodes`):** Because spatial graph and lore nodes reside in separate relational tables with turn-indexed overrides and GraphRAG embeddings, adding per-row `unsupported_fields_json` to all four child tables is deferred. However, `inspect_uploaded_file` **will** warn if unrecognized keys appear on nested world sub-entities during `.zcc` inspect so users are never caught off-guard.
> - **SQLite `DROP COLUMN` on `personas.physical_appearance`:** Retain the `personas.physical_appearance` column in `schema.sql` for backward-compatible reads of historical rows and `campaigns.persona_snapshot_json`.
> - **Campaign `persona_snapshot_json` Mutation:** Existing campaigns keep their frozen `persona_snapshot_json` verbatim; `resolve_character_known_persona` and `format_zone1_player_protagonist_block` retain `persona_snapshot.physical_appearance` fallback solely for those immutable campaign snapshots while never reading `unsupported_fields`.

---

## 2. Scope, Boundaries & Core Invariants

1. **Conditional `Unsupported` Tab Visibility (Personas & Worlds):**
   - The **`Unsupported`** tab in [`PersonaEditorModal`](file:///home/diegolima/Git/cybercantina/frontend/src/components/PersonaEditorModal.tsx) and [`WorldInspectorModal`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldInspectorModal.tsx) must be **completely hidden** unless at least one entry exists in `unsupported_fields` or an unmigrated legacy attribute is present (`persona.physical_appearance` non-empty and `!= persona_bio`, or legacy/extra keys inside `worlds.global_rules_json`).
2. **Read-Only + Non-Destructive Preservation Across Saves:**
   - All entries in `Unsupported` are strictly read-only.
   - Saving edits on `Base`, `Appearance`, `Map`, `Lore`, or `Inventory` preserves `unsupported_fields` intact; keys are removed **only** when explicitly deleted by the user and committed on Save.
3. **Zero Context Injection for `Unsupported`:**
   - Neither `persona.unsupported_fields` nor `world.unsupported_fields` may ever be injected into Zone 1 (`zone1_static.py`), Zone 2, VectorStore embeddings, `WorldMapReimagineRequest`, or character enrichment prompts.
4. **Campaign Snapshot Immutability & CoW Isolation:**
   - Running campaigns stay pinned to `campaigns.persona_snapshot_json` (for Personas) and CoW-forked `worlds.id` rows (for Worlds, [`worlds.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/worlds.py#L718-L738)). Moving legacy fields into `unsupported_fields` happens on `.zcc` import and explicit Save—never via destructive startup SQLite migrations across existing campaign snapshots.
5. **`.zcc` Export Round-Trip & Collision Safety:**
   - [`build_zcc_export`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py#L148-L250) omits `unsupported_fields` wrapper keys from `personas.json` and `worlds.json`, omits empty/duplicate `persona.physical_appearance`, and re-emits `unsupported_fields` entries cleanly:
     - Top-level keys onto `persona_data` / `world_data` (skipping any collision with canonical `PersonaRecord` / `WorldRecord` keys).
     - `"global_rules.<subkey>"` entries onto `world_data["global_rules"][<subkey>]` (skipping any collision with canonical `WorldGlobalRules` keys).
6. **Module Boundary Compliance:**
   - Backend imports must pass `tach check` (`backend/tach.toml`), frontend imports must pass `npm --prefix frontend run arch:check`, and architecture docs must be regenerated via `scripts/generate_arch_docs.py`.

---

## 3. Functional Requirements & Edge Cases

### FR-1: Shared `unsupported_fields` Utility & Bounds Enforcement
**Requirement:** Centralize bounded extension-field validation so Characters, Personas, and Worlds share identical security limits and sanitization rules.

- **New Leaf Schema Module (`backend/app/schemas/unsupported.py`):**
  - Move `MAX_UNSUPPORTED_KEYS = 64`, `MAX_UNSUPPORTED_BYTES = 64 * 1024`, `MAX_UNSUPPORTED_DEPTH = 8`, `_measure_json_depth`, and `sanitize_unsupported_fields(raw, *, blocked_keys, strict=False)` into `backend/app/schemas/unsupported.py` (re-exporting Character-bound helpers in `schemas/character.py` so existing imports remain intact).
  - Verify `backend/tach.toml` compliance (`app.schemas` depends only on `app.config`).
- **Shared Frontend Component (`frontend/src/components/shared/UnsupportedFieldsTab.tsx` + helpers):**
  - Refactor [`CharacterUnsupportedTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/character/CharacterUnsupportedTab.tsx) to delegate rendering of read-only cards, `Deprecated` vs `Unsupported` badges, Copy, Staged Delete + Undo, and custom per-key migration buttons to a reusable `UnsupportedFieldsTab` component supporting theme accents (`amber` for Characters, `emerald` for Personas, `cyan` for Worlds).
  - Standardize migration helper button copy across all three modals: show **`Copy to <Target>`** when the target field is empty or **`Append to <Target>`** when non-empty, paired with **`Move to <Target> & Delete`** (or **`Move to Distinctive Features & Delete`** for chip arrays).

---

### FR-2: Personas — Schema, Persistence, Zone 1 Isolation & Editor UI
**Requirement:** Apply the `unsupported_fields` lifecycle to player Personas (`PersonaRecord`, `PersonaEditorModal`, `personas.json`).

- **Database & Migrations ([`schema.sql`](file:///home/diegolima/Git/cybercantina/backend/app/db/schema.sql#L195-L214), [`schema_init.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/schema_init.py#L470-L515)):**
  - Add `unsupported_fields_json TEXT NOT NULL DEFAULT '{}'` to `personas` and via additive `ALTER TABLE` migration in `schema_init.py`.
- **Schemas ([`backend/app/schemas/persona.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/persona.py#L134-L267)):**
  - Add `unsupported_fields: dict[str, Any] = Field(default_factory=dict)` to `PersonaRecord`, `PersonaCreatePayload`, and `PersonaUpdatePayload` (default `None` on `PersonaUpdatePayload` so partial updates preserve existing `unsupported_fields` unless explicitly supplied).
  - Define `CANONICAL_PERSONA_RECORD_KEYS` (all `PersonaRecord` fields except `physical_appearance` and `unsupported_fields`) and `LEGACY_DEPRECATED_PERSONA_KEYS = frozenset({"physical_appearance"})`.
  - Add `canonicalize_persona_legacy_fields(persona_bio, physical_appearance, unsupported_fields)` helper:
    - If `physical_appearance.strip()` is non-empty and `!= persona_bio.strip()`, store under `unsupported_fields["physical_appearance"]` (unless already present or explicitly deleted); clear `physical_appearance = ""`.
    - If `physical_appearance.strip() == persona_bio.strip()`, discard duplicate and clear `physical_appearance = ""`.
- **Repository ([`backend/app/db/repos/personas.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/personas.py)):**
  - Read/write `unsupported_fields_json` in `create_persona`, `update_persona`, and `_row_to_persona_record`.
  - In **both** `create_persona` and `update_persona`, canonicalize any non-empty `physical_appearance` supplied in `payload` (or remaining on `existing` when `payload.physical_appearance is None` and `payload.unsupported_fields is None`) into `unsupported_fields` (clearing `physical_appearance = ""`), while respecting explicit `payload.unsupported_fields` deletions when provided.
  - Ensure `get_default_persona` sets `unsupported_fields={}` and `physical_appearance=""`.
- **Frontend Persona UI & Display Fallbacks:**
  - Update [`frontend/src/types/persona.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/persona.ts) with `unsupported_fields?: Record<string, unknown>`.
  - Update [`PersonaEditorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/PersonaEditorModal.tsx):
    - Build `unsupportedFields` from `persona.unsupported_fields` plus any untouched legacy `persona.physical_appearance` (non-empty and `!= persona_bio`).
    - Render conditional **`Unsupported`** tab (`modal-tabs-emerald`, count badge) only when `Object.keys(unsupportedFields).length > 0`.
    - Provide **Copy**, **Copy to Bio** / **Append to Bio** + **Move to Bio & Delete** (for `physical_appearance`), and staged **Delete** / **Undo** when `!isReadOnly`.
    - On submit (`handleSubmit`), send `physical_appearance: ""` (stopping the hidden `persona?.physical_appearance ?? ""` passthrough on line 193) and `unsupported_fields: remainingUnsupported`. (`PersonaEditorModal` submits immediately on **Save Changes** and closes on success; staged deletes show `"Marked for deletion — click Save Changes to remove permanently, or Undo to keep"`.)
    - Note for `isDefaultPersonaRecord` (`"User"`): default persona has no legacy/unsupported fields; if cloned (`clonedMode === true`), cloned copy starts cleanly.
  - Update [`HomeEntityPickerModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/HomeEntityPickerModal.tsx#L494), [`NewCampaignModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/NewCampaignModal.tsx#L469), and [`ExportBundleModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ExportBundleModal.tsx#L634) so persona previews prefer `persona_bio` / `build_and_height` / `distinctive_features` over `physical_appearance` (keeping `physical_appearance` fallback only if still set on an untouched legacy row).
- **Zone 1 & Campaign Safety ([`zone1_static.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/zone1_static.py#L76,L135)):**
  - Never inject `persona_snapshot.unsupported_fields` in `format_zone1_player_protagonist_block` or `resolve_character_known_persona`.
  - Keep `persona_snapshot.physical_appearance` fallback solely for frozen `campaigns.persona_snapshot_json` rows created before migration.

---

### FR-3: Worlds — Schema, Persistence, Legacy `global_rules` & Inspector UI
**Requirement:** Apply the `unsupported_fields` lifecycle to Worlds (`WorldRecord`, `WorldGlobalRules`, `WorldInspectorModal`, `worlds.json`).

- **Database & Migrations ([`schema.sql`](file:///home/diegolima/Git/cybercantina/backend/app/db/schema.sql#L81-L88), [`schema_init.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/schema_init.py)):**
  - Add `unsupported_fields_json TEXT NOT NULL DEFAULT '{}'` to `worlds` and via additive `ALTER TABLE` migration in `schema_init.py`.
- **Schemas ([`backend/app/schemas/world.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/world.py)):**
  - Define `CANONICAL_WORLD_GLOBAL_RULE_KEYS = frozenset({"genre", "tone", "setting_overview", "tech_or_magic_rules", "starting_timestamp", "describe_on_first_visit"})`, `LEGACY_DEPRECATED_WORLD_GLOBAL_RULE_KEYS = frozenset({"narrative_style", "sensory_profile", "taboos_and_limits"})`, and `CANONICAL_WORLD_RECORD_KEYS` (all `WorldRecord` fields except `unsupported_fields`).
  - Add `unsupported_fields: dict[str, Any] = Field(default_factory=dict)` to `WorldRecord`, and `unsupported_fields: dict[str, Any] | None = None` to `WorldUpdatePayload` (so partial or internal `WorldUpdatePayload` callers preserve existing `unsupported_fields` unless explicitly replaced/cleared).
  - Add `extract_world_unsupported_fields(raw_world_dict, *, strict=False) -> dict[str, Any]`:
    - Captures unrecognized top-level keys on a world dict (e.g. `"calendar_system"`).
    - Captures unrecognized or legacy keys inside `global_rules` (such as `"narrative_style"`, `"sensory_profile"`, `"taboos_and_limits"`, or future keys) under dotted keys `"global_rules.<subkey>"`.
    - For `WorldGlobalRules._coerce_rules` alias keys (`"genre_and_tone"`, `"genre_tone"`, `"genre_setting"`, `"mood"`, `"atmosphere"`, `"narrative_tone"`): skip an alias key **only** if it was consumed to populate an empty `genre` or `tone` (or its trimmed value matches the canonical `genre`/`tone`); capture any non-empty conflicting alias value under `"global_rules.<alias>"` so no distinct data is lost.
    - Validates with `sanitize_unsupported_fields` (max 64 keys, 64 KB, depth 8).
- **Repository ([`backend/app/db/repos/worlds.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/worlds.py), [`backend/app/db/repos/world_locations.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/world_locations.py)):**
  - In `get_world`: parse raw `w_row["global_rules_json"]` and merge any legacy/unknown `global_rules.*` keys found there with `w_row["unsupported_fields_json"]` into `WorldRecord.unsupported_fields` (without mutating the DB row on read—preserving untouched running-campaign rows!).
  - In `update_world` (both in-place and CoW fork branches): resolve `effective_unsupported = orig.unsupported_fields if payload.unsupported_fields is None else payload.unsupported_fields`, persist `payload.global_rules.model_dump_json()` (canonical 6 keys only) and `json.dumps(sanitize_unsupported_fields(effective_unsupported, ...))` into `worlds.unsupported_fields_json`.
  - In `world_locations.py` (`delete_location_container` and `convert_location_to_container`): explicitly pass `unsupported_fields=orig.unsupported_fields` in `WorldUpdatePayload(...)` so container operations never wipe world-level `unsupported_fields`.
  - In `create_world_from_draft`: accept optional `unsupported_fields` (used during `.zcc` import, defaulting `{}`).
- **Frontend World API & UI ([`frontend/src/api/worlds.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/api/worlds.ts), [`frontend/src/types/world.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/world.ts), [`WorldInspectorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldInspectorModal.tsx)):**
  - Add `unsupported_fields?: Record<string, unknown>` to `WorldRecord` and include `"unsupported_fields"` in the `Pick<WorldRecord, ...>` payload type of `api.updateWorld` in [`frontend/src/api/worlds.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/api/worlds.ts#L41).
  - In `WorldInspectorModal`:
    - Add `"unsupported"` to `WorldTab` (`"base" | "map" | "lore" | "settings" | "unsupported"`).
    - Render the **`Unsupported`** tab button (`modal-tabs-cyan`, count badge) **only** when `Object.keys(unsupportedFields).length > 0` (never shown for canonical worlds or fresh wizard drafts).
    - In `mode === "campaign"` (`isCampaignMode === true`), render `Unsupported` strictly read-only (`readOnly={true}`): hide all migration/delete controls and never trigger `markDirty()` from `Unsupported`.
    - In `mode === "inspector"`, every migration or staged delete/undo action calls `markDirty()` so the conditional `{isDirty && Save Changes}` button activates reliably, and reset `activeTab` to `"base"` if zero unsupported fields remain after Save:
      - **`Deprecated`** badge for `"global_rules.narrative_style"`, `"global_rules.sensory_profile"`, `"global_rules.taboos_and_limits"`; **`Unsupported`** badge for unknown/future keys.
      - Convenience migration helpers using consistent copy:
        - `"global_rules.narrative_style"` / `"global_rules.sensory_profile"`: **Copy to Tone** / **Append to Tone** + **Move to Tone & Delete**.
        - `"global_rules.taboos_and_limits"`: **Copy to World Rules** / **Append to World Rules** + **Move to World Rules & Delete**.
      - **Copy** and staged **Delete** / **Undo** per field.
    - Never pass `unsupported_fields` into `api.reimagineWorldMap(...)` or Zone 1 prompts.

---

### FR-4: `.zcc` Inspect Warnings, Import & Export Across Characters, Worlds & Personas
**Requirement:** Unify `.zcc` inspect warnings, bounded ingestion, and top-level export round-tripping across all three entity categories.

- **Inspect Warnings ([`inspect_uploaded_file`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py#L428-L460)):**
  - Extend warning detection to **`worlds.json`** and **`personas.json`** alongside `characters.json`:
    - Warn when a World has unrecognized top-level keys, legacy/unrecognized `global_rules` keys, or unrecognized keys inside nested `containers` / `locations` / `edges` / `lore_nodes` (noting explicitly when nested sub-entity keys cannot be preserved).
    - Warn when a Persona has unrecognized top-level keys or distinct legacy `physical_appearance`.
  - Continue displaying all warnings in [`ImportPreviewModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ImportPreviewModal.tsx#L438-L470).
- **Import Ingestion ([`commit_staged_import`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py#L615-L997)):**
  - **Worlds:** Extract `unsupported_fields = extract_world_unsupported_fields(w, strict=True)` (returning HTTP 400 on bounds violation); validate/store canonical `WorldGlobalRules` in `global_rules_json` and `unsupported_fields` in `worlds.unsupported_fields_json`.
  - **Personas:** Extract unrecognized top-level keys and non-duplicate `physical_appearance` (`!= persona_bio`) into `unsupported_fields` (HTTP 400 on bounds violation); pass `physical_appearance=""` and `unsupported_fields=unsupported_fields` to `PersonaCreatePayload`.
- **Export Serialization ([`build_zcc_export`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py#L148-L250)):**
  - **Personas (`personas.json`):** Pop `"unsupported_fields"`; omit `"physical_appearance"` if empty or equal to `persona_bio`; re-emit non-colliding `persona.unsupported_fields` entries at top level of each persona dict.
  - **Worlds (`worlds.json`):** Pop `"unsupported_fields"`; re-emit top-level `world.unsupported_fields` entries (skipping canonical collisions) onto `world_data`, and re-emit `"global_rules.<subkey>"` entries onto `world_data["global_rules"][<subkey>]` (skipping canonical `WorldGlobalRules` collisions).

---

## 4. Non-Functional Requirements & Backward Compatibility

1. **Running Campaign Immutability:**
   - Active campaigns retain frozen `campaigns.persona_snapshot_json` (Personas) and CoW-pinned `worlds.id` rows (Worlds); editing a persona updates master template without touching active campaigns, and editing a world with `campaigns_using > 0` CoW-forks a new world row.
2. **Legacy Test Alignment:**
   - Update existing test assertions coupled to `persona.physical_appearance` persistence ([`test_user_personas.py`](file:///home/diegolima/Git/cybercantina/backend/tests/test_user_personas.py#L174,L247,L264,L734)) and verify legacy `WorldGlobalRules` kwargs in [`test_import_export.py`](file:///home/diegolima/Git/cybercantina/backend/tests/test_import_export.py#L69-L71) and [`test_server_config_and_chloromancer.py`](file:///home/diegolima/Git/cybercantina/backend/tests/test_server_config_and_chloromancer.py#L246-L248) remain backward-compatible for wizard/test callers (with `.zcc` / DB round-trips storing unrecognized/legacy world keys cleanly in `unsupported_fields`).
3. **Security & Layering:**
   - Enforce `MAX_UNSUPPORTED_KEYS = 64`, `MAX_UNSUPPORTED_BYTES = 64 KB`, `MAX_UNSUPPORTED_DEPTH = 8` across all three entity types on import.
   - Render all unsupported values as escaped text/JSON only (no `dangerouslySetInnerHTML`).

---

## 5. Resolved Design Decisions

1. **Shared Leaf Validator + Shared Frontend Tab Component:**
   - **Decision:** Centralize `sanitize_unsupported_fields` in `backend/app/schemas/unsupported.py` and the UI card list in `frontend/src/components/shared/UnsupportedFieldsTab.tsx` rather than duplicating logic across Character, Persona, and World modules.
2. **Dotted `"global_rules.<key>"` Namespace for World Rule Extensions:**
   - **Decision:** Store unknown/legacy `global_rules` keys inside `worlds.unsupported_fields` under `"global_rules.<subkey>"` so per-key cards, Delete/Undo, and `.zcc` re-emission back into `world_data["global_rules"]` are flat, unambiguous, and collision-safe.
3. **Scope World Extension Bag to World + `global_rules` (Deferring Spatial Child Tables):**
   - **Decision:** Keep `unsupported_fields_json` at the `worlds` row level in `v0.14.0` while surfacing inspect warnings if nested `locations` / `containers` / `edges` / `lore_nodes` contain unknown keys, avoiding schema bloat across 4 turn-branch-versioned spatial tables.

---

## 6. Acceptance Criteria

- [ ] **Hidden by Default:** Canonical Personas and Worlds show **no** `Unsupported` tab, and export cleanly to `.zcc` without `unsupported_fields`, empty/duplicate `persona.physical_appearance`, or legacy `global_rules` keys.
- [ ] **Persona `Unsupported` Tab & Cleanup:** Existing or imported Personas with distinct `physical_appearance` or unrecognized future `.zcc` keys display the conditional **`Unsupported`** tab (with `Deprecated` / `Unsupported` badges, Copy/Bio helpers, and staged Delete/Undo), preserve entries across unrelated edits, and omit deleted keys from subsequent exports.
- [ ] **World `Unsupported` Tab & Cleanup:** Existing or imported Worlds with legacy `global_rules` (`narrative_style`, `sensory_profile`, `taboos_and_limits`) or unrecognized top-level/`global_rules` keys display the conditional **`Unsupported`** tab (`mode === "inspector"` editable; `mode === "campaign"` read-only), support Copy/Append/Move/Delete, preserve entries across Map/Lore edits, and round-trip cleanly in `.zcc`.
- [ ] **Zone 1 & Running Campaign Safety:** `persona.unsupported_fields` and `world.unsupported_fields` are never injected into Zone 1 prompts or embeddings; active campaigns remain unaffected by master Persona edits or CoW-forked World edits.
- [ ] **`.zcc` Inspect Warnings & Bounds:** `inspect_uploaded_file` surfaces warnings for unsupported/deprecated keys in `worlds.json` and `personas.json`, and `commit_staged_import` rejects oversized/over-deep unsupported payloads with HTTP 400.
- [ ] **Checks Pass:**
  - Backend: `cd backend && .venv/bin/ruff check app tests && .venv/bin/tach check` and `backend/.venv/bin/pytest backend/tests` pass.
  - Frontend: `npm --prefix frontend run arch:check && npm --prefix frontend run build && npm --prefix frontend test` pass.
  - Docs: `backend/.venv/bin/python scripts/generate_arch_docs.py && backend/.venv/bin/python scripts/generate_arch_docs.py --check` pass.
