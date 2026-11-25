---
feature: codex-character-polish-and-bond-tracker
target_version: 0.39.1
document_type: frd
status: completed
last_updated: 2026-11-25
---

# Feature Requirements Document — v0.39.1 Codex Character Polish & Relational Bond Tracker

## 1. Overview & Motivation

Following v0.39.0 (unifying campaign character presentation into the Codex), two minor polish gaps and one high-value telemetry opportunity remain:
1. **Stale / Duplicate Fields:** `Default Want` and `Default Plan` on the NPC `Personality` tab reflect Turn 0/1 bootstrap seeds that are immediately superseded by live state on `Current`, while `Core Drive` and `Core Fear` on `Current` duplicate fields already shown on `Personality`.
2. **Tab Clarity & Hierarchy:** Shortened labels (`Pers`, `Inv`) inside a single 8-tab strip mix static profile reference with live mutable state. Splitting into two explicit rows (**Profile** vs. **Live**) with full unabbreviated labels and ordering **Live** tabs by usage frequency (`Current` → `Inventory` → `Memories`) clarifies the mental model and prevents awkward wrapping.
3. **Dyadic Relational History:** `Current` currently shows only the latest turn's `Warmth`, `Trust`, `Respect`, `Power`, `Grievance`, and `Obligation` values. Because `bundle.active_branch_turns` already snapshots `care_state.relations` per turn, users can inspect how any relationship evolved turn-by-turn across the active timeline branch.

---

## 2. Agreed Requirements

### 2.1 Remove `Default Want` & `Default Plan` from NPC `Personality` Tab
- In `CodexCharacterDetail.tsx` (`kind === "character"`, `personality` tab), omit `Default Want` and `Default Plan` from **Baseline Psyche & Emotional Defaults**.
- Leave **Baseline Psyche & Emotional Defaults** as a clean 2×2 grid: **Temperament**, **Baseline Mood**, **Core Drive**, and **Core Fear**.
- Outside campaigns, authoring in `CharacterInspectorModal` remains unchanged.

### 2.2 Remove `Core Drive` & `Core Fear` from `Current` Tab
- In `CampaignCharacterStateTab.tsx`, remove the bottom **Core Drive & Fear Reminder** card (already present on the `Personality` tab).

### 2.3 Two-Row Renamed Character Subtab Bar
- Rename `"Pers"` → `"Personality"` and `"Inv"` → `"Inventory"`.
- Organize the NPC character subtab container (`.codex-char-tabs`) into **two explicit rows** separated by a subtle `1px` horizontal divider, with tiny muted left-aligned row labels (`Profile` on Row 1, `Live` on Row 2; row labels hidden below `620px`):
  - **Row 1 (`Profile`):** `Bio` · `Appearance` · `Personality` · `Voice` · `Media (N)`
  - **Row 2 (`Live` — rendered when live state/campaign context applies):** `Current [Live]` · `Inventory (N)` · `Memories (N)`
- Preserve cyan active styling on Profile tabs and amber active styling on Live tabs (`Current`, `Inventory`, `Memories`).

### 2.4 Expandable Dyadic Relational Bonds Turn-by-Turn Line Graph (`Current` Tab)
- **Expandable Bond Cards:**
  - Clicking any CARE Dyadic Relational Bond card header toggles expansion independently (`aria-expanded` + chevron indicator; multiple bonds can remain expanded simultaneously).
  - Legacy `relationship_notes`-only fallback cards (without `care_state.relations`) remain simple non-expandable text cards.
- **Pure Frontend History Extraction (`relationalHistory.ts`):**
  - Derive each bond's series from `bundle.active_branch_turns` with zero backend changes.
  - Resolve the character's snapshot per turn via `turn.character_states?.[characterId] ?? (turn.character_state?.character_id === characterId ? turn.character_state : undefined)`.
  - Exclude standalone map-move waypoint turns (`turn.actor_id === "__arrival__"`).
  - Start each bond's X-axis at the first narrative turn where `care_state.relations[targetId]` appeared (never backfill synthetic zeros from Turn #0).
  - If the active `state` has a turn not yet reflected or `activeBranchTurns` is omitted, ensure the latest snapshot still produces a clean 1-point series.
- **Plotted Metrics & Scales:**
  - Plot **Warmth**, **Trust**, **Respect**, and **Power** enabled by default on a shared `[-1.0, +1.0]` Y-axis with a dashed `0.0` baseline.
  - Include **Grievance** (mapped to `[0, +1.0]` in the upper half with a dashed stroke and formatted as `0–100%`) and **Obligation** (`[-1.0, +1.0]`) as opt-in toggleable legend pills (default OFF).
  - All 6 legend pills are clickable to toggle or isolate lines (guarding against an ambiguous blank state if all metrics are toggled off).
- **X-Axis, Long Branches & Sparse Bonds:**
  - Display sparse `#N` turn ticks along the X-axis.
  - Automatically show an **`All` / `Last 25`** range toggle when a bond's history exceeds 25 narrative turns.
  - Always render explicit point markers alongside `<polyline>` paths; for 1-turn bonds, render the point marker cleanly with a concise caption (`"1 turn recorded — shifts will chart as the campaign progresses"`).
- **Interactive Crosshair & HTML Readout Bar:**
  - Hovering or clicking any turn column on the SVG highlights a vertical crosshair and updates an HTML readout bar (no SVG `<foreignObject>`) showing **`Turn #N`**, exact numeric values for the active metrics, and that turn's `episodic_note` when present (defaulting to the latest turn).

---

## 3. Non-Goals & Out of Scope
- Backend API changes or new turn persistence fields.
- Adding relational bond charts to the Player Persona dossier or pre-campaign `CharacterInspectorModal`.
- Plotting `consolidated_warmth` / `consolidated_trust` curves in v0.39.1 (can be layered onto the same SVG later if desired).

---

## 4. Acceptance Criteria
1. NPC `Personality` tab no longer displays `Default Want` or `Default Plan`; `Baseline Psyche & Emotional Defaults` displays Temperament, Baseline Mood, Core Drive, and Core Fear.
2. `Current` tab no longer displays `Core Drive` or `Core Fear`.
3. NPC Codex subtab bar renders two rows separated by a `1px` divider with `Profile` (`Bio`, `Appearance`, `Personality`, `Voice`, `Media`) and `Live` (`Current`, `Inventory`, `Memories`) labels on desktop/tablet (row labels hidden at `<= 620px`).
4. Clicking any CARE Dyadic Relational Bond card expands/collapses its inline SVG turn-by-turn chart independently (`aria-expanded`), excluding `__arrival__` turns and starting at the bond's first turn.
5. Warmth, Trust, Respect, and Power render by default on `[-1, +1]`; Grievance (`%`) and Obligation toggle on/off via clickable legend pills; `All` / `Last 25` appears when `> 25` turns exist; hovering/clicking a turn updates the vertical crosshair and HTML readout bar with `Turn #N` values and `episodic_note`.
6. All frontend checks (`arch:check`, `css:audit`, `build`, `typecheck:e2e`, `test`), architecture doc checks (`generate_arch_docs.py --check`), and end-user wiki updates pass cleanly.
