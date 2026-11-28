---
feature: seed-asset-updates
target_version: 0.53.0
document_type: frd
status: completed
last_updated: 2026-11-28
---

# Feature Requirements Document — Seeded World & Character Updates

## 1. Overview & Motivation

CyberCantina's default showcase assets — the world **The Green Lie** (`seed_key = "showcase:the_green_lie"`) and character **Yulia Halim** (`seed_key = "showcase:kira_vance"`) — are seeded per user via `seed_showcase_for_user` in `backend/app/db/seed.py`. Today, `seed_showcase_for_user` skips any user who already owns a non-deleted asset with that `seed_key`, and startup migrations (`_migrate_v1_showcase_to_v2`) previously bumped `seed_version` without updating the actual world or character content.

As a result, existing players never receive showcase upgrades (such as the `v0.52.5` spatial topology, containers, tracked props, and lore upgrade to *The Green Lie*, or the *Kira Vance* → *Yulia Halim* profile/voice-anchor/lore update) unless they manually delete their assets and invoke **Profile → Restore Defaults**.

This feature introduces **library-only, player-controlled seed updates** for both seeded worlds and seeded characters, safely preserving active campaigns via Copy-on-Write (CoW) and giving players an explicit choice when they have made manual edits.

---

## 2. Scope & Campaign Boundary

1. **Dual Asset Coverage:** Applies to both **seeded worlds** (`showcase:the_green_lie`) and **seeded characters** (`showcase:kira_vance`) in the user's library.
2. **Strictly Library-Only UI & API:**
   - Update badges, buttons, banners, and endpoints operate exclusively on library assets (`worlds` / `characters` outside campaigns).
   - Update controls are **never** shown or permitted inside an active campaign view (Live Inspector, Campaign Map, World Codex, or GM Mode).
3. **Campaign Snapshot Safety (CoW Fork):**
   - If active campaigns reference a seeded world (`campaigns.world_id`) or seeded character (`campaigns.character_id` or `campaign_characters.character_id`), updating from the library is still allowed.
   - Instead of mutating campaign history, the backend performs a **Copy-on-Write (CoW) fork** (marking the campaign-referenced row `pending_deletion = 1` so existing campaigns remain frozen on their original snapshot, while creating the updated library row for future campaigns).

---

## 3. Independent Seed Versioning & Edit Detection

### 3.1 Split Media Version vs. Content Versions
- Keep `SHOWCASE_MEDIA_VERSION = 2` (controlling immutable public media IDs `pub_v2_*` and URLs `/api/media/public/v2/...`) decoupled from per-asset content versions so content updates never cause unnecessary media file renames or URL migrations.
- Introduce a central showcase seed registry (`SEED_CATALOG` in `backend/app/db/seed.py`) with independent integer content versions and human-readable changelogs:
  - `showcase:the_green_lie` → **`v3`**: summarizes the `v0.52.5` spatial consistency upgrade (37 locations, 88 edges with 11 vertical transitions and obstacle metadata, 3 cross-container anchors, 2 tracked props, and *Aegis Security Patrols* threat lore).
  - `showcase:kira_vance` → **`v3`**: summarizes the *Yulia Halim* identity/profile update, voice anchors, and artifact lore linkage (ensuring legacy *Kira Vance* and v2 users can upgrade cleanly).

### 3.2 Startup Migration Fix
- `_migrate_v1_showcase_to_v2` (and any future media-only startup migrations) MUST migrate media references only and **MUST NEVER** overwrite `worlds.seed_version` or `characters.seed_version`.

### 3.3 Dismissal & Edit Tracking
- **Dismissal column:** Add `dismissed_seed_version INTEGER NULL` to `worlds` and `characters` (in `backend/app/db/schema.sql` and idempotent `ALTER TABLE` migrations in `backend/app/db/repos/schema_init.py`).
- **Manual edit detection:** Use the existing `seed_modified` column, and tighten `update_world` (`backend/app/db/repos/worlds.py`) and `update_character` (`backend/app/db/repos/character_versions.py`) so **no-op saves** (where persisted fields are unchanged from the current record) do **not** flip `seed_modified` from `0` to `1`.

---

## 4. Update Modes, Detached Copies & Linked Data

### 4.1 Mode `"replace"` (Unmodified Replace, or Modified "Replace & Discard Edits")
- **Unused by campaigns (`active_campaigns_count == 0`):**
  - Replace the world or character content **in-place** (preserving its `id`), updating `seed_version = latest_version`, `seed_modified = 0`, and `dismissed_seed_version = NULL`.
- **Used by campaigns (`active_campaigns_count > 0`):**
  - Perform a **CoW fork**: mark the old row `pending_deletion = 1` (keeping running campaigns intact) and insert the fresh seeded row at `latest_version`, `seed_modified = 0`, `dismissed_seed_version = NULL`.
- **World linked characters & artifacts:**
  - Re-link all active (`pending_deletion = 0`) characters whose `world_id` points to the old world to the updated `world_id`.
  - Remap item `lore_id` references across `equipped_json` and `inventory_json` by matching artifact lore title against the updated world (dropping `"artifact"` from `flags` and clearing `lore_id` only if no matching artifact title exists).
- **Character world linkage, media & history:**
  - Preserve active linked `world_id` if valid (or link to the user's active seeded world if present), remap artifact `lore_id`s by title, reset portraits/gallery cleanly to the seed's public media URLs, and record a new `character_versions` snapshot (maintaining `update_character` history guarantees).

### 4.2 Mode `"copy_and_update"` (Available When `seed_modified == 1`)
- **Detach preserved copy:**
  - Rename the player's modified asset to a user-supplied `copy_name` (default `"<Name> (Custom Copy)"`, auto-numbered `"<Name> (Custom Copy 2)"`, etc. if that name already exists in the user's library).
  - Clear seed provenance on the preserved copy: `seed_key = NULL`, `seed_version = NULL`, `seed_modified = 0`, `dismissed_seed_version = NULL`.
  - Keep all manual edits, custom uploaded media/portraits/gallery, and character version history intact on the preserved copy.
  - If active campaigns reference the original row (`active_campaigns_count > 0`), CoW-fork the preserved copy onto a fresh library row (reconciling character media via `_reconcile_character_media_for_id` for characters, or cloning world rows + `world_media_links` for worlds) while marking the campaign-bound snapshot `pending_deletion = 1` so running campaigns do not see their world/character renamed to `"(Custom Copy)"`.
- **Install updated seed:**
  - Insert the fresh updated seeded world/character at `latest_version`, `seed_modified = 0`, `dismissed_seed_version = NULL`.
- **World linked characters split:**
  - Keep custom characters (`seed_key IS NULL`) and modified seeded characters (`seed_modified = 1`) attached to the **preserved copy**.
  - Move unmodified seeded characters (`seed_key IS NOT NULL AND seed_modified = 0`, e.g. unmodified *Yulia Halim*) to the **newly updated seeded world** and remap their artifact `lore_id`s by title.
- **Character copy linkage:**
  - Preserve the edited character's existing `world_id`, custom media, and version history on the detached copy; link the newly installed seeded *Yulia Halim* to the player's active seeded world (if present) with artifact `lore_id`s resolved.

---

## 5. API & Schema Contracts

### 5.1 Leaf DTO (`backend/app/schemas/seed.py`)
`SeedUpdateInfo`:
- `seed_key: str`
- `current_version: int`
- `latest_version: int`
- `update_available: bool`
- `seed_modified: bool`
- `dismissed_version: int | None = None`
- `is_dismissed: bool`
- `changelog: str`
- `has_custom_media: bool`
- `active_campaigns_count: int`
- `linked_characters_count: int = 0`

Attached as `seed_update: SeedUpdateInfo | None = None` on `WorldRecord` and `CharacterRecord` **only** when hydrated in library context (`campaign_id is None` and `pending_deletion == 0`). Excluded from `.zcc` exports and `unsupported_fields`.

### 5.2 Endpoints
- `POST /api/worlds/{world_id}/seed-update`
  - Request: `{ "mode": "replace" | "copy_and_update", "copy_name": str | None }`
  - Response: `{ "updated_world": WorldRecord, "preserved_copy": WorldRecord | None }`
- `POST /api/worlds/{world_id}/seed-update/dismiss`
  - Sets `dismissed_seed_version = latest_version` for the asset's `seed_key`.
  - Response: `WorldRecord`
- `POST /api/characters/{character_id}/seed-update`
  - Request: `{ "mode": "replace" | "copy_and_update", "copy_name": str | None }`
  - Response: `{ "updated_character": CharacterRecord, "preserved_copy": CharacterRecord | None }`
- `POST /api/characters/{character_id}/seed-update/dismiss`
  - Sets `dismissed_seed_version = latest_version` for the asset's `seed_key`.
  - Response: `CharacterRecord`
- `POST /api/profile/restore-defaults` (`backend/app/routers/auth.py`):
  - Remains strictly for restoring deleted defaults. When an existing default is skipped AND has a newer seed version available, `message` notes that an update is available in the Worlds/Characters library.

---

## 6. Frontend UI & UX

1. **`HomeScreen` (`frontend/src/components/HomeScreen.tsx`):**
   - Show a subtle update pill/badge on the **Worlds** and **Characters** category cards whenever ≥1 active library asset has `seed_update.update_available && !seed_update.is_dismissed`.
2. **`HomeEntityPickerModal` (`frontend/src/components/HomeEntityPickerModal.tsx`):**
   - Show an **`Update`** action button on world/character rows when `seed_update.update_available && !seed_update.is_dismissed`.
3. **`WorldInspectorModal` & `CharacterInspectorModal`:**
   - Show a clear update banner/button in library inspection mode when `seed_update.update_available && !seed_update.is_dismissed`.
   - Show a quiet, non-intrusive `"vN available (skipped)"` trigger when `seed_update.update_available && seed_update.is_dismissed` so players can still apply a previously skipped version.
   - **Never** render update UI when inspecting inside an active campaign.
4. **Shared `SeedUpdateModal` (`frontend/src/components/SeedUpdateModal.tsx`):**
   - **Unmodified (`!seed_modified`):** Compact confirm dialog showing `vX → vY`, changelog summary, note that active campaigns remain untouched on their current snapshot, and `Update` + `Cancel` actions.
   - **Modified (`seed_modified`):** Shows `vX → vY`, changelog summary, editable copy name input (pre-filled `"<Name> (Custom Copy)"`), warning when `has_custom_media` (custom media is kept on the copy and dropped if replacing directly), note on linked characters/campaigns, primary **Save Copy & Update**, secondary destructive (`--accent-rose`) **Replace & Discard Edits**, and subtle **Skip this version** + **Cancel** buttons.

---

## 7. Non-Goals & Acceptance Criteria

### 7.1 Non-Goals
- Live in-campaign world or character migration (running campaigns stay frozen on their snapshot).
- Automatic/silent overwrites of user libraries without explicit user confirmation.
- Three-way structural merge of manual edits with updated seed deltas.
- Changing `SHOWCASE_MEDIA_VERSION` or renaming `pub_v2_*` public media URLs.

### 7.2 Acceptance Criteria
1. Existing v2 (or legacy v1/*Kira Vance*) users see `update_available: true` (`latest_version: 3`) on *The Green Lie* and *Yulia Halim* in library responses, with `seed_update: null` inside campaign views.
2. Saving a world or character in the inspector without changing persisted fields leaves `seed_modified == 0`.
3. Replacing an unmodified asset updates it in-place when unused, or CoW-forks (`pending_deletion = 1` on old row) when referenced by campaigns, leaving campaigns untouched.
4. Choosing **Save Copy & Update** detaches the modified asset (`seed_key = NULL`, `seed_version = NULL`) under the user-chosen (or auto-numbered) copy name, preserves all edits/media/version history (and isolates active campaigns via CoW if needed), installs the fresh v3 asset, and routes custom/edited linked characters to the copy while moving unmodified seeded characters to the updated world with remapped artifact `lore_id`s.
5. Choosing **Skip this version** persists `dismissed_seed_version = 3`, hiding Home/Picker badges while retaining the quiet `"v3 available (skipped)"` trigger in the Inspector modal.
6. `.zcc` export and re-import round-trips ignore `seed_update` cleanly without polluting `unsupported_fields`.
7. All backend (`ruff`, `tach`, `pytest`), frontend (`arch:check`, `css:audit`, `build`, `vitest`), and architecture doc checks pass.
