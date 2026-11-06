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
