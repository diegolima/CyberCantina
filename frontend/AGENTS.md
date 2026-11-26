# Frontend UI/UX Design Guidelines

## 1. Card Decks & Extension Trays
When designing card-based configuration decks (such as model or provider selectors):
- **In-Place Extension Morphing**: When a card features an expandable configuration/tuning tray, anchor it at the top of the summary shelf (`top: calc(100% - shelf_height)`). The tray must cover the shelf summary in-place rather than stacking below it. This eliminates redundant summary display, saves vertical viewport space, and preserves modal real estate.
- **Header Continuity**: The tray header must match the shelf's active/focused background tone (`rgba(255, 255, 255, 0.08)` or role accent tint) with an up-arrow (`ChevronUp`) retract icon, reinforcing that clicking closes/slides the drawer back up.
- **Card-Width Matching**: The tray must match the parent card width exactly (`left: -1px; right: -1px; width: calc(100% + 2px); min-width: 0; max-width: none;`), inheriting the card's accent border and bottom border-radius for a monolithic hardware silhouette.

## 2. Popover & Dropdown Alignment
- **Edge-Aware Anchoring**: In multi-column decks or near container margins, popover menus on rightmost cards must anchor inward (`align="right"` / `left: auto; right: 0;`) to prevent clipping against `overflow-y: auto` modal boundaries.
- **Stacking Context Invariant**: When a dropdown popover or tray opens, elevate the parent card's stacking context (`z-index: 100` / `.has-active-popover`). Within the card, ensure the card body sits above the bottom shelf (`z-index: 2` vs `z-index: 1`) so open selectors are never covered by subsequent sibling DOM elements.

## 3. Narrow Column Input Ergonomics
- **Single-Column Stacking**: In containers narrower than 320px (such as individual cards in a 3-column deck), numeric sliders (`NumericSliderField`) and integer inputs (`IntegerField`) must stack vertically in a single column (`flex-direction: column; gap: 12px;`). Never use multi-column grids (`grid-2`) for sliders in narrow cards, ensuring slider tracks maintain at least ~150px of draggable width alongside input boxes.

## 4. Admin and User Profile Parity
- Shared configuration surfaces (e.g., Models selection, Provider management) must use the exact same deck components for both Admin global settings and User Profile personal overrides. Handle admin locks and read-only scopes (e.g. Semantic Vectors) via props and subtle scope badges (`Monitor`, `User`, `Lock`) to eliminate design and behavioral drift.


## 5. Stylesheet Organization, Tokens & CSS Audit (`v0.29.1+`)
- **Modular Stylesheets (`frontend/src/styles/`)**: `frontend/src/styles.css` is an ordered `@import` manifest loading domain stylesheets (`00-tokens.css` → `15-responsive.css`). Add new styles to the matching domain file rather than appending to `styles.css`, and always keep `15-responsive.css` imported last.
- **Design Tokens (`00-tokens.css`)**: Prefer semantic CSS custom properties (`--surface-glass-1..4`, `--border-glass-*`, `--amber-bg`/`--amber-border`/`--amber-fg`, `--cyan-*`, `--violet-*`, `--purple-*`, `--rose-*`, `--emerald-*`, `--font-mono`, `--radius-*`, `--z-*`) over raw hex/`rgba()` color literals.
- **Shared Primitives (`02-primitives.css`)**: Reuse `.ui-search-*` / `.ui-search-bar*`, `.ui-pill` (+ tone/size modifiers), `.ui-popover`, `.ui-empty-state`, `.ui-list-row`, and `.ui-section-card` before introducing new feature-prefixed duplicates. Never merge `.model-config-flyout` into `.ui-popover`.
- **Canonical Breakpoints & Specificity**: Align responsive rules to the 3 tiers synchronized with `frontend/src/utils/campaignLayout.ts` (`@media (max-width: 620px)`, `@media (max-width: 820px)`, `@media (max-width: 1100px)` / `(min-width: 821px) and (max-width: 1100px)`), avoid `!important`, and run `npm --prefix frontend run css:audit` (enforced in CI) to catch orphan classes, undefined `@keyframes`, and unguarded `var(--*)` references.

## 6. Codex Game Mechanics & Contextual Help Deep-Links (`v0.40.0+`)
- **Canon vs. Reference Isolation**: Render `Game Mechanics` as a full-width shelf below the 3×2 `.codex-hub-grid`, separate its category pill from world categories with `.codex-pill-divider`, and partition Global Codex Search results under a dedicated `Game Mechanics (N)` divider below in-world hits (`frontend/src/components/world/mechanics/mechanicsHelpers.ts`) so system guides never outrank world lore.
- **Modal Remount & Stacking Safety**: `frontend/src/App.tsx` mounts `WorldInspectorModal` with `key={`${bundle.campaign.id}:${campaignWorldSheetTab}`}`. Jumps from inside `WorldInspectorModal` (`Map`, `World Settings`, `Major Characters`) must switch tabs internally via `handleOpenInternalMechanicsHelp` (preserving unsaved drafts and wiring `← Return to ...`) instead of mutating `campaignWorldSheetTab`. External triggers (`LiveInspector`, `ChatComposer`, `DirectorChoicesDrawer`, `ContextHealthModal`, `StoryModal`, `PartyManagementModal`, `GmTalkDrawer`, expanded map overlays) must route through `handleOpenMechanicsGuide` in `App.tsx`, closing transient overlays first so modals never stack.
- **Contextual Help Button Ergonomics (`MechanicsHelpButton`)**: Reuse `frontend/src/components/shared/MechanicsHelpButton.tsx` (`.ui-mechanics-help-btn` in `02-primitives.css`), which uses `type="button"` and calls `e.preventDefault(); e.stopPropagation()` so it is safe inside `<label>` wrappers (e.g., GM Mode). Never nest `<button>` inside another `<button>` — render `?` triggers as sibling actions (such as `InspectorSection`'s `headerAction` inside `.inspector-section-header-row` in `frontend/src/components/inspector/InspectorPrimitives.tsx`).
