---
feature: runtime-spatial-improvisation
target_version: 0.52.0
document_type: review
status: completed
last_updated: 2026-11-27
---

# Pre-Implementation Review — Runtime Spatial Improvisation & Link Discovery

## Architectural Risks & Mitigations

### 1. Local 12B LLM JSON Schema Size & Structured Output Reliability
- **Trap:** Local constrained JSON decoders skip fields with defaults unless explicitly listed in `required`, while overly large nested schemas on every turn hurt latency and generation reliability.
- **Mitigation:** Keep `ImprovisedLinkSpec` optional (`WorldPostTurnDelta.improvised_link: ImprovisedLinkSpec | None = None`) so routine `stay` / `move_existing` turns pay zero schema overhead, while marking every field inside `ImprovisedLocationSpec` and `ImprovisedLinkSpec` as `required` in `json_schema_extra` (`Pydantic v2 + Local LLM JSON Grammar` rule).

### 2. Unrevealed Secret Links & Spoiler Leaks
- **Trap:** Including unvisited locations behind unrevealed `is_secret` edges in `Other Known Locations`, or letting multi-hop Dijkstra / 2D Euclidean offset projection route through hidden `is_secret` edges, would let the LLM or UI leak secret doors/tunnels and expose base-world secrets.
- **Mitigation:** Both `select_candidate_known_locations` and `compute_visible_scope_positions` strictly exclude unrevealed `is_secret` edges unless `campaign.world_settings.unlock_lore` is enabled or the edge/pair is in `revealed_edge_ids` (`pipeline.py` already loads revealed edge IDs cleanly). Duplicate-name coercion likewise ignores hidden unvisited targets behind secret-only edges.

### 3. ReDoS Safety in `extract_travel_cues`
- **Trap:** Regexes scanning untrusted turn text or prose (`\s*(.*?)` or unbounded word-gap scans) can trigger CodeQL `py/polynomial-redos`.
- **Mitigation:** Restrict all patterns in `extract_travel_cues` (`spatial_geometry.py`) to bounded non-overlapping token windows (e.g., `\d{1,5}(?:\.\d{1,2})?\s{0,2}(?:meters?|m|kilometers?|km)\b`, fixed word counts `{0,3}` between verb and unit), matching `world_clock.py` hygiene and `py/polynomial-redos` rules.

### 4. Geometry Clamping vs. Narrative Pace & Disconnected Scopes
- **Trap:** Clamping `Street ↔ Plaza` from `350m` to `783m` while keeping the LLM's `elapsed_minutes=5` creates an internal contradiction (5 min walk for 783m = `157 m/min`), or wrongly clamps a magic portal / vertical lift. Worse, clamping across incompatible disconnected container components could fabricate arbitrary distances.
- **Mitigation:**
  - Bypass Euclidean clamping whenever `distance_mode == "non_euclidean"`, `is_vertical == True`, or `estimate_euclidean_offset` returns `None` (disconnected component / mixed non-Euclidean boundary).
  - When clamping applies (`~783m`), drive `min_travel_minutes` from `derive_travel_minutes(clamped_meters, speed_modifier)` (`~11 min` at `1.0x`), while honoring explicit narrative faster pace cues (`sprint` -> `2.0x` ~6 min, `bike`/`vehicle` -> `3.0x`/`10.0x`).

### 5. Duplicate-Name Coercion False Positives
- **Trap:** Over-eager substring matching on generic nouns (`"Street"`, `"Room"`, `"Hall"`) could mistakenly redirect an intentionally distinct new room (e.g., `"North Back Alley"` vs `"South Alley"`) onto an unrelated older location.
- **Mitigation:** Trigger automatic duplicate-name coercion in `pipeline.py` strictly on **normalized exact name match** (lowercase, trimmed, optional leading `"the "` stripped, identical normalized token sequence) within 1-hop neighbors or eligible `Other Known Locations` — never fuzzy substring matching.

### 6. `tach.toml` Layer Boundary Compliance
- **Trap:** `backend/tach.toml` forbids `app.db` from importing `app.engine.*` outside explicitly listed modules (`affective_engine`, `parties`), so calling `spatial_geometry` inside `world_locations.py` would fail `tach check`.
- **Mitigation:** Perform all geometry calculations, clamping, candidate filtering, and shortest-path Dijkstra inside `app.engine.spatial_geometry` and `app.engine.clerk.pipeline` before calling `repo.add_improvised_link(...)`. Keep `world_locations.py` strictly focused on SQL persistence (`from app.schemas.turn import ImprovisedLinkSpec, ImprovisedLocationSpec`).

### 7. Bidirectional Compass Port Overflow & Branch Deletion Cleanup
- **Trap:** Connecting two existing rooms that already have 8 neighbors or connecting a portal to an existing busy hub could collide on compass slots or fail `UNIQUE`/8-neighbor constraints; timeline branch deletions must also prune improvised links created by `add_improvised_link`.
- **Mitigation:**
  - `add_improvised_link` sets `created_at_turn_id = completed_turn.id` identically to `add_improvised_location`, so existing `DELETE FROM location_edges WHERE created_at_turn_id IN (...)` cleanup in `turns.py` and `.zcc` v2 campaign export/import handles it automatically.
  - On `from_location_id` overflow (`>= 8` distinct neighbors), route cleanly via an existing Passage Hub (or spawn one on `target_dir`) just like `add_improvised_location`; on `to_location_id`, pick the nearest available free slot around `OPPOSITE_COMPASS[fwd_dir]`, and if `to_location_id` already has 8 distinct neighbors, fall back cleanly through `to_location_id`'s hub (or nearest edge slot) so writes never drop edges silently.
