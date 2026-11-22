---
feature: turn-bookmarks-and-notes
target_version: 0.29.0
document_type: plan
status: completed
last_updated: 2026-11-22
---

# Implementation Plan & Verification Trail
## Turn Bookmarks, Personal Notes & Clerk Single-Turn Summarization (v0.29.0)

### User-Confirmed Decisions
1. **Protect bookmarked sibling swipes:** `delete_last_turn` preserves bookmarked childless sibling swipes (`AND COALESCE(t.is_bookmarked, 0) = 0`).
2. **Live note keyword filter:** Case-insensitive multi-token whitespace search strictly against `turn.user_note` (empty query shows all bookmarks).
3. **Prompt Presets exposure:** Expose `clerk_turn_bookmark_summary_system` in `PROMPTS_METADATA` and `promptRoleDefinitions.ts` (`auxiliary` role).

### Implementation Checklist
- [x] **Feature Lifecycle Docs:** Create `FRD.md` and `REVIEW.md` (`0.29.0-turn-bookmarks-and-notes`).
- [x] **Backend Schema, Migration & Repo:** Add `is_bookmarked` and `user_note` to `turn_nodes` (`schema.sql`, `schema_init.py`, `schemas/turn.py`, `db/repos/turns.py`), add `update_turn_bookmark` with Turn #0/`__arrival__` guards + note retention, and protect bookmarked sibling swipes in `delete_last_turn`.
- [x] **Clerk Prompt & Summarizer:** Add `PROMPT_KEY_CLERK_BOOKMARK_SUMMARY` (`defaults.py`, `prompts/__init__.py`) and `summarize_turn_for_bookmark` (`engine/clerk/episodic.py`, re-exported via `engine/phase5_clerk.py`) with parent-turn context, deterministic sanitization, and offline fallback.
- [x] **Campaign API & Facade:** Add `PATCH .../turns/{turn_id}/bookmark` and `POST .../turns/{turn_id}/bookmark-summary` (`schemas_and_gate.py`, `crud_and_state.py`, `campaigns.py`).
- [x] **Frontend Types, API, Hook & TurnCard:** Update `types/turn.ts`, `api/campaigns.ts`, `promptRoleDefinitions.ts`, `useCampaignTurnActions.ts`, `TurnBookmarkNoteRow.tsx` (with `MagicWandButton`), `TurnCard.tsx` (top-left dedicated slot + purple note below `★ notable_event_summary`), `ChatStage.tsx`, and `App.tsx`.
- [x] **Timeline Graph & Story `Bookmarks` Tab:** Create `storyBookmarks.ts`, update `branchGraphLayout.ts` (keep bookmarked swipes visible, description priority `user_note` → `notable_event_summary` → fallback, episode `bookmarkCount`, `findContainingEpisodeId`), update `BranchGraphCanvas.tsx` (purple Bookmark SVG icons, episode badge, synchronous expansion & focus centering), update `StoryModal.tsx` (`Bookmarks` tab, sorting, live keyword filter, active zoom vs. alternate Timelines focus), and add CSS in `styles.css`.
- [x] **Verification & Docs:** Add `backend/tests/test_turn_bookmarks.py`, update `promptRoleDefinitions.test.ts`, add `frontend/src/components/__tests__/turnBookmarks.test.tsx`, regenerate `docs/architecture/`, update `../cybercantina-wiki`, and run full backend/frontend verification suites.

### Verification Commands
- `cd backend && .venv/bin/ruff check app tests && .venv/bin/tach check`
- `backend/.venv/bin/pytest backend/tests`
- `npm --prefix frontend run arch:check && npm --prefix frontend run build && npm --prefix frontend test`
- `backend/.venv/bin/python scripts/generate_arch_docs.py && backend/.venv/bin/python scripts/generate_arch_docs.py --check`
- `git -C ../cybercantina-wiki diff`
