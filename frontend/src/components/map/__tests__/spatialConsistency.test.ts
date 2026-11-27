import { describe, expect, it } from "vitest";
import type { LocationContainer, LocationEdge, LocationNode } from "../../../types";
import {
  analyzeSpatialConsistency,
  analyzeWorldConsistencySummary,
  computeReconciliationPlan,
  estimateImpliedEdgeDistance,
  formatSuggestedDistanceLabel,
  isValidSpatialAnchor,
} from "../spatialConsistency";
import { resolveDefaultNewEdgeDistance } from "../useTopologyMutations";

const mkCont = (
  id: string,
  name: string,
  depth: 1 | 2 | 3 | 4,
  parent_container_id: string | null = null
): LocationContainer => ({
  id,
  world_id: "w1",
  parent_container_id,
  depth,
  name,
  description: "",
  environmental_tags: [],
});

const mkLoc = (
  id: string,
  name: string,
  container_id: string | null = null,
  extra: Partial<LocationNode> = {}
): LocationNode => ({
  id,
  world_id: "w1",
  container_id,
  name,
  summary: "",
  description: "",
  environmental_tags: [],
  is_starting_location: false,
  ...extra,
});

const mkPair = (
  idBase: string,
  from: string,
  to: string,
  dir: "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW",
  distance_meters: number,
  extra: Partial<LocationEdge> = {}
): LocationEdge[] => {
  const opp: Record<typeof dir, typeof dir> = {
    N: "S",
    NE: "SW",
    E: "W",
    SE: "NW",
    S: "N",
    SW: "NE",
    W: "E",
    NW: "SE",
  };
  return [
    {
      id: `${idBase}_fwd`,
      world_id: "w1",
      from_location_id: from,
      to_location_id: to,
      direction_label: `To ${to}`,
      compass_direction: dir,
      distance_meters,
      speed_modifier: 1,
      obstacles: [],
      is_blocked: false,
      is_secret: false,
      distance_mode: "flexible",
      is_vertical: false,
      ...extra,
    },
    {
      id: `${idBase}_rev`,
      world_id: "w1",
      from_location_id: to,
      to_location_id: from,
      direction_label: `Back to ${from}`,
      compass_direction: opp[dir],
      distance_meters,
      speed_modifier: 1,
      obstacles: [],
      is_blocked: false,
      is_secret: false,
      distance_mode: "flexible",
      is_vertical: false,
      ...extra,
    },
  ];
};

describe("spatialConsistency", () => {
  it("resolves The Green Lie Sector 9 + Sewers anchors and reconciles Tunnel 1-L <-> 1-M and 2-L <-> 2-M to 1500m", () => {
    const containers = [
      mkCont("sector9", "Sector 9: The Drain", 3, null),
      mkCont("neon_rust", "The Neon Rust", 1, "sector9"),
      mkCont("sewers", "Sewers", 1, "sector9"),
    ];
    const locations = [
      mkLoc("main_floor", "Main Floor", "neon_rust", { is_entry_exit: true, is_starting_location: true }),
      // Internal 280m NW offset inside Neon Rust should collapse at Sector 9 scope
      mkLoc("sump_well", "The Sump-Well", "neon_rust", { is_entry_exit: true }),
      mkLoc("chop_cath", "The Chop-Cathedral", "sector9"),
      mkLoc("sewer_ent", "The Neon Rust's Sewer Entrance", "sewers", {
        is_entry_exit: true,
        anchor_location_id: "sump_well",
      }),
      mkLoc("t1l", "Tunnel 1-L", "sewers"),
      mkLoc("t1m", "Tunnel 1-M", "sewers", {
        is_entry_exit: true,
        anchor_location_id: "chop_cath",
      }),
      mkLoc("t2l", "Tunnel 2-L", "sewers"),
      mkLoc("t2m", "Tunnel 2-M", "sewers"),
    ];
    const edges = [
      ...mkPair("e_nr_sump", "main_floor", "sump_well", "NW", 280),
      ...mkPair("e_nr_chop", "main_floor", "chop_cath", "E", 1500, { distance_mode: "locked" }),
      ...mkPair("e_hatch", "sump_well", "sewer_ent", "N", 25, { is_vertical: true }),
      ...mkPair("e_chop_t1m", "chop_cath", "t1m", "N", 1000),
      ...mkPair("e_ent_t1l", "sewer_ent", "t1l", "N", 1000),
      ...mkPair("e_t1l_t1m", "t1l", "t1m", "E", 140),
      ...mkPair("e_t1l_t2l", "t1l", "t2l", "N", 210),
      ...mkPair("e_t1m_t2m", "t1m", "t2m", "N", 210),
      ...mkPair("e_t2l_t2m", "t2l", "t2m", "E", 210),
    ];

    const report = analyzeSpatialConsistency({
      scopeContainerId: "sewers",
      containers,
      locations,
      edges,
    });

    // Anchors resolved accurately:
    // Sewer Entrance pinned at Neon Rust (0, 0) via vertical 25m hatch (0 horizontal offset)
    expect(report.anchorResolutions["sewer_ent"]?.valid).toBe(true);
    expect(report.anchorResolutions["sewer_ent"]?.offsetMetersX).toBe(0);
    expect(report.anchorResolutions["sewer_ent"]?.offsetMetersY).toBe(0);
    // Tunnel 1-M pinned at Chop-Cathedral (1500, 0) + N 1000m = (1500, 1000)
    expect(report.anchorResolutions["t1m"]?.valid).toBe(true);
    expect(report.anchorResolutions["t1m"]?.resolvedX).toBeCloseTo(1500, 1);
    expect(report.anchorResolutions["t1m"]?.resolvedY).toBeCloseTo(1000, 1);

    const t1Adj = report.proposedByEdgeId["e_t1l_t1m_fwd"];
    expect(t1Adj?.proposedMeters).toBe(1500);
    const t2Adj = report.proposedByEdgeId["e_t2l_t2m_fwd"];
    expect(t2Adj?.proposedMeters).toBe(1500);
    expect(report.diagnosticsByEdgeId["e_t1l_t1m_fwd"]?.kind).toBe("distance_mismatch");
    expect(report.diagnosticsByEdgeId["e_t1l_t1m_fwd"]?.suggestedMeters).toBe(1500);
  });

  it("never modifies locked edges and flags overconstrained_locked when locked edges conflict", () => {
    const locations = [
      mkLoc("a", "A"),
      mkLoc("b", "B"),
      mkLoc("c", "C"),
    ];
    const edges = [
      ...mkPair("ab", "a", "b", "E", 100, { distance_mode: "locked" }),
      ...mkPair("bc", "b", "c", "E", 100, { distance_mode: "locked" }),
      ...mkPair("ac", "a", "c", "E", 500, { distance_mode: "locked" }),
    ];

    const report = analyzeSpatialConsistency({
      scopeContainerId: null,
      containers: [],
      locations,
      edges,
    });

    expect(report.proposedAdjustments).toHaveLength(0);
    expect(report.errorCount).toBeGreaterThan(0);
    expect(report.diagnostics.some((d) => d.kind === "overconstrained_locked")).toBe(true);
  });

  it("exempts non_euclidean portals from triangle-inequality and loop checks", () => {
    const locations = [
      mkLoc("a", "A"),
      mkLoc("b", "B"),
      mkLoc("c", "C"),
    ];
    const edges = [
      ...mkPair("ab", "a", "b", "E", 100),
      ...mkPair("bc", "b", "c", "E", 100),
      // Magic portal folding 200m into 5m
      ...mkPair("ac", "a", "c", "E", 5, { distance_mode: "non_euclidean" }),
    ];

    const report = analyzeSpatialConsistency({
      scopeContainerId: null,
      containers: [],
      locations,
      edges,
    });

    expect(report.diagnostics).toHaveLength(0);
    expect(report.proposedAdjustments).toHaveLength(0);
  });

  it("flags triangle_inequality when direct horizontal link is longer than an alternate route", () => {
    const locations = [
      mkLoc("main", "Main Floor"),
      mkLoc("sump", "Green-Sump"),
      mkLoc("chop", "Chop-Cathedral"),
    ];
    const edges = [
      ...mkPair("mc", "main", "chop", "E", 1500),
      ...mkPair("ms", "main", "sump", "SE", 210),
      ...mkPair("sc", "sump", "chop", "N", 140),
    ];

    const report = analyzeSpatialConsistency({
      scopeContainerId: null,
      containers: [],
      locations,
      edges,
    });

    expect(report.diagnostics.some((d) => d.kind === "distance_mismatch" || d.kind === "triangle_inequality")).toBe(true);

    // On pure collinear shortcut where loop residual is zero? No, triangle inequality still triggers on a 100m vs 50m+20m collinear or non-collinear mismatch
    const colLocs = [mkLoc("x", "X"), mkLoc("y", "Y"), mkLoc("z", "Z")];
    const colEdges = [
      ...mkPair("xy", "x", "y", "E", 50, { distance_mode: "locked" }),
      ...mkPair("yz", "y", "z", "E", 50, { distance_mode: "locked" }),
      ...mkPair("xz", "x", "z", "E", 100, { distance_mode: "locked" }),
    ];
    const okReport = analyzeSpatialConsistency({
      scopeContainerId: null,
      containers: [],
      locations: colLocs,
      edges: colEdges,
    });
    expect(okReport.diagnostics).toHaveLength(0);
  });

  it("supports reference-only anchors (no connecting edge) with 0 horizontal offset", () => {
    const containers = [
      mkCont("bldg", "Tower", 1),
      mkCont("base", "Undercroft", 1),
    ];
    const locations = [
      mkLoc("lobby", "Lobby", "bldg"),
      mkLoc("plaza", "Plaza", null),
      mkLoc("vault", "Vault", "base", { anchor_location_id: "plaza" }),
      mkLoc("shaft", "Shaft", "base", { anchor_location_id: "lobby" }),
    ];
    const edges = [
      ...mkPair("lp", "lobby", "plaza", "E", 300, { distance_mode: "locked" }),
      ...mkPair("vs", "vault", "shaft", "W", 50),
    ];

    const report = analyzeSpatialConsistency({
      scopeContainerId: "base",
      containers,
      locations,
      edges,
    });

    expect(report.anchorResolutions["vault"]?.resolvedX).toBeCloseTo(300, 1);
    expect(report.anchorResolutions["shaft"]?.resolvedX).toBeCloseTo(0, 1);
    expect(report.proposedByEdgeId["vs_fwd"]?.proposedMeters).toBe(300);
  });

  it("detects compass conflicts instead of proposing bogus 1m links", () => {
    const containers = [mkCont("sub", "Sub", 1)];
    const locations = [
      mkLoc("ext_w", "West Gate", null),
      mkLoc("ext_e", "East Gate", null),
      mkLoc("sub_w", "Sub West", "sub", { anchor_location_id: "ext_w" }),
      mkLoc("sub_e", "Sub East", "sub", { anchor_location_id: "ext_e" }),
    ];
    const edges = [
      ...mkPair("ext", "ext_w", "ext_e", "E", 400, { distance_mode: "locked" }),
      // Wrong compass direction: points W instead of E!
      ...mkPair("sub_link", "sub_w", "sub_e", "W", 100),
    ];

    const report = analyzeSpatialConsistency({
      scopeContainerId: "sub",
      containers,
      locations,
      edges,
    });

    expect(report.diagnosticsByEdgeId["sub_link_fwd"]?.kind).toBe("compass_conflict");
    expect(report.diagnosticsByEdgeId["sub_link_fwd"]?.severity).toBe("error");
    expect(report.proposedByEdgeId["sub_link_fwd"]).toBeUndefined();
  });

  it("hides undiscovered secret edges in campaign player mode", () => {
    const locations = [mkLoc("a", "A"), mkLoc("b", "B"), mkLoc("c", "C")];
    const edges = [
      ...mkPair("ab", "a", "b", "E", 100),
      ...mkPair("bc", "b", "c", "E", 100),
      ...mkPair("ac_sec", "a", "c", "E", 900, { is_secret: true }),
    ];

    const playerReport = analyzeSpatialConsistency({
      scopeContainerId: null,
      containers: [],
      locations,
      edges,
      options: { mode: "campaign", unlockLore: false, revealedEdgeIds: [] },
    });
    expect(playerReport.diagnostics).toHaveLength(0);

    const gmReport = analyzeSpatialConsistency({
      scopeContainerId: null,
      containers: [],
      locations,
      edges,
      options: { mode: "campaign", unlockLore: true, revealedEdgeIds: [] },
    });
    expect(gmReport.diagnostics.length).toBeGreaterThan(0);
  });

  it("validates anchor containment rules and detects asymmetric pairs", () => {
    const containers = [mkCont("c1", "Building", 1)];
    const a = mkLoc("a", "Room A", "c1");
    const b = mkLoc("b", "Room B", "c1");
    const root = mkLoc("r", "Root", null);

    expect(isValidSpatialAnchor(a, "b", containers, [a, b, root]).valid).toBe(false);
    expect(isValidSpatialAnchor(root, "b", containers, [a, b, root]).valid).toBe(false);
    expect(isValidSpatialAnchor(a, "r", containers, [a, b, root]).valid).toBe(true);

    const asymEdges: LocationEdge[] = [
      {
        id: "f",
        world_id: "w1",
        from_location_id: "a",
        to_location_id: "b",
        direction_label: "E",
        compass_direction: "E",
        distance_meters: 20,
        speed_modifier: 1,
        obstacles: [],
        is_blocked: false,
        is_secret: false,
      },
      {
        id: "r",
        world_id: "w1",
        from_location_id: "b",
        to_location_id: "a",
        direction_label: "W",
        compass_direction: "W",
        distance_meters: 80,
        speed_modifier: 1,
        obstacles: [],
        is_blocked: false,
        is_secret: false,
      },
    ];
    const summary = analyzeWorldConsistencySummary({
      containers,
      locations: [a, b, root],
      edges: asymEdges,
    });
    expect(summary.totalInfos).toBe(1);
    expect(
      computeReconciliationPlan({
        scopeContainerId: "c1",
        containers,
        locations: [a, b, root],
        edges: asymEdges,
      })
    ).toHaveLength(0);
  });

  it("validates 1-K -- 500m -- 1-L -- 500m -- 2-L -- 500m -- 3-L triangle inside NE octant without distorting grid or cascading proposals", () => {
    const containers = [mkCont("sewers", "Sewers", 1)];
    const t1k = mkLoc("t1k", "Tunnel 1-K", "sewers");
    const t1l = mkLoc("t1l", "Tunnel 1-L", "sewers", { is_starting_location: true });
    const t2l = mkLoc("t2l", "Tunnel 2-L", "sewers");
    const t3l = mkLoc("t3l", "Tunnel 3-L", "sewers");
    const t1m = mkLoc("t1m", "Tunnel 1-M", "sewers");
    const t2m = mkLoc("t2m", "Tunnel 2-M", "sewers");
    const unlinked = mkLoc("isolated", "Side Chamber", "sewers");

    const baseGridEdges: LocationEdge[] = [
      ...mkPair("k_1l", "t1k", "t1l", "E", 500),
      ...mkPair("1l_2l", "t1l", "t2l", "N", 500),
      ...mkPair("2l_3l", "t2l", "t3l", "N", 500),
      ...mkPair("1l_1m", "t1l", "t1m", "E", 500),
      ...mkPair("1m_2m", "t1m", "t2m", "N", 500),
      ...mkPair("2l_2m", "t2l", "t2m", "E", 500),
    ];
    const locations = [t1k, t1l, t2l, t3l, t1m, t2m, unlinked];

    // 1. Implied distance before adding chord: sqrt(500^2 + 1000^2) = 1118m NE
    const implied = estimateImpliedEdgeDistance({
      fromLocationId: "t1k",
      toLocationId: "t3l",
      scopeContainerId: "sewers",
      containers,
      locations,
      edges: baseGridEdges,
    });
    expect(implied?.distanceMeters).toBe(1118);
    expect(implied?.compassDirection).toBe("NE");

    // Unlinked same-container node yields null and falls back to 20m default
    expect(
      estimateImpliedEdgeDistance({
        fromLocationId: "t1k",
        toLocationId: "isolated",
        scopeContainerId: "sewers",
        containers,
        locations,
        edges: baseGridEdges,
      })
    ).toBeNull();
    expect(
      resolveDefaultNewEdgeDistance({
        fromLoc: t1k,
        toLoc: unlinked,
        sourceKind: "location",
        targetKind: "location",
        scopeContainerId: "sewers",
        containers,
        locations,
        edges: baseGridEdges,
      })
    ).toEqual({ distanceMeters: 20, fromGeometry: false });
    expect(
      resolveDefaultNewEdgeDistance({
        fromLoc: t1k,
        toLoc: t3l,
        sourceKind: "location",
        targetKind: "location",
        scopeContainerId: "sewers",
        containers,
        locations,
        edges: baseGridEdges,
      })
    ).toEqual({ distanceMeters: 1118, fromGeometry: true });

    // 2. Valid 1118m NE and tolerance-rounded 1100m NE links yield 0 diagnostics
    for (const validDist of [1118, 1100]) {
      const okReport = analyzeSpatialConsistency({
        scopeContainerId: "sewers",
        containers,
        locations,
        edges: [...baseGridEdges, ...mkPair("k_3l", "t1k", "t3l", "NE", validDist)],
      });
      expect(okReport.diagnostics).toHaveLength(0);
    }

    // 3. Adding broken 20m or 1000m chord flags ONLY the new chord and proposes 1118m directly
    for (const badDist of [20, 1000]) {
      const badReport = analyzeSpatialConsistency({
        scopeContainerId: "sewers",
        containers,
        locations,
        edges: [...baseGridEdges, ...mkPair("k_3l", "t1k", "t3l", "NE", badDist)],
      });
      expect(badReport.diagnostics).toHaveLength(1);
      expect(badReport.diagnostics[0].primaryEdgeId).toBe("k_3l_fwd");
      expect(badReport.diagnostics[0].kind).toBe("distance_mismatch");
      expect(badReport.diagnostics[0].suggestedMeters).toBe(1118);
      expect(badReport.proposedAdjustments).toHaveLength(1);
      expect(badReport.proposedAdjustments[0].proposedMeters).toBe(1118);
      // Existing 500m grid edges stay completely clean
      expect(badReport.diagnosticsByEdgeId["k_1l_fwd"]).toBeUndefined();
      expect(badReport.diagnosticsByEdgeId["1l_2l_fwd"]).toBeUndefined();
      expect(badReport.diagnosticsByEdgeId["2l_3l_fwd"]).toBeUndefined();
    }

    // 4. Wrong compass sector (NW instead of NE) flags ONLY the new chord as compass_conflict
    const wrongCompassReport = analyzeSpatialConsistency({
      scopeContainerId: "sewers",
      containers,
      locations,
      edges: [...baseGridEdges, ...mkPair("k_3l", "t1k", "t3l", "NW", 1118)],
    });
    expect(wrongCompassReport.diagnostics).toHaveLength(1);
    expect(wrongCompassReport.diagnostics[0].primaryEdgeId).toBe("k_3l_fwd");
    expect(wrongCompassReport.diagnostics[0].kind).toBe("compass_conflict");
    expect(wrongCompassReport.diagnostics[0].message).toContain("1118m NE");
    expect(wrongCompassReport.proposedAdjustments).toHaveLength(0);
    expect(formatSuggestedDistanceLabel(1118)).toBe("1118m");
    expect(formatSuggestedDistanceLabel(1500)).toBe("1.5km");
  });

  it("reconciles multi-anchor L-bends cleanly without distorting non-bridge geometry", () => {
    const containers = [mkCont("sector9", "Sector 9", 2), mkCont("sewers", "Sewers", 1, "sector9")];
    const neon = mkLoc("neon", "Neon Rust", "sector9", { is_starting_location: true });
    const chop = mkLoc("chop", "Chop Cathedral", "sector9");
    const ent = mkLoc("ent", "Sewer Entrance", "sewers", { anchor_location_id: "neon" });
    const t1l = mkLoc("t1l", "Tunnel 1-L", "sewers");
    const t1m = mkLoc("t1m", "Tunnel 1-M", "sewers", { anchor_location_id: "chop" });

    const edges: LocationEdge[] = [
      ...mkPair("neon_chop", "neon", "chop", "NE", Math.round(Math.hypot(1500, 1000)), {
        distance_mode: "locked",
      }),
      ...mkPair("ent_t1l", "ent", "t1l", "N", 500),
      ...mkPair("t1l_t1m", "t1l", "t1m", "E", 500),
    ];
    // Wait: make Chop explicitly at (1500, 1000) via an intermediate north node from Neon so Chop sits cleanly at (1500, 1000)
    const eastCorner = mkLoc("east", "East Corner", "sector9");
    const exactEdges: LocationEdge[] = [
      ...mkPair("n_e", "neon", "east", "E", 1500, { distance_mode: "locked" }),
      ...mkPair("e_c", "east", "chop", "N", 1000, { distance_mode: "locked" }),
      ...mkPair("ent_t1l", "ent", "t1l", "N", 500),
      ...mkPair("t1l_t1m", "t1l", "t1m", "E", 500),
    ];
    expect(edges.length).toBeGreaterThan(0);

    const report = analyzeSpatialConsistency({
      scopeContainerId: "sewers",
      containers,
      locations: [neon, eastCorner, chop, ent, t1l, t1m],
      edges: exactEdges,
    });
    expect(report.proposedByEdgeId["ent_t1l_fwd"]?.proposedMeters).toBe(1000);
    expect(report.proposedByEdgeId["t1l_t1m_fwd"]?.proposedMeters).toBe(1500);
  });

  it("preserves portal offsets for sprawling Sewers in Sector 9 while keeping The Neon Rust collapsed", () => {
    const buildFixture = (withAnchor: boolean) => {
      const containers = [
        mkCont("sector9", "Sector 9: The Drain", 3, null),
        mkCont("neon_rust", "The Neon Rust", 1, "sector9"),
        mkCont("sewers", "Sewers", 1, "sector9"),
      ];
      const locations = [
        mkLoc("main_floor", "Main Floor", "neon_rust", { is_starting_location: true }),
        mkLoc("sump_well", "The Sump-Well", "neon_rust"),
        mkLoc("chop_cath", "The Chop-Cathedral", "sector9"),
        mkLoc("pillory", "The Pillory", "sector9"),
        mkLoc("sewer_ent", "The Neon Rust's Sewer Entrance", "sector9"),
        mkLoc("t1l", "Tunnel 1-L", "sewers"),
        mkLoc("t1m", "Tunnel 1-M", "sewers"),
        mkLoc("t2n", "Tunnel 2-N", "sewers", {
          anchor_location_id: withAnchor ? "pillory" : null,
        }),
      ];
      const baseEdges: LocationEdge[] = [
        ...mkPair("nr_sump", "main_floor", "sump_well", "NW", 280),
        ...mkPair("nr_chop", "main_floor", "chop_cath", "E", 500),
        ...mkPair("chop_t1m", "chop_cath", "t1m", "N", 1000),
        ...mkPair("t1m_t1l", "t1m", "t1l", "W", 500),
        ...mkPair("sump_ent", "sump_well", "sewer_ent", "N", 1),
      ];
      return { containers, locations, baseEdges };
    };

    for (const withAnchor of [true, false]) {
      const { containers, locations, baseEdges } = buildFixture(withAnchor);

      // 1. Pre-link implied distance with sourceCompass="N" resolves 999m N (not 1117m NE)
      const implied = estimateImpliedEdgeDistance({
        fromLocationId: "sewer_ent",
        toLocationId: "t1l",
        scopeContainerId: "sector9",
        containers,
        locations,
        edges: baseEdges,
        sourceCompass: "N",
      });
      expect(implied?.distanceMeters).toBe(999);
      expect(implied?.compassDirection).toBe("N");

      const defaultDist = resolveDefaultNewEdgeDistance({
        fromLoc: locations.find((l) => l.id === "sewer_ent")!,
        toLoc: locations.find((l) => l.id === "t1l")!,
        sourceKind: "location",
        targetKind: "location",
        sourceCompass: "N",
        scopeContainerId: "sector9",
        containers,
        locations,
        edges: baseEdges,
      });
      expect(defaultDist).toEqual({ distanceMeters: 999, fromGeometry: true });

      // 2. Valid 1000m S link from Tunnel 1-L -> Sewer Entrance passes with 0 errors and 0 warnings
      const validReport = analyzeSpatialConsistency({
        scopeContainerId: "sector9",
        containers,
        locations,
        edges: [...baseEdges, ...mkPair("t1l_ent", "t1l", "sewer_ent", "S", 1000)],
      });
      expect(validReport.errorCount).toBe(0);
      expect(validReport.warningCount).toBe(0);
      // Internal Sewers edge never leaks into Sector 9 diagnostics
      expect(validReport.diagnosticsByEdgeId["t1m_t1l_fwd"]).toBeUndefined();

      // 3. Wrong 1117m S distance warns distance_mismatch implying ~999m (NOT compass_conflict 1117m SW)
      const mismatchReport = analyzeSpatialConsistency({
        scopeContainerId: "sector9",
        containers,
        locations,
        edges: [...baseEdges, ...mkPair("t1l_ent", "t1l", "sewer_ent", "S", 1117)],
      });
      expect(mismatchReport.errorCount).toBe(0);
      expect(mismatchReport.diagnosticsByEdgeId["t1l_ent_fwd"]?.kind).toBe("distance_mismatch");
      expect(mismatchReport.diagnosticsByEdgeId["t1l_ent_fwd"]?.suggestedMeters).toBe(999);
      // Neon Rust stays collapsed: Main Floor <-> Chop-Cathedral remains 500m E without being distorted by 280m NW
      expect(mismatchReport.diagnosticsByEdgeId["nr_chop_fwd"]).toBeUndefined();
    }
  });

  it("expands L2/L3 macro containers with 2+ portals so World Root preserves portal offsets", () => {
    const containers = [mkCont("district", "Outer District", 2, null)];
    const locations = [
      mkLoc("gate_w", "West Gate", null, { is_starting_location: true }),
      mkLoc("d_west", "District West", "district"),
      mkLoc("d_east", "District East", "district"),
      mkLoc("gate_e", "East Gate", null),
    ];
    const edges: LocationEdge[] = [
      ...mkPair("gw_dw", "gate_w", "d_west", "N", 100),
      ...mkPair("dw_de", "d_west", "d_east", "E", 1000),
      ...mkPair("de_ge", "d_east", "gate_e", "S", 100),
      ...mkPair("gw_ge", "gate_w", "gate_e", "E", 1000),
    ];
    const report = analyzeSpatialConsistency({
      scopeContainerId: null,
      containers,
      locations,
      edges,
    });
    expect(report.diagnostics).toHaveLength(0);
  });
});
