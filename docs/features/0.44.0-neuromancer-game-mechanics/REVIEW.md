---
feature: neuromancer-game-mechanics
target_version: 0.44.0
document_type: review
status: completed
last_updated: 2026-11-26
---

# Pre-Implementation Review — v0.44.0 Neuromancer Game Mechanics Access

## Key Architectural Traps & Mitigations

### 1. Zero-Contamination Boundary (SQLite, Vector Store, World Codex, `.zcc`)
- **Trap:** Storing mechanics rules in `lore_nodes` or indexing them in `vector_store` would leak system documentation into campaign character prompts, World Codex entry counts, `Draft Codex` duplicate checks, and `.zcc` archives.
- **Mitigation:**
  - Package the exported JSON strictly as static app data at `backend/app/reference/game_mechanics_catalog.json` (bundled via `[tool.setuptools.package-data]` in `backend/pyproject.toml`).
  - Load exclusively through `backend/app/engine/game_mechanics.py` (which depends on nothing in `app.db`, `app.routers`, or `app.services`, enforced in `backend/tach.toml`).
  - Explicitly state in `<game_mechanics>` and `GM_TOOLS_MECHANICS_ADDENDUM` that Neuromancer must never confuse `<game_mechanics>` with `<world>` / `<retrieved_lore>` or pass system mechanics into `propose_world_lore_entry`.

### 2. ReDoS-Safe Inline `@mechanic` Boundary Matching
- **Trap:** Naive regexes or substring checks (`"@mechanic" in text.lower()`) either risk backtracking or falsely trigger on emails (`player@mechanics.org`) and substrings (`@mechanical_arm`).
- **Mitigation:** Use a single bounded character-class boundary regex:
  ```python
  _INLINE_MECHANIC_RE = re.compile(
      r"(?:^|[\s(\[\"'`])@mechanics?(?=$|[\s.,!?;:)\]'\"`])",
      re.IGNORECASE,
  )
  ```
  It has zero nested quantifiers, operates in linear time, matches `@mechanic` / `@mechanics` at line start, after whitespace, or after opening punctuation, and rejects mid-word `@` tokens and compound words like `@mechanical`.

### 3. Disambiguating `lookup_game_rules` from World Codex Tools
- **Trap:** Small local tool-calling models (e.g., 12B Qwen/Gemma/Llama models) frequently confuse tool names containing `"codex"` (`search_world_codex` vs. a mechanics tool containing `"codex"`), or waste rounds doing search-then-fetch.
- **Mitigation:**
  - Name the tool `lookup_game_rules(query, limit)` and avoid the word `"codex"` anywhere in its tool name or parameter schema.
  - Return the complete structured article fields (`in_one_line`, `scales`, `how_it_changes`, `effect_on_play`, `under_the_hood`, `related_topic_ids`) in a single round.
  - Omit `lookup_game_rules` entirely from `complete_with_tools(...)` whenever `prep.mechanics_active` is `False` so normal campaign queries cannot mis-route to game rules.

### 4. Synthesis Truncation on Fallback Stream (`_build_synthesis_messages`)
- **Trap:** `_build_synthesis_messages` in `backend/app/engine/gm_tools.py` currently truncates each tool output JSON at `750` chars and caps total trace chars at `4000`, which would clip `under_the_hood` constants off `lookup_game_rules` outputs during max-round fallback synthesis.
- **Mitigation:** Allow up to `1800` chars for `lookup_game_rules` outputs and raise `max_total_chars` to `5500`.

### 5. Non-Tool Fallback on `ToolsUnsupportedError` & Carryover Precision
- **Trap 1:** If a user enables `gm_tools_enabled=True` on a provider that raises `ToolsUnsupportedError` on round 0 (e.g., WebGPU or AI Horde), skipping pre-injection in `build_gm_context_and_messages` would leave Phase 1 `stream_chat` with empty `<game_mechanics>`.
- **Mitigation:** Set `prep.mechanics_needs_non_tool_fallback = True` whenever tools are enabled without pinned articles; inside `gm_routes.py`, call `apply_non_tool_mechanics_fallback(prep, req.message)` inside the `ToolsUnsupportedError` / offline-fallback handler before `run_phase1_flow = True` and merge the returned `GmSourceRef`s into `merged_sources`.
- **Trap 2:** On a 1-turn sticky carryover turn in non-tool mode, if the player pivots straight back to a campaign question (*"Where is Kira right now?"*), a `min_score = 1` match on an incidental word like `"location"` or `"now"` could inject an irrelevant mechanics block and perpetuate carryover.
- **Mitigation:** Require `score >= CARRYOVER_MATCH_MIN_SCORE` (`8`) when `mechanics_explicit` is `False` in non-tool/fallback mode so only clear follow-up rule terms inject mechanics and emit `mechanic` sources.

### 6. Mention Popover Truncation (`useGmTalk.ts`) & CSS Token Hygiene
- **Trap:** `useGmTalk.ts` currently requests `limit: 16` for all `searchGmMentions` calls, which would hide 9 of the 25 items (`@Mechanics` + 24 articles) when browsing `@mechanics:`.
- **Mitigation:** Pass `limit: 30` when `mentionTrigger.mode === "category" && mentionTrigger.category === "mechanics"`. In `05-composer-and-slash.css`, reuse existing tokens (`--cyan-fg-bright`, `--cyan-border-subtle`, `--cyan-bg-subtle`, `--cyan-border`) from `00-tokens.css` so `npm --prefix frontend run css:audit` passes cleanly.
