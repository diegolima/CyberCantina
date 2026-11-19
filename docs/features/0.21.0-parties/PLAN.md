---
feature: parties
target_version: 0.21.0
document_type: plan
status: completed
last_updated: 2026-11-19
---

# Execution Plan — Parties System (`v0.21.0`)

**Feature Spec:** [FRD.md](file:///home/diegolima/Git/cybercantina/docs/features/0.21.0-parties/FRD.md)  
**Architectural Review:** [REVIEW.md](file:///home/diegolima/Git/cybercantina/docs/features/0.21.0-parties/REVIEW.md)

## Phase 1: Empty / Solo Room Support (Prerequisite) — Completed

- [x] **1. Schemas & Persistence Layer**
  - [x] Update `PreTurnAnalysis._populate_resolved_roll` in `backend/app/schemas/turn.py` to retain `resolved_roll` when `active_speaker_id == "__solo__"` and `character_rolls == {}`.
  - [x] Add `"__solo__"` to all sentinel checks in `backend/app/db/repos/turns.py` (`save_turn_node`, `get_turn_node`, `get_branch_turn_chain`, `list_campaign_turn_nodes`, `_row_to_turn_node`, and nullable `character_id` on `save_episodic_chunk` / `asave_episodic_chunk`).
  - [x] Update `default_actor` fallback in `backend/app/db/repos/campaign_lore_items.py`.
  - [x] Update `search_memories_for_characters` in `backend/app/db/vector_store.py` to support empty `character_ids=[]` (skipping `character_shard` filters while returning world/location/container lore and branch episodic chunks).

- [x] **2. Backend Turn Engine & Streaming Route**
  - [x] Update `run_phase1_pre_analysis` (`backend/app/engine/phase1_pre.py`) for explicit `present_characters=[]`, `"__solo__"` active speaker, empty `speaker_order`, Solitary Action Guard preservation, and solo `auto`/`forced` dice resolution.
  - [x] Add `build_zone1_solo_system_prompt` in `backend/app/engine/context/zone1_static.py` and re-export in `context/__init__.py` + `phase2_context.py`.
  - [x] Update `backend/app/engine/context/zone4_ephemeral.py`, `assembler.py`, and `zone2_episodic.py` for solo prompt framing, `"__solo__"` rewind fallback, unfiltered Zone 3 thread history, and `"__solo__": "Narrator"` labels.
  - [x] Update `backend/app/engine/phase4_prose.py` (`is_solo`) for live streaming sentinel and offline solo simulation.
  - [x] Update `backend/app/engine/clerk/pipeline.py`, `episodic.py`, `affective/models.py`, and `char_agent/matching.py` for `is_solo_turn`, empty `scene_characters`, World Clerk + remote `@Character:` comms whispers, witness exclusion, witness-safe nullable vector `character_id`, and `"__solo__"` alias handling.
  - [x] Update `backend/app/routers/campaign_routes/turn_streaming.py` to stop forcing `[primary_character]`, route `is_solo` turns through the `"__solo__"` pipeline, skip Phase 3 cleanly, preserve absent `primary_character.current_location_id` on both solo and empty-room narrator turns, and guard private recall leakage.

- [x] **3. Frontend Solo-Room UI**
  - [x] Add `isSolo?: boolean` to `LiveStreamState` in `frontend/src/types/turn.ts`.
  - [x] Add `isSoloTurnNode` / `isLiveStreamSolo` and skip-warning suppression in `frontend/src/utils/narratorCognition.ts`.
  - [x] Track `isSolo` state and Phase 1 stream label in `frontend/src/hooks/useCampaignTurnActions.ts`.
  - [x] Fix `presentCharacters` memo, empty `choices` tray handling, `"Alone in {location}"` header, and `activeLocationName` prop in `frontend/src/components/ChatStage.tsx`.
  - [x] Update `ChatComposer.tsx` (solo placeholder, disabled `Choices` button) and `DirectorChoicesDrawer.tsx` (empty guard).
  - [x] Update `TurnCard.tsx` and `LiveStreamingTurnCard.tsx` to omit empty `<cognition>` drawers / absent speaker headers on solo turns, display a `Solo Scene` badge, and render solo roll badges cleanly.

- [x] **4. Automated Tests & Verification Matrix**
  - [x] Add `backend/tests/test_empty_room_solo_turns.py`.
  - [x] Update `frontend/src/utils/__tests__/narratorCognition.test.ts` and create `frontend/src/components/__tests__/emptyRoomSolo.test.tsx`.
  - [x] Run `cd backend && .venv/bin/ruff check app tests && .venv/bin/tach check && .venv/bin/pytest tests`.
  - [x] Run `npm --prefix frontend run arch:check && npm --prefix frontend run build && npm --prefix frontend test`.
  - [x] Run `backend/.venv/bin/python scripts/generate_arch_docs.py && backend/.venv/bin/python scripts/generate_arch_docs.py --check`.

## Phase 2: Core Parties System (`v0.21.0`) — Completed

- [x] **1. Leaf Schemas, Pure Party Engine & Module Layering**
  - [x] Create leaf `backend/app/schemas/party.py` (`USER_PARTY_MEMBER_ID`, `PartyRecord`, `PartyActionSpec`, `PartyInviteOutcome`, `PartyEventDelta`, enums/types) and extend `character.py` + `turn.py`.
  - [x] Create pure deterministic `backend/app/engine/parties.py` (Model 1 strict co-location splitting, single-party disjointness, random NPC leader election, lifecycle mutations, longest-prefix `@Name` slash command parser/validator, Zone 4 / Phase 3 renderers) and register in `backend/tach.toml`.

- [x] **2. SQLite Persistence, Legacy Migration & Repositories**
  - [x] Add `parties_json TEXT NOT NULL DEFAULT '[]'` to `world_state_snapshots` in `schema.sql` with idempotent migration in `schema_init.py`.
  - [x] Persist explicit empty `parties` snapshots cleanly in `turns.py` (`save_turn_node`, `update_turn_post_clerk`, branch hydration).
  - [x] Extend `campaigns.py` (`start_in_party_character_ids`), `clerk_placement.py`, and `campaign_spatial.py` (`override_campaign_location`, `override_character_location`, `create_npc_party`, `disband_party`).

- [x] **3. Backend Turn Pipeline & API Routes**
  - [x] Extend `choices.py`, `phase1_pre.py`, `engine/context/{zone2_episodic,zone4_ephemeral,assembler}.py` (leaving `zone1_static.py` immutable), `engine/cognition/{heuristics,runner}.py`, `phase4_prose.py`, `engine/char_agent/agent.py`, and `engine/clerk/pipeline.py`.
  - [x] Add `/characters/{character_id}/location-override`, `POST /parties`, `DELETE /parties/{party_id}` (`422` on player party), and update `/campaigns`, `/location-override`, and `/turns[/stream]` in `routers/campaign_routes/`.

- [x] **4. Frontend Types, Pure Helpers & Party UI**
  - [x] Create `frontend/src/types/party.ts`, extend `character.ts`, `mechanics.ts`, `turn.ts`, create `frontend/src/utils/{partyHelpers,partyCommand}.ts`, and wire `api/campaigns.ts` + `useCampaignTurnActions.ts`.
  - [x] Add `AppSidebar.tsx` `Party` navigation button below `Codex`, `PartyManagementModal.tsx`, `LocationOverrideButton.tsx` (split button in `InspectorLocationCard.tsx` and `MapDetailsDrawer.tsx`), `CharacterRow.tsx` / `CampaignCharacterModal.tsx` party pills & relocation control, `ChatStage.tsx` / `ChatComposer.tsx` `/party` autocomplete & blocking warnings + quick-exit phrasing, `TurnCard.tsx` / `AgentChangesModal.tsx` party badges/deltas, and `NewCampaignModal.tsx` `"Start in Party"` checkboxes.

- [x] **5. Verification & Documentation**
  - [x] Add `backend/tests/test_parties.py` and align `test_location_override_affects_next_turn_and_swipe` + `test_independent_character_spatial_transitions`.
  - [x] Add `frontend/src/utils/__tests__/{partyCommand,partyHelpers}.test.ts` and `frontend/src/components/__tests__/partyUi.test.tsx`.
  - [x] Regenerate `docs/architecture/` (`generate_arch_docs.py --check`) and update `../cybercantina-wiki` pages.
