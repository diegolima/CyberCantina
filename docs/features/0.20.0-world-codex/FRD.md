---
feature: world-codex
target_version: 0.20.0
document_type: frd
status: completed
last_updated: 2026-11-18
---

# Feature Requirements Document (FRD)
## World Codex Tab: Categorized Lore Hub, Prioritized Search & Master–Detail Browser

**Status:** Completed  
**Target Version:** CyberCantina v0.20.0  
**Depends On:** `0.15.0-world-media-files`, `0.19.2-minimap-container-envelope`  
**Scope:**
- Backend Schemas, DDL, Migrations, `.zcc` Import & Wizard Prompts ([`world.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/world.py), [`schema.sql`](file:///home/diegolima/Git/cybercantina/backend/app/db/schema.sql), [`schema_init.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/schema_init.py), [`import_export_service.py`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py), [`defaults.py`](file:///home/diegolima/Git/cybercantina/backend/app/prompts/defaults.py))
- Frontend Types, World Sheet, Map Focus, Campaign Inspector, Styles & Codex Components ([`world.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/world.ts), [`WorldInspectorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldInspectorModal.tsx), [`worldDraftMappers.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/worldDraftMappers.ts), [`SpatialTopologyView.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/SpatialTopologyView.tsx), [`LiveInspector.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/LiveInspector.tsx), [`styles.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css), and extracted pure helpers + Codex UI components under `frontend/src/components/world/`)
- Automated Tests (`backend/tests/`, `frontend/src/`)

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
In [`WorldInspectorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldInspectorModal.tsx#L880-L1085), world-level lore is managed inside a single flat **`Lore`** tab that renders every `LoreNode` simultaneously as a full inline editing form:
1. **Poor Scalability as Worlds Grow:** Once a world accumulates 10–30+ lore nodes, scrolling through stacked title inputs, category dropdowns, `TagChipsInput` controls, and multi-line textareas creates high visual noise and makes locating or editing a specific entry slow.
2. **No Search, Prioritization, or Alphabetical Structure:** Entries appear in insertion order with no search input, filtering, or alphabetical index—even though `entity_tags` (trigger keywords) are critical to GraphRAG recall.
3. **Fragmented World Reference During Play:** When players open the World Sheet during a campaign (`mode === "campaign"`), world lore, branch-visible locations/containers, and the active campaign cast + player persona live across separate tabs or modals rather than a cohesive, encyclopedia-style Codex.
4. **Missing Semantic Buckets for Figures & Threats:** World-level `LoreNode.category` currently supports `'history' | 'culture' | 'faction' | 'rumor' | 'artifact'`, forcing creators to overload `'faction'`, `'history'`, or `'rumor'` for notable background figures (non-actor NPCs/legends) and world threats (monsters, plagues, anomalies, hostile forces).

### 1.2 Proposed Solution
Replace the flat `Lore` tab in [`WorldInspectorModal`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldInspectorModal.tsx) with a structured **`Codex`** tab featuring:
1. **Six Distinct Codex Categories (Derived Directly from `LoreNode.category` + Live World/Campaign Views):**
   - **History & Culture** (`history`, `culture`) — editable world lore.
   - **Factions & Figures** (`faction`, `figure`) — editable world lore.
   - **Locations** *(Special Read-Only)* — hierarchical tree of Map `LocationContainer`s (`L4`→`L1`) and `LocationNode`s with summaries/descriptions, visited-gated images, tags, and local lore.
   - **Items & Artifacts** (`artifact`) — editable world lore preserving `ItemInstance.lore_id` artifact linking.
   - **Major Characters** *(Special Read-Only, Campaign-Only)* — active player `PersonaRecord` and current campaign participant `CharacterRecord`s (greyed out outside campaigns; wired reactively to support future mid-campaign character additions/removals).
   - **Rumors & Threats** (`rumor`, `threat`) — editable world lore.
2. **In-Place View Switching (No Nested Modals):**
   - **Persistent Top Bar:** Breadcrumb/back navigation, live Quick Search input (`Title > Keywords > Content`) in Hub/Global Search states, and context-aware `+ Add Entry` action.
   - **Hub View:** Clean 6-card category grid summarizing entry counts, validation warnings, and preview titles.
   - **2-Pane Master–Detail View:** Entered directly by clicking any enabled category card **or** typing into Quick Search. Left pane lists alphabetically sorted (or search-ranked) titles with category-switcher pills; right pane renders the focused editor or read-only sheet.
3. **Zero Breaking Changes to Lore Mechanics:**
   - World lore entries retain the exact `(id, world_id, title, category, content, entity_tags)` structure, GraphRAG vector indexing, `artifact` item-linking invariants, and `.zcc` import/export compatibility.

---

## 2. Scope, Boundaries & Core Invariants

1. **Single-Field Category Mapping (Option A — No Parallel Taxonomy):**
   - Codex sections for the 4 editable lore categories **must** be derived deterministically from `LoreNode.category` via a pure mapping table—never via a second independent `codex_category` field.
   - Extend `WorldLoreCategory` (and `AnyLoreCategory`) with `'figure'` and `'threat'`:
     - `'history' | 'culture'` → **History & Culture**
     - `'faction' | 'figure'` → **Factions & Figures**
     - `'artifact'` → **Items & Artifacts**
     - `'rumor' | 'threat'` → **Rumors & Threats**
   - `'artifact'`, `'figure'`, and `'threat'` are strictly **world-scoped** (`location_id IS NULL AND container_id IS NULL`) and rejected on location/container scopes in both Pydantic (`LoreNode._enforce_scope_invariants`) and SQLite `CHECK`.
   - `LocationLoreCategory` remains strictly `'history' | 'culture' | 'faction' | 'rumor' | 'secret'` (location/container lore continues to be authored on the `Map` tab).
2. **Artifact, Secret & Campaign Visibility Invariants Preserved:**
   - `_validate_world_artifact_lore_id` ([`base.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/base.py#L81-L106)) continues to require `category == 'artifact'` and `location_id IS NULL AND container_id IS NULL`. Because **Items & Artifacts** maps 1:1 to `'artifact'`, every entry created inside it is automatically eligible for character item `lore_id` linking.
   - `'secret'` remains forbidden on world-level `lore_nodes` and allowed only on `LocationNode` / `depth === 1` `LocationContainer` lore.
   - **Branch-Visible Locations (Including Mid-Campaign Locations):** In [`LiveInspector.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/LiveInspector.tsx#L424-L438), `bundle.visible_locations` contains all **branch-visible** locations (including unvisited locations with `is_visited: false` and mid-campaign branch-created locations with `created_at_turn_id != null`). In `mode === "campaign"`, Codex `Locations` **must** read reactively from `world.locations` and `world.containers` (bypassing `WorldInspectorModal`'s editor-only `!loc.created_at_turn_id` filter at [lines 110–121](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldInspectorModal.tsx#L110-L121)) so branch-created locations are never hidden.
   - **Visited-Only Media Gating (`0.15.0-world-media-files` Parity):** In `mode === "campaign"`, Codex `Locations` **must** show linked location images **only** when `Boolean(loc.is_visited)` and linked container images **only** when `visitedContainerIds.includes(cont.id) || containerHasVisitedDescendants(cont.id, containers, locations)` (matching [`MapDetailsDrawer.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDetailsDrawer.tsx#L889-L901) and [`mapValidation.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/mapValidation.ts#L219-L230)).
   - **Campaign Secret Gating:** When `mode === "campaign"`, Codex `Locations` (and Global Quick Search) **must filter out** `lore.category === "secret"` on both locations and `depth === 1` containers (matching [`LoreIndexModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/inspector/LoreIndexModal.tsx#L137-L163)).
3. **Campaign Spoiler-Safe Search:**
   - In `mode === "campaign"`, neither Global Quick Search nor Category Search may index or match hidden/GM fields: `category === "secret"` local lore on locations/containers, or `CharacterRecord.baseline_psyche`, `memory_shards`, `creator_notes`, `core_persona`, `moral_code`, and `quirks_flaws`.
4. **Single Active Search Input (No Competing Search Boxes or Focus Loss):**
   - Never render two search inputs simultaneously.
   - **Hub View** and **Global Search 2-Pane View** share the **single mounted Top Bar search input** (preserving DOM identity and focus/IME composition when typing the first character from the Hub transitions into Global Search 2-Pane View).
   - **Category 2-Pane View** replaces the Top Bar search input with a `← All Categories · {Section}` breadcrumb (plus `+ Add Entry` when editable) and mounts the **single category-scoped filter input** inside the Left Pane alongside a 1-click `"Search all Codex"` jump button.
5. **In-Place Modal Navigation (No Modal Stacking):**
   - All Codex states (Hub View, Category 2-Pane View, Global Search 2-Pane View) render **inside** `WorldInspectorModal`'s Codex tab body. Never open a second modal on top of `WorldInspectorModal` to browse a category.
6. **Read-Only Special Categories:**
   - Users **cannot** manually create, edit, or delete entries inside `Locations` or `Major Characters` from the Codex. `Locations` links to the `Map` tab; `Major Characters` derives strictly from campaign state.
7. **Dynamic Campaign Roster Readiness:**
   - `Major Characters` must derive its character list reactively from live campaign props (`campaignCharacters` / `activePersona` / `activePersonaTurnState`) rather than freezing initial modal mount state, ensuring future mid-campaign character join/leave mutations reflect immediately without Codex changes.
8. **Backward Compatibility & Cross-Layer Sync:**
   - Existing SQLite databases, `.zcc` archives, and `showcase_data` JSON bundles containing `'history' | 'culture' | 'faction' | 'rumor' | 'artifact'` load without manual migration; `SchemaInitMixin._migrate_lore_schema_and_legacy_rows` upgrades the `lore_nodes` `CHECK` constraint idempotently on startup.
   - [`LoreIndexModal`](file:///home/diegolima/Git/cybercantina/frontend/src/components/inspector/LoreIndexModal.tsx) in `LiveInspector`'s Internals section remains intact as the turn-level RAG/memory-shard diagnostic index.
   - Backend must pass `ruff check`, `tach check`, and `pytest`; frontend must pass `arch:check`, `build`, and `test` (Node-only SSR/Vitest).

---

## 3. Functional Requirements

### FR-1: Backend, Schema, `.zcc` Import & Badge Styling (`'figure'` and `'threat'` Categories)

1. **Pydantic & TypeScript Category Enums:**
   - **Backend ([`backend/app/schemas/world.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/world.py)):**
     - Update `WorldLoreCategory` to `Literal["history", "culture", "faction", "figure", "rumor", "threat", "artifact"]` and `AnyLoreCategory` to include `"figure"` and `"threat"`.
     - Update `WORLD_LORE_CATEGORIES` tuple to `("history", "culture", "faction", "figure", "rumor", "threat", "artifact")`.
     - Update `normalize_lore_category` when `allow_artifact=True` (world scope) to accept `"figure"` and `"threat"` as strict valid categories; when `allow_artifact=False` (location/container scope), reject `"figure"` and `"threat"` if `strict=True`. Add lenient (`strict=False`) alias normalization:
       - `"figure"`, `"figures"`, `"person"`, `"people"`, `"npc"`, `"npcs"`, `"notable"` → `"figure"` when `allow_artifact=True`, or `"culture"` when `allow_artifact=False`.
       - `"threat"`, `"threats"`, `"enemy"`, `"enemies"`, `"monster"`, `"monsters"`, `"hazard"`, `"hazards"`, `"danger"` → `"threat"` when `allow_artifact=True`, or `"rumor"` when `allow_artifact=False`.
     - Update `LoreNode._enforce_scope_invariants` ([lines 632–648](file:///home/diegolima/Git/cybercantina/backend/app/schemas/world.py#L632-L648)) so `category in ("artifact", "figure", "threat")` raises `ValueError` whenever `self.location_id is not None or self.container_id is not None`.
     - Update `WizardLoreNodeLLMOutput.category` field description and [`DEFAULT_WIZARD_WORLD_SYSTEM`](file:///home/diegolima/Git/cybercantina/backend/app/prompts/defaults.py#L310-L316) to list `'faction'`, `'figure'`, `'history'`, `'culture'`, `'rumor'`, `'threat'`, `'artifact'`.
   - **Frontend ([`frontend/src/types/world.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/world.ts)):**
     - Mirror `WorldLoreCategory`, `AnyLoreCategory`, and `WORLD_LORE_CATEGORIES` (`worldDraftMappers.ts` consumes `WORLD_LORE_CATEGORIES` directly and propagates `'figure'` and `'threat'` automatically).
2. **SQLite Schema & Idempotent Migration:**
   - **DDL ([`backend/app/db/schema.sql`](file:///home/diegolima/Git/cybercantina/backend/app/db/schema.sql#L289-L311)):** Update `lore_nodes.category` `CHECK` constraint strictly as:
     ```sql
     category IN ('history', 'culture', 'faction', 'figure', 'rumor', 'threat', 'artifact', 'secret')
     AND ((location_id IS NOT NULL OR container_id IS NOT NULL) OR category != 'secret')
     AND (location_id IS NULL OR category NOT IN ('artifact', 'figure', 'threat'))
     AND (container_id IS NULL OR category NOT IN ('artifact', 'figure', 'threat'))
     AND (campaign_id IS NULL OR location_id IS NOT NULL OR container_id IS NOT NULL)
     AND (location_id IS NULL OR container_id IS NULL)
     ```
   - **Migration ([`backend/app/db/repos/schema_init.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/schema_init.py#L23-L183)):** Extend `_migrate_lore_schema_and_legacy_rows` early-return guard to also verify `"'figure'" in ddl_sql and "'threat'" in ddl_sql`, and update `lore_nodes_migrated` DDL to match `schema.sql` identically. Preserve the existing `init_db` execution order where `_migrate_lore_schema_and_legacy_rows(conn)` runs *before* `conn.executescript(sql)` (so `idx_lore_nodes_*` indexes recreate cleanly on the migrated table).
3. **`.zcc` Import Normalization ([`import_export_service.py`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py#L1047-L1200)):**
   - Normalize imported `category` values via `normalize_lore_category(..., allow_secret=..., allow_artifact=..., strict=False)` prior to SQLite `INSERT` for container, location, and world `lore_nodes` so legacy or malformed `.zcc` archives degrade safely instead of failing the `CHECK` constraint.
4. **GraphRAG & CSS Badge Styles:**
   - Existing `lore_nodes` storage, `vector_store.py` indexing, and `zone4_ephemeral.py` / `cognition/runner.py` category header formatting (`ln.category.upper()`) work automatically with `'figure'` and `'threat'`.
   - Add `.lore-cat-badge--artifact`, `.lore-cat-badge--figure`, and `.lore-cat-badge--threat` classes in [`frontend/src/styles.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L3629-L3672) alongside the existing category badge modifiers.

---

### FR-2: Codex Tab Shell, Responsive Width & Validation Redirect (`WorldInspectorModal`)

1. **Tab Rename, Alias Safety & Copy Sync:**
   - Replace the `"Lore"` tab button in [`WorldInspectorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldInspectorModal.tsx#L619-L642) with **`Codex`** (`BookOpen` icon).
   - Update `WorldTab` to `"base" | "media" | "map" | "codex" | "settings" | "unsupported"`, normalizing `initialTab === "lore"` to `"codex"` for backward caller compatibility.
   - Preserve the tab count badge (`loreNodes.length`) and error badge (`!{invalidWorldLoreCount}` when `!isCampaignMode`).
   - Update wizard helper copy in [`WorldInspectorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldInspectorModal.tsx#L690) (`"Map and Codex tabs"`).
   - Update `handleSave` world lore validation failure handling ([lines 407–418](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldInspectorModal.tsx#L407-L418)) so failing validation sets `activeTab` to `"codex"`, opens the failing entry's Codex section, clears any active filter blocking it, and sets `selectedEntryId` to that entry's `id`.
2. **Consistent Modal Sizing & Responsive Layout:**
   - Use `width: activeTab === "map" ? "min(1120px, 96vw)" : activeTab === "codex" ? "min(980px, 95vw)" : "min(860px, 95vw)"` so switching between Hub and 2-Pane inside Codex never jumps modal dimensions.
   - Stack the 2-pane layout vertically on narrow viewports (`< 720px`) via CSS media rules so left-pane lists and right-pane forms/dossiers remain usable on small screens.
3. **Persistent Codex Top Bar (Single Search Input Contract):**
   - **On Hub View & Global Search 2-Pane View:**
     - Left breadcrumb shows `"Codex"` (Hub) or `← All Categories · Search Results` (Global Search).
     - Center/right holds the **single mounted Global Quick Search input** (`placeholder="Search Codex titles, keywords, or content..."`) with clear (`X`) button. Typing into it from Hub View transitions smoothly into Global Search 2-Pane View while keeping the input mounted and focused. Clearing it returns to Hub View.
     - Right holds `+ Add Entry` (when `!isCampaignMode`), creating a new draft entry (`category: "history"`, `title: ""`), switching to `History & Culture` 2-pane view, selecting the new entry, and focusing its Title input.
   - **On Category 2-Pane View:**
     - Left breadcrumb shows `← All Categories` + active section name.
     - Top Bar search input is unmounted in favor of the **single Left-Pane category filter input** (`Filter {Section}...`), accompanied by a 1-click `"Search all"` pill/link that transfers the current filter query into Global Quick Search.
     - `+ Add Entry` (hidden in `isCampaignMode`, omitted in `Locations` and `Major Characters`) pre-selects that section's primary `WorldLoreCategory` (`history`, `faction`, `artifact`, or `rumor`).

---

### FR-3: Hub View (6 Category Cards)

When `activeSection === null` and `globalQuery.trim() === ""`:
1. Render a responsive 3×2 grid (2 columns on medium, 1 on narrow) of 6 category cards:
   - **History & Culture** (`history`, `culture`) — Timelines, eras, traditions, laws, and cultural norms. (`{N} entry/entries`)
   - **Factions & Figures** (`faction`, `figure`) — Guilds, syndicates, governments, and notable background figures. (`{N} entry/entries`)
   - **Locations** *(Special)* — Hierarchical atlas of mapped regions, buildings, and sites. (`{L} location(s)` or `{L} location(s) · {C} area(s)` when containers exist)
   - **Items & Artifacts** (`artifact`) — Plot-driving relics and legendary items linkable to character gear. (`{N} entry/entries`)
   - **Major Characters** *(Special)* — Player persona and campaign cast. In `mode === "campaign"`, displays `{P} persona · {N} character(s)` (or `{N} character(s)` if no persona); outside campaigns, **greyed out (`disabled`, `aria-disabled="true"`)** with badge `"Campaign only"` and subtitle `"Available during an active campaign"`.
   - **Rumors & Threats** (`rumor`, `threat`) — Whispers, unverified leads, hostile forces, monsters, plagues, and hazards. (`{N} entry/entries`)
2. Each card displays:
   - Distinct Lucide icon and subtle category accent border/tint.
   - Category title, count pill, and concise 1-line description.
   - Validation alert badge (`!N`) in rose accent if any entry in that editable category is invalid (`!isCampaignMode`).
   - Preview snippet of up to 3 alphabetically first entry titles (rendering empty titles as muted italic `Untitled Entry`, or a subtle `"No entries yet"` hint when count is 0).

---

### FR-4: Prioritized Search, Per-Entity Matching Matrix & Alphabetical Ordering

Implement pure, deterministic helper functions in `frontend/src/components/world/codexHelpers.ts` (Node-Vitest testable without DOM):

1. **3-Tier Search Priority Ranking (`title > keywords > content`):**
   - Given normalized query `q = query.trim().toLowerCase()`:
     - **Tier 1:** Primary Title / Name contains `q`.
     - **Tier 2:** Not Tier 1, and at least one Keyword / Tag contains `q`.
     - **Tier 3:** Not Tier 1 or 2, and Body / Lore / Bio text contains `q`.
   - Non-matching entries are excluded. Within each tier, results sort **alphabetically by primary title/name** using `localeCompare(b, undefined, { sensitivity: "base" })` (treating blank `""` titles as `"Untitled Entry"` for display while keeping deterministic tie-breaks by `id`).
   - When `query` is empty, all entries in scope sort alphabetically by primary title/name.

2. **Per-Entity 3-Tier Matching Matrix:**

   | Entity Type | Tier 1 (Title) | Tier 2 (Keywords) | Tier 3 (Content / Bio) | Campaign Spoiler Exclusions |
   | :--- | :--- | :--- | :--- | :--- |
   | **World `LoreNode`** | `lore.title` | `lore.entity_tags` | `lore.content` | *None* (always public) |
   | **`LocationNode`** | `loc.name` | `loc.environmental_tags` | `loc.summary`, `loc.description`, plus visible `loc.lore_nodes` (`title`, `entity_tags`, `content`) | Exclude `lore.category === "secret"` in `mode === "campaign"` |
   | **`LocationContainer`** | `cont.name` | `cont.environmental_tags` | `cont.description`, plus visible `depth === 1` `cont.lore_nodes` (`title`, `entity_tags`, `content`) | Exclude `lore.category === "secret"` in `mode === "campaign"` |
   | **`PersonaRecord`** *(campaign only)* | `persona.name` | `persona.tags` | `persona.persona_bio`, `persona.species` | *None* (owned by player) |
   | **`CharacterRecord`** *(campaign only)* | `char.name` | `char.tags`, `char.communication_style` | `char.tagline`, `char.character_bio`, `char.species` | **Never index** `baseline_psyche`, `memory_shards`, `creator_notes`, `core_persona`, `moral_code`, `quirks_flaws` |

3. **Global Quick Search Behavior & Right-Pane Dispatch:**
   - Searches across all 4 editable World Lore categories, `Locations` (`containers` + `locations`), and (when `mode === "campaign"`) `Major Characters` (`activePersona` + `campaignCharacters`).
   - Left-pane rows show title/name, category/type badge (e.g., `Faction`, `Threat`, `Location`, `Area L1`, `Character`, `Persona`), invalid `!` marker (if editable and incomplete), and subtle match-tier indicator (`Title`, `Keyword`, `Content`) when `q` is present.
   - Clicking any hit renders the corresponding Right-Pane component directly (`Lore` editor/reader for world lore, `Location/Container` sheet for `locations`/`containers` with `"Open on Map →"`, or `Persona/Character` dossier for cast hits).
4. **Mid-Edit Alphabetical Stability & Draft Defaults:**
   - Selection is always tracked by entity `id` (never array index).
   - Newly added entries initialize with `title: ""`, `content: ""`, `entity_tags: []` (rendered as muted italic `"Untitled Entry"` in the left pane, with `maxLength={120}` on the Title input matching backend `LoreNode.title`).
   - While the right-pane Title input is focused, freeze the left-pane sort order snapshot for the currently rendered list and re-sort alphabetically cleanly on Title blur, selection change, or save—preventing the active row from jumping mid-keystroke.

---

### FR-5: 2-Pane Interface — Editable Lore Categories

For **History & Culture**, **Factions & Figures**, **Items & Artifacts**, and **Rumors & Threats**:

1. **Left Pane:**
   - Compact **Category Switcher Pills** along the top (`History & Culture`, `Factions & Figures`, `Items & Artifacts`, `Rumors & Threats`, `Locations`, and `Major Characters` when `mode === "campaign"`) for 1-click section hopping.
   - Category-scoped filter search input (`Filter entries...`) + `"Search all"` trigger when non-empty.
   - Scrollable alphabetical title list with active highlight, sub-category pill (`history`, `culture`, `faction`, `figure`, `artifact`, `rumor`, `threat`), and inline red `!` indicator on invalid entries (`!isCampaignMode`).
2. **Right Pane (Detail View):**
   - **When `!isCampaignMode` (Editor / Wizard):**
     - **Title** input (`maxLength={120}`, placeholder `"Entry title..."`, auto-focused on `+ Add Entry`).
     - **Category `<select>`:** Lists all `WORLD_LORE_CATEGORIES` grouped by Codex section (defaulting to the section's primary category on creation).
     - **Cross-Section Reclassification Handling:** If the author changes `category` to one belonging to a *different* Codex section (e.g., changing `rumor` → `faction`), keep `selectedEntryId` active and **automatically switch `activeSection`** to the entry's new Codex section with a concise non-blocking banner (`"Moved to Factions & Figures"` + 1-click `"Undo"` button) so the entry never vanishes mid-edit. (In Global Search 2-pane view, keep the entry selected in-place with its updated category badge.)
     - **Artifact Unlink Notice:** When reclassifying an existing entry *away from* `'artifact'` or deleting an `'artifact'` entry, show a concise non-blocking informational notice explaining that any character items referencing this artifact will be unlinked upon saving (handled server-side by `_remap_character_items_for_world_update` in [`worlds.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/worlds.py#L1054-L1065)).
     - **Trigger Keywords (min 1):** [`TagChipsInput`](file:///home/diegolima/Git/cybercantina/frontend/src/components/TagChipsInput.tsx) wired with `pendingWorldLoreTagDrafts` (preserving the controlled-delimiter contract and flush-on-save behavior in `handleSave`) plus helper caption: *"Keywords trigger GraphRAG recall when mentioned in play."*
     - **Content:** Multiline textarea (`maxLength={2000}`, placeholder `"Describe origins, significance, and impact on the world..."`) with live character counter (`{content.length} / 2000`) and inline validation hints.
     - **Footer Actions:**
       - **Duplicate:** Flushes any pending `pendingWorldLoreTagDrafts[source.id]` into `entity_tags`, builds a copy with collision-safe `id` (`new_lore_${Date.now()}_${counter}`), appends `" (Copy)"` to `title` (capped at 120 chars), calls `markDirty()`, and selects the duplicate.
       - **Delete:** Removes the entry, cleans `pendingWorldLoreTagDrafts[deleted.id]`, calls `markDirty()`, and selects the nearest remaining neighbor in the active sorted list (next item, or previous if last, or `null` if empty).
     - **Artifact Guidance (inside `Items & Artifacts`):** Concise banner explaining that entries here can be linked to character inventory items as World Artifacts.
   - **When `isCampaignMode` (Read-Only):**
     - Displays title, category badge, formatted prose content, and read-only keyword chips with no mutation controls.

---

### FR-6: Special Category — `"Locations"` (Hierarchical Tree & Map Deep-Link)

1. **Data Source & Graph Integrity:**
   - In `mode === "campaign"`, read reactively from `world.locations` and `world.containers` props so branch-created locations (`created_at_turn_id != null`), live overrides, and `is_visited` flags are preserved accurately.
   - In `mode === "inspector" | "wizard"`, read from `WorldInspectorModal`'s live `locations` and `containers` draft state so unsaved Map tab edits appear immediately in the Codex.
   - **Orphan & Cycle Guard:** Tree construction must track visited `container_id`s to break any hypothetical parent cycle and safely promote containers with missing `parent_container_id` (or locations with missing `container_id`) to root level without throwing or dropping nodes.
2. **Left Pane (Hierarchical Tree):**
   - Renders nested `LocationContainer`s (`depth` 4 → 3 → 2 → 1) and nested/root `LocationNode`s, sorted **alphabetically by `name`** among siblings at every tree level.
   - Collapsible container branches (`ChevronRight` / `ChevronDown`) showing `L{depth}` pill; selectable locations showing `Start` / `Hub` badges, `Current` indicator (when `activeLocationId` matches), and subtle `Visited` / `Unvisited` status in `mode === "campaign"`.
   - **Tree QoL Controls:** `"Expand All"` / `"Collapse All"` toggle; typing in the left-pane filter automatically expands every ancestor container of any matching location or container.
   - `+ Add Entry` is omitted/disabled in `Locations`.
3. **Right Pane (Read-Only Location / Container Sheet):**
   - **Visited-Only Media Gating (`mode === "campaign"`):**
     - Add `visitedContainerIds?: string[]` to `WorldInspectorModalProps` (wired from `bundle.current_world_snapshot.visited_container_ids ?? []` in [`LiveInspector.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/LiveInspector.tsx#L484) and also forwarded to `SpatialTopologyView`).
     - Render linked image thumbnail (with silent `onError` hide fallback and click-to-enlarge lightbox) for a `LocationNode` in campaign mode **only** when `Boolean(loc.is_visited)`, and for a `LocationContainer` in campaign mode **only** when `visitedContainerIds.includes(cont.id) || containerHasVisitedDescendants(cont.id, containers, locations)`. (In `inspector`/`wizard` modes, show all linked images.)
   - **When a `LocationNode` is selected:** Header with name, `Start` / `Hub` / `Visited` badges, container breadcrumb path, gated image thumbnail, `Summary`, `Description`, `Environmental Tags`, and **Local Lore** (`location.lore_nodes`, filtering out `category === "secret"` whenever `mode === "campaign"`).
   - **When a `LocationContainer` is selected:** Header with name, `L{depth} · {CONTAINER_DEPTH_LABELS[depth]}` badge, parent breadcrumb path, gated image thumbnail, `Description`, `Environmental Tags`, child site count summary, and—for `depth === 1`—**Local Lore** (`container.lore_nodes`, filtering out `category === "secret"` whenever `mode === "campaign"`).
4. **Concrete `"Open on Map →"` Deep-Link Contract:**
   - Because [`SpatialTopologyView`](file:///home/diegolima/Git/cybercantina/frontend/src/components/SpatialTopologyView.tsx#L258) stays mounted across `WorldInspectorModal` tab switches and only evaluates `initialFocus` on mount, add an optional prop:
     ```ts
     externalFocusRequest?: { kind: "location" | "container"; id: string; nonce: number } | null;
     ```
     to `SpatialTopologyViewProps`, watched via `useEffect` (keyed by `nonce`) to drill into the target's container scope and select that location or container in `MapDetailsDrawer`.
   - Clicking `"Open on Map →"` in Codex `Locations` sets `externalFocusRequest` (incrementing `nonce`) and switches `activeTab` to `"map"`.

---

### FR-7: Special Category — `"Major Characters"` (Campaign Cast & Persona)

1. **Availability & Prop Wiring for Future Mid-Campaign Roster Edits:**
   - Extend `WorldInspectorModalProps` ([`WorldInspectorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldInspectorModal.tsx#L52-L72)) with optional reactive campaign props:
     - `activePersona?: PersonaRecord | null`
     - `activePersonaTurnState?: PersonaTurnStateSnapshot | null`
     - `campaignId?: string` (fallback for loading `api.getCampaignPersonaState(campaignId)` when inspecting Persona if `activePersonaTurnState` prop is omitted)
     - `campaignCharacters?: CodexCampaignCharacterEntry[]` (`{ record: CharacterRecord; state?: CharacterStateSnapshot; isPresent?: boolean; elsewhereLocationName?: string; isPrimary?: boolean }`)
     - `activeLocationId?: string`
     - `visitedContainerIds?: string[]`
   - In [`LiveInspector.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/LiveInspector.tsx#L424-L438), pass `activePersona={bundle.campaign.persona_snapshot ?? null}`, `campaignId={bundle.campaign.id}`, `activeLocationId={activeLoc.id}`, `visitedContainerIds={bundle.current_world_snapshot.visited_container_ids ?? []}`, and `campaignCharacters` derived reactively from `characterRows` (which derives from `bundle.campaign.participant_character_ids`, `bundle.character_records`, and `bundle.character_states`).
   - **Mid-Campaign Add/Remove Readiness:** `Major Characters` computes its list directly via `useMemo` from `campaignCharacters` and `activePersona`, and reconciles `selectedEntryId` via `useEffect` if the viewed character is removed mid-campaign (selecting the next available entry or showing the clean empty state), so future mid-campaign character additions/removals work automatically.
   - Outside campaigns (`mode !== "campaign"`), the `Major Characters` Hub card is greyed out and non-interactive (`disabled` / `aria-disabled="true"`), and omitted/disabled in the 2-pane category switcher.
2. **Left Pane (`Major Characters` List):**
   - When `activePersona` is present, pin the player's **Persona** first with a `Persona` badge, followed by all `campaignCharacters` sorted **alphabetically by `record.name`** (displaying avatar thumbnail/initials and `Present` vs. `Elsewhere` status badge).
   - If both `activePersona` is null and `campaignCharacters` is empty, render a clean empty-state message (`"No active persona or campaign characters in this session."`).
   - Supports the left-pane search filter (`Name > Tags > Bio`) and omits `+ Add Entry`.
3. **Right Pane (Read-Only Persona / Character Dossier):**
   - **When the Player Persona is selected:**
     - Displays read-only Persona dossier using canonical fields ([`persona.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/persona.py#L135-L205)): `name`, `species`, `sex`, `pronouns`, `age` (with subtle `Secret` lock badge if `age_is_secret`, readable by the owning player), `build_and_height`, `distinctive_features` chips (falling back to legacy `physical_appearance` only if both `build_and_height` and `distinctive_features` are empty), `persona_bio`, `tags`, live `equipped` & `inventory` (preferring `activePersonaTurnState?.equipped ?? activePersona.equipped` and `activePersonaTurnState?.inventory ?? activePersona.inventory`, with `is_secret` indicators), and `lore_entries`.
   - **When a Campaign Character is selected:**
     - Displays a clean, **spoiler-safe read-only Character Dossier** using canonical fields ([`character.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/character.ts#L189-L243)): live emotion portrait via [`getCharacterEmotionPortrait`](file:///home/diegolima/Git/cybercantina/frontend/src/utils/entityImages.ts#L9) (`record`, `state?.care_state?.active_emotion ?? "default"`), `name`, `tagline`, `species`, `age`, `sex`, `pronouns`, `build_and_height`, `posture`, current location badge (`Present` / `Elsewhere: ...`), `character_bio`, `distinctive_features`, `mannerisms`, `visual_aesthetic`, `communication_style`, `tags`, and current `equipped` gear (`state?.equipped ?? record.equipped`).
     - **Artifact Cross-Link QoL:** When an equipped item carries `flags.includes("artifact")` and `item.lore_id` matches an entry in `loreNodes`, render a clickable World Artifact badge that jumps directly to that entry in Codex `Items & Artifacts`.
     - **Explicitly Omits** internal/GM fields (`baseline_psyche`, `memory_shards`, `creator_notes`, `core_persona`, `moral_code`, `quirks_flaws`, and legacy `physical_appearance`) so the Codex remains spoiler-safe.

---

### FR-8: Quality-of-Life (QoL) Improvements

1. **Modal-Safe Keyboard Ergonomics:**
   - Pressing `Escape` while the Top Bar search or category filter `<input>` is focused and non-empty clears the search query and calls `e.stopPropagation()` (leaving `WorldInspectorModal` open); pressing `Escape` inside an open Codex image lightbox closes the lightbox. Global `Escape` does **not** force-close `WorldInspectorModal` (preserving existing wizard draft safety and avoiding conflicts with `showReimagineModal` / `showExportDialog`).
   - Left-pane list container supports `ArrowUp` / `ArrowDown` keyboard navigation between visible entries, guarded by [`isEditableKeyboardTarget`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/mapGeometry.ts#L224) so arrow navigation never intercepts cursor movement inside text inputs or textareas.
2. **Smart Auto-Selection & Empty States:**
   - Entering a non-empty category automatically selects the first entry (unless a valid `selectedEntryId` in that category is already active).
   - When filtering hides the currently selected entry, automatically select the top matching result—or show a clean `"No entries match '{query}'"` empty state with a 1-click `"Clear search"` button.
   - Empty editable categories display a clear category description and a 1-click `"Create first {Category} entry"` CTA button (when `!isCampaignMode`).
3. **Live Unsaved & Validation Awareness:**
   - Surface field-level validation hints next to incomplete inputs in the right pane (`Title required`, `Content required`, `Add at least 1 trigger keyword`), `!` dots on left-pane rows, and `!N` badges on Hub cards.

---

## 4. Acceptance Criteria & Verification Matrix

1. **Backend Checks:**
   - `WorldLoreNodeDraft` and `LoreNode` accept `'figure'` and `'threat'` at world scope; `LoreNode._enforce_scope_invariants` rejects `'artifact'`, `'figure'`, and `'threat'` on `location_id` / `container_id` scopes.
   - `normalize_lore_category` maps lenient aliases (`person`/`people`/`enemy`/`enemies`, etc.) deterministically for both world (`allow_artifact=True`) and location (`allow_artifact=False`) scopes.
   - `_migrate_lore_schema_and_legacy_rows` upgrades an existing SQLite DB lacking `'figure'` / `'threat'` in `lore_nodes` `CHECK` without data loss or breaking `vector_entries` or `idx_lore_nodes_*`.
   - `import_export_service.py` normalizes imported `lore_nodes` categories safely prior to SQLite `INSERT`.
   - `_validate_world_artifact_lore_id` remains strictly enforced for `category == 'artifact'` and rejects `'figure'` / `'threat'`.
   - `cd backend && .venv/bin/ruff check app tests && .venv/bin/tach check` and `backend/.venv/bin/pytest backend/tests` pass.
2. **Frontend Checks:**
   - Pure helper tests (`codexHelpers.ts`) verify:
     - All 6 Codex sections derive deterministically from `LoreNode.category` without duplicate fields.
     - Search ranks `Title > Keywords > Content` across World Lore, `LocationNode`, `LocationContainer`, `PersonaRecord`, and `CharacterRecord`, sorting alphabetically within each tier and excluding `secret` local lore + GM character fields in `mode === "campaign"`.
     - `Locations` tree handles cycles/orphaned containers safely, builds nested `L4→L1` containers + locations sorted alphabetically per sibling level, expands ancestors on search match, strips `secret` lore in `mode === "campaign"`, and enforces visited-only image gating (`loc.is_visited`, `visitedContainerIds`, `containerHasVisitedDescendants`).
     - `Major Characters` stays disabled outside campaigns, handles empty cast/persona cleanly, lists persona + alphabetical campaign characters in campaigns, and reconciles selection when `campaignCharacters` mutates mid-session.
   - Component / SSR tests (`WorldInspectorModal` across `inspector`, `wizard`, and `campaign` modes) verify:
     - Hub view renders 6 cards with `Major Characters` disabled in `inspector`/`wizard` modes and enabled in `campaign` mode.
     - In-place view switching between Hub, Category 2-Pane, and Global Search 2-Pane works with a single mounted search input per view and zero nested modals.
     - Campaign mode preserves `created_at_turn_id != null` locations in Codex `Locations`, renders canonical character appearance fields (no `physical_appearance` dependency on `CharacterRecord`), uses live `activePersonaTurnState` gear fallback, and displays `.lore-cat-badge--figure` / `--threat` / `--artifact` cleanly.
     - `!N` validation badges, `handleSave` redirect to failing Codex entry, cross-section reclassification auto-follow + artifact unlink notice, `externalFocusRequest` Map deep-link, `TagChipsInput` pending draft flush, and `isEditableKeyboardTarget`-guarded keyboard shortcuts work as specified.
   - `npm --prefix frontend run arch:check && npm --prefix frontend run build && npm --prefix frontend test` pass.
3. **Architecture Docs:**
   - `backend/.venv/bin/python scripts/generate_arch_docs.py && backend/.venv/bin/python scripts/generate_arch_docs.py --check` passes (if routes/schema/modules change during implementation).
