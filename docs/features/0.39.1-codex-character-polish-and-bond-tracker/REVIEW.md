---
feature: codex-character-polish-and-bond-tracker
target_version: 0.39.1
document_type: review
status: completed
last_updated: 2026-11-25
---

# Pre-Implementation Review — v0.39.1 Codex Character Polish & Relational Bond Tracker

## Key Architectural Traps & Mitigations

1. **Arrival Turn Filtering (`turn.actor_id === "__arrival__"`):**
   - Standalone map-move turns are tagged via `turn.actor_id === "__arrival__"` (consistent with `TurnCard.tsx` and `branchGraphLayout.ts`), whereas `turn.user_message` may hold display text or a sentinel.
   - **Mitigation:** Filter strictly on `turn.actor_id !== "__arrival__"` inside `relationalHistory.ts` so non-CARE travel turns never produce flat horizontal plateaus.

2. **Primary vs. Secondary Participant Lookup Across Historical Turns:**
   - On `Turn #0` or older turns, `turn.character_states` may hold per-character snapshots while `turn.character_state` holds the primary character's snapshot.
   - **Mitigation:** Resolve each turn's snapshot via `turn.character_states?.[characterId] ?? (turn.character_state?.character_id === characterId ? turn.character_state : undefined)`, deduplicate by `turn.id`, and ensure the live `state` snapshot is appended if `activeBranchTurns` is omitted or lacks the active leaf.

3. **Prop Threading & Layer Boundary Compliance (`dependency-cruiser`):**
   - `activeBranchTurns` comes from `bundle.active_branch_turns` in `App.tsx` and needs to reach `CampaignCharacterStateTab.tsx` via `WorldInspectorModal` → `WorldCodexTab` → `CodexCharacterDetail`.
   - **Mitigation:** Thread `activeBranchTurns?: TurnNodeRecord[]` down as an optional prop (preserving backward compatibility for non-campaign `WorldInspectorModal` modes and existing unit tests). Keep `relationalHistory.ts` inside `frontend/src/components/world/codexCharacter/` importing only from `../../../types` so `arch:check` stays green and unit tests run purely in Node.

4. **Mixed Metric Scales (`Grievance` `[0, 1]` vs. `[-1, +1]`):**
   - `Warmth`, `Trust`, `Respect`, `Power`, and `Obligation` live on `[-1.0, +1.0]`, while `Grievance` lives on `[0.0, 1.0]`. Plotting raw `Grievance` without visual distinction makes `+0.50` look indistinguishable from `+0.50` Warmth.
   - **Mitigation:** Plot `Grievance` in the upper `[0, +1]` half using a dashed rose stroke (`strokeDasharray="4 3"`) and format its readout explicitly as a percentage (`50%`) rather than a signed float.

5. **SVG Interactive Readout & CSS Hygiene:**
   - Avoid `<foreignObject>` inside SVG for hover tooltips (browser repaint glitches and guardrail constraint).
   - **Mitigation:** Render wide transparent `<rect>` column hit-targets inside the inline SVG (`onMouseEnter` / `onFocus` / `onClick`) to update `selectedTurnIndex`, driving an SVG vertical crosshair line + highlighted point rings while displaying numeric values and `episodic_note` in a standard HTML readout bar below the chart. Ensure every new class in `12-world-codex.css` and `15-responsive.css` is referenced in production TSX (`css:audit` = 0 orphans).

6. **Semantic Color Discipline:**
   - Reserve `--accent-rose` / red strictly for Grievance (negative/warning) and keep positive/neutral axes cleanly separated:
     - Warmth: `#10b981` (`--accent-emerald`)
     - Trust: `#06b6d4` (`--accent-cyan`)
     - Respect: `#8b5cf6` (`--accent-violet`)
     - Power: `#f59e0b` (`--accent-amber`)
     - Obligation: `#94a3b8` (`--text-secondary`, dotted/dashed)
     - Grievance: `#f43f5e` (`--accent-rose`, dashed)
