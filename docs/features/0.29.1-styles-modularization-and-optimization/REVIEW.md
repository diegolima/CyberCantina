---
feature: styles-modularization-and-optimization
target_version: 0.29.1
document_type: review
status: approved
last_updated: 2026-11-22
---

# Pre-Implementation Architectural Review
## Stylesheet Modularization, Dead-Code Pruning & Design-Token Optimization

### 1. Cascade-Order Traps Identified Before Splitting (`styles.css` → `src/styles/*.css`)
AST cross-section span analysis of `frontend/src/styles.css` surfaced five load-bearing source-order dependencies that must be preserved verbatim during Phase 2:

1. **Mention Picker & Slash Picker Shared Header Rules:**
   - `.mention-picker-header` (L5419) and `.mention-picker-title` (L5429) are extended by Slash Command Picker rules at L7889–L7894. Both popover systems belong together in `05-composer-and-slash.css` (in original relative order), loaded after `04-chat-and-turns.css`.
2. **Modal Form Controls vs Model Extension Tray Inputs:**
   - `.form-input` / `.form-label` (L2376–L2432) are specialized inside `.model-config-flyout` (L4545–L4562). `07-modals-and-forms.css` must load before `09-providers-and-models.css`.
3. **Turn Card Highlight / Bookmark Extensions:**
   - `.turn-card--highlighted` (L8954) and `.turn-card-top-row` (L9398) extend `.turn-card` / `.narrator-turn-card` / `.arrival-turn-card` from `04-chat-and-turns.css`. `14-story-and-bookmarks.css` must load after `04-chat-and-turns.css`.
4. **Notes Flyout & Responsive Drawer Overrides:**
   - `.notes-flyout-popover` (L2723 in `08-notes.css`) is overridden for tablet rail (`L6273`, `L6515`) and mobile (`L6571`). `15-responsive.css` must load last.
   - Removing `!important` on mobile `.notes-flyout-popover` (L6572) requires matching the `(0,2,0)` specificity of `.studio-shell--sidebar-rail .notes-flyout-popover` via `.studio-shell .notes-flyout-popover` inside `@media (max-width: 820px)`.
5. **Dice Input Invalid & Composer Cancel Specificity:**
   - `.field-input` (L2383) is declared after `.dice-input-invalid` (L1267). Removing `!important` requires `.field-input.dice-input-invalid` (`(0,2,0)`).
   - `.btn.composer-cancel-btn` (`(0,2,0)`) beats `.btn` / `.btn:hover:not(:disabled)` without `!important`.
   - `.tag-chips-box input.tag-chips-inline-input` beats generic input rules while preserving `.tag-chips-inline-input` (asserted in `frontend/e2e/02-character-and-world-authoring.spec.ts`).

### 2. Frontend Design Invariants to Protect (`frontend/AGENTS.md`)
- **Card Deck Extension Trays:** Never merge `.model-config-flyout` into `.ui-popover`; preserve `left: -1px; right: -1px; width: calc(100% + 2px);`, `.has-active-popover` (`z-index: 100`), and card body (`z-index: 2`) over shelf (`z-index: 1`).
- **Themed Picker Dropdown:** Preserve `.themed-picker-popover.align-right` inward anchoring.
- **Semantic Accents:** Keep `--accent-rose` / `--rose-*` strictly for errors, validation failures, and destructive controls; keep assistive AI controls on `--accent-amber` / `--accent-violet`.
- **Stabilized Sheet Modals (`v0.25.1`):** Keep `.modal-panel--sheet` (`880px × 760px`) and `.modal-panel--sheet-wide` (`1120px × 820px`) bounding-box invariants intact.

### 3. CI & Audit Script Edge Cases
- `frontend/scripts/audit-css.mjs` must recursively resolve relative `@import` statements from `frontend/src/styles.css` so it validates both the monolithic file (Phase 1) and the modular tree (Phases 2–5).
- Dynamic class patterns (`prefix-${expr}`, `expr` + `-suffix`, string concatenation) must be extracted via the TypeScript compiler API so valid dynamic variants (49 classes across `lore-cat-badge--*`, `agent-pill--*`, `provider-pill--*`, `memory-item-*`, `context-health-*`, etc.) never trigger false positives in CI.
- CSS custom properties injected inline via React `style={{ "--card-accent-color": ... }}` (`--card-accent-color`, `--codex-card-accent`) must be recognized as defined in TSX so they are never falsely flagged as undefined CSS variables.
