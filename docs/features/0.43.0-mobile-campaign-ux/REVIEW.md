---
feature: mobile-campaign-ux
target_version: 0.43.0
document_type: review
status: completed
last_updated: 2026-11-26
---

# Pre-Implementation Review — v0.43.0 Mobile Campaign UX, Turn Controls & Responsive Codex

## Key Architectural Traps & Mitigations

### 1. CSS Audit Canonical Media Queries & Orphan-Class Enforcement (`frontend/scripts/audit-css.mjs`)
- **Trap:** `audit-css.mjs` warns on any `@media` query outside `(max-width: 620px)`, `(max-width: 820px)`, `(max-width: 1100px)`, `(min-width: 821px) and (max-width: 1100px)`, and `(prefers-reduced-motion: reduce)`. Using `@media (pointer: coarse)` in CSS would emit non-canonical `@media` warnings, and any unused or test-only CSS class fails `css:audit`.
- **Mitigation:**
  - Keep all CSS media rules strictly aligned to the 3 canonical width breakpoints + `prefers-reduced-motion`.
  - Detect coarse pointer dynamically in `ChatComposer.tsx` via `window.matchMedia("(pointer: coarse)")` inside a pure helper `shouldEnterSubmitComposer`.
  - Ensure every newly added CSS class appears directly in production `.ts`/`.tsx` files.

### 2. Node-Only SSR Vitest Compatibility in `WorldCodexTab` (`codexGameMechanics.test.tsx`, `worldCodex.test.tsx`)
- **Trap:** Existing SSR tests render `WorldCodexTab` and assert presence of elements inside both `.codex-left-pane` (e.g., `codex-pill-divider`, `CARE (Emotions & Bonds)`) and `.codex-right-pane` (article detail) simultaneously in static HTML. Conditionally unmounting one pane in JS would break desktop/SSR assertions.
- **Mitigation:** Keep both `.codex-left-pane` and `.codex-right-pane` mounted in the DOM inside `.codex-two-pane`, toggling visibility at `@media (max-width: 820px)` via `.codex-two-pane--mobile-list` and `.codex-two-pane--mobile-detail`.

### 3. Mutual Exclusivity & Stacking Context for TurnCard Popovers (`TurnCard.tsx`, `ChatStage.tsx`)
- **Trap:** Adding `TurnSwipeSwitcher`'s `.ui-popover` alongside `TurnProseModelPill`'s `.ui-popover` inside `.turn-card` risks both popovers remaining open simultaneously or clipping behind subsequent `TurnCard` siblings.
- **Mitigation:**
  - Lift `openTurnPopover: { turnId: string; kind: "model" | "swipe" } | null` in `ChatStage.tsx` so opening either popover closes any other open popover across all cards (also cleared on `onCheckoutTurn`, `handleSwipeRegenerate`, `handleStartEdit`, `handleBranchFromTurn`).
  - Drive `.turn-card--popover-open` from `effectiveModelPopoverOpen || effectiveSwipePopoverOpen`.

### 4. Two-Tap Delete Confirmation Lifecycle (`TurnCard.tsx`)
- **Trap:** Leaving `confirmDelete` armed after switching swipe versions, starting an edit, starting streaming, or deleting leaves a misleading `"Confirm?"` prompt on a different state.
- **Mitigation:** Reset `confirmDelete` via `useEffect` whenever `turn.id`, `isBusy`, `isDeletingTurn`, or `hasDescendants` changes, and auto-disarm after 4000 ms. Keep explicit `aria-label` on the button since `"Delete"` text is hidden on `<= 620px`.

### 5. `BranchGraphCanvas` Single/Multi-Pointer Lifecycle (`BranchGraphCanvas.tsx`, `branchGraphLayout.ts`)
- **Trap:** Naive `pointerdown` / `pointermove` tracking breaks 2-finger pinch-zoom or jumps when lifting one finger while the second stays down; missing `touch-action: none` lets mobile browsers hijack vertical drags to scroll the modal container.
- **Mitigation:**
  - Track active pointers in `activePointersRef: Map<number, { clientX: number; clientY: number }>`.
  - When `size === 2`, compute distance & center delta via pure `computeBranchPinchViewport` (anchored to `stageRect`, clamped with `clampGraphZoom`).
  - When transitioning `2 -> 1` pointer on `pointerup`/`pointercancel`, re-anchor single-pointer pan origin from the remaining pointer so the canvas never jumps.
  - Apply `touch-action: none` on `.branch-graph-stage`.

### 6. Overlay Drawer Swipe-to-Dismiss Conflict Guards (`drawerSwipe.ts`, `useDrawerSwipeDismiss.ts`, `dependency-cruiser`)
- **Trap:** Naive horizontal touch handlers on `.sidebar--overlay` / `.inspector--overlay` interfere with vertical drawer scrolling, mini-map SVG clicks, or `<input>`/`<select>` interaction—and putting component imports inside `src/hooks/` violates `no-hooks-to-components` in `.dependency-cruiser.cjs`.
- **Mitigation:**
  - Isolate pure geometry & threshold logic in `src/utils/drawerSwipe.ts` (`no-utils-local-upward` safe) and hook wiring in `src/hooks/useDrawerSwipeDismiss.ts` (`no-hooks-to-components` safe).
  - Lock to `"vertical"` whenever vertical motion dominates early (`|dy| >= 12 && |dy| >= |dx|`), only engage horizontal swipe in the dismiss direction (`left`: `dx < 0`, `right`: `dx > 0`), and ignore touches starting inside `<svg>`, form controls, or `[data-no-drawer-swipe="true"]`.

### 7. Custom Non-`HH:MM` Clocks in `splitWorldClockDisplay` (`worldClockDisplay.ts`)
- **Trap:** Custom calendars (`"3rd Moon of Frost"`, `"Day 4 (+15m)"`) have no `HH:MM` clock, while `"Day 1, 22:00"` has a date prefix `"Day 1, "` before `"22"`.
- **Mitigation:** Compute `datePrefix = trimmed.slice(0, idx)` and `hourDigits = match[1]` cleanly so `datePrefix + hourDigits === prefix`, preserving existing consumers while letting `.stage-clock-date` hide on `<= 620px` only when `datePrefix` is non-empty.
