---
feature: styles-modularization-and-optimization
target_version: 0.29.1
document_type: plan
status: completed
last_updated: 2026-11-22
---

# Implementation Plan & Progress Tracker
## Stylesheet Modularization, Dead-Code Pruning & Design-Token Optimization

### Phase 1 — Hygiene, Orphan Pruning, Silent-Bug Fixes & CI Audit Gate
- [x] Add `frontend/scripts/audit-css.mjs` (recursive `@import` PostCSS + TypeScript AST checker)
- [x] Add `"css:audit"` script to `frontend/package.json`
- [x] Wire `npm --prefix frontend run css:audit` into `.github/workflows/ci.yml`
- [x] Remove 18 confirmed orphan classes (22 rules) & 2 dead selectors in shared rules
- [x] Fix missing `@keyframes spin` & `fadeIn`; deduplicate `provider-spin`, `promptFadeIn`, `change-dot-pulse`/`provider-pulse`
- [x] Fix undefined `var(--border-color)` on `.home-action-btn:hover`, merge split `:root`, add `--font-mono`, clean `.modal-panel--sheet-wide` redundant height, extend `prefers-reduced-motion`
- [x] Gate: `css:audit`, `arch:check`, `build`, `test`

### Phase 2 — Domain Modularization (`frontend/src/styles/*.css`)
- [x] Split `frontend/src/styles.css` into 16 ordered domain files (`00-tokens.css` … `15-responsive.css`)
- [x] Replace `frontend/src/styles.css` with ordered `@import` manifest (18 lines)
- [x] Gate: `css:audit`, `arch:check`, `build`, `test`, `typecheck:e2e`, `generate_arch_docs.py --check`

### Phase 3 — Design Token Expansion & Raw Color Normalization
- [x] Expand `frontend/src/styles/00-tokens.css` with semantic surface/border/accent/radius/z-index tokens
- [x] Replace raw hex/`rgba()` literals across `01-*.css` … `15-*.css` (**853 → 199**, **-76.7%**, exceeding ≥70% target)
- [x] Gate: `css:audit`, `arch:check`, `build`, `test`

### Phase 4 — Shared UI Primitive Consolidation
- [x] Sub-batch 4a: `.ui-search-*` / `.ui-search-bar*` primitive replacing all 7 search families (36 bespoke rules removed)
- [x] Sub-batch 4b: `.ui-pill` + tone/size modifiers consolidating save/status/role/bookmark/chunk pill rules
- [x] Sub-batch 4c: `.ui-popover`, `.ui-empty-state` (all 10 bespoke empty-state rules removed) & 10 semantic intra-file duplicate rule merges
- [x] Sub-batch 4d: `.ui-list-row` replacing `.campaign-item` in `AdminUsersTab.tsx`
- [x] Gate: `css:audit`, `arch:check`, `build`, `test`

### Phase 5 — Breakpoint Standardization, `!important` Removal & Inline Style Hygiene
- [x] Align all 11 scattered `max-width` breakpoints to canonical `620px` / `820px` / `1100px` tiers (`mediaQueries`: 12 → 5)
- [x] Remove all 17 `!important` declarations across all 6 selectors via clean specificity (`!important`: 17 → 0)
- [x] Extract `.ui-section-card` (+ `--compact`, `--danger`) replacing 11 identical inline card blocks in `AdminServerConfigTab.tsx` and `ProfileAccountTab.tsx`
- [x] Update `frontend/AGENTS.md` with modular stylesheet, token, breakpoint, and `css:audit` guidelines
- [x] Update `FRD.md` / `PLAN.md` status to `completed`
- [x] Final Gate: `css:audit`, `arch:check`, `build`, `test` (270/270), `typecheck:e2e`, `test:e2e` (13/13), `generate_arch_docs.py --check`

### Final Verified Metrics
| Metric | Before | After | Delta |
| :--- | ---: | ---: | ---: |
| Entry `styles.css` lines | 9,717 | 18 (manifest + 16 domain files) | Modularized |
| Total CSS rules | 1,287 | 1,242 | -45 rules |
| Orphan CSS classes | 18 | 0 | -100% |
| Undefined `@keyframes` refs | 9 | 0 | -100% |
| Unguarded undefined `var(--*)` | 1 | 0 | -100% |
| Raw color literals outside `:root` | 853 | 199 | -76.7% |
| `!important` declarations | 17 | 0 | -100% |
| Distinct `@media` queries | 12 | 5 (3 canonical widths + reduced-motion) | -58.3% |
| Production CSS (gzip) | 24.2 KB | 24.36 KB | ~flat |
