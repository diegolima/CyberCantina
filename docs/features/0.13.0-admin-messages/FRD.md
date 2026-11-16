---
feature: admin-messages
target_version: 0.13.0
document_type: frd
status: draft
last_updated: 2026-11-16
---

# Feature Requirements Document (FRD)
## Admin Communication Messages (Login & Home Banners, Scheduling, Archive & Chloromancer Cleanup)

**Status:** Draft  
**Target Version:** CyberCantina v0.13.0  
**Scope:**
- Backend Persistence & Schema (`backend/app/db/schema.sql`, `backend/app/db/repos/schema_init.py`, `backend/app/db/repos/`)
- Backend Schemas & Routers (`backend/app/schemas/`, `backend/app/routers/`, `backend/app/routers/auth.py`, `backend/app/main.py`)
- Backend Chloromancer Housekeeping (`backend/app/housekeeping/`)
- Frontend Admin UI (`frontend/src/components/auth/AdminModal.tsx`, new Communication tab component)
- Frontend Public & Home Banner UI (`frontend/src/components/auth/AuthScreen.tsx`, `frontend/src/components/HomeScreen.tsx`, `frontend/src/App.tsx`, `frontend/src/styles.css`, shared banner component & `localStorage` state helper)
- Frontend API & Types (`frontend/src/api/`, `frontend/src/types/`)
- Automated Tests (`backend/tests/`, `frontend/src/components/__tests__/`)
- User-Facing Wiki Documentation (`cybercantina-wiki/Authentication-Multi-User-and-Security.md`, `cybercantina-wiki/First-Campaign-and-Interface-Tour.md`)

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
CyberCantina supports multi-user authentication, self-registration controls, and automated Chloromancer housekeeping, but administrators currently have **no built-in communication channel** to notify users about planned maintenance windows, expected downtimes, policy changes, or instance announcements:

1. **No Pre-Authentication Notices:** Users visiting [`AuthScreen`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AuthScreen.tsx#L23-L116) during an outage or maintenance window have no way to see server notices before attempting to sign in or register.
2. **No In-App Announcement Banner:** [`HomeScreen`](file:///home/diegolima/Git/cybercantina/frontend/src/components/HomeScreen.tsx#L415-L513) renders client-side hardware notices (`.home-webgpu-notice`), but has no server-managed announcement surface for operational updates.
3. **No Lifecycle Management for Notices:** Admins need scheduling (`from` / `until`), priority-based styling and ordering, safe revision-based re-notification when a message changes, soft deletion with a recovery window, and automatic cleanup of old messages.

### 1.2 Proposed Solution
Add an **Admin Communication Messages** system consisting of:
- A new **"Communication"** tab in [`AdminModal`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AdminModal.tsx#L23-L272) (disabled in single-user passwordless mode) with **Active** and **Archived** views.
- A dedicated `admin_messages` SQLite table using **stable UUID primary keys (`id`)** paired with a monotonic **`revision`** counter, soft-delete timestamps (`deleted_at`), effective-date windows (`starts_at`, `expires_at`), urgency grouping, and per-group `sort_order`.
- Unauthenticated delivery of active **Login** messages (only when setup is complete and multi-user mode is active) above the sign-in card in [`AuthScreen`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AuthScreen.tsx#L113-L124), and authenticated delivery of active **Home** messages in [`HomeScreen`](file:///home/diegolima/Git/cybercantina/frontend/src/components/HomeScreen.tsx#L413-L416).
- Collapsible, optionally dismissable message banners backed by `localStorage` state so dismissed/collapsed choices persist cleanly without database write overhead.
- A built-in **Chloromancer** housekeeping job that permanently purges messages deleted or expired more than 7 days ago.

> [!NOTE]
> **Deferred Scope (Explicitly Excluded from v0.13.0):**
> - **Mid-session push notifications / WebSocket broadcast banners inside active `ChatStage` gameplay:** Home messages render on [`HomeScreen`](file:///home/diegolima/Git/cybercantina/frontend/src/components/HomeScreen.tsx); users actively inside a campaign see updated Home messages when returning to Home or reloading.
> - **Per-user server-side read/dismiss receipts:** Dismissal and collapse preferences are intentionally stored client-side in `localStorage`.

---

## 2. Scope, Boundaries & Core Invariants

1. **Stable Identity + Revision Separation:**
   - Every message row has an immutable UUID primary key `id` and a separate integer `revision` (starting at `1`).
   - Editing message content/settings or restoring an archived message increments `revision` while keeping `id` intact.
   - Reordering messages within an urgency group updates `sort_order` **only** and must **not** increment `revision` (so reordering does not re-trigger dismissed banners).
2. **Single-User Mode Suppression:**
   - When `singleUserMode === true` (single passwordless admin), the `"Communication"` tab in [`AdminModal`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AdminModal.tsx) is greyed out/disabled, and neither Login nor Home messages are served or displayed.
3. **Unauthenticated Endpoint Safety:**
   - Unauthenticated clients may only fetch active `login` / `both` messages when `setup_required === false` and `single_user_mode === false`.
   - Public payloads must strip internal admin/audit fields and never render raw HTML in the browser.
4. **Dedicated Table Isolation:**
   - Messages live in `admin_messages`, separate from [`AppSettings`](file:///home/diegolima/Git/cybercantina/backend/app/config.py#L200-L286) and `settings_revision`, so announcement edits never collide with model/server policy saves.
5. **Module Boundary Compliance:**
   - Backend imports must pass `tach check` (`backend/tach.toml`), frontend imports must pass `npm --prefix frontend run arch:check`, and architecture docs must be regenerated via `scripts/generate_arch_docs.py`.

---

## 3. Functional Requirements & Edge Cases

### FR-1: Message Data Model & Lifecycle States
**Requirement:** Persist admin messages in a dedicated SQLite table (`admin_messages`) supporting versioning, placement, urgency, effective dates, ordering, and soft deletion.

- **Fields:**
  - `id` (`TEXT PRIMARY KEY`): Stable UUID generated at creation; never mutated on edit or restore.
  - `revision` (`INTEGER NOT NULL DEFAULT 1`): Incremented by `+1` whenever `placement`, `title`, `message`, `urgency`, `starts_at`, `expires_at`, or `dismissable` changes, or when an archived message is restored via edit.
  - `placement` (`TEXT NOT NULL`): `"login" | "home" | "both"`.
  - `title` (`TEXT NOT NULL`): Short heading (trimmed, non-empty, max `120` characters).
  - `message` (`TEXT NOT NULL`): Body text (trimmed, non-empty, max `2000` characters).
  - `urgency` (`TEXT NOT NULL DEFAULT 'info'`): `"info" | "warning" | "critical"`.
  - `dismissable` (`INTEGER NOT NULL DEFAULT 1`): Boolean (`true` by default).
  - `starts_at` (`TEXT NULL`): Optional UTC ISO-8601 timestamp (`%Y-%m-%dT%H:%M:%SZ`). `NULL` means effective immediately.
  - `expires_at` (`TEXT NULL`): Optional UTC ISO-8601 timestamp (`%Y-%m-%dT%H:%M:%SZ`). `NULL` means no automatic expiration.
  - `sort_order` (`INTEGER NOT NULL DEFAULT 0`): Display order within the message's `urgency` group (lower values appear first).
  - `created_at` (`TEXT NOT NULL`), `updated_at` (`TEXT NOT NULL`), `deleted_at` (`TEXT NULL`).
- **Derived Lifecycle States (evaluated against server `now_utc`):**
  - **Active (Live):** `deleted_at IS NULL` AND `(starts_at IS NULL OR starts_at <= now_utc)` AND `(expires_at IS NULL OR expires_at > now_utc)`.
  - **Scheduled (Future):** `deleted_at IS NULL` AND `starts_at IS NOT NULL AND starts_at > now_utc` (visible in Admin Active tab with a `"Scheduled"` badge; excluded from public Login/Home responses until `starts_at`).
  - **Expired (Archived):** `deleted_at IS NULL` AND `expires_at IS NOT NULL AND expires_at <= now_utc`.
  - **Deleted (Archived):** `deleted_at IS NOT NULL`.
- **Validation Rules:**
  - On create and update, `expires_at` (`Until`) must be `NULL`/empty or `>= now_utc` (past `Until` values are rejected with `HTTP 422`/`400`).
  - If both `starts_at` and `expires_at` are set, enforce `expires_at > starts_at` (return `HTTP 422`/`400` otherwise).
  - Reject empty/whitespace-only `title` or `message`, invalid `placement`/`urgency` values, or lengths exceeding field bounds.

---

### FR-2: Admin "Communication" Tab & "Archived" View
**Requirement:** Add a `"Communication"` tab to [`AdminModal`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AdminModal.tsx#L25-L272) for creating, editing, ordering, soft-deleting, and archiving/restoring messages.

- **Single-User Mode Gating:**
  - When `singleUserMode === true`, render the `"Communication"` tab button as disabled/greyed out with an explanatory tooltip (e.g., *"Communication messages are unavailable in single-user passwordless mode. Set an admin password to enable multi-user mode."*).
  - If `AdminModal` is opened with `initialTab="communication"` while `singleUserMode === true`, fall back to `"users"`.
- **Sub-Navigation (`Active` vs. `Archived`):**
  - **Active Sub-Tab:** Lists all non-deleted, non-expired messages (`deleted_at IS NULL AND (expires_at IS NULL OR expires_at > now_utc)`), including live and future-scheduled messages.
    - Displays messages **grouped by urgency** in fixed order: **Critical** → **Warning** → **Info**.
    - Within each urgency group, admins can **drag-and-drop** message cards to reorder them (implemented with native HTML5 drag-and-drop consistent with [`MapPaletteBar.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapPaletteBar.tsx#L123-L128), plus accessible Up/Down buttons for keyboard/touch users).
    - Dragging must be constrained strictly within the same urgency group (a `warning` card cannot be dropped into `critical`).
    - Shows placement badge (`Login`, `Home`, `Both`), `Dismissable` / `Pinned` badge, `Scheduled` badge + effective window summary if `starts_at`/`expires_at` is set, and `Edit` / `Delete` actions.
  - **Archived Sub-Tab:** Lists all **Deleted** (`deleted_at IS NOT NULL`) and **Expired** (`deleted_at IS NULL AND expires_at <= now_utc`) messages within the 7-day retention window.
    - Each item displays its archive reason badge (`Deleted` with deletion timestamp, or `Expired` with expiration timestamp) and an **Edit & Restore** action.
- **Create & Edit Form:**
  - Fields: `Placement` (`Login` / `Home` / `Both`), `Title`, `Message`, `Urgency` (default `Info`), `From` date/time picker (optional, defaults to blank), `Until` date/time picker (optional, defaults to blank), `Dismissable` checkbox (checked by default).
  - Date/time pickers accept local browser date/time (`datetime-local`), display the admin's local timezone hint, and convert to/from UTC ISO-8601 when communicating with the API.
  - **Editing an Archived Message (Restore Flow):**
    - Opening an archived (deleted or expired) message in the edit form allows modifying any field and saving.
    - When opening an **expired** message (`expires_at <= now`), the UI automatically clears the `Until` (`expires_at`) input so the admin can immediately restore it with no expiration or pick a new `Until >= now` timestamp.
    - Saving clears `deleted_at` (`NULL`), sets `sort_order` appropriately for its urgency group (e.g. end of group if urgency changed or restored), bumps `revision += 1`, enforces `expires_at IS NULL OR expires_at >= now_utc` (and `> starts_at` if set), and returns the message to the **Active** tab.
- **Soft Delete:**
  - Clicking Delete on an Active message soft-deletes it (`deleted_at = now_utc`), removing it immediately from Active, Login, and Home views and moving it into Archived.

---

### FR-3: Login & Home Display Placement and Ordering
**Requirement:** Render active messages on the Login/Registration page and User Home screen in deterministic order.

- **Ordering Invariant (Login & Home):**
  - Messages are ordered strictly by urgency: **`critical` → `warning` → `info`**.
  - Within each urgency tier, messages are ordered by **`sort_order ASC`** (matching their exact order in the Admin Communication tab, with `created_at ASC` as deterministic tie-breaker).
- **Login / Registration Screen ([`AuthScreen.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AuthScreen.tsx)):**
  - Display active messages with `placement IN ('login', 'both')` **above** the main login/registration `.modal-panel` card.
  - Wrap the message stack and `.modal-panel` inside a vertical flex column container inside `.auth-stage-backdrop` (`styles.css` currently uses row flex directly on `.auth-stage-backdrop`) so banners stack cleanly above the card on desktop and mobile viewports.
  - Served **unauthenticated** (either bundled in `GET /api/auth/status` or via a dedicated unauthenticated `GET /api/messages/login` endpoint; returning an empty list whenever `setup_required === true` or `single_user_mode === true`).
- **User Home Screen ([`HomeScreen.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/HomeScreen.tsx)):**
  - Display active messages with `placement IN ('home', 'both')` above `.home-deck-area` (above `.home-webgpu-notice`), styled consistently with Home notice cards.
  - Suppressed when `singleUserMode === true`.
- **Visual Styling by Urgency:**
  - **`info`**: `--accent-cyan` border/tint and `Info` icon.
  - **`warning`**: `--accent-amber` border/tint and `AlertTriangle` icon.
  - **`critical`**: `--accent-rose` border/tint and critical alert icon (`AlertOctagon` / `AlertTriangle`).
  - Visually distinguish announcement cards from inline form-validation alerts (`.auth-alert-error`) so users do not mistake a critical server notice above the login card for a bad-password error.
- **Message Body Rendering:**
  - Render `message` as safe plain text preserving newlines (`white-space: pre-wrap`) with optional safe `https://`/`http://` URL auto-linking (never raw HTML / `dangerouslySetInnerHTML`).

---

### FR-4: Collapsible, Dismissable UX & `localStorage` Persistence
**Requirement:** Allow users to collapse any message and dismiss dismissable messages, persisting state client-side in `localStorage`.

- **Expanded State:**
  - Header row displays: `[Urgency Icon] [Title] ... [ChevronUp button] [X button (only if dismissable === true)]`.
  - Message body displays below the header row.
  - Clicking the header row or ChevronUp button collapses the message (do **not** bind collapse to the message body so users can select/copy URLs, dates, or instructions).
  - Clicking `"X"` calls `e.stopPropagation()` and dismisses the message.
- **Collapsed State:**
  - Renders a compact single-line bar displaying only the **urgency icon**, **title** (truncated cleanly with `text-overflow: ellipsis; min-width: 0` on narrow screens for responsive friendliness), and **expand chevron indicator** (`ChevronDown`).
  - The `"X"` dismiss button is **hidden while collapsed** (even for dismissable messages) to preserve minimal single-line width; users click the collapsed bar to expand it and then dismiss if desired.
  - Clicking anywhere on the collapsed bar expands the message.
  - If `dismissable === false`, no `"X"` button is shown in either state; non-dismissable messages remain collapsible.
- **Accessibility:**
  - Header toggle uses proper `<button>` semantics with `aria-expanded={isExpanded}`.
  - `"X"` dismiss button uses a distinct `aria-label` (e.g., `"Dismiss message"`).
- **`localStorage` State Model & Re-Notification Semantics:**
  - Store a compact JSON map keyed by `message.id`: `{ dismissedRevision?: number; collapsed?: boolean }`.
  - **Storage Scoping:**
    - Login screen uses an unauthenticated key (e.g., `cantina_login_admin_msg_state_v1`).
    - Home screen uses a per-user key (e.g., `cantina_home_admin_msg_state_v1:${currentUser.id}`).
    - **Cross-surface continuity for `placement === "both"`:** When initializing or reading state on Home for a `"both"` message, if the user has no Home entry yet for `(id, revision)` (or their Home `dismissedRevision` is older), honor any matching `(id, revision)` dismiss/collapse state already recorded on Login so users do not have to dismiss the exact same banner twice back-to-back.
  - **Dismissal Reset on Edit/Restore:** A message is hidden as dismissed **only if** `msg.dismissable === true` **and** `stored.dismissedRevision === msg.revision`. If the admin edits or restores the message (`revision` increases) or unchecks `dismissable`, the message reappears automatically.
  - **Collapse Persistence:** `stored.collapsed` is keyed by stable `msg.id`, so collapsed messages remain collapsed across page reloads, sessions, and minor edits.
  - **Removal & Pruning:** When an admin deletes a message or its `expires_at` passes, the server stops returning it in active endpoints, so it disappears immediately on next fetch. Prune stale `id`s from `localStorage` when no longer returned (or after expiry) to avoid unbounded growth.

---

### FR-5: Chloromancer Purge Job (`purge_admin_messages`)
**Requirement:** Add a built-in Chloromancer housekeeping task that permanently removes soft-deleted or expired admin messages older than 7 days.

- **Job Registration (`backend/app/housekeeping/scheduler.py`):**
  - Register `purge_admin_messages` in `ChloromancerScheduler._register_builtin_jobs()`.
  - Must be **always enabled** (`is_enabled=lambda: True`) regardless of whether `inactive_user_purge_days` is configured, running on the scheduler's configured `chloromancer_interval_minutes` cadence (and manually runnable via `POST /api/admin/chloromancer/run/purge_admin_messages`).
- **Purge Criteria:**
  - Cutoff timestamp: `cutoff_iso = now_utc - timedelta(days=7)`.
  - Hard-delete rows from `admin_messages` where:
    `(deleted_at IS NOT NULL AND deleted_at < cutoff_iso)` OR `(expires_at IS NOT NULL AND expires_at < cutoff_iso)`.
- **Run History & Visibility:**
  - Record each execution in `chloromancer_runs` (`items_affected` = count of permanently deleted messages, `details_json` = breakdown of deleted vs. expired purged).
  - Automatically surfaces in the Chloromancer status/history table inside [`AdminServerConfigTab`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AdminServerConfigTab.tsx).

---

### FR-6: User-Facing Documentation (`cybercantina-wiki`)
**Requirement:** Update the living user and administrator documentation in `/home/diegolima/Git/cybercantina-wiki/` to cover Admin Communication Messages.

- **[Authentication, Multi-User & Security](file:///home/diegolima/Git/cybercantina-wiki/Authentication-Multi-User-and-Security.md):**
  - Document **Admin Settings → Communication** under Section 3 (*Admin User Management & Policies*): multi-user requirement (disabled in Single-User Local Mode), message placement (`Login`, `Home`, `Both`), urgency tiers (`Info`, `Warning`, `Critical`) and drag-reordering, optional `From`/`Until` scheduling, dismissable vs. pinned behavior, revision-based re-notification on edits, the **Archived** sub-tab (soft-deleted & expired recovery), and Chloromancer's automatic 7-day purge.
- **[First Campaign & Interface Tour](file:///home/diegolima/Git/cybercantina-wiki/First-Campaign-and-Interface-Tour.md):**
  - Document **Admin Announcements** in Section 1 (*The Home Deck*): how server notices appear on Login and Home, how to collapse/expand banners, and how dismissal resets if an administrator updates a notice.

---

## 4. Non-Functional Requirements & Security Considerations

1. **Authorization Boundaries:**
   - All admin message CRUD, reorder, and archived endpoints (`/api/admin/messages*`) must enforce `require_admin` and reject/block modifications or validate cleanly when `singleUserMode` is active if needed.
   - Public login message delivery must never leak `deleted_at`, `created_at`, internal user IDs, or inactive/scheduled messages.
2. **XSS & Injection Prevention:**
   - Never render message titles or bodies using `dangerouslySetInnerHTML`.
   - Validate all API inputs with Pydantic v2 schemas and use parameterized SQLite queries exclusively.
3. **Log Hygiene:**
   - Sanitize any dynamic message IDs or titles logged server-side using [`sanitize_log_value`](file:///home/diegolima/Git/cybercantina/backend/app/security/log_sanitize.py).
4. **Non-Blocking Housekeeping:**
   - Run the Chloromancer `purge_admin_messages` DB cleanup inside `asyncio.to_thread(...)` guarded by the scheduler's per-job `asyncio.Lock` so active SSE streams and WebSocket relays are unaffected.

---

## 5. Resolved Design Decisions

1. **Stable `id` + Separate `revision`:**
   - **Decision:** Keep `id` (UUID) immutable across the lifetime of a message and store a separate `revision` integer that increments on edits and archive restores (while drag-reordering updates `sort_order` without bumping `revision`). This preserves user collapse state and clean ordering while reliably resetting dismissals on edits.
2. **Soft Delete + `"Archived"` Admin Sub-Tab:**
   - **Decision:** Manual deletions set `deleted_at` instead of immediately hard-deleting. Admins have an `"Archived"` tab showing both deleted and expired messages during the 7-day retention window; editing an archived message restores it to `"Active"` with a new `revision` (requiring a cleared or future `expires_at` if previously expired).
3. **Combined Placement (`"login" | "home" | "both"`):**
   - **Decision:** Model placement as a field on a single message entity rather than separate Login/Home lists so maintenance notices affecting both surfaces are authored, ordered, and maintained in one place.
4. **Hide `"X"` When Collapsed:**
   - **Decision:** Collapsed messages render strictly `[Urgency Icon] [Title] [Chevron]` to preserve minimal, responsive single-line estate; the `"X"` dismiss button is shown only when expanded (for dismissable messages).
5. **Future-or-Blank `Until` & Auto-Clear on Expired Restore:**
   - **Decision:** New or edited messages must set `Until` (`expires_at`) to blank or `>= now`; when opening an expired archived message to edit/restore it, the UI automatically clears `expires_at` so the admin can restore immediately or set a new future deadline.

---

## 6. Acceptance Criteria

- [ ] **Admin Communication Tab:** `AdminModal` includes a `"Communication"` tab that is greyed out/disabled in `singleUserMode`, with `"Active"` and `"Archived"` sub-tabs when enabled.
- [ ] **CRUD, Versioning & Restore:** Creating/editing messages persists `id` (stable UUID), `revision` (increments on edit/restore, unchanged on reorder), `placement`, `title`, `message`, `urgency`, `starts_at`, `expires_at`, `dismissable`, and `sort_order`. Soft-deleted and expired messages appear in `"Archived"`, and editing one restores it to `"Active"` with `revision + 1`.
- [ ] **Urgency Grouping & Drag Reorder:** Active messages in Admin are grouped `critical` → `warning` → `info` and drag-sortable within each urgency group; Login and Home reflect that exact ordering.
- [ ] **Effective Date Filtering:** Server time gates display accurately for open-ended, `from`-only, `until`-only, and bounded ranges; `until` on create/edit is validated `>= now` (or blank), expired messages auto-clear `until` when opened from `"Archived"`, and expired messages disappear from Login/Home automatically.
- [ ] **Login & Home UX:** Unauthenticated Login messages render above the login card in `AuthScreen` (only when setup is complete and multi-user mode is active); Home messages render above the deck in `HomeScreen` with `--accent-cyan` (`info`), `--accent-amber` (`warning`), and `--accent-rose` (`critical`).
- [ ] **Collapse & Dismiss Persistence:** All messages collapse to a responsive single-line `[icon + title + chevron]` bar (with `"X"` hidden until expanded) and expand on click; header chevron collapses expanded messages; dismissable messages hide on `"X"` click via `localStorage` and reappear only when `revision` increments (or `dismissable` is unchecked); collapsed state persists across reloads and edits.
- [ ] **Chloromancer Cleanup:** `purge_admin_messages` runs in `ChloromancerScheduler` (always enabled) and permanently deletes rows soft-deleted or expired `> 7 days` ago, recording runs in `chloromancer_runs`.
- [ ] **User-Facing Documentation:** `cybercantina-wiki/Authentication-Multi-User-and-Security.md` and `cybercantina-wiki/First-Campaign-and-Interface-Tour.md` document Admin Communication management, user collapse/dismiss behavior, Archive restoration, and Chloromancer cleanup.
- [ ] **Checks Pass:** `ruff check`, `tach check`, `pytest`, `npm --prefix frontend run arch:check`, `npm --prefix frontend run build`, `npm --prefix frontend test`, and `scripts/generate_arch_docs.py --check` all pass once implemented.
