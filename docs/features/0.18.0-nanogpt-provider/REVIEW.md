---
feature: nanogpt-provider
target_version: 0.18.0
document_type: review
status: approved
last_updated: 2026-11-17
---

# Pre-Implementation Architectural Review
## NanoGPT Cloud Provider (`nanogpt`)

### Key Traps & Edge Cases Identified

1. **`/api/v1` Path Stripping Trap in Generic `"ollama"` Logic:**
   - [`get_ollama_root_url`](file:///home/diegolima/Git/cybercantina/backend/app/engine/llm_client.py#L77-L84) and [`normalizeRemoteBaseUrl`](file:///home/diegolima/Git/cybercantina/frontend/src/local/remoteProviderDriver.ts#L145-L151) strip trailing `/v1` and `/api` segments.
   - Because NanoGPT's OpenAI-compatible root path is `/api/v1` (`https://nano-gpt.com/api/v1`), `"nanogpt"` must follow the `"openrouter"` URL normalization branch (preserving `/api/v1` and defaulting empty path to `/api/v1`).
2. **Split Chat vs. Embedding Model Catalogs:**
   - Live check against `https://api.nano-gpt.com/api/v1/models` returned 631 chat models and **0** embedding models; NanoGPT serves its 17 embedding models at `GET /api/v1/embedding-models` (`{"object": "list", "data": [...]}`).
   - Probing `/models` (~59 KB) plus best-effort `/embedding-models` merges both into `cached_models` without pulling the ~761 KB `?detailed=true` payload.
3. **Reachability-Only Probe vs. Key Requirement on Save:**
   - `GET /api/v1/models` returns `HTTP 200` without authentication. Probes must validate reachability only (not fail when `token` is absent during draft/reachability probing), while `ProviderEditor` / `create_provider` still require an API key to save and `runRemoteProviderChat` / `llm_client` send it on inference.
   - Wiki docs must explicitly call this out so users know `401`/`403` key errors appear at inference/embedding time.
4. **Actor Context Ceiling & Reasoning Fallback:**
   - [`resolve_actor_context_ceiling`](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/lore_scope.py#L64-L80) must include `"nanogpt"` alongside `("openrouter", "aihorde")` so server-managed context is not locally clamped.
   - `disable_reasoning` retries (`reasoning: {"effort": "none"}` -> `{"exclude": True}` -> omitted) should be shared between `"openrouter"` and `"nanogpt"` without duplicating code.
5. **Browser-Stored Credentials & CORS:**
   - Verified `OPTIONS` and `GET` preflights on both `nano-gpt.com/api/v1/*` and `api.nano-gpt.com/api/v1/*` return `access-control-allow-origin: *` and `access-control-allow-headers: Authorization, Content-Type`.
