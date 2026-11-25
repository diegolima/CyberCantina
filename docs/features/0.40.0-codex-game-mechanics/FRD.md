---
feature: codex-game-mechanics
target_version: 0.40.0
document_type: frd
status: completed
last_updated: 2026-11-25
---

# Feature Requirements Document — v0.40.0 Codex Game Mechanics Reference

## 1. Overview & Motivation

Following `v0.39.0` and `v0.39.1`—which unified live campaign character state, CARE/PAD telemetry, Layer 1–4 diagnostics, expandable Dyadic Relational Bond charts, and `Knowledge of You` provenance into `Codex → Major Characters`—players now inspect dense simulation metrics directly inside the World Codex without an in-app explanation of what those values mean or how they drive behavior.

Similarly, CyberCantina exposes deterministic systems across the Campaign UI (d20 outcome tiers, `/choice` gates, `@Character:` whisper isolation, strict party co-location, metric link travel times, 3-tier memory & Context Health, timeline branching, and GM Mode / Neuromancer) that currently require players or world authors to leave the app and search external documentation.

This feature adds a **static, read-only `Game Mechanics` reference guide** inside `WorldCodexTab` paired with **contextual `?` help buttons** across key simulation surfaces—helping players and authors understand mechanics on demand while preserving strict separation between *world canon* and *system rules*.

---

## 2. Agreed Product Decisions

### 2.1 Placement & Visual Separation inside World Codex
- **Hub Shelf Below the 3×2 World Grid:** Preserve the balanced 3×2 `.codex-hub-grid` for the 6 world/campaign categories (`History & Culture`, `Factions & Figures`, `Locations`, `Items & Artifacts`, `Major Characters`, `Rumors & Threats`). Render **Game Mechanics** directly beneath that grid as a visually distinct, full-width horizontal shelf card carrying a subtle **`Reference`** badge, concise description, and quick-jump preview chips for its top subcategories.
- **2-Pane Section Pill Strip:** Include a `Game Mechanics` pill in `.codex-section-pills` preceded by a subtle vertical visual divider separating world/campaign canon from system reference.
- **Availability Across All Modes:** Always accessible in **all** `WorldInspectorModal` modes (`"campaign"`, `"inspector"`, and `"wizard"`), rather than gated behind `campaignOnly`. World and character authors benefit from temperament, map link, and secret-gating rules while building worlds as much as players do during active campaigns.

### 2.2 Strict Static / Zero-Contamination Invariant
- `Game Mechanics` entries are **100% static, read-only client-side TypeScript data**.
- Mechanics articles must **never**:
  - be stored in `lore_nodes` or any SQLite table;
  - be counted in the `World Codex (N)` header badge or `WorldInspectorModal` tab badge;
  - trigger incomplete-entry validation (`!N` badges);
  - appear in `CodexLoreEditor` or become editable under **Unlock Lore & Secrets (GM Mode)**;
  - be indexed in `vector_entries`, recalled by Phase 2 RAG / `InspectorInternalsSection`, or retrieved by Neuromancer;
  - be exported into `.zcc` / `.json` world or campaign archives.

### 2.3 Search & 2-Level Tree Navigation
- **Grouped Global Codex Search (`searchAllCodexEntries`):**
  - Keep all in-world results (`Lore`, `Locations`, `Major Characters`) ranked first by `matchTier` (`Title` → `Keyword` → `Content`).
  - Render matching `Game Mechanics` articles in a separate **`Game Mechanics (N)`** group below in-world results so searches like `"threat"`, `"history"`, `"artifact"`, or `"secret"` never bury world canon beneath manual pages, while direct lookups like `"composure"` or `"d20"` still work from the Hub search bar.
  - Keyboard `ArrowUp`/`ArrowDown` list navigation and auto-selection span both groups seamlessly.
- **2-Level Collapsible Tree inside `Game Mechanics`:**
  - Reuse the collapsible tree ergonomics from `Locations` (`Expand All` / `Collapse All` toolbar + category-scoped filter input that auto-expands matching subcategory groups).
  - Strictly **2 levels deep** (`Subcategory Group → Article`); cross-cutting concepts link via bottom **Related Topics** chips rather than deeper folder nesting.
  - On default entry (no active search or deep-link), expand the **`CARE`** group with **`How CARE Works`** selected and keep the remaining 6 groups collapsed as a clean scannable index.

### 2.4 Full Content Catalog (7 Subcategories · 23 Articles)

All 7 subcategories ship in `v0.40.0`:

#### 1. `care` — **CARE (Emotions & Bonds)** *(ordered Layer 1 → Layer 4)*
1. `care-overview` — **How CARE Works**
   - Deterministic 4-layer psychological & relational engine; *Zero Raw Floats in Prompts* invariant (compact categorical tags from Phase 3/5 → continuous Python solver → qualitative prose directives); how Phase 3 `<feeling>` / `<want>` / `<plan>` and Phase 5 Clerk updates advance state; overview of time-decay half-lives across `/wait` and travel.
2. `care-worldview-temperament` — **Worldview & Temperament** *(Layer 1)*
   - `Active Worldview` (`Benevolence`, `Belonging`, `Agency` in `[-1.0, +1.0]`); the 6 Temperament Archetypes sourced directly from `TEMPERAMENT_ARCHETYPE_OPTIONS` (`Balanced Realist`, `Stoic Guardian`, `Volatile Firebrand`, `Warm Confidant`, `Guarded Paranoiac`, `Proud Rival`); `Baseline Mood`, `Core Drive`, and `Core Fear`.
3. `care-mood-composure` — **Mood & Composure (PAD)** *(Layer 2)*
   - Exact UI meters on `Current`: `Valence (Distressed ↔ Warm)`, `Arousal / Tension`, `Dominance (Cornered ↔ Commanding)`, `Composure & Emotional Mask`; emotional dampening vs. somatic leakage below `35%` composure; `Outward Demeanor` & `Expression` portrait swapping; resting-baseline decay half-lives (`30m` acute threat, `45m` arousal, `3h` dominance, `4h` composure rest, `6h` valence).
4. `care-scene-appraisal` — **Scene Appraisal & Intent** *(Layer 3)*
   - Exact UI labels on `Current`: `Threat` (`0–100%`), `Coping` (`-1.0` to `+1.0`), `Goal Fit` (`goal_congruence`, `-1.0` to `+1.0`), and `Surprise` (`ambiguity`, `0–100%`); how Layer 1 + Layer 3 appraisal feeds `Active Scene Want`, `Active Tactical Plan`, and Phase 3 private `<cognition>`.
5. `care-dyadic-bonds` — **Dyadic Relational Bonds** *(Layer 4)*
   - Directed per-actor edges (`Warmth`, `Trust`, `Respect`, `Power`, `Grievance`, `Obligation` displayed as `Indebted (+)` vs. `Owed Debt (-)`); fast reactions vs. slow 14-day consolidated trust/warmth anchors; Gottman negativity bias (`negativity_ratio`) & Weber-Fechner saturation; co-present witness coupling; reading the expandable turn-by-turn `RelationalBondChart` (`All` / `Last 25`).

#### 2. `dice` — **Dice & Action Resolution**
6. `dice-modes` — **d20 Modes (Auto, Forced, Disabled)**
   - How `Auto`, `Forced` (random or pinned `1–20`), and `Disabled` work; per-character check roles (`active_attempt`, `contested_reaction`, `scene_hazard`, `co_present_bystander`); DC (`5–25`) and modifier (`-5` to `+8`) assignment; automatic promotion from `Disabled` → `Auto` for gated Director Choices or blocked/obstacle exits.
7. `dice-outcome-tiers` — **The 5 Outcome Tiers**
   - Canonical outcomes (`Critical Failure`, `Failure with Consequences`, `Simple Failure`, `Clean Success`, `Critical Success`), strict `nat 1` / `nat 20` precedence over `margin = total - DC`, and how Phase 3 cognition & Phase 4 prose enforce each tier.
8. `dice-director-choices` — **Director Choices (`/choice`)**
   - Guiding NPC cognition cleanly via the Choices tray or `/choice Name (DC N): Option @gate | ...`; available gates (`@any`, `@success`, `@crit`, `@fail`, `@critfail`); live probability preview; blank-message continuation; `followed` / `coerced` / `free_fallback` compliance outcomes.

#### 3. `directing` — **Directing & Privacy**
9. `directing-whispers-privacy` — **Whispers, Remote Comms & Privacy (`@Character:`)**
   - Shared public room actions vs. `@Character:` local whispers (`"double quotes"` for private spoken dialogue, unquoted text for private sensory/GM cues hidden from co-present peers and scrubbed from summaries) vs. remote off-site comms; empty/solo room turns.
10. `directing-narrator-clock` — **Narrator Mode & World Clock**
    - Neutral narrator commands (`/look`, `/wait`, `/event`, `/narrate` derived with `SLASH_COMMANDS` metadata), zero-dice Narrator turns, and how advancing the World Clock decays CARE mood and acute threat over elapsed minutes.
11. `directing-knowledge-gossip` — **Knowledge of You & Gossip**
    - How Persona secrets (`age_is_secret`, hidden items, personal `lore_entries`) unlock per NPC and propagate across rooms with `Direct` (`player`) vs. `Gossip` provenance shown on `Current`.

#### 4. `spatial` — **Parties, Map & Travel**
12. `spatial-parties` — **Parties & Strict Co-Location (`/party`)**
    - Player-led parties vs. NPC-only parties (elected leader); strict single-room co-location and single-party membership; autonomous Phase 3 invitation acceptance & persuasion checks; `/party invite|kick|leave|disband` and Party Management overrides.
13. `spatial-hierarchy-portals` — **Locations, Containers & Portals**
    - Level 0 Locations inside Levels 1–4 Containers (`CONTAINER_DEPTH_LABELS`); `[Entry/Exit Portal]` threshold rooms; cross-boundary external ghost stubs; First-Visit Arrival description & visual cards.
14. `spatial-links-travel` — **Links, Travel Time & Secret Passages**
    - Metric distances (`m`/`km`), Speed Modifiers (`0.05×`–`100×` and `LINK_SPEED_PRESET_GROUPS`), deterministic World Clock floor (`distance_meters / (WALKING_METERS_PER_MINUTE * speed_modifier)`), `Shift+Click` travel previews, Blocked/Obstacles checks, and Secret Link discovery.

#### 5. `memory` — **Memory, Lore & Context**
15. `memory-3-tier` — **How the AI Remembers (3-Tier Memory)**
    - Tier 1 Working Memory (`working_memory_turns = 12`, `min_working_memory_turns = 4`), Tier 2 Sealed-Episode LOD Cascade (`episodic_chunk_size = 6`, `lod_summary_chunks = 6`, `salience_score >= 8` longevity bonus), Tier 3 Hybrid RRF + BM25/IDF + MMR vector recall, Dynamic Turn Elevation, and ephemeral shard compaction (`40` turns).
16. `memory-context-health` — **Context Health & 4-Zone Economy**
    - 4-Zone KV-cache structure (`Zone 1 Static`, `Zone 2 Episodic`, `Zone 3 Working Mem`, `Zone 4 Ephemeral/RAG`), why Zone 1 stays cache-stable, reading the 4-bar header pill (`PHASE_DISPLAY_META`: P1, P3, P4, P5), Green/Amber/Red health states, and local `num_ctx` overflow protection (`45%` Zone 2 cap).
17. `memory-lore-flags` — **Lore Recall, Secrets & Scene Flags**
    - Global vs. Location vs. Level 1 Container lore, Equipment Artifact cross-links, automatic `secret` reveal detection, `Recalled Last Turn` scores in `Internals`, Phase 3 personal `character_shard` quota (`2` slots), and FIFO `Scene Flags` (`max_scene_flags = 10`).

#### 6. `timelines` — **Timelines & Chronicles**
18. `timelines-branching` — **Branching, Swiping & Editing**
    - Acyclic `TurnNodeRecord` tree; how `Branch`, `Edit`, `Swipe`, and leaf-only `Delete` preserve sibling branches; atomic per-branch switching of CARE states, clock, improvised rooms, parties, inventory, and memories.
19. `timelines-graph-bookmarks` — **Branch Graph & Bookmarks**
    - Collapsed summarized episodes, hidden unfollowed swipes (`+N swipes`), spoiler-safe `"Episode in Progress"` alternate-summary switcher, map-move waypoints (`__arrival__`), and out-of-context personal Bookmark notes (never sent to the AI).
20. `timelines-major-events` — **Major Events & Copy-on-Write**
    - Chronological world-changing `history` milestones and permanent location updates recorded by the Phase 5 Clerk under `Story → Major Events`, plus branch-safe Copy-on-Write isolation so base Worlds remain untouched.

#### 7. `gm` — **GM Tools & Overrides**
21. `gm-neuromancer` — **GM Talk (Neuromancer)**
    - Zero-mutation OOC assistant (`/gm`, **Talk to GM**), `@` live search across turns/entities, spoiler safety respecting GM Mode, human-confirmed **Draft Codex** cards, and opt-in **GM Agentic Tools** (including running tools on **Clerk** while keeping prose on **Primary**).
22. `gm-mode` — **Unlock Lore & Secrets (GM Mode)**
    - What **World Settings → Unlock Lore & Secrets (GM Mode)** unlocks in the UI and Neuromancer (hidden secrets, ghost secret links, Map Auto-Layout, Codex/Major Event edits) and the core invariant: **AI characters still follow in-game discovery rules**.
23. `gm-overrides-locks` — **Manual Overrides & Item Locks**
    - Scene relocation overrides (`Move Scene Here`, `Move Party Here`, `Move Selected...`), individual NPC relocation on `Current` / `Party`, campaign-scoped `MemoryShard` edits, and Inventory `permanent` vs. `artifact` lock flags.

### 2.5 Scannable Article Template & Optional "Under the Hood" Drawer
Every article in the right pane (`CodexMechanicsDetail.tsx`) renders a uniform, concise layout:
1. **Header:** Subcategory badge/breadcrumb, article title, accent icon, and **In One Line** lead summary.
2. **Metrics, Modes & Scales** *(when applicable)*: Compact structured key/value or range rows aligned to exact UI labels and semantic accent colors (`--accent-emerald` for positive/safe/success, `--accent-amber` for tension/warning/live/moderate, `--accent-cyan` for agency/spatial/neutral-mechanics, `--accent-violet` for bonds/episodic/factions, `--accent-rose` strictly for negative values, grievance, or failure tiers).
3. **How It Changes:** Bullet list covering triggers, time decay, or manual overrides.
4. **Effect on Play:** Concrete impact on Phase 1–5 AI cognition, prose, and campaign state, plus relevant slash commands or UI shortcuts.
5. **Optional `Under the Hood` Inline Drawer:** Collapsed by default (matching `Creator Notes` / `Opening Scene` toggle UX in `CodexCharacterDetail`), exposing exact half-lives, margins, constants, and formulas for curious players without cluttering the main view.
6. **Related Topics Footer:** Clickable cross-link chips jumping directly to connected `MechanicsTopicId` entries.

### 2.6 Contextual `?` Deep-Links & Return Navigation
Provide a subtle reusable `MechanicsHelpButton` (`HelpCircle` icon, muted at rest, brighter on hover, accessible `title` and `aria-label`) wired to all high-value live and authoring surfaces:

| Surface & Section | Target `MechanicsTopicId` | Navigation Behavior |
| :--- | :--- | :--- |
| `CampaignCharacterStateTab` — PAD & Composure meters | `care-mood-composure` | Opens `Game Mechanics` in-place + sets `← Return to <Character>` |
| `CampaignCharacterStateTab` — `Layer 3 · Scene Appraisal` | `care-scene-appraisal` | Opens `Game Mechanics` in-place + sets `← Return to <Character>` |
| `CampaignCharacterStateTab` — `Layer 1 · Active Worldview` | `care-worldview-temperament` | Opens `Game Mechanics` in-place + sets `← Return to <Character>` |
| `CampaignCharacterStateTab` — `Layer 4 · Dyadic Relational Bonds` | `care-dyadic-bonds` | Opens `Game Mechanics` in-place + sets `← Return to <Character>` |
| `CampaignCharacterStateTab` — `Knowledge of You` | `directing-knowledge-gossip` | Opens `Game Mechanics` in-place + sets `← Return to <Character>` |
| `CodexCharacterDetail` (`Personality`) — `Baseline Psyche & Emotional Defaults` | `care-worldview-temperament` | Opens `Game Mechanics` in-place + sets `← Return to <Character>` |
| `WorldInspectorModal` (`World Settings`) — `Unlock Lore & Secrets (GM Mode)` | `gm-mode` | Switches `WorldInspectorModal` tab to `"codex"` + sets `← Return to World Settings` |
| `MapLinkInspectorSection` — `Speed Modifier` / `Secret Link` | `spatial-links-travel` | Inside `WorldInspectorModal` switches tab to `"codex"` with `← Return to Map`; inside `LiveInspector` `Expand Map` closes map overlay and opens Codex |
| `ContextHealthModal` header | `memory-context-health` | Closes `ContextHealthModal`, opens `WorldInspectorModal` on Codex `Game Mechanics` |
| `InspectorInternalsSection` (`LiveInspector`) header | `memory-lore-flags` | Opens `WorldInspectorModal` on Codex `Game Mechanics` |
| `DirectorChoicesDrawer` header | `dice-director-choices` | Opens `WorldInspectorModal` on Codex `Game Mechanics` |
| `ChatComposer` footer (next to Dice Mode pill) | `dice-modes` | Opens `WorldInspectorModal` on Codex `Game Mechanics` |
| `PartyManagementModal` header | `spatial-parties` | Closes `PartyManagementModal`, opens `WorldInspectorModal` on Codex `Game Mechanics` |
| `StoryModal` header (tab-aware: `summary` / `major_events` / `timelines` / `bookmarks`) | `memory-3-tier` / `timelines-major-events` / `timelines-branching` / `timelines-graph-bookmarks` | Closes `StoryModal`, opens `WorldInspectorModal` on Codex `Game Mechanics` |
| `GmTalkDrawer` header | `gm-neuromancer` | Keeps drawer state cleanly dismissed/minimized if desired or behind modal, opens `WorldInspectorModal` on Codex `Game Mechanics` |

---

## 3. Non-Goals & Out of Scope

- Any backend API endpoints, database migrations, or prompt pipeline changes.
- Editing, deleting, or authoring `Game Mechanics` entries inside the UI (all entries are static read-only reference docs).
- Extracting a separate standalone modal outside `WorldInspectorModal` / `WorldCodexTab` for Home Deck access (authors access Mechanics inside any World Editor or World Wizard Codex tab).
- Replacing or removing the `/help` command tray (`SlashHelpTray.tsx`), which remains the fast inline composer command launcher.

---

## 4. Acceptance Criteria

1. Opening **Codex** in Campaign, World Edit, or World Wizard mode renders the 6 existing categories in the 3×2 `.codex-hub-grid` with a visually separated full-width **`Game Mechanics`** (`Reference`) shelf below it.
2. `World Codex (N)` header badge, `WorldInspectorModal` Codex tab badge, `!N` validation counts, `lore_nodes` persistence, RAG indexing, and `.zcc` exports remain completely unaffected by `Game Mechanics`.
3. In 2-pane mode, `.codex-section-pills` displays a subtle visual separator before the **`Game Mechanics`** pill. Opening **`Game Mechanics`** shows a 2-level collapsible tree (`7` subcategories, `23` articles) with `Expand All` / `Collapse All`, scoped filtering, `CARE` expanded by default, and `How CARE Works` selected.
4. Global Codex Search displays matching world/campaign entries first and groups any matching mechanics articles under a distinct **`Game Mechanics (N)`** section below them, with working keyboard `ArrowUp`/`ArrowDown` navigation across both groups.
5. Every article renders the structured 4-part layout (`In One Line`, optional `Metrics, Modes & Scales`, `How It Changes`, `Effect on Play`), an optional collapsed-by-default **`Under the Hood`** inline drawer where applicable, and clickable **`Related Topics`** cross-link chips.
6. All 7 subcategories (`CARE`, `Dice & Action Resolution`, `Directing & Privacy`, `Parties, Map & Travel`, `Memory, Lore & Context`, `Timelines & Chronicles`, `GM Tools & Overrides`) and all 23 topics are populated and cross-checked against shared frontend constants (`TEMPERAMENT_ARCHETYPE_OPTIONS`, `LINK_SPEED_PRESET_GROUPS`, `WALKING_METERS_PER_MINUTE`, `CONTAINER_DEPTH_LABELS`, `PHASE_DISPLAY_META`, `SLASH_COMMANDS`).
7. Clicking any contextual `?` button jumps directly to the matching `Game Mechanics` topic, closes any transient modal cleanly without stacking, preserves unsaved `WorldInspectorModal` drafts when jumping from `Map` or `World Settings`, and provides a 1-step **`← Return to ...`** button when launched from within `WorldInspectorModal` / `CodexCharacterDetail`.
8. `npm --prefix frontend run arch:check`, `css:audit`, `build`, `typecheck:e2e`, `test`, `scripts/generate_arch_docs.py --check`, and end-user wiki updates all pass cleanly.
