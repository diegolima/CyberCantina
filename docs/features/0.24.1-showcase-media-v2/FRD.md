---
feature: showcase-media-v2
target_version: 0.24.1
document_type: frd
status: completed
last_updated: 2026-11-20
---

# Feature Requirements Document (FRD)
## Showcase Media v2: Watermark-Free Artwork, Neo-Veridia Linked Video & Seeding Support

**Status:** Implemented  
**Target Version:** CyberCantina v0.24.1  
**Depends On:** `0.16.0` (Per-User Showcase Seeding & Public Media), `0.24.0-image-linked-videos`  
**Scope:**
- Showcase Media Bundle ([`backend/app/db/showcase_data/the_green_lie/`](../../../backend/app/db/showcase_data/the_green_lie/world.json))
- Showcase Seeding & v1→v2 Migration ([`backend/app/db/seed.py`](../../../backend/app/db/seed.py))
- Unified Media Asset Resolution & Public Guard Coverage ([`backend/app/db/repos/media_assets.py`](../../../backend/app/db/repos/media_assets.py), [`backend/app/db/repos/worlds.py`](../../../backend/app/db/repos/worlds.py), [`backend/app/housekeeping/purge_inactive.py`](../../../backend/app/housekeeping/purge_inactive.py))
- Frontend Public Video Badge Clarity (optional minor polish in [`WorldMediaTab.tsx`](../../../frontend/src/components/world/WorldMediaTab.tsx))
- Automated Tests ([`backend/tests/test_showcase_seeding_and_public_media.py`](../../../backend/tests/test_showcase_seeding_and_public_media.py), [`backend/tests/test_video_uploads_and_governance.py`](../../../backend/tests/test_video_uploads_and_governance.py))

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
1. **No Built-In Linked Video Showcase:** CyberCantina v0.24.0 introduced 1:1 image-linked videos across Worlds, Characters, Personas, Map Details, World Codex, and First-Visit Arrival Cards, but the default showcase scenario (*The Green Lie*) only seeds static `.webp` images. New users must upload their own `.mp4`/`.webm` to experience the lightbox reveal and Turn-1 arrival video playback.
2. **Corner Watermarks / Signatures on Default World Art:** All three existing showcase world images (`wmed_28416ce9b1.webp`, `wmed_d8d34909a5.webp`, `wmed_7149de5689.webp`) carry a `"J.S. Chan"` signature in the bottom-right corner, violating [`cybercantina-zcc-review`](../../../.agents/skills/cybercantina-zcc-review/SKILL.md#L47) showcase art hygiene.
3. **Seeding Pipeline Lacks Public Linked-Video Support:** [`ensure_public_showcase_media`](../../../backend/app/db/seed.py#L89-L170) hardcodes `media_type = 'image'`, `role = 'world_scene'`, `parent_image_id = NULL`, `.webp` extensions, and `worlds/images/` paths. It cannot materialize or register a public `linked_video` asset alongside its parent showcase image.
4. **24-Hour Browser Cache on `v1` Public Assets:** Both [`get_world_media`](../../../backend/app/routers/worlds.py#L222-L246) and [`get_unified_media_asset`](../../../backend/app/routers/media.py#L48-L82) emit `Cache-Control: private, max-age=86400`. Overwriting `pub_v1_*` files in place leaves existing browsers serving cached watermarked `v1` images for up to 24 hours unless the showcase version tag is bumped.

### 1.2 Proposed Solution
1. **Replace All Three *The Green Lie* World Images with Clean, Signature-Free Artwork:**
   - **Neo-Veridia (`wmed_28416ce9b1`):** Replace `wmed_28416ce9b1.webp` with the exact first frame of `Neo-Veridia-short-v2.mp4` (`1280×720` WebP, 16:9, signature-free), matching the linked video's framing and aspect ratio so [`ImageLightboxModal`](../../../frontend/src/components/shared/ImageLightboxModal.tsx) cross-fades seamlessly without letterboxing or visual jumps.
   - **Sector 9: The Drain (`wmed_d8d34909a5`):** Replace `wmed_d8d34909a5.webp` with `sector_9.png` normalized via `render_webp_bytes(..., square_crop=False, max_size=1920)` (`1920×1434` WebP, signature-free).
   - **The Neon Rust's Main Floor (`wmed_7149de5689`):** Replace `wmed_7149de5689.webp` with `the_neon_rust_main_floor.png` normalized via `render_webp_bytes(..., square_crop=False, max_size=1920)` (`1920×1920` WebP, signature-free).
2. **Add Linked Showcase Video for *Neo-Veridia* (`wmed_28416ce9b1`):**
   - Bundle `Neo-Veridia-short-v2.mp4` (`1,948,665` bytes, `1280×720`, 24 fps, `10.0s`, H.264 `yuv420p` + AAC mono 96 kbps, `-movflags +faststart`) into `backend/app/db/showcase_data/the_green_lie/media/` and link it 1:1 to `wmed_28416ce9b1` (`sort_order: 0`, Depth-4 root container *Neo-Veridia*), so players immediately see the `Video` badge on the World card, Codex, Map Inspector, and Turn-1 arrival carousel (`autoPlayVideo={true}`).
3. **Support Seeding Linked Media in `seed.py` & Bump `SHOWCASE_SEED_VERSION` to `2`:**
   - Extend `world.json` showcase media metadata and [`ensure_public_showcase_media`](../../../backend/app/db/seed.py#L89-L170) to materialize and upsert public `linked_video` rows in `media_assets` under `assets/videos/`.
   - Bump `SHOWCASE_SEED_VERSION = 2` (minting `pub_v2_wmed_*`, `pub_v2_vid_*`, and `/api/media/public/v2/characters/kira_vance/...`) and provide an **idempotent `v1 → v2` startup migration** so existing databases upgrade cleanly without broken image links, orphaned `pub_v1_*` files, or stale `v1` browser caches.

---

## 2. Scope, Boundaries & Core Invariants

1. **1:1 Parent-Image Binding & Quota Exemption:**
   - The seeded showcase video must be stored as `media_type = 'video'`, `role = 'linked_video'`, `is_public = 1`, `owner_id = NULL`, `seed_key = SHOWCASE_WORLD_SEED_KEY`, and `parent_image_id = 'pub_v2_wmed_28416ce9b1'`.
   - It must **never** count toward any user's `media_bytes_used` quota and must **never** be deleted by user edits, CoW forks, user data resets, `admin/media/purge`, or Chloromancer orphan sweeps.
2. **Disk Location & Serving Path:**
   - Because [`MediaAssetsMixin.resolve_asset_disk_path`](../../../backend/app/db/repos/media_assets.py#L91-L105) resolves `media_type = 'video'` strictly from `{media_dir}/assets/videos/{filename}` (its legacy `worlds/` fallback only covers `images` and `audio`), the public showcase video **must** be materialized via `safe_resolve_asset_file_path(repo.media_dir, "videos", pub_video_filename)` and served via `/api/media/assets/{pub_video_id}` with HTTP `Range` support.
3. **Zero Broken References on Existing `v1` Databases:**
   - Upgrading `SHOWCASE_SEED_VERSION` from `1` to `2` must never strand existing users' seeded worlds, characters, saved `character_versions`, or `turns.first_visit_media_json` on missing `pub_v1_*` or `/api/media/public/v1/...` assets.
4. **`.zcc` Portability:**
   - Exporting *The Green Lie* with `include_videos=True` must package the linked showcase video cleanly inside the `.zcc` archive; exporting with `include_videos=False` (default) must strip `video_url` / `video_mime_type` cleanly as specified in v0.24.0.
5. **Security & Architecture Guardrails:**
   - All media paths must continue routing through [`media_path.py`](../../../backend/app/security/media_path.py).
   - No new `ffmpeg` runtime dependency is introduced during startup seeding: the first-frame `.webp` is pre-extracted and committed in `showcase_data/the_green_lie/media/` alongside the `.mp4`.

---

## 3. Functional Requirements

### FR-1: Showcase Media Bundle Updates (`showcase_data/the_green_lie/`)
1. **Media Files in `backend/app/db/showcase_data/the_green_lie/media/`:**
   - Replace `wmed_28416ce9b1.webp` with the extracted first frame of `Neo-Veridia-short-v2.mp4`, encoded to WebP (`1280×720`, `max_size=1920`, `square_crop=False`).
   - Add `vid_neo_veridia.mp4` (copied from `Neo-Veridia-short-v2.mp4`, `1,948,665` bytes, `1280×720`, `10,000 ms` duration).
   - Replace `wmed_d8d34909a5.webp` with `sector_9.png` converted to WebP (`1920×1434`, `max_size=1920`, `square_crop=False`).
   - Replace `wmed_7149de5689.webp` with `the_neon_rust_main_floor.png` converted to WebP (`1920×1920`, `max_size=1920`, `square_crop=False`).
2. **Metadata in [`world.json`](../../../backend/app/db/showcase_data/the_green_lie/world.json):**
   - Update `byte_size` on all three `media[]` entries to match the newly generated `.webp` files.
   - Add linked-video fields on the `wmed_28416ce9b1` entry in `media[]`:
     - `video_asset_id`: `"vid_neo_veridia"` (canonical bundle video key)
     - `video_url`: `"media/worlds/world_b83529a8ec/videos/vid_neo_veridia.mp4"` (resolved by basename `Path(...).name` in `seed.py`, matching the existing `url` pattern)
     - `video_mime_type`: `"video/mp4"`
     - `video_byte_size`: `1948665`
     - `video_width`: `1280`, `video_height`: `720`, `video_duration_ms`: `10000` (optional metadata fields consumed by `seed.py`; ignored by `WorldMediaItem` if unused).

### FR-2: Linked-Video Seeding Support in `backend/app/db/seed.py`
1. **Bump Seed Version:**
   - Increment `SHOWCASE_SEED_VERSION = 2` in [`seed.py`](../../../backend/app/db/seed.py#L32).
   - Helper outputs become:
     - World images: `pub_v2_{orig_media_id}` / `pub_v2_{orig_media_id}.webp`
     - World linked video: `pub_v2_{orig_video_id}` / `pub_v2_{orig_video_id}{ext}` (e.g., `pub_v2_vid_neo_veridia` / `pub_v2_vid_neo_veridia.mp4`)
     - Character public media path prefix: `/api/media/public/v2/characters/kira_vance/...`
2. **Materialize & Upsert Linked Videos in `ensure_public_showcase_media(repo)`:**
   - For each `item` in `world_data.get("media", [])`:
     - Materialize the parent image to `safe_resolve_world_media_file_path(repo.media_dir, "images", pub_filename)` and upsert its `media_assets` row (`media_type='image'`, `role='world_scene'`, `is_public=1`, `parent_image_id=NULL`).
     - When `item` declares a linked video (`video_url` / `video_asset_id`):
       - Resolve source file from `_SHOWCASE_MEDIA_DIR / Path(str(item["video_url"])).name`.
       - Copy via `_copy_if_needed` to `safe_resolve_asset_file_path(repo.media_dir, "videos", pub_video_filename)`.
       - Upsert `media_assets` row with `id = pub_video_id`, `owner_id = NULL`, `entity_scope = 'world'`, `media_type = 'video'`, `role = 'linked_video'`, `filename = pub_video_filename`, `label = item.get("label") or ""`, `mime_type = item.get("video_mime_type") or "video/mp4"`, `byte_size = video_byte_size`, `is_public = 1`, `seed_key = SHOWCASE_WORLD_SEED_KEY`, `parent_image_id = pub_id`, `duration_ms`, `width`, `height`.
       - Handle `ON CONFLICT(id)` and `parent_image_id` uniqueness cleanly (`WHERE parent_image_id IS NOT NULL`) so repeated startups are strictly idempotent.
3. **Hydration Verification:**
   - Because [`WorldsMixin._resolve_world_media_items`](../../../backend/app/db/repos/worlds.py#L1396-L1437) already calls `self.get_linked_videos_map(conn, ...)` and [`_hydrate_entities_media`](../../../backend/app/db/repos/worlds.py#L1440-L1464) populates `video_url` and `video_mime_type` onto containers/locations, linking `pub_v2_vid_neo_veridia` to `pub_v2_wmed_28416ce9b1` automatically hydrates:
     - `WorldRecord.media[0]` (`video_asset_id`, `video_url`, `video_mime_type`, `video_byte_size`)
     - Container *Neo-Veridia* (`video_url`, `video_mime_type`)
     - Turn-1 [`FirstVisitMediaItem`](../../../backend/app/db/repos/arrival_descriptions.py#L160-L198) in [`turns.py`](../../../backend/app/db/repos/turns.py#L1093-L1101)

### FR-3: Idempotent `v1 → v2` Upgrade Migration for Existing Databases
When [`ensure_public_showcase_media`](../../../backend/app/db/seed.py#L89) runs on an existing database containing `v1` seeded entities (`pub_v1_*` / `/api/media/public/v1/characters/kira_vance/...`):
1. **Migrate World Media References (`pub_v1_wmed_* → pub_v2_wmed_*`):**
   - Rewrite `world_media_links.media_id` (`pub_v1_wmed_*` → `pub_v2_wmed_*`, avoiding duplicate PK errors if `pub_v2_*` already exists).
   - Rewrite `location_containers.image_media_id` and `location_nodes.image_media_id` from `pub_v1_wmed_*` to `pub_v2_wmed_*`.
   - Rewrite matching `media_id` and `image_url` (`pub_v1_wmed_*` → `pub_v2_wmed_*`) inside `turns.post_turn_json` (`first_visit_media`) so existing campaign transcripts immediately resolve the watermark-free `v2` images and linked video via [`_filter_deleted_turn_media`](../../../backend/app/db/repos/turns.py#L1055-L1103).
   - Bump `worlds.seed_version = 2` for rows where `seed_key = SHOWCASE_WORLD_SEED_KEY` and `seed_version < 2` (preserving `seed_modified` and any user edits/label overrides).
2. **Migrate Public Character URLs (`/api/media/public/v1/characters/kira_vance/... → .../v2/...`):**
   - Rewrite `/api/media/public/v1/characters/kira_vance/` → `/api/media/public/v2/characters/kira_vance/` in `characters.portraits_json`, `characters.gallery_json`, and `character_versions.portraits_json` / `gallery_json`, and bump `seed_version = 2` where `seed_key = SHOWCASE_CHARACTER_SEED_KEY` and `seed_version < 2`.
3. **Clean Up Obsolete `pub_v1_*` Showcase Artifacts:**
   - After references are migrated, delete legacy `pub_v1_wmed_*` rows from `media_assets` and unlink stale `pub_v1_wmed_*.webp` files under `worlds/images/` and stale `media/public/v1/characters/kira_vance/` files (if present) so orphan sweeps and disk usage remain tidy.
   - Ensure migration is wrapped in a single DB transaction and is safe/no-op on fresh databases or repeated restarts.

### FR-4: UI Quota Hint & Regression Tests
1. **Optional Minor UI Clarification ([`WorldMediaTab.tsx`](../../../frontend/src/components/world/WorldMediaTab.tsx#L545-L548)):**
   - On `item.is_public` cards that display byte size + linked video size, append a subtle `Built-in` / `No quota` indicator (or keep existing formatting if covered by tests) so users inspecting the showcase video see it does not consume their private storage quota.
2. **Automated Tests:**
   - Update [`backend/tests/test_showcase_seeding_and_public_media.py`](../../../backend/tests/test_showcase_seeding_and_public_media.py):
     - Update versioned assertions (`pub_v2_`, `/api/media/public/v2/...`, `SHOWCASE_SEED_VERSION == 2`).
     - Assert `Neo-Veridia` (`w["media"][0]`) and container *Neo-Veridia* have `video_url` (`/api/media/assets/pub_v2_vid_neo_veridia`), `video_mime_type == "video/mp4"`, `video_byte_size == 1948665`, and `GET video_url` returns `200` (including `Range` header support) while `media_bytes_used` remains `0`.
     - Assert Turn-1 arrival on *The Green Lie* includes the `Neo-Veridia` `FirstVisitMediaItem` with `video_url` populated.
     - Verify `POST /api/worlds/{id}/media/videos` with `linked_image_id = pub_v2_wmed_28416ce9b1` is rejected (`400`), `DELETE .../video` on the public video is rejected (`ValueError` / `400`), and `admin/media/purge` + Chloromancer `_sweep_orphan_media_dirs` leave `pub_v2_vid_neo_veridia.mp4` intact on disk and in DB.
     - Verify `.zcc` export (`include_videos=True` vs `include_videos=False`) packages/omits `pub_v2_vid_neo_veridia.mp4` properly and roundtrips cleanly.
     - Add a dedicated **v1 → v2 upgrade test** seeding synthetic `v1` DB rows (`pub_v1_wmed_*`, `v1` character URLs, `turns.post_turn_json` with `pub_v1_wmed_28416ce9b1`), running `ensure_public_showcase_media(repo)`, and asserting clean migration to `v2` + removal of `pub_v1_*` artifacts.
   - Check and update any other tests referencing `pub_v1_` showcase constants if impacted (`test_unified_media_assets.py` and `test_video_uploads_and_governance.py` use synthetic `pub_v1_showcase` / `pub_v1_pad` fixtures independent of `SHOWCASE_SEED_VERSION`, so verify they remain unaffected).

---

## 4. Verification & Acceptance Criteria

- [ ] **Visual & Archive Verification:**
  - All 3 world `.webp` images and `vid_neo_veridia.mp4` are watermark-free; `wmed_28416ce9b1.webp` is `1280×720` matching `vid_neo_veridia.mp4` frame 0.
  - Isolated `.zcc` export + import check (per [`cybercantina-zcc-review`](../../../.agents/skills/cybercantina-zcc-review/SKILL.md)) passes with zero `unsupported_fields` warnings and clean video staging when `import_videos=True`.
- [ ] **Backend Checks:** `cd backend && .venv/bin/ruff check app tests && .venv/bin/tach check` and `backend/.venv/bin/pytest backend/tests` pass with zero failures.
- [ ] **Frontend Checks:** `npm --prefix frontend run arch:check && npm --prefix frontend run build && npm --prefix frontend test` pass with zero failures.
- [ ] **Architecture Docs:** `backend/.venv/bin/python scripts/generate_arch_docs.py --check` passes.
- [ ] **End-User Wiki (`../cybercantina-wiki`):** Update any showcase/media walkthrough notes if they reference *The Green Lie* media behavior (e.g., noting the built-in *Neo-Veridia* showcase video on Turn 1).
