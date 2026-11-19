---
feature: parties
target_version: 0.21.0
document_type: review
status: approved
last_updated: 2026-11-19
---

# Pre-Implementation Architectural Review
## Parties System — Phase 1: Empty / Solo Room Support (`v0.21.0`)

### Scope Note
This review documents architectural traps and invariants verified prior to implementing **Phase 1 (Empty / Solo Room Support)**. Phase 2 (Parties tables, `/party` commands, Party Management Modal, and party-aware `override_campaign_location`) will expand or follow up on these sections once Phase 1 passes full repository checks.

### Key Traps & Edge Cases Identified

1. **`vector_store.py` Early Return & Empty `all_present_turn_ids` Drop All Solo RAG Recall:**
   - [`search_memories_for_characters`](file:///home/diegolima/Git/cybercantina/backend/app/db/vector_store.py#L613-L735) aborts immediately when `not char_set`, builds an invalid SQL `IN (...)` shard filter when `character_ids == []`, and computes `all_present_turn_ids = set()` when `char_set` is empty—dropping world lore, location/container lore, and branch `episodic_chunk` recall inside empty rooms.
   - Fix: Only abort on `not query_text`, skip `camp_shard_rows` and `character_shard` SQL filters when `not char_set`, and set `all_present_turn_ids = valid_turns` when `not char_set`.

2. **`PreTurnAnalysis._populate_resolved_roll` Wipes Solo Dice Rolls on Reload:**
   - [`PreTurnAnalysis._populate_resolved_roll`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/turn.py#L318-L339) sets `self.resolved_roll = None` whenever `not self.character_rolls`.
   - On `"__solo__"` turns, a protagonist roll lives in `resolved_roll` (`character_id="__solo__"`) while `character_rolls` stays `{}`. Leaving that branch unguarded would erase the solo dice result as soon as a saved turn reloads from SQLite.
   - Fix: Only clear `resolved_roll` when `not self.character_rolls and self.active_speaker_id != "__solo__"`.

3. **Falsy List Fallbacks & Absent-Character Teleportation (`__narrator__` vs. `__solo__`):**
   - [`run_phase1_pre_analysis`](file:///home/diegolima/Git/cybercantina/backend/app/engine/phase1_pre.py#L809) (`room_chars = present_characters if present_characters else [character]`), [`pipeline.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/clerk/pipeline.py#L179) (re-injecting `character` into `scene_characters`), and [`turn_streaming.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/campaign_routes/turn_streaming.py#L208-L209) force `[primary_character]` into empty rooms.
   - Worse, [`turn_streaming.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/campaign_routes/turn_streaming.py#L635-L640) initializes `initial_char_state.current_location_id = active_location.id` on the turn's `character_state` snapshot even when `primary_character` was absent—affecting **both** solo turns and Narrator turns in empty rooms.
   - Fix: Distinguish explicit `[]` from `None`, introduce the `"__solo__"` `actor_id` sentinel, skip Phase 3 cognition (`roster=[]`), keep `scene_characters=[]` in Phase 5, and preserve absent `primary_character`'s true `current_location_id` from `parent_turn` on both solo and empty-room narrator turns.

4. **SQLite `actor_id` Joins & Lore Default Attribution:**
   - [`save_turn_node`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/turns.py#L65), [`get_turn_node`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/turns.py#L709), [`get_branch_turn_chain`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/turns.py#L763), [`list_campaign_turn_nodes`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/turns.py#L805), and [`_row_to_turn_node`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/turns.py#L1108) join `character_states` on `actor_id` unless `actor_id IN ('__narrator__', '__arrival__')`.
   - [`campaign_lore_items.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/campaign_lore_items.py#L111) similarly resolves `default_actor` by checking `turn_actor in ("__narrator__", "__arrival__")`.
   - Fix: Include `'__solo__'` in every sentinel guard across `turns.py`, `campaign_lore_items.py`, `zone4_ephemeral.py`, `episodic.py`, `affective/models.py`, and `char_agent/matching.py`.

5. **Episodic Witnesses & Unfiltered Solo Thread History:**
   - [`compute_episodic_chunk_witnesses`](file:///home/diegolima/Git/cybercantina/backend/app/engine/clerk/episodic.py#L39-L48) must exclude `"__solo__"` (and `"__arrival__"`) so sentinel IDs never leak into `witness_character_ids`.
   - Zone 3 history assembly in [`assembler.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/assembler.py) must retain unsummarized non-`__arrival__` turns for solo scenes instead of filtering by an absent `character.id`.

6. **Frontend `presentCharacters` Merge, False Cognition Warnings & Optional `ChatComposer` Prop:**
   - [`ChatStage.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ChatStage.tsx#L171-L183) merges `character.id` into `presentCharacters` when `bundle.present_character_ids` is `[]`, hiding solo scenes completely.
   - [`narratorCognition.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/utils/narratorCognition.ts) would trigger a false `"Skipped by Model"` alert on `"__solo__"` turns unless handled alongside `"__narrator__"` and `"__arrival__"`.
   - Adding `activeLocationName?: string` to `ChatComposer` must stay optional so existing unit tests and callers keep compiling without breaking signatures.
   - Keeping `override_campaign_location` unchanged during Phase 1 preserves backward compatibility with `test_location_override_updates_active_state_and_swipe` until Phase 2 lands party-aware overrides (`FR-2.5`).


---

## Parties System — Phase 2: Core Parties System (`v0.21.0`)

### Additional Edge Cases & Guardrails Verified
1. **Explicit Empty `parties_json` Overwriting (No Parent Resurrection):**
   - `save_turn_node` and `update_turn_post_clerk` in [`turns.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/turns.py) serialize `world_snapshot.parties` directly without falling back to the parent snapshot when `parties == []`, ensuring post-disband turns never resurrect prior party memberships.
2. **Double-Application Guard on Next-Turn `override_location_id`:**
   - [`turn_streaming.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/campaign_routes/turn_streaming.py) runs `resolve_location_override_movement` ONLY when `req.override_location_id != parent_active_loc_id`, preventing a `"Move Alone"` override applied prior to submission from re-moving left-behind party members on the subsequent turn while preserving swipe-with-override re-anchoring.
3. **Slash `/party` Before `@Character:` Whisper Decomposition:**
   - Validating and converting `/party ...` commands into `PartyActionSpec` + synthetic turn text before [`decompose_user_message`](file:///home/diegolima/Git/cybercantina/backend/app/engine/mentions.py) prevents `/party @Name` from being misparsed as a remote whisper or falling back to invite-all on typos/off-site targets.
4. **In-Character Disband Boundary (`422`) & OOC NPC-Party Management:**
   - `DELETE /api/campaigns/{campaign_id}/parties/{party_id}` rejects parties containing `"user"` with HTTP `422` (`disband_party`), guaranteeing player-party disbands always trigger an in-character turn while NPC-only parties disband immediately out-of-character.
