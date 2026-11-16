---
feature: strict-entry-exit-portal-badges
target_version: 0.11.5
document_type: frd
status: approved
last_updated: 2026-11-16
---

# Feature Requirements Document (FRD)
## Strict Entry/Exit Portal Badges (Marked Nodes Only)

**Status:** Approved  
**Target Version:** CyberCantina v0.11.5  
**Scope:**
- Frontend Portal Resolution & Projection ([`topologyProjection.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/topologyProjection.ts))
- Frontend Map Canvas, Drawer & Mini-Map Consumers ([`SpatialTopologyCanvas.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/SpatialTopologyCanvas.tsx), [`MapDetailsDrawer.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDetailsDrawer.tsx), [`LiveInspector.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/LiveInspector.tsx), [`InspectorLocationCard.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/inspector/InspectorLocationCard.tsx))
- Backend Campaign Bundle Portal Hydration ([`turns.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/turns.py))
- Frontend & Backend Tests (`frontend/src/components/__tests__/locationContainers.test.tsx`, `frontend/src/components/__tests__/mapEditor.test.tsx`, `backend/tests/test_location_containers.py`)

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
1. **Unmarked Locations Display Portal Badges When Connected Across Container Boundaries:**
   - Currently, [`computeDynamicPortalIds`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/topologyProjection.ts#L310-L336) adds **both** endpoints of any cross-container edge (`cFrom !== cTo`, provided `container_id !== null`) to `dynamicPortalIds`—even when `loc.is_entry_exit` is `false`.
   - In multi-level worlds such as *The Green Lie*, locations inside a Depth-3 district container (`Sector 9: The Drain`) such as *The Chop-Cathedral*, *The Green-Sump*, and *The Cage-Walk* have `is_entry_exit = 0`, yet connect to child Depth-1 sub-containers (`The Neon Rust`, `Sewers`, `The Caissons`). Because `cFrom !== null`, the map canvas and mini-map falsely stamp those district locations with the cyan `DoorOpen` portal badge.
2. **Inspector UI Contradicts Itself on Unmarked Cross-Boundary Nodes:**
   - In [`MapDetailsDrawer`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDetailsDrawer.tsx#L1225-L1509), `isPortal` reads `dynamicPortalIds.has(selectedLocation.id)` (`true` → renders `[Entry/Exit Portal]` badge), while the **Entry/Exit Portal** editor checkbox reads `Boolean(selectedLocation.is_entry_exit)` (`false` → appears unchecked).
3. **Campaign Hydration Re-Synthesizes `is_entry_exit = True` on Base World Edges:**
   - In [`get_campaign_state_bundle`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/turns.py#L994-L1014), the backend loops over *every* active edge (`world_filtered.edges`, including static base-world edges where `created_at_turn_id is None`) and mutates `loc.is_entry_exit = True` in memory for both ends of any `from_cont != to_cont` edge.
   - As a result, fixing only the frontend function would fix the **World Editor**, but **Campaign View** (`LiveInspector` + Campaign Map) would still receive mutated `is_entry_exit: true` payloads from the backend for *The Chop-Cathedral*, *The Green-Sump*, and *The Cage-Walk*.

### 1.2 Proposed Solution
Make portal badge rendering and portal status **strictly reflect explicit entry/exit designations** (`is_entry_exit === true` on containerized locations), while keeping edge-driven graph visualization (ghost nodes, `↗ External Exit` chips, aggregated container edges) intact:
1. **Strict Marked-Portal Semantics in Frontend Projection (`FR-1`):** Update [`computeDynamicPortalIds`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/topologyProjection.ts#L310-L336) to derive `dynamicPortalIds` solely from explicitly marked locations (`Boolean(loc.container_id && loc.is_entry_exit)`), removing edge-based portal inference on unmarked nodes.
2. **Remove Dynamic Portal Synthesis From Backend Campaign Bundles (`FR-2`):** Remove the `cross_boundary_loc_ids` auto-promotion loop completely from [`get_campaign_state_bundle`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/turns.py#L994-L1014) so effective `is_entry_exit` values in campaigns come strictly from `location_nodes.is_entry_exit` and explicit `campaign_location_overrides.is_entry_exit` (never synthesized from edges).
3. **Preserve Edge-Based Cross-Boundary Navigation & Promotion Safeguards (`FR-3`):** Confirm that ghost nodes/edges, `↗ External Exit` indicators, container-to-container edge aggregation, [`computePromotionCandidates`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/topologyProjection.ts#L763-L793), and manual **Entry/Exit Portal** toggling in [`MapDetailsDrawer`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDetailsDrawer.tsx#L1484-L1509) remain unaffected or become more accurate, with zero database schema or data migrations.

---

## 2. Scope, Boundaries & Core Invariants

1. **Badge Source of Truth (`is_entry_exit` Only):**
   - A location displays the cyan `DoorOpen` portal diamond badge on [`SpatialTopologyCanvas`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/SpatialTopologyCanvas.tsx#L1089-L1105), the `[Entry/Exit Portal]` badge in [`MapDetailsDrawer`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDetailsDrawer.tsx#L1295-L1306), the `[Portal]` tag in [`PortalPromotionModal`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/PortalPromotionModal.tsx#L162) / [`EmptyCanvasCreateModal`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDialogs.tsx), and the mini-map Portal indicators in [`InspectorLocationCard`](file:///home/diegolima/Git/cybercantina/frontend/src/components/inspector/InspectorLocationCard.tsx#L217-L433) **if and only if** `loc.container_id != null && Boolean(loc.is_entry_exit)`.
   - Uncontained root-level locations (`container_id == null`) never show a portal badge.
2. **Ghost Nodes & Cross-Boundary Connections Unchanged:**
   - [`projectTopologyForDepth`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/topologyProjection.ts#L499-L534) builds `externalPortalsByLocationId`, `ghostExternalNodes`, and `ghostEdges` from **actual edges** crossing the visible container scope (`fromVis && !toVis`), NOT from `dynamicPortalIds`. Removing edge-based inference from `dynamicPortalIds` will **not** hide ghost portals, dashed cross-boundary edges, or `↗ Destination` labels.
3. **Zero Database Migration Required:**
   - Existing `location_nodes.is_entry_exit` (`0 | 1`) and `campaign_location_overrides.is_entry_exit` columns already represent explicit entry/exit status. No schema change is required.
4. **Backwards-Compatible Function Signatures:**
   - Keep `computeDynamicPortalIds(locations, edges?)` exported cleanly so callers ([`projectTopologyForDepth`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/topologyProjection.ts#L356), [`LiveInspector`](file:///home/diegolima/Git/cybercantina/frontend/src/components/LiveInspector.tsx#L299), and existing tests) remain call-compatible without churn across unrelated files.

---

## 3. Functional Requirements

### FR-1: Frontend Portal Set Derived Strictly From `is_entry_exit`

- Update [`computeDynamicPortalIds`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/topologyProjection.ts#L310-L336):
  - Include `loc.id` **only** when `Boolean(loc.container_id && loc.is_entry_exit)`.
  - Remove the `edges` loop that added endpoints whenever `cFrom !== cTo`.
- Resulting UI behavior across all map views:
  - [`SpatialTopologyCanvas`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/SpatialTopologyCanvas.tsx#L906): Only marked `is_entry_exit` nodes render the cyan `DoorOpen` diamond badge. In *The Green Lie*, *The Chop-Cathedral*, *The Green-Sump*, and *The Cage-Walk* no longer show the badge unless explicitly toggled on; true marked gates/doors (*Main Floor*, *The Sluice*, *The Mid-Web*, *Tunnel 1-M*, etc.) keep theirs.
  - [`MapDetailsDrawer`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDetailsDrawer.tsx#L1225-L1508): Top `[Entry/Exit Portal]` badge and the `Entry/Exit Portal` checkbox always match 1:1.
  - [`LiveInspector`](file:///home/diegolima/Git/cybercantina/frontend/src/components/LiveInspector.tsx#L298) / [`InspectorLocationCard`](file:///home/diegolima/Git/cybercantina/frontend/src/components/inspector/InspectorLocationCard.tsx#L217-L433): Mini-map diamond badge and `[Portal]` pill reflect marked entry/exit nodes only.
  - **Container Supernode Subtitle & Gateway Fallback** ([`topologyProjection.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/topologyProjection.ts#L424-L445) & [`resolveNodeConnectionEndpoint`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/useTopologyMutations.ts#L70)):
    - `externalPortalsCount` counts descendants with `is_entry_exit === true` inside the container.
    - If a container has 0 marked portals, `representativePortalLocationId` and `resolveNodeConnectionEndpoint` fall back gracefully to `descendants[0]?.id ?? null` / `inside[0] ?? null` as today.

### FR-2: Remove Dynamic Portal Synthesis From Backend Campaign Bundles

- Remove the `cross_boundary_loc_ids` auto-promotion loop completely from [`get_campaign_state_bundle`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/turns.py#L994-L1014):
  - Neither static base-world edges (`created_at_turn_id is None`) nor branch-turn edges (`created_at_turn_id is not None`) mutate `loc.is_entry_exit = True` in memory during bundle hydration.
  - Campaign portal flags reflect **only** persisted `location_nodes.is_entry_exit` values overlaid with explicit `campaign_location_overrides.is_entry_exit` entries (saved via the Campaign Map Editor / `update_campaign_map`), leaving [`connect_campaign_locations`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/campaign_spatial.py#L137) free of implicit portal side effects and updating [test_location_containers.py](file:///home/diegolima/Git/cybercantina/backend/tests/test_location_containers.py#L755-L774) accordingly.

### FR-3: Promotion & Authoring Flows Remain Intact

- **Level 1 Cross-Boundary Promotion Prompt:**
  - [`computePromotionCandidates`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/topologyProjection.ts#L763-L793) continues prompting users to promote Level 1 interior nodes (`depth === 1 && !loc.is_entry_exit`) to `is_entry_exit = true` when linking across container boundaries.
  - Because `dynamicPortalIds` no longer falsely counts an unmarked Level 1 node as already-a-portal, even nodes with pre-existing legacy edges accurately show up as promotable when linked.
- **Explicit Author Control for Any Container Depth:**
  - Users can still check/uncheck **Entry/Exit Portal** in [`MapDetailsDrawer`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDetailsDrawer.tsx#L1484-L1509) for any location with `container_id != null` (including Depth 2–4 district/city gates like *The Sluice* in *Sector 9*).

---

## 4. Edge Cases & Constraints

1. **Container-to-Child Descent vs. Outward Portal (`Sector 9: The Drain` Case):**
   - Under `FR-1` + `FR-2`, *The Chop-Cathedral* (`Sector 9`) linking to *Main Floor* (`The Neon Rust` inside `Sector 9`) keeps *Main Floor* as `[Entry/Exit Portal]` (`is_entry_exit = 1`) and *The Chop-Cathedral* as a normal location (`is_entry_exit = 0`) with no portal diamond badge.
2. **Checking `PortalPromotionModal` During Existing-Location or Container Linking:**
   - When connecting `Main Floor` (`is_entry_exit: true`, L1) to `The Chop-Cathedral` (`is_entry_exit: false`, L3), `computePromotionCandidates` still skips `The Chop-Cathedral` because `Sector 9` is `depth: 3` (only `depth === 1` structures force an entry/exit prompt), avoiding unexpected prompts for L2–L4 district nodes.
3. **Anchored Camera / Focus Selection (`anchorNodeId`):**
   - `projectTopologyForDepth` selects `activeVis`, else first marked portal (`dynamicPortalIds`), else `visibleLocations[0]`, else `visibleSupernodes[0]`. If a container happens to have no marked portals, layout still anchors deterministically on `visibleLocations[0]`.
4. **Root-Level Normalization Invariant:**
   - Moving a marked portal out to the world root (`container_id = null`) clears `is_entry_exit = false` (`useTopologyMutations.ts`), and `computeDynamicPortalIds` additionally guards `Boolean(loc.container_id && loc.is_entry_exit)` so stale flags at root never display a portal badge.
5. **Existing Test Contract Update (`backend/tests/test_location_containers.py`):**
   - Lines 755–774 previously asserted that calling `connect_campaign_locations` between `vip` (`is_entry_exit: false`) and `lounge` automatically flipped `vis_vip.is_entry_exit` to `True` in `get_campaign_state_bundle` via dynamic edge synthesis. Update that test to verify that `connect_campaign_locations` leaves both base DB `location_nodes.is_entry_exit` **and** `bundle_conn.visible_locations` `is_entry_exit == False` unless explicitly marked via campaign map overrides.

---

## 5. Acceptance Criteria & Verification Matrix

| ID | Criterion | Verification Method |
| :--- | :--- | :--- |
| **AC-1** | `computeDynamicPortalIds` returns **only** containerized locations with `is_entry_exit === true`, ignoring cross-container edges on unmarked (`is_entry_exit === false`) nodes. | `locationContainers.test.tsx` + `mapEditor.test.tsx` unit tests |
| **AC-2** | On a fixture matching *The Green Lie* (Depth-3 location *The Chop-Cathedral* with `is_entry_exit: false` connected to Depth-1 *Main Floor* with `is_entry_exit: true`), `Main Floor` shows the portal badge/pill while *The Chop-Cathedral* does **not**, in both canvas SVG and `MapDetailsDrawer`. | `mapEditor.test.tsx` SSR assertions |
| **AC-3** | Ghost external nodes, dashed boundary links, and `↗ External Exit` labels continue rendering for cross-boundary edges regardless of whether endpoints have `is_entry_exit: true`. | `locationContainers.test.tsx` + `mapEditor.test.tsx` |
| **AC-4** | Campaign state hydration (`get_campaign_state_bundle`) performs zero dynamic portal synthesis across both base-world and campaign-turn cross-boundary edges, preserving explicit `location_nodes.is_entry_exit` and `campaign_location_overrides.is_entry_exit` flags only. | `backend/tests/test_location_containers.py` |
| **AC-5** | Existing worlds require zero database/data migrations (`location_nodes.is_entry_exit` values stay untouched). | SQLite & schema check |
| **AC-6** | All backend (`ruff check`, `tach check`, `pytest`) and frontend (`arch:check`, `build`, `test`) gates pass. | CLI gate |

---

## 6. Resolved Design Decisions

1. **Remove Dynamic Portal Synthesis Completely:** Both frontend ([`computeDynamicPortalIds`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/topologyProjection.ts#L310-L336)) and backend ([`get_campaign_state_bundle`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/turns.py#L994-L1014)) rely strictly on explicit `is_entry_exit` markings (`location_nodes.is_entry_exit` and `campaign_location_overrides.is_entry_exit`), with zero edge-based portal synthesis anywhere.
2. **Zero DB Migration:** Keep schema and existing persisted world rows untouched; existing `is_entry_exit` values (including `0` on *The Chop-Cathedral*, *The Green-Sump*, and *The Cage-Walk* in *The Green Lie*) remain authoritative unless edited explicitly by the user.
