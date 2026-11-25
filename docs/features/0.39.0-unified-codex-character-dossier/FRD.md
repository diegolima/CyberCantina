---
feature: unified-codex-character-dossier
target_version: 0.39.0
document_type: frd
status: completed
last_updated: 2026-11-25
---

# Feature Requirements Document — v0.39.0 Unified Campaign Character Presentation (Codex Dossier)

## 1. Overview & Motivation

During active campaigns, character information is currently split across two overlapping surfaces:
1. **`LiveInspector` → `CharacterRow` → `CampaignCharacterModal`** (*"Character Sheet"* / *"Campaign Dossier"*), an 8-tab modal opened from an expandable accordion in the right pane that holds live CARE/PAD telemetry, inventory editing, memory shard editing, character relocation, and read-only static character tabs.
2. **`WorldInspectorModal` → `WorldCodexTab` → `CodexCharacterDetail`** (*Codex → Major Characters*), a single long scrolling read-only page showing only a subset of fields (bio, appearance, communication style, visible equipped gear, tags, and photo album) alongside the active Player Persona.

This split creates duplicate entry points, inconsistent field coverage, and awkward navigation between characters and the world lore/artifacts they reference.

This feature **unifies campaign character presentation into the Codex as the single source of truth**, retires `CampaignCharacterModal`, simplifies the right-pane character list into compact non-expanding portrait cards that jump directly into the Codex, and upgrades `CodexCharacterDetail` into a cohesive tabbed dossier for both NPC campaign characters and the active Player Persona.

---

## 2. Agreed Product Decisions

1. **Single Campaign Character Surface (Retire `CampaignCharacterModal`):**
   - `CampaignCharacterModal` is removed from campaign play.
   - All read-only reference views and live campaign controls (Inventory equip/unequip/add/edit/delete & artifact lore linking, Campaign Memory Shards editing, Character Relocation override, and `Knowledge of You` provenance) move into `CodexCharacterDetail` inside `WorldCodexTab`.
   - Outside campaigns, the authoring sheet (`CharacterInspectorModal` in the Characters library) remains unchanged.

2. **Compact Right-Pane Character Cards (`LiveInspector` / `CharacterRow`):**
   - Replace the expandable right-pane accordion with a **compact, non-expanding card** per campaign participant.
   - Each card displays:
     - Emotional expression portrait (`getCharacterEmotionPortrait(character, activeEmotion)`)
     - Character Name
     - Party status pill (`In Party`, `NPC Party`, `NPC Party · Leader`) when applicable
     - Presence indicator (`Present` vs. `Elsewhere · <Location>`)
     - Mood label / active emotion badge + change dot when mood shifted
     - Compact **Valence / Arousal** mini-bars and **Composure** indicator
   - Clicking anywhere on the character card opens the Codex directly to that character's entry on the **`Current`** subtab.
   - Hover/focus states and accessible `aria-label` / tooltip clearly communicate *"Open in Codex"*.

3. **Unified Tabbed NPC Dossier (`CodexCharacterDetail` for `kind="character"`):**
   - **Persistent Identity Header (above the subtab bar):**
     - Portrait (emotional expression when live state exists), Character Name, Tagline, Character Tags, and Status/Demographic Badges (`Primary Character` / `Campaign Character`, `Present` / `Elsewhere: <Loc>`, Party pill, Temperament badge, Species, Sex, Pronouns, Age).
   - **Subtab Bar (directly below the Identity Header):**
     - 8 subtabs:
       1. `Bio`
       2. `Appearance`
       3. `Pers` (Personality)
       4. `Voice` (Voice & Dialogue)
       5. `Memories` (with shard count badge)
       6. `Inv` (Inventory, with equipped + carried count badge)
       7. `Current` (with `Live` badge)
       8. `Media` (with portrait + gallery count badge)
     - Visually distinguish **Live / Engine tabs** (`Memories`, `Inv`, `Current` or `Current` live pill + subtle grouping/accent) from static lore reference tabs while keeping **all tabs always accessible** (no GM Mode lock required).
   - **Subtab Contents:**
     - **`Bio`**: Character Biography prose card. Below it, footer toggle buttons for **Creator Notes** and **Opening Scene** (shown only when non-empty). Clicking either button expands/switches an **inline drawer card** right below the Bio box (no nested modals).
     - **`Appearance`**: Structured key/value rows (`Height`, `Resting Posture`, `Visual Aesthetic`), `Distinctive Features` chips, and `Mannerisms & Behavioral Tells` bulleted list.
     - **`Pers`**: `Core Demeanor` prose box, `Traits` chip row, 2-column grid for `Moral Code & Boundaries` and `Quirks & Flaws` (rendered as readable vertical bullet lists rather than truncated pill chips, collapsing to 1 column on narrow widths), and `Baseline Psyche & Emotional Defaults` (`Core Drive`, `Core Fear`, Temperament archetype, baseline mood/PAD).
     - **`Voice`**: `Communication Style` chips and `Voice Anchors` dialogue snippets.
     - **`Memories`**: Campaign-scoped editable `MemoryShard` list (reusing `CampaignCharacterMemoriesTab` logic), applying edits from the next turn onward without mutating the base catalog template.
     - **`Inv`**: Live campaign inventory manager (reusing `CampaignCharacterInventoryTab` logic: Equipped & Carried lists, quick equip/unequip, add/edit/delete items, item notes/flags, world artifact lore linking, plus direct Codex jump to linked Artifact lore entries via `onJumpToLore`).
     - **`Current`**: Live CARE/PAD state (reusing `CampaignCharacterStateTab` logic: Presence/Mood/Expression/Party banner, `Relocate Character (Override)`, Outward Demeanor, Valence/Arousal/Dominance/Composure meters, Layer 3 Scene Appraisal, Layer 1 Active Worldview, Active Scene Want, Active Tactical Plan, Layer 4 Dyadic Relational Bonds, Core Drive & Fear) **plus** the migrated **`Knowledge of You`** card (`unlocked_persona_keys` with Direct / Gossip provenance badges) alongside Dyadic Relational Bonds.
     - **`Media`**: Emotional Expression Portraits grid (8 slots) + Photo Album with lightbox & video playback support (reusing `CampaignCharacterMediaTab` logic).

4. **Context-Aware Default Landing Subtab:**
   - Clicking a character card in the right pane (`LiveInspector`) opens the Codex to `Major Characters` → that character → **`Current`** subtab.
   - Selecting a character while browsing inside the Codex sidebar (or global Codex search) defaults to the **`Bio`** subtab.

5. **Matching Tabbed Player Persona Dossier (`CodexCharacterDetail` for `kind="persona"`):**
   - Uses the same persistent Identity Header layout (Portrait, Name, Tagline, Tags, `Player Persona` + Demographic badges) above a tailored subtab bar with only applicable tabs:
     1. `Bio` (Bio & Concept)
     2. `Appearance` (Height/Build, Distinctive Features, legacy appearance fallback)
     3. `Gear` (Equipped & Carried items with counts)
     4. `Lore & Secrets` (Personal Lore & Secrets with count)
     5. `Media` (Photo Album with count + lightbox)

---

## 3. Non-Goals & Out of Scope
- Modifying the pre-campaign catalog authoring modal (`CharacterInspectorModal`) or Persona editor modal (`PersonaInspectorModal`).
- Adding backend API endpoints (all required campaign character mutation endpoints—inventory actions, memory shard saves, and character relocation—already exist).
- Gating live character state (`Current`, `Memories`, `Inv`) behind GM Mode (`unlockLore`).

---

## 4. Acceptance Criteria
1. Clicking any character card on the right pane opens `WorldInspectorModal` on the `Codex` tab, selects `Major Characters` → that character, and lands on the **`Current`** subtab.
2. Right-pane character cards no longer expand into an accordion; each card compactly renders Portrait, Name, Party pill (if any), Presence (`Present` / `Elsewhere`), Mood label + emotion/shift dot, Valence/Arousal mini-bars, and Composure indicator.
3. Selecting a character from the Codex `Major Characters` sidebar list or Codex global search lands on the **`Bio`** subtab.
4. `Bio` renders `Creator Notes` and `Opening Scene` inline toggle buttons only when populated, toggling an inline drawer card without opening a nested modal.
5. `Appearance`, `Pers`, `Voice`, `Memories`, `Inv`, `Current`, and `Media` all render cleanly inside the Codex split pane at desktop, tablet (`<= 1100px`), and mobile (`<= 820px` / `<= 620px`) breakpoints.
6. `Knowledge of You` (`unlocked_persona_keys` + Direct/Gossip provenance) appears in the `Current` tab alongside Dyadic Relational Bonds.
7. Equip/unequip, add/edit/delete item, artifact lore link + jump, campaign memory shard save, and character relocation all work end-to-end inside the Codex and respect `isMutatingLocked`.
8. Player Persona entries in `Major Characters` render with the matching Identity Header + tailored 5-tab layout (`Bio`, `Appearance`, `Gear`, `Lore & Secrets`, `Media`).
9. `CampaignCharacterModal.tsx` is retired with no dead references or unused CSS classes (`arch:check`, `css:audit`, `build`, `test`, and `generate_arch_docs.py --check` all pass).
