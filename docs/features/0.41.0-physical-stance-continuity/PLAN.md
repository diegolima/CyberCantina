---
feature: physical-stance-continuity
target_version: 0.41.0
document_type: plan
status: completed
last_updated: 2026-11-25
---

# Implementation Plan — v0.41.0 Physical Stance & Motion Continuity Tracking

## Stage 0: Feature Package Lifecycle Artifacts
- [x] Author `FRD.md`
- [x] Author `REVIEW.md`
- [x] Author `PLAN.md`

## Stage 1: Leaf Schemas, Database Migrations, Persistence & `.zcc` Parity
- [x] Create leaf module `backend/app/schemas/physical.py`:
  - [x] Define `PhysicalStance` 10-value `Literal` (`unspecified`, `standing`, `sitting`, `leaning`, `crouching`, `kneeling`, `lying_down`, `moving`, `restrained`, `incapacitated`) and `PHYSICAL_STANCE_VALUES`.
  - [x] Implement `normalize_physical_stance(raw, *, fallback="unspecified")` synonym/alias mapper (handling `prone`, `supine`, `seated`, `walking`, `pinned`, `unconscious`, etc.).
  - [x] Implement `sanitize_physical_context(raw, *, max_length=120)` stripping CoT/HTML tags cleanly, collapsing whitespace/newlines, and truncating safely at word boundaries.
  - [x] Implement `resolve_post_turn_physical_state(...)` smart staleness reset helper (clearing stale context and resetting stance on location change or `>= 30` min skip *only if* Clerk left `(stance, context)` verbatim-unchanged, while always preserving `restrained` / `incapacitated`).
- [x] Update `backend/app/schemas/character.py`, `backend/app/schemas/persona.py`, and `backend/app/schemas/turn.py`:
  - [x] Add `physical_stance` and `physical_context` to `CharacterStateSnapshot`, `PersonaTurnStateSnapshot`, `CharacterAgentDelta` (with `required` schema properties preserved), and `WorldPostTurnDelta` (`player_physical_stance`, `player_physical_context`).
  - [x] Add audit/diff helper fields on `CharacterAgentDelta` / `PostTurnStateDelta` (e.g., previous vs. resolved player/character physical state & optional reset reason) for `AgentChangesModal` visibility.
  - [x] Add `current_persona_turn_state: PersonaTurnStateSnapshot | None = None` to `CampaignStateBundle`.
- [x] Update `backend/app/db/schema.sql` & `backend/app/db/repos/schema_init.py`:
  - [x] Add `physical_stance TEXT NOT NULL DEFAULT 'unspecified'` and `physical_context TEXT NOT NULL DEFAULT ''` to `character_states` and `persona_turn_states` with idempotent `PRAGMA table_info` `ALTER TABLE` guards.
- [x] Update repository persistence (`turns.py`, `personas.py`, `campaign_spatial.py`) & `turn_streaming.py`:
  - [x] Persist/load `physical_stance` and `physical_context` in `save_turn_node` (provisional, absent-NPC copy, and copied `persona_turn_states`), `update_turn_post_state`, `_populate_turn_character_states`, `get_campaign_persona_turn_state`, and `save_campaign_persona_turn_state`.
  - [x] Populate `CampaignStateBundle.current_persona_turn_state` in `get_campaign_state_bundle` (synthesizing a default snapshot when no row exists, even without a selected Persona).
  - [x] In `turn_streaming.py`, instantiate default `current_player_state` even when `persona_snapshot is None` and preserve parent physical state on provisional snapshots.
  - [x] Apply smart staleness reset in `override_campaign_location` and `override_character_location` (`campaign_spatial.py`).
- [x] Update `backend/app/services/zcc_campaign_io.py`:
  - [x] Export and import `physical_stance` and `physical_context` on both `character_states` and `persona_turn_states`, safely defaulting legacy archives.

## Stage 2: Forward Pipeline Integration (Zone 1, Phase 3 Cognition & Phase 4 Zone 4)
- [x] Update `backend/app/engine/context/zone1_static.py`:
  - [x] Relabel static `Posture:` to `Habitual Bearing:` in both `build_zone1_static_system_prompt` and `build_zone1_ensemble_system_prompt`.
- [x] Update `backend/app/engine/cognition/runner.py` & `backend/app/engine/context/assembler.py`:
  - [x] Pass `current_player_state` and co-present `all_character_states` into `run_character_cognition_agent` so Phase 3 Cognition sees starting physical states of self, co-present NPCs, and the Player (omitted silently when `unspecified` + empty).
  - [x] Relabel `prior_cues_section` `"Outward posture:"` to `"Outward manner:"`.
- [x] Update `backend/app/engine/context/zone4_ephemeral.py`:
  - [x] Inject `Starting Physical State: [<stance>] <context>` inside `<character_equipment_and_goals>` for the active speaker (when non-unspecified/non-empty).
  - [x] Append `| Physical State: [<stance>] <context>` to `<other_characters_in_room>` entries (when non-unspecified/non-empty).
  - [x] Render `<player_physical_state player="...">` whenever player physical state is non-unspecified/non-empty, including for persona-less campaigns, Solo mode, and Narrator turns.
  - [x] Add concise 1-line blocking continuity rule framing physical states as **starting states** and instructing the Actor to depict stance/orientation/spatial transitions explicitly in prose.

## Stage 3: Phase 5 Clerk Extraction, Smart Staleness Resets, Offline Heuristics & GM Tools
- [x] Update `backend/app/prompts/defaults.py`:
  - [x] Add `player_physical_stance` and `player_physical_context` extraction instructions and carry-forward rules to `DEFAULT_CLERK_POST_TURN_SYSTEM`.
  - [x] Add `physical_stance` and `physical_context` extraction instructions and carry-forward rules to `DEFAULT_CHARACTER_POST_TURN_SYSTEM`.
- [x] Update `backend/app/engine/char_agent/agent.py` & `backend/app/engine/clerk/heuristics.py`:
  - [x] Inject pre-turn `physical_stance` & `physical_context` into Character State Agent and Global World Clerk user prompts so both can compare against previous state.
  - [x] Add deterministic regex stance heuristics in offline/mock Clerk fallbacks for unambiguous stance transitions while preserving prior state when ambiguous.
- [x] Update `backend/app/engine/clerk/pipeline.py`:
  - [x] Resolve post-turn NPC and Player physical states via `resolve_post_turn_physical_state` (respecting `is_static_describe`, location changes, `>= 30` min time skips, and `restrained` / `incapacitated` retention).
  - [x] Persist resolved `physical_stance` and `physical_context` onto updated `CharacterStateSnapshot`s and `PersonaTurnStateSnapshot`, and record transition/reset metadata on `PostTurnStateDelta` / `CharacterAgentDelta`.
- [x] Update `backend/app/engine/gm_tools.py` & `backend/app/engine/gm_talk.py`:
  - [x] Surface live `physical_stance` and `physical_context` in `get_campaign_entity` (`gm_tools.py`) and formatted GM Talk persona/character context (`gm_talk.py`).

## Stage 4: Always-Available Manual Physical State Override Endpoints
- [x] Add `PhysicalStateOverrideRequest` schema in `backend/app/schemas/physical.py` (`re-exported` via `turn.py`).
- [x] Implement `override_character_physical_state` and `override_player_physical_state` repository methods (re-exported via `backend/app/db/repository.py`) updating the `active_leaf_turn_id` row (upserting `persona_turn_states` when absent) and returning `CampaignStateBundle`.
- [x] Add endpoints in `backend/app/routers/campaign_routes/crud_and_state.py`:
  - [x] `POST /api/campaigns/{campaign_id}/characters/{character_id}/physical-state-override`
  - [x] `POST /api/campaigns/{campaign_id}/player-physical-state-override`

## Stage 5: Frontend Leaf Types, API Client & UI Surfaces
- [x] Create `frontend/src/types/physical.ts` (`PhysicalStance`, `PHYSICAL_STANCE_OPTIONS`, `PhysicalStateOverrideRequest`) and update `character.ts`, `persona.ts`, `turn.ts`, and `index.ts`.
- [x] Add `overrideCharacterPhysicalState` and `overridePlayerPhysicalState` in `frontend/src/api/campaigns.ts` and wire handlers through `frontend/src/hooks/useCampaignTurnActions.ts` and `frontend/src/App.tsx`.
- [x] Update `frontend/src/components/inspector/CharacterRow.tsx`:
  - [x] Show subtle stance pill when `isPresent && state.physical_stance && state.physical_stance !== "unspecified"` with `physical_context` tooltip.
- [x] Update `frontend/src/components/LiveInspector.tsx`:
  - [x] Add compact **"You" (Player)** physical state strip showing player stance + `physical_context` with inline edit (working both with and without a selected Persona; disabled when `isMutatingLocked`).
- [x] Update `frontend/src/components/world/codexCharacter/CampaignCharacterStateTab.tsx`, `CodexCharacterDetail.tsx`, `WorldCodexTab.tsx`, and `WorldInspectorModal.tsx`:
  - [x] Render **Physical State** block (`PhysicalStateControl.tsx`) with inline edit and contextual `MechanicsHelpButton` on NPC `Current` tab and Player Persona dossier (`personaTurnState` sourced cleanly from `CampaignStateBundle.current_persona_turn_state`).
- [x] Update `frontend/src/components/inspector/AgentChangesModal.tsx`:
  - [x] Show Player physical state transition (`prev → next` + reset note) in Global World Clerk view and NPC physical state transition in per-character agent view.
- [x] Update modular stylesheets (`02-primitives.css`, `06-inspector-and-lore.css`, `12-world-codex.css`, `15-responsive.css`) cleanly without `!important`.

## Stage 6: In-App Codex Game Mechanics & Contextual Help Sync
- [x] Update `frontend/src/types/mechanics.ts` & `frontend/src/components/world/mechanics/mechanicsCatalog.ts`:
  - [x] Document Physical Stance & Motion Continuity (consuming `PHYSICAL_STANCE_OPTIONS` directly, never duplicating literals) and wire contextual `MechanicsHelpButton` triggers on Physical State UI blocks.

## Stage 7: Automated Tests, Architecture Docs & Full Verification Suite
- [x] Add backend unit & integration tests (`backend/tests/test_physical_stance.py`):
  - [x] `PhysicalStance` synonym normalization & `physical_context` sanitization/truncation.
  - [x] Zone 1 `Habitual Bearing:` relabeling; Phase 3 Cognition & Phase 4 Zone 4 physical injection + silent omission when `unspecified` + `""` + persona-less / Solo coverage.
  - [x] Phase 5 Clerk NPC + Player updates, offline regex heuristics, static `/describe` preservation, smart staleness resets (location change vs `>= 30` min time skip vs Clerk explicit update vs `restrained`/`incapacitated` retention).
  - [x] Manual NPC & Player physical state override endpoints + `CampaignStateBundle.current_persona_turn_state` atomicity + `.zcc` archive round-trip & legacy `.zcc` defaults.
- [x] Add frontend Vitest tests (`frontend/src/components/__tests__/physicalStance.test.tsx` & `codexGameMechanics.test.tsx`):
  - [x] Pure helper tests + `ReactDOMServer.renderToStaticMarkup` tests covering `CharacterRow` stance pill, `LiveInspector` `"You"` strip (with & without Persona), `CampaignCharacterStateTab`, `CodexCharacterDetail` Persona view, `AgentChangesModal` physical diff, and `mechanicsCatalog`.
- [x] Run full verification suite:
  - [x] `cd backend && .venv/bin/ruff check app tests && .venv/bin/tach check`
  - [x] `backend/.venv/bin/pytest backend/tests`
  - [x] `npm --prefix frontend run arch:check && npm --prefix frontend run css:audit && npm --prefix frontend run build && npm --prefix frontend run typecheck:e2e && npm --prefix frontend test`
  - [x] `backend/.venv/bin/python scripts/generate_arch_docs.py && backend/.venv/bin/python scripts/generate_arch_docs.py --check`

## Stage 8: User-Facing Wiki Documentation & Lifecycle Closure
- [x] Update affected pages in `../cybercantina-wiki` (`Live-Inspector-Map-and-Timeline.md`, `Playing-Directing-and-Mechanics.md`, `First-Campaign-and-Interface-Tour.md`, `Architecture-Context-Memory-and-State.md`, `Architecture-Turn-Pipeline.md`).
- [x] Verify wiki changes with `git -C ../cybercantina-wiki diff`.
- [x] Mark all completed tasks `[x]` and update `status: completed` across `FRD.md`, `REVIEW.md`, and `PLAN.md`.
