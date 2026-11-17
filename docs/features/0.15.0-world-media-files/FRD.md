---
feature: world-media-files
target_version: 0.15.0
document_type: frd
status: draft
last_updated: 2026-11-17
---

# Feature Requirements Document (FRD)
## World Media Files, Location/Container Visual Links & Arrival Image Carousel

**Status:** Draft  
**Target Version:** CyberCantina v0.15.0  
**Depends On:** `0.11.6-first-visit-arrival-descriptions`, `0.14.0-worlds-and-personas-unsupported-fields`  
**Scope:**
- Backend Security, Quotas & Housekeeping ([`media_path.py`](file:///home/diegolima/Git/cybercantina/backend/app/security/media_path.py), [`dependencies.py`](file:///home/diegolima/Git/cybercantina/backend/app/dependencies.py), [`auth_users.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/auth_users.py), [`purge_inactive.py`](file:///home/diegolima/Git/cybercantina/backend/app/housekeeping/purge_inactive.py))
- Backend Schemas, DDL & Repositories ([`schema.sql`](file:///home/diegolima/Git/cybercantina/backend/app/db/schema.sql), [`schema_init.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/schema_init.py), [`world.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/world.py), [`turn.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/turn.py), [`worlds.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/worlds.py), [`world_locations.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/world_locations.py), [`campaigns.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/campaigns.py), [`campaign_spatial.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/campaign_spatial.py), [`campaign_map_update.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/campaign_map_update.py), [`arrival_descriptions.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/arrival_descriptions.py), [`pipeline.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/clerk/pipeline.py))
- Backend Routers & `.zcc` Import/Export ([`worlds.py` router](file:///home/diegolima/Git/cybercantina/backend/app/routers/worlds.py), [`import_export.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/import_export.py), [`import_export_service.py`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py))
- Frontend Types, World Sheet, Map Drawer, Chat Arrival Cards & Home Screen ([`world.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/world.ts), [`turn.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/turn.ts), [`worlds.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/api/worlds.ts), [`importExport.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/api/importExport.ts), [`WorldInspectorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldInspectorModal.tsx), [`MapDetailsDrawer.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDetailsDrawer.tsx), [`ArrivalDescriptionCards.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/ArrivalDescriptionCards.tsx), [`TurnCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/TurnCard.tsx), [`entityImages.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/utils/entityImages.ts), [`HomeScreen.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/HomeScreen.tsx), [`HomeEntityPickerModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/HomeEntityPickerModal.tsx))
- Automated Tests (`backend/tests/`, `frontend/src/`)

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
1. **Worlds Lack Visual Media Support:**
   - Characters support portrait and photo album uploads, quota enforcement, `.zcc` media bundling, and Home screen card carousels via [`getEntityPrimaryImage`](file:///home/diegolima/Git/cybercantina/frontend/src/utils/entityImages.ts#L35-L71), whereas Worlds have no media upload UI, storage schema, or `.zcc` media packaging.
2. **Locations & Containers Cannot Surface Curated Visuals on Arrival or Map Inspection:**
   - World creators often have pre-existing scene artwork, establishing shots, or district illustrations they want players to see the first time they enter an area or when inspecting visited nodes on the campaign map.
3. **Storage Efficiency & Quota Control:**
   - Unlike character portraits (which are duplicated per Copy-on-Write fork), world scene artwork can be numerous and high-resolution; duplicating files across CoW forks would inflate disk usage and prevent users from reclaiming quota without deleting active campaigns.

### 1.2 Proposed Solution
1. **World Sheet `Media` Tab (Save-First):**
   - Add a `Media` tab to [`WorldInspectorModal`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldInspectorModal.tsx) allowing creators to upload, label, preview (lightbox), and delete images once a world has been saved (disabled with guidance in `mode === "wizard"`).
2. **Non-Duplicated Media Assets with Hard-Delete Quota Reclamation:**
   - Store physical world image files once per `media_id` (zero duplication across [`update_world`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/worlds.py#L665-L925) CoW forks) and count them toward [`get_user_media_usage_bytes`](file:///home/diegolima/Git/cybercantina/backend/app/dependencies.py#L376-L381).
   - Keep location/container link attributes isolated per CoW world version so editing links on the base world never alters running campaigns, while allowing explicit hard-deletion of media files from disk (with cross-fork campaign warnings) to immediately free user quota.
3. **Location & Container Image Linking + Visited-Only Campaign Viewing:**
   - Allow linking at most **1** uploaded world image to each `LocationNode` and `LocationContainer` inside [`MapDetailsDrawer`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDetailsDrawer.tsx) (`mode === "editor"` only).
   - During running campaigns, disable all world media mutations, show linked images in `MapDetailsDrawer` **only** for visited locations/containers, and omit images on external ghost stubs.
4. **Unified Arrival-Media Carousel Card in Chat:**
   - When entering unvisited containers/locations (and always on Turn 0 if starting scope has images), emit a single collapsible arrival-media carousel card displaying all triggered images in outer → inner → location order, with click-to-enlarge overlay and auto-collapse on the next turn.
5. **Home Screen Carousel & `.zcc` Packaging:**
   - Populate [`getEntityPrimaryImage`](file:///home/diegolima/Git/cybercantina/frontend/src/utils/entityImages.ts#L50-L59) from the world's first image so the Home `"Worlds"` card and [`HomeEntityPickerModal`](file:///home/diegolima/Git/cybercantina/frontend/src/components/HomeEntityPickerModal.tsx#L390-L410) automatically display world visuals.
   - Add `include_media` (default `true`) to world `.zcc` exports and remap/quota-check world media on `.zcc` import.

> [!NOTE]
> **Deferred Scope (Future Phase — Background Music / Audio):**
> - Audio upload, playback controls, and location audio triggers are **out of scope** for `v0.15.0`.
> - However, schemas, storage paths, and security path validators in `v0.15.0` **must** include a `media_type` discriminator (`"image"` in `v0.15.0`, extensible to `"audio"`) so background music can be added later without breaking schema migrations or URL layouts.

---

## 2. Scope, Boundaries & Core Invariants

1. **Save-First Creation Boundary:**
   - Pre-commit wizard drafts (`WorldWizardModal` / `WorldInspectorModal` with `mode === "wizard"`) do **not** support staged media uploads. Users must save/commit the world before uploading media.
2. **Non-Duplicated Files & Hard-Delete Semantics:**
   - Physical world media files are **never** duplicated on [`update_world`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/worlds.py#L665-L925) CoW forks.
   - Changing which image is linked to a location/container (or adding/removing links on the World Sheet) produces a new CoW world version when campaigns exist; running campaigns retain the attribute snapshot from when the campaign started.
   - Deleting a media file from the Media tab hard-deletes the physical file on disk immediately to reclaim quota (after confirming a warning if any active campaign—directly or via an earlier CoW fork—references that file).
   - Deleting a World when running campaigns still pin an earlier or current version must warn the user accurately across CoW forks, and any surviving campaign must degrade gracefully if a referenced image file is gone.
3. **Campaign Read-Only Lock for World Media:**
   - Running campaigns (`mode === "campaign"`) allow **no** world media uploads, deletions, or location/container image link changes, preventing orphaned/lost media files across swipes, branches, or failed turns.
4. **Graceful Missing-Media Degradation:**
   - Missing or deleted image files must **never** render broken `<img>` icons, error banners, or empty arrival cards. Backend hydration omits missing image references cleanly, and frontend `<img>` handlers fail silently by hiding the unavailable image/card.
5. **Cosmetic-Only / Zero LLM Context Injection:**
   - World media metadata, filenames, labels, and URLs **never** enter Zone 1–4 prompts, VectorStore embeddings, `WorldMapReimagineRequest`, or Clerk/Actor evaluation.
6. **Module & Security Boundaries:**
   - All filesystem paths must pass through generalized two-step lexical + `realpath` confinement in [`media_path.py`](file:///home/diegolima/Git/cybercantina/backend/app/security/media_path.py); client-influenced log fields must pass through [`log_sanitize.py`](file:///home/diegolima/Git/cybercantina/backend/app/security/log_sanitize.py).
   - Backend must pass `tach check` (`backend/tach.toml`) and frontend must pass `npm --prefix frontend run arch:check`.

---

## 3. Functional Requirements

### FR-1: World Media Storage, Schema, Quotas & CoW Lifecycle

- **Database Schema ([`schema.sql`](file:///home/diegolima/Git/cybercantina/backend/app/db/schema.sql), [`schema_init.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/schema_init.py)):**
  - Introduce a `world_media` table storing deduplicated physical assets:
    - `id TEXT PRIMARY KEY` (e.g., `wmed_<hex>`)
    - `owner_id TEXT NULL REFERENCES users(id) ON DELETE CASCADE`
    - `media_type TEXT NOT NULL DEFAULT 'image'` (`'image'` in v0.15.0; extensible to `'audio'`)
    - `filename TEXT NOT NULL` (disk filename within media root, e.g. `wmed_<hex>.webp`)
    - `label TEXT NOT NULL DEFAULT ''` (user-facing title, seeded from uploaded filename stem)
    - `mime_type TEXT NOT NULL DEFAULT 'image/webp'`
    - `byte_size INTEGER NOT NULL DEFAULT 0`
    - `created_at TEXT NOT NULL`
  - Introduce a `world_media_links` join table (`world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE`, `media_id TEXT NOT NULL REFERENCES world_media(id) ON DELETE CASCADE`, `sort_order INTEGER NOT NULL DEFAULT 0`, `PRIMARY KEY (world_id, media_id)`) so multiple CoW world forks (`world_v1`, `world_v2`) can share the same `world_media` asset with zero file duplication and deterministic ordering (where `sort_order = 0` is the world's first/primary image).
  - Add nullable `image_media_id TEXT NULL REFERENCES world_media(id) ON DELETE SET NULL` columns to `location_nodes` and `location_containers` (with additive `ALTER TABLE` migrations in `schema_init.py`).
- **Filesystem Layout & Security ([`media_path.py`](file:///home/diegolima/Git/cybercantina/backend/app/security/media_path.py)):**
  - Generalize `media_path.py` with `validate_safe_media_id` and `safe_resolve_world_media_file_path(media_dir, media_type_dir, filename)` storing world images under `{media_dir}/worlds/images/{filename}` (enforcing the exact same `os.path.normpath` + `os.path.realpath` containment checks as character media).
  - Add `GET /api/media/worlds/{media_type_dir}/{filename}` (or `/api/media/worlds/{media_id}`): verify `current_user.id == asset.owner_id` (matching existing world access rules), return 404 if missing or unauthorized, and serve `image/webp` via `FileResponse` with `Cache-Control: private, max-age=86400` (safe because every upload generates a fresh immutable `wmed_<hex>` filename).
- **CoW Forking, Hard-Deletion & Account Cleanup Rules:**
  - **On `update_world` CoW fork:** Copy `world_media_links` rows from `old_world_id` to `new_world_id` and copy `image_media_id` values onto the new `location_nodes` and `location_containers` rows. **Do not** copy or touch files on disk.
  - **On media mutations when campaigns exist (`POST /api/worlds/{world_id}/media`, `PATCH /api/worlds/{world_id}/media/{media_id}`, `PUT /api/worlds/{world_id}/media/reorder`):** If `campaigns_using > 0` for `world_id`, CoW-fork `world_id` → `new_world_id` before attaching, renaming, or reordering media so running campaigns never see new or relabeled world media.
  - **On `DELETE /api/worlds/{world_id}/media/{media_id}` (Hard-Delete Media):**
    - Delete the `world_media` row (cascading `world_media_links` and setting `image_media_id = NULL` on any referencing `location_nodes`/`location_containers` across versions) and immediately unlink the physical file from disk so user quota drops immediately.
    - Provide a lightweight pre-check endpoint/metadata returning `campaigns_using_media` count across **all** worlds (including `pending_deletion = 1` CoW forks) referencing `media_id` so the UI warns the user before confirming deletion when any running campaign uses that image.
  - **On `DELETE /api/worlds/{world_id}` (`mark_world_pending_deletion`) & Pruning:**
    - Deletion pre-check must report active campaigns directly on `world_id` **and** any active campaigns on sibling CoW forks sharing its `media_id`s, so warnings are never silently skipped on forked worlds ([`App.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/App.tsx#L385-L397)).
    - Deleting a world sets `pending_deletion = 1` without deleting `world_media` files still referenced by sibling active/campaign-pinned worlds; when [`prune_pending_deletion_worlds`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/worlds.py#L1302-L1337) hard-deletes unreferenced worlds, it also garbage-collects any `world_media` rows (and unlinks their disk files) that now have **zero** remaining `world_media_links` rows.
  - **On Account Reset / User Deletion / Chloromancer Sweep ([`auth_users.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/auth_users.py#L299-L391), [`purge_inactive.py`](file:///home/diegolima/Git/cybercantina/backend/app/housekeeping/purge_inactive.py#L113-L215)):**
    - `reset_user_data` (which does not delete the `users` row, so `ON DELETE CASCADE` on `users` does not fire) and `delete_user` must explicitly delete `world_media` rows owned by `user_id` and unlink their files on disk.
    - Chloromancer's `_sweep_orphan_media_dirs` and `get_chloromancer_purge_preview` must also sweep orphaned files under `{media_dir}/worlds/` older than `ORPHAN_MEDIA_GRACE_SECONDS` that lack a matching `world_media` row, and include world media bytes in purge previews.
- **User Quota Enforcement ([`dependencies.py`](file:///home/diegolima/Git/cybercantina/backend/app/dependencies.py#L376-L481)):**
  - Update `get_user_media_usage_bytes(repo, user_id)` to sum persisted `world_media` file sizes owned by `user_id` alongside character media directories (avoiding double-counting across CoW forks because files are stored once per `media_id`).
  - Enforce `enforce_quota_and_write_webp` under `get_user_media_lock(user_id)` on every world image upload and `.zcc` world import.

### FR-2: World Sheet `Media` Tab (`WorldInspectorModal`)

- **Tab Navigation & Dirty-State CoW Synchronization:**
  - Extend `WorldTab` in [`WorldInspectorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldInspectorModal.tsx#L71) to `"base" | "media" | "map" | "lore" | "settings" | "unsupported"`.
  - **`mode === "inspector"`:** Full upload, label edit, reorder / set-cover, preview, and delete support.
  - **`mode === "wizard"`:** Keep the `Media` tab visible with uploads disabled and a clear informational state (*"Save this world first to upload media and link images to locations."*).
  - **`mode === "campaign"`:** Show the `Media` tab strictly read-only (displaying the frozen world's media gallery with click-to-enlarge, without upload/delete/edit controls; matching [`CampaignCharacterMediaTab`](file:///home/diegolima/Git/cybercantina/frontend/src/components/inspector/campaignCharacter/CampaignCharacterMediaTab.tsx)).
  - **CoW Fork Sync in `WorldInspectorModal`:** Track `activeWorldId` in modal state (initialized from `world.id`). Whenever a Media tab mutation triggers a CoW fork on the backend (`updated.id !== activeWorldId`), update `activeWorldId`, sync `media`, and propagate the updated world to parent state *without* closing the modal—and if unsaved `Base`/`Map`/`Lore` edits are pending (`isDirty === true`) while `campaigns_using > 0`, prompt the user to save pending edits first (or flush them cleanly) before CoW-forking via Media actions so edits and `world_id` never diverge.
- **Upload & Management UX:**
  - Mirror character gallery upload ([`CharacterMediaTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/character/CharacterMediaTab.tsx)): accept single or multi-file image uploads, validate & transcode to WebP on backend via [`render_webp_bytes`](file:///home/diegolima/Git/cybercantina/backend/app/dependencies.py#L401-L434) with `square_crop=False, max_size=1920` (preserving natural aspect ratios up to 1920px, 20 MB raw upload cap).
  - Display each image card with:
    - Thumbnail preview (click opens full-size lightbox overlay, dismissible via `Escape` or backdrop click)
    - Editable **label** (auto-initialized from uploaded filename without extension)
    - **"Set as Primary / Move First"** (or reorder) action updating `sort_order` so creators can choose which image represents the world on the Home screen card
    - Usage badge showing how many locations/containers in the current world link to it
    - Delete button: checks `campaigns_using_media` across current and CoW-forked world versions; if `> 0`, shows a confirmation warning explaining that deleting the image frees quota immediately and will remove the image from those active campaigns.
  - Deleting a media item also clears any staged `image_media_id` references in the open `WorldInspectorModal` draft state so a subsequent save doesn't hold stale IDs.

### FR-3: Linking Images to Locations & Containers + Campaign Map Viewing

- **Schema & API Sync:**
  - Add `image_media_id: str | None = None` and hydrated read-only `image_url: str | None = None` / `image_label: str | None = None` (or `WorldMediaItem` list on `WorldRecord`) to `LocationNode` and `LocationContainer` in [`world.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/world.py) and [`world.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/world.ts).
  - Validate on `update_world` that any submitted `image_media_id` belongs to the world's `world_media_links` (and `media_type == "image"`), ignoring/clearing missing IDs gracefully rather than failing saves if a file was concurrently removed.
  - Enforce **at most 1 image** per `LocationNode` and **at most 1 image** per `LocationContainer` (each level in a nested container hierarchy may independently link 1 image).
- **Map Editor Linking (`MapDetailsDrawer` in `mode === "editor"`):**
  - Inside [`MapDetailsDrawer.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDetailsDrawer.tsx), add an **Image** section for both locations and containers (all container depths `1..4`) allowing the creator to:
    - Select an existing uploaded image from the world's `media` list via a visual **thumbnail picker** (showing thumbnail + label, plus an `"Unlink / None"` option).
    - Preview the linked thumbnail and click to enlarge in an overlay.
    - If no world images exist yet, show a subtle hint pointing to the `Media` tab.
- **Campaign Map Viewing (`MapDetailsDrawer` in `mode === "campaign"`):**
  - Hide/omit all image-linking or unlinking controls in `mode === "campaign"`.
  - For **Locations:** Display the linked image (plus click-to-enlarge overlay) **only when `selectedLocation.is_visited` is `true`** and the image file exists.
  - For **Containers:** Display the linked image (plus click-to-enlarge overlay) **only when the container is visited** (`visitedContainerIds.includes(selectedContainer.id)` or [`containerHasVisitedDescendants`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDetailsDrawer.tsx#L615)) and the image file exists.
  - For **External Ghost Stubs (`selectedGhost`):** Omit images completely.

### FR-4: First-Visit Arrival-Media Carousel Card in Chat

- **Payload & Backend Emission ([`arrival_descriptions.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/arrival_descriptions.py), [`turn.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/turn.py)):**
  - Introduce `FirstVisitMediaItem` (e.g., `entity_type: "container" | "location"`, `entity_id: str`, `depth: int`, `entity_name: str`, `media_id: str`, `image_url: str`, `label: str`) and attach `first_visit_media: list[FirstVisitMediaItem] = Field(default_factory=list)` onto `PostTurnStateDelta` (alongside `first_visit_cards`).
  - When visiting `target_location`:
    - Collect images from newly visited ancestor containers (`outermost → innermost`) and `target_location` (if newly visited), **independently** of whether those entities have meaningful text descriptions (so a location or container with **no description**—or only boilerplate description—still emits its image).
    - Deduplicate consecutive/repeated `media_id` entries within the same arrival event (retaining the innermost/most specific entity occurrence) so reusing one image across a container and child location never renders duplicate slides in the same carousel.
    - Resolve display label for each slide as `media.label.trim() || entity.name` (falling back to the owning container's or location's name, never mislabeling a container image with a child location's name).
  - **Turn 0 (`[Scene Start]`) Rule ([`campaigns.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/campaigns.py#L173-L294)):**
    - Turn 0 **always** emits `first_visit_media` if the starting location or its ancestor containers have linked images—even when `skip_location_card = true` (`{location_description}` / blank greeting fallback) or `start_focus === "world"` (`suppress_cards = true`). Ensure Turn 0 creates a `PostTurnStateDelta(elapsed_minutes=0, first_visit_cards=root_cards, first_visit_media=root_media)` whenever `root_cards` **or** `root_media` is non-empty.
  - **Subsequent Turns (`pipeline.py` & `override_campaign_location`):**
    - `campaign.world_settings.describe_on_first_visit` governs automated first-visit cards (both text and media) after Turn 0; visiting locations still marks `visited_location_ids` and `visited_container_ids` even when `describe_on_first_visit` is `false`.
    - On Phase 5 Clerk movement (`pipeline.py`), attach `first_visit_media` onto the triggering turn's `post_turn`.
    - On manual map move (`override_campaign_location` in [`campaign_spatial.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/campaign_spatial.py#L59-L127)), emit the standalone `turn_kind = "arrival"` turn whenever `first_visit_cards` **or** `first_visit_media` is non-empty (so `Delete` cleanly undoes the map move and restores unvisited status).
  - **Missing Media Hydration Guard:** When hydrating `CampaignStateBundle` (`get_campaign_state_bundle` / `get_turn_node`) and `WorldRecord` (`get_world` / `list_worlds`), filter out any `FirstVisitMediaItem` or `WorldMediaItem` whose `media_id` row or file on disk no longer exists, so deleted media never leaves empty card chrome, dead Home carousel URLs, or 404 image requests.
- **Frontend Arrival Carousel & Lightbox ([`ArrivalDescriptionCards.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/ArrivalDescriptionCards.tsx), [`TurnCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/TurnCard.tsx)):**
  - Render all `first_visit_media` items for a turn inside **one** collapsible arrival-media card styled consistently with the arrival card stack (resized to a sensible chat preview height, e.g., `max-height: 240px`, `object-fit: cover` or `contain` within card width).
  - When `items.length > 1`, present them as an interactive **carousel** (previous/next buttons + dot/counter indicator) showing the active slide's label (`label || entity_name`) and entity scope badge. When `items.length === 1`, omit carousel controls.
  - Apply the exact same [`isArrivalCardExpanded`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/arrivalHelpers.ts) lifecycle: expanded on the latest turn when present, automatically collapsed as soon as a subsequent turn occurs (with a clear collapsed header like `Scene Imagery` / `Location Visuals (N)`), and manually toggleable anytime.
  - Clicking the preview image opens a full-size **lightbox overlay** (dismissible via `Escape`, close button, or backdrop click).
  - If an `<img>` still fails to load (`onError`), remove/hide that slide silently (and hide the whole arrival-media card if no valid slides remain).

### FR-5: Home Screen `"Worlds"` Card & Entity Picker Thumbnails

- Populate `WorldRecord.media` (and/or `gallery` / `cover_url` compatibility in [`getEntityPrimaryImage`](file:///home/diegolima/Git/cybercantina/frontend/src/utils/entityImages.ts#L50-L59)) using the **first image** (`media_type === "image"`, lowest `sort_order`) of each world when available.
- [`HomeScreen`](file:///home/diegolima/Git/cybercantina/frontend/src/components/HomeScreen.tsx#L286) continues passing `worldImages` into `<HomeCard title="Worlds" ... />` so it loops every 12 seconds across worlds that have at least one image, falling back to the `Globe` watermark when none exist.
- [`HomeEntityPickerModal`](file:///home/diegolima/Git/cybercantina/frontend/src/components/HomeEntityPickerModal.tsx#L390-L410) automatically displays each world's first image thumbnail (with `onError` graceful fallback to the `Globe` icon if a file is missing).

### FR-6: `.zcc` World Export & Import

- **Export Endpoints & UI ([`import_export.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/import_export.py), [`import_export_service.py`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py)):**
  - Add `include_media: bool = Query(default=True)` to `GET /api/export/world/{world_id}` (and `include_world_media: bool = True` on `ExportBundleRequest` / `export_single_character` when exporting associated worlds). Replace the single `window.confirm` in [`WorldInspectorModal.handleExportWorld`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldInspectorModal.tsx#L220-L230) with a compact export-options popover/modal containing checkboxes for `"Include resident characters"` (default `true`) and `"Include world media"` (default `true`), and expose the same toggle in [`ExportBundleModal`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ExportBundleModal.tsx).
  - When `include_media=True`: package each world's media files under `media/worlds/{world_id}/images/{filename}` inside the `.zcc` archive, serialize `media` entries in `worlds.json`, and preserve `image_media_id` links on locations/containers.
  - When `include_media=False`: omit world media binaries, serialize `media: []`, and clear `image_media_id` on exported locations/containers so importing the package produces clean, link-error-free worlds.
- **Import Inspection & Commit:**
  - Validate ZIP path traversal and total byte bounds (`MAX_TOTAL_UNCOMPRESSED_BYTES`, `MAX_ZIP_ENTRIES`).
  - Pre-render imported world images (`render_webp_bytes(..., square_crop=False, max_size=1920)`), include their byte total alongside character media in the single atomic `get_user_media_quota_bytes` check under `get_user_media_lock`, and unlink any newly written world media files on DB exception rollback.
  - Generate fresh `wmed_*` IDs on import, remap `location_nodes.image_media_id` and `location_containers.image_media_id` to the newly created `media_id`s, and gracefully clear `image_media_id` if a referenced ZIP member is missing rather than failing import or leaving dangling links.

---

## 4. Non-Functional Requirements & Edge Cases

1. **Path Confinement & Upload Validation:**
   - All world media reads, writes, deletes, and `.zcc` extraction must pass through `media_path.py` lexical + `realpath` validation and `render_webp_bytes` format validation (rejecting non-image payloads and payloads `> 20 MB`).
   - Log all dynamic IDs/filenames through `sanitize_log_value` (`py/log-injection`).
2. **Container Operations Preservation:**
   - World map edits (`update_world`) and container utilities ([`delete_location_container`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/world_locations.py) and [`convert_location_to_container`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/world_locations.py#L126-L190)) must preserve `world_media_links` and `image_media_id` on untouched/migrated entities (`_row_to_location` and `_row_to_container` must always hydrate `image_media_id`).
3. **Campaign Map Bulk Edits (`update_campaign_map`):**
   - [`update_campaign_map`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/campaign_map_update.py#L26) must **server-enforce** the campaign media lock by preserving `orig_loc.image_media_id` and `orig_cont.image_media_id` on existing nodes and forcing `image_media_id = None` on any newly created mid-campaign nodes (ignoring any client-supplied media changes).
4. **Vitest / Frontend Constraints:**
   - Keep carousel navigation, fallback labeling, and media filtering helpers in pure TypeScript modules tested via Vitest (Node environment) alongside `ReactDOMServer.renderToStaticMarkup` component assertions.

---

## 5. Acceptance Criteria & Verification Matrix

| ID | Criterion | Verification Method |
| :--- | :--- | :--- |
| **AC-1** | `WorldInspectorModal` includes a `Media` tab: upload/label/preview/delete work on saved worlds (`mode="inspector"`), uploads are disabled with guidance in `mode="wizard"`, and editing/linking is disabled in `mode="campaign"`. | Frontend Vitest SSR tests + backend router tests (`pytest`) |
| **AC-2** | Locations and containers each accept at most 1 linked image (`mode="editor"`), preserved across `update_world`, `delete_location_container`, `convert_location_to_container`, and `update_campaign_map`. | Backend repo/API tests (`pytest`) |
| **AC-3** | CoW `update_world` forks share physical `world_media` files without disk duplication; changing location image links on the edited world does not affect running campaigns; hard-deleting a media file reclaims quota immediately, warns across CoW-forked campaigns, and degrades gracefully (no broken `<img>` or empty card) in affected campaigns. | Backend CoW, quota & pruner tests (`pytest`) + frontend error-fallback tests (`vitest`) |
| **AC-4** | First-visit arrivals (Turn 0, Clerk move, manual map move) emit at most one arrival-media carousel card containing all newly triggered container/location images (even when descriptions are blank/boilerplate), ordered outer → inner → location, with `label \|\| entity.name`, Turn 0 always showing images, auto-collapsing on the next turn, and click-to-enlarge overlay. | Backend arrival & `create_campaign` tests (`pytest`) + frontend `ArrivalDescriptionCards` / `TurnCard` Vitest tests |
| **AC-5** | During campaigns, `MapDetailsDrawer` shows images only for visited locations (`is_visited`) and visited containers (`containerHasVisitedDescendants` / `visitedContainerIds`), omits images on external ghost stubs, and opens an enlarged overlay on click. | Frontend `MapDetailsDrawer` Vitest tests |
| **AC-6** | Home screen `"Worlds"` card cycles through the first image of each world that has media, and `HomeEntityPickerModal` renders world thumbnails cleanly. | Frontend `entityImages` & Home component Vitest tests |
| **AC-7** | `.zcc` world export defaults to `include_media=true`, omits binaries and clears `image_media_id` links when `include_media=false`, and `.zcc` import remaps `media_id` references and enforces user media quota. | Backend `test_import_export.py` (`pytest`) |
| **AC-8** | Backend (`ruff check`, `tach check`, `pytest`), frontend (`arch:check`, `build`, `test`), and architecture docs (`generate_arch_docs.py --check`) all pass. | CLI gate |

---

## 6. Resolved Design Decisions

1. **Save-First Uploads:** Media uploads and linking are unlocked only after a world is saved/created (`mode === "inspector"`), avoiding `staged_world_ownership` complexity.
2. **Non-Duplicated Physical Files + Hard-Delete Quota Model:** World media assets are stored once per `media_id` (`world_media` + `world_media_links`) rather than copied per CoW fork. Editing location/container links forks the world normally via CoW; explicitly deleting a media file hard-removes it from disk immediately (with cross-fork campaign warnings) to reclaim quota.
3. **Single Carousel Arrival-Media Card + Turn 0:** Multiple images triggered on arrival (nested containers + location) render inside one collapsible carousel card (falling back from image label to owning entity name), auto-collapsing on the following turn. Turn 0 always displays starting images when present.
4. **Campaign Read-Only Lock & Spoiler Protection:** No world media uploads, deletions, or link changes are permitted inside running campaigns. The campaign map drawer displays images only for visited locations/containers and omits images on ghost stubs.
