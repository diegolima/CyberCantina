---
feature: seed-asset-updates
target_version: 0.53.0
document_type: review
status: completed
last_updated: 2026-11-28
---

# Pre-Implementation Review — Seeded World & Character Updates

## Architectural Traps & Mitigations

### 1. Overloaded `SHOWCASE_SEED_VERSION` vs. Immutable Public Media Paths
- **Trap:** `backend/app/db/seed.py` currently uses a single `SHOWCASE_SEED_VERSION = 2` for both public media prefixes (`pub_v2_*`, `/api/media/public/v2/...`) and DB `seed_version` tracking. Bumping a single constant to `3` would rename all public media files/URLs and force unnecessary disk/DB migrations.
- **Mitigation:** Split `SHOWCASE_MEDIA_VERSION = 2` (governing `pub_v2_*` filenames and `/api/media/public/v2/...` routes) from independent per-asset content versions (`SHOWCASE_WORLD_SEED_VERSION = 3`, `SHOWCASE_CHARACTER_SEED_VERSION = 3`) in a central `SEED_CATALOG` registry.

### 2. Startup Media Migration Overwriting Content `seed_version`
- **Trap:** `_migrate_v1_showcase_to_v2` in `seed.py` executes `UPDATE worlds SET seed_version = ?` and `UPDATE characters SET seed_version = ?`. Any migration that bumps content `seed_version` without replacing content hides real content updates from players (and was why legacy *Kira Vance* rows showed `seed_version = 2`).
- **Mitigation:** Remove the `seed_version` overwrite from `_migrate_v1_showcase_to_v2` so media migrations update media IDs/URLs only, and update the corresponding test assertions in `backend/tests/test_showcase_seeding_and_public_media.py`.

### 3. `.zcc` Export & `CANONICAL_*_RECORD_KEYS` Leakage
- **Trap:** Adding `seed_update` to `WorldRecord` and `CharacterRecord` could cause `.zcc` exports to serialize ephemeral library update metadata, or cause `.zcc` imports to capture `"seed_update"` inside `unsupported_fields` if `CANONICAL_*_RECORD_KEYS` is not updated/filtered.
- **Mitigation:** Exclude `seed_update` when serializing `.zcc` archives in `backend/app/services/import_export_service.py`, strip/ignore `"seed_update"` on `.zcc` import (and include it in `CANONICAL_WORLD_RECORD_KEYS` / `CANONICAL_CHARACTER_RECORD_KEYS` or explicitly drop it before unsupported-field extraction), and hydrate `seed_update` **only** in library queries (`campaign_id is None` and `pending_deletion == 0`).

### 4. No-Op Save False Positives on `seed_modified`
- **Trap:** `update_world` (`backend/app/db/repos/worlds.py`) and `update_character` (`backend/app/db/repos/character_versions.py`) currently set `next_seed_modified = 1 if seed_key else ...` unconditionally on every save. Opening an inspector and clicking Save without changing anything locks the asset into `seed_modified = 1`.
- **Mitigation:** Compare canonical persisted field values (excluding timestamps/version counters/ephemeral fields) against the existing record before flipping `seed_modified` from `0` to `1`. Genuine field edits and media mutations (`upload/delete/reorder`) continue to set `seed_modified = 1`.

### 5. `copy_and_update` vs. Active Campaigns & Media CoW Isolation
- **Trap:** On `copy_and_update`, mutating the existing library row in-place (renaming it to `"<Name> (Custom Copy)"` and clearing `seed_key = NULL`) works cleanly when `active_campaigns_count == 0`, **but** if active campaigns reference that row, renaming it in-place would unexpectedly rename the world or character inside those running campaigns!
- **Mitigation:**
  - When `active_campaigns_count == 0`: detach and rename the existing row in-place (`seed_key = NULL, seed_version = NULL, seed_modified = 0, dismissed_seed_version = NULL`), preserving its ID, custom media, and character version history with zero file copies.
  - When `active_campaigns_count > 0`: perform a **CoW fork** for the preserved copy — mark the campaign-bound row `pending_deletion = 1` (keeping its original name/content frozen for running campaigns), insert the detached copy under a new ID with `copy_name` and `seed_key = NULL`, copy its child rows / `world_media_links` (or reconcile character media via `_reconcile_character_media_for_id` and copy `character_versions` history), and then insert the fresh seeded v3 asset.

### 6. In-Place Replace Cleanup (Vector Entries, Props & Custom Media)
- **Trap:** Replacing a modified world in-place must not leave orphaned `location_props`, `location_containers`, `world_media_links`, or stale `vector_entries` (`lore`, `location_lore`, `container_lore`) from user edits, nor break custom media pruning.
- **Mitigation:** Inside a single transaction, delete world-scoped base rows (`location_edges`, `location_props` where `campaign_id IS NULL`, `location_nodes` where `created_at_turn_id IS NULL`, `lore_nodes` where `campaign_id IS NULL`, `location_containers`, `world_media_links`, and `vector_entries` where `campaign_id IS NULL OR campaign_id = ''`) before inserting the new seed, and trigger `run_entity_pruner` in background tasks if custom media links were detached.

### 7. Linked Character Split & Artifact `lore_id` Remapping
- **Trap:** When a world is updated, characters linked via `characters.world_id` may hold `equipped` / `inventory` items referencing old `lore_<uuid>` artifact IDs. Furthermore, on `copy_and_update`, custom characters created for the player's edited world shouldn't silently jump to the vanilla seed world, whereas an unmodified seeded *Yulia Halim* should follow the updated *The Green Lie*.
- **Mitigation:**
  - On **Replace**: re-link all active (`pending_deletion = 0`) characters from the old `world_id` to the updated `world_id`, remapping artifact `lore_id`s by matching artifact lore title against the updated world.
  - On **Save Copy & Update**: keep custom (`seed_key IS NULL`) and modified seeded (`seed_modified = 1`) characters linked to the **preserved copy**; move unmodified seeded characters (`seed_key IS NOT NULL AND seed_modified = 0`) to the **updated seeded world** and remap their artifact `lore_id`s by title.

### 8. Concurrency, Layering & Frontend Guardrails
- **Trap:** Concurrent clicks on Update, Upload Media, or Restore Defaults could race on disk/DB state; placing shared DTOs in upper layers could violate `tach check` or `arch:check`; inline styles/colors could violate CSS rules.
- **Mitigation:**
  - Guard all seed-update/dismiss routes with `get_user_media_lock(current_user.id)`.
  - Place `SeedUpdateInfo` and request/response DTOs in leaf `backend/app/schemas/seed.py` and `frontend/src/types/seed.ts`.
  - Use modular CSS in `frontend/src/styles/` (`css:audit`, no `!important`), reserve `--accent-rose` strictly for the destructive **Replace & Discard Edits** action, and never render update UI inside campaign views.
