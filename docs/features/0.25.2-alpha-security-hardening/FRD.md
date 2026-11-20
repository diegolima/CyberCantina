---
feature: alpha-security-hardening
target_version: 0.25.2
document_type: frd
status: completed
last_updated: 2026-11-20
---

# Feature Requirements Document (FRD)
## Public Alpha Security Hardening: Multi-Tenant IDOR Closure, Session Cookie Transport, Auth Abuse Protection & Bounded Upload Staging

**Status:** Completed  
**Target Version:** CyberCantina v0.25.2  
**Origin:** Verified audit of code security concerns raised in the Public Alpha Readiness Assessment ([22b8cdcb-de8e-4428-bb29-99e74cccdd38](conversation://22b8cdcb-de8e-4428-bb29-99e74cccdd38)) against `HEAD` (`7d7f797`), expanded with sibling multi-tenant IDOR and resource-exhaustion findings uncovered post-v0.24.0.

**Scope:**
- **Backend Tenancy & Access Control:**
  - [`import_export.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/import_export.py), [`import_export_service.py`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py), [`enrich.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/enrich.py)
  - [`turn_streaming.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/campaign_routes/turn_streaming.py), [`crud_and_state.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/campaign_routes/crud_and_state.py), [`settings.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/settings.py), [`media.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/media.py)
  - [`base.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/base.py), [`characters.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/characters.py), [`character_versions.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/character_versions.py), [`personas.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/personas.py), [`turns.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/turns.py), [`media_assets.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/media_assets.py)
- **Session Cookie & Proxy Transport Hardening:**
  - [`dependencies.py`](file:///home/diegolima/Git/cybercantina/backend/app/dependencies.py), [`auth.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/auth.py), [`main.py`](file:///home/diegolima/Git/cybercantina/backend/app/main.py), [`nginx.conf`](file:///home/diegolima/Git/cybercantina/frontend/nginx.conf), [`docker-compose.yml`](file:///home/diegolima/Git/cybercantina/docker-compose.yml)
- **Auth Rate Limiting, Input Bounds & Session Write Throttling:**
  - New: `backend/app/security/rate_limit.py` (plus transport/cookie helpers in `backend/app/security/`)
  - [`schemas/auth.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/auth.py), [`routers/auth.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/auth.py), [`auth_users.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/auth_users.py), [`import_export.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/import_export.py)
- **Upload Streaming & Staged Import Resource Caps:**
  - [`import_export_service.py`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py), [`import_export.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/import_export.py), [`dependencies.py`](file:///home/diegolima/Git/cybercantina/backend/app/dependencies.py)
  - [`routers/characters.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/characters.py), [`routers/worlds.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/worlds.py), [`routers/personas.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/personas.py), [`purge_inactive.py`](file:///home/diegolima/Git/cybercantina/backend/app/housekeeping/purge_inactive.py)
- **API Docs Gating, HTTP Security Headers & Outbound Metadata Hygiene:**
  - [`main.py`](file:///home/diegolima/Git/cybercantina/backend/app/main.py), [`nginx.conf`](file:///home/diegolima/Git/cybercantina/frontend/nginx.conf), [`llm_client.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/llm_client.py)
- **Frontend Auth Form Alignment:**
  - [`AuthScreen.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AuthScreen.tsx), [`InitialSetupScreen.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/InitialSetupScreen.tsx), [`ProfileAccountTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/ProfileAccountTab.tsx), [`AdminUsersTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AdminUsersTab.tsx)
- **Automated Tests:**
  - Extensions to [`test_security_audit_access_control.py`](file:///home/diegolima/Git/cybercantina/backend/tests/test_security_audit_access_control.py), [`test_auth_and_tenancy.py`](file:///home/diegolima/Git/cybercantina/backend/tests/test_auth_and_tenancy.py), [`test_import_export.py`](file:///home/diegolima/Git/cybercantina/backend/tests/test_import_export.py), [`test_enrich.py`](file:///home/diegolima/Git/cybercantina/backend/tests/test_enrich.py), and [`conftest.py`](file:///home/diegolima/Git/cybercantina/backend/tests/conftest.py)
  - New: `backend/tests/test_rate_limiting_and_hardening.py` + frontend auth form validation unit assertions
- **User-Facing Documentation (verify/update upon implementation):**
  - [`Authentication-Multi-User-and-Security.md`](file:///home/diegolima/Git/cybercantina-wiki/Authentication-Multi-User-and-Security.md) and [`Installation-and-Setup.md`](file:///home/diegolima/Git/cybercantina-wiki/Installation-and-Setup.md) (document new security env vars, password/username bounds, rate-limiting defaults, and API docs opt-in)

---

## 1. Assessment Triage & Verification Summary

Every item raised in the Public Alpha Readiness Assessment was independently verified against `HEAD` (`7d7f797`), including post-v0.24.0 changes (`media_assets` unified store and disk-staged `.zcc` inspection).

| # | Assessment Concern | Verdict on `HEAD` (`7d7f797`) | Verified Code Evidence & Expanded Findings |
|---|---|---|---|
| 1 | **Cross-user IDOR on Character Export & Enrich** | **Valid (Critical) — Confirmed & Expanded** | All 4 original gaps remain open: `GET /api/export/character/{character_id}` ([`import_export.py#L84`](file:///home/diegolima/Git/cybercantina/backend/app/routers/import_export.py#L84)), `build_zcc_export_to_file` ([`import_export_service.py#L532`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py#L532)), `GET /api/export/world/{world_id}` ([`import_export.py#L126`](file:///home/diegolima/Git/cybercantina/backend/app/routers/import_export.py#L126)), and `POST /api/enrich` `character_field` scope ([`enrich.py#L260`](file:///home/diegolima/Git/cybercantina/backend/app/routers/enrich.py#L260)). **Four sibling IDORs were also found:**<br>1. **Import conflict oracle ([`import_export_service.py#L841-L843`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py#L841-L843)):** `_inspect_zcc_archive` calls `repo.list_characters(include_pending_deletion=False)` without `owner_id=user_id`; because `CharacterRecord` ([`schemas/character.py#L1126-L1137`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/character.py#L1126-L1137)) has no `owner_id` field, `getattr(c, "owner_id", None)` is always `None`, turning `.zcc` inspection into a cross-tenant character-name-to-`char_*`-ID oracle.<br>2. **World location enrich without `world_id` ([`enrich.py#L161-L167`](file:///home/diegolima/Git/cybercantina/backend/app/routers/enrich.py#L161-L167)):** When `ref.world_id` is omitted, `repo.get_location(ref.location_id)` loads any tenant's location.<br>3. **Cross-campaign turn-chain / persona-state lookups:** `repo.get_branch_turn_chain(leaf_turn_id)` ([`turns.py#L728`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/turns.py#L728)) and `repo.get_campaign_persona_turn_state(turn_id)` ([`personas.py#L757`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/personas.py#L757)) do not verify `campaign_id`, exposing foreign campaign turns via `parent_turn_id` / `turn_id` in [`enrich.py#L86-L92`](file:///home/diegolima/Git/cybercantina/backend/app/routers/enrich.py#L86-L92), [`turn_streaming.py#L136-L143`](file:///home/diegolima/Git/cybercantina/backend/app/routers/campaign_routes/turn_streaming.py#L136-L143), and [`crud_and_state.py#L174-L178`](file:///home/diegolima/Git/cybercantina/backend/app/routers/campaign_routes/crud_and_state.py#L174-L178).<br>4. **Private media URL smuggling & linked-video overwrite:** `_sanitize_character_media` ([`base.py#L186-L223`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/base.py#L186-L223)) and `_sanitize_persona_media` ([`base.py#L231-L247`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/base.py#L231-L247)) accept arbitrary `/api/media/...` URLs without checking ownership. Once saved on an attacker's entity, `user_can_access_asset` ([`media_assets.py#L406-L451`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/media_assets.py#L406-L451)) and `user_can_access_persona_media` ([`personas.py#L534-L540`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/personas.py#L534-L540)) grant read access, `_resolve_local_media_disk_path` ([`import_export_service.py#L222-L276`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py#L222-L276)) exports the victim's file into the attacker's `.zcc`, and `attach_or_replace_linked_video` ([`media_assets.py#L253-L308`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/media_assets.py#L253-L308)) lets an attacker overwrite/delete a victim's linked video on a smuggled `image_id`.<br>*(Minor sibling info leak)*: `GET /api/profile/models` ([`settings.py#L301`](file:///home/diegolima/Git/cybercantina/backend/app/routers/settings.py#L301)) returns unredacted `settings.embedding_profile.base_url` to non-admins. |
| 2 | **Missing `Secure` flag on `cantina_session` cookie** | **Valid (High) — Confirmed (with proxy nuance)** | [`dependencies.py#L319-L326`](file:///home/diegolima/Git/cybercantina/backend/app/dependencies.py#L319-L326) sets `httponly=True, samesite="lax"` without `secure=...`, and [`auth.py#L214`](file:///home/diegolima/Git/cybercantina/backend/app/routers/auth.py#L214), [`#L539`](file:///home/diegolima/Git/cybercantina/backend/app/routers/auth.py#L539), [`#L657`](file:///home/diegolima/Git/cybercantina/backend/app/routers/auth.py#L657) omit matching `secure`/`httponly`/`samesite` flags on `delete_cookie`. Additionally, [`frontend/nginx.conf#L41`](file:///home/diegolima/Git/cybercantina/frontend/nginx.conf#L41) and [`#L57`](file:///home/diegolima/Git/cybercantina/frontend/nginx.conf#L57) unconditionally overwrite `X-Forwarded-Proto` with `$scheme`, erasing upstream `https` behind external TLS proxies. |
| 3 | **No rate limiting on Auth & Import Inspect** | **Valid (High) — Confirmed** | Only `ProbeService` has a `TokenBucket` ([`probe.py#L46-L61`](file:///home/diegolima/Git/cybercantina/backend/app/providers/probe.py#L46-L61)). `/api/auth/login`, `/api/auth/register`, `/api/auth/setup`, `/api/auth/passkey/*`, `/api/profile/*` password/passkey/destructive mutations, and `/api/import/inspect` lack rate limits. Must resolve client IP safely behind trusted proxies/Cloudflare without honoring spoofed forwarding headers from untrusted peers. |
| 4 | **Missing username & password bounds** | **Valid (High) — Confirmed (with legacy compatibility)** | [`schemas/auth.py#L54-L152`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/auth.py#L54-L152) and [`auth_users.py#L63-L103`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/auth_users.py#L63-L103), [`#L191-L232`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/auth_users.py#L191-L232) enforce no `min_length`/`max_length` or character hygiene—allowing 1-char passwords, control chars (`\r`/`\n` logged raw in [`auth.py#L128`](file:///home/diegolima/Git/cybercantina/backend/app/routers/auth.py#L128), [`#L202`](file:///home/diegolima/Git/cybercantina/backend/app/routers/auth.py#L202)), and oversized strings into Argon2id. Also [`auth.py#L279`](file:///home/diegolima/Git/cybercantina/backend/app/routers/auth.py#L279), [`#L419`](file:///home/diegolima/Git/cybercantina/backend/app/routers/auth.py#L419) expose raw `str(exc)` in passkey verification errors. Must preserve blank admin password for single-user mode and enforce only `max_length` on login/verification fields so existing accounts are not locked out. |
| 5 | **Unbounded `_staged_imports` RAM/disk exhaustion** | **Valid (High) — Evolved since v0.24.0, Still Critical** | v0.24.0 (`b6a9cc0`) moved `.zcc` upload staging to disk `.staging/import_*.part` (reducing normal `.zcc` RAM), but raised `MAX_TOTAL_UNCOMPRESSED_BYTES` to `1 GB` ([`import_export_service.py#L81`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py#L81)) and left three active DoS vectors:<br>1. `inspect_uploaded_path` ([`import_export_service.py#L1039-L1044`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py#L1039-L1044)) calls `staged_path.read_bytes()` on any non-ZIP upload up to `1 GB` straight into RAM, and SillyTavern cards sit in `_staged_imports` RAM (`data_bytes`) for 30 minutes.<br>2. `_staged_imports` ([`#L98`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py#L98)) has no per-user or global entry/disk/RAM cap and bypasses `user_media_quota_mb`.<br>3. Six image/card upload routes use unbounded `await file.read()` ([`characters.py#L202`](file:///home/diegolima/Git/cybercantina/backend/app/routers/characters.py#L202), [`#L558`](file:///home/diegolima/Git/cybercantina/backend/app/routers/characters.py#L558), [`#L683`](file:///home/diegolima/Git/cybercantina/backend/app/routers/characters.py#L683); [`worlds.py#L264`](file:///home/diegolima/Git/cybercantina/backend/app/routers/worlds.py#L264); [`personas.py#L183`](file:///home/diegolima/Git/cybercantina/backend/app/routers/personas.py#L183), [`#L286`](file:///home/diegolima/Git/cybercantina/backend/app/routers/personas.py#L286)). |
| 6 | **Public `/docs` & `/openapi.json` + missing HTTP security headers** | **Valid (Medium) — Confirmed (with HSTS caveat)** | [`main.py#L139-L143`](file:///home/diegolima/Git/cybercantina/backend/app/main.py#L139-L143) enables `/docs`, `/redoc`, and `/openapi.json` unconditionally (proxied by [`nginx.conf#L74-L84`](file:///home/diegolima/Git/cybercantina/frontend/nginx.conf#L74-L84)). [`frontend/nginx.conf`](file:///home/diegolima/Git/cybercantina/frontend/nginx.conf) emits no `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, or `Permissions-Policy: loopback-network=(self)` (FastAPI middleware at [`main.py#L176-L177`](file:///home/diegolima/Git/cybercantina/backend/app/main.py#L176-L177) attaches `Permissions-Policy` only on `/api/` responses, not Nginx static HTML). **Caveat:** HSTS must NOT be emitted unconditionally on plain-HTTP self-hoster setups. |
| 7 | **Per-request SQLite write in `get_and_touch_session`** | **Valid (Medium) — Confirmed** | [`auth_users.py#L880-L904`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/auth_users.py#L880-L904) throttles `users.last_active_at` to 1800s, yet executes `UPDATE user_sessions SET last_active_at = ?` + `conn.commit()` on every authenticated API request (~10+ write transactions per page load), risking SQLite write-lock contention under concurrent alpha traffic. |
| 8 | **Hardcoded `"HTTP-Referer": "http://localhost:5173"`** | **Valid (Low / Hygiene) — Confirmed** | [`llm_client.py#L179`](file:///home/diegolima/Git/cybercantina/backend/app/engine/llm_client.py#L179), [`#L189`](file:///home/diegolima/Git/cybercantina/backend/app/engine/llm_client.py#L189) send `http://localhost:5173` to OpenRouter/NanoGPT/AI Horde regardless of deployment URL. Configurable `CYBERCANTINA_PUBLIC_URL` avoids leaking localhost metadata. |
| — | **Out-of-Scope / Non-Security Findings** | **Excluded from Security FRD** | Tracked outside this FRD because they are ops/reliability/docs/performance issues rather than application security vulnerabilities:<br>• [`frontend/Dockerfile#L20-L21`](file:///home/diegolima/Git/cybercantina/frontend/Dockerfile#L20-L21) / [`nginx.conf#L7`](file:///home/diegolima/Git/cybercantina/frontend/nginx.conf#L7) IPv4/IPv6 Docker `HEALTHCHECK` mismatch (`(unhealthy)` container).<br>• [`README.md#L66`](file:///home/diegolima/Git/cybercantina/README.md#L66) stale campaign name (*Midnight at the Neon Rust*).<br>• Frontend initial JS chunk size (`~6.1 MB` bundle).<br>• Live `cybercantina-alpha` VM infra ops (swap/RAM sizing, Cloudflare Origin CA / Full Strict TLS, GCE IP rules, SQLite `.backup` cron). |

---

## 2. Core Security Invariants & Design Boundaries

1. **Strict Multi-Tenant Isolation (Default-Deny, 404 Non-Disclosure):**
   - Every non-public entity lookup (`character`, `world`, `persona`, `campaign`, `location`, `turn`, `media_asset`) on user-authenticated endpoints must be scoped to `current_user.id` (or an authorized campaign/world owned by `current_user.id`), returning HTTP `404` on foreign IDs and omitting foreign records from import conflict inspection lists.
2. **Self-Hoster & Local Development Ergonomics Preserved:**
   - Plain HTTP `http://localhost:3000`, `http://127.0.0.1:5173`, LAN deployments, and single-user passwordless admin mode MUST continue working out of the box with zero mandatory TLS certificates, external Redis instances, or reverse-proxy prerequisites.
3. **Architecture & Tach Boundary Compliance:**
   - New security primitives (rate limiter, trusted-proxy client IP extraction, HTTPS/cookie security detection) MUST live in leaf package `backend/app/security/` (`depends_on = []` in [`backend/tach.toml`](file:///home/diegolima/Git/cybercantina/backend/tach.toml)) with zero upward imports from `app.db`, `app.routers`, or `app.services`.
4. **CodeQL & Log Hygiene Compliance:**
   - All client-influenced log fields must pass through [`sanitize_log_value`](file:///home/diegolima/Git/cybercantina/backend/app/security/log_sanitize.py); zero raw `str(exc)` in HTTP error payloads; no polynomial ReDoS patterns.
5. **Backward Compatibility for Existing Accounts & Test Suite:**
   - Login and current-password confirmation flows enforce `max_length` only (never `min_length`), preventing lockouts of pre-existing accounts. Rate limiters provide a deterministic test-reset hook for [`conftest.py`](file:///home/diegolima/Git/cybercantina/backend/tests/conftest.py).

---

## 3. Functional & Security Requirements

### FR-1: Close Export, Import-Conflict, Enrich & Campaign-Turn Cross-Tenant IDORs

1. **FR-1.1 Export & Import-Inspect Character/World Tenancy:**
   - [`export_single_character`](file:///home/diegolima/Git/cybercantina/backend/app/routers/import_export.py#L74-L106) (`GET /api/export/character/{character_id}`): pass `owner_id=current_user.id` to `repo.get_character(character_id, owner_id=current_user.id)`.
   - [`export_single_world`](file:///home/diegolima/Git/cybercantina/backend/app/routers/import_export.py#L109-L146) (`GET /api/export/world/{world_id}`): pass `owner_id=current_user.id` to `repo.list_characters(include_pending_deletion=False, owner_id=current_user.id)`.
   - [`build_zcc_export_to_file`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py#L495-L535) (`POST /api/export/bundle`): pass `owner_id=owner_id` to `repo.get_character(cid, owner_id=owner_id)`.
   - [`_inspect_zcc_archive`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py#L840-L856) (`POST /api/import/inspect`): replace unfiltered `repo.list_characters(include_pending_deletion=False)` and the broken `getattr(c, "owner_id", None)` check with `repo.list_characters(include_pending_deletion=False, owner_id=user_id)` so conflict detection only checks characters owned by `user_id`.
2. **FR-1.2 Enrich Tenancy (`backend/app/routers/enrich.py`):**
   - `scope="character_field"` ([`enrich.py#L258-L262`](file:///home/diegolima/Git/cybercantina/backend/app/routers/enrich.py#L258-L262)): call `repo.get_character(req.context_ref.character_id, owner_id=current_user.id)` (returning HTTP `404` on `KeyError`).
   - `scope="world_location"` ([`enrich.py#L160-L168`](file:///home/diegolima/Git/cybercantina/backend/app/routers/enrich.py#L160-L168)): when `ref.location_id` is supplied without `ref.world_id` (`db_world is None`), verify ownership by calling `repo.get_world(candidate.world_id, owner_id=current_user.id)` (ignoring `candidate` on `KeyError`, never hydrating another tenant's location into prompt context). When `db_world` is present, retain `candidate.world_id == db_world.id`.
3. **FR-1.3 Campaign Turn-Chain & Persona-State Containment:**
   - Extend [`get_branch_turn_chain`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/turns.py#L728-L779) to accept optional `campaign_id: str | None = None`; when provided, constrain the recursive CTE anchor in SQL with `WHERE id = ? AND campaign_id = ?`.
   - Pass `campaign_id=campaign.id` in both [`enrich.py#L90`](file:///home/diegolima/Git/cybercantina/backend/app/routers/enrich.py#L90) (returning HTTP `404` if `branch_turns` is empty) and [`turn_streaming.py#L141`](file:///home/diegolima/Git/cybercantina/backend/app/routers/campaign_routes/turn_streaming.py#L141) (raising `KeyError` / HTTP `404` if `branch_turns` is empty).
   - Extend [`get_campaign_persona_turn_state`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/personas.py#L757-L775) to accept optional `campaign_id: str | None = None`; when provided, verify the `turn_id` belongs to `campaign_id` via `JOIN turn_nodes tn ON tn.id = pts.turn_id WHERE pts.turn_id = ? AND tn.campaign_id = ?` (and check turn membership when `turn_id` is explicitly supplied in [`crud_and_state.py#L174-L178`](file:///home/diegolima/Git/cybercantina/backend/app/routers/campaign_routes/crud_and_state.py#L174-L178), returning HTTP `404` for a `turn_id` from another campaign).
4. **FR-1.4 Profile Models Non-Admin Redaction (`backend/app/routers/settings.py`):**
   - In [`get_profile_models`](file:///home/diegolima/Git/cybercantina/backend/app/routers/settings.py#L224-L302) (`L301`), redact `default_embedding_profile.base_url` to `""` when `current_user.role != "admin"`, matching [`_redacted_for_user`](file:///home/diegolima/Git/cybercantina/backend/app/routers/settings.py#L53-L60) on `GET /api/settings`.

---

### FR-2: Close Private Media URL Smuggling, Export Media Isolation & Linked-Video Overwrite

1. **FR-2.1 Write-Time Local Media URL Authorization:**
   - Add a repository validation helper invoked whenever `owner_id is not None` in [`create_character_from_draft`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/characters.py#L35-L70), [`update_character`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/character_versions.py#L277-L287), and [`create_persona`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/personas.py#L90-L157) before persisting `portraits`, `portrait_url`, or `gallery`:
     - External `http://` and `https://` URLs remain permitted.
     - Shared `/api/media/public/...` showcase URLs remain permitted.
     - Unified `/api/media/assets/{aid}` URLs are permitted **only** if `media_assets` contains `aid` AND (`is_public == 1` OR `row["owner_id"] == owner_id`). Do **not** rely on circular entity string-column lookups when validating writes.
     - Legacy `/api/media/characters/{cid}/...` URLs are permitted **only** if `cid == target_char_id` or `repo.user_can_access_character(owner_id, cid)`.
     - Legacy `/api/media/personas/{pid}/...` URLs are permitted **only** if `repo.user_can_access_persona_media(owner_id, pid, category, filename)`.
     - `/api/media/worlds/{cat}/{fname}` URLs are permitted **only** if `repo.user_can_access_world_media(owner_id, cat, fname)`.
     - Any other `/api/media/...` reference raises `ValueError("Unauthorized media asset reference.")` (mapped to HTTP `400` at routers).
2. **FR-2.2 Export-Time Media Authorization (`import_export_service.py`):**
   - Update [`_resolve_local_media_disk_path`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py#L222-L276) to require `owner_id: str` and authorize the resolved resource before returning a `Path`:
     - Unified `/api/media/assets/{aid}`: require `repo.user_can_access_asset(owner_id, aid)` (and ensure linked videos inherit the same authorization).
     - Legacy character/persona/world paths: require `repo.user_can_access_character`, `repo.user_can_access_persona_media`, or `repo.user_can_access_world_media` for `owner_id`.
     - Reject/omit unauthorized local disk files so `.zcc` exports can never pack another user's private files even for pre-existing database rows.
3. **FR-2.3 Linked-Video Attach/Replace Ownership Guard:**
   - Update [`stage_and_commit_linked_video`](file:///home/diegolima/Git/cybercantina/backend/app/routers/media.py#L123-L254) and [`attach_or_replace_linked_video`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/media_assets.py#L253-L308) to verify before staging/swapping that when `parent_image_id` is provided:
     - The parent image exists in `media_assets`, has `is_public == 0`, matches `entity_scope`, and has `owner_id == target_owner_id`.
     - Any existing linked video row being replaced also has `owner_id == target_owner_id` (or `owner_id is None`).
     - Raise `KeyError` / `PermissionError` (mapped to HTTP `404` / `403` before file replacement or DB deletion occurs).
4. **FR-2.4 Exact Asset-ID Matching in `user_can_access_asset` (`media_assets.py`):**
   - Replace raw JSON substring matching (`url_needle in (cr["portraits_json"] or "")`) in [`user_can_access_asset`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/media_assets.py#L406-L451) with exact asset-ID extraction via [`_collect_asset_ids_from_char_row`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/media_assets.py#L49-L68) and [`_collect_asset_ids_from_persona_row`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/media_assets.py#L71-L85), eliminating prefix-collision false positives (e.g., `img_abc` matching `img_abcdef`).

---

### FR-3: Transport-Aware `Secure` Flag on `cantina_session` Cookie

1. **HTTPS Detection & Policy Resolution (`backend/app/security/`):**
   - Implement `is_request_https(request: Request) -> bool` and `should_set_secure_cookie(request: Request) -> bool`:
     - Controlled by `CYBERCANTINA_COOKIE_SECURE` (`"auto"` default, `"true"`, `"false"`).
     - `"true"` -> always `True`; `"false"` -> always `False`.
     - `"auto"` -> `True` when `request.url.scheme == "https"`, OR first comma-delimited entry of `X-Forwarded-Proto` (from a trusted proxy per FR-4) equals `"https"`, OR `CF-Visitor` JSON parses cleanly with `"scheme": "https"` (when trusted). Otherwise `False` so `http://localhost:3000` and LAN HTTP continue working.
2. **Cookie Issuance & Deletion Parity:**
   - In [`issue_session_response`](file:///home/diegolima/Git/cybercantina/backend/app/dependencies.py#L301-L331), pass `secure=should_set_secure_cookie(request)` to `response.set_cookie(...)`.
   - In [`logout_user`](file:///home/diegolima/Git/cybercantina/backend/app/routers/auth.py#L206-L215), [`delete_my_account`](file:///home/diegolima/Git/cybercantina/backend/app/routers/auth.py#L518-L541), and [`admin_delete_user`](file:///home/diegolima/Git/cybercantina/backend/app/routers/auth.py#L636-L658), pass matching `httponly=True, samesite="lax", secure=should_set_secure_cookie(request), path="/"` to `response.delete_cookie(...)` so browsers reliably clear `Secure` cookies over HTTPS.
3. **Preserve Upstream `X-Forwarded-Proto` in Nginx ([`frontend/nginx.conf`](file:///home/diegolima/Git/cybercantina/frontend/nginx.conf)):**
   - Replace `proxy_set_header X-Forwarded-Proto $scheme;` (`L41`, `L57`) with a `map $http_x_forwarded_proto $forwarded_proto { default $http_x_forwarded_proto; "" $scheme; }` so upstream TLS termination (e.g., Cloudflare Flexible or an external reverse proxy) is preserved instead of downgraded to `http`.

---

### FR-4: Sliding-Window Rate Limiting & Trusted-Proxy Client IP Resolution

1. **Leaf Security Rate Limiter (`backend/app/security/rate_limit.py`):**
   - Zero dependencies on `app.*` (`tach.toml` `app.security` remains `depends_on = []`).
   - **Trusted-Proxy Client IP Extraction (`resolve_client_ip(request)`):**
     - Inspect forwarding headers (`CF-Connecting-IP` when `CYBERCANTINA_TRUST_CF_HEADERS=true`, rightmost non-trusted entry in `X-Forwarded-For` using `CYBERCANTINA_TRUSTED_PROXY_HOPS` default `1`, or `X-Real-IP`) **only** when the direct peer `request.client.host` is a loopback/private/Docker proxy address (`127.0.0.0/8`, `::1`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7`).
     - If the peer is not a trusted proxy, ignore client-supplied forwarding headers completely to prevent trivial `X-Forwarded-For` spoofing bypasses.
   - **Bounded-Memory `SlidingWindowRateLimiter`:**
     - Thread-safe (`threading.Lock`) sliding window storing monotonic timestamps per bucket key.
     - Enforce `MAX_TRACKED_KEYS = 10_000` with expired-bucket pruning (and oldest-key eviction if full) so distributed IP spam cannot leak memory.
     - On limit exceeded, return HTTP `429 Too Many Requests` with `Retry-After` header and clear user-facing `detail`.
2. **Endpoint Limits & Configuration:**
   - Controlled by `CYBERCANTINA_RATE_LIMIT_ENABLED` (default `"true"`). Provide `reset_rate_limiters()` for deterministic test isolation in [`conftest.py`](file:///home/diegolima/Git/cybercantina/backend/tests/conftest.py).
   - Default limits:
     - `POST /api/auth/login`: `15 requests / 5 minutes` per IP **and** `10 failed attempts / 5 minutes` per normalized username (successful login clears the username failure bucket).
     - `POST /api/auth/register`: `5 requests / 60 minutes` per IP.
     - `POST /api/auth/setup`: `10 requests / 15 minutes` per IP.
     - `POST /api/auth/passkey/login/start` & `POST /api/auth/passkey/login/finish`: `20 requests / 5 minutes` per IP.
     - Authenticated sensitive account mutations (`POST /api/profile/password`, `POST /api/profile/passkeys/register/start`, `POST /api/profile/reset-data`, `DELETE /api/profile`, `POST /api/profile/delete`): `10 requests / 15 minutes` per `current_user.id`.
     - `POST /api/import/inspect`: `15 requests / 5 minutes` per `current_user.id`.

---

### FR-5: Username, Display Name & Password Bounds + Auth Log/Error Hygiene

1. **Password Length & Character Bounds:**
   - **Password creation/change** (`RegisterRequest`, `AdminCreateUserRequest`, non-blank `InitialSetupRequest`, non-blank `ChangePasswordRequest`): require `8 <= len(password) <= 128` and reject `\x00` bytes.
   - **Single-user passwordless exception:** blank password (`""`) remains strictly allowed ONLY on `InitialSetupRequest` (`confirm_blank_password=True`) and `ChangePasswordRequest` (`confirm_blank_password=True`, sole admin user).
   - **Login / verification fields** (`LoginRequest.password`, `current_password` on `ChangePasswordRequest`, `PasskeyRegisterStartRequest`, `PasskeyDeleteRequest`, `ProfileResetDataRequest`, `ProfileDeleteAccountRequest`): enforce `max_length=128` **only** (no `min_length`), capping Argon2id DoS without breaking legacy accounts.
2. **Username Bounds & Format (`schemas/auth.py` + `auth_users.py`):**
   - Strip leading/trailing whitespace on `InitialSetupRequest`, `RegisterRequest`, `AdminCreateUserRequest`, `AdminChangeUsernameRequest`, and inside `create_user` / `update_user_username`.
   - Enforce `2 <= len(username) <= 32` matching `^[A-Za-z0-9][A-Za-z0-9._-]{1,31}$` (verified compatible with all 101 unique usernames across `backend/tests/`, including `u1` and `adm`; blocks control chars, whitespace spoofing, and log injection).
3. **Display Name Bounds:**
   - Strip outer whitespace; enforce `1 <= len(display_name) <= 64`; reject ASCII control characters (`\x00-\x1f`, `\x7f`) in schemas and repository methods (`create_user`, `update_user_display_name`).
4. **Auth Log & Error Hygiene (`backend/app/routers/auth.py`):**
   - Wrap `admin_user.username` ([`auth.py#L128`](file:///home/diegolima/Git/cybercantina/backend/app/routers/auth.py#L128)) and `user.username` ([`auth.py#L202`](file:///home/diegolima/Git/cybercantina/backend/app/routers/auth.py#L202)) in `sanitize_log_value(...)`.
   - Replace raw `f"Passkey verification failed: {exc}"` ([`auth.py#L279`](file:///home/diegolima/Git/cybercantina/backend/app/routers/auth.py#L279)) and `f"Passkey registration verification failed: {exc}"` ([`auth.py#L419`](file:///home/diegolima/Git/cybercantina/backend/app/routers/auth.py#L419)) with static user-safe error messages while logging `sanitize_log_value(exc)` server-side.
   - Normalize `POST /api/auth/passkey/login/start` errors when an explicit `username` is missing or lacks passkeys ([`auth.py#L228-L239`](file:///home/diegolima/Git/cybercantina/backend/app/routers/auth.py#L228-L239)) to a uniform HTTP `400` message (`"Unable to start passkey sign-in for the supplied username. Try password sign-in or discoverable passkey login."`) so the endpoint cannot be used as a silent username-enumeration oracle.
5. **Frontend Auth UI Parity:**
   - Add client-side length hints, `minLength`/`maxLength` HTML attributes, and inline validation matching backend rules across [`AuthScreen.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AuthScreen.tsx), [`InitialSetupScreen.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/InitialSetupScreen.tsx), [`ProfileAccountTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/ProfileAccountTab.tsx), and [`AdminUsersTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AdminUsersTab.tsx).

---

### FR-6: Bounded Upload Streaming & Staged Import Resource Caps

1. **Non-ZIP Card OOM Guard (`import_export_service.py`):**
   - Define `MAX_CARD_IMPORT_BYTES = 20 * 1024 * 1024` (20 MB). In [`inspect_uploaded_path`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py#L1039-L1044), verify `staged_path.stat().st_size <= MAX_CARD_IMPORT_BYTES` before calling `staged_path.read_bytes()`, unlinking the staged file and raising HTTP `413` if exceeded.
2. **Compressed Upload Limit & `_staged_imports` Memory/Disk Caps (`import_export.py`, `import_export_service.py`):**
   - Enforce a dedicated compressed upload limit `MAX_IMPORT_UPLOAD_BYTES` (env var `CYBERCANTINA_MAX_IMPORT_UPLOAD_MB`, default `100` MB) in [`inspect_import`](file:///home/diegolima/Git/cybercantina/backend/app/routers/import_export.py#L168) while preserving `MAX_TOTAL_UNCOMPRESSED_BYTES` (`1 GB`) inside `_open_safe_zip` as the decompression bomb guard.
   - Protect `_staged_imports` with a `threading.Lock` and enforce:
     - `MAX_STAGED_IMPORTS_PER_USER = 3` (FIFO-evicting and unlinking that user's oldest staged session on overflow).
     - `MAX_STAGED_IMPORTS_GLOBAL = 20`.
     - `MAX_STAGED_DISK_BYTES_GLOBAL = 256 * 1024 * 1024` (256 MB total staged `.part` files across all users).
     - `MAX_STAGED_RAM_BYTES_GLOBAL = 32 * 1024 * 1024` (32 MB total in-memory `data_bytes` across all users).
     - When global limits would still be exceeded after pruning expired entries, unlink the newly staged file and raise HTTP `503` with a clear retry message.
   - Reap stale `.staging/import_*.part` and `.staging/export_*.zcc` files older than `STAGED_IMPORT_TTL_SECONDS` (`1800s`) at startup ([`main.py`](file:///home/diegolima/Git/cybercantina/backend/app/main.py)) and in [`_sweep_orphan_media_dirs`](file:///home/diegolima/Git/cybercantina/backend/app/housekeeping/purge_inactive.py#L211-L230) (rather than waiting 24 hours).
3. **Bounded Streaming Reads for Image & SillyTavern Upload Routes:**
   - Add `async def read_upload_bytes_bounded(file: UploadFile, max_bytes: int) -> bytes` in [`dependencies.py`](file:///home/diegolima/Git/cybercantina/backend/app/dependencies.py), streaming in 64 KB chunks and raising HTTP `413` immediately once `total > max_bytes`.
   - Replace all 6 unbounded `await file.read()` calls ([`characters.py#L202`](file:///home/diegolima/Git/cybercantina/backend/app/routers/characters.py#L202), [`#L558`](file:///home/diegolima/Git/cybercantina/backend/app/routers/characters.py#L558), [`#L683`](file:///home/diegolima/Git/cybercantina/backend/app/routers/characters.py#L683); [`worlds.py#L264`](file:///home/diegolima/Git/cybercantina/backend/app/routers/worlds.py#L264); [`personas.py#L183`](file:///home/diegolima/Git/cybercantina/backend/app/routers/personas.py#L183), [`#L286`](file:///home/diegolima/Git/cybercantina/backend/app/routers/personas.py#L286)) with `await read_upload_bytes_bounded(file, 20 * 1024 * 1024)`.

---

### FR-7: API Documentation Gating, HTTP Security Headers & Outbound Referer Hygiene

1. **Gate Swagger / ReDoc / OpenAPI (`backend/app/main.py`, `docker-compose.yml`):**
   - Read `CYBERCANTINA_ENABLE_API_DOCS` (default `"false"`).
   - Pass `docs_url="/docs" if enable_docs else None`, `redoc_url="/redoc" if enable_docs else None`, and `openapi_url="/openapi.json" if enable_docs else None` into `FastAPI(...)` ([`main.py#L139-L143`](file:///home/diegolima/Git/cybercantina/backend/app/main.py#L139-L143)). Document opting in via `CYBERCANTINA_ENABLE_API_DOCS=true`.
2. **Baseline HTTP Security Headers (`frontend/nginx.conf`, `backend/app/main.py`):**
   - In [`frontend/nginx.conf`](file:///home/diegolima/Git/cybercantina/frontend/nginx.conf) at `server` block scope (with **no** `add_header` inside `location` blocks so inheritance is preserved):
     - `add_header X-Content-Type-Options "nosniff" always;`
     - `add_header X-Frame-Options "SAMEORIGIN" always;`
     - `add_header Referrer-Policy "strict-origin-when-cross-origin" always;`
     - `add_header Permissions-Policy "loopback-network=(self)" always;`
   - Mirror the same 4 headers via `setdefault` in FastAPI HTTP middleware ([`main.py#L168-L181`](file:///home/diegolima/Git/cybercantina/backend/app/main.py#L168-L181)).
   - **Safe Conditional HSTS:** Never emit `Strict-Transport-Security` over plain HTTP (to avoid breaking `http://localhost` or LAN self-hosters). In FastAPI middleware, emit `Strict-Transport-Security: max-age=31536000; includeSubDomains` **only** when `CYBERCANTINA_ENABLE_HSTS=true` AND `is_request_https(request)` is true (default `"false"`).
3. **Outbound Provider Referer Hygiene (`backend/app/engine/llm_client.py`):**
   - Replace hardcoded `"HTTP-Referer": "http://localhost:5173"` ([`llm_client.py#L179`](file:///home/diegolima/Git/cybercantina/backend/app/engine/llm_client.py#L179), [`#L189`](file:///home/diegolima/Git/cybercantina/backend/app/engine/llm_client.py#L189)) with `os.environ.get("CYBERCANTINA_PUBLIC_URL", "https://cybercantina.io").strip() or "https://cybercantina.io"`.

---

### FR-8: Throttle `user_sessions.last_active_at` SQLite Writes

1. In [`get_and_touch_session`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/auth_users.py#L847-L911):
   - Define `SESSION_TOUCH_THROTTLE_SECONDS = 300` (5 minutes; negligible compared to `SESSION_IDLE_TIMEOUT_SECONDS = 86400`).
   - Execute `UPDATE user_sessions SET last_active_at = ? WHERE id = ?` **only** when `idle_seconds >= SESSION_TOUCH_THROTTLE_SECONDS` (or timestamp parse fails).
   - Call `conn.commit()` **only** when `should_touch_session or should_touch_user` is true, avoiding SQLite write locks on read-only authenticated requests.
   - Preserve the existing 1800s `users.last_active_at` throttle invariant verified by [`test_server_config_and_chloromancer.py#L179-L199`](file:///home/diegolima/Git/cybercantina/backend/tests/test_server_config_and_chloromancer.py#L179-L199).

---

## 4. Edge Cases, Compatibility & Known Implementation Pitfalls

1. **Single-User Passwordless Mode:** Blank passwords MUST remain allowed during initial setup (`InitialSetupRequest`) and password removal (`ChangePasswordRequest`) when `confirm_blank_password=True` and no other users exist.
2. **Legacy User Accounts:** `LoginRequest` and `current_password` confirmation payloads MUST enforce `max_length=128` only (never `min_length=8`) so pre-existing accounts with short passwords can always sign in or rotate their password.
3. **Existing Test Fixture Usernames:** [`test_providers_and_byop.py#L410`](file:///home/diegolima/Git/cybercantina/backend/tests/test_providers_and_byop.py#L410) uses `username="u1"` (length 2) and [`test_showcase_seeding_and_public_media.py#L268`](file:///home/diegolima/Git/cybercantina/backend/tests/test_showcase_seeding_and_public_media.py#L268) uses `username="adm"` (length 3). Setting `min_length=2` (`^[A-Za-z0-9][A-Za-z0-9._-]{1,31}$`) passes all 101 unique usernames in existing backend tests without breaking fixtures.
4. **Rate Limiter Isolation in Pytest:** [`conftest.py`](file:///home/diegolima/Git/cybercantina/backend/tests/conftest.py) MUST reset all rate-limiter buckets in an `autouse` fixture so back-to-back API tests never trip 429 thresholds unintentionally.
5. **Nginx `add_header` Inheritance Trap:** Adding any `add_header` inside a Nginx `location` block suppresses all `server`-level `add_header` directives. Keep all security `add_header` directives exclusively at the `server` block level.
6. **Nginx `X-Forwarded-Proto` Clobbering:** Using `$scheme` directly in `proxy_set_header X-Forwarded-Proto` discards upstream `https` from Cloudflare or reverse proxies terminating TLS ahead of Nginx; use `map $http_x_forwarded_proto $forwarded_proto`.
7. **SillyTavern Wizard Pre-Staged Media:** When validating local media URLs in `create_character_from_draft` (`FR-2.1`), assets newly registered in `media_assets` with `owner_id == current_user.id` and pre-assigned `char_*` IDs recorded in `staged_character_ownership` for `current_user.id` MUST pass validation cleanly.
8. **Built-In Public Showcase Media:** Seeded showcase entities reference shared `is_public = 1` assets and `/api/media/public/...` URLs; `FR-2.1` and `FR-2.2` MUST preserve read/copy/export compatibility for built-in showcase media while blocking mutations onto public assets.
9. **Tach & Dependency-Cruiser Boundaries:** `app.security` MUST remain dependency-free relative to `app.*` (`depends_on = []` in [`backend/tach.toml`](file:///home/diegolima/Git/cybercantina/backend/tach.toml)); keep `rate_limit.py` and cookie helpers free of `app.config` / `app.db` / `app.routers` imports.

---

## 5. Verification Matrix & Acceptance Criteria

### Targeted Security Regression Suite
| Requirement | Automated Verification Case | Expected Result |
|---|---|---|
| FR-1.1 | User B calls `GET /api/export/character/{user_a_char}`, `POST /api/export/bundle` (`character_ids=[user_a_char]`), `GET /api/export/world/{user_b_world}` with User A resident char, and `POST /api/import/inspect` with `.zcc` matching User A's character name | `404` on single-char export; foreign char omitted from bundle & world export; zero foreign `conflicts` leaked in inspect |
| FR-1.2 | User B calls `POST /api/enrich` with `scope="character_field"` targeting User A's `character_id`, and `scope="world_location"` targeting User A's `location_id` without `world_id` | `404` on `character_field`; User A's location fields omitted from enrichment prompt context |
| FR-1.3 | User B calls `POST /api/enrich` (`campaign_turn`), turn stream, or `GET /api/campaigns/{camp_b}/persona-state?turn_id={camp_a_turn}` supplying a `turn_id` from User A's campaign | HTTP `404`; zero foreign turn history or persona state returned |
| FR-1.4 | Non-admin calls `GET /api/profile/models`; admin calls `GET /api/profile/models` | `default_embedding_profile.base_url == ""` for non-admin; preserved for admin |
| FR-2.1..2.4 | User B submits `portraits`/`gallery`/`portrait_url` containing User A's `/api/media/assets/{id}` or `/api/media/characters/...` on create/update; exports pre-seeded smuggled URL; or posts `linked_image_id={user_a_img}` to `/gallery/videos` | Write rejected (`400`); foreign asset omitted on `.zcc` export; linked-video attach/replace rejected (`403`/`404`) without altering User A's video; prefix-colliding IDs denied |
| FR-3 | Login/logout over plain HTTP vs `X-Forwarded-Proto: https` vs `CF-Visitor: {"scheme":"https"}` vs `CYBERCANTINA_COOKIE_SECURE=true` | `Secure` omitted on local HTTP (`auto`), present on HTTPS / `CF-Visitor` / forced mode, and mirrored on `delete_cookie` |
| FR-4 | Exceed threshold on `/api/auth/login`, `/api/auth/register`, `/api/auth/passkey/login/start`, `/api/import/inspect`; send spoofed `X-Forwarded-For` from untrusted peer vs trusted loopback proxy | HTTP `429` with `Retry-After` header; untrusted peer spoofing ignored |
| FR-5 | Test 1-char/control-char/`129`-char passwords on register vs short legacy password on login; test invalid/long usernames, `u1` valid username, blank single-user admin setup, sanitized auth logs, unified passkey start errors | `422`/`400` on invalid registration/change; legacy login and single-user setup pass; `u1` passes |
| FR-6 | Stream `>20 MB` non-ZIP file to `/api/import/inspect`; stage `>3` imports per user or exceed global staged caps; upload `>20 MB` payload to portrait/gallery/world/SillyTavern routes | HTTP `413` without reading 1 GB into RAM; oldest user staged import evicted & unlinked; global cap returns `503`; image routes return `413` mid-stream |
| FR-7 | Default app vs `CYBERCANTINA_ENABLE_API_DOCS=true`; check `Permissions-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, conditional HSTS, and `CYBERCANTINA_PUBLIC_URL` header | `/docs` and `/openapi.json` return `404` by default (`200` when enabled); baseline headers present; HSTS emitted only when enabled + HTTPS |
| FR-8 | Execute two consecutive authenticated requests `< 300s` apart vs `>= 300s` apart | `user_sessions.last_active_at` skipped when `< 300s` (no commit), updated when `>= 300s`; `test_server_config_and_chloromancer.py` passes |

### Repository & CI Verification Commands
- Backend lint, boundaries & full suite:
  `cd backend && .venv/bin/ruff check app tests && .venv/bin/tach check && .venv/bin/pytest tests`
- Frontend architecture, build & tests:
  `npm --prefix frontend run arch:check && npm --prefix frontend run build && npm --prefix frontend test`
- Architecture docs check:
  `backend/.venv/bin/python scripts/generate_arch_docs.py --check`
- CodeQL security scan:
  Local `codeql` `python-security-extended.qls` scan reports `0` new alerts (`py/log-injection`, `py/stack-trace-exposure`, `py/polynomial-redos`, `py/path-injection`).
- Wiki docs sync:
  `git -C ../cybercantina-wiki diff` confirms end-user docs updated for new security env vars, auth bounds, and rate-limiting behavior.
