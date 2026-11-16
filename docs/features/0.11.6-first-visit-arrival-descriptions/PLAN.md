---
feature: first-visit-arrival-descriptions
target_version: 0.11.6
document_type: plan
status: completed
last_updated: 2026-11-16
---

# Implementation Plan (`v0.11.6`)

1. [x] **Schemas & DB Columns:**
   - Add `describe_on_first_visit: bool = True` to `WorldGlobalRules` (`backend/app/schemas/world.py`, `frontend/src/types/world.ts`).
   - Add `CampaignWorldSettings`, `FirstVisitDescriptionCard`, `first_visit_cards` on `PostTurnStateDelta`, `visited_container_ids` on `WorldStateSnapshot`, and `world_settings` on `CampaignRecord` (`backend/app/schemas/turn.py`, `frontend/src/types/turn.ts`).
   - Update `backend/app/db/schema.sql` and `backend/app/db/repos/schema_init.py` (`campaigns.world_settings_json`, `world_state_snapshots.visited_container_ids_json`).
2. [x] **Shared Backend Arrival Resolver (`backend/app/db/repos/arrival_descriptions.py`):**
   - Implement boilerplate/empty description filtering, ancestor container ordering (`outer → inner`), `visited_container_ids` derivation/merge, and `build_first_visit_cards(...)`.
3. [x] **Turn 0, Repo Persistence & Campaign Map Moves:**
   - Update `backend/app/db/repos/campaigns.py` (`create_campaign`, `get_campaign`, `list_campaigns`, `update_campaign_world_settings`) to snapshot/persist `world_settings`, seed Turn 0 `visited_container_ids`, and attach Turn 0 `first_visit_cards` per `start_focus` + `{location_description}` fallback rules.
   - Update `backend/app/db/repos/turns.py` to persist/read `visited_container_ids_json` and handle `actor_id = "__arrival__"` in SQL joins/cognition checks.
   - Update `backend/app/db/repos/campaign_spatial.py` (`override_campaign_location`) to create a standalone `actor_id = "__arrival__"` turn node carrying `first_visit_cards` when `describe_on_first_visit` is on and cards qualify.
4. [x] **Clerk Pipeline, Context Isolation & Router Endpoint:**
   - Update `backend/app/engine/clerk/pipeline.py` to attach `first_visit_cards` onto `PostTurnStateDelta` and update `visited_container_ids` on move while excluding `__arrival__` turns from episodic chunking.
   - Update `backend/app/engine/context/assembler.py` (Zone 3) and `zone4_ephemeral.py` (`resolve_character_previous_state`) to skip `__arrival__` rows cleanly.
   - Add `PATCH /api/campaigns/{campaign_id}/world-settings` in `crud_and_state.py`, `schemas_and_gate.py`, and re-export on `campaign_routes/__init__.py` & `routers/campaigns.py` (+ `start_focus` forwarded into `create_campaign`).
5. [x] **Frontend API, World Settings Modal & Campaign Entry Point:**
   - Add `campaignsApi.updateWorldSettings` (`frontend/src/api/campaigns.ts`), wire handler in `useCampaignTurnActions.ts` / `App.tsx`, and add a **World Sheet** button in `LiveInspector.tsx` / `AppModals.tsx`.
   - Add **World Settings** tab (`Describe on First Visit` toggle) and `mode="campaign"` support (read-only world rules/lore, independent campaign settings save) in `WorldInspectorModal.tsx`.
6. [x] **Frontend Arrival Card UI, Collapse Lifecycle & Styling:**
   - Create `frontend/src/components/chat/arrivalHelpers.ts` and `ArrivalDescriptionCards.tsx`.
   - Render attached `post_turn.first_visit_cards` and standalone `actor_id === "__arrival__"` rows in `TurnCard.tsx` & `ChatStage.tsx` (distinct `.arrival-turn-card` / `.arrival-cards-panel` styles in `styles.css`, latest-turn auto-expand + collapse-on-next-turn reset, non-scrolling arrival update, leaf delete allowed on standalone arrival rows with Edit/Swipe hidden).
7. [x] **Verification & Architecture Sync:**
   - Add backend tests (`backend/tests/test_first_visit_descriptions.py`) and frontend tests (`frontend/src/components/__tests__/firstVisitDescriptions.test.tsx`).
   - Run `ruff check app tests`, `tach check`, `pytest tests`, `npm --prefix frontend run arch:check && build && test`, and `scripts/generate_arch_docs.py` + `--check`.
