---
feature: server-config-chloromancer
target_version: 0.11.0
document_type: frd
status: completed
last_updated: 2026-11-14
---

# Feature Requirements Document (FRD)
## Server Configuration Tab, Chloromancer Scheduler (Inactivity Purge), User Activity Tracking, Media Quotas & Self-Registration Toggle

**Status:** Completed  
**Target Version:** CyberCantina v0.11.0  
**Scope:**
- Backend Configuration & Layering (`backend/app/config.py`, `backend/app/providers/settings_service.py`, `backend/tach.toml`)
- Backend Persistence & Schema (`backend/app/db/schema.sql`, `backend/app/db/repos/schema_init.py`, `backend/app/db/repos/auth_users.py`)
- Backend Auth, Quotas & Media Enforcement (`backend/app/auth.py`, `backend/app/dependencies.py`, `backend/app/routers/auth.py`, `backend/app/routers/characters.py`, `backend/app/routers/settings.py`, `backend/app/services/import_export_service.py`, `backend/app/schemas/auth.py`)
- Backend Chloromancer Scheduler (`backend/app/housekeeping/` / `backend/app/main.py`, `backend/app/routers/admin_housekeeping.py` or `routers/auth.py`)
- Frontend Admin, Auth & Profile UI (`frontend/src/components/auth/AdminModal.tsx`, `frontend/src/components/auth/AdminServerConfigTab.tsx`, `frontend/src/components/auth/AdminUsersTab.tsx`, `frontend/src/components/auth/AuthScreen.tsx`, `frontend/src/components/auth/ProfileAccountTab.tsx`, `frontend/src/types/`, `frontend/src/api/`)
- Automated Tests (`backend/tests/`, `frontend/src/components/__tests__/`)

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
CyberCantina already supports multi-user authentication (`users`, `user_sessions`, `user_passkeys`), self-registration (`POST /api/auth/register`), and user-owned worlds/characters/media. However, operating a multi-tenant or public alpha instance (such as `alpha.cybercantina.io` with no paid inference and minimal hosting cost) exposes four missing operational controls:

1. **No Self-Registration Gate:** `POST /api/auth/register` ([`register_user`](file:///home/diegolima/Git/cybercantina/backend/app/routers/auth.py#L144-L180)) and [`AuthScreen`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AuthScreen.tsx#L11-L115) always allow open account creation whenever multi-user mode is active. Admins cannot close public signups at runtime while keeping existing users active.
2. **No Persistent User Activity Signal:** The `users` table ([`schema.sql`](file:///home/diegolima/Git/cybercantina/backend/app/db/schema.sql#L6-L14)) records only `created_at` and `updated_at` (mutated only on profile/password/passkey edits). Meanwhile, `user_sessions.last_active_at` is deleted when a session expires after 24 hours of inactivity (`SESSION_IDLE_TIMEOUT_SECONDS`) or on logout. Once a session ends, the system has no record of when the user was last active.
3. **No Automated Inactivity Cleanup / Housekeeping Scheduler:** Inactive accounts accumulate turns, vector BLOBs, worlds, and character media indefinitely. Deleting rows manually in SQLite also leaves dead pages inside `cybercantina.db` without reclaiming disk space.
4. **No Per-User Media Storage Quotas:** [`process_and_save_image`](file:///home/diegolima/Git/cybercantina/backend/app/dependencies.py#L330-L358) enforces a 20 MB per-file upload ceiling, but users can upload unlimited portraits/gallery images and import unlimited `.zcc` / SillyTavern PNG bundles, creating unbounded disk growth.
5. **No Unified Server Policy Surface:** Server-wide operational policies (self-registration, inactivity purge timeouts, media quotas, and housekeeping schedule/status) have no dedicated home in [`AdminModal`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AdminModal.tsx#L172-L214).

### 1.2 Proposed Solution
Introduce a **Server Configuration** tab in the Admin Modal backed by persistent `AppSettings`, durable user activity tracking (`last_active_at` + `last_login_at`), **Chloromancer** (an extensible in-process async housekeeping scheduler starting with inactive-user purging and SQLite space reclamation), and opt-in per-user **media storage quotas** enforced across all image-write paths.

> [!NOTE]
> **Deferred Scope (Explicitly Excluded from v0.11.0):**
> - **Browser-local storage of provider API keys** (client-side key vault + browser-direct OpenRouter/OpenAI-compat relay driver) will be designed in a separate FRD.
> - **Chloromancer LLM-based world/memory housekeeping** (claim NLI verification, character action attribution, omission detection, and inventory lineage checks on `episodic_chunks`) is deferred to a follow-up phase; v0.11.0 establishes the scheduler runtime and job contract for it.
> - **Cloudflare / Edge Deployment Hardening** (Tunnel setup, `CF-Connecting-IP` proxy headers, SSE keepalive heartbeats, Turnstile) is tracked separately as hosting infrastructure work.

---

## 2. Scope, Boundaries & Core Invariants

1. **Zero-Surprise Defaults for Local Self-Hosters:**
   - `allow_self_registration` defaults to `True` (preserving current multi-user behavior).
   - `inactive_user_purge_days` defaults to `None` (disabled). Existing local instances must **never** purge accounts automatically unless an admin explicitly configures a positive timeout.
   - `user_media_quota_mb` defaults to `None` (disabled).
2. **Admin Protection Invariant:**
   - Inactivity detection and automated purging apply **strictly** to standard accounts (`role = 'user'`).
   - Accounts with `role = 'admin'` must **never** be marked eligible for inactivity purge or deleted by Chloromancer.
3. **Single-Process Scheduler Safety:**
   - Chloromancer must run in-process via `asyncio` (no external Celery/Redis/APScheduler dependencies) and guard every job with an `asyncio.Lock` so scheduled ticks and manual admin `"Run Now"` requests cannot race.
4. **All Media Write Paths Covered:**
   - Media quota enforcement must cover direct portrait/gallery uploads, SillyTavern PNG card artwork staging, and `.zcc` bundle imports—measured against **persisted WebP disk footprint**, never raw pre-compression upload size alone.
5. **Module Boundary Compliance:**
   - Any new backend packages (e.g., `app.housekeeping`) must be declared in `backend/tach.toml` (`tach check` clean) and architecture docs regenerated (`scripts/generate_arch_docs.py`).
   - Frontend additions must respect `frontend/.dependency-cruiser.cjs` (`npm --prefix frontend run arch:check`).

---

## 3. Functional Requirements & Edge Cases

### FR-1: User Activity Tracking (`last_active_at` & `last_login_at`)
**Requirement:** Persist durable activity timestamps on `users` so administrators and Chloromancer can accurately determine when an account was last used, even after sessions expire or log out.

- **Schema Additions (`users` table in `schema.sql` + `schema_init.py`):**
  - Add `last_login_at TEXT NULL` and `last_active_at TEXT NULL` (stored as UTC ISO-8601 `%Y-%m-%dT%H:%M:%SZ`, matching `created_at` / `user_sessions.last_active_at`).
  - **Migration Backfill:** When adding the columns on existing databases, backfill `last_active_at` using `COALESCE((SELECT MAX(last_active_at) FROM user_sessions WHERE user_sessions.user_id = users.id), created_at)` so pre-existing accounts have a deterministic baseline rather than `NULL`.
  - Add an index `idx_users_last_active ON users(role, last_active_at)` for fast inactivity queries.
- **Update Triggers:**
  - **On registration (`POST /api/auth/register`), initial setup (`POST /api/auth/setup`), admin user creation, password login (`POST /api/auth/login`), and passkey login (`POST /api/auth/passkey/login/finish`):** Set both `last_login_at` and `last_active_at` to `now`.
  - **On authenticated session activity (`get_and_touch_session`):** Update `users.last_active_at` **throttled** (only if the stored `users.last_active_at` is older than a cooldown, e.g., `15 minutes` or `1800 seconds`, or `NULL`). This captures users who remain active across multi-day sliding sessions without triggering a `users` table write on every API request.
- **API & UI Visibility:**
  - Include `last_login_at`, `last_active_at`, and `media_bytes_used` (or dedicated admin-user stats) on admin user listings (`GET /api/admin/users`) and `UserProfile` (or `AdminUserSummary`).
  - Display `Last Active`, `Last Login`, and (when inactivity purge is enabled) `"Purge in N days"` / `"Eligible for purge"` countdown badges in [`AdminUsersTab`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AdminUsersTab.tsx) for standard (`role = 'user'`) accounts.
  - Display the configured inactivity purge policy and remaining grace window (alongside a reminder to export `.zcc` backups) in [`ProfileAccountTab`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/ProfileAccountTab.tsx) for standard user accounts whenever `inactive_user_purge_days` is enabled.
- **Edge Cases:**
  - **Active Session vs. Stale `last_login_at`:** A user who logged in 20 days ago and uses their sliding session daily has `last_login_at` = 20 days ago, `last_active_at` = today. Inactivity purge must evaluate **`last_active_at`**, never `last_login_at` alone.
  - **Single-User Passwordless Mode:** Updating `last_active_at` is harmless, and `admin` accounts are never subject to inactivity purge anyway.

---

### FR-2: Chloromancer Scheduler & Inactive-User Purge Job
**Requirement:** Implement **Chloromancer**, an extensible background housekeeping scheduler wired into FastAPI’s [`lifespan`](file:///home/diegolima/Git/cybercantina/backend/app/main.py#L105-L131), initially running the **inactive-user purge** job.

- **Scheduler Architecture (`backend/app/housekeeping/`):**
  - Define a clean job abstraction (`HousekeepingJob` protocol/registry) with metadata: `job_id`, `description`, `interval_seconds`, `enabled`, and an `async run(ctx) -> HousekeepingRunResult`.
  - v0.11.0 registers `purge_inactive_users` (periodic tick, e.g., configurable or default every 1 hour / 3600s; no-op when `inactive_user_purge_days` is `None` or `<= 0`).
  - Future Chloromancer LLM world-consistency jobs (claim verification, attribution, omission checks, inventory auditing) will register into this same scheduler without refactoring lifecycle wiring.
  - Guard each job with an `asyncio.Lock` and handle `asyncio.CancelledError` cleanly during shutdown.
- **Persistence of Run History (`chloromancer_runs` table or equivalent):**
  - Record each executed (non-dry-run) run: `id`, `job_id`, `trigger` (`"scheduled" | "manual"`), `started_at`, `finished_at`, `status` (`"ok" | "skipped" | "error"`), `items_affected` (purged user count), `details_json` (e.g., `bytes_reclaimed`, `vacuum_ran`, `orphan_media_dirs_removed`, error summary).
- **Inactive-User Purge Semantics:**
  - Cutoff timestamp: `now_utc - timedelta(days=inactive_user_purge_days)`.
  - Candidate query: `role = 'user' AND COALESCE(last_active_at, created_at) < cutoff_iso`.
  - Never select `role = 'admin'`, and never delete the currently executing admin if triggered manually.
  - For each candidate, invoke [`repo.delete_user(user_id)`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/auth_users.py#L361-L379) (which deletes campaigns, turn trees, vector entries, worlds, characters + media, notes, personas, prompt presets, user providers, user model settings, sessions, passkeys, and the user row).
  - **SQLite Disk Space Reclamation:** If at least one user was deleted during a run, checkpoint WAL (`PRAGMA wal_checkpoint(TRUNCATE)`) and run `VACUUM` (serialized carefully against active DB writes / threadpool) so deleted turns and vector BLOBs return disk space to the OS.
  - **Orphan Media Sweep (Safety Net):** Optionally scan `media_dir` for `<character_id>` directories that do not exist in `characters` **and** whose directory mtime is older than a safety grace window (e.g., 24 hours, so staged SillyTavern card imports not yet saved by a user are never wiped mid-flow).
- **Admin Control Endpoints (`require_admin`):**
  - `GET /api/admin/chloromancer/status`: Returns scheduler state, registered jobs, and recent run history (`chloromancer_runs`).
  - `GET /api/admin/chloromancer/purge-preview`: Dry-run preview listing all `role = 'user'` accounts currently past the configured `inactive_user_purge_days` cutoff (username, `last_active_at`, days inactive, character/world/campaign count, media bytes). Accepts an optional `?days=` query override so an admin can preview before lowering the timeout.
  - `POST /api/admin/chloromancer/run/{job_id}`: Manually triggers a job (e.g. `purge_inactive_users`), respecting the job lock (`409` if already running).
- **Edge Cases:**
  - **Lowering Timeout Cliff:** If an admin lowers `inactive_user_purge_days` from `30` to `7` in Server Configuration, users inactive for 8–29 days become immediately eligible on the next scheduled tick. The UI must display a live preview/count warning before saving a stricter timeout if any users would immediately qualify.
  - **Purging a User With Active SSE/WS:** Since `cutoff` is measured in days (`>= 1` day) and `last_active_at` is updated on active requests, an actively connected user cannot be selected.

---

### FR-3: Global User Media Quotas
**Requirement:** Allow administrators to set a global maximum media storage limit per user account (e.g., `5 MB`), disabled (`None`) by default.

- **Configuration (`AppSettings`):**
  - Add `user_media_quota_mb: float | None = Field(default=None, ge=0.5, le=10240.0)` (or integer MB / `None` = unlimited).
  - Applies **strictly to standard accounts (`role == 'user'`)**; accounts with `role == 'admin'` are **exempt** from media quotas so operators can seed showcase worlds/characters freely.
- **Authoritative Usage Calculation:**
  - Compute `get_user_media_usage_bytes(user_id)` directly from disk by summing file sizes under `safe_resolve_character_media_dir(media_dir, char_id)` for all characters owned by `user_id` (including `pending_deletion = 1` characters, since their files remain on disk until pruned).
  - Avoid drifting cached counters in SQLite; per-user character counts are small enough that summing `os.scandir` / `rglob` for one owner is sub-millisecond.
- **Enforcement Across All Media Write Paths:**
  - Centralize a helper (e.g., `enforce_user_media_quota(repo, user, incoming_webp_bytes, replacing_path=None)`):
    1. If `user.role == "admin"` or `quota_bytes is None`, skip quota enforcement.
    2. Convert/resize the uploaded image to WebP in memory (still enforcing the existing 20 MB raw upload guard in [`process_and_save_image`](file:///home/diegolima/Git/cybercantina/backend/app/dependencies.py#L330-L358)) so quota checks the **actual WebP byte size** that will land on disk.
    3. Subtract `replacing_path.stat().st_size` if replacing an existing emotion portrait.
    4. If `current_used + new_bytes - replaced_bytes > quota_bytes`, reject with `HTTP 413 Payload Too Large` and a clear error: e.g., `"Media storage quota exceeded (4.85 MB / 5.00 MB used). Delete existing portraits or gallery images to free space."`
  - **Required Call Sites:**
    1. [`upload_character_portrait`](file:///home/diegolima/Git/cybercantina/backend/app/routers/characters.py#L441-L485)
    2. [`upload_character_gallery_image`](file:///home/diegolima/Git/cybercantina/backend/app/routers/characters.py#L523-L555)
    3. [`distill_sillytavern_card`](file:///home/diegolima/Git/cybercantina/backend/app/routers/characters.py#L216-L254): Check quota after converting the embedded card artwork to WebP; if staging the portrait or gallery artwork would exceed the user's quota, **allow text-only distillation to succeed**, skip/clean up the over-quota staged media files for that request (`draft.portraits = {}`, `draft.gallery = []`), and return an explicit warning field/banner so the user knows the character profile was imported without artwork due to their media quota.
    4. [`commit_staged_import`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py#L837-L867) (`.zcc` bundle import—must enforce cumulative quota across all imported characters' portraits and gallery images, cleaning up any partially unpacked `new_c_id` media dirs and returning `413` if the quota is exceeded mid-bundle).
- **User Visibility:**
  - Expose `media_bytes_used` and `media_quota_bytes` (`null` when unlimited or for exempt `admin` accounts) in user profile / auth status or `GET /api/profile` so [`ProfileAccountTab`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/ProfileAccountTab.tsx) and upload UIs can show a simple usage indicator (e.g., `1.4 MB / 5.0 MB` or `Exempt (Admin)`).
- **Edge Cases:**
  - **Quota Lowered Below Existing Usage:** Existing files are **never** auto-deleted when an admin lowers the quota; the user simply cannot add net-new media bytes until they delete enough images (though replacing an existing portrait with a *smaller* WebP should still be allowed!).
  - **Concurrent Uploads:** Use a per-user `asyncio.Lock` or `threading.Lock` around the check-and-write step so two parallel gallery uploads cannot both pass the quota check simultaneously.

---

### FR-4: Self-Registration Toggle
**Requirement:** Allow admins to enable or disable public self-registration at runtime via Server Configuration.

- **Configuration (`AppSettings`):**
  - Add `allow_self_registration: bool = Field(default=True)`.
  - Optionally support `CYBERCANTINA_ALLOW_SELF_REGISTRATION` env default on first boot (when `cantina_settings.json` does not exist yet), while keeping the Admin UI as the runtime authority once persisted.
- **Backend Enforcement:**
  - In [`register_user`](file:///home/diegolima/Git/cybercantina/backend/app/routers/auth.py#L144-L180) (`POST /api/auth/register`): if `not settings.allow_self_registration`, return `HTTP 403` (`"Public account registration is currently disabled by the administrator."`).
  - Keep [`initial_setup`](file:///home/diegolima/Git/cybercantina/backend/app/routers/auth.py#L72-L112) (`POST /api/auth/setup` when `user_count == 0`) and [`admin_create_user`](file:///home/diegolima/Git/cybercantina/backend/app/routers/auth.py#L496-L525) (`POST /api/admin/users`) **unaffected** so admins can always bootstrap and manually provision accounts.
- **Unauthenticated Auth Status & Frontend (`AuthScreen.tsx`):**
  - Add `allow_self_registration: bool` to [`AuthStatusResponse`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/auth.py#L34-L38) returned by `GET /api/auth/status`.
  - In [`AuthScreen`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AuthScreen.tsx#L92-L115), hide the `"Create Account"` tab (and reset `mode` to `"login"`) when `allowSelfRegistration === false`, optionally showing a subtle note: `"Registration is closed; contact an administrator for an account."`

---

### FR-5: "Server Configuration" Tab in Admin Modal
**Requirement:** Add a dedicated `"Server Configuration"` tab to [`AdminModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AdminModal.tsx#L172-L214) consolidating server policy and Chloromancer housekeeping controls.

- **Tab Layout (`AdminServerConfigTab.tsx`):**
  - **Access & Registration Section:**
    - Toggle: **Allow Public Self-Registration** (`allow_self_registration`), with brief inline description noting admin-created accounts remain allowed.
  - **Storage Quotas Section:**
    - Toggle / numeric input: **Per-User Media Quota** (`Disabled` by default, or enabled with `MB` numeric input, e.g., `5` MB), noting it applies to standard user accounts and is measured after WebP compression.
  - **Account Inactivity & Chloromancer Housekeeping Section:**
    - Toggle / numeric input: **Inactive User Purge Timeout** (`Disabled` by default, or enabled with `Days` numeric input, e.g., `14` days), explicitly stating *"Applies only to standard user accounts; admin accounts are never purged."*
    - **Chloromancer Check Interval** (e.g., hourly / every 6 hours / daily) or read-only cadence + live status card showing:
      - Scheduler status, last run timestamp, last run outcome, and recent run log.
      - **Preview Eligible Accounts (Dry Run)** button displaying a table/list of matching inactive users (username, last active date, days idle, owned characters/worlds/campaigns, media size) before saving a lower timeout or triggering a manual sweep.
      - **Run Cleanup Now** button (with confirmation dialog when `eligibleCount > 0`) calling `POST /api/admin/chloromancer/run/purge_inactive_users`.
  - **Persistence & Concurrency:**
    - Uses the existing optimistic-concurrency `settings_revision` flow in [`apply_settings`](file:///home/diegolima/Git/cybercantina/backend/app/providers/settings_service.py#L37-L80) (`PUT /api/settings`) so concurrent edits in `Models` and `Server Configuration` never clobber each other silently.
    - When `PUT /api/settings` saves `allow_self_registration` or `user_media_quota_mb`, emit `onSettingsUpdated` so parent app state stays synchronized.

---

## 4. Non-Functional Requirements & Security Considerations

1. **No Path Traversal or Log Injection:**
   - Media quota directory scans must route exclusively through [`safe_resolve_character_media_dir`](file:///home/diegolima/Git/cybercantina/backend/app/security/media_path.py) (never raw `Path` joins).
   - Chloromancer logs and audit summaries involving usernames/IDs must sanitize dynamic strings via [`sanitize_log_value`](file:///home/diegolima/Git/cybercantina/backend/app/security/log_sanitize.py).
2. **No Sensitive Leakage to Non-Admins:**
   - [`_redacted_for_user`](file:///home/diegolima/Git/cybercantina/backend/app/routers/settings.py#L50-L57) (or `GET /api/settings`) may expose `allow_self_registration` and `user_media_quota_mb` safely, while admin-only Chloromancer endpoints (`/api/admin/chloromancer/*`) must require `require_admin`.
3. **Graceful SQLite Locking Under Background Cleanup:**
   - Run `delete_user` batches and `VACUUM` in `asyncio.to_thread(...)` so the single-worker Uvicorn event loop (serving SSE streams and `/api/local-relay/ws` heartbeats) is never blocked while pruning accounts or compacting the database.
4. **Data-Loss Prevention on First Enable:**
   - Turning on `inactive_user_purge_days` should show the dry-run count in the UI (and require explicit Save) before Chloromancer executes its first sweep.

---

## 5. Resolved Design Decisions

1. **Admin Exemption from Media Quotas:**
   - **Decision:** Accounts with `role == 'admin'` are **exempt** from `user_media_quota_mb` (consistent with their exemption from `inactive_user_purge_days`). This should be stated explicitly in the Server Configuration UI and shown as exempt in the admin's own profile usage view.
2. **SillyTavern Card Import Media Staging When Over Quota:**
   - **Decision:** [`distill_sillytavern_card`](file:///home/diegolima/Git/cybercantina/backend/app/routers/characters.py#L216-L254) **allows text-only distillation to succeed** when staging card artwork would exceed the user's media quota, cleans up any skipped/partial staged artwork for that request, and surfaces a clear warning to the user.
3. **Inactivity Purge Countdown & Policy Notice Visibility:**
   - **Decision:** When `inactive_user_purge_days` is enabled, display per-user inactivity countdown badges (`Active Xd ago · Yd left`) in [`AdminUsersTab`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AdminUsersTab.tsx) **and** display the instance's inactivity retention policy + `.zcc` backup reminder in [`ProfileAccountTab`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/ProfileAccountTab.tsx).

---

## 6. Acceptance Criteria

- [ ] **Activity Tracking:** `users.last_active_at` and `users.last_login_at` exist in SQLite, backfill cleanly on existing DBs, update on login/register/passkey auth, and update throttled on active session usage.
- [ ] **Self-Registration Toggle:** Disabling `allow_self_registration` in Server Configuration hides the `"Create Account"` tab in `AuthScreen` and causes `POST /api/auth/register` to return `403`, while `admin_create_user` continues working.
- [ ] **Media Quota Enforcement:** Setting `user_media_quota_mb` (e.g. `5` MB) blocks over-quota portrait uploads, gallery uploads, and `.zcc` bundle imports for `role = 'user'` accounts (returning `413` measured in output WebP bytes), allows text-only SillyTavern distillation with a warning when artwork staging exceeds quota, exempts `role = 'admin'` accounts, allows net-reducing portrait replacements, and disables cleanly when `None`.
- [ ] **Chloromancer Purge:** Enabling `inactive_user_purge_days` purges only `role = 'user'` accounts whose `last_active_at` exceeds the threshold, removes all owned DB rows and character media directories, runs `VACUUM` / WAL truncation when deletions occur, and never touches `role = 'admin'` accounts.
- [ ] **Admin & Profile UI:** The new **Server Configuration** tab in `AdminModal` persists all settings atomically with `settings_revision`, displays Chloromancer run history, supports dry-run preview and manual run; `AdminUsersTab` shows `last_active_at` / `last_login_at` and purge countdowns; `ProfileAccountTab` displays media usage and the inactivity purge notice when enabled.
- [ ] **Checks Pass:** `ruff check`, `tach check`, `pytest`, `npm --prefix frontend run arch:check`, `npm --prefix frontend run build`, `npm --prefix frontend test`, and `scripts/generate_arch_docs.py --check` all pass once implemented.
