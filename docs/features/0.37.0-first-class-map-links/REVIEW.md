---
feature: first-class-map-links
target_version: 0.37.0
document_type: review
status: completed
last_updated: 2026-11-24
---

# Pre-Implementation Review — v0.37.0 First-Class Map Links

## Key Architectural Traps & Mitigations

1. **Player-Mode `PUT /api/campaigns/{campaign_id}/map` Silently Deleting Undiscovered Secret Links (CRITICAL):**
   - **Trap:** To prevent network-tab spoiler leaks, `get_campaign_state` strips undiscovered secret edges from `world_edges` when `unlock_lore == False`. If a player subsequently edits another node or normal link in the campaign map and saves via `PUT /api/campaigns/{campaign_id}/map`, the client's submitted `edges` array will not include those hidden secret edges. A naive diff (`existing_edges - submitted_edges`) in `campaign_map_update.py` would mark every undiscovered secret link as superseded/deleted!
   - **Mitigation:** In `campaign_map_update.py`, compute the set of undiscovered secret edges on the active branch when `not unlock_lore`. Exclude them from deletion/supersession diffs and automatically preserve them untouched. Additionally, reject (`403 PermissionError`) any player-mode attempt to set `is_secret=True` or alter an existing secret edge's `is_secret` flag. Add a dedicated regression test covering player-mode map saves with hidden secret edges present.

2. **CoW Edge Supersession Re-Hiding Already-Discovered Secret Links (CRITICAL):**
   - **Trap:** Editing an edge in a live campaign (`PATCH /api/campaigns/{campaign_id}/edges/{edge_id}` or `PUT /api/campaigns/{campaign_id}/map`) uses Copy-on-Write supersession when `edge.created_at_turn_id != active_leaf_turn_id`, minting a **new `edge_id`**. If `WorldStateSnapshot.revealed_edge_ids` only matches raw `edge_id` strings, editing `obstacles`, `distance_meters`, or `is_blocked` on a discovered secret link would immediately re-hide it!
   - **Mitigation:**
     - During CoW supersession in `campaign_spatial.py` and `campaign_map_update.py`, whenever a superseded edge ID is present in the active snapshot's `revealed_edge_ids`, automatically append/remap the replacement edge ID (and its reciprocal) into `revealed_edge_ids`.
     - Furthermore, when checking whether an active edge is revealed on a branch, resolve membership by exact `edge_id` **or** canonical unordered endpoint pair (`tuple(sorted((edge.from_location_id, edge.to_location_id)))`) derived from all branch edges whose IDs appear in `revealed_edge_ids`. This guarantees both pairwise symmetry (`A → B` and `B → A`) and CoW resilience across edits and checkouts.

3. **Secret Link Discovery Timing & Diceless Campaign Soft-Locks:**
   - **Trap A (One-Turn Lag):** If secret link discovery were evaluated only in Phase 5 Clerk (after prose generation), Phase 4 prose wouldn't know the player just found the secret passage on the turn they rolled a Critical Success on Investigation.
   - **Trap B (Diceless Soft-Lock):** In campaigns running `dice_mode == "disabled"`, Phase 1 emits no dice rolls—making dice-only secret links permanently unreachable.
   - **Mitigation:**
     - Partition neighbors before Phase 1: pass only already-visible neighbors into Phase 1 so undiscovered secret links cannot leak prematurely.
     - Immediately after Phase 1 (before Phase 2 builds Zone 4), evaluate `select_newly_discovered_secret_edges(...)` mirroring `select_contextual_lore` in `lore_scope.py`: unlock on Clean/Critical Success discovery rolls (or rolls matching the secret edge's label/obstacles), and when `dice_mode == "disabled"`, unlock on explicit search/investigation intent or matching keywords in the player's message.
     - Inject newly discovered secret edges into that same turn's Zone 4 context tagged `| NEWLY DISCOVERED SECRET PASSAGE`, and persist the edge ID + reciprocal ID into `WorldStateSnapshot.revealed_edge_ids` in Phase 5 Clerk.

4. **Prompt Hallucination From Hardcoded `"walk"` & Unanchored Clerk Clock:**
   - **Trap:** Leaving `"walk"` hardcoded in `zone4_ephemeral.py` (`[10km, ~3 min walk]`) when `speed_modifier = 25` (`Rail`) causes prose models to narrate superhuman sprinting. Conversely, leaving travel time purely advisory in Phase 5 Clerk lets small models ignore `speed_modifier = 0.3` (`Swamp`) and advance the clock by 2 minutes for a 40-minute trek.
   - **Mitigation:**
     - Route all exit strings through `format_exit_travel_phrase(distance_meters, speed_modifier, travel_mode)` (emitting `"walk"` only when `speed_modifier ≈ 1.0` and `travel_mode` is empty; otherwise `"via {travel_mode}"` or `"travel"`).
     - In `clerk/pipeline.py`, apply `derive_travel_minutes(nb.distance_meters, nb.speed_modifier)` as a deterministic floor on `elapsed_minutes` whenever `transition_type == "move_existing"` (skipping the floor only for sub-30-second hops where `distance / (70 * speed_modifier) < 0.5`, and capping at `MAX_TURN_ELAPSED_MINUTES_SANITY`).

5. **Double-Migration / Disappearing Exits on Legacy `is_locked_or_hidden`:**
   - **Trap:** Mapping legacy `is_locked_or_hidden = 1` to `is_secret = True` would make previously visible locked doors vanish from existing campaigns, `.zcc` exports, and *The Green Lie* showcase world.
   - **Mitigation:** In `schema_init.py`, Pydantic `@model_validator(mode="before")`, `import_export_service.py`, `zcc_campaign_io.py`, and `seed.py`, map legacy `is_locked_or_hidden` strictly to `is_blocked` (with `is_secret = False`) only when `is_blocked` and `is_secret` are absent. Audit `the_green_lie/world.json` explicitly by hand to assign `is_blocked` vs. `is_secret` per passage.

6. **SVG Hit-Targets, Click-vs-Double-Click Races & `MultiEdgePopover` Retirement:**
   - **Trap A (Thin Edge Selection):** Standard 2px SVG link strokes are frustratingly hard to click; conversely, single-click selection on a badge can fight with badge time-preview toggling or double-click inline editing.
   - **Trap B (Mobile Deselection):** Tapping an edge line or badge on touch devices must register in `pendingTapTargetRef` so `finishGesture` does not deselect the link on pointer-up.
   - **Trap C (Global `Delete` Shortcut in Inspector Inputs):** Pressing `Delete`/`Backspace` inside `MapDetailsDrawer` inputs (e.g., `TagChipsInput` for obstacles or `travel_mode` input) must never trigger canvas link deletion.
   - **Mitigation:**
     - Render wide transparent SVG hit-target paths (`strokeWidth={14}`–`16`, `stroke="transparent"`) under every link line so single-clicking anywhere along the connection reliably selects it in `MapDetailsDrawer`.
     - Keep `TagChipsInput` for `obstacles` (never a raw comma-joined controlled `<input>`), keep inline distance editor as a screen-space HTML overlay (never `<foreignObject>`), and preserve the existing input-focus guard on the global `Delete` key handler.
     - Retire `MultiEdgePopover` cleanly by moving collapsed supernode bundle listing into `MapDetailsDrawer` so all edge inspection lives in one unified panel.

7. **Pydantic v2 + Local LLM Constrained JSON Grammar (`LocationEdgeDraft`):**
   - **Trap:** Adding new optional/defaulted fields (`speed_modifier`, `travel_mode`, `obstacles`, `is_blocked`, `is_secret`) to `LocationEdgeDraft` without updating `required_properties` or prompt instructions can cause constrained local decoders to emit malformed types or omit keys.
   - **Mitigation:** Explicitly sanitize/coerce `speed_modifier`, `travel_mode`, `obstacles`, `is_blocked`, and `is_secret` in deterministic `@model_validator`s on `LocationEdgeDraft` (stripping HTML/markup from `travel_mode` and `obstacles`, clamping floats, defaulting nulls safely) and keep `world_wizard.py` `required_properties` synchronized.

8. **Architecture Layering, Facades & CI Checks:**
   - **Trap:** Importing backend helpers across prohibited `tach.toml` layers or introducing frontend circular imports across `types/` ↔ `components/map/` (`arch:check`).
   - **Mitigation:** Keep pure metric/speed constants and formatters in leaf modules (`backend/app/schemas/world.py` and `frontend/src/utils/spatialDistance.ts`), keep `LocationEdge` DTOs in `frontend/src/types/world.ts`, place new inspector/badge CSS in `frontend/src/styles/06-inspector-and-lore.css` using semantic tokens from `00-tokens.css` (no `!important`), and regenerate `docs/architecture/` before completion.
