---
feature: arc-objectives-cognition-recall
target_version: 0.54.0
document_type: plan
status: completed
last_updated: 2026-11-28
---

# Implementation Plan — Arc Objectives & Phase 3 Cognition Context Bridge

## Step 1: Worktree & Feature Spec Package
- [x] Create isolated worktree `.worktrees/arc-objectives-cognition-recall` on branch `feat/arc-objectives-cognition-recall`
- [x] Author `FRD.md` (`docs/features/TBD-arc-objectives-cognition-recall/FRD.md`)
- [x] Author `REVIEW.md` (`docs/features/TBD-arc-objectives-cognition-recall/REVIEW.md`)
- [x] Author `PLAN.md` (`docs/features/TBD-arc-objectives-cognition-recall/PLAN.md`)
- [x] Obtain explicit user approval before writing production code

## Step 2: Database Schema & Migration
- [x] Add `arc_objective_json TEXT NULL` to `character_states` in `backend/app/db/schema.sql`
- [x] Add idempotent `ALTER TABLE character_states ADD COLUMN arc_objective_json TEXT NULL` migration in `backend/app/db/repos/schema_init.py`

## Step 3: Backend Leaf Schemas, Config & Showcase Seed v4
- [x] Update `backend/app/schemas/character.py`:
  - Add `CharacterObjective` (`summary`, `deadline_cue`, `set_at_turn_depth`) with `sanitize_character_markup` validators
  - Add `default_objective: CharacterObjective | None = None` to `BaselinePsyche` (preserving clean sanitization and equality)
  - Add `arc_objective: CharacterObjective | None = None` to `CharacterStateSnapshot`
  - Extend `MemorySignificance` to include `"commitment"`
  - Add optional `default_objective_summary` / `default_objective_deadline_cue` to `CharacterWizardPass2LLMOutput` and `CharacterWizardLLMOutput` (mapped in `to_draft()`)
  - Add `ObjectiveOverrideRequest` (or place in `backend/app/schemas/turn.py` / `schemas_and_gate.py`)
- [x] Update `backend/app/schemas/turn.py`:
  - Add flat, GBNF-required fields on `CharacterAgentDelta`: `objective_action: Literal["keep", "set", "refine", "complete", "abandon"] = "keep"`, `objective_summary: str | None = None`, `objective_deadline_cue: str | None = None`
  - Add audit diff fields on `CharacterAgentDelta` (`previous_arc_objective`, `new_arc_objective`, `objective_disruption_triggered`) for `AgentChangesModal`
- [x] Raise default `recall_budget_cognition_tokens` from `220` → `450` in `backend/app/config.py`, `backend/app/dependencies.py`, and `backend/app/schemas/auth.py`
- [x] Update showcase character `backend/app/db/showcase_data/the_green_lie/character.json` with Yulia Halim's `baseline_psyche.default_objective`, and bump `SHOWCASE_CHARACTER_SEED_VERSION = 4` with changelog in `backend/app/db/seed_catalog.py`

## Step 4: Phase 3 Cognition Context Bridge & Smart Recall Packing
- [x] Update `pack_recalled_items_to_budget` (`backend/app/engine/context/zone2_episodic.py`) to support `prefer_short_first: bool = False`, and enable it in `select_cognition_recalled_items` (`backend/app/engine/cognition/heuristics.py`) so Rank 0 does not starve ranks #3–#5
- [x] Add pure epistemically-scoped context builders (in `backend/app/engine/context/zone2_episodic.py` or `backend/app/engine/cognition/heuristics.py`, re-exported cleanly via facades):
  - Witnessed Zone 2 1-line synopsis strip (`~350` token cap)
  - Witnessed compact Zone 3 working-memory tail (`~300` token cap, `filter_user_message_for_character` whisper-safe)
- [x] Update `run_character_cognition_agent` & `run_phase3_multi_cognition` (`backend/app/engine/cognition/runner.py`) to:
  - Inject `Current In-World Time`, always-on quiet 1-line `Arc Objective` (+ `deadline_cue` + subtle CARE temperament vigilance framing), witnessed Zone 2 synopsis strip, and compact Zone 3 tail
  - Preserve facade re-exports in `backend/app/engine/phase2_context.py` and `backend/app/engine/phase3_cognition.py`
- [x] Update `build_zone4_ephemeral_tail_frame` & `resolve_character_previous_state` (`backend/app/engine/context/zone4_ephemeral.py`) to:
  - Render compact 1-line `Arc Objective` per present character in Zone 4
  - Preserve `arc_objective` across narrator/arrival/solo state rewinds

## Step 5: Phase 5 Clerk Lifecycle, Disruption Triggers & `'commitment'` Memories
- [x] Update `DEFAULT_CHARACTER_POST_TURN_SYSTEM` (`backend/app/prompts/defaults.py`) with crisp `objective_action` anti-churn rules and `"commitment"` memory category instructions
- [x] Update `run_character_post_turn_agent` & `heuristic_character_agent_delta` (`backend/app/engine/char_agent/agent.py`) to surface current `arc_objective`, disruption status, and world time, and include `objective_*` in `required_properties`
- [x] Update `backend/app/engine/clerk/pipeline.py` to:
  - Detect per-character disruption triggers (`major_event` or severe CARE trauma/betrayal shock)
  - Enforce deterministic anti-churn guards (`set` only when empty or disrupted; `refine` preserves `set_at_turn_depth`; `complete`/`abandon` clears to `None`)
  - Bypass passive-bystander fast-path on `major_event` or severe shock in the active room, and carry `arc_objective` forward verbatim on normal fast-path turns
- [x] Update `backend/app/engine/clerk/memories.py` with `"commitment"` heuristic fallback patterns and deduplication support
- [x] Update `backend/app/db/repos/turns.py` and `backend/app/db/repos/campaigns.py` to read/write `arc_objective_json`, seed Turn 0 `arc_objective` from `default_objective`, and implement `override_campaign_character_objective`

## Step 6: Character Wizard, `.zcc` Import/Export, GM Mode Override Route & GM Talk
- [x] Update Character Wizard (`backend/app/prompts/defaults.py`, `backend/app/wizards/char_gen/draft_pipeline.py`, `backend/app/wizards/char_gen/inference.py`, and SillyTavern import distiller) to generate/preserve `default_objective`
- [x] Verify `.zcc` character and campaign export/import (`backend/app/services/import_export_service.py`, `backend/app/services/zcc_campaign_io.py`) round-trip `default_objective` and `arc_objective` cleanly without leaking into `unsupported_fields`
- [x] Add `POST /api/campaigns/{campaign_id}/characters/{character_id}/objective-override` in `backend/app/routers/campaign_routes/crud_and_state.py` (with request schema in `schemas_and_gate.py`)
- [x] Update `backend/app/engine/gm_talk.py` and `backend/app/engine/gm_tools.py` to surface `arc_objective` in character detail summaries and tool results

## Step 7: Frontend Types, API, UI & In-App Game Mechanics Codex
- [x] Update `frontend/src/types/character.ts` (`CharacterObjective`, `BaselinePsyche.default_objective`, `CharacterStateSnapshot.arc_objective`, `MemorySignificance`, `CharacterAgentDelta` objective fields) and `frontend/src/types/index.ts`
- [x] Add `overrideCampaignCharacterObjective` in `frontend/src/api/campaigns.ts`
- [x] Update `frontend/src/components/character/CharacterPersonalityTab.tsx` and `frontend/src/components/WizardModals.tsx` for optional `Default Arc Objective` & `Deadline Cue`
- [x] Update `frontend/src/components/world/codexCharacter/CampaignCharacterStateTab.tsx` to display `Arc Objective` (+ deadline badge) above `Active Scene Want`, with GM Mode Edit / Clear controls
- [x] Update `frontend/src/components/inspector/AgentChangesModal.tsx` to render `Arc Objective` transitions (`Set` / `Refined` / `Completed` / `Abandoned`)
- [x] Update frontend default `recall_budget_cognition_tokens` fallback (`220` → `450`) in `SettingsModal.tsx`, `AdminModelsTab.tsx`, `ProfilePreferencesTab.tsx`, and `utils/profilePreferences.ts`
- [x] Update `frontend/src/components/world/mechanics/mechanicsCatalog.ts` and `backend/app/reference/game_mechanics_catalog.json`

## Step 8: Tests & Full Verification Gate
- [x] Add/update backend tests:
  - `CharacterObjective` schema validation, `arc_objective_json` persistence & branching/undo isolation
  - Phase 3 Cognition context bridge (Zone 2 synopsis strip, Zone 3 tail, whisper/epistemic isolation, short-first recall packing, Turn 72 regression test)
  - Phase 5 Clerk anti-churn guards (`set`/`refine`/`complete`/`abandon`, major-event & trauma disruption wake-up, `"commitment"` memory extraction)
  - `POST .../objective-override` GM Mode endpoint, `.zcc` round-trip, GM Talk output, and Showcase Seed v4 update tests
- [x] Add/update frontend Vitest tests:
  - `CampaignCharacterStateTab` Arc Objective display & GM Mode Edit/Clear controls
  - `AgentChangesModal` Arc Objective transition diff rendering
  - `CharacterPersonalityTab` Default Arc Objective fields & updated `profilePreferences` / `codexGameMechanics` expectations
- [x] Run required checks inside `.worktrees/arc-objectives-cognition-recall`:
  - `cd backend && .venv/bin/ruff check app tests && .venv/bin/tach check`
  - `backend/.venv/bin/pytest backend/tests`
  - `npm --prefix frontend run arch:check && npm --prefix frontend run css:audit && npm --prefix frontend run build && npm --prefix frontend test`
  - `backend/.venv/bin/python scripts/generate_arch_docs.py && backend/.venv/bin/python scripts/generate_arch_docs.py --check`

## Step 9: Planned `../cybercantina-wiki` Updates (Applied at Merge Time)
- [x] `../cybercantina-wiki/Authoring-Worlds-Characters-and-Personas.md`: document optional `Default Arc Objective` and `Deadline Cue` fields on characters, how they seed Turn 0, and how `.zcc` exports preserve them.
- [x] `../cybercantina-wiki/Playing-Directing-and-Mechanics.md`: explain Arc Objectives vs. Scene Wants/Plans, how characters track commitments (`"commitment"` memories) without obsessing, and how major events/shocks pivot goals.
- [x] `../cybercantina-wiki/Live-Inspector-Map-and-Timeline.md`: document the Arc Objective card in the Campaign Character Codex, GM Mode Edit/Clear overrides, and Agent Changes Modal transition logs.
- [x] `../cybercantina-wiki/Context-Sizing-and-Performance.md`: document the updated `recall_budget_cognition_tokens` default (`450`), short-first recall packing, and Cognition's Zone 2 synopsis strip + Zone 3 tail.
- [x] `../cybercantina-wiki/Architecture-Turn-Pipeline.md`: document Phase 3 Cognition context inputs and Phase 5 objective transition guardrails.
- [x] `../cybercantina-wiki/Architecture-Context-Memory-and-State.md`: document `CharacterStateSnapshot.arc_objective`, `character_states.arc_objective_json` branch isolation, and `"commitment"` `MemorySignificance`.
- [x] `../cybercantina-wiki/Connecting-Cloud-Models-via-OpenRouter.md` & `../cybercantina-wiki/Providers-Models-and-Embeddings.md`: update `recall_budget_cognition_tokens` default table cells from `220` → `450`.
