---
feature: parties
target_version: 0.21.0
document_type: frd
status: draft
last_updated: 2026-11-19
---

# Feature Requirements Document (FRD)
## Parties System: Empty-Room Foundation, Co-Located Travel Groups & Party Management

**Status:** Draft  
**Target Version:** CyberCantina v0.21.0  
**Depends On:** `0.20.1-codex-polish-and-campaign-sidebar`  
**Scope:**
- **Phase 1 (Prerequisite — Standalone Empty / Solo Rooms):**
  - Backend Turn Pipeline, Solo Prompting, Persistence & Schemas ([`turn_streaming.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/campaign_routes/turn_streaming.py), [`phase1_pre.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/phase1_pre.py), [`assembler.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/assembler.py), [`zone1_static.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/zone1_static.py), [`zone4_ephemeral.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/zone4_ephemeral.py), [`phase4_prose.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/phase4_prose.py), [`pipeline.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/clerk/pipeline.py), [`turns.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/turns.py))
  - Frontend Solo-Room Composer & Turn Semantics ([`ChatStage.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ChatStage.tsx), [`ChatComposer.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/ChatComposer.tsx), [`DirectorChoicesDrawer.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/DirectorChoicesDrawer.tsx))
- **Phase 2 (Core Parties System):**
  - Backend Schemas, DDL, Migrations & Spatial/Turn Persistence ([`turn.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/turn.py), [`character.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/character.py), [`schema.sql`](file:///home/diegolima/Git/cybercantina/backend/app/db/schema.sql), [`schema_init.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/schema_init.py), [`turns.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/turns.py), [`campaigns.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/campaigns.py), [`campaign_spatial.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/campaign_spatial.py))
  - Backend Routers & Engine ([`schemas_and_gate.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/campaign_routes/schemas_and_gate.py), [`crud_and_state.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/campaign_routes/crud_and_state.py), [`turn_streaming.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/campaign_routes/turn_streaming.py), [`choices.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/choices.py), [`cognition/runner.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/cognition/runner.py), [`zone4_ephemeral.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/zone4_ephemeral.py), [`clerk/pipeline.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/clerk/pipeline.py), [`char_agent/agent.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/char_agent/agent.py), [`clerk_placement.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/clerk_placement.py))
  - Frontend Types, API Client, Party UI, Composer & Overrides ([`turn.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/turn.ts), [`campaigns.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/api/campaigns.ts), [`App.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/App.tsx), [`AppSidebar.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/AppSidebar.tsx), [`ChatStage.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ChatStage.tsx), [`CharacterMentionPicker.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/CharacterMentionPicker.tsx), [`InspectorLocationCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/inspector/InspectorLocationCard.tsx), [`MapDetailsDrawer.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDetailsDrawer.tsx), [`CharacterRow.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/inspector/CharacterRow.tsx), [`CampaignCharacterModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/inspector/CampaignCharacterModal.tsx), [`SpatialTopologyView.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/SpatialTopologyView.tsx), [`NewCampaignModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/NewCampaignModal.tsx), [`styles.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css), plus new Party Management Modal & command/party helpers)
- **Automated Tests:** `backend/tests/` and `frontend/src/components/__tests__/`

---

## 1. Executive Summary, Problem Statement & Phased Delivery Strategy

### 1.1 Problem Statement
CyberCantina currently treats spatial movement and companionship as implicit, heuristic side effects rather than explicit player-driven and character-consented mechanics:

1. **Empty / Solo Rooms Are Impossible Today:**
   - In [`turn_streaming.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/campaign_routes/turn_streaming.py#L201-L209), whenever no campaign characters are physically located in `active_location`, the backend forces `present_characters = [primary_character]`, runs Phase 3/4 for that character, and writes `current_location_id = active_location.id` on [L635-L640](file:///home/diegolima/Git/cybercantina/backend/app/routers/campaign_routes/turn_streaming.py#L635-L640)—silently teleporting an absent character into the room.
   - Similarly, [`ChatStage.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ChatStage.tsx#L171-L183) unconditionally merges `character.id` into `presentCharacters`, and Phase 1/2/3/4 assume `present_characters[0]` exists as an active speaker.
2. **Fuzzy Heuristic Movement & Blanket Teleports:**
   - In [`agent.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/char_agent/agent.py#L480-L528) and [`defaults.py`](file:///home/diegolima/Git/cybercantina/backend/app/prompts/defaults.py#L263-L267), every co-present character defaults to `follow_player` whenever the player moves unless negative regexes or free-text cues override it—causing stationary NPCs (bartenders, shopkeepers, contacts) to trail behind the player automatically.
   - Location overrides ([`campaign_spatial.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/campaign_spatial.py#L77-L157), [`turn_streaming.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/campaign_routes/turn_streaming.py#L179-L183)) and Narrator turns ([`pipeline.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/clerk/pipeline.py#L637-L670)) blindly move every co-located NPC to the new room, with no single-click way for the player to travel alone or bring only specific companions, and no endpoint to reposition a single NPC.
3. **No Party Model or In-Character Formation Flow:**
   - There is no structured representation of a traveling party (player + NPCs or NPC-only), no `/party` invitation or cognitive accept/refuse flow, no party UI in the left sidebar (`AppSidebar` has `Codex` only after `0.20.1`), and no spatial/data anchor to support future single-cognition off-screen NPC groups.

### 1.2 Phased Delivery Strategy
To decouple foundational empty-room support from party semantics and isolate higher-risk autonomous NPC behavior for dedicated design review, delivery is structured into three phases:

1. **Phase 1 (Prerequisite — Implement Standalone First): Empty / Solo Room Support (`present_characters == []`)**
   - Enables the player persona to occupy and act inside locations containing zero campaign characters without forcing `[primary_character]` into the scene or confusing solo player turns with OOC Narrator directive turns.
   - Must be implemented, tested, and verified independently before Phase 2 starts.
2. **Phase 2 (Core Feature — Primary Target of v0.21.0): Parties System**
   - Introduces turn-snapshotted `PartyRecord` state, strict co-location (Model 1), leader-anchored movement, structured Phase 3 `travel_intent` & `party_invite_decision` fields, deterministic Phase 4 Zone 4 directives and Phase 5 enforcement, `/party` slash commands with `@Name` longest-prefix parsing & scoped autocomplete, left-pane `Party` button & Party Management Modal (including NPC-only party creation/disbanding), split-button Location Override + generalized character location override, `NewCampaignModal` `"Start in Party"` checkboxes, Quick Exits phrasing alignment, and Narrator turn alignment.
3. **Phase 3 (Deferred / Future Discussion — Out of Scope for v0.21.0):**
   - **NPC-Initiated Party Splits (In-Room Walkouts):** Autonomous NPC departure from a party while remaining in the same room requires further design discussion (CARE Trust/Grievance triggers vs. LLM discretion, preventing 12B false-positive walkouts on tense banter, and NPC-party leader interactions) before implementation.
   - **Off-Screen Character-Only Party Cognition:** Future long-term capability enabling off-screen NPC-only parties to act and traverse the map using a single party-level cognition pass rather than per-character cognition. Phase 2 explicitly prepares the schema (`PartyRecord.location_id`, `leader_id`, `shared_goal`) and strict co-location invariant so Phase 3 can layer cleanly onto it.

---

## 2. Scope, Boundaries & Core Invariants

1. **Empty-Room Solitary Fidelity:**
   - When zero campaign characters occupy `active_location`, `present_characters` MUST remain `[]` across backend turn execution and frontend rendering.
   - Solo-room standard turns MUST use a distinct sentinel (`actor_id = "__solo__"`) separate from explicit Narrator directive turns (`actor_id = "__narrator__"`) and cosmetic arrival turns (`actor_id = "__arrival__"`), ensuring Phase 1 pre-analysis, location/lore RAG, solo `auto`/`forced` dice checks, and standard swipe/edit semantics operate normally without touching absent characters' `current_location_id`.
2. **Party Definition & Single-Party Disjointness:**
   - A party is a group of **2 or more** characters (`len(member_ids) >= 2`).
   - The player persona is modeled as a character inside `member_ids` using CyberCantina's canonical `"user"` sentinel (matching CARE relation edges and arbitration winner keys; never referencing the `characters` table via SQLite FK).
   - Every character (including `"user"`) may belong to **at most one** active party on any turn snapshot.
3. **Strict Co-Location Invariant (Model 1):**
   - Every member of an active party MUST share the exact same `current_location_id == party.location_id`.
   - Any spatial divergence removes the diverging member(s) from their party:
     - **Single-member departure or kick** (cognition `stay_behind`, independent `move_to_neighbor`, `/party leave`, `/party kick`, or single-character location override): removes only the diverging/kicked member(s).
     - **Subset / solo departure** (player Location Override `"Move Alone"` or `"Move Selected"`, or player leaving via `/party leave`): if **2 or more** co-located former party members remain together in the origin location, they **stay together as an NPC-only party** (with a randomly elected `leader_id` if the previous leader left; player can later disband them via the Party Management modal).
     - Any party whose membership drops below 2 dissolves immediately.
4. **Leader-Anchored Movement & Player Agency:**
   - Movement resolution is strictly anchored by `leader_id`:
     - In a **player party** (`"user" in member_ids`), `leader_id` is ALWAYS `"user"`. Co-located party members follow the player when the player moves unless their Phase 3 cognition emits `travel_intent = "stay_behind"`. If an NPC independently moves to a neighbor (`move_to_neighbor`) while the player stays, that NPC splits off—never pulling the player (preserving [`zone1_static.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/zone1_static.py#L138) no-puppeteering).
     - In an **NPC-only party** (`"user" not in member_ids`), `leader_id` is **randomly elected** from `member_ids` upon formation (and randomly re-elected from remaining members if the current leader leaves and `>= 2` members remain). When an NPC-only party is co-located with the player, its members follow `leader_id` unless a member explicitly diverges (`stay_behind` or `move_to_neighbor`).
5. **Turn-Branch Snapshotting:**
   - Active parties are persisted per turn node via `world_state_snapshots.parties_json` and copied forward in [`save_turn_node`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/turns.py#L141-L268) alongside `character_states` and `persona_turn_states`.
   - Swiping/regenerating a turn, editing a prior turn, deleting the last turn (`delete_last_turn`), or checking out an earlier branch (`checkout_turn_branch`) MUST deterministically restore the exact `parties` snapshot of that timeline node.
6. **Deterministic Phase 3 → Phase 4 → Phase 5 Contract (Zero Free-Text Plan Parsing):**
   - Never rely on post-hoc regex/Clerk interpretation of free-text `<plan>` bullets to determine travel or invitation consent.
   - Extend `CognitionBlock` with structured enum fields (`travel_intent` and `party_invite_decision`), passed via `required_properties` in grammar-constrained `complete_structured` schemas ([`choices.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/choices.py#L231-L319)) **only** when applicable to the turn.
   - Between Phase 3 and Phase 4, Python computes exact movement and invite cohorts and injects explicit **conditional** Zone 4 directives (`<movement_resolution>` / `<party_invite_outcomes>` / `<party_event>`) so Phase 4 prose aligns with Phase 5 state mutations without narrating failed moves.
7. **4-Zone KV-Cache Economy:**
   - Dynamic party membership, party rosters, and invite/breakup events MUST NEVER be injected into Zone 1 ([`zone1_static.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/zone1_static.py)). Inject them strictly into Zone 4 ([`zone4_ephemeral.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/zone4_ephemeral.py)) and Phase 3 cognition prompts ([`cognition/runner.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/cognition/runner.py)) so Zone 1 prefix caching remains 100% intact across party changes.
8. **Arrival Card & Visited-Location Isolation on Overrides:**
   - Player Location Override (`POST /api/campaigns/{campaign_id}/location-override`) must update `parties_json` consistently across **both** its `__arrival__` turn creation path and its in-place leaf update path ([`campaign_spatial.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/campaign_spatial.py#L71-L162)), as well as pre-turn `req.override_location_id` handling in [`turn_streaming.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/campaign_routes/turn_streaming.py#L170-L183).
   - Character Location Override (`POST /api/campaigns/{campaign_id}/characters/{character_id}/location-override`) ALWAYS updates `leaf_turn` in-place and MUST NEVER touch `visited_location_ids`, `visited_container_ids`, `active_location_id`, or emit `first_visit_cards` / `first_visit_media` / `__arrival__` turn nodes.

---

## 3. Data Model, Schema & API Contracts

### 3.1 Core Schemas (`backend/app/schemas/` & `frontend/src/types/`)

1. **`PartyRecord`** ([`turn.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/turn.py), [`turn.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/turn.ts)):
   - `id: str` — unique identifier (`party_{uuid4().hex[:10]}`).
   - `name: str | None = None` — optional display label; UI falls back to `"Your Party"` when `"user" in member_ids` or joined member names (e.g., `"Kira & Viktor"`) when omitted.
   - `member_ids: list[str]` — ordered list containing `"user"` and/or `character.id` values; `@model_validator` enforces deduplication and `len(member_ids) >= 2`.
   - `leader_id: str` — must belong to `member_ids`; automatically normalized to `"user"` whenever `"user" in member_ids`.
   - `location_id: str` — current `LocationNode.id` shared by all members.
   - `shared_goal: str | None = None` — optional short objective string (unused by LLM in v1; reserved for Phase 3 off-screen party cognition).
   - `formed_at_turn_id: str` — `turn_id` where the party snapshot originated.

2. **`PartyActionSpec`** ([`turn.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/turn.py), [`turn.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/turn.ts)):
   - `kind: Literal["invite", "leave", "kick", "disband"]`
   - `target_character_ids: list[str] = Field(default_factory=list)`
   - `message: str | None = None`
   - `source: Literal["slash_command", "party_modal"] = "slash_command"`
   - Added as optional `party_action: PartyActionSpec | None = None` on `TurnSubmitRequest` (and `TurnSubmitOptions` in TypeScript) and persisted as `party_action: PartyActionSpec | None = None` on `PreTurnAnalysis` so swiping or editing a `/party` turn preserves its exact command semantics.

3. **`CognitionBlock` Extensions** ([`character.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/character.py), [`character.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/character.ts)):
   - `travel_intent: Literal["default", "stay_behind", "follow_player"] = "default"`
   - `party_invite_decision: Literal["accept", "refuse"] | None = None`
   - **Dynamic Grammar Enforcement ([`choices.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/choices.py#L231-L319)):** Update `build_undirected_cognition_schema` and `build_directed_cognition_schema` with optional flags (`include_travel_intent: bool = False`, `include_party_invite: bool = False`):
     - When `pre_turn.spatial_intent != "stay"`, include `"travel_intent"` in schema `properties` and `required` (enum `["default", "stay_behind", "follow_player"]`, omitting `"follow_player"` for existing party members or `"stay_behind"` for non-party members as appropriate, or validating cleanly).
     - When `party_action.kind == "invite"` and the character is in `target_character_ids`, include `"party_invite_decision"` in schema `properties` and `required` with strict enum `["accept", "refuse"]` (never nullable during an active invite evaluation so local 12B GBNF decoders cannot emit `null`).

4. **`WorldStateSnapshot` & `CampaignStateBundle` Updates:**
   - Add `parties: list[PartyRecord] = Field(default_factory=list)` to `WorldStateSnapshot` (and mirror `parties: list[PartyRecord]` on `CampaignStateBundle` or read via `current_world_snapshot.parties` — exposing `parties: list[PartyRecord] = Field(default_factory=list)` on `WorldStateSnapshot` guarantees every turn node carries its exact timeline party snapshot automatically).

### 3.2 SQLite Schema & Idempotent Migration

1. **DDL ([`schema.sql`](file:///home/diegolima/Git/cybercantina/backend/app/db/schema.sql#L352-L360)):**
   - Extend `world_state_snapshots`:
     ```sql
     parties_json TEXT NOT NULL DEFAULT '[]'
     ```
2. **Migration ([`schema_init.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/schema_init.py#L187-L300)):**
   - In `init_db`, inspect `PRAGMA table_info(world_state_snapshots)` and idempotently execute:
     ```sql
     ALTER TABLE world_state_snapshots ADD COLUMN parties_json TEXT NOT NULL DEFAULT '[]';
     ```
     whenever `parties_json` is absent.
3. **Turn Persistence ([`turns.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/turns.py#L141-L430), [`_row_to_turn_node`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/turns.py#L1135-L1155)):**
   - Persist `parties_json` in `save_turn_node` (copying forward `parent_turn_id`'s `parties_json` when `world_snapshot.parties` is not explicitly replaced, matching `visited_location_ids_json` / `persona_turn_states` inheritance).
   - Update `update_turn_post_clerk` to persist updated `parties_json` alongside `world_state_snapshots`.
   - Hydrate `parties` in `_row_to_turn_node` with safe `json.loads(r["parties_json"] or "[]")` fallback.

### 3.3 REST Endpoints & Request Schemas

| Method & Path | Request / Changes | Behavior |
| :--- | :--- | :--- |
| `POST /api/campaigns` | Extend `CampaignCreateRequest` with `start_in_party_character_ids: list[str] = []` | Validates IDs against selected participants; seeds Turn 0 `parties` with `PartyRecord(member_ids=["user", *valid_ids], leader_id="user", location_id=start_loc_id, formed_at_turn_id=root_turn_id)` when `>= 1` character checked. |
| `POST /api/campaigns/{campaign_id}/location-override` | Extend `LocationOverrideRequest` with `move_mode: Literal["party", "alone", "subset"] = "party"` and `accompanying_character_ids: list[str] \| None = None` | Moves player to `location_id`. In `"party"` mode moves co-located player party; in `"alone"` moves player only; in `"subset"` moves only selected co-located party members. Non-party NPCs stay put. Left-behind `>= 2` party members stay together as an NPC-only party with a randomly elected leader. |
| `POST /api/campaigns/{campaign_id}/characters/{character_id}/location-override` | `CharacterLocationOverrideRequest(location_id: str)` | Moves any campaign character in-place on `leaf_turn` to `location_id`. Removes character from any prior party (re-electing/preserving `>= 2` remaining co-located members or dissolving `< 2`). Never triggers arrival cards or `visited_location_ids`. |
| `POST /api/campaigns/{campaign_id}/parties` | `CreateNpcPartyRequest(character_ids: list[str], name: str \| None = None)` | Instant OOC creation of an NPC-only party on `leaf_turn`. Requires `>= 2` valid campaign NPCs sharing the same `current_location_id` and not currently in a party (or explicitly validates conflict). Randomly elects `leader_id`. |
| `DELETE /api/campaigns/{campaign_id}/parties/{party_id}` | — | Instant OOC disband of an **NPC-only** party on `leaf_turn`. Rejects disbanding `"user"`'s party (`400`) — player party disbandment MUST execute via an in-character turn (`party_action.kind == "disband"`). |

All mutation endpoints (`parties`, `location-override`, `characters/{id}/location-override`) should acquire `campaign_turn_gate.lock_for(campaign_id)` or guard against concurrent turn mutation cleanly and return the refreshed `CampaignStateBundle`.

---

## 4. Functional Requirements — Phase 1 (Empty / Solo Room Support)

*Phase 1 MUST be completed and verified independently before Phase 2 implementation begins.*

### FR-1.1: Remove Forced Primary-Character Fallbacks
1. **Backend ([`turn_streaming.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/campaign_routes/turn_streaming.py#L201-L210)):**
   - Remove the `if not present_characters: present_characters = [primary_character]` fallback when `active_location` has zero campaign characters.
   - Keep `present_characters = []` as a valid first-class state for standard player turns.
2. **Backend Bundle ([`turns.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/turns.py#L1006-L1010)):**
   - Preserve true empty `present_character_ids = []` when no campaign character has `current_location_id == active_loc.id`.
3. **Frontend ([`ChatStage.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ChatStage.tsx#L171-L183)):**
   - Fix `presentCharacters` memo so when `bundle.present_character_ids` is defined and empty (`[]`), `presentCharacters` resolves to `[]` instead of force-injecting `character.id` (`bundle.present_character_ids ?? [character.id]` fallback only when `present_character_ids` is `undefined`).

### FR-1.2: Solo-Room Standard Turn Execution (`actor_id = "__solo__"`)
When `not is_narrator` and `len(present_characters) == 0`:
1. **Dedicated Sentinel (`actor_id = "__solo__"`):**
   - Set `actor_id = "__solo__"` on the saved `TurnNodeRecord` (distinct from `"__narrator__"` so solo player actions are never mistaken for `/narrate` directive turns).
2. **Phase 1 Pre-Analysis ([`phase1_pre.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/phase1_pre.py#L779-L1020)):**
   - Run `run_phase1_pre_analysis` with `present_characters=[]`:
     - Do **not** fall back to `[character]` inside `room_chars` when `present_characters` is explicitly `[]`.
     - Populate `spatial_intent`, `target_location_hint`, `mentioned_entities`, `memory_search_queries`, and `mechanics_check` (evaluated for the player's action).
     - Set `active_speaker_id = "__solo__"` and `speaker_order = []`.
     - Preserve `detect_persona_disclosures` Solitary Action Guard (`present_characters_count=0` → `[]`, never unlocking NPC secrets when nobody is present).
     - Resolve solo player `resolved_roll` when `dice_mode` is `"auto"` (and `mechanics_check.requires_roll` is true) or `"forced"`, labeling the roll for the protagonist rather than an absent NPC.
3. **Phase 2 Context Assembly ([`assembler.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/assembler.py), [`zone1_static.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/zone1_static.py), [`zone4_ephemeral.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/zone4_ephemeral.py)):**
   - Zone 1 uses the static solo world/protagonist system prompt (`build_zone1_narrator_system_prompt` + `format_zone1_player_protagonist_block`, plus guidance for depicting player actions, location exploration, and mechanical check outcomes without puppeteering player speech/choices).
   - Zone 2 renders campaign episodic chunks normally.
   - Zone 3 retains working memory turns in the protagonist's thread (including prior `"__solo__"` turns).
   - Zone 4 injects `<active_location>`, `<other_characters_in_room>` (`None — you are alone here`), `<connected_locations>`, `<recalled_memories_and_lore>`, `<mechanics_outcome>` (if rolled), `<player_visible_equipment>`, and the player's `User Action / Dialogue` — without emitting any absent NPC's `<internal_affective_state>` or `<character_active_cognition>`.
4. **Phase 3 & Phase 4:**
   - Skip Phase 3 cognition (`established_cognitions = {}`, emitting `phase3_start` / `phase3_complete` with `roster=[]` cleanly so streaming UI progress tracks predictably).
   - Stream Phase 4 prose depicting environmental response, solitary physical actions, and dice-check outcomes (`is_narrator=False`, solo fallback in [`build_offline_simulated_prose`](file:///home/diegolima/Git/cybercantina/backend/app/engine/phase4_prose.py#L29-L194)).
5. **Phase 5 Post-Turn Clerk ([`pipeline.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/clerk/pipeline.py)):**
   - Run with `scene_characters = []`:
     - Execute Global World Clerk (`_compute_world_delta`) for clock advance, `active_location_id` movement, `improvised_location`, `scene_flags`, `first_visit_cards`, and `first_visit_media`.
     - Run episodic chunk summarization when `unsummarized > wm_limit`.
     - Process remote `@Character:` comms whispers ([`pipeline.py#L812-L868`](file:///home/diegolima/Git/cybercantina/backend/app/engine/clerk/pipeline.py#L812-L868)) so players can still radio off-site NPCs while alone in a room.
     - Copy forward all campaign characters' `character_states` **unchanged** in their existing locations (`save_turn_node` inheritance + zero forced moves in Phase 5).

### FR-1.3: Solo-Room Persistence, Branching & Frontend UX
1. **SQLite Queries ([`turns.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/turns.py#L708-L765), [`list_campaign_turn_nodes`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/turns.py#L804-L807)):**
   - Update `CASE WHEN t.actor_id IN ('__narrator__', '__arrival__', '__solo__')` across `get_turn_node`, `get_branch_turn_chain`, and `list_campaign_turn_nodes` so joining `character_states` resolves cleanly to `campaigns.character_id` without failing when `actor_id == '__solo__'`.
2. **Swipe & Edit Preservation ([`ChatStage.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ChatStage.tsx#L614-L679)):**
   - Update `inferNarratorTurnOptions` so `turn.actor_id === "__solo__"` returns `{ isNarrator: false }`, allowing players to swipe or edit solo-room turns with `diceMode` (`auto`/`forced`/`disabled`) intact.
3. **Frontend Composer & TurnCard Polish ([`ChatComposer.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/ChatComposer.tsx), [`DirectorChoicesDrawer.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/DirectorChoicesDrawer.tsx)):**
   - When `presentCharacters.length === 0`:
     - Disable or show a clear empty state in the `Choices` button / `DirectorChoicesDrawer` (`"No characters present in this location to guide."`).
     - Update composer placeholder from `"Write your action or dialogue to ${character.name}..."` to `"You are alone in ${bundle.active_location.name}. Describe your action... (Or try @Name: for comms, /look, /wait 30m)"`.
     - Ensure `TurnCard` and `LiveInspector` render `"__solo__"` turns cleanly as `"Scene / Narrator"` without attributing solo narration to an absent `character.name`.

---

## 5. Functional Requirements — Phase 2 (Party System)

*Phase 2 builds upon the verified Phase 1 Empty-Room foundation.*

### FR-2.1: `/party` Slash Command Grammar, Longest-Prefix `@Name` Parser & Autocomplete

1. **Supported Command Syntax (Parsed Deterministically Frontend + Validated Backend):**
   - `/party` — Invite **all** campaign characters currently present in `active_location` (excluding those already in the player's party) with no extra message.
   - `/party <message>` — Invite **all** present non-party characters while passing `<message>` as the player's spoken invitation pitch.
   - `/party @<char_name> [@<char_name_2> ...] [message]` — Invite one or more specific present characters separated cleanly by `@<char_name>` prefix matching, followed by an optional invitation `<message>`.
   - `/party invite [@<char_name> ...] [message]` — Full canonical invitation form (and default interpretation whenever the first token after `/party` is not `leave`, `kick`, or `disband`).
   - `/party leave [optional message]` — Player leaves their active party (submits a turn).
   - `/party kick @<char_name> [@<char_name_2> ...] [optional message]` — Player removes specific member(s) from the player's active party (submits a turn).
   - `/party disband [optional message]` — Player disbands their active party completely (submits a turn).

2. **Longest-Prefix `@Name` Resolution (No Space Splitting Bugs):**
   - Because character names can contain spaces (e.g., `@Kira Vance`), parsing after `@` MUST perform **longest-prefix case-insensitive matching** against eligible character names (exact full name first, optionally followed by `:`, whitespace, comma, or end-of-string; then unambiguous single-character first-name prefix).
   - Support chaining multiple `@Name` tokens (e.g., `/party @Kira Vance @Viktor Kovacs watch my back`) before extracting the trailing free-text `<message>`.
   - **Strict Failure Policy (No Silent Invite-All Fallback):**
     - If an `@name` does not match any campaign character, matches multiple ambiguously, or targets a character **not present in `active_location`** (for `invite`) or **not in the player's party** (for `kick`), surface an inline warning banner in [`ChatComposer.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/ChatComposer.tsx#L447-L463) (matching `choiceSlashWarning`) and **block submission** rather than falling back to inviting the whole room.
     - Block `/party` / `/party invite` with an inline warning when the room is empty or when all present characters are already in the player's party.
     - Block `/party leave`, `/party kick`, and `/party disband` when the player is not currently in a party.

3. **Scoped `@Name` Autocomplete in [`ChatStage.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ChatStage.tsx#L241-L290) & [`CharacterMentionPicker.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/CharacterMentionPicker.tsx):**
   - Extend `checkAndTriggerMention` to detect `@<query>` inside `/party ...`, `/party invite ...`, and `/party kick ...` lines (not only at column 0).
   - Filter suggestions dynamically by context:
     - Inside `/party` or `/party invite`: show present characters not already in the player's party.
     - Inside `/party kick`: show current members of the player's party.
   - Extend `handleSelectMention` so selecting a character inside a `/party` command inserts `@${char.name} ` at the `@<query>` span instead of overwriting the line with `@Name: `.

### FR-2.2: Invitation Cognition, Loyalty Context, Persuasion Rolls & Breakup Turns

All `/party` chat commands and **player-party** modal actions (`Invite`, `Leave`, `Kick`, `Disband`) submit a real turn via `TurnSubmitRequest.party_action` so narrative prose and Zone 3 working memory stay consistent with party state.

1. **`invite` Turns (`party_action.kind == "invite"`):**
   - **Message & Speaker Selection:**
     - Phase 1 sets `spatial_intent = "stay"` (inviting characters does not itself move rooms) and selects the primary speaker from `target_character_ids` (using `speaker_order` / CARE relevance).
     - Display a readable synthetic/clean user turn message when submitted from the modal or bare `/party` (e.g., `"/party"` or the player's invitation text) while preserving `party_action` on `PreTurnAnalysis` for swipe/edit fidelity.
   - **Persuasion Rolls (Decision 4):**
     - Rolls are **allowed** on `invite` turns in `auto` and `forced` modes (disabled only when `dice_mode == "disabled"`).
     - Phase 1 may assign persuasion/social checks targeting `target_character_ids` based on the invitation pitch, character skepticism, or forced mode; resolved roll tiers are passed into Phase 3 cognition.
   - **Phase 3 Cognition for Invited Characters (`target_character_ids`):**
     - Prompt explicitly informs each invited character:
       - That the player (`persona_snapshot.name` or `"the user"`) is inviting them to join a traveling party (including `party_action.message` if provided).
       - **Anti-Sycophancy CARE Grounding:** Instructs the character to evaluate the invitation honestly against their CARE stance (`Trust`, `Warmth`, `Grievance`, `Respect` toward `"user"`), `Core Drive`, `Core Fear`, and current `active_want`—explicitly authorizing refusal when trust is low, grievances are high, goals conflict, or they are anchored to their post.
       - **NPC-Party Loyalty Context (Decision 3):** If the invited character currently belongs to an NPC-only party (`existing_npc_party`), inject explicit context naming their current companions (and leader) and stating that **accepting this invitation means leaving that party**.
       - Any persuasion roll outcome tier resolved for this character.
     - Structured schema requires `party_invite_decision: "accept" | "refuse"`.
     - **Non-Invited Co-Present Characters** (including existing members of the player's party) run normal Phase 3 cognition (without `party_invite_decision`) so they can react, welcome, or warn in-character.
     - In `sequential` dispatch mode, subsequent invited/present characters observe earlier characters' `prior_cues` (whether peers leaned toward accepting or refusing).
   - **Phase 4 Prose Directive:**
     - Inject `<party_invite_outcomes>` into Zone 4 listing each invited character's authoritative `accept` or `refuse` decision so prose accurately depicts their spoken acceptance or refusal.
   - **Phase 5 Commit:**
     - Accepted invitees join `"user"`'s party (creating a new `PartyRecord` with `leader_id="user"` if `"user"` wasn't in one, or appending to `"user"`'s existing party).
     - Any accepted invitee previously in an NPC-only party is removed from that old party; if `>= 2` members remain in the old party, it persists (randomly electing a new `leader_id` if the departed member was its leader); otherwise the old party dissolves.

2. **`leave` / `kick` / `disband` Turns (Decision 1 — Unilateral In-Character Turns):**
   - Executed as full in-character turns (no NPC veto on membership change; dice disabled unless user explicitly uses `forced` mode).
   - Phase 3 cognition and Phase 4 Zone 4 receive a dedicated `<party_event>` block stating the exact unilateral change (e.g., player left the party, player dismissed/kicked `[names]`, or player disbanded the party) plus any trailing `party_action.message`, so co-present characters process the relational impact (CARE appraisal) and respond in prose—solidifying the breakup inside Zone 3 working memory.
   - **Phase 5 Deterministic Mutation:**
     - `leave`: Removes `"user"` from the player's party. Per Decision 2, if **2 or more** co-located NPCs remain in that party, they **remain together as an NPC-only party** with a randomly elected `leader_id`; if fewer than 2 remain, the party dissolves.
     - `kick`: Removes `target_character_ids` from the player's party. If `>= 2` members (including `"user"`) remain, the party continues; otherwise it dissolves.
     - `disband`: Removes the player's party entirely from `parties`.

### FR-2.3: Deterministic Movement Enforcement, Zone 4 Directives & Narrator Alignment

Whenever `pre_turn.spatial_intent != "stay"` on a turn with co-present characters:

1. **Phase 3 Structured `travel_intent`:**
   - Require `travel_intent` (`"default" | "stay_behind" | "follow_player"`) in `CognitionBlock`'s JSON schema (`required` list):
     - **Co-located Player Party Members:** Prompted that as a party member they will travel together with the player unless they explicitly choose `"stay_behind"` (which leaves the party).
     - **Non-Party Co-Present Characters (including NPC-only party members):** Prompted that they are NOT in the player's party and will remain in `{active_location.name}` unless they explicitly choose `"follow_player"`.
     - *(Offline heuristic fallback in [`char_agent/agent.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/char_agent/agent.py#L480-L528) mirrors the exact same party-aware default: party members default to moving unless explicit stay cues exist; non-party NPCs default to `stay_here` unless explicit follow cues exist.)*

2. **Pre-Phase-4 Deterministic Cohort Computation & Conditional Zone 4 Directive:**
   - Between Phase 3 and Phase 4, compute:
     - `moving_with_player_ids`: co-located player-party members with `travel_intent != "stay_behind"` **+** non-party co-present characters with `travel_intent == "follow_player"` (plus NPC-party members following a co-located NPC leader who chose `follow_player`, unless those members chose `stay_behind`).
     - `staying_behind_ids`: all other co-present characters.
   - Inject `<movement_resolution>` into [`zone4_ephemeral.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/zone4_ephemeral.py) using **conditional** phrasing (since Phase 5 World Clerk has not yet committed whether travel succeeded vs. was blocked by a locked door or failed roll):
     - *If movement to `{target_location_hint or 'the destination'}` succeeds:* list characters in `moving_with_player_ids` as traveling alongside the player, and explicitly instruct the prose model that every character in `staying_behind_ids` **remained behind in `{active_location.name}`** and MUST NOT appear in the destination room.

3. **Phase 5 Deterministic 4-Step Spatial & Party Reconciliation ([`pipeline.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/clerk/pipeline.py)):**
   - Replace free-form `char_delta.location_transition` guessing for player-accompanied movement with a strict deterministic sequence:
     - **Step 1 (World Destination):** Resolve `new_location_id` and `location_changed = (new_location_id != active_location.id)` from World Clerk.
     - **Step 2 (Player & Player's Party):**
       - If `location_changed`: co-located player-party members with `travel_intent != "stay_behind"` move to `new_location_id`; any player-party member with `travel_intent == "stay_behind"` stays at `active_location.id` and exits the player's party.
       - If **2 or more** former player-party members stayed behind together at `active_location.id`, keep them together as an NPC-only party at `active_location.id` with a randomly elected `leader_id` (Decision 2).
     - **Step 3 (Co-Located NPC-Only Parties):**
       - Resolve each co-located NPC-only party's `leader_id`:
         - If `location_changed` and leader chose `travel_intent == "follow_player"`, leader moves to `new_location_id`.
         - Else if `!location_changed` (player stayed) and leader's `CharacterAgentDelta` has valid `move_to_neighbor` (`target_location_id in valid_neighbor_ids`), leader moves to `target_location_id`.
       - If the NPC party leader moved to `dest_id`, co-located members of that NPC party follow to `dest_id` unless they chose `stay_behind` (or moved to a different neighbor).
     - **Step 4 (Independent Non-Party / Non-Leader Moves & Strict Co-Location Enforcement):**
       - Non-party characters with `travel_intent == "follow_player"` (when `location_changed`) move to `new_location_id`.
       - Characters staying while the player stayed may independently execute `move_to_neighbor` from `CharacterAgentDelta` if validated.
       - Run final `reconcile_parties_co_location(parties, end_locations_by_member)`: for every party, group members by end `location_id` — only the leader's cohort (or any remaining co-located NPC cluster of size `>= 2` if separated from a player leader) stays grouped; dissolve any group with `< 2` members, ensure `location_id` matches its members' `current_location_id`, and ensure `leader_id` is `"user"` (if `"user"` is present) or randomly re-elected from remaining NPCs if the prior leader left.
   - **Passive Bystander Fast-Path:** Continue allowing `should_fast_path_passive_bystander` for unmentioned non-party bystanders whose cognition stayed default (`stay_here` at `active_location.id`), saving LLM Clerk calls during multi-NPC room exits.

4. **Narrator Turns Alignment (Req 4.e):**
   - In [`pipeline.py#L637-L670`](file:///home/diegolima/Git/cybercantina/backend/app/engine/clerk/pipeline.py#L637-L670), when `is_narrator_turn` results in `location_changed`:
     - Only co-located members of `"user"`'s party move to `new_location_id`.
     - Non-party characters in `active_location.id` remain at `active_location.id` (preserving their existing `current_location_id`), and `parties_json` is preserved consistently.

### FR-2.4: Left-Pane `Party` Menu, Party Management Modal & Live Indicators

1. **Sidebar Placement & Availability ([`AppSidebar.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/AppSidebar.tsx#L273-L290)):**
   - Add **`Party`** button directly below **`Codex`** inside `<nav className="sidebar-campaign-nav" aria-label="Campaign tools">` (with `Users` icon and a compact member/party count badge) and add a corresponding `Users` icon button inside `mode === "rail"` (`rail-categories`).
   - **Always Clickable During Campaign:** Unlike the early draft, `Party` is NEVER greyed out when zero parties exist, so players can open it at any time to learn `/party` syntax, invite present characters, or create/disband NPC-only parties.
   - **Lifted Modal State ([`App.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/App.tsx)):** Lift `isPartyModalOpen` state to `App.tsx` (matching `0.20.1`'s `campaignWorldSheetTab` pattern) so clicking `Party` opens the modal even when `LiveInspector` is collapsed/hidden and closes overlays on mobile/tablet.

2. **Party Management Modal Features:**
   - **Default Focus:** Focuses the player's party tab/section by default when `"user"` is in a party; otherwise defaults to the active NPC party list or an actionable empty state explaining `/party` commands with quick-invite controls for present characters.
   - **Player Party Section (In-Character Turn Actions — disabled when `isMutatingLocked`):**
     - Member cards showing character portrait/avatar, name, mood badge, current location, **"You (Leader)"** badge on the player persona row, **"Override Location"** button per NPC member, and **"Kick"** button (confirm/trigger or 1-click disabled while streaming; submits `party_action.kind="kick"` turn).
     - **"Invite Characters"** subsection listing co-present non-party characters (with an optional short pitch input), submitting an in-character `party_action.kind="invite"` turn so the invited NPC runs their cognitive accept/refuse check.
     - **"Leave Party"** and **"Disband Party"** buttons (each submitting an in-character turn per Decision 1 and closing the modal cleanly to show live turn streaming).
   - **NPC-Only Parties Section (Instant OOC GM Mutations — disabled when `isMutatingLocked`):**
     - Lists every active NPC-only party with its `location_id` name, **Leader** badge (`leader_id`), member list, per-member **"Override Location"** button, and **"Disband Party"** button (`DELETE /api/campaigns/{id}/parties/{party_id}`).
     - **"Create NPC Party" Builder:** Groups eligible campaign NPCs **by `current_location_id`** (disabled/badged for characters already belonging to a party so strict co-location and single-party invariants cannot be violated by the form), allows selecting `>= 2` co-located NPCs + optional party name, and submits `POST /api/campaigns/{id}/parties` (randomly electing `leader_id`).

3. **Live Inspector & Map Visibility:**
   - **Inspector ([`CharacterRow.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/inspector/CharacterRow.tsx#L126-L156)):** Render a compact **`Party`** pill (`Users` icon) on characters in `"user"`'s party (and a subtle NPC party/leader pill for NPC-only party members) so players can immediately tell who will move with them without opening the Party modal.
   - **Map (`SpatialTopologyView`):** Reflect party membership visually in location character markers/popovers alongside existing `presentCharacterLocations`.

### FR-2.5: Location Override UX (Player Split Button & Generalized Character Override)

1. **Player Scene Location Override Split Button ([`InspectorLocationCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/inspector/InspectorLocationCard.tsx#L684-L697) & [`MapDetailsDrawer.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDetailsDrawer.tsx#L1689-L1700)):**
   - **When player is NOT in a party:** Keep a single 1-click button (`"Override Location"` / `"Move Scene Here (Override)"`) calling `move_mode: "party"` (moves only the player; non-party NPCs at the origin room remain behind).
   - **When player IS in a party:** Render a **split button**:
     - **Primary Button (1-click, default):** `"Move Party Here"` — moves player + all co-located party members (`move_mode: "party"`).
     - **Dropdown Toggle (`▾`):** Opens an inline popover with:
       - 1-click `"Move Alone"` (`move_mode: "alone"`).
       - Pre-checked checklist of co-located party members + `"Move Selected"` (`move_mode: "subset"`, `accompanying_character_ids`).
   - **Backend Semantics ([`campaign_spatial.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/campaign_spatial.py#L33-L162) & [`turn_streaming.py`](file:///home/diegolima/Git/cybercantina/backend/app/routers/campaign_routes/turn_streaming.py#L170-L183)):**
     - Both the `__arrival__` turn creation path and the in-place `leaf_turn` update path MUST respect `move_mode` and leave non-party NPCs untouched at `old_loc_id`.
     - Any party members left behind at `old_loc_id` exit `"user"`'s party; if `>= 2` former party members stay together at `old_loc_id`, they remain together as an NPC-only party with a randomly elected `leader_id` (Decision 2).
     - Keep `TurnSubmitRequest.override_location_id` ([`turn_streaming.py#L170-L183`](file:///home/diegolima/Git/cybercantina/backend/app/routers/campaign_routes/turn_streaming.py#L170-L183)) synchronized using the same party-aware movement logic rather than moving every co-located NPC blindly.

2. **Generalized Character Location Override:**
   - Endpoint `POST /api/campaigns/{campaign_id}/characters/{character_id}/location-override` works for **any** campaign character (party member or solo/elsewhere NPC), exposed in:
     - The Party Management Modal (each member row), and
     - [`CharacterRow.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/inspector/CharacterRow.tsx) / [`CampaignCharacterModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/inspector/CampaignCharacterModal.tsx) (location selector / move control).
   - Updates `character_states.current_location_id` for `character_id` in-place on `leaf_turn`, removes `character_id` from any prior party (keeping `>= 2` remaining co-located members together and re-electing leader if needed; dissolving `< 2`), and **never** alters `active_location_id`, `visited_location_ids`, `visited_container_ids`, or arrival cards.

### FR-2.6: Campaign Creation (`NewCampaignModal`) & Quick Exits Consistency

1. **`NewCampaignModal.tsx` Step 2 ([`NewCampaignModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/NewCampaignModal.tsx#L524-L580)):**
   - Inside each selected character card, display an **unticked-by-default** `"Start in Party"` checkbox (`e.stopPropagation()` on click/change so toggling it does not deselect the character card).
   - Clear a character's `"Start in Party"` flag automatically if the character itself is unchecked in Step 2.
   - Pass `start_in_party_character_ids` in `CreateCampaignPayload` to `POST /api/campaigns`.
   - On world-focused starts ([`clerk_placement.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/clerk_placement.py)), pass party companion context so opening staging prose reflects that `"Start in Party"` characters arrived alongside the protagonist rather than as unacquainted strangers.

2. **Quick Exits Phrasing ([`ChatStage.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ChatStage.tsx#L580-L598)):**
   - In `handleQuickExit`:
     - When the player has co-located party members in `active_location`: send `"Let's head through the ${nb.direction_label.toLowerCase()} into ${nb.destination.name}."`
     - When the player is not in a party (or solo): send `"I head through the ${nb.direction_label.toLowerCase()} into ${nb.destination.name}."`

---

## 6. Phase 3 — Deferred Scope & Future Roadmap (Out of Scope for v0.21.0)

The following capabilities are **explicitly excluded from v0.21.0** implementation and recorded here to preserve architectural alignment:

1. **NPC-Initiated Party Splits (In-Room Walkouts):**
   - *Goal:* Allow an NPC in a party to voluntarily leave the party mid-scene without a spatial split or player command (e.g., after severe betrayal, collapsing Trust, or irreconcilable conflict).
   - *Why Deferred:* Requires dedicated design discussion before implementation—specifically tuning deterministic CARE guardrails (e.g., minimum Grievance / Trust thresholds) vs. LLM Phase 3 discretion so 12B models do not falsely disband parties during ordinary tense roleplay, plus defining how walkouts interact with NPC-party leaders.
2. **Off-Screen Character-Only Party Cognition:**
   - *Goal:* Allow NPC-only parties located away from the player to traverse connected map edges and take off-screen actions using a **single collective party cognition** rather than per-character LLM calls.
   - *How Phase 2 Enables It:* Phase 2's `PartyRecord` (`location_id`, `leader_id`, optional `shared_goal`) and strict co-location invariant ensure every NPC-only party already occupies a single valid room with an unambiguous leader, allowing Phase 3 to add a lightweight party-level cognition scheduler paired with deterministic `project_care_to_minute` decay for individual members.

---

## 7. Acceptance Criteria & Verification Matrix

### Phase 1 — Empty / Solo Rooms
1. Moving into an empty location (either via Quick Exit, narrative move, or Location Override) leaves `bundle.present_character_ids == []` without injecting `[primary_character]` or altering any absent NPC's `current_location_id`.
2. Submitting a standard turn in an empty room saves `actor_id = "__solo__"`, runs Phase 1 (spatial intent, lore/location RAG, solo `auto`/`forced` dice rolls), skips Phase 3 cleanly, streams solo Phase 4 prose, executes Phase 5 World Clerk + remote `@Character:` comms whispers, and keeps absent NPCs stationary.
3. Swiping or editing a `__solo__` turn preserves standard turn behavior (`isNarrator === false`) and dice settings.
4. `DirectorChoicesDrawer` is disabled/guarded when `presentCharacters.length === 0`.

### Phase 2 — Parties System
1. **Persistence & Branching:** `world_state_snapshots.parties_json` migrates idempotently on pre-existing SQLite databases, snapshots across `save_turn_node` and `update_turn_post_clerk`, and restores historical party state accurately on swipe, turn edit, `delete_last_turn`, and `checkout_turn_branch`.
2. **`/party` Parsing & Autocomplete:** `/party`, `/party <msg>`, `/party @<multi-word name> [msg]`, `/party invite ...`, `/party leave`, `/party kick @<name>`, and `/party disband` parse accurately without breaking multi-word names, block invalid/off-site targets with inline composer warnings (never falling back to invite-all), and provide scoped `@` autocomplete in `ChatStage`.
3. **In-Character Party Turns:** `/party` invite turns evaluate cognitive `party_invite_decision` (`"accept" | "refuse"`) using CARE stance, persuasion rolls (`auto`/`forced`), and existing NPC-party loyalty context; `/party leave|kick|disband` (and modal equivalents) run in-character turns so prose and Zone 3 memory reflect the change while Phase 5 enforces strict co-location and `>= 2` NPC party retention with random leader election.
4. **Movement & Narrator Enforcement:** On player movement (standard turn or Narrator turn), co-located party members move with `"user"` unless `travel_intent == "stay_behind"`, non-party bystanders remain behind unless `travel_intent == "follow_player"`, Zone 4 instructs Phase 4 conditionally who stayed behind, NPC party leaders anchor NPC-only party movement without dragging the player, and divergent members leave/split cleanly.
5. **UI, Overrides & Campaign Launch:** Left-pane `Party` button sits below `Codex`, stays clickable when empty, and opens the lifted Party Management Modal (supporting player-party turns + instant OOC NPC-only party creation/disbanding); `InspectorLocationCard` and `MapDetailsDrawer` offer the `"Move Party Here"` / `"Move Alone"` / `"Move Selected"` split button; any character's location can be overridden without triggering arrival cards/visited updates; `NewCampaignModal` provides unticked-by-default `"Start in Party"` checkboxes; Quick Exits phrasing adapts to party presence.
6. **Repository Verification Suite:**
   - Backend: `cd backend && .venv/bin/ruff check app tests && .venv/bin/tach check && .venv/bin/pytest tests`
   - Frontend: `npm --prefix frontend run arch:check && npm --prefix frontend run build && npm --prefix frontend test`
   - Architecture docs (when implementation changes modules/routes/schema): `backend/.venv/bin/python scripts/generate_arch_docs.py && backend/.venv/bin/python scripts/generate_arch_docs.py --check`
