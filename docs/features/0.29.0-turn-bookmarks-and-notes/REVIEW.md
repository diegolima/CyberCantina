---
feature: turn-bookmarks-and-notes
target_version: 0.29.0
document_type: review
status: approved
last_updated: 2026-11-22
---

# Pre-Implementation Architectural Review
## Turn Bookmarks, Personal Notes & Clerk Single-Turn Summarization (v0.29.0)

### Critical Architectural Traps Identified & Mitigated

1. **Zero-Context-Injection & Separation from `post_turn_json`**
   - **Trap:** Storing `is_bookmarked` or `user_note` inside `post_turn_json` (`PostTurnStateDelta`) couples player annotations to the async Phase 5 Clerk pipeline (`update_turn_post_clerk`), inflates clerk pill mutation counts, and risks race overwrites if a player bookmarks a turn immediately after prose finishes streaming.
   - **Mitigation:** Store `is_bookmarked` (`INTEGER NOT NULL DEFAULT 0`) and `user_note` (`TEXT NULL`) as first-class columns on `turn_nodes` and top-level fields on `TurnNodeRecord`. Bookmark updates execute targeted single-row `UPDATE turn_nodes SET ...` queries without touching `post_turn_json`, and neither field is read by Phase 1–5 context assembly (`assemble_four_zone_messages`, episodic compaction, or `vector_entries`).

2. **Icon & Color Collisions Across Turn Cards and Timeline**
   - **Trap:** Both `TurnCard.tsx` and `BranchGraphCanvas.tsx` already use amber `★` exclusively for Clerk-detected `notable_event_summary`, and blue (`#93c5fd`) for Director Choices Guidance. Putting a star on timeline nodes or using blue notes creates immediate visual ambiguity.
   - **Mitigation:** Reserve `★` + `--accent-amber` strictly for `notable_event_summary`. Use the **Bookmark** icon + purple/violet (`var(--accent-violet)` / `#a855f7` / `#d8b4fe`) uniformly across Turn Cards, Episode badges, Timeline nodes, and the Story `Bookmarks` tab.

3. **Prompt-Layer Boundary (`tach.toml`) & Built-In Preset Sync**
   - **Trap:** `backend/tach.toml` permits `app.routers` to depend on `app.engine.phase5_clerk`, NOT `app.engine.clerk` directly. Additionally, `promptRoleDefinitions.test.ts` asserts exact prompt counts (13 total, 5 auxiliary).
   - **Mitigation:** Implement `summarize_turn_for_bookmark` in `app.engine.clerk.episodic`, re-export it via `app.engine.phase5_clerk` and `app.routers.campaigns`, register `clerk_turn_bookmark_summary_system` in `PROMPTS_METADATA` and `promptRoleDefinitions.ts` (`auxiliary`), and update `promptRoleDefinitions.test.ts` to 14 total / 6 auxiliary.

4. **Bookmarked Swipe Preservation & `delete_last_turn` Sibling Guard**
   - **Trap:** `branchGraphLayout.ts` collapses childless unfollowed sibling swipes into `hiddenSwipes`, which would hide a bookmarked swipe from the graph and break jump-to-timeline focus. Similarly, `delete_last_turn` deletes childless same-prompt siblings alongside the active leaf.
   - **Mitigation:** Exempt `is_bookmarked` turns from `hiddenSwipes` collapsing in `branchGraphLayout.ts` and exclude bookmarked siblings (`AND COALESCE(t.is_bookmarked, 0) = 0`) from automatic sibling cleanup in `delete_last_turn`.

5. **SSR-Safe Synchronous Episode Expansion in `BranchGraphCanvas`**
   - **Trap:** Expanding a collapsed episode inside `useEffect` leaves the target turn absent from `model.nodeById` on initial render (breaking Vitest `renderToStaticMarkup` tests and falling back `effectiveSelectedId` to `activeLeafId`).
   - **Mitigation:** Export pure `findContainingEpisodeId` from `branchGraphLayout.ts` and seed `episodeExpandOverrides` synchronously inside `useState(...)` initialization in `BranchGraphCanvas.tsx`, plus a `useEffect` fallback for in-place `initialSelectedNodeId` transitions.

6. **Turn #0 & Map-Move Exclusions + Note Retention**
   - **Trap:** Turn #0 (`depth_index == 0`) places the Speaker Emotion Portrait Header at the top-left of `.turn-card`, and map-move turns (`__arrival__`) render compact `StandaloneArrivalCard` / `152×38` waypoint pills.
   - **Mitigation:** Exclude both Turn #0 and `__arrival__` from bookmarking in UI and backend (`HTTP 400`). Wrap non-root turn prompts in a dedicated `.turn-card-top-row` flex container with a left `.turn-bookmark-slot`, and preserve `user_note` when `is_bookmarked` toggles to `False`.
