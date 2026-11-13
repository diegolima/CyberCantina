import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CampaignStateBundle,
  CharacterRecord,
  LocationContainer,
  LocationEdge,
  LocationNode,
  UseMagicWandReturn,
  WorldRecord,
} from "../../types";
import { LiveInspector } from "../LiveInspector";
import { MagicWandButton } from "../MagicWandButton";
import {
  SpatialTopologyView,
  computeFullMapCoords,
  projectTopologyForDepth,
} from "../SpatialTopologyView";
import { MapDetailsDrawer } from "../map/MapDetailsDrawer";
import { SpatialTopologyCanvas } from "../map/SpatialTopologyCanvas";
import {
  EmptyCanvasCreateModal,
  GroupIntoContainerModal,
  PassageHubCollisionModal,
  StandaloneContainerCreateModal,
} from "../map/MapDialogs";
import {
  CONTAINER_CARD_HALF_W,
  HUB_RADIUS,
  LOCATION_TILE_HALF,
  clampZoom,
  computeDistanceBadgeWidth,
  computeEdgeClippedSegment,
  computeRayShapeExitDistance,
  isEditableKeyboardTarget,
  resolveCanvasCursor,
} from "../map/mapGeometry";
import {
  filterEdgesAfterDeletion,
  parseCommittedEdgeMinutes,
  stepEdgeMinutesDraft,
} from "../map/topologyProjection";
import { getDefaultMapIconKey, resolveMapIconComponent } from "../map/mapIcons";
import {
  computeUnreachableLocationIds,
  containerHasVisitedDescendants,
  isValidContainerDrop,
  validateVisitedAncestorContainment,
} from "../map/mapValidation";

function makeRichWorldFixture() {
  const containers: LocationContainer[] = [
    {
      id: "cont_district",
      world_id: "world_1",
      parent_container_id: null,
      depth: 2,
      name: "Watson District",
      description: "Port ward.",
      environmental_tags: ["industrial"],
      lore_nodes: [],
      icon: "map",
      ui_x: 120,
      ui_y: -40,
    },
    {
      id: "cont_club",
      world_id: "world_1",
      parent_container_id: "cont_district",
      depth: 1,
      name: "Afterlife Club",
      description: "Mercenary bar.",
      environmental_tags: ["neon"],
      lore_nodes: [],
      icon: "beer",
      ui_x: 40,
      ui_y: 80,
    },
    {
      id: "cont_clinic",
      world_id: "world_1",
      parent_container_id: null,
      depth: 1,
      name: "Viktor Clinic",
      description: "Ripperdoc basement.",
      environmental_tags: ["sterile"],
      lore_nodes: [],
      icon: "building-2",
    },
  ];

  const locations: LocationNode[] = [
    {
      id: "loc_foyer",
      world_id: "world_1",
      container_id: "cont_club",
      is_entry_exit: true,
      name: "Main Floor",
      summary: "Crowded bar.",
      description: "Sub-bass thumps across neon booths.",
      environmental_tags: ["neon", "crowd"],
      is_starting_location: true,
      is_hub: false,
      is_visited: true,
      icon: "beer",
      ui_x: 0,
      ui_y: 0,
    },
    {
      id: "loc_hub",
      world_id: "world_1",
      container_id: "cont_district",
      is_entry_exit: false,
      name: "Canal Junction",
      summary: "Walkway intersection.",
      description: "Wet concrete crossroads under highway pylons.",
      environmental_tags: ["rain"],
      is_starting_location: false,
      is_hub: true,
      is_visited: false,
      icon: "git-branch",
      ui_x: 200,
      ui_y: 0,
    },
    {
      id: "loc_street",
      world_id: "world_1",
      container_id: null,
      is_entry_exit: false,
      name: "Harbor Pier",
      summary: "Foggy dock.",
      description: "Sodium lamps glow over rusting cargo barges.",
      environmental_tags: ["fog"],
      is_starting_location: false,
      is_hub: false,
      is_visited: false,
      icon: "anchor",
    },
  ];

  const edges: LocationEdge[] = [
    {
      id: "e1",
      world_id: "world_1",
      from_location_id: "loc_foyer",
      to_location_id: "loc_hub",
      direction_label: "Out onto Canal",
      compass_direction: "E",
      travel_minutes: 2,
      is_locked_or_hidden: false,
    },
    {
      id: "e2",
      world_id: "world_1",
      from_location_id: "loc_hub",
      to_location_id: "loc_foyer",
      direction_label: "Into Afterlife",
      compass_direction: "W",
      travel_minutes: 2,
      is_locked_or_hidden: false,
    },
    {
      id: "e3",
      world_id: "world_1",
      from_location_id: "loc_hub",
      to_location_id: "loc_street",
      direction_label: "Down to Harbor",
      compass_direction: "S",
      travel_minutes: 4,
      is_locked_or_hidden: false,
    },
    {
      id: "e4",
      world_id: "world_1",
      from_location_id: "loc_street",
      to_location_id: "loc_hub",
      direction_label: "Back to Canal",
      compass_direction: "N",
      travel_minutes: 4,
      is_locked_or_hidden: false,
    },
  ];

  return { containers, locations, edges };
}

describe("Interactive Map Editor & Mini-Map", () => {
  it("validates bidirectional reachability and rejects orphans or one-way traps", () => {
    const { locations, edges } = makeRichWorldFixture();

    const clean = computeUnreachableLocationIds(locations, edges);
    expect(clean.starterError).toBeNull();
    expect(clean.unreachableIds).toEqual([]);

    // One-way trap: drop return edge loc_street -> loc_hub
    const oneWayEdges = edges.filter((e) => e.id !== "e4");
    const oneWayReport = computeUnreachableLocationIds(locations, oneWayEdges);
    expect(oneWayReport.starterError).toBeNull();
    expect(oneWayReport.unreachableIds).toEqual(["loc_street"]);

    // Temporary orphan node
    const withOrphan: LocationNode[] = [
      ...locations,
      {
        id: "loc_orphan",
        world_id: "world_1",
        name: "Floating Skylight",
        summary: "Unlinked",
        description: "No exits yet.",
        environmental_tags: [],
        is_starting_location: false,
      },
    ];
    const orphanReport = computeUnreachableLocationIds(withOrphan, edges);
    expect(orphanReport.unreachableIds).toEqual(["loc_orphan"]);

    // Missing starting location
    const noStart = locations.map((l) => ({ ...l, is_starting_location: false }));
    expect(computeUnreachableLocationIds(noStart, edges).starterError).toMatch(
      /Starting Location/i
    );
  });

  it("enforces container depth rules and campaign visited ancestor monotonicity on drops", () => {
    const { containers, locations } = makeRichWorldFixture();

    // Same-level L1 -> L1 rejected
    expect(
      isValidContainerDrop({
        draggedKind: "container",
        draggedId: "cont_clinic",
        targetKind: "container",
        targetId: "cont_club",
        currentContainerId: null,
        containers,
        locations,
      })
    ).toMatchObject({ valid: false });

    // Lower-level L1 (cont_clinic) into higher-level L2 (cont_district) allowed
    expect(
      isValidContainerDrop({
        draggedKind: "container",
        draggedId: "cont_clinic",
        targetKind: "container",
        targetId: "cont_district",
        currentContainerId: null,
        containers,
        locations,
      })
    ).toMatchObject({ valid: true });

    // Grouping L0-on-L0 inside L1 container is forbidden
    const insideClub: LocationNode = {
      ...locations[2],
      id: "loc_vip",
      container_id: "cont_club",
    };
    expect(
      isValidContainerDrop({
        draggedKind: "location",
        draggedId: insideClub.id,
        targetKind: "location",
        targetId: "loc_foyer",
        currentContainerId: "cont_club",
        containers,
        locations: [...locations, insideClub],
      })
    ).toMatchObject({ valid: false });

    // Campaign mode: visited loc_hub placed inside L2 can be wrapped inside an L1 inside that L2
    const visitedInDistLocs = locations.map((l) =>
      l.id === "loc_hub" ? { ...l, is_visited: true } : l
    );
    const l1InsideDist: LocationContainer = {
      id: "cont_new_l1",
      world_id: "world_1",
      parent_container_id: "cont_district",
      depth: 1,
      name: "Junction Kiosk",
      description: "",
      environmental_tags: [],
    };
    expect(
      validateVisitedAncestorContainment(
        "cont_district",
        containers,
        l1InsideDist.id,
        [...containers, l1InsideDist]
      ).valid
    ).toBe(true);

    // Campaign mode: visited loc_foyer inside cont_club CANNOT move out to root or cont_clinic
    expect(
      isValidContainerDrop({
        draggedKind: "location",
        draggedId: "loc_foyer",
        targetKind: "container",
        targetId: "cont_clinic",
        currentContainerId: "cont_club",
        containers,
        locations: visitedInDistLocs,
        campaignMode: true,
        originalContainers: containers,
        originalLocations: visitedInDistLocs,
      })
    ).toMatchObject({ valid: false });

    // Container holding visited descendant cannot move out of its parent cont_district to root
    expect(containerHasVisitedDescendants("cont_club", containers, locations)).toBe(
      true
    );
    expect(
      isValidContainerDrop({
        draggedKind: "container",
        draggedId: "cont_club",
        targetKind: "root",
        currentContainerId: null,
        containers,
        locations,
        campaignMode: true,
        originalContainers: containers,
        originalLocations: locations,
      })
    ).toMatchObject({ valid: false });
  });

  it("preserves pinned ui_x/ui_y coordinates while placing null-coordinate neighbors nearby", () => {
    const { locations, edges } = makeRichWorldFixture();
    const coords = computeFullMapCoords(locations, edges, "loc_foyer");
    expect(coords["loc_foyer"]).toEqual({ x: 0, y: 0 });
    expect(coords["loc_hub"]).toEqual({ x: 200, y: 0 });
    expect(coords["loc_street"]).toBeDefined();
    expect(Number.isFinite(coords["loc_street"].x)).toBe(true);
    expect(Number.isFinite(coords["loc_street"].y)).toBe(true);
  });

  it("resolves map icon defaults and overrides cleanly", () => {
    expect(getDefaultMapIconKey("location")).toBe("map-pin");
    expect(getDefaultMapIconKey("hub")).toBe("git-branch");
    expect(getDefaultMapIconKey("container", 1)).toBe("building-2");
    expect(getDefaultMapIconKey("container", 2)).toBe("map");
    expect(getDefaultMapIconKey("container", 4)).toBe("globe-2");

    const BeerIcon = resolveMapIconComponent("beer", "location");
    const FallbackLocIcon = resolveMapIconComponent("unknown-key", "location");
    expect(BeerIcon).toBeDefined();
    expect(FallbackLocIcon).toBeDefined();
    expect(BeerIcon).not.toBe(FallbackLocIcon);
  });

  it("renders compact MagicWandButton states cleanly", () => {
    const idleWand: UseMagicWandReturn = {
      status: "idle",
      error: null,
      canEnrich: true,
      canRevert: false,
      isDirtyAfterApply: false,
      triggerEnrich: async () => {},
      cancelEnrich: () => {},
      revert: () => {},
      dismissUndo: () => {},
      reset: () => {},
    };
    const idleHtml = renderToStaticMarkup(
      <MagicWandButton
        wand={idleWand}
        isInputEmpty={false}
        isSlashCommand={false}
        variant="compact"
        compactLabel="Suggest Tags"
        iconAccent="violet"
      />
    );
    expect(idleHtml).toContain("Suggest Tags");

    const appliedWand: UseMagicWandReturn = {
      ...idleWand,
      status: "applied",
      canRevert: true,
    };
    const appliedHtml = renderToStaticMarkup(
      <MagicWandButton
        wand={appliedWand}
        isInputEmpty={false}
        isSlashCommand={false}
        variant="compact"
        compactLabel="Enrich Description"
        iconAccent="amber"
      />
    );
    expect(appliedHtml).toContain("magic-wand-revert-bar compact");
    expect(appliedHtml).toContain("Undo");
  });

  it("renders MapDetailsDrawer hidden when unselected, and locks visited campaign narrative while keeping icon editable", () => {
    const { containers, locations } = makeRichWorldFixture();

    // Empty when deselected
    const emptyHtml = renderToStaticMarkup(
      <MapDetailsDrawer
        mode="editor"
        selectedLocation={null}
        selectedContainer={null}
        containers={containers}
        allLocations={locations}
        dynamicPortalIds={new Set()}
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
      />
    );
    expect(emptyHtml).toBe("");

    // Visited campaign location: lock notice, disabled inputs, enabled icon button, no legacy delete/link forms
    const visitedHtml = renderToStaticMarkup(
      <MapDetailsDrawer
        mode="campaign"
        selectedLocation={locations[0]}
        selectedContainer={null}
        containers={containers}
        allLocations={locations}
        dynamicPortalIds={new Set(["loc_foyer"])}
        externalPortals={[]}
        containerStats={null}
        activeLocId="loc_foyer"
        worldContext={{ worldName: "Night Sector", genre: "Cyberpunk" }}
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
      />
    );
    expect(visitedHtml).toContain("Visited location");
    expect(visitedHtml).toContain("Choose map icon");
    expect(visitedHtml).toContain("Enrich Description");
    expect(visitedHtml).toContain("Suggest Tags");
    expect(visitedHtml).not.toContain("Delete Location");
    expect(visitedHtml).not.toContain("Convert to Container");
    expect(visitedHtml).not.toContain("Create Link");
  });

  it("renders SpatialTopologyView palette, unlinked warnings, dialogs, and upgraded LiveInspector mini-map", () => {
    const { containers, locations, edges } = makeRichWorldFixture();

    const orphanLoc: LocationNode = {
      id: "loc_unlinked",
      world_id: "world_1",
      container_id: null,
      name: "Dark Roof",
      summary: "Isolated rooftop.",
      description: "No stairs down yet.",
      environmental_tags: ["wind"],
      is_starting_location: false,
      is_visited: false,
    };

    const viewHtml = renderToStaticMarkup(
      <SpatialTopologyView
        title="Editor Topology"
        containers={containers}
        locations={[...locations, orphanLoc]}
        edges={edges}
        activeLocationId="loc_foyer"
        mode="editor"
        hasUnsavedChanges
        onSaveMap={() => {}}
        onChangeGraph={() => {}}
      />
    );
    expect(viewHtml).toContain("+ Location");
    expect(viewHtml).toContain("+ Passage Hub");
    expect(viewHtml).toContain("+ Container");
    expect(viewHtml).toContain("1 Unlinked Node");
    expect(viewHtml).toContain("Save Map");
    expect(viewHtml).toContain("disabled=\"\"");

    // Dialogs SSR verification
    const hubDlgHtml = renderToStaticMarkup(
      <PassageHubCollisionModal
        state={{
          sourceNodeId: "loc_foyer",
          sourceName: "Main Floor",
          sourceSlot: "E",
          targetNodeId: "loc_street",
          targetName: "Harbor Pier",
          targetSlot: "W",
          collidingSide: "source",
          occupiedByName: "Canal Junction",
          suggestedHubName: "Main Floor — Junction",
          travelMinutes: 2,
          x: 50,
          y: 0,
        }}
        onCancel={() => {}}
        onConfirm={() => {}}
      />
    );
    expect(hubDlgHtml).toContain("Create Passage Hub to Share Exit?");
    expect(hubDlgHtml).toContain("Decline (Cancel Link)");

    const emptyDlgHtml = renderToStaticMarkup(
      <EmptyCanvasCreateModal
        state={{
          sourceKind: "location",
          sourceId: "loc_foyer",
          sourceName: "Main Floor",
          sourceSlot: "S",
          dropX: 40,
          dropY: 120,
          canCreateContainer: true,
          availableDepths: [1, 2],
        }}
        onCancel={() => {}}
        onCreate={() => {}}
      />
    );
    expect(emptyDlgHtml).toContain("Passage Hub");
    expect(emptyDlgHtml).toContain("Container");

    const groupDlgHtml = renderToStaticMarkup(
      <GroupIntoContainerModal
        state={{
          draggedLoc: locations[2],
          targetLoc: locations[1],
          parentContainerId: null,
        }}
        onCancel={() => {}}
        onConfirm={() => {}}
      />
    );
    expect(groupDlgHtml).toContain("Group into New Container (L1)");

    // LiveInspector mini-map SVG & selected card
    const world: WorldRecord = {
      id: "world_1",
      name: "Night Sector",
      global_rules: {
        genre: "Cyberpunk",
        tone: "Gritty",
        setting_overview: "Rain-slicked megacity.",
        tech_or_magic_rules: "Cyberware & netrunning",
        starting_timestamp: "Day 1, 22:00",
      },
      created_at: "2026-01-01T00:00:00Z",
      containers,
      locations,
      edges,
      lore_nodes: [],
    };
    const char: CharacterRecord = {
      id: "char_1",
      version: 1,
      name: "V",
      tagline: "Afterlife solo",
      physical_appearance: "Leather jacket and cyberware seams.",
      core_persona: "Sharp solo.",
      initial_message: "Need a drink.",
      quirks_flaws: [],
      communication_style: [],
      inventory: [],
      voice_anchors: [],
      baseline_psyche: {
        mood_label: "Calm",
        valence: 0.2,
        arousal: 0.3,
        core_drive: "Survive Night City",
        core_fear: "Being forgotten",
        default_want: "Meet Fixer",
        default_plan: "Order at the bar and watch the door.",
      },
      memory_shards: [],
      tags: [],
      creator: "",
      creator_notes: "",
      portraits: {},
      gallery: [],
      created_at: "2026-01-01T00:00:00Z",
    };
    const worldSnapshot = {
      turn_id: "turn_0",
      world_timestamp: "2077-05-01T22:00:00Z",
      campaign_elapsed_minutes: 0,
      active_location_id: "loc_foyer",
      scene_flags: [],
      visited_location_ids: ["loc_foyer"],
    };
    const charState = {
      turn_id: "turn_0",
      character_id: "char_1",
      current_location_id: "loc_foyer",
      mood_label: "Alert",
      valence: 0.1,
      arousal: 0.6,
      active_want: "Meet Fixer",
      active_plan: "Scan the booth",
      relationship_notes: {},
      inventory: [],
    };
    const bundle: CampaignStateBundle = {
      campaign: {
        id: "camp_1",
        name: "Afterlife Run",
        world_id: world.id,
        character_id: char.id,
        persona_snapshot: null,
        active_leaf_turn_id: "turn_0",
        created_at: "2026-01-01T00:00:00Z",
      },
      active_branch_turns: [],
      all_turn_nodes: [],
      current_world_snapshot: worldSnapshot,
      current_character_state: charState,
      active_location: locations[0],
      neighbor_locations: [
        {
          edge_id: "e1",
          direction_label: "Out onto Canal",
          compass_direction: "E",
          travel_minutes: 2,
          is_locked_or_hidden: false,
          destination: locations[1],
        },
      ],
      containers,
      visible_locations: locations,
      visible_edges: edges,
      episodic_chunks: [],
    };

    const inspectorHtml = renderToStaticMarkup(
      <LiveInspector bundle={bundle} world={world} character={char} />
    );
    expect(inspectorHtml).toContain("L1 · Afterlife C");
    expect(inspectorHtml).toContain("[Watson Distr");
    expect(inspectorHtml).toContain("<polygon");
    expect(inspectorHtml).toContain("Portal");
  });

  it("clips link segments to node perimeters, sizes badges, clamps zoom, and resolves canvas cursors", () => {
    // Location cardinal & diagonal rounded-corner ray exit
    expect(computeRayShapeExitDistance(100, 0, { kind: "location" })).toBeCloseTo(
      LOCATION_TILE_HALF,
      4
    );
    const diagLoc = computeRayShapeExitDistance(100, 100, { kind: "location" });
    expect(diagLoc).toBeGreaterThan(LOCATION_TILE_HALF);
    expect(diagLoc).toBeLessThan(LOCATION_TILE_HALF * Math.SQRT2);

    // Hub octagon apothem vs vertex
    expect(computeRayShapeExitDistance(100, 0, { kind: "hub" })).toBeCloseTo(
      HUB_RADIUS * Math.cos(Math.PI / 8),
      4
    );

    // Container card horizontal exit
    expect(computeRayShapeExitDistance(100, 0, { kind: "container" })).toBeCloseTo(
      CONTAINER_CARD_HALF_W,
      4
    );

    // Asymmetric container -> location clipped segment places midpoint in visible gap
    const clipped = computeEdgeClippedSegment(
      { x: 0, y: 0 },
      { kind: "container" },
      { x: 200, y: 0 },
      { kind: "location" }
    );
    expect(clipped.collapsed).toBe(false);
    expect(clipped.x1).toBeCloseTo(74, 4);
    expect(clipped.x2).toBeCloseTo(182, 4);
    expect(clipped.midX).toBeCloseTo(128, 4);

    // Coincident and overlapping centers collapse safely without NaN
    const coincident = computeEdgeClippedSegment(
      { x: 50, y: 50 },
      { kind: "location" },
      { x: 50, y: 50 },
      { kind: "location" }
    );
    expect(coincident.collapsed).toBe(true);
    expect(Number.isFinite(coincident.midX)).toBe(true);

    const overlapping = computeEdgeClippedSegment(
      { x: 0, y: 0 },
      { kind: "container" },
      { x: 20, y: 0 },
      { kind: "location" }
    );
    expect(overlapping.collapsed).toBe(true);
    expect(overlapping.midX).toBe(10);

    // Dynamic badge width & zoom clamping & cursor precedence
    expect(computeDistanceBadgeWidth("2m")).toBe(44);
    expect(computeDistanceBadgeWidth("240m · 12 🔒")).toBeGreaterThan(44);
    expect(clampZoom(0.1)).toBe(0.35);
    expect(clampZoom(5)).toBe(3);
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(
      resolveCanvasCursor({ isNodeDragging: false, isLinking: false, isPanning: false })
    ).toBe("grab");
    expect(
      resolveCanvasCursor({ isNodeDragging: false, isLinking: false, isPanning: true })
    ).toBe("grabbing");
    expect(
      resolveCanvasCursor({ isNodeDragging: false, isLinking: true, isPanning: false })
    ).toBe("crosshair");
    expect(
      resolveCanvasCursor({ isNodeDragging: true, isLinking: false, isPanning: false })
    ).toBe("grabbing");
  });

  it("renders layered opaque edge badges, location terminology, decoupled zoom HUD, and container level modal", () => {
    const { containers, locations, edges } = makeRichWorldFixture();
    const html = renderToStaticMarkup(
      <SpatialTopologyView
        title="UX Polish Topology"
        containers={containers}
        locations={locations}
        edges={edges}
        activeLocationId="loc_foyer"
        mode="editor"
        onSaveMap={() => {}}
        onChangeGraph={() => {}}
      />
    );

    // Paint order: edge-lines -> edge-badges -> nodes
    const linesIdx = html.indexOf('data-layer="edge-lines"');
    const badgesIdx = html.indexOf('data-layer="edge-badges"');
    const nodesIdx = html.indexOf('data-layer="nodes"');
    expect(linesIdx).toBeGreaterThan(-1);
    expect(badgesIdx).toBeGreaterThan(linesIdx);
    expect(nodesIdx).toBeGreaterThan(badgesIdx);

    // Opaque distance badge and "locations" terminology
    expect(html).toContain('fill-opacity="1"');
    expect(html).not.toContain('fill-opacity="0.9"');
    expect(html).toContain("locations ·");
    expect(html).not.toContain("rooms ·");

    // Hover buffer around location
    expect(html).toContain('r="34"');

    // Decoupled zoom indicator & Center button
    expect(html).toContain("Current zoom 100%, click to reset");
    expect(html).toContain('data-testid="canvas-zoom-indicator"');
    expect(html).not.toContain("Center (100%)");

    // Standalone container depth prompt shows Lore (L1) and Higher-Level Macro options
    const standaloneDlgHtml = renderToStaticMarkup(
      <StandaloneContainerCreateModal
        state={{
          x: 100,
          y: 100,
          parentContainerId: null,
          availableDepths: [1, 2, 3, 4],
        }}
        onCancel={() => {}}
        onCreate={() => {}}
      />
    );
    expect(standaloneDlgHtml).toContain("Lore Container");
    expect(standaloneDlgHtml).toContain("Building / Landmark");
    expect(standaloneDlgHtml).toContain("Higher-Level Macro Containers");
    expect(standaloneDlgHtml).toContain("District / Zone");
    expect(standaloneDlgHtml).toContain("City / Settlement");
    expect(standaloneDlgHtml).toContain("Region / Planet / Realm");
    expect(standaloneDlgHtml).toContain("Create initial entry location inside container");
  });

  it("supports inline editor HTML overlay, L1 container Magic Wand boundaries, Delete target guards, and atomic edge-group deletion (v0.10.2)", () => {
    const { containers, locations, edges } = makeRichWorldFixture();

    // 1. Pure inline edge travel-minute stepping & commit parsing
    expect(stepEdgeMinutesDraft("5", 1)).toBe("6");
    expect(stepEdgeMinutesDraft("1", -1)).toBe("1");
    expect(stepEdgeMinutesDraft("240", 1)).toBe("240");
    expect(stepEdgeMinutesDraft("", 1, 7)).toBe("8");
    expect(parseCommittedEdgeMinutes("")).toBeNull();
    expect(parseCommittedEdgeMinutes("0")).toBe(1);
    expect(parseCommittedEdgeMinutes("310")).toBe(240);
    expect(parseCommittedEdgeMinutes("18")).toBe(18);

    // 2. Inline edge editor renders as HTML overlay (not SVG foreignObject) with +/- steppers
    const projected = projectTopologyForDepth(
      null,
      containers,
      locations,
      edges,
      "loc_foyer"
    );
    const coords: Record<string, { x: number; y: number }> = {
      ...computeFullMapCoords(locations, edges, "loc_foyer"),
      cont_district: { x: 120, y: -40 },
      cont_club: { x: 0, y: 0 },
    };
    const canvasEditHtml = renderToStaticMarkup(
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
        mode="editor"
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
        projectedTopology={projected}
        fullMapCoords={coords}
        selectedContainer={null}
        selectedLocation={null}
        activeLoc={locations[0]}
        activeNeighborIds={new Set()}
        unreachableSet={new Set()}
        occupiedSlotsByLocId={new Map()}
        isMutatingLocked={false}
        inlineEdgeEdit={{ edgeId: "e_club_street", midX: 10, midY: 20, value: "2" }}
        setInlineEdgeEdit={() => {}}
        statusNotice={null}
        setStatusNotice={() => {}}
        setSelectedLocId={() => {}}
        setSelectedContainerId={() => {}}
        setContextMenu={() => {}}
        setMultiEdgeModalEdges={() => {}}
        openContextMenuAt={() => {}}
        handleUpdateEdgeDistance={() => {}}
        handleDeleteEdge={() => {}}
        handleDeleteEdgeGroup={() => {}}
        drillIntoContainer={() => {}}
      />
    );
    expect(canvasEditHtml).not.toContain("<foreignObject");
    expect(canvasEditHtml).toContain('data-layer="inline-edge-editor"');
    expect(canvasEditHtml).toContain('aria-label="Decrease travel minutes"');
    expect(canvasEditHtml).toContain('aria-label="Increase travel minutes"');
    expect(canvasEditHtml).toContain('aria-label="Travel minutes"');
    expect(canvasEditHtml).toContain('stroke-width="14"');
    expect(canvasEditHtml).not.toContain("· 1");

    // 3. Atomic edge & aggregated bundle deletion removes reverse pairs in one pass
    const afterSingleDelete = filterEdgesAfterDeletion(edges, ["e1"]);
    expect(afterSingleDelete.some((e) => e.id === "e1")).toBe(false);
    expect(afterSingleDelete.some((e) => e.id === "e2")).toBe(false);
    expect(afterSingleDelete.length).toBe(edges.length - 2);

    const extraEdge: LocationEdge = {
      id: "e_extra",
      world_id: "world_1",
      from_location_id: "loc_foyer",
      to_location_id: "loc_street",
      direction_label: "Fire escape",
      compass_direction: "S",
      travel_minutes: 3,
      is_locked_or_hidden: false,
    };
    const extraRev: LocationEdge = {
      id: "e_extra_rev",
      world_id: "world_1",
      from_location_id: "loc_street",
      to_location_id: "loc_foyer",
      direction_label: "Up stairs",
      compass_direction: "N",
      travel_minutes: 3,
      is_locked_or_hidden: false,
    };
    const afterBundleDelete = filterEdgesAfterDeletion(
      [...edges, extraEdge, extraRev],
      ["e1", "e_extra"]
    );
    expect(
      afterBundleDelete.some((e) =>
        ["e1", "e2", "e_extra", "e_extra_rev"].includes(e.id)
      )
    ).toBe(false);
    expect(afterBundleDelete.length).toBe(edges.length - 2);

    // 4. Delete keyboard target guard blocks inputs/textareas/contenteditable, allows canvas targets
    expect(isEditableKeyboardTarget({ tagName: "INPUT" })).toBe(true);
    expect(isEditableKeyboardTarget({ tagName: "textarea" })).toBe(true);
    expect(isEditableKeyboardTarget({ tagName: "SELECT" })).toBe(true);
    expect(isEditableKeyboardTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(
      isEditableKeyboardTarget({
        tagName: "SPAN",
        closest: (sel: string) => (sel.includes(".tag-chips-container") ? {} : null),
      })
    ).toBe(true);
    expect(isEditableKeyboardTarget({ tagName: "svg" })).toBe(false);
    expect(isEditableKeyboardTarget(null)).toBe(false);

    // 5. Magic Wand renders on Level 1 container (depth=1), but NOT on Level 2+ container
    const depthLabels = {
      1: "Building / Landmark",
      2: "District / Zone",
      3: "City / Settlement",
      4: "Region / Planet / Realm",
    };
    const l1ContHtml = renderToStaticMarkup(
      <MapDetailsDrawer
        mode="editor"
        isMutatingLocked={false}
        selectedContainer={containers[1]}
        selectedLocation={null}
        containers={containers}
        allLocations={locations}
        activeLocId="loc_foyer"
        dynamicPortalIds={new Set(["loc_foyer"])}
        externalPortals={[]}
        containerStats={null}
        depthLabels={depthLabels}
        onClose={() => {}}
        onPatchLocation={() => {}}
        onPatchContainer={() => {}}
        onResetCoordinates={() => {}}
        onDrillIntoContainer={() => {}}
      />
    );
    expect(l1ContHtml).toContain("Enrich Description");
    expect(l1ContHtml).toContain("Suggest Tags");

    const l2ContHtml = renderToStaticMarkup(
      <MapDetailsDrawer
        mode="editor"
        isMutatingLocked={false}
        selectedContainer={containers[0]}
        selectedLocation={null}
        containers={containers}
        allLocations={locations}
        activeLocId="loc_foyer"
        dynamicPortalIds={new Set(["loc_foyer"])}
        externalPortals={[]}
        containerStats={null}
        depthLabels={depthLabels}
        onClose={() => {}}
        onPatchLocation={() => {}}
        onPatchContainer={() => {}}
        onResetCoordinates={() => {}}
        onDrillIntoContainer={() => {}}
      />
    );
    expect(l2ContHtml).not.toContain("Enrich Description");
    expect(l2ContHtml).not.toContain("Suggest Tags");
  });
});
