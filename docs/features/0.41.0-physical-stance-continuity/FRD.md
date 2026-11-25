---
feature: physical-stance-continuity
target_version: 0.41.0
document_type: frd
status: completed
last_updated: 2026-11-25
---

# Feature Requirements Document — v0.41.0 Physical Stance & Motion Continuity Tracking

## 1. Overview & Motivation

While CyberCantina tracks psychological state (4-layer CARE affective dynamics,PAD/composure, dyadic bonds), spatial macro-location (`current_location_id`), and equipment/inventory across turns, autoregressive roleplay models—especially smaller/local 7B–14B models, and occasionally frontier models—frequently drop **micro-spatial and bodily motion continuity** across turns:

- **Teleporting limbs & forgotten posture:** A character knocked flat on their stomach or pinned behind cover suddenly kneels, sits at a table, or paces across the room two turns later once incidental stage directions are buried in Zone 3 or compacted into Zone 2 episodic summaries.
- **Ambiguous staging prose:** Models hedge ("shifts closer", "moves across the room") without committing to orientation, stance, or cover, leaving readers unsure how participants are physically positioned.
- **Static `posture` confusion:** Zone 1 currently injects each character's static card field (`characters.posture`) as `Posture: ...`, which is meant for habitual bearing/carriage rather than dynamic turn-by-turn pose.

CyberCantina already runs Phase 5 post-turn structured extraction via the Global World Clerk (`WorldPostTurnDelta`) and per-character State Agents (`CharacterAgentDelta`) and injects live turn state into Phase 3 Cognition and Phase 4 Zone 4. Piggybacking a compact, structured **Physical Stance & Context** snapshot onto those existing Clerk calls resolves motion continuity across both NPCs and the Player with **zero extra LLM calls**.

---

## 2. Agreed Product Decisions

### 2.1 Entity Scope (NPCs & Player Persona — Including Persona-less Campaigns)
- **Both NPCs and the Player:** Track physical stance and context for every participant NPC (stored on `character_states`) **and** for the Player (stored on `persona_turn_states`).
- **Zero Extra LLM Calls:**
  - NPC updates come from two new fields on `CharacterAgentDelta` (evaluated by each existing per-character State Agent in Phase 5).
  - Player updates come from two lightweight fields on `WorldPostTurnDelta` (evaluated by the existing Global Post-Turn World Clerk in Phase 5).
- **Persona-less & Solo Support:** Player physical state must persist and inject identically even when `campaign.persona_id` / `campaign.persona_snapshot` is `None` or when the player is in an empty/Solo room (`__solo__`).

### 2.2 Two-Field Hybrid Data Model
Physical state uses a compact 2-field hybrid schema designed to resist small-model JSON drift and avoid Zone 4 bloat:

1. **`physical_stance`** — Constrained plain-English **10-value enum** (`PhysicalStance`):
   - `"unspecified"` *(default at Turn 0 or after long unanchored time skips)*
   - `"standing"`
   - `"sitting"`
   - `"leaning"`
   - `"crouching"`
   - `"kneeling"`
   - `"lying_down"`
   - `"moving"` *(walking, running, climbing, pacing, crawling, swimming)*
   - `"restrained"` *(bound, pinned, grappled, cuffed)*
   - `"incapacitated"` *(unconscious, collapsed, paralyzed)*
2. **`physical_context`** — Short situational anchor string (`str`, default `""`, deterministic cap at `120` chars / guidance `≤ 15` words):
   - Disambiguates orientation (`"on stomach"`, `"on back"`, `"curled on side"`), micro-location (`"behind the overturned booth"`), hand/prop engagement (`"pistol braced on the crate"`), and dyadic physical contact (`"pinning Kira against the bulkhead"`).

### 2.3 Always-On Core Engine State
- Physical stance tracking is **always-on** (like CARE affective tracking and inventory)—no user/campaign settings toggle is added.
- **Silent Prompt Omission:** Whenever `physical_stance == "unspecified"` and `physical_context == ""`, prompts omit the physical-state line cleanly so unestablished scenes pay zero token overhead.

### 2.4 Forward Turn Pipeline Integration (Zone 1, Phase 3 Cognition & Phase 4 Zone 4)
- **Zone 1 Static Disambiguation (`backend/app/engine/context/zone1_static.py`):**
  - Relabel the static character card `Posture:` output line to **`Habitual Bearing:`** in both single-character and ensemble Zone 1 prompts so it never collides with Zone 4's transient pose. Keep the underlying `characters.posture` DB column and wizard schema unchanged.
- **Phase 3 Cognition Injection (`backend/app/engine/cognition/runner.py`):**
  - Inject the character's starting physical state, co-present NPCs' starting physical states, and the player's starting physical state into Phase 3 Cognition prompts so NPC `<plan>` blocks respect physical constraints (e.g., needing to scramble up from `lying_down` before sprinting for the exit, or struggling against `restrained`).
  - Clarify `prior_cues_section` wording so `c.feeling_summary` is labeled `"Emotional outward manner"` rather than `"Outward posture"`.
- **Phase 4 Zone 4 Injection (`backend/app/engine/context/zone4_ephemeral.py`):**
  - **Speaker:** Inside `<character_equipment_and_goals>`, render `Starting Physical State: [<stance>] <physical_context>` (when non-unspecified or non-empty).
  - **Co-Present NPCs:** Inside `<other_characters_in_room>`, append `| Physical State: [<stance>] <physical_context>` per co-present NPC when established.
  - **Player:** Render a `<player_physical_state player="<name-or-Player>">` block (including in Narrator and Solo turns) whenever player `physical_stance != "unspecified"` or `physical_context != ""`.
  - **Blocking Continuity Rule (1-line Actor directive):** Include a concise directive in Zone 4 framing every injected physical line explicitly as a **starting state** (preventing "statue syndrome") and instructing the Actor to depict stance, orientation, and spatial transitions explicitly in prose rather than skipping or leaving them ambiguous.

### 2.5 Phase 5 Clerk Update Rules & Smart Staleness Resets
- **Carry-Forward Default:** Prompt both the Global World Clerk (for the Player) and Character State Agents (for NPCs) to carry forward the prior `(physical_stance, physical_context)` verbatim on pure-dialogue or physically unchanged turns, and update them only when turn prose explicitly depicts a bodily/spatial transition or stabilization.
- **Static `/describe` Protection:** On static `[Describe ...]` narrator turns (`is_static_describe`), carry forward all existing NPC and Player physical states untouched.
- **Smart Staleness Reset (`backend/app/engine/clerk/pipeline.py` & `backend/app/db/repos/campaign_spatial.py`):**
  - Trigger condition for a character (or the Player):
    1. Location changed (`new_location_id != prev_location_id`, via Clerk movement or manual relocation override), **OR**
    2. Elapsed turn time skipped significantly (`turn_elapsed >= 30` minutes).
  - **Smart Guard ("Only if Clerk Left Verbatim Unchanged"):** If the Clerk already emitted a *new* `(physical_stance, physical_context)` different from pre-turn (e.g., *"they walk into the tavern and drop into a corner booth"* → `sitting`), keep the Clerk's explicit end-of-turn state! Apply the staleness reset **only** when the Clerk left `(physical_stance, physical_context)` verbatim-unchanged from pre-turn:
    - Clear stale `physical_context = ""`.
    - Reset `physical_stance` to `"standing"` on location change, or `"unspecified"` on a `>= 30` minute time skip.
    - **`restrained` / `incapacitated` Exception:** Never auto-clear `physical_stance` when it is `"restrained"` or `"incapacitated"` (e.g., an unconscious prisoner carried into a new room or sleeping overnight while bound stays `restrained` / `incapacitated`; on location change, only room-bound `physical_context` is cleared if left verbatim-unchanged).
  - **Telemetry Auditability:** Record any deterministic reset cleanly on the resolved `PostTurnStateDelta` / `AgentChangesModal` so users can see when a travel or time skip cleared stale posture.

### 2.6 Turn 0 Initialization & Offline/Mock Heuristics
- **Turn 0 (`create_campaign`):** Initialize `character_states` and `persona_turn_states` with `physical_stance = "unspecified"` and `physical_context = ""`. Zero extra campaign-creation latency; Zone 4 silently omits the physical-state line until Turn 1 establishes a pose.
- **Offline/Mock Clerk Fallback (`char_agent/agent.py`, `clerk/heuristics.py`):** Add lightweight deterministic regex extraction for unmistakable stance cues (e.g., `"drops to his knees"`, `"lies flat on her stomach"`, `"sits in the booth"`, `"stands up"`, `"handcuffed"`, `"knocked unconscious"`) while defaulting cleanly to carrying forward prior state when ambiguous.

### 2.7 UI Surfaces & Always-Available Manual Overrides
1. **Live Inspector Right Pane (`LiveInspector.tsx`, `CharacterRow.tsx`):**
   - **NPC `CharacterRow`:** Render a subtle, compact stance pill next to status metadata **only when** `isPresent === true` and `physical_stance !== "unspecified"`, with a hover `title` showing `physical_context` (when non-empty).
   - **Compact `"You"` (Player) Row / Strip:** Render a compact player status strip in `LiveInspector.tsx` showing the player's current `physical_stance` badge and `physical_context` summary (plus an inline Edit popover/controls)—rendered **even in campaigns with no selected Persona** (`persona_snapshot == null`). Clicking edit lets the player fix stance/context on the spot.
2. **Codex Dossier (`CodexCharacterDetail.tsx`, `CampaignCharacterStateTab.tsx`):**
   - **NPC `Current` Tab (`CampaignCharacterStateTab`):** Add a compact **Physical State** block showing `physical_stance` badge + `physical_context` with inline **Edit** (always available, disabled only while `isMutatingLocked` during streaming) and contextual `MechanicsHelpButton`.
   - **Player Persona Dossier (`CodexCharacterDetail` `"persona"` mode):** Add a live **Current Physical State** card/section (visible in campaign mode via `personaTurnState`) with inline **Edit** and contextual `MechanicsHelpButton`.
3. **Turn Clerk Diff Modal (`AgentChangesModal.tsx`):**
   - **Global World Clerk view:** Show Player physical state transition (`prev → next`, plus staleness-reset indicator if triggered) whenever stance or context changed.
   - **Per-Character Agent view:** Show NPC physical state transition (`prev → next`, plus staleness-reset indicator if triggered) whenever stance or context changed.
4. **Always-Available Override Endpoints (Not GM-Mode Gated):**
   - `POST /api/campaigns/{campaign_id}/characters/{character_id}/physical-state-override`
   - `POST /api/campaigns/{campaign_id}/player-physical-state-override`
   - Both mutate the active `active_leaf_turn_id` snapshot atomically and return updated `CampaignStateBundle` (matching `/location-override`).

### 2.8 Cross-Cutting Parity (Bundle, GM Tools, `.zcc`, Codex Mechanics & Wiki)
- **`CampaignStateBundle` (`backend/app/schemas/turn.py`):** Expose `current_persona_turn_state: PersonaTurnStateSnapshot | None = None` directly on the campaign bundle so turns, swipes, branch switches, and overrides update Player physical state atomically without stale secondary fetches.
- **GM Talk (`backend/app/engine/gm_tools.py`):** Surface current `physical_stance` and `physical_context` in `get_campaign_entity` for both `character` and `persona`.
- **`.zcc` Export/Import (`backend/app/services/zcc_campaign_io.py`):** Round-trip `physical_stance` and `physical_context` in both `character_states` and `persona_turn_states`, defaulting safely when importing older `.zcc` archives that lack those columns.
- **In-App Codex Game Mechanics & Wiki:** Document physical stance & motion continuity in `mechanicsCatalog.ts` (consuming shared `PHYSICAL_STANCE_OPTIONS` constants) with contextual `MechanicsHelpButton` links, and update the sibling `../cybercantina-wiki` documentation.

---

## 3. Core Invariants & Non-Goals

### Invariants
1. **Zero Extra LLM Calls:** No new phase or standalone LLM request; all extraction piggybacks on `WorldPostTurnDelta` and `CharacterAgentDelta`.
2. **Starting-State Framing:** Zone 4 and Phase 3 prompts explicitly treat physical state as a mutable *starting state* at turn start, never an immutable constraint.
3. **Silent Omission at Rest:** `("unspecified", "")` adds zero tokens to Phase 3 or Phase 4 prompts.
4. **Required JSON Schema Properties:** `physical_stance` and `physical_context` are included in `required` schema properties on `WorldPostTurnDelta` and `CharacterAgentDelta` so constrained local decoders do not silently drop them.
5. **Restrained/Incapacitated Persistence:** Travel and time-skip resets never silently clear `"restrained"` or `"incapacitated"`.
6. **Layering & Backwards Compatibility:** Leaf schema/type modules hold `PhysicalStance` and presets; old SQLite databases and `.zcc` archives upgrade seamlessly via additive defaults (`'unspecified'`, `''`).

### Non-Goals
- No 2D/3D coordinate grid or room furniture collision physics inside a room.
- No hit-point, limb-damage, or medical trauma simulation engine.
- No extra LLM pass at campaign creation (Turn 0).
- No new user or campaign settings toggle.

---

## 4. Acceptance Criteria

1. Both `character_states` and `persona_turn_states` persist `physical_stance` (constrained 10-value enum defaulting to `'unspecified'`) and `physical_context` (`''` default, `<= 120` chars), with idempotent DB migration and `.zcc` round-trip parity.
2. Zone 1 renders `characters.posture` as `Habitual Bearing:` (single-character and ensemble); Phase 3 Cognition and Phase 4 Zone 4 inject established NPC and Player starting physical states (omitting `"unspecified"` + `""`), including for persona-less campaigns and Solo rooms, paired with the 1-line blocking continuity rule.
3. Phase 5 Clerk updates both NPC (`CharacterAgentDelta`) and Player (`WorldPostTurnDelta`) physical states, preserves prior state on static `/describe` turns, and applies smart staleness resets on location change / `>= 30` min time skips only when verbatim-unchanged (preserving `"restrained"` / `"incapacitated"`).
4. `CampaignStateBundle.current_persona_turn_state` updates atomically on turns, swipes, branch switches, and overrides; manual override endpoints update NPC and Player physical state on the leaf turn and return the refreshed bundle.
5. `LiveInspector` (NPC `CharacterRow` stance pill + compact `"You"` strip with inline edit), `CodexCharacterDetail` / `CampaignCharacterStateTab` (NPC `Current` + Persona live physical state + inline edit), `AgentChangesModal` (Clerk & NPC diffs), GM Talk (`get_campaign_entity`), and Codex `Game Mechanics` + sibling wiki are implemented and verified.
6. All backend (`ruff`, `tach check`, `pytest`) and frontend (`arch:check`, `css:audit`, `build`, `typecheck:e2e`, `vitest`) checks plus `scripts/generate_arch_docs.py --check` pass.
