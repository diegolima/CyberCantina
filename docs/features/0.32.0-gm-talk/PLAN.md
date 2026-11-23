---
feature: gm-talk
target_version: 0.32.0
document_type: plan
status: completed
last_updated: 2026-11-23
---

# Implementation Plan — v0.32.0 GM Talk ("Neuromancer")

## Stage 0: Feature Package Lifecycle Artifacts
- [x] Author `FRD.md`
- [x] Author `REVIEW.md`
- [x] Author `PLAN.md`

## Stage 1: Backend Schema, Migrations & Repository Layer
- [x] Create leaf schema module `backend/app/schemas/gm.py`
- [x] Extend `AppSettings` (`backend/app/config.py`), `auth.py`, `import_export.py`
- [x] Update `backend/app/db/schema.sql` and `backend/app/db/repos/schema_init.py` (`user_model_settings` GM columns + `gm_chat_messages`)
- [x] Update `backend/app/db/repos/auth_users.py` to persist/load GM settings
- [x] Create `backend/app/db/repos/gm_chat.py` (`GmChatMixin`) and compose into `CantinaRepository`

## Stage 2: Effective Model Resolution, Prompts & GM Talk Engine
- [x] Update `EffectiveModels`, `resolve_effective_models`, and add `resolve_gm_profile` in `backend/app/dependencies.py`; expose in `backend/app/routers/settings.py`
- [x] Register `PROMPT_KEY_GM_TALK_SYSTEM` ("Neuromancer") in `backend/app/prompts/defaults.py` and `backend/app/prompts/__init__.py`
- [x] Create `backend/app/engine/gm_talk.py` (3-layer `unlock_lore` gating, mention search, hybrid RAG + `@` pins, ReDoS-safe reasoning filter, offline fallback) and add `app.engine.gm_talk` to `backend/tach.toml`

## Stage 3: Backend Campaign GM Routes & `.zcc` Export/Import
- [x] Create `backend/app/routers/campaign_routes/gm_routes.py` (`GET /gm/messages`, `DELETE /gm/messages`, `GET /gm/mentions`, `POST /gm/chat` SSE with Browser Ollama / WebGPU relay)
- [x] Mount & re-export GM routes in `backend/app/routers/campaign_routes/__init__.py` and `backend/app/routers/campaigns.py`
- [x] Wire `include_gm_chat` toggle (default `False`) through `backend/app/routers/import_export.py` and `backend/app/services/zcc_campaign_io.py` (export + import `anchor_turn_id` remap)

## Stage 4: Frontend Types, API Client & Pure Helpers
- [x] Create `frontend/src/types/gm.ts` and update `frontend/src/types/{index,auth,importExport,turn}.ts`
- [x] Create `frontend/src/api/gm.ts` and expose via `frontend/src/api/index.ts`
- [x] Create pure Node-testable helper `frontend/src/utils/gmMentions.ts`
- [x] Register `/gm` alphabetically in `frontend/src/utils/slashCommands.ts` and icon in `SlashCommandPicker.tsx`
- [x] Add `gm` card metadata and draft fields to `frontend/src/utils/profilePreferences.ts`

## Stage 5: Frontend UI Components & Modular CSS
- [x] Create `frontend/src/hooks/useGmTalk.ts` (isolated GM draft, branch-safe fetch, SSE stream, `@` mention state, minimize animation lifecycle)
- [x] Create `frontend/src/components/chat/GmMentionPopover.tsx` (Antigravity-style `Browse` → category/live search)
- [x] Create `frontend/src/components/chat/GmTalkDrawer.tsx` (~50% bottom-up slide-out covering the main chat feed with Neuromancer greeting, spoiler status pill, `Clear Chat`, expand/minimize controls, SSE stream)
- [x] Reuse `ChatComposer.tsx` in GM mode (switching footer actions to GM controls, swapping `@` mention picker/chips, preserving story draft) and wire `Talk to GM`, `/gm`, `GmTalkDrawer`, and click-outside minimize in `ChatStage.tsx`
- [x] Add 5th **`GM Talk`** card to `ProfileBehaviorCards.tsx` and wire in `ProfilePreferencesTab.tsx`
- [x] Add **`Include GM conversations`** toggle (off by default) to `ExportCampaignModal.tsx`
- [x] Add modular styles to `00-tokens.css`, `04-chat-and-turns.css`, `05-composer-and-slash.css`, and `15-responsive.css`

## Stage 6: Tests, Architecture Docs, Feature Trail & Wiki
- [x] Add `backend/tests/test_gm_talk.py` and run `ruff`, `tach check`, `pytest`
- [x] Add `frontend/src/utils/__tests__/gmMentions.test.ts` and `frontend/src/components/__tests__/gmTalkUi.test.tsx`; run `arch:check`, `css:audit`, `build`, `test`
- [x] Regenerate and `--check` architecture docs (`scripts/generate_arch_docs.py`)
- [x] Update user-facing guides in `../cybercantina-wiki`
- [x] Finalize `FRD.md` & `PLAN.md` statuses and create `walkthrough.md`
