---
feature: green-lie-seed-v3
target_version: 0.52.5
document_type: review
status: completed
last_updated: 2026-11-28
---

# Pre-Implementation Review — Upgraded *The Green Lie* Showcase Seed & Full Spatial Seeder Parity

## Architectural Traps & Mitigations

### 1. Silent Data Loss in `seed.py`
- **Trap:** `_seed_green_lie_world_for_user` in `backend/app/db/seed.py` currently omits `anchor_location_id` (on `location_nodes`), `location_props` rows, and `distance_mode` / `is_vertical` (on `location_edges`). Dropping the new `world.json` in place without updating `seed.py` would silently discard all 3 portal anchors, both location props, and all 11 vertical edge pairs—immediately re-introducing spatial consistency failures on freshly seeded worlds.
- **Mitigation:** Update `seed.py` to persist `anchor_location_id`, `location_props` (remapping `lore_id` if present), and `distance_mode` / `is_vertical` via `extract_edge_consistency_fields(edge)`, and add explicit assertions in `test_showcase_seeding_and_public_media.py`.

### 2. Double-Prefixed Public Media IDs (`pub_v2_pub_v2_*`)
- **Trap:** Exporting directly from `backend/cybercantina.db` produces runtime public IDs like `pub_v2_wmed_28416ce9b1` and `pub_v2_vid_neo_veridia`. Because `seed.py` prepends `pub_v{SHOWCASE_SEED_VERSION}_` when materializing public media, unnormalized IDs would double-prefix to `pub_v2_pub_v2_*` and fail file lookups in `showcase_data/the_green_lie/media/`.
- **Mitigation:** Strip `pub_v2_` prefixes from `media[]`, container `image_media_id`/`image_url`, and location `image_media_id`/`image_url`, and preserve `video_duration_ms` / `video_width` / `video_height` / `video_byte_size` from the existing showcase manifest. Verify via `ensure_public_showcase_media` and `GET /api/media/...` tests.

### 3. Artifact Lore Cross-Reference Drift (`character.json` ↔ `world.json`)
- **Trap:** `character.json` binds Yulia Halim's `Encrypted burner slate` to `lore_id: "lore_ced32a7021"` (`"The Sovereign Cipher"`). Exporting from a cloned user DB gives `"The Sovereign Cipher"` a different runtime ID (`lore_40cf0a47d8`), which would break direct `id_remap` lookup on fresh seeds (forcing fallback title lookup or unlinking the artifact).
- **Mitigation:** Normalize `"The Sovereign Cipher"`'s ID in `world.json` back to `lore_ced32a7021` so `character.json` and `world.json` stay in exact ID alignment.

### 4. `location_props` Insertion Order vs. World Lore Remapping
- **Trap:** If a location prop references a world `artifact` `lore_id`, inserting `location_props` inside the location loop *before* world `lore_nodes` are inserted into `id_remap` would fail to resolve `prop.lore_id`.
- **Mitigation:** Insert `location_props` *after* world `lore_nodes` have been inserted and mapped into `id_remap` (or pre-allocate world lore IDs in `id_remap` up front).

### 5. `SHOWCASE_SEED_VERSION` Stability
- **Trap:** Bumping `SHOWCASE_SEED_VERSION` to `3` when no media files changed would rename every public media file and URL (`pub_v2_*` → `pub_v3_*`, `/api/media/public/v2/...` → `/v3/...`), requiring a new DB/disk migration across `media_assets`, `characters`, `character_versions`, and `turn_nodes` for zero visual change.
- **Mitigation:** Keep `SHOWCASE_SEED_VERSION = 2` (consistent with prior v0.36.0 and v0.37.0 `world.json` upgrades). Existing users' worlds remain safely untouched; new users and **Restore Default Showcase** receive the upgraded world.

### 6. Existing Test Assumptions
- **Trap:** `test_showcase_seeding_and_public_media.py` hardcodes `len(w["locations"]) == 35` and `len(w["lore_nodes"]) == 14`, and `test_spatial_edges.py` asserts `all(e.distance_meters >= 70 for e in green_lie.edges)` (which fails on the new realistic `6m`/`8m`/`10m`/`1m` interior and hatch links).
- **Mitigation:** Update those assertions (`37` locations, `15` global lore nodes, `distance_meters >= 1` plus targeted checks for interior/vertical/anchor/prop values) and ensure full pytest + Vitest suites pass.
