---
feature: security-alerts-triage
target_version: 0.52.4
document_type: frd
status: completed
last_updated: 2026-11-27
---

# Feature Requirements Document — CodeQL & Dependabot Security Alerts Triage

## 1. Overview & Triage Summary

This document captures the triage of all **6 open GitHub security alerts** (5 CodeQL code-scanning alerts and 1 Dependabot alert) on `main`, along with **1 related `npm audit` advisory** in the same transitive frontend build chain.

| Alert | Rule / Advisory | Severity | Location / Package | Triage Verdict | Action |
|---|---|---|---|---|---|
| **CodeQL #56 & #57** | `py/polynomial-redos` | High | `backend/app/routers/campaign_routes/turn_streaming.py:345,347,495` | **Valid (True Positive)** | **Fix Required** (FR-1) |
| **Dependabot #16** (+ `npm audit` `glob`) | `GHSA-g3hv-75wg-m249` / `CVE-2026-118764` (`minimatch@10.2.6`, patched `11.0.1`); `GHSA-3g3m-2fjr-6pw4` (`glob@11.1.0`) | Medium / Moderate | `frontend/package-lock.json` (`vite-plugin-pwa@2.0.0 -> workbox-build@7.4.1 -> glob@11.1.0 -> minimatch@10.2.6`) | **Valid Upstream CVE, Low Runtime Exposure** (dev-only build tool on static globs) | **Fix Cleanly via Scoped Override** (FR-4) |
| **CodeQL #53** | `py/clear-text-logging-sensitive-data` | High | `backend/app/engine/llm_client.py:1629` (`stream_chat_completion`) | **False Positive** (key-insensitive dict taint from fictional character `sex` field onto `active_payload["model"]`) | **Hygiene Fix Recommended** (FR-2) |
| **CodeQL #54 & #55** | `js/insecure-randomness` | High | `frontend/src/utils/navigationHistory.ts:51 -> 55,138` (`createNavSessionId`) | **False Positive on Security Impact** (non-security tab-mount history tag), **Real Functional Gap on Plain HTTP LAN** (`crypto.randomUUID` unavailable) | **Hygiene Fix Recommended** (FR-3) |

### Detailed Triage Findings

1. **CodeQL #56 & #57 (`py/polynomial-redos` in `turn_streaming.py`) — Valid (True Positive)**
   - Line 345 defines `_search_slash_re = re.compile(r"^/(?:search|investigate|inspect)(?:\s+(.*))?$", re.IGNORECASE)` and matches it against user-controlled `effective_user_message` at lines 347 and 495.
   - Because `\s+` and `.*` overlap on whitespace and `.*` stops at `\n` (failing on multiline input without `re.DOTALL`), an input starting with `/search` followed by many spaces and a newline triggers $O(n^2)$ backtracking.
   - **Empirical verification:** Running `_search_slash_re.match("/search" + " " * 25000 + "a\nb")` on the backend Python runtime took `~1.94s` on a single request, blocking the async handler loop.

2. **Dependabot #16 (`minimatch@10.2.6`) & Related `npm audit` (`glob@11.1.0`) — Valid Upstream CVE, Dev-Only Exposure**
   - `frontend/package-lock.json` resolves `vite-plugin-pwa@2.0.0 -> workbox-build@7.4.1 -> glob@11.1.0 -> minimatch@10.2.6` (`>= 7.0.0, < 11.0.1`, vulnerable to `GHSA-g3hv-75wg-m249` / `CVE-2026-118764`, patched in `11.0.1`).
   - `npm --prefix frontend audit` also reports `glob@11.1.0` (`GHSA-3g3m-2fjr-6pw4`, `>=9.0.0 <=14.0.1`), propagating through `workbox-build` (`>=7.4.0`) and `vite-plugin-pwa` (`>=1.2.0`), and suggests `npm audit fix --force`, which would downgrade `vite-plugin-pwa` from `2.0.0` to `1.1.0`.
   - **Exposure assessment:** `workbox-build` runs strictly at Vite build time (`node:22-alpine` builder stage in `frontend/Dockerfile`) over hardcoded static `globPatterns` and `globIgnores` in `frontend/vite.config.ts`. Neither `glob` nor `minimatch` ships in the `nginx` runtime image or browser bundle.
   - Note that a separate transitive branch (`@trickfilm400/rollup-plugin-off-main-thread@3.0.0-pre1 -> ejs@3.1.10 -> jake@10.9.4 -> filelist@1.0.6 -> minimatch@5.1.9`) uses `minimatch@5.1.9`, which is outside the `>= 7.0.0, < 11.0.1` vulnerable range and relies on v5 API semantics, so any npm override must be scoped strictly to `workbox-build` rather than applied globally.

3. **CodeQL #53 (`py/clear-text-logging-sensitive-data` in `llm_client.py`) — False Positive**
   - Line 1629 logs `active_payload["model"]` (an LLM model identifier string) when a streaming provider falls back to another model.
   - CodeQL's taint tracker marks fictional RPG attributes `persona_snapshot.sex` (`backend/app/engine/context/zone1_static.py:122`) and `c.sex` (`zone1_static.py:223`) as sensitive PII, propagates taint into `messages` -> `oai_payload` -> `active_payload`, and key-insensitively taints `active_payload["model"]`.
   - No PII or credentials are logged, so there is no real secret exposure. However, tracking `current_model` as a local `str` outside `active_payload` (matching `complete_chat` at line 991) and routing both `current_model` and `fallback` through `sanitize_log_value(...)` resolves Alert #53 without suppression comments and also hardens against CR/LF log injection from remote provider fallback responses.

4. **CodeQL #54 & #55 (`js/insecure-randomness` in `navigationHistory.ts`) — False Positive on Security Impact**
   - `createNavSessionId()` (`frontend/src/utils/navigationHistory.ts:47-52`) falls back to `Math.random().toString(36).slice(2, 10)` when `crypto.randomUUID` is unavailable, and flows into `buildHistoryNavState` (line 55) and `isStaleForwardOverlayState` (line 138).
   - `sessionId` is only a client-side `window.history.state` tab-mount identifier (`frontend/src/providers/NavigationHistoryContext.tsx:86`) used to detect stale browser Forward entries across tab reloads; it has no authentication, CSRF, or authorization role. CodeQL flags it because of the `sessionId` identifier name.
   - However, on plain HTTP LAN deployments (e.g., `http://192.168.x.x`), browsers restrict `crypto.randomUUID()` to Secure Contexts, so the `Math.random()` fallback actually executes in real usage. Switching the fallback to `crypto.getRandomValues(new Uint8Array(16))` (supported on both plain HTTP and HTTPS browsers, plus Node 20+) with a deterministic monotonic counter + timestamp last-resort fallback removes `Math.random()` entirely, closes #54 and #55 cleanly, and improves LAN tab uniqueness.

---

## 2. Functional Requirements

### FR-1: Linear-Time `/search` Slash-Command Parsing (Closes CodeQL #56 & #57)
1. Replace `_search_slash_re` in `backend/app/routers/campaign_routes/turn_streaming.py` with a deterministic $O(n)$ string parser helper `_parse_search_slash_command(message: str) -> tuple[bool, str | None]` (no backtracking regular expression).
2. **Exact Parsing Invariants:**
   - Reject any message containing `"\n"` or `"\r"` (`(False, None)`), preserving the single-line semantics of the prior `.*` match so multi-line RP prose starting with `/search ...` is not misclassified as a slash command.
   - Case-insensitively match leading prefixes `/search`, `/investigate`, or `/inspect` when followed either by end-of-string or a whitespace character (`ch.isspace()`).
   - Reject non-delimiter continuations (e.g., `"/searchfoo"` or `"/inspector"` -> `(False, None)`).
   - Trim trailing/leading whitespace from the remainder after the command; return `(True, focus[:240])` when non-empty or `(True, None)` when empty/whitespace-only.
3. Reuse `_parse_search_slash_command(effective_user_message)` at both call sites (lines 347 and 495) so no regex remains on `effective_user_message` for `/search` detection.
4. **Performance Guarantee:** Parsing a 50 KB adversarial payload (`"/search" + " " * 50000 + "a\nb"`) completes in `< 5 ms`.

### FR-2: Decoupled Model-ID Tracking & Log Sanitization in `llm_client.py` (Closes CodeQL #53)
1. In `stream_chat_completion` (`backend/app/engine/llm_client.py`):
   - Maintain `current_model = str(active_profile.model)` outside `active_payload`.
   - Pass `current_model` (instead of `str(active_payload["model"])`) to `adapter.resolve_model_fallback(...)`.
   - When `fallback and fallback != current_model`, log `sanitize_log_value(current_model)` and `sanitize_log_value(fallback)` using `app.security.log_sanitize.sanitize_log_value`, then update both `active_payload["model"] = fallback` and `current_model = fallback`.
   - Pass `model_override=current_model` to `_record_llm_telemetry`.
2. Apply the same `sanitize_log_value(...)` hygiene to the sibling model-fallback warning log in `complete_chat` (`llm_client.py:991`).
3. Keep `backend/tach.toml` boundaries intact (`app.engine.llm_client` already declares `app.security`).

### FR-3: Web Crypto `getRandomValues` Fallback in `createNavSessionId` (Closes CodeQL #54 & #55)
1. Update `createNavSessionId()` in `frontend/src/utils/navigationHistory.ts` to use a 3-tier generator with zero `Math.random()` usage:
   - **Tier 1:** `crypto.randomUUID()` when `typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"`.
   - **Tier 2:** `crypto.getRandomValues(new Uint8Array(16))` formatted as `ccnav_<32-hex-chars>` when `typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function"` (works in plain HTTP LAN browsers and Node).
   - **Tier 3:** Deterministic monotonic counter + base-36 timestamp (`ccnav_${Date.now().toString(36)}_${++navSessionSeq}`) strictly when Web Crypto is unavailable.
2. Preserve `HistoryNavState`, `parseHistoryNavState`, `buildHistoryNavState`, and `isStaleForwardOverlayState` signatures and state formats unchanged.

### FR-4: Scoped `workbox-build` Dependency Override for `glob` & `minimatch` (Closes Dependabot #16 + `npm audit` `glob` Advisory)
1. Add a scoped `overrides` block in `frontend/package.json` targeting only `workbox-build`'s `glob` dependency:
   ```json
   "overrides": {
     "workbox-build": {
       "glob": "^14.0.6"
     }
   }
   ```
   (`glob@14.0.6` depends on `minimatch@^11.0.5`, resolving `minimatch@11.0.9` without touching `filelist@1.0.6 -> minimatch@5.1.9`).
2. Regenerate `frontend/package-lock.json` via `npm --prefix frontend install --package-lock-only` and verify clean installation with `npm --prefix frontend ci`.
3. Keep `vite-plugin-pwa@^2.0.0` intact (do **not** run `npm audit fix --force` or downgrade to `1.1.0`).
4. Verify `npm --prefix frontend audit` reports `0` vulnerabilities, `npm --prefix frontend run build` succeeds on Node 22+, and `frontend/dist/sw.js` contains the expected precache manifest honoring `globPatterns` and `globIgnores`.
5. **Fallback Clause:** If `glob@14.0.6` exhibits any runtime incompatibility with `workbox-build@7.4.1`, narrow the override to `"workbox-build": { "glob": { "minimatch": "^11.0.9" } }` (closing Dependabot #16 while leaving `glob@11.1.0`) or document risk acceptance for dev-only build tooling.

---

## 3. Non-Goals

- Changing `/search` gameplay behavior, cooldowns, or API contracts.
- Suppressing CodeQL alerts with inline ignore comments or weakening security queries.
- Downgrading `vite-plugin-pwa@2.0.0` or altering PWA service-worker caching semantics.
- Modifying unrelated anchored regexes in `turn_streaming.py` (`^\[introduce a complication:(.*)\]$`, `^\[perception check:(.*)\]$`), which do not contain overlapping quantifiers.
- Updating `../cybercantina-wiki` (no user-facing features, controls, or documented setup steps change).
