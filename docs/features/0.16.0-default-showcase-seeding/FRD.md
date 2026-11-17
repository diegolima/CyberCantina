---
feature: default-showcase-seeding
target_version: 0.16.0
document_type: frd
status: draft
last_updated: 2026-11-17
---

# Feature Requirements Document (FRD)
## Default Showcase Seeding (*The Green Lie* & *Kira Vance*), Public Media Sharing & Profile Restore

**Status:** Draft  
**Target Version:** CyberCantina v0.16.0  
**Depends On:** `0.15.0-world-media-files`, `0.14.0-worlds-and-personas-unsupported-fields`, `0.13.1-canonical-character-export-and-legacy-field-cleanup`, `0.11.0-server-config-chloromancer`  
**Scope:**
- Bundled Showcase Asset & Seeder ([`seed.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/seed.py), [`main.py`](file:///home/diegolima/Git/cybercantina/backend/app/main.py))
- Database Schema & Repositories ([`schema.sql`](file:///home/diegolima/Git/cybercantina/backend/app/db/schema.sql), [`schema_init.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/schema_init.py), [`base.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/base.py), [`worlds.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/worlds.py), [`characters.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/characters.py), [`character_versions.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/character_versions.py), [`auth_users.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/auth_users.py))
- Auth, Media Serving, Quotas, Housekeeping & `.zcc` Import/Export ([`auth.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/auth.py), [`characters.py` router](file:///home/diegolima/Git/cybercantina/backend/app/routers/characters.py), [`worlds.py` router](file:///home/diegolima/Git/cybercantina/backend/app/routers/worlds.py), [`dependencies.py`](file:///home/diegolima/Git/cybercantina/backend/app/dependencies.py), [`media_path.py`](file:///home/diegolima/Git/cybercantina/backend/app/security/media_path.py), [`purge_inactive.py`](file:///home/diegolima/Git/cybercantina/backend/app/housekeeping/purge_inactive.py), [`import_export_service.py`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py))
- Frontend Profile Restore UX, World/Character Media CoW Sync & Types ([`auth.ts` API](file:///home/diegolima/Git/cybercantina/frontend/src/api/auth.ts), [`auth.ts` types](file:///home/diegolima/Git/cybercantina/frontend/src/types/auth.ts), [`world.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/world.ts), [`ProfileAccountTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/ProfileAccountTab.tsx), [`ProfileModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/ProfileModal.tsx), [`WorldMediaTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldMediaTab.tsx), [`CharacterInspectorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/character/CharacterInspectorModal.tsx), [`App.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/App.tsx))
- Automated Tests (`backend/tests/`, `frontend/src/`)

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
1. **Outdated Single-Tenant Showcase Seed:**
   - [`ensure_default_seed`](file:///home/diegolima/Git/cybercantina/backend/app/db/seed.py#L22-L367) currently seeds a minimal 5-location world (*Sector 9: The Neon Rust Undercity*), a simplified *Kira Vance*, and a pre-created campaign (`camp_neon_rust_default`) **only** when the database is completely empty.
   - Newly registered or admin-created users receive **no** starter world or character, and the current seed does not showcase nested containers (`depth` 4 → 3 → 1), world/location/container media, location `starting_message`, `secret` lore gating, `artifact`/`permanent` items, or `paranoiac` CARE temperament.
2. **Pre-Started Default Campaign Hides Start-Focus Choices:**
   - Auto-creating a default campaign skips letting new users experience choosing between world-focused and character-focused campaign creation.
3. **Per-User Media Duplication, Quota Penalty & Cross-Tenant Leaks:**
   - Currently, character media lives in per-character folders (`media/characters/{char_id}/...`), is billed to [`get_user_media_usage_bytes`](file:///home/diegolima/Git/cybercantina/backend/app/dependencies.py#L406-L412), and is duplicated on CoW forks ([`_copy_character_media`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/base.py#L372-L385)). Naively cloning *The Green Lie* (~1.69 MB of world images) and *Kira Vance* (~0.67 MB of character images) per user would duplicate ~2.36 MB per account and immediately consume user storage quotas.
   - Conversely, sharing `world_media` rows or disk files without strict tenant isolation would let one user's portrait/gallery/world-media deletion, label edit, or Chloromancer cleanup break other users, or let [`get_world_media_usage_summary`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/worlds.py#L1671-L1703) and [`get_world_delete_impact`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/worlds.py#L1705-L1737) count other users' campaigns across shared `media_id`s.
4. **No Recovery Path After Deletion & No Base-Version Upgrade Path:**
   - Users who delete the default showcase world or character have no self-service way to restore them from their Profile, and future CyberCantina releases need a safe strategy to update base showcase assets without breaking user-edited copies or active campaigns.

### 1.2 Proposed Solution
1. **Promote *The Green Lie* & *Kira Vance* as the Canonical Showcase Bundle (Without a Default Campaign):**
   - Bundle *The Green Lie* world (`35` locations, `88` edges, `13` containers across depths `4 → 3 → 1`, `14` global lore nodes + `5` location/container-scoped lore nodes, `3` WebP world images) and *Kira Vance* character (`8` memory shards, `paranoiac` temperament, `permanent` + `artifact` items, portrait + gallery WebP) as versioned static showcase seed assets (`seed_version = 1`).
   - Intentionally preserve `low_token_initial_message` on *Kira Vance* as an active test of `unsupported_fields` ingestion, read-only Unsupported tab rendering, and exclusion from roleplay LLM prompts.
   - **Do not** seed a default campaign so players can freely explore World-focused vs. Character-focused campaign starts (a deliberate choice that may be revisited later based on user feedback).
2. **Per-User DB Clones Sharing Public Media:**
   - On every new user creation via the account-creation layer (`initial_setup`, `register_user`, `admin_create_user`), clone private DB rows (`owner_id = user.id`) for *The Green Lie* and *Kira Vance* pointing at shared, immutable public media files.
   - Users can edit, CoW-fork, or delete their own cloned world/character normally without affecting any other user or modifying/deleting shared public media files.
   - Only user-uploaded/added media files are private and count toward [`get_user_media_usage_bytes`](file:///home/diegolima/Git/cybercantina/backend/app/dependencies.py#L406-L412).
3. **Profile Page Non-Destructive Restore:**
   - Add a **"Restore Default World & Character"** control in [`ProfileAccountTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/ProfileAccountTab.tsx) that restores whichever of *The Green Lie* or *Kira Vance* is missing (deleted) and displays an informational message if one or both already exist (including edited versions).
4. **Test Isolation & Legacy Test Seed Retention (with Review TODO):**
   - Keep the compact *Midnight at the Neon Rust* scenario available strictly as an internal test-only helper (never exposed to users or production startup) so existing engine/spatial/branch tests remain fast and deterministic, while adding comprehensive tests for the new seeding, media-sharing, quota, CoW, restore, and showcase field contracts.

---

## 2. Scope, Boundaries & Core Invariants

1. **Zero-Campaign Default Experience:**
   - Seeding creates **only** the user's private *The Green Lie* world and *Kira Vance* character (linked via `world_id` and `Encrypted burner slate`'s `lore_id`), **not** a pre-created campaign.
2. **Public Media Immutability, Tenant Isolation & Quota Exemption:**
   - Public seeded media files on disk are **read-only** to user actions: user edits, portrait/gallery removals, world media unlinks/renames, CoW forks, character/world deletions, `reset_user_data`, `delete_user`, and Chloromancer orphan sweeps must **never** delete, overwrite, or globally mutate shared public media files or shared `world_media` rows.
   - Public media files must **never** count toward `media_bytes_used` or `compute_purge_preview`.
   - Any **new** media uploaded by a user onto a seeded (or CoW-forked) world/character is private, stored under the user/entity's private media namespace, and counted toward quota normally.
   - Impact summaries (`get_world_media_usage_summary`, `get_world_delete_impact`) must **never** count campaigns owned by other users.
3. **Non-Destructive Profile Restore:**
   - Restoring defaults **only** creates an asset when the user has no active (`pending_deletion = 0`) copy of that seeded asset (`seed_key`). User-edited copies count as existing and must **never** be overwritten or duplicated.
4. **Expected `unsupported_fields` Coverage:**
   - `Kira Vance`'s `low_token_initial_message` field must remain preserved in `unsupported_fields_json` on seeded rows and round-trip cleanly through edits, CoW forks, and `.zcc` exports for upcoming feature testing.
5. **Fast, Offline-Safe Seeding:**
   - Seeding a new user or restoring defaults must not block on external LLM/embedding network calls when precomputed seed embeddings or `local_hash` embeddings apply.
6. **Repository Test Boundary:**
   - `CantinaRepository.create_user(...)` must remain free of implicit showcase seeding (with seeding invoked at account-creation endpoints or via an explicit helper/opt-in flag) so existing repository-level unit tests creating bare test users remain unaffected.
7. **Module & Security Boundaries:**
   - All public and private media paths must be validated through [`media_path.py`](file:///home/diegolima/Git/cybercantina/backend/app/security/media_path.py) (`os.path.normpath` + `os.path.realpath` confinement).
   - Dynamic IDs/filenames in logs must pass through [`log_sanitize.py`](file:///home/diegolima/Git/cybercantina/backend/app/security/log_sanitize.py).
   - Backend must pass `ruff check`, `tach check`, and `pytest`; frontend must pass `arch:check`, `build`, and `test`; architecture docs must pass `generate_arch_docs.py --check`.

---

## 3. Functional Requirements

### FR-1: Showcase Asset Bundling & Seed Provenance Schema

- **Bundled Showcase Source:**
  - Package the canonical *The Green Lie* world JSON, *Kira Vance* character JSON, and the 5 `.webp` media files inside the backend package (e.g., `backend/app/db/showcase_data/the_green_lie/`) so runtime seeding has zero dependency on external paths.
  - Preserve `low_token_initial_message` inside *Kira Vance*'s seeded payload so it lands in `unsupported_fields_json` (`unsupported_fields = {"low_token_initial_message": ...}`) upon creation.
  - Ensure all 35 locations, 88 edges, 13 containers (`depth` 4 → 3 → 1), 14 global lore nodes, 5 location/container-scoped lore nodes, `Main Floor.starting_message`, `image_media_id` references, `baseline_psyche` (`paranoiac` archetype), `equipped`/`inventory` (`Subdermal shard` `permanent`, `Encrypted burner slate` `artifact` → `The Sovereign Cipher`), `voice_anchors`, `memory_shards`, `portraits`, `gallery`, and `creator_notes` are faithfully seeded per user with fresh per-user entity IDs (while preserving intra-bundle cross-references such as `character.world_id`, `item.lore_id`, `container.parent_container_id`, `location.container_id`, `edge.*_location_id`, and `image_media_id`).
- **Provenance Tracking Columns ([`schema.sql`](file:///home/diegolima/Git/cybercantina/backend/app/db/schema.sql), [`schema_init.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/schema_init.py)):**
  - Add additive columns to `worlds` and `characters` (with idempotent `ALTER TABLE` migrations in `schema_init.py`):
    - `seed_key TEXT NULL` (e.g., `"showcase:the_green_lie"`, `"showcase:kira_vance"`)
    - `seed_version INTEGER NULL` (e.g., `1`)
    - `seed_modified INTEGER NOT NULL DEFAULT 0` (set to `1` whenever the user edits the entity, mutates its media, or restores an edited version)
  - Add indexes on `worlds(owner_id, seed_key, pending_deletion)` and `characters(owner_id, seed_key, pending_deletion)` for fast existence checks during restore and future base-version upgrades.
  - Extend `world_media` and `world_media_links`:
    - On `world_media`: add `is_public INTEGER NOT NULL DEFAULT 0` and `seed_key TEXT NULL` so public world media rows (`owner_id IS NULL AND is_public = 1`) are explicitly distinguished from user-owned private `world_media` rows.
    - On `world_media_links`: add `label_override TEXT NULL` so a user renaming a public world image label modifies only their own world's link row without mutating the shared `world_media.label` seen by other users.
    - Expose `is_public: bool = False` on `WorldMediaItem` ([`world.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/world.py), [`world.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/world.ts)).

### FR-2: Per-User Seeding Lifecycle (Admin, Self-Registration & Admin-Created Users)

- **Account Creation Seeding (`seed_showcase_for_user` in [`seed.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/seed.py), called from [`auth.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/auth.py)):**
  - Seed *The Green Lie* and *Kira Vance* for the newly created user in all three account creation endpoints:
    1. `POST /api/auth/setup` ([`initial_setup`](file:///home/diegolima/Git/cybercantina/backend/app/routers/auth.py#L84-L124)) — admin account (both passworded and blank-password single-user mode).
    2. `POST /api/auth/register` ([`register_user`](file:///home/diegolima/Git/cybercantina/backend/app/routers/auth.py#L156-L196)) — self-registered standard user.
    3. `POST /api/admin/users` ([`admin_create_user`](file:///home/diegolima/Git/cybercantina/backend/app/routers/auth.py#L514-L541)) — admin-created user (whether `role="user"` or `role="admin"`).
  - `seed_showcase_for_user(repo, user_id)` must idempotently ensure the public media files and `is_public = 1` `world_media` rows exist on disk/DB before cloning user rows, so seeding succeeds even in isolated tests or `TestClient` instances where FastAPI `lifespan` did not run.
- **Startup & Reset Behavior ([`main.py`](file:///home/diegolima/Git/cybercantina/backend/app/main.py#L109-L118), [`auth_users.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/auth_users.py#L299-L374)):**
  - On application startup (`lifespan`), materialize the shared public media files and `is_public = 1` `world_media` rows on disk/DB, without creating unowned showcase worlds/characters when `users` is empty (initial admin setup seeds them when the admin is created).
  - For existing pre-v0.16.0 databases that already contain users, startup must remain non-destructive (do not wipe, alter, or unexpectedly inject assets into existing users' catalogs unless explicitly requested via Profile Restore).
  - `POST /api/profile/reset-data` ([`reset_user_data`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/auth_users.py#L299-L374)) continues wiping all user-owned worlds, characters, and campaigns **without** auto-re-seeding defaults (leaving the account cleanly empty, with Profile Restore available if the user wants defaults back) and **without** deleting public media.
- **Zero-Campaign Policy:**
  - Production showcase seeding **must not** create any row in `campaigns` for the new user.

### FR-3: Public / Shared Media Storage, Access Control, Quotas & Mutation Safety

- **Public Media Storage Layout & Serving ([`media_path.py`](file:///home/diegolima/Git/cybercantina/backend/app/security/media_path.py), [`worlds.py` router](file:///home/diegolima/Git/cybercantina/backend/app/routers/worlds.py), [`characters.py` router](file:///home/diegolima/Git/cybercantina/backend/app/routers/characters.py)):**
  - **Public character media:** Store files under `{media_dir}/public/v{N}/characters/{seed_slug}/{category}/{filename}` and serve via `GET /api/media/public/v{version}/characters/{seed_slug}/{category}/{filename}` to any authenticated user (`get_current_user`) through strict `media_path.py` confinement (`Cache-Control: private, max-age=86400`).
    - Seeded *Kira Vance* rows reference `/api/media/public/v1/characters/kira_vance/portraits/default_0b97fa1a.webp` and `/api/media/public/v1/characters/kira_vance/gallery/img_59a7be04b1.webp`.
  - **Public world media:** Store files inside the standard world media directory `{media_dir}/worlds/images/pub_v{N}_{media_id}.webp` (e.g., `pub_v1_wmed_28416ce9b1.webp`) backed by deterministic `world_media` rows with `owner_id = NULL, is_public = 1, seed_key = "showcase:the_green_lie"`.
    - Keeping public world media under `{media_dir}/worlds/images/` with `is_public = 1` preserves full compatibility with [`build_world_media_url`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/base.py#L40-L42) (`/api/media/worlds/images/...`), [`get_world_media`](file:///home/diegolima/Git/cybercantina/backend/app/routers/worlds.py#L219-L239), [`_world_media_file_exists`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/base.py#L400-L408), [`_stage_world_media_for_export`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py#L215-L236), and [`_sweep_orphan_media_dirs`](file:///home/diegolima/Git/cybercantina/backend/app/housekeeping/purge_inactive.py#L152-L175) (because `list_active_world_media_filenames` queries all `world_media` rows, keeping `is_public = 1` rows alive).
    - Update [`user_can_access_world_media`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/worlds.py#L1512-L1546) to permit read access when `wm.is_public = 1` (alongside existing owner/campaign checks).
- **Quota Exclusion ([`dependencies.py`](file:///home/diegolima/Git/cybercantina/backend/app/dependencies.py#L393-L429)):**
  - [`get_user_media_usage_bytes`](file:///home/diegolima/Git/cybercantina/backend/app/dependencies.py#L406-L412) must return **`0` bytes** for a freshly seeded user:
    - Public character media URLs (`/api/media/public/...`) live outside `media/characters/{user_char_id}/` and are never summed.
    - Public world media rows have `owner_id IS NULL` and `is_public = 1`, so `list_user_world_media_files(user_id)` (`WHERE owner_id = ? AND is_public = 0`) excludes them.
  - When a user uploads a **new** portrait, gallery image, or world image onto their seeded (or CoW-forked) *Kira Vance* / *The Green Lie*, the new file is written to the user's private directory (`media/characters/{char_id}/...` or `world_media` with `owner_id = user.id, is_public = 0`) and **only** those new private files count toward quota and `compute_purge_preview`.
  - When a user replaces a public portrait slot (`/api/media/public/...`) with an uploaded image, `replacing_path` in [`upload_character_portrait`](file:///home/diegolima/Git/cybercantina/backend/app/routers/characters.py#L500-L516) must be `None` so the full byte size of the new private upload is checked against quota.
- **Safe User Edits, Removals, CoW Forks & Cross-Tenant Isolation:**
  - **Character updates & CoW forks ([`character_versions.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/character_versions.py), [`base.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/base.py), [`characters.py` router](file:///home/diegolima/Git/cybercantina/backend/app/routers/characters.py)):**
    - `_reconcile_media_url` / `_copy_character_media` must **preserve** `/api/media/public/...` URLs verbatim without copying public files into `media/characters/{target_char_id}/`.
    - `upload_character_portrait`, `delete_character_portrait`, `upload_character_gallery_image`, and `delete_character_gallery_image` **must never** unlink `/api/media/public/...` files on disk—they only update `portraits_json` / `gallery_json` and set `seed_modified = 1`.
    - When `campaigns_using > 0` for `character_id`, portrait/gallery upload & delete mutations must CoW-fork `character_id` → `new_char_id` before modifying `portraits_json` / `gallery_json` (and sync `activeCharId` in [`CharacterInspectorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/character/CharacterInspectorModal.tsx), matching `WorldInspectorModal` CoW sync) so running campaigns keep their frozen portraits/gallery intact and only newly uploaded private files live under `new_char_id`.
    - Fix [`update_character`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/character_versions.py#L273-L274) so clearing all portraits (`{}`) or all gallery images (`[]`) is preserved rather than falling back to `orig.portraits` / `orig.gallery` via falsy checks; propagate `seed_key`, `seed_version`, and `seed_modified = 1` across `update_character` (and preserve `seed_key`/`seed_version` + `seed_modified` across `restore_character_version`).
  - **World media edits, removals & impact checks ([`worlds.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/worlds.py), [`WorldMediaTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldMediaTab.tsx)):**
    - [`_resolve_world_media_items`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/worlds.py#L1397-L1430) resolves `label` as `COALESCE(NULLIF(wml.label_override, ''), wm.label)` and hydrates `is_public = bool(wm.is_public)`.
    - CoW forks (`update_world` / `_ensure_writable_world_id`) copy `label_override` alongside `(world_id, media_id, sort_order, created_at)` in `world_media_links`.
    - [`update_world_media_label`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/worlds.py#L1604-L1628): If `wm.is_public == 1`, CoW-fork if `campaigns_using > 0` and write the new label to `world_media_links.label_override` for `target_world_id` (leaving `world_media.label` immutable for other users and costing 0 quota); also mark `seed_modified = 1`.
    - [`delete_world_media`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/worlds.py#L1739-L1781): If `wm.is_public == 1`, CoW-fork if `campaigns_using > 0`, then delete **only** the `world_media_links` row for `target_world_id` and clear `image_media_id` on `target_world_id`'s `location_nodes` / `location_containers`, marking `seed_modified = 1`—**never** delete the `world_media` row or unlink its file on disk.
    - [`get_world_media_usage_summary`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/worlds.py#L1671-L1703) and [`get_world_delete_impact`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/worlds.py#L1705-L1737): Scope all `campaigns` queries strictly by `camp.owner_id = world_owner_id` (preventing cross-tenant campaign counts when sharing public `media_id`s), and return `is_public: bool` in `/impact` so [`WorldMediaTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldMediaTab.tsx#L150-L175) prompts accurately (for `is_public`: *"Remove this default image from your world?"* without falsely claiming disk/quota reclamation).
    - [`prune_pending_deletion_worlds`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/worlds.py#L1377-L1394): Must skip `is_public = 1` rows when garbage-collecting `world_media` rows with zero remaining links.
  - **Account Reset, User Deletion & Orphan Sweep ([`auth_users.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/auth_users.py#L299-L399), [`purge_inactive.py`](file:///home/diegolima/Git/cybercantina/backend/app/housekeeping/purge_inactive.py#L125-L175)):**
    - `reset_user_data` and `delete_user` delete only `world_media WHERE owner_id = user_id AND is_public = 0` (`ON DELETE CASCADE` on `worlds` cleans up `world_media_links` automatically without touching `is_public = 1` rows).
    - `_sweep_orphan_media_dirs` skips `media/public/` (under `media_dir`) and `world_media` `is_public = 1` files (`list_active_world_media_filenames` includes them).
  - **`.zcc` Export & Re-Import ([`import_export_service.py`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py)):**
    - Update [`_stage_character_media_for_export`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py#L316-L344) to recognize `/api/media/public/v{N}/characters/{seed_slug}/{category}/{filename}` and resolve it via `media_path.py` so exporting a user's seeded *Kira Vance* embeds her portrait and gallery into the `.zcc` archive.
    - World `.zcc` export works seamlessly via `_stage_world_media_for_export` because public world media lives under `{media_dir}/worlds/images/`.
    - On `.zcc` import (`commit_staged_import`), scope duplicate-name checks in `"copy"` mode to `owner_id=user_id` (fixing the missing `owner_id` filter on `list_characters`) and keep manually imported entities with `seed_key = NULL` and private quota-billed media so manual `.zcc` imports never interfere with `seed_key` restore checks.

### FR-4: Profile Page "Restore Default World & Character"

- **Backend Endpoint (`POST /api/profile/restore-defaults` in [`auth.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/auth.py)):**
  - Authenticated endpoint (`get_current_user`) serialized per user (under a per-user lock or transaction) returning:
    - `restored_world: bool`
    - `restored_character: bool`
    - `skipped_world: bool`
    - `skipped_character: bool`
    - `message: str`
  - **Existence Rule:** Check for active (`pending_deletion = 0`) user-owned rows matching `seed_key = "showcase:the_green_lie"` and `seed_key = "showcase:kira_vance"` (covering both unmodified and user-edited versions of the seeded assets).
  - **Selective Restoration Behavior:**
    - If **neither** exists: restore both *The Green Lie* and *Kira Vance*, linking Kira's `world_id` and `Encrypted burner slate` `lore_id` to the newly restored world/lore IDs.
    - If **only one** was deleted (e.g., user deleted *Kira Vance* while keeping an unmodified or edited *The Green Lie*): restore **only** the missing asset. When restoring *Kira Vance* while *The Green Lie* exists, link her `world_id` to the user's existing *The Green Lie* row (resolving `The Sovereign Cipher` artifact `lore_id` if still present on that world, or clearing `lore_id` and `"artifact"` flag gracefully if the user deleted that lore node). Return an informational message stating which asset was restored and which was skipped because it already exists.
    - If **both** already exist (edited or unedited): restore **neither** and return an informational message explaining that neither asset was restored because *The Green Lie* and *Kira Vance* (or edited versions of them) already exist in their library.
- **Frontend UX ([`ProfileAccountTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/ProfileAccountTab.tsx), [`ProfileModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/ProfileModal.tsx), [`App.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/App.tsx)):**
  - Add a **Starter Assets** card outside the red Danger Zone (using neutral/cyan styling, never `--accent-rose`) with a **"Restore Default World & Character"** button.
  - Explain clearly that only deleted default assets are restored and existing or edited copies will not be overwritten.
  - Display the backend's informational feedback banner (`restored` vs. `already exists`) and invoke an `onDefaultsRestored` callback so `App.tsx` refreshes the user's worlds and characters immediately when anything was restored.

### FR-5: Test Seed Separation & Automated Test Suite Updates

- **Test-Only Legacy Seed Retention (with Review TODO):**
  - Retain the compact *Midnight at the Neon Rust* scenario (`world_neon_rust`, `char_kira_vance`, `camp_neon_rust_default`) inside an explicit test-only helper (never called in `main.py` or `auth.py` and never visible to real users) so the existing engine/spatial/branch test files stay fast, deterministic, and isolated from showcase content changes.
  - **TODO (Explicit Follow-Up Review Item):** Revisit keeping the legacy *Neon Rust* test seed vs. migrating remaining legacy tests to minimal purpose-built fixtures or *The Green Lie* showcase seed once v0.16.0 stabilizes.
- **New & Expanded Test Coverage:**
  - Update auth/tenancy tests to assert *The Green Lie* + *Kira Vance* (and zero campaigns) are seeded on `initial_setup`, `register_user`, and `admin_create_user`, and that the legacy test world/character are not created for real users.
  - Add comprehensive showcase validation tests verifying **all** fields of *The Green Lie* and *Kira Vance*:
    - Depth `4 → 3 → 1` container hierarchy, 35 locations (all reachable), 88 edges, `Main Floor.starting_message`, `image_media_id` links.
    - 14 global + 5 location/container-scoped lore nodes (including `secret` gating and `artifact` lore).
    - `Kira Vance` demographics, `baseline_psyche` (`paranoiac` temperament), `permanent` (`Subdermal shard`) & `artifact` (`Encrypted burner slate` → `The Sovereign Cipher`) items, 8 memory shards, `unsupported_fields["low_token_initial_message"]` preservation + prompt exclusion, portrait & gallery URLs.
  - Add multi-user media, quota & CoW isolation tests:
    - Freshly seeded users have `media_bytes_used == 0`.
    - Editing *Kira Vance* / *The Green Lie* (fields, labels, or media) with active campaigns creates a CoW fork without duplicating public media files or increasing quota.
    - Clearing all portraits/gallery items on a character persists cleanly across subsequent `update_character` saves.
    - Uploading new private character/world media increases quota **only** by the new files' bytes (including replacing a public portrait slot).
    - Deleting/renaming/editing seeded media on User A's account leaves disk files, `world_media`, and User B's assets/labels/impact counts untouched.
    - `reset_user_data`, `delete_user`, and Chloromancer `_sweep_orphan_media_dirs` never delete public media files.
    - `.zcc` export of seeded *Kira Vance* / *The Green Lie* embeds the public images cleanly, and `.zcc` re-import stays isolated from `seed_key` restore checks.
    - `POST /api/profile/restore-defaults` handles: both missing, world-only missing, character-only missing (including when existing world removed `The Sovereign Cipher` lore), and both present (edited or unedited) with informational messages.

### FR-6: Future Base-Asset Upgrade Strategy (Non-Breaking Updates)

To support updating *The Green Lie* or *Kira Vance* in future CyberCantina releases (`seed_version = N+1`) without breaking user-edited copies or active campaigns:
1. **Track Modification Provenance:** Every seeded row records `seed_key`, `seed_version`, and `seed_modified` (set to `1` on any user edit, CoW fork from edits, or media mutation).
2. **Unmodified Copies (`seed_modified == 0`):**
   - If `campaigns_using == 0`, an idempotent upgrade can safely replace the row in place and bump `seed_version` to `N+1`.
   - If `campaigns_using > 0`, CoW-fork automatically: mark the `vN` row `pending_deletion = 1` (preserving active campaigns' frozen location IDs, `lore_id`s, and snapshots intact) and insert the `vN+1` row as the active catalog entry.
3. **User-Edited Copies (`seed_modified == 1`):**
   - **Never** automatically overwrite or auto-merge user-edited worlds/characters. Keep their customized copy untouched (and optionally surface a non-intrusive *"Newer default version available"* option in a future release).
4. **Versioned Public Media Assets:**
   - Public character media uses version-prefixed directories (`public/v1/...`, `public/v2/...`), and public world media uses version-prefixed filenames (`pub_v1_...`, `pub_v2_...`). Never delete or overwrite `v1` public files while any DB row, `pending_deletion` campaign-pinned row, or `character_versions` snapshot still references them.

---

## 4. Non-Functional Requirements & Edge Cases

1. **Registration & Restore Latency:**
   - Seeding 19 lore nodes and 8 memory shards per user must precompute or reuse deterministic seed embeddings (when `embedding_profile.mode == "local_hash"` or matching cached seed vectors) inside a single SQLite transaction so user signup and restore remain sub-second.
2. **Media Path & Log Hygiene:**
   - All `/api/media/public/...` and `/api/media/worlds/...` lookups must validate path segments via [`media_path.py`](file:///home/diegolima/Git/cybercantina/backend/app/security/media_path.py) (`_resolve_within_base` lexical + `realpath` containment).
   - Never log raw user inputs without `sanitize_log_value`.
3. **Concurrency / Idempotency:**
   - Concurrent restore clicks (`POST /api/profile/restore-defaults`) must not create duplicate seeded copies (guard under a per-user lock and transactional check).
4. **Vitest / Frontend Constraints:**
   - Keep restore status/message formatting and public-media delete prompt helpers testable in Node-only Vitest alongside `ReactDOMServer.renderToStaticMarkup` assertions.

---

## 5. Acceptance Criteria & Verification Matrix

| ID | Criterion | Verification Method |
| :--- | :--- | :--- |
| **AC-1** | New admin (`initial_setup`), self-registered (`register`), and admin-created (`admin_create_user`) accounts each receive private clones of *The Green Lie* and *Kira Vance* (with `0` seeded campaigns), while the legacy *Neon Rust* test scenario is never visible to users. | Backend auth & seeding tests (`pytest`) |
| **AC-2** | All fields of *The Green Lie* (35 locations, 88 edges, depth 4→3→1 containers, 19 lore nodes, `starting_message`, `image_media_id`) and *Kira Vance* (`baseline_psyche` `paranoiac`, `permanent`/`artifact` items, 8 shards, `unsupported_fields["low_token_initial_message"]`, portrait + gallery) persist and hydrate cleanly. | Backend showcase validation tests (`pytest`) |
| **AC-3** | Public media files are stored once on disk, served to authenticated users, excluded from `media_bytes_used` (`0` bytes after seeding) and `compute_purge_preview`, and never duplicated across CoW forks. | Backend quota, CoW & purge tests (`pytest`) |
| **AC-4** | Adding private media to seeded entities counts **only** the new private bytes toward user quota (including replacing a public portrait slot); deleting/renaming/editing seeded media on one account leaves disk files, other users' labels/impact counts, and running campaigns intact; `.zcc` export includes public media cleanly. | Backend media, CoW, tenancy & `.zcc` tests (`pytest`) + Frontend `WorldMediaTab` / `CharacterInspectorModal` Vitest tests |
| **AC-5** | `POST /api/profile/restore-defaults` and `ProfileAccountTab` restore only deleted default assets, never overwrite existing or user-edited copies, and show clear informational messages when skipped. | Backend restore API tests (`pytest`) + Frontend Vitest SSR tests |
| **AC-6** | Chloromancer `_sweep_orphan_media_dirs`, `reset_user_data`, and `delete_user` never delete public media files. | Backend housekeeping & auth tests (`pytest`) |
| **AC-7** | Backend (`ruff check`, `tach check`, `pytest`), frontend (`arch:check`, `build`, `test`), and architecture docs (`generate_arch_docs.py --check`) all pass. | CLI gate |

---

## 6. Resolved Design Decisions & Open Follow-Ups

1. **Per-User DB Clones Sharing Public Media:** Chosen over global `owner_id = NULL` template rows so existing `owner_id` tenancy, `pending_deletion`, and CoW editing work uniformly across all worlds/characters.
2. **No Default Campaign Seeded:** Intentionally omitted so users choose between World-focused and Character-focused campaign starts (subject to future user feedback).
3. **Preserved `unsupported_fields` on *Kira Vance*:** `low_token_initial_message` is retained intentionally as an active test fixture for upcoming unsupported-field functionality.
4. **Restore-Only-When-Deleted Rule:** `POST /api/profile/restore-defaults` only recreates missing `seed_key` assets and informs the user when an asset (edited or unedited) already exists.
5. **Unified World Media Path + Per-Link Label Override:** Storing public world media under `{media_dir}/worlds/{category}/pub_v1_*.webp` (`is_public = 1`) with `world_media_links.label_override` avoids rewriting world media URL/export resolvers while isolating label edits and deletions per user/CoW fork.
6. **TODO — Legacy Test Seed Review:** Retain the legacy *Neon Rust* seed strictly as a test-only helper for existing tests in v0.16.0; schedule a follow-up cleanup review to decide whether to migrate those tests to minimal per-test fixtures or *The Green Lie*.
