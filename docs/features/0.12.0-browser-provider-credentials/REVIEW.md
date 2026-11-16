---
feature: browser-provider-credentials
target_version: 0.12.0
document_type: review
status: completed
last_updated: 2026-11-16
---

# Pre-Implementation & Architectural Review

## Key Edge Cases Guarded
1. **Zero-Server-Knowledge Boundary:** `create_provider`, `update_provider`, and `probe_draft` reject non-empty `bearer_token` payloads when `credential_storage == "browser"` or when `provider_credential_store == "browser_only"` (`422`), and `ProviderEditor` routes draft tests through `probeRemoteProvider` instead of `/api/providers/probe-draft`.
2. **AI Horde Anonymous Fallback Guard:** `remoteProviderDriver.ts` never falls back to `"0000000000"` when a browser-credentialed AI Horde key is absent; missing keys fail loudly with `browser_credential_missing`.
3. **Reversible `server_only` Enforcement:** `visibility_problem` returns `"browser_storage_disabled"` when `record.credential_storage == "browser"` and `settings.provider_credential_store == "server_only"`, keeping `localStorage` keys intact and exempting `browser_ollama` and `webgpu`.
4. **Metadata-Only Edits Under `server_only`:** Updating `name`, `color`, or `is_enabled` on a paused `credential_storage = 'browser'` provider does not force migration to `'server'` unless a new token is explicitly entered.
5. **TOCTOU-Safe `browser_only` Purge:** `apply_settings` checks `store.count_user_stored_credentials()` inside `_APPLY_LOCK` and raises `CredentialPurgeRequiredError` (`409` `user_credentials_purge_required`) until `confirm_credential_purge=true` is passed, then purges `scope = 'user'` secrets atomically, invalidates `probe_service`, and runs `compact_after_purge()` via `asyncio.to_thread`.
6. **Layer Boundaries:** `credentialVault.ts` and `remoteProviderDriver.ts` live under `frontend/src/local/` with zero upward imports into `api/`, `providers/`, or `components/`, verified by `depcruise` (`arch:check`) and `tach check`.
