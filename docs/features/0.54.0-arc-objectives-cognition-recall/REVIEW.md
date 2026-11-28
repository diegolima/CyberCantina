---
feature: arc-objectives-cognition-recall
target_version: 0.54.0
document_type: review
status: completed
last_updated: 2026-11-28
---

# Pre-Implementation Architectural Review — Arc Objectives & Phase 3 Cognition Context Bridge

## Architectural Traps & Mitigations

### 1. Pydantic v2 + 12B Local LLM JSON Grammar Trap (`CharacterAgentDelta` & Wizard Pass 2)
- **Trap:** Pydantic v2 omits fields with default values from JSON Schema `required` lists. Local Ollama / llama.cpp constrained decoders then skip optional/defaulted fields or struggle with nested optional object unions (`updated_objective: CharacterObjective | None`).
- **Mitigation:**
  - Model `CharacterAgentDelta`'s objective mutation fields as **flat, nullable primitives**: `objective_action: Literal["keep", "set", "refine", "complete", "abandon"] = "keep"`, `objective_summary: str | None = None`, `objective_deadline_cue: str | None = None`.
  - Ensure `CharacterAgentDelta.model_config["json_schema_extra"]` includes all three keys in `required` (alongside the existing required fields), and pass `required_properties` explicitly on `complete_structured` calls for both `CharacterAgentDelta` and `CharacterWizardPass2LLMOutput`.
  - Keep `CharacterWizardPass2LLMOutput` fields flat (`default_objective_summary: str | None = None`, `default_objective_deadline_cue: str | None = None`) and assemble `CharacterObjective` deterministically in `draft_pipeline.py` so 12B models never fail nested schema generation.

### 2. Anti-Paranoia & Recency/Novelty Bias in Prompts
- **Trap:** Conditionally injecting `arc_objective` only when references vanish from recent context—or adding heavy negative prompts ("NEVER obsess over your objective")—triggers LLM novelty bias and "Pink Elephant" fixation, causing characters to shoehorn their goal into every unrelated turn.
- **Mitigation:**
  - Inject `Arc Objective` **always-on** as a calm, 1-line background anchor in Phase 3 Cognition (`Previous Psychological State`) and Phase 4 Zone 4.
  - Pair it with current in-world time (`describe_world_timestamp`) and a concise temperament vigilance hint + positive framing (*"background arc compass — pursue organically when relevant or time-pressured; defer to immediate scene needs when appropriate"*).

### 3. Anti-Churn: Preventing Scene Micro-Tactics from Clobbering `arc_objective`
- **Trap:** Small or mid-sized Clerk LLMs frequently confuse immediate scene wants (*"Keep him away from the envelope"*) with strategic arc objectives, emitting `objective_action = "set"` on normal turns and overwriting the character's true arc goal.
- **Mitigation:**
  - Enforce deterministic guards in `backend/app/engine/clerk/pipeline.py` on top of prompt instructions:
    - If prior `arc_objective is not None` and `objective_disruption_triggered` is `False`, deterministically reject `"set"` (downgrading to `"keep"`).
    - Allow `"refine"` only when prior `arc_objective is not None` and `objective_summary` is non-empty, preserving `set_at_turn_depth`.
    - Reject blank/whitespace `"set"` or `"refine"` payloads (`"keep"` instead).
    - Never auto-invent a new `arc_objective` when `"complete"` or `"abandon"` clears it to `None`.

### 4. Epistemic Isolation in the Phase 3 Cognition Context Bridge
- **Trap:** Phase 2 and Phase 4 carefully isolate per-character knowledge, whereas adding Zone 2 synopses and Zone 3 turns directly into `run_character_cognition_agent` could accidentally leak off-screen events or private whispers to a co-present character.
- **Mitigation:**
  - **Zone 2 Synopsis Strip:** Filter `episodic_chunks` strictly to chunks where `character.id in chunk.witness_character_ids` (or, for legacy chunks with empty `witness_character_ids`, where at least one chunk turn satisfies `was_character_present_on_turn(t, character.id)`).
  - **Zone 3 Tail:** Filter `branch_turns` strictly to unsummarized non-arrival turns where `was_character_present_on_turn(t, character.id)` is `True`, and pass every `user_message` through `filter_user_message_for_character(..., target_character_id=character.id, campaign_characters=...)` before formatting.
  - Never pass raw `public_text` from other characters' private whispers or narrator-only solo turns that the character did not witness.

### 5. Narrator, Arrival, Solo & Passive Bystander State Continuity
- **Trap:**
  - On narrator/arrival turns, `resolve_character_previous_state` (`backend/app/engine/context/zone4_ephemeral.py`) rewinds across `"Objective / Detached"` placeholders to restore `mood_label`, `active_want`, `active_plan`, and `care_state`. Missing `arc_objective` in that rewind `model_copy` would silently wipe `arc_objective` to `None`.
  - Passive co-present bystanders normally skip the Phase 5 LLM Character Agent (`fast-path`). If a `major_event` or severe shock hits the room, fast-pathing would leave their `arc_objective` stale.
- **Mitigation:**
  - Include `"arc_objective": hist_state.arc_objective` (and fallback to `default_objective` if rewinding to baseline) inside `resolve_character_previous_state`.
  - Carry `prev_state.arc_objective` forward verbatim in the passive bystander fast-path, and bypass the fast-path whenever `world_delta.major_event is not None` or turn-level severe shock applies to co-present characters in the active location.

### 6. Recall Budget Packing Starvation (`pack_recalled_items_to_budget`)
- **Trap:** In `camp_509ebf763e` Turn 72, `pack_recalled_items_to_budget` unconditionally admitted Rank 0 in `full` form (`~140+` tokens), leaving barely enough room in `220` tokens for one `short` shard and dropping ranks #3/#4 (`Episode 1–6` and `The Sluice Passage`). Simply raising the budget from `220` to `450` helps, but a single verbose Rank 0 item could still crowd out multiple relevant items.
- **Mitigation:**
  - Raise default `recall_budget_cognition_tokens` from `220` → `450` across all config/schema/UI defaults (preserving any explicit `user_model_settings` override).
  - Add `prefer_short_first: bool = False` to `pack_recalled_items_to_budget` (enabled by `select_cognition_recalled_items`): when multiple candidates exist, reserve `short` cost across prioritized items first so up to 4–5 distinct memories are guaranteed a slot, then upgrade from Rank 0 downward to `full` using remaining spare tokens (always admitting Rank 0 in `full` if only 1 item or if budget cannot even fit Rank 0 short + 1 more).

### 7. Timeline Branching, Undo & GM Mode Override Consistency
- **Trap:** Updating `arc_objective` on a campaign-global table or mutating ancestor turns would corrupt sibling branches and Turn Replay / Undo.
- **Mitigation:**
  - Store `arc_objective_json` strictly on `character_states (turn_id, character_id)` (exact same snapshot model as `physical_stance` / `active_want`).
  - `POST /api/campaigns/{campaign_id}/characters/{character_id}/objective-override` updates only the active leaf turn's `character_states` row (guarded by `campaign_turn_gate`, matching `override_campaign_character_physical_state`), leaving earlier turns and sibling branches untouched.

### 8. Layering, Facades, Architecture Docs & `.zcc` Canonical Keys
- **Trap:**
  - Importing engine modules from `backend/app/schemas/` breaks `tach check`.
  - Adding `default_objective` to `BaselinePsyche` or `arc_objective` to `CharacterStateSnapshot` affects `.zcc` exports, `CharacterRecord` equality checks in `update_character` (`seed_modified` no-op detection!), and `generate_arch_docs.py --check` (due to the new FastAPI route).
- **Mitigation:**
  - Keep `CharacterObjective` in leaf `backend/app/schemas/character.py` (no upward imports).
  - Verify `update_character` no-op save comparison in `backend/app/db/repos/character_versions.py` accounts for `default_objective` cleanly without false-positive `seed_modified = 1`.
  - Keep `CANONICAL_CHARACTER_RECORD_KEYS` / `.zcc` campaign bundle serialization (`zcc_campaign_io.py`) aligned so exported/imported characters and campaigns round-trip `default_objective` and `arc_objective` cleanly.
  - Regenerate `docs/architecture/` via `scripts/generate_arch_docs.py` and verify `--check`.

### 9. Built-In Showcase Seed Versioning & Test Expectations
- **Trap:** Bumping `SHOWCASE_CHARACTER_SEED_VERSION` from `3` → `4` in `seed_catalog.py` may break assertions in `test_showcase_seeding_and_public_media.py` or `test_seed_asset_updates.py` if any tests hardcode `== 3`.
- **Mitigation:** Keep `SHOWCASE_MEDIA_VERSION = 2` unchanged, update `SHOWCASE_CHARACTER_SEED_VERSION = 4` in `seed_catalog.py`, and inspect/update seed version assertions in the test suite to reference `SHOWCASE_CHARACTER_SEED_VERSION` or `v4`.

### 10. Frontend Modularity, Tokens & Node-Only Vitest
- **Trap:** Vitest runs in Node without `jsdom`; inline hex colors or `!important` break `css:audit`; `mechanicsCatalog.ts` / `game_mechanics_catalog.json` parity is tested by `codexGameMechanics.test.tsx`.
- **Mitigation:**
  - Place any new CSS classes in domain stylesheets (`frontend/src/styles/07-modals-and-forms.css` / `09-codex.css` or appropriate domain sheet, keeping `15-responsive.css` last), using CSS variables from `00-tokens.css` (`--accent-amber` / `--accent-cyan` for edit/goal accents, `--accent-rose` strictly for destructive Clear / error states).
  - Update both `frontend/src/components/world/mechanics/mechanicsCatalog.ts` and `backend/app/reference/game_mechanics_catalog.json` in sync, and cover new UI components with `ReactDOMServer.renderToStaticMarkup` Vitest tests.
