---
feature: first-class-map-links
target_version: 0.37.0
document_type: frd
status: completed
last_updated: 2026-11-24
---

# Feature Requirements Document (FRD)
## First-Class Map Links: Element Inspector, Speed Modifiers, Obstacles, Blocked & Secret Discovery

**Status:** Completed (`v0.37.0`)  
**Target Version:** CyberCantina v0.37.0  
**Depends On:**
- [v0.36.0 Metric Spatial Edge Distances](file:///home/diegolima/Git/cybercantina/docs/features/0.36.0-metric-spatial-distances/FRD.md)
- [v0.31.0 Campaign Lore, GM Mode & Major Events](file:///home/diegolima/Git/cybercantina/docs/features/0.31.0-campaign-lore-gm-mode-and-major-events/FRD.md)
- [v0.32.0 GM Talk](file:///home/diegolima/Git/cybercantina/docs/features/0.32.0-gm-talk/FRD.md)
- [v0.10.0 Interactive Spatial Topology Map Editor](file:///home/diegolima/Git/cybercantina/docs/features/0.10.0-interactive-map-editor/FRD.md)

**Expected Scope:**
- **Backend Schema, Persistence & Migration:**
  - [`backend/app/db/schema.sql`](file:///home/diegolima/Git/cybercantina/backend/app/db/schema.sql), [`backend/app/db/repos/schema_init.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/schema_init.py), [`backend/app/db/seed.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/seed.py), [`backend/app/db/showcase_data/the_green_lie/world.json`](file:///home/diegolima/Git/cybercantina/backend/app/db/showcase_data/the_green_lie/world.json)
  - [`backend/app/db/repos/worlds.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/worlds.py), [`backend/app/db/repos/world_locations.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/world_locations.py), [`backend/app/db/repos/campaign_spatial.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/campaign_spatial.py), [`backend/app/db/repos/campaign_map_update.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/campaign_map_update.py), [`backend/app/db/repos/turns.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/turns.py)
  - [`backend/app/services/import_export_service.py`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py), [`backend/app/services/zcc_campaign_io.py`](file:///home/diegolima/Git/cybercantina/backend/app/services/zcc_campaign_io.py)
- **Backend Schemas, Routes, Prompts & Simulation Engine:**
  - [`backend/app/schemas/world.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/world.py), [`backend/app/schemas/turn.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/turn.py)
  - [`backend/app/routers/campaign_routes/schemas_and_gate.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/campaign_routes/schemas_and_gate.py), [`backend/app/routers/campaign_routes/spatial_routes.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/campaign_routes/spatial_routes.py), [`backend/app/routers/campaign_routes/turn_streaming.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/campaign_routes/turn_streaming.py)
  - [`backend/app/engine/phase1_pre.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/phase1_pre.py), [`backend/app/engine/context/lore_scope.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/lore_scope.py), [`backend/app/engine/context/assembler.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/assembler.py), [`backend/app/engine/context/zone4_ephemeral.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/zone4_ephemeral.py)
  - [`backend/app/engine/clerk/pipeline.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/clerk/pipeline.py), [`backend/app/engine/clerk/heuristics.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/clerk/heuristics.py)
  - [`backend/app/engine/gm_talk.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/gm_talk.py), [`backend/app/engine/gm_tools.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/gm_tools.py)
  - [`backend/app/prompts/defaults.py`](file:///home/diegolima/Git/cybercantina/backend/app/prompts/defaults.py), [`backend/app/wizards/world_wizard.py`](file:///home/diegolima/Git/cybercantina/backend/app/wizards/world_wizard.py)
- **Frontend Types, API, Helpers & UI Components:**
  - [`frontend/src/types/world.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/world.ts), [`frontend/src/types/turn.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/turn.ts), [`frontend/src/api/campaigns.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/api/campaigns.ts), [`frontend/src/utils/spatialDistance.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/utils/spatialDistance.ts), [`frontend/src/components/world/worldDraftMappers.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/worldDraftMappers.ts)
  - [`frontend/src/components/SpatialTopologyView.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/SpatialTopologyView.tsx), [`frontend/src/components/map/SpatialTopologyCanvas.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/SpatialTopologyCanvas.tsx), [`frontend/src/components/map/MapDetailsDrawer.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDetailsDrawer.tsx), [`frontend/src/components/map/topologyProjection.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/topologyProjection.ts), [`frontend/src/components/map/useTopologyMutations.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/useTopologyMutations.ts), [`frontend/src/components/map/MapDialogs.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDialogs.tsx), [`frontend/src/components/map/PortalPromotionModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/PortalPromotionModal.tsx)
  - [`frontend/src/components/chat/ChatComposer.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/ChatComposer.tsx), [`frontend/src/components/inspector/InspectorLocationCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/inspector/InspectorLocationCard.tsx)
  - [`frontend/src/styles/`](file:///home/diegolima/Git/cybercantina/frontend/src/styles/06-inspector-and-lore.css)
- **User-Facing Wiki Documentation:** [`../cybercantina-wiki`](file:///home/diegolima/Git/cybercantina-wiki/Home.md) (`Authoring-Worlds-Characters-and-Personas.md`, `Live-Inspector-Map-and-Timeline.md`, `Playing-Directing-and-Mechanics.md`, `Importing-and-Exporting.md`)

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
With `v0.36.0`, map links (`location_edges`) now carry physical metric separation (`distance_meters`), separating geography from fixed walking time. However, links remain second-class map primitives compared to Locations and Containers:

1. **Fragmented Editing UX:** Links cannot be selected and inspected in `MapDetailsDrawer` like Locations or Containers. Their properties are split across an inline canvas distance badge editor, a right-click context menu, and a separate `MultiEdgePopover` dialog.
2. **Walking-Only Travel Time:** Every route assumes `70 m/min` (`4.2 km/h`) flat walking speed. There is no way to model slow terrain (swamp, rubble, steep stairs) or fast transit (mounts, vehicles, maglev/rail), and Phase 5 Clerk treats exit duration as an advisory hint rather than anchoring the world clock.
3. **No Route Hazards / Obstacles:** Authors have no concise structured way to attach route hazards (e.g., `laser grid`, `flooded floor`, `toll checkpoint`) to a connection without bloating room descriptions.
4. **Conflated `is_locked_or_hidden` Flag:** A single boolean merges two fundamentally different mechanics—**visibility** (hidden/secret passage) and **passability** (blocked/sealed route)—and always leaks hidden passages into Zone 4 exits, player exit lists, and the campaign map.

### 1.2 Proposed Solution
Elevate map links to **first-class inspectable elements** inside `MapDetailsDrawer` (modeled as unified **Link Pairs** with per-direction labels, and a bundle list view for collapsed container edges that retires `MultiEdgePopover`), introducing:
- **`speed_modifier`** (float multiplier relative to `70 m/min` walking) + optional **`travel_mode`** label and genre-neutral presets, driving live UI speed/time readouts, mode-aware LLM exit phrasing, and a deterministic Phase 5 Clerk elapsed-time floor on movement.
- **`obstacles`** (capped keyword chips via `TagChipsInput`) injected into Zone 4 exits for visible links.
- **`is_blocked`** and **`is_secret`** replacing `is_locked_or_hidden`, with branch-safe secret link discovery persisted on `WorldStateSnapshot.revealed_edge_ids` (mirroring `revealed_lore_ids`), same-turn discovery roll reveals, diceless & GM-Mode fallbacks, and strict spoiler gating across the map, exit lists, Zone 4 context, and GM Talk.

---

## 2. Scope, Boundaries & Core Invariants

1. **Unified Link Pair Inspector Invariant:**
   - Single-clicking a link on the map canvas selects it and opens its properties in `MapDetailsDrawer` (matching locations and containers). Quick-distance editing remains available via the distance badge or inside the inspector.
   - Bidirectional connections (`A → B` and `B → A`) are inspected and edited as a single **Link Pair**: `distance_meters`, `speed_modifier`, `travel_mode`, `obstacles`, `is_blocked`, and `is_secret` stay synchronized across both directions, while `A → B` and `B → A` `direction_label` values remain individually editable.
   - Clicking an aggregated supernode bundle (`isAggregated && passagePairCount > 1`) opens a bundle link list inside `MapDetailsDrawer`, letting the user drill into any constituent Link Pair (retiring `MultiEdgePopover`).
2. **Speed Modifier & Travel Time Math Invariant:**
   - Canonical base speed remains `WALKING_METERS_PER_MINUTE = 70` (`4.2 km/h`).
   - `speed_modifier` is a positive finite float clamped to **`[0.05, 100.0]`** (default `1.0`).
   - Effective speed: `effective_mpm = 70.0 * speed_modifier` (`effective_kmh = 4.2 * speed_modifier`).
   - Derived integer travel minutes: `max(1, int(distance_meters / (70.0 * speed_modifier) + 0.5))` (matched identically in Python and TypeScript). Sub-30-second transitions (`distance_meters / (70.0 * speed_modifier) < 0.5`) display as `"< 1 min"`.
   - When `transition_type == "move_existing"` in Phase 5 Clerk, the traversed link's derived travel minutes acts as a **deterministic floor** on `elapsed_minutes` (`max(clerk_elapsed, min(MAX_TURN_ELAPSED_MINUTES_SANITY, derived_travel_minutes))`), so terrain and transit speeds reliably advance the world clock while still allowing the LLM to add extra time for lingering, dialogue, or combat.
3. **Replacement of `is_locked_or_hidden` & Safe Legacy Migration Invariant (Hard):**
   - `is_blocked: bool = False` and `is_secret: bool = False` replace `is_locked_or_hidden` across `location_edges`, Pydantic models, API payloads, and TypeScript types.
   - Existing SQLite databases (`schema_init.py`), legacy `.zcc` archives, and JSON/LLM payloads carrying `is_locked_or_hidden: true` (without explicit `is_blocked`/`is_secret`) migrate losslessly to **`is_blocked = True, is_secret = False`** so existing visible locked exits never unexpectedly vanish.
   - Built-in showcase data (`the_green_lie/world.json`) is explicitly audited and assigned accurate `is_blocked` vs. `is_secret` values.
4. **Branch-Safe Secret Discovery & Spoiler Gating Invariant (Hard):**
   - Secret link discovery is never mutated directly on `location_edges`. Discovered secret connections are persisted per-turn-snapshot on `WorldStateSnapshot.revealed_edge_ids` (monotonically accumulated along the active branch, mirroring `revealed_lore_ids`).
   - Discovering one direction of a secret link (`A → B`) automatically reveals its reciprocal (`B → A`) on that branch.
   - CoW edge supersession during live campaign edits (which mints a new `edge_id`) **must preserve reveal state** for already-discovered secret links (via canonical endpoint-pair matching and/or remapping superseded IDs in `revealed_edge_ids`) so editing a discovered secret link never re-hides it.
   - **Undiscovered secret links must never leak** into:
     - Player-mode campaign map edges or supernode bundle counts/min-max distance ranges/tooltips (`!unlock_lore`).
     - Player-facing exit lists (`ChatComposer` quick exits, `InspectorLocationCard` minimap/exits).
     - Phase 1 / Phase 2 / Zone 4 / Phase 5 LLM context (until discovered on that turn or an earlier ancestor turn).
     - GM Talk / GM Tools when GM Mode (`unlock_lore`) is off.
   - **Player-mode map save preservation:** When `PUT /api/campaigns/{campaign_id}/map` executes with `unlock_lore = False`, any undiscovered secret edges omitted from the player's client payload are **preserved untouched** server-side and never treated as deletions.
5. **Campaign Mutability & Permission Boundary Invariant:**
   - **World Editor:** All link fields (`distance_meters`, `speed_modifier`, `travel_mode`, `obstacles`, `is_blocked`, `is_secret`, direction labels) are freely editable.
   - **Active Campaign (Player Mode, `unlock_lore = False`):** Operational link fields (`distance_meters`, `speed_modifier`, `travel_mode`, `obstacles`, `is_blocked`, direction labels) are editable branch-safely via CoW supersession. `is_secret` edits and manual Reveal/Hide actions are rejected (`403 Forbidden`).
   - **Active Campaign (GM Mode, `unlock_lore = True`):** All link fields plus manual Reveal/Hide (`POST /api/campaigns/{campaign_id}/edges/{edge_id}/reveal`) are unlocked.

---

## 3. Functional Requirements

### FR-1: Database Schema, Startup Migration & Showcase Audit
- **`location_edges` DDL (`backend/app/db/schema.sql`):**
  - Replace `is_locked_or_hidden INTEGER NOT NULL DEFAULT 0` with:
    - `speed_modifier REAL NOT NULL DEFAULT 1.0`
    - `travel_mode TEXT NULL`
    - `obstacles_json TEXT NOT NULL DEFAULT '[]'`
    - `is_blocked INTEGER NOT NULL DEFAULT 0`
    - `is_secret INTEGER NOT NULL DEFAULT 0`
- **`world_state_snapshots` DDL (`backend/app/db/schema.sql`):**
  - Add `revealed_edge_ids_json TEXT NOT NULL DEFAULT '[]'`.
- **Idempotent Startup Migration (`backend/app/db/repos/schema_init.py`):**
  - Inspect `PRAGMA table_info(location_edges)`:
    - If legacy `is_locked_or_hidden` exists or new columns (`speed_modifier`, `travel_mode`, `obstacles_json`, `is_blocked`, `is_secret`) are missing, rebuild `location_edges` safely under `PRAGMA foreign_keys = OFF` inside a transaction (preserving `idx_location_edges_from` and FK cascades), mapping `is_blocked = COALESCE(is_locked_or_hidden, 0)`, `is_secret = 0`, `speed_modifier = 1.0`, `travel_mode = NULL`, `obstacles_json = '[]'`.
  - Inspect `PRAGMA table_info(world_state_snapshots)`:
    - If `revealed_edge_ids_json` is missing, `ALTER TABLE world_state_snapshots ADD COLUMN revealed_edge_ids_json TEXT NOT NULL DEFAULT '[]'`.
- **Showcase World (`the_green_lie/world.json` & `seed.py`):**
  - Audit all 6 previously `is_locked_or_hidden: true` link pairs in `the_green_lie/world.json` (assigning `is_blocked` for sealed/gated checkpoints such as Meridian Gate / Valve Station and `is_secret` for concealed/hidden passages such as Drowned Reliquary / Sump-Well / Mid-Web where lore-appropriate; add `speed_modifier`/`travel_mode` on Mag-Lev transit links if fitting).
  - Preserve `SHOWCASE_SEED_VERSION = 2` in `backend/app/db/seed.py` while updating edge hydration to read the new fields (with legacy `is_locked_or_hidden` → `is_blocked` fallback).

### FR-2: Backend Schemas, Constants, Validation & `.zcc` Compatibility
- **Constants & Helpers (`backend/app/schemas/world.py`):**
  - `MIN_EDGE_SPEED_MODIFIER = 0.05`, `MAX_EDGE_SPEED_MODIFIER = 100.0`, `DEFAULT_EDGE_SPEED_MODIFIER = 1.0`.
  - `MAX_EDGE_OBSTACLES = 6`, `MAX_EDGE_OBSTACLE_LENGTH = 48`, `MAX_EDGE_TRAVEL_MODE_LENGTH = 40`.
  - `normalize_edge_speed_modifier(raw: Any) -> float`: clamps finite positive floats into `[0.05, 100.0]`, falling back to `1.0`.
  - `normalize_edge_obstacles(raw: Any) -> list[str]`: strips HTML/control whitespace, deduplicates case-insensitively, trims to `MAX_EDGE_OBSTACLE_LENGTH`, caps at `MAX_EDGE_OBSTACLES`.
  - `derive_travel_minutes(distance_meters: int, speed_modifier: float = 1.0) -> int`: `max(1, int(distance_meters / (WALKING_METERS_PER_MINUTE * safe_mod) + 0.5))` (keep `derive_walking_minutes` as a thin wrapper calling `derive_travel_minutes(distance_meters, 1.0)` for backward compatibility).
  - `format_travel_duration(distance_meters: int, speed_modifier: float = 1.0) -> str`: `"< 1 min"` when `distance_meters / (70.0 * safe_mod) < 0.5`, else `"~{m} min"` / `"~{h}h"` / `"~{h}h {rem}min"`.
  - `format_exit_travel_phrase(distance_meters: int, speed_modifier: float = 1.0, travel_mode: str | None = None) -> str`:
    - When `travel_mode` is set (non-empty): e.g., `"~3 min via Rail"` or `"~18 min via Swamp / Difficult Terrain"` (or `"{dur} ({travel_mode})"` — concise, natural English for LLMs).
    - When `travel_mode` is `None` and `abs(speed_modifier - 1.0) < 0.01`: `"{dur} walk"`.
    - When `travel_mode` is `None` and `speed_modifier != 1.0`: `"{dur} travel"`.
- **Pydantic Models (`backend/app/schemas/world.py`, `backend/app/schemas/turn.py`):**
  - Update `LocationEdgeDraft`, `LocationEdge`, and `NeighborLocationView`:
    - Add `speed_modifier: float = Field(default=1.0, ge=0.05, le=100.0)`
    - Add `travel_mode: str | None = Field(default=None, max_length=40)`
    - Add `obstacles: list[str] = Field(default_factory=list)`
    - Replace `is_locked_or_hidden: bool` with `is_blocked: bool = False`, `is_secret: bool = False`.
    - Add `is_discovered: bool = True` (or `is_revealed_secret: bool = False`) on `NeighborLocationView` if useful for UI/telemetry badges; keep `@model_validator(mode="before")` coercing legacy `is_locked_or_hidden` into `is_blocked` when `is_blocked`/`is_secret` are absent.
  - Update `CANONICAL_LOCATION_EDGE_KEYS` in `backend/app/schemas/world.py` to include the new fields and keep `is_locked_or_hidden` as a recognized legacy migration key (no spurious import warnings).
  - Add `revealed_edge_ids: list[str] = Field(default_factory=list)` to `WorldStateSnapshot` (`backend/app/schemas/turn.py`).
- **Import / Export (`import_export_service.py`, `zcc_campaign_io.py`):**
  - Export all new edge fields (`speed_modifier`, `travel_mode`, `obstacles`, `is_blocked`, `is_secret`) and snapshot `revealed_edge_ids`.
  - On import of legacy `.zcc` bundles lacking `is_blocked`/`is_secret`, map `is_locked_or_hidden` → `is_blocked` (`is_secret = False`), default `speed_modifier = 1.0`, `travel_mode = None`, `obstacles = []`, and `revealed_edge_ids = []`.

### FR-3: Backend Repositories & Campaign API Endpoints
- **Unified Campaign Edge Update (`PATCH /api/campaigns/{campaign_id}/edges/{edge_id}`):**
  - Evolve `CampaignEdgeDistanceUpdateRequest` (keep backward-compatible alias/fields so existing distance-only callers keep working) into `CampaignEdgeUpdateRequest` supporting optional fields:
    - `distance_meters: int | None`
    - `speed_modifier: float | None`
    - `travel_mode: str | None` (with explicit sentinel / `clear_travel_mode` or `model_fields_set` check so callers can clear `travel_mode` back to `None`)
    - `obstacles: list[str] | None`
    - `is_blocked: bool | None`
    - `is_secret: bool | None` *(requires GM Mode `unlock_lore = True`; raises `403 PermissionError` otherwise)*
    - `direction_label: str | None` *(updates the targeted directed edge only)*
    - `reciprocal_direction_label: str | None` *(updates the reciprocal directed edge only)*
    - `update_reciprocal: bool = True`
  - CoW supersession in `campaign_spatial.py` updates the targeted edge (and its reciprocal for shared link-pair fields) on `active_leaf_turn_id` and **remaps any matching old edge IDs inside the active snapshot's `revealed_edge_ids`** to the newly minted edge IDs so editing a discovered secret link never re-hides it.
- **Manual Secret Link Reveal Toggle (`POST /api/campaigns/{campaign_id}/edges/{edge_id}/reveal`):**
  - Request: `CampaignEdgeRevealRequest(revealed: bool)` (mirrors `POST /api/campaigns/{campaign_id}/lore/{lore_id}/reveal`).
  - Requires GM Mode (`unlock_lore = True`; returns `403` otherwise).
  - Adds or removes **both** `edge_id` and its reciprocal edge ID in the active turn's `world_state_snapshots.revealed_edge_ids_json` (branch-safe) and returns the updated `CampaignStateBundle`.
- **Campaign Map Bulk Save (`PUT /api/campaigns/{campaign_id}/map` in `campaign_map_update.py`):**
  - Persists all new edge fields on added/updated edges.
  - Enforces GM-Mode gate: when `not unlock_lore`:
    - Any attempt to toggle `is_secret` on an existing visible edge or create a new `is_secret=True` edge raises `PermissionError` (`403`).
    - Any existing **undiscovered secret edges** on the active branch that were omitted from the player-mode client payload are **automatically preserved** (never superseded/deleted).
  - Carries forward `revealed_edge_ids` across CoW edge supersessions.
- **Campaign State & Neighbor Filtering (`turns.py`, `world_locations.py`):**
  - Inherit and monotonically merge `revealed_edge_ids` across parent/child turns in `turns.py` (exact mirror of `revealed_lore_ids`).
  - In `get_campaign_state`:
    - Build `effective_revealed_edge_ids` (matching by exact ID **or** canonical endpoint-pair key against any revealed edge on the branch so CoW IDs stay resilient).
    - Filter `neighbors` (exits from `active_location`) to exclude undiscovered secret edges (`edge.is_secret and not is_revealed`).
    - Filter `world_edges`: when `not unlock_lore`, exclude undiscovered secret edges completely from the response; when `unlock_lore`, include them (the frontend reads `active_turn.world_snapshot.revealed_edge_ids` to style undiscovered vs. discovered secret links).
    - Also expose `revealed_edge_ids` on `WorldStateSnapshot` in `CampaignStateBundle`.

### FR-4: Secret Link Discovery Pipeline, Zone 4 Context, Clerk Floor & GM Talk
- **Same-Turn Secret Link Discovery (`phase1_pre.py`, `lore_scope.py`, `turn_streaming.py`, `assembler.py`, `clerk/pipeline.py`):**
  - Load **all** active edges from `active_location` internally (`all_neighbors`), partitioned into:
    - `visible_neighbors`: non-secret edges + already-revealed secret edges (passed to Phase 1 so Phase 1 never leaks undiscovered secrets as known exits!).
    - `undiscovered_secret_neighbors`: secret edges not yet in `prior_revealed_edge_ids`.
  - **Discovery Evaluation (between Phase 1 and Phase 2, mirroring `select_contextual_lore`):**
    - Add a pure deterministic helper `select_newly_discovered_secret_edges(...)` (in `lore_scope.py` or a dedicated spatial helper):
      1. **Dice enabled (`dice_mode != "disabled"`):** Unlock an undiscovered secret edge on the current turn when Phase 1 resolves at least one succeeding roll (`Clean Success` or `Critical Success`) and **either**:
         - The roll is a discovery/search/investigate/perception roll (`_DISCOVERY_CHECK_STEMS`), **or**
         - The roll's description/skill matches keywords extracted from the secret edge's `direction_label` or `obstacles` (or destination name).
         - Failed-only rolls never reveal secret edges.
      2. **Diceless play (`dice_mode == "disabled"`):** Unlock an undiscovered secret edge when the player's message expresses explicit search/inspection/investigation intent (matching `_DISCOVERY_CHECK_STEMS` or explicit reference to the secret edge's obstacle/direction keywords) — with a deterministic check in Phase 1/2 so diceless campaigns are never soft-locked.
  - **Same-Turn Injection into Zone 4 (`zone4_ephemeral.py`):**
    - Combine `effective_neighbors = visible_neighbors + newly_discovered_secret_neighbors`.
    - Render each exit cleanly:
      - Standard: `- [N] Iron Door -> Boiler Room (Steam-choked basement) [35m, < 1 min walk]`
      - With speed/mode: `- [E] Mag-Lev Platform -> Central Hub (...) [4.2km, ~2 min via Rail]`
      - With obstacles: `[..., obstacles: laser grid, flooded floor]`
      - With blocked: `[... | BLOCKED]`
      - Newly discovered on this turn: `[... | NEWLY DISCOVERED SECRET PASSAGE]` (with a brief directive so Phase 4 prose narrates uncovering it naturally).
    - Previously discovered secret links render as normal visible exits (no longer hidden).
  - **Persistence in Phase 5 Clerk (`clerk/pipeline.py`):**
    - Merge `newly_discovered_secret_edge_ids` **plus their reciprocal edge IDs** into `updated_world_snapshot.revealed_edge_ids`, persisting them monotonically on the branch.
- **Deterministic Travel-Time Floor in Phase 5 Clerk (`clerk/pipeline.py`, `clerk/heuristics.py`):**
  - Update Clerk `neighbor_options` prompt line to show `{format_distance_meters(n.distance_meters)}, {format_exit_travel_phrase(n.distance_meters, n.speed_modifier, n.travel_mode)}` plus obstacles / `BLOCKED` status.
  - When `world_delta.transition_type == "move_existing"` and `world_delta.target_location_id` matches a neighbor `nb`:
    - Compute `min_travel_minutes = derive_travel_minutes(nb.distance_meters, nb.speed_modifier)` (or `0` if sub-minute `< 0.5 min` so indoor room hops don't artificially inflate, else `min(MAX_TURN_ELAPSED_MINUTES_SANITY, min_travel_minutes)`).
    - Apply floor: `effective_elapsed_minutes = max(world_delta.elapsed_minutes, min_travel_minutes)` before `resolve_turn_timestamp` / `resolve_bounded_turn_elapsed_minutes` (respecting `is_static_describe` and `MAX_TURN_ELAPSED_MINUTES_SANITY`).
  - Update `clerk/heuristics.py` to use `derive_travel_minutes(nb.distance_meters, nb.speed_modifier)` instead of `derive_walking_minutes(nb.distance_meters)`.
- **GM Talk & GM Tools Spoiler Gating (`gm_talk.py`, `gm_tools.py`):**
  - Wherever GM Talk or read-only GM tools inspect map connections/neighbors, filter out undiscovered secret edges when `not vis.unlock_lore`. When `vis.unlock_lore` is True, badge them as `Secret · Hidden` vs. `Secret · Discovered` (mirroring `_lore_badge`), and expose `speed_modifier`, `travel_mode`, `obstacles`, and `is_blocked`.

### FR-5: AI World Wizard & Reimagine Map Prompts
- Update `DEFAULT_WIZARD_WORLD_SYSTEM` and `DEFAULT_WIZARD_MAP_REIMAGINE_SYSTEM` (`backend/app/prompts/defaults.py`) and `LocationEdgeDraft` (`backend/app/schemas/world.py`) so AI-generated worlds can emit:
  - `speed_modifier` (default `1.0`, e.g. `0.3` difficult terrain, `10.0` vehicle road, `25.0` rail)
  - `travel_mode` (optional concise string when `speed_modifier != 1.0`, else `null`)
  - `obstacles` (optional short list of 0–3 hazard keywords)
  - `is_blocked` (bool, default `false`)
  - `is_secret` (bool, default `false`)
- Keep explicit `required_properties` compliance for Pydantic v2 + local LLM constrained JSON decoding, with safe defaults (`speed_modifier = 1.0`, `travel_mode = None`, `obstacles = []`, `is_blocked = False`, `is_secret = False`) in offline/fallback generators (`world_wizard.py`).

### FR-6: Frontend Speed Presets, Helpers & Non-Map Surfaces
- **Metric & Speed Helpers (`frontend/src/utils/spatialDistance.ts`):**
  - Export `MIN_EDGE_SPEED_MODIFIER = 0.05`, `MAX_EDGE_SPEED_MODIFIER = 100`, `DEFAULT_EDGE_SPEED_MODIFIER = 1`.
  - Export genre-neutral `LINK_SPEED_PRESETS`:
    - `Swamp / Difficult Terrain` (`0.3×`, `~1.3 km/h`)
    - `Steep / Climb / Stairs` (`0.6×`, `~2.5 km/h`)
    - `Walking (Default)` (`1.0×`, `~4.2 km/h`)
    - `Mount / Bike` (`3×`, `~12.6 km/h`)
    - `Vehicle / Carriage` (`10×`, `~42 km/h`)
    - `Rail / Fast Transit` (`25×`, `~105 km/h`)
    - `High-Speed / Air` (`60×`, `~252 km/h`)
  - Export `clampEdgeSpeedModifier`, `deriveTravelMinutes(distanceMeters, speedModifier = 1)`, `formatTravelDuration(distanceMeters, speedModifier = 1)`, `formatEffectiveSpeedKmh(speedModifier)`, and `formatTravelSummary(distanceMeters, speedModifier, travelMode)`.
  - Update `formatBundleTravelDuration` to compute min/max across each edge's `(distance_meters, speed_modifier)` rather than raw meters alone.
- **Non-Map UI Surfaces:**
  - `ChatComposer.tsx`: render visible exits only (undiscovered secrets already omitted by backend), displaying travel duration with speed/mode (`via Iron Door • 4.2km (~2 min via Rail)`), subtle blocked badge if `is_blocked`, and obstacle chips/hint in tooltip.
  - `InspectorLocationCard.tsx`: render visible exits with `formatDistanceCompact` + `formatTravelDuration(nb.distance_meters, nb.speed_modifier)`, showing `Blocked` badge and obstacle keywords when present.

### FR-7: Map Canvas Selection, Rendering & Element Inspector (`MapDetailsDrawer`)
- **Selection State (`SpatialTopologyView.tsx`):**
  - Extend selection model so Locations, Containers, and **Links** are mutually exclusive selectable elements:
    - `selectedEdgeSelection: { kind: "pair"; edgeId: string } | { kind: "bundle"; edgeIds: string[]; title: string } | null` (clears `selectedLocationId` / `selectedContainerId` on select, and vice versa).
  - Global `Delete` shortcut (when not focused in an input/textarea/modal) supports deleting a selected Link Pair in editor mode (Undo-backed, respecting `canDeleteEdge` / connectivity constraints).
- **Canvas Interactions & Visual Styling (`SpatialTopologyCanvas.tsx`, `topologyProjection.ts`):**
  - **Single-click** a link line (via a wide transparent hit-target) or link badge selects the link (or supernode bundle) and opens `MapDetailsDrawer`.
  - **Badge quick-preview & inline edit:**
    - Keep double-click on a single link badge opening the fast inline distance editor (or explicit pencil action in the inspector), while single-clicking the link selects it in `MapDetailsDrawer` (and toggling distance ↔ time preview remains accessible via click-toggle or badge icon without fighting selection).
  - **Visual distinction on canvas:**
    - **Selected link:** Highlighted cyan glow/stroke matching selected nodes.
    - **Speed-modified link (`speed_modifier != 1.0`):** Subtle speed/mode cue in tooltip and badge preview (using `deriveTravelMinutes(distance_meters, speed_modifier)`).
    - **Obstacles present:** Subtle hazard dot/icon cue on badge or tooltip.
    - **Blocked link (`is_blocked`):** Distinct barred/amber-rose dashed-accent stroke + lock/ban icon on badge.
    - **Undiscovered Secret link (Campaign GM Mode only, or World Editor):** Distinct dashed violet ghost line (`--accent-violet`) with a hidden-eye (`EyeOff`) badge icon.
    - **Discovered Secret link (Campaign Mode):** Renders as a normal visible link with a subtle discovered-eye indicator in the inspector/tooltip so players/GMs remember its origin.
    - **Undiscovered Secret link (Campaign Player Mode):** Completely hidden from canvas lines, badges, tooltips, and supernode bundle aggregations (`topologyProjection.ts` excludes them before computing `groupedCount`, `minMeters`, `maxMeters`, and `containsBlockedEdge`).
- **Element Inspector — Link Pair View (`MapDetailsDrawer.tsx`):**
  - Displays header: `From Location ↔ To Location` (or `A → B` if unidirectional), compass slot badges, and Delete Link action (when permitted).
  - **Distance & Travel Time section:**
    - Distance input (`m` / `km` shorthand via `parseCommittedEdgeDistance`) + adaptive steppers (`Shift` for `±1m`).
    - **Speed Modifier** numeric input (`0.05×`–`100×`) + quick preset pills (`LINK_SPEED_PRESETS`) + optional editable **Travel Mode** label (auto-populated when clicking a preset, clearable/customizable).
    - Live readout bar: `Estimated travel: ~12 min (42 km/h · 10×)` (updates instantaneously as distance or speed changes).
  - **Direction Labels section:**
    - Editable `A → B` label and `B → A` label (synced cleanly to each directed row).
  - **Obstacles section:**
    - `TagChipsInput` for up to 6 concise hazard keywords (e.g., `collapsed masonry`, `laser grid`, `flooded floor`) with helper note that visible link obstacles are shared with the AI narrator.
  - **Status Toggles section:**
    - **Blocked** toggle (`is_blocked`): description noting it marks the route obstructed on the map and alerts the narrator (soft-enforced).
    - **Secret** toggle (`is_secret`): editable in World Editor and Campaign GM Mode; disabled/hidden for non-GM players.
    - **Campaign GM Mode Discovery Controls** (shown when `mode === "campaign" && is_secret && unlockLore`): shows current branch status (`Hidden from players` vs. `Discovered on this branch`) with a one-click **Reveal to Players / Re-hide** button wired to `POST /api/campaigns/{campaign_id}/edges/{edge_id}/reveal`.
- **Element Inspector — Supernode Bundle View (`MapDetailsDrawer.tsx`):**
  - Replaces `MultiEdgePopover`: when a collapsed container bundle containing `> 1` link pairs is clicked, `MapDetailsDrawer` renders a clean list of the constituent link pairs (endpoints, distance, travel duration, blocked/secret/obstacle badges) with one-click drill-in to edit any Link Pair (and a Back button to return to the bundle list).

---

## 4. Non-Functional Requirements & Acceptance Criteria

- **Token Budget Discipline:** Zone 4 exit lines remain single-line and compact; `obstacles` capped at 6 short chips; undiscovered secret links add **0 tokens** to Zone 4 until discovered.
- **Branch Integrity:** Rewinding/checking out a turn before a secret link's discovery turn re-hides the secret link on map, exits, and context; editing a discovered secret link's distance/obstacles/blocked status keeps it discovered.
- **Zero Spoiler Leakage:** Automated tests verify undiscovered secret links never appear in Player-mode `get_campaign_state` (`neighbors` or `world_edges`), Zone 4 prompts, Clerk prompts, GM Talk responses, or supernode bundle counts, AND survive Player-mode `PUT /api/campaigns/{campaign_id}/map` saves intact.
- **Verification Gates:**
  - Backend: `cd backend && .venv/bin/ruff check app tests && .venv/bin/tach check` and `backend/.venv/bin/pytest backend/tests`.
  - Frontend: `npm --prefix frontend run arch:check && npm --prefix frontend run css:audit && npm --prefix frontend run build && npm --prefix frontend test`.
  - Architecture docs: `backend/.venv/bin/python scripts/generate_arch_docs.py && backend/.venv/bin/python scripts/generate_arch_docs.py --check`.
  - User-facing wiki updates in `../cybercantina-wiki` (`git -C ../cybercantina-wiki diff`).
