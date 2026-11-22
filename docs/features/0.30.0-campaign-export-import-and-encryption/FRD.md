---
feature: campaign-export-import-and-encryption
target_version: 0.30.0
document_type: frd
status: completed
last_updated: 2026-11-22
---

# Feature Requirements Document (FRD)
## Running Campaign Export/Import & Password-Protected `.zcc` Archives

**Status:** Completed  
**Target Version:** CyberCantina v0.30.0  
**Depends On:**
- [v0.13.1 Canonical Character Export & Legacy Field Cleanup](file:///home/diegolima/Git/cybercantina/docs/features/0.13.1-canonical-character-export-and-legacy-field-cleanup/FRD.md)
- [v0.28.0 Timeline Branching, Story Modal & Interactive Branch Graph](file:///home/diegolima/Git/cybercantina/docs/features/0.28.0-timeline-branching-and-story-modal/FRD.md)
- [v0.29.0 Turn Bookmarks, Personal Notes & Clerk Single-Turn Summarization](file:///home/diegolima/Git/cybercantina/docs/features/0.29.0-turn-bookmarks-and-notes/FRD.md)

**Scope:**
- `.zcc` Archive Format & Schemas ([`import_export.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/import_export.py))
- Export/Import Packaging, Branch Pruning, ID Remapping & Encryption Envelope ([`import_export_service.py`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py))
- Export/Import API Endpoints & Rate Limiting ([`import_export.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/import_export.py), [`rate_limit.py`](file:///home/diegolima/Git/cybercantina/backend/app/security/rate_limit.py))
- Campaign, World, Character, Turn & Vector Persistence ([`schema.sql`](file:///home/diegolima/Git/cybercantina/backend/app/db/schema.sql), [`campaigns.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/campaigns.py), [`turns.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/turns.py))
- Frontend API Client, Export UI & Import Unlock/Preview Flow ([`importExport.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/api/importExport.ts), [`ExportBundleModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ExportBundleModal.tsx), [`ImportPreviewModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ImportPreviewModal.tsx), [`importExportLogic.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/utils/importExportLogic.ts))
- User-Facing Wiki Documentation (`../cybercantina-wiki`)

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
Today, CyberCantina’s `.zcc` archive format (`format_version: 1`) only packages static library entities (`characters`, `worlds`, `personas`, and their media). Users have no way to:
1. Back up, migrate across servers, or share an **in-progress campaign** along with its narrative history, branching timelines, swipes, episodic summaries, CARE affective trajectories, and memories.
2. Share or archive sensitive/private `.zcc` bundles with **password protection** so archive contents (including file listings and metadata) remain confidential at rest and in transit.

### 1.2 Proposed Solution
Extend `.zcc` (`format_version: 2`) to support **Running Campaign Export/Import** and **Optional Password-Protected Archive Encryption** across all `.zcc` exports:
1. **Self-Contained Running Campaign Packages:** Export a running campaign alongside its base world, participating characters (including CoW `pending_deletion` snapshots pinned to the campaign), persona state, and all campaign runtime state (turns, swipes, branches, bookmarks, episodic summaries, CARE states, memories, spatial/lore overrides, and media).
2. **Timeline Scope Selection on Export:** Let users choose between **Full Timelines** (all branches and unfollowed swipes) or **Active Timeline Only** (strict linear chain from Turn #0 to `active_leaf_turn_id`), plus an opt-in option (disabled by default) to strip player-added bookmark comments (`user_note`) while preserving `is_bookmarked` pins.
3. **Library Isolation by Default on Import:** Campaign imports always use **`copy` semantics** (creating a new campaign instance without overwriting existing campaigns). By default, the campaign’s base world and characters are imported in a `pending_deletion = 1` state and the persona stays snapshot-only (`persona_id = NULL` via `persona_snapshot_json`), with an opt-in toggle (disabled by default) to also import them as standalone library items.
4. **Universal Password-Protected `.zcc` Envelope:** Support optional Argon2id + chunked AEAD (`AES-256-GCM` or `ChaCha20-Poly1305`) encryption for any `.zcc` export (campaigns, bundles, worlds, characters) via existing backend dependencies (`argon2-cffi`, `cryptography`), backed by a two-step unlock flow in `/api/import/inspect`.

---

## 2. Scope, Boundaries & Core Invariants

1. **Backwards Compatibility (`format_version: 1`):**
   - Existing `format_version: 1` `.zcc` archives and SillyTavern `.png`/`.json` imports must continue to inspect and import identically.
2. **Deferred Future Scope — "Export Evolved World State":**
   - Exporting a campaign’s *current/evolved* world and characters as a fresh Turn-0 standalone scenario template (e.g., baking mid-campaign character locations, relationship changes, and world consequences into a sequel world) is **explicitly out of scope** for this feature.
   - The standalone import option strictly concerns the campaign’s **base** world, characters, and persona.
3. **Campaign-Scoped `pending_deletion = 1` & Re-Export Invariant:**
   - When standalone import is **not** selected, imported base world and character rows must be created with `pending_deletion = 1` in the **same atomic SQLite transaction** as the `campaigns`, `campaign_characters`, and `character_states` rows so background `prune_pending_deletion_*` sweeps cannot prematurely delete them.
   - Because `personas` has no `pending_deletion` column in [`schema.sql`](file:///home/diegolima/Git/cybercantina/backend/app/db/schema.sql#L240-L265), when standalone import is **not** selected, no standalone `personas` row is created; the imported campaign binds `persona_id = NULL` and runs from `persona_snapshot_json`.
   - Deleting that imported campaign later automatically allows `prune_pending_deletion_worlds` and `prune_pending_deletion_characters` to garbage-collect those unreferenced base entities and their media.
   - **Re-export allowed:** A running campaign backed by `pending_deletion = 1` base world/characters must remain **re-exportable** as a running campaign (while remaining blocked from starting *new* campaigns or standalone world/character exports).
4. **Copy-Only Campaign Import Semantics:**
   - Campaign imports always create a new campaign record with freshly remapped IDs (`copy` semantics) and never overwrite an existing running campaign in-place.
5. **Zero-Dangling-Reference & Complete ID Remapping Invariant:**
   - Importing a campaign must deterministically remap every primary and foreign ID (`world_id`, `character_id`, `persona_id`, `campaign_id`, `turn_id`, `location_id`, `container_id`, `edge_id`, `lore_id`, `media_id`, `chunk_id`) across both relational columns and nested JSON payloads (`actor_id` when not `__solo__`/`__narrator__`/`__arrival__`, `parties_json`, `visited_location_ids_json`, `visited_container_ids_json`, `witness_character_ids_json`, `recalled_items_json`, `relationship_notes_json`, `equipped_json`/`inventory_json` `lore_id`, `campaign_character_memories`, `campaign_spatial_overrides`).
6. **Zero-Leakage Timeline Pruning Invariant:**
   - When exporting **Active Timeline Only**, no turns, swipes, `episodic_chunks`, `vector_entries`, improvised `created_at_turn_id` map entities, or `joined_at_turn_id` characters outside the `active_leaf_turn_id -> Turn #0` lineage may be included in the archive.
7. **Cryptography & Confidentiality Invariant:**
   - Password protection applies uniformly at the `.zcc` envelope layer for **all** `.zcc` exports (campaigns, bundles, worlds, characters).
   - Encryption must **never** use legacy `ZipCrypto` or unencrypted-central-directory ZIP encryption. The entire payload (entity JSONs, turn history, media, and manifest details) must be authenticated and encrypted.
   - Passphrases must never be logged, written to disk, or stored in `StagedImport` / SQLite.

---

## 3. Functional Requirements

### FR-1: Campaign Export (`POST /api/export/campaign/{campaign_id}` & Export UI)

#### 1.1 Export Options
Users can initiate export from a running campaign (or campaign list / export UI) with the following options:
1. **Timeline Scope** (`timeline_scope: Literal["active", "full"]`, default `"full"`):
   - **`full`**: Exports the entire campaign turn DAG, including alternative branches and unfollowed sibling swipes.
   - **`active`**: Walks `campaigns.active_leaf_turn_id` via `parent_turn_id` up to Turn #0 (`active_turn_ids`) and exports only turns in that linear chain.
2. **Strip Player Bookmark Comments** (`strip_bookmark_comments: bool = False`):
   - Disabled by default.
   - When enabled, clears `turn_nodes.user_note` (`None`) on exported turns while **preserving `is_bookmarked`** flags so structural bookmark pins remain intact. `telemetry_json` and `whispers_json` remain preserved and are not altered by this toggle.
3. **Media & Video Options** (aligned with existing `.zcc` export controls):
   - `include_world_media: bool = True`
   - `include_videos: bool = False` (plus optional `selected_video_ids`)
4. **Password Protection** (`password: str | None = None`):
   - Optional user-supplied passphrase to encrypt the resulting `.zcc` archive (also exposed across standard bundle/character/world `.zcc` exports).

#### 1.2 Exported Campaign Payload & Partitioning
A campaign export bundle (`format_version: 2`) packages:
1. **Base World (`worlds.json`)**:
   - The campaign’s referenced `world_id` (loaded even when `pending_deletion = 1` due to CoW edits or prior campaign-only import).
   - **Strict isolation**: Base `worlds.json` includes only base world topology/lore (`created_at_turn_id IS NULL`, `campaign_id IS NULL`). Improvised map/lore data from *other* campaigns on the same world must **never** leak into the export.
2. **Base Characters (`characters.json`)**:
   - Primary `campaigns.character_id` plus every character in `campaign_characters` (allowing `pending_deletion = 1` CoW/campaign-only snapshots).
   - In **`active`** timeline mode, characters whose `campaign_characters.joined_at_turn_id` is non-null and **not** in `active_turn_ids` are excluded from `characters.json` and `campaign_characters`.
3. **Persona (`personas.json` + `persona_snapshot_json`)**:
   - Export `campaigns.persona_snapshot_json` on the campaign record, and include the referenced `personas` record in `personas.json` when `campaigns.persona_id` exists (including persona avatar/media).
4. **Campaign Runtime State (`campaigns.json`)**:
   - Campaign metadata: `name`, `world_id`, `character_id`, `persona_id`, `persona_snapshot_json`, `active_leaf_turn_id`, `world_settings_json`, `created_at`, plus optional non-secret `prompt_preset` reference/snapshot (gracefully falling back to `NULL` if missing on target).
   - `campaign_characters` rows (including `joined_at_turn_id`).
   - `campaign_character_memories` rows (`memory_shards_json`).
   - Campaign-scoped spatial deltas filtered to exported turn IDs:
     - Improvised `location_containers`, `location_nodes`, `location_edges` (`created_at_turn_id IN exported_turn_ids`, preserving `superseded_at_turn_id` when in `exported_turn_ids`),
     - `campaign_spatial_overrides` (`turn_id IN exported_turn_ids`),
     - Campaign-scoped `lore_nodes` (`campaign_id = campaign.id`), `campaign_location_lore_overrides`, `campaign_container_lore_overrides`.
   - Turn tree & per-turn snapshots (`turn_id IN exported_turn_ids`):
     - `turn_nodes` (`id`, `parent_turn_id`, `depth_index`, `user_message`, `actor_id`, `raw_prose`, `cognition_json`, `cognitions_json`, `whispers_json`, `pre_turn_json`, `post_turn_json`, `recalled_items_json`, `telemetry_json`, `is_bookmarked`, `user_note`, `created_at`),
     - `world_state_snapshots` (`world_timestamp`, `active_location_id`, `scene_flags_json`, `campaign_elapsed_minutes`, `visited_location_ids_json`, `visited_container_ids_json`, `parties_json`),
     - `character_states` (all CARE/affective, mood, want/plan, relationship notes, unlocked persona keys/provenance, location, equipped/inventory fields),
     - `persona_turn_states` (`equipped_json`, `inventory_json`).
   - Summaries & Memory vectors:
     - `episodic_chunks` (`leaf_turn_id IN exported_turn_ids`),
     - `vector_entries` scoped to the campaign and its exported base world/characters (`anchor_turn_id IS NULL OR anchor_turn_id IN exported_turn_ids`), exporting text/metadata, `embedding_fingerprint`, and `embedding_blob` for cross-server portability with fast-path reuse.

---

### FR-2: Campaign Import, Library Isolation & Re-Indexing

#### 2.1 Inspect (`POST /api/import/inspect`)
- Extend `ZccManifestContents` and `ImportInspectResponse` to report `campaigns_count` and campaign summaries (campaign name, turn/branch counts, base world & cast names, timeline mode `"active"` vs `"full"`).
- Conflict detection checks library conflicts when standalone import may be enabled; if standalone import remains disabled on commit, name collisions with existing standalone library entities do **not** block or alter the campaign’s `pending_deletion = 1` entities (the imported campaign itself always creates a new copy, optionally suffixing `(Imported)` on campaign name collision).

#### 2.2 Standalone vs. Campaign-Private Import Toggle (`ImportPreviewModal.tsx` & `ImportCommitRequest`)
- Add `import_campaign_assets_as_standalone: bool = False` (disabled by default) to `ImportCommitRequest` and render it clearly in `ImportPreviewModal.tsx` whenever the inspected `.zcc` contains a campaign:
  - **Label / Copy:** *"Import base world, characters & persona as standalone library items"* (default **OFF**), with helper text explaining that when unchecked, the world and characters remain private to this campaign (`pending_deletion = 1`) and are automatically cleaned up if the campaign is deleted, and the persona runs from its campaign snapshot without being added to the Persona library.
  - **Unchecked (`False`, default):**
    - Insert the campaign’s base world and base characters with `pending_deletion = 1` in the same atomic transaction as the campaign rows.
    - Do not insert a standalone `personas` row; store `campaigns.persona_id = NULL` and retain `persona_snapshot_json` (plus `persona_turn_states`).
    - Hide library conflict strategy selectors for campaign-private entities since they will not enter the standalone catalog.
  - **Checked (`True`):**
    - Insert the campaign’s base world, base characters (`pending_deletion = 0`), and persona (when present) into the user’s libraries respecting the existing conflict strategies (`copy` / `overwrite` / `skip`—note: if `skip` or `overwrite` is chosen for a base entity, the campaign either binds to the selected existing library entity or uses a `pending_deletion = 1` copy if schemas diverge; exact binding behavior to be specified in `ARCHITECTURE.md`).

#### 2.3 Transactional Commit, Media Quota & Embedding Portability
- Enforce user media upload permissions (`allow_image_uploads`, `allow_video_uploads`) and storage quotas across all imported character, world, and persona media before committing (clearly reflecting total media size even when standalone import is unchecked).
- **Atomic SQLite commit**: Insert base world, base characters, persona (if standalone), campaign, `campaign_characters`, `campaign_character_memories`, campaign spatial/lore deltas, turn tree (`turn_nodes` ordered topologically from root to leaves so `parent_turn_id` FKs succeed), snapshots, `character_states`, `persona_turn_states`, `episodic_chunks`, and `vector_entries` in a single transaction, rolling back staged media files on failure.
- **Embedding Fingerprint Check**: Compare each imported `vector_entries.embedding_fingerprint` against `current_embedding_fingerprint()`:
  - When equal and `embedding_blob` is valid, reuse `embedding_blob` directly.
  - When missing or mismatched, re-embed via the target server’s active embedding provider so hybrid RAG memory remains accurate across instances.

---

### FR-3: Password-Protected `.zcc` Encryption & Unlock Flow

#### 3.1 Cryptographic Envelope (Universal Across All `.zcc` Exports)
- Implement a dedicated `.zcc` encrypted envelope (e.g., binary magic header `ZCCENC01` or an outer container with stub `manifest.json` `{"encrypted": true, "format_version": 2, "kdf": "argon2id", "cipher": "aes-256-gcm"}` + encrypted payload stream) using `argon2-cffi` and `cryptography`.
- Support optional `password` on **all** `.zcc` export entrypoints (`POST /api/export/campaign/{campaign_id}`, `POST /api/export/bundle`, `GET /api/export/character/{character_id}` / `POST`, `GET /api/export/world/{world_id}` / `POST` — ensuring passwords are never sent in URL query strings, using `POST` or request bodies/headers whenever a password is supplied).
- **Key Derivation**: Argon2id with a fresh 16-byte cryptographic random salt per export and bounded memory/time cost parameters (stored in the unencrypted header) tuned to resist brute force without exhausting server memory under concurrent requests.
- **Streaming/Chunked AEAD**: Encrypt the inner `.zcc` ZIP stream in fixed-size chunks (e.g., 256 KB) using AES-256-GCM (or ChaCha20-Poly1305) with unique per-chunk nonces and AAD binding `(header_bytes, chunk_index, is_final)` to prevent chunk reordering, splicing, or truncation while keeping server RAM usage bounded for large video-bearing exports.

#### 3.2 Two-Step Inspect & Unlock Flow
1. `POST /api/import/inspect`:
   - If the uploaded `.zcc` carries the encrypted envelope, stage it on disk as usual and return `ImportInspectResponse` with `requires_password: true` (and `staged_token`, `is_native: true`, `format_type: "zcc"`), **without** attempting decryption or exposing inner entity names.
2. `POST /api/import/unlock`:
   - Accepts `{ staged_token, password }`.
   - Enforces per-user / per-token sliding-window rate limiting ([`rate_limit.py`](file:///home/diegolima/Git/cybercantina/backend/app/security/rate_limit.py)) before running Argon2id.
   - Streams decryption to a bounded temporary staging file on disk (enforcing `MAX_TOTAL_UNCOMPRESSED_BYTES` / upload size ceilings), validates AEAD tags, and inspects the decrypted inner `.zcc` archive.
   - **Wrong password:** Returns HTTP `401` / `400` with a clear `"Incorrect password"` message while **retaining** the encrypted staged file (until TTL or rate limit) so the user can retry without re-uploading a large archive.
   - **Security hygiene:** Never log `password`, never send `password` in URL query parameters, never store `password` in `StagedImport`, and unlink decrypted temporary staging files deterministically on expiry/eviction/commit.

---

### FR-4: Archive Limits & Scale Guardrails
- Store campaign turn trees and state snapshots in consolidated JSON/JSONL archive members (e.g., `campaigns.json`) rather than per-turn files so long campaigns do not hit `MAX_ZIP_ENTRIES = 500`.
- Keep current upload and ZIP safety ceilings (`DEFAULT_MAX_IMPORT_UPLOAD_MB = 100`, `MAX_ZIP_ENTRIES = 500`, `MAX_TOTAL_UNCOMPRESSED_BYTES = 1 GB`, `MAX_STAGED_DISK_BYTES_GLOBAL = 256 MB` in [`import_export_service.py`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py)) as the initial baseline, to be fine-tuned during testing if real-world campaign sizes warrant adjustment.

---

## 4. Acceptance Criteria
- [ ] Exporting a running campaign in `full` mode and importing it on a clean account/instance restores identical turn tree, active leaf, all sibling swipes, bookmarks, episodic summaries, CARE states, memories, spatial overrides, and base world/character/persona media.
- [ ] Exporting in `active` mode excludes all unfollowed swipes, alternate branches, branch-only `episodic_chunks`, branch-only `vector_entries`, branch-only `created_at_turn_id` map changes, and branch-only `joined_at_turn_id` characters.
- [ ] Enabling `strip_bookmark_comments` clears `user_note` while keeping `is_bookmarked` intact; disabled by default preserves all notes. `telemetry_json` and `whispers_json` remain preserved.
- [ ] Campaign imports always create a new campaign copy (`copy` semantics) and never overwrite existing running campaigns.
- [ ] Importing with standalone disabled (default) creates base world & characters as `pending_deletion = 1` atomically with the campaign and keeps the persona snapshot-only (`persona_id = NULL`); the campaign remains re-exportable, and deleting it prunes its `pending_deletion = 1` entities and media.
- [ ] Importing with standalone enabled (`True`) adds the base world, characters (`pending_deletion = 0`), and persona to the user's libraries.
- [ ] Vector embeddings reuse `embedding_blob` when `embedding_fingerprint` matches and automatically re-embed on mismatch.
- [ ] Password-protected `.zcc` archives work across all `.zcc` export types, reveal no inner filenames or entity metadata prior to unlock, resist wrong-password retries via rate limiting without requiring re-upload, reject tampered ciphertexts, and never pass passwords in URL query strings.
