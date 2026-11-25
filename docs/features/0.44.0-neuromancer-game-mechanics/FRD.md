---
feature: neuromancer-game-mechanics
target_version: 0.44.0
document_type: frd
status: completed
last_updated: 2026-11-26
---

# Feature Requirements Document — v0.44.0 Neuromancer Game Mechanics Access (`@mechanics` + `lookup_game_rules`)

## 1. Overview & Motivation

CyberCantina's out-of-character GM assistant (**Neuromancer**) already answers campaign-specific questions using branch-safe recent turns, `@` entity pins (`@characters:`, `@lore:`, `@locations:`, `@containers:`, `@turns:`), hybrid RAG, and optional read-only campaign lookup tools. Meanwhile, `Codex → Game Mechanics` (`v0.40.0` + `v0.41.0`) houses **24** structured reference articles across **7** subcategories documenting CARE psychology, d20 modes/outcome tiers, `/choice`, whispers, parties, travel math, 3-tier memory, Context Health, timelines, and GM Mode.

Currently, Neuromancer has no visibility into those game mechanics—so players asking how composure decay, d20 margins, travel speed modifiers, or Context Health zones work cannot get grounded answers from Neuromancer without risking hallucinated rules or confusing app mechanics with in-world lore.

This feature gives Neuromancer **strictly opt-in, zero-contamination visibility** into the Game Mechanics reference catalog via `@mechanics` mentions, a deterministic matcher fallback, and a single-round `lookup_game_rules` tool.

---

## 2. Agreed Product Decisions

### 2.1 Single Canonical Source & Zero-Contamination Invariant
- `frontend/src/components/world/mechanics/mechanicsCatalog.ts` remains the **single canonical source** (preserving its live typed TypeScript constant imports).
- A zero-dependency Node exporter (`frontend/scripts/export-mechanics-catalog.mjs` using `esbuild` bundled with Vite) emits a lean, deterministic JSON artifact to `backend/app/reference/game_mechanics_catalog.json`, enforced in CI via `npm --prefix frontend run mechanics:check`.
- The backend loads `game_mechanics_catalog.json` once via `@functools.lru_cache` in `backend/app/engine/game_mechanics.py`.
- Game mechanics data must **never** be inserted into SQLite tables (`lore_nodes`, etc.), indexed into `vector_entries`, counted in World Codex totals, passed into `gm_codex` entry proposals, or exported into `.zcc` world/campaign archives.

### 2.2 Strict `@mechanics` Opt-In Gating + Sticky 1-Turn Carryover
- **Off by default on normal turns:** When the user does not reference `@mechanic` / `@mechanics` (or pin a `@mechanics:<article>` chip) and has no active 1-turn carryover, `<game_mechanics>` is omitted from Neuromancer's system prompt and `lookup_game_rules` is excluded from active tool definitions—preserving zero token overhead and zero confusion with `<world>` rules or `<retrieved_lore>`.
- **Explicit trigger:** Mechanics access activates when any of the following holds:
  1. A pinned mention with `kind == "mechanic"` targeting a specific article ID.
  2. A pinned umbrella mention `kind == "mechanic"` with `id == "__all__"` (`@Mechanics`).
  3. An inline `@mechanic` or `@mechanics` word-boundary token in `user_message` (works both in the GM Talk composer and via `/gm @mechanics ...`).
- **Sticky 1-turn carryover:** If the immediately preceding assistant message in the branch's GM history cited at least one `GmSourceRef(kind="mechanic", ...)`, mechanics access remains active for **1 follow-up turn** so natural follow-up questions (*"And what about trust?"*) work seamlessly without retyping `@mechanics`. If the player pivots back to a campaign question and the reply cites no `mechanic` source, carryover expires automatically on the following turn.

### 2.3 Routing Between `<game_mechanics>` Pre-Injection & `lookup_game_rules`
- **Specific `@mechanics:<article>` pins:** Always formatted directly into `<game_mechanics>` (0 tool rounds needed) and attributed via `GmSourceRef(kind="mechanic", id=article.id, label=article.title)`.
- **Tool-first when `gm_tools_enabled=True`:** Whenever mechanics access is active (pin, umbrella `@Mechanics` / inline `@mechanic(s)`, or 1-turn carryover), dynamically append `lookup_game_rules(query, limit)` to the turn's active tool list. When tools are active without specific pins, `<game_mechanics>` is **not** pre-injected up front so Neuromancer queries `lookup_game_rules(query)` on demand; if round 0 raises `ToolsUnsupportedError`, the route invokes `apply_non_tool_mechanics_fallback` before streaming Phase 1 so the player still gets a grounded rule answer.
- **Non-tool / fallback mode:** When `gm_tools_enabled=False` (or on `ToolsUnsupportedError` fallback), bare `@mechanics` runs the deterministic keyword/title/subcategory scorer in `game_mechanics.py` to inject the top 1–2 articles into `<game_mechanics>` (falling back to a compact 7-subcategory directory overview for generic explicit queries like `@mechanics what rules can you explain?`). On a non-tool sticky carryover turn, injection requires `score >= CARRYOVER_MATCH_MIN_SCORE` so pivoting back to campaign questions stays completely clean.
- **Single-round `lookup_game_rules` tool:** Deliberately avoids the word `"codex"` so smaller models never confuse it with `search_world_codex`. Returns matched article summaries, `scales`, `how_it_changes`, `effect_on_play`, and full `under_the_hood` constants in a single round instead of separate search + get calls.

### 2.4 Scoped `@` Mention Picker & Clickable Source Chips
- **6th category (`@mechanics:`):** Add `"mechanics"` (`@mechanics:`, `Compass` cyan icon) to `GM_MENTION_CATEGORIES` across backend (`GmMentionCategory = "mechanics"`, `GmMentionKind = "mechanic"`) and frontend (`GmMentionPopover`).
- **Scoped search:**
  - `@mechanics:<query>` lists the umbrella `@Mechanics` (`__all__`) candidate plus matching articles (all 24 when query is empty, ranked via `search_mechanics_articles` when filtering).
  - Bare `@<query>` live search **excludes** all 24 individual mechanics articles so queries like `@party`, `@trust`, `@map`, or `@memory` stay strictly campaign-entity focused; only prefix matches `len >= 4` of `"mechanics"` (e.g., `@mech`..`@mechanics`) surface the umbrella `@Mechanics` candidate.
- **Clickable `mechanic` source chips:** In `GmTalkDrawer.tsx`, `GmSourceRef` entries with `kind === "mechanic"` matching a valid `MechanicsTopicId` render as interactive `<button>` chips that invoke `onOpenMechanicsHelp(topicId)` to jump straight into `Codex → Game Mechanics`. Keep `GM_GREETING_MESSAGE` and drawer chrome clean with no extra banners.
