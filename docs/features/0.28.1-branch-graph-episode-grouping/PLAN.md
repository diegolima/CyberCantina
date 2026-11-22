---
feature: branch-graph-episode-grouping
target_version: 0.28.1
document_type: plan
status: completed
last_updated: 2026-11-22
---

# Implementation Plan & Verification Trail
## Branch Graph Summarized Episode Grouping & Alternate Summary Switcher (v0.28.1)

### Completed Tasks
- [x] **Backend Cross-Timeline Chunks:** Extracted `_hydrate_episodic_chunk_row`, added `list_campaign_episodic_chunks` in `backend/app/db/repos/turns.py`, and exposed `all_episodic_chunks` on `CampaignStateBundle` (`backend/app/schemas/turn.py`) while keeping `episodic_chunks` strictly active-branch-scoped.
- [x] **Frontend Type Sync:** Added `title`, `synopsis_text`, `keywords`, `witness_character_ids`, `salience_score` to `EpisodicChunkRecord` and `all_episodic_chunks` to `CampaignStateBundle` (`frontend/src/types/turn.ts`).
- [x] **Pure Layout & Grouping Engine (`branchGraphLayout.ts`):** Implemented exact `parent_turn_id` turn-chain resolution, interior `__arrival__` waypoint absorption, active-first disjoint multi-branch ownership, `"Episode in Progress"` + alternate summary variant lists, single/multi-branch re-parenting with `originTurnDepth`, active-tip auto-expansion (`defaultExpandedEpisodeIds` + `episodeExpandOverrides`), `showAllSwipes` auto-expansion, and row-segmented `expandedEpisodeFrames`.
- [x] **Interactive SVG Canvas & Detail Bar (`BranchGraphCanvas.tsx`, `styles.css`):** Implemented stacked Summary Pseudo-Node cards, `+N turns` expand pill, `‹ ›` inline alternate-summary chevron switcher, `from #N` edge origin badges, expanded episode frames with `Collapse` pill, toolbar `Expand/Collapse episodes` toggle, pan anchoring on toggle, and mirrored HTML Detail Bar controls.
- [x] **Tests & Documentation:** Added backend branch-chunk test (`backend/tests/test_engine_and_branches.py`), 6 frontend unit & SSR tests (`frontend/src/components/__tests__/branchGraphAndStory.test.tsx`), regenerated architecture docs, and updated `../cybercantina-wiki/Live-Inspector-Map-and-Timeline.md`.
