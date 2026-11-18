---
feature: standalone-arrival-cards
target_version: 0.19.1
document_type: frd
status: completed
last_updated: 2026-11-18
---

# Feature Requirements Document (FRD)
## Standalone First-Visit Arrival Cards, Two-Level Collapse & Non-Disruptive Clerk Delivery

**Status:** Completed  
**Target Version:** CyberCantina v0.19.1  
**Scope:**
- Frontend Chat Feed, Turn Cards & Arrival Components ([`ChatStage.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ChatStage.tsx), [`TurnCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/TurnCard.tsx), [`ArrivalDescriptionCards.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/ArrivalDescriptionCards.tsx), [`arrivalHelpers.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/arrivalHelpers.ts), [`arrivalMediaHelpers.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/arrivalMediaHelpers.ts), [`styles.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css))
- Frontend Tests ([`firstVisitDescriptions.test.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/__tests__/firstVisitDescriptions.test.tsx), [`worldMedia.test.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/__tests__/worldMedia.test.tsx))
- Backend Persistence & Turn Pipeline: **No schema or API changes required** (continues using [`PostTurnStateDelta`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/turn.py#L839-L846) and `actor_id = "__arrival__"` rows from `v0.11.6` / `v0.15.0`)

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
In the `v0.11.6` / `v0.15.0` implementation, first-visit arrival descriptions (`first_visit_cards`) and arrival visuals (`first_visit_media`) use two different layouts depending on how the arrival occurred:

1. **Counter-Intuitive Information Flow on Turn 0:**
   - In [`TurnCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/TurnCard.tsx#L1024-L1041), Turn 0 (`depth_index === 0`) renders the speaker portrait and `raw_prose` *first*, followed by `.arrival-cards-panel` *below* the opening message.
   - Presenting world/container context and arrival visuals after the character's opening prose forces the player to read the scene backwards.
2. **Displaced Clerk Arrival Cards & Layout Shift Inside Turn N:**
   - When Phase 5 Clerk detects movement on Turn N (`depth_index > 0`), it attaches `first_visit_cards` / `first_visit_media` to Turn N's `post_turn`.
   - Rendering `.arrival-cards-panel` *inside* Turn N's `.turn-card` (between `prose-body` and the Turn N footer) makes the new location read like a footnote to the *previous* turn rather than the threshold into the *next* turn—and pushes Turn N's footer downward asynchronously when Clerk completes.
3. **Inconsistent Card Taxonomy & Tedious Per-Item Collapsing:**
   - Manual map moves (`actor_id = "__arrival__"`) render as standalone `.arrival-turn-card` blocks, whereas Turn 0 and Clerk moves render as embedded `.arrival-cards-panel` sub-blocks.
   - Inside [`ArrivalDescriptionCards.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/ArrivalDescriptionCards.tsx), only individual elements (`Arrival Visuals`, `L2`, `L1`, `Location`) are collapsible. Collapsing a multi-layer arrival takes multiple clicks, and auto-collapsed past arrivals still leave multiple stacked header bars in the feed.

### 1.2 Proposed Solution
1. **Unified Standalone Arrival Card Placement (`FR-1`):**
   - Always render first-visit cards and visuals as a standalone `.arrival-turn-card` in the chat feed across all three arrival sources:
     - **Turn 0 (`depth_index === 0`):** Standalone arrival card **before** Turn 0's initial message card.
     - **Clerk Move (`depth_index > 0`, `actor_id !== "__arrival__"`):** Standalone arrival card **after** Turn N's card (below Turn N's footer with Edit/Swipe/Delete controls).
     - **Manual Map Move (`actor_id === "__arrival__"`):** Standalone arrival card at its branch position (preserving its Undo/Delete button).
   - Keep Turn 0 and Clerk arrival payloads stored on Turn N's `post_turn` (no extra DB `turn_node` rows), preserving Edit, Swipe, Delete-Last, and branch rewinding.
2. **Two-Level Collapsible Card Hierarchy (`FR-2`):**
   - Make the **entire standalone arrival card** collapsible down to a single compact summary bar (defaulting to expanded only on `lastTurnId`, auto-collapsing on the next turn), while retaining individual collapse/expand toggles for each inner element (defaulting inner items to open whenever the outer card is expanded, and skipping redundant inner headers when only 1 element is present).
3. **Zero Focus or Scroll Hijack on Async Clerk Commit (`FR-3`):**
   - Appending a Clerk-generated standalone arrival card below Turn N must **never** steal DOM focus, scroll the viewport, or disturb reading/selection/drawer state on Turn N's cognition + prose card.

---

## 2. Scope, Boundaries & Core Invariants

1. **Visually Standalone, Turn-Tree Preserved:**
   - Turn 0 and Clerk arrivals **must not** insert synthetic `turn_node` rows into SQLite or change `active_leaf_turn_id`, `depth_index`, or `parent_turn_id`.
   - Deleting, editing, or swiping Turn N continues to delete or replace Turn N's `post_turn` arrival card atomically.
   - Manual map moves (`actor_id === "__arrival__"`) remain the only standalone `turn_node` arrival rows and remain excluded from Zone 3 LLM context ([`assembler.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/context/assembler.py#L266)) and Clerk summarization ([`pipeline.py`](file:///home/diegolima/Git/cybercantina/backend/app/engine/clerk/pipeline.py#L403)).
2. **Non-Intrusive Async Arrival Rendering (Focus & Scroll Preservation):**
   - When Phase 5 Clerk finishes asynchronously via `onPhase4Complete` ([`useCampaignTurnActions.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/hooks/useCampaignTurnActions.ts#L396-L420)), rendering the new standalone arrival card below Turn N:
     - **Must not** call `.focus()`, `.scrollIntoView()`, or `.scrollTo()` on the arrival card or feed container.
     - **Must not** alter DOM layout inside Turn N's `.turn-card` (Turn N's cognition drawer, `prose-body`, and footer remain untouched at their exact scroll coordinates).
     - **Must not** reset Turn N's expanded cognition/memory drawer state, selected multi-character cognition tab, or active text selection inside Turn N.
     - Must carry `overflow-anchor: none` on `.arrival-turn-card` so browser scroll anchoring does not jump if the user is reading Turn N or scrolling upward.
3. **Cosmetic-Only Context Isolation:**
   - Preserves all `v0.11.6` / `v0.15.0` invariants: zero LLM prompt injection, zero extra LLM calls, and `Describe on First Visit` campaign settings independence.
4. **No Backend Changes & SSR Test Compatibility:**
   - All changes are strictly frontend presentation/state logic and must remain compatible with Vitest Node-only `ReactDOMServer.renderToStaticMarkup` tests (`npm --prefix frontend test`) and `dependency-cruiser` (`arch:check`).

---

## 3. Functional Requirements

### FR-1: Unified Standalone Arrival Card Placement Across All Paths

Extract a shared `StandaloneArrivalCard` component (e.g., `frontend/src/components/chat/StandaloneArrivalCard.tsx`) and render every arrival from [`TurnCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/TurnCard.tsx) using the `.arrival-turn-card` surface, removing `.arrival-cards-panel` from inside `.turn-card`:

1. **Component & Fragment Ownership (`TurnCard.tsx`):**
   - `TurnCard` continues to be mounted in [`ChatStage.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ChatStage.tsx#L1066) with `key={turn.id}` and returns a `<React.Fragment>` (which projects sibling flex items directly into `.turn-feed` without wrapping `.turn-card` in an extra `<div>` and preserves isolated `<TurnCard />` SSR test coverage in [`firstVisitDescriptions.test.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/__tests__/firstVisitDescriptions.test.tsx) and [`worldMedia.test.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/__tests__/worldMedia.test.tsx)):
     - **Turn 0 (`turn.depth_index === 0`):** Render `<StandaloneArrivalCard key="arrival" ... />` **before** `<div key="turn-body" className="turn-card">...</div>` whenever `first_visit_cards.length > 0 || first_visit_media.length > 0`.
     - **Clerk / AI Turn Moves (`turn.depth_index > 0` and `turn.actor_id !== "__arrival__"`):** Render `<div key="turn-body" className="turn-card ...">...</div>` **first**, followed by `<StandaloneArrivalCard key="arrival" ... />` whenever `first_visit_cards.length > 0 || first_visit_media.length > 0`. Applies identically to both Character and Narrator (`__narrator__`) turns that trigger a Clerk move.
     - **Manual Map Moves (`turn.actor_id === "__arrival__"`):** Render `<StandaloneArrivalCard key="arrival" ... />` directly.
2. **Header Source Attribution & Controls:**
   - **Turn 0:** Display `"Scene Opening"` + `world_timestamp` (no Delete button).
   - **Clerk Move (`depth_index > 0`, non-`__arrival__`):** Display `"Arrived via Turn #<depth_index>"` + `world_timestamp` (no Delete button on the arrival card itself; undoing/swiping/editing belongs to Turn N directly above it, and `.turn-card--editing` continues highlighting only Turn N's `.turn-card`).
   - **Manual Map Move (`actor_id === "__arrival__"`):** Display `"Map Move"` + `world_timestamp`, retaining the `Delete` button when `isLastTurn && hasDeleteLastHandler` to undo the map move.

---

### FR-2: Two-Level Collapsible Hierarchy (Outer Card + Inner Elements)

Support collapsing at both the **whole-card** level and the **individual-element** level:

1. **Outer Card Collapse (`makeArrivalGroupKey(turnId)`):**
   - Add `makeArrivalGroupKey(turnId: string): string` (e.g., `${turnId}:group`) in [`arrivalHelpers.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/arrivalHelpers.ts).
   - Clicking the standalone arrival card's header toggle button switches the entire card body between expanded and collapsed states.
   - **Auto-Collapse Lifecycle:**
     - Outer card expanded state is governed by `isArrivalCardExpanded({ turnId, lastTurnId, cardKey: groupKey, manualOverrides })` (preserving `effectiveLastTurnId` in `TurnCard` so `turn_0` also acts as `lastTurnId` when `active_branch_turns.length === 1`):
       - Defaults to **expanded** when `turnId === lastTurnId`.
       - Defaults to **collapsed** as soon as a subsequent turn is committed (`turnId !== lastTurnId`).
       - Whenever `lastTurnId` changes (new turn saved via `onTurnSaved`, branch checkout via `onCheckoutTurn`, or last turn deleted), [`ChatStage.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ChatStage.tsx#L108-L110) clears `arrivalManualOverrides` so all past arrival cards collapse into a single compact bar each.
       - Note: `onPhase4Complete` (Clerk completion) updates the existing leaf turn without changing `lastTurnId`, so `arrivalManualOverrides` is preserved and the newly committed Clerk arrival card starts expanded.
   - **Informative Outer Header Summary & Responsive Truncation:**
     - Build a deterministic destination summary in the outer header so collapsed cards stay scannable at a glance:
       - If `cards.length > 0`: join `cards` titles outermost → innermost (`cards.map(c => c.title).join(" › ")`, e.g., `Old Ward › Anchor Tavern`).
       - Else (`cards.length === 0` and `visibleMedia.length > 0`): use `"Arrival Visuals (N)"` when `visibleMedia.length > 1`, or the single slide label (`getArrivalMediaDisplayLabel(activeSlide)`) when `visibleMedia.length === 1`.
     - Apply `min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap` to the summary title and allow metadata/actions on the right to wrap cleanly on narrow viewports (`< 640px`).
     - When `cards.length > 0` and the card is collapsed (or multi-item), surface a compact count/visuals indicator (e.g., `2 cards` / `+ Visuals`) in the header badges.
   - **Valid Interactive Header Layout:**
     - Place the outer collapse toggle `<button type="button" aria-expanded={groupExpanded}>` and the manual map-move `Delete` `<button type="button">` as **siblings** inside the `.arrival-turn-card` header row (never nesting `<button>` inside `<button>`).

2. **Inner Element Collapse (`isArrivalInnerItemExpanded` & `failedUrls` Lifting):**
   - **Lift `failedUrls` State into `StandaloneArrivalCard`:**
     - Move `failedUrls` state and `filterAvailableArrivalMedia(mediaItems, failedUrls)` evaluation up from [`ArrivalDescriptionCards.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/ArrivalDescriptionCards.tsx#L41-L52) into `StandaloneArrivalCard` (passing `visibleMedia`, `slideIdx`/`setSlideIdx`, and `onMediaError` down).
     - If `cards.length === 0 && visibleMedia.length === 0` (either initially or after all image URLs fail `onError`), `StandaloneArrivalCard` returns `null` so no empty header shell remains.
   - **Open-by-Default Inside Open Outer Card:**
     - Add a pure helper `isArrivalInnerItemExpanded({ cardKey, manualOverrides })` in [`arrivalHelpers.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/arrivalHelpers.ts) that returns `manualOverrides[cardKey]` if present, and `true` otherwise (while keeping `isArrivalCardExpanded` unchanged for outer-group `turnId === lastTurnId` logic).
     - Clicking a collapsed past outer card immediately reveals all arrival descriptions and visuals in **one click**, while users can still independently collapse/expand `Arrival Visuals` or any `container` / `location` card via `manualOverrides`.
   - **Single-Item De-Duplication:**
     - Compute `renderableItemCount = cards.length + (visibleMedia.length > 0 ? 1 : 0)`.
     - When `renderableItemCount === 1`, omit the redundant nested inner accordion header inside the card body:
       - If 1 text card (`cards.length === 1`, `visibleMedia.length === 0`): display the card's icon (`Layers` / `MapPin`), title, and scope badge (`Location` / `L<depth> Area` / `Area`) directly in the outer header, and render `.arrival-card-body` directly when the outer card is expanded.
       - If 1 media carousel (`cards.length === 0`, `visibleMedia.length >= 1`): display `ImageIcon`, `"Arrival Visuals (N)"` (or single slide label), and slide counter (`1/N`) or scope badge in the outer header, and render `.arrival-media-body` directly when the outer card is expanded.
     - When `renderableItemCount >= 2`, render the outer summary header plus the stacked individually collapsible inner cards inside `ArrivalDescriptionCards`.

---

### FR-3: Focus & Scroll Isolation During Asynchronous Clerk Delivery

1. **No Focus Stealing:**
   - Neither `StandaloneArrivalCard` nor `ArrivalDescriptionCards` may call `.focus()` on mount or expansion state changes.
   - Active focus in Turn N (cognition toggle button, character cognition tabs, agent modal trigger, or text selection) or in the message composer `textarea` must remain completely undisturbed when Phase 5 Clerk emits `first_visit_cards` / `first_visit_media`.
2. **No Scroll Jumping:**
   - Do not invoke `scrollIntoView` or programmatic feed scrolling when `first_visit_cards` / `first_visit_media` arrive on `onPhase4Complete`.
   - Keep `overflow-anchor: none` on `.arrival-turn-card` in [`styles.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L438-L442).
   - Because the Clerk arrival card renders **outside and below** Turn N's `.turn-card` (rather than inside Turn N above its footer), Turn N's cognition box, prose, and footer do not shift or resize when Clerk commits.
3. **Turn N DOM & Key Stability:**
   - For `depth_index > 0`, `<div key="turn-body" className="turn-card">` always occupies slot `0` of `TurnCard`'s `<React.Fragment>` before and after Clerk completes, while `<StandaloneArrivalCard key="arrival">` mounts into slot `1`.
   - Consequently, React never unmounts or remounts Turn N's `.turn-card` DOM subtree or wipes `TurnCard` local state (`selectedCognitionCharIdByTurn`, `showRetainedIds`) or browser text selection when Clerk populates `post_turn`.

---

## 4. Edge Cases & UX Constraints

1. **Failed Media URL Fallback (`onError`):**
   - If an arrival starts with 1 text card + 1 broken image URL (`renderableItemCount === 2`) and the image fires `onError`, lifting `failedUrls` into `StandaloneArrivalCard` drops `visibleMedia.length` to `0` and transitions cleanly to `renderableItemCount === 1` without leaving an orphaned media accordion or broken frame.
   - If an arrival has 0 text cards and 1 broken image URL, `onError` drops `visibleMedia.length` to `0` and hides the entire `.arrival-turn-card`.
2. **Turn 0 `start_focus === "world"` With Media:**
   - When `start_focus === "world"`, [`campaigns.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/campaigns.py#L187-L188) sets `suppress_cards=True` and `emit_media=True`, so Turn 0 may have `first_visit_media` with `first_visit_cards = []`. Placing `<StandaloneArrivalCard />` **before** Turn 0's `.turn-card` handles media-only Turn 0 arrivals cleanly using the 1-item media layout.
3. **Auto-Collapse Timing Across Streaming, Swipes & Manual Map Moves:**
   - While Turn N+1 is actively streaming (`LiveStreamingTurnCard`), `lastTurnId` remains `turnN.id` until `onTurnSaved` commits Turn N+1 to `active_branch_turns`. If Turn N+1 errors before saving, Turn N's arrival card stays undisturbed.
   - If Turn 0 is followed immediately by a manual map move (`__arrival__`), `lastTurnId` advances to the `__arrival__` turn and Turn 0's standalone arrival card auto-collapses to one bar cleanly.
4. **Deprecated `.arrival-cards-panel` Styles & Existing Test Updates:**
   - Remove unused `.arrival-cards-panel` / `.arrival-cards-panel-label` rules from [`styles.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L444-L463) (or keep only if needed) and update assertions in [`firstVisitDescriptions.test.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/__tests__/firstVisitDescriptions.test.tsx) and [`worldMedia.test.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/__tests__/worldMedia.test.tsx) from `"arrival-cards-panel"` inside `.turn-card` to standalone `"arrival-turn-card"` placement (verifying arrival precedes Turn 0 prose and follows Turn N's footer).

---

## 5. Acceptance Criteria & Verification Matrix

| ID | Criterion | Verification Method |
| :--- | :--- | :--- |
| **AC-1** | Turn 0 arrivals (`first_visit_cards` / `first_visit_media`) render as a standalone `.arrival-turn-card` **before** Turn 0's `.turn-card`, with no `.arrival-cards-panel` inside Turn 0's card. | Vitest (`TurnCard` SSR order test in `firstVisitDescriptions.test.tsx` & `worldMedia.test.tsx`) |
| **AC-2** | Clerk-triggered arrivals on Turn N (`depth_index > 0`, Character or Narrator) render as a standalone `.arrival-turn-card` **after** Turn N's `.turn-card` (below Turn N's Edit/Swipe/Delete footer) without creating extra DB `turn_node` rows; Turn N retains `Edit`, `Swipe`, `Delete`, `.turn-card--editing` isolation, and stable React reconciliation. | Vitest SSR test + existing backend pytest suite |
| **AC-3** | Manual map moves (`actor_id === "__arrival__"`) render with the same `StandaloneArrivalCard` component and retain the `Delete` button on the active leaf turn (as a sibling `<button>`, never nested inside the header toggle `<button>`). | Vitest SSR test |
| **AC-4** | The outer standalone arrival card is collapsible (`aria-expanded` toggle + truncated destination summary in header); it defaults to expanded **only** when `turn.id === lastTurnId` (including Turn 0 when it is the sole turn) and auto-collapses to a single compact bar when `lastTurnId` advances. | Vitest pure-helper (`arrivalHelpers`) + SSR tests |
| **AC-5** | When an outer card is expanded with 2+ renderable items, inner items (`Arrival Visuals` and each container/location card) default to expanded via `isArrivalInnerItemExpanded` and can each be toggled independently; when `renderableItemCount === 1`, no redundant nested header is rendered; when all media fails and `cards` is empty, nothing renders. | Vitest pure-helper + `StandaloneArrivalCard` / `ArrivalDescriptionCards` SSR tests |
| **AC-6** | Async Clerk arrival insertion performs zero `.focus()` / `.scrollIntoView()` calls, preserves `overflow-anchor: none`, and keeps Turn N's `.turn-card` key/slot and DOM layout unchanged. | Code inspection + Vitest SSR / structural tests |
| **AC-7** | Frontend (`npm --prefix frontend run arch:check`, `npm --prefix frontend run build`, `npm --prefix frontend test`) and architecture doc checks (`backend/.venv/bin/python scripts/generate_arch_docs.py --check`) pass cleanly. | CLI gate |
