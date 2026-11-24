import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LocationContainer, LocationEdge, LocationNode } from "../../types";
import { SpatialTopologyView } from "../SpatialTopologyView";
import {
  DEFAULT_MAP_VIEWBOX_H,
  DEFAULT_MAP_VIEWBOX_W,
  MAX_MAP_ZOOM,
  MIN_MAP_ZOOM,
  computeDoubleTapZoomPan,
  computePanDeltaWorld,
  computePinchZoomPan,
  computeResponsiveViewBox,
  computeSvgClientScale,
  shouldDeferNodeDragToTapFirst,
} from "../map/mapGeometry";

function makeFixture(): {
  containers: LocationContainer[];
  locations: LocationNode[];
  edges: LocationEdge[];
} {
  const containers: LocationContainer[] = [
    {
      id: "cont_tavern",
      world_id: "w1",
      name: "Rusty Anchor",
      depth: 1,
      parent_container_id: null,
      description: "Warm harbor tavern.",
      environmental_tags: ["tavern"],
    },
  ];
  const locations: LocationNode[] = [
    {
      id: "loc_start",
      world_id: "w1",
      container_id: "cont_tavern",
      name: "Common Room",
      summary: "Hearth room",
      description: "Bustling taproom.",
      environmental_tags: ["indoors"],
      is_starting_location: true,
      is_hub: false,
      ui_x: 0,
      ui_y: 0,
    },
    {
      id: "loc_cellar",
      world_id: "w1",
      container_id: "cont_tavern",
      name: "Wine Cellar",
      summary: "Cool cellar",
      description: "Rows of oak casks.",
      environmental_tags: ["basement"],
      is_starting_location: false,
      is_hub: false,
      ui_x: 160,
      ui_y: 40,
    },
  ];
  const edges: LocationEdge[] = [
    {
      id: "e1",
      world_id: "w1",
      from_location_id: "loc_start",
      to_location_id: "loc_cellar",
      direction_label: "Cellar stairs",
      compass_direction: "E",
      distance_meters: 140,
      speed_modifier: 1,
      travel_mode: null,
      obstacles: [],
      is_blocked: false,
      is_secret: false,
    },
    {
      id: "e2",
      world_id: "w1",
      from_location_id: "loc_cellar",
      to_location_id: "loc_start",
      direction_label: "Upstairs",
      compass_direction: "W",
      distance_meters: 140,
      speed_modifier: 1,
      travel_mode: null,
      obstacles: [],
      is_blocked: false,
      is_secret: false,
    },
  ];
  return { containers, locations, edges };
}

describe("Mobile map geometry & touch gesture helpers", () => {
  it("computes aspect-adaptive viewBox with 680x520 SSR fallback and 1:1 portrait density", () => {
    const fallback = computeResponsiveViewBox(0, 0);
    expect(fallback).toEqual({
      x: -DEFAULT_MAP_VIEWBOX_W / 2,
      y: -DEFAULT_MAP_VIEWBOX_H / 2,
      width: DEFAULT_MAP_VIEWBOX_W,
      height: DEFAULT_MAP_VIEWBOX_H,
    });

    // Portrait mobile container (< 680px wide) keeps 1:1 CSS-pixel world units
    const portrait = computeResponsiveViewBox(390, 700);
    expect(portrait).toEqual({ x: -195, y: -350, width: 390, height: 700 });
    expect(computeSvgClientScale({ width: 390, height: 700 }, portrait)).toBeCloseTo(1, 4);

    // Desktop container preserves centered balanced framing
    const desktop = computeResponsiveViewBox(960, 640);
    expect(desktop.x).toBe(-desktop.width / 2);
    expect(desktop.y).toBe(-desktop.height / 2);
    expect(desktop.width).toBeGreaterThanOrEqual(680);
    expect(desktop.height).toBeGreaterThanOrEqual(520);
  });

  it("scales pan deltas 1:1 with SVG client scale and zoom", () => {
    const portraitScale = computeSvgClientScale(
      { width: 390, height: 700 },
      { width: 680, height: 520 }
    );
    expect(portraitScale).toBeCloseTo(390 / 680, 4);

    // Moving finger 100px right at zoom=1 on a 0.573-scaled SVG needs ~174.36 world units
    const worldDelta = computePanDeltaWorld(100, -50, portraitScale, 1);
    expect(worldDelta.dx * portraitScale).toBeCloseTo(100, 4);
    expect(worldDelta.dy * portraitScale).toBeCloseTo(-50, 4);

    // At zoom=2, world delta halves so visual displacement stays 1:1
    const zoomedDelta = computePanDeltaWorld(100, -50, 1, 2);
    expect(zoomedDelta).toEqual({ dx: 50, dy: -25 });
  });

  it("keeps anchorWorld pinned under pinch midpoint and clamps zoom bounds", () => {
    const svgRect = { left: 0, top: 0, width: 390, height: 700 };
    const viewBox = { width: 390, height: 700 };
    const anchorWorld = { x: 45, y: -30 };
    const midClient = { x: 235, y: 310 };

    const res = computePinchZoomPan({
      initialZoom: 1,
      initialDist: 100,
      currentDist: 180,
      anchorWorld,
      midClient,
      svgRect,
      viewBox,
    });
    expect(res.zoom).toBe(1.8);
    // Verify projected screen position of anchorWorld equals midClient
    const projectedX = svgRect.width / 2 + (anchorWorld.x + res.pan.x) * res.zoom;
    const projectedY = svgRect.height / 2 + (anchorWorld.y + res.pan.y) * res.zoom;
    expect(projectedX).toBeCloseTo(midClient.x, 3);
    expect(projectedY).toBeCloseTo(midClient.y, 3);

    // Clamps to MAX_MAP_ZOOM and MIN_MAP_ZOOM
    const maxed = computePinchZoomPan({
      initialZoom: 2,
      initialDist: 50,
      currentDist: 500,
      anchorWorld,
      midClient,
      svgRect,
      viewBox,
    });
    expect(maxed.zoom).toBe(MAX_MAP_ZOOM);

    const minned = computePinchZoomPan({
      initialZoom: 0.6,
      initialDist: 200,
      currentDist: 20,
      anchorWorld,
      midClient,
      svgRect,
      viewBox,
    });
    expect(minned.zoom).toBe(MIN_MAP_ZOOM);
  });

  it("toggles double-tap zoom in/reset anchored around the tapped world coordinate", () => {
    const svgRect = { left: 0, top: 0, width: 390, height: 700 };
    const viewBox = { width: 390, height: 700 };
    const tappedWorld = { x: 80, y: 20 };
    const tapClient = { x: 275, y: 370 };

    const zoomedIn = computeDoubleTapZoomPan({
      currentZoom: 1,
      tappedWorld,
      tapClient,
      svgRect,
      viewBox,
    });
    expect(zoomedIn.zoom).toBe(1.75);
    expect(svgRect.width / 2 + (tappedWorld.x + zoomedIn.pan.x) * zoomedIn.zoom).toBeCloseTo(
      tapClient.x,
      3
    );

    const reset = computeDoubleTapZoomPan({
      currentZoom: 1.75,
      tappedWorld,
      tapClient,
      svgRect,
      viewBox,
    });
    expect(reset.zoom).toBe(1);
    expect(svgRect.width / 2 + (tappedWorld.x + reset.pan.x) * reset.zoom).toBeCloseTo(
      tapClient.x,
      3
    );
  });

  it("enforces tap-to-select-first on touch and locked nodes while preserving desktop mouse drag", () => {
    expect(
      shouldDeferNodeDragToTapFirst({
        pointerType: "touch",
        isSelected: false,
        isMutatingLocked: false,
      })
    ).toBe(true);
    expect(
      shouldDeferNodeDragToTapFirst({
        pointerType: "touch",
        isSelected: true,
        isMutatingLocked: false,
      })
    ).toBe(false);
    expect(
      shouldDeferNodeDragToTapFirst({
        pointerType: "mouse",
        isSelected: false,
        isMutatingLocked: false,
      })
    ).toBe(false);
    expect(
      shouldDeferNodeDragToTapFirst({
        pointerType: "mouse",
        isSelected: true,
        isMutatingLocked: true,
      })
    ).toBe(true);
  });
});

describe("SpatialTopologyView mobile-ready SSR markup & drawer action parity", () => {
  it("uses responsive split classes, touch-action:none SVG, bottom-right Center icon, and touch drawer actions", () => {
    const { containers, locations, edges } = makeFixture();
    const html = renderToStaticMarkup(
      <SpatialTopologyView
        title="Harbor Map"
        containers={containers}
        locations={locations}
        edges={edges}
        activeLocationId="loc_start"
        defaultSelectedLocationId="loc_cellar"
        mode="editor"
      />
    );

    expect(html).toContain('class="map-topology-split"');
    expect(html).not.toContain("minmax(460px");
    expect(html).toContain("touch-action:none");
    expect(html).toContain('aria-label="Center on Selected / Active Location"');
    expect(html).toContain('aria-label="Toggle map legend"');
    expect(html).toContain('aria-label="Add map element"');
    expect(html).toContain("Location Actions");
    expect(html).toContain("Set as Starting Location");
    expect(html).toContain("Convert to Container (L1)");
    expect(html).toContain("Move Out to");
    expect(html).toContain("Delete Location");
  });

  it("hides creation palette and destructive drawer actions when isMutatingLocked is true", () => {
    const { containers, locations, edges } = makeFixture();
    const html = renderToStaticMarkup(
      <SpatialTopologyView
        title="Harbor Map"
        containers={containers}
        locations={locations}
        edges={edges}
        activeLocationId="loc_start"
        defaultSelectedLocationId="loc_cellar"
        mode="campaign"
        isMutatingLocked={true}
      />
    );

    expect(html).not.toContain("Palette (Drag or Click):");
    expect(html).not.toContain("Location Actions");
    expect(html).not.toContain("Delete Location");
    expect(html).not.toContain('aria-label="Add map element"');
    expect(html).toContain('aria-label="Center on Selected / Active Location"');
  });
});
