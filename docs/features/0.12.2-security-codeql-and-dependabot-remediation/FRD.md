---
feature: security-codeql-and-dependabot-remediation
target_version: 0.12.2
document_type: frd
status: completed
last_updated: 2026-11-16
---

# Feature Requirements Document (FRD)
## Security Remediation: Remote Provider Relay URL Validation, Admin Settings Error Hygiene & OpenTelemetry Dependency Patch

**Status:** Completed  
**Target Version:** CyberCantina v0.12.2  
**Scope:**
- Client-Direct Remote Provider Relay & Driver Hardening (`frontend/src/providers/LocalRelayContext.tsx`, `frontend/src/local/remoteProviderDriver.ts`)
- Admin Settings Conflict Response Hygiene (`backend/app/routers/settings.py`)
- Python Lockfile Dependency Security Patch (`backend/uv.lock` — `opentelemetry-api`)
- Automated Tests (`frontend/src/local/__tests__/browserCredentialVaultAndDriver.test.ts`, `backend/tests/test_browser_provider_credentials.py`)

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
CodeQL and Dependabot scans on `main` (following v0.12.0–v0.12.1) raised three sets of security and hygiene findings:

1. **CodeQL Alerts #45–#52 (`js/request-forgery`, Critical) in `frontend/src/local/remoteProviderDriver.ts`:**  
   - **Data flow:** WebSocket messages parsed in [`LocalRelayContext.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/providers/LocalRelayContext.tsx#L357-L370) pass `req.base_url` directly into [`probeRemoteProvider`](file:///home/diegolima/Git/cybercantina/frontend/src/local/remoteProviderDriver.ts#L190-L460), [`getAiHordeFallbackModel`](file:///home/diegolima/Git/cybercantina/frontend/src/local/remoteProviderDriver.ts#L561-L578), and [`runRemoteProviderChat`](file:///home/diegolima/Git/cybercantina/frontend/src/local/remoteProviderDriver.ts#L580-L798).
   - **Real defense-in-depth gaps:**
     1. [`normalizeRemoteBaseUrl`](file:///home/diegolima/Git/cybercantina/frontend/src/local/remoteProviderDriver.ts#L36-L54) performs only `.trim()` and `/v1`/`/api` suffix stripping with no `URL` parsing or validation. Pre-save *Test connection* calls from [`ProviderEditor.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/providers/ProviderEditor.tsx#L276-L284) (before backend `url_policy.py` checks run) and any unexpected inputs can pass non-HTTP(S) schemes, embedded credentials (`user:pass@`), query strings, fragments, path traversal segments, or link-local/metadata IP literals straight into `fetch(...)` alongside the user's `Authorization: Bearer` token.
     2. In [`LocalRelayContext.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/providers/LocalRelayContext.tsx#L225-L330), `handleLlmRequest` and `handleProbeRequest` look up the browser-stored credential by `req.provider_id` but read `base_url` from the WebSocket frame (`req.base_url`) rather than binding the request to the user's server-validated provider record from `/api/providers`.

2. **CodeQL Alert #44 (`py/stack-trace-exposure`, Medium) in `backend/app/routers/settings.py`:**  
   - [`update_settings`](file:///home/diegolima/Git/cybercantina/backend/app/routers/settings.py#L124-L135) catches [`CredentialPurgeRequiredError`](file:///home/diegolima/Git/cybercantina/backend/app/providers/settings_service.py#L19-L28) and returns `"message": str(exc)` inside the HTTP 409 `JSONResponse`. While non-exploitable (fixed integer template, admin-only endpoint), CodeQL flags `str(exc)` flowing into an HTTP response payload.

3. **Dependabot Alert #13 (`GHSA-mf5v-w3w3-f6cg` / `CVE-2026-126360`, Medium) in `backend/uv.lock`:**  
   - `opentelemetry-api` is pinned to `1.45.1` (transitive dependency of `fastapi 0.162.0`), which has a quadratic-time ReDoS vulnerability in `TraceContextTextMapPropagator.extract()` (patched in `1.45.2`). Although CyberCantina does not import or invoke `opentelemetry-api` directly, upgrading the lockfile eliminates the vulnerable version.

### 1.2 Proposed Solution
1. **Bind WebSocket Relay Targets to Registered Providers & Validate URLs in `remoteProviderDriver.ts`:**
   - In [`LocalRelayContext.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/providers/LocalRelayContext.tsx), resolve the target `base_url` for remote relay `llm.request` and `probe.request` frames from the authenticated `/api/providers` provider list (`allProvidersRef`, refreshing once if `provider_id` is not yet cached), verifying `provider.is_enabled`, `provider.type === req.driver`, and `provider.credential_storage === "browser"`. Never trust an unverified `req.base_url` from a WebSocket frame to receive a browser-stored Bearer token.
   - In [`remoteProviderDriver.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/local/remoteProviderDriver.ts), harden [`normalizeRemoteBaseUrl`](file:///home/diegolima/Git/cybercantina/frontend/src/local/remoteProviderDriver.ts#L36-L54) using `new URL(...)` to validate schemes (`https:` required for `openrouter`/`aihorde`, `http:`/`https:` for `ollama`), reject embedded credentials, queries, fragments, `.` / `..` path segments, invalid ports, and unspecified/link-local/cloud-metadata IP literals (`0.0.0.0`, `169.254.0.0/16`, `fe80::/10`, `::`), and reconstruct clean canonical URLs. Return structured `invalid_url` probe failures in `probeRemoteProvider` and throw `RemoteDriverError("invalid_url", ...)` in `runRemoteProviderChat` before calling `fetch`.
2. **Eliminate `str(exc)` from HTTP Response in `settings.py`:**
   - Construct the 409 conflict message directly from integer attributes `exc.affected_providers` and `exc.affected_users` in [`update_settings`](file:///home/diegolima/Git/cybercantina/backend/app/routers/settings.py#L124-L135).
3. **Upgrade `opentelemetry-api` in `backend/uv.lock`:**
   - Upgrade `opentelemetry-api` to `>=1.45.2` using `uv lock --upgrade-package opentelemetry-api` without altering unrelated packages.

---

## 2. Functional & Security Requirements

### FR-1: Relay Provider Binding (`LocalRelayContext.tsx`)
- For `llm.request` and `probe.request` with `driver` in `{"ollama", "openrouter", "aihorde"}`:
  - The relay must require `req.provider_id` and resolve the provider record from the user's `/api/providers` list (`allProvidersRef`, calling `api.listProviders()` once on cache miss).
  - If no matching enabled browser-credentialed provider (`provider.type === req.driver` and `provider.credential_storage === "browser"`) exists, the relay must fail the request (`llm.error` with code `"inference_failed"` or `probe.result` with `reachable: false`, `error_code: "invalid_url"`) without calling `fetch`.
  - The driver must receive `provider.base_url` from the `/api/providers` record rather than `req.base_url` from the WebSocket payload.

### FR-2: Strict URL Parsing & Normalization (`remoteProviderDriver.ts`)
- [`normalizeRemoteBaseUrl`](file:///home/diegolima/Git/cybercantina/frontend/src/local/remoteProviderDriver.ts#L36-L54) must:
  1. Default blank URLs to `https://openrouter.ai/api/v1` (for `openrouter`) and `https://oai.stablehorde.net/v1` (for `aihorde`), and throw `RemoteDriverError("invalid_url", "Server URL is required.")` when blank for `ollama`.
  2. Parse non-empty URLs with `new URL(...)`; throw `RemoteDriverError("invalid_url", ...)` on parse failure.
  3. Enforce `https:` for `openrouter` and `aihorde`, and `http:` or `https:` for `ollama`.
  4. Reject non-empty `username` or `password`, non-empty `search` or `hash`, invalid ports (outside `1..65535`), and `.` or `..` path segments.
  5. Reject unspecified, link-local, or cloud-metadata IP literals (`0.0.0.0`, `169.254.0.0/16`, `fe80::/10`, `::`).
  6. Normalize path suffixes consistently with [`normalize_base_url`](file:///home/diegolima/Git/cybercantina/backend/app/security/url_policy.py#L48-L94) (`/api/v1` default for `openrouter`, `/v1` suffix enforcement for `aihorde`, stripping trailing `/v1` or `/api` for `ollama`) and reconstruct the canonical URL from validated components.
- [`probeRemoteProvider`](file:///home/diegolima/Git/cybercantina/frontend/src/local/remoteProviderDriver.ts#L190-L460) must catch URL validation errors and return a `ProviderProbeResponse` with `reachable: false` and `error_code: "invalid_url"` without calling `fetch`.
- [`runRemoteProviderChat`](file:///home/diegolima/Git/cybercantina/frontend/src/local/remoteProviderDriver.ts#L580-L798) must reject invalid URLs with `RemoteDriverError("invalid_url", ...)` before calling `fetch`.

### FR-3: Admin Settings 409 Response Hygiene (`settings.py`)
- `PUT /api/settings` must format the `user_credentials_purge_required` message directly from `exc.affected_providers` and `exc.affected_users` (no `str(exc)` in the response payload) while preserving the exact HTTP `409` JSON schema (`detail.code`, `detail.message`, `detail.affected_providers`, `detail.affected_users`).

### FR-4: Lockfile Dependency Patch (`backend/uv.lock`)
- `opentelemetry-api` in `backend/uv.lock` must be upgraded to `>= 1.45.2`.

---

## 3. Non-Functional Requirements & Invariants

1. **Preserve Legitimate Remote Ollama & Custom OpenRouter URLs:**
   - Remote `ollama` providers with `credential_storage: "browser"` must continue supporting custom public/LAN HTTP(S) hostnames and ports (e.g., `https://ollama.example.com`, `http://192.168.1.50:11434`) as allowed by server policy.
   - `openrouter` must continue supporting custom HTTPS OpenRouter-compatible gateways if configured, while rejecting insecure `http://` or malformed URLs.
2. **Existing Error Codes & UI Contracts Preserved:**
   - `ProbeErrorCode` already includes `"invalid_url"` (`frontend/src/types/providers.ts`).
   - `RemoteDriverError.code` must accept `"invalid_url"`.
   - `ProviderEditor.tsx` pre-save *Test connection* must surface the validation error cleanly in the test result banner rather than crashing.
3. **Zero CodeQL / Dependency Violations:**
   - `frontend` must pass `arch:check`, `build`, `test`, and local CodeQL `javascript-security-extended` with 0 alerts in `remoteProviderDriver.ts` and `LocalRelayContext.tsx`.
   - `backend` must pass `ruff check`, `tach check`, `pytest`, and local CodeQL `python-security-extended` with 0 alerts in `settings.py`.

---

## 4. Verification Matrix

| Check | Command | Expected Result |
|---|---|---|
| Frontend unit tests | `npm --prefix frontend test` | All tests pass, including new invalid/unsafe URL & relay provider-binding coverage |
| Frontend arch & build | `npm --prefix frontend run arch:check && npm --prefix frontend run build` | 0 violations, clean `tsc && vite build` |
| Backend lint, tach, tests | `cd backend && .venv/bin/ruff check app tests && .venv/bin/tach check && .venv/bin/pytest tests` | All checks and tests pass |
| Architecture docs | `backend/.venv/bin/python scripts/generate_arch_docs.py --check` | Up to date |
| Local CodeQL JS & Python | `codeql database analyze ...` (`javascript-security-extended.qls`, `python-security-extended.qls`) | 0 alerts for `js/request-forgery` in `remoteProviderDriver.ts` and `py/stack-trace-exposure` in `settings.py` |
