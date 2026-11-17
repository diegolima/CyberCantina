---
feature: nanogpt-provider
target_version: 0.18.0
document_type: frd
status: completed
last_updated: 2026-11-17
---

# Feature Requirements Document (FRD)
## NanoGPT Cloud Provider Support (`nanogpt`)

**Status:** Completed  
**Target Version:** CyberCantina v0.18.0  
**Scope:**
- Backend Schemas, URL Policy & Persistence ([`provider.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/provider.py), [`url_policy.py`](file:///home/diegolima/Git/cybercantina/backend/app/security/url_policy.py), [`provider_store.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/provider_store.py))
- Backend Provider Router, Probing & Relay ([`providers.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/providers.py), [`probe.py`](file:///home/diegolima/Git/cybercantina/backend/app/providers/probe.py), [`models.py`](file:///home/diegolima/Git/cybercantina/backend/app/providers/models.py), [`local_relay.py`](file:///home/diegolima/Git/cybercantina/backend/app/providers/local_relay.py))
- Backend LLM Inference & Embeddings ([`llm_client.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/llm_client.py), [`vector_math.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/vector_math.py))
- Frontend Types, Browser Driver & UI ([`providers.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/providers.ts), [`local/types.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/local/types.ts), [`remoteProviderDriver.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/local/remoteProviderDriver.ts), [`ProviderEditor.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/providers/ProviderEditor.tsx), [`ProviderCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/providers/ProviderCard.tsx), [`ModelPicker.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/models/ModelPicker.tsx))
- User-Facing Wiki Documentation (`cybercantina-wiki/Providers-Models-and-Embeddings.md`)
- Automated Tests (`backend/tests/`, `frontend/src/`)

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
NanoGPT exposes an OpenAI-compatible multi-model API at `https://nano-gpt.com/api/v1` (and `https://api.nano-gpt.com/api/v1`) covering chat completions, structured JSON output, reasoning models, and vector embeddings.

Today, users cannot cleanly configure NanoGPT using CyberCantina's existing `"ollama"` generic OpenAI-compatible provider type:
1. **Path Stripping Breakage:** NanoGPT's OpenAI-compatible root path is `/api/v1`. Under `"ollama"`, [`normalize_base_url`](file:///home/diegolima/Git/cybercantina/backend/app/security/url_policy.py#L82-L85) strips `/v1` (leaving `.../api`), and [`get_ollama_root_url`](file:///home/diegolima/Git/cybercantina/backend/app/engine/llm_client.py#L77-L84) / [`normalizeRemoteBaseUrl`](file:///home/diegolima/Git/cybercantina/frontend/src/local/remoteProviderDriver.ts#L145-L151) strip `/api` as well—producing broken `/v1/chat/completions` and `/v1/embeddings` URLs without `/api`.
2. **Unnecessary Ollama Probing:** `"ollama"` probes `/api/tags`, `/api/chat`, and `/api/embed` before falling back to OpenAI-compatible routes.
3. **Large Catalog Ergonomics:** NanoGPT hosts hundreds of models; `"ollama"` renders a flat `<select>` dropdown instead of the searchable combobox used by `"openrouter"` and `"aihorde"` in [`ModelPicker`](file:///home/diegolima/Git/cybercantina/frontend/src/components/models/ModelPicker.tsx#L67-L71).

### 1.2 Proposed Solution
Add **`"nanogpt"`** as a first-class cloud provider type modeled closely on `"openrouter"`:
1. Preserve `/api/v1` path semantics in backend URL normalization and browser-direct remote drivers (supporting both `https://nano-gpt.com/api/v1` as default and custom `https://api.nano-gpt.com/api/v1` or compatible proxy URLs).
2. Support **both** server-stored (`credential_storage = "server"`) and browser-stored (`credential_storage = "browser"`) BYOP credentials (NanoGPT's `/api/v1/*` endpoints return `Access-Control-Allow-Origin: *` and `Access-Control-Allow-Headers: Authorization, Content-Type` on `OPTIONS` preflight).
3. Validate **endpoint reachability and model catalog retrieval only** during connection probes (`GET {root}/models`), deferring API key authentication validation to inference/embedding calls—and document this behavior explicitly on the wiki.

---

## 2. Scope, Boundaries & Core Invariants

1. **Zero Database Migration Required:**
   - [`schema.sql`](file:///home/diegolima/Git/cybercantina/backend/app/db/schema.sql#L483-L504) defines `providers.type TEXT NOT NULL` with no `CHECK` constraint on `type`. Existing databases require no DDL migration.
2. **Reachability-Only Probe Semantics (Explicit Scope Decision):**
   - NanoGPT's `GET /api/v1/models` returns `HTTP 200` publicly without validating the `Bearer` token, and NanoGPT has no `/auth/key` parity endpoint like OpenRouter.
   - For `v0.18.0`, probing a `"nanogpt"` provider **only validates endpoint reachability and fetches the model catalog** (`GET {root}/models`). It does **not** verify API key authentication or account balance.
   - Saving a `"nanogpt"` provider still requires an API key in the UI/API (server-stored or browser-stored), and invalid/unauthorized keys will surface on the first chat completion or embedding call (`401`/`403`).
3. **BYOP & Credential Store Policy Parity:**
   - `"nanogpt"` must participate identically to `"openrouter"` in `allow_user_providers`, `provider_credential_store` (`server_only`, `prefer_server`, `prefer_browser`, `browser_only`), `purge_user_credentials()` in [`ProviderStore`](file:///home/diegolima/Git/cybercantina/backend/app/db/provider_store.py#L314-L350), and SSRF protection (`assert_url_allowed(..., allow_private=False)` for non-admin users).
4. **Browser-Direct Execution Parity:**
   - When `scope = "user"` and `credential_storage = "browser"`, API keys must never be sent to the CyberCantina server; probes and completions run directly from the browser via [`remoteProviderDriver.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/local/remoteProviderDriver.ts) over `/api/local-relay/ws`.
5. **No Silent Provider Fallback:**
   - Missing/unavailable `"nanogpt"` providers or models must fail loudly with explicit errors via [`ProviderUnavailableError`](file:///home/diegolima/Git/cybercantina/backend/app/providers/resolver.py#L23-L40) and never silently switch models or providers.
6. **User-Facing Wiki Documentation Requirement:**
   - Any wiki documentation added or updated for NanoGPT must explicitly warn users that **Test Connection / Probe only checks reachability and loads the model list, and does not verify whether their NanoGPT API key is valid**.

---

## 3. Functional Requirements & Edge Cases

### FR-1: Provider Type, Default URL & Persistence
**Requirement:** Register `"nanogpt"` across backend and frontend type contracts, URL normalization, and SQLite persistence helpers.

- **Type Unions:**
  - Backend: add `"nanogpt"` to `ProviderType` in [`provider.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/provider.py#L11) and `BrowserDriver` in [`local_relay.py`](file:///home/diegolima/Git/cybercantina/backend/app/providers/local_relay.py#L27).
  - Frontend: add `"nanogpt"` to `ProviderType` in [`types/providers.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/providers.ts#L62-L67) and `RelayDriver` in [`local/types.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/local/types.ts#L13-L18).
- **URL Normalization (`url_policy.py` & `remoteProviderDriver.ts`):**
  - Default base URL constant: `NANOGPT_DEFAULT_BASE_URL = "https://nano-gpt.com/api/v1"`.
  - When `provider_type == "nanogpt"`:
    - Empty `base_url` resolves to `NANOGPT_DEFAULT_BASE_URL`.
    - If a URL is supplied with an empty path (e.g. `https://nano-gpt.com` or `https://api.nano-gpt.com`), normalize path to `/api/v1` (matching `"openrouter"`).
    - If a URL already includes a non-empty path (e.g. `/api/v1`), preserve it without stripping `/v1` or `/api`.
    - In `remoteProviderDriver.ts`, require `https://` for `"nanogpt"` just like `"openrouter"` and `"aihorde"`.
- **Store & Router (`provider_store.py`, `routers/providers.py`):**
  - Default display name in `ProviderStore.create()`: `"NanoGPT"`.
  - Include `'nanogpt'` alongside `'ollama'`, `'openrouter'`, `'aihorde'` in `ProviderStore.purge_user_credentials()`.
  - In `create_provider()` (`POST /api/providers`): when `payload.type == "nanogpt"`, require `raw_token` if `storage == "server"` (`422` if missing), and default empty `base_url` to `NANOGPT_DEFAULT_BASE_URL`.
  - In `probe_draft()` (`POST /api/providers/probe-draft`): resolve empty `draft.base_url` to `NANOGPT_DEFAULT_BASE_URL`.

---

### FR-2: Reachability-Only Probing & Model Catalog Parsing
**Requirement:** Probe NanoGPT endpoints for reachability and available models without enforcing authentication validation during the probe step.

- **Backend Probe ([`probe.py`](file:///home/diegolima/Git/cybercantina/backend/app/providers/probe.py#L83-L169)):**
  - Add a `if provider_type == "nanogpt":` branch in `_probe_once()`:
  - Send `GET {url.root.rstrip('/')}/models` with `bearer_headers(token)` (when a token is provided) and `timeout=5.0`.
  - Also issue a best-effort `GET {url.root.rstrip('/')}/embedding-models` (`timeout=3.0`, non-fatal on non-200 or network error) because NanoGPT exposes chat models on `/models` and embedding models separately on `/embedding-models`.
  - Do **not** abort locally if `token` is empty during a reachability probe, and do **not** call any `/auth/key` endpoint.
    - Map responses:
      - `200`: parse model payload into `list[ProviderModelInfo]` and return `_Outcome(True, "openai_compat", models)`. If payload is non-JSON or missing expected structure, return `_Outcome(False, error_code="bad_payload", ...)`.
      - `401` / `403`: return `_Outcome(False, error_code="unauthorized" | "forbidden", ...)` (defensive handling in case a custom proxy or future endpoint requires auth).
      - Other non-200 / network errors: map via `_classify_exception` or `HTTP {status_code}`.
  - Persist `cached_models_json` via `ProbeService._run()` (`store.record_probe(...)`), which already deduplicates writes using `models_hash`.
- **Browser Probe ([`remoteProviderDriver.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/local/remoteProviderDriver.ts#L290-L563)):**
  - Add `opts.type === "nanogpt"` in `probeRemoteProvider()`:
    - Send `GET ${root}/models` with `bearerHeaders(cleanToken)` (if present) and 5 s timeout.
    - Note: if `opts.requireToken` is set for a saved browser-credentialed provider missing its key from `localStorage`, keep `browser_credential_missing` behavior consistent with `ProviderCard` / `ProvidersContext`, or probe `/models` cleanly during draft testing even before a key is entered—match the behavior defined in `ProviderEditor.tsx` / `ProvidersContext.tsx`.
- **Model Parsing ([`models.py`](file:///home/diegolima/Git/cybercantina/backend/app/providers/models.py#L36-L84) & `remoteProviderDriver.ts`):**
  - Parse OpenAI-style `{ "data": [{ "id": ... }] }` using [`parse_openai_models`](file:///home/diegolima/Git/cybercantina/backend/app/providers/models.py#L36-L47) (or a small helper parsing `context_length` and `family` from `id.split("/")[0]` if `?detailed=true` is used, matching OpenRouter's `"{ctx // 1000}k ctx"` metadata).
  - Detect embedding models via existing `EMBED_MODEL_KEYWORDS` (and/or `category` if detailed metadata is requested).

---

### FR-3: Chat Completions, Streaming & Reasoning Controls
**Requirement:** Route non-streaming (`complete`), structured JSON (`complete_structured`), and SSE streaming (`stream`) requests for `"nanogpt"` through `/chat/completions`.

- **Backend ([`llm_client.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/llm_client.py)):**
  - [`get_chat_completions_url`](file:///home/diegolima/Git/cybercantina/backend/app/engine/llm_client.py#L139-L142): treat `"nanogpt"` like `"openrouter"` and `"aihorde"` (`f"{target.root_url.rstrip('/')}/chat/completions"`).
  - [`build_call_target`](file:///home/diegolima/Git/cybercantina/backend/app/engine/llm_client.py#L172-L190): construct OpenAI headers (`Authorization: Bearer {token}`, `Content-Type: application/json`, and optional `HTTP-Referer` / `X-Title` headers).
  - `complete()` and `stream()`:
    - Skip the native Ollama `/api/chat` block when `target.provider_type in ("openrouter", "aihorde", "nanogpt")`.
    - Pass `"response_format": {"type": "json_object"}` when `json_mode or json_schema is not None`.
    - For `disable_reasoning` (Clerk / structured extraction passes): reuse the `"openrouter"` `reasoning: {"effort": "none"}` + `400` retry (`{"exclude": True}`, then omit `reasoning`) so reasoning models on NanoGPT do not fail or exhaust `max_tokens` on hidden CoT, while safely falling back if a specific backend rejects the `reasoning` parameter.
- **Browser Driver ([`remoteProviderDriver.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/local/remoteProviderDriver.ts#L683-L901)):**
  - Accept `"nanogpt"` in `runRemoteProviderChat()`.
  - Require a non-empty browser-stored token (`browser_credential_missing` if absent).
  - Route to `${root}/chat/completions` with `Bearer` auth, `response_format` when `json_mode` / `json_schema` is set, and the same `disable_reasoning` retry fallback as `"openrouter"`.

---

### FR-4: Embeddings Support
**Requirement:** Allow `"nanogpt"` to be selected as a system embedding provider when `embedding_profile.mode == "openai_compat"`.

- In [`embed_text`](file:///home/diegolima/Git/cybercantina/backend/app/db/vector_math.py#L279-L290): include `"nanogpt"` in `is_remote_v1` so embedding requests skip `/api/embed` and `POST` directly to `f"{v1_url}/embeddings"`.

---

### FR-5: Frontend Provider Editor, Card & Model Picker UX
**Requirement:** Expose `"nanogpt"` cleanly in provider management and model selection UIs.

- **[`ProviderEditor.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/providers/ProviderEditor.tsx):**
  - Add `"nano-gpt.com"` and `"api.nano-gpt.com"` to `PRESET_CLOUD_HOSTS`.
  - Add a **NanoGPT (Cloud API)** button in `.provider-type-grid`.
  - Set default name (`"NanoGPT"`) and default URL (`"https://nano-gpt.com/api/v1"`).
  - Label token input `"NanoGPT API Key"` and require a key (or reuse existing saved token) when saving—matching `"openrouter"` validation—while allowing `"Store in Browser only"` for `scope === "user"`.
  - Update `testResult` / helper text if helpful so users aren't misled into thinking a green probe validates their API key.
- **[`ProviderCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/providers/ProviderCard.tsx#L45-L46):**
  - Include `"nanogpt"` in `requiresKey` so a browser-credentialed NanoGPT provider without a local key displays **`Key missing in this browser`**.
- **[`ModelPicker.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/models/ModelPicker.tsx#L67-L71):**
  - Enable `isCombobox` for `selected?.type === "nanogpt"` (same filter-as-you-type suggestions UX as `"openrouter"`), allowing users to select from cached models or type any NanoGPT model ID / routing suffix (e.g., `:fast`, `:cheap`, `:caching`, `:reasoning`).

---

### FR-6: User-Facing Wiki Documentation (`cybercantina-wiki`)
**Requirement:** Document NanoGPT setup and explicitly call out the reachability-only probe limitation in user-facing wiki pages.

- Update [`Providers-Models-and-Embeddings.md`](file:///home/diegolima/Git/cybercantina-wiki/Providers-Models-and-Embeddings.md) (and cross-link or update cloud provider documentation as appropriate) to list **`nanogpt`** alongside `openrouter` and `aihorde`:
  - Default endpoint (`https://nano-gpt.com/api/v1`, also compatible with `https://api.nano-gpt.com/api/v1`).
  - Support for both server-stored and browser-stored (`Store in Browser only`) personal credentials.
  - Model routing suffix examples (`:fast`, `:cheap`, `:caching`, etc.) and Clerk/Actor pairing notes.
  - **Mandatory Callout Note:** Explicitly state that **Test Connection / Probe for NanoGPT validates reachability and downloads the public model catalog only—it does not authenticate or verify your API key** (because NanoGPT's `/api/v1/models` endpoint is publicly accessible without an API key). An invalid, expired, or unfunded API key will only fail with an authentication/billing error (`401`/`403`) when running an actual turn, wizard, or embedding request.

---

## 4. Out of Scope (Deferred)
The following items are intentionally excluded from `v0.18.0`:
1. **Authenticated Key / Balance Verification on Probe:** Probing a separate authenticated NanoGPT balance/account endpoint to verify API key validity during `Test connection`.
2. **NanoGPT-Specific Protocol Extensions:** Custom UI controls for `advisor` multi-model consultation, accountless `x-x402` pay-per-request headers, or per-model pricing display.
3. **First-Boot Auto-Seeding:** Pre-creating a NanoGPT provider on fresh startup.

---

## 5. Resolved Design Decisions

1. **Probe Scope (`FR-2`):** Validate reachability and fetch `/models` only; do not block probe on key verification. Document clearly in the wiki (`FR-6`).
2. **Default Base URL (`FR-1`):** Use `https://nano-gpt.com/api/v1` as the default (while allowing `https://api.nano-gpt.com/api/v1` or custom HTTPS endpoints via `base_url`), preserving `/api/v1` paths identically to OpenRouter.
3. **Browser-Stored Keys (`FR-2`, `FR-3`):** Full support enabled from day one, as live CORS preflight checks confirm `access-control-allow-origin: *` and `access-control-allow-headers: Authorization, Content-Type` on both `nano-gpt.com` and `api.nano-gpt.com`.
4. **Model Picker UX (`FR-5`):** Use the searchable combobox (`isCombobox`) rather than a raw `<select>`, matching OpenRouter for large model catalogs and suffix flexibility.

---

## 6. Verification & Acceptance Criteria

- **Backend Unit & Integration Tests (`backend/tests/`):**
  - `url_policy` tests: `normalize_base_url` preserves `/api/v1` for `"nanogpt"`, defaults empty URL to `https://nano-gpt.com/api/v1`, and enforces SSRF rules.
  - `probe` tests: `"nanogpt"` probes `GET .../models`, returns `reachable=True, protocol="openai_compat"` with parsed models (even without an `/auth/key` endpoint), and maps `401`/`403`/`bad_payload`/timeouts cleanly.
  - `llm_client` & `vector_math` tests: `complete`, `complete_structured`, `stream` (including `disable_reasoning` fallback), and `embed_text` hit `/api/v1/chat/completions` and `/api/v1/embeddings` directly without hitting `/api/tags`, `/api/chat`, or `/api/embed`.
  - `providers` router & `provider_store` tests: create/update/purge-credentials lifecycle for `"nanogpt"` under both `server` and `browser` credential storage modes.
- **Frontend Tests (`frontend/src/`):**
  - `remoteProviderDriver` tests: `normalizeRemoteBaseUrl`, `probeRemoteProvider`, and `runRemoteProviderChat` (streaming + non-streaming + `disable_reasoning` retry + missing credential guard) for `"nanogpt"`.
  - UI tests: `ProviderEditor`, `ProviderCard`, and `ModelPicker` render `"nanogpt"` controls, require API key on save, flag `Key missing in this browser`, and use combobox filtering.
- **Repository Quality Gates:**
  - `cd backend && .venv/bin/ruff check app tests && .venv/bin/tach check` and `backend/.venv/bin/pytest backend/tests`
  - `npm --prefix frontend run arch:check && npm --prefix frontend run build && npm --prefix frontend test`
  - `backend/.venv/bin/python scripts/generate_arch_docs.py --check`
