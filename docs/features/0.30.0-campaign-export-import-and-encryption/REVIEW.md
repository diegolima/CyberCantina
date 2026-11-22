---
feature: campaign-export-import-and-encryption
target_version: 0.30.0
document_type: review
status: approved
last_updated: 2026-11-22
---

# Pre-Implementation Review — v0.30.0 Campaign Export/Import & `.zcc` Encryption

## Key Architectural Traps & Mitigations
1. **Atomic `pending_deletion = 1` Insertion**:
   - Background housekeeping (`prune_pending_deletion_worlds`, `prune_pending_deletion_characters`) hard-deletes any `pending_deletion = 1` row unreferenced by a campaign. Base worlds, base characters, `campaigns`, `campaign_characters`, and `character_states` must commit in a single SQLite transaction.
2. **Campaign Picker `"Unknown"` Display for `pending_deletion = 1` Entities**:
   - `HomeEntityPickerModal.tsx` looks up world/character names from active `worlds` / `characters` lists which exclude `pending_deletion = 1`. Adding `world_name`, `character_name`, and `character_portrait_url` on `CampaignRecord` (populated via `LEFT JOIN`) ensures imported campaigns display cleanly.
3. **Active Timeline Pruning Completeness**:
   - Must filter all 7 turn-bound surfaces: `turn_nodes`, `world_state_snapshots`, `character_states`, `persona_turn_states`, `campaign_spatial_overrides`, `episodic_chunks` (`leaf_turn_id`), `vector_entries` (`anchor_turn_id`), improvised map entities (`created_at_turn_id`), and `campaign_characters` (`joined_at_turn_id`).
   - `campaign_character_memories` is keyed by `(campaign_id, character_id)` without `turn_id` and is preserved per included character.
4. **Argon2id DoS & Wrong-Password Retry UX**:
   - Rate-limit `POST /api/import/unlock` per user (`import_unlock_user`) and per staged token (`import_unlock_token`), validate KDF header bounds before invoking Argon2id, retain the staged encrypted file on `401` wrong password so users don't re-upload large files, and never log or persist passphrases.
5. **Security & CodeQL Hygiene**:
   - All staging/export temp paths route through `safe_resolve_staging_file_path`; passwords travel strictly in `POST` JSON bodies (never URL query strings); dynamic error values are sanitized via `sanitize_log_value` and never exposed as raw tracebacks.
