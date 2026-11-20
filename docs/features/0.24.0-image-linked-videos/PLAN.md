---
feature: image-linked-videos
target_version: 0.24.0
document_type: plan
status: completed
last_updated: 2026-11-20
---

# Implementation Plan
## Image-Linked Videos, Unified Media Asset Store & Admin Media Governance (v0.24.0)

This plan executes [`FRD.md`](file:///home/diegolima/Git/cybercantina/docs/features/0.24.0-image-linked-videos/FRD.md) with the confirmed user requirements:
- **Video limits:** File-size-based only (`max_video_upload_mb`, default `15.0` MB, configurable by admin — no hard duration cap).
- **Accepted formats & codecs:** Strict MP4 (`h264`, `hevc`, `av1`) and WebM (`vp8`, `vp9`, `av1`) validated by `ffprobe` + container header checks (reject `.mov`, `.mkv`, `.avi`, `.gif`, non-web codecs, audio-only, or corrupt files).
- **Unified storage:** Single `media_assets` table & asset-ID-keyed disk store (`{media_dir}/assets/{images,videos}`) with non-duplicated CoW references and immediate hard-delete quota reclamation across Worlds, Characters, and Personas; built-in (`is_public = 1`) showcase media is strictly exempt from quota and deletion.
- **Zero partial uploads:** Stream uploads to `{media_dir}/.staging/` with mid-stream size abort and guaranteed `try/finally` cleanup on all failures/disconnects.

---

## Step 1: Container, Runtime Config, Path Security & Tach Boundaries
1. [`backend/Dockerfile`](file:///home/diegolima/Git/cybercantina/backend/Dockerfile): Install `ffmpeg` (includes `ffprobe`) via `apt-get install --no-install-recommends`.
2. [`backend/app/config.py`](file:///home/diegolima/Git/cybercantina/backend/app/config.py) & [`settings_service.py`](file:///home/diegolima/Git/cybercantina/backend/app/providers/settings_service.py): Add and persist `allow_image_uploads: bool = True`, `allow_video_uploads: bool = True`, and `max_video_upload_mb: float = 15.0` (`ge=1.0, le=500.0`). Keep visible in `_redacted_for_user` in [`settings.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/settings.py).
3. [`backend/app/security/media_path.py`](file:///home/diegolima/Git/cybercantina/backend/app/security/media_path.py): Add two-step lexical + `realpath` confinement helpers for `{media_dir}/assets/{images,videos,audio}` and `{media_dir}/.staging/`.
4. [`backend/tach.toml`](file:///home/diegolima/Git/cybercantina/backend/tach.toml): Allow `app.services` to depend on `app.security`.

## Step 2: Streaming Video Processor (`backend/app/services/video_processor.py`)
- Stream uploads in 64 KB chunks to `.staging/` with mid-stream `max_bytes` abort (`413`) and `BaseException` cleanup (`CancelledError` safe).
- Validate MP4/WebM headers + `ffprobe` format/streams/codecs + positive dimensions (`400` on invalid/unsupported, `503` if `ffmpeg`/`ffprobe` missing).
- Extract first video frame via `ffmpeg` and normalize via `render_webp_bytes(..., square_crop=False, max_size=1920)`.

## Step 3: Unified `media_assets` Store, Migrations & Quota Unification
1. [`backend/app/db/schema.sql`](file:///home/diegolima/Git/cybercantina/backend/app/db/schema.sql) & [`schema_init.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/schema_init.py): Introduce `media_assets` with unique `parent_image_id` 1:1 constraint and idempotent startup migration from legacy `world_media` + private character/persona URLs.
2. `backend/app/db/repos/media_assets.py` (`MediaAssetsMixin`): Asset CRUD, 1:1 linked-video swap/delete, immediate hard-delete with cascade, campaign impact queries across Worlds/Characters/Personas, dynamic read hydration, user private asset listing, and admin purge preview/execute (Images purge forces Videos cascade).
3. Unify `characters.py`, `character_versions.py`, `personas.py`, `campaigns.py`, `worlds.py`, `world_locations.py`, `turns.py`, `seed.py`, `auth_users.py`, `purge_inactive.py`, and `dependencies.py` (`get_user_media_usage_bytes`, `enforce_upload_policy`, `enforce_quota_and_commit_staged_files`).

## Step 4: Schemas, Routers & Streaming `.zcc` Import/Export
1. Update schemas ([`character.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/character.py), [`world.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/world.py), [`turn.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/turn.py), [`import_export.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/import_export.py), [`housekeeping.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/housekeeping.py)).
2. Create `backend/app/routers/media.py` (`GET /api/media/assets/{asset_id}`, `GET /api/admin/media/purge-preview`, `POST /api/admin/media/purge`) and register in [`main.py`](file:///home/diegolima/Git/cybercantina/backend/app/main.py).
3. Add video upload/delete + impact endpoints to `worlds.py`, `characters.py`, `personas.py` and enforce `enforce_upload_policy`.
4. Update `import_export.py` & `import_export_service.py` for streaming `.zcc` export (`include_videos`, `selected_video_ids`) and import (`import_images`, `import_videos`, disabled-media warnings/skip, per-video `ffprobe` + quota check).

## Step 5: Frontend Implementation
1. Update TypeScript contracts (`frontend/src/types/`) and API clients (`frontend/src/api/`).
2. Upgrade [`ImageLightboxModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/shared/ImageLightboxModal.tsx) with instant still render, play-once `<video>` overlay (muted default + unmute button), corner/footer Replay button, and slide-change reset.
3. Wire unified `ImageLightboxModal` + video badges across `ArrivalDescriptionCards`, `MapDetailsDrawer`, `WorldCodexTab`, `CodexCharacterDetail` (including new Character Photo Album section), and `CampaignCharacterMediaTab`.
4. Update `WorldMediaTab`, `CharacterMediaTab`, `PersonaMediaTab` with video upload (`MP4 / WebM · Max {N} MB`), existing-photo linking + replace confirmation, video-only delete vs cascade image delete, and upload-disabled UI state.
5. Update `ExportBundleModal` (`Include videos` + per-video checklist), `ImportPreviewModal` (`Import media` -> `Images`/`Videos` coupling + warnings), and `AdminServerConfigTab` (upload toggles, max video MB, Purge Non-Built-In Media with `Images -> Videos` cascade).

## Step 6: Verification, Architecture Maps & Wiki
- Backend tests (`test_unified_media_assets.py`, `test_video_uploads_and_governance.py`, `test_import_export.py`, updated media assertions).
- Frontend Vitest suite (`ImageLightboxModal`, `importExportLogic`, `ExportBundleModal`, `ImportPreviewModal`, `AdminServerConfigTab`, `CodexCharacterDetail`, Media tabs).
- Gates: `ruff check app tests`, `tach check`, `pytest backend/tests`, `npm --prefix frontend run arch:check && npm --prefix frontend run build && npm --prefix frontend test`, `scripts/generate_arch_docs.py --check`.
- Update `../cybercantina-wiki` guides.
