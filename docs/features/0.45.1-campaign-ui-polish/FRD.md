---
feature: campaign-ui-polish
target_version: 0.45.1
document_type: frd
status: completed
last_updated: 2026-11-26
---

# Feature Requirements Document — Campaign UI Polish & Bugfixes

## 1. Overview & Motivation

Five targeted UI/UX polish items and styling bugfixes across the active campaign interface (mobile and desktop):

1. **Player Notes Slideout Tint & Mobile Presentation**: When opening Player Notes on mobile, `App.tsx` closes the left overlay drawer (and its `.drawer-backdrop` scrim) and renders `.notes-flyout-popover` directly over the chat stage using the exact same `--bg-panel` / `--bg-deep` / `--bg-card` surfaces, causing a brief *"did anything happen?"* moment.
2. **Director Choices Icon Bug & Emerald Theme**: In `ChatComposer.tsx`, `<ListChecks>` uses `color="var(--accent-blue)"` when no choices are staged, but `--accent-blue` is undefined in `00-tokens.css`, rendering an invisible icon on `<= 620px` mobile where `.composer-action-label` is hidden.
3. **Turn Card Footer Turn # & Timestamp Pill**: In `TurnCard.tsx`, `Turn #N` and `world_timestamp` render as plain inline spans next to pill-styled model and agent metadata chips.
4. **Unified Composer Footer Control Heights & Radii**: In `15-responsive.css` (`<= 620px`), `.composer-action-btn`, `.composer-cancel-btn`, and `.composer-send-btn` enforce `min-height: 32px`, while `.btn-dice-toggle` was omitted and stays shorter on mobile (and desktop footer buttons use mismatched heights/radii).
5. **Context Health Modal Styling & Cascade Fix**: `ContextHealthModal.tsx` uses undefined `modal-card`, `btn-icon`, and `btn-sm` classes, leaving the modal floating transparently without a panel background, border, or rounded frame, and `04-chat-and-turns.css` is imported before `07-modals-and-forms.css` in `styles.css`.

---

## 2. Agreed Product Decisions

### 2.1 Player Notes Slideout Surface Tint & Mobile Presentation
- **Warm-amber dark surface tint:** Apply a subtle warm-amber surface tint to `.notes-flyout-popover`, its header/footer/quick-add bar, and an amber-accented border (`--amber-border-subtle` / `--amber-border`) using semantic tokens in `00-tokens.css` and `08-notes.css`, preserving full legibility for `--text-secondary`, `--text-muted`, and cyan `#tag` chips.
- **Mobile dim backdrop scrim:** On mobile (`<= 820px`), render a dim click-to-dismiss backdrop (`.notes-flyout-backdrop`) behind `NotesFlyout` so dismissing the left sidebar drawer does not leave the scratchpad floating without figure–ground separation.
- **Mobile bottom slide-up entrance & reduced motion:** On `<= 820px`, animate `.notes-flyout-popover` sliding upward (`translateY(24px) -> 0`) rather than desktop's `translateX(-10px)`, and include `.notes-flyout-popover` and `.notes-flyout-backdrop` in `@media (prefers-reduced-motion: reduce)` in `15-responsive.css`.
- **Disable mobile search `autoFocus`:** Do not auto-focus the `NotesFlyout` search `<input>` on mobile/coarse-pointer viewports so opening the scratchpad does not immediately raise the virtual keyboard over the note list.

### 2.2 Director Choices Icon Fix & End-to-End Emerald Theme
- **Fix invisible icon:** Replace the undefined `var(--accent-blue)` color on `<ListChecks>` in `ChatComposer.tsx` so the icon is always visible on both desktop and mobile (`<= 620px`).
- **End-to-end emerald theme (`--accent-emerald` / `--emerald-*`):** Re-theme all Director Choices surfaces to emerald (distinct from violet GM Talk, cyan Narrator/Exits, sky-blue Forced Dice, and amber Auto Dice/Send):
  - **Composer button & count badge** (`ChatComposer.tsx`, `05-composer-and-slash.css`): `--accent-emerald` icon at rest, `--emerald-*` active/staged surface and `--emerald-fg` text, and emerald `.composer-count-badge`.
  - **`/choice` slash command** (`slashCommands.ts`, `05-composer-and-slash.css`): `accent: "emerald"` with matching `.composer-slash-pill--emerald` and `.slash-picker-icon--emerald`.
  - **`DirectorChoicesDrawer`** (`DirectorChoicesDrawer.tsx`, `04-chat-and-turns.css`): emerald border, header title, active character tab, and preview summary.
  - **`TurnCard` Director Choices badges & guidance** (`TurnCard.tsx`): emerald staged choice badge strip and cognition Director Choices Guidance container/header/label, while preserving amber (`coerced`) and slate (`free_fallback`) compliance badges.

### 2.3 Turn # and Timestamp Combined Quiet Pill in `TurnCard` Footer
- Replace the bare `<span>Turn #{turn.depth_index}</span>` and `<span>• {turn.world_snapshot.world_timestamp}</span>` in `.turn-card-meta` (`TurnCard.tsx`) with a single combined read-only neutral pill (`.turn-meta-pill` with a hairline `.turn-meta-pill-divider`, dropping the leading `• `).
- Match the vertical height and pill rhythm of `.turn-model-pill` and `.agent-pill` (`0.69rem`, `line-height: 1.3`, `padding: 2px 7px`, `border-radius: var(--radius-pill)`) while remaining visually subordinate (`--surface-glass-1`, `--border-glass-subtle`, `--text-muted`, `font-variant-numeric: tabular-nums`, `cursor: default`, no hover lift) so it clearly reads as static metadata rather than an interactive button.

### 2.4 Unified Composer Footer Control Heights & Radii
- Standardize a shared `min-height` (`28px` on desktop, `32px` on `<= 620px`) and consistent `border-radius: var(--radius-md)` (`6px`) across all composer footer controls: `.composer-action-btn` (GM Talk, Narrator, Exits, Choices, and GM Talk mode buttons), `.btn-dice-toggle`, `.composer-cancel-btn`, `.composer-send-btn`, and `.field-input.composer-dice-override-input`.
- Keep `.btn-dice-toggle` horizontal padding compact (`padding: 4px 7px`) at `<= 620px` so the single-row `flex-wrap: nowrap` mobile footer fits narrow (~360px) viewports cleanly even when `diceMode === "forced"` (showing the `rnd` input) or while editing (`Cancel` visible).

### 2.5 Context Health Modal Styling & Cascade Fix
- Replace undefined `modal-card` on `ContextHealthModal.tsx` with `modal-panel` so the dialog receives `--bg-panel`, border, border-radius, and overflow clipping.
- Replace undefined `btn-icon` (modal close button) and `btn-sm` ("Open Model Settings" button) in `ContextHealthModal.tsx` with explicitly styled button classes/rules.
- Resolve the `04-chat-and-turns.css` vs. `07-modals-and-forms.css` stylesheet import-order cascade so `.context-health-modal` (`width: min(800px, 94vw)`, `max-height: 86vh`), `.context-health-modal-body` padding, and `15-responsive.css` `<= 820px` full-screen rules all apply cleanly without `!important`.

---

## 3. Acceptance Criteria
- [x] Opening Player Notes displays a warm-amber tinted flyout surface; on mobile (`<= 820px`), a dim backdrop scrim renders behind the flyout, the panel slides up from the bottom, `prefers-reduced-motion` disables transitions/animations, and opening does not auto-focus the search input on mobile/coarse-pointer devices.
- [x] The Choices button displays its emerald `ListChecks` icon on both desktop and mobile (`<= 620px`) even when 0 options are staged, and all Director Choices surfaces (composer button, count badge, `/choice` slash pill/picker, `DirectorChoicesDrawer`, and `TurnCard` staged badges/cognition guidance) use emerald tokens consistently.
- [x] `TurnCard` footers render `Turn #N` and `world_timestamp` inside a single quiet, read-only neutral `.turn-meta-pill` matching sibling pill heights without the leading `• ` separator or clickable hover affordances.
- [x] All composer footer buttons (`GM Talk`, `Narrator`, `Exits`, `Choices`, `Dice`, `Cancel`, `Send`) and the forced-dice numeric input share identical heights and border-radii on both desktop (`28px`) and `<= 620px` mobile (`32px`) without horizontal overflow.
- [x] `ContextHealthModal` renders inside `.modal-panel` with full panel background, border, header close button, and compact recommendation CTA styling, with `.context-health-modal` desktop dimensions and `<= 820px` full-screen layout intact.
- [x] Frontend checks (`arch:check`, `css:audit`, `build`, `test`), backend checks (`ruff`, `tach`, `pytest`), and `scripts/generate_arch_docs.py --check` pass.
