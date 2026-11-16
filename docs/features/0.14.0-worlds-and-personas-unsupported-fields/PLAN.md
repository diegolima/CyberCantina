# Execution Plan — CyberCantina v0.14.0 (Worlds & Personas `unsupported_fields`)

Reference specification: [`FRD.md`](./FRD.md) | Architectural review: [`REVIEW.md`](./REVIEW.md)

## Phase 1: Shared Validation & Schema Contracts
1. Create `backend/app/schemas/unsupported.py` with `MAX_UNSUPPORTED_KEYS = 64`, `MAX_UNSUPPORTED_BYTES = 65536`, `MAX_UNSUPPORTED_DEPTH = 8`, `measure_json_depth`, and `sanitize_unsupported_fields_dict`.
2. Update `backend/app/schemas/character.py` to delegate `sanitize_unsupported_fields` to `unsupported.py` while keeping facade constants exported.
3. Update `backend/app/db/schema.sql` and `backend/app/db/repos/schema_init.py` to add `unsupported_fields_json TEXT NOT NULL DEFAULT '{}'` to `worlds` and `personas`.
4. Update `backend/app/schemas/persona.py` (`PersonaRecord`, `PersonaCreatePayload`, `PersonaUpdatePayload`, `canonicalize_persona_legacy_fields`, `sanitize_persona_unsupported_fields`) and `backend/app/schemas/world.py` (`WorldRecord`, `WorldUpdatePayload`, `extract_world_unsupported_fields`, `find_nested_world_unsupported_keys`, `sanitize_world_unsupported_fields`).

## Phase 2: Backend Repositories & `.zcc` Import/Export Service
1. Update `backend/app/db/repos/personas.py` (`create_persona`, `update_persona`, `_row_to_persona_record`) to persist `unsupported_fields_json`, canonicalize `physical_appearance`, respect explicit `unsupported_fields` deletions, and surface untouched pre-migration `physical_appearance` dynamically on read.
2. Update `backend/app/db/repos/worlds.py` (`create_world_from_draft`, `get_world`, `update_world`) and `backend/app/db/repos/world_locations.py` (`delete_location_container`, `convert_location_to_container`) to store/read/preserve `unsupported_fields_json` cleanly across in-place updates, CoW forks, and container operations.
3. Update `backend/app/services/import_export_service.py`:
   - Re-emit `unsupported_fields` at top-level (`personas.json`) and top-level + `global_rules.*` (`worlds.json`) during `build_zcc_export`.
   - Emit non-blocking warnings across Characters, Worlds (including nested map sub-entity warnings), and Personas in `inspect_uploaded_file`.
   - Extract bounded `unsupported_fields` (`strict=True` -> HTTP 400 on violation) during `commit_staged_import`.

## Phase 3: Frontend Shared UI, Types, Modals & Fallbacks
1. Add `unsupported_fields` to `frontend/src/types/{persona,world}.ts` and `frontend/src/api/worlds.ts`.
2. Extract pure helpers in `frontend/src/utils/unsupportedFields.ts` and shared UI in `frontend/src/components/shared/UnsupportedFieldsTab.tsx`, refactoring `CharacterUnsupportedTab.tsx` cleanly onto the shared component.
3. Add conditional **`Unsupported`** tabs + migration/delete/undo workflows to `PersonaEditorModal.tsx` and `WorldInspectorModal.tsx` (strictly read-only in `"campaign"` mode), and prioritize `persona_bio` / `build_and_height` / `distinctive_features` over `physical_appearance` in `HomeEntityPickerModal.tsx`, `NewCampaignModal.tsx`, and `ExportBundleModal.tsx`.

## Phase 4: Verification & Architecture Docs
1. Update legacy persona tests and add repository/API/`.zcc`/Zone 1/container-preservation tests (`test_user_personas.py`, `test_import_export.py`, `test_location_containers.py`).
2. Add Vitest helper + SSR component tests (`frontend/src/components/__tests__/unsupportedFieldsTabs.test.tsx`).
3. Regenerate `docs/architecture/` via `scripts/generate_arch_docs.py` and pass all backend (`ruff`, `tach`, full `pytest`), frontend (`arch:check`, `build`, `test`), and architecture doc (`--check`) checks.
