---
feature: spatial-distance-consistency
target_version: 0.51.0
document_type: frd
status: completed
last_updated: 2026-11-27
---

# Feature Requirements Document — Spatial Distance Consistency, Anchors & Overrides

## 1. Overview & Motivation

CyberCantina represents world geography as a hierarchical spatial graph: Level 0 `LocationNode` rooms grouped inside optional Level 1–4 `LocationContainer` layers (Buildings/Complexes → Districts → Cities/Settlements → Regions/Realms) and connected by directed `LocationEdge` passages carrying `compass_direction` (8-way), `distance_meters`, `speed_modifier`, and `travel_mode`.

While authoring multi-layer maps—such as **The Green Lie**'s *Sector 9: The Drain* and its nested *Sewers* Level 1 container—authors frequently connect sub-areas back to multiple surface landmarks:
- *Main Floor* (inside *The Neon Rust* L1) connects East `1500m` to *The Chop-Cathedral* (*Sector 9: The Drain*).
- *The Sump-Well* (inside *The Neon Rust* L1) drops North `25m` down a hatch into *The Neon Rust's Sewer Entrance* (*Sewers* L1).
- *The Neon Rust's Sewer Entrance* runs North/NE `1000m` to *Tunnel 1-L* (*Sewers* L1).
- *The Chop-Cathedral* drops North `1000m` into *Tunnel 1-M* (*Sewers* L1).
- *Tunnel 1-L* connects East to *Tunnel 1-M*, currently defaulting to `140m` instead of the `1500m` dictated by the surface layout above.

Today, every link's `distance_meters` is authored in isolation without any awareness of:
1. **External spatial anchors** pinning interior rooms/portals to outside landmarks across container boundaries.
2. **2D compass-vector loop closure** across cycles, triangles, and parallel corridors (e.g., *Tunnel 1-L ↔ Tunnel 1-M*, *Tunnel 2-L ↔ Tunnel 2-M*, and *Main Floor → The Green-Sump → The Chop-Cathedral*).
3. **Vertical transitions** (ladders, hatches, drop-shafts, elevators) that consume travel distance/time vertically without displacing 2D horizontal map coordinates.
4. **Intentional physics-bending exceptions** (magic portals, wormholes, pocket dimensions) that should explicitly opt out of Euclidean geometry rules.

This feature introduces **External Spatial Anchors**, **Per-Link Distance Rules (`flexible`, `locked`, `non_euclidean`) & Vertical Transition flags**, a **2D Compass-Vector Consistency Analyzer & Reconciliation Solver**, and **non-blocking Editor/Campaign Map authoring controls**—while keeping schematic canvas positions `(ui_x, ui_y)` completely free for author readability.

---

## 2. Core Data Model & Invariants

### 2.1 `LocationEdge` Extensions
1. **`distance_mode: "flexible" | "locked" | "non_euclidean"`** (default `"flexible"`):
   - **`flexible`**: Participates in 2D consistency checks and may be automatically adjusted by **Preview Reconciliation** or **Auto-Sync Unlocked Links**.
   - **`locked`**: Authoritative ground-truth distance. Participates in 2D consistency checks as a hard constraint and is **never** modified by the solver or Auto-Sync. Conflicts between multiple locked constraints surface as `overconstrained_locked` errors.
   - **`non_euclidean`**: Physics-bending / folded-space passage (e.g., magic portal, wormhole, psychic shortcut). Excluded from **all** 2D compass-vector loop checks, triangle-inequality checks, and reconciliation solves, while retaining `distance_meters`, `speed_modifier`, `travel_mode`, and gameplay duration.
2. **`is_vertical: bool`** (default `False`):
   - Marks vertical transitions (ladders, hatches, elevator shafts, stairwells, drop chutes).
   - Retains full `distance_meters`, `speed_modifier`, and gameplay travel duration in Zone 4 / Phase 1 / Phase 5 Clerk movement.
   - Contributes `(0, 0)` horizontal displacement in 2D geometry (unless `distance_mode == "non_euclidean"`, which already opts out of geometry entirely).
3. **Bidirectional Pair Synchronization**:
   - Editing `distance_mode` or `is_vertical` on one edge of a bidirectional pair (`A ↔ B`) mirrors to its reciprocal edge (`B → A`) across frontend mutations, `PATCH /api/campaigns/{id}/edges/{edge_id}`, `PUT /api/campaigns/{id}/map`, and `PUT /api/worlds/{world_id}`.

### 2.2 `LocationNode` Extension
1. **`anchor_location_id: str | None`** (default `None`):
   - Designates an external reference `LocationNode.id` used to position a containerized location (`container_id != None`) relative to outer-scope geography.
   - **Scope constraint:** Only valid when the anchored node is inside a container (`container_id != None`), and `anchor_location_id` MUST belong to a location **outside** the anchored node's owning container subtree (cannot be self, cannot share the same container, cannot sit in a descendant container).
   - **Connected or Reference-Only:** Works both when a physical passage links the two locations (e.g., *Tunnel 1-M ↔ The Chop-Cathedral*, *Sewer Entrance ↔ The Sump-Well*) **and** when no passage exists (reference-only pin—useful for shafts/vents or subterranean alignment without a direct exit).
   - **Lifecycle Hygiene:** Automatically cleared (`None`) if the target location is deleted, if the anchored node moves to `World Root`, or if container reparenting causes both nodes to enter the same/descendant container subtree. Remapped losslessly during world Copy-on-Write forks and `.zcc` imports.

### 2.3 Zero Zone 1 KV-Cache / Prompt Impact
- `distance_mode`, `is_vertical`, and `anchor_location_id` are strictly **authoring & topology-consistency metadata**. They are **never** injected into Zone 1 static system prompts or Zone 4 turn context (gameplay continues to use `distance_meters`, `speed_modifier`, `travel_mode`, `obstacles`, `is_blocked`, and `is_secret` as before).

---

## 3. Spatial Consistency Rules & Resolution Semantics

### 3.1 Compass-Vector Geometry (Canvas Remains Schematic)
- Every horizontal non-`non_euclidean` edge `u → v` with `compass_direction` $c$ and `distance_meters` $d$ implies a 2D displacement vector $\Delta \mathbf{p} = d \cdot \mathbf{u}(c)$:
  - `N = (0, +1)`, `NE = (+1/√2, +1/√2)`, `E = (+1, 0)`, `SE = (+1/√2, -1/√2)`
  - `S = (0, -1)`, `SW = (-1/√2, -1/√2)`, `W = (-1, 0)`, `NW = (-1/√2, +1/√2)`
- Canvas coordinates `(ui_x, ui_y)` remain strictly schematic and are **never** coupled to meter distances or auto-rewritten by consistency checks.

### 3.2 Outer-Scope Anchor Resolution & L1 Footprint Collapse
When analyzing a target container scope $C$ (or World Root):
1. **Strict Outer-Scope Separation (No Circular Feedback):** Outer coordinates for external anchors are computed from the ancestor/outer graph **strictly excluding** edges internal to $C$ (and its descendants). Thus interior edits inside *Sewers* never warp *Sector 9* anchor coordinates.
2. **L1 Building / Child-Container Footprint Collapse:** When solving at a parent scope (e.g., *Sector 9: The Drain*), any L1 (or nested) child container inside that scope is collapsed to a single shared macro footprint point (`cont:<id>`). For example, *The Sump-Well* inside *The Neon Rust* resolves to *The Neon Rust*'s Sector 9 footprint—ignoring internal room offsets inside the bar—so *Main Floor → The Chop-Cathedral* (`E 1500m`) sets the macro separation between *The Neon Rust* and *The Chop-Cathedral* directly.
3. **Anchor Offset Rule:** For an anchored node $a \in C$ with `anchor_location_id` = $r$:
   - Compute outer-scope 2D coordinates $\mathbf{P}_{\text{outer}}(r)$ (resolved recursively if the outer scope itself has anchors).
   - If a non-`non_euclidean` edge connects $r$ and $a$:
     - If `is_vertical == True`: offset $\boldsymbol{\delta}(r \to a) = (0, 0)$, so $\mathbf{P}(a) = \mathbf{P}_{\text{outer}}(r)$.
     - If `is_vertical == False`: offset $\boldsymbol{\delta}(r \to a) = d_{r \to a} \cdot \mathbf{u}(c_{r \to a})$, so $\mathbf{P}(a) = \mathbf{P}_{\text{outer}}(r) + \boldsymbol{\delta}(r \to a)$ (e.g., *The Chop-Cathedral* + `N 1000m` → *Tunnel 1-M*).
   - If no horizontal/vertical non-`non_euclidean` edge connects $r$ and $a$ (reference-only anchor): $\mathbf{P}(a) = \mathbf{P}_{\text{outer}}(r)$.

### 3.3 Checks & Tolerances
1. **Geometric Loop / Anchor Consistency:** Solves optimal 2D node positions under current edge lengths and evaluates per-edge longitudinal residual (along compass axis) and lateral residual (perpendicular to compass axis).
   - **Warning** if longitudinal error exceeds $\max(5\text{m}, 5\% \cdot d_e)$ or lateral error exceeds $\max(10\text{m}, 10\% \cdot d_e)$.
   - **Compass / Locked Conflict (`error`)** if reconciliation cannot close the residual because compass bearings oppose closure (e.g., an East link needs a negative distance) or `locked` constraints conflict.
2. **Metric Triangle-Inequality Check:** For every horizontal non-`non_euclidean` edge $e = (u, v)$, if an alternate path between $u$ and $v$ exists whose summed `distance_meters` is strictly shorter than $d_e$ beyond $\max(5\text{m}, 5\% \cdot d_e)$ (e.g., *Main Floor → Chop-Cathedral* `1500m` vs. *Main Floor → Green-Sump → Chop-Cathedral* `210m + 140m = 350m`), flag a **Shortcut / Triangle Inequality** warning suggesting either reconciling the links or marking the shortcut `non_euclidean`.
3. **Informational Diagnostics (`info`):**
   - **Asymmetric Pair:** Bidirectional edges `u → v` and `v → u` disagree on `distance_meters`, `distance_mode`, `is_vertical`, or compass opposition (`c(u→v) != OPPOSITE[c(v→u)]`).
   - **Disconnected Anchor Reference:** `anchor_location_id` cannot reach or be mapped to an outer-scope component relative to another anchor in the same view (only one anchor in a view provides an origin; two+ anchors in different outer connected components cannot fix relative scale).
4. **Non-Blocking Save Invariant:** Consistency warnings and errors **never** block saving the map in World Editor or Campaign Map Editor.

### 3.4 Campaign Player Mode Spoiler Safety
- In Campaign Player mode (`mode == "campaign"` with GM Mode `unlock_lore == False`), consistency diagnostics MUST evaluate **only visible edges** (excluding undiscovered `is_secret` passages) so discrepancy warnings never leak hidden secret routes. In World Editor and GM Mode (`unlock_lore == True`), all edges are evaluated.

---

## 4. Authoring UX & Editor Surfaces

### 4.1 Link Inspector (`MapLinkInspectorSection.tsx`)
- **Distance Rule** segmented control (`Flexible` | `Locked` | `Non-Euclidean`) with concise explanatory tooltips.
- **Vertical Transition** toggle (`Vertical (0m horizontal offset)` — e.g., hatch, ladder, elevator) disabled/muted when `Non-Euclidean` is active (since non-Euclidean links already bypass geometry).
- **Inline Consistency Banner:** When the selected link has a discrepancy, displays the issue, expected distance (when solvable, e.g., `Suggested: 1.5km (1500m)`), and quick actions: **`Apply Suggested`** (if `flexible` or switchable) or **`Mark Non-Euclidean`**.

### 4.2 Location / Container Details Drawer (`MapDetailsDrawer.tsx`)
- On **containerized Level 0 Locations** (`container_id != null`) in editable views:
  - **External Spatial Anchor** selector listing valid external locations outside the current container subtree, grouped into:
    1. *Connected External Locations* (ghost portal destinations directly linked to this node)
    2. *Other External Locations* (grouped by container/World Root)
  - Clear (`×`) button and live offset summary (e.g., `Pinned to The Sump-Well (+0m, +0m via vertical hatch)` or `Pinned to The Chop-Cathedral (N 1000m)`).
- **Ghost External Node / Portal Context Menu:** Right-clicking a Ghost External Node or external portal location offers a quick **"Anchor to \<External Name\>"** / **"Clear Anchor"** action.

### 4.3 Canvas Visual Affordances (`SpatialTopologyCanvas.tsx`)
- **Anchored Nodes:** Subtle cyan/amber anchor badge (`Anchor` icon) on nodes with `anchor_location_id` set, with tooltip naming the external anchor.
- **Link Badges (respecting existing hover/badge contracts):**
  - `locked`: subtle lock glyph beside the distance text.
  - `non_euclidean`: distinct violet/dashed portal badge (`Sparkles` / infinity-portal indicator) so magic portals/shortcuts stand out immediately.
  - `is_vertical`: compact vertical-shaft glyph (`ArrowUpDown`).
  - Inconsistent edges: subtle amber warning dot/outline on the distance badge (never full-line red recoloring!) with hover tooltip showing expected vs. current meters.
- **Preview Diff Mode:** When **Preview Reconciliation** is active, affected flexible edges display proposed diffs (`140m → 1.5km`) directly on their badges alongside an Apply / Cancel canvas bar (matching `Auto-Layout` preview UX).

### 4.4 Toolbar Consistency Panel & Optional Auto-Sync (`TopologyHeaderToolbar.tsx` + `MapConsistencyPanel.tsx`)
- Toolbar button: **`Consistency`** (with live badge count when warnings/errors exist, or clean checkmark when consistent).
- Opening the popover/panel shows:
  - **Scope summary** (Current View issues + Other Views / World Root issues with one-click jump-to-element).
  - **Auto-Sync Unlocked Links** toggle (**OFF by default**): when ON, editing an unlocked/locked edge distance, compass direction, vertical flag, or anchor within the current view automatically adjusts dependent `flexible` edges in the current view in the same single Undo snapshot (with a clear `statusNotice` summarizing how many links adjusted).
  - **Preview Reconciliation** button: computes all `flexible` adjustments needed in the current view (or entire world scope option), previews diffs on canvas, and applies as a **single Undo-backed snapshot** (or cancels cleanly).

---

## 5. Persistence, Campaign Branching & `.zcc` Compatibility

- **SQLite (`schema.sql` + `schema_init.py`):**
  - `location_nodes.anchor_location_id TEXT NULL`
  - `location_edges.distance_mode TEXT NOT NULL DEFAULT 'flexible'`
  - `location_edges.is_vertical INTEGER NOT NULL DEFAULT 0`
  - Branch-safe campaign anchor overrides stored in `campaign_spatial_overrides.metadata_override_json` (`"anchor_location_id"`).
- **REST APIs:**
  - `PUT /api/worlds/{world_id}` persists `anchor_location_id`, `distance_mode`, and `is_vertical`.
  - `POST /api/campaigns/{campaign_id}/edges`, `PATCH /api/campaigns/{campaign_id}/edges/{edge_id}`, and `PUT /api/campaigns/{campaign_id}/map` accept and persist these fields on the active branch.
- **`.zcc` Import/Export:**
  - World & campaign `.zcc` exports serialize `anchor_location_id`, `distance_mode`, and `is_vertical`.
  - Legacy `.zcc` archives missing these fields default cleanly (`anchor_location_id=None`, `distance_mode="flexible"`, `is_vertical=False`).
  - Imports remap `anchor_location_id` through `loc_id_map` and drop invalid/dangling anchor references gracefully.
