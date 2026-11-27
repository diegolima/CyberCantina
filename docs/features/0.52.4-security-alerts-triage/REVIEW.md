---
feature: security-alerts-triage
target_version: 0.52.4
document_type: review
status: completed
last_updated: 2026-11-27
---

# Pre-Implementation Review — CodeQL & Dependabot Security Alerts Triage

## Architectural Risks & Mitigations

### 1. `/search` Slash-Command Edge-Case Parity
- **Trap:** Replacing `_search_slash_re = re.compile(r"^/(?:search|investigate|inspect)(?:\s+(.*))?$", re.IGNORECASE)` with naive `.startswith("/search")` logic could break subtle edge cases:
  - False-matching prefixes such as `"/searchlight"` or `"/inspector"`.
  - Matching multi-line RP messages starting with `"/search the desk\n..."`, whereas regex `.` without `re.DOTALL` previously rejected inputs containing `"\n"` (or `"\r"`).
  - Accepting `"\t"` or multiple spaces between `/search` and the focus argument, or treating `/search   ` (whitespace-only tail) as a non-empty focus.
- **Mitigation:** Implement `_parse_search_slash_command(message: str) -> tuple[bool, str | None]` to:
  1. Reject immediately if `not message` or `"\n" in message` or `"\r" in message`.
  2. Check lowercase prefixes `("/search", "/investigate", "/inspect")`, verify exact end-of-string or `message[len(prefix)].isspace()`, and return `(True, focus[:240])` with `focus = message[len(prefix):].strip() or None`.
  3. Add unit tests covering every boundary case plus a 50 KB adversarial ReDoS timing test (`< 5 ms`).

### 2. CodeQL Key-Insensitive Dictionary Taint on `active_payload`
- **Trap:** CodeQL's Python taint tracker treats dictionaries as coarse-grained containers: inserting `messages` (tainted via fictional `sex` fields in `zone1_static.py`) into `oai_payload` / `active_payload` causes `active_payload["model"]` to inherit taint even though the `"model"` key only holds a model ID string. If a refactored helper still reads `active_payload["model"]` or `active_payload.get("model")`, Alert #53 could persist.
- **Mitigation:** Track `current_model = str(active_profile.model)` in an independent scalar variable (mirroring `complete_chat` at `llm_client.py:991`, which CodeQL did not flag), only mutate `active_payload["model"] = fallback` alongside `current_model = fallback`, and pass `sanitize_log_value(...)` into `logger.warning(...)`. Verify locally with CodeQL CLI (`codeql/python-queries:codeql-suites/python-security-extended.qls`) on an isolated `/tmp/codeql_src` copy before committing.

### 3. `workbox-build@7.4.1` + `glob@14.0.6` / `minimatch@11.0.9` Compatibility
- **Trap:** `workbox-build@7.4.1` (`build/lib/get-file-details.js`) uses CommonJS `require("glob")` and invokes `globSync(globPattern, { cwd: globDirectory, follow: globFollow, ignore: globIgnores })`. Upgrading `glob` across majors (`11.x -> 14.0.6`) or `minimatch` (`10.x -> 11.0.9`) via `overrides` could fail if exports or Node engine requirements diverge.
- **Mitigation:**
  - Verified upstream metadata: `glob@14.0.6` provides CJS `require` exports (`./dist/commonjs/index.min.js`) with `engines.node: "18 || 20 || >=22"`, and `minimatch@11.0.9` provides CJS `require` exports with `engines.node: "20 || >=22"`. Both `frontend/Dockerfile` (`node:22-alpine`) and `.github/workflows/ci.yml` (`node-version: "22"`) run Node 22+.
  - After applying the override, run `npm --prefix frontend ci`, `npm --prefix frontend run build`, and inspect `frontend/dist/sw.js` to confirm precache manifest entries match expectations (and `webgpu.worker-*.js` remains excluded).

### 4. Scoped vs. Unscoped `overrides` Blast Radius
- **Trap:** Adding a top-level `"overrides": { "minimatch": "^11.0.9" }` in `frontend/package.json` would also overwrite `filelist@1.0.6 -> minimatch@5.1.9` (pulled via `@trickfilm400/rollup-plugin-off-main-thread@3.0.0-pre1 -> ejs@3.1.10 -> jake@10.9.4`), risking breaking major-version API changes in an unrelated branch that is not vulnerable (`< 7.0.0`).
- **Mitigation:** Scope the override strictly to `"workbox-build": { "glob": "^14.0.6" }` so `filelist@1.0.6` keeps `minimatch@5.1.9` untouched while `workbox-build` resolves `glob@14.0.6` and `minimatch@11.0.9`.

### 5. Plain HTTP LAN `crypto` Availability & Vitest Coverage
- **Trap:** Browsers running on plain HTTP LAN origins (e.g., `http://192.168.1.x`) expose `window.crypto.getRandomValues` but omit `crypto.randomUUID` (Secure Context only). Conversely, stripped-down SSR/test globals might lack `crypto` altogether.
- **Mitigation:** Keep `crypto.randomUUID()` as Tier 1, `crypto.getRandomValues(new Uint8Array(16))` formatted as hex as Tier 2, and a module-scoped monotonic counter + `Date.now().toString(36)` as Tier 3—eliminating `Math.random()` entirely. Cover all three tiers in `frontend/src/utils/__tests__/navigationHistory.test.ts` using `vi.stubGlobal("crypto", ...)` in Vitest.

### 6. Layer Boundaries & Architecture Docs
- **Check:** `backend/tach.toml` already includes `"app.security"` in `app.engine.llm_client.depends_on`. No new modules, routes, or database tables are added, and `scripts/generate_arch_docs.py --check` + `tach check` will verify compliance.
