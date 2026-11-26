---
feature: dual-narrative-voice
target_version: 0.49.0
document_type: frd
status: completed
last_updated: 2026-11-27
---

# Feature Requirements Document — Dual Narrative Voice (`1st-Person In-Character` & `3rd-Person Storyteller`)

## 1. Overview & Motivation

CyberCantina's primary actor system prompt (`actor_zone1_system`) currently opens with `"You are roleplaying as {character_name} in an interactive narrative."` — a 1st-person in-character framing calibrated for classic 1-on-1 cantina roleplay. While that voice fits intimate 1v1 character-greeting campaigns, CyberCantina now supports multi-character scenes, parties, and world-first campaigns (`start_focus = "world"`).

Currently, multi-character rooms hit a hardcoded `build_zone1_ensemble_system_prompt` f-string in `backend/app/engine/context/zone1_static.py` that:
1. Causes jarring mid-campaign POV flips whenever a second NPC enters or leaves a room (switching between `"I"` when 1 NPC is present and 3rd-person ensemble when 2+ NPCs are present — including right after Turn 0 on a multi-character `character` start).
2. Completely bypasses user/built-in prompt presets (`Default`, `Novelistic & Descriptive`, `Fast & Concise`) and omits core directives (`AFFECTIVE MASKING & COMPOSURE`, `HIGH-INTENSITY & INTIMATE INTERACTION`, `PHYSICAL ACTION & OBJECT INTERACTION HIERARCHY`, `<world_clock>`).

This feature introduces an explicit, campaign-scoped **Dual Narrative Voice** (`"first_person"` vs `"storyteller"`), selectable when launching a campaign with smart defaults, immutable once started, and integrated cleanly into CyberCantina's preset system.

---

## 2. Core Definitions & Nomenclature

| Mode ID | Display Label | Narrative Voice & Role |
| :--- | :--- | :--- |
| `"first_person"` | **1st-Person In-Character** | Roleplays from inside the character's `"I"` perspective (`actor_zone1_system`), addressing the player in 2nd person (`"you"`). |
| `"storyteller"` | **3rd-Person Storyteller** | Literary 3rd-person in-world narrator (`actor_zone1_storyteller_system`) portraying one or multiple present NPCs, executing their active cognition/plans and directives, and addressing the player in 2nd person (`"you"`). |

> **Separation from Unblinking Lens & Neuromancer:**
> `"storyteller"` is strictly for standard character/ensemble gameplay turns (`narrative_mode == "standard"`). It does **not** replace `narrator_zone1_system` (*The Unblinking Lens*, used for `/describe`, `/advance`, `/complication`, `custom`, and empty-room `is_solo` turns) or `gm_talk_system` (*Neuromancer*, the out-of-character GM assistant).

---

## 3. Data Model, Persistence & Defaults

### 3.1 `NarrativeVoice` & `CampaignWorldSettings`
- Define `NarrativeVoice = Literal["first_person", "storyteller"]` in `backend/app/schemas/turn.py` and `frontend/src/types/turn.ts`.
- Add `narrative_voice: NarrativeVoice = "first_person"` to `CampaignWorldSettings` (stored inside `campaigns.world_settings_json` in SQLite).
- **Immutability Post-Launch:**
  - `narrative_voice` is chosen at campaign creation and **cannot be changed** after launch.
  - `CampaignWorldSettingsPatchRequest` (`PATCH /api/campaigns/{campaign_id}/world-settings`) does **not** expose `narrative_voice`, and `update_campaign_world_settings` in `backend/app/routers/campaign_routes/crud_and_state.py` preserves `existing.narrative_voice` verbatim.

### 3.2 Campaign Creation Default Rule
Add `narrative_voice: NarrativeVoice | None = None` to `CampaignCreateRequest` and `CreateCampaignPayload`.
When `req.narrative_voice` is omitted (`None`), the backend resolves the default via:
- `"first_person"` if `len(all_char_ids) == 1 and req.start_focus == "character"`
- `"storyteller"` if `len(all_char_ids) > 1 or req.start_focus == "world"`

### 3.3 Legacy Campaign & `.zcc` Backwards Compatibility
- Because `world_settings_json` lives on `campaigns`, `.zcc` export/import (`backend/app/services/zcc_campaign_io.py`) persists `narrative_voice` automatically for new exports.
- For existing campaigns in SQLite or imported legacy `.zcc` archives whose `world_settings_json` lacks the `"narrative_voice"` key, `CampaignsMixin.get_campaign` infers:
  - `"storyteller"` if `len(participant_ids) > 1` OR Turn 0 (`depth_index == 0`) has `actor_id == "__narrator__"`
  - `"first_person"` otherwise.

---

## 4. Prompt Preset Integration

### 4.1 Dual Keys Inside Each Preset
Instead of duplicating preset records, each prompt preset holds both Zone 1 keys:
- `PROMPT_KEY_ACTOR_ZONE1 = "actor_zone1_system"` — 1st-Person In-Character Zone 1 template (updated to explicitly require addressing the player in 2nd person `"you"`).
- `PROMPT_KEY_ACTOR_STORYTELLER_ZONE1 = "actor_zone1_storyteller_system"` — 3rd-Person Storyteller Zone 1 template.

Both keys belong to `ALL_PROMPT_KEYS`, `FACTORY_DEFAULT_PROMPTS`, `PROMPTS_METADATA`, and `PROMPT_ROLES` (`"storytelling"` group in `frontend/src/components/prompts/promptRoleDefinitions.ts`).

### 4.2 Built-in Preset Variants
All three built-in presets in `BUILTIN_PRESETS` (`backend/app/prompts/defaults.py`) provide calibrated `actor_zone1_storyteller_system` templates alongside their `actor_zone1_system` templates:
1. **`builtin-default` (`Default (Balanced)`):** Full Storyteller prompt preserving all core directives (`WORLD SETTING`, `CAST PRESENT IN SCENE`, `AFFECTIVE MASKING & COMPOSURE`, `HIGH-INTENSITY & INTIMATE INTERACTION`, `PHYSICAL ACTION & OBJECT INTERACTION HIERARCHY`, `COGNITIVE & NARRATIVE OUTPUT PROTOCOL`, 2nd-person `"you"` addressing, dice outcome tiers, and `<world_clock>`).
2. **`builtin-novelistic` (`Novelistic & Descriptive`):** Literary 3rd-person Storyteller variant emphasizing multi-sensory textures, subtext, and novelistic pacing with the full directive stack.
3. **`builtin-fast-concise` (`Fast & Concise (Low-Latency)`):** Token-efficient 3rd-person Storyteller variant tailored for 7B/8B/12B local models while retaining 3rd-person NPC + 2nd-person `"you"` rules and dice tier enforcement.

Custom user presets that omit `actor_zone1_storyteller_system` automatically fall back to `FACTORY_DEFAULT_PROMPTS["actor_zone1_storyteller_system"]` via `resolve_effective_prompts()`.

### 4.3 Phase 3 Cognition & Turn 0
- **Phase 3 (`character_cognition_system`):** Remains in 1st-person internal thoughts (`"I"`) across both modes so characters maintain strong internal agency and psychological voice; Phase 4 handles rendering outward prose in the campaign's `narrative_voice`.
- **Turn 0 (`initial_message`):** Remains verbatim as authored on the character card (or Clerk world-start staging). Turn 1+ follows the campaign's configured `narrative_voice`.

---

## 5. Runtime Turn Routing & Multi-Character Rules

### 5.1 Sentinel Scenes (`is_narrator` / `eff_is_solo`)
- Unchanged: `is_narrator` and empty-room `eff_is_solo` always route through `build_zone1_narrator_system_prompt` / `build_zone1_solo_system_prompt` (`narrator_zone1_system`).

### 5.2 `narrative_voice == "storyteller"`
- **Both 1-NPC and multi-NPC rooms** (`len(present_characters) >= 1`) render via the Storyteller Zone 1 builder (`build_zone1_storyteller_system_prompt` / unified `build_zone1_ensemble_system_prompt`), sorting `present_characters` canonically by `c.id` to maximize KV-cache reuse across turns.
- All core directives and the active preset's `actor_zone1_storyteller_system` template apply uniformly whether 1 or 5 NPCs are in the room.

### 5.3 `narrative_voice == "first_person"`
1. **Single Focus Character in Room (`present_characters == [focus_char]`):**
   - Renders via `build_zone1_static_system_prompt` with `actor_zone1_system` (`"You are roleplaying as {character_name}..."`), explicitly addressing the player in 2nd person (`"you"`).
2. **Focus Character + Other NPC(s) in Room (`campaign.character_id` in `present_ids` and `len(present_characters) > 1`):**
   - Keeps Zone 1 anchored on the original focus character's 1st-person `"I"` POV (`actor_zone1_system`), appending a concise cast summary of co-present NPCs and an explicit **1st-Person Ensemble Anchoring** rule: write strictly from `{focus_character.name}`'s 1st-person `"I"` perspective, rendering co-present NPCs' spoken dialogue and visible physical behavior externally in 3rd person without mind-reading or shifting `"I"` to another NPC.
   - Anchors the turn's `character` / saved `turn.actor_id` in `turn_streaming.py` to `campaign.character_id` (while still forwarding `pre_turn.active_speaker_id` in Zone 4 for turn-taking cues) so Zone 3 working memory never misattributes `"I"` prose to another character (`[OtherNPC]: I...`).
   - Frames co-present NPCs' `<character_active_cognition>` blocks in Zone 4 as observable external cues/actions rather than telepathic knowledge for `"I"`.
3. **Focus Character Absent from Room (`campaign.character_id` NOT in `present_ids`, `len(present_characters) >= 1`):**
   - Temporarily falls back to **Storyteller** (`actor_zone1_storyteller_system`) for that turn so `"I"` remains reserved exclusively for the campaign's original character and Zone 2/3 working memory stays unambiguous. Returns seamlessly to 1st-person `"I"` once the player reunites with the focus character.

---

## 6. Frontend UI & UX Requirements

1. **`NewCampaignModal.tsx` (Step 3 — Opening Scene):**
   - Add a **Narrative Voice** two-card selector (`1st-Person In-Character` vs `3rd-Person Storyteller`) below **Campaign Opening Hook**.
   - Auto-select `"first_person"` when `selectedCharIds.length === 1 && startFocus === "character"`, and `"storyteller"` otherwise.
   - Track a manual-override (`dirty`) flag so changing character count or `startFocus` updates the recommended selection automatically *only* until the user explicitly clicks a Narrative Voice card.
   - Display a concise note indicating which option is recommended for the current setup and that Narrative Voice locks once the campaign launches.
2. **`WorldInspectorModal.tsx` (Campaign World Settings):**
   - In campaign mode, display **Narrative Voice** as a read-only indicator showing the campaign's locked voice (`1st-Person In-Character` or `3rd-Person Storyteller`).
3. **Prompt Presets Manager (`promptRoleDefinitions.ts`):**
   - Include `actor_zone1_storyteller_system` under the **Storytelling** role tab so users can inspect/customize both templates per preset.
