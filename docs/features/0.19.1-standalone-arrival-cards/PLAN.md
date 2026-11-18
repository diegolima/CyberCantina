---
feature: standalone-arrival-cards
target_version: 0.19.1
document_type: plan
status: completed
last_updated: 2026-11-18
---

# Implementation Plan (`v0.19.1`)
## Standalone First-Visit Arrival Cards, Two-Level Collapse & Non-Disruptive Clerk Delivery

## Tasks Completed
1. **Pure Arrival Helpers ([`arrivalHelpers.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/arrivalHelpers.ts)):**
   - Added `makeArrivalGroupKey`, `isArrivalInnerItemExpanded`, `getArrivalScopeLabel`, and `buildArrivalHeaderSummary`.
2. **Standalone & Inner Arrival Components ([`StandaloneArrivalCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/StandaloneArrivalCard.tsx), [`ArrivalDescriptionCards.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/ArrivalDescriptionCards.tsx)):**
   - Created `StandaloneArrivalCard` with outer collapse toggle, destination summary header, sibling `Delete` control for manual map moves, and lifted `failedUrls` / `slideIdx` state so failed-only media cards return `null`.
   - Updated `ArrivalDescriptionCards` to support `visibleMediaOverride`, `onMediaError`, `slideIdxOverride`, `singleItemBare` (omitting redundant inner toggle headers for 1-item groups), and `defaultInnerExpanded` (inner cards open-by-default inside an open outer card).
3. **Turn Feed Ordering & Focus/Scroll Stability ([`TurnCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/TurnCard.tsx), [`styles.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css)):**
   - Removed `.arrival-cards-panel` from inside `.turn-card` and projected `<StandaloneArrivalCard />` via `<React.Fragment>` before Turn 0's card (`depth_index === 0`) and after Turn N's card (`depth_index > 0`), keeping `key="turn-body"` in a stable slot so async Clerk updates never remount Turn N, shift layout, or steal focus/scroll.
   - Styled `.arrival-turn-header`, `.arrival-turn-header-toggle`, `.arrival-turn-summary`, `.arrival-turn-meta`, and `.arrival-card-body--bare` / `.arrival-media-body--bare` while retaining `overflow-anchor: none` and removing obsolete `.arrival-cards-panel*` rules.
4. **Tests & Architecture Docs:**
   - Updated [`firstVisitDescriptions.test.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/__tests__/firstVisitDescriptions.test.tsx) and [`worldMedia.test.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/__tests__/worldMedia.test.tsx).
   - Regenerated `docs/architecture/` via `scripts/generate_arch_docs.py`.

## Verification Gates
- `npm --prefix frontend run arch:check` — passed (165 modules, 653 dependencies, 0 violations)
- `npm --prefix frontend run build` — passed
- `npm --prefix frontend test` — passed (23 test files, 169 tests)
- `backend/.venv/bin/python scripts/generate_arch_docs.py --check` — passed
- `cd backend && .venv/bin/ruff check app tests && .venv/bin/tach check` — passed
- `cd backend && .venv/bin/pytest -q -k "first_visit or arrival" tests` — passed (9 passed)
