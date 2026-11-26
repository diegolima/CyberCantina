---
feature: tracked-location-props
target_version: 0.48.0
document_type: frd
status: completed
last_updated: 2026-11-26
---

# Feature Requirements Document — Tracked Location Props & `/search`

## 1. Overview & Motivation

CyberCantina locations currently support descriptive summaries, environmental tags, and static `lore_nodes` (including `secret` lore entries unlocked via discovery rolls). However, there is no first-class way for world authors or active campaigns to place tangible, stateful, portable **"key items"** inside rooms that:
- stay neatly separated from World Codex lore (avoiding clutter and keeping `World Codex (N)` / RAG clean);
- can be marked **hidden** until discovered by a character;
- are subtly hinted at by the neutral Narrator's **Look Around** (`/look`) when visible;
- are actively hunted via a dedicated, rolled **`/search`** character action that keeps `/look` strictly ambient and dice-free;
- optionally materialize situationally useful, strictly bounded props on `/search` Critical Successes; and
- transfer deterministically into a Player's or NPC's inventory when picked up in narrative play.

This feature introduces **Tracked Location Props** on Level 0 Locations alongside the **`/search`** command and button.

---

## 2. Data Model & Lifecycle

### 2.1 First-Class `LocationProp` Model
- **Scope:** Tracked props exist strictly on **Level 0 Locations** (`location_nodes`), never on `location_containers` (Levels 1–4).
- **Portability:** Props represent **strictly portable items**. Immovable environmental fixtures (e.g., locked wall safes, fixed terminals) remain `location_nodes` lore entries.
- **Shape (aligned 1-to-1 with `ItemInstance` in `backend/app/schemas/character.py`):**
  - `id: str` — stable unique identifier (UUID / prefixed `prop_...` ID).
  - `name: str` — item name (1–160 chars, sanitized via `sanitize_character_markup`).
  - `note: str` — brief description/clue text (0–300 chars, sanitized).
  - `flags: list[ItemFlag]` — valid item flags (`"permanent"`, `"artifact"`).
  - `lore_id: str | None` — optional link to a World-level `artifact` `LoreNode` (matching `ItemInstance.lore_id` + `"artifact"` flag invariant).
  - `is_hidden: bool = False` — whether the prop starts concealed from players/actors until discovered.
  - `auto_spawned: bool = False` — indicates runtime creation via Critical Success auto-spawn (default `False` for authored/GM props).
- **Codex & RAG Exclusion:** Because `LocationProp` is a dedicated entity rather than a `lore_nodes` row, props are automatically excluded from World Codex listings (`World Codex (N)`), GM Codex drafting, ambient lore caps, and `vector_entries` RAG indexing.
- **Post-Pickup Lifecycle:** Once picked up by the Player or a co-present NPC, the prop converts losslessly into a standard `ItemInstance` (`id`, `name`, `note`, `flags`, `lore_id`) in that character's or persona's `inventory`, and is marked claimed/removed from the room. Dropping an inventory item later does **not** recreate a tracked room prop in v1.

### 2.2 Relational Persistence (`location_props`)
Authored and campaign-map-edited props persist in a dedicated `location_props` table in `backend/app/db/schema.sql`:
- `id TEXT PRIMARY KEY`
- `world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE`
- `location_id TEXT NOT NULL REFERENCES location_nodes(id) ON DELETE CASCADE`
- `campaign_id TEXT NULL REFERENCES campaigns(id) ON DELETE CASCADE` (`NULL` for base world-authored props)
- `name TEXT NOT NULL CHECK(length(trim(name)) >= 1)`
- `note TEXT NOT NULL DEFAULT ''`
- `flags_json TEXT NOT NULL DEFAULT '[]'`
- `lore_id TEXT NULL`
- `is_hidden INTEGER NOT NULL DEFAULT 0`
- `sort_order INTEGER NOT NULL DEFAULT 0`
- Indexed on `(world_id, location_id)` and `(location_id, campaign_id)`.

### 2.3 Branch-Safe Per-Turn State (`world_state_snapshots` / `WorldStateSnapshot`)
All runtime campaign prop progression is anchored to turn snapshots so timeline branching, checkout, delete, and rewind remain lossless:
- `revealed_prop_ids` (`revealed_prop_ids_json`): IDs of hidden props that have been discovered (or GM-revealed) on this branch.
- `claimed_prop_ids` (`claimed_prop_ids_json`): IDs of props picked up or removed from the room on this branch.
- `spawned_props` (`spawned_props_json`): list of runtime-created `SpawnedLocationProp` records (`LocationProp` + `location_id: str`), covering both Crit auto-spawns and GM-added runtime props on a branch.
- `location_search_last_turn_depth` (`location_search_last_turn_depth_json`): `dict[str, int]` mapping `location_id -> turn.depth_index` of the most recent `/search` executed in that room on this branch.
- `auto_spawned_prop_location_ids` (`auto_spawned_prop_location_ids_json`): list of `location_id`s that have already received a Crit auto-spawn on this branch.

For any `location_id` at a given turn snapshot:
- **Effective room props** = `(base/map-edited props for location_id) + (spawned_props for location_id)` excluding any ID in `claimed_prop_ids`.
- A prop is **visible** iff `not prop.is_hidden or prop.id in revealed_prop_ids`.

---

## 3. `/look` vs. `/search` Mechanics, Discovery & Cooldowns

### 3.1 Narrator `/look` (`narrative_mode="describe"`)
- `/look` remains **strictly ambient, objective, and dice-free** (`dice_mode="disabled"`, `mechanics_check.requires_roll=False`).
- Zone 4 injects currently **visible** (non-hidden + already-revealed uncollected) props in the active room, instructing the Narrator to weave them naturally into the scene description as environmental hints.
- Hidden, unrevealed props are **never** injected into `/look` prompts.

### 3.2 New `/search [optional focus]` Character Action
- **In-world action:** Unlike `/look`, `/search` is an active player-character inspection turn.
  - When co-present NPCs are in the room, it runs as a normal multi-character turn (NPCs witness the search and may react via CARE/cognition).
  - When the room is empty, it runs as a solo turn (`__solo__`) narrating the search and its outcome.
- **Anti-leakage fixed roll:**
  - `/search` **always** triggers a Perception/Investigation mechanics check at fixed **DC 12 (`DEFAULT_GATE_DC`)**, even if the room has zero props (visible or hidden).
  - Even if the composer's `dice_mode` is `"disabled"`, `/search` promotes `dice_mode` to `"forced"` so the roll always occurs and never leaks whether hidden props exist.
  - If the player supplies an explicit pinned manual d20 value (`dice_mode="forced"` + `manual_dice_override`), that roll value is respected—**however, pinned manual d20 rolls cannot trigger Crit auto-spawns unless GM Mode (`unlock_lore`) is active**.
- **Unified discovery + freeform prose parity:**
  - Rolling `Clean Success` or `Critical Success` on `/search` unlocks:
    1. Hidden props (`is_hidden=True`) in the active location (adding their IDs to `revealed_prop_ids`).
    2. Hidden `secret` location/container `lore_nodes` (via `lore_scope.py`).
    3. Hidden secret `location_edges` (`select_newly_discovered_secret_edges`).
  - Normal freeform prose that triggers and passes a discovery roll (`Clean Success` / `Critical Success`) in Phase 1 also unlocks hidden props in the active location.
  - Crit auto-spawn (Section 4) is **exclusive to `/search`**.
  - Discovering a hidden prop via `/search` marks it revealed in the room rather than auto-looting it into inventory (unless the narrative prose clearly shows picking it up).

### 3.3 5-Turn Per-Room Cooldown & GM Mode Bypass
- **Cooldown rule:** On a branch, if `(next_turn_depth - last_search_depth) < 5` for the active `location_id` (where `next_turn_depth = parent_turn.depth_index + 1`), `/search` is on cooldown for that room.
- **No movement reset:** Leaving the room (including via Location Override) and returning does **not** clear `location_search_last_turn_depth[location_id]`.
- **GM Mode bypass:** When `campaign.world_settings.unlock_lore` (GM Mode) is `True`, all `/search` cooldown restrictions are bypassed (and `/search` does not get blocked on the UI or backend).
- **Enforcement:**
  - Frontend disables the `/search` toolbar button and slash item with a tooltip displaying remaining turns until available; moving to a non-cooldown room or toggling GM Mode immediately re-enables `/search`.
  - Backend enforces the same cooldown guard in `turn_streaming.py` (`HTTPException(status_code=409, ...)` if `!unlock_lore` and room is on cooldown).

---

## 4. Critical Success Auto-Spawn Props

### 4.1 Settings Toggle
- Add `auto_spawn_props_on_search_crit: bool = False` to `WorldGlobalRules` (`backend/app/schemas/world.py`, **off by default**).
- Copy into `CampaignWorldSettings` (`backend/app/schemas/turn.py`) upon campaign creation and expose via `PATCH /api/campaigns/{campaign_id}/world-settings` (`CampaignWorldSettingsUpdatePayload`).

### 4.2 Strict Eligibility Criteria
A Crit auto-spawn runs **if and only if all** of the following hold on a `/search` turn:
1. `campaign.world_settings.auto_spawn_props_on_search_crit` is `True`.
2. The `/search` roll outcome tier is `"Critical Success"`.
3. The roll was **not** a pinned manual d20 override (unless GM Mode `unlock_lore` is `True`).
4. The active location currently has **0 uncollected props** (neither visible nor hidden authored/spawned props remain unclaimed in the room).
5. `active_location.id` is **not** in `parent_turn.world_snapshot.auto_spawned_prop_location_ids` (strict **once-ever per location** cap on this timeline branch).

### 4.3 Bounded Generation & Timing
- **Pipeline position:** Runs immediately after Phase 1 (when eligibility passes) and **before** Phase 4 prose generation, so the Narrator/Actor can seamlessly describe finding the newly spawned prop in the same turn.
- **Model & Schema:** Uses the **Clerk** model (`complete_structured` with explicit `required_properties`) grounded in the active location's description/tags and the last 2–3 turns of branch prose.
- **Hard power boundaries:**
  - Constrained to `PropTier = Literal["clue", "mundane_tool", "minor_consumable", "improvised_aid"]`.
  - Prompt & deterministic `@model_validator` / keyword guardrails forbid firearms/high-tier weapons, master keys/universal bypasses, large currency hoards, or plot-breaking magical/sci-fi relics.
  - Deterministic, genre-adaptive offline fallback when LLM is unavailable or returns invalid/disallowed output (derived from `WorldGlobalRules.genre`, never hardcoded to a single genre).
- Newly spawned prop is appended to `spawned_props` (with `auto_spawned=True`, `is_hidden=False`), `active_location.id` is recorded in `auto_spawned_prop_location_ids`, and the prop is injected into Zone 4 for Phase 4 narration.

---

## 5. Prompt Visibility & Room -> Inventory Pickup Transfer

### 5.1 Zone 4 Visibility (`zone4_ephemeral.py`)
- Currently visible, unclaimed props (`not is_hidden or id in revealed_prop_ids`, excluding `claimed_prop_ids`) are lightly listed in Zone 4 on **all** turns (with `id`, `name`, and `note`) so the Player and co-present NPCs can reference or pick them up naturally.
- On `/look` (`narrative_mode="describe"`), Zone 4 adds an explicit environmental hint cue highlighting visible props.
- On `/search`, Zone 4 indicates the search roll outcome and explicitly marks any **newly revealed** or **newly auto-spawned** props on this turn so Phase 4 prose describes discovering them (and refrains from fabricating hidden props on failed rolls).
- Discovered hidden props remain revealed (`revealed_prop_ids`) in the room on that branch until picked up.

### 5.2 Phase 5 Clerk Pickup Claims & Single-Owner Arbitration
- Inject the active location's **visible, unclaimed props** (`id`, `name`, `note`) into Phase 5 Clerk (`engine/clerk/pipeline.py`).
- Extend `PostTurnStateDelta` (`backend/app/schemas/turn.py`) with:
  - `claimed_props: list[PropClaim]` where `PropClaim` has `prop_id: str` and `holder_id: Literal["player"] | str` (`"player"` or a co-present `character_id`).
- **Hard Validation & Gating:**
  - Only `prop_id`s that belong to the active room's *currently visible, unclaimed* props are accepted (preventing unrevealed hidden props from being silently looted on a non-discovery turn).
  - `holder_id` must be `"player"` or a co-present NPC `character_id`.
- **Single-Owner Arbitration:** If multiple characters or both Player and NPC appear to claim the same `prop_id` on the same turn, arbitrate deterministically (or via Clerk inventory arbitration) to a single winner so unique props are never duplicated.
- **Lossless Inventory Conversion & Deduplication:**
  - Convert the claimed `LocationProp` into an `ItemInstance(id=prop.id, name=prop.name, note=prop.note, flags=prop.flags, lore_id=prop.lore_id)` and add it to the holder's `inventory` (`persona_turn_states` for `"player"`, `character_states` for NPC).
  - Suppress any redundant raw `inventory_added` string emitted by the Clerk on the same turn that matches the claimed prop's name (`item_names_match_word_bounded`) so inventories never receive duplicates.
  - Record `prop.id` in `claimed_prop_ids` on the turn's `WorldStateSnapshot`.
- **Offline Heuristic Fallback (`heuristics.py`):** Support deterministic pickup detection when running without an LLM Clerk.

---

## 6. UI, GM Mode & Ecosystem Contracts

### 6.1 Map Editor & Live Map Drawer (`MapDetailsDrawer.tsx`)
- Add a dedicated **"Props (N)"** collapsible/tabbed section on **Level 0 Locations only** (never on Containers), visually separate from Location Lore.
- **Authoring / Map Edit Mode:** Add, edit, reorder, and delete props (`name`, `note`, `is_hidden` toggle, optional `flags` / link to a World `artifact` `lore_id`).
- **Live Campaign Inspector Mode:**
  - When GM Mode (`unlock_lore`) is **OFF**: display only currently visible (non-hidden + revealed) unclaimed props; completely hide unrevealed `is_hidden` props so the player receives zero metadata leakage.
  - When GM Mode (`unlock_lore`) is **ON**: show all unclaimed props (with a clear `"Hidden"` / `"Revealed"` / `"Auto-spawned"` badge) plus controls to **Reveal/Hide**, **Add/Edit/Delete** runtime props, and **Transfer to Player/NPC** directly.

### 6.2 `ChatComposer.tsx` & `/search` Controls
- Register `/search` alphabetically in `SLASH_COMMANDS` (`frontend/src/utils/slashCommands.ts`) with optional focus argument (`/search [focus]`).
- Add a dedicated **`Search`** action button in `ChatComposer.tsx` (distinct from the Narrator dropdown so `/look` remains clearly under Narrator and `/search` is clearly a character inspection action).
- When the active room is on its 5-turn cooldown (and GM Mode is OFF), disable both the `/search` toolbar button and `/search` slash availability with a clear tooltip/reason (e.g., `"Search on cooldown in this room (3 turns remaining)"`). Switching to another room or enabling GM Mode immediately updates availability.

### 6.3 World Settings UI (`WorldInspectorModal.tsx`)
- Add **"Auto-spawn situational props on /search Critical Success"** toggle (off by default) to both World Global Rules (World editor) and live Campaign World Settings.

### 6.4 Ecosystem Integration
- **`.zcc` Export/Import (`import_export_service.py`, `zcc_campaign_io.py`):** Export and import `location_props` and all new `world_state_snapshots` prop/search fields with backwards-compatible defaults for older `.zcc` archives.
- **Neuromancer GM Talk (`gm_talk.py`, `gm_tools.py`):** Read-only awareness of room props respecting hidden/GM Mode visibility gating (`unlock_lore`).
- **Game Mechanics Codex & Wiki:** Update `mechanicsCatalog.ts` (`frontend/src/components/world/mechanics/mechanicsCatalog.ts`) and plan end-user updates in `../cybercantina-wiki` (deferred until merge).

---

## 7. Explicit Non-Goals (v1)
- Props attached to Level 1–4 `location_containers`.
- Non-portable (`portable: false`) interactive room fixtures.
- Re-creating tracked room props when a player/NPC drops an item from inventory.
- AI World Wizard generation of default room props or modifications to built-in seed worlds.
- Neuromancer GM Talk proposal mutations for props (read-only awareness only in v1).
