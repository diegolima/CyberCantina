---
feature: dual-narrative-voice
target_version: 0.49.0
document_type: plan
status: completed
last_updated: 2026-11-27
---

# Implementation Plan — Dual Narrative Voice

## Step 1: Feature Spec Package
- [x] Create isolated worktree `.worktrees/dual-narrative-voice` on branch `feat/dual-narrative-voice`
- [x] Author `FRD.md` (`docs/features/0.49.0-dual-narrative-voice/FRD.md`)
- [x] Author `REVIEW.md` (`docs/features/0.49.0-dual-narrative-voice/REVIEW.md`)
- [x] Author `PLAN.md` (`docs/features/0.49.0-dual-narrative-voice/PLAN.md`)
- [x] Obtain explicit user approval before editing production code

## Step 2: Backend Schemas, Persistence & Legacy Inference
- [x] Update `backend/app/schemas/turn.py`:
  - Add `NarrativeVoice = Literal["first_person", "storyteller"]`
  - Add `narrative_voice: NarrativeVoice = "first_person"` to `CampaignWorldSettings`
- [x] Update `backend/app/routers/campaign_routes/schemas_and_gate.py`:
  - Add `narrative_voice: NarrativeVoice | None = None` to `CampaignCreateRequest`
  - Keep `CampaignWorldSettingsPatchRequest` without `narrative_voice` (immutable post-launch)
- [x] Update `backend/app/db/repos/campaigns.py`:
  - Accept `narrative_voice: NarrativeVoice | None = None` in `create_campaign`, persisting it inside `camp_world_settings` (defaulting to `"first_person"` when `len(all_char_ids) == 1 and effective_start_focus == "character"`, else `"storyteller"`)
  - In `get_campaign`, infer `"storyteller"` vs `"first_person"` when `"narrative_voice"` is absent from legacy `world_settings_json` (`len(participant_ids) > 1` or Turn 0 `actor_id == "__narrator__"` -> `"storyteller"`, else `"first_person"`)
- [x] Update `backend/app/routers/campaign_routes/crud_and_state.py`:
  - Resolve and pass `narrative_voice` in `create_campaign`
  - Preserve `narrative_voice=existing.narrative_voice` in `update_campaign_world_settings`
- [x] Verify `backend/app/services/zcc_campaign_io.py` preserves `narrative_voice` on export and cleanly handles legacy `.zcc` imports missing `"narrative_voice"`

## Step 3: Prompt Templates, Presets & Metadata
- [x] Update `backend/app/prompts/defaults.py` & `backend/app/prompts/__init__.py`:
  - Define `PROMPT_KEY_ACTOR_STORYTELLER_ZONE1 = "actor_zone1_storyteller_system"` and register in `ALL_PROMPT_KEYS`, `FACTORY_DEFAULT_PROMPTS`, `PROMPTS_METADATA`, and `__all__`
  - Add explicit 2nd-person player addressing (`"you"`) guidance to `DEFAULT_ACTOR_ZONE1_SYSTEM`, `NOVELISTIC_ACTOR_ZONE1`, and `FAST_CONCISE_ACTOR_ZONE1`
  - Author `DEFAULT_ACTOR_STORYTELLER_ZONE1`, `NOVELISTIC_ACTOR_STORYTELLER_ZONE1`, and `FAST_CONCISE_ACTOR_STORYTELLER_ZONE1` preserving all core directives (`WORLD SETTING`, `CAST PRESENT`, `AFFECTIVE MASKING & COMPOSURE`, `HIGH-INTENSITY & INTIMATE INTERACTION`, `PHYSICAL ACTION & OBJECT INTERACTION HIERARCHY`, `COGNITIVE & NARRATIVE OUTPUT PROTOCOL` / dice tiers / `<world_clock>`, 2nd-person `"you"` addressing) and wire them into `BUILTIN_PRESETS`

## Step 4: Engine Routing (Zone 1, Zone 4, Turn Streaming & Offline Prose)
- [x] Update `backend/app/engine/context/zone1_static.py`, `backend/app/engine/context/__init__.py`, and `backend/app/engine/phase2_context.py`:
  - Extract shared character-sheet formatting helper so single-NPC and multi-NPC cast formatting share one code path without duplication
  - Add `build_zone1_storyteller_system_prompt(world, present_characters, prompt_template=None, persona_snapshot=None)` rendering `actor_zone1_storyteller_system` for 1 or N characters (canonically sorted by `c.id`)
  - Refactor `build_zone1_ensemble_system_prompt` to route through `build_zone1_storyteller_system_prompt` when `len(present_characters) > 1` (preserving existing signature/exports for backwards compatibility)
  - Support optional `co_present_characters` + 1st-person ensemble anchoring directive inside `build_zone1_static_system_prompt` when 1st-person mode has additional NPCs alongside the focus character
- [x] Update `backend/app/engine/context/zone4_ephemeral.py`, `backend/app/engine/context/assembler.py`, and `backend/app/engine/phase2_context.py`:
  - Thread `narrative_voice` cleanly into `resolve_phase2_turn_context`, `assemble_four_zone_messages`, and `build_zone4_ephemeral_tail_frame`, plus `pov_character` separation in `assemble_four_zone_messages`
  - Route Storyteller turns (1 or N NPCs) to `build_zone1_storyteller_system_prompt` using `actor_zone1_storyteller_system`
  - Route 1st-person multi-NPC rooms (when focus character is present) to `build_zone1_static_system_prompt` anchored on the focus character, framing co-present NPC `<character_active_cognition>` blocks as observable external behavior/dialogue only
  - Temporarily fall back to Storyteller when `narrative_voice == "first_person"` and focus character is absent from `present_characters`
- [x] Update `backend/app/routers/campaign_routes/turn_streaming.py`:
  - Resolve effective per-turn voice (`"storyteller"` fallback when `"first_person"` focus character is absent from `present_char_ids`)
  - Preserve active speaker `actor_id` while passing `pov_character=primary_character` when `"first_person"` has 2+ NPCs in the room with `primary_character` present
  - Select `actor_zone1_storyteller_system` vs `actor_zone1_system` template cleanly for Phase 2 & Phase 4

## Step 5: Frontend Types, Launch Modal, Campaign Settings & Prompt Roles
- [x] Update `frontend/src/types/turn.ts`:
  - Add `NarrativeVoice = "first_person" | "storyteller"`
  - Add `narrative_voice?: NarrativeVoice` to `CampaignWorldSettings` and `CreateCampaignPayload`
- [x] Update `frontend/src/components/NewCampaignModal.tsx`:
  - Add Narrative Voice selector cards (`1st-Person In-Character` vs `3rd-Person Storyteller`) in Step 3 below Campaign Opening Hook
  - Auto-select default (`first_person` iff `selectedCharIds.length === 1 && startFocus === "character"`, else `storyteller`) until manually overridden, and note immutability after launch
- [x] Update `frontend/src/components/world/WorldInspectorModal.tsx`:
  - Display locked `Narrative Voice` as a read-only row in Campaign World Settings and preserve `narrative_voice` cleanly in state
- [x] Update `frontend/src/components/prompts/promptRoleDefinitions.ts`:
  - Add `"actor_zone1_storyteller_system"` to the `"storytelling"` role group

## Step 6: Verification, Tests & Architecture Docs
- [x] Add/update backend tests covering `PROMPT_KEY_ACTOR_STORYTELLER_ZONE1`, campaign defaults & immutability, legacy inference, Zone 1/3/4 routing, and streaming anchoring/fallback (`test_dual_narrative_voice.py`, `test_campaign_lore_gm_and_major_events.py`)
- [x] Add/update frontend Vitest tests (`promptRoleDefinitions.test.ts`, `newCampaignModal.test.tsx`)
- [x] Run full backend & frontend verification suite inside `.worktrees/dual-narrative-voice/`:
  - `cd backend && .venv/bin/ruff check app tests && .venv/bin/tach check` (passed)
  - `backend/.venv/bin/pytest backend/tests` (601 passed)
  - `npm --prefix frontend run arch:check && npm --prefix frontend run css:audit && npm --prefix frontend run build && npm --prefix frontend test` (62 test files / 405 tests passed)
  - `backend/.venv/bin/python scripts/generate_arch_docs.py && backend/.venv/bin/python scripts/generate_arch_docs.py --check` (4 files verified)

## Step 7: Planned Wiki Updates (Applied at Merge Time)
- [x] Apply, verify (`git -C ../cybercantina-wiki diff`), and commit updates to `../cybercantina-wiki`:
  - `../cybercantina-wiki/First-Campaign-and-Interface-Tour.md` — Document choosing **Narrative Voice** (`1st-Person In-Character` vs `3rd-Person Storyteller`) in Step 3 of Launch Campaign, automatic defaults, and immutability once started.
  - `../cybercantina-wiki/Playing-Directing-and-Mechanics.md` — Explain how `1st-Person In-Character` vs `3rd-Person Storyteller` behave in single-NPC, multi-NPC, and focus-character-absent rooms (distinct from Unblinking Lens `/describe`/`/advance`/`/complication` and Neuromancer `/gm`).
  - `../cybercantina-wiki/Prompt-Customization-and-Presets.md` — Document the new `actor_zone1_storyteller_system` template key under Storytelling across `Default`, `Novelistic & Descriptive`, and `Fast & Concise` presets.
  - `../cybercantina-wiki/Architecture-Context-Memory-and-State.md` — Document dual Zone 1 voice routing (`actor_zone1_system` vs `actor_zone1_storyteller_system`), focus-character anchoring in 1st-person multi-NPC scenes, and legacy inference.
