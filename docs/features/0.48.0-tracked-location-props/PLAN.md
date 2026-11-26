---
feature: tracked-location-props
target_version: 0.48.0
document_type: plan
status: completed
last_updated: 2026-11-26
---

# Implementation Plan — Tracked Location Props & `/search`

## Step 1: Feature Spec Package
- [x] Create isolated worktree `.worktrees/tracked-location-props` on branch `feat/tracked-location-props`
- [x] Author `FRD.md` (`docs/features/TBD-tracked-location-props/FRD.md`)
- [x] Author `REVIEW.md` (`docs/features/TBD-tracked-location-props/REVIEW.md`)
- [x] Author `PLAN.md` (`docs/features/TBD-tracked-location-props/PLAN.md`)

## Step 2: Database Schema, Migrations & Pydantic Contracts
- [x] Update `backend/app/db/schema.sql`:
  - Add `location_props` table + indexes (`world_id`, `location_id`, `campaign_id`)
  - Add `revealed_prop_ids_json`, `claimed_prop_ids_json`, `spawned_props_json`, `location_search_last_turn_depth_json`, and `auto_spawned_prop_location_ids_json` columns to `world_state_snapshots`
- [x] Update `backend/app/db/repos/schema_init.py` with idempotent migrations (`CREATE TABLE IF NOT EXISTS location_props`, `ALTER TABLE world_state_snapshots ADD COLUMN ...`)
- [x] Update `backend/app/schemas/world.py`:
  - Add `LocationProp` (aligned with `ItemInstance` fields + `is_hidden`, `auto_spawned`) and `props: list[LocationProp]` on `LocationNode`
  - Add `auto_spawn_props_on_search_crit: bool = False` to `WorldGlobalRules`
- [x] Update `backend/app/schemas/turn.py`:
  - Add `SpawnedLocationProp`, `PropClaim`, `PropTier`
  - Add prop/cooldown fields to `WorldStateSnapshot`, `CampaignWorldSettings.auto_spawn_props_on_search_crit`, `PostTurnStateDelta.claimed_props`, and `PreTurnAnalysis.is_search_action` (or equivalent search metadata)
- [x] Update repositories (`backend/app/db/repos/{world_locations,worlds,turns,campaigns,campaign_spatial,campaign_map_update,campaign_lore_items}.py`) to load, persist, copy, and reconcile `location_props` and `world_state_snapshots` prop/cooldown fields cleanly (including `LocationProp.id` stability on map updates and effective visible-prop helpers)

## Step 3: Turn Pipeline — `/search`, Fixed DC 12 Roll, Cooldown, Discovery & Crit Auto-Spawn
- [x] Update `backend/app/routers/campaign_routes/schemas_and_gate.py` & `backend/app/routers/campaign_routes/turn_streaming.py`:
  - Parse `/search [optional focus]` (or request flag) as a non-narrator character search action
  - Enforce 5-turn per-room cooldown (`(next_depth - last_depth) < 5` -> HTTP `409`) unless GM Mode (`unlock_lore`) is enabled
  - Record `location_search_last_turn_depth[active_location.id] = turn_depth` in the saved `WorldStateSnapshot`
- [x] Update `backend/app/engine/phase1_pre.py`:
  - Force a Perception/Investigation roll at fixed `DEFAULT_GATE_DC` (`12`) on `/search` turns, promoting `dice_mode="disabled"` to `"forced"` so rolling/DC never leaks prop presence
  - Track whether a roll used a pinned manual d20 override
- [x] Create Clerk-model Crit auto-spawn generator module (with `required_properties` JSON schema, `PropTier` bounds, deterministic sanitization/weapon/master-key/hoard guardrails, and genre-adaptive offline fallback)
- [x] Update `backend/app/engine/context/{lore_scope,zone4_ephemeral,assembler}.py` & `backend/app/engine/phase4_prose.py`:
  - Unlock hidden props in active location on Clean/Critical Success from `/search` or freeform discovery rolls
  - Trigger pre-Phase-4 Crit auto-spawn only when all eligibility gates pass (`auto_spawn_props_on_search_crit`, Crit Success, non-pinned or GM Mode, 0 uncollected props in room, location not in `auto_spawned_prop_location_ids`)
  - Inject visible/revealed unclaimed props into Zone 4 on all turns, highlight them as hints on `/look`, and mark newly revealed/spawned props on `/search` (solo + multi-character)

## Step 4: Phase 5 Clerk Prop Pickup Claims, Arbitration & Heuristics
- [x] Update `backend/app/engine/clerk/{pipeline,inventory,heuristics}.py` and preserve facade exports in `backend/app/engine/phase5_clerk.py`:
  - Inject active room's visible, unclaimed props (`id`, `name`, `note`) into Phase 5 Clerk
  - Validate `PostTurnStateDelta.claimed_props` strictly against visible/unclaimed room props and valid holders (`"player"` or co-present `character_id`)
  - Arbitrate competing claims to a single owner, convert claimed `LocationProp` -> `ItemInstance` into holder's inventory, deduplicate overlapping `inventory_added` strings, and record claimed IDs in `claimed_prop_ids`
  - Add offline heuristic pickup fallback in `heuristics.py`

## Step 5: API Routes, GM Overrides, GM Talk Awareness & `.zcc` Import/Export
- [x] Update `backend/app/routers/campaign_routes/{crud_and_state,spatial_routes,schemas_and_gate}.py` & `backend/app/routers/worlds.py`:
  - Accept/return `auto_spawn_props_on_search_crit` on world/campaign settings endpoints
  - Expose GM Mode runtime prop endpoints/actions (reveal/hide, add/edit/delete runtime prop, manual transfer to Player/NPC inventory)
  - Redact unrevealed `is_hidden` props from player-facing live state when GM Mode (`unlock_lore`) is off (or ensure consistent client/API gating without breaking base world editing)
- [x] Update `backend/app/engine/{gm_talk,gm_tools}.py` for read-only room prop awareness respecting `is_hidden` / `unlock_lore` gating
- [x] Update `backend/app/services/{import_export_service,zcc_campaign_io}.py` for backwards-compatible `.zcc` world & campaign export/import of `location_props` and new snapshot columns

## Step 6: Frontend Types, API Clients & `/search` Slash Command + Composer Button
- [x] Update `frontend/src/types/` (`world.ts`, `turn.ts`, `slash.ts` / `index.ts`) with `LocationProp`, `SpawnedLocationProp`, snapshot prop/cooldown fields, and `auto_spawn_props_on_search_crit`
- [x] Update `frontend/src/api/{campaigns,worlds}.ts` for world/campaign settings and GM prop actions
- [x] Update `frontend/src/utils/slashCommands.ts`:
  - Add `search` alphabetically in `SLASH_COMMANDS` (`/search [optional focus]`)
  - Add pure cooldown helper (`getLocationSearchCooldownRemaining` / availability check respecting GM Mode)
- [x] Update `frontend/src/components/chat/ChatComposer.tsx`, `frontend/src/hooks/useCampaignTurnActions.ts`, and `frontend/src/styles/05-composer-and-slash.css`:
  - Add dedicated `/search` toolbar/action button alongside Narrator menu
  - Disable `/search` button & slash item with remaining-turn cooldown tooltip when active room is on cooldown, immediately re-enabling on room change or GM Mode activation

## Step 7: Frontend Map Editor / Live Map Drawer Props UI & World Settings Toggle
- [x] Update `frontend/src/components/map/{MapDetailsDrawer.tsx,topologyProjection.ts,useTopologyMutations.ts,mapValidation.ts}` and map styles:
  - Add dedicated **"Props (N)"** section strictly on Level 0 Locations (`selectedLocation`), separate from Location Lore
  - Support add/edit/delete, `is_hidden`, `note`, `flags`, and optional World `artifact` `lore_id` linking in Map Editor
  - In live campaign drawer: hide unrevealed `is_hidden` props when GM Mode is OFF; expose Reveal/Hide, Add/Edit/Delete, and Transfer-to-Player/NPC controls when GM Mode is ON
- [x] Update `frontend/src/components/world/WorldInspectorModal.tsx` to expose **"Auto-spawn situational props on /search Critical Success"** in World Rules and Campaign World Settings

## Step 8: In-App Game Mechanics Codex & Planned Wiki Updates
- [x] Update `frontend/src/components/world/mechanics/mechanicsCatalog.ts` (and `frontend/src/types/mechanics.ts` + contextual `MechanicsHelpButton` if needed) to document Tracked Location Props, `/search` vs. `/look`, 5-turn per-room cooldown, Crit auto-spawn setting, and pickup transfer
- [x] Record planned `../cybercantina-wiki` updates (to be applied, reviewed, and committed at merge time):
  - `../cybercantina-wiki/Authoring-Worlds-Characters-and-Personas.md` — Authoring Level 0 location props, hidden flag, World `artifact` lore linking, and default `auto_spawn_props_on_search_crit` world rule
  - `../cybercantina-wiki/Playing-Directing-and-Mechanics.md` — Document `/search [focus]` vs. ambient `/look`, fixed DC 12 discovery roll, 5-turn per-room cooldown, Crit auto-spawn rules, and picking up room props
  - `../cybercantina-wiki/Live-Inspector-Map-and-Timeline.md` — Document Live Map Drawer Props section, GM Mode reveal/edit/transfer overrides, and campaign world setting toggle
  - `../cybercantina-wiki/Importing-and-Exporting.md` — Note `.zcc` archival support for `location_props` and prop snapshot state
  - `../cybercantina-wiki/Architecture-Turn-Pipeline.md` — Update Phase 1 (`/search` forced roll), pre-Phase-4 Crit auto-spawn, and Phase 5 Clerk `claimed_props` arbitration
  - `../cybercantina-wiki/Architecture-Context-Memory-and-State.md` — Update `location_props`, `world_state_snapshots` prop/cooldown fields, and Zone 4 prop injection

## Step 9: Unit & Integration Tests
- [x] Backend pytest coverage in `backend/tests/`:
  - Schema & migration compatibility for `location_props` and `world_state_snapshots` columns
  - `/search` fixed DC 12 roll (even on empty rooms & `dice_mode="disabled"`), freeform discovery parity, and secret lore/edge unlocking
  - 5-turn per-room cooldown enforcement (survives Location Override exit/re-entry), branch rewind/checkout isolation, and GM Mode bypass
  - Crit auto-spawn eligibility (setting toggle, non-pinned roll guard, 0-prop room check, once-ever cap, `PropTier` bounds, genre-adaptive offline fallback)
  - Phase 5 Clerk `claimed_props` validation, single-owner arbitration, `ItemInstance` conversion, `inventory_added` deduplication, and heuristic fallback
  - Hidden prop redaction in player-facing state / `gm_talk.py`, GM override actions, and `.zcc` world/campaign export-import round-trip
- [x] Frontend Vitest coverage in `frontend/src/`:
  - `slashCommands.ts` alphabetical ordering, `/search` parsing, and pure cooldown availability helper
  - `ChatComposer.tsx` `/search` button disabled/enabled states across cooldowns, room changes, and GM Mode
  - `MapDetailsDrawer.tsx` Level-0-only Props section (hidden redaction vs. GM Mode controls, absent on Containers)
  - `WorldInspectorModal.tsx` `auto_spawn_props_on_search_crit` toggle & `mechanicsCatalog.ts` coverage

## Step 10: Architecture Docs & Final Verification Gates
- [x] Regenerate and verify architecture docs inside `.worktrees/tracked-location-props`:
  `backend/.venv/bin/python scripts/generate_arch_docs.py && backend/.venv/bin/python scripts/generate_arch_docs.py --check`
- [x] Run full verification gates inside `.worktrees/tracked-location-props`:
  - Backend: `cd backend && .venv/bin/ruff check app tests && .venv/bin/tach check` and `backend/.venv/bin/pytest backend/tests`
  - Frontend: `npm --prefix frontend run arch:check && npm --prefix frontend run css:audit && npm --prefix frontend run build && npm --prefix frontend test`
- [x] Mark `FRD.md`, `REVIEW.md`, and `PLAN.md` `status: completed` with all boxes checked upon completion
