---
feature: canonical-character-export-and-legacy-field-cleanup
target_version: 0.13.1
document_type: plan
status: completed
last_updated: 2026-11-16
---

# Implementation Plan & Progress Checklist
## Canonical Character Schema, "Unsupported" Tab & `.zcc` Forward-Compatibility (v0.13.1)

- [x] **Database & Seed Layer:** Added `unsupported_fields_json` column (`schema.sql`, `schema_init.py`), fixed startup `physical_appearance` backfill, and updated seeded *Kira Vance* in `seed.py` to canonical fields.
- [x] **Backend Schemas & Repositories:** Split `_CharacterFieldsBase`, `CharacterRecord`, `CharacterWizardDraft`, and `CharacterWizardLLMOutput.to_draft()`; added bounded `sanitize_unsupported_fields` and `canonicalize_legacy_fields_into_unsupported`; persisted `unsupported_fields_json` across `characters.py` and `character_versions.py`.
- [x] **Wizards & Zone 1 Context:** Aligned `draft_pipeline.py`, `inference.py`, and `sillytavern_distiller.py` to `character_bio`; fixed `Bio:` suppression in `zone1_static.py` and excluded `unsupported_fields` from prompts.
- [x] **Import/Export Service:** Extracted unrecognized future keys and distinct legacy keys into `unsupported_fields`, surfaced inspect warnings, omitted empty/duplicate legacy keys and wrapper on export, and re-emitted non-colliding `unsupported_fields` keys at top level.
- [x] **Frontend UI & Types:** Added `CharacterUnsupportedTab.tsx`, `unsupportedFields.ts`, conditional `Unsupported` tab in `CharacterInspectorModal.tsx`, removed mirroring in `CharacterBaseTab.tsx` / `CharacterAppearanceTab.tsx` / `WizardModals.tsx`, and rendered warnings in `ImportPreviewModal.tsx`.
- [x] **Tests & Architecture Docs:** Updated legacy test assertions, added backend and Vitest coverage, regenerated `docs/architecture/`, and ran full backend + frontend verification suites.
