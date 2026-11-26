---
feature: tracked-location-props
target_version: 0.48.0
document_type: review
status: completed
last_updated: 2026-11-26
---

# Pre-Implementation Review — Tracked Location Props & `/search`

## Key Architectural Traps & Mitigations

### 1. Zero Information Leakage on `/search` & Hidden Prop Redaction
- **Trap:** If `/search` only rolls when hidden props exist, uses a variable DC tied to prop existence, skips rolling when composer `dice_mode == "disabled"`, or serializes unrevealed hidden props into player-visible API payloads / `gm_talk.py` without gating, savvy players (or browser DevTools / GM Talk queries) can infer hidden items exist in a room.
- **Mitigation:**
  - Always trigger a Perception/Investigation roll at fixed `DEFAULT_GATE_DC` (`12`) on `/search`, even when the active location has 0 props.
  - In `turn_streaming.py` / `phase1_pre.py`, promote `dice_mode="disabled"` to `"forced"` specifically for `/search` turns so dice cannot be suppressed to probe rooms silently.
  - Gate hidden prop visibility in `gm_talk.py` and `gm_tools.py` on `unlock_lore` (matching `lore_nodes` `secret` gating) and keep unrevealed `is_hidden` props visually hidden in `MapDetailsDrawer` unless `unlock_lore` (GM Mode) is enabled. (Note: when authoring/editing a base World or when GM Mode is active, authors/GMs can inspect all props.)

### 2. Branch-Safe 5-Turn Cooldown & Anti-Override Exploit
- **Trap:** Storing a mutable `search_cooldown` column on `location_nodes` or an in-memory dictionary breaks timeline branching, rewind (`checkout`), and turn deletion—and resetting cooldown on room exit allows players to bounce back and forth via **Location Override** (`override_campaign_location`) to reset the cooldown.
- **Mitigation:**
  - Persist `location_search_last_turn_depth_json` (`dict[str, int]`) directly inside `world_state_snapshots` (copied forward across turns on the active branch).
  - Compute remaining cooldown purely from `(parent_turn.depth_index + 1) - last_depth < 5` (never reset when leaving/re-entering a location or overriding location).
  - Bypass the cooldown check entirely when `campaign.world_settings.unlock_lore` is `True` (GM Mode), and enforce the guard in both the frontend (`slashCommands.ts` + `ChatComposer.tsx`) and backend (`turn_streaming.py` returning HTTP `409`).

### 3. Crit Auto-Spawn Power Creep & Pydantic v2 Local LLM JSON Grammar
- **Trap:** Asking a small local model (e.g., 12B Ollama/llama.cpp) for a "useful but balanced prop" via negative prompt instructions often fails ("Pink Elephant" weapons/master keys) or produces omitted/blank JSON keys because Pydantic v2 fields with default values are left out of `required` in JSON Schema. Additionally, checking only "current room props == 0" allows infinite farming once a player picks up the spawned prop, and allowing pinned `d20=20` manual rolls to trigger Crit auto-spawns turns manual dice into an item printer.
- **Mitigation:**
  - Pass `required_properties=list(schema_cls.model_fields.keys())` to `complete_structured` (`backend/app/engine/llm_client.py`).
  - Constrain output with `PropTier = Literal["clue", "mundane_tool", "minor_consumable", "improvised_aid"]`, sanitize text deterministically via Pydantic `@model_validator`s, and run a deterministic forbidden-item check (rejecting firearms/weapons, master keys, currency hoards, etc., falling back to a safe genre-adaptive item).
  - Never hardcode cyberpunk items in the fallback—resolve defaults from `WorldGlobalRules.genre` (matching CyberCantina's genre-adaptive fallback invariant).
  - Require **all** gates before spawning: `auto_spawn_props_on_search_crit == True`, `outcome_tier == "Critical Success"`, not a pinned manual d20 (unless GM Mode), 0 uncollected props currently in the room, and `active_location.id` not in `auto_spawned_prop_location_ids`.

### 4. Phase 5 Clerk Claim Reconciliation & Inventory Duplication
- **Trap:** In Phase 5 (`backend/app/engine/clerk/pipeline.py`), the Clerk already extracts freeform `inventory_added` strings for characters and the player persona. If the Clerk emits both a `claimed_props` entry for `"Tarnished Brass Key"` and `"brass key"` in `inventory_added`, the holder gets two copies; conversely, if the Clerk hallucinates claiming an unrevealed hidden prop or two actors claim the same prop on the same turn, state integrity breaks.
- **Mitigation:**
  - Inject only **visible, unclaimed** room props with exact `id` and `name` into Phase 5 Clerk context, and reject any `PropClaim.prop_id` not in that visible/unclaimed set.
  - Deduplicate `claimed_props` by `prop_id` using single-owner arbitration (respecting existing `arbitrate_inventory_disputes_detailed` rules) so only one holder receives the `ItemInstance`.
  - Strip matching entries from `inventory_added` via `item_names_match_word_bounded` (`backend/app/engine/character_agent.py`) before applying `merge_inventory` / `ItemInstance` updates, and preserve facade re-exports in `backend/app/engine/phase5_clerk.py`.

### 5. Map Editing, Copy-on-Write & Prop ID Stability
- **Trap:** During `update_world` or live `update_campaign_map` (`backend/app/db/repos/campaign_map_update.py`), regenerating prop IDs on save would break `revealed_prop_ids`, `claimed_prop_ids`, and `spawned_props` references in `world_state_snapshots`, or silently wipe props when `topologyProjection.ts` constructs clean payloads.
- **Mitigation:**
  - Preserve client-supplied `LocationProp.id` across `update_world` and `update_campaign_map` (generating IDs only when missing/blank), and ignore stale IDs cleanly in runtime snapshot reconciliation if an authored prop is deleted.
  - Include `props` in `topologyProjection.ts` projection, dirty-state comparison, and `useTopologyMutations.ts` location cloning/updates.
  - Validate `lore_id` references cleanly (or clear dangling `lore_id` if a linked World `artifact` LoreNode is deleted).

### 6. SQLite Schema Migration & `.zcc` Backwards Compatibility
- **Trap:** Existing `cybercantina.db` databases and older `.zcc` world/campaign archives lack the `location_props` table, `world_state_snapshots` prop/cooldown columns, and `auto_spawn_props_on_search_crit` in `global_rules_json` / `world_settings_json`.
- **Mitigation:**
  - Add `CREATE TABLE IF NOT EXISTS location_props` and `ALTER TABLE world_state_snapshots ADD COLUMN ...` migrations idempotently in `backend/app/db/repos/schema_init.py`.
  - Use safe defaults (`[]` / `{}` / `False`) in `turns.py`, `WorldGlobalRules`, `CampaignWorldSettings`, and `zcc_campaign_io.py` so legacy DB rows and `.zcc` files import seamlessly without errors.

### 7. Frontend Layering, Node-Only Vitest & CSS Audit Compliance
- **Trap:** `frontend/package.json` runs Vitest in Node without `jsdom`, `arch:check` (`.dependency-cruiser.cjs`) forbids upward imports from `types/` or `utils/`, and `css:audit` rejects `!important` and invalid token usage. Additionally, `MapDetailsDrawer.tsx` restricts Level-0-only features from appearing on Level 1–4 containers.
- **Mitigation:**
  - Define `LocationProp`, `SpawnedLocationProp`, and updated `CampaignWorldSettings` / `WorldStateSnapshot` types in `frontend/src/types/` (leaf layer).
  - Keep `/search` cooldown calculation and slash availability helpers pure inside `frontend/src/utils/slashCommands.ts` so they unit-test directly under Node Vitest and `ReactDOMServer.renderToStaticMarkup`.
  - Render the **"Props"** editor/inspector section strictly for `selectedLocation` (Level 0) in `MapDetailsDrawer.tsx`, never for `selectedContainer`.
  - Place composer/prop UI styles in `frontend/src/styles/05-composer-and-slash.css` and map drawer style files using `00-tokens.css` variables without `!important`.

### 8. Solo vs. Multi-Character `/search` Execution
- **Trap:** In `turn_streaming.py`, turns with `present_characters == []` take the `is_solo` branch (`__solo__`), whereas turns with co-present NPCs run Phase 3 cognition (`phase3_actor`). If `/search` is routed as a Narrator action (`is_narrator`), it would skip Phase 1 rolls and NPC reactions; if it assumes NPCs are always present, solo rooms would crash.
- **Mitigation:**
  - Route `/search` as a **character action** (not `is_narrator`), setting a dedicated flag/directive so both `is_solo` and multi-character paths execute Phase 1 (forced DC 12 Perception/Investigation roll), Phase 4 prose narration of the search, and Phase 5 Clerk state persistence.
  - Ensure `phase4_prose.py` (`is_solo`) receives the `/search` roll outcome, newly revealed/auto-spawned props, and search focus so solo room searches narrate discoveries accurately without inventing unrevealed items on failures.
