---
feature: first-visit-arrival-descriptions
target_version: 0.11.6
document_type: review
status: approved
last_updated: 2026-11-16
---

# Pre-Implementation Review (`v0.11.6`)

## Architectural & Dependency Checks
- **Backend Module Graph ([`backend/tach.toml`](file:///home/diegolima/Git/cybercantina/backend/tach.toml))**:
  - `app.db` depends on `app.schemas`, `app.config`, `app.prompts`, `app.providers`, `app.security`, and `app.engine.affective_engine`.
  - `app.engine.clerk` depends on `app.db` and `app.schemas`.
  - Placing shared pure arrival helpers (`FirstVisitDescriptionCard` construction, ancestor container ordering, boilerplate filtering, `visited_container_ids` backfill) in [`backend/app/db/repos/arrival_descriptions.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/arrival_descriptions.py) allows `app.db.repos.campaigns`, `app.db.repos.campaign_spatial`, `app.db.repos.turns`, and `app.engine.clerk.pipeline` to share a single source of truth with zero `tach.toml` changes.
- **Router Facade Compatibility ([`campaigns.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/campaigns.py))**:
  - Re-export the new campaign world-settings route (`update_campaign_world_settings`) and request schema on `campaign_routes/__init__.py` and `routers/campaigns.py` facade so `_resolve_facade_attr` seams remain intact.
- **Frontend Dependency Graph (`frontend/.dependency-cruiser.cjs`)**:
  - Pure arrival collapse/grouping helpers belong in a chat leaf helper module ([`frontend/src/components/chat/arrivalHelpers.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/arrivalHelpers.ts)) and shared collapsible card component ([`frontend/src/components/chat/ArrivalDescriptionCards.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/ArrivalDescriptionCards.tsx)) imported by [`TurnCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/TurnCard.tsx). Zero upward or circular edges.

## Edge Cases & Pitfalls Verified
1. **SQL JOIN & Context Exclusions for Standalone Map-Move Rows (`actor_id = "__arrival__"`):**
   - `get_turn_node`, `get_branch_turn_chain`, and `list_campaign_turn_nodes` in [`turns.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/turns.py#L675) join `character_states` via `CASE WHEN t.actor_id = '__narrator__' ...`. Update all three joins to `IN ('__narrator__', '__arrival__')` and skip `__arrival__` in `save_turn_node` / `_row_to_turn_node` cognition maps.
   - [`assembler.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/assembler.py#L284) and [`clerk/pipeline.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/clerk/pipeline.py#L399) (Zone 3 working memory and episodic chunking) must explicitly skip turns with `actor_id == "__arrival__"` so map-move synthetic rows never leak into LLM context, working-memory budgets, or summaries.
   - [`zone4_ephemeral.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/zone4_ephemeral.py#L129-L131) (`resolve_character_previous_state`) must still see valid `character_states` copied on `save_turn_node` (already handled automatically by `save_turn_node` copying `parent_cs_rows` & `persona_turn_states` while updating moving characters to `target_loc.id`).
2. **Legacy Campaign `visited_container_ids` Backfill:**
   - Existing campaigns in SQLite have populated `visited_location_ids_json` and empty `visited_container_ids_json` after additive `ALTER TABLE`. On read/transition, derive missing ancestor container IDs from `prev_visited_location_ids` before diffing newly visited containers so existing campaigns do not falsely emit starter/already-visited container cards on their next move.
3. **Turn 0 `start_focus` & Blank-Greeting Fallback Guard:**
   - On `start_focus == "character"`, [`campaigns.py#L144-L147`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/campaigns.py#L144-L147) embeds `primary_loc.description` verbatim when `character.initial_message` is blank and no `opening_prose` is provided, in addition to substituting `{location_description}` when present. Suppress the Turn 0 location card in **both** cases while still emitting qualifying parent container cards.
4. **World Settings Campaign Isolation (No CoW Fork on Toggle):**
   - Toggling `describe_on_first_visit` in Campaign Mode mutates `campaigns.world_settings_json` via `PATCH /api/campaigns/{id}/world-settings` without touching `worlds.global_rules_json` or triggering [`worlds.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/worlds.py#L718) CoW world forking.
   - Do **not** include `describe_on_first_visit` in [`zone1_static.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/zone1_static.py#L299) rendered text so Zone 1 KV-cache remains byte-identical.
5. **Non-Scrolling Clerk Insertion & Collapse Reset:**
   - Clerk updates attach `post_turn.first_visit_cards` to the existing turn card (`overflow-anchor: none` inside arrival panel) without calling `scrollIntoView`.
   - `ChatStage` resets manual expand/collapse overrides whenever `lastTurn.id` changes, and defaults expanded state strictly to `turn.id === lastTurn.id`, guaranteeing all past arrival cards auto-collapse as soon as the next turn arrives.
