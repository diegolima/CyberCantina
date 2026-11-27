---
feature: security-alerts-triage
target_version: 0.52.4
document_type: plan
status: completed
last_updated: 2026-11-27
---

# Implementation Plan — CodeQL & Dependabot Security Alerts Triage

## Step 1: Feature Spec Package
- [x] Create isolated worktree `.worktrees/security-alerts-triage` on branch `fix/security-alerts-triage`
- [x] Author `FRD.md` (`docs/features/TBD-security-alerts-triage/FRD.md`)
- [x] Author `REVIEW.md` (`docs/features/TBD-security-alerts-triage/REVIEW.md`)
- [x] Author `PLAN.md` (`docs/features/TBD-security-alerts-triage/PLAN.md`)
- [x] Obtain explicit user approval before writing production code

## Step 2: Backend Security Fixes
- [x] Update `backend/app/routers/campaign_routes/turn_streaming.py`:
  - Replace `_search_slash_re` with linear-time `_parse_search_slash_command(message: str) -> tuple[bool, str | None]`
  - Update both call sites (lines 347 and 495) to use `_parse_search_slash_command`
- [x] Update `backend/app/engine/llm_client.py`:
  - Import `sanitize_log_value` from `app.security.log_sanitize`
  - Track `current_model = str(active_profile.model)` outside `active_payload` in `stream_chat` (`stream_chat_completion` equivalent), log `sanitize_log_value(current_model)` and `sanitize_log_value(fallback)`, update `current_model = fallback`, and pass `model_override=current_model` to `_record_llm_telemetry`
  - Apply `sanitize_log_value` to the sibling model-fallback warning log in `complete_chat`

## Step 3: Frontend Security & Dependency Fixes
- [x] Update `frontend/src/utils/navigationHistory.ts`:
  - Replace `Math.random()` fallback in `createNavSessionId()` with `crypto.getRandomValues(new Uint8Array(16))` hex formatting plus deterministic monotonic counter + timestamp Tier-3 fallback
- [x] Update `frontend/package.json` & `frontend/package-lock.json`:
  - Add scoped `"overrides": { "workbox-build": { "glob": "^14.0.6" } }` in `frontend/package.json` (preserving `vite-plugin-pwa@^2.0.0`)
  - Refresh `frontend/package-lock.json` (`npm --prefix frontend install --package-lock-only` + `npm --prefix frontend ci`)

## Step 4: Regression Tests
- [x] Add backend tests (`backend/tests/test_security_alerts_regression.py`):
  - Verify `_parse_search_slash_command` parity on `/search`, `/investigate`, `/inspect`, case-insensitivity, whitespace trimming, 240-char truncation, non-delimiter rejection (`/searchfoo`), and multiline rejection
  - Verify 50 KB adversarial ReDoS payload (`"/search" + " " * 50000 + "a\nb"`) completes in `< 50 ms`
  - Verify `stream_chat` fallback warning logs sanitized model names without leaking payload contents
- [x] Add frontend tests in `frontend/src/utils/__tests__/navigationHistory.test.ts`:
  - Verify `createNavSessionId()` across all three tiers (`crypto.randomUUID`, `crypto.getRandomValues`, and no-`crypto` deterministic counter fallback)

## Step 5: Verification Gates
- [x] Backend checks:
  - `cd backend && .venv/bin/ruff check app tests && .venv/bin/tach check && .venv/bin/pytest -p no:tach tests`
- [x] Frontend checks:
  - `npm --prefix frontend audit` (`0` vulnerabilities)
  - `npm --prefix frontend run arch:check && npm --prefix frontend run css:audit && npm --prefix frontend run build && npm --prefix frontend test`
  - Verify `frontend/dist/sw.js` contains precache entries and continues excluding `webgpu.worker-*.js`
- [x] Architecture docs check:
  - `backend/.venv/bin/python scripts/generate_arch_docs.py --check`
- [x] Local CodeQL CLI SARIF verification (per `github-security-triage` skill):
  - Build isolated `/tmp/codeql_src` copy from tracked/non-ignored worktree files
  - Run `python-security-extended.qls` and `javascript-security-extended.qls`
  - Confirm `0` alerts in `turn_streaming.py`, `llm_client.py`, and `navigationHistory.ts`
  - Clean up `/tmp/codeql_*`

## Step 6: Planned Wiki Updates
- **None required:** All changes are internal security hardening and dev-dependency hygiene with zero user-facing workflow, UI, or setup changes.
