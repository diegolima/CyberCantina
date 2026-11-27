import type {
  CompassDirection,
  EdgeDistanceMode,
  LocationContainer,
  LocationEdge,
  LocationNode,
} from "../../types";
import { getDescendantContainerIds } from "./mapValidation";
import {
  COMPASS_ORDER,
  OPPOSITE_COMPASS,
  buildContainerBreadcrumb,
  canonicalEdgePairKey,
  formatDistanceCompact,
  inferCompassDirection,
  isEdgeRevealed,
  resolveRevealedEdgePairs,
} from "./topologyProjection";

export type { EdgeDistanceMode };

export const COMPASS_UNIT_VECTORS: Record<
  CompassDirection,
  { x: number; y: number }
> = {
  N: { x: 0, y: 1 },
  NE: { x: Math.SQRT1_2, y: Math.SQRT1_2 },
  E: { x: 1, y: 0 },
  SE: { x: Math.SQRT1_2, y: -Math.SQRT1_2 },
  S: { x: 0, y: -1 },
  SW: { x: -Math.SQRT1_2, y: -Math.SQRT1_2 },
  W: { x: -1, y: 0 },
  NW: { x: -Math.SQRT1_2, y: Math.SQRT1_2 },
};

const LAMBDA_GEO = 1e6;
const LAMBDA_LOCK = 1e8;
const TIKHONOV_EPS = 1e-8;
const MAX_ACTIVE_SET_ITERS = 8;
const MAX_RECURSIVE_DEPTH = 12;
const MAX_COMPASS_SECTOR_DEG = 25; // 8-way compass sector half-width is 22.5° (+2.5° grace)
const MIN_COMPASS_COS = Math.cos((MAX_COMPASS_SECTOR_DEG * Math.PI) / 180);

export function vectorToCompass(dx: number, dy: number): CompassDirection {
  const angle = Math.atan2(dy, dx);
  const octant = ((Math.round((angle * 8) / (2 * Math.PI)) % 8) + 8) % 8;
  const order: CompassDirection[] = ["E", "NE", "N", "NW", "W", "SW", "S", "SE"];
  return order[octant] ?? "E";
}

/**
 * Format suggested distances for interactive Apply/Use buttons cleanly
 * (`1500` -> `1.5km`, while non-tenth-km values like `1118` stay `1118m`).
 */
export function formatSuggestedDistanceLabel(meters: number): string {
  const safe = Math.max(1, Math.round(meters));
  if (safe < 1000) return `${safe}m`;
  if (safe < 10_000 && safe % 100 !== 0) return `${safe}m`;
  return formatDistanceCompact(safe);
}

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
  fromLocationId: string;
  toLocationId: string;
  fromName: string;
  toName: string;
  kind: ConsistencyIssueKind;
  severity: "error" | "warning" | "info";
  currentMeters: number;
  suggestedMeters: number | null;
  longitudinalErrorMeters: number;
  lateralErrorMeters: number;
  message: string;
  shortcutPathNames?: string[];
  shortcutMeters?: number;
  scopeContainerId: string | null;
}

export interface AnchorResolution {
  locationId: string;
  anchorLocationId: string;
  anchorLocationName: string;
  resolvedX: number;
  resolvedY: number;
  offsetMetersX: number;
  offsetMetersY: number;
  viaEdgeId: string | null;
  viaDirection: CompassDirection | null;
  viaDistanceMeters: number | null;
  viaVertical: boolean;
  viaNonEuclidean: boolean;
  outerComponentId: string | null;
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
  scopeContainerId: string | null;
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

export interface WorldConsistencySummary {
  totalErrors: number;
  totalWarnings: number;
  totalInfos: number;
  byScope: Array<{
    containerId: string | null;
    label: string;
    report: ConsistencyReport;
  }>;
  allDiagnostics: EdgeConsistencyDiagnostic[];
  allProposedAdjustments: ReconciliationAdjustment[];
}

export interface ConsistencyAnalysisOptions {
  mode?: "editor" | "campaign";
  unlockLore?: boolean;
  revealedEdgeIds?: readonly string[];
  changedEdgeIds?: readonly string[];
}

export function normalizeEdgeDistanceMode(raw: unknown): EdgeDistanceMode {
  if (raw === "locked" || raw === "non_euclidean" || raw === "flexible") {
    return raw;
  }
  return "flexible";
}

export function normalizeEdgeIsVertical(raw: unknown): boolean {
  return Boolean(raw);
}

function getEffectiveCompass(edge: LocationEdge): CompassDirection {
  if (edge.compass_direction && COMPASS_ORDER.includes(edge.compass_direction)) {
    return edge.compass_direction;
  }
  return inferCompassDirection(null, edge.direction_label);
}

/** Validate whether `anchorLocationId` is a valid external anchor for `location`. */
export function isValidSpatialAnchor(
  location: LocationNode,
  anchorLocationId: string | null | undefined,
  containers: readonly LocationContainer[],
  locations: readonly LocationNode[]
): { valid: boolean; reason?: string } {
  const cleaned = typeof anchorLocationId === "string" ? anchorLocationId.trim() : "";
  if (!cleaned) {
    return { valid: true };
  }
  if (!location.container_id) {
    return {
      valid: false,
      reason: "Top-level (World Root) locations cannot be externally anchored.",
    };
  }
  if (cleaned === location.id) {
    return { valid: false, reason: "A location cannot anchor to itself." };
  }
  const target = locations.find((l) => l.id === cleaned);
  if (!target) {
    return { valid: false, reason: "Anchor target location no longer exists." };
  }
  const ownSubtree = getDescendantContainerIds(
    location.container_id,
    containers as LocationContainer[]
  );
  if (target.container_id && ownSubtree.has(target.container_id)) {
    return {
      valid: false,
      reason: "Anchor target must sit outside the location's owning container.",
    };
  }
  return { valid: true };
}

export interface AnchorCandidateGroup {
  connected: Array<{ location: LocationNode; breadcrumb: string; edge: LocationEdge }>;
  other: Array<{ location: LocationNode; breadcrumb: string }>;
}

/** Return valid external anchor candidates for a containerized location, connected portals first. */
export function getValidAnchorCandidates(
  location: LocationNode,
  containers: readonly LocationContainer[],
  locations: readonly LocationNode[],
  edges: readonly LocationEdge[]
): AnchorCandidateGroup {
  if (!location.container_id) {
    return { connected: [], other: [] };
  }
  const ownSubtree = getDescendantContainerIds(
    location.container_id,
    containers as LocationContainer[]
  );
  const directEdgeByOtherId = new Map<string, LocationEdge>();
  for (const e of edges) {
    if (e.from_location_id === location.id && !directEdgeByOtherId.has(e.to_location_id)) {
      directEdgeByOtherId.set(e.to_location_id, e);
    } else if (e.to_location_id === location.id && !directEdgeByOtherId.has(e.from_location_id)) {
      directEdgeByOtherId.set(e.from_location_id, e);
    }
  }

  const connected: AnchorCandidateGroup["connected"] = [];
  const other: AnchorCandidateGroup["other"] = [];

  for (const cand of locations) {
    if (cand.id === location.id) continue;
    if (cand.container_id && ownSubtree.has(cand.container_id)) continue;
    const breadcrumb = buildContainerBreadcrumb(
      cand.container_id,
      containers as LocationContainer[]
    );
    const directEdge = directEdgeByOtherId.get(cand.id);
    if (directEdge) {
      connected.push({ location: cand, breadcrumb, edge: directEdge });
    } else {
      other.push({ location: cand, breadcrumb });
    }
  }

  connected.sort((a, b) => a.location.name.localeCompare(b.location.name));
  other.sort((a, b) =>
    `${a.breadcrumb}:${a.location.name}`.localeCompare(
      `${b.breadcrumb}:${b.location.name}`
    )
  );
  return { connected, other };
}

interface ReducedPair {
  pairKey: string;
  u: string; // canonical mapped node ID (location ID or "cont:<id>")
  v: string;
  rawU: string; // original location ID for u-side
  rawV: string;
  primaryEdge: LocationEdge;
  reciprocalEdge: LocationEdge | null;
  distanceMeters: number;
  distanceMode: EdgeDistanceMode;
  isVertical: boolean;
  dirUV: CompassDirection;
  unitVectorUV: { x: number; y: number };
  minEdgeIndex: number;
  asymmetricReason: string | null;
}

function getContainerAncestors(
  containerId: string | null | undefined,
  contById: Map<string, LocationContainer>
): string[] {
  const chain: string[] = [];
  let curr = containerId ?? null;
  const seen = new Set<string>();
  while (curr && contById.has(curr) && !seen.has(curr)) {
    seen.add(curr);
    chain.push(curr);
    curr = contById.get(curr)!.parent_container_id ?? null;
  }
  return chain;
}

/** Find lowest common ancestor container ID enclosing both container A and container B (null = World Root). */
function findLowestCommonContainer(
  contIdA: string | null | undefined,
  contIdB: string | null | undefined,
  contById: Map<string, LocationContainer>
): string | null {
  const ancA = new Set(getContainerAncestors(contIdA, contById));
  for (const cand of getContainerAncestors(contIdB, contById)) {
    if (ancA.has(cand)) return cand;
  }
  return null;
}

function longitudinalTolerance(meters: number): number {
  return Math.max(5, 0.05 * Math.max(1, meters));
}

function lateralTolerance(meters: number): number {
  return Math.max(10, 0.1 * Math.max(1, meters));
}

/**
 * Solve symmetric positive definite linear system `A x = b` via dense Cholesky.
 * Mutates nothing; adds small Tikhonov diagonal epsilon for numerical safety.
 */
function solveSpdCholesky(n: number, A: Float64Array, b: Float64Array): Float64Array | null {
  if (n === 0) return new Float64Array(0);
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = A[i * n + j];
      for (let k = 0; k < j; k++) {
        sum -= L[i * n + k] * L[j * n + k];
      }
      if (i === j) {
        const diag = sum + TIKHONOV_EPS;
        if (!(diag > 0) || !Number.isFinite(diag)) {
          return null;
        }
        L[i * n + j] = Math.sqrt(diag);
      } else {
        const denom = L[j * n + j];
        if (!(denom > 1e-12)) return null;
        L[i * n + j] = sum / denom;
      }
    }
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = b[i];
    for (let k = 0; k < i; k++) {
      sum -= L[i * n + k] * y[k];
    }
    y[i] = sum / L[i * n + i];
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = y[i];
    for (let k = i + 1; k < n; k++) {
      sum -= L[k * n + i] * x[k];
    }
    x[i] = sum / L[i * n + i];
  }
  return x;
}

class UnionFind {
  private parent = new Map<string, string>();
  find(id: string): string {
    if (!this.parent.has(id)) {
      this.parent.set(id, id);
      return id;
    }
    let curr = id;
    while (this.parent.get(curr) !== curr) {
      curr = this.parent.get(curr)!;
    }
    let step = id;
    while (step !== curr) {
      const nxt = this.parent.get(step)!;
      this.parent.set(step, curr);
      step = nxt;
    }
    return curr;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) {
      if (ra < rb) this.parent.set(rb, ra);
      else this.parent.set(ra, rb);
    }
  }
}

function getVisibleEdges(
  edges: readonly LocationEdge[],
  options?: ConsistencyAnalysisOptions
): LocationEdge[] {
  if (options?.mode === "campaign" && !options?.unlockLore) {
    const revealedIds = new Set((options.revealedEdgeIds ?? []).filter(Boolean));
    const revealedPairs = resolveRevealedEdgePairs(edges, options.revealedEdgeIds ?? []);
    return edges.filter(
      (e) =>
        !e.is_secret ||
        isEdgeRevealed(e, revealedIds, revealedPairs)
    );
  }
  return [...edges];
}

interface ScopedSolverContext {
  scopeContainerId: string | null;
  mappedIdByLocationId: Map<string, string>;
  directLocationIds: Set<string>;
  nodeIds: string[];
  pairs: ReducedPair[];
  uf: UnionFind;
  dofByNode: Map<string, string>;
  nodeIdsByDof: Map<string, string[]>;
  componentByDof: Map<string, string>;
  pinnedDofCoords: Map<string, { x: number; y: number }>;
  anchorResolutions: Record<string, AnchorResolution>;
  anchorDiagnostics: EdgeConsistencyDiagnostic[];
  dofPositions: Map<string, { x: number; y: number }>;
}

function buildReducedPairsForScope(params: {
  scopeContainerId: string | null;
  locations: readonly LocationNode[];
  containers: readonly LocationContainer[];
  visibleEdges: readonly LocationEdge[];
  excludedSubtreeContainerIds: Set<string>;
}): {
  mappedIdByLocationId: Map<string, string>;
  directLocationIds: Set<string>;
  nodeIds: string[];
  pairs: ReducedPair[];
} {
  const {
    scopeContainerId,
    locations,
    containers,
    visibleEdges,
    excludedSubtreeContainerIds,
  } = params;
  const contById = new Map(containers.map((c) => [c.id, c]));
  const childContainers = containers.filter(
    (c) =>
      (c.parent_container_id ?? null) === scopeContainerId &&
      !excludedSubtreeContainerIds.has(c.id)
  );
  const childIds = new Set(childContainers.map((c) => c.id));

  const resolveChildUnderScope = (contId: string | null | undefined): string | null => {
    let curr = contId ?? null;
    const seen = new Set<string>();
    while (curr && contById.has(curr) && !seen.has(curr)) {
      seen.add(curr);
      if (curr === scopeContainerId) return null;
      if (childIds.has(curr)) return curr;
      curr = contById.get(curr)!.parent_container_id ?? null;
    }
    return null;
  };

  const mappedIdByLocationId = new Map<string, string>();
  const directLocationIds = new Set<string>();
  const nodeIdSet = new Set<string>();

  for (const child of childContainers) {
    const cid = `cont:${child.id}`;
    nodeIdSet.add(cid);
  }

  for (const loc of locations) {
    const locCont = loc.container_id && contById.has(loc.container_id) ? loc.container_id : null;
    if (locCont && excludedSubtreeContainerIds.has(locCont)) {
      continue;
    }
    if (locCont === scopeContainerId) {
      mappedIdByLocationId.set(loc.id, loc.id);
      directLocationIds.add(loc.id);
      nodeIdSet.add(loc.id);
    } else {
      const childCid = resolveChildUnderScope(locCont);
      if (childCid) {
        const mapped = `cont:${childCid}`;
        mappedIdByLocationId.set(loc.id, mapped);
        nodeIdSet.add(mapped);
      }
    }
  }

  // Group edges by unordered mapped endpoint pair (for collapsed L1 containers, keep per physical raw pair unless collapsed)
  const edgeIndexById = new Map<string, number>();
  visibleEdges.forEach((e, idx) => edgeIndexById.set(e.id, idx));

  const pairGroups = new Map<string, LocationEdge[]>();
  for (const edge of visibleEdges) {
    const mFrom = mappedIdByLocationId.get(edge.from_location_id);
    const mTo = mappedIdByLocationId.get(edge.to_location_id);
    if (!mFrom || !mTo || mFrom === mTo) continue;
    const pk = canonicalEdgePairKey(mFrom, mTo);
    const list = pairGroups.get(pk) ?? [];
    list.push(edge);
    pairGroups.set(pk, list);
  }

  const pairs: ReducedPair[] = [];
  for (const pk of Array.from(pairGroups.keys()).sort((a, b) => a.localeCompare(b))) {
    const group = pairGroups.get(pk)!;
    // Sub-group by exact raw location pair inside collapsed containers if multiple links bridge two containers
    const rawSubGroups = new Map<string, LocationEdge[]>();
    for (const e of group) {
      const rpk = canonicalEdgePairKey(e.from_location_id, e.to_location_id);
      const list = rawSubGroups.get(rpk) ?? [];
      list.push(e);
      rawSubGroups.set(rpk, list);
    }

    for (const rpk of Array.from(rawSubGroups.keys()).sort((a, b) => a.localeCompare(b))) {
      const rGroup = rawSubGroups.get(rpk)!;
      const mA = mappedIdByLocationId.get(rGroup[0].from_location_id)!;
      const mB = mappedIdByLocationId.get(rGroup[0].to_location_id)!;
      const [u, v] = mA <= mB ? [mA, mB] : [mB, mA];
      const fwd = rGroup.find(
        (e) => mappedIdByLocationId.get(e.from_location_id) === u
      );
      const rev = rGroup.find(
        (e) => mappedIdByLocationId.get(e.from_location_id) === v
      );
      const primary = fwd ?? rev ?? rGroup[0];
      const reciprocal = fwd && rev ? rev : null;

      let asymmetricReason: string | null = null;
      if (fwd && rev) {
        const diffs: string[] = [];
        if (Math.round(fwd.distance_meters) !== Math.round(rev.distance_meters)) {
          diffs.push(
            `distance (${Math.round(fwd.distance_meters)}m vs ${Math.round(rev.distance_meters)}m)`
          );
        }
        const fMode = normalizeEdgeDistanceMode(fwd.distance_mode);
        const rMode = normalizeEdgeDistanceMode(rev.distance_mode);
        if (fMode !== rMode) {
          diffs.push(`distance rule (${fMode} vs ${rMode})`);
        }
        const fVert = normalizeEdgeIsVertical(fwd.is_vertical);
        const rVert = normalizeEdgeIsVertical(rev.is_vertical);
        if (fVert !== rVert) {
          diffs.push("vertical flag");
        }
        const fDir = getEffectiveCompass(fwd);
        const rDir = getEffectiveCompass(rev);
        if (OPPOSITE_COMPASS[fDir] !== rDir) {
          diffs.push(`compass (${fDir} vs ${rDir}, expected ${OPPOSITE_COMPASS[fDir]})`);
        }
        if (diffs.length > 0) {
          asymmetricReason = `Bidirectional pair disagrees on ${diffs.join(", ")}.`;
        }
      }

      const fMode = fwd ? normalizeEdgeDistanceMode(fwd.distance_mode) : "flexible";
      const rMode = rev ? normalizeEdgeDistanceMode(rev.distance_mode) : "flexible";
      const distanceMode: EdgeDistanceMode =
        fMode === "non_euclidean" || rMode === "non_euclidean"
          ? "non_euclidean"
          : fMode === "locked" || rMode === "locked"
          ? "locked"
          : "flexible";
      const isVertical = Boolean(
        (fwd && normalizeEdgeIsVertical(fwd.is_vertical)) ||
          (rev && normalizeEdgeIsVertical(rev.is_vertical))
      );

      let dirUV: CompassDirection;
      if (fwd) {
        dirUV = getEffectiveCompass(fwd);
      } else {
        dirUV = OPPOSITE_COMPASS[getEffectiveCompass(rev!)];
      }

      const distanceMeters = Math.max(
        1,
        Math.round(
          fwd
            ? fwd.distance_meters
            : rev!.distance_meters
        )
      );

      const minEdgeIndex = rGroup.reduce(
        (best, e) => Math.min(best, edgeIndexById.get(e.id) ?? Number.MAX_SAFE_INTEGER),
        Number.MAX_SAFE_INTEGER
      );

      pairs.push({
        pairKey: rpk,
        u,
        v,
        rawU: fwd ? fwd.from_location_id : rev!.to_location_id,
        rawV: fwd ? fwd.to_location_id : rev!.from_location_id,
        primaryEdge: primary,
        reciprocalEdge: reciprocal,
        distanceMeters,
        distanceMode,
        isVertical,
        dirUV,
        unitVectorUV: COMPASS_UNIT_VECTORS[dirUV],
        minEdgeIndex,
        asymmetricReason,
      });
    }
  }

  return {
    mappedIdByLocationId,
    directLocationIds,
    nodeIds: Array.from(nodeIdSet).sort((a, b) => a.localeCompare(b)),
    pairs,
  };
}

function solvePriorityBasisPositions(params: {
  nodeIds: string[];
  pairs: ReducedPair[];
  uf: UnionFind;
  dofByNode: Map<string, string>;
  pinnedDofCoords: Map<string, { x: number; y: number }>;
  preferredOriginDof?: string | null;
  changedEdgeIds?: Set<string>;
  scopeContainerId: string | null;
  mappedIdByLocationId: Map<string, string>;
  directLocationIds: Set<string>;
  nodeIdsByDof: Map<string, string[]>;
  anchorResolutions: Record<string, AnchorResolution>;
  anchorDiagnostics: EdgeConsistencyDiagnostic[];
}): {
  dofPositions: Map<string, { x: number; y: number }>;
  componentByDof: Map<string, string>;
} {
  const {
    nodeIds,
    pairs,
    uf,
    dofByNode,
    pinnedDofCoords,
    preferredOriginDof,
    changedEdgeIds,
    scopeContainerId,
    mappedIdByLocationId,
    directLocationIds,
    nodeIdsByDof,
    anchorResolutions,
    anchorDiagnostics,
  } = params;
  const changedSet = changedEdgeIds ?? new Set<string>();
  const dofSet = new Set<string>();
  for (const id of nodeIds) dofSet.add(uf.find(id));
  const dofs = Array.from(dofSet).sort((a, b) => a.localeCompare(b));

  const horizPairs = pairs.filter(
    (p) => p.distanceMode !== "non_euclidean" && !p.isVertical
  );
  const adj = new Map<string, string[]>();
  for (const d of dofs) adj.set(d, []);
  for (const p of horizPairs) {
    const du = dofByNode.get(p.u)!;
    const dv = dofByNode.get(p.v)!;
    if (du === dv) continue;
    adj.get(du)?.push(dv);
    adj.get(dv)?.push(du);
  }

  // Priority order: locked first -> changed/edited -> established oldest -> newest last
  const getTier = (p: ReducedPair): number => {
    if (p.distanceMode === "locked") return 0;
    const isChanged =
      changedSet.has(p.primaryEdge.id) ||
      (p.reciprocalEdge ? changedSet.has(p.reciprocalEdge.id) : false);
    if (isChanged) return 1;
    return 2;
  };
  const orderedPairs = [...horizPairs].sort((a, b) => {
    const ta = getTier(a);
    const tb = getTier(b);
    if (ta !== tb) return ta - tb;
    if (a.minEdgeIndex !== b.minEdgeIndex) return a.minEdgeIndex - b.minEdgeIndex;
    return a.pairKey.localeCompare(b.pairKey);
  });

  // Connected components of DOFs
  const componentByDof = new Map<string, string>();
  const placed = new Map<string, { x: number; y: number }>();
  const clusterUf = new UnionFind();
  for (const [d, pt] of pinnedDofCoords.entries()) {
    placed.set(d, { ...pt });
    clusterUf.find(d);
  }

  for (const start of dofs) {
    if (componentByDof.has(start)) continue;
    const comp: string[] = [];
    const queue = [start];
    componentByDof.set(start, start);
    for (let i = 0; i < queue.length; i++) {
      const curr = queue[i];
      comp.push(curr);
      for (const nb of adj.get(curr) ?? []) {
        if (!componentByDof.has(nb)) {
          componentByDof.set(nb, start);
          queue.push(nb);
        }
      }
    }
    const hasPin = comp.some((d) => placed.has(d));
    if (!hasPin && comp.length > 0) {
      const compSet = new Set(comp);
      let originDof: string | null = null;
      if (preferredOriginDof && compSet.has(preferredOriginDof)) {
        originDof = preferredOriginDof;
      } else {
        const firstPair = orderedPairs.find(
          (p) =>
            compSet.has(dofByNode.get(p.u)!) && compSet.has(dofByNode.get(p.v)!)
        );
        if (firstPair) {
          originDof = dofByNode.get(firstPair.u)!;
        } else {
          originDof = [...comp].sort((a, b) => a.localeCompare(b))[0];
        }
      }
      placed.set(originDof, { x: 0, y: 0 });
      clusterUf.find(originDof);
    }
  }

  for (const d of dofs) {
    if (!placed.has(d)) {
      clusterUf.find(d);
    }
  }

  // Grow Prim-style priority spanning forest (anchors & oldest established links take precedence)
  const basisPairKeys = new Set<string>();
  const basisPairs: ReducedPair[] = [];
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const p of orderedPairs) {
      if (basisPairKeys.has(p.pairKey)) continue;
      const du = dofByNode.get(p.u)!;
      const dv = dofByNode.get(p.v)!;
      if (du === dv) continue;
      const pu = placed.get(du);
      const pv = placed.get(dv);
      if (pu && !pv) {
        placed.set(dv, {
          x: pu.x + p.distanceMeters * p.unitVectorUV.x,
          y: pu.y + p.distanceMeters * p.unitVectorUV.y,
        });
        clusterUf.union(du, dv);
        basisPairKeys.add(p.pairKey);
        basisPairs.push(p);
        progressed = true;
        break;
      }
      if (!pu && pv) {
        placed.set(du, {
          x: pv.x - p.distanceMeters * p.unitVectorUV.x,
          y: pv.y - p.distanceMeters * p.unitVectorUV.y,
        });
        clusterUf.union(du, dv);
        basisPairKeys.add(p.pairKey);
        basisPairs.push(p);
        progressed = true;
        break;
      }
    }
  }

  // Targeted multi-anchor bridge reconciliation only when free L-bends span distinct anchor pins
  const lateralCrossPinBridges = orderedPairs.filter((p) => {
    if (basisPairKeys.has(p.pairKey)) return false;
    const du = dofByNode.get(p.u)!;
    const dv = dofByNode.get(p.v)!;
    if (du === dv) return false;
    if (clusterUf.find(du) === clusterUf.find(dv)) return false;
    if (pinnedDofCoords.has(du) && pinnedDofCoords.has(dv)) return false;
    const pu = placed.get(du);
    const pv = placed.get(dv);
    if (!pu || !pv) return false;
    const dx = pv.x - pu.x;
    const dy = pv.y - pu.y;
    const euclid = Math.hypot(dx, dy);
    const eLat = Math.abs(-dx * p.unitVectorUV.y + dy * p.unitVectorUV.x);
    return eLat > lateralTolerance(Math.max(1, euclid));
  });

  if (lateralCrossPinBridges.length > 0) {
    const bridgeCtx: ScopedSolverContext = {
      scopeContainerId,
      mappedIdByLocationId,
      directLocationIds,
      nodeIds,
      pairs: [...basisPairs, ...lateralCrossPinBridges],
      uf,
      dofByNode,
      nodeIdsByDof,
      componentByDof,
      pinnedDofCoords,
      anchorResolutions,
      anchorDiagnostics,
      dofPositions: placed,
    };
    const { finalPos, conflictKindsByPairKey } = solveReconciliationInternal(
      bridgeCtx,
      changedSet
    );
    if (conflictKindsByPairKey.size === 0) {
      return { dofPositions: finalPos, componentByDof };
    }
  }

  return { dofPositions: placed, componentByDof };
}

function solveScopeLayoutInternal(params: {
  scopeContainerId: string | null;
  containers: readonly LocationContainer[];
  locations: readonly LocationNode[];
  visibleEdges: readonly LocationEdge[];
  excludedSubtreeContainerIds: Set<string>;
  depth: number;
  changedEdgeIds?: Set<string>;
}): ScopedSolverContext {
  const {
    scopeContainerId,
    containers,
    locations,
    visibleEdges,
    excludedSubtreeContainerIds,
    depth,
    changedEdgeIds,
  } = params;

  const contById = new Map(containers.map((c) => [c.id, c]));
  const locById = new Map(locations.map((l) => [l.id, l]));

  const {
    mappedIdByLocationId,
    directLocationIds,
    nodeIds,
    pairs,
  } = buildReducedPairsForScope({
    scopeContainerId,
    locations,
    containers,
    visibleEdges,
    excludedSubtreeContainerIds,
  });

  const uf = new UnionFind();
  for (const id of nodeIds) uf.find(id);
  for (const p of pairs) {
    if (p.distanceMode !== "non_euclidean" && p.isVertical) {
      uf.union(p.u, p.v);
    }
  }

  const dofByNode = new Map<string, string>();
  const nodeIdsByDof = new Map<string, string[]>();
  for (const id of nodeIds) {
    const dof = uf.find(id);
    dofByNode.set(id, dof);
    const list = nodeIdsByDof.get(dof) ?? [];
    list.push(id);
    nodeIdsByDof.set(dof, list);
  }

  const anchorResolutions: Record<string, AnchorResolution> = {};
  const anchorDiagnostics: EdgeConsistencyDiagnostic[] = [];
  const rawAnchorPins = new Map<string, { res: AnchorResolution; outerCompKey: string }>();

  // Resolve anchors for locations residing inside this scope (or inside collapsed children if at root/outer)
  const scopeSubtree = scopeContainerId
    ? getDescendantContainerIds(scopeContainerId, containers as LocationContainer[])
    : null;

  if (depth < MAX_RECURSIVE_DEPTH) {
    for (const loc of locations) {
      const mappedNodeId = mappedIdByLocationId.get(loc.id);
      if (!mappedNodeId) continue;
      if (!loc.anchor_location_id) continue;

      const check = isValidSpatialAnchor(loc, loc.anchor_location_id, containers, locations);
      const target = locById.get(loc.anchor_location_id);
      if (!check.valid || !target) {
        anchorResolutions[loc.id] = {
          locationId: loc.id,
          anchorLocationId: loc.anchor_location_id,
          anchorLocationName: target?.name ?? loc.anchor_location_id,
          resolvedX: 0,
          resolvedY: 0,
          offsetMetersX: 0,
          offsetMetersY: 0,
          viaEdgeId: null,
          viaDirection: null,
          viaDistanceMeters: null,
          viaVertical: false,
          viaNonEuclidean: false,
          outerComponentId: null,
          valid: false,
          reason: check.reason || "Invalid spatial anchor.",
        };
        if (directLocationIds.has(loc.id)) {
          anchorDiagnostics.push({
            pairKey: `anchor:${loc.id}`,
            primaryEdgeId: `anchor:${loc.id}`,
            reciprocalEdgeId: null,
            fromLocationId: loc.id,
            toLocationId: loc.anchor_location_id,
            fromName: loc.name,
            toName: target?.name ?? loc.anchor_location_id,
            kind: "anchor_invalid",
            severity: "warning",
            currentMeters: 0,
            suggestedMeters: null,
            longitudinalErrorMeters: 0,
            lateralErrorMeters: 0,
            message: `${loc.name}: ${check.reason || "Invalid spatial anchor."}`,
            scopeContainerId,
          });
        }
        continue;
      }

      // If target is already inside this scope's subtree, it's internal to this scope (not an external anchor here)
      if (scopeSubtree && target.container_id && scopeSubtree.has(target.container_id)) {
        continue;
      }
      if (!scopeSubtree && loc.container_id == null) {
        continue;
      }
      // Only resolve anchors whose target lies outside scopeContainerId
      if (
        (target.container_id ?? null) === scopeContainerId &&
        mappedIdByLocationId.has(target.id)
      ) {
        continue;
      }

      const lcaId = findLowestCommonContainer(
        scopeContainerId ?? loc.container_id,
        target.container_id,
        contById
      );
      const nextExcluded = new Set(excludedSubtreeContainerIds);
      if (scopeContainerId) {
        for (const sid of getDescendantContainerIds(
          scopeContainerId,
          containers as LocationContainer[]
        )) {
          nextExcluded.add(sid);
        }
      } else if (loc.container_id) {
        for (const sid of getDescendantContainerIds(
          loc.container_id,
          containers as LocationContainer[]
        )) {
          nextExcluded.add(sid);
        }
      }

      const outerCtx = solveScopeLayoutInternal({
        scopeContainerId: lcaId,
        containers,
        locations,
        visibleEdges,
        excludedSubtreeContainerIds: nextExcluded,
        depth: depth + 1,
      });

      const outerMappedTarget = outerCtx.mappedIdByLocationId.get(target.id);
      const outerTargetDof = outerMappedTarget
        ? outerCtx.dofByNode.get(outerMappedTarget)
        : undefined;
      const outerPt = outerTargetDof
        ? outerCtx.dofPositions.get(outerTargetDof)
        : undefined;
      const outerComp = outerTargetDof
        ? outerCtx.componentByDof.get(outerTargetDof) ?? null
        : null;

      if (!outerPt) {
        continue;
      }

      // Find direct edge(s) connecting target <-> loc
      const connecting = visibleEdges.filter(
        (e) =>
          (e.from_location_id === target.id && e.to_location_id === loc.id) ||
          (e.from_location_id === loc.id && e.to_location_id === target.id)
      );
      const nonPortalConnecting = connecting.filter(
        (e) => normalizeEdgeDistanceMode(e.distance_mode) !== "non_euclidean"
      );
      const hasOnlyPortal = connecting.length > 0 && nonPortalConnecting.length === 0;
      const chosenEdge =
        nonPortalConnecting.find((e) => e.from_location_id === target.id) ??
        nonPortalConnecting[0] ??
        connecting[0] ??
        null;

      let offsetX = 0;
      let offsetY = 0;
      let viaDir: CompassDirection | null = null;
      let viaDist: number | null = null;
      let viaVert = false;

      if (chosenEdge && !hasOnlyPortal) {
        viaDist = Math.max(1, Math.round(chosenEdge.distance_meters));
        viaVert = normalizeEdgeIsVertical(chosenEdge.is_vertical);
        if (!viaVert) {
          if (chosenEdge.from_location_id === target.id) {
            viaDir = getEffectiveCompass(chosenEdge);
          } else {
            viaDir = OPPOSITE_COMPASS[getEffectiveCompass(chosenEdge)];
          }
          const u = COMPASS_UNIT_VECTORS[viaDir];
          offsetX = viaDist * u.x;
          offsetY = viaDist * u.y;
        }
      }

      const resolvedX = outerPt.x + offsetX;
      const resolvedY = outerPt.y + offsetY;
      const res: AnchorResolution = {
        locationId: loc.id,
        anchorLocationId: target.id,
        anchorLocationName: target.name,
        resolvedX,
        resolvedY,
        offsetMetersX: Math.round(offsetX * 10) / 10,
        offsetMetersY: Math.round(offsetY * 10) / 10,
        viaEdgeId: chosenEdge?.id ?? null,
        viaDirection: viaDir,
        viaDistanceMeters: viaDist,
        viaVertical: viaVert,
        viaNonEuclidean: hasOnlyPortal,
        outerComponentId: outerComp,
        valid: true,
      };
      anchorResolutions[loc.id] = res;
      rawAnchorPins.set(loc.id, {
        res,
        outerCompKey: `${lcaId ?? "__root__"}:${outerComp ?? target.id}`,
      });
    }
  }

  // Pin anchors belonging to the dominant outer connected component
  const pinnedDofCoords = new Map<string, { x: number; y: number }>();
  const compCounts = new Map<string, number>();
  for (const item of rawAnchorPins.values()) {
    compCounts.set(item.outerCompKey, (compCounts.get(item.outerCompKey) ?? 0) + 1);
  }
  let primaryOuterCompKey: string | null = null;
  let bestCount = -1;
  for (const [k, cnt] of Array.from(compCounts.entries()).sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    if (cnt > bestCount) {
      bestCount = cnt;
      primaryOuterCompKey = k;
    }
  }

  for (const [locId, item] of rawAnchorPins.entries()) {
    const mappedNodeId = mappedIdByLocationId.get(locId)!;
    const dof = dofByNode.get(mappedNodeId)!;
    if (primaryOuterCompKey && item.outerCompKey !== primaryOuterCompKey) {
      if (directLocationIds.has(locId)) {
        anchorDiagnostics.push({
          pairKey: `anchor_disc:${locId}`,
          primaryEdgeId: `anchor_disc:${locId}`,
          reciprocalEdgeId: null,
          fromLocationId: locId,
          toLocationId: item.res.anchorLocationId,
          fromName: locById.get(locId)?.name ?? locId,
          toName: item.res.anchorLocationName,
          kind: "anchor_disconnected",
          severity: "info",
          currentMeters: 0,
          suggestedMeters: null,
          longitudinalErrorMeters: 0,
          lateralErrorMeters: 0,
          message: `Anchor "${item.res.anchorLocationName}" is in a disconnected outer component from another anchor in this view; relative scale cannot be constrained between them.`,
          scopeContainerId,
        });
      }
      continue;
    }
    if (!pinnedDofCoords.has(dof)) {
      pinnedDofCoords.set(dof, {
        x: item.res.resolvedX,
        y: item.res.resolvedY,
      });
    }
  }

  const startLoc = locations.find((l) => l.is_starting_location);
  const startMapped = startLoc ? mappedIdByLocationId.get(startLoc.id) : undefined;
  const preferredOriginDof = startMapped ? dofByNode.get(startMapped) ?? null : null;

  const { dofPositions, componentByDof } = solvePriorityBasisPositions({
    nodeIds,
    pairs,
    uf,
    dofByNode,
    pinnedDofCoords,
    preferredOriginDof,
    changedEdgeIds,
    scopeContainerId,
    mappedIdByLocationId,
    directLocationIds,
    nodeIdsByDof,
    anchorResolutions,
    anchorDiagnostics,
  });

  return {
    scopeContainerId,
    mappedIdByLocationId,
    directLocationIds,
    nodeIds,
    pairs,
    uf,
    dofByNode,
    nodeIdsByDof,
    componentByDof,
    pinnedDofCoords,
    anchorResolutions,
    anchorDiagnostics,
    dofPositions,
  };
}

function solveReconciliationInternal(
  ctx: ScopedSolverContext,
  changedEdgeIds: Set<string>
): {
  finalPos: Map<string, { x: number; y: number }>;
  proposedMetersByPairKey: Map<string, number>;
  conflictKindsByPairKey: Map<string, "compass_conflict" | "overconstrained_locked">;
} {
  const horizPairs = ctx.pairs.filter(
    (p) => p.distanceMode !== "non_euclidean" && !p.isVertical
  );
  const dofs = Array.from(ctx.nodeIdsByDof.keys()).sort((a, b) => a.localeCompare(b));
  const freeDofs = dofs.filter((d) => !ctx.pinnedDofCoords.has(d));
  const freeIdx = new Map(freeDofs.map((d, idx) => [d, idx]));

  const nonZeroMeters = horizPairs.map((p) => p.distanceMeters).sort((a, b) => a - b);
  const medianM =
    nonZeroMeters.length > 0
      ? nonZeroMeters[Math.floor(nonZeroMeters.length / 2)]
      : 100;

  const clampedMinimumPairs = new Set<string>();
  let finalPos = new Map(ctx.dofPositions);
  const proposedMetersByPairKey = new Map<string, number>();

  for (let pass = 0; pass < MAX_ACTIVE_SET_ITERS; pass++) {
    const nFree = freeDofs.length;
    const dim = 2 * nFree;
    const H = new Float64Array(dim * dim);
    const b = new Float64Array(dim);

    const addPairToSystem = (
      du: string,
      dv: string,
      ux: number,
      uy: number,
      nx: number,
      ny: number,
      kPara: number,
      kPerp: number,
      d0: number
    ) => {
      // K = kPara * (u u^T) + kPerp * (n n^T)
      const kxx = kPara * ux * ux + kPerp * nx * nx;
      const kxy = kPara * ux * uy + kPerp * nx * ny;
      const kyy = kPara * uy * uy + kPerp * ny * ny;
      // f = kPara * d0 * u
      const fx = kPara * d0 * ux;
      const fy = kPara * d0 * uy;

      const iu = freeIdx.get(du);
      const iv = freeIdx.get(dv);
      const pu = ctx.pinnedDofCoords.get(du);
      const pv = ctx.pinnedDofCoords.get(dv);

      const addBlock = (rowIdx: number, colIdx: number, sign: number) => {
        const r = 2 * rowIdx;
        const c = 2 * colIdx;
        H[r * dim + c] += sign * kxx;
        H[r * dim + (c + 1)] += sign * kxy;
        H[(r + 1) * dim + c] += sign * kxy;
        H[(r + 1) * dim + (c + 1)] += sign * kyy;
      };

      if (iu !== undefined && iv !== undefined) {
        addBlock(iu, iu, 1);
        addBlock(iv, iv, 1);
        addBlock(iu, iv, -1);
        addBlock(iv, iu, -1);
        b[2 * iu] -= fx;
        b[2 * iu + 1] -= fy;
        b[2 * iv] += fx;
        b[2 * iv + 1] += fy;
      } else if (iu !== undefined && pv) {
        addBlock(iu, iu, 1);
        b[2 * iu] += kxx * pv.x + kxy * pv.y - fx;
        b[2 * iu + 1] += kxy * pv.x + kyy * pv.y - fy;
      } else if (iv !== undefined && pu) {
        addBlock(iv, iv, 1);
        b[2 * iv] += kxx * pu.x + kxy * pu.y + fx;
        b[2 * iv + 1] += kxy * pu.x + kyy * pu.y + fy;
      }
    };

    for (const p of horizPairs) {
      const du = ctx.dofByNode.get(p.u)!;
      const dv = ctx.dofByNode.get(p.v)!;
      if (du === dv) continue;

      const ux = p.unitVectorUV.x;
      const uy = p.unitVectorUV.y;
      const nx = -uy;
      const ny = ux;

      const isLocked =
        p.distanceMode === "locked" || clampedMinimumPairs.has(p.pairKey);
      const d0 = clampedMinimumPairs.has(p.pairKey) ? 1 : p.distanceMeters;

      if (isLocked) {
        addPairToSystem(du, dv, ux, uy, nx, ny, LAMBDA_LOCK, LAMBDA_LOCK, d0);
      } else {
        const isEdited =
          changedEdgeIds.has(p.primaryEdge.id) ||
          (p.reciprocalEdge ? changedEdgeIds.has(p.reciprocalEdge.id) : false);
        const ratio = medianM / Math.max(p.distanceMeters, 10);
        const alphaBase = Math.min(16, Math.max(0.0625, ratio * ratio));
        const alpha = isEdited ? alphaBase * 25 : alphaBase;
        const kappa = (LAMBDA_GEO * alpha) / (LAMBDA_GEO + alpha);
        addPairToSystem(du, dv, ux, uy, nx, ny, kappa, LAMBDA_GEO, d0);
      }
    }

    const sol = dim > 0 ? solveSpdCholesky(dim, H, b) : new Float64Array(0);
    const nextPos = new Map<string, { x: number; y: number }>();
    for (const [d, pt] of ctx.pinnedDofCoords.entries()) {
      nextPos.set(d, { ...pt });
    }
    for (let i = 0; i < nFree; i++) {
      nextPos.set(freeDofs[i], {
        x: sol ? sol[2 * i] : ctx.dofPositions.get(freeDofs[i])?.x ?? 0,
        y: sol ? sol[2 * i + 1] : ctx.dofPositions.get(freeDofs[i])?.y ?? 0,
      });
    }
    finalPos = nextPos;

    let newlyClamped = false;
    proposedMetersByPairKey.clear();
    for (const p of horizPairs) {
      const du = ctx.dofByNode.get(p.u)!;
      const dv = ctx.dofByNode.get(p.v)!;
      const pu = finalPos.get(du) ?? { x: 0, y: 0 };
      const pv = finalPos.get(dv) ?? { x: 0, y: 0 };
      const proj = (pv.x - pu.x) * p.unitVectorUV.x + (pv.y - pu.y) * p.unitVectorUV.y;

      if (p.distanceMode === "locked") {
        proposedMetersByPairKey.set(p.pairKey, p.distanceMeters);
        continue;
      }

      if (clampedMinimumPairs.has(p.pairKey)) {
        proposedMetersByPairKey.set(p.pairKey, 1);
        continue;
      }

      const isEdited =
        changedEdgeIds.has(p.primaryEdge.id) ||
        (p.reciprocalEdge ? changedEdgeIds.has(p.reciprocalEdge.id) : false);
      const ratio = medianM / Math.max(p.distanceMeters, 10);
      const alphaBase = Math.min(16, Math.max(0.0625, ratio * ratio));
      const alpha = isEdited ? alphaBase * 25 : alphaBase;
      const dStar = (LAMBDA_GEO * proj + alpha * p.distanceMeters) / (LAMBDA_GEO + alpha);

      if (dStar < 1) {
        clampedMinimumPairs.add(p.pairKey);
        newlyClamped = true;
      } else {
        proposedMetersByPairKey.set(p.pairKey, Math.max(1, Math.round(dStar)));
      }
    }

    if (!newlyClamped) break;
  }

  const conflictKindsByPairKey = new Map<
    string,
    "compass_conflict" | "overconstrained_locked"
  >();
  for (const p of horizPairs) {
    const du = ctx.dofByNode.get(p.u)!;
    const dv = ctx.dofByNode.get(p.v)!;
    const pu = finalPos.get(du) ?? { x: 0, y: 0 };
    const pv = finalPos.get(dv) ?? { x: 0, y: 0 };
    const dStar = proposedMetersByPairKey.get(p.pairKey) ?? p.distanceMeters;
    const rx = pv.x - pu.x - dStar * p.unitVectorUV.x;
    const ry = pv.y - pu.y - dStar * p.unitVectorUV.y;
    const eLong = Math.abs(rx * p.unitVectorUV.x + ry * p.unitVectorUV.y);
    const eLat = Math.abs(-rx * p.unitVectorUV.y + ry * p.unitVectorUV.x);
    if (
      eLong > longitudinalTolerance(dStar) ||
      eLat > lateralTolerance(dStar)
    ) {
      if (p.distanceMode === "locked") {
        conflictKindsByPairKey.set(p.pairKey, "overconstrained_locked");
      } else if (clampedMinimumPairs.has(p.pairKey) || eLat > lateralTolerance(dStar)) {
        conflictKindsByPairKey.set(p.pairKey, "compass_conflict");
      } else {
        conflictKindsByPairKey.set(p.pairKey, "overconstrained_locked");
      }
    }
  }

  return { finalPos, proposedMetersByPairKey, conflictKindsByPairKey };
}

export interface ImpliedEdgeGeometry {
  distanceMeters: number;
  compassDirection: CompassDirection;
  dx: number;
  dy: number;
}

/**
 * Estimate implied Euclidean distance and 8-way compass direction between two locations
 * when they already share a 2D connected component or independent anchored coordinates.
 * Returns `null` when connecting an unlinked node or across disconnected components.
 */
export function estimateImpliedEdgeDistance(params: {
  fromLocationId: string;
  toLocationId: string;
  scopeContainerId: string | null;
  containers: readonly LocationContainer[];
  locations: readonly LocationNode[];
  edges: readonly LocationEdge[];
  options?: ConsistencyAnalysisOptions;
}): ImpliedEdgeGeometry | null {
  const {
    fromLocationId,
    toLocationId,
    scopeContainerId,
    containers,
    locations,
    edges,
    options,
  } = params;
  if (!fromLocationId || !toLocationId || fromLocationId === toLocationId) {
    return null;
  }
  const contById = new Map(containers.map((c) => [c.id, c]));
  const locById = new Map(locations.map((l) => [l.id, l]));
  const fromLoc = locById.get(fromLocationId);
  const toLoc = locById.get(toLocationId);
  if (!fromLoc || !toLoc) return null;

  const visibleEdges = getVisibleEdges(edges, options);

  const tryScope = (targetScopeId: string | null): ImpliedEdgeGeometry | null => {
    const ctx = solveScopeLayoutInternal({
      scopeContainerId: targetScopeId,
      containers,
      locations,
      visibleEdges,
      excludedSubtreeContainerIds: new Set<string>(),
      depth: 0,
    });
    const mFrom = ctx.mappedIdByLocationId.get(fromLocationId);
    const mTo = ctx.mappedIdByLocationId.get(toLocationId);
    if (!mFrom || !mTo || mFrom === mTo) return null;
    const du = ctx.dofByNode.get(mFrom);
    const dv = ctx.dofByNode.get(mTo);
    if (!du || !dv || du === dv) return null;

    const compU = ctx.componentByDof.get(du);
    const compV = ctx.componentByDof.get(dv);
    const pinnedComps = new Set<string>();
    for (const pinnedDof of ctx.pinnedDofCoords.keys()) {
      const c = ctx.componentByDof.get(pinnedDof);
      if (c) pinnedComps.add(c);
    }
    const sameComp = Boolean(compU && compU === compV);
    const bothAnchored = Boolean(
      compU && compV && pinnedComps.has(compU) && pinnedComps.has(compV)
    );
    if (!sameComp && !bothAnchored) return null;

    const pu = ctx.dofPositions.get(du);
    const pv = ctx.dofPositions.get(dv);
    if (!pu || !pv) return null;
    const dx = pv.x - pu.x;
    const dy = pv.y - pu.y;
    const euclid = Math.hypot(dx, dy);
    if (!Number.isFinite(euclid) || euclid < 1) return null;
    return {
      distanceMeters: Math.max(1, Math.round(euclid)),
      compassDirection: vectorToCompass(dx, dy),
      dx,
      dy,
    };
  };

  const directRes = tryScope(scopeContainerId);
  if (directRes) return directRes;

  const lcaScope = findLowestCommonContainer(
    fromLoc.container_id,
    toLoc.container_id,
    contById
  );
  if (lcaScope !== scopeContainerId) {
    return tryScope(lcaScope);
  }
  return null;
}

/**
 * Analyze 2D compass-vector & metric consistency for a given container scope
 * (or World Root when `scopeContainerId === null`), including outer-scope anchors,
 * 25° 8-way compass sector validation, triangle-inequality shortcuts, and priority basis reconciliation.
 */
export function analyzeSpatialConsistency(params: {
  scopeContainerId: string | null;
  containers: readonly LocationContainer[];
  locations: readonly LocationNode[];
  edges: readonly LocationEdge[];
  options?: ConsistencyAnalysisOptions;
}): ConsistencyReport {
  const { scopeContainerId, containers, locations, edges, options } = params;
  const locById = new Map(locations.map((l) => [l.id, l]));
  const visibleEdges = getVisibleEdges(edges, options);
  const changedSet = new Set(options?.changedEdgeIds ?? []);

  const ctx = solveScopeLayoutInternal({
    scopeContainerId,
    containers,
    locations,
    visibleEdges,
    excludedSubtreeContainerIds: new Set<string>(),
    depth: 0,
    changedEdgeIds: changedSet,
  });

  const diagnostics: EdgeConsistencyDiagnostic[] = [...ctx.anchorDiagnostics];
  const diagnosticsByEdgeId: Record<string, EdgeConsistencyDiagnostic> = {};
  const proposedAdjustments: ReconciliationAdjustment[] = [];
  const proposedByEdgeId: Record<string, ReconciliationAdjustment> = {};

  // Pre-pass: record Euclidean implied distances for flexible mismatching links so alternate-path
  // triangle checks don't treat an erroneous 20m chord as a bogus short alternate path
  const suggestedByDistanceMismatchPair = new Map<string, number>();
  for (const p of ctx.pairs) {
    if (p.distanceMode === "non_euclidean" || p.isVertical) continue;
    const du = ctx.dofByNode.get(p.u)!;
    const dv = ctx.dofByNode.get(p.v)!;
    const pu = ctx.dofPositions.get(du) ?? { x: 0, y: 0 };
    const pv = ctx.dofPositions.get(dv) ?? { x: 0, y: 0 };
    const dx = pv.x - pu.x;
    const dy = pv.y - pu.y;
    const euclid = Math.hypot(dx, dy);
    const proj = dx * p.unitVectorUV.x + dy * p.unitVectorUV.y;
    const eDist = Math.round(Math.abs(euclid - p.distanceMeters));
    const distTol = longitudinalTolerance(euclid);
    const cosTheta = euclid > 1e-6 ? proj / euclid : 1;
    const compassValid = euclid <= 5 || cosTheta >= MIN_COMPASS_COS;
    if (compassValid && eDist > distTol && p.distanceMode === "flexible") {
      suggestedByDistanceMismatchPair.set(
        p.pairKey,
        Math.max(1, Math.round(euclid))
      );
    }
  }

  // Build alternate-path graph for triangle-inequality checks over non-non_euclidean pairs
  const physicalPairs = ctx.pairs.filter((p) => p.distanceMode !== "non_euclidean");
  const shortestAltDistance = (excludePairKey: string, start: string, goal: string): number => {
    const dist = new Map<string, number>([[start, 0]]);
    const visited = new Set<string>();
    const adj = new Map<string, Array<{ to: string; w: number }>>();
    for (const p of physicalPairs) {
      if (p.pairKey === excludePairKey) continue;
      if (!adj.has(p.u)) adj.set(p.u, []);
      if (!adj.has(p.v)) adj.set(p.v, []);
      const weight = suggestedByDistanceMismatchPair.get(p.pairKey) ?? p.distanceMeters;
      adj.get(p.u)!.push({ to: p.v, w: weight });
      adj.get(p.v)!.push({ to: p.u, w: weight });
    }

    while (true) {
      let bestNode: string | null = null;
      let bestDist = Infinity;
      for (const [node, d] of dist.entries()) {
        if (!visited.has(node) && d < bestDist) {
          bestDist = d;
          bestNode = node;
        }
      }
      if (!bestNode || bestNode === goal) return bestDist;
      visited.add(bestNode);
      for (const nxt of adj.get(bestNode) ?? []) {
        const nd = bestDist + nxt.w;
        if (nd < (dist.get(nxt.to) ?? Infinity)) {
          dist.set(nxt.to, nd);
        }
      }
    }
  };

  for (const p of ctx.pairs) {
    const fromName = locById.get(p.primaryEdge.from_location_id)?.name ?? p.u;
    const toName = locById.get(p.primaryEdge.to_location_id)?.name ?? p.v;

    if (p.asymmetricReason && p.distanceMode !== "non_euclidean") {
      const asymDiag: EdgeConsistencyDiagnostic = {
        pairKey: p.pairKey,
        primaryEdgeId: p.primaryEdge.id,
        reciprocalEdgeId: p.reciprocalEdge?.id ?? null,
        fromLocationId: p.primaryEdge.from_location_id,
        toLocationId: p.primaryEdge.to_location_id,
        fromName,
        toName,
        kind: "asymmetric_pair",
        severity: "info",
        currentMeters: p.distanceMeters,
        suggestedMeters: null,
        longitudinalErrorMeters: 0,
        lateralErrorMeters: 0,
        message: `${fromName} ↔ ${toName}: ${p.asymmetricReason}`,
        scopeContainerId,
      };
      diagnostics.push(asymDiag);
      diagnosticsByEdgeId[p.primaryEdge.id] = asymDiag;
      if (p.reciprocalEdge) {
        diagnosticsByEdgeId[p.reciprocalEdge.id] = asymDiag;
      }
    }

    if (p.distanceMode === "non_euclidean" || p.isVertical) {
      continue;
    }

    const du = ctx.dofByNode.get(p.u)!;
    const dv = ctx.dofByNode.get(p.v)!;
    const pu = ctx.dofPositions.get(du) ?? { x: 0, y: 0 };
    const pv = ctx.dofPositions.get(dv) ?? { x: 0, y: 0 };
    const dx = pv.x - pu.x;
    const dy = pv.y - pu.y;
    const euclid = Math.hypot(dx, dy);
    const suggestedEuclid = Math.max(1, Math.round(euclid));
    const proj = dx * p.unitVectorUV.x + dy * p.unitVectorUV.y;
    const eLat = Math.round(Math.abs(-dx * p.unitVectorUV.y + dy * p.unitVectorUV.x));
    const eDist = Math.round(Math.abs(euclid - p.distanceMeters));
    const distTol = longitudinalTolerance(euclid);
    const cosTheta = euclid > 1e-6 ? proj / euclid : 1;
    const compassValid = euclid <= 5 || cosTheta >= MIN_COMPASS_COS;
    const impliedCompass = euclid > 1e-6 ? vectorToCompass(dx, dy) : null;

    let diag: EdgeConsistencyDiagnostic | null = null;
    if (!compassValid) {
      diag = {
        pairKey: p.pairKey,
        primaryEdgeId: p.primaryEdge.id,
        reciprocalEdgeId: p.reciprocalEdge?.id ?? null,
        fromLocationId: p.primaryEdge.from_location_id,
        toLocationId: p.primaryEdge.to_location_id,
        fromName,
        toName,
        kind: "compass_conflict",
        severity: "error",
        currentMeters: p.distanceMeters,
        suggestedMeters: null,
        longitudinalErrorMeters: eDist,
        lateralErrorMeters: eLat,
        message: `${fromName} ↔ ${toName}: Compass direction (${p.dirUV}) conflicts with surrounding geometry (implies ~${suggestedEuclid}m${
          impliedCompass ? ` ${impliedCompass}` : ""
        }). Adjust compass bearing or mark Non-Euclidean.`,
        scopeContainerId,
      };
    } else if (eDist > distTol) {
      if (p.distanceMode === "locked") {
        diag = {
          pairKey: p.pairKey,
          primaryEdgeId: p.primaryEdge.id,
          reciprocalEdgeId: p.reciprocalEdge?.id ?? null,
          fromLocationId: p.primaryEdge.from_location_id,
          toLocationId: p.primaryEdge.to_location_id,
          fromName,
          toName,
          kind: "overconstrained_locked",
          severity: "error",
          currentMeters: p.distanceMeters,
          suggestedMeters: null,
          longitudinalErrorMeters: eDist,
          lateralErrorMeters: eLat,
          message: `${fromName} ↔ ${toName}: Locked distance (${p.distanceMeters}m) conflicts with anchors or other locked links (geometry implies ~${suggestedEuclid}m).`,
          scopeContainerId,
        };
      } else {
        diag = {
          pairKey: p.pairKey,
          primaryEdgeId: p.primaryEdge.id,
          reciprocalEdgeId: p.reciprocalEdge?.id ?? null,
          fromLocationId: p.primaryEdge.from_location_id,
          toLocationId: p.primaryEdge.to_location_id,
          fromName,
          toName,
          kind: "distance_mismatch",
          severity: "warning",
          currentMeters: p.distanceMeters,
          suggestedMeters: suggestedEuclid,
          longitudinalErrorMeters: eDist,
          lateralErrorMeters: eLat,
          message: `${fromName} ↔ ${toName} is ${p.distanceMeters}m, but anchors/loop geometry imply ~${suggestedEuclid}m.`,
          scopeContainerId,
        };

        if (Math.abs(suggestedEuclid - p.distanceMeters) >= 1) {
          const adj: ReconciliationAdjustment = {
            edgeId: p.primaryEdge.id,
            reciprocalEdgeId: p.reciprocalEdge?.id ?? null,
            fromLocationId: p.primaryEdge.from_location_id,
            toLocationId: p.primaryEdge.to_location_id,
            fromName,
            toName,
            currentMeters: p.distanceMeters,
            proposedMeters: suggestedEuclid,
            deltaMeters: suggestedEuclid - p.distanceMeters,
            scopeContainerId,
          };
          proposedAdjustments.push(adj);
          proposedByEdgeId[p.primaryEdge.id] = adj;
          if (p.reciprocalEdge) {
            proposedByEdgeId[p.reciprocalEdge.id] = adj;
          }
        }
      }
    } else {
      const altDist = shortestAltDistance(p.pairKey, p.u, p.v);
      const violatesTriangle =
        Number.isFinite(altDist) && altDist + distTol < p.distanceMeters;
      if (violatesTriangle) {
        diag = {
          pairKey: p.pairKey,
          primaryEdgeId: p.primaryEdge.id,
          reciprocalEdgeId: p.reciprocalEdge?.id ?? null,
          fromLocationId: p.primaryEdge.from_location_id,
          toLocationId: p.primaryEdge.to_location_id,
          fromName,
          toName,
          kind: "triangle_inequality",
          severity: "warning",
          currentMeters: p.distanceMeters,
          suggestedMeters: Math.max(1, Math.round(altDist)),
          longitudinalErrorMeters: Math.round(p.distanceMeters - altDist),
          lateralErrorMeters: 0,
          shortcutMeters: Math.round(altDist),
          message: `${fromName} ↔ ${toName} (${p.distanceMeters}m) is longer than an alternate path (${Math.round(altDist)}m). Reconcile or mark Non-Euclidean.`,
          scopeContainerId,
        };
      }
    }

    if (diag) {
      diagnostics.push(diag);
      diagnosticsByEdgeId[p.primaryEdge.id] = diag;
      if (p.reciprocalEdge) {
        diagnosticsByEdgeId[p.reciprocalEdge.id] = diag;
      }
    }
  }

  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;
  for (const d of diagnostics) {
    if (d.severity === "error") errorCount += 1;
    else if (d.severity === "warning") warningCount += 1;
    else infoCount += 1;
  }

  return {
    scopeContainerId,
    diagnostics,
    diagnosticsByEdgeId,
    anchorResolutions: ctx.anchorResolutions,
    proposedAdjustments,
    proposedByEdgeId,
    errorCount,
    warningCount,
    infoCount,
  };
}

/** Convenience helper returning proposed flexible distance adjustments for a view. */
export function computeReconciliationPlan(params: {
  scopeContainerId: string | null;
  containers: readonly LocationContainer[];
  locations: readonly LocationNode[];
  edges: readonly LocationEdge[];
  options?: ConsistencyAnalysisOptions;
}): ReconciliationAdjustment[] {
  return analyzeSpatialConsistency(params).proposedAdjustments;
}

/** Analyze World Root and every container scope for the global Consistency panel. */
export function analyzeWorldConsistencySummary(params: {
  containers: readonly LocationContainer[];
  locations: readonly LocationNode[];
  edges: readonly LocationEdge[];
  options?: ConsistencyAnalysisOptions;
}): WorldConsistencySummary {
  const { containers, locations, edges, options } = params;
  const scopeIds: Array<{ id: string | null; label: string }> = [
    { id: null, label: "World Root" },
    ...containers
      .slice()
      .sort((a, b) => b.depth - a.depth || a.name.localeCompare(b.name))
      .map((c) => ({ id: c.id, label: `${c.name} (L${c.depth})` })),
  ];

  const byScope: WorldConsistencySummary["byScope"] = [];
  const allDiagnostics: EdgeConsistencyDiagnostic[] = [];
  const allProposedAdjustments: ReconciliationAdjustment[] = [];
  let totalErrors = 0;
  let totalWarnings = 0;
  let totalInfos = 0;

  for (const sc of scopeIds) {
    const report = analyzeSpatialConsistency({
      scopeContainerId: sc.id,
      containers,
      locations,
      edges,
      options,
    });
    byScope.push({ containerId: sc.id, label: sc.label, report });
    totalErrors += report.errorCount;
    totalWarnings += report.warningCount;
    totalInfos += report.infoCount;
    allDiagnostics.push(...report.diagnostics);
    allProposedAdjustments.push(...report.proposedAdjustments);
  }

  return {
    totalErrors,
    totalWarnings,
    totalInfos,
    byScope,
    allDiagnostics,
    allProposedAdjustments,
  };
}
