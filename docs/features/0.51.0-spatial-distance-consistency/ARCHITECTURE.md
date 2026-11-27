---
feature: spatial-distance-consistency
target_version: 0.51.0
document_type: architecture
status: completed
last_updated: 2026-11-27
---

# Technical Architecture — Spatial Distance Consistency, Anchors & Overrides

## 1. Pure Frontend Spatial Consistency & Reconciliation Engine (`frontend/src/components/map/spatialConsistency.ts`)

All 2D geometry checks, outer-scope anchor resolution, and distance reconciliation live in a pure, DOM-free TypeScript module (`spatialConsistency.ts`) so they run identically in the browser UI and Node-only Vitest.

### 1.1 Public Contracts
```ts
export type DistanceMode = "flexible" | "locked" | "non_euclidean";

export type ConsistencyIssueKind =
  | "distance_mismatch"
  | "triangle_inequality"
  | "compass_conflict"
  | "overconstrained_locked"
  | "asymmetric_pair"
  | "anchor_disconnected"
  | "anchor_invalid";

export interface EdgeConsistencyDiagnostic {
  pairKey: string;
  primaryEdgeId: string;
  reciprocalEdgeId: string | null;
  kind: ConsistencyIssueKind;
  severity: "error" | "warning" | "info";
  currentMeters: number;
  suggestedMeters: number | null;
  longitudinalErrorMeters: number;
  lateralErrorMeters: number;
  message: string;
  shortcutPathNames?: string[];
  shortcutMeters?: number;
}

export interface AnchorResolution {
  locationId: string;
  anchorLocationId: string;
  resolvedX: number;
  resolvedY: number;
  offsetMetersX: number;
  offsetMetersY: number;
  viaEdgeId: string | null;
  viaVertical: boolean;
  valid: boolean;
  reason?: string;
}

export interface ReconciliationAdjustment {
  edgeId: string;
  reciprocalEdgeId: string | null;
  fromLocationId: string;
  toLocationId: string;
  fromName: string;
  toName: string;
  currentMeters: number;
  proposedMeters: number;
  deltaMeters: number;
}

export interface ConsistencyReport {
  scopeContainerId: string | null;
  diagnostics: EdgeConsistencyDiagnostic[];
  diagnosticsByEdgeId: Record<string, EdgeConsistencyDiagnostic>;
  anchorResolutions: Record<string, AnchorResolution>;
  proposedAdjustments: ReconciliationAdjustment[];
  proposedByEdgeId: Record<string, ReconciliationAdjustment>;
  errorCount: number;
  warningCount: number;
  infoCount: number;
}
```

### 1.2 Compass Vectors & Bidirectional Pair Reduction
1. **Unit Vectors (`COMPASS_UNIT_VECTORS`)**:
   - `N: { x: 0, y: 1 }`, `NE: { x: Math.SQRT1_2, y: Math.SQRT1_2 }`, `E: { x: 1, y: 0 }`, `SE: { x: Math.SQRT1_2, y: -Math.SQRT1_2 }`
   - `S: { x: 0, y: -1 }`, `SW: { x: -Math.SQRT1_2, y: -Math.SQRT1_2 }`, `W: { x: -1, y: 0 }`, `NW: { x: -Math.SQRT1_2, y: Math.SQRT1_2 }`
2. **Visibility Gating**:
   - In `mode === "campaign" && !unlockLore`, filter out undiscovered secret edges (`is_secret && !isEdgeRevealed(...)`) before reduction so secret paths never leak through warnings.
3. **Pair Reduction**:
   - Group directed edges by canonical unordered pair `min(u,v)<->max(u,v)`.
   - Detect `asymmetric_pair` (`info`) if forward and reverse edges disagree on `distance_meters`, `distance_mode`, `is_vertical`, or if `c_rev !== OPPOSITE_COMPASS[c_fwd]`.
   - Effective pair values:
     - If either direction is `"non_euclidean"`, treat pair as `"non_euclidean"`; else if either is `"locked"`, treat as `"locked"`; else `"flexible"`.
     - If either direction has `is_vertical === true`, treat pair as vertical.
     - Direction vector from `u → v` uses `fwd.compass_direction` (or `OPPOSITE_COMPASS[rev.compass_direction]` if only reverse exists, falling back to `inferCompassDirection`).

### 1.3 Scoped Graph Construction, Vertical Contraction & Outer-Scope Anchor Resolution
Given a target scope `scopeContainerId: string | null` (the active container view, or `null` for World Root):

1. **Scope Projection (`buildScopedSolverGraph`)**:
   - Collect all locations inside `scopeContainerId` and its descendant containers (`subLocIds`).
   - At `scopeContainerId`, collapse any direct child container `childCont` (and its descendants) into a single virtual node `cont:${childCont.id}` **unless** we are inside that child container (`scopeContainerId === childCont.id`).
     - *Effect for The Green Lie*: When resolving *Sector 9: The Drain*, *Main Floor* and *The Sump-Well* (both inside *The Neon Rust* L1) collapse to `cont:<neon_rust_id>`, so *Main Floor --[E 1500m]--> The Chop-Cathedral* and *The Green-Sump --[NW 210m]--> Main Floor* share the same macro origin for *The Neon Rust* without *The Sump-Well*'s internal `280m NW` room offset distorting Sewers' anchors.
   - Include all edges whose both endpoints map to distinct nodes in the scoped graph (edges internal to a collapsed child container become self-loops and are dropped).
   - **Strict Exclusion:** Edges internal to `scopeContainerId` are **never** included when computing outer scopes for `anchor_location_id` targets.
2. **Recursive Anchor Resolution (`resolveOuterAnchorsForScope`)**:
   - For any location $a$ directly or transitively inside `scopeContainerId` whose `anchor_location_id = r` lies outside `scopeContainerId`'s subtree:
     - Validate `isValidSpatialAnchor(a, r, containers, locations)`.
     - Find the lowest common ancestor (LCA) container `lcaId` enclosing both `scopeContainerId` and $r$ (or `null` = World Root).
     - Recursively solve the 2D layout of `lcaId` (**excluding** `scopeContainerId`'s subtree edges, and collapsing `scopeContainerId` itself only if referenced externally—actually, when solving `lcaId` to locate $r$, exclude edges whose *both* endpoints are inside `scopeContainerId` and drop cross-boundary edges into `scopeContainerId` so *Sewers* never pulls *Sector 9*!).
     - Obtain $\mathbf{P}_{\text{outer}}(r)$ in meters relative to `lcaId`'s primary component origin.
     - Inspect all edges connecting $r$ and $a$ directly:
       - If any non-`non_euclidean` edge connects $r$ and $a$:
         - If `is_vertical`: offset $\boldsymbol{\delta} = (0, 0)$.
         - Else: $\boldsymbol{\delta} = d_{r \to a} \cdot \mathbf{u}(c_{r \to a})$.
       - Else (no connecting edge, or only `non_euclidean` portal): $\boldsymbol{\delta} = (0, 0)$.
     - Record anchor pin $\mathbf{P}_{\text{pin}}(a) = \mathbf{P}_{\text{outer}}(r) + \boldsymbol{\delta}$.
   - **Anchor Component Handling:**
     - Nodes whose `anchor_location_id` resolves in the same outer connected component share a consistent coordinate frame (e.g., *Sewer Entrance* via *The Sump-Well*/*The Neon Rust* and *Tunnel 1-M* via *The Chop-Cathedral* are both in *Sector 9*'s connected component!).
     - If an anchored node's target lies in a *different* disconnected outer component from another anchor in the same scope, emit `anchor_disconnected` (`info`) and treat only the primary outer component's anchors as hard pins.
3. **Vertical Contraction (Union-Find)**:
   - Among non-`non_euclidean` edges in the scoped graph, merge endpoints joined by `is_vertical === true` edges via Union-Find.
   - Each Union-Find component becomes one 2D position DOF $\mathbf{p}_g = (x_g, y_g) \in \mathbb{R}^2$.
   - If multiple nodes in the same vertical group carry anchor pins, average/check consistency; if two pins in the same vertical group disagree by $> \max(5\text{m}, 5\%)$, flag `overconstrained_locked`.

### 1.4 Check 1 — Fixed-Distance Residual Analysis
With current distances $d_e$ held fixed on all horizontal non-`non_euclidean` edges $e = (g_u, g_v)$ with unit vector $\mathbf{u}_e$:
- Minimize $\sum_e w_e \|\mathbf{p}_{g_v} - \mathbf{p}_{g_u} - d_e \mathbf{u}_e\|_2^2$ subject to $\mathbf{p}_g = \mathbf{P}_{\text{pin}}(g)$ for anchored DOFs (and pinning one deterministic root per unanchored connected component to $(0, 0)$).
- Solve the decoupled $x$ and $y$ Laplacian systems via dense Cholesky with Tikhonov regularization ($\epsilon = 10^{-8}$).
- For each horizontal edge $e$, decompose residual $\mathbf{r}_e = (\mathbf{p}_{g_v}^* - \mathbf{p}_{g_u}^*) - d_e \mathbf{u}_e$ into:
  - Longitudinal error: $e_{\parallel} = |\mathbf{r}_e \cdot \mathbf{u}_e|$
  - Lateral error: $e_{\perp} = |\mathbf{r}_e \cdot \mathbf{u}_e^\perp|$
- Tolerance thresholds: $\tau_{\parallel}(d) = \max(5, 0.05 \cdot d)$, $\tau_{\perp}(d) = \max(10, 0.10 \cdot d)$.
- Any edge exceeding $\tau_{\parallel}$ or $\tau_{\perp}$ is marked inconsistent (`distance_mismatch` if flexible or adjacent to flexible edges; `overconstrained_locked` if locked/conflicting).

### 1.5 Check 2 — Metric Triangle-Inequality Check
For each horizontal non-`non_euclidean` edge $e = (u, v)$ with distance $d_e$:
- Run Dijkstra between $u$ and $v$ on the graph of all **other** non-`non_euclidean` edges (excluding $e$ itself; vertical edges have weight `distance_meters` for physical path length, or `0`? Wait—vertical distance adds real path meters, so use `edge.distance_meters` for all non-`non_euclidean` edges!).
- Let $D_{\text{alt}}(u, v)$ be the shortest alternate path length.
- If $D_{\text{alt}}(u, v) + \max(5, 0.05 \cdot d_e) < d_e$:
  - Flag `triangle_inequality` (`warning`): direct edge $e$ ($d_e$) is longer than an alternate physical route ($D_{\text{alt}}$), e.g., *Main Floor → Chop-Cathedral* (`1500m`) vs *Main Floor → Green-Sump → Chop-Cathedral* (`210m + 140m = 350m`).
  - Provide `suggestedMeters = Math.round(D_alt)` (or allow marking the shortcut `non_euclidean`).

### 1.6 Part B — Schur-Complement Reconciliation Solver
Goal: Find minimally perturbed coordinates $\mathbf{p}_g$ and flexible edge lengths $d_e \ge 1$ that satisfy all anchored pins, `locked` edges, and compass directions.

For each horizontal edge $e = (g_u, g_v)$ with unit vector $\mathbf{u}_e = (u_x, u_y)$ and normal $\mathbf{n}_e = (-u_y, u_x)$, let $\Delta \mathbf{p}_e = \mathbf{p}_{g_v} - \mathbf{p}_{g_u}$:
- **Locked edge ($d_e$ fixed at $d_e^{(0)}$):**
  $$\text{Energy}_e(\mathbf{p}) = \Lambda_{\text{lock}} \|\Delta \mathbf{p}_e - d_e^{(0)} \mathbf{u}_e\|_2^2$$
- **Flexible edge ($d_e$ free):**
  $$\min_{d_e} \left[ \Lambda_{\text{geo}} \|\Delta \mathbf{p}_e - d_e \mathbf{u}_e\|_2^2 + \alpha_e (d_e - d_e^{(0)})^2 \right]$$
  Eliminating $d_e$ analytically yields the exact closed-form optimal length:
  $$d_e^*(\mathbf{p}) = \frac{\Lambda_{\text{geo}} (\Delta \mathbf{p}_e \cdot \mathbf{u}_e) + \alpha_e d_e^{(0)}}{\Lambda_{\text{geo}} + \alpha_e}$$
  and the exact reduced quadratic energy in $\mathbf{p}$ alone:
  $$\text{Energy}_e^{\text{red}}(\mathbf{p}) = \Lambda_{\text{geo}} (\Delta \mathbf{p}_e \cdot \mathbf{n}_e)^2 + \kappa_e \left(\Delta \mathbf{p}_e \cdot \mathbf{u}_e - d_e^{(0)}\right)^2, \qquad \kappa_e = \frac{\Lambda_{\text{geo}} \alpha_e}{\Lambda_{\text{geo}} + \alpha_e}$$
- **Scale-Invariant Weights:**
  - $M = \text{median}(\{d_e^{(0)}\}, 100)$
  - $\alpha_e = \left(\frac{M}{\max(d_e^{(0)}, 10)}\right)^2$ (relative proportional stiffness)
  - $\Lambda_{\text{geo}} = 10^4$, $\Lambda_{\text{lock}} = 10^6$
- **Linear System & Active-Set Clamping:**
  - Assemble the $2|V_{\text{free}}| \times 2|V_{\text{free}}|$ symmetric positive-definite matrix $\mathbf{H}$ and RHS $\mathbf{b}$ (anchored pins eliminated directly into $\mathbf{b}$; one root per unanchored component pinned to $(0, 0)$).
  - Solve $\mathbf{H}\mathbf{x} = \mathbf{b}$ via dense Cholesky decomposition.
  - Recover $d_e^* = \frac{\Lambda_{\text{geo}}(\Delta \mathbf{p}_e^* \cdot \mathbf{u}_e) + \alpha_e d_e^{(0)}}{\Lambda_{\text{geo}} + \alpha_e}$ for every flexible edge.
  - **Active-set loop (max 8 iterations):** If any flexible $d_e^* < 1$, clamp that edge as temporarily locked at $d_e = 1$ and re-solve.
  - **Post-solve diagnostic check:** Re-evaluate longitudinal & lateral residuals on $\mathbf{p}^*$:
    - If a `flexible` edge still has $d_e^* \le 1$ with residual $> \tau$ (compass direction points opposite to geometric closure), classify as `compass_conflict` (`error`) and **do not** propose a bogus `1m` adjustment.
    - If a `locked` edge retains residual $> \tau$, classify as `overconstrained_locked` (`error`).
    - Otherwise, for every `flexible` edge where $|\text{round}(d_e^*) - d_e^{(0)}| \ge \max(1, \text{tolerance})$, emit a `ReconciliationAdjustment` with `proposedMeters = Math.max(1, Math.round(d_e^*))`.

#### Worked Walkthrough on User's Green Lie Scenario
1. Outer scope *Sector 9*:
   - *The Neon Rust* (`Main Floor`, `The Sump-Well` collapsed to `cont:neon_rust`) at $(0, 0)$.
   - *Main Floor --[E 1500m]--> The Chop-Cathedral* places *The Chop-Cathedral* at $(+1500, 0)$ *(or adjusted if `Main Floor -> Green-Sump -> Chop-Cathedral` are flexible/locked—when `Main Floor -> Chop-Cathedral` is `locked` at `1500m`, Chop-Cathedral is fixed at $(+1500, 0)$)*.
2. *Sewers* scope:
   - *The Neon Rust's Sewer Entrance* anchored to *The Sump-Well* via vertical `25m` hatch (`is_vertical = true`) → pin at $(0, 0)$.
   - *Tunnel 1-M* anchored to *The Chop-Cathedral* via `N 1000m` (`is_vertical = false`) → pin at $(+1500, +1000)$.
   - *Sewer Entrance --[N 1000m]--> Tunnel 1-L* (or `NE` if drawn/oriented—note if `N 1000m`, *Tunnel 1-L* lands at $(0, +1000)$).
   - *Tunnel 1-L --[E 140m]--> Tunnel 1-M*: $\Delta \mathbf{p} = (1500 - 0, 1000 - 1000) = (1500, 0)$ along `E=(1,0)` → $d^* \approx 1500\text{m}$!
   - Parallel rung *Tunnel 2-L --[E 210m]--> Tunnel 2-M* (with `Tunnel 1-L --[N 210m]--> Tunnel 2-L` and `Tunnel 1-M --[N 210m]--> Tunnel 2-M`) also solves cleanly to $1500\text{m}$!

---

## 2. Database Schema & Migrations

### 2.1 `backend/app/db/schema.sql`
- **`location_nodes`:** Add `anchor_location_id TEXT NULL` (nullable soft reference; validated/cleaned on delete/repairs rather than hard FK cascade so self-referential deletion order in bulk world updates never triggers FK errors).
- **`location_edges`:** Add:
  - `distance_mode TEXT NOT NULL DEFAULT 'flexible' CHECK(distance_mode IN ('flexible', 'locked', 'non_euclidean'))`
  - `is_vertical INTEGER NOT NULL DEFAULT 0 CHECK(is_vertical IN (0, 1))`
- **`campaign_spatial_overrides`:** Reuse existing `metadata_override_json` column to store `"anchor_location_id"` when overridden on a campaign branch.

### 2.2 `backend/app/db/repos/schema_init.py`
- Add idempotent `ALTER TABLE` migrations:
  - `location_nodes`: `anchor_location_id TEXT NULL`
  - `location_edges`: `distance_mode TEXT NOT NULL DEFAULT 'flexible'` and `is_vertical INTEGER NOT NULL DEFAULT 0`
- Include new columns in any table-rebuild migration paths (`location_nodes`, `location_edges` rebuilds) so fresh and upgraded DBs match `schema.sql`.

---

## 3. Backend Schemas, Repositories, Routes & `.zcc`

### 3.1 `backend/app/schemas/world.py`
- `EdgeDistanceMode = Literal["flexible", "locked", "non_euclidean"]`
- `VALID_EDGE_DISTANCE_MODES: frozenset[str] = frozenset({"flexible", "locked", "non_euclidean"})`
- Pure normalizers: `normalize_edge_distance_mode(raw) -> EdgeDistanceMode` and `normalize_edge_is_vertical(raw) -> bool`.
- Update `resolve_legacy_edge_flags` and `extract_edge_link_fields` (or add `extract_edge_consistency_fields`) so `LocationEdge`, `LocationEdgeDraft`, and `NeighborLocationView` coerce missing/legacy values cleanly.
- Add `anchor_location_id: str | None = None` to `LocationNode` and `LocationNodeCommitDraft`.
- Add helper `validate_spatial_anchors_integrity(containers, locations)` (non-blocking normalization or validation: rejects self-anchors, intra-container anchors, or anchors inside descendant containers; remaps/clears on broken targets).

### 3.2 Repositories
- `backend/app/db/repos/worlds.py`:
  - `create_world` & `update_world`: persist `anchor_location_id` (remapped through `loc_id_map` on CoW world fork, cleared if invalid/deleted) and `distance_mode` / `is_vertical`.
  - `_load_world_rows` / `get_world`: hydrate `anchor_location_id`, `distance_mode`, `is_vertical`.
- `backend/app/db/repos/world_locations.py`:
  - `create_linked_location`: accept/persist `distance_mode`, `is_vertical` with sensible defaults.
  - Row mappers (`_row_to_location`, `_row_to_edge` in `campaign_spatial.py`): read `anchor_location_id`, `distance_mode`, `is_vertical`.
- `backend/app/db/repos/campaign_spatial.py`:
  - `_apply_campaign_spatial_overrides`: apply `meta.get("anchor_location_id")` when `"anchor_location_id" in meta`.
  - `connect_campaign_locations` & `update_campaign_edge`: accept `distance_mode` and `is_vertical` (mirroring to reciprocal edge when `update_reciprocal=True`).
- `backend/app/db/repos/campaign_map_update.py`:
  - Persist `anchor_location_id` on new/leaf-created locations and via `metadata_override_json` on pre-existing locations. Allow `anchor_location_id` updates on unvisited or GM-unlocked locations (and clear dangling `anchor_location_id` pointing to deleted locations).
  - Persist `distance_mode` and `is_vertical` on new and updated `location_edges` (respecting existing GM Mode / visited edge restrictions or mirroring existing edge mutation rules).

### 3.3 Routes & `.zcc` Import/Export
- `backend/app/routers/campaign_routes/schemas_and_gate.py`:
  - Add optional `distance_mode: EdgeDistanceMode = "flexible"` and `is_vertical: bool = False` to `CampaignEdgeCreateRequest`.
  - Add optional `distance_mode: EdgeDistanceMode | None = None` and `is_vertical: bool | None = None` to `CampaignEdgeDistanceUpdateRequest`.
- `backend/app/routers/campaign_routes/spatial_routes.py`: pass `distance_mode` and `is_vertical` through to `connect_campaign_locations` and `update_campaign_edge`.
- `backend/app/services/import_export_service.py` & `backend/app/services/zcc_campaign_io.py`:
  - Export `anchor_location_id` on locations and `distance_mode`, `is_vertical` on edges.
  - Import with `loc_id_map` remapping for `anchor_location_id` and safe defaults (`None`, `"flexible"`, `False`) for legacy `.zcc` archives.

---

## 4. Frontend Layering & Component Integration

- **Leaf Types (`frontend/src/types/world.ts`)**:
  - `EdgeDistanceMode = "flexible" | "locked" | "non_euclidean"`.
  - Add `anchor_location_id?: string | null` to `LocationNode` and `LocationNodeDraft`.
  - Add `distance_mode?: EdgeDistanceMode` and `is_vertical?: boolean` to `LocationEdge`, `LocationEdgeDraft`, and `NeighborLocationView`.
- **Projection & Dirty Tracking (`frontend/src/components/map/topologyProjection.ts`)**:
  - Carry `distance_mode`, `is_vertical`, and `anchor_location_id` cleanly through `cloneGraph`, `areGraphSnapshotsEqual`, `ProjectedTopologyEdge`, and `ProjectedGhostEdge`.
- **Mutations & Auto-Sync (`frontend/src/components/map/useTopologyMutations.ts`)**:
  - Extend `EdgePairPatch` with `distance_mode` and `is_vertical`, mirrored onto reciprocal edges.
  - Add `clearDanglingAnchors` on location delete or container drop/reparent so `anchor_location_id` never points to a deleted or same-container node.
  - Add `applyConsistencyAutoSync` helper invoked when **Auto-Sync Unlocked Links** is enabled and a distance/compass/mode/anchor edit occurs in the current view (atomic single Undo snapshot).
  - Add `applyReconciliationAdjustments` helper for one-click single-edge fix or batch Preview/Apply reconciliation (atomic single Undo snapshot).
- **UI Components**:
  - `MapLinkInspectorSection.tsx`: Distance Rule selector, Vertical toggle, inline consistency suggestion banner.
  - `MapDetailsDrawer.tsx`: External Spatial Anchor picker on containerized Level 0 locations + clear/jump/offset summary.
  - `SpatialTopologyCanvas.tsx`: Anchor badge on nodes, Locked / Non-Euclidean / Vertical / Warning indicators on edges, Preview Reconciliation badge diffs & banner, Ghost Node / Portal context-menu `"Anchor to..."`.
  - `TopologyHeaderToolbar.tsx` + `MapConsistencyPanel.tsx`: Live Consistency status pill/button, diagnostic list across current view & world scopes, Preview Reconciliation trigger, and Auto-Sync Unlocked Links toggle.
- **Styles (`frontend/src/styles/`):**
  - Place new map inspector/badge/panel styles in the existing map stylesheet (`frontend/src/styles/`), using `00-tokens.css` variables, zero `!important`, and checking `npm --prefix frontend run css:audit`.
