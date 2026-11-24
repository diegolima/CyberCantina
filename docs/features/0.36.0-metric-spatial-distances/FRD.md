---
feature: metric-spatial-distances
target_version: 0.36.0
document_type: frd
status: completed
last_updated: 2026-11-24
---

# Feature Requirements Document (FRD)
## Metric Spatial Edge Distances (`distance_meters`) & Quick Walking-Time Preview

**Status:** Completed (`v0.36.0`)  
**Target Version:** CyberCantina v0.36.0  
**Depends On:**
- [v0.10.0 Interactive Spatial Topology Map Editor](file:///home/diegolima/Git/cybercantina/docs/features/0.10.0-interactive-map-editor/FRD.md)
- [v0.11.4 Cross-Container Linking & Ghost Portals](file:///home/diegolima/Git/cybercantina/docs/features/0.11.4-map-cross-container-linking-and-lucide-upgrade/FRD.md)
- [v0.31.1 Mobile Map UX](file:///home/diegolima/Git/cybercantina/docs/features/0.31.1-mobile-map-ux/FRD.md)

**Expected Scope:**
- **Backend Schema, Persistence & Migration:**
  - [`backend/app/db/schema.sql`](file:///home/diegolima/Git/cybercantina/backend/app/db/schema.sql), [`backend/app/db/repos/schema_init.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/schema_init.py), [`backend/app/db/seed.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/seed.py), [`backend/app/db/showcase_data/the_green_lie/world.json`](file:///home/diegolima/Git/cybercantina/backend/app/db/showcase_data/the_green_lie/world.json)
  - [`backend/app/db/repos/worlds.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/worlds.py), [`backend/app/db/repos/world_locations.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/world_locations.py), [`backend/app/db/repos/campaign_spatial.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/campaign_spatial.py), [`backend/app/db/repos/campaign_map_update.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/campaign_map_update.py)
  - [`backend/app/services/import_export_service.py`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py), [`backend/app/services/zcc_campaign_io.py`](file:///home/diegolima/Git/cybercantina/backend/app/services/zcc_campaign_io.py)
- **Backend Schemas, Routes, Prompts & Simulation Engine:**
  - [`backend/app/schemas/world.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/world.py), [`backend/app/schemas/turn.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/turn.py)
  - [`backend/app/routers/campaign_routes/schemas_and_gate.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/campaign_routes/schemas_and_gate.py), [`backend/app/routers/campaign_routes/spatial_routes.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/campaign_routes/spatial_routes.py)
  - [`backend/app/prompts/defaults.py`](file:///home/diegolima/Git/cybercantina/backend/app/prompts/defaults.py), [`backend/app/wizards/world_wizard.py`](file:///home/diegolima/Git/cybercantina/backend/app/wizards/world_wizard.py)
  - [`backend/app/engine/context/zone4_ephemeral.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/zone4_ephemeral.py), [`backend/app/engine/clerk/pipeline.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/clerk/pipeline.py), [`backend/app/engine/clerk/heuristics.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/clerk/heuristics.py)
- **Frontend Types, API, Helpers & UI Components:**
  - [`frontend/src/types/world.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/world.ts), [`frontend/src/types/turn.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/turn.ts), [`frontend/src/api/campaigns.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/api/campaigns.ts), [`frontend/src/components/world/worldDraftMappers.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/worldDraftMappers.ts)
  - [`frontend/src/components/map/topologyProjection.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/topologyProjection.ts), [`frontend/src/components/map/useTopologyMutations.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/useTopologyMutations.ts), [`frontend/src/components/map/SpatialTopologyCanvas.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/SpatialTopologyCanvas.tsx), [`frontend/src/components/SpatialTopologyView.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/SpatialTopologyView.tsx), [`frontend/src/components/map/MapDialogs.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDialogs.tsx), [`frontend/src/components/map/PortalPromotionModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/PortalPromotionModal.tsx), [`frontend/src/components/map/MapDetailsDrawer.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDetailsDrawer.tsx)
  - [`frontend/src/components/chat/ChatComposer.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/ChatComposer.tsx), [`frontend/src/components/inspector/InspectorLocationCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/inspector/InspectorLocationCard.tsx)
- **User-Facing Wiki Documentation:** [`../cybercantina-wiki`](file:///home/diegolima/Git/cybercantina-wiki/Home.md) (`Authoring-Worlds-Characters-and-Personas.md`, `Live-Inspector-Map-and-Timeline.md`, `Playing-Directing-and-Mechanics.md`, `Importing-and-Exporting.md`)

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
Spatial edges (`location_edges`) currently measure separation purely in `travel_minutes` (capped at `240` in most UI/editor paths) and display the shorthand `"m"` across map badges (`10m`), `ChatComposer` quick-exits (`via Passage • 10m`), `InspectorLocationCard` (`[N] · 10m`), and Clerk context (`10m`):

1. **Physical vs. Temporal Coupling:** Coupling edges to minutes assumes one fixed mode of traversal; physical separation in **meters** is an intrinsic world property, while duration depends on traversal speed (walking, sprinting, vehicles, etc.).
2. **`"m"` Unit Ambiguity:** Across map badges and exit pills, `"10m"` looks like 10 meters while representing 10 minutes.
3. **Hard `240` Cap:** A hard `240` ceiling blocks regional/overland distances (e.g., `2 km`, `15 km`, `120 km`) when editing or creating routes.
4. **No Quick Walking-Time Preview:** Even when distances are stored in meters, players and worldbuilders want instant walking-time intuition on the map without doing mental math.

### 1.2 Proposed Solution
Cleanly replace `travel_minutes` with canonical metric **`distance_meters`** across database tables, backend schemas/APIs, LLM prompts, and frontend UI—anchored to a canonical walking speed of **`70 m/min` (`4.2 km/h`)** for duration derivation, legacy migration, and click-to-convert map badge previews.

---

## 2. Scope, Boundaries & Core Invariants

1. **Canonical Metric Field (`distance_meters`) Invariant (Hard):**
   - `distance_meters` (`int`, `>= 1`) replaces `travel_minutes` as the sole persisted spatial edge field in `location_edges`, Pydantic DTOs (`LocationEdge`, `LocationEdgeDraft`, `NeighborLocationView`, `ImprovisedLocationSpec`), API contracts, and TypeScript interfaces.
   - No dual persisted `travel_minutes` + `distance_meters` columns/fields in live schemas (eliminates drift).
2. **Lossless Legacy Migration & Import Compatibility Invariant (Hard):**
   - Existing SQLite databases migrate idempotently on startup (`schema_init.py`): legacy `travel_minutes` values convert via `MAX(1, COALESCE(travel_minutes, 1) * 70)`.
   - Legacy `.zcc` world/campaign archives, JSON payloads, and custom-preset LLM JSON outputs that emit `travel_minutes` (without `distance_meters`) automatically convert via `max(1, int(travel_minutes) * 70)` on import / Pydantic validation without double-converting payloads that already carry `distance_meters`.
3. **Canonical Walking Speed & Duration Derivation Invariant (`70 m/min`):**
   - Canonical walking speed is **`WALKING_METERS_PER_MINUTE = 70`** (`4.2 km/h`).
   - Derived integer walking minutes: `max(1, round(distance_meters / 70))` (implemented identically in Python and TypeScript using standard half-away-from-zero or `Math.round` consistency—specify `int(distance_meters / 70 + 0.5)` / `Math.round(distance_meters / 70)` clamped to `>= 1`).
   - Offline `heuristics.py` movement clock advancement uses `min(MAX_TURN_ELAPSED_MINUTES_SANITY, max(2, derived_walking_minutes(distance_meters) + 1))` to preserve transition/orientation overhead without `70x` clock inflation.
4. **Unambiguous Unit & Prompt Presentation Invariant (Hard):**
   - `"m"` (and `"km"` for `>= 1000m`) strictly denotes **meters / kilometers** everywhere in UI and prompts.
   - Time previews and durations strictly use `"min"` (and `"h ...min"` at `>= 60 min`, `"< 1 min"` below `35 m`).
   - Narrator (`zone4_ephemeral.py`) and World Clerk (`clerk/pipeline.py`) exit lists render **both** physical distance and derived walking time (e.g., `[350m, ~5 min walk]` / `[1.8km, ~25 min walk]`) so small local models never misread `"m"` as minutes or miscalculate `distance / 70`.
5. **No `240` Cap Invariant:**
   - Remove the `240` upper cap from all frontend and backend schemas, mutations, inputs, and repository methods. Retain `>= 1` integer validation (with a generous overflow-safety ceiling such as `100_000_000` m = `100,000 km` where numeric bounds are required).

---

## 3. Functional Requirements

### FR-1: Database Schema, Startup Migration & Showcase Seed (`v0.36.0`)
- **Schema (`backend/app/db/schema.sql`):**
  - Update `location_edges` DDL to use `distance_meters INTEGER NOT NULL DEFAULT 50` (replacing `travel_minutes INTEGER NOT NULL DEFAULT 1`).
- **Startup Migration (`backend/app/db/repos/schema_init.py`):**
  - Inspect `PRAGMA table_info(location_edges)`:
    - If `distance_meters` is missing and `travel_minutes` exists: add `distance_meters INTEGER NOT NULL DEFAULT 50`, backfill `UPDATE location_edges SET distance_meters = MAX(1, COALESCE(travel_minutes, 1) * 70)`, and migrate/drop legacy `travel_minutes` via table rebuild (matching the repository's existing SQLite table-rebuild migration pattern in `schema_init.py`, preserving indexes and `FOREIGN KEY` constraints) so clean `schema.sql` and migrated DBs share identical column layout.
- **Showcase World (`backend/app/db/showcase_data/the_green_lie/world.json` & `seed.py`):**
  - Convert all edges in `the_green_lie/world.json` from `travel_minutes` to `distance_meters` using `* 70` (e.g., `10` → `700`, `25` → `1750`, `40` → `2800`, `60` → `4200`).
  - Preserve `SHOWCASE_SEED_VERSION = 2` in `backend/app/db/seed.py` (which keys immutable `pub_v2_*` public media IDs and URLs), while updating `seed.py` to read `distance_meters` directly with fallback `int(edge.get("travel_minutes") or 1) * 70`. Pre-existing DBs migrate seeded `location_edges` rows via `* 70` in `schema_init.py`.

### FR-2: Backend Schemas, Validation, Defaults & Repositories
- **Canonical Constants & Helpers (`backend/app/schemas/world.py`):**
  - Define `WALKING_METERS_PER_MINUTE = 70`, `MAX_EDGE_DISTANCE_METERS = 100_000_000`, context defaults (`DEFAULT_INTERIOR_DISTANCE_METERS = 20`, `DEFAULT_EXTERIOR_DISTANCE_METERS = 100`, `DEFAULT_FALLBACK_DISTANCE_METERS = 50`), and helpers:
    - `derive_walking_minutes(distance_meters: int) -> int`: returns `max(1, int(distance_meters / WALKING_METERS_PER_MINUTE + 0.5))`.
    - `format_distance_meters(distance_meters: int) -> str`: compact `"{d}m"` below `1000`, `"{km:.1f}km"` (stripping trailing `.0`, e.g., `"2km"`, `"1.4km"`) at `1000–99999`, and `"{round(km)}km"` at `>= 100km`.
    - `format_walking_duration(distance_meters: int) -> str`: `"< 1 min"` when `distance_meters < 35`, `"~{m} min"` for `1..59`, `"~{h}h"` or `"~{h}h {rem}min"` at `>= 60 min`.
- **Legacy Input Coercion (`@model_validator(mode="before")`):**
  - On `LocationEdgeDraft`, `LocationEdge`, `NeighborLocationView`, and `ImprovisedLocationSpec`: if `distance_meters` is missing/None and `travel_minutes` is present, compute `max(1, int(round(float(travel_minutes) * 70)))` and strip `travel_minutes`.
  - Clamp `distance_meters` to `[1, MAX_EDGE_DISTANCE_METERS]` (removing `le=240` and `le=1440`).
- **Context-Aware Defaults:**
  - `20 m`: `ImprovisedLocationSpec` default when `is_exterior=False`, interior/same-container manual room creation (`create_linked_location` / `connect_campaign_locations` when both endpoints share a non-null `container_id`), and indoor offline fallback edges in `world_wizard.py`.
  - `100 m`: `ImprovisedLocationSpec` when `is_exterior=True`, cross-container / exterior / hub / portal edge creation (`PortalPromotionModal`, hub/exterior wizard fallbacks).
  - `50 m`: General fallback when neither interior nor exterior context is specified (`LocationEdgeDraft` default, `LocationEdge` default, `CampaignEdgeCreateRequest` default).
- **Repositories & Import/Export:**
  - Update SQL queries and model construction in `worlds.py`, `world_locations.py`, `campaign_spatial.py`, and `campaign_map_update.py` to read/write `distance_meters` with `max(1, min(MAX_EDGE_DISTANCE_METERS, int(...)))`.
  - Update `import_export_service.py` and `zcc_campaign_io.py` exports to emit `distance_meters` and imports to accept `distance_meters` directly or fall back to `max(1, int(edge.get("travel_minutes") or 1) * 70)` for legacy `.zcc` bundles.
- **API Request DTOs (`schemas_and_gate.py`, `spatial_routes.py`):**
  - Replace `travel_minutes` with `distance_meters` in `LinkedLocationCreateRequest` (default `20`), `CampaignEdgeCreateRequest` (default `50`), and `CampaignEdgeDistanceUpdateRequest` (`ge=1, le=MAX_EDGE_DISTANCE_METERS`), with `@model_validator(mode="before")` legacy `travel_minutes` fallback if an older client payload sends it.

### FR-3: Simulation Clock, Prompts & Wizards
- **Context Injection (`zone4_ephemeral.py`, `clerk/pipeline.py`):**
  - `zone4_ephemeral.py`: render exits as `[{format_distance_meters(n.distance_meters)}, {format_walking_duration(n.distance_meters)} walk{' | LOCKED/HIDDEN' if n.is_locked_or_hidden else ''}]` (e.g. `[350m, ~5 min walk]`).
  - `clerk/pipeline.py`: render Known Exits as `(via {n.direction_label}, {format_distance_meters(n.distance_meters)}, {format_walking_duration(n.distance_meters)} walk)`.
- **Offline Clerk Heuristics (`clerk/heuristics.py`):**
  - On `move_known` match, compute `derived_min = derive_walking_minutes(nb.distance_meters)` and set `elapsed_minutes = min(MAX_TURN_ELAPSED_MINUTES_SANITY, max(2, derived_min + 1))`.
  - On `explore_new` heuristic fallback, emit `distance_meters=100 if is_exterior_heuristic else 20`.
- **Prompt Templates (`backend/app/prompts/defaults.py`):**
  - `DEFAULT_CLERK_POST_TURN_SYSTEM`: replace `travel_minutes` in `improvised_location` spec with `distance_meters` (suggesting `10-60` for interior rooms, `80-500` for nearby exterior/courtyard/street transitions).
  - `DEFAULT_WIZARD_WORLD_SYSTEM` and `DEFAULT_WIZARD_MAP_REIMAGINE_SYSTEM`: replace `travel_minutes` with `distance_meters` and concrete scale bands (`10-60` for indoor rooms, `80-500` for adjacent streets/courtyards, `500-5000+` for district or overland routes).

### FR-4: Frontend Formatting, Non-Map Surfaces & Adaptive Editing
- **Pure Formatting & Editing Helpers (`frontend/src/components/map/topologyProjection.ts` or dedicated metric helper re-exported there):**
  - `WALKING_METERS_PER_MINUTE = 70`, `MAX_EDGE_DISTANCE_METERS = 100_000_000`.
  - `deriveWalkingMinutes(distanceMeters: number): number`: `Math.max(1, Math.round(distanceMeters / 70))`.
  - `formatDistanceCompact(distanceMeters: number): string`: `< 1000` → `${m}m`; `1000..99999` → `${Number((m / 1000).toFixed(1))}km` (no `.0`, e.g., `1km`, `1.4km`, `12.5km`); `>= 100000` → `${Math.round(m / 1000)}km`.
  - `formatWalkingDuration(distanceMeters: number): string`: `< 35` → `"< 1 min"`; `1..59 min` → `"~${min} min"`; `>= 60 min` → `"~${h}h"` when `rem === 0` else `"~${h}h ${rem}min"`.
  - `getAdaptiveDistanceStep(meters: number): number`: `< 100` → `5`; `< 1000` → `25`; `< 10000` → `100`; `>= 10000` → `500` (with `fine = true` / `Shift` overriding to `1`).
  - `parseCommittedEdgeDistance(rawDraft: string): number | null`: accepts integer meters (`"350"`, `"350m"`) and decimal/integer kilometers (`"1.5km"`, `"2 km"` → `1500`, `2000`), clamped to `[1, MAX_EDGE_DISTANCE_METERS]`, returning `null` when blank/invalid.
  - `stepEdgeDistanceDraft(rawDraft: string, direction: 1 | -1, fallbackMeters = 50, fine = false): string`: steps up/down using adaptive increment (or `±1` when `fine` is true), clamped to `[1, MAX_EDGE_DISTANCE_METERS]`.
  - `sanitizeEdgeDistanceInput(raw: string): string`: permits digits, one `.`, and optional `k`/`m` suffix characters while typing so users can type `1.5km` seamlessly.
- **Non-Map UI Surfaces:**
  - `ChatComposer.tsx`: `via {nb.direction_label} • {formatDistanceCompact(nb.distance_meters)} ({formatWalkingDuration(nb.distance_meters)})`.
  - `InspectorLocationCard.tsx`: minimap slot label `{nb.slot} · {formatDistanceCompact(nb.distance_meters)}` (compact SVG fit), selected exit meta + Exits list show `{formatDistanceCompact(nb.distance_meters)} ({formatWalkingDuration(nb.distance_meters)})`.
  - `MapDetailsDrawer.tsx`: external cross-boundary passage list shows `({formatDistanceCompact(ge.distance_meters)} · {formatWalkingDuration(ge.distance_meters)})`.
  - `MapDialogs.tsx` & `PortalPromotionModal.tsx`: replace `"Minutes"` labels and `max={240}` caps with `"Distance (m)"` / `"Distance (m or km)"`, context-appropriate defaults (`20` interior / `100` exterior / `50` general), live walking-time helper preview next to numeric fields, and adaptive `MultiEdgePopover` inputs with `formatWalkingDuration` hint.

### FR-5: Click-to-Convert Walking-Time Preview on Map Badges (`SpatialTopologyCanvas.tsx`)
- **State & Per-Badge Toggle:**
  - Maintain `previewTimePairKeys: Set<string>` in `SpatialTopologyCanvas` (scoped by `pairKey`, e.g. `locA<->locB` or `ghost:locA<->locB`).
  - Default badge text: `${formatDistanceCompact(edge.distance_meters)}${aggSuffix}${lockSuffix}` (e.g., `350m`, `1.8km · 2 🔒`).
  - Toggled preview badge text:
    - Single edge / uniform bundle: `${formatWalkingDuration(edge.distance_meters)}${aggSuffix}${lockSuffix}` (e.g., `~5 min`, `~25 min · 2 🔒`).
    - Aggregated bundle with differing route durations (`minMinutes !== maxMinutes`): `~${minLabel}-${maxLabel} · ${passagePairCount}` (e.g., `~5-15 min · 2` or `~1h-2h · 3`).
  - Dynamic badge width (`computeDistanceBadgeWidth(labelText)`) automatically sizes `<rect>` and anchors the Layer 4 hover quick-delete `"X"` button (`clipped.midX + badgeWidth / 2 - 1`).
- **Desktop Click vs. Double-Click & Deselection Guard:**
  - Clicking a badge stops propagation (`onPointerDown` and `onClick`) so background canvas deselection never fires.
  - Single-click toggles `pairKey` inside `previewTimePairKeys`.
  - `onDoubleClick` calls `openEdgeEditor(...)` without interference: because `inlineEdgeEdit` is anchored to `(clipped.midX, clipped.midY)` rather than badge width, toggling on click does not prevent double-click from opening the inline editor or `MultiEdgePopover` (and double-clicking can cleanly preserve or leave preview unaffected while the editor overlay replaces the badge).
- **Mobile / Touch Behavior:**
  - In `mode === "editor"` (when `!isMutatingLocked`): preserve single-tap-to-edit via `pendingTapTargetRef` (`kind: "edge"`), and show the derived walking-time preview inside the inline editor / `MultiEdgePopover` and `<title>` tooltip.
  - In `mode === "campaign"` (or when editing is locked): register `pendingTapTargetRef` (`kind: "edge-preview"`) on `onPointerDown` so `finishGesture` toggles `previewTimePairKeys` on tap instead of falling through to empty-canvas deselection.
- **Inline Editor Overlay (`SpatialTopologyCanvas.tsx`):**
  - Show live derived walking duration beside/below the screen-space inline input (e.g. `~5 min`), pass `Shift` key state for `±1m` fine stepping vs adaptive stepping, update button `title` tooltips dynamically to show the active step increment (e.g. `Increase (+25m, Shift +1m)`), and accept `1.5km` shorthand via `parseCommittedEdgeDistance`.

---

## 4. Non-Functional Requirements & Acceptance Criteria

- All backend linters, layer checks, and tests pass (`ruff check`, `tach check`, `pytest`).
- All frontend checks pass (`arch:check`, `css:audit`, `build`, `vitest run`).
- Architecture docs regenerated and verified (`scripts/generate_arch_docs.py --check`).
- User-facing guides in `../cybercantina-wiki` updated to document metric distances, `km` formatting, adaptive inputs, and click-to-preview walking times.
