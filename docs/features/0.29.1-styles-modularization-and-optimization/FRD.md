---
feature: styles-modularization-and-optimization
target_version: 0.29.1
document_type: frd
status: completed
last_updated: 2026-11-22
---

# Feature Requirements Document (FRD)
## Stylesheet Modularization, Dead-Code Pruning & Design-Token Optimization

**Status:** Completed  
**Target Version:** CyberCantina v0.29.1  
**Depends On:** `0.17.0-responsive-campaign-panels`, `0.25.1-stabilized-tabbed-sheet-modals`, `0.29.0-turn-bookmarks-and-notes`  
**Scope:**
- **Backend / Schemas / API:** **No changes required** (purely frontend CSS architecture, design tokens, shared UI primitives, and targeted TSX class migrations).
- **Frontend Stylesheets:**
  - Prune orphaned selectors and fix broken `@keyframes` / undefined CSS custom properties in [`frontend/src/styles.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css).
  - Refactor [`frontend/src/styles.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css) into an ordered manifest importing domain-scoped stylesheets under `frontend/src/styles/`.
  - Expand semantic design tokens in `frontend/src/styles/00-tokens.css` and extract reusable UI primitives in `frontend/src/styles/02-primitives.css`.
  - Normalize fragmented responsive breakpoints, remove `!important` leaks, and opportunistically migrate repetitive inline `style={{ ... }}` wrappers.
- **Frontend Tooling / Automated Checks:**
  - Add a lightweight PostCSS + TypeScript AST stylesheet audit script (`frontend/scripts/audit-css.mjs`, exposed via `npm --prefix frontend run css:audit`) to catch undefined `@keyframes`, undefined `var(--*)`, and orphaned CSS classes automatically.
- **Automated Tests:**
  - Existing Vitest SSR component suite (`frontend/src/components/__tests__/`) and Playwright E2E suite (`frontend/e2e/`) serve as regression gates at the end of every phase.
  - Add targeted unit/audit assertions covering CSS integrity (no undefined `@keyframes` or unguarded `var(--*)`, canonical breakpoint hygiene, and primitive class rendering where TSX migrates).
- **User-Facing Documentation:**
  - **No wiki updates expected** (internal styling refactor with zero intentional UX/feature changes; verify only if any visible polish such as restored spinner animations warrants a changelog note).

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
A PostCSS + TypeScript AST audit of [`frontend/src/styles.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css) identified **9,717 lines (192.1 KB raw / 148.5 KB minified / 24.2 KB gzipped)** containing 1,287 rules, 5,920 declarations, and 1,017 unique classes inside a single monolithic file. While gzipped transfer size is manageable, the stylesheet has accumulated five concrete maintainability and correctness issues:

1. **Orphaned Rules & Silent CSS Bugs:**
   - **18 orphaned classes** across 22 dead rules (~150 lines) plus 2 dead selectors inside shared comma-separated rules remain from superseded features (legacy sidebar accordion/pager, legacy inline user-bubble editing, legacy branch tree list, legacy model scope badges, legacy narrator chips).
   - **Missing `@keyframes spin`:** `.spin-slow` ([styles.css](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L3519-L3521)) references `animation: spin 2.5s linear infinite`, which is never defined (only `@keyframes provider-spin` exists). All 8 live `.spin-slow` loading icons (`TurnCard`, `LiveStreamingTurnCard`, `AgentChangesModal`, `MagicWandButton`, `VideoUploadControls`) fail to rotate.
   - **Missing `@keyframes fadeIn`:** Referenced 8 times ([L447](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L447), [L808](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L808), [L835](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L835), [L1404](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L1404), [L1521](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L1521), [L1701](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L1701), [L6458](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L6458), [L8015](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L8015)), yet never defined (only `@keyframes promptFadeIn` exists), causing 8 entrance transitions to silently no-op.
   - **Undefined CSS custom properties:** `.home-action-btn:hover` ([L4970](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L4970)) references `var(--border-color)` with no fallback; `--accent-purple` and `--font-mono` are also absent from `:root`.
   - **Duplicate blocks & redundant overrides:** `:root` is split across [L1-L18](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L1-L18) and [L3774-L3787](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L3774-L3787); `change-dot-pulse` and `provider-pulse` are byte-for-byte identical; `.modal-panel--sheet, .modal-panel--sheet-wide` sets a shared height at [L8364](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L8364) that `.modal-panel--sheet-wide` immediately overrides at [L8377](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L8377).
2. **Monolithic Append-Only File Structure:**
   - 25 distinct feature sections (ranging from 94 to 1,044 lines each) are concatenated into a single 9.7k-line file, increasing merge conflicts, cognitive load, and accidental rule duplication.
3. **Heavy Pattern Duplication Across Features:**
   - Features routinely re-implement identical UI primitives under new prefixes: **7 separate search input families (38 classes)**, **175 pill/badge/chip classes**, **125 card/panel/box classes**, **63 button classes**, **39 modal/drawer classes**, **29 popover/flyout/tray classes**, and **27 tab classes**.
   - Cross-domain class leakage has appeared (e.g., [`AdminUsersTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AdminUsersTab.tsx#L328-L374) borrows `.sidebar-search-wrap` and `.campaign-item`).
4. **Raw Color & Token Sprawl:**
   - Outside `:root`, **862 raw hex/`rgba()` color literals** appear (more than the 767 `var(--...)` references). Amber alone is hardcoded 172 times across 10 slightly inconsistent opacity stops, violet/purple 109 times, white-alpha 100 times, cyan 99 times, and rose 90 times.
5. **Fragmented Breakpoints, `!important` Overrides & Inline Style Proliferation:**
   - **11 distinct `max-width` breakpoints** (`480`, `560`, `600`, `620`, `640`, `720`, `768`, `820`, `900`, `1100`, `1120px`) are scattered across 17 `@media` blocks, drifting from the canonical 3-tier layout constants in [`campaignLayout.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/utils/campaignLayout.ts#L7-L8) (`MOBILE_MAX_WIDTH = 820`, `TABLET_MAX_WIDTH = 1100`).
   - **17 `!important` declarations** override specificity lazily across 6 selectors.
   - **2,147 inline `style={{ ... }}` objects** exist across 94 TSX files, mixing dynamic geometry/accent vars with static layout boilerplate.

### 1.2 Proposed Solution
Execute the cleanup and optimization across **five sequential, independently shippable phases**:

| Phase | Focus | Primary Outcome | Visual Risk |
| :--- | :--- | :--- | :--- |
| **Phase 1** | Orphan Pruning, Bug Fixes & Audit Gate | Remove 18 orphan classes (~150 LOC), fix broken `spin`/`fadeIn`/`--border-color`, add automated `css:audit` gate | Very Low (restores intended spinner/fade animations) |
| **Phase 2** | Domain Modularization (`src/styles/*.css`) | Split 9.7k-line monolith into ~15 ordered domain files imported via `styles.css` manifest | Zero (strictly cascade-equivalent) |
| **Phase 3** | Design Token Expansion & Color Normalization | Consolidate `:root`, introduce semantic surface/border/tint/mono tokens, replace raw hex/`rgba()` sprawl | Low (verify visual parity) |
| **Phase 4** | Shared UI Primitive Consolidation | Extract reusable `.ui-search-*`, `.ui-pill`, `.ui-popover`, `.ui-empty-state`, `.ui-list-row` primitives & remove ~1,500–2,500 LOC of duplicated rules | Medium (requires incremental TSX migrations + E2E verification) |
| **Phase 5** | Breakpoints, `!important` Removal & Inline Hygiene | Align `@media` queries to canonical responsive tiers, remove all 17 `!important` rules, opportunistically lift repetitive static inline styles | Low–Medium (verify desktop/tablet/mobile E2E viewports) |

> **Ordering rationale:** Phase 1 establishes an automated regression guard before moving code. Phase 2 splits the file *before* tokens and primitives change so all subsequent diffs are scoped and reviewable. Phase 3 defines semantic tokens *before* Phase 4 builds shared primitives so primitives consume tokens from day one. Phase 5 cleans up cross-cutting responsive, specificity, and inline-style debt once structure and primitives are stable.

---

## 2. Scope, Boundaries & Core Invariants

1. **Zero Visual Regressions Across Intentional UI:**
   - Aside from fixing the broken `.spin-slow` rotation, broken `fadeIn` transitions, and undefined `.home-action-btn:hover` border color in Phase 1, rendered layouts, contrast, spacing, and interactions must remain visually equivalent.
2. **Preserve Frontend UI/UX Design Invariants ([`frontend/AGENTS.md`](file:///home/diegolima/Git/cybercantina/frontend/AGENTS.md)):**
   - **Card Deck & Extension Tray Geometry:** Keep in-place extension morphing (`left: -1px; right: -1px; width: calc(100% + 2px)`), header continuity, and stacking contexts (`.has-active-popover` at `z-index: 100`, card body `z-index: 2` over bottom shelf `z-index: 1`).
   - **Semantic Accents:** Keep `--accent-rose` / red strictly reserved for errors, validation failures, and destructive actions; keep assistive AI actions (`MagicWandButton`, extract/populate controls) on `--accent-amber` or `--accent-violet`.
   - **Map Topology Editor & Modal Sheet Stability:** Preserve all `v0.10.1+` map editor contracts and `v0.25.1` `.modal-panel--sheet` / `.modal-panel--sheet-wide` fixed-dimension invariants.
3. **Preserve Single Vite Entrypoint & Architecture Boundaries:**
   - Keep [`frontend/src/main.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/main.tsx#L4) importing `./styles.css` (acting as the `@import` manifest) so Vite bundles everything into one hashed CSS asset with zero extra network requests and no churn to `dependency-cruiser` rules.
   - Maintain compatibility with `scripts/generate_arch_docs.py --check`.
4. **No CSS Preprocessor or Framework Migration:**
   - Stay on native modern CSS bundled by Vite (no Tailwind, Sass, or CSS-in-JS introduction).
5. **Respect Dynamic Inline Styles:**
   - Phase 5 must **not** try to eliminate runtime-computed inline styles (CSS custom property injection such as `--card-accent-color` / `--codex-card-accent`, SVG coordinates/transforms, popover measured coordinates, or progress bar widths).
6. **Test Selector Compatibility:**
   - Keep all existing class names asserted by Vitest SSR tests (`frontend/src/components/__tests__/`) and Playwright E2E specs (`frontend/e2e/`) intact, or update affected tests cleanly in the same phase PR when migrating bespoke classes to shared primitives in Phase 4.

---

## 3. Phased Functional Requirements

### Phase 1 — Hygiene, Orphan Pruning, Silent-Bug Fixes & Automated Audit Gate

#### FR-1.1: Remove Confirmed Orphan CSS Classes
Remove the 18 unused classes (22 dead rules, ~150 lines) and 2 dead selectors inside shared rules:
- **Legacy sidebar accordion & pager:** `.sidebar-section` ([L124-L129](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L124-L129)), `.sidebar-category-header` + `:hover` ([L131-L143](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L131-L143)), `.sidebar-category-title` ([L145-L154](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L145-L154)), `.sidebar-category-body` ([L156-L161](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L156-L161)), `.sidebar-pager` ([L191-L198](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L191-L198)).
- **Legacy grid & branch tree:** `.wizard-grid` ([L289-L293](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L289-L293)), `.campaign-list`, `.branch-tree-list` ([L295-L301](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L295-L301)).
- **Legacy inline user-bubble editor:** `.user-bubble-editing`, `.user-bubble-edit-header`, `.user-bubble-edit-textarea` (+ `:focus`), `.user-bubble-edit-actions` ([L450-L483](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L450-L483)).
- **Legacy narrator & cognition selectors:** `.narrator-quick-chip` (+ `:hover`, `.active`) ([L778-L798](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L778-L798)), `.user-bubble-narrator-perception` ([L1004-L1017](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L1004-L1017)), and strip dead `.cog-step-body` from the shared rule at [L1051-L1056](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L1051-L1056) (preserving `.cog-step > div:not(.cog-step-label)`).
- **Superseded model/prompt selectors:** `.model-scope-badge` (+ `.system`, `.override`, `.locked`) ([L4252-L4278](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L4252-L4278)), `.prompt-role-focus-header` ([L5819-L5827](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L5819-L5827)), and strip dead `.prompt-role-custom-pill` from the shared rule at [L5799-L5808](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L5799-L5808) (preserving `.prompt-role-unsaved-pill`).

#### FR-1.2: Fix Broken `@keyframes`, Undefined Custom Properties & Duplicate Definitions
1. Define canonical `@keyframes spin` (`to { transform: rotate(360deg); }`) and point both `.spin-slow` and provider spinner rules to `spin` (removing duplicate `provider-spin`).
2. Define canonical `@keyframes fadeIn` (`from { opacity: 0; } to { opacity: 1; }`) and point `promptFadeIn` callers to `fadeIn` (removing duplicate `promptFadeIn`). Respect `@media (prefers-reduced-motion: reduce)` for new/fixed animations where appropriate.
3. Deduplicate `change-dot-pulse` ([L1925](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L1925)) and `provider-pulse` ([L3768](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L3768)) into a single `@keyframes pulseOpacity`, and evaluate merging `flyoutSlideDown` / `promptFadeSlideDown`.
4. Fix `.home-action-btn:hover` ([L4970](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L4970)) from `var(--border-color)` to `var(--text-muted)` or `var(--border-subtle)` (matching hover affordance of `.btn:hover`).
5. Merge the two `:root` blocks ([L1-L18](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L1-L18) and [L3774-L3787](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L3774-L3787)) into a single top-of-file `:root` block and add `--font-mono`.
6. Remove the redundant `.modal-panel--sheet-wide` selector from [L8364-L8367](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L8364-L8367) since [L8374-L8378](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L8374-L8378) defines its own height.

#### FR-1.3: Automated Stylesheet Audit Script (`css:audit`)
Add `frontend/scripts/audit-css.mjs` (using `postcss` and `typescript` already installed in `frontend/node_modules`) and wire `"css:audit": "node scripts/audit-css.mjs"` in `frontend/package.json`:
- **Fail (non-zero exit)** on:
  - Any `animation` / `animation-name` referencing an undefined `@keyframes`.
  - Any `var(--*)` without a fallback that is neither defined in CSS nor set inline in TSX.
  - Any unused CSS class not present in production TSX/TS/HTML string literals or dynamic template prefixes (supporting an explicit small allowlist only if ever needed for runtime/third-party hooks).
- **Warn/Report** metrics: total rules, raw color literal count, `!important` count, and distinct `@media` breakpoints so Phases 2–5 progress is objectively tracked.

---

### Phase 2 — Domain Modularization (`frontend/src/styles/*.css`)

#### FR-2.1: Directory Structure & Exact Cascade Preservation
Turn [`frontend/src/styles.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css) into a thin ordered `@import` manifest pointing to domain stylesheets under `frontend/src/styles/`:

| Order | Target File | Source Sections (approx. current lines) |
| :--- | :--- | :--- |
| 00 | `styles/00-tokens.css` | `:root` tokens & canonical `@keyframes` |
| 01 | `styles/01-base-and-shell.css` | Global reset, scrollbars, `.studio-shell`, base `.btn` variants, utility classes |
| 02 | `styles/02-primitives.css` | *(Created empty or seeded with shared modals/forms; expanded in Phase 4)* |
| 03 | `styles/03-sidebar.css` | Original sidebar styles + v0.20.1 campaign-focused sidebar + auth/admin sidebar footer |
| 04 | `styles/04-chat-and-turns.css` | Chat stage, turn cards, narrator/arrival cards, choices drawer, cognition drawer/tabs, RNG/dice, agent pills, mentions/whispers, context telemetry |
| 05 | `styles/05-composer-and-slash.css` | Unified composer card, Magic Wand bars, composer footer, flyout menus, slash autocomplete & `/help` tray |
| 06 | `styles/06-inspector-and-lore.css` | Right inspector panel, collapsible sections, exits, character rows, story/internals, lore index, `TagChipsInput`, location lore badges |
| 07 | `styles/07-modals-and-forms.css` | Generic modals, form controls, `.modal-panel--sheet` / `--sheet-wide`, profile modal frame & preference sub-tabs, export search |
| 08 | `styles/08-notes.css` | User notes flyout popover, master-detail modal, note editor |
| 09 | `styles/09-providers-and-models.css` | Providers manager, provider pills/status dots, model card deck, floating extension tray, `ThemedPickerDropdown` |
| 10 | `styles/10-home.css` | Home screen, dashboard grid, watermark cards, carousel dots, entity picker modal |
| 11 | `styles/11-prompts-and-admin.css` | Prompt presets role deck & admin communication message banners/composer |
| 12 | `styles/12-world-codex.css` | World Codex hub + 2-pane master-detail + local lore cue |
| 13 | `styles/13-parties-and-map-search.css` | Parties system (v0.21.0) & Spatial Topology header search combobox |
| 14 | `styles/14-story-and-bookmarks.css` | Timeline branching, Story modal, SVG branch graph, turn bookmarks & personal notes |
| 15 | `styles/15-responsive.css` | Responsive campaign layout, collapsible rail, overlay drawers, backdrop & reduced-motion overrides |

#### FR-2.2: Cascade Order Verification
- Import order in `frontend/src/styles.css` **must** preserve every cross-section override (in particular, `15-responsive.css` must load last so responsive overrides for `.studio-shell`, `.sidebar--overlay`, `.inspector--overlay`, `.notes-flyout-popover`, and `.stage-header` win identically to today; `03-sidebar.css` must keep v0.20.1 overrides after base sidebar rules).
- Update `frontend/scripts/audit-css.mjs` to recursively follow `@import` statements from `styles.css` (or scan `frontend/src/styles/*.css`) so the audit covers the full modular tree.

---

### Phase 3 — Design Token Expansion & Raw Color Normalization

#### FR-3.1: Expand Semantic Tokens in `styles/00-tokens.css`
Define a compact, structured token palette in `:root` covering the patterns currently hardcoded 862 times:
- **Surface & neutral overlays:** `--surface-glass-1` (`rgba(255, 255, 255, 0.02)`), `--surface-glass-2` (`0.04`), `--surface-glass-3` (`0.06`), `--surface-glass-4` (`0.08`), `--surface-backdrop-dark`, `--shadow-popover`, `--shadow-modal`.
- **Border alphas:** `--border-glass-subtle` (`rgba(255, 255, 255, 0.08)`), `--border-glass-strong` (`rgba(255, 255, 255, 0.14)`).
- **Accent semantic triplets (`bg`, `bg-hover`, `border`, `fg`)** for each brand hue:
  - Amber (`--amber-bg`, `--amber-bg-hover`, `--amber-border`, `--amber-fg` `#fbbf24` / `#fde68a`)
  - Cyan (`--cyan-bg`, `--cyan-bg-hover`, `--cyan-border`, `--cyan-fg` `#67e8f9` / `#22d3ee`)
  - Violet (`--violet-bg`, `--violet-bg-hover`, `--violet-border`, `--violet-fg` `#c4b5fd` / `#ddd6fe`)
  - Purple (`--accent-purple: #a855f7` + triplet, or harmonized intentionally with violet where identical)
  - Rose (`--rose-bg`, `--rose-bg-hover`, `--rose-border`, `--rose-fg` `#fda4af`)
  - Emerald (`--emerald-bg`, `--emerald-bg-hover`, `--emerald-border`, `--emerald-fg` `#6ee7b7`)
- **Typography & Radii:** `--font-mono`, `--radius-sm` (`4px`), `--radius-md` (`6px`), `--radius-lg` (`8px`), `--radius-xl` (`12px`), `--radius-pill` (`9999px`).
- **Z-index scale:** `--z-drawer-backdrop`, `--z-drawer`, `--z-popover`, `--z-card-popover-host` (`100`, matching `frontend/AGENTS.md`), `--z-modal`.

#### FR-3.2: Migrate Raw Color Literals
- Replace raw hex/`rgba()` values across `frontend/src/styles/*.css` with semantic tokens, targeting a **>= 70% reduction** in raw color literals outside `00-tokens.css` (from 862 down to <= ~250 genuinely one-off gradients/illustrative accents).
- Preserve contrast ratios (WCAG AA readability on `--bg-deep` / `--bg-panel` / `--bg-card`) and never substitute rose/red onto non-error/non-destructive states.

---

### Phase 4 — Shared UI Primitive Consolidation

Consolidate duplicated component CSS into `frontend/src/styles/02-primitives.css` in four incremental, independently testable sub-batches:

#### FR-4.1: Sub-Batch 4a — Search Field Primitive (7 families → 1)
- Create `.ui-search-wrap`, `.ui-search-icon`, `.ui-search-input`, `.ui-search-clear` (plus compact/pill size modifiers as needed).
- Migrate all 7 bespoke search implementations (38 classes):
  - `sidebar-search-*` ([`HomeEntityPickerModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/HomeEntityPickerModal.tsx), [`AdminUsersTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AdminUsersTab.tsx), [`LoreIndexModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/inspector/LoreIndexModal.tsx))
  - `notes-search-*` / `notes-flyout-search-wrap` ([`NotesDrawer.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/NotesDrawer.tsx))
  - `themed-picker-search-*` ([`ThemedPickerDropdown.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/models/ThemedPickerDropdown.tsx))
  - `export-category-search-*` ([`ExportBundleModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ExportBundleModal.tsx))
  - `codex-search-*` ([`WorldCodexTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldCodexTab.tsx))
  - `map-search-*` input chrome ([`TopologyHeaderToolbar.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/TopologyHeaderToolbar.tsx) — keeping dropdown/combobox-specific classes)
  - `story-bookmarks-search-*` ([`StoryModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/story/StoryModal.tsx))

#### FR-4.2: Sub-Batch 4b — Pill / Badge / Chip Primitive
- Create `.ui-pill` with composable size (`.ui-pill--xs`, `.ui-pill--sm`) and tone (`.ui-pill--neutral`, `--amber`, `--cyan`, `--violet`, `--emerald`, `--rose`, `--purple`) modifiers powered by Phase 3 tokens.
- Migrate repetitive badge/pill rules across `providers`, `lore`, `slash-commands`, `map-search`, `codex`, `parties`, `story`, and `context-health` while retaining domain hook classes only where unique layout/animation/test selectors require them.

#### FR-4.3: Sub-Batch 4c — Popover Surface, Empty State & Sub-Tab Primitives
- Create `.ui-popover` (shared dark surface, border, radius, elevation shadow, z-index, `fadeIn` entrance) and apply across autocomplete/picker/flyout popovers without breaking `ThemedPickerDropdown` edge-aware `.align-right` anchoring or `ModelCard` extension tray geometry.
- Create `.ui-empty-state` (centered muted placeholder layout) to unify the 11 separate empty-state classes.
- Consolidate repeated header/toolbar flex patterns (e.g., `.codex-topbar` / `.pref-subtabs-bar`, `.story-summary-panel` / `.story-bookmarks-panel`) identified in the duplicate-declaration audit.

#### FR-4.4: Sub-Batch 4d — Decouple Cross-Domain Class Borrowing
- Replace `.campaign-item` usage in [`AdminUsersTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AdminUsersTab.tsx#L374) with a shared `.ui-list-row` primitive and retire `.campaign-item` once no callers remain.
- Target net stylesheet reduction across Phase 4: **1,500–2,500 lines removed**.

---

### Phase 5 — Breakpoint Standardization, `!important` Removal & Inline Style Hygiene

#### FR-5.1: Canonical Responsive Breakpoints
Align the 11 fragmented `max-width` media queries (`480`, `560`, `600`, `620`, `640`, `720`, `768`, `820`, `900`, `1100`, `1120px`) to the canonical tiers synchronized with [`campaignLayout.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/utils/campaignLayout.ts#L7-L8):
- **Compact Phone:** `@media (max-width: 620px)` *(absorbs `480px`, `560px`, `600px`, `620px`, `640px` after verifying modal/form grids at `480px` and `620px`)*
- **Mobile:** `@media (max-width: 820px)` *(matches `MOBILE_MAX_WIDTH = 820`; absorbs `720px`, `768px`, `820px`)*
- **Tablet:** `@media (min-width: 821px) and (max-width: 1100px)` and `@media (max-width: 1100px)` *(matches `TABLET_MAX_WIDTH = 1100`; absorbs `900px`, `1100px`, `1120px`)*
- **Motion Accessibility:** Single `@media (prefers-reduced-motion: reduce)` block covering drawers, spinners/pulses, and fade transitions.

Document the canonical breakpoint table at the top of `styles/15-responsive.css` and check for non-canonical breakpoints in `css:audit` (warning level).

#### FR-5.2: Eliminate All 17 `!important` Declarations
Refactor the 6 rules currently relying on `!important`:
1. `.turn-card--editing` ([L429](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L429)) & `.turn-card--highlighted` ([L8954](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L8954)): place after base `.turn-card` / `.narrator-turn-card` / `.arrival-turn-card` rules or scope as `.turn-card.turn-card--editing`.
2. `.dice-input-invalid` ([L1268-L1270](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L1268-L1270)): scope as `.dice-input.dice-input-invalid` after `.dice-input`.
3. `.composer-cancel-btn` (+ `:hover:not(:disabled)`) ([L1417-L1428](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L1417-L1428)): scope as `.btn.composer-cancel-btn` after `.btn` / `.btn-danger`.
4. `.tag-chips-inline-input` ([L3670-L3676](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L3670-L3676)): scope as `.tag-chips-box .tag-chips-inline-input` so it cleanly beats `.field-input` without `!important`.
5. `.notes-flyout-popover` (`left: 12px !important` at [L6572](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L6572)): replace inline `left` positioning or use CSS custom property `--notes-flyout-left` overridden inside `@media (max-width: 820px)`.

#### FR-5.3: Opportunistic Inline `style={{ ... }}` Hygiene
- Audit the top 10 TSX files by inline `style={{ ... }}` count (out of the 2,147 occurrences across 94 files) and extract high-repetition static layout/card/badge wrappers into existing or Phase 4 CSS classes.
- Explicitly leave genuinely dynamic inline styles (SVG transforms, `--card-accent-color`, progress percentages, measured popup coordinates) untouched.
- Add a concise CSS & styling convention note in [`frontend/AGENTS.md`](file:///home/diegolima/Git/cybercantina/frontend/AGENTS.md) covering the modular file map, canonical breakpoints, semantic tokens, and primitive reuse so new features do not re-create monolithic bloat.

---

## 4. Edge Cases & Regression Risk Matrix

| Risk / Edge Case | Affected Phase | Mitigation |
| :--- | :--- | :--- |
| Restoring `@keyframes spin` or `fadeIn` unexpectedly animates elements under reduced-motion preferences | Phase 1 | Honor `@media (prefers-reduced-motion: reduce)` for entrance animations and verify all 8 `.spin-slow` call sites only render while actively loading/running. |
| Changing cascade order when splitting into `src/styles/*.css` breaks `.sidebar--overlay`, `.inspector--overlay`, or `.modal-panel--sheet` overrides | Phase 2 | Keep exact file-to-rule source ordering; verify minified CSS rule structure and run full Playwright E2E suite (desktop + tablet + mobile). |
| Consolidating `.modal-panel--sheet` / `.ui-popover` accidentally disrupts `ModelCard` extension trays or `ThemedPickerDropdown` `.align-right` positioning | Phase 3–4 | Explicitly exclude `.model-config-flyout` / `.has-active-popover` from generic `.ui-popover` overrides; verify against [`frontend/AGENTS.md`](file:///home/diegolima/Git/cybercantina/frontend/AGENTS.md) stacking invariants. |
| Consolidating search inputs breaks Playwright locators or Vitest SSR class assertions (`sidebar-search-input`, `map-search-input`, etc.) | Phase 4 | Audit all `frontend/src/**/__tests__/*` and `frontend/e2e/*` selectors before each sub-batch; prefer ARIA/label selectors or keep semantic class hook alongside `.ui-search-input` if externally targeted. |
| Collapsing `480px`/`560px`/`600px`/`640px` → `620px` and `720px`/`768px` → `820px` causes cramped modal grids or horizontal overflow on tablet/phone | Phase 5 | Spot-check key views (`HomeScreen`, `WorldCodexTab`, `StoryModal`, `ProfileModal`, `ContextHealthModal`, `PromptRoleDeck`, `ChatStage`) at `390×844`, `620×800`, `820×900`, `1024×768`, and `1440×900`. |
| Removing `!important` on `.notes-flyout-popover` fails to override inline `style={{ left }}` on mobile | Phase 5 | Pass the desktop offset via a CSS variable (e.g., `--notes-flyout-left`) instead of direct inline `left` so `@media (max-width: 820px)` overrides it cleanly without `!important`. |
| `css:audit` falsely flags dynamic classes constructed via template literals or helper maps | Phase 1–5 | Parse TS/TSX with the TypeScript compiler API to extract both static string tokens and dynamic template prefix/suffix patterns (`prefix-${...}`), mirroring the verified audit algorithm. |

---

## 5. Acceptance Criteria & Verification Matrix

### 5.1 Quantitative Phase Targets
- **Phase 1:** `0` confirmed orphan classes; `0` undefined `@keyframes`; `0` unguarded undefined `var(--*)`; `npm --prefix frontend run css:audit` exits `0`.
- **Phase 2:** `frontend/src/styles.css` is a <= 35-line `@import` manifest; all domain files live under `frontend/src/styles/` (each <= ~1,100 lines initially); `frontend/dist/assets/*.css` builds cleanly with zero visual regressions.
- **Phase 3:** Single `:root` in `styles/00-tokens.css`; >= 70% reduction in raw hex/`rgba()` color literals outside `00-tokens.css` (<= ~250 remaining).
- **Phase 4:** 7 search input families consolidated into 1 `.ui-search-*` primitive; `.ui-pill`, `.ui-popover`, `.ui-empty-state`, `.ui-list-row` adopted; net CSS line count reduced by **>= 1,500 lines** (targeting <= ~7,800 total lines across all modular files, down from 9,717).
- **Phase 5:** Distinct `max-width` breakpoints reduced from 11 to **<= 4** canonical tiers synchronized with `campaignLayout.ts`; `!important` count reduced from 17 to **0**; `frontend/AGENTS.md` updated with styling guidelines.

### 5.2 Repository Verification Gates (Required After Every Phase)
```bash
# CSS integrity & hygiene audit (introduced in Phase 1)
npm --prefix frontend run css:audit

# Frontend architecture, production bundle & Vitest SSR suite
npm --prefix frontend run arch:check && npm --prefix frontend run build && npm --prefix frontend test

# Playwright E2E regression suite (required on Phases 2, 4, and 5; recommended on all phases)
npm --prefix frontend run typecheck:e2e && npm --prefix frontend run test:e2e

# Architecture docs check (required on Phase 2 if frontend file graph changes)
backend/.venv/bin/python scripts/generate_arch_docs.py && backend/.venv/bin/python scripts/generate_arch_docs.py --check
```
