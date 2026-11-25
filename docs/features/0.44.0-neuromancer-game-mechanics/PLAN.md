---
feature: neuromancer-game-mechanics
target_version: 0.44.0
document_type: plan
status: completed
last_updated: 2026-11-26
---

# Implementation Plan — v0.44.0 Neuromancer Game Mechanics Access

## Step 1: Feature Spec Package
- [x] Author `FRD.md` (`docs/features/0.44.0-neuromancer-game-mechanics/FRD.md`)
- [x] Author `REVIEW.md` (`docs/features/0.44.0-neuromancer-game-mechanics/REVIEW.md`)
- [x] Author `PLAN.md` (`docs/features/0.44.0-neuromancer-game-mechanics/PLAN.md`)

## Step 2: Canonical JSON Exporter, `mechanicsCatalog.ts` Sync & CI Check
- [x] Update `gm-neuromancer` article in `frontend/src/components/world/mechanics/mechanicsCatalog.ts` for `@mechanics` & `lookup_game_rules`
- [x] Create `frontend/scripts/export-mechanics-catalog.mjs` (`--check` support, Vite-bundled `esbuild`, deterministic JSON output)
- [x] Add `mechanics:export` and `mechanics:check` scripts to `frontend/package.json`
- [x] Enforce `npm --prefix frontend run mechanics:check` in `.github/workflows/ci.yml`
- [x] Add `[tool.setuptools.package-data]` (`"app" = ["reference/*.json"]`) to `backend/pyproject.toml`
- [x] Generate and verify `backend/app/reference/game_mechanics_catalog.json`

## Step 3: Backend Pure Game Mechanics Module & Boundary Config
- [x] Create `backend/app/engine/game_mechanics.py` (catalog loader, inline boundary matcher, deterministic scorer, prompt/tool formatters)
- [x] Register `app.engine.game_mechanics` in `backend/tach.toml` (`depends_on = []`) and add to `app.engine.gm_talk` and `app.engine.gm_tools`

## Step 4: Backend Schemas, Mention Search, Context Builder & Carryover
- [x] Extend `GmMentionKind` (`"mechanic"`) and `GmMentionCategory` (`"mechanics"`) in `backend/app/schemas/gm.py`
- [x] Update `search_gm_mentions`, `GmPreparedContext`, `_has_recent_mechanic_carryover`, `build_gm_context_and_messages`, and `apply_non_tool_mechanics_fallback` in `backend/app/engine/gm_talk.py`

## Step 5: `lookup_game_rules` Tool & Route Wiring
- [x] Add `GM_MECHANICS_TOOL_DEFINITION` (`lookup_game_rules`), `GM_TOOLS_MECHANICS_ADDENDUM`, status label, execution handler, synthesis budget tuning, and conditional tool passing in `backend/app/engine/gm_tools.py`
- [x] Wire `gm_tools_enabled` and `apply_non_tool_mechanics_fallback` on `ToolsUnsupportedError` / offline fallback in `backend/app/routers/campaign_routes/gm_routes.py`

## Step 6: Frontend Mentions, Popover, Clickable Source Chips & CSS
- [x] Extend `GmMentionKind` and `GmMentionCategory` in `frontend/src/types/gm.ts`
- [x] Add `"mechanics"` category & prefix regexes in `frontend/src/utils/gmMentions.ts`
- [x] Add `Compass` icon mapping for `"mechanics"` in `frontend/src/components/chat/GmMentionPopover.tsx`
- [x] Increase `@mechanics:` mention search limit to `30` in `frontend/src/hooks/useGmTalk.ts`
- [x] Render clickable `mechanic` source chips via `onOpenMechanicsHelp` in `frontend/src/components/chat/GmTalkDrawer.tsx`
- [x] Style `.gm-source-chip--interactive` using existing cyan tokens in `frontend/src/styles/05-composer-and-slash.css`

## Step 7: Tests (Backend & Frontend)
- [x] Create `backend/tests/test_gm_mechanics.py` covering catalog integrity, inline triggers, deterministic scorer, scoped mention search, strict gating, `lookup_game_rules`, `ToolsUnsupportedError` fallback, sticky 1-turn carryover, and `.zcc` non-contamination
- [x] Update `frontend/src/utils/__tests__/gmMentions.test.ts` and `frontend/src/components/__tests__/gmTalkUi.test.tsx`

## Step 8: User-Facing Wiki Updates
- [x] Update `../cybercantina-wiki/Playing-Directing-and-Mechanics.md` and `../cybercantina-wiki/Providers-Models-and-Embeddings.md`

## Step 9: Regenerate Docs, Finalize Spec & Full Verification
- [x] Re-run `mechanics:export`, `mechanics:check`, and `scripts/generate_arch_docs.py --check`
- [x] Mark feature spec docs `completed` with checked boxes
- [x] Run full backend (`ruff`, `tach`, `pytest`) and frontend (`mechanics:check`, `arch:check`, `css:audit`, `build`, `test`) suites
