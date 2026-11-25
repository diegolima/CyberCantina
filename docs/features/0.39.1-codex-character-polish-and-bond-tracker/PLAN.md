---
feature: codex-character-polish-and-bond-tracker
target_version: 0.39.1
document_type: plan
status: completed
last_updated: 2026-11-25
---

# Implementation Plan — v0.39.1 Codex Character Polish & Relational Bond Tracker

## Stage 0: Feature Package Lifecycle Artifacts
- [x] Author `FRD.md`
- [x] Author `REVIEW.md`
- [x] Author `PLAN.md`

## Stage 1: Pure Relational History Extractor & Inline SVG Chart
- [x] Create `frontend/src/components/world/codexCharacter/relationalHistory.ts`:
  - [x] Extract ordered `RelationalHistoryPoint[]` per `targetId` for a given `characterId` from `activeBranchTurns` (+ live `state` fallback/sync).
  - [x] Exclude `__arrival__` map-move turns (`turn.actor_id === "__arrival__"`).
  - [x] Start each bond's series at its first recorded turn (no synthetic Turn #0 zeros).
  - [x] Compute SVG geometry helpers (`mapValueToChartY`, sparse X-axis tick indices, window slicing for `All` vs `Last 25`).
- [x] Create `frontend/src/components/world/codexCharacter/RelationalBondChart.tsx`:
  - [x] Clickable legend pills for `Warmth`, `Trust`, `Respect`, `Power` (default ON) and `Grievance`, `Obligation` (default OFF).
  - [x] Automatic `All` / `Last 25` window toggle when series length `> 25`.
  - [x] Inline SVG (`[-1, +1]` Y-axis with dashed `0.0` baseline, sparse `#N` X ticks, `<polyline>` paths + point circles, vertical crosshair, wide transparent column hit-targets).
  - [x] HTML readout bar showing `Turn #N`, active metric values (`+0.XX` or `%` for Grievance), and `episodic_note` (defaulting to latest point).
  - [x] Single-turn caption when `points.length === 1`.

## Stage 2: Tab Bar Redesign & Field Cleanup
- [x] Update `frontend/src/components/world/CodexCharacterDetail.tsx`:
  - [x] Remove `Default Want` and `Default Plan` from `Personality` → `Baseline Psyche & Emotional Defaults`.
  - [x] Rename `"Pers"` → `"Personality"` and `"Inv"` → `"Inventory"`.
  - [x] Render two-row subtab bar inside `.codex-char-tabs` with subtle `1px` divider and `Profile` / `Live` row labels (`Bio · Appearance · Personality · Voice · Media` on Row 1; `Current · Inventory · Memories` on Row 2).
  - [x] Thread `activeBranchTurns?: TurnNodeRecord[]` into `CampaignCharacterStateTab`.
- [x] Update `frontend/src/components/world/codexCharacter/CampaignCharacterStateTab.tsx`:
  - [x] Remove `Core Drive & Fear Reminder` section.
  - [x] Accept `activeBranchTurns?: TurnNodeRecord[]` and derive `bondHistories` via `relationalHistory.ts`.
  - [x] Make CARE Dyadic Relational Bond cards independently expandable (`expandedBondTargets: Set<string>`, button header with `aria-expanded` + chevron) rendering `<RelationalBondChart>` when expanded.

## Stage 3: Thread `activeBranchTurns` Through Campaign Codex Hierarchy
- [x] Update `frontend/src/App.tsx` to pass `activeBranchTurns={bundle.active_branch_turns}` to `WorldInspectorModal`.
- [x] Update `frontend/src/components/world/WorldInspectorModal.tsx` to accept and forward `activeBranchTurns` to `WorldCodexTab`.
- [x] Update `frontend/src/components/world/WorldCodexTab.tsx` to accept and forward `activeBranchTurns` to `CodexCharacterDetail` (both Global Search and `Major Characters` views).

## Stage 4: Modular CSS, Tests & Full Verification
- [x] Update `frontend/src/styles/12-world-codex.css` for two-row `.codex-char-tabs` (`Profile` / `Live` labels + divider) and `.codex-bond-*` / `.codex-chart-*` styles.
- [x] Update `frontend/src/styles/15-responsive.css` to hide row micro-labels below `620px` and stack chart controls cleanly on mobile.
- [x] Add `frontend/src/components/__tests__/relationalBondTracker.test.tsx` (history extraction, `__arrival__` filtering, late-joining bond start turn, 1-turn bond, `Last 25` slicing, SSR chart + expanded bond card rendering).
- [x] Update `frontend/src/components/__tests__/worldCodex.test.tsx` for removed `Default Want`/`Default Plan`/`Core Drive`/`Core Fear`, two-row `Profile`/`Live` tab names & order, and `activeBranchTurns` integration.
- [x] Run required checks:
  - [x] `npm --prefix frontend run arch:check`
  - [x] `npm --prefix frontend run css:audit`
  - [x] `npm --prefix frontend run build && npm --prefix frontend run typecheck:e2e`
  - [x] `npm --prefix frontend test`
  - [x] `backend/.venv/bin/python scripts/generate_arch_docs.py && backend/.venv/bin/python scripts/generate_arch_docs.py --check`

## Stage 5: User-Facing Wiki Documentation & Lifecycle Closure
- [x] Update `../cybercantina-wiki/Live-Inspector-Map-and-Timeline.md` and `../cybercantina-wiki/First-Campaign-and-Interface-Tour.md` for the two-row `Profile`/`Live` subtabs, cleaned field layout, and expandable Dyadic Relational Bond turn-by-turn graph.
- [x] Verify wiki diff with `git -C ../cybercantina-wiki diff`.
- [x] Mark all checkboxes and set `status: completed` across the feature package.
