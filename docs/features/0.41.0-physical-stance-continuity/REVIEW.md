---
feature: physical-stance-continuity
target_version: 0.41.0
document_type: review
status: completed
last_updated: 2026-11-25
---

# Pre-Implementation Review — v0.41.0 Physical Stance & Motion Continuity Tracking

## Key Architectural Traps & Mitigations

### 1. Persona-less Campaigns & Solo Mode Blind Spot (`turn_streaming.py:154-161`, `zone4_ephemeral.py:596-609`)
- **Trap:** In `backend/app/routers/campaign_routes/turn_streaming.py:154-161`, `current_player_state` is only instantiated as a fallback `PersonaTurnStateSnapshot` **if `persona_snapshot is not None`**. When a campaign is launched with no selected Persona (`campaign.persona_id is None`), `current_player_state` stays `None` through Phase 4 and Phase 5, silently dropping player stance tracking! Likewise, `zone4_ephemeral.py:597` gates player blocks behind `if persona_snapshot:`.
- **Mitigation:**
  - In `turn_streaming.py` (and `get_campaign_state_bundle` in `turns.py`), when `repo.get_campaign_persona_turn_state(...)` returns `None`, unconditionally synthesize a fallback `PersonaTurnStateSnapshot(turn_id=..., equipped=list(persona_snapshot.equipped) if persona_snapshot else [], inventory=list(persona_snapshot.inventory) if persona_snapshot else [], physical_stance="unspecified", physical_context="")`.
  - In `zone4_ephemeral.py` (and `cognition/runner.py`), render `<player_physical_state player="{player_label}">` (falling back to `"Player"` when `persona_snapshot is None`) whenever `current_player_state` has non-unspecified `physical_stance` or non-empty `physical_context`, independent of whether `persona_snapshot` exists or the room is Solo/Narrator.

### 2. Missing `current_persona_turn_state` on `CampaignStateBundle` (`schemas/turn.py:1179`, `turns.py:1213-1230`)
- **Trap:** Today `CampaignStateBundle` carries `character_states` for every NPC, while `persona_turn_states` is only fetched lazily by `WorldCodexTab` via `GET /api/campaigns/{id}/persona-state`. Relying on a separate fetch would cause `LiveInspector`'s `"You"` strip, `CodexCharacterDetail`, and `AgentChangesModal` to show stale Player stance after turns, swipes, timeline branch switches, and manual overrides.
- **Mitigation:**
  - Add `current_persona_turn_state: PersonaTurnStateSnapshot | None = None` to `CampaignStateBundle` (`backend/app/schemas/turn.py` and `frontend/src/types/turn.ts`).
  - Populate it inside `get_campaign_state_bundle` (`backend/app/db/repos/turns.py:1213`) from `persona_turn_states` for `leaf_turn.id` (synthesizing default snapshot when absent) so every turn completion, branch switch, location override, and physical-state override returns atomic player state.

### 3. Provisional Turn Carry-Forward & `persona_turn_states` Persistence (`turns.py:206-275, 425-480`, `personas.py:782-834`)
- **Trap:** `save_turn_node` (`turns.py:206-218`) copies `persona_turn_states` from `parent_turn_id` using explicit column lists (`equipped_json, inventory_json`), and `update_turn_post_state` (`turns.py:425-465`) plus `personas.py:782-834` also hardcode only those two columns. Meanwhile, `save_turn_node`'s absent-NPC copy loop (`turns.py:224-259`) manually constructs `CharacterStateSnapshot`. Missing the new columns in *any* of these four places will silently drop stance across turns, swipes, or absent NPCs.
- **Mitigation:**
  - Update **all** SQL `SELECT`, `INSERT`, and `ON CONFLICT DO UPDATE` statements on `character_states` and `persona_turn_states` across `turns.py` (`save_turn_node`, `update_turn_post_state`, `_populate_turn_character_states`), `personas.py` (`get_campaign_persona_turn_state`, `save_campaign_persona_turn_state`), and `zcc_campaign_io.py`.
  - In `turn_streaming.py:845-895`, preserve parent `physical_stance` and `physical_context` on provisional Phase 4 snapshots before Phase 5 Clerk runs so UI displays don't flicker back to `"unspecified"` mid-turn.

### 4. Zone 1 Static `Posture:` Collision & Cognition `"Outward posture"` Label (`zone1_static.py:202-203, 302-303`, `cognition/runner.py:217`)
- **Trap:** `zone1_static.py` renders `characters.posture` as `- Posture: ...` (single) and `Posture: ...` (ensemble). Additionally, `cognition/runner.py:217` currently renders `f"Outward posture: '{c.feeling_summary}'"` for co-present cognition cues. Small models seeing both static/emotional `"Posture:"` and transient `"Starting Physical State:"` conflate habitual bearing or mood with actual body pose.
- **Mitigation:**
  - Relabel `zone1_static.py:203` (`- Habitual Bearing: {character.posture}`) and `zone1_static.py:303` (`Habitual Bearing: {c.posture}`), leaving `characters.posture` DB schema and character wizards intact.
  - Update `cognition/runner.py:217` from `"Outward posture:"` to `"Outward manner:"` (or `"Emotional demeanor:"`), reserving physical stance terminology strictly for physical state blocks.

### 5. Local 12B LLM JSON Grammar Drift, Synonyms & Sanitation (`schemas/physical.py`, `schemas/turn.py`)
- **Trap:** Per CyberCantina's Pydantic v2 guardrail, fields with default values are omitted from `required` unless explicitly enforced via `required_properties` / `ConfigDict(json_schema_extra=...)`. Furthermore, small local models frequently emit plausible synonyms (`"prone"`, `"supine"`, `"flat"`, `"seated"`, `"slouched"`, `"walking"`, `"cuffed"`, `"unconscious"`) or leak HTML/CoT tags or overlong sentences into `physical_context`.
- **Mitigation:**
  - Ensure `WorldPostTurnDelta` (`player_physical_stance`, `player_physical_context`) and `CharacterAgentDelta` (`physical_stance`, `physical_context`) keep `required=list(schema.get("properties", {}).keys())` and are passed via `required_properties` in `complete_structured`.
  - Build a deterministic `normalize_physical_stance(raw, *, fallback="unspecified")` helper mapping common LLM synonyms cleanly to the 10 canonical `PhysicalStance` literals (e.g., `prone`/`supine`/`flat`/`lying` → `"lying_down"`, `seated` → `"sitting"`, `walking`/`running`/`pacing`/`crawling` → `"moving"`, `bound`/`pinned`/`cuffed`/`tied` → `"restrained"`, `unconscious`/`collapsed`/`fainted` → `"incapacitated"`).
  - Deterministically sanitize `physical_context` in `@model_validator`/`@field_validator`: strip CoT/HTML tags (using strict `</?[a-zA-Z]...` matching, preserving `<` operators), collapse newlines/whitespace, strip trailing punctuation clutter, and truncate cleanly at word boundary `<= 120` chars.

### 6. Smart Staleness Reset Edge Cases (`clerk/pipeline.py`, `db/repos/campaign_spatial.py`)
- **Trap 1 (False Positive Reset):** If a scene transitions to a new location *and* the prose says they immediately sat down at a booth in the new bar, a naive hard reset on location change would wipe `"sitting"` back to `"standing"`.
- **Trap 2 (Case/Whitespace False Negative):** If pre-turn had `("sitting", "in corner booth")` and the Clerk echoes `("sitting", "In corner booth")` with slightly altered casing/whitespace, treating it as "newly changed" would leave stale booth context active after moving to an exterior alley!
- **Trap 3 (Manual Overrides & Restrained/Incapacitated):** Manual location overrides (`override_campaign_location`, `override_character_location`) bypass `clerk/pipeline.py` and would leave stale room poses behind unless they apply the same reset helper. Conversely, auto-clearing `"restrained"` or `"incapacitated"` on a room transition or 1-hour skip breaks narrative prisoner/unconscious continuity.
- **Mitigation:**
  - Implement one shared deterministic helper `resolve_post_turn_physical_state(...)` taking `(prev_stance, prev_context, clerk_stance, clerk_context, *, location_changed: bool, time_elapsed_minutes: int)`:
    - Normalize comparison via `prev_norm = (prev_stance, prev_context.strip().casefold())` vs `clerk_norm = (clerk_stance, clerk_context.strip().casefold())`.
    - Apply staleness reset **only** when `(location_changed or time_elapsed_minutes >= 30)` **and** `clerk_norm == prev_norm`.
    - When triggered: always clear `physical_context = ""` (unless we want to keep nothing room-bound); if `prev_stance in ("restrained", "incapacitated")`, **preserve** `physical_stance = prev_stance`, else set `"standing"` (if `location_changed`) or `"unspecified"` (if `time_elapsed_minutes >= 30`).
  - Invoke the same staleness helper from `override_campaign_location` (for the player and moving NPCs) and `override_character_location` (for the relocated NPC), and capture `physical_state_reset_reason` / `prev`/`next` values on `PostTurnStateDelta` / `CharacterAgentDelta` for `AgentChangesModal` visibility.
  - Skip Clerk physical updates altogether when `is_static_describe` is `True`.

### 7. Leaf Contract Layering (`backend/tach.toml`, `frontend/.dependency-cruiser.cjs`)
- **Trap:** Defining `PhysicalStance` inside `schemas/turn.py` or `types/turn.ts` and importing it from `character.py` / `persona.py` / `mechanicsCatalog.ts` would violate leaf contract boundaries or create circular dependencies (`tach check` / `arch:check`).
- **Mitigation:**
  - Backend: create leaf module `backend/app/schemas/physical.py` (with `PhysicalStance`, `PHYSICAL_STANCE_VALUES`, `normalize_physical_stance`, `sanitize_physical_context`, `format_physical_state_label`), imported downwards by `schemas/character.py`, `schemas/persona.py`, `schemas/turn.py`, and engine modules. (Check `backend/tach.toml` before finalizing imports.)
  - Frontend: create leaf module `frontend/src/types/physical.ts` (with `PhysicalStance`, `PHYSICAL_STANCE_OPTIONS` metadata including display labels & short descriptions, `PhysicalStateOverridePayload`), re-exported by `frontend/src/types/index.ts`. Both UI editors and `mechanicsCatalog.ts` consume `PHYSICAL_STANCE_OPTIONS` as the single source of truth.

### 8. `.zcc` Campaign Archive Compatibility & SQLite Migrations (`schema.sql`, `schema_init.py`, `zcc_campaign_io.py`)
- **Trap:** Existing user databases (`cybercantina.db`) and exported `.zcc` campaign archives from `v0.40.0` or earlier lack `physical_stance` and `physical_context` columns in `character_states` and `persona_turn_states`.
- **Mitigation:**
  - Add `physical_stance TEXT NOT NULL DEFAULT 'unspecified'` and `physical_context TEXT NOT NULL DEFAULT ''` to `backend/app/db/schema.sql` (`character_states` and `persona_turn_states`).
  - Add idempotent `PRAGMA table_info` `ALTER TABLE` guards for both tables in `backend/app/db/repos/schema_init.py`.
  - In `backend/app/services/zcc_campaign_io.py`, normalize `cs.get("physical_stance")` / `pts.get("physical_stance")` through `normalize_physical_stance` (defaulting to `"unspecified"`) and sanitize `physical_context` (defaulting to `""`).

### 9. UI Controls, Streaming Locks & Modular CSS (`06-inspector-and-lore.css`, `12-world-codex.css`, `15-responsive.css`)
- **Trap:** Editing stance/context while a turn is actively streaming would race with `update_turn_post_state`; adding unused CSS selectors or `!important` breaks `npm --prefix frontend run css:audit`.
- **Mitigation:**
  - Gate inline edit triggers on `!isMutatingLocked` (matching `LocationOverrideButton` and Codex `Relocate`).
  - Keep `CharacterRow` stance pill strictly conditional on `isPresent && state.physical_stance && state.physical_stance !== "unspecified"` so off-screen or unestablished characters stay visually clean.
  - Keep the `"You"` Player row in `LiveInspector` compact (one tidy status row with stance pill, context summary/placeholder, and inline popover/edit toggle) so narrow right-pane widths (`620px`/`820px`/`1100px`) remain uncluttered.
  - Place CSS in domain files (`06-inspector-and-lore.css`, `12-world-codex.css`, `15-responsive.css`) without `!important`.

### 10. Node-Only Vitest Verification & Architecture Docs CI Guard
- **Trap:** `frontend/package.json` runs Vitest in pure Node without `jsdom`. Meanwhile, CI runs `scripts/generate_arch_docs.py --check`, which fails if new routes, schema columns, or modules are added without regenerating `docs/architecture/`.
- **Mitigation:**
  - Put frontend formatting/diff helpers in pure TypeScript helpers and pair unit tests with `ReactDOMServer.renderToStaticMarkup` assertions covering `LiveInspector` (with and without Persona), `CharacterRow`, `CampaignCharacterStateTab`, `CodexCharacterDetail` (Persona mode), `AgentChangesModal`, and `mechanicsCatalog`.
  - Run `backend/.venv/bin/python scripts/generate_arch_docs.py && backend/.venv/bin/python scripts/generate_arch_docs.py --check` before finishing implementation.
