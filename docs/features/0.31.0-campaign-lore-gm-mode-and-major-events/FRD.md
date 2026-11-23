---
feature: campaign-lore-gm-mode-and-major-events
target_version: 0.31.0
document_type: frd
status: completed
last_updated: 2026-11-23
---

# Feature Requirements Document (FRD)
## Campaign Lore Authoring, GM Mode ("Unlock Lore & Secrets"), Secret Discovery & Major Events

**Status:** Completed  
**Target Version:** CyberCantina v0.31.0  
**Depends On:**
- [v0.28.0 Timeline Branching, Story Modal & Interactive Branch Graph](file:///home/diegolima/Git/cybercantina/docs/features/0.28.0-timeline-branching-and-story-modal/FRD.md)
- [v0.29.0 Turn Bookmarks, Personal Notes & Clerk Single-Turn Summarization](file:///home/diegolima/Git/cybercantina/docs/features/0.29.0-turn-bookmarks-and-notes/FRD.md)
- [v0.30.0 Running Campaign `.zcc` v2 Export/Import & Encryption](file:///home/diegolima/Git/cybercantina/docs/features/0.30.0-campaign-export-import-and-encryption/FRD.md)

**Scope:**
- SQLite Schema, Migration & Branch-Safe Lore / Reveal Persistence ([`schema.sql`](file:///home/diegolima/Git/cybercantina/backend/app/db/schema.sql), [`schema_init.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/schema_init.py), [`campaign_lore_items.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/campaign_lore_items.py), [`worlds.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/worlds.py), [`campaign_spatial.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/campaign_spatial.py), [`turns.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/turns.py), [`vector_store.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/vector_store.py))
- Schemas, Campaign World Settings & Lore/Major-Event API Endpoints ([`world.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/world.py), [`turn.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/turn.py), [`crud_and_state.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/campaign_routes/crud_and_state.py), [`spatial_routes.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/campaign_routes/spatial_routes.py))
- Phase 5 Post-Turn World Clerk Prompts, Secret Reveal Detection, Major Events & Location Mutations ([`defaults.py`](file:///home/diegolima/Git/cybercantina/backend/app/prompts/defaults.py), [`pipeline.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/clerk/pipeline.py), [`heuristics.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/clerk/heuristics.py), [`world_clock.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/world_clock.py))
- `.zcc` v2 Campaign Export / Import Parity ([`zcc_campaign_io.py`](file:///home/diegolima/Git/cybercantina/backend/app/services/zcc_campaign_io.py))
- Frontend World Settings, Codex, Map Drawer & Story Modal UI ([`WorldInspectorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldInspectorModal.tsx), [`WorldCodexTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldCodexTab.tsx), [`CodexLocationDetail.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/CodexLocationDetail.tsx), [`codexHelpers.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/codexHelpers.ts), [`MapDetailsDrawer.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDetailsDrawer.tsx), [`MapLoreSection.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapLoreSection.tsx), [`StoryModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/story/StoryModal.tsx))
- User-Facing Wiki Documentation ([`Live-Inspector-Map-and-Timeline.md`](file:///home/diegolima/Git/cybercantina-wiki/Live-Inspector-Map-and-Timeline.md), [`Authoring-Worlds-Characters-and-Personas.md`](file:///home/diegolima/Git/cybercantina-wiki/Authoring-Worlds-Characters-and-Personas.md), [`Playing-Directing-and-Mechanics.md`](file:///home/diegolima/Git/cybercantina-wiki/Playing-Directing-and-Mechanics.md), [`Prompt-Customization-and-Presets.md`](file:///home/diegolima/Git/cybercantina-wiki/Prompt-Customization-and-Presets.md))

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
During an active CyberCantina campaign, world-building and emergent canon currently suffer from four structural gaps:

1. **Inconsistent Campaign Lore Editing & Secret Leakage:**
   - World-level Codex lore (`world.lore_nodes`) is strictly read-only during campaigns ([`WorldCodexTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldCodexTab.tsx)) and explicitly blocked by the `lore_nodes` SQLite `CHECK` constraint ([`schema.sql`](file:///home/diegolima/Git/cybercantina/backend/app/db/schema.sql#L313)) and Pydantic validator ([`world.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/world.py#L668-L671)).
   - Meanwhile, [`MapLoreSection.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapLoreSection.tsx#L231-L506) inside the Map Details Drawer allows players to edit location/L1 container lore *and* exposes `secret` entries at all times, creating a spoiler loophole that bypasses Codex secret hiding ([`codexHelpers.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/codexHelpers.ts#L301-L308)).
2. **Non-Branch-Safe Campaign Lore Overrides:**
   - Existing campaign overrides (`campaign_location_lore_overrides` / `campaign_container_lore_overrides` in [`campaign_lore_items.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/campaign_lore_items.py#L454-L609)) are keyed solely by `(campaign_id, entity_id)` without turn lineage, causing edits to bleed across sibling timeline branches or persist after rewinding/deleting turns.
3. **No Persistent Secret Discovery State:**
   - [`lore_scope.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/lore_scope.py#L511-L611) evaluates `secret` prompt injection ephemerally per turn. Once a secret is genuinely uncovered in narrative prose, it never unlocks in the player's Codex—leaving secrets permanently invisible unless viewed in the World Editor.
4. **No Automated Campaign Chronicle or Permanent World/Location Evolution:**
   - Major canon-altering milestones (e.g., assassinating a monarch, redirecting a river so a swamp becomes a dry forest, erecting a monument in a plaza) live only in rolling episodic chunks or ephemeral `scene_flags`. They neither become permanent searchable Codex history / updated location descriptions nor appear in a dedicated chronological chronicle inside the `Story` modal.

### 1.2 Proposed Solution
1. **"Unlock Lore & Secrets (GM Mode)" Setting:** Add a campaign-scoped GM override toggle in `World Settings` (off by default on new campaigns; visible but disabled/greyed out in World Edit mode). When enabled during a campaign, it unlocks branch-safe adding, editing, and deleting of lore across the **World Codex**, **Locations**, **L1 Containers**, and **Story -> Major Events**, and reveals all hidden secrets in the UI.
2. **Branch-Safe Secret Discovery Tracking:** Track revealed `secret` lore IDs in turn snapshots (`world_state_snapshots`) so secrets stay hidden everywhere in campaign UI until actually revealed in play (or while GM Mode is temporarily toggled on). Turning GM Mode back off re-hides unrevealed secrets while keeping genuinely discovered secrets visible.
3. **Phase 5 Clerk Major Events & Permanent Location Evolution:**
   - **World-changing events** are automatically logged by the Phase 5 Clerk as branch-safe **World Codex `history`** entries (referencing the location where they happened, characters/personas involved, and keywords).
   - **Location-changing physical events** permanently update the affected location's branch-scoped `description` / `environmental_tags` via `campaign_spatial_overrides` (avoiding contradicting `description` vs. `lore_nodes`), while also recording a chronological Major Event milestone.
4. **Story Modal `Major Events` Tab:** Add a chronological, branch-scoped **Major Events** accordion tab to [`StoryModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/story/StoryModal.tsx) with full expandable details and GM Mode Edit/Remove (or Revert) controls to correct Clerk hallucinations.
5. **Strict Base-World Isolation & Branch Safety:** All manual and Clerk-generated lore additions, edits, secret reveals, and location alterations never modify the base world and apply strictly from the turn they were created onward along the active timeline branch.

---

## 2. Scope, Boundaries & Core Invariants

1. **Base-World Isolation Invariant (Hard):**
   - No campaign lore addition, edit, deletion, secret reveal, Major Event, or Clerk location alteration may ever mutate base-world rows (`worlds`, `location_nodes`, `location_containers`, `lore_nodes WHERE campaign_id IS NULL`) or leak into base-world `.zcc` exports (`base_only=True`).
2. **Branch-Safety & Turn-Anchor Invariant (Hard):**
   - Every lore entry created, edited, or superseded during a campaign—whether manually via GM Mode or automatically by the Phase 5 Clerk—is anchored to `created_at_turn_id` / `superseded_at_turn_id` (and every location mutation to `campaign_spatial_overrides.turn_id`; every secret reveal to `world_state_snapshots`).
   - An entry added or modified at Turn `N` is visible **only** at Turn `N` and its descendants. Branching from an earlier turn (e.g., Turn 4 after editing at Turn 8), switching to a sibling branch, swiping Turn `N`, or deleting Turn `N` automatically excludes those changes from both UI and RAG vector retrieval.
3. **GM Mode Is Strictly UI-Only (Hard):**
   - Enabling **Unlock Lore & Secrets (GM Mode)** reveals unrevealed `secret` entries and unlocks editing in the **player UI only**. It must **never** bypass the Python secret gate in [`lore_scope.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/lore_scope.py#L511-L611) or leak unrevealed secrets into Phase 2–4 LLM prompts.
4. **Uniform Secret Gating Across All Campaign UI Surfaces (Hard):**
   - When GM Mode is OFF, unrevealed `secret` lore entries must be hidden identically across:
     - World Codex (`WorldCodexTab`, `CodexLocationDetail`),
     - Codex Global Search (`searchAllCodexEntries`) and Location Tree counts (`buildCodexLocationTree`),
     - Map Details Drawer (`MapLoreSection` for both Locations and L1 Containers).
   - Once revealed on the active branch, a `secret` entry remains visible across those surfaces even after GM Mode is turned OFF (unless the player branches/rewinds to a turn prior to the reveal).
5. **No Contradictory Location Description + Local Lore:**
   - Permanent physical changes to a location (e.g., swamp drained into dry forest, statue built in plaza) mutate the location's branch-scoped metadata (`campaign_spatial_overrides`), **not** location `lore_nodes`, so Zone 4 `<location>` never contradicts `<local_lore>` and authored local lore slots (`max_ambient_entries = 5`) are never crowded out.
6. **Semantic Accent & UI Discipline:**
   - Reserve `--accent-rose` / red strictly for errors, validation failures, and destructive delete actions.
   - Use `TagChipsInput` for all lore keyword/entity-tag fields.
   - Use `--accent-amber` / `--accent-violet` for GM Mode badges, Secret badges, and Major Event accents.

---

## 3. Functional Requirements

### FR-1: "Unlock Lore & Secrets (GM Mode)" World Setting

#### 1.1 Data Model & Persistence
- Extend `CampaignWorldSettings` in [`backend/app/schemas/turn.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/turn.py#L390-L396) and [`frontend/src/types/turn.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/turn.ts#L57-L59) with:
  - `unlock_lore: bool = False`
- Existing campaigns whose `world_settings_json` lacks `unlock_lore` deserialize cleanly with default `False`.
- New campaigns always initialize `unlock_lore = False` (this setting is **not** inherited from `WorldGlobalRules`).
- Extend `PATCH /api/campaigns/{campaign_id}/world-settings` ([`crud_and_state.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/campaign_routes/crud_and_state.py#L359-L370)) to accept and persist `unlock_lore`.

#### 1.2 UI Presentation in `World Settings` ([`WorldInspectorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldInspectorModal.tsx#L920-L988))
- Add a checkbox control titled **`Unlock Lore & Secrets (GM Mode)`** under the **World Settings** tab:
  - **Campaign Mode (`isCampaignMode === true`):**
    - Enabled (unless `isMutatingLocked` is active during a running turn) and unchecked (`false`) by default.
    - Description clearly states:
      1. Reveals all hidden location/container secrets in the Codex and Map Inspector (UI-only; does not reveal secrets to AI characters).
      2. Unlocks adding, editing, and removing lore in the World Codex, Locations, L1 Containers, and Story -> Major Events (plus correcting Clerk edits).
      3. **Branch-Safety Tip:** *"Lore changes apply only to this campaign starting from the current turn onward—never to the base world. If you branch or rewind to an earlier turn (e.g., branching from Turn 4 after editing at Turn 8), later lore edits will not appear on that branch."*
  - **World Edit Mode (`isCampaignMode === false`):**
    - Rendered **disabled (greyed out)** and unchecked, with a brief muted note: *"Campaign-only GM override. All lore and secrets are already editable in World Edit mode."*
- When GM Mode is toggled **ON** in Campaign Mode, display a subtle non-intrusive status pill (e.g., `GM Mode Active`) in the World Inspector / Codex header and Story `Major Events` tab so the player always knows spoilers and editing are unlocked.

---

### FR-2: Branch-Safe Campaign Lore Authoring (Codex, Locations & L1 Containers)

#### 2.1 Schema & Branch-Safe Storage (`lore_nodes` & `vector_entries`)
- Migrate `lore_nodes` ([`schema.sql`](file:///home/diegolima/Git/cybercantina/backend/app/db/schema.sql#L301-L329), [`schema_init.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/schema_init.py)):
  - Relax the `CHECK` constraint (and [`LoreNode._enforce_scope_invariants`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/world.py#L654-L674)) so `campaign_id IS NOT NULL` is valid for **world-level** lore (`location_id IS NULL AND container_id IS NULL`) as well as location and L1 container lore.
  - Add branch lineage and Major Event columns:
    - `created_at_turn_id TEXT NULL REFERENCES turn_nodes(id) ON DELETE CASCADE`
    - `superseded_at_turn_id TEXT NULL REFERENCES turn_nodes(id) ON DELETE SET NULL`
    - `origin_lore_id TEXT NULL` *(optional pointer to the base/prior lore entry replaced by an edit, for clean CoW superseding across branches)*
    - `is_major_event INTEGER NOT NULL DEFAULT 0`
- **Branch Resolution Rules (for a given `campaign_id` + `valid_turn_ids`):**
  - A base-world row (`campaign_id IS NULL`) is active unless superseded by a campaign tombstone/revision whose `created_at_turn_id IN valid_turn_ids` (or `superseded_at_turn_id IN valid_turn_ids` on campaign-scoped rows).
  - A campaign row (`campaign_id = ?`) is active iff `(created_at_turn_id IS NULL OR created_at_turn_id IN valid_turn_ids)` AND `(superseded_at_turn_id IS NULL OR superseded_at_turn_id NOT IN valid_turn_ids)`.
  - Legacy rows from pre-v0.31.0 `campaign_location_lore_overrides` / `campaign_container_lore_overrides` remain backward-compatible (treated as root-turn / `created_at_turn_id IS NULL` overrides until edited on a newer turn).
- **Vector Store Parity ([`vector_store.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/vector_store.py)):**
  - World-level campaign `lore` entries (`source_type='lore'`) are embedded with `campaign_id = campaign.id` and `anchor_turn_id = leaf_turn_id`.
  - Vector retrieval filters `source_type='lore'` by `(campaign_id IS NULL OR campaign_id = ?)` and respects `anchor_turn_id` / `superseded_at_turn_id` against `valid_branch_turn_ids` so edited/deleted base lore is excluded on the edited branch while staying intact on other branches and other campaigns.
  - `secret` entries continue to be excluded from `vector_entries` (retrieved strictly via the active-location/container hard gate in `lore_scope.py`).

#### 2.2 Campaign Lore API Endpoints
- Add/update campaign-owner-scoped endpoints (all rejecting mutations with HTTP `403` when `campaign.world_settings.unlock_lore` is `False`!):
  - **World Codex Lore:** `PUT /api/campaigns/{campaign_id}/lore` (or granular `POST /api/campaigns/{campaign_id}/lore`, `PATCH /api/campaigns/{campaign_id}/lore/{lore_id}`, `DELETE /api/campaigns/{campaign_id}/lore/{lore_id}`) — anchors new/edited/deleted world-level lore entries to `campaign.active_leaf_turn_id`, updates `vector_entries` asynchronously, and returns updated `CampaignStateBundle`.
  - **Location & L1 Container Lore:** Upgrade existing `PUT /api/campaigns/{campaign_id}/locations/{location_id}/lore` and `PUT /api/campaigns/{campaign_id}/containers/{container_id}/lore` to:
    1. Require `campaign.world_settings.unlock_lore === True` (HTTP `403` otherwise).
    2. Persist diffs branch-safely at `campaign.active_leaf_turn_id` rather than overwriting campaign-wide override tables.

#### 2.3 Frontend Editing Surfaces (Gated by `unlock_lore`)
- **World Codex ([`WorldCodexTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldCodexTab.tsx)):**
  - When `isCampaignMode && unlockLore`: enable `+ Add Entry`, inline editing (`CodexLoreEditor`), Duplicate, and Delete across the 4 World Codex sections (`History & Culture`, `Factions & Figures`, `Items & Artifacts`, `Rumors & Threats`), supporting both campaign-added entries and existing base-world entries via branch-safe CoW superseding, with clear save persistence to the campaign lore endpoint.
  - When `isCampaignMode && !unlockLore`: strictly read-only (current behavior).
- **Codex Locations & L1 Containers ([`CodexLocationDetail.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/CodexLocationDetail.tsx)):**
  - When `isCampaignMode && unlockLore`: allow adding, editing, and deleting local/container lore (including existing base-world entries via branch-safe CoW) directly from Codex Location/L1 Container detail views (reusing or sharing the campaign lore save callbacks).
- **Map Details Drawer ([`MapLoreSection.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapLoreSection.tsx) & [`MapDetailsDrawer.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDetailsDrawer.tsx)):**
  - Gate the `+ Add Lore`, `Edit`, and `Delete` controls in campaign mode strictly behind `unlockLore === true` (closing the existing bypass where players could edit location/container lore with GM Mode off).
  - When `isCampaignMode && unlockLore`: also unlock editing `name`, `summary`, `description`, and `environmental_tags` on **visited locations** (`isLocNarrativeLocked` bypassed when GM Mode is active, persisting branch-safely via `campaign_spatial_overrides`), so players can manually tweak descriptions or correct Clerk location mutations directly on the map.

---

### FR-3: Secret Lore Visibility & Branch-Safe Discovery Tracking

#### 3.1 Branch-Safe Revealed Secret State
- Add `revealed_lore_ids_json TEXT NOT NULL DEFAULT '[]'` to `world_state_snapshots` ([`schema.sql`](file:///home/diegolima/Git/cybercantina/backend/app/db/schema.sql#L367-L376)) with an idempotent `ALTER TABLE` migration in [`schema_init.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/schema_init.py).
- Expose `revealed_lore_ids: list[str] = Field(default_factory=list)` on `WorldStateSnapshot` in [`backend/app/schemas/turn.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/turn.py) and [`frontend/src/types/turn.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/turn.ts).
- Carry `revealed_lore_ids` forward monotonically on each subsequent turn along a branch (union of prior turn's `revealed_lore_ids` + newly revealed IDs this turn), just like `visited_location_ids`.

#### 3.2 Reveal Detection (Phase 5 Clerk)
- When a turn completes at `active_location` (and its immediate L1 container, if any), collect any **not-yet-revealed** `secret` lore nodes belonging to that location / L1 container (optionally prioritizing those injected into Phase 2/4 context or referenced in `raw_prose`).
- Pass those candidate unrevealed secrets (ID, title, brief summary/tags) to the Phase 5 World Clerk and add `revealed_secret_lore_ids: list[str]` to `WorldPostTurnDelta`:
  - **Strict Prompt Rule:** Mark a secret ID as revealed **only** if the secret's substance was actually disclosed to, discovered by, or witnessed by the player in the turn's public narrative prose (`raw_prose`). Never mark a secret revealed merely because an NPC thought about it privately in `<cognition>` or hinted obliquely without revealing it.
  - Validate returned IDs strictly against the candidate unrevealed secret IDs for that turn.
  - Deterministic offline fallback (when `allow_offline_fallback` is enabled): only mark revealed if a secret was both injected by `lore_scope.py` *and* its key phrase/tag appears in `raw_prose`.

#### 3.3 Visibility Matrix Across UI Surfaces

| Context | Non-Secret Lore | Revealed `secret` Lore | Unrevealed `secret` Lore |
| :--- | :---: | :---: | :---: |
| World Edit Mode | Visible & Editable | Visible & Editable | Visible & Editable |
| Campaign Mode (`unlock_lore = false`) | Visible (Read-Only) | Visible (Read-Only, `Secret · Discovered` badge) | **Hidden** (omitted from lists, counts, and Codex search) |
| Campaign Mode (`unlock_lore = true`) | Visible & Editable | Visible & Editable (`Secret · Discovered` badge) | **Visible & Editable** (`Secret · Hidden` GM badge) |

- Toggling `unlock_lore` back to `false` immediately re-hides all unrevealed secrets while keeping secrets in `current_world_snapshot.revealed_lore_ids` visible.
- **Manual Reveal / Hide Toggle in GM Mode:** When `unlock_lore === true`, each `secret` entry (in Codex Location/Container detail and `MapLoreSection`) exposes a quick **`Mark Revealed` / `Mark Hidden`** toggle (persisted branch-safely to `revealed_lore_ids` at the active leaf turn) so GMs can manually correct missed or premature Clerk reveal detections.
- `category = "secret"` remains scoped strictly to **Locations** and **L1 Containers** (not World-level Codex entries).

---

### FR-4: Phase 5 Clerk Major Events & Permanent Location Alterations

#### 4.1 Explicit Event Qualification Criteria (Prompt Calibration)
Update `DEFAULT_CLERK_POST_TURN_SYSTEM` ([`backend/app/prompts/defaults.py`](file:///home/diegolima/Git/cybercantina/backend/app/prompts/defaults.py#L217-L241)) with an explicit, high-threshold rubric designed to prevent small-model over-triggering:

- **Emit `null` on ~90%+ of routine turns.**
- **Explicit Positive List — World-Changing Events (`scope: "world"`):**
  - Death, assassination, overthrow, capture, or coronation/appointment of a major political, faction, or regional leader.
  - Outbreak or resolution of a war, coup, city-wide lockdown, treaty, rebellion, or faction schism/collapse.
  - Cataclysmic, supernatural, or technological events affecting an entire region or world (e.g., power grid collapse, plague outbreak, magical rift opening, public revelation of a world-shattering conspiracy).
  - Destruction, theft, or activation of a legendary/world-defining artifact with region-wide fallout.
- **Explicit Positive List — Location-Changing Events (`scope: "location"`):**
  - Permanent physical transformation of the site or terrain (e.g., building burned down or collapsed, river redirected turning a swamp into dry land, monument/statue erected, breach blown through a fortified wall).
  - Permanent change in ownership, faction control, security regime, or public function of the location (e.g., tavern seized and boarded up by syndicate enforcers, shrine consecrated or desecrated).
  - Permanent sealing or opening of a major landmark feature within the location.
- **Explicit Negative List (NEVER emit a Major Event):**
  - Routine dialogue, banter, flirting, negotiations without lasting world/site change, ordering food/drinks, shopping, resting, or ordinary travel between rooms.
  - Temporary combat/scuffles, knocked-over furniture, spilled drinks, weather changes, or transient tactical conditions (those belong in `scene_flags_updated`).
  - Private personal revelations, minor interpersonal arguments, or character emotional shifts (those belong in per-character memories / CARE).

#### 4.2 Structured `WorldPostTurnDelta` Extension
Add an optional structured `major_event` field to `WorldPostTurnDelta` ([`backend/app/schemas/turn.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/turn.py#L508-L545)):
- `scope: Literal["world", "location"]`
- `evocative_title: str` — 1-sentence (concise) evocative title *without* the date prefix (backend formats the date deterministically so the LLM never malforms dates).
- `summary: str` — brief objective summary explicitly naming the involved character(s)/persona(s) and, for world events, referencing the location where it occurred (e.g., *"At the Royal Courtyard, ... "*).
- `keywords: list[str]` — concrete entity, character, faction, and location tags (min 1, deduplicated).
- **For `scope == "location"` only (Locations only for v0.31.0; L1 Containers are not auto-mutated by the Clerk):**
  - `location_description_update: str | None` — targeted revision of `active_location.description` preserving all unchanged physical layout, exits, and static details while updating only what permanently changed.
  - `environmental_tags_added: list[str]` (default `[]`)
  - `environmental_tags_removed: list[str]` (default `[]`)

#### 4.3 Date Formatting & Persistence Rules
1. **Deterministic Date Prefix:**
   - Compute `date_prefix` from `new_timestamp` using [`world_clock.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/world_clock.py):
     - If `parse_world_timestamp(new_timestamp)` succeeds: `dt.strftime("%Y-%m-%d")`.
     - If custom/fantasy calendar: strip trailing `HH:MM` / `(+Nm)` time suffix if present; otherwise preserve the date label cleanly.
   - Final stored title: `f"{date_prefix} - {evocative_title}"` (trimmed to schema max length).
2. **If `scope == "world"`:**
   - Insert a branch-safe **World Codex `history`** `LoreNode`:
     - `world_id = world_id`, `campaign_id = campaign_id`, `location_id = None`, `container_id = None`
     - `category = "history"`, `is_major_event = 1`, `created_at_turn_id = completed_turn.id`
     - `title = f"{date_prefix} - {evocative_title}"`, `content = summary`, `entity_tags = keywords` (ensuring location name & involved names are included in `content` and/or tags).
   - Embed into `vector_entries` (`source_type = "lore"`, `campaign_id = campaign_id`, `anchor_turn_id = completed_turn.id`).
   - Avoid double-indexing a redundant `event_{turn.id}` episodic vector when `major_event` already covers the turn's event.
3. **If `scope == "location"`:**
   - Persist a branch-safe **`campaign_spatial_overrides`** row on `turn_id = completed_turn.id`, `entity_type = "location"`, `entity_id = active_location.id`:
     - **Critical:** Copy the current effective location's `container_id`, `is_entry_exit`, `ui_x`, `ui_y`, and `icon` (and merge into any existing `metadata_override_json` on that turn) so spatial layout is never clobbered.
     - Apply the updated `description` and `environmental_tags` (applying `added`/`removed` case-insensitively) inside `metadata_override_json`.
   - Persist the structured Major Event record on `turn_nodes.post_turn_json` (e.g., `major_event` with `id`, `scope="location"`, `location_id`, `location_name`, `date_label`, `title`, `summary`, `keywords`, `previous_description`, `updated_description`, `tags_added`, `tags_removed`, `deleted: bool = False`) so it appears chronologically in **Story -> Major Events** and can be edited or cleanly reverted in GM Mode.

---

### FR-5: Story Modal `Major Events` Tab ([`StoryModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/story/StoryModal.tsx))

#### 5.1 Tab Layout & Branch Scope
- Add a fourth tab **`Major Events`** in `StoryModal` alongside `Summary`, `Timelines`, and `Bookmarks`, showing a count badge for active-branch major events.
- Display a branch-scope banner matching `Summary`: *"Showing major world and location events for the **currently active timeline branch**."*
- Empty state when no major events have occurred on the active branch.

#### 5.2 Chronological Ordering & Accordion Expansion
- Combine active-branch **world-scoped Major Events** (from active branch `lore_nodes` where `is_major_event === true`) and active-branch **location-scoped Major Events** (from active branch `turn_nodes.post_turn.major_event` where not deleted).
- **Strict Chronological Order:** Sort ascending by branch turn `depth_index` (oldest -> newest), with creation/row order as tie-breaker—never by naive alphabetical string sort on titles.
- **Collapsed Row:** Displays the formatted title (`YYYY-MM-DD - Evocative title`), scope badge (`World` vs. `<Location Name>`), and `Turn #N` badge.
- **Expanded Panel (on click, `aria-expanded`):**
  - Full event summary (including characters/personas involved and location reference),
  - Keyword chips (`entity_tags` / `keywords`),
  - For location-changing events: compact diff/preview of the applied location description/tag alteration,
  - Action links: **`Jump to Turn #N`** (closes modal and scrolls chat to the turn, reusing `onZoomToTurn`) and **`Open on Map`** (for location-referenced events).

#### 5.3 GM Mode Edit & Remove / Revert Controls
- When `unlock_lore === true` (and `!isMutatingLocked`), each expanded Major Event displays inline **Edit** and **Delete / Revert** controls:
  - **World Major Event (`lore_nodes`):**
    - **Edit:** Updates the World Codex `history` `LoreNode` (title, summary, keywords) in place (if created on the active leaf) or via branch-safe CoW revision, keeping World Codex and `Major Events` in sync.
    - **Delete:** Marks the `LoreNode` deleted/superseded on the active branch (removing it from both World Codex, `Major Events`, and RAG retrieval).
  - **Location Major Event (`post_turn.major_event` + `campaign_spatial_overrides`):**
    - **Edit:** Lets the user edit the Major Event summary/title/keywords **and** adjust the location's overridden `description` / `environmental_tags`.
    - **Delete & Revert:** Soft-deletes the Major Event from the timeline and reverts the location's `campaign_spatial_overrides` metadata mutation on that turn (while preserving any user map layout coordinates on that turn).

---

### FR-6: `.zcc` v2 Campaign Export / Import & Migration Compatibility
- Update [`zcc_campaign_io.py`](file:///home/diegolima/Git/cybercantina/backend/app/services/zcc_campaign_io.py) so running campaign `.zcc` exports/imports round-trip:
  - `campaigns.world_settings_json` (including `unlock_lore`),
  - `world_state_snapshots.revealed_lore_ids_json`,
  - Branch-safe `lore_nodes` columns (`created_at_turn_id`, `superseded_at_turn_id`, `origin_lore_id`, `is_major_event`) including world-level campaign lore (`location_id IS NULL AND container_id IS NULL AND campaign_id IS NOT NULL`),
  - `turn_nodes.post_turn_json` (`major_event`) and `campaign_spatial_overrides` (already exported).
- Base-world exports (`export_single_world`) continue to export strictly `campaign_id IS NULL` lore and base `location_nodes`.

---

## 4. Resolved Design Decisions

1. **Base-World Lore Editing Scope in GM Mode:** `Unlock Lore & Secrets (GM Mode)` allows adding new lore **and** editing/deleting/hiding existing base-world lore across World Codex, Locations, and L1 Containers via branch-safe campaign Copy-on-Write (`created_at_turn_id` / `superseded_at_turn_id` / `origin_lore_id`), leaving the base world untouched.
2. **Clerk Location-Change Mutation Strategy:** For permanent location-changing events, the Phase 5 Clerk performs a **targeted revision** of `active_location.description` (preserving unchanged layout, exits, and details) plus `environmental_tags_added` / `environmental_tags_removed` deltas persisted via branch-safe `campaign_spatial_overrides`.
3. **Visited Location Metadata in `MapDetailsDrawer`:** Enabling `Unlock Lore & Secrets (GM Mode)` also unlocks editing `name`, `summary`, `description`, and `environmental_tags` on visited locations (`isLocNarrativeLocked` bypassed when GM Mode is active, saved branch-safely via `campaign_spatial_overrides`).
4. **Manual Reveal / Hide Toggle for Secrets:** When GM Mode is ON, `secret` entries expose a **`Mark Revealed` / `Mark Hidden`** toggle updating `revealed_lore_ids` at the active leaf turn.
5. **World-Level `secret` Scope:** `category = "secret"` remains scoped strictly to **Locations & L1 Containers** (not World-level Codex entries).
6. **Clerk Physical Mutation Scope:** Phase 5 Clerk permanent physical mutations apply to **Locations only** for v0.31.0; L1 Container lore remains manually editable in GM Mode.

---

## 5. Acceptance Criteria & Verification Plan

### 5.1 Acceptance Criteria
- [x] `World Settings` displays **`Unlock Lore & Secrets (GM Mode)`**: disabled by default on new campaigns, greyed out in World Edit mode, with a clear branch-safety tip in Campaign Mode.
- [x] With GM Mode OFF: all lore editing/adding/deleting is blocked in UI and API (`403`) across World Codex, Codex Locations/L1 Containers, Map Details Drawer, and `Major Events`; unrevealed `secret` entries are hidden across all surfaces and search.
- [x] With GM Mode ON: users can add, edit, and delete lore (including existing base-world lore via branch-safe CoW) across World Codex, Locations, and L1 Containers, edit visited location metadata in `MapDetailsDrawer`, manually toggle `Mark Revealed` / `Mark Hidden` on secrets, and view all secrets (with clear *Discovered* vs. *Hidden* indicators); LLM prompt secret-gating remains unaffected.
- [x] Turning GM Mode OFF re-hides unrevealed secrets while keeping secrets previously revealed on the active branch visible.
- [x] Phase 5 Clerk marks secrets revealed in `world_state_snapshots.revealed_lore_ids` only when actually disclosed in turn prose.
- [x] Phase 5 Clerk logs qualifying **world-changing** events as branch-safe World Codex `history` entries (`<date> - <1-sentence evocative title>`, location reference, involved characters/personas, keywords) and applies qualifying **location-changing** events via branch-safe `campaign_spatial_overrides` (preserving spatial coordinates/parenting).
- [x] `StoryModal` renders a chronological, branch-scoped **`Major Events`** tab with expandable full details, jump-to-turn links, and GM Mode inline Edit & Delete/Revert actions.
- [x] Branching from an earlier turn, switching timelines, swiping, or deleting the last turn cleanly rolls back all lore additions/edits, secret reveals, Major Events, and Clerk location alterations from later turns; base-world data and base-world exports remain untouched.
- [x] Running campaign `.zcc` v2 export/import preserves all new lore lineage, `unlock_lore`, `revealed_lore_ids`, Major Events, and location overrides.

### 5.2 Required Verification Suite
- **Backend:**
  - `cd backend && .venv/bin/ruff check app tests && .venv/bin/tach check`
  - `backend/.venv/bin/pytest backend/tests` (covering `lore_nodes` migration, `403` guard when `unlock_lore=False`, branch-safe world/location/container lore CoW + vector RAG filtering, `revealed_lore_ids` persistence & rollback, Clerk Major Event world-lore + `campaign_spatial_overrides` spatial-preservation, GM edit/revert endpoints, and `.zcc` v2 round-trip)
- **Frontend:**
  - `npm --prefix frontend run arch:check && npm --prefix frontend run build && npm --prefix frontend test` (covering World Settings GM toggle in edit vs. campaign mode, unified secret hiding/revealing across Codex + Search + MapLoreSection, GM editing controls, and `StoryModal` Major Events chronological sort/expand/edit/delete)
- **Architecture & Wiki Docs:**
  - `backend/.venv/bin/python scripts/generate_arch_docs.py && backend/.venv/bin/python scripts/generate_arch_docs.py --check`
  - Update user-facing wiki pages in `../cybercantina-wiki` (`Live-Inspector-Map-and-Timeline.md`, `Authoring-Worlds-Characters-and-Personas.md`, `Playing-Directing-and-Mechanics.md`, `Prompt-Customization-and-Presets.md`).
