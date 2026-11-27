---
feature: green-lie-seed-v3
target_version: 0.52.5
document_type: frd
status: completed
last_updated: 2026-11-28
---

# Feature Requirements Document — Upgraded *The Green Lie* Showcase Seed & Full Spatial Seeder Parity

## 1. Overview & Motivation

CyberCantina's default showcase world (**The Green Lie**) in `backend/app/db/showcase_data/the_green_lie/world.json` was authored prior to the v0.48.0 **Tracked Location Props** and v0.51.0 **Spatial Distance Consistency, External Anchors & Vertical Transitions** releases. As a result, the currently seeded showcase:
1. Fails the spatial consistency analyzer (`spatialConsistency.ts`) with **11 diagnostics** (6 errors, 3 warnings, 2 info), including compass conflicts in *Sector 9* / *Sewers* and asymmetric bidirectional pairs.
2. Uses horizontal edges for all vertical arcology tier transitions (*Sector 1* through *Sector 9*) and lacks cross-container `anchor_location_id` pins.
3. Contains zero `LocationProp` items, leaving the tracked-prop and `/search` discovery loop undemonstrated out of the box.
4. Has unrealistic interior dive-bar distances (`Main Floor ↔ The Sump-Well` at `280m`, `Main Floor ↔ The Catwalk` at `70m`).

An improved edition of **The Green Lie** has been authored, audited, and exported from the local server (`world_b07c520ab5`), achieving **0 spatial consistency diagnostics** across all container scopes while showcasing vertical arcology transitions, escalating Aegis security obstacles, portal anchors, and tracked location props.

However, inspecting `backend/app/db/seed.py` reveals that `_seed_green_lie_world_for_user` does **not** yet persist `location_nodes.anchor_location_id`, `location_props`, `location_edges.distance_mode`, or `location_edges.is_vertical`. Replacing `world.json` alone would silently drop those fields for every newly seeded user.

This feature replaces `backend/app/db/showcase_data/the_green_lie/world.json` with the normalized export of the upgraded world **and** brings `backend/app/db/seed.py` into full parity with the modern spatial schema.

---

## 2. Upgraded Showcase World Specification

### 2.1 Structural Summary
- **Containers:** 13 (unchanged hierarchy across depths `{1, 3, 4}`).
- **Locations:** 37 (up from 35; +2 new locations):
  - `Sector 9: The Drain / The Neon Rust's Sewer Entrance` (*"Rusted Submarine Hatch"*, `is_entry_exit: true`, 5 environmental tags) — cleanly bridges `The Sump-Well` vertically (`1m` `Ladder`, blocked with `['Flooded floor', 'sealed hatch']`) to `Sewers / Tunnel 1-L` (`1000m`).
  - `Sewers / Tunnel 2-O` (`is_entry_exit: true`, anchored to `The Pillory`, 4 environmental tags) — replaces the old geometrically impossible `Tunnel 1-N ↔ The Pillory` and `Tunnel 2-N ↔ The Green-Sump` cross-wiring.
- **Edges:** 88 directed edges (44 bidirectional pairs), **0 spatial consistency diagnostics** across World Root and every container scope:
  - **11 vertical edge pairs (`is_vertical: true`)**: all 9 inter-sector transitions spanning `4,240m` vertically (*Sector 9* → *Sector 1*) with tailored `travel_mode`, `speed_modifier`, and Aegis/syndicate `obstacles` (`Low-Speed Elevator` `0.7x` → `Elevator` `1.0x` → `High-Speed Elevator` `2.5x` → `Super High-Speed Elevator` `3.0x` → `Maglev` `25x`, including a secret `Hidden Maintenance Elevator` between *Sector 6* and *Sector 5*), plus `The Sump-Well ↔ The Neon Rust's Sewer Entrance` (`Ladder`) and `The Mid-Web ↔ Tunnel 3-L`.
  - **Realistic interior & sewer scales**: `Main Floor ↔ The Catwalk` (`6m`), `Main Floor ↔ The Sump-Well` (`8m`), `Main Floor ↔ The Cage-Walk` (`10m`), `Tunnel 1-N ↔ Tunnel 1-O` (`3242m` @ `0.8x` `Tight Space` = `~58 min`).
  - **Complete blocked & secret obstacle coverage**: every blocked and secret link carries explicit `obstacles` chips (`['false wall']` on `Tunnel 2-L ↔ Tunnel 3-L`, `['Sealed Doors']` on `Tunnel 4-M ↔ The Sluice`, `['Collapsed walls', 'high-voltage wiring']` on `Tunnel 2-M ↔ Tunnel 3-M`, `['submerged passage']` on `Tunnel 2-O ↔ The Pillory`, `['submerged girders', 'waist-deep silt']` on `Tunnel 1-O ↔ Drowned Reliquary`, etc.).
- **External Spatial Anchors (`anchor_location_id`):** 3 valid cross-container pins:
  - `Sewers / Tunnel 1-O` → `Sector 9: The Drain / Drowned Reliquary`
  - `Sewers / Tunnel 2-O` → `Sector 9: The Drain / The Pillory`
  - `Sewers / Tunnel 3-L` → `The Caissons / The Mid-Web`
- **Tracked Location Props (`props`):** 2 authored props:
  - `Drowned Reliquary`: **`Encrypted Ghost Signal Data Slate`** (`is_hidden: true`) — ties directly into `"The Ghost Signal"` rumor lore and `Unit 4B-12`'s secret cutout.
  - `The Cage-Walk`: **`Old Pistol`** (`is_hidden: false`) — early salvageable weapon tying into Yulia's `"Gearing Up"` / `"Helping the Rust-Splicers"` memory shards.
- **Global World Lore:** 15 entries (up from 14; +1 new `threat` entry: **`Aegis Security Patrols`**, tying directly into the upper-tier security obstacles).
- **Hygiene Invariants:** 0 unused `is_entry_exit` portal flags (`Tunnel 1-N` unset), 0 locations with empty `environmental_tags`, 0 asymmetric bidirectional pairs, 0 unreachable locations.

### 2.2 Canonical Bundle Normalization (`world.json`)
Before committing to `backend/app/db/showcase_data/the_green_lie/world.json`, the exported world payload MUST be normalized so that:
1. All public media IDs and URLs use canonical unprefixed showcase IDs (`wmed_28416ce9b1`, `wmed_7149de5689`, `wmed_d8d34909a5`, `vid_neo_veridia`) rather than runtime `pub_v2_*` prefixes.
2. Static video metadata (`video_duration_ms`, `video_width`, `video_height`, `video_byte_size`, `created_at`) on `wmed_28416ce9b1` / `vid_neo_veridia` is preserved intact.
3. The world lore node `"The Sovereign Cipher"` retains canonical ID `lore_ced32a7021` so `backend/app/db/showcase_data/the_green_lie/character.json` (`Encrypted burner slate` → `lore_id: "lore_ced32a7021"`) resolves without modification.

---

## 3. Seeder Parity Requirements (`backend/app/db/seed.py`)

`_seed_green_lie_world_for_user` MUST be updated to persist all modern spatial fields from `world.json`:

1. **`location_nodes.anchor_location_id`**:
   - Remap `loc.get("anchor_location_id")` through `id_remap` (already pre-populated for all locations prior to location insertion) and validate via `validate_spatial_anchors_integrity` / subtree check before writing `anchor_location_id` into `location_nodes`.
2. **`location_props`**:
   - For each location's `props` list, validate each entry with `LocationProp.model_validate(...)`, assign a fresh per-clone `prop_<hex>` ID, remap `lore_id` through `id_remap` (clearing `"artifact"` flag if unmapped), and insert into `location_props` preserving `name`, `note`, `flags_json`, `lore_id`, `is_hidden`, `auto_spawned`, and `sort_order`.
   - Props remain excluded from `vector_store` (RAG) and World Codex per `LocationProp` invariants.
3. **`location_edges.distance_mode` & `location_edges.is_vertical`**:
   - Extract via `extract_edge_consistency_fields(edge)` and persist `distance_mode` and `is_vertical` in the `INSERT INTO location_edges` statement.
4. **Seed Version & Non-Destructive Rollout**:
   - Keep `SHOWCASE_SEED_VERSION = 2` since shared public media files (`media/*.webp`, `vid_neo_veridia.mp4`) and public URLs (`/api/media/public/v2/...`, `pub_v2_*`) are unchanged.
   - Existing users' worlds (including user-modified copies) are **never** overwritten automatically. New users (via setup, self-registration, or admin creation) and existing users who delete their copy and trigger **Restore Default Showcase** (`POST /api/profile/restore-showcase`) receive the upgraded world.

---

## 4. Non-Goals

- No edits to `Yulia Halim` (`character.json`) or showcase media binaries.
- No automatic destructive overwrite or forced migration of existing users' saved `The Green Lie` worlds or active campaigns.
- No UI or gameplay-mechanic changes (no wiki updates required).

---

## 5. Acceptance Criteria

1. `backend/app/db/showcase_data/the_green_lie/world.json` contains the normalized upgraded world (37 locations, 88 edges, 13 containers, 15 global lore nodes, 2 props, 3 anchors, 11 vertical pairs) and passes `WorldRecord.model_validate(...)`.
2. `analyzeSpatialConsistency` reports **0 diagnostics** across World Root and every container scope on a freshly seeded `The Green Lie` world.
3. Seeding a new user via `seed_showcase_for_user` produces a private clone with all 3 remapped `anchor_location_id`s, both `location_props` (`Encrypted Ghost Signal Data Slate` hidden, `Old Pistol` visible), all 22 directed `is_vertical = True` edges, all `travel_mode` / `speed_modifier` / `obstacles` values, and `Yulia Halim`'s `Encrypted burner slate` linked to the cloned `"The Sovereign Cipher"` lore ID.
4. Exporting the freshly seeded world + character to `.zcc` and re-importing into an isolated DB succeeds with zero errors and preserves all counts, anchors, props, and vertical flags.
5. All backend and frontend test/lint/architecture verification gates pass.
