import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  CompassDirection,
  LocationContainer,
  LocationEdge,
  LocationNode,
} from "../../types";
import {
  LINK_SPEED_PRESETS,
  LINK_SPEED_PRESET_GROUPS,
  clampEdgeSpeedModifier,
  deriveTravelMinutes,
  findMatchingSpeedPreset,
  formatBundleTravelDuration,
  formatEffectiveSpeedKmh,
  formatExitTravelPhrase,
  formatTravelDuration,
} from "../../utils/spatialDistance";
import {
  COMPASS_ANGLES,
  canonicalEdgePairKey,
  getLocationOccupiedPorts,
  isEdgeRevealed,
  projectTopologyForDepth,
  resolveBundleLinkPairs,
  resolveLinkPairForInspector,
  resolvePortConnectionPreview,
  resolveRevealedEdgePairs,
} from "../map/topologyProjection";
import { LOCATION_PORT_RADIUS } from "../map/mapGeometry";
import { reassignEdgeCompassSlot } from "../map/useTopologyMutations";
import { hitTestSameLocationPortAt } from "../map/useTopologyPointerDrag";
import { MapDetailsDrawer } from "../map/MapDetailsDrawer";
import { SpatialTopologyCanvas } from "../map/SpatialTopologyCanvas";
import { computeFullMapCoords } from "../SpatialTopologyView";

function makeLinksFixture() {
  const containers: LocationContainer[] = [
    {
      id: "cont_station",
      world_id: "w1",
      depth: 1,
      name: "Transit Hall",
      description: "Rail concourse.",
      environmental_tags: ["rail"],
    },
  ];
  const locations: LocationNode[] = [
    {
      id: "loc_atrium",
      world_id: "w1",
      container_id: null,
      name: "Grand Atrium",
      summary: "Central concourse.",
      description: "High glass roof.",
      environmental_tags: [],
      is_starting_location: true,
      is_hub: true,
    },
    {
      id: "loc_bog",
      world_id: "w1",
      container_id: null,
      name: "Mire Boardwalk",
      summary: "Flooded marsh path.",
      description: "Half-sunk planks.",
      environmental_tags: ["swamp"],
      is_starting_location: false,
    },
    {
      id: "loc_vault",
      world_id: "w1",
      container_id: null,
      name: "Hidden Archive",
      summary: "Secret vault.",
      description: "Behind sliding panels.",
      environmental_tags: ["secret"],
      is_starting_location: false,
    },
    {
      id: "loc_platform",
      world_id: "w1",
      container_id: "cont_station",
      is_entry_exit: true,
      name: "Mag-Lev Platform",
      summary: "Elevated rail bay.",
      description: "Humming rails.",
      environmental_tags: ["rail"],
      is_starting_location: false,
    },
  ];
  const edges: LocationEdge[] = [
    {
      id: "e_bog_fwd",
      world_id: "w1",
      from_location_id: "loc_atrium",
      to_location_id: "loc_bog",
      direction_label: "Through the flooded gate",
      compass_direction: "E",
      distance_meters: 2100,
      speed_modifier: 0.3,
      travel_mode: "Swamp / Difficult Terrain",
      obstacles: ["Knee-Deep Mud", "Thorny Vines"],
      is_blocked: true,
      is_secret: false,
    },
    {
      id: "e_bog_rev",
      world_id: "w1",
      from_location_id: "loc_bog",
      to_location_id: "loc_atrium",
      direction_label: "Back to Grand Atrium",
      compass_direction: "W",
      distance_meters: 2100,
      speed_modifier: 0.3,
      travel_mode: "Swamp / Difficult Terrain",
      obstacles: ["Knee-Deep Mud", "Thorny Vines"],
      is_blocked: true,
      is_secret: false,
    },
    {
      id: "e_sec_fwd",
      world_id: "w1",
      from_location_id: "loc_atrium",
      to_location_id: "loc_vault",
      direction_label: "Behind bookcases",
      compass_direction: "N",
      distance_meters: 35,
      speed_modifier: 1,
      travel_mode: null,
      obstacles: ["Concealed Latch"],
      is_blocked: false,
      is_secret: true,
    },
    {
      id: "e_sec_rev",
      world_id: "w1",
      from_location_id: "loc_vault",
      to_location_id: "loc_atrium",
      direction_label: "Out to Atrium",
      compass_direction: "S",
      distance_meters: 35,
      speed_modifier: 1,
      travel_mode: null,
      obstacles: ["Concealed Latch"],
      is_blocked: false,
      is_secret: true,
    },
    {
      id: "e_rail_fwd",
      world_id: "w1",
      from_location_id: "loc_atrium",
      to_location_id: "loc_platform",
      direction_label: "Express Mag-Lev",
      compass_direction: "S",
      distance_meters: 17500,
      speed_modifier: 25,
      travel_mode: "Rail",
      obstacles: [],
      is_blocked: false,
      is_secret: false,
    },
    {
      id: "e_rail_rev",
      world_id: "w1",
      from_location_id: "loc_platform",
      to_location_id: "loc_atrium",
      direction_label: "Atrium Express",
      compass_direction: "N",
      distance_meters: 17500,
      speed_modifier: 25,
      travel_mode: "Rail",
      obstacles: [],
      is_blocked: false,
      is_secret: false,
    },
    {
      id: "e_rail_sec_fwd",
      world_id: "w1",
      from_location_id: "loc_atrium",
      to_location_id: "loc_platform",
      direction_label: "Service Tunnels",
      compass_direction: "SW",
      distance_meters: 1400,
      speed_modifier: 1,
      travel_mode: null,
      obstacles: [],
      is_blocked: false,
      is_secret: true,
    },
  ];
  return { containers, locations, edges };
}

describe("v0.37.0 First-Class Map Links", () => {
  it("computes speed presets, clamped modifiers, speed-adjusted durations, and exit phrases", () => {
    expect(LINK_SPEED_PRESETS.map((p) => p.modifier)).toEqual([
      0.25, 0.3, 0.4, 0.6, 1, 2, 3, 5, 10, 25, 60,
    ]);
    expect(LINK_SPEED_PRESET_GROUPS.map((g) => g.label)).toEqual([
      "Terrain & Slow",
      "On Foot & Mounts",
      "Vehicles & Transit",
    ]);
    expect(findMatchingSpeedPreset(0.4)?.id).toBe("swim");
    expect(findMatchingSpeedPreset(5)?.id).toBe("boat");
    expect(findMatchingSpeedPreset(1.45)).toBeNull();
    expect(clampEdgeSpeedModifier(0.001)).toBe(0.05);
    expect(clampEdgeSpeedModifier(999)).toBe(100);
    expect(clampEdgeSpeedModifier(-5)).toBe(1);

    // 2100m @ 0.3x = 2100 / (70 * 0.3) = 100 min (~1h 40min)
    expect(deriveTravelMinutes(2100, 0.3)).toBe(100);
    expect(formatTravelDuration(2100, 0.3)).toBe("~1h 40min");
    expect(formatEffectiveSpeedKmh(0.3)).toBe("1.3 km/h");
    expect(formatExitTravelPhrase(2100, 0.3, "Swamp")).toBe(
      "~1h 40min via Swamp"
    );

    // 17500m @ 25x = 17500 / (70 * 25) = 10 min
    expect(deriveTravelMinutes(17500, 25)).toBe(10);
    expect(formatExitTravelPhrase(17500, 25, "Rail")).toBe(
      "~10 min via Rail"
    );
    expect(formatExitTravelPhrase(350, 1, null)).toBe("~5 min walk");

    // Bundle travel duration across fast Rail (10 min) and Swamp (100 min)
    expect(
      formatBundleTravelDuration([
        { distance_meters: 17500, speed_modifier: 25 },
        { distance_meters: 2100, speed_modifier: 0.3 },
      ])
    ).toBe("~10 min-1h 40min");
  });

  it("enforces Player-mode pre-projection secret filtering, pairwise reveal matching, and GM Mode ghost exposure", () => {
    const { containers, locations, edges } = makeLinksFixture();

    // 1. Player Mode (unlockLore=false, nothing revealed): omits all secret edges completely
    const playerProj = projectTopologyForDepth(
      null,
      containers,
      locations,
      edges,
      "loc_atrium",
      undefined,
      { mode: "campaign", unlockLore: false, revealedEdgeIds: [] }
    );
    expect(
      playerProj.projectedEdges.some((pe) => pe.is_secret || pe.isUndiscoveredSecret)
    ).toBe(false);
    // Secret edge e_rail_sec_fwd is excluded from the supernode bundle count/min distance in Player Mode!
    const playerAgg = playerProj.projectedEdges.find(
      (pe) => pe.targetNodeId === "cont_station" || pe.sourceNodeId === "cont_station"
    )!;
    expect(playerAgg.groupedEdges?.map((e) => e.id)).not.toContain("e_rail_sec_fwd");

    // 2. Pairwise reveal check: revealing e_sec_fwd reveals reciprocal e_sec_rev too
    const revealedPairs = resolveRevealedEdgePairs(edges, ["e_sec_fwd"]);
    expect(
      isEdgeRevealed(edges[3], new Set(["e_sec_fwd"]), revealedPairs)
    ).toBe(true);
    expect(canonicalEdgePairKey("a", "b")).toBe(canonicalEdgePairKey("b", "a"));

    const afterRevealProj = projectTopologyForDepth(
      null,
      containers,
      locations,
      edges,
      "loc_atrium",
      undefined,
      { mode: "campaign", unlockLore: false, revealedEdgeIds: ["e_sec_fwd"] }
    );
    const revealedEdgeOnMap = afterRevealProj.projectedEdges.find(
      (pe) => pe.rawEdge.id === "e_sec_fwd"
    );
    expect(revealedEdgeOnMap).toBeDefined();
    expect(revealedEdgeOnMap?.isUndiscoveredSecret).toBe(false);

    // 3. GM Mode (unlockLore=true): exposes undiscovered secret edges with isUndiscoveredSecret=true
    const gmProj = projectTopologyForDepth(
      null,
      containers,
      locations,
      edges,
      "loc_atrium",
      undefined,
      { mode: "campaign", unlockLore: true, revealedEdgeIds: [] }
    );
    const gmSecret = gmProj.projectedEdges.find((pe) => pe.rawEdge.id === "e_sec_fwd");
    expect(gmSecret?.isUndiscoveredSecret).toBe(true);

    // SVG canvas in GM Mode renders dashed violet stroke + EyeOff & Lock badges
    const coords: Record<string, { x: number; y: number }> = {
      ...computeFullMapCoords(locations, edges, "loc_atrium"),
      cont_station: { x: 160, y: 120 },
    };
    const gmCanvasHtml = renderToStaticMarkup(
      <SpatialTopologyCanvas
        svgRef={{ current: null }}
        canvasWrapRef={{ current: null }}
        viewportGroupRef={{ current: null }}
        panDragRef={{
          current: {
            active: false,
            moved: false,
            button: 0,
            startClientX: 0,
            startClientY: 0,
            origPanX: 0,
            origPanY: 0,
          },
        }}
        mode="campaign"
        zoom={1}
        setZoom={() => {}}
        pan={{ x: 0, y: 0 }}
        setPan={() => {}}
        nodeDrag={null}
        setNodeDrag={() => {}}
        linkDrag={null}
        setLinkDrag={() => {}}
        hoveredNodeKey={null}
        setHoveredNodeKey={() => {}}
        projectedTopology={gmProj}
        fullMapCoords={coords}
        selectedContainer={null}
        selectedLocation={null}
        activeLoc={locations[0]}
        activeNeighborIds={new Set()}
        unreachableSet={new Set()}
        occupiedSlotsByLocId={new Map()}
        isMutatingLocked={false}
        inlineEdgeEdit={null}
        setInlineEdgeEdit={() => {}}
        statusNotice={null}
        setStatusNotice={() => {}}
        setSelectedLocId={() => {}}
        setSelectedContainerId={() => {}}
        setContextMenu={() => {}}
        selectedEdgeState={{ kind: "pair", edgeId: "e_sec_fwd" }}
        openContextMenuAt={() => {}}
        handleUpdateEdgeDistance={() => {}}
        handleDeleteEdge={() => {}}
        handleDeleteEdgeGroup={() => {}}
        drillIntoContainer={() => {}}
      />
    );
    expect(gmCanvasHtml).toContain('stroke="#a78bfa"');
    expect(gmCanvasHtml).toContain("lucide-eye-off");
    expect(gmCanvasHtml).toContain("lucide-lock");
    expect(gmCanvasHtml).toContain('data-edge-selected="true"');
  });

  it("renders MapDetailsDrawer Link Pair Inspector & GM Discovery Banner across Editor, Player, and GM modes", () => {
    const { containers, locations, edges } = makeLinksFixture();
    const bogPair = resolveLinkPairForInspector("e_bog_fwd", edges)!;
    const secretPair = resolveLinkPairForInspector("e_sec_fwd", edges)!;
    const bundlePairs = resolveBundleLinkPairs(
      edges.map((e) => e.id),
      edges
    );
    expect(bundlePairs.length).toBeGreaterThanOrEqual(3);

    const commonProps = {
      selectedLocation: null,
      selectedContainer: null,
      containers,
      allLocations: locations,
      allEdges: edges,
      dynamicPortalIds: new Set<string>(),
      externalPortals: [],
      containerStats: null,
      depthLabels: {
        1: "Building / Landmark",
        2: "District / Zone",
        3: "City / Settlement",
        4: "Region / Planet / Realm",
      } as Record<1 | 2 | 3 | 4, string>,
      onClose: () => {},
      onPatchLocation: () => {},
      onPatchContainer: () => {},
      onResetCoordinates: () => {},
      onDrillIntoContainer: () => {},
      onPatchEdgePair: () => {},
      onDeleteEdge: () => {},
    };

    // 1. World Editor: renders presets, travel summary, obstacles, Blocked & Secret toggles, and Delete Link
    const editorHtml = renderToStaticMarkup(
      <MapDetailsDrawer {...commonProps} mode="editor" selectedEdgePair={bogPair} />
    );
    expect(editorHtml).toContain("Grand Atrium ↔ Mire Boardwalk");
    expect(editorHtml).toContain("2.1km · ~1h 40min");
    expect(editorHtml).toContain("1.3 km/h (0.3×)");
    expect(editorHtml).toContain('placeholder="e.g. 350m, 1.5km"');
    expect(editorHtml).toContain('aria-label="Increase distance"');
    expect(editorHtml).toContain('aria-label="Decrease distance"');
    expect(editorHtml).toContain('aria-label="Speed modifier preset"');
    expect(editorHtml).toContain("Swamp / Bog");
    expect(editorHtml).toContain("link-inspector-card");
    expect(editorHtml).toContain("field-input field-input--compact field-input--cyan");
    expect(editorHtml).not.toContain('class="input"');
    expect(editorHtml).toContain("Knee-Deep Mud");
    expect(editorHtml).toContain('aria-label="Blocked link"');
    expect(editorHtml).toContain('aria-label="Secret link"');
    expect(editorHtml).toContain("Delete Link");

    // 2. Campaign Player Mode: hides Secret toggle and omits Delete Link
    const playerHtml = renderToStaticMarkup(
      <MapDetailsDrawer
        {...commonProps}
        mode="campaign"
        unlockLore={false}
        selectedEdgePair={bogPair}
      />
    );
    expect(playerHtml).toContain('aria-label="Blocked link"');
    expect(playerHtml).not.toContain('aria-label="Secret link"');
    expect(playerHtml).not.toContain("Delete Link");

    // 3. Campaign GM Mode: renders Reveal / Re-hide Secret Link controls
    const gmHiddenHtml = renderToStaticMarkup(
      <MapDetailsDrawer
        {...commonProps}
        mode="campaign"
        unlockLore={true}
        isEdgeSavedSecretInDb={true}
        revealedEdgeIds={[]}
        selectedEdgePair={secretPair}
        onToggleEdgeReveal={() => {}}
      />
    );
    expect(gmHiddenHtml).toContain("Hidden from players");
    expect(gmHiddenHtml).toContain("Reveal to Players");

    const gmRevealedHtml = renderToStaticMarkup(
      <MapDetailsDrawer
        {...commonProps}
        mode="campaign"
        unlockLore={true}
        isEdgeSavedSecretInDb={true}
        revealedEdgeIds={["e_sec_fwd"]}
        selectedEdgePair={secretPair}
        onToggleEdgeReveal={() => {}}
      />
    );
    expect(gmRevealedHtml).toContain("Discovered on this branch");
    expect(gmRevealedHtml).toContain("Re-hide Secret Link");
  });

  it("reassigns a single edge's compass slot to an empty port without touching reciprocal or allowing collisions", () => {
    const { edges } = makeLinksFixture();
    // Move e_bog_fwd (loc_atrium -> loc_bog) from E to NE
    const moved = reassignEdgeCompassSlot(edges, "e_bog_fwd", "NE");
    expect(moved.changed).toBe(true);
    const updatedFwd = moved.edges.find((e) => e.id === "e_bog_fwd");
    const untouchedRev = moved.edges.find((e) => e.id === "e_bog_rev");
    expect(updatedFwd?.compass_direction).toBe("NE");
    // Reciprocal end on loc_bog stays local/untouched
    expect(untouchedRev?.compass_direction).toBe("W");

    // Attempting to move e_bog_fwd onto S (occupied by e_sec_fwd on loc_atrium) is blocked
    const blocked = reassignEdgeCompassSlot(edges, "e_bog_fwd", "S");
    expect(blocked.changed).toBe(false);
    expect(blocked.reason).toContain("Port S is already occupied");

    // Moving to its own slot is a no-op
    const same = reassignEdgeCompassSlot(edges, "e_bog_fwd", "E");
    expect(same.changed).toBe(false);
    expect(same.reason).toBeUndefined();
  });

  it("hit-tests same-location compass ports accurately for empty, occupied, and origin slots", () => {
    const center = { x: 100, y: 100 };
    const occupied = new Set<CompassDirection>(["E", "S"]);

    const neX = center.x + Math.cos(COMPASS_ANGLES.NE) * LOCATION_PORT_RADIUS;
    const neY = center.y + Math.sin(COMPASS_ANGLES.NE) * LOCATION_PORT_RADIUS;
    expect(hitTestSameLocationPortAt(neX, neY, center, occupied, "E")).toEqual({
      slot: "NE",
      blocked: false,
    });

    const sX = center.x + Math.cos(COMPASS_ANGLES.S) * LOCATION_PORT_RADIUS;
    const sY = center.y + Math.sin(COMPASS_ANGLES.S) * LOCATION_PORT_RADIUS;
    expect(hitTestSameLocationPortAt(sX, sY, center, occupied, "E")).toEqual({
      slot: "S",
      blocked: true,
    });

    const eX = center.x + Math.cos(COMPASS_ANGLES.E) * LOCATION_PORT_RADIUS;
    const eY = center.y + Math.sin(COMPASS_ANGLES.E) * LOCATION_PORT_RADIUS;
    expect(hitTestSameLocationPortAt(eX, eY, center, occupied, "E")).toEqual({
      slot: "E",
      blocked: false,
    });

    // Far away returns null
    expect(hitTestSameLocationPortAt(250, 250, center, occupied, "E")).toBeNull();
  });

  it("resolves opposite-end port connection previews across direct locations, container supernodes, and ghost nodes", () => {
    const { containers, locations, edges } = makeLinksFixture();
    const locationMap = new Map(locations.map((l) => [l.id, l]));

    // 1. Root view: loc_atrium (E) -> loc_bog (W) direct visible location
    const rootProj = projectTopologyForDepth(
      null,
      containers,
      locations,
      edges,
      "loc_atrium",
      undefined,
      { mode: "editor" }
    );
    const directPreview = resolvePortConnectionPreview({
      locationId: "loc_atrium",
      slot: "E",
      edges,
      projectedTopology: rootProj,
      locationMap,
    });
    expect(directPreview).not.toBeNull();
    expect(directPreview?.targetKind).toBe("location");
    expect(directPreview?.targetNodeId).toBe("loc_bog");
    expect(directPreview?.targetSlot).toBe("W");
    expect(directPreview?.edgePairKey).toBe("loc_atrium<->loc_bog");
    expect(directPreview?.tooltipText).toBe("E → Mire Boardwalk (W)");

    // 2. Root view: loc_atrium (S) -> loc_platform (inside cont_station supernode)
    const supernodePreview = resolvePortConnectionPreview({
      locationId: "loc_atrium",
      slot: "S",
      edges,
      projectedTopology: rootProj,
      locationMap,
    });
    expect(supernodePreview).not.toBeNull();
    expect(supernodePreview?.targetKind).toBe("container");
    expect(supernodePreview?.targetNodeId).toBe("cont_station");
    expect(supernodePreview?.targetSlot).toBeNull();
    expect(supernodePreview?.targetContainerName).toBe("Transit Hall");
    expect(supernodePreview?.tooltipText).toContain("inside Transit Hall");

    // 3. Drilled into cont_station: loc_platform (N) -> loc_atrium (rendered as external ghost node)
    const interiorProj = projectTopologyForDepth(
      "cont_station",
      containers,
      locations,
      edges,
      "loc_platform",
      undefined,
      { mode: "editor" }
    );
    const ghostPreview = resolvePortConnectionPreview({
      locationId: "loc_platform",
      slot: "N",
      edges,
      projectedTopology: interiorProj,
      locationMap,
    });
    expect(ghostPreview).not.toBeNull();
    expect(ghostPreview?.targetKind).toBe("ghost");
    expect(ghostPreview?.targetNodeId).toBe("loc_atrium");
    expect(ghostPreview?.edgePairKey).toBe("ghost:loc_atrium<->loc_platform");
  });

  it("highlights the opposite-end node, reciprocal port dot, and edge during port preview / reassignment", () => {
    const { containers, locations, edges } = makeLinksFixture();
    const locationMap = new Map(locations.map((l) => [l.id, l]));
    const proj = projectTopologyForDepth(
      null,
      containers,
      locations,
      edges,
      "loc_atrium",
      undefined,
      { mode: "editor" }
    );
    const coords: Record<string, { x: number; y: number }> = {
      ...computeFullMapCoords(locations, edges, "loc_atrium"),
      cont_station: { x: 160, y: 120 },
    };
    const occupiedSlotsByLocId = new Map<string, Set<CompassDirection>>();
    for (const e of edges) {
      if (!e.compass_direction) continue;
      if (!occupiedSlotsByLocId.has(e.from_location_id)) {
        occupiedSlotsByLocId.set(e.from_location_id, new Set());
      }
      occupiedSlotsByLocId.get(e.from_location_id)!.add(e.compass_direction);
    }

    const atriumPt = coords.loc_atrium;
    const startX = atriumPt.x + Math.cos(COMPASS_ANGLES.E) * LOCATION_PORT_RADIUS;
    const startY = atriumPt.y + Math.sin(COMPASS_ANGLES.E) * LOCATION_PORT_RADIUS;
    const currX = atriumPt.x + Math.cos(COMPASS_ANGLES.NE) * LOCATION_PORT_RADIUS;
    const currY = atriumPt.y + Math.sin(COMPASS_ANGLES.NE) * LOCATION_PORT_RADIUS;

    const canvasHtml = renderToStaticMarkup(
      <SpatialTopologyCanvas
        svgRef={{ current: null } as unknown as React.RefObject<SVGSVGElement>}
        viewportGroupRef={{ current: null } as unknown as React.RefObject<SVGGElement>}
        panDragRef={{
          current: {
            active: false,
            moved: false,
            button: 0,
            startClientX: 0,
            startClientY: 0,
            origPanX: 0,
            origPanY: 0,
          },
        }}
        mode="editor"
        zoom={1}
        setZoom={() => {}}
        pan={{ x: 0, y: 0 }}
        setPan={() => {}}
        nodeDrag={null}
        setNodeDrag={() => {}}
        linkDrag={null}
        setLinkDrag={() => {}}
        portReassignDrag={{
          locationId: "loc_atrium",
          edgeId: "e_bog_fwd",
          fromSlot: "E",
          startClientX: 0,
          startClientY: 0,
          startX,
          startY,
          currX,
          currY,
          hasMoved: true,
          hoverSlot: "NE",
          hoverSlotBlocked: false,
        }}
        setPortReassignDrag={() => {}}
        hoveredNodeKey={null}
        setHoveredNodeKey={() => {}}
        projectedTopology={proj}
        workingEdges={edges}
        locationMap={locationMap}
        fullMapCoords={coords}
        selectedContainer={null}
        selectedLocation={null}
        activeLoc={locations[0]}
        activeNeighborIds={new Set()}
        unreachableSet={new Set()}
        occupiedSlotsByLocId={occupiedSlotsByLocId}
        isMutatingLocked={false}
        inlineEdgeEdit={null}
        setInlineEdgeEdit={() => {}}
        statusNotice={null}
        setStatusNotice={() => {}}
        setSelectedLocId={() => {}}
        setSelectedContainerId={() => {}}
        setContextMenu={() => {}}
        openContextMenuAt={() => {}}
        handleUpdateEdgeDistance={() => {}}
        handleDeleteEdge={() => {}}
        handleDeleteEdgeGroup={() => {}}
        drillIntoContainer={() => {}}
      />
    );

    expect(canvasHtml).toContain('data-port-preview-edge="true"');
    expect(canvasHtml).toContain('data-port-preview-target="location"');
    expect(canvasHtml).toContain('data-port-preview-target-slot="loc_bog:W"');
    expect(canvasHtml).toContain('stroke="#10b981"');
  });

  it("renders editable Compass Ports grids in MapLinkInspectorSection with occupied other slots disabled", () => {
    const { containers, locations, edges } = makeLinksFixture();
    const bogPair = resolveLinkPairForInspector("e_bog_fwd", edges)!;
    const locMap = new Map(locations.map((l) => [l.id, l]));

    // Excluding e_bog_fwd itself, loc_atrium still has N and S occupied by other links
    const otherOccupied = getLocationOccupiedPorts("loc_atrium", edges, locMap, "e_bog_fwd");
    expect(otherOccupied.has("E")).toBe(false);
    expect(otherOccupied.has("N")).toBe(true);
    expect(otherOccupied.has("S")).toBe(true);

    const html = renderToStaticMarkup(
      <MapDetailsDrawer
        mode="editor"
        selectedLocation={null}
        selectedContainer={null}
        selectedEdgePair={bogPair}
        containers={containers}
        allLocations={locations}
        allEdges={edges}
        dynamicPortalIds={new Set<string>()}
        externalPortals={[]}
        containerStats={null}
        depthLabels={{
          1: "Building / Landmark",
          2: "District / Zone",
          3: "City / Settlement",
          4: "Region / Planet / Realm",
        }}
        onClose={() => {}}
        onPatchLocation={() => {}}
        onPatchContainer={() => {}}
        onResetCoordinates={() => {}}
        onDrillIntoContainer={() => {}}
        onPatchEdgePair={() => {}}
        onDeleteEdge={() => {}}
      />
    );

    expect(html).toContain('data-testid="link-compass-ports-card"');
    expect(html).toContain('data-testid="link-compass-primary"');
    expect(html).toContain('data-testid="link-compass-reciprocal"');
    expect(html).toContain('aria-label="Exit on Grand Atrium: E"');
    expect(html).toContain('aria-label="Exit on Mire Boardwalk: W"');
    expect(html).toContain('title="N — occupied by Hidden Archive"');
    expect(html).toContain('title="S — occupied by Mag-Lev Platform"');
    expect(html).toContain('title="NE — move port here"');
  });
});
