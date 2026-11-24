import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LocationContainer, LocationEdge, LocationNode } from "../../types";
import {
  LINK_SPEED_PRESETS,
  clampEdgeSpeedModifier,
  deriveTravelMinutes,
  formatBundleTravelDuration,
  formatEffectiveSpeedKmh,
  formatExitTravelPhrase,
  formatTravelDuration,
} from "../../utils/spatialDistance";
import {
  canonicalEdgePairKey,
  isEdgeRevealed,
  projectTopologyForDepth,
  resolveBundleLinkPairs,
  resolveLinkPairForInspector,
  resolveRevealedEdgePairs,
} from "../map/topologyProjection";
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
      0.3, 0.6, 1, 3, 10, 25, 60,
    ]);
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
});
