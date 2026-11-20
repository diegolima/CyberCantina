---
feature: image-linked-videos
target_version: 0.24.0
document_type: frd
status: completed
last_updated: 2026-11-20
---

# Feature Requirements Document (FRD)
## Image-Linked Videos, Unified Non-Duplicated Media Store & Admin Media Governance

**Status:** Implemented  
**Target Version:** CyberCantina v0.24.0  
**Depends On:** `0.15.0-world-media-files`, `0.20.0-world-codex`, `0.23.0-persona-character-parity`  
**Scope:**
- Backend Container, Config & Media Processing ([`Dockerfile`](file:///home/diegolima/Git/cybercantina/backend/Dockerfile), [`config.py`](file:///home/diegolima/Git/cybercantina/backend/app/config.py), [`settings_service.py`](file:///home/diegolima/Git/cybercantina/backend/app/providers/settings_service.py), [`media_path.py`](file:///home/diegolima/Git/cybercantina/backend/app/security/media_path.py), [`dependencies.py`](file:///home/diegolima/Git/cybercantina/backend/app/dependencies.py))
- Backend Unified Media Asset Store, Schemas, Migrations & CoW Unification ([`schema.sql`](file:///home/diegolima/Git/cybercantina/backend/app/db/schema.sql), [`schema_init.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/schema_init.py), [`base.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/base.py), [`characters.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/characters.py), [`character_versions.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/character_versions.py), [`personas.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/personas.py), [`worlds.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/worlds.py), [`arrival_descriptions.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/arrival_descriptions.py), [`turns.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/turns.py), [`auth_users.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/auth_users.py), [`purge_inactive.py`](file:///home/diegolima/Git/cybercantina/backend/app/housekeeping/purge_inactive.py))
- Backend Routers, Admin Controls & `.zcc` Packaging ([`worlds.py` router](file:///home/diegolima/Git/cybercantina/backend/app/routers/worlds.py), [`characters.py` router](file:///home/diegolima/Git/cybercantina/backend/app/routers/characters.py), [`personas.py` router](file:///home/diegolima/Git/cybercantina/backend/app/routers/personas.py), [`settings.py` router](file:///home/diegolima/Git/cybercantina/backend/app/routers/settings.py), [`admin_housekeeping.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/admin_housekeeping.py), [`import_export.py` schema](file:///home/diegolima/Git/cybercantina/backend/app/schemas/import_export.py), [`import_export_service.py`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py))
- Frontend Types, API Clients, Media Tabs, Lightbox Playback, Import/Export & Admin UI ([`types/`](file:///home/diegolima/Git/cybercantina/frontend/src/types/index.ts), [`api/`](file:///home/diegolima/Git/cybercantina/frontend/src/api/index.ts), [`ImageLightboxModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/shared/ImageLightboxModal.tsx), [`ArrivalDescriptionCards.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/ArrivalDescriptionCards.tsx), [`MapDetailsDrawer.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDetailsDrawer.tsx), [`WorldMediaTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldMediaTab.tsx), [`CharacterMediaTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/character/CharacterMediaTab.tsx), [`PersonaMediaTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/PersonaMediaTab.tsx), [`CampaignCharacterMediaTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/inspector/campaignCharacter/CampaignCharacterMediaTab.tsx), [`CodexCharacterDetail.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/CodexCharacterDetail.tsx), [`ExportBundleModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ExportBundleModal.tsx), [`ImportPreviewModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ImportPreviewModal.tsx), [`AdminServerConfigTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AdminServerConfigTab.tsx))
- End-User Documentation (`../cybercantina-wiki`) & Automated Tests (`backend/tests/`, `frontend/src/`)

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
1. **Static Media Only:** Personas, Characters, and Worlds support WebP images (portraits, photo albums, and world scene visuals), but cannot attach short motion clips to enrich location arrivals, map inspection, or character/persona galleries.
2. **Fragmented, Duplicated Media Ownership:** Currently, **Worlds** use a shared `world_media` table with immediate hard-delete quota reclamation, whereas **Characters** duplicate entire media directories via `shutil.copytree` on every Copy-on-Write (CoW) fork ([`base.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/base.py#L404-L420)) and **Personas** retain deleted disk files whenever `campaigns.persona_snapshot_json` references them. Duplicating multi-megabyte videos across CoW forks or keeping orphaned files indefinitely is unsustainable under tight server storage quotas.
3. **Missing Server Governance & Safe Archive Controls:** Administrators have a global `user_media_quota_mb` limit, but lack fine-grained switches to disable image/video uploads, a configurable per-video size cap, or a purge action to reclaim server disk space across non-built-in media. Meanwhile, `.zcc` exports and imports assume WebP-only images under a 100 MB uncompressed ceiling and lack granular image/video selection.

### 1.2 Proposed Solution
1. **1:1 Image-Linked Videos (MP4 & WebM):**
   - Allow users to upload **MP4** or **WebM** videos to **Personas**, **Characters**, and **Worlds**—either linked to an existing album/world image (replacing any previously linked video with confirmation) or auto-generating a new `.webp` album/world image from the video's first frame via server-side `ffmpeg`/`ffprobe`.
   - Enforce a strict **1:1 extension model**: videos cannot exist detached from an image. Users can delete a video while retaining its parent image, whereas deleting a parent image warns and cascade-deletes its linked video.
2. **Unified Shared Asset Store & Non-Duplicated Immediate-Delete Model:**
   - Consolidate user and public media files under a shared `media_assets` table (asset-ID-keyed store) used across Worlds, Characters, and Personas.
   - Eliminate `_copy_character_media` CoW file duplication and snapshot-pinned file retention for private user media: CoW forks and campaign snapshots reference shared asset IDs, deleting private media frees quota immediately (with active-campaign impact warnings), and swapping an image's linked video updates the shared image-to-video association so running campaigns see the replacement (or break gracefully if deleted). Built-in (`is_public = 1`) assets remain exempt from user quota and physical deletion.
3. **Immersive "Play Once" Lightbox Experience:**
   - Whenever any linked image is opened in expanded mode during a campaign—clicking a First-Visit Arrival Card, a Location Visual in `MapDetailsDrawer`, or an album image in World Codex / Campaign Character Inspector / Persona detail—[`ImageLightboxModal`](file:///home/diegolima/Git/cybercantina/frontend/src/components/shared/ImageLightboxModal.tsx) renders the still image immediately while buffering the video, plays the video **once** (muted by default with an unmute control), transitions back to the still image when finished, and exposes a subtle corner/footer **Replay** button.
4. **Hardened Streaming Upload Pipeline & Quota Accounting:**
   - Install `ffmpeg` and `ffprobe` in [`Dockerfile`](file:///home/diegolima/Git/cybercantina/backend/Dockerfile) for container/codec probing and first-frame extraction.
   - Stream uploads to a temporary staging directory, enforce the admin-configured size cap mid-stream (default **15 MB**), guarantee cleanup of partial/failed uploads, and compute quota deltas (`new_bytes - replaced_bytes`) so replacing a larger video with a smaller one succeeds even at quota.
5. **`.zcc` Selective Video Packaging & Admin Controls:**
   - Add opt-in `"Include videos"` (default off) with per-video selection to [`ExportBundleModal`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ExportBundleModal.tsx), and `"Import media"` → `"Images"` / `"Videos"` controls to [`ImportPreviewModal`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ImportPreviewModal.tsx).
   - Add fine-grained upload disable toggles (Images / Videos, admins exempt), configurable max video upload size (MB), and fine-grained non-built-in media purge controls (Images purge automatically checks & cascades to Videos) in [`AdminServerConfigTab`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AdminServerConfigTab.tsx).

---

## 2. Scope, Boundaries & Core Invariants

1. **1:1 Image-Extension Invariant (No Orphan Videos):**
   - Every video asset **must** be linked to exactly one parent image asset (a `GalleryImage` on a Character or Persona, or an `"image"` `WorldMediaItem` on a World). Multiple videos cannot link to the same image; character/persona **portraits** (`portraits_json` / `portrait_url`) remain image-only and do **not** link videos.
   - Videos cannot be unlinked into standalone items. Users may **delete a video** (preserving its parent image, even if that image was extracted from the video's first frame), **replace a video** (deleting the previous video after confirmation), or **delete the parent image** (cascade-deleting the linked video after confirmation).
2. **Unified Non-Duplicated, Immediate-Delete Model (Built-Ins Exempt):**
   - Physical files for images and videos are **never** duplicated on CoW character/world forks or campaign creation.
   - Deleting any private (`is_public = 0`) image or video immediately deletes its `media_assets` record and disk file, reclaiming user quota immediately—even if referenced by active campaigns. Swapping a video on a parent image updates that image asset's linked video in place, replacing it in running campaigns as well.
   - Built-in showcase media (`is_public = 1` / `/api/media/public/...`) never counts toward user storage quotas and is never physically deleted by user edits, user deletes, or admin non-built-in media purges (user edits only detach references on the user's CoW fork).
   - Missing or purged media in running campaigns must degrade silently: video playback falls back to the still image if only the video is gone, and missing images hide cleanly without error banners or broken `<img>` icons.
3. **Zero LLM Context / Prompt Injection:**
   - Video metadata, filenames, labels, MIME types, durations, and URLs **never** enter Zone 1–4 prompts, VectorStore embeddings, or Clerk/Actor context.
4. **No Partial Uploads Left Behind:**
   - Upload routes must never stream directly into active media directories or write DB rows before validation, first-frame extraction, and quota locking succeed. Any aborted stream, probe failure, quota rejection, DB error, or cancellation must delete all temporary/partial files in `finally` blocks, and Chloromancer housekeeping must sweep stale staging files older than `ORPHAN_MEDIA_GRACE_SECONDS`.
5. **Security, Path Confinement & Architecture Boundaries:**
   - All asset paths must route through [`media_path.py`](file:///home/diegolima/Git/cybercantina/backend/app/security/media_path.py) (`os.path.normpath(os.path.abspath(...))` + `os.path.realpath(...)` confinement), all dynamic log fields through [`log_sanitize.py`](file:///home/diegolima/Git/cybercantina/backend/app/security/log_sanitize.py), and all quota-checked writes under `get_user_media_lock(user_id)`.
   - Backend must pass `ruff check`, `tach check`, and `pytest`; frontend must pass `arch:check`, `build`, and `test`; architecture docs must pass `generate_arch_docs.py --check`.

---

## 3. Functional Requirements

### FR-1: Unified Shared Media Asset Store & Migration

1. **Database Schema ([`schema.sql`](file:///home/diegolima/Git/cybercantina/backend/app/db/schema.sql), [`schema_init.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/schema_init.py)):**
   - Introduce a unified `media_assets` table storing every persisted image and video asset once by `id`:
     - `id TEXT PRIMARY KEY` (e.g. `img_<hex>`, `por_<hex>`, `wmed_<hex>`, `vid_<hex>`)
     - `owner_id TEXT NULL REFERENCES users(id) ON DELETE CASCADE`
     - `entity_scope TEXT NOT NULL CHECK (entity_scope IN ('character', 'persona', 'world'))`
     - `media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video'))`
     - `role TEXT NOT NULL DEFAULT 'album' CHECK (role IN ('portrait', 'album', 'world_scene', 'linked_video'))`
     - `filename TEXT NOT NULL`
     - `mime_type TEXT NOT NULL` (`image/webp`, `video/mp4`, `video/webm`)
     - `byte_size INTEGER NOT NULL DEFAULT 0`
     - `is_public INTEGER NOT NULL DEFAULT 0`
     - `parent_image_id TEXT NULL REFERENCES media_assets(id) ON DELETE CASCADE` (for `media_type = 'video'`; enforced 1:1 via `UNIQUE(parent_image_id) WHERE parent_image_id IS NOT NULL`)
     - `duration_ms INTEGER NULL` (for videos, populated from `ffprobe`)
     - `width INTEGER NULL`, `height INTEGER NULL`
     - `created_at TEXT NOT NULL`
   - Retain `world_media_links` (linking `worlds.id` -> `media_assets.id`, or migrating existing `world_media` rows into `media_assets` seamlessly on startup) so CoW world forks share `media_assets` rows while preserving per-world `sort_order` and `label_override`.
   - Idempotent startup migration in `schema_init.py`:
     - Migrate existing `world_media` rows into `media_assets` (keeping existing IDs and paths resolving cleanly).
     - Scan existing non-public `characters` (`portraits_json`, `gallery_json`) and `personas` (`portrait_url`, `gallery_json`) rows, register deduplicated `media_assets` rows pointing to their canonical files, and rewrite entity JSON / snapshot URLs to the unified asset endpoint `/api/media/assets/{asset_id}` (keeping legacy route aliases working if needed during transition).
2. **Unified Filesystem Layout & Serving ([`media_path.py`](file:///home/diegolima/Git/cybercantina/backend/app/security/media_path.py), media router):**
   - Store unified private assets under `{media_dir}/assets/{category}/{filename}` where `category IN ("images", "videos")` and staging uploads under `{media_dir}/.staging/` (never directly web-accessible). Preserve `{media_dir}/public/...` for immutable built-in assets.
   - Expose `GET /api/media/assets/{asset_id}`:
     - Authorize access if `asset.is_public == 1`, `asset.owner_id == current_user.id`, or `current_user.id` owns a campaign/world/character/persona referencing `asset_id` (returning `404` otherwise).
     - Serve via `FileResponse` with the exact validated `media_type` (`image/webp`, `video/mp4`, or `video/webm`), `Cache-Control: private, max-age=86400` (safe because every asset ID/filename is immutable; swapping a video mints a **new** `vid_<hex>` `asset_id` and deletes the old `vid_<hex>` row/file), and HTTP `Range` support for smooth video buffering/seeking.
3. **Unified Non-Duplicated CoW & Immediate-Delete Semantics:**
   - **Characters ([`character_versions.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/character_versions.py), [`characters.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/characters.py)):**
     - Remove `_copy_character_media` duplication on CoW forks and version restores. CoW forks copy `portraits` / `gallery` asset references only; deleting a private character portrait or album image (when not referenced by another character owned by the user, or directly owned by that character) deletes the `media_assets` row (cascading any linked video) and unlinks its disk file immediately.
     - Pre-delete impact check (`GET /api/characters/{character_id}/gallery/{image_id}/impact` or inline count) reports how many active campaigns reference the character/image (and whether a linked video will also be deleted) so the UI displays a confirmation warning matching `WorldMediaTab`.
   - **Personas ([`personas.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/personas.py)):**
     - Deleting a private persona portrait, gallery image, or persona deletes the user-owned `media_assets` rows (cascading linked videos) and unlinks files immediately, after warning if active campaigns' `persona_snapshot_json` reference them.
   - **Worlds ([`worlds.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/worlds.py)):**
     - Preserve existing non-duplicated CoW link semantics (`world_media_links`) and immediate hard-delete behavior on `DELETE /api/worlds/{world_id}/media/{media_id}` (which now also cascade-deletes any linked video via `parent_image_id`).
   - **Dynamic Video Resolution for Campaigns & Arrival Cards ([`arrival_descriptions.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/arrival_descriptions.py), [`turns.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/turns.py)):**
     - Hydrate `video_asset_id` / `video_url` / `video_mime_type` / `video_byte_size` dynamically at read time from `media_assets` (`WHERE parent_image_id = ?`) onto `GalleryImage`, `WorldMediaItem`, `LocationNode`/`LocationContainer` image metadata, and `FirstVisitMediaItem` (rather than freezing stale video URLs into `turn_nodes.first_visit_media` or `persona_snapshot_json`).
     - Consequently:
       - Removing a video outside a campaign immediately causes running campaigns to lose the video (falling back cleanly to the image).
       - Swapping a linked video on an image outside a campaign creates a new video `media_assets` row linked to the same `parent_image_id` and deletes the old video row/file—so running campaigns immediately play the swapped video on next load!
   - **Quota Accounting ([`dependencies.py`](file:///home/diegolima/Git/cybercantina/backend/app/dependencies.py#L463-L487)):**
     - Simplify `get_user_media_usage_bytes(repo, user_id)` to sum `byte_size` (verified against files on disk) across `media_assets WHERE owner_id = ? AND is_public = 0`. Zero double-counting across CoW forks or campaign snapshots.

---

### FR-2: Video Upload Pipeline, `ffmpeg`/`ffprobe` Extraction & Quota Swap Safety

1. **Container Dependencies ([`backend/Dockerfile`](file:///home/diegolima/Git/cybercantina/backend/Dockerfile)):**
   - Install `ffmpeg` (which provides both `ffmpeg` and `ffprobe`) via `apt-get` in `backend/Dockerfile` (`--no-install-recommends`), keeping image overhead minimal.
   - Document `ffmpeg`/`ffprobe` as a required system binary for local non-Docker backend runs; if missing at runtime, video upload endpoints return `503 Service Unavailable` with a clear admin-facing detail message rather than crashing app startup.
2. **Accepted Formats & Admin Size Limit ([`config.py`](file:///home/diegolima/Git/cybercantina/backend/app/config.py)):**
   - Only **MP4** (`.mp4`, H.264/AVC or H.265/HEVC/AV1 inside `mp4`/`mov,mp4,m4a,3gp,3g2,mj2` reported by `ffprobe`, strictly normalized/verified as MP4 brand—reject QuickTime `.mov`/`.mkv`/`.avi`/`.gif` uploads) and **WebM** (`.webm`, VP8/VP9/AV1 inside `matroska,webm` with WebM doctype) are accepted. Prefer H.264 MP4 or VP8/VP9/AV1 WebM; reject non-video streams or corrupt headers with `400 Bad Request`.
   - Add `max_video_upload_mb: float = Field(default=15.0, ge=1.0, le=500.0)` to `AppSettings` (exposed via `/api/settings` to all authenticated users so upload UIs can display the exact server limit).
3. **Streaming Upload, Validation & Zero-Leftover Guarantee:**
   - **Step 1 — Authorization & Upload-Toggle Gate:** Verify ownership/write permission on target entity (`character_id`, `persona_id`, `world_id`), reject default `'User'` persona (`400`), verify target `linked_image_id` (if provided) exists on that entity and is not a `is_public = 1` immutable asset (or if attaching a private video to a built-in image on a forked entity is disallowed—see note below; clarify: users may only link videos to their own non-public album/world images, or upload a standalone video which extracts a new private image).
     - *Rule clarification:* If a user tries to link a new video to an existing `is_public = 1` image on a forked world/character, reject with `400` (*"Cannot attach private video to shared built-in artwork; upload the video standalone to create an editable album entry"*), keeping built-in assets completely untouched.
   - **Step 2 — Stream to Temp Staging File:** Read `UploadFile` in 64 KB chunks into a unique temp file under `{media_dir}/.staging/`. Track cumulative bytes; if bytes exceed `max_video_upload_mb * 1024 * 1024`, abort immediately with `413 Payload Too Large` without reading the rest of the stream into RAM or disk.
   - **Step 3 — `ffprobe` Inspection & First-Frame Extraction:**
     - Run `ffprobe -v error -print_format json -show_format -show_streams` (with subprocess timeout, e.g. 15s) to validate format (`mp4` / `webm`), confirm at least one video stream with positive dimensions/duration, extract `duration_ms`, `width`, `height`, and canonical MIME (`video/mp4` or `video/webm`).
     - If `linked_image_id` is **omitted**: run `ffmpeg` (`-frames:v 1`) to extract the first video frame to a temp PNG/BMP, then normalize it via existing `render_webp_bytes(..., square_crop=False, max_size=1920)` (and `max_size=1920` WebP) so the generated album/world image matches native photo album quality and size efficiency.
   - **Step 4 — Atomic Quota Check & Replacement Delta:**
     - Acquire `get_user_media_lock(user.id)`.
     - Compute `replaced_bytes`: if `linked_image_id` already has a linked video (`old_video`), `replaced_bytes = old_video.byte_size`.
     - Compute `added_bytes = video_bytes + (extracted_image_bytes if new_image else 0)`.
     - Compute `net_added = added_bytes - replaced_bytes`.
     - Enforce `if quota is not None and net_added > 0 and (used + net_added) > quota: raise HTTPException(413, ...)`. (Replacing a 14 MB video with a 6 MB video yields `net_added = -8 MB <= 0` and succeeds even at 100% quota.)
   - **Step 5 — Commit & Guaranteed Cleanup:**
     - Move staged video (and extracted WebP, if any) atomically to `{media_dir}/assets/videos/` and `{media_dir}/assets/images/` via `os.replace`.
     - Update DB (`media_assets` + entity `gallery_json` / `world_media_links`). If replacing an existing video, delete the old video DB row and unlink the old video file *after* the new files and DB commit succeed.
     - In `try ... finally`, unlink all `.staging/` temp files (and roll back newly moved target files if DB commit fails), ensuring **zero** partial uploads remain on disk after errors, disconnects, or `CancelledError`.

---

### FR-3: Video Upload, Replacement & Deletion Across Personas, Characters, and Worlds

1. **API Endpoints:**
   - **Worlds ([`worlds.py` router](file:///home/diegolima/Git/cybercantina/backend/app/routers/worlds.py)):**
     - `POST /api/worlds/{world_id}/media/videos` (`file: UploadFile`, `label: str = Form("")`, `linked_image_id: str | None = Form(None)`) → `WorldRecord` (CoW-forks `world_id` if campaigns use it when adding a *new* image-video pair, whereas attaching/replacing a video on an existing `linked_image_id` updates the shared `media_assets` link directly).
     - `DELETE /api/worlds/{world_id}/media/{media_id}/video` → `WorldRecord` (deletes only the linked video asset while keeping the parent image `media_id`, even if `media_id` was created by a video upload).
     - `DELETE /api/worlds/{world_id}/media/{media_id}` → `WorldRecord` (deletes the image and cascade-deletes its linked video). `GET /api/worlds/{world_id}/media/{media_id}/impact` includes `has_linked_video: bool` and `video_byte_size: int`.
   - **Characters ([`characters.py` router](file:///home/diegolima/Git/cybercantina/backend/app/routers/characters.py)):**
     - `POST /api/characters/{character_id}/gallery/videos` (`file: UploadFile`, `caption: str = Form("")`, `linked_image_id: str | None = Form(None)`) → `CharacterRecord`.
     - `DELETE /api/characters/{character_id}/gallery/{image_id}/video` → `CharacterRecord` (deletes only the linked video while preserving the album image).
     - `DELETE /api/characters/{character_id}/gallery/{image_id}` → `CharacterRecord` (deletes the image and cascade-deletes its linked video; includes pre-delete impact endpoint `GET /api/characters/{character_id}/gallery/{image_id}/impact`).
   - **Personas ([`personas.py` router](file:///home/diegolima/Git/cybercantina/backend/app/routers/personas.py)):**
     - `POST /api/personas/{persona_id}/gallery/videos` (`file: UploadFile`, `caption: str = Form("")`, `linked_image_id: str | None = Form(None)`) → `PersonaRecord`.
     - `DELETE /api/personas/{persona_id}/gallery/{image_id}/video` → `PersonaRecord` (deletes only the linked video while preserving the album image).
     - `DELETE /api/personas/{persona_id}/gallery/{image_id}` → `PersonaRecord` (deletes the image and cascade-deletes its linked video; includes pre-delete impact endpoint `GET /api/personas/{persona_id}/gallery/{image_id}/impact`).
2. **Frontend Media Library UI ([`WorldMediaTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldMediaTab.tsx), [`CharacterMediaTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/character/CharacterMediaTab.tsx), [`PersonaMediaTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/PersonaMediaTab.tsx)):**
   - Add an **Upload Video** control (`accept="video/mp4,video/webm,.mp4,.webm"`) in each element's Media/Photo Album tab alongside the image upload controls, clearly displaying the allowed formats and configured size limit (e.g., `"MP4 / WebM · Max 15 MB"`).
   - Provide an optional **"Link to existing photo"** selector (default `"Create new album photo from first frame"`):
     - Listing eligible non-public album/world images.
     - If the selected image **already has a linked video**, show an explicit pre-upload confirmation warning (*"This image already has a linked video. Uploading a new video will permanently delete the previous video across this asset and any running campaigns. Continue?"*) before sending the upload request.
   - On album/world image cards that have a linked video:
     - Display a subtle **video badge** (e.g., `Film` / `Play` pill + video byte size) on the thumbnail so users can immediately distinguish motion-enabled images from static ones.
     - Clicking the card opens [`ImageLightboxModal`](file:///home/diegolima/Git/cybercantina/frontend/src/components/shared/ImageLightboxModal.tsx) with play-once behavior (previewable in editor as well as campaigns).
     - Provide two distinct delete actions: **"Remove Video"** (keeps the image) and **"Delete Image"** (warns explicitly that both the image and its linked video will be permanently deleted, plus active campaign count if `> 0`). Do **not** provide an "Unlink video" action.

---

### FR-4: Expanded Campaign Playback (`ImageLightboxModal`) & View Surfaces

1. **Unified Lightbox Video Playback ([`ImageLightboxModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/shared/ImageLightboxModal.tsx)):**
   - Extend `ImageLightboxModalProps` with optional `videoUrl?: string | null` and `videoMimeType?: string | null` (plus per-slide video fields when navigating arrays).
   - **Immediate Still Render + Smooth Buffer Transition:**
     - Always render the still `<img>` immediately at full visibility when the lightbox opens or changes slides.
     - When `videoUrl` is present and the play-once cycle hasn't completed for the active slide, mount a `<video>` element overlaid on the still image (`playsInline`, `autoPlay`, `muted` by default, `preload="auto"`), keeping it hidden (`opacity: 0`) until `onCanPlay` / `onPlaying` fires, then fading it in over the still image—preventing black frames or layout jumps while buffering.
   - **Play-Once Lifecycle & Replay:**
     - Do **not** set `loop`. When `onEnded` fires, fade/hide the `<video>` back to the underlying still `<img>` and mark the current slide as `hasPlayed = true`.
     - Once finished (or if autoplay is blocked), display a subtle **"Replay"** icon/pill button in a corner of the media frame or in the bottom caption bar (never centered over the image) that restarts the video from `currentTime = 0`.
   - **Mute / Unmute Toggle:**
     - Start every video **muted** (`muted = true`). Render a subtle **Mute / Unmute** toggle button in the corner/footer bar whenever `videoUrl` is present (and show an error fallback back to the still image if the video fails to load/decode).
   - **Slide Switching (`onPrev` / `onNext`):**
     - Key or reset video playback state (`isPlaying`, `hasPlayed`, `isBuffered`, `isMuted` or persistent mute preference) whenever `url` / `videoUrl` changes so switching slides immediately stops the previous `<video>` and starts play-once for the newly focused slide (if it has a linked video).
2. **Campaign Playback Entry Points:**
   - Wire `videoUrl` / `videoMimeType` into every campaign expanded-image surface using `ImageLightboxModal`:
     1. **First-Visit Arrival Cards** ([`ArrivalDescriptionCards.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/ArrivalDescriptionCards.tsx)) — `FirstVisitMediaItem` carries hydrated `video_url` / `video_mime_type` and shows a subtle video indicator badge on slides with video.
     2. **Expanded Map Location & Container Visuals** ([`MapDetailsDrawer.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDetailsDrawer.tsx#L571-L659)) — visited location/container `Location Visual` shows a subtle video badge and passes `videoUrl` / `videoMimeType` to `ImageLightboxModal` on click.
     3. **World Codex Character & Persona Galleries** ([`WorldCodexTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldCodexTab.tsx), [`CodexCharacterDetail.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/CodexCharacterDetail.tsx)) — character and persona album thumbnails display the video badge and pass `videoUrl` / `videoMimeType` when opened in `ImageLightboxModal` (supporting `onPrev`/`onNext` slide navigation).
     4. **Campaign Character Inspector** ([`CampaignCharacterMediaTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/inspector/campaignCharacter/CampaignCharacterMediaTab.tsx)) — album thumbnails display the video badge and pass `videoUrl` / `videoMimeType` into `ImageLightboxModal`.

---

### FR-5: `.zcc` Export & Import Media Controls

1. **Export Bundle Modal & Backend ([`ExportBundleModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ExportBundleModal.tsx), [`import_export.py` schema](file:///home/diegolima/Git/cybercantina/backend/app/schemas/import_export.py), [`import_export_service.py`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py)):**
   - Add `include_videos: bool = False` and `selected_video_ids: list[str] | None = None` to `ExportBundleRequest` (and `include_videos: bool = False` on `ExportCharacterOptions` / `ExportWorldOptions`).
   - In `ExportBundleModal`:
     - Add an **"Include videos"** checkbox (default: **unchecked**).
     - When toggled **on**, discover all videos belonging to the currently selected Characters, Worlds, and Personas, **auto-select all** of those videos by default, and render a scrollable per-video checklist showing entity name, image label/caption, and video file size (plus estimated total video payload size).
     - If an entity is deselected from the export bundle, omit its videos from selection/export.
     - Package selected videos into the `.zcc` ZIP archive (preserving parent image linkage metadata in the entity JSON / manifest) without passing video bytes through `render_webp_bytes`.
2. **Import Preview Modal & Backend ([`ImportPreviewModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ImportPreviewModal.tsx), [`import_export.py` schema](file:///home/diegolima/Git/cybercantina/backend/app/schemas/import_export.py), [`import_export_service.py`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py)):**
   - Extend `ImportInspectResponse` / `ZccManifestContents` with media breakdown counts and byte totals (`images_count`, `images_bytes`, `videos_count`, `videos_bytes`, plus `media_upload_restrictions` warnings if server settings block images or videos for standard users).
   - Extend `ImportCommitRequest` with `import_images: bool = True` and `import_videos: bool = True`.
   - In `ImportPreviewModal`, render a hierarchical media selection group when the archive contains media:
     - Parent **"Import media"** checkbox (`checked` when either Images or Videos is checked; `indeterminate` if only Images is checked when Videos exist; toggling it checks/unchecks both `import_images` and `import_videos`).
     - Child **"Images"** checkbox (`import_images`).
     - Child **"Videos"** checkbox (`import_videos`) — **checking "Videos" automatically checks "Images"**; **unchecking "Images" automatically unchecks "Videos"** (preventing orphan videos).
   - **Disabled-Upload Policy on Import:**
     - **Admin users (`role == "admin"`) are exempt** from image/video upload disable settings on both direct uploads and `.zcc` / SillyTavern imports.
     - For standard users, if image or video uploads are disabled in `AppSettings`:
       - Surface clear warning(s) during `inspect_import` and `commit_import` (`ImportCommitResponse.warnings` / `message`), skip importing the disallowed media category (and skip videos if images were disabled/skipped), and import all allowed entities and allowed media cleanly without failing the whole `.zcc` import.
   - **Large-Archive & Quota Streaming Safety:**
     - Raise or split `import_export_service.py` ZIP limits so video-bearing `.zcc` bundles aren't artificially blocked at 100 MB (e.g., stream video ZIP entries to `.staging/` one file at a time with per-video `max_video_upload_mb` validation and `ffprobe` verification, never loading entire multi-video archives into memory at once), and enforce `get_user_quota_bytes` across kept images + videos atomically.

---

### FR-6: Admin Control Panel Governance & Housekeeping

1. **Runtime Settings ([`config.py`](file:///home/diegolima/Git/cybercantina/backend/app/config.py), [`settings_service.py`](file:///home/diegolima/Git/cybercantina/backend/app/providers/settings_service.py), [`AdminServerConfigTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AdminServerConfigTab.tsx)):**
   - Add to `AppSettings`:
     - `allow_image_uploads: bool = True`
     - `allow_video_uploads: bool = True`
     - `max_video_upload_mb: float = Field(default=15.0, ge=1.0, le=500.0)`
   - Enforce `allow_image_uploads` and `allow_video_uploads` on all direct upload routes (worlds, characters, personas, SillyTavern card artwork) with `403 Forbidden` for non-admin users (admins exempt), and strip disallowed media with warnings on `.zcc` import.
   - In [`AdminServerConfigTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AdminServerConfigTab.tsx):
     - Add fine-grained toggles to **Disable image uploads** and **Disable video uploads** (noting that administrator accounts are exempt and `.zcc` imports skip disabled media with a warning).
     - Add numeric input for **Max video upload size (MB)** (default `15`).
     - Update existing quota description copy to cover both WebP images and MP4/WebM videos.
2. **Fine-Grained Admin Media Purge ([`admin_housekeeping.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/admin_housekeeping.py), [`AdminServerConfigTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AdminServerConfigTab.tsx)):**
   - Add preview + execute endpoints (admin-only via `require_admin`):
     - `GET /api/admin/media/purge-preview?images=true&videos=true` → returns counts & total bytes of non-built-in (`is_public = 0`) images and videos that will be deleted (including cascade-deleted videos when `images=true`).
     - `POST /api/admin/media/purge` (`{ purge_images: bool, purge_videos: bool }`) → requires at least one flag `true`; if `purge_images=True`, **forces `purge_videos=True` on the backend** so no orphaned videos can remain.
   - Deletes matching `is_public = 0` `media_assets` rows, cleans referencing URLs/IDs (`characters.portraits_json`, `characters.gallery_json`, `personas.portrait_url`, `personas.gallery_json`, `location_nodes.image_media_id`, `location_containers.image_media_id`, `campaigns.persona_snapshot_json`), and unlinks the physical files from disk while leaving all `is_public = 1` / built-in showcase media untouched.
   - In [`AdminServerConfigTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AdminServerConfigTab.tsx):
     - Render checkboxes for **Images** and **Videos** alongside a **"Purge Non-Built-In Media"** action button.
     - Checking **Images** automatically checks (and disables unchecking) **Videos**, displaying a clear inline note: *"Purging images also deletes all linked user videos."*
     - Clicking **Purge** fetches the live preview counts/MB from `/api/admin/media/purge-preview` and requires explicit confirmation before executing.
3. **Chloromancer & Account Cleanup ([`purge_inactive.py`](file:///home/diegolima/Git/cybercantina/backend/app/housekeeping/purge_inactive.py), [`auth_users.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/auth_users.py)):**
   - Update `reset_user_data` and `delete_user` to delete all `media_assets WHERE owner_id = ? AND is_public = 0` and unlink their physical image/video files.
   - Update `_sweep_orphan_media_dirs` to sweep unreferenced files under `{media_dir}/assets/images`, `{media_dir}/assets/videos`, and stale temp files in `{media_dir}/.staging/` older than `ORPHAN_MEDIA_GRACE_SECONDS`.

---

## 4. End-User Documentation & Verification Requirements

1. **Wiki Documentation (`../cybercantina-wiki`):**
   - Update all affected wiki guides (interface/media authoring, campaign viewing/lightbox/map, `.zcc` import/export, admin server config & quotas) to document:
     - Image-linked MP4/WebM video uploads (1:1 attachment, first-frame extraction, replacing/deleting behavior, play-once & mute/replay controls).
     - The unified **non-duplicated, immediate-delete** media model across Worlds, Characters, and Personas—explicitly noting that deleting private images/videos frees quota immediately and breaks them in running campaigns, while swapping a linked video replaces it in running campaigns.
     - Admin upload toggles, max video size, and non-built-in media purge rules.
2. **Automated Verification:**
   - **Backend (`backend/tests/`):**
     - Unified `media_assets` migration, CoW non-duplication across characters/worlds, immediate delete quota reclamation, built-in exemption (`is_public = 1`).
     - Streaming upload size enforcement, zero leftover temp files on error/quota failure/cancel, `ffprobe` MP4/WebM validation (rejecting `.mov`/`.mkv`/corrupt), `ffmpeg` first-frame `.webp` extraction, quota replacement delta (`smaller` replaces `larger` at 100% quota).
     - Admin disable toggles (403 on direct upload, warning+skip on `.zcc` import, admin exemption), admin purge (cascade images→videos, built-ins preserved).
     - `.zcc` export (`include_videos` + `selected_video_ids`) and import (`import_images` / `import_videos` coupling).
   - **Frontend (`frontend/src/`):**
     - Vitest tests for `ImageLightboxModal` (still-first rendering, play-once without loop, mute toggle, corner Replay button, slide-change reset), `ExportBundleModal` video checklist, `ImportPreviewModal` parent/child checkbox coupling, `AdminServerConfigTab` purge checkbox coupling, and Media tab upload/delete warning flows.
   - **CI & Architecture Gates:**
     - `cd backend && .venv/bin/ruff check app tests && .venv/bin/tach check` and `backend/.venv/bin/pytest backend/tests`
     - `npm --prefix frontend run arch:check && npm --prefix frontend run build && npm --prefix frontend test`
     - `backend/.venv/bin/python scripts/generate_arch_docs.py && backend/.venv/bin/python scripts/generate_arch_docs.py --check`
