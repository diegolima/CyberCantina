---
feature: canonical-character-export-and-legacy-field-cleanup
target_version: 0.13.1
document_type: review
status: completed
last_updated: 2026-11-16
---

# Pre-Implementation Architectural Review
## Canonical Character Schema, "Unsupported" Tab & `.zcc` Forward-Compatibility

### Key Invariants & Traps Verified
1. **Read Model vs. Draft Mutator Isolation (`backend/app/schemas/character.py`):**
   - `CharacterRecord` and `CharacterUpdatePayload` previously inherited directly from `CharacterWizardDraft._sanitize_and_sync_fields`, causing cross-field mirroring (`character_bio <-> physical_appearance`) and `modifications` merges on reads and updates alike.
   - Separated `_CharacterFieldsBase` (markup + `unsupported_fields` sanitization only) from `CharacterWizardDraft` (duplicate cleanup) and `CharacterWizardLLMOutput.to_draft()` (LLM promotion of `physical_appearance`/`modifications` into canonical fields).
2. **Startup Backfill Contamination (`backend/app/db/repos/schema_init.py`):**
   - `init_db()` previously ran `WHERE physical_appearance = '' OR initial_message = ''` on every startup, overwriting canonical `physical_appearance = ''` with synthetic fallback text. Gated the legacy backfill strictly on `(character_bio = '' AND physical_appearance = '')` writing to `character_bio` only, and updated `seed.py` to canonical fields.
3. **Copy-on-Write Running Campaign Safety (`backend/app/db/repos/character_versions.py`, `backend/app/engine/context/zone1_static.py`):**
   - Moving legacy fields into `unsupported_fields` occurs only on `.zcc` import or explicit `PUT /api/characters/{id}` save (which CoW-forks when `campaigns_using > 0`), leaving active campaigns pinned to their untouched original rows with legacy fallback intact, while `unsupported_fields` is strictly excluded from Zone 1 prompts.
4. **Export Collision & Untrusted Payload Bounds (`backend/app/services/import_export_service.py`):**
   - Bounded `unsupported_fields` at max 64 keys, 64 KB serialized JSON, and max nesting depth 8; re-emitting `unsupported_fields` onto top-level `characters.json` skips any key colliding with canonical `CharacterRecord` attributes.
