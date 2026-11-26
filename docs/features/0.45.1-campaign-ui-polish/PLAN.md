---
feature: campaign-ui-polish
target_version: 0.45.1
document_type: plan
status: completed
last_updated: 2026-11-26
---

# Implementation Plan — Campaign UI Polish & Bugfixes

## Step 1: Feature Spec Package
- [x] Author `FRD.md` (`docs/features/0.45.1-campaign-ui-polish/FRD.md`)
- [x] Author `REVIEW.md` (`docs/features/0.45.1-campaign-ui-polish/REVIEW.md`)
- [x] Author `PLAN.md` (`docs/features/0.45.1-campaign-ui-polish/PLAN.md`)

## Step 2: Player Notes Slideout Tint & Mobile Backdrop
- [x] Add warm-amber scratchpad surface tokens (e.g., `--notes-surface-bg`, `--notes-surface-header`) in `frontend/src/styles/00-tokens.css`
- [x] Update `.notes-flyout-popover`, header, footer, and quick-add styles in `frontend/src/styles/08-notes.css` to use the warm-amber surface tint and amber border
- [x] Render a mobile-only `.notes-flyout-backdrop` scrim in `frontend/src/components/NotesDrawer.tsx` and guard search `autoFocus` to fine-pointer desktop viewports (SSR-safe)
- [x] Add mobile (`<= 820px`) `.notes-flyout-backdrop`, upward slide-in `@keyframes` on `.notes-flyout-popover`, and `@media (prefers-reduced-motion: reduce)` entries in `frontend/src/styles/15-responsive.css`

## Step 3: Director Choices Icon Fix & End-to-End Emerald Theme
- [x] Add `"emerald"` to `SlashCommandAccent` in `frontend/src/types/` (if not already present) and switch `/choice` to `accent: "emerald"` in `frontend/src/utils/slashCommands.ts`
- [x] Update `ChatComposer.tsx` Choices button icon color (`var(--accent-emerald)` / `var(--emerald-fg)`) and staged button styling; update `.composer-count-badge` and replace `--blue` slash classes with `--emerald` in `frontend/src/styles/05-composer-and-slash.css`
- [x] Re-theme `frontend/src/components/chat/DirectorChoicesDrawer.tsx` and `.choices-*` rules in `frontend/src/styles/04-chat-and-turns.css` to emerald tokens
- [x] Re-theme staged Director Choices badge strip and cognition Director Choices Guidance panel in `frontend/src/components/chat/TurnCard.tsx` to emerald tokens (preserving amber `coerced` and slate `free_fallback` badges)

## Step 4: Turn Card Footer Quiet Metadata Pill
- [x] Replace `Turn #{turn.depth_index}` and `• {turn.world_snapshot.world_timestamp}` in `frontend/src/components/chat/TurnCard.tsx` with a single combined `.turn-meta-pill` (with hairline `.turn-meta-pill-divider`, no leading `• `)
- [x] Add `.turn-meta-pill` and `.turn-meta-pill-divider` styles in `frontend/src/styles/04-chat-and-turns.css` matching `.turn-model-pill`/`.agent-pill` height with muted read-only styling

## Step 5: Unified Composer Footer Button Heights & Radii
- [x] Unify `min-height: 28px` and `border-radius: var(--radius-md)` across `.composer-action-btn`, `.btn-dice-toggle`, `.composer-cancel-btn`, `.composer-send-btn`, and `.field-input.composer-dice-override-input` in `frontend/src/styles/04-chat-and-turns.css` and `frontend/src/styles/05-composer-and-slash.css`
- [x] Add `.btn-dice-toggle` and `.field-input.composer-dice-override-input` to `@media (max-width: 620px)` in `frontend/src/styles/15-responsive.css` with `min-height: 32px` / `height: 32px` and compact horizontal padding

## Step 6: Context Health Modal Styling & Cascade Fix
- [x] Replace `modal-card`, `btn-icon`, and `btn-sm` in `frontend/src/components/chat/ContextHealthModal.tsx` with `modal-panel` and explicitly defined compact button classes
- [x] Fix stylesheet cascade between `frontend/src/styles/04-chat-and-turns.css` and `frontend/src/styles/07-modals-and-forms.css` (preserving `800px` desktop modal width, `.context-health-modal-body` padding, and `<= 820px` full-screen layout in `frontend/src/styles/15-responsive.css` without `!important`)

## Step 7: Tests & Verification
- [x] Update/add Vitest SSR & helper assertions in `frontend/src/components/__tests__/` and `frontend/src/utils/__tests__/` (`contextHealth.test.tsx`, `slashCommandUi.test.tsx`, `slashCommands.test.ts`, `mobileCampaignUx.test.tsx`, and NotesFlyout / TurnCard footer pill tests)
- [x] Note: No `../cybercantina-wiki` or `mechanicsCatalog.ts` updates needed (purely visual/CSS polish and bugfixes with no mechanic or workflow changes)
- [x] Run frontend checks: `npm --prefix frontend run arch:check && npm --prefix frontend run css:audit && npm --prefix frontend run build && npm --prefix frontend test`
- [x] Run backend checks (`cd backend && .venv/bin/ruff check app tests && .venv/bin/tach check && .venv/bin/pytest tests`) and architecture docs check (`backend/.venv/bin/python scripts/generate_arch_docs.py --check`)
