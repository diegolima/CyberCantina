---
feature: responsive-campaign-panels
target_version: 0.17.0
document_type: frd
status: completed
last_updated: 2026-11-17
---

# Feature Requirements Document (FRD)
## Responsive Campaign Layout: Collapsible Side Panels & Mobile Overlay Drawers

**Status:** Completed  
**Target Version:** CyberCantina v0.17.0  
**Scope:**
- Campaign Shell & Responsive Grid/Drawer Layout ([`App.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/App.tsx), [`styles.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css))
- Left Sidebar Rail & Drawer Modes ([`AppSidebar.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/AppSidebar.tsx), [`SidebarCategory.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/SidebarCategory.tsx), [`NotesDrawer.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/NotesDrawer.tsx))
- Center Stage Header, Viewport & Composer Mobile Ergonomics ([`ChatStage.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ChatStage.tsx), [`chatHelpers.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/chatHelpers.tsx), [`ChatComposer.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/ChatComposer.tsx))
- Right Live Inspector Slide-Out & Drawer Mode ([`LiveInspector.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/LiveInspector.tsx))
- Automated Tests (`frontend/src/components/__tests__/`)

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
While CyberCantina's Home screen (`.home-grid`) and setup/model decks already include responsive `@media` breakpoints, the **active campaign workspace** is strictly desktop-fixed:

1. **Fixed 3-Column Grid Crushes Narrow Viewports:**  
   [`.studio-shell`](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L33-L38) declares `grid-template-columns: 280px 1fr 370px;` with no `@media` overrides. The left [`AppSidebar`](file:///home/diegolima/Git/cybercantina/frontend/src/components/AppSidebar.tsx) (`280px`) and right [`LiveInspector`](file:///home/diegolima/Git/cybercantina/frontend/src/components/LiveInspector.tsx) (`370px`) consume **650px** unconditionally, leaving zero usable width for [`ChatStage`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ChatStage.tsx) on phones (~360–430px) and severely squeezing prose on portrait tablets (~768px) or split-screen desktop windows.
2. **No Focus / Reclaim-Space Mode on Desktop:**  
   Even on laptops and desktop monitors, users cannot collapse [`AppSidebar`](file:///home/diegolima/Git/cybercantina/frontend/src/components/AppSidebar.tsx) (mostly out-of-session catalog/account navigation) or slide away [`LiveInspector`](file:///home/diegolima/Git/cybercantina/frontend/src/components/LiveInspector.tsx) to dedicate more screen width to reading and writing turns.
3. **Viewport, Header & Flyout Assumptions Break on Mobile Once Panels Collapse:**  
   - `body`, `.studio-shell`, and [`.chat-stage`](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L26-L326) use `height: 100vh` (`overflow: hidden` on `body`), which clips `.composer-bar` behind mobile browser chrome and soft keyboards.
   - [`.stage-header`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ChatStage.tsx#L958-L999) packs campaign title, `Close Campaign`, `Actor: Name — tagline`, location badge, and clock badge in one non-wrapping flex layout.
   - [`.notes-flyout-popover`](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L2605-L2621) hardcodes `left: 288px; width: 370px;`, which breaks whenever the left sidebar is collapsed or on narrow viewports.

### 1.2 Proposed Solution
Implement a **viewport-adaptive collapsible panel system** for campaign mode that pairs the requested desktop ergonomics (icon-rail left sidebar + full slide-out right inspector) with touch-friendly overlay drawers on small screens:

| Breakpoint | Left Pane (`AppSidebar`) | Right Pane (`LiveInspector`) | Shell Mechanism |
| :--- | :--- | :--- | :--- |
| **Desktop (`> 1100px`)** | Expanded (`280px`) by default; user-collapsible to **`52px` icon rail** | Expanded (`370px`) by default; user-collapsible to **`0px`** (full slide-out) | CSS Grid column resize (pushes `.chat-stage`) |
| **Tablet (`821px–1100px`)** | Starts collapsed as **`52px` icon rail**; expands as a left **overlay drawer** (`280px`) | Starts collapsed (**`0px`**); opens as a right **overlay drawer** (`min(370px, 92vw)`) | Fixed `52px` left rail + `1fr` stage; both expanded panes open as fixed overlay drawers with backdrop |
| **Mobile (`<= 820px`)** | **Hidden (`0px`)** by default; opens from `.stage-header` Menu button as a left **overlay drawer** (`min(300px, 85vw)`) | **Hidden (`0px`)** by default; opens from `.stage-header` Inspector toggle as a right **overlay drawer** (`min(370px, 92vw)`) | Single-column `.chat-stage` + fixed overlay drawers with backdrop |

Key design choices from pre-FRD critique:
- **No permanent `52px` left icon rail on phones (`<= 820px`):** A permanent rail wastes ~14% of a 375px screen on out-of-session catalog items and overflows vertically when the soft keyboard opens.
- **No floating mid-screen edge chevron:** Putting the Inspector toggle in `.stage-header` (with a clear icon + optional pending-change dot, and a companion collapse button inside the inspector header) avoids covering `.turn-feed` / `.user-bubble` text and avoids conflicting with mobile OS edge-swipe back/forward gestures.
- **Mobile-first `100dvh` & compact header:** Upgrade campaign shell height to `100dvh` (with `100vh` fallback) and condense `.stage-header` and composer popovers below `820px` / `620px` so the chat stage is genuinely playable on a phone.

---

## 2. Scope, Boundaries & Core Invariants

1. **Frontend-Only Scope (Zero Backend / API / Schema Changes):**
   - All changes live within `frontend/src/`. No FastAPI routes, SQLite tables, or Python schemas are modified.
2. **Home Screen Non-Regression:**
   - `.studio-shell.no-campaign` ([`HomeScreen`](file:///home/diegolima/Git/cybercantina/frontend/src/components/HomeScreen.tsx)) must remain completely unaffected.
3. **Desktop Default Preservation:**
   - On desktop (`> 1100px`) with no stored preference, both panes start expanded (`280px 1fr 370px`), preserving the current first-impression studio layout.
4. **Safe Breakpoint Initialization & Viewport Resize Invariant:**
   - Below `820px` (both panes) and `<= 1100px` (right pane), panels must **never** initialize open into a zero-width `.chat-stage`. Stored desktop `expanded` preferences must not trap a mobile viewport behind an auto-opened drawer on load or resize across breakpoints.
5. **Single Active Overlay Drawer & Z-Index Layering Invariant:**
   - When operating in overlay drawer mode, opening Left Sidebar closes Right Inspector (and vice versa), and opening either closes active composer popovers (`activePopover`).
   - Drawer & backdrop `z-index` (`~35–40`) must stay **above** `.chat-stage` / `.composer-bar` and **below** `.notes-flyout-popover` (`z-index: 45`), `.composer-popover` (`z-index: 60`), `.modal-backdrop` (`z-index: 50` / `70`), and `.auth-stage-backdrop` (`z-index: 150`) so modals launched from inside a drawer always stack cleanly on top.
6. **Backwards-Compatible Component Props:**
   - Any new props added to [`LiveInspector`](file:///home/diegolima/Git/cybercantina/frontend/src/components/LiveInspector.tsx), [`AppSidebar`](file:///home/diegolima/Git/cybercantina/frontend/src/components/AppSidebar.tsx), [`SidebarCategory`](file:///home/diegolima/Git/cybercantina/frontend/src/components/SidebarCategory.tsx), or [`ChatStage`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ChatStage.tsx) must be optional with safe defaults so existing Vitest `renderToStaticMarkup` suites (such as [`mapEditor.test.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/__tests__/mapEditor.test.tsx#L679)) continue to pass unmodified.
7. **Node-Only Vitest Compatibility:**
   - Layout breakpoint/state helpers must be extracted into pure TypeScript utilities testable in Vitest without `jsdom`, paired with `ReactDOMServer.renderToStaticMarkup` structural assertions.

---

## 3. Functional Requirements & Edge Cases

### FR-1: Responsive Shell Grid, Overlay Drawers & Viewport Mode State
**Requirement:** Replace the static 3-column `.studio-shell` layout in [`App.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/App.tsx) and [`styles.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css) with a 3-tier responsive shell (`desktop` `> 1100px`, `tablet` `821px–1100px`, `mobile` `<= 820px`).

- **Grid & Track Sizing:**
  - `.chat-stage` must have `min-width: 0` so grid content (`turn-card`, `pre`, badges, flex rows) never forces horizontal grid expansion.
  - **Desktop (`> 1100px`):**
    - Both open: `grid-template-columns: 280px minmax(0, 1fr) 370px`
    - Left collapsed: `grid-template-columns: 52px minmax(0, 1fr) 370px`
    - Right collapsed: `grid-template-columns: 280px minmax(0, 1fr) 0px`
    - Both collapsed: `grid-template-columns: 52px minmax(0, 1fr) 0px`
  - **Tablet (`821px–1100px`):**
    - Base grid: `grid-template-columns: 52px minmax(0, 1fr);` (the rail remains docked at `52px` and never pushes the stage to `280px`).
    - Expanding the left sidebar opens it as a `position: fixed; left: 0; top: 0; bottom: 0; width: 280px;` overlay drawer with `.drawer-backdrop` (dismissing returns it to the `52px` rail).
    - Opening the right inspector opens it as a `position: fixed; right: 0; top: 0; bottom: 0; width: min(370px, 92vw);` overlay drawer with `.drawer-backdrop`.
  - **Mobile (`<= 820px`):**
    - Base grid: `grid-template-columns: minmax(0, 1fr);`
    - Both left sidebar (`width: min(300px, 85vw)`) and right inspector (`width: min(370px, 92vw)`) render as `position: fixed; top: 0; bottom: 0;` slide-over drawers with smooth transform transitions and a shared translucent `.drawer-backdrop` behind the active drawer.
- **Backdrop & Dismissal:**
  - Clicking `.drawer-backdrop` or pressing `Escape` closes the active overlay drawer.
  - Pressing `Escape` must **not** close a drawer if a modal (`.modal-backdrop`) or `NotesFlyout` is currently stacked above it (or let top-most layer consume it cleanly).
  - Selecting/loading a campaign on mobile (`loadCampaignBundle`) closes the left drawer automatically so the user lands directly in the active chat.

---

### FR-2: Left Sidebar (`AppSidebar`) — Icon Rail (Desktop/Tablet) & Overlay Drawer (Mobile)
**Requirement:** Support a collapsed icon-only rail on desktop/tablet and a full-label slide-out drawer on mobile without losing access to any sidebar action.

- **Desktop/Tablet Collapsed Rail (`52px`):**
  - Header shows `Flame` brand icon (still returns to Home on click) plus a compact expand/collapse toggle (`PanelLeftClose` / `PanelLeftOpen` or chevron).
  - The 4 [`SidebarCategory`](file:///home/diegolima/Git/cybercantina/frontend/src/components/SidebarCategory.tsx) groups (`Personas`, `Characters`, `Worlds`, `Campaigns`) render as centered `40×40px` icon buttons (`UserCheck`, `Users`, `Globe`, `FolderKanban`) with `aria-label` and `title` tooltips.
    - **Decision (Expand + Open Category):** Clicking any category icon while the rail is collapsed (on either desktop or tablet) **expands the sidebar** (inline on desktop, overlay drawer on tablet) **and forces that specific category open** (via controlled/coordinated state in [`SidebarCategory`](file:///home/diegolima/Git/cybercantina/frontend/src/components/SidebarCategory.tsx) without breaking standalone usage).
  - Bottom area ([`AppSidebar.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/AppSidebar.tsx#L488-L602)) adapts cleanly to `52px`:
    - `RelaySidebarBadge`: collapses to a compact `Cpu` status dot/icon button (clickable/hoverable tooltip showing full relay/WebGPU status) when rail is collapsed.
    - `Player Notes`: icon button (`StickyNote`) with optional tiny star/count badge; toggles `NotesFlyout`.
    - `User Profile`: icon button (`User`) opening `ProfileModal`.
    - `Sign out` (when `!singleUserMode`): icon button (`LogOut`).
    - `Admin Area` (when `currentUser.role === "admin"`): icon button (`UserCog`).
- **Mobile Overlay Drawer (`<= 820px`):**
  - Renders full-width sidebar content (`280–300px` wide) with all text labels, search bars, `+ New` buttons, and bottom cards intact, plus a clear `X` close button in `.brand-header`.
  - When collapsed (`!leftDrawerOpen`), the left sidebar is hidden off-screen (`aria-hidden` / inert or unmounted/non-focusable) so keyboard/screen-reader focus cannot enter invisible rail elements.
- **`NotesFlyout` Anchoring Fix (`styles.css`):**
  - Desktop expanded sidebar: `left: 288px`.
  - Desktop collapsed rail & Tablet (`821px–1100px`): `left: 60px` (driven via `.studio-shell.sidebar-collapsed .notes-flyout-popover` or tablet breakpoint). When triggered from an expanded tablet overlay drawer, either dismiss the drawer or let `.notes-flyout-popover` (`z-index: 45`) stack cleanly above the drawer (`z-index: 40`).
  - Mobile (`<= 820px`): anchored cleanly inside the viewport (`left: 12px; right: 12px; bottom: 12px; width: auto; max-height: 75dvh;`).

---

### FR-3: Right Inspector (`LiveInspector`) — Full Slide-Out & Header-Anchored Toggle
**Requirement:** Allow [`LiveInspector`](file:///home/diegolima/Git/cybercantina/frontend/src/components/LiveInspector.tsx) to slide completely out of view (`0px` on desktop, off-screen on tablet/mobile) and re-open via a clear header control.

- **Toggle Placement (`.stage-header` + Inspector Header):**
  - Remove any dependency on a floating mid-screen edge chevron over `.turn-feed`.
  - Place the primary **Inspector toggle button** at the right end of `.stage-header` (e.g., `PanelRightOpen` / `PanelRightClose` or `Compass` + `ChevronLeft`/`ChevronRight`, with `aria-expanded`, `aria-controls="live-inspector-aside"`, and accessible label `"Toggle World & Mind Inspector"`).
  - When collapsed on desktop (`0px` grid track), [`LiveInspector`](file:///home/diegolima/Git/cybercantina/frontend/src/components/LiveInspector.tsx) must be non-interactive (`visibility: hidden` / `pointer-events: none` / `inert` or not rendered in tab order) while collapsed so keyboard users don't tab into a `0px` off-screen pane.
  - Inside `LiveInspector` (top bar or World Clock header row), include an explicit collapse/close button (`PanelRightClose` / `ChevronRight` on desktop, `X` on overlay drawer) so users can dismiss it directly from inside the panel.
- **Collapsed State Cue:**
  - If `pendingLocationOverrideId` is active while the inspector is collapsed, show a subtle amber indicator dot on the `.stage-header` Inspector toggle button so the player remembers a location override is staged.
- **Responsive Drawer Width:**
  - In overlay mode (`<= 1100px`), `.inspector` uses `width: min(370px, 92vw); max-width: 100vw;` and internal mini-map SVGs / cards remain horizontally bounded (`overflow-x: hidden`).

---

### FR-4: `ChatStage` Viewport (`100dvh`), Compact Header & Mobile Composer Ergonomics
**Requirement:** Ensure [`ChatStage`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ChatStage.tsx) remains fully readable and operable on phones (`<= 820px` and `<= 620px`) once the panels collapse.

- **Dynamic Viewport Height:**
  - Update `body`, `.studio-shell`, `.chat-stage`, and overlay drawers in [`styles.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css) from `height: 100vh` to `height: 100vh; height: 100dvh;` (and `max-height: calc(100dvh - 28px)` on flyouts) so mobile browser bars and soft keyboards do not push `.composer-bar` out of view.
- **Responsive `.stage-header` (`<= 820px` / `<= 620px`):**
  - Left cluster:
    - On `<= 820px`, render the **Left Sidebar Menu button** (`Menu` icon, `>= 36×36px` touch target) at the far left of `.stage-header`.
    - Truncate campaign title (`text-overflow: ellipsis; overflow: hidden; white-space: nowrap; min-width: 0;`).
    - Condense `Close Campaign` button text on `<= 620px` to icon-only (or compact `Home` / `Exit` button with `aria-label="Close campaign and return to Home"`).
    - Hide the `— {character.tagline}` suffix on `<= 620px` (keeping `Actor: {character.name}` readable).
  - Right cluster:
    - **Decision (Hide Badges on Narrow Phones):** On `<= 620px`, **hide** the duplicate Location and Clock badges in `.stage-header` (`display: none`) to preserve vertical/horizontal space for the title, actor name, and panel toggles (both Location and Clock remain immediately visible at the top of [`LiveInspector`](file:///home/diegolima/Git/cybercantina/frontend/src/components/LiveInspector.tsx) one tap away). Between `621px` and `1100px`, keep them visible and compact alongside the Inspector toggle.
- **Turn Feed & Composer Mobile Polish (`<= 620px`):**
  - Reduce `.turn-feed` horizontal padding (`padding: 14px 12px` vs `20px 26px`) and allow `.user-bubble` `max-width: 92%` so prose has comfortable line length on 375px screens.
  - Ensure [`ChatComposer`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/ChatComposer.tsx) button rows wrap cleanly (`flex-wrap: wrap`) and composer popovers clamp inside `max-width: calc(100vw - 24px)`.

---

### FR-5: State Persistence, Accessibility & Reduced-Motion Support
**Requirement:** Persist desktop panel preferences reliably without breaking responsive transitions or keyboard accessibility.

- **Persistence:**
  - Persist desktop collapse preferences under `cybercantina.layout.sidebarCollapsed` and `cybercantina.layout.inspectorCollapsed` (reusing the `localStorage` safety pattern from [`InspectorPrimitives.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/inspector/InspectorPrimitives.tsx#L10-L33)).
  - Use a viewport-tier hook/helper (`desktop` / `tablet` / `mobile` via `matchMedia` listeners matching `1100px` and `820px` breakpoints) so:
    - Desktop reads/writes persisted collapse state.
    - Tablet starts with left rail collapsed (`sidebarCollapsed` or rail-only) and right drawer closed.
    - Mobile starts with **both drawers closed**; toggling drawers on mobile mutates transient drawer state rather than overwriting the user's desktop preferences.
- **Accessibility:**
  - All panel toggle buttons have `type="button"`, `aria-expanded`, `aria-controls`, and descriptive `aria-label`s.
  - Respect `@media (prefers-reduced-motion: reduce)` for drawer/grid slide transitions.

---

## 4. Out of Scope (Deferred)
The following items are intentionally excluded from `v0.17.0` to keep this feature small, low-risk, and fast to ship:
1. Touch-gesture overhaul for [`SpatialTopologyView`](file:///home/diegolima/Git/cybercantina/frontend/src/components/SpatialTopologyView.tsx) (pinch-to-zoom, touch node dragging).
2. Mobile-optimized redesigns of full-screen/large entity modals (`CharacterInspectorModal`, `WorldInspectorModal`, `WizardModals`, `PromptPresetsManager`).
3. Edge-swipe gestures to pull open drawers (omitted intentionally to avoid conflicting with iOS/Android Safari/Chrome back/forward navigation gestures).

---

## 5. Resolved Design Decisions

1. **Rail Category Icon Click (`FR-2`):** Clicking a category icon on the collapsed `52px` rail expands the sidebar **and** opens that clicked category.
2. **Tablet (`821px–1100px`) Left Expansion (`FR-1`, `FR-2`):** Expanding the left rail on tablet opens it as a **fixed overlay drawer** (`280px` + backdrop) rather than pushing the grid, keeping `.chat-stage` width stable.
3. **Narrow Phone (`<= 620px`) Header Badges (`FR-4`):** The Location and Clock badges in [`.stage-header`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ChatStage.tsx#L989-L998) are **hidden** below `620px` (accessible via the Inspector drawer).
