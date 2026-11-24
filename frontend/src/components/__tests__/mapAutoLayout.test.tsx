import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LocationContainer, LocationEdge, LocationNode } from "../../types";
import {
  SpatialTopologyView,
  projectTopologyForDepth,
} from "../SpatialTopologyView";
import { SpatialTopologyCanvas } from "../map/SpatialTopologyCanvas";
import {
  AUTO_LAYOUT_FIT_MAX_ZOOM,
  AUTO_LAYOUT_MAX_SPAN,
  AUTO_LAYOUT_MIN_SPAN,
  type NodeFootprint,
  computeAutoLayoutEdgeLength,
  computeScopedAutoLayout,
  computeViewportFitForCoords,
  reduceVisibleEdgesForAutoLayout,
} from "../map/mapAutoLayout";
import {
  CONTAINER_CARD_HALF_H,
  CONTAINER_CARD_HALF_W,
  MIN_MAP_ZOOM,
} from "../map/mapGeometry";

function makeLoc(
  id: string,
  name: string,
  opts: Partial<LocationNode> = {}
): LocationNode {
  return {
    id,
    world_id: "w1",
    name,
    summary: name,
    description: name,
    environmental_tags: [],
    is_starting_location: false,
    ...opts,
  };
}

function makeEdge(
  id: string,
  from: string,
  to: string,
  opts: Partial<LocationEdge> = {}
): LocationEdge {
  return {
    id,
    world_id: "w1",
    from_location_id: from,
    to_location_id: to,
    direction_label: `To ${to}`,
    compass_direction: "E",
    distance_meters: 100,
    speed_modifier: 1,
    obstacles: [],
    is_blocked: false,
    is_secret: false,
    ...opts,
  };
}

function makeContainer(
  id: string,
  name: string,
  depth: 1 | 2 | 3 | 4 = 1,
  opts: Partial<LocationContainer> = {}
): LocationContainer {
  return {
    id,
    world_id: "w1",
    parent_container_id: null,
    depth,
    name,
    description: name,
    environmental_tags: [],
    ...opts,
  };
}

function buildFootprints(
  projected: ReturnType<typeof projectTopologyForDepth>
): Record<string, NodeFootprint> {
  const map: Record<string, NodeFootprint> = {};
  for (const loc of projected.visibleLocations) {
    map[loc.id] = { halfW: 54, halfH: 34 };
  }
  for (const sn of projected.visibleSupernodes) {
    map[sn.container.id] = {
      halfW: CONTAINER_CARD_HALF_W + 6,
      halfH: CONTAINER_CARD_HALF_H + 8,
    };
  }
  return map;
}

describe("Scoped Map Auto-Layout engine & UI controls", () => {
  it("maps metric distances monotonically within clamped log bounds and respects wide supernode footprints", () => {
    const locFp: NodeFootprint = { halfW: 54, halfH: 34 };
    const contFp: NodeFootprint = {
      halfW: CONTAINER_CARD_HALF_W + 6,
      halfH: CONTAINER_CARD_HALF_H + 8,
    };

    const shortLen = computeAutoLayoutEdgeLength(20, locFp, locFp, 0);
    const medLen = computeAutoLayoutEdgeLength(200, locFp, locFp, 0);
    const longLen = computeAutoLayoutEdgeLength(20_000, locFp, locFp, 0);

    expect(shortLen).toBeGreaterThanOrEqual(AUTO_LAYOUT_MIN_SPAN);
    expect(shortLen).toBeLessThan(medLen);
    expect(medLen).toBeLessThan(longLen);
    expect(longLen).toBeLessThanOrEqual(AUTO_LAYOUT_MAX_SPAN + 108 + 68);

    // Wide container supernodes along East (angle=0) enforce wider center-to-center clearance than location tiles
    const contShortLen = computeAutoLayoutEdgeLength(20, contFp, contFp, 0);
    expect(contShortLen).toBeGreaterThan(shortLen);
    expect(contShortLen).toBeGreaterThanOrEqual(contFp.halfW * 2 + 68);
  });

  it("places N/E/S/W neighbors in expected directional quadrants including reciprocal reverse edges", () => {
    const locations = [
      makeLoc("hub", "Hub", { is_starting_location: true, ui_x: 900, ui_y: -500 }),
      makeLoc("n_loc", "North", { ui_x: 0, ui_y: 400 }),
      makeLoc("e_loc", "East", { ui_x: -400, ui_y: 0 }),
      makeLoc("s_loc", "South", { ui_x: 100, ui_y: -300 }),
      makeLoc("w_loc", "West", { ui_x: 400, ui_y: 100 }),
    ];
    const edges = [
      makeEdge("e_n", "hub", "n_loc", { compass_direction: "N", distance_meters: 100 }),
      makeEdge("e_e", "hub", "e_loc", { compass_direction: "E", distance_meters: 100 }),
      // Only a reverse incoming edge from South -> Hub pointing North (must invert to South from Hub!)
      makeEdge("e_s_rev", "s_loc", "hub", { compass_direction: "N", distance_meters: 100 }),
      makeEdge("e_w", "hub", "w_loc", { compass_direction: "W", distance_meters: 100 }),
    ];

    const projected = projectTopologyForDepth(null, [], locations, edges, "hub");
    const footprints = buildFootprints(projected);
    const { coords, ghostCoords } = computeScopedAutoLayout({
      projectedTopology: projected,
      footprints,
    });

    expect(Object.keys(ghostCoords)).toHaveLength(0);
    const hub = coords.hub;
    expect(coords.n_loc.y).toBeLessThan(hub.y);
    expect(coords.s_loc.y).toBeGreaterThan(hub.y);
    expect(coords.e_loc.x).toBeGreaterThan(hub.x);
    expect(coords.w_loc.x).toBeLessThan(hub.x);
  });

  it("resolves cycles and wide container supernodes with zero AABB overlap", () => {
    const containers = [
      makeContainer("c_a", "District Alpha", 1),
      makeContainer("c_b", "District Beta", 1),
      makeContainer("c_c", "District Gamma", 1),
    ];
    const locations = [
      makeLoc("a1", "Alpha Gate", { container_id: "c_a", is_entry_exit: true, is_starting_location: true }),
      makeLoc("b1", "Beta Gate", { container_id: "c_b", is_entry_exit: true }),
      makeLoc("c1", "Gamma Gate", { container_id: "c_c", is_entry_exit: true }),
      makeLoc("plaza", "Central Plaza"),
    ];
    const edges = [
      makeEdge("e1", "plaza", "a1", { compass_direction: "E", distance_meters: 80 }),
      makeEdge("e2", "a1", "b1", { compass_direction: "E", distance_meters: 90 }),
      makeEdge("e3", "b1", "c1", { compass_direction: "S", distance_meters: 70 }),
      makeEdge("e4", "c1", "plaza", { compass_direction: "NW", distance_meters: 120 }),
      makeEdge("e5", "plaza", "b1", { compass_direction: "E", distance_meters: 150 }),
    ];

    const projected = projectTopologyForDepth(null, containers, locations, edges, "plaza");
    const footprints = buildFootprints(projected);
    const { coords } = computeScopedAutoLayout({
      projectedTopology: projected,
      footprints,
    });

    // Strictly scoped: interior locations inside containers must NOT appear in root layout output
    expect(coords.plaza).toBeDefined();
    expect(coords.c_a).toBeDefined();
    expect(coords.c_b).toBeDefined();
    expect(coords.c_c).toBeDefined();
    expect(coords.a1).toBeUndefined();
    expect(coords.b1).toBeUndefined();
    expect(coords.c1).toBeUndefined();

    // Verify zero AABB overlap across all visible footprints
    const ids = Object.keys(coords);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = coords[ids[i]];
        const b = coords[ids[j]];
        const fpA = footprints[ids[i]];
        const fpB = footprints[ids[j]];
        const overlapsX = Math.abs(a.x - b.x) < fpA.halfW + fpB.halfW;
        const overlapsY = Math.abs(a.y - b.y) < fpA.halfH + fpB.halfH;
        expect(overlapsX && overlapsY).toBe(false);
      }
    }
  });

  it("prefers non-secret edges over secret shortcuts and falls back to secret-only pairs", () => {
    const locations = [
      makeLoc("start", "Start", { is_starting_location: true }),
      makeLoc("main_dest", "Main Dest"),
      makeLoc("secret_vault", "Secret Vault"),
    ];
    const edges = [
      makeEdge("e_normal", "start", "main_dest", {
        compass_direction: "E",
        distance_meters: 600,
        is_secret: false,
      }),
      makeEdge("e_secret_shortcut", "start", "main_dest", {
        compass_direction: "S",
        distance_meters: 20,
        is_secret: true,
      }),
      makeEdge("e_secret_only", "start", "secret_vault", {
        compass_direction: "W",
        distance_meters: 80,
        is_secret: true,
      }),
    ];

    const projected = projectTopologyForDepth(null, [], locations, edges, "start", undefined, {
      mode: "editor",
    });
    const footprints = buildFootprints(projected);
    const reduced = reduceVisibleEdgesForAutoLayout(projected, footprints);

    const normalPair = reduced.find(
      (r) =>
        (r.u === "main_dest" && r.v === "start") ||
        (r.u === "start" && r.v === "main_dest")
    );
    expect(normalPair).toBeDefined();
    expect(normalPair!.usedSecretFallback).toBe(false);
    expect(normalPair!.distanceMeters).toBe(600);

    const secretOnlyPair = reduced.find(
      (r) =>
        (r.u === "secret_vault" && r.v === "start") ||
        (r.u === "start" && r.v === "secret_vault")
    );
    expect(secretOnlyPair).toBeDefined();
    expect(secretOnlyPair!.usedSecretFallback).toBe(true);

    const { coords } = computeScopedAutoLayout({
      projectedTopology: projected,
      footprints,
    });
    // Non-secret East link governs main_dest placement (x > start.x)
    expect(coords.main_dest.x).toBeGreaterThan(coords.start.x);
    expect(Math.abs(coords.main_dest.y - coords.start.y)).toBeLessThan(30);
    // Secret-only West link places secret_vault West of start
    expect(coords.secret_vault.x).toBeLessThan(coords.start.x);
  });

  it("packs disconnected interior components cleanly and realigns external ghost portals", () => {
    const containers = [
      makeContainer("building", "Hotel", 1, {
        ghost_coords: { street: { x: 999, y: 999 } },
      }),
    ];
    const locations = [
      makeLoc("lobby", "Lobby", { container_id: "building", is_entry_exit: true, is_starting_location: true }),
      makeLoc("penthouse", "Penthouse", { container_id: "building" }),
      makeLoc("basement", "Basement", { container_id: "building" }),
      makeLoc("street", "Street", { container_id: null }),
    ];
    // Lobby and Basement only connect via Street outside (disconnected inside building),
    // while Lobby -> Penthouse is internal.
    const edges = [
      makeEdge("e_up", "lobby", "penthouse", { compass_direction: "N", distance_meters: 25 }),
      makeEdge("e_out", "lobby", "street", { compass_direction: "S", distance_meters: 30 }),
      makeEdge("e_back", "street", "lobby", { compass_direction: "N", distance_meters: 30 }),
      makeEdge("e_cellar", "street", "basement", { compass_direction: "W", distance_meters: 40 }),
    ];

    const projected = projectTopologyForDepth("building", containers, locations, edges, "lobby", undefined, {
      mode: "editor",
    });
    const footprints = buildFootprints(projected);
    const { coords, ghostCoords } = computeScopedAutoLayout({
      projectedTopology: projected,
      footprints,
    });

    // Only building's direct interior locations are laid out
    expect(Object.keys(coords).sort()).toEqual(["basement", "lobby", "penthouse"]);
    // Disconnected basement must not overlap lobby or penthouse
    for (const id of ["lobby", "penthouse"]) {
      const overlapsX =
        Math.abs(coords.basement.x - coords[id].x) <
        footprints.basement.halfW + footprints[id].halfW;
      const overlapsY =
        Math.abs(coords.basement.y - coords[id].y) <
        footprints.basement.halfH + footprints[id].halfH;
      expect(overlapsX && overlapsY).toBe(false);
    }

    // Ghost portal for `street` is recomputed around lobby (ignoring old {999, 999} override)
    expect(ghostCoords.street).toBeDefined();
    expect(Math.hypot(ghostCoords.street.x - 999, ghostCoords.street.y - 999)).toBeGreaterThan(200);
    expect(ghostCoords.street.y).toBeGreaterThan(coords.lobby.y);
  });

  it("computes clamped viewport auto-fit framing nodes and ghosts", () => {
    const fit = computeViewportFitForCoords({
      coords: {
        a: { x: -400, y: -250 },
        b: { x: 400, y: 250 },
      },
      ghostCoords: {
        g: { x: 520, y: 0 },
      },
      footprints: {
        a: { halfW: 54, halfH: 34 },
        b: { halfW: 54, halfH: 34 },
      },
      viewBox: { width: 680, height: 520 },
    });

    expect(Number.isFinite(fit.pan.x)).toBe(true);
    expect(Number.isFinite(fit.pan.y)).toBe(true);
    expect(fit.zoom).toBeGreaterThanOrEqual(MIN_MAP_ZOOM);
    expect(fit.zoom).toBeLessThanOrEqual(AUTO_LAYOUT_FIT_MAX_ZOOM);
  });

  it("gates Auto-Layout button visibility by editor mode, GM unlockLore, and mutating lock", () => {
    const locations = [
      makeLoc("a", "Alpha", { is_starting_location: true }),
      makeLoc("b", "Beta"),
    ];
    const edges = [makeEdge("e1", "a", "b")];

    const editorHtml = renderToStaticMarkup(
      <SpatialTopologyView
        locations={locations}
        edges={edges}
        activeLocationId="a"
        mode="editor"
      />
    );
    expect(editorHtml).toContain('data-testid="map-auto-layout-btn"');

    const gmCampaignHtml = renderToStaticMarkup(
      <SpatialTopologyView
        locations={locations}
        edges={edges}
        activeLocationId="a"
        mode="campaign"
        unlockLore={true}
      />
    );
    expect(gmCampaignHtml).toContain('data-testid="map-auto-layout-btn"');

    const playerCampaignHtml = renderToStaticMarkup(
      <SpatialTopologyView
        locations={locations}
        edges={edges}
        activeLocationId="a"
        mode="campaign"
        unlockLore={false}
      />
    );
    expect(playerCampaignHtml).not.toContain('data-testid="map-auto-layout-btn"');

    const lockedEditorHtml = renderToStaticMarkup(
      <SpatialTopologyView
        locations={locations}
        edges={edges}
        activeLocationId="a"
        mode="editor"
        isMutatingLocked={true}
      />
    );
    expect(lockedEditorHtml).not.toContain('data-testid="map-auto-layout-btn"');
  });

  it("renders floating Apply / Reset preview bar on SpatialTopologyCanvas only while previewing", () => {
    const locations = [
      makeLoc("a", "Alpha", { is_starting_location: true, ui_x: 0, ui_y: 0 }),
      makeLoc("b", "Beta", { ui_x: 180, ui_y: 0 }),
    ];
    const edges = [makeEdge("e1", "a", "b")];
    const projected = projectTopologyForDepth(null, [], locations, edges, "a");
    const baseProps = {
      svgRef: { current: null },
      canvasWrapRef: { current: null },
      viewportGroupRef: { current: null },
      panDragRef: {
        current: {
          active: false,
          moved: false,
          button: 0,
          startClientX: 0,
          startClientY: 0,
          origPanX: 0,
          origPanY: 0,
        },
      },
      mode: "editor" as const,
      zoom: 1,
      setZoom: () => {},
      pan: { x: 0, y: 0 },
      setPan: () => {},
      nodeDrag: null,
      setNodeDrag: () => {},
      linkDrag: null,
      setLinkDrag: () => {},
      hoveredNodeKey: null,
      setHoveredNodeKey: () => {},
      projectedTopology: projected,
      fullMapCoords: { a: { x: 0, y: 0 }, b: { x: 180, y: 0 } },
      selectedContainer: null,
      selectedLocation: null,
      activeLoc: locations[0],
      activeNeighborIds: new Set<string>(["b"]),
      unreachableSet: new Set<string>(),
      occupiedSlotsByLocId: new Map(),
      isMutatingLocked: true,
      inlineEdgeEdit: null,
      setInlineEdgeEdit: () => {},
      statusNotice: null,
      setStatusNotice: () => {},
      setSelectedLocId: () => {},
      setSelectedContainerId: () => {},
      setContextMenu: () => {},
      openContextMenuAt: () => {},
      handleUpdateEdgeDistance: () => {},
      handleDeleteEdge: () => {},
      handleDeleteEdgeGroup: () => {},
      drillIntoContainer: () => {},
    };

    const previewHtml = renderToStaticMarkup(
      <SpatialTopologyCanvas
        {...baseProps}
        isAutoLayoutPreviewing={true}
        onApplyAutoLayout={() => {}}
        onResetAutoLayout={() => {}}
      />
    );
    expect(previewHtml).toContain('data-testid="map-auto-layout-preview-bar"');
    expect(previewHtml).toContain('data-testid="map-auto-layout-apply-btn"');
    expect(previewHtml).toContain('data-testid="map-auto-layout-reset-btn"');
    expect(previewHtml).toContain("Auto-Layout Preview (Current View)");

    const idleHtml = renderToStaticMarkup(
      <SpatialTopologyCanvas {...baseProps} isAutoLayoutPreviewing={false} />
    );
    expect(idleHtml).not.toContain('data-testid="map-auto-layout-preview-bar"');
  });
});
