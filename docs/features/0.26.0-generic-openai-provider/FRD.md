---
feature: generic-openai-provider
target_version: 0.26.0
document_type: frd
status: completed
last_updated: 2026-11-20
---

# Feature Requirements Document (FRD)
## Generic OpenAI-Compatible Provider (`openai_compat`) & OpenAI-Compat Adapter Hierarchy Refactor

**Status:** Completed  
**Target Version:** CyberCantina v0.26.0  
**Scope:**
- Backend Generic OpenAI-Compatible Adapter & Registry ([`openai_compat.py`](file:///home/diegolima/Git/cybercantina/backend/app/providers/openai_compat.py))
- Backend Schemas, URL Policy & Persistence ([`provider.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/provider.py), [`url_policy.py`](file:///home/diegolima/Git/cybercantina/backend/app/security/url_policy.py), [`provider_store.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/provider_store.py))
- Backend Provider Router, Probing, Model Parsing & Relay ([`providers.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/providers.py), [`probe.py`](file:///home/diegolima/Git/cybercantina/backend/app/providers/probe.py), [`models.py`](file:///home/diegolima/Git/cybercantina/backend/app/providers/models.py), [`local_relay.py`](file:///home/diegolima/Git/cybercantina/backend/app/providers/local_relay.py))
- Backend LLM Inference, Embeddings & Context Ceiling ([`llm_client.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/llm_client.py), [`vector_math.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/vector_math.py), [`lore_scope.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/lore_scope.py))
- Frontend Types, Browser Driver Adapter Hierarchy & UI ([`providers.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/providers.ts), [`local/types.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/local/types.ts), [`remoteProviderDriver.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/local/remoteProviderDriver.ts), [`LocalRelayContext.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/providers/LocalRelayContext.tsx), [`ProviderEditor.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/providers/ProviderEditor.tsx), [`ModelPicker.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/models/ModelPicker.tsx), [`ModelCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/models/ModelCard.tsx))
- User-Facing Wiki Documentation ([`Home.md`](file:///home/diegolima/Git/cybercantina-wiki/Home.md), [`Providers-Models-and-Embeddings.md`](file:///home/diegolima/Git/cybercantina-wiki/Providers-Models-and-Embeddings.md))
- Automated Tests ([`test_openai_compat_provider.py`](file:///home/diegolima/Git/cybercantina/backend/tests/test_openai_compat_provider.py), [`browserCredentialVaultAndDriver.test.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/local/__tests__/browserCredentialVaultAndDriver.test.ts), [`browserCredentialStoreUi.test.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/__tests__/browserCredentialStoreUi.test.tsx))

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
Prior to `v0.26.0`, CyberCantina supported several specialized OpenAI-compatible cloud providers (`openrouter`, `nanogpt`, `aihorde`) alongside `ollama`, `browser_ollama`, and `webgpu`, but lacked a dedicated **Generic OpenAI-Compatible API** provider:

1. **Ollama Workaround Friction & Path Stripping:** Users connecting to standard OpenAI-compatible services (OpenAI, Groq, Together, Mistral, DeepSeek, Fireworks, Gemini's OpenAI endpoint, LiteLLM, vLLM, LM Studio, `llama.cpp` server, TabbyAPI) had to register them as `"ollama"` providers. Doing so caused unnecessary `/api/tags`, `/api/chat`, and `/api/embed` probe/request round-trips before falling back to `/v1/*`, and stripped `/v1` or `/api` suffixes in URL normalization—breaking endpoints with custom base paths such as `/openai/v1` or `/v1beta/openai`.
2. **Scattered Provider-Specific Branching:** Each specialized OpenAI-compatible provider (`openrouter`, `nanogpt`, `aihorde`) had duplicated `if/elif provider_type == "..."` branches across `probe.py`, `llm_client.py`, `vector_math.py`, `lore_scope.py`, `routers/providers.py`, `provider_store.py`, and `remoteProviderDriver.ts`. Adding a new OpenAI-compatible provider required touching ~10+ files and risked behavioral drift.
3. **Model Picker Ergonomics:** Using `"ollama"` for OpenAI-compatible APIs rendered a static `<select>` dropdown instead of the searchable combobox + custom model ID input needed for cloud/proxy catalogs.

### 1.2 Solution Implemented
1. **First-Class `"openai_compat"` Provider Type:** Added a dedicated **OpenAI-Compatible API** provider supporting any standard `/models`, `/chat/completions`, and `/embeddings` endpoint (cloud HTTPS or admin/LAN HTTP), with optional API keys and path-preserving URL normalization.
2. **Unified OpenAI-Compatible Adapter Hierarchy (Backend & Frontend):**
   - Backend ([`openai_compat.py`](file:///home/diegolima/Git/cybercantina/backend/app/providers/openai_compat.py)): Introduced `OpenAICompatProvider` as the base implementation and refactored `OpenRouterProvider`, `NanoGPTProvider`, and `AIHordeProvider` to inherit from it (sharing `_ReasoningObjectOpenAICompatProvider` for OpenRouter/NanoGPT reasoning-suppression retries) behind a single registry (`OPENAI_COMPAT_PROVIDERS`).
   - Frontend ([`remoteProviderDriver.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/local/remoteProviderDriver.ts)): Mirrored the same architecture with `OpenAiCompatAdapter` as the base class and `OpenRouterAdapter`, `NanoGptAdapter`, and `AiHordeAdapter` extending it.

---

## 2. Scope, Boundaries & Core Invariants

1. **Zero Database Migration Required:**
   - `providers.type TEXT NOT NULL` in `schema.sql` has no `CHECK` constraint on `type`; existing databases require no DDL migration.
2. **Zero Behavioral Regression for Existing Providers:**
   - `openrouter` retains `/auth/key` verification, shared `openrouter_catalog_service` caching (`persist_probed_models = False`), `HTTP-Referer`/`X-Title` headers, and `reasoning: {"effort": "none"}` → `{"exclude": True}` → omit retry semantics.
   - `nanogpt` retains reachability-only `/models` + best-effort `/embedding-models` catalog merging, `HTTP-Referer`/`X-Title` headers, and the same reasoning retry chain.
   - `aihorde` retains anonymous `"0000000000"` key fallback on server probes/calls (serialized via `_AIHORDE_ANON_SEMAPHORE`), Option A worker/queue capacity sorting, `min_max_tokens = 16`, `reasoning_effort = "none"` retry, and offline model fallback.
3. **Clean Generic Defaults (No Non-Standard Headers or Params):**
   - Generic `"openai_compat"` requests omit `HTTP-Referer`, `X-Title`, `reasoning`, and `reasoning_effort` so strict OpenAI-compatible servers and CORS gateways do not reject unknown fields or headers.
   - API keys / bearer tokens are optional; when omitted, no `Authorization` header is sent.
4. **Module Boundary Compliance (`tach.toml` & `dependency-cruiser`):**
   - `app.security.url_policy` remains a leaf module (`depends_on = []`) and handles `"openai_compat"` path normalization without importing `app.providers`.
5. **BYOP, SSRF & Browser-Credential Store Parity:**
   - `"openai_compat"` participates in `allow_user_providers`, `provider_credential_store` (`server_only`, `prefer_server`, `prefer_browser`, `browser_only`), `ProviderStore.purge_user_credentials()`, and SSRF enforcement (`assert_url_allowed(..., allow_private=False)` for non-admin users).

---

## 3. Functional Requirements & Behavior

### FR-1: Generic OpenAI-Compatible Adapter Hierarchy & Registry
- **Backend ([`openai_compat.py`](file:///home/diegolima/Git/cybercantina/backend/app/providers/openai_compat.py)):**
  - `OpenAICompatProvider` defines:
    - Metadata: `provider_type`, `display_name`, `default_base_url`, `requires_server_api_key`, `persist_probed_models`, `min_max_tokens`, `include_referer_headers`, `probe_timeout_seconds`.
    - Endpoint builders: `models_url(root_url)`, `chat_completions_url(root_url)`, `embeddings_url(root_url)`.
    - Auth & headers: `effective_token(token)`, `build_probe_headers(token)`, `build_chat_headers(token, referer_url=...)`.
    - Probing & parsing: `parse_models(payload)` and `probe(root_url, token, client=...)` against `GET {root}/models`.
    - Inference hooks: `build_chat_payload(...)`, `apply_disable_reasoning(payload)`, `next_bad_request_payload(payload, error_text_lower, attempt)`, `request_semaphore(headers)`, `resolve_model_fallback(...)`.
  - Subclasses:
    - `_ReasoningObjectOpenAICompatProvider(OpenAICompatProvider)` → `OpenRouterProvider`, `NanoGPTProvider`.
    - `AIHordeProvider(OpenAICompatProvider)`.
  - Registry helpers: `OPENAI_COMPAT_PROVIDERS`, `OPENAI_COMPAT_PROVIDER_TYPES`, `get_openai_compat_provider(provider_type)`, `is_openai_compat_provider(provider_type)`.
- **Frontend ([`remoteProviderDriver.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/local/remoteProviderDriver.ts)):**
  - `OpenAiCompatAdapter` base class + `ReasoningObjectOpenAiAdapter`, `OpenRouterAdapter`, `NanoGptAdapter`, and `AiHordeAdapter` registered in `OPENAI_COMPAT_ADAPTERS`.

---

### FR-2: Provider Type Registration, URL Normalization & Persistence
- **Type Unions:**
  - Backend: `"openai_compat"` added to `ProviderType` ([`schemas/provider.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/provider.py)) and `BrowserDriver` ([`local_relay.py`](file:///home/diegolima/Git/cybercantina/backend/app/providers/local_relay.py)).
  - Frontend: `"openai_compat"` added to `ProviderType` ([`types/providers.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/providers.ts)), `RelayDriver` ([`local/types.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/local/types.ts)), `RemoteProviderDriverType` ([`remoteProviderDriver.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/local/remoteProviderDriver.ts)), and `executeLlmDispatch` ([`LocalRelayContext.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/providers/LocalRelayContext.tsx)).
- **URL Normalization ([`url_policy.py`](file:///home/diegolima/Git/cybercantina/backend/app/security/url_policy.py) & [`remoteProviderDriver.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/local/remoteProviderDriver.ts)):**
  - Empty URL is rejected (`invalid_url`, `"Server URL is required."`).
  - Allows both `http://` and `https://` (subject to backend SSRF policy for non-admin users and browser mixed-content warnings for HTTPS pages targeting non-loopback HTTP).
  - If the URL has no path (e.g., `https://api.openai.com` or `http://localhost:1234`), appends `/v1`.
  - If the URL includes a non-empty path (e.g., `/v1`, `/api/v1`, `/openai/v1`, `/v1beta/openai`), preserves it as-is after stripping trailing slashes.
- **Persistence & Router ([`provider_store.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/provider_store.py), [`routers/providers.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/providers.py)):**
  - Default display name: `"OpenAI API"` (resolved via `adapter.display_name`).
  - `_DEFAULT_URLS_BY_TYPE` and `_REQUIRED_SERVER_KEY_LABELS` are derived dynamically from `OPENAI_COMPAT_PROVIDERS`.
  - `ProviderStore.purge_user_credentials()` includes `'openai_compat'` alongside `'ollama'`, `'openrouter'`, `'aihorde'`, and `'nanogpt'`.

---

### FR-3: Probing, Chat Completions, Streaming, Embeddings & Context Ceiling
- **Probing ([`probe.py`](file:///home/diegolima/Git/cybercantina/backend/app/providers/probe.py), [`models.py`](file:///home/diegolima/Git/cybercantina/backend/app/providers/models.py)):**
  - `_probe_once()` delegates any OpenAI-compatible type to `adapter.probe(...)`.
  - Generic `"openai_compat"` sends `GET {root}/models` with optional `Authorization: Bearer <token>`, validates `{ "data": [...] }`, parses models via `parse_openai_models` (deduplicating IDs, extracting `family` prefix when `/` is present, and classifying embedding models via `EMBED_MODEL_KEYWORDS`), and maps `401`/`403`/`404`/`502`/`bad_payload`/network errors cleanly.
- **Chat Completions & Streaming ([`llm_client.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/llm_client.py)):**
  - Skips native Ollama `/api/chat` whenever `is_openai_compat_provider(target.provider_type)` is true.
  - Sends `POST {root}/chat/completions` for both `complete_text` (with `response_format: {"type": "json_object"}` when `json_mode` or `json_schema` is set) and `stream_chat` (SSE streaming).
  - Delegates reasoning suppression, `400` retries, request semaphores, and offline model fallbacks to the active adapter.
- **Embeddings ([`vector_math.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/vector_math.py)):**
  - Skips native Ollama `/api/embed` when `get_openai_compat_provider(endpoint.type)` is present and posts directly to `adapter.embeddings_url(endpoint.root_url)` with `adapter.build_probe_headers(token)`.
- **Context Ceiling ([`lore_scope.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/lore_scope.py)):**
  - `resolve_actor_context_ceiling` uses `is_openai_compat_provider(endpoint.type)` to return `(None, 0)` (server-managed context).

---

### FR-4: Frontend Provider Management & Model Picker UX
- **[`ProviderEditor.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/providers/ProviderEditor.tsx):**
  - Adds **OpenAI-Compatible API** button to `.provider-type-grid`.
  - Sets default name placeholder (`Defaults to “OpenAI API”`), `API Base URL` label with examples (`OpenAI, Groq, Together, vLLM, LM Studio, llama.cpp`) and `https://api.openai.com/v1` placeholder, and `API Key / Bearer token` with optional hint (`optional; required by most cloud APIs`).
  - Requires non-empty URL; allows saving with or without an API key (both server-stored and `"Store in Browser only"` modes).
  - Displays the HTTPS mixed-content warning when `"Store in Browser only"` is used with a non-loopback `http://` URL on an HTTPS page.
- **[`ModelPicker.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/models/ModelPicker.tsx):**
  - Enables `isCombobox` and `catalogSuggestions` for `selected?.type === "openai_compat"` so users can search discovered models or enter any custom model ID.
- **[`ModelCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/models/ModelCard.tsx):**
  - Formats `"openai_compat"` provider badge as `OPENAI API`.

---

### FR-5: User-Facing Documentation
- Updated [`Home.md`](file:///home/diegolima/Git/cybercantina-wiki/Home.md) and [`Providers-Models-and-Embeddings.md`](file:///home/diegolima/Git/cybercantina-wiki/Providers-Models-and-Embeddings.md) in `cybercantina-wiki` to document `openai_compat`, note that `openrouter`, `nanogpt`, and `aihorde` extend the OpenAI-compatible driver, and list `openai_compat` under browser-stored credential support.

---

## 4. Out of Scope (Deferred)
1. **Per-Provider Custom HTTP Headers UI:** Arbitrary user-defined headers (e.g., Azure `api-key` header or custom proxy headers) are not exposed in the UI.
2. **Provider-Specific Reasoning Toggle UI:** Generic `openai_compat` intentionally avoids sending non-standard `reasoning` / `reasoning_effort` fields; exposing a per-provider reasoning parameter toggle is deferred.
3. **Declarative Frontend Form Metadata Table:** Consolidating all inline ternary labels/placeholders in `ProviderEditor.tsx` into a single declarative config object can be done as a follow-up if additional preset types are added.

---

## 5. Verification & Acceptance Criteria

- **Backend Tests ([`test_openai_compat_provider.py`](file:///home/diegolima/Git/cybercantina/backend/tests/test_openai_compat_provider.py) + existing provider suites):**
  - Inheritance assertions confirming `OpenRouterProvider`, `NanoGPTProvider`, and `AIHordeProvider` subclass `OpenAICompatProvider`.
  - URL normalization for empty URL rejection, bare host `/v1` append, and custom path preservation (`/v1`, `/openai/v1`, `/v1beta/openai`).
  - Probing with and without bearer token, error code mapping (`401`, `403`, `404`, `502`, `bad_payload`).
  - `LLMClient.complete_text` and `stream_chat` direct `/chat/completions` routing, header hygiene, `response_format`, and omission of non-standard reasoning params.
  - `embed_text` direct `/embeddings` routing and `resolve_actor_context_ceiling` returning `(None, 0)`.
  - Provider CRUD API (`POST /api/providers`) and `purge_user_credentials()` coverage.
- **Frontend Tests ([`browserCredentialVaultAndDriver.test.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/local/__tests__/browserCredentialVaultAndDriver.test.ts), [`browserCredentialStoreUi.test.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/__tests__/browserCredentialStoreUi.test.tsx)):**
  - `normalizeRemoteBaseUrl`, `probeRemoteProvider`, and `runRemoteProviderChat` for `openai_compat` (with and without token, custom paths, streaming, no non-standard reasoning fields).
  - `ProviderEditor` SSR rendering assertions for `openai_compat`.
- **Repository Quality Gates (All Passing):**
  - `cd backend && .venv/bin/ruff check app tests && .venv/bin/tach check`
  - `backend/.venv/bin/pytest backend/tests` (502 passed)
  - `npm --prefix frontend run arch:check && npm --prefix frontend run build && npm --prefix frontend test` (37 files, 247 passed)
  - `backend/.venv/bin/python scripts/generate_arch_docs.py --check`
