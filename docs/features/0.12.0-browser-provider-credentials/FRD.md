---
feature: browser-provider-credentials
target_version: 0.12.0
document_type: frd
status: completed
last_updated: 2026-11-16
---

# Feature Requirements Document (FRD)
## Browser-Stored Provider Credentials, Client-Direct Relay Execution & Admin Credential Store Policy

**Status:** Completed  
**Target Version:** CyberCantina v0.12.0  
**Scope:**
- Backend Config & Settings Policy (`backend/app/config.py`, `backend/app/providers/settings_service.py`, `backend/app/routers/settings.py`)
- Backend Persistence & Provider Schemas (`backend/app/db/schema.sql`, `backend/app/db/repos/schema_init.py`, `backend/app/db/provider_store.py`, `backend/app/schemas/provider.py`)
- Backend Provider Policy, Resolver & Relay (`backend/app/routers/providers.py`, `backend/app/providers/resolver.py`, `backend/app/providers/endpoint.py`, `backend/app/providers/probe.py`, `backend/app/providers/local_relay.py`, `backend/app/engine/llm_client.py`)
- Frontend Browser Credential Vault & Direct Drivers (`frontend/src/local/`, `frontend/src/providers/LocalRelayContext.tsx`)
- Frontend Admin, Provider & Profile UI (`frontend/src/components/auth/AdminModelsTab.tsx`, `frontend/src/components/providers/ProviderEditor.tsx`, `frontend/src/components/providers/ProviderCard.tsx`, `frontend/src/components/providers/ProvidersContext.tsx`, `frontend/src/types/`, `frontend/src/api/`)
- User-Facing & Admin Wiki Documentation (`cybercantina-wiki/Providers-Models-and-Embeddings.md`, `cybercantina-wiki/Connecting-Cloud-Models-via-OpenRouter.md`, `cybercantina-wiki/Authentication-Multi-User-and-Security.md`)
- Automated Tests (`backend/tests/`, `frontend/src/components/__tests__/`)

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
Currently, non-browser personal providers (`ollama`, `openrouter`, and `aihorde`) store credentials server-side in SQLite (`providers.secret_enc`, Fernet-sealed via [`secret_box.py`](file:///home/diegolima/Git/cybercantina/backend/app/security/secret_box.py)) and execute all outbound inference and probe HTTP requests from the CyberCantina host ([`llm_client.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/llm_client.py), [`probe.py`](file:///home/diegolima/Git/cybercantina/backend/app/providers/probe.py)).

For multi-user and publicly hosted instances, this creates two structural concerns:
1. **Host Liability:** The host stores users' paid API keys alongside `.cantina_secret.key` on the same machine and proxies all third-party LLM API requests from the host's IP address.
2. **User Trust & Security:** Users cannot bring personal OpenRouter, AI Horde, or authenticated Ollama keys without transmitting and persisting those raw credentials on a server they may not control.

### 1.2 Proposed Solution (Browser Vault + Client-Direct Relay Execution)
Extend CyberCantina's existing browser relay architecture ([`LocalRelayHub`](file:///home/diegolima/Git/cybercantina/backend/app/providers/local_relay.py#L81-L86) and [`LocalRelayProvider`](file:///home/diegolima/Git/cybercantina/frontend/src/providers/LocalRelayContext.tsx#L62-L86)) so personal provider credentials (`ollama` bearer tokens, `openrouter` API keys, and `aihorde` API keys) can be stored **exclusively in the user's browser** and executed **directly from the browser**:
1. **Browser Credential Vault & Direct HTTP Drivers:** Store browser-only credentials in client storage keyed by `(user_id, provider_id)` and run both connection probes and LLM completions (`complete` / `stream`) directly from the browser via `fetch()`, streaming token deltas back to the backend over `/api/local-relay/ws`.
2. **Per-Provider `credential_storage` Mode:** Track `credential_storage` (`'server' | 'browser'`) on each provider record alongside a **"Store in Browser only"** checkbox in [`ProviderEditor`](file:///home/diegolima/Git/cybercantina/frontend/src/components/providers/ProviderEditor.tsx#L50).
3. **4-Mode Admin `"Provider Credential Store"` Policy:** Give administrators explicit control over personal (`scope = 'user'`) provider storage via `server_only`, `prefer_server` (default), `prefer_browser`, and `browser_only`, with an atomic confirmation + SQLite credential purge when enabling `browser_only`.

---

## 2. Scope, Boundaries & Core Invariants

1. **Zero-Server-Knowledge Invariant for Browser Credentials:**
   - Whenever a provider uses `credential_storage = 'browser'` (or the user checks *"Store in Browser only"* during draft testing), its bearer token / API key must **never** be transmitted to `POST /api/providers`, `PUT /api/providers/{id}`, `POST /api/providers/probe-draft`, `POST /api/providers/{id}/probe`, `/api/local-relay/ws` frames, or any turn/wizard/enrich endpoint.
   - All probes and completions for `credential_storage = 'browser'` providers execute exclusively in the browser.
2. **Shared System Provider Exemption:**
   - System-scoped providers (`scope = 'system'`) are shared across users and consumed by background tasks ([`_periodic_provider_probe`](file:///home/diegolima/Git/cybercantina/backend/app/main.py#L97-L105), `embedding_profile`). They **always** use `credential_storage = 'server'` and are never restricted or purged by `provider_credential_store`.
3. **Local Compute Providers Unaffected (`browser_ollama` & `webgpu`):**
   - `browser_ollama` and `webgpu` do not persist server-side credentials. Setting `provider_credential_store = 'server_only'` governs credentialed providers (`ollama`, `openrouter`, `aihorde`) only and must **never** disable `browser_ollama` or `webgpu` (which remain governed by `allow_user_providers`).
4. **No Silent Credential Downgrade (AI Horde Guard):**
   - [`build_call_target`](file:///home/diegolima/Git/cybercantina/backend/app/engine/llm_client.py#L177-L178) and [`_probe_once`](file:///home/diegolima/Git/cybercantina/backend/app/providers/probe.py#L119-L121) currently substitute `"0000000000"` when an `aihorde` token is empty. When `credential_storage = 'browser'` and the browser vault has no key for that `provider_id` (e.g., new device, cleared site data, or post-purge), browser execution and probing **must fail loudly** with `browser_credential_missing` rather than silently downgrading to anonymous queue priority.
5. **Reversible `server_only` Enforcement:**
   - Switching `provider_credential_store` to `server_only` causes existing `scope = 'user'` providers with `credential_storage = 'browser'` to be disregarded/unusable on the server (`browser_storage_disabled`), **without** clearing stored keys from users' browsers—so reverting back to `prefer_server` or `prefer_browser` restores access with zero re-entry friction.
6. **Zero-Surprise Upgrade Default:**
   - `provider_credential_store` defaults to `"prefer_server"`, preserving current server-side storage by default while allowing users to opt in per provider.

---

## 3. Functional Requirements & Edge Cases

### FR-1: Admin `"Provider Credential Store"` Policy (`AppSettings`)
**Requirement:** Add a 4-mode `provider_credential_store` policy governing `scope = 'user'` credentialed providers (`ollama`, `openrouter`, `aihorde`).

- **Configuration (`backend/app/config.py`, `backend/app/providers/settings_service.py`, `backend/app/routers/settings.py`):**
  - Add `ProviderCredentialStoreMode = Literal["server_only", "prefer_server", "prefer_browser", "browser_only"]`.
  - Add `provider_credential_store: ProviderCredentialStoreMode = Field(default="prefer_server")` to `AppSettings`.
  - Apply updates atomically in [`apply_settings`](file:///home/diegolima/Git/cybercantina/backend/app/providers/settings_service.py#L37-L84) under `_APPLY_LOCK`.
  - Preserve `provider_credential_store` in [`_redacted_for_user`](file:///home/diegolima/Git/cybercantina/backend/app/routers/settings.py#L50-L57) (`GET /api/settings`) so non-admin clients know the active policy and checkbox state.
- **Mode Behavior Matrix (for `scope = 'user'` credentialed providers):**

| Mode | Policy Value | `"Store in Browser only"` Checkbox (`ProviderEditor`) | Server Storage (`secret_enc`) | Existing `browser` Providers |
| :--- | :--- | :--- | :--- | :--- |
| **Server Only** | `server_only` | **Disabled**, unchecked | Required / allowed | Disregarded (`usable: false`, `browser_storage_disabled`); browser vault keys retained |
| **Prefer Server** *(default)* | `prefer_server` | **Enabled**, unchecked on Create; reflects existing `credential_storage` on Edit | Allowed | Allowed & usable |
| **Prefer Browser** | `prefer_browser` | **Enabled**, checked on Create; reflects existing `credential_storage` on Edit | Allowed | Allowed & usable |
| **Browser Only** | `browser_only` | **Disabled**, checked | Forbidden (`422` on `POST`/`PUT`) | Allowed & usable (all `scope = 'user'` DB secrets purged on enable) |

- **Admin UI (`frontend/src/components/auth/AdminModelsTab.tsx`):**
  - Add a **Provider Credential Store** selector (`Server Only`, `Prefer Server`, `Prefer Browser`, `Browser Only`) inside the **User policies** card alongside `allow_user_providers`.
  - Visually disable/mute the selector when `allow_user_providers` is `false`, with a concise hint explaining:
    - Applies only to personal (`scope = 'user'`) providers; shared system providers are never affected.
    - `Server Only` pauses existing browser-stored providers without wiping browser storage.
    - `Browser Only` purges all stored personal credentials from the server database upon confirmation.

---

### FR-2: Atomic Confirmation & User-Scoped Credential Purge (`browser_only`)
**Requirement:** Transitioning `provider_credential_store` to `browser_only` must check whether any `scope = 'user'` providers currently hold server-stored credentials (`secret_enc IS NOT NULL`), require explicit admin confirmation, and purge all matching DB secrets atomically.

- **Server-Enforced Confirmation (`PUT /api/settings` & `apply_settings`):**
  - Add `confirm_credential_purge: bool = False` to the settings update request (e.g., query parameter or request field handled in [`update_settings`](file:///home/diegolima/Git/cybercantina/backend/app/routers/settings.py#L107-L126) and [`apply_settings`](file:///home/diegolima/Git/cybercantina/backend/app/providers/settings_service.py#L37-L84)).
  - Inside `_APPLY_LOCK`, when `updated.provider_credential_store == "browser_only"`:
    1. Query `SELECT COUNT(*) AS provider_count, COUNT(DISTINCT owner_id) AS user_count FROM providers WHERE scope = 'user' AND secret_enc IS NOT NULL`.
    2. If `provider_count > 0` and `confirm_credential_purge` is `False`, abort before mutating in-memory `settings` or writing disk and raise **HTTP `409 Conflict`** with structured payload:
       ```json
       {
         "code": "user_credentials_purge_required",
         "message": "Enabling Browser Only will purge stored credentials from X personal provider(s) across Y user(s).",
         "affected_providers": X,
         "affected_users": Y
       }
       ```
    3. If `provider_count > 0` and `confirm_credential_purge` is `True`:
       - Execute inside a single SQLite transaction: set `secret_enc = NULL`, `credential_storage = 'browser'`, `version = version + 1`, `last_error_code = NULL`, `updated_at = now` on all `scope = 'user'` rows where `secret_enc IS NOT NULL`.
       - Also convert any remaining `scope = 'user'` credentialed rows (`ollama`, `openrouter`, `aihorde`) with `credential_storage = 'server'` and `secret_enc IS NULL` to `credential_storage = 'browser'` (`version = version + 1`).
       - Preserve `id`, `name`, `settings_json` (`base_url`), `cached_models_json`, and `user_model_settings` references so users keep their provider definitions and role assignments.
       - Call `probe_service.invalidate(pid)` for each modified provider ID.
       - Run `PRAGMA wal_checkpoint(TRUNCATE)` and `VACUUM` asynchronously via `asyncio.to_thread(...)` (matching Chloromancer's non-blocking compaction pattern) so residual ciphertext pages are reclaimed from SQLite.
  - **System Providers Untouched:** `scope = 'system'` rows must never be matched or modified.
- **Admin Confirmation Modal (`AdminModelsTab.tsx`):**
  - On `409` (`user_credentials_purge_required`), display a confirmation dialog stating the exact `affected_providers` personal provider(s) and `affected_users` account(s) whose stored server credentials will be permanently deleted, noting that shared system providers are unaffected and affected users will need to re-enter their keys in their browser.
  - On confirm, re-submit `PUT /api/settings` with `confirm_credential_purge = true`.
- **Non-Destructive Notice on `server_only` (Optional UX Polish):**
  - Switching to `server_only` does not purge anything and does not require a `409` gate; optionally surface a non-blocking status note if `scope = 'user'` providers with `credential_storage = 'browser'` exist, explaining they will be paused until migrated or browser storage is re-enabled.

---

### FR-3: Persistence, Schema & Provider API Enforcement
**Requirement:** Persist `credential_storage` cleanly in SQLite and enforce policy boundaries on every provider CRUD and resolution path.

- **Database Schema (`backend/app/db/schema.sql`, `backend/app/db/repos/schema_init.py`, `backend/app/db/provider_store.py`):**
  - Add column to `providers`:
    `credential_storage TEXT NOT NULL DEFAULT 'server' CHECK (credential_storage IN ('server', 'browser'))`
  - Add an idempotent `ALTER TABLE providers ADD COLUMN ...` migration in [`SchemaInitMixin`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/schema_init.py#L19) for existing databases (defaulting all pre-existing rows to `'server'`).
  - Update [`ProviderStore`](file:///home/diegolima/Git/cybercantina/backend/app/db/provider_store.py#L41) (`_row_to_record`, `create`, `update`, plus a `purge_user_credentials()` helper).
- **Schemas (`backend/app/schemas/provider.py`):**
  - Add `CredentialStorage = Literal["server", "browser"]`.
  - Add `credential_storage: CredentialStorage = "server"` to `ProviderCreatePayload`, `ProviderResponse`, and `ProviderRecord`, and `credential_storage: CredentialStorage | None = None` to `ProviderUpdatePayload`.
  - Add `"browser_storage_disabled"` to [`UnusableReason`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/provider.py#L30) and [`UnavailableCode`](file:///home/diegolima/Git/cybercantina/backend/app/providers/resolver.py#L13).
  - Add `"browser_credential_missing"` and `"cors_or_network_error"` (or map cleanly) to [`ProbeErrorCode`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/provider.py#L14-L29).
- **API Enforcement (`backend/app/routers/providers.py`):**
  - **System Scope Guard:** Reject `credential_storage == "browser"` on `scope == "system"` (`422`).
  - **Browser-Local Compute Types (`browser_ollama`, `webgpu`):** Always keep `credential_storage = "server"` (unused/no secret) and ignore `provider_credential_store` restrictions.
  - **Create (`POST /api/providers`):**
    - If `scope == "user"` and type is in `("ollama", "openrouter", "aihorde")`:
      - If `settings.provider_credential_store == "server_only"` and `payload.credential_storage == "browser"`, reject with `422` (`"Browser-stored provider credentials are disabled by the administrator."`).
      - If `settings.provider_credential_store == "browser_only"` and (`payload.credential_storage != "browser"` or `(payload.settings.bearer_token or "").strip()`): reject with `422` (`"Personal provider credentials must be stored in your browser."`).
      - When `payload.credential_storage == "browser"`:
        - Reject non-empty `payload.settings.bearer_token` with `422` so secrets are never accepted server-side.
        - **Bypass** the server-side `"OpenRouter requires an API key"` check (since the key lives in the browser).
  - **Update (`PUT /api/providers/{id}`):**
    - If `record.scope == "user"` and type is in `("ollama", "openrouter", "aihorde")`:
      - Under `browser_only`: reject any attempt to set `credential_storage = "server"` or supply a non-empty `bearer_token` (`422`).
      - Under `server_only`:
        - Reject any attempt to set `credential_storage = "browser"` (`422`).
        - **Metadata-Only / Delete Compatibility:** If `record.credential_storage == "browser"` already, allow metadata-only edits (`name`, `color`, `is_enabled`) or `DELETE` without forcing conversion; if the caller supplies a new `bearer_token` (or explicitly sets `credential_storage = "server"`), validate per normal server rules and clear/migrate to `'server'`.
      - When switching `"server" -> "browser"`: require `bearer_token` to be empty/unset, set `secret_enc = NULL` and `credential_storage = "browser"`.
      - When switching `"browser" -> "server"`: for `openrouter`, require a non-empty `bearer_token` (`422`).
  - **Visibility & Resolution (`backend/app/providers/resolver.py`, `_to_response`):**
    - In [`visibility_problem`](file:///home/diegolima/Git/cybercantina/backend/app/providers/resolver.py#L35-L44): for `record.scope == "user"` and `record.credential_storage == "browser"` (with `record.type not in ("browser_ollama", "webgpu")`), return `"browser_storage_disabled"` when `settings.provider_credential_store == "server_only"`.
    - In [`_to_response`](file:///home/diegolima/Git/cybercantina/backend/app/routers/providers.py#L58-L84): include `credential_storage` and expose `"browser_storage_disabled"` in `unusable_reason` (so `usable` is `false` while `server_only` is active).

---

### FR-4: Frontend Browser Credential Vault & UI Flows
**Requirement:** Manage browser-stored keys securely per user/provider without breaking multi-device clarity or `server_only` reversibility.

- **Credential Vault (`frontend/src/local/credentialVault.ts`):**
  - Store secrets in `localStorage` under keys scoped by both `user_id` and `provider_id` (e.g., `cantina_provider_cred:<userId>:<providerId>`).
  - Never send secrets to the backend or include them in error telemetry/logs.
  - **Pruning Rule:** Only prune stored keys for `userId` when a `providerId` no longer exists in `api.listProviders()` (i.e., the provider was deleted). **Never** auto-delete keys simply because `provider.usable === false` or `provider_credential_store === "server_only"`, preserving them in case the admin reverts `server_only`.
  - Clear a provider's vault key immediately when the user deletes that provider or explicitly migrates it from `"browser"` → `"server"`.
- **`ProviderEditor.tsx` UX:**
  - Render the **"Store in Browser only"** checkbox directly below/beside the credential field for `openrouter`, `aihorde`, and `ollama` when `scope === "user"`. Hide it for `scope === "system"`, `webgpu`, and `browser_ollama`.
  - Apply the 4-mode checkbox state matrix:
    - `server_only`: disabled, unchecked.
    - `prefer_server`: enabled; unchecked on Create, initialized to `existing.credential_storage === "browser"` on Edit.
    - `prefer_browser`: enabled; checked on Create, initialized to `existing.credential_storage === "browser"` on Edit.
    - `browser_only`: disabled, checked.
  - **Edit Transitions:**
    - `server` → `browser`: Display an inline note that the existing server-stored key cannot be read back and must be re-entered to save in this browser (required for `openrouter`, optional for `ollama`/`aihorde` if intentionally blank, though warn if `aihorde` expects a key). On Save, store the newly entered key in `credentialVault` and send `{ credential_storage: "browser", clear_bearer_token: true }` (no `bearer_token`) to `PUT /api/providers/{id}`.
    - `browser` → `server`: If `credentialVault` already holds a key for `(userId, provider.id)`, pre-authorize/offer migrating that key seamlessly on Save (sending `bearer_token` once to `PUT /api/providers/{id}` and removing the local copy on success) or let the user type a new key.
    - Editing a `browser`-stored provider while `server_only` is active: Show a clear notice (*"Browser-stored credentials are disabled by the administrator. Enter a key below to switch this provider to server storage, or wait until browser storage is re-enabled."*). Allow saving metadata edits (`name`, `color`, `is_enabled`) without forcing a key if no migration is requested.
  - **Mixed Content / CORS Warning (`ProviderEditor.tsx`):**
    - When *"Store in Browser only"* is active for a non-loopback `ollama` URL and `window.location.protocol === "https:"`, show an inline warning if the URL uses `http://` (browsers block `http://` Mixed Content for non-loopback hosts) and remind the user that remote Ollama endpoints must allow `OLLAMA_ORIGINS` for browser CORS.
- **`ProviderCard.tsx` & Model Picker Status:**
  - For `credential_storage === "browser"`:
    - If `unusable_reason === "browser_storage_disabled"`: show badge **`Browser Storage Disabled`** (with tooltip explaining admin `server_only` policy).
    - Else if key is present in `credentialVault`: show **`Stored in this browser`**.
    - Else (new device, cleared browser storage, or post-purge): show warning badge **`Key missing in this browser`** (for `openrouter` and `aihorde`, or `ollama` if previously purged/configured for browser key) with a prompt to open Edit and re-enter the credential.

---

### FR-5: Client-Direct Probing (`probe-draft` & `client-probe`)
**Requirement:** Probing a browser-credentialed provider must never transmit its token to the backend.

- **Draft Probe (`ProviderEditor.tsx`):**
  - When *"Store in Browser only"* is checked, clicking **Test Connection** must **not** call `api.probeProviderDraft(...)`.
  - Instead, invoke a client-side probe driver (`frontend/src/local/remoteProviderDriver.ts`):
    - `openrouter`: `GET <root>/auth/key` with `Authorization: Bearer <token>`, then `GET <root>/models` to populate model list.
    - `aihorde`: `GET <root>/models` with `Authorization: Bearer <token>` (require non-empty token when `credential_storage === "browser"`, failing with `browser_credential_missing` rather than `"0000000000"`).
    - `ollama`: `GET <root>/api/tags` (fallback `/v1/models`) with `Authorization: Bearer <token>` if non-empty.
- **Saved Provider Probe (`ProvidersContext.tsx` & `routers/providers.py`):**
  - Update [`ProvidersContext.probe`](file:///home/diegolima/Git/cybercantina/frontend/src/components/providers/ProvidersContext.tsx#L80-L154) so providers with `credential_storage === "browser"` execute their probe in the browser using `credentialVault` and sync non-secret results (`reachable`, `protocol`, `models`, `error_code`, `error`) to `POST /api/providers/{id}/client-probe`.
  - Update [`report_client_probe`](file:///home/diegolima/Git/cybercantina/backend/app/routers/providers.py#L322-L352) to permit providers where `_is_browser_provider(record.type) or record.credential_storage == "browser"`, rejecting with `403`/`409` if `visibility_problem(record, user.id)` returns `"browser_storage_disabled"` or `"byop_disabled"`.
  - Update [`probe_provider`](file:///home/diegolima/Git/cybercantina/backend/app/routers/providers.py#L279-L319) so server-triggered probes on `credential_storage == "browser"` providers route through `local_relay_hub.probe(...)` (never `_probe_once` on the server).

---

### FR-6: Browser-Direct Inference Execution via `LocalRelayHub`
**Requirement:** Route all completions (`complete_text`, `complete_structured`, `stream_chat`) for `credential_storage = 'browser'` providers through the user's connected browser tab.

- **Backend Endpoint & Call Target (`endpoint.py`, `resolver.py`, `llm_client.py`, `local_relay.py`):**
  - Add `credential_storage: CredentialStorage = "server"` to [`ResolvedEndpoint`](file:///home/diegolima/Git/cybercantina/backend/app/providers/endpoint.py#L9-L24) and [`CallTarget`](file:///home/diegolima/Git/cybercantina/backend/app/engine/llm_client.py#L126-L135).
  - In [`resolve_endpoint`](file:///home/diegolima/Git/cybercantina/backend/app/providers/resolver.py#L47-L79): when `record.credential_storage == "browser"`, skip `active.bearer_token(record)` and return `ResolvedEndpoint(..., bearer_token=None, credential_storage="browser")`.
  - In [`llm_client.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/llm_client.py#L418-L443): dispatch to `local_relay_hub.complete(...)` / `local_relay_hub.stream(...)` whenever `target.provider_type in ("browser_ollama", "webgpu")` **or** `target.credential_storage == "browser"`, passing `provider_id`, `driver` (`"openrouter" | "aihorde" | "ollama" | "browser_ollama" | "webgpu"`), `base_url`, `model`, `messages`, sampling options, and `json_mode`/`json_schema`—never any credential.
- **Frontend Relay & Direct HTTP Driver (`LocalRelayContext.tsx`, `frontend/src/local/remoteProviderDriver.ts`):**
  - Update `hasBrowserProviders` in [`LocalRelayProvider`](file:///home/diegolima/Git/cybercantina/frontend/src/providers/LocalRelayContext.tsx#L84-L85) so the WebSocket connects whenever the user has any enabled, `usable` provider where `type in ("browser_ollama", "webgpu")` **or** `credential_storage === "browser"`.
  - Implement browser-side `complete` and `stream` (SSE `data: ...` for OpenAI-compat `openrouter`/`aihorde`/`ollama /v1`, and NDJSON for native `ollama /api/chat`), attaching `Authorization: Bearer <vaultKey>` directly from `credentialVault`:
    - If `vaultKey` is missing for `openrouter` or `aihorde`, immediately emit `llm.error` with `code = "browser_credential_missing"` (never `"0000000000"`).
    - Map `401`/`403` to clear authentication error messages, and `TypeError` / network failures to `cors_or_network_error`.
  - Ensure `turn_streaming.py` surfaces `browser_credential_missing` and `cors_or_network_error` cleanly in [`_RELAY_ERROR_MESSAGES`](file:///home/diegolima/Git/cybercantina/backend/app/routers/campaign_routes/turn_streaming.py#L768-L773).

---

### FR-7: User-Facing & Administrator Documentation (`cybercantina-wiki`)
**Requirement:** Update the living user and operator documentation in `cybercantina-wiki` (per [`docs/features/README.md`](file:///home/diegolima/Git/cybercantina/docs/features/README.md)) alongside implementation so end users and server admins understand how browser-stored credentials work, their trade-offs, and how to troubleshoot them.

- **[Providers-Models-and-Embeddings.md](file:///home/diegolima/Git/cybercantina-wiki/Providers-Models-and-Embeddings.md):**
  - Document the **"Store in Browser only"** option for personal `ollama`, `openrouter`, and `aihorde` providers, explaining that credentials stay in the local browser (`localStorage`, scoped per account) and that probes/completions execute directly from the browser via the WebSocket relay rather than through the host server.
  - Clearly call out trade-offs and limitations: device/browser locality (`Key missing in this browser` when switching devices or clearing site data), keeping the browser tab open until a turn and Phase 5 Clerk finish, Mixed Content (`https://` CyberCantina requiring `https://` for non-loopback remote Ollama) and `OLLAMA_ORIGINS` CORS requirements for browser-credentialed remote `ollama`, and why AI Horde requires a browser key instead of falling back to anonymous mode.
- **[Connecting-Cloud-Models-via-OpenRouter.md](file:///home/diegolima/Git/cybercantina-wiki/Connecting-Cloud-Models-via-OpenRouter.md):**
  - Update **Step 2: Add the OpenRouter Provider in CyberCantina** to explain the **"Store in Browser only"** checkbox (and when it is locked on/off by the server's **Provider Credential Store** policy).
  - Add **Troubleshooting** entries for `Key missing in this browser` / `browser_credential_missing` (including after an admin enables `Browser Only`), `Browser Storage Disabled` (when an admin switches to `Server Only`), and relay-offline / tab-closed interruptions.
- **[Authentication-Multi-User-and-Security.md](file:///home/diegolima/Git/cybercantina-wiki/Authentication-Multi-User-and-Security.md):**
  - Document the **Provider Credential Store** policy (`Server Only`, `Prefer Server`, `Prefer Browser`, `Browser Only`) under **Admin Settings → Models → User policies**.
  - Clarify that shared system providers (`scope = 'system'`) and local compute providers (`browser_ollama`, `webgpu`) are unaffected, explain the destructive `Browser Only` SQLite credential purge + confirmation dialog, and document `Server Only`'s reversible pause behavior (browser keys retained client-side).
  - Update **Credential Encryption & SSRF Protections** to contrast server-side Fernet encryption (`secret_enc`) against browser-only storage + client-direct execution (including XSS/shared-browser considerations).

---

## 4. Non-Functional Requirements & Security Considerations

1. **CORS Compatibility Verification:**
   - Before finalizing headers in `remoteProviderDriver.ts`, verify preflight CORS responses from `https://openrouter.ai/api/v1` and `https://oai.stablehorde.net/v1` (specifically whether `HTTP-Referer` / `X-Title` are permitted in `Access-Control-Allow-Headers` or should be omitted in browser-direct calls).
2. **Account Isolation in Shared Browsers:**
   - Namespace all `localStorage` credential entries by `user_id` (`cantina_provider_cred:<userId>:<providerId>`) so switching accounts in the same browser never exposes one user's key to another user.
3. **Non-Blocking SQLite Compaction:**
   - Execute `VACUUM` / `PRAGMA wal_checkpoint(TRUNCATE)` after a `browser_only` credential purge off the asyncio event loop (`asyncio.to_thread`) so active SSE streams and WebSocket heartbeats are not stalled.
4. **Module Layering & Architecture Docs:**
   - Keep `frontend/src/local/` free of upward UI/API cycles (`npm --prefix frontend run arch:check`), keep `backend/tach.toml` clean (`tach check`), and regenerate architecture docs via `scripts/generate_arch_docs.py` when schemas/routes/modules change.

---

## 5. Acceptance Criteria

- [ ] **4-Mode Policy & Defaults:** `provider_credential_store` defaults to `"prefer_server"`, is configurable in Admin → Models → User policies, and is respected by `GET /api/settings` (including non-admin views).
- [ ] **Checkbox State Matrix:** `ProviderEditor` renders `"Store in Browser only"` for `scope = 'user'` `ollama`/`openrouter`/`aihorde` providers matching the exact enabled/checked rules across `server_only`, `prefer_server`, `prefer_browser`, and `browser_only`, and hides it for `scope = 'system'`, `webgpu`, and `browser_ollama`.
- [ ] **`server_only` Reversibility:** Switching to `server_only` marks existing `scope = 'user'` `credential_storage = 'browser'` providers `usable: false` (`unusable_reason: "browser_storage_disabled"`) on the backend without deleting keys from `localStorage`; reverting to `prefer_server`/`prefer_browser` restores usability immediately. `browser_ollama` and `webgpu` remain usable under `server_only`.
- [ ] **`browser_only` Purge Flow:** Switching to `browser_only` returns `409` (`user_credentials_purge_required`) when `scope = 'user'` rows have `secret_enc IS NOT NULL`; confirming clears `secret_enc`, sets `credential_storage = 'browser'`, bumps `version`, invalidates `probe_service`, compacts SQLite, leaves `scope = 'system'` providers untouched, and rejects subsequent server-side user credential writes (`422`).
- [ ] **Zero-Server-Knowledge Execution & Probing:** Creating, editing, draft-probing, saved-probing, and streaming/completing turns with a `credential_storage = 'browser'` provider never sends the token to any backend HTTP route or WebSocket message.
- [ ] **Missing Credential Guard:** Missing browser keys (second device or post-purge) fail loudly with `browser_credential_missing` and surface a clear UI badge/prompt without falling back to AI Horde's `"0000000000"` anonymous key.
- [ ] **Wiki Documentation:** `Providers-Models-and-Embeddings.md`, `Connecting-Cloud-Models-via-OpenRouter.md`, and `Authentication-Multi-User-and-Security.md` in `cybercantina-wiki` are updated to cover the `"Store in Browser only"` flow, device-local trade-offs, remote Ollama CORS/Mixed Content caveats, and all 4 admin **Provider Credential Store** modes.
- [ ] **Checks Pass:** `ruff check`, `tach check`, `pytest`, `npm --prefix frontend run arch:check`, `npm --prefix frontend run build`, `npm --prefix frontend test`, and `scripts/generate_arch_docs.py --check` all pass once implemented.
