---
feature: gm-codex-authoring-and-tools
target_version: 0.33.0
document_type: plan
status: completed
last_updated: 2026-11-23
---

# Implementation Plan — v0.33.0 GM-Assisted World Codex Authoring (Phase 1)

## Stage 0: Feature Package Lifecycle Artifacts
- [x] Author `FRD.md`
- [x] Author `REVIEW.md`
- [x] Author `PLAN.md`

## Stage 1: Backend Schema, Prompts & Persistence
- [x] Add `GmCodexProposal`, `GmWorldLoreDraftLLMOutput`, `GmCodexDuplicateMatch`, request/response DTOs, and `proposals` field on `GmChatMessage` in `backend/app/schemas/gm.py`
- [x] Register `PROMPT_KEY_GM_CODEX_DRAFT` (`gm_codex_draft`) in `backend/app/prompts/defaults.py` and `backend/app/prompts/__init__.py`
- [x] Add `proposals_json` column + idempotent migration in `backend/app/db/schema.sql` and `backend/app/db/repos/schema_init.py`
- [x] Extend `GmChatMixin` (`backend/app/db/repos/gm_chat.py`) to store, attach, and update `proposals_json`
- [x] Update `.zcc` v2 export/import (`backend/app/services/zcc_campaign_io.py`) to round-trip and remap `proposals_json`
- [x] Add branch-safe single-entry `aupsert_campaign_world_lore_entry` to `backend/app/db/repos/campaign_lore_items.py` with base-world GM Mode guard

## Stage 2: Backend GM Codex Drafting Engine & API Routes
- [x] Create `backend/app/engine/gm_codex.py` (`detect_explicit_codex_add_intent`, `find_world_codex_duplicates`, `build_offline_codex_draft`, `draft_world_codex_proposal`) and update `backend/tach.toml`
- [x] Add `CampaignWorldLoreEntryUpsertRequest` / `CampaignWorldLoreEntryUpsertResponse` in `backend/app/routers/campaign_routes/schemas_and_gate.py`
- [x] Add `codex_proposal` SSE emission, `POST /gm/codex-draft`, and `PATCH /gm/proposals/{proposal_id}` in `backend/app/routers/campaign_routes/gm_routes.py`
- [x] Add `POST /api/campaigns/{campaign_id}/lore/entries` in `backend/app/routers/campaign_routes/spatial_routes.py` and facade re-exports in `backend/app/routers/campaigns.py`

## Stage 3: Frontend Types, API, Confirmation Card & App Wiring
- [x] Extend `frontend/src/types/gm.ts` and `frontend/src/api/gm.ts` for `GmCodexProposal`, `codex_proposal` SSE, draft, upsert, and cancel calls
- [x] Register `gm_codex_draft` in `frontend/src/components/prompts/promptRoleDefinitions.ts` and update its test
- [x] Create `frontend/src/components/chat/GmCodexProposalCard.tsx` (editable title/category/`TagChipsInput`/content, duplicate warning + replace toggle, deterministic Confirm & Save / Cancel)
- [x] Wire `draftCodexEntry`, `confirmCodexProposal`, `cancelCodexProposal`, `onDraftCodexEntry`, `onCampaignBundleChange`, and `onOpenCodex` through `useGmTalk.ts`, `GmTalkDrawer.tsx`, `ChatStage.tsx`, and `App.tsx` (plus live `codexCount` on `AppSidebar`)
- [x] Add modular styles in `frontend/src/styles/05-composer-and-slash.css` and `frontend/src/styles/15-responsive.css`

## Stage 4: Verification, Architecture Docs & Wiki
- [x] Add `backend/tests/test_gm_codex_authoring.py` and run `ruff check`, `tach check`, `pytest`
- [x] Add frontend unit/markup tests in `frontend/src/components/__tests__/gmTalkUi.test.tsx` and run `arch:check`, `css:audit`, `build`, `test`
- [x] Regenerate and `--check` architecture docs (`scripts/generate_arch_docs.py`)
- [x] Update user-facing guides in `../cybercantina-wiki`
- [x] Finalize Phase 1 statuses in `FRD.md`, `PLAN.md`, and create `walkthrough.md`
