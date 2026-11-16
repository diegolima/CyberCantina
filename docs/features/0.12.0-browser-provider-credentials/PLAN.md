---
feature: browser-provider-credentials
target_version: 0.12.0
document_type: plan
status: completed
last_updated: 2026-11-16
---

# Execution Plan & Verification Trail

## Completed Workstreams
1. **Backend Config, Schema & Persistence:** `AppSettings.provider_credential_store` (`server_only | prefer_server | prefer_browser | browser_only`), `providers.credential_storage` DDL & migration, `ProviderStore` purge & compaction methods.
2. **Backend Policy, Purge Gate & Relay Routing:** `apply_settings` 409 confirmation gate under `_APPLY_LOCK`, `/api/settings?confirm_credential_purge=true`, `/api/providers` CRUD & client-probe enforcement, `resolver.py` `browser_storage_disabled`, and `LocalRelayHub` + `llm_client.py` browser-direct routing.
3. **Frontend Browser Vault, Direct Drivers & UI:** `credentialVault.ts`, `remoteProviderDriver.ts`, `LocalRelayContext.tsx`, `AdminModelsTab.tsx`, `AdminModal.tsx`, `ProvidersContext.tsx`, `ProviderEditor.tsx`, `ProviderCard.tsx`, and `ProfilePreferencesTab.tsx`.
4. **Wiki Documentation:** Updated `Providers-Models-and-Embeddings.md`, `Connecting-Cloud-Models-via-OpenRouter.md`, and `Authentication-Multi-User-and-Security.md` in `cybercantina-wiki`.
5. **Automated Verification:** Backend `pytest`, `ruff check`, `tach check`, frontend `arch:check`, `build`, `vitest`, and `scripts/generate_arch_docs.py --check`.
