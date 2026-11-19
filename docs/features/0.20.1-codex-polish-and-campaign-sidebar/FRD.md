---
feature: codex-polish-and-campaign-sidebar
target_version: 0.20.1
document_type: frd
status: completed
last_updated: 2026-11-19
---

# Feature Requirements Document (FRD)
## Codex Locations Polish & Campaign-Scoped Left Sidebar (`Codex` + `Close Campaign`)

**Status:** Completed  
**Target Version:** CyberCantina v0.20.1  
**Depends On:** `0.17.0-responsive-campaign-panels`, `0.20.0-world-codex`  
**Scope:**
- **Backend / Schemas / API:** No changes required (`WorldRecord` and `CampaignStateBundle` already provide all required world lore, location/container lore, and campaign cast data).
- **Frontend Codex Tree & Detail Views:** [`codexHelpers.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/codexHelpers.ts), [`WorldCodexTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldCodexTab.tsx), [`CodexLocationDetail.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/CodexLocationDetail.tsx)
- **Frontend Campaign Sidebar, Stage Header & Layout State:** [`AppSidebar.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/AppSidebar.tsx), [`SidebarCategory.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/SidebarCategory.tsx), [`ChatStage.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ChatStage.tsx), [`chatHelpers.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/chatHelpers.tsx), [`LiveInspector.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/LiveInspector.tsx), [`App.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/App.tsx), [`useResponsiveCampaignLayout.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/hooks/useResponsiveCampaignLayout.ts), [`campaignLayout.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/utils/campaignLayout.ts), [`styles.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css)
- **Automated Tests:** [`worldCodex.test.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/__tests__/worldCodex.test.tsx), [`responsiveCampaignPanels.test.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/__tests__/responsiveCampaignPanels.test.tsx)

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
1. **No At-a-Glance Local Lore Cue in Codex `Locations`:**
   - In [`WorldCodexTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldCodexTab.tsx#L610-L680), rows inside the `Locations` hierarchical tree only show name, `Current`/`Start`/`Hub` badges, or `L1–L4` container depth badges—giving no indication of which locations or `depth === 1` containers actually hold attached local lore without clicking every item.
2. **Cluttered `L1–L4` Pills in the Hierarchical Tree:**
   - Because containers are already visually nested via chevron toggles and horizontal indentation (`paddingLeft: 8 + depthIndent * 14`), showing `L1`–`L4` badges on every container row clutters the narrow left pane and truncates long container names prematurely. Meanwhile, the right pane ([`CodexLocationDetail.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/CodexLocationDetail.tsx#L211-L214)) already shows the full `L{depth} · {CONTAINER_DEPTH_LABELS[depth]}` badge.
3. **Legacy Catalog Accordions & Hidden `Close Campaign` in Campaign Mode:**
   - [`AppSidebar.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/AppSidebar.tsx#L300-L690) still renders four global catalog accordions (`Personas`, `Characters`, `Worlds`, `Campaigns`) left over from before the Home screen existed—creating confusion between editing global master templates vs. inspecting the active campaign's frozen snapshot while consuming sidebar space needed for campaign-specific tools (starting with **Codex**, and paving the way for future **Player Inventory** and **Party** panels).
   - Simultaneously, **`Close Campaign`** lives inside the [`ChatStage.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ChatStage.tsx#L987-L998) header next to the campaign title (where it competes for space and hides its text label on mobile), while **`Codex`** has no direct left-pane shortcut and can only be reached through the right inspector's `World Sheet` button.

### 1.2 Proposed Solution
1. **Local Lore Indicator Icon in `Locations` Tree (`FR-1`):**
   - Compute `localLoreCount` per tree node strictly via `getVisibleScopedLore(..., isCampaignMode)` (preventing hidden `secret` lore leaks in campaigns and never rolling up child lore onto `L2–L4` containers), and display a compact `BookOpen` icon beside any location or Level 1 container that has visible local lore.
2. **Decluttered Hierarchical Tree (`FR-2`):**
   - Remove the `L1`–`L4` pills from left-pane tree rows (`WorldCodexTab.tsx`) while adding a subtle `Layers` icon next to container chevrons so containers (including empty ones) remain visually distinct from `MapPin` leaf locations. Keep the full `L{depth} · {CONTAINER_DEPTH_LABELS[depth]}` badge in `CodexLocationDetail.tsx` and keep `Area L{depth}` pills in flat Global Search results.
3. **Campaign-Focused Left Sidebar (`FR-3`):**
   - Replace the four legacy catalog accordions (`Personas`, `Characters`, `Worlds`, `Campaigns`) and their 4 rail buttons in [`AppSidebar.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/AppSidebar.tsx) with a clean, extensible **Campaign** navigation section featuring **`Codex`** (and structured for upcoming *Player Inventory* / *Party* entries) plus a prominent **`Close Campaign`** action moved out of [`ChatStage.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ChatStage.tsx).
4. **Lifted Campaign World Sheet / Codex Modal (`FR-4`):**
   - Lift campaign `WorldInspectorModal` open/tab state out of [`LiveInspector.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/LiveInspector.tsx#L122) into [`App.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/App.tsx) so clicking **`Codex`** in `AppSidebar` opens the single shared campaign `WorldInspectorModal` directly on `initialTab="codex"` even when the right-pane `LiveInspector` is collapsed or hidden.

---

## 2. Scope, Boundaries & Core Invariants

1. **Frontend-Only Change:**
   - Zero backend Python, SQLite schema, or REST API modifications.
2. **Spoiler-Safe Local Lore Icon Invariant:**
   - In `mode === "campaign"`, `localLoreCount` on `CodexLocationTreeNode` **must** count only entries returned by [`getVisibleScopedLore(node.lore_nodes, true)`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/codexHelpers.ts) (`category !== "secret"`). A room or Level 1 container whose *only* lore is `category === "secret"` must show **no** lore icon in campaign mode so players are never tipped off to undiscovered secrets.
   - `depth >= 2` containers cannot hold direct lore and **must** always have `localLoreCount === 0` (never aggregate child counts onto parent containers).
3. **Container vs. Location Legibility Without `L1–L4` Pills:**
   - Removing `L1–L4` pills applies **only** to the hierarchical `Locations` tree in `WorldCodexTab.tsx`.
   - Containers in the tree must display a subtle `Layers` icon alongside their chevron toggle so empty containers remain visually distinct from `MapPin` leaf locations.
   - [`CodexLocationDetail.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/CodexLocationDetail.tsx) keeps `L{container.depth} · {CONTAINER_DEPTH_LABELS[depth]}` in the right pane, and flat `isGlobalSearchMode` rows keep `Area L{depth}` badges since there is no tree indentation there.
4. **Lifted Campaign Modal Visibility Invariant:**
   - Because `.inspector--hidden` hides the right-pane `LiveInspector` subtree with `display: none` when collapsed on desktop or closed on tablet/mobile, rendering `WorldInspectorModal` inside `LiveInspector` would prevent the left-pane **`Codex`** button from displaying the modal when the right pane is hidden.
   - Lifting campaign `WorldInspectorModal` state (`campaignWorldSheetTab: WorldTab | null`) to [`App.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/App.tsx) ensures **one** modal instance serves both left-pane `Codex` (`"codex"`) and right-pane `World Sheet` (`"base"`), regardless of right-panel collapse state.
5. **Distinct Action Iconography (`Close Campaign` vs. `Sign out`):**
   - `Close Campaign` in `AppSidebar` must use `Home` or `ArrowLeft` (never `LogOut`) so it cannot be confused with account **`Sign out`** (`LogOut`) in either expanded or collapsed icon-rail modes.
6. **Preserved Bottom Utility Dock & Responsive Modes:**
   - Keep [`RelaySidebarBadge`](file:///home/diegolima/Git/cybercantina/frontend/src/components/SidebarCategory.tsx), Player Notes flyout (`showNotesFlyout`), User Profile, Sign out (when `!singleUserMode`), and Admin Area (when `currentUser.role === "admin"`) across all four [`LeftPanelMode`](file:///home/diegolima/Git/cybercantina/frontend/src/utils/campaignLayout.ts#L9) values (`expanded`, `rail`, `overlay`, `hidden`), while cleanly removing obsolete catalog-accordion plumbing (`SidebarCategoryKey`, `expandedCategories`, `setCategoryExpanded`, `expandSidebarToCategory`).

---

## 3. Functional Requirements

### FR-1: Local Lore Indicator Icon in Codex `Locations` Tree

1. **Pure Helper Count ([`codexHelpers.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/codexHelpers.ts)):**
   - Extend `CodexLocationTreeNode` with `localLoreCount: number`:
     - For `LocationNode`: `getVisibleScopedLore(loc.lore_nodes, isCampaignMode).length`.
     - For `LocationContainer` with `cont.depth === 1`: `getVisibleScopedLore(cont.lore_nodes, isCampaignMode).length`.
     - For `LocationContainer` with `cont.depth >= 2`: strictly `0`.
2. **Tree Row Indicator ([`WorldCodexTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldCodexTab.tsx)):**
   - Inside `renderLocationTreeNode`, when `node.localLoreCount > 0`, render a small `BookOpen` icon (`size={11}`, `color="var(--text-muted)"` or subtle violet accent, `aria-label` + `title` reading `"{N} local lore entry"` / `"{N} local lore entries"`).
   - Place the icon unobtrusively beside the node name/meta row without wrapping or clipping long location titles.

---

### FR-2: Decluttered `Locations` Hierarchical Tree Without `L1`–`L4` Pills

1. **Remove `L{depth}` Pills from Tree Rows ([`WorldCodexTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldCodexTab.tsx)):**
   - Remove `<span className="badge codex-badge--location">L{node.depth}</span>` from `renderLocationTreeNode`.
   - Keep `Current`, `Start`, and `Hub` badges on `LocationNode` rows.
2. **Distinguish Containers Visually via `Layers` Icon:**
   - For `node.kind === "container"`, render the expand/collapse chevron button followed by a subtle `<Layers size={12} color="var(--accent-cyan)" />` icon before `node.name`, pairing symmetrically with `<MapPin size={12} color="var(--accent-cyan)" />` on locations.
3. **Preserve Depth Context Elsewhere:**
   - [`CodexLocationDetail.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/CodexLocationDetail.tsx#L211-L214) continues rendering `L{container.depth} · {CONTAINER_DEPTH_LABELS[container.depth]}` in the right-pane header.
   - `searchAllCodexEntries` continues emitting `badgeLabel: "Area L{depth}"` in flat Global Search rows.

---

### FR-3: Campaign-Focused Left Sidebar (`AppSidebar`), `Codex` Entry & Relocated `Close Campaign`

1. **Remove Legacy Catalog Accordions & Plumbing:**
   - In [`AppSidebar.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/AppSidebar.tsx):
     - Remove the 4 `SidebarCategory` accordions (`Personas`, `Characters`, `Worlds`, `Campaigns`) from the expanded/overlay sidebar and the 4 `railCategories` buttons from `mode === "rail"`.
     - Remove obsolete catalog props from `AppSidebarProps` (`personas`, `characters`, `worlds`, `campaigns`, `campaignActiveWorldId`, `campaignActivePersonaId`, `campaignActiveCharacterIds`, `expandedCategories`, `onToggleCategory`, `onExpandToCategory`, `setEditingPersona`, `setShowPersonaModal`, `setShowCharWizard`, `setShowWorldWizard`, `setShowNewCampaignModal`, `handleRequestDelete*`, `handleSelect*`, `loadCampaignBundle`).
   - Remove unused `SidebarCategoryKey`, `expandedCategories`, `setCategoryExpanded`, and `expandSidebarToCategory` from [`campaignLayout.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/utils/campaignLayout.ts) and [`useResponsiveCampaignLayout.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/hooks/useResponsiveCampaignLayout.ts) (verify `SidebarCategory.tsx` is only kept if `RelaySidebarBadge` stays there, or move `RelaySidebarBadge` into a dedicated/shared component and remove unused `SidebarCategory`).
2. **New Campaign Navigation Section in `AppSidebar`:**
   - **Expanded / Overlay Mode:**
     - **Campaign Summary Card / Header:** Shows active campaign name (`bundle.campaign.name`) and world name (`worldName`, optional prop from `campaignWorld?.name`), plus a full-width, easy-to-spot **`Close Campaign`** button (`ArrowLeft` or `Home` icon, clearly labeled `"Close Campaign"`, `title="Close campaign and return to Home"`) directly below or inside the campaign header.
     - **`Campaign Tools` Navigation List:** Styled as a vertical nav list (`role="navigation"`, `aria-label="Campaign tools"`) designed for future expansion (upcoming *Inventory*, *Party*, etc.), starting with:
       - **`Codex`** button (`BookOpen` icon, label `"Codex"`, optional world lore count pill, active highlight when Codex is open) calling `onOpenCodex()` and `onCloseOverlay?.()`.
   - **Collapsed Rail Mode (`mode === "rail"`):**
     - Top header: `Flame` Home/Close Campaign button + Expand button (`PanelLeftOpen`).
     - Middle `<nav className="rail-categories" aria-label="Campaign tools">`:
       - **`Codex`** icon button (`BookOpen`, `aria-label="Open Campaign Codex"`, `title="Open Campaign Codex"`) calling `onOpenCodex()`.
       - **`Close Campaign`** icon button (`Home` or `ArrowLeft`, `aria-label="Close campaign and return to Home"`, `title="Close campaign and return to Home"`) calling `handleCloseCampaign()`. *(Or keep `Flame` as brand return + dedicated `ArrowLeft`/`Home` rail action for clarity.)*
     - Bottom utility dock: `RelaySidebarBadge`, Notes button, Profile button, Sign out button (when `!singleUserMode`), Admin button (when `currentUser.role === "admin"`).
3. **Remove `Close Campaign` from [`ChatStage.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ChatStage.tsx):**
   - Remove the inline `<button className="btn btn-sm btn-close-campaign">` from `ChatStage`'s `.stage-title-row` ([lines 987–998](file:///home/diegolima/Git/cybercantina/frontend/src/components/ChatStage.tsx#L987-L998)) and clean up `onCloseCampaign` from `ChatStageProps` / [`chatHelpers.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/chat/chatHelpers.tsx#L60) / [`App.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/App.tsx#L710) and unused `.btn-close-campaign*` rules in [`styles.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L5165).

---

### FR-4: Lifted Campaign World Sheet / Codex Modal State (`App.tsx` & `LiveInspector.tsx`)

1. **State Ownership in [`App.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/App.tsx):**
   - Add `const [campaignWorldSheetTab, setCampaignWorldSheetTab] = useState<WorldTab | null>(null);`.
   - Reset `setCampaignWorldSheetTab(null)` inside `handleCloseCampaign` (and whenever active campaign changes / `bundle === null`).
   - Pass `onOpenCodex={() => { setCampaignWorldSheetTab("codex"); layout.closeOverlays(); }}` and `isCodexOpen={campaignWorldSheetTab === "codex"}` to `AppSidebar`.
   - Pass `onOpenWorldSheet={() => setCampaignWorldSheetTab("base")}` to [`LiveInspector.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/LiveInspector.tsx) (removing `showWorldSheet` local state and the nested `<WorldInspectorModal>` from `LiveInspector.tsx` so there is only **one** campaign `WorldInspectorModal` rendered directly inside `App.tsx` when `bundle && campaignWorld && campaignWorldSheetTab !== null`).
2. **Shared Reactive Campaign Roster Helper:**
   - Extract the `characterRows` / `codexCampaignCharacters` derivation from [`LiveInspector.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/LiveInspector.tsx#L173-L237) into a pure shared helper (e.g., in `codexHelpers.ts` or `campaignLayout.ts` / `world/`) so both `LiveInspector` and `App.tsx`'s lifted `WorldInspectorModal` compute the exact same `CodexCampaignCharacterEntry[]` (`record`, `state`, `isPresent`, `elsewhereLocationName`, `isPrimary`) from `bundle`, `campaignCharacter`, and `participants`—keeping future mid-campaign character additions/removals 100% reactive.
   - Pass `initialTab={campaignWorldSheetTab}` (with a `key` or `useEffect` sync if `campaignWorldSheetTab` can change while closed, since the modal unmounts when `campaignWorldSheetTab === null`) along with `activePersona`, `campaignId`, `activeLocationId`, `visitedContainerIds`, `campaignWorldSettings`, `isMutatingLocked`, and `onSaveCampaignWorldSettings` on `WorldInspectorModal`.

---

## 4. Acceptance Criteria & Verification Matrix

1. **Codex `Locations` Tree Polish:**
   - `buildCodexLocationTree` sets `localLoreCount` accurately for `LocationNode`s and `depth === 1` `LocationContainer`s, returns `0` for `depth >= 2` containers, and excludes `category === "secret"` entries in `mode === "campaign"`.
   - `WorldCodexTab` `Locations` tree renders the `BookOpen` local-lore indicator when `localLoreCount > 0`, hides it when a campaign location/container has only `secret` lore, omits `L1`–`L4` badges from left-pane tree rows, and renders `Layers` on containers alongside `MapPin` on locations.
   - `CodexLocationDetail` continues displaying `L{depth} · {CONTAINER_DEPTH_LABELS[depth]}` in the right pane, and Global Search continues displaying `Area L{depth}`.
2. **Campaign Sidebar & Lifted Codex Modal:**
   - `AppSidebar` no longer renders `Personas`, `Characters`, `Worlds`, or `Campaigns` lists or rail buttons; renders `Codex` and `Close Campaign` (distinct from `Sign out` `LogOut`) across `expanded`, `overlay`, and `rail` modes while preserving Notes, Relay badge, Profile, Sign out, and Admin controls.
   - `ChatStage` header no longer renders `.btn-close-campaign` / `"Close Campaign"`.
   - Clicking `Codex` in `AppSidebar` opens the campaign `WorldInspectorModal` on the `Codex` tab even when `LiveInspector` is hidden/collapsed (`mode === "hidden"`), and `WorldInspectorModal` opens on `Base` when triggered from `LiveInspector`'s `World Sheet` button.
3. **Frontend & Architecture Checks:**
   - `npm --prefix frontend run arch:check && npm --prefix frontend run build && npm --prefix frontend test` pass (including updated tests in `worldCodex.test.tsx` and `responsiveCampaignPanels.test.tsx`).
   - `backend/.venv/bin/python scripts/generate_arch_docs.py && backend/.venv/bin/python scripts/generate_arch_docs.py --check` passes (if any module imports/edges changed).
