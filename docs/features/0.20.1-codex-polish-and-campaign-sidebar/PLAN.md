# Execution Plan — Codex Locations Polish & Campaign Left Sidebar (`v0.20.1`)

**Version Target:** `v0.20.1`  
**Feature Spec:** [FRD.md](file:///home/diegolima/Git/cybercantina/docs/features/0.20.1-codex-polish-and-campaign-sidebar/FRD.md)

## Implemented Architecture & Steps

1. **Spoiler-Safe `localLoreCount` & Reactive Roster Helper ([`codexHelpers.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/codexHelpers.ts)):**
   - Extend `CodexLocationTreeNode` with `localLoreCount: number` (`getVisibleScopedLore(loc.lore_nodes, isCampaignMode).length` for locations, `getVisibleScopedLore(cont.lore_nodes, isCampaignMode).length` for `depth === 1` containers, `0` for `depth >= 2` containers).
   - Extract `buildCampaignCharacterEntries(bundle, primaryCharacter, participants)` so both `LiveInspector` and the lifted `WorldInspectorModal` share identical reactive participant resolution.

2. **Decluttered Codex `Locations` Tree ([`WorldCodexTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldCodexTab.tsx), [`styles.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css)):**
   - Remove `L1`–`L4` badges from left-pane tree rows (`renderLocationTreeNode`) while retaining `L{container.depth} · {Label}` in `CodexLocationDetail` and `Area L{depth}` in flat search hits.
   - Pair `<Layers size={12} color="var(--accent-cyan)" />` beside container expand chevrons symmetrically with `<MapPin size={12} color="var(--accent-cyan)" />` on leaf locations.
   - Render `.codex-lore-indicator` (`<BookOpen size={11} />` with accessible title/aria-label) whenever `node.localLoreCount > 0`.

3. **Campaign-Focused Left Sidebar & Header Cleanup ([`AppSidebar.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/AppSidebar.tsx), [`RelaySidebarBadge.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/RelaySidebarBadge.tsx), [`ChatStage.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/ChatStage.tsx), [`campaignLayout.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/utils/campaignLayout.ts), [`useResponsiveCampaignLayout.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/hooks/useResponsiveCampaignLayout.ts)):**
   - Extract `RelaySidebarBadge` to its own module and delete obsolete `SidebarCategory.tsx`, `SidebarCategoryKey`, and `expandedCategories` layout plumbing.
   - Replace the 4 legacy catalog accordions/rail categories in `AppSidebar` with an active campaign summary block, `Close Campaign` button (`ArrowLeft` icon, separated from `Sign out` `LogOut`), and an extensible `Campaign Tools` nav list beginning with **`Codex`** (`BookOpen` icon, lore badge, active highlight), mirrored in collapsed `rail` mode.
   - Remove the inline `.btn-close-campaign` button from `ChatStage.tsx`, `onCloseCampaign` from `ChatStageProps`, and `.btn-close-campaign*` rules from `styles.css`.

4. **Lifted Campaign World Sheet / Codex Modal ([`App.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/App.tsx), [`LiveInspector.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/LiveInspector.tsx)):**
   - Own `campaignWorldSheetTab: WorldTab | null` at root level in `App.tsx`, resetting to `null` on campaign close, campaign switch, or active campaign deletion.
   - Mount the single campaign `<WorldInspectorModal>` in `App.tsx` (outside `LiveInspector`'s `display: none` collapsed container) triggered from `AppSidebar` **Codex** (`"codex"`) or `LiveInspector`'s **World Sheet** button (`"base"`).

5. **Verification & Documentation:**
   - Update [`worldCodex.test.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/__tests__/worldCodex.test.tsx) and [`responsiveCampaignPanels.test.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/__tests__/responsiveCampaignPanels.test.tsx).
   - Verify via `arch:check`, `build`, `vitest`, and `generate_arch_docs.py --check`.
