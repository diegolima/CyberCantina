---
feature: responsive-campaign-panels
target_version: 0.17.0
document_type: review
status: completed
last_updated: 2026-11-17
---

# Pre-Implementation Review & Edge-Case Checklist
## Responsive Campaign Layout (`v0.17.0`)

1. **Backwards-Compatible Component Contracts:**
   - [`mapEditor.test.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/__tests__/mapEditor.test.tsx#L679) renders `<LiveInspector bundle={bundle} world={world} character={char} />` without layout props. All new props on `LiveInspector`, `AppSidebar`, `SidebarCategory`, and `ChatStage` remain optional with desktop defaults.
2. **Tablet Grid Pinning (`821px–1100px`):**
   - Expanding the left rail as a `position: fixed` overlay removes `.sidebar` from grid flow. Pinning `.chat-stage { grid-column: 2; }` in the tablet `@media` query keeps `.chat-stage` aligned in column 2 (`52px minmax(0, 1fr)`) with zero horizontal layout jump.
3. **Keyboard & Focus Isolation (`hidden` / `0px` Panels):**
   - Collapsed desktop `.inspector` (`0px` grid track) and closed mobile drawers use `visibility: hidden`, `pointer-events: none`, and `aria-hidden={true}` so keyboard users cannot tab into invisible controls.
4. **Z-Index & `Escape` Layering:**
   - `.drawer-backdrop` (`z-index: 39`) and `.sidebar--overlay` / `.inspector--overlay` (`z-index: 40`) stay below `.notes-flyout-popover` (`45`), `.modal-backdrop` (`50`/`70`), and `.composer-flyout-menu` (`60`).
   - `Escape` in [`useResponsiveCampaignLayout.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/hooks/useResponsiveCampaignLayout.ts) checks `!hasTopPopoverOpen` and `!document.querySelector(".modal-backdrop")` before closing the drawer.
5. **No Side Effects Inside React State Updaters:**
   - `onPanelOpened` (closing `NotesFlyout`) is invoked outside `setState` updaters to remain StrictMode-safe.
6. **Dependency Boundaries:**
   - Pure layout logic lives in [`campaignLayout.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/utils/campaignLayout.ts) (`src/utils/`), consumed by [`useResponsiveCampaignLayout.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/hooks/useResponsiveCampaignLayout.ts) (`src/hooks/`), adhering to [`.dependency-cruiser.cjs`](file:///home/diegolima/Git/cybercantina/frontend/.dependency-cruiser.cjs).
