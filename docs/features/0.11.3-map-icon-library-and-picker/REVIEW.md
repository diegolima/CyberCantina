---
feature: map-icon-library-and-picker
target_version: 0.11.3
document_type: review
status: approved
last_updated: 2026-11-15
---

# Pre-Implementation Review (`v0.11.3`)

## Architectural & Dependency Checks
- **Frontend Dependency Graph (`frontend/.dependency-cruiser.cjs`)**:
  - `mapIcons.ts` imports only from `lucide-react` (zero upward component/view imports).
  - `MapDialogs.tsx` imports `MAP_ICON_OPTIONS`, `MAP_ICON_CATEGORIES`, `filterMapIcons`, `getDefaultMapIconKey`, `getSuggestedMapIcons` from `./mapIcons` — sibling import inside `components/map/`, no circular dependencies (`MapDetailsDrawer.tsx` does NOT need to import `MapDialogs.tsx` if `SpatialTopologyView.tsx` renders `MapIconBrowserModal`, or if fallback isn't importing upwards; actually keeping `MapIconBrowserModal` in `MapDialogs.tsx` and wiring via `onOpenIconBrowser` in `SpatialTopologyView.tsx` keeps `MapDetailsDrawer` <-> `MapDialogs` completely decoupled!).
  - `worldDraftMappers.ts` (`components/world/`) importing `inferMapIconKey` from `../map/mapIcons` is clean and acyclic (`mapIcons.ts` has no `components/world/` imports).

## Edge Cases & Pitfalls Verified
1. **Lucide Export Verification**: All 125 Lucide icon components in `mapIcons.ts` were verified against `lucide-react@^0.378.0` to prevent runtime `undefined` component errors or TypeScript build breaks.
2. **Vite Tree-Shaking**: Static named imports only (`import { Anchor, ... } from "lucide-react"`); no `import * as Lucide`.
3. **Backward Compatibility**: All 31 legacy icon keys (`map-pin`, `building-2`, `git-branch`, `door-open`, `globe-2`, `layers`, etc.) retain exact keys and fallback semantics (`getDefaultMapIconKey` / `resolveMapIconComponent` invariants preserved in `mapEditor.test.tsx`).
4. **Global Keyboard Shortcut Guard (`Delete` Key)**:
   - `SpatialTopologyView.tsx` includes `iconBrowserTarget` in `hasBlockingOverlayOpen`.
   - `isEditableKeyboardTarget` (`mapGeometry.ts`) also checks `el.closest(..., [aria-modal='true'])` so focus on non-input buttons inside any modal prevents background canvas deletion.
5. **Creation vs. Placeholder Naming**:
   - Generic auto-names (`"New Location N"`, `"Junction N"`) do not match domain keywords, so they fall back cleanly to `getDefaultMapIconKey`.
   - `"<Container> Entrance"` contains `"entrance"`, resolving naturally to `"door-open"` (`Portal / Gate`), fitting container entry/exit semantics.
   - Multi-word or domain keywords (`"spaceport"`, `"cantina"`, `"cybernetics"`, `"ripperdoc"`, `"catacombs"`) are ordered before weaker substrings (`"port"`, `"bar"`) so specificity wins cleanly.
