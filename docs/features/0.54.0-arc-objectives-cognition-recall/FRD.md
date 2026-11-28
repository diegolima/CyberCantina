---
feature: arc-objectives-cognition-recall
target_version: 0.54.0
document_type: frd
status: completed
last_updated: 2026-11-28
---

# Feature Requirements Document — Arc Objectives & Phase 3 Cognition Context Bridge

## 1. Overview & Motivation

Long-running CyberCantina campaigns suffer from two coupled failure modes that cause characters to drift away from prior commitments and established story goals:

1. **Missing Arc-Level Motivational Tier:** Characters currently operate with only two goal horizons:
   - `BaselinePsyche.core_drive` (static, life-level abstraction such as exposing a corporate conspiracy), and
   - `CharacterStateSnapshot.active_want` / `active_plan` (hyper-local scene tactics that shift every few turns whenever an immediate obstacle, conversation, or wound demands attention).
   There is no intermediate **Arc Objective** representing a multi-scene strategic goal (hours/days horizon — e.g., *"Reach Sector 8 through the Sluice with the player for 3,000 credits"* with an optional time anchor *"at daybreak"*). Once an immediate crisis dominates `active_want`, the overarching reason the character partnered with the player or traveled across districts fades from active awareness.
2. **Phase 3 Cognition Context Blindness & Recall Starvation (Surfaced by `camp_509ebf763e`, Turn 72):**
   - On Turn 72 of `camp_509ebf763e`, the player asked when the character needed to reach the Sluice. Hybrid RAG *did* retrieve Episode Turns 1–6 (*"Kira Vance offers three thousand credits, half paid upfront, for transit through the Sluice at daybreak..."*) at rank #3/#4 (`score=0.8882`).
   - However, `recall_budget_cognition_tokens = 220` paired with unconditional Rank 0 full-form admission and `personal_shard_quota = 2` in `select_cognition_recalled_items` / `pack_recalled_items_to_budget` exhausted the budget after just **2 items** (Episode 14–20 + a rib-injury shard), evicting Episode 1–6 and the character's `The Sluice Passage` shard.
   - Furthermore, Phase 3 Cognition (`run_character_cognition_agent`) receives **neither** Zone 2 episodic synopses **nor** recent Zone 3 verbatim turns, and `MemorySignificance` lacks a category for concrete deals/commitments (`"commitment"`). Seeing only Episode 14–20 (*"...remain unconfirmed"*), Phase 3 fabricated *"Sluice appointment is unlinked, unconfirmed; she never shared its timing"*, and Phase 4 Actor obeyed Phase 3's `<cognition>` over Zone 2.

This feature bundles:
1. A branch-safe, nullable **Arc Objective** system spanning authoring, Turn 0 seeding, always-on anti-paranoia prompt anchoring, Phase 5 Clerk lifecycle management, GM Mode manual overrides, GM Talk inspection, and live UI visibility.
2. A **Phase 3 Cognition Context Bridge** (epistemically-filtered Zone 2 synopsis strip, compact witnessed Zone 3 tail, rebalanced recall budget & short-first packing, and `"commitment"` `MemoryShard` extraction).

---

## 2. Core Data Model (Branch-Safe & Leaf-Layered)

### 2.1 `CharacterObjective` Schema (`backend/app/schemas/character.py`)
Define a leaf Pydantic model `CharacterObjective` (with corresponding `CharacterObjectiveSeed` or shared fields):
- `summary: str` — concise 1-sentence arc goal (sanitized via `sanitize_character_markup(..., single_line=True)`, `min_length=1`, `max_length=240`).
- `deadline_cue: str | None = None` — optional short in-world time/condition anchor (e.g., `"at daybreak"`, `"before the next Surge"`, sanitized single-line, `max_length=80`, coerced from empty/whitespace string to `None`).
- `set_at_turn_depth: int | None = None` — branch turn depth where this objective was initialized or replaced (runtime snapshot metadata; `None` when authored statically on `BaselinePsyche`).

### 2.2 Character Authoring & Runtime Snapshot Extensions
- **`BaselinePsyche.default_objective: CharacterObjective | None = None`** (in `backend/app/schemas/character.py`):
  - Optional nullable starting arc objective for Turn 0 seeding.
  - Exposed end-to-end across Character Editor (`CharacterPersonalityTab.tsx`), Character Creation Wizard (`CharacterWizardPass2LLMOutput`, `CharacterWizardLLMOutput`, SillyTavern import distiller, and genre-adaptive offline fallbacks), and `.zcc` archive import/export (`CANONICAL_CHARACTER_RECORD_KEYS`).
- **`CharacterStateSnapshot.arc_objective: CharacterObjective | None = None`** (in `backend/app/schemas/character.py`):
  - Persisted **per turn** on `character_states` (`arc_objective_json TEXT NULL` in `backend/app/db/schema.sql` + idempotent `ALTER TABLE` migration in `backend/app/db/repos/schema_init.py`).
  - Strictly branch-isolated: checkout, branching, turn deletion, and undo automatically restore the exact `arc_objective` snapshot at that turn without mutating ancestor turns or sibling branches.
- **`MemorySignificance` Extension (`backend/app/schemas/character.py`):**
  - Extend `MemorySignificance` from:
    `Literal["trauma", "bonding", "betrayal", "revelation", "vow", "consolidated"]`
    to include **`"commitment"`** for concrete agreements, deals, scheduled rendezvous, debts, and non-ritual promises (e.g., escort contracts, payment terms, agreed deadlines).

---

## 3. Turn 0 Seeding, Built-In Showcase Assets & Existing Campaigns

1. **Turn 0 Seeding (`backend/app/db/repos/campaigns.py`):**
   - When creating a campaign or adding a character to an existing campaign (`add_character_to_campaign`), initialize `arc_objective` from `character.baseline_psyche.default_objective` with `set_at_turn_depth = 0` (or the current branch leaf depth when added mid-campaign), if non-null; otherwise `arc_objective = None`.
   - Never fabricate an objective from `default_want` when `default_objective` is `None`.
2. **Showcase Seed Upgrade (`backend/app/db/seed_catalog.py`, `backend/app/db/showcase_data/the_green_lie/character.json`):**
   - Populate `baseline_psyche.default_objective` on **Yulia Halim** (`showcase:kira_vance`) grounded in her opening predicament (securing scanner-free transit through The Sluice to Sector 8 with a capable escort while keeping the stolen Veridian Accord ledger concealed).
   - Bump `SHOWCASE_CHARACTER_SEED_VERSION` from `3` → `4` in `backend/app/db/seed_catalog.py` with an updated changelog, while keeping `SHOWCASE_MEDIA_VERSION = 2` untouched so existing library users can opt in via the v0.53.0 Seed Update flow.
3. **Existing Campaigns (e.g., `camp_509ebf763e`):**
   - Legacy `character_states` rows with `arc_objective_json IS NULL` deserialize cleanly as `arc_objective = None`.
   - On the very next turn, existing campaigns immediately gain the Phase 3 Cognition Context Bridge (Zone 2 synopses + Zone 3 tail + rebalanced recall) and allow Phase 5 Clerk or GM Mode override to populate `arc_objective` cleanly.

---

## 4. Prompt Injection & Anti-Paranoia Framing

To prevent LLM recency/novelty spikes ("the system just reminded me of this, so I must obsess over it right now"):

1. **Always-On Quiet 1-Line Anchor (No On/Off Toggling):**
   - Whenever `arc_objective is not None`, inject it consistently on every turn — never conditionally hide and re-inject it when keyword references fade.
2. **Phase 3 Cognition Injection (`backend/app/engine/cognition/runner.py`):**
   - Inside `Previous Psychological State`, render:
     - `Current In-World Time`: formatted `world_timestamp` (via `describe_world_timestamp`) so deadlines can be compared against actual elapsed time.
     - `Arc Objective (background compass — pursue organically when relevant or time-pressured; do not force into unrelated turns)`: `<summary>` (plus `[Deadline/Condition: <deadline_cue>]` if set).
     - Subtle **CARE / Temperament Vigilance Cue**: derived deterministically from `character.baseline_psyche.temperament.archetype` and current CARE state (e.g., `paranoiac` / `proud_rival` keep sharper watch on schedules and leverage; `stoic` / `balanced` / `confidant` treat it as steady background direction unless time/threat pressure rises).
   - When `arc_objective is None`, render `None (no active multi-scene commitment; focus on the immediate scene and core drive)` or omit noise concisely so Cognition does not invent fake quests.
3. **Phase 4 Zone 4 Ephemeral Anchor (`backend/app/engine/context/zone4_ephemeral.py`):**
   - Include a compact 1-line `Arc Objective` line per present character inside Zone 4 (which is already ephemeral and never breaks Zone 1/Zone 2 KV-cache prefixes), keeping concrete terms/deadlines factually available to Actor Prose even when `<want>` addresses an immediate turn-level micro-beat.

---

## 5. Phase 5 Clerk Lifecycle & Anti-Churn Guardrails

### 5.1 `CharacterAgentDelta` Schema (`backend/app/schemas/turn.py`)
Add GBNF-safe flat fields (all listed in `required` via `model_config` `json_schema_extra`):
- `objective_action: Literal["keep", "set", "refine", "complete", "abandon"] = "keep"`
- `objective_summary: str | None = None` — required non-empty when `objective_action in ("set", "refine")`.
- `objective_deadline_cue: str | None = None` — optional short deadline/condition cue when `objective_action in ("set", "refine")`.
- Optional audit snapshot fields (`previous_arc_objective`, `new_arc_objective`, `objective_disruption_triggered: bool = False`) recorded on the persisted `CharacterAgentDelta` for `AgentChangesModal` diffing.

### 5.2 Anti-Churn & Disruption Rules (`backend/app/engine/char_agent/agent.py`, `backend/app/engine/clerk/pipeline.py`, `backend/app/prompts/defaults.py`)
1. **Default Stability (`"keep"`):** Prompt `DEFAULT_CHARACTER_POST_TURN_SYSTEM` explicitly directs `"keep"` on ~90%+ of routine turns; immediate scene tactics belong exclusively in `updated_want`, never in `arc_objective`.
2. **Deterministic Transition Enforcement in `pipeline.py`:**
   - **Disruption Trigger Detection:** Compute `objective_disruption_triggered` per character when any of the following holds on the turn:
     - Phase 5 World Clerk emitted a `major_event` (`world` or `location` scope), OR
     - The character's CARE state experienced a severe shock this turn (e.g., extracted `"trauma"` or `"betrayal"` memory shard, `grievance_shift == "grave_wrong"`, `goal_congruence == "strong_neg"` with `scene_threat in ("high", "critical")` or `scene_surprise in ("high", "extreme")`).
   - **`"set"`:** Allowed ONLY when prior `arc_objective is None` OR `objective_disruption_triggered` is True. If prior `arc_objective` exists and no disruption occurred, deterministically ignore `"set"` (downgrading to `"keep"`) so routine scene shifts cannot overwrite a long-term arc goal. Sets `set_at_turn_depth = completed_turn.depth_index`.
   - **`"refine"`:** Allowed when prior `arc_objective is not None`, updating `summary` and/or `deadline_cue` while preserving `set_at_turn_depth` (e.g., refining a destination or locking in a newly negotiated departure hour).
   - **`"complete"` / `"abandon"`:** Clears `arc_objective` to `None`. Characters remain at `arc_objective = None` during quiet downtime until a new concrete multi-scene commitment or goal naturally emerges.
3. **Passive Witness Disruption Wake-Up (`backend/app/engine/clerk/pipeline.py`):**
   - Co-present passive characters who would normally take the bystander fast-path MUST still run post-turn evaluation when a `major_event` occurs in their presence (or when they witness severe turn shock), so their `arc_objective` can pivot or be abandoned accurately.
4. **Narrator / Solo Preservation (`backend/app/engine/context/zone4_ephemeral.py`):**
   - `resolve_character_previous_state` MUST preserve `arc_objective` across narrator/arrival/solo turns when rewinding placeholder states, just like `active_want`, `active_plan`, and `care_state`.
5. **Heuristic Offline Fallbacks (`backend/app/engine/clerk/memories.py`, `backend/app/engine/char_agent/agent.py`):**
   - Add regex/pattern support for `"commitment"` memory extraction when `allow_offline_fallback` is active (deals, payment terms, agreed rendezvous/escort pacts), and default `objective_action = "keep"` in heuristic agent deltas.

---

## 6. Phase 3 Cognition Context Bridge (Fixing Context Blindness)

Update `run_phase3_multi_cognition` and `run_character_cognition_agent` (`backend/app/engine/cognition/runner.py`) plus recall packing (`backend/app/engine/context/zone2_episodic.py`, `backend/app/engine/cognition/heuristics.py`):

1. **Epistemically-Filtered Zone 2 Synopsis Strip (`~350` token cap):**
   - For each `EpisodicChunkRecord` on the branch (ordered chronologically), include its 1-line `synopsis_text` (`_chunk_synopsis_fallback`) ONLY if the character witnessed it (`character.id in chunk.witness_character_ids`, or—for legacy chunks with empty `witness_character_ids`—`any(was_character_present_on_turn(t, character.id) for t in chunk_turns)`).
   - Trim from oldest entries if the strip exceeds ~350 tokens so long campaigns remain bounded and KV-friendly.
2. **Compact Witnessed Zone 3 Working-Memory Tail (`~300` token cap):**
   - Take up to the last `3` unsummarized non-arrival turns (`depth_index > max_summarized_depth`) where `was_character_present_on_turn(t, character.id)` holds.
   - Sanitize user messages via `filter_user_message_for_character` so private whispers directed to other NPCs never leak into a co-present character's cognition prompt.
   - Render compact ~140-char user/speaker snippets capped at ~300 tokens total so Phase 3 sees recent dialogue leading up to the current turn.
3. **Rebalanced Recall Budget & Short-First Packing:**
   - Raise default `recall_budget_cognition_tokens` from `220` → `450` (`backend/app/config.py`, `backend/app/dependencies.py`, `backend/app/schemas/auth.py`, and frontend defaults/settings/tests), while respecting any explicit per-user override stored in `user_model_settings`.
   - Enhance `pack_recalled_items_to_budget` (via a `prefer_short_first: bool = False` option used by `select_cognition_recalled_items`): when `prefer_short_first=True` and multiple recalled items exist, reserve Rank 0 at its `short` cost (or cap Rank 0 initial reservation) so 4–5 top recalled items (`episodic_chunk`, `character_shard`, `lore`) fit in `short` form first before upgrading from Rank 0 downward with spare budget. This guarantees a single long chunk cannot starve out rank #3/#4 matches like Episode 1–6.

---

## 7. UI, GM Mode Override, GM Talk & Documentation

1. **Campaign Character Codex (`frontend/src/components/world/codexCharacter/CampaignCharacterStateTab.tsx`):**
   - Display an **Arc Objective** card directly above **Active Scene Want**, showing `arc_objective.summary`, an optional `deadline_cue` badge, and a muted `"No active arc objective"` placeholder when `None`.
   - When **GM Mode** is active, show Edit / Clear controls (using `Sparkles` / `--accent-amber` or standard neutral edit controls, reserving `--accent-rose` strictly for destructive Clear/validation errors) calling `POST /api/campaigns/{campaign_id}/characters/{character_id}/objective-override`.
2. **Backend GM Mode Override Endpoint (`backend/app/routers/campaign_routes/crud_and_state.py`, `backend/app/db/repos/turns.py`):**
   - Add `POST /api/campaigns/{campaign_id}/characters/{character_id}/objective-override` (guarded by `campaign_turn_gate` or owner auth matching `physical-state-override`, updating the active leaf turn's `character_states` snapshot + `turn_nodes` if mirrored, and returning `CampaignStateBundle`).
   - Support clearing (`summary = None` / `clear = True`) or setting/updating `summary` + `deadline_cue`, preserving `set_at_turn_depth` or stamping current leaf depth when newly set.
3. **Agent Changes Modal (`frontend/src/components/inspector/AgentChangesModal.tsx`):**
   - Display an **Arc Objective** transition row whenever `objective_action != "keep"` (with status pills for `Set`, `Refined`, `Completed`, `Abandoned` and previous/new text + deadline cue).
4. **Character Editor & Wizard (`frontend/src/components/character/CharacterPersonalityTab.tsx`, `frontend/src/components/WizardModals.tsx`):**
   - Add optional `Default Arc Objective` and `Deadline Cue` fields under Baseline Psyche (with clear helper text distinguishing multi-scene arc goal from `Default Scene Want`).
5. **Neuromancer GM Talk (`backend/app/engine/gm_talk.py`, `backend/app/engine/gm_tools.py`):**
   - Surface `arc_objective` (and `deadline_cue`) inside `_format_character_detail` and `get_campaign_entity` tool output so GM Talk can accurately answer questions about character goals.
6. **In-App Game Mechanics Codex (`frontend/src/components/world/mechanics/mechanicsCatalog.ts`, `backend/app/reference/game_mechanics_catalog.json`):**
   - Document Arc Objectives, the Phase 3 Cognition Context Bridge, `"commitment"` memories, and the updated `recall_budget_cognition_tokens = 450` default.
7. **External Wiki (`../cybercantina-wiki`, applied at merge time):**
   - Plan updates across Authoring, Playing/Mechanics, Live Inspector, Context Sizing, and Architecture pages in `PLAN.md`.

---

## 8. Acceptance Criteria

1. In a multi-episode campaign where a deal/rendezvous (`"at daybreak"`) was agreed in Turns 1–6 and 60+ turns of unrelated events/crises occurred afterward, asking about that schedule recalls the deal accurately in Phase 3 `<recall>` and Phase 4 prose.
2. Characters with an `arc_objective` keep it stable across routine micro-interactions (`objective_action == "keep"`), express it organically without forcing it into unrelated beats, and clear (`"complete"` / `"abandon"`) or pivot only on genuine completion, abandonment, `major_event`, or severe CARE shock.
3. Multi-character scenes maintain strict epistemic isolation: Phase 3 Cognition never leaks unwitnessed Zone 2 synopses or private whispers in Zone 3 tails.
4. Timeline branching, checkout, turn deletion, and GM Mode overrides preserve per-turn `arc_objective` snapshots cleanly.
5. All backend (`ruff`, `tach`, `pytest`), frontend (`arch:check`, `css:audit`, `build`, `vitest`), and architecture doc (`generate_arch_docs.py --check`) checks pass.
