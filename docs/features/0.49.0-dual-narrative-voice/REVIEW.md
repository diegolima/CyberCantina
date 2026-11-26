---
feature: dual-narrative-voice
target_version: 0.49.0
document_type: review
status: completed
last_updated: 2026-11-27
---

# Pre-Implementation Review — Dual Narrative Voice

## Key Architectural Traps & Mitigations

### 1. Conflating "3rd-Person Storyteller" with "Unblinking Lens" or "Neuromancer OOC"
- **Trap:** Framing the 3rd-person mode as an "OOC narrator" causes smaller local models (8B–12B) to slip into either `DEFAULT_NARRATOR_ZONE1_SYSTEM` (*Unblinking Lens* — refusing to voice NPC emotions/dialogue) or `DEFAULT_GM_TALK_SYSTEM` (*Neuromancer* — meta-commenting out-of-character).
- **Mitigation:**
  - Name and phrase `actor_zone1_storyteller_system` explicitly as an **in-world 3rd-person Storyteller / narrative writer** portraying the cast in `<cast_present>` with full dialogue, somatic realism, and Affective Masking, strictly keeping `narrator_zone1_system` separate for `/describe`, `/advance`, `/complication`, `custom`, and `is_solo`.
  - Include an explicit rule in both `actor_zone1_system` and `actor_zone1_storyteller_system` to address the player persona in **2nd person (`"you"`)** and never speak or act on behalf of the player.

### 2. Hardcoded `build_zone1_ensemble_system_prompt` & Existing Test Compatibility
- **Trap:** `build_zone1_ensemble_system_prompt` in `backend/app/engine/context/zone1_static.py` is currently a hardcoded f-string that ignores `prompt_template` and omits core directives. However, multiple existing tests (`test_phase3_multi_cognition_and_phase4_prose.py`, `test_user_personas.py`, `test_parties.py`, `test_physical_stance.py`) call `build_zone1_ensemble_system_prompt(world, present_characters, ...)` directly.
- **Mitigation:**
  - Upgrade `build_zone1_ensemble_system_prompt` (and/or delegate from `build_zone1_storyteller_system_prompt`) to render `actor_zone1_storyteller_system` via `render_template(...)` while preserving its existing call signature, default `prompt_template=None` fallback, canonical `sorted(present_characters, key=lambda c: c.id)` KV-cache ordering, and `format_zone1_player_protagonist_block(persona_snapshot)`.
  - Notice `build_zone1_ensemble_system_prompt` currently delegates to `build_zone1_static_system_prompt` when `len(present_characters) == 1`; in `"storyteller"` mode, `assembler.py` should pass the single character through the Storyteller builder (`build_zone1_storyteller_system_prompt`) so 1-NPC rooms in a Storyteller campaign never flip back into 1st-person `"I"`.

### 3. Zone 3 Attribution & Mind-Reading Leak in 1st-Person Multi-NPC Rooms
- **Trap:** When `narrative_voice == "first_person"` and 2+ NPCs share a room with `campaign.character_id` present:
  1. `turn_streaming.py` currently sets `character = participants_by_id[pre_turn.active_speaker_id]` and `actor_id = character.id`. If `active_speaker_id` is Character B while prose is narrated in Character A's `"I"` voice, Zone 3 on subsequent turns prefixes `[Char B]: I glance across the room...`, breaking speaker identity.
  2. `zone4_ephemeral.py` injects `<character_active_cognition>` (`<feeling>`, `<want>`, `<plan>`) for all present characters; without explicit framing, `"I"` may narrate Character B's secret internal thoughts.
- **Mitigation:**
  - In `turn_streaming.py`, when `effective_voice == "first_person"` and `campaign.character_id` is in `present_char_ids`, anchor `character` and saved `actor_id` to the focus character (`primary_character`), while still passing `pre_turn` (including `pre_turn.active_speaker_id`) into Zone 4 so the scene honors who should speak/act next.
  - In `zone4_ephemeral.py`, when rendering `<character_active_cognition>` under 1st-person multi-NPC mode, label co-present NPCs' blocks with an explicit `<actor_directive>` clarifying that `{focus_character.name}` is the 1st-person `"I"` narrator and must render other characters strictly via observable dialogue and outward behavior (never internal telepathy).

### 4. Focus Character Absent in a 1st-Person Campaign
- **Trap:** If the player travels to a room where `campaign.character_id` is absent and interacts with Character B, keeping `"first_person"` would either force Character A to narrate a room they aren't in or make Character B hijack `"I"` inside a turn log full of A's `"I"` turns.
- **Mitigation:**
  - In `turn_streaming.py` / `assembler.py`, compute effective turn voice per turn: if `campaign.world_settings.narrative_voice == "first_person"` and `campaign.character_id not in present_char_ids` (and `not is_narrator` and `not is_solo`), temporarily use `"storyteller"` for that turn (using `actor_zone1_storyteller_system`). Return to `"first_person"` as soon as `campaign.character_id` is co-present again.

### 5. `update_campaign_world_settings` Field Reconstruction Overwrite
- **Trap:** `update_campaign_world_settings` in `backend/app/routers/campaign_routes/crud_and_state.py` manually constructs a fresh `CampaignWorldSettings(...)` from `CampaignWorldSettingsPatchRequest` fields. Adding `narrative_voice` to `CampaignWorldSettings` without forwarding `narrative_voice=existing.narrative_voice` would silently reset `"storyteller"` campaigns back to `"first_person"` whenever a user toggles GM Mode (`unlock_lore`), `describe_on_first_visit`, or `auto_spawn_props_on_search_crit`.
- **Mitigation:**
  - Explicitly copy `narrative_voice=existing.narrative_voice` in `update_campaign_world_settings` (and keep `narrative_voice` out of `CampaignWorldSettingsPatchRequest`), backed by a regression test toggling `unlock_lore` on a `"storyteller"` campaign.

### 6. Legacy Campaign & `.zcc` Inference Without Breaking Unit Tests
- **Trap:** Existing DB rows and legacy `.zcc` archives have `world_settings_json` without `"narrative_voice"`. Relying solely on Pydantic's default `"first_person"` would leave legacy multi-character / world-start campaigns stuck in `"first_person"`, whereas failing on missing JSON keys would break legacy imports.
- **Mitigation:**
  - Keep `narrative_voice: NarrativeVoice = "first_person"` as the safe Pydantic default on `CampaignWorldSettings` (so unit tests instantiating `CampaignWorldSettings()` directly continue to pass).
  - In `CampaignsMixin.get_campaign` (`backend/app/db/repos/campaigns.py`), inspect the raw JSON dict: when `"narrative_voice"` is absent from `world_settings_json`, query Turn 0's `actor_id` and infer `"storyteller"` if `len(participant_ids) > 1` or `turn0_actor_id == "__narrator__"`, else `"first_person"`. Apply the same fallback cleanly during `.zcc` campaign import (`zcc_campaign_io.py`) if `"narrative_voice"` was omitted.

### 7. Prompt Preset Editor Validation (`PromptPresetsManager` & `PROMPTS_METADATA`)
- **Trap:** `PromptPresetsManager.tsx` validates `meta.required_tags` when saving custom presets, and `promptRoleDefinitions.ts` + `promptRoleDefinitions.test.ts` assert an exact 16-key partition across the 4 role tabs. Adding `actor_zone1_storyteller_system` without updating both `promptRoleDefinitions.ts` and its unit test will fail Vitest or drop the new key into `"auxiliary"`.
- **Mitigation:**
  - Set `required_tags: []` on `actor_zone1_storyteller_system` in `PROMPTS_METADATA` (consistent with Phase 3/4 decoupled cognition, where Zone 4 tells Phase 4 not to emit `<cognition>` blocks).
  - Add `"actor_zone1_storyteller_system"` to `PROMPT_ROLES` (`"storytelling"`) in `frontend/src/components/prompts/promptRoleDefinitions.ts` and update `promptRoleDefinitions.test.ts` and `test_prompts_and_presets.py`.
  - Preserve facade re-exports in `backend/app/prompts/__init__.py` and `backend/app/engine/phase2_context.py`.

### 8. `NewCampaignModal` Auto-Default vs Manual Override & Offline Prose Consistency
- **Trap:** In `NewCampaignModal.tsx`, unconditionally resetting `narrativeVoice` inside a `useEffect` on `[selectedCharIds.length, startFocus]` would overwrite a user's manual selection if they pick characters or toggle Opening Hook afterward; conversely, never updating it leaves stale defaults when stepping back from Step 3 to Step 2.
- **Mitigation:**
  - Track `hasManualVoiceOverride` state in `NewCampaignModal.tsx` (reset only on modal close/reopen, set `true` when the user clicks either Narrative Voice card). While `false`, derive/sync `narrativeVoice` from `selectedCharIds.length === 1 && startFocus === "character" ? "first_person" : "storyteller"`.
  - Keep `build_offline_simulated_prose` in `backend/app/engine/phase4_prose.py` clean across both modes (ensure offline fallback respects `narrative_voice` / anchored focus character without breaking offline test assertions).
