---
feature: campaign-export-import-and-encryption
target_version: 0.30.0
document_type: architecture
status: approved
last_updated: 2026-11-22
---

# Architecture — Running Campaign Export/Import & Password-Protected `.zcc`

## 1. `.zcc` Format v2 Layout
A `.zcc` v2 archive is a standard ZIP container (or a `ZCCENC01` encrypted envelope wrapping that ZIP):
- `manifest.json` (`format_version: 2`, `contents.campaigns_count`, plus existing counts)
- `worlds.json` (base worlds only: `created_at_turn_id IS NULL`, `campaign_id IS NULL`)
- `characters.json` (base characters, including `pending_deletion = 1` CoW snapshots pinned to exported campaigns)
- `personas.json` (referenced persona if still present)
- `campaigns.json` (array of exported campaign bundles)
- `media/...` (stored uncompressed with `ZIP_STORED`)

Each item in `campaigns.json` contains:
- `campaign`: metadata (`id`, `name`, `world_id`, `character_id`, `persona_id`, `persona_snapshot`, `active_leaf_turn_id`, `world_settings`, `created_at`, `timeline_scope`)
- `campaign_characters`: `[{ character_id, joined_at_turn_id, created_at }]`
- `campaign_character_memories`: `[{ character_id, memory_shards, updated_at }]`
- `spatial_deltas`: `{ containers, locations, edges, overrides }` scoped strictly to `exported_turn_ids`
- `lore_deltas`: `{ lore_nodes, location_lore_overrides, container_lore_overrides }`
- `turns`: topologically ordered `turn_nodes` rows (`Turn #0` first)
- `world_state_snapshots`, `character_states`, `persona_turn_states`
- `episodic_chunks`: filtered by `leaf_turn_id IN exported_turn_ids`
- `vector_entries`: campaign-bound vectors (`anchor_turn_id IS NULL OR anchor_turn_id IN exported_turn_ids`) with `embedding_fingerprint` and base64 `embedding_blob`

## 2. `ZCCENC01` Streaming Authenticated Encryption Envelope
Implemented in `backend/app/security/zcc_crypto.py` (leaf `app.security` module with zero internal dependencies):
- **Header (52 bytes)**:
  - `magic` (8B): `b"ZCCENC01"`
  - `time_cost` (u32 BE), `memory_kib` (u32 BE), `parallelism` (u32 BE), `chunk_size` (u32 BE)
  - `salt` (16B CSPRNG), `base_nonce` (12B CSPRNG)
- **Key Derivation**: Argon2id (`argon2-cffi`, 32-byte key; defaults `time_cost=3`, `memory_kib=65536`, `parallelism=2`). Decryption validates header parameters against safe bounds (`1 <= time_cost <= 10`, `8192 <= memory_kib <= 262144`, `1 <= parallelism <= 8`, `4096 <= chunk_size <= 4194304`) before deriving the key.
- **Chunked AEAD Framing**:
  - Each chunk: `plaintext_len` (u32 BE) + `is_final` (u8, `0` or `1`) + `AES-256-GCM(key, chunk_nonce, plaintext, aad)` (`plaintext_len + 16` bytes).
  - `chunk_nonce`: 12 bytes = `base_nonce XOR (chunk_index as 12-byte big-endian)`.
  - `aad`: `header_bytes + chunk_index(u64 BE) + is_final(u8)`.
  - Final chunk (`is_final == 1`) must be followed immediately by EOF; decryption enforces `max_output_bytes` on every chunk.

## 3. Atomic Campaign Commit & Deep ID Remapping
On `POST /api/import/commit`:
1. Pre-render images/videos and enforce media upload permissions and storage quota before opening the SQLite write transaction.
2. Within one SQLite transaction:
   - Insert base world (`pending_deletion = 0` when standalone & not skipped, else `1`) and map `old_world_id`, `old_container_id`, `old_location_id`, `old_edge_id`, `old_lore_id`, `old_media_id`.
   - Insert base characters (`pending_deletion = 0` when standalone & not skipped, else `1`) and map `old_char_id`.
   - Insert standalone persona only when `import_campaign_assets_as_standalone = True` and not skipped; otherwise set `campaigns.persona_id = NULL` and preserve `persona_snapshot_json`.
   - Insert `campaigns` (always `copy` semantics, suffixing `(Imported)` on name collision), `campaign_characters`, `campaign_character_memories`.
   - Insert `turn_nodes` in topological order (`parent_turn_id` before children), mapping every `old_turn_id -> new_turn_id` and remapping `actor_id` (preserving sentinels `__solo__`, `__narrator__`, `__arrival__`) and `recalled_items_json`.
   - Insert improvised `location_containers`, `location_nodes`, `location_edges`, `campaign_spatial_overrides`, campaign `lore_nodes` & lore overrides, `world_state_snapshots` (remapping `active_location_id`, `visited_*_ids_json`, `parties_json`), `character_states` (remapping `current_location_id`, `relationship_notes_json`, item `lore_id`), `persona_turn_states`, `episodic_chunks` (remapping `leaf_turn_id`, `witness_character_ids_json`), and `vector_entries` (reusing `embedding_blob` when `embedding_fingerprint == current_embedding_fingerprint()`, else re-embedding via `embed_text_sync`).
3. On any exception, roll back the SQLite transaction and unlink all newly written media files.
