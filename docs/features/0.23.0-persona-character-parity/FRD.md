---
feature: persona-character-parity
target_version: 0.23.0
document_type: frd
status: completed
last_updated: 2026-11-20
---

# Feature Requirements Document (FRD)
## Player Persona–Character Parity: Tagline, Height Alignment, Media Support & Chat Portrait

**Status:** Completed  
**Target Version:** CyberCantina v0.23.0  
**Depends On:** `0.15.0-world-media-files`, `0.20.0-world-codex`  
**Scope:**
- Backend Schemas, DDL, Migrations & Prompt Formatting ([`persona.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/persona.py), [`schema.sql`](file:///home/diegolima/Git/cybercantina/backend/app/db/schema.sql), [`schema_init.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/schema_init.py), [`personas.py` repo](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/personas.py), [`campaigns.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/campaigns.py), [`zone1_static.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/zone1_static.py))
- Backend Media Security, Quotas, Housekeeping & `.zcc` Import/Export ([`media_path.py`](file:///home/diegolima/Git/cybercantina/backend/app/security/media_path.py), [`dependencies.py`](file:///home/diegolima/Git/cybercantina/backend/app/dependencies.py), [`personas.py` router](file:///home/diegolima/Git/cybercantina/backend/app/routers/personas.py), [`auth_users.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/auth_users.py), [`purge_inactive.py`](file:///home/diegolima/Git/cybercantina/backend/app/housekeeping/purge_inactive.py), [`import_export_service.py`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py))
- Frontend Types, API Client, Persona Editor, Codex, Home & Chat UI ([`persona.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/persona.ts), [`personas.ts` API](file:///home/diegolima/Git/cybercantina/frontend/src/api/personas.ts), [`entityImages.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/utils/entityImages.ts), [`PersonaEditorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/PersonaEditorModal.tsx), [`CodexCharacterDetail.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/CodexCharacterDetail.tsx), [`HomeEntityPickerModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/HomeEntityPickerModal.tsx), [`NewCampaignModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/NewCampaignModal.tsx), [`TurnCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/TurnCard.tsx), [`LiveStreamingTurnCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/LiveStreamingTurnCard.tsx), [`chatHelpers.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/chatHelpers.tsx), [`styles.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css))
- Automated Tests (`backend/tests/`, `frontend/src/`)

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
Player Personas and Characters share core identity, appearance, and equipment concepts, but Personas have fallen behind recent Character improvements across four areas:
1. **No Quick-Reference `Tagline`:** Characters use `tagline` ([`CharacterBaseTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/character/CharacterBaseTab.tsx#L90-L96)) as their one-line summary in campaign creation and the World Codex. Personas lack `tagline`, forcing [`HomeEntityPickerModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/HomeEntityPickerModal.tsx#L500-L509) and [`NewCampaignModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/NewCampaignModal.tsx#L476-L483) to fall back to multi-line `persona_bio` prose or `build_and_height`.
2. **Stale `Build & Height` Labeling:** Characters migrated the Appearance field to **`Height`** (metric `cm` with shortcut pills, routing build/frame descriptors into `distinctive_features`), while Personas still display `"Build & Height"` in [`PersonaEditorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/PersonaEditorModal.tsx#L650-L659), [`CodexCharacterDetail.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/CodexCharacterDetail.tsx#L100), and [`zone1_static.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/zone1_static.py#L129).
3. **No Media Support:** [`HomeScreen.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/HomeScreen.tsx#L298) and [`HomeEntityPickerModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/HomeEntityPickerModal.tsx#L461) already call [`getEntityPrimaryImage("personas", persona)`](file:///home/diegolima/Git/cybercantina/frontend/src/utils/entityImages.ts#L64-L67), which reads unbacked stub keys (`avatar_url || portrait_url || image_url`). Personas cannot upload portraits or photo album images, have no media representation in the World Codex or chat turn cards, and carry no media inside `.zcc` archives.
4. **Snapshot Media Integrity Without Redundant CoW:** Campaigns already freeze a complete `PersonaRecord` in `campaigns.persona_snapshot_json` at creation ([`schema.sql`](file:///home/diegolima/Git/cybercantina/backend/app/db/schema.sql#L262), [`campaigns.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/campaigns.py#L73-L93)), so persona edits or deletions already cannot alter existing campaigns' text, items, or lore. Adding media files on disk introduces a new gap: eager file deletion on portrait replacement or persona deletion would `404` URLs still referenced inside surviving `campaigns.persona_snapshot_json` rows—yet adding full Character-style Copy-on-Write (`pending_deletion` + ID forking) on `personas` would duplicate immutability machinery unnecessarily.

### 1.2 Proposed Solution
1. **Add `tagline` to Personas (UI Reference Only):**
   - Add `tagline: str = ""` to `PersonaRecord` / `PersonaCreatePayload` / `PersonaUpdatePayload` and render it on the `Base` tab, World Codex persona header, Home entity picker, and New Campaign persona preview—without injecting it into Zone 1 LLM prompts.
2. **Align `Build & Height` → `Height`:**
   - Relabel the Persona Appearance input to **`Height`** with metric `cm` suggestions matching [`CharacterAppearanceTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/character/CharacterAppearanceTab.tsx#L113-L127), keeping the `build_and_height` schema/SQL column intact and applying the `"," in val` heuristic (`Build & Height` vs. `Height`) when rendering legacy values in [`CodexCharacterDetail.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/CodexCharacterDetail.tsx) and [`zone1_static.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/zone1_static.py).
3. **Add Adapted Persona Media (`1` Primary Portrait + Photo Album):**
   - Add a single `portrait_url: str | None = None` (square-cropped 512px WebP; no 8-emotion CARE grid) and `gallery: list[GalleryImage]` (up to 1920px natural-aspect WebP photo album) to Personas, managed in a new **`Media`** tab in [`PersonaEditorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/PersonaEditorModal.tsx).
   - Require saving/creating the persona before enabling uploads (consistent with the Character workflow).
4. **Surface Persona Media Across Codex, Home, Campaign Setup & Chat `TurnCard`:**
   - Display the persona's primary portrait (and gallery in Codex) in [`CodexCharacterDetail.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/CodexCharacterDetail.tsx), [`HomeScreen.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/HomeScreen.tsx), [`HomeEntityPickerModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/HomeEntityPickerModal.tsx), and [`NewCampaignModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/NewCampaignModal.tsx).
   - Render the campaign snapshot's persona portrait to the right of user prompt bubbles in [`TurnCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/TurnCard.tsx) and [`LiveStreamingTurnCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/LiveStreamingTurnCard.tsx) (omitted on Director/OOC cue bubbles and when no portrait is set).
5. **Protect Campaign Integrity via Snapshot-Aware Media Retention (No Persona CoW):**
   - Keep `personas` editable in place and preserve `campaigns.persona_snapshot_json` as the single campaign snapshot boundary.
   - Retain physical `.webp` files on disk for as long as **any** `campaigns.persona_snapshot_json` references their URL, garbage-collecting unreferenced files when no master persona or campaign snapshot points to them.

---

## 2. Scope, Boundaries & Core Invariants

1. **No Zone 1 Prompt / KV-Cache Bloat from `tagline` or Media:**
   - `tagline`, `portrait_url`, and `gallery` (including captions/filenames) **must never** be injected into [`format_zone1_player_protagonist_block`](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/zone1_static.py#L109-L139) or any other LLM prompt context.
2. **Single Portrait Model (No Emotion Grid):**
   - Personas have **no** CARE affective engine or `active_emotion` state; therefore Personas store at most **one** primary `portrait_url` (not an 8-key emotion map) plus an optional `gallery` photo album.
3. **Save-First Upload Boundary & Default Persona Lock:**
   - Unsaved/new persona creation drafts in [`PersonaEditorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/PersonaEditorModal.tsx) (`!persona?.id || clonedMode`) **must disable** media uploads with clear save-first guidance.
   - The hard-coded read-only default `'User'` persona (`is_default_persona_id(persona_id)`) **must reject** all media upload/delete mutations (`400 Bad Request`), matching existing `PUT`/`DELETE /api/personas/{persona_id}` behavior.
4. **Snapshot-Aware Media Integrity (Instead of Full CoW Forking):**
   - `personas` rows are **not** Copy-on-Write forked (`persona_id` stays stable across edits; no `pending_deletion` column on `personas`).
   - Every uploaded portrait or gallery image gets an immutable UUID-suffixed filename so browser caching (`Cache-Control: private, max-age=86400`) never serves stale images after replacement.
   - Replacing `portrait_url`, deleting a `gallery` item, or deleting a master persona (`DELETE /api/personas/{persona_id}`) **must check** whether any row in `campaigns.persona_snapshot_json` still references the target URL before unlinking the file on disk.
   - `GET /api/media/personas/{persona_id}/{category}/{filename}` **must** authorize access if `current_user.id` owns the `personas` row **or** owns at least one `campaigns` row whose `persona_snapshot_json` references that media URL (ensuring deleted master personas' campaign snapshots remain viewable).
5. **Graceful Missing-Media Degradation:**
   - If a portrait or gallery file is unavailable, UI components (`TurnCard`, `LiveStreamingTurnCard`, `CodexCharacterDetail`, `HomeEntityPickerModal`, `NewCampaignModal`) must fail silently without broken `<img>` icons or error banners.
6. **Security, Quota & Architecture Compliance:**
   - All filesystem path validation must route through [`media_path.py`](file:///home/diegolima/Git/cybercantina/backend/app/security/media_path.py) (two-step `os.path.normpath(os.path.abspath(...))` + `os.path.realpath(...)` confinement), all dynamic log values through [`log_sanitize.py`](file:///home/diegolima/Git/cybercantina/backend/app/security/log_sanitize.py), and all disk writes through `enforce_quota_and_write_webp` under `get_user_media_lock(user_id)`.
   - Backend must pass `ruff check`, `tach check`, and `pytest`; frontend must pass `arch:check`, `build`, and `test`; architecture docs must pass `generate_arch_docs.py --check`.

---

## 3. Functional Requirements

### FR-1: Persona Schema, SQLite Migration & Prompt Alignment (`tagline` & `Height`)

1. **Pydantic Schemas ([`backend/app/schemas/persona.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/persona.py)):**
   - Import `GalleryImage` from `app.schemas.character`.
   - Add to `PersonaRecord`:
     - `tagline: str = Field(default="", max_length=200, description="One-line quick-reference summary for the player.")`
     - `portrait_url: str | None = Field(default=None, description="Optional primary square portrait URL.")`
     - `gallery: list[GalleryImage] = Field(default_factory=list, description="Optional photo album images.")`
   - Add `tagline`, `portrait_url`, and `gallery` to `CANONICAL_PERSONA_RECORD_KEYS` (so `.zcc` import never leaks them into `unsupported_fields`).
   - Add `tagline: str = Field(default="", max_length=200)` to `PersonaCreatePayload` and `tagline: str | None = Field(default=None, max_length=200)` to `PersonaUpdatePayload` (media fields `portrait_url` and `gallery` are mutated via dedicated upload/delete endpoints rather than generic JSON `PUT`, matching [`CharacterRecord`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/character.py) and preserving `build_and_height` compatibility).
   - Update `PersonaRecord.build_and_height` field description to match metric height guidance while preserving the field name for backward compatibility, and update `get_default_persona` to initialize `tagline=""`, `portrait_url=None`, `gallery=[]`.
2. **TypeScript Contracts ([`frontend/src/types/persona.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/persona.ts)):**
   - Import `GalleryImage` from `./character`.
   - Add `tagline?: string`, `portrait_url?: string | null`, and `gallery?: GalleryImage[]` to `PersonaRecord`, and `tagline?: string` to `PersonaCreatePayload` and `PersonaUpdatePayload`.
3. **SQLite Schema & Idempotent Migration ([`schema.sql`](file:///home/diegolima/Git/cybercantina/backend/app/db/schema.sql), [`schema_init.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/schema_init.py), [`personas.py` repo](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/personas.py)):**
   - Add columns to `personas` in `schema.sql` with idempotent `ALTER TABLE` migrations in `schema_init.py`:
     - `tagline TEXT NOT NULL DEFAULT ''`
     - `portrait_url TEXT NULL`
     - `gallery_json TEXT NOT NULL DEFAULT '[]'`
   - Update `create_persona`, `update_persona`, `_ensure_default_persona_for_user_conn`, and `_row_to_persona_record` to persist and hydrate `tagline`, `portrait_url`, and `gallery`.
   - Add `update_persona_portrait(persona_id, portrait_url, owner_id)` and `update_persona_gallery(persona_id, gallery, owner_id)` repository methods (plus `touch` of `updated_at`), rejecting default persona IDs.
4. **Zone 1 Height Label Heuristic ([`zone1_static.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/zone1_static.py#L128-L130)):**
   - In `format_zone1_player_protagonist_block`, mirror [`build_zone1_static_system_prompt`](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/zone1_static.py#L195-L197):
     ```python
     height_label = "Build & Height" if "," in persona_snapshot.build_and_height else "Height"
     lines.append(f"{height_label}: {persona_snapshot.build_and_height.strip()}")
     ```
   - Do **not** include `persona_snapshot.tagline` in `format_zone1_player_protagonist_block`.

---

### FR-2: Persona Editor Modal (`Base`, `Appearance`, `Media` Tabs)

Update [`PersonaEditorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/PersonaEditorModal.tsx):
1. **Tab Navigation:**
   - Extend `PersonaTab` to `"base" | "appearance" | "media" | "lore" | "inventory" | "unsupported"`.
   - Add a **`Media`** tab button (`Image` icon) showing count badge when a portrait or gallery photos exist (e.g., `(portraitUrl ? 1 : 0) + gallery.length`).
2. **`Base` Tab:**
   - Add a **Tagline** text input (`maxLength={200}`, placeholder `"One-line quick reference (e.g. Ex-corp courier keeping a low profile)..."`) directly beneath `Persona Name` and above `Demographics & Identity`.
   - Disabled in `isReadOnly` mode (system default `"User"` persona).
3. **`Appearance` Tab:**
   - Relabel `"Build & Height"` to **`Height`** with placeholder `"e.g. 180 cm"` and clickable metric shortcut pills (`162 cm`, `168 cm`, `175 cm`, `180 cm`, `185 cm`, `190 cm`) matching [`CharacterAppearanceTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/character/CharacterAppearanceTab.tsx#L113-L127).
   - Keep `Distinctive Features` right below with updated helper copy reminding users to place build/frame traits here (`e.g. lean wiry frame, neon blue iris, scarred eyebrow, cybernetic left arm`).
4. **`Media` Tab (`PersonaMediaTab`):**
   - **Save-First Guard (New / Cloned Drafts):** When `!persona?.id || clonedMode`, display the `Media` tab with upload/delete controls disabled and a clear informational banner: *"Save this persona first to upload a portrait or photo album."*
   - **Default Persona Guard (`isReadOnly`):** Display a read-only message explaining the system default `'User'` persona cannot hold custom media (clone first).
   - **Primary Portrait Section (Single Slot):**
     - Upload an image (`image/*`, client-side square-cropped via shared `cropToSquareBlob(..., 512)` from [`characterMediaUtils.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/character/characterMediaUtils.ts)), preview in a square/circular card, click to enlarge in lightbox, or delete with confirmation.
     - Immediately updates `portraitUrl` state and invokes `onSaved(updated, false)` (or equivalent non-closing callback) so Home/header state stays synchronized without closing the modal.
   - **Photo Album (`gallery`) Section:**
     - Mirror [`CharacterMediaTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/character/CharacterMediaTab.tsx): optional caption input, multi-file upload, responsive image cards, click-to-enlarge lightbox (`Escape` / backdrop / close button), and per-photo delete confirmation.

---

### FR-3: Persona Media Endpoints, Security, Quotas & Snapshot-Safe Retention

1. **Media Path Confinement ([`backend/app/security/media_path.py`](file:///home/diegolima/Git/cybercantina/backend/app/security/media_path.py), [`backend/app/dependencies.py`](file:///home/diegolima/Git/cybercantina/backend/app/dependencies.py)):**
   - Add `validate_safe_persona_id(persona_id: str) -> str`, `safe_resolve_persona_media_dir(media_dir, persona_id)`, and `safe_resolve_persona_media_file_path(media_dir, persona_id, category, filename)` storing files at `{media_dir}/personas/{persona_id}/{category}/{filename}` where `category in ("portraits", "gallery")`, enforcing the exact same `os.path.normpath(os.path.abspath(...))` + `os.path.realpath(...)` confinement as character media.
   - Add `safe_resolve_persona_media_path` in `dependencies.py` translating `PathTraversalError` → `403` and `ValueError` → `400`.
2. **REST Endpoints ([`backend/app/routers/personas.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/personas.py), [`frontend/src/api/personas.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/api/personas.ts)):**
   - `POST /api/personas/{persona_id}/portrait` (`UploadFile` → `PersonaRecord`):
     - Reject default personas (`400`) and non-owned/missing personas (`404`).
     - Validate non-empty payload, transcode via `render_webp_bytes(file_bytes, square_crop=True, max_size=512)` (20 MB cap), generate `default_{uuid8}.webp`, write atomically under `get_user_media_lock(user.id)` via `enforce_quota_and_write_webp`.
     - Update `portrait_url = f"/api/media/personas/{persona_id}/portraits/{filename}"`.
     - If an old portrait file existed and is **not** referenced by any `campaigns.persona_snapshot_json`, unlink the old file safely; otherwise retain it on disk for the referencing campaign(s).
   - `DELETE /api/personas/{persona_id}/portrait` (`-> PersonaRecord`):
     - Clear `portrait_url = None` on the persona row and unlink the file on disk **only** if no `campaigns.persona_snapshot_json` references that URL.
   - `POST /api/personas/{persona_id}/gallery` (`UploadFile` + optional `caption: str | None = Form(None)` → `PersonaRecord`):
     - Transcode via `render_webp_bytes(file_bytes, square_crop=False, max_size=1920)`, store `img_{uuid10}.webp` under quota lock, append `GalleryImage`, and persist.
   - `DELETE /api/personas/{persona_id}/gallery/{image_id}` (`-> PersonaRecord`):
     - Remove matching item from `gallery`, persist, and unlink the disk file **only** if no `campaigns.persona_snapshot_json` references that URL.
   - `GET /api/media/personas/{persona_id}/{category}/{filename}` (`-> FileResponse`):
     - Validate path via `safe_resolve_persona_media_path`, verify file exists (`404`), and authorize if `user.id` owns `persona_id` **or** owns any campaign whose `persona_snapshot_json` contains `/api/media/personas/{persona_id}/{category}/{filename}` (`404` otherwise). Serve `image/webp` with `Cache-Control: private, max-age=86400`.
3. **Snapshot-Safe Cleanup, Quotas & Chloromancer Housekeeping:**
   - **On `DELETE /api/personas/{persona_id}`:** Delete the `personas` DB row (`campaigns.persona_id` becomes `NULL` via `ON DELETE SET NULL` while `persona_snapshot_json` stays intact). Sweep `{media_dir}/personas/{persona_id}` and unlink only files **not** referenced in any `campaigns.persona_snapshot_json`; remove the directory if empty.
   - **On `DELETE /api/campaigns/{campaign_id}` (`run_entity_pruner`) & Chloromancer `_sweep_orphan_media_dirs` ([`purge_inactive.py`](file:///home/diegolima/Git/cybercantina/backend/app/housekeeping/purge_inactive.py)):** Scan `{media_dir}/personas/*` and remove any file (older than `ORPHAN_MEDIA_GRACE_SECONDS` in Chloromancer, or matching deleted campaign snapshot URLs in pruner) that is referenced by **neither** an active `personas` row (`portrait_url` / `gallery_json`) **nor** any `campaigns.persona_snapshot_json`, cleaning up empty directories.
   - **Quota Calculation ([`dependencies.py`](file:///home/diegolima/Git/cybercantina/backend/app/dependencies.py#L427-L433)):** Update `get_user_media_usage_bytes(repo, user_id)` (and Chloromancer purge preview bytes) to include persisted persona media files belonging to `user_id`'s personas and `user_id`'s campaign `persona_snapshot_json` references (deduplicated by path so shared snapshot URLs are counted once).
   - **Account Reset & Deletion ([`auth_users.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/auth_users.py#L364-L380)):** `reset_user_data` and `delete_user` must delete all persona media directories/files belonging to `user_id`'s personas and `user_id`'s campaign snapshots.

---

### FR-4: Visibility in Codex, Home Screen, Entity Picker & Campaign Creation

1. **Image Resolution Helper ([`frontend/src/utils/entityImages.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/utils/entityImages.ts#L64-L67)):**
   - Update `getEntityPrimaryImage("personas", persona)` to resolve `persona.portrait_url || persona.avatar_url || persona.image_url || persona.gallery?.[0]?.url || null` (falling back to the first gallery photo if no primary portrait is set, matching `"characters"` fallback behavior).
2. **World Codex `Major Characters` ([`CodexCharacterDetail.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/CodexCharacterDetail.tsx)) & `codexHelpers.ts`:**
   - In `CodexCharacterDetail.tsx` (`kind === "persona"`):
     - Resolve primary portrait (`persona.portrait_url || persona.gallery?.[0]?.url || null`) and render the circular/framed portrait in `.codex-detail-header` alongside `persona.name` and badges (matching the Character detail header, with `onError` `portraitBroken` fallback).
     - Render `persona.tagline` in `.codex-character-tagline` right beneath the title/badges when non-empty.
     - Display `Build & Height:` vs. `Height:` using the `"," in persona.build_and_height` heuristic (matching Characters).
     - Render a **Photo Album** section (thumbnails + captions + click-to-enlarge lightbox) when `(persona.gallery?.length ?? 0) > 0`.
   - In [`WorldCodexTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldCodexTab.tsx) left-pane list rows for `Major Characters` and Global Search: show the persona's primary portrait thumbnail when available (falling back to `UserCheck` icon).
   - In `codexHelpers.ts` search indexing for `PersonaRecord`: include `persona.tagline` in Tier 3 (content/bio) matching alongside `persona_bio` and `species`.
3. **Home Screen & Pickers ([`HomeScreen.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/HomeScreen.tsx), [`HomeEntityPickerModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/HomeEntityPickerModal.tsx), [`NewCampaignModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/NewCampaignModal.tsx)):**
   - `HomeScreen` `"Personas"` card automatically cycles through persona primary images via `getCategoryPrimaryImages("personas", personas)`.
   - `HomeEntityPickerModal` displays persona thumbnail (`onError` fallback to `UserCheck`) and prefers `persona.tagline || persona.persona_bio || persona.build_and_height || ...` in `.home-picker-item-sub`.
   - `NewCampaignModal` persona preview card displays the selected persona's thumbnail (when present) and prefers `selectedPersona.tagline || selectedPersona.persona_bio || ...`.

---

### FR-5: Turn Card & Live Streaming User Prompt Portrait

Update [`TurnCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/TurnCard.tsx), [`LiveStreamingTurnCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/LiveStreamingTurnCard.tsx), [`chatHelpers.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/chatHelpers.tsx), and [`styles.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css):
1. **Source & Eligibility:**
   - Read the portrait URL from `bundle.campaign.persona_snapshot?.portrait_url` (or `getEntityPrimaryImage("personas", bundle.campaign.persona_snapshot)`—Wait: use `persona_snapshot?.portrait_url` strictly or `getEntityPrimaryImage`? Specifying `persona_snapshot?.portrait_url || null` ensures only an explicit primary portrait shows as the chat avatar, whereas a pure album/reference image in `gallery` does not unexpectedly act as a chat bubble avatar unless set as portrait).
   - Render the avatar **only** when:
     - `!isRoot` (Turn 0 has no user prompt),
     - `!isCueMessage` (exclude Director/OOC bracketed cues `[Advance the story...]`, `[Complication...]`, narrator lens cues),
     - `portraitUrl` is non-empty and has not errored (`!portraitBroken`).
   - When no portrait is set (including the default `'User'` persona), render **nothing** (no placeholder icon).
2. **Placement & Layout:**
   - Render a right-aligned flex row (`className="user-prompt-row"`, `display: flex; align-self: flex-end; align-items: flex-start; gap: 10px; max-width: 100%; justify-content: flex-end`) containing:
     - Left: the existing user message output from `renderUserMessageBubble(...)` (`.user-bubble` or `.user-message-container` for `@mention` whispers; ensure inner `.user-bubble` keeps its max-width cleanly inside the row).
     - Right: `32–36px` circular `<img>` (`border-radius: 50%; object-fit: cover; flex-shrink: 0; border: 1px solid rgba(6, 182, 212, 0.35)`), with `alt={personaName}`, `title={personaName}`, and `onError` silent hide.
   - Apply identically in both [`TurnCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/TurnCard.tsx#L303-L305) and [`LiveStreamingTurnCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/LiveStreamingTurnCard.tsx#L58-L60) so there is no layout jump when streaming completes.

---

### FR-6: `.zcc` Archive Export & Import Parity

Update [`backend/app/services/import_export_service.py`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py):
1. **Export (`build_zcc_export` & `_serialize_persona_for_zcc`):**
   - Stage `persona.portrait_url` under `media/personas/{persona.id}/portraits/{filename}` and each `persona.gallery` entry under `media/personas/{persona.id}/gallery/{filename}` inside `media_entries`, rewriting the serialized URLs in `personas.json` to relative ZIP paths (mirroring character media staging).
   - Update `ZccManifestContents.media_files_count` automatically via `len(media_entries)`.
2. **Import (`inspect_zcc` & `commit_import`):**
   - Include persona media entries in ZIP safety checks (`MAX_ZIP_ENTRIES`, `MAX_TOTAL_UNCOMPRESSED_BYTES`, path traversal rejection).
   - On `commit_import`, transcode/validate imported persona portrait (`square_crop=True, max_size=512`) and gallery images (`square_crop=False, max_size=1920`) via `render_webp_bytes`, include their bytes in the atomic `get_user_media_quota_bytes` check under `get_user_media_lock(user_id)`, write to `{media_dir}/personas/{new_p_id}/...`, remap `portrait_url` and `gallery[].url` to `/api/media/personas/{new_p_id}/...`, and unlink written files if DB persistence fails.
   - Ignore/clear missing media paths gracefully rather than failing import of the persona record.

---

## 4. Non-Functional Requirements & Edge Cases

1. **Path Confinement & Log Hygiene:**
   - Validate all `persona_id`, `category`, and `filename` segments through `media_path.py`; pass `media_dir=repo.media_dir` explicitly in service-layer helpers (`import_export_service.py`, `purge_inactive.py`, `dependencies.py`) rather than relying on global `settings.media_dir`.
   - Pass all dynamic persona/filename values through `sanitize_log_value` before logging.
2. **Legacy Campaign Snapshots:**
   - Existing `campaigns.persona_snapshot_json` blobs created prior to `v0.23.0` lack `tagline`, `portrait_url`, and `gallery`; `PersonaRecord.model_validate_json` defaults them safely (`""`, `None`, `[]`) with zero backfill migration needed.
3. **Concurrent Media / Quota Serialization:**
   - All portrait, gallery, and `.zcc` persona media writes acquire `get_user_media_lock(user_id)` around quota calculation and file creation.
4. **Vitest / Frontend Constraints:**
   - Keep image resolution, label formatting, and whisper/prompt-row helpers pure and unit-tested in Node Vitest alongside `ReactDOMServer.renderToStaticMarkup` component assertions for `PersonaEditorModal`, `CodexCharacterDetail`, `TurnCard`, `LiveStreamingTurnCard`, and `HomeEntityPickerModal`.

---

## 5. Acceptance Criteria & Verification Matrix

| ID | Criterion | Verification Method |
| :--- | :--- | :--- |
| **AC-1** | `PersonaRecord` / payloads / `personas` table support `tagline`, `portrait_url`, and `gallery` (with idempotent migration from pre-v0.23.0 DBs), and `format_zone1_player_protagonist_block` omits `tagline` and renders `Height:` vs. `Build & Height:` dynamically. | Backend schema, migration & `zone1_static` tests (`pytest`) |
| **AC-2** | `PersonaEditorModal` shows `Tagline` on `Base`, `Height` (with metric `cm` chips) on `Appearance`, and a `Media` tab with single portrait + gallery upload/delete/lightbox when editing an existing non-default persona, while disabling uploads on unsaved/cloned drafts and default `'User'` personas. | Frontend Vitest SSR tests + backend router tests (`pytest`) |
| **AC-3** | Persona media endpoints enforce ownership/campaign-snapshot auth, path confinement, WebP validation, and user media quota; replacing/deleting media or deleting a persona preserves files still referenced by `campaigns.persona_snapshot_json` and prunes orphaned files after campaign deletion or Chloromancer sweep. | Backend media, quota, snapshot-retention & pruner tests (`pytest`) |
| **AC-4** | `CodexCharacterDetail` (plus `HomeScreen`, `HomeEntityPickerModal`, `NewCampaignModal`) displays persona `portrait_url`, `tagline`, `Height`/`Build & Height` label, and `gallery` album with silent `onError` degradation. | Frontend `entityImages`, Codex & Home Vitest tests |
| **AC-5** | `TurnCard` and `LiveStreamingTurnCard` render `bundle.campaign.persona_snapshot.portrait_url` to the right of user prompts (including `@mention` whisper turns), omit it on Director/OOC cue bubbles and when unset, and hide cleanly on image error. | Frontend `TurnCard` & `LiveStreamingTurnCard` Vitest tests |
| **AC-6** | `.zcc` export packages persona portrait/gallery binaries and rewrites URLs; `.zcc` import validates, quota-checks, remaps URLs to the new `persona_id`, and degrades cleanly if ZIP media is missing. | Backend `test_import_export.py` (`pytest`) |
| **AC-7** | Backend (`ruff check`, `tach check`, `pytest`), frontend (`arch:check`, `build`, `test`), and architecture docs (`generate_arch_docs.py --check`) all pass. | CLI verification gate |

---

## 6. Resolved Design Decisions

1. **Single Portrait + Photo Album (No 8-Emotion Grid):** Personas lack CARE emotional state, so only one primary `portrait_url` and an optional `gallery` album are supported.
2. **Save-First Uploads:** Media uploads in `PersonaEditorModal` remain disabled until the persona exists in the database, avoiding temporary staged-persona ownership tracking.
3. **Keep `build_and_height` Key:** Rename only the UI label/placeholder/suggestions to `Height` (and apply the `","` heuristic on display) to preserve `.zcc` and campaign snapshot backward compatibility.
4. **Snapshot-Aware Media Retention Over Full Persona CoW:** `campaigns.persona_snapshot_json` already isolates campaign data from master persona edits/deletions. Protecting disk files via campaign-snapshot reference checks and orphan GC delivers 100% campaign integrity without `pending_deletion` rows or `persona_id` forking.
5. **TurnCard Right-Aligned Portrait Excludes Cue Turns & Empty State:** Only non-cue player turns with a configured `portrait_url` render a circular avatar to the right of the prompt bubble.
