---
feature: seed-asset-updates
target_version: 0.53.0
document_type: plan
status: completed
last_updated: 2026-11-28
---

# Implementation Plan — Seeded World & Character Updates

## Step 1: Worktree & Feature Spec Package
- [x] Create isolated worktree `.worktrees/seed-asset-updates` on branch `feat/seed-asset-updates`
- [x] Author `FRD.md` (`docs/features/TBD-seed-asset-updates/FRD.md`)
- [x] Author `REVIEW.md` (`docs/features/TBD-seed-asset-updates/REVIEW.md`)
- [x] Author `PLAN.md` (`docs/features/TBD-seed-asset-updates/PLAN.md`)
- [x] Obtain explicit user approval before writing production code

## Step 2: Database Schema & Migration
- [x] Add `dismissed_seed_version INTEGER NULL` to `worlds` and `characters` in `backend/app/db/schema.sql`
- [x] Add idempotent `ALTER TABLE` migrations for `dismissed_seed_version` on `worlds` and `characters` in `backend/app/db/repos/schema_init.py`

## Step 3: Backend Schemas & Seed Registry
- [x] Create leaf schema module `backend/app/schemas/seed.py` (`SeedUpdateInfo`, `SeedUpdateRequest`) and response schemas (`WorldSeedUpdateResponse`, `CharacterSeedUpdateResponse`)
- [x] Add `seed_update: SeedUpdateInfo | None = None` to `WorldRecord` (`backend/app/schemas/world.py`) and `CharacterRecord` (`backend/app/schemas/character.py`), keeping `.zcc` canonical key filtering safe
- [x] Refactor `backend/app/db/seed.py` and add `backend/app/db/seed_catalog.py` & `backend/app/db/seed_updates.py`:
  - Split `SHOWCASE_MEDIA_VERSION = 2` from per-asset content versions (`SHOWCASE_WORLD_SEED_VERSION = 3`, `SHOWCASE_CHARACTER_SEED_VERSION = 3`) in `SEED_CATALOG` with changelogs
  - Fix `_migrate_v1_showcase_to_v2` so media-only migrations never overwrite `worlds.seed_version` or `characters.seed_version`
  - Add helper to generate unique copy names (`"<Name> (Custom Copy)"`, auto-numbered if taken)
  - Add `compute_seed_update_info`
  - Add `update_seeded_world_for_user` (`"replace"` and `"copy_and_update"`, CoW fork when `active_campaigns_count > 0`, linked character split + artifact `lore_id` remapping, vector/prop/container/media cleanup)
  - Add `update_seeded_character_for_user` (`"replace"` and `"copy_and_update"`, CoW fork + `_reconcile_character_media_for_id` + version history preservation, world/artifact `lore_id` resolution)
  - Add `dismiss_seeded_world_update` and `dismiss_seeded_character_update`

## Step 4: Repository Hydration, No-Op Save Tightening & `.zcc` Isolation
- [x] Hydrate `seed_update` in `WorldsMixin.get_world` / `list_worlds` (`backend/app/db/repos/worlds.py`) only when `campaign_id is None`, `valid_turn_ids is None`, and `pending_deletion == 0`
- [x] Hydrate `seed_update` in `CharactersMixin.get_character` / `list_characters` (`backend/app/db/repos/characters.py`) only when `campaign_id is None`, `valid_turn_ids is None`, and `pending_deletion == 0`
- [x] Tighten `update_world` (`worlds.py`) and `update_character` (`character_versions.py`) so no-op saves do not flip `seed_modified` from `0` to `1`
- [x] Exclude `seed_update` from `.zcc` exports and strip/ignore it on `.zcc` import in `backend/app/services/import_export_service.py`

## Step 5: API Routes & Restore Defaults Messaging
- [x] Add `POST /api/worlds/{world_id}/seed-update` and `POST /api/worlds/{world_id}/seed-update/dismiss` in `backend/app/routers/worlds.py` (guarded by `get_user_media_lock`, triggering `run_entity_pruner`)
- [x] Add `POST /api/characters/{character_id}/seed-update` and `POST /api/characters/{character_id}/seed-update/dismiss` in `backend/app/routers/characters.py` (guarded by `get_user_media_lock`, triggering `run_entity_pruner`)
- [x] Update `restore_default_assets` in `backend/app/routers/auth.py` so skipped defaults with a newer seed version note in `message` that an update is available in the Worlds/Characters library

## Step 6: Frontend Types, API Clients & UI
- [x] Create `frontend/src/types/seed.ts` and wire `seed_update?: SeedUpdateInfo | null` into `types/world.ts`, `types/character.ts`, and `types/index.ts`
- [x] Add `updateSeededWorld`, `dismissWorldSeedUpdate` in `frontend/src/api/worlds.ts` and `updateSeededCharacter`, `dismissCharacterSeedUpdate` in `frontend/src/api/characters.ts`
- [x] Build shared `frontend/src/components/SeedUpdateModal.tsx` (unmodified compact confirm vs. modified 3-way Save Copy & Update / Replace & Discard Edits / Skip this version)
- [x] Surface update indicators and actions (never inside campaigns):
  - `HomeScreen.tsx`: subtle update badge on Worlds and Characters cards
  - `HomeEntityPickerModal.tsx`: `"Update"` button on world/character rows when unskipped update available
  - `WorldInspectorModal.tsx` & `CharacterInspectorModal.tsx`: update banner/button (or subtle `"vN available (skipped)"` trigger when dismissed), hidden in campaign mode
  - `App.tsx` / `AppModals.tsx`: coordinate modal state and library refresh after update/dismiss
- [x] Add modular styles in `frontend/src/styles/10-home.css` and `frontend/src/styles/07-modals-and-forms.css` (no `!important`, `--accent-rose` strictly for destructive Replace & Discard Edits)

## Step 7: Tests & Verification Gates
- [x] Update `backend/tests/test_showcase_seeding_and_public_media.py` and `backend/tests/test_spatial_edges.py`
- [x] Add comprehensive backend suite `backend/tests/test_seed_asset_updates.py`
- [x] Add frontend Vitest suite `frontend/src/components/__tests__/seedAssetUpdates.test.tsx`
- [x] Run required checks:
  - `cd backend && .venv/bin/ruff check app tests && .venv/bin/tach check`
  - `backend/.venv/bin/pytest backend/tests`
  - `npm --prefix frontend run arch:check && npm --prefix frontend run css:audit && npm --prefix frontend run build && npm --prefix frontend test`
  - `backend/.venv/bin/python scripts/generate_arch_docs.py && backend/.venv/bin/python scripts/generate_arch_docs.py --check`

## Step 8: Planned `../cybercantina-wiki` Updates (Applied at Merge Time)
- [x] `../cybercantina-wiki/First-Campaign-and-Interface-Tour.md`: document update badges on Home cards and updating built-in showcase worlds/characters from the library.
- [x] `../cybercantina-wiki/Authoring-Worlds-Characters-and-Personas.md`: document the library Update flow (Unmodified replace, Modified "Save Copy & Update" vs. "Replace & Discard Edits", "Skip this version", linked characters, and active campaign snapshot safety).
- [x] `../cybercantina-wiki/Authentication-Multi-User-and-Security.md`: checked — no Restore Defaults section present there (Profile Restore guidance lives in `First-Campaign-and-Interface-Tour.md`).
- [x] Note on in-app `mechanicsCatalog.ts`: no gameplay turn mechanics change, so no `mechanicsCatalog.ts` updates are required.
