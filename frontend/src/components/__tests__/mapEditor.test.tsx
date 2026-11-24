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
import {
  ENVELOPE_HUB_RADIUS,
  MINI_MAP_CENTER,
  MINI_MAP_RX,
  MINI_MAP_RY,
  computeBoundaryMarkerTicks,
  doesEdgeCrossContainer,
  isSameContainerLocation,
  resolveExternalContainerLabel,
} from "../inspector/miniMapGeometry";
import { MagicWandButton } from "../MagicWandButton";
import {
  SpatialTopologyView,
  computeFullMapCoords,
  projectTopologyForDepth,
} from "../SpatialTopologyView";
import { MapDetailsDrawer } from "../map/MapDetailsDrawer";
import { PortalPromotionModal } from "../map/PortalPromotionModal";
import { SpatialTopologyCanvas } from "../map/SpatialTopologyCanvas";
import { TargetEdgeSelector } from "../map/TargetEdgeSelector";
import {
  EmptyCanvasCreateModal,
  GroupIntoContainerModal,
  MapContextMenu,
  MapIconBrowserModal,
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
  getContainerPortPoint,
  isEditableKeyboardTarget,
  resolveCanvasCursor,
} from "../map/mapGeometry";
import {
  COMPASS_ANGLES,
  COMPASS_ORDER,
  buildContainerBreadcrumb,
  deriveWalkingMinutes,
  filterEdgesAfterDeletion,
  formatBundleWalkingDuration,
  formatDistanceCompact,
  formatWalkingDuration,
  getAdaptiveDistanceStep,
  getLocationOccupiedPorts,
  parseCommittedEdgeDistance,
  resolveAutoTargetSlot,
  resolveBidirectionalProjectedBundle,
  resolveBundleLinkPairs,
  resolveEdgePairForDialog,
  resolveLinkPairForInspector,
  sanitizeEdgeDistanceInput,
  stepEdgeDistanceDraft,
  syncEdgeLabelsForLocationRename,
  worldPointToWrapperPoint,
} from "../map/topologyProjection";
import {
  buildBidirectionalEdgePair,
  resolveNodeConnectionEndpoint,
} from "../map/useTopologyMutations";
import {
  commitCanvasDropCoordinates,
  hitTestTopologyPortAt,
} from "../map/useTopologyPointerDrag";
import {
  MAP_ICON_CATEGORIES,
  MAP_ICON_OPTIONS,
  filterMapIcons,
  getDefaultMapIconKey,
  getSuggestedMapIcons,
  inferMapIconKey,
  resolveMapIconComponent,
} from "../map/mapIcons";
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
      distance_meters: 140,
      speed_modifier: 1,
      travel_mode: null,
      obstacles: [],
      is_blocked: false,
      is_secret: false,
    },
    {
      id: "e2",
      world_id: "world_1",
      from_location_id: "loc_hub",
      to_location_id: "loc_foyer",
      direction_label: "Into Afterlife",
      compass_direction: "W",
      distance_meters: 140,
      speed_modifier: 1,
      travel_mode: null,
      obstacles: [],
      is_blocked: false,
      is_secret: false,
    },
    {
      id: "e3",
      world_id: "world_1",
      from_location_id: "loc_hub",
      to_location_id: "loc_street",
      direction_label: "Down to Harbor",
      compass_direction: "S",
      distance_meters: 280,
      speed_modifier: 1,
      travel_mode: null,
      obstacles: [],
      is_blocked: false,
      is_secret: false,
    },
    {
      id: "e4",
      world_id: "world_1",
      from_location_id: "loc_street",
      to_location_id: "loc_hub",
      direction_label: "Back to Canal",
      compass_direction: "N",
      distance_meters: 280,
      speed_modifier: 1,
      travel_mode: null,
      obstacles: [],
      is_blocked: false,
      is_secret: false,
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
          distanceMeters: 100,
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
          distance_meters: 140,
          speed_modifier: 1,
          travel_mode: null,
          obstacles: [],
          is_blocked: false,
          is_secret: false,
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
    expect(inspectorHtml).toContain('viewBox="0 0 330 236"');
    expect(inspectorHtml).toContain('maskUnits="userSpaceOnUse"');

    // Pure mini-map geometry helpers across all 5 container combinations & 8 compass slots
    expect(isSameContainerLocation("c1", "c1")).toBe(true);
    expect(isSameContainerLocation("c1", "c2")).toBe(false);
    expect(isSameContainerLocation(null, null)).toBe(false);
    expect(doesEdgeCrossContainer(null, null)).toBe(false);
    expect(doesEdgeCrossContainer("c1", "c1")).toBe(false);
    expect(doesEdgeCrossContainer("c1", "c2")).toBe(true);
    expect(doesEdgeCrossContainer(null, "c1")).toBe(true);
    expect(doesEdgeCrossContainer("c1", null)).toBe(true);

    const contMap = new Map(containers.map((c) => [c.id, c]));
    // Hierarchical containment: L3 -> L2 -> L1 descendants are inside, while sibling L1s & parents are outside
    const l3Cont: LocationContainer = {
      id: "cont_city",
      world_id: "world_1",
      parent_container_id: null,
      depth: 3,
      name: "Night City",
      description: "Metropolis.",
      environmental_tags: [],
      lore_nodes: [],
    };
    const hierContainers: LocationContainer[] = [
      l3Cont,
      ...containers.map((c) =>
        c.id === "cont_district" ? { ...c, parent_container_id: "cont_city" } : c
      ),
    ];
    const hierMap = new Map(hierContainers.map((c) => [c.id, c]));
    // L3 ancestor contains L2 district and nested L1 club/clinic
    expect(isSameContainerLocation("cont_club", "cont_city", hierMap)).toBe(true);
    expect(isSameContainerLocation("cont_district", "cont_city", hierMap)).toBe(true);
    expect(doesEdgeCrossContainer("cont_club", "cont_city", hierMap)).toBe(false);
    expect(doesEdgeCrossContainer("cont_district", "cont_city", hierMap)).toBe(false);
    expect(doesEdgeCrossContainer(null, "cont_city", hierMap)).toBe(true);
    // L1 does NOT contain sibling L1 (even under same L2/L3) or parent L2/L3
    expect(isSameContainerLocation("cont_clinic", "cont_club", hierMap)).toBe(false);
    expect(isSameContainerLocation("cont_district", "cont_club", hierMap)).toBe(false);
    expect(isSameContainerLocation("cont_city", "cont_club", hierMap)).toBe(false);
    expect(doesEdgeCrossContainer("cont_clinic", "cont_club", hierMap)).toBe(true);
    expect(doesEdgeCrossContainer("cont_district", "cont_club", hierMap)).toBe(true);
    // Cycle-safe parent walk
    const cyclicMap = new Map<string, LocationContainer>([
      ["ca", { ...l3Cont, id: "ca", parent_container_id: "cb" }],
      ["cb", { ...l3Cont, id: "cb", parent_container_id: "ca" }],
    ]);
    expect(isSameContainerLocation("ca", "cc", cyclicMap)).toBe(false);

    expect(resolveExternalContainerLabel({ container_id: "cont_club" }, "cont_club", contMap)).toBeNull();
    expect(resolveExternalContainerLabel({ container_id: null }, "cont_club", contMap)).toBe("[Outside]");
    expect(resolveExternalContainerLabel({ container_id: "cont_district" }, "cont_club", contMap)).toBe("[Watson Distr…]");
    expect(resolveExternalContainerLabel({ container_id: "cont_club" }, null, contMap)).toBe("[Afterlife Cl…]");
    expect(resolveExternalContainerLabel({ container_id: "missing_c" }, "cont_club", contMap)).toBeNull();

    for (const slot of ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const) {
      const ang = COMPASS_ANGLES[slot];
      const p2 = {
        x: Math.round(MINI_MAP_CENTER.x + Math.cos(ang) * MINI_MAP_RX),
        y: Math.round(MINI_MAP_CENTER.y + Math.sin(ang) * MINI_MAP_RY),
      };
      const ticks = computeBoundaryMarkerTicks(MINI_MAP_CENTER, p2, slot);
      expect(ticks).not.toBeNull();
      const rdx = p2.x - MINI_MAP_CENTER.x;
      const rdy = p2.y - MINI_MAP_CENTER.y;
      const bdx = ticks!.bar1.x2 - ticks!.bar1.x1;
      const bdy = ticks!.bar1.y2 - ticks!.bar1.y1;
      const rLen = Math.hypot(rdx, rdy);
      const bLen = Math.hypot(bdx, bdy);
      // Orthogonal bar relative to ray & clear of hub + destination node
      expect(Math.abs((rdx * bdx + rdy * bdy) / (rLen * bLen))).toBeLessThan(0.05);
      const gateDist = Math.hypot(
        (ticks!.gap.x1 + ticks!.gap.x2) / 2 - MINI_MAP_CENTER.x,
        (ticks!.gap.y1 + ticks!.gap.y2) / 2 - MINI_MAP_CENTER.y
      );
      expect(gateDist).toBeGreaterThan(ENVELOPE_HUB_RADIUS);
      expect(gateDist).toBeLessThan(rLen - 18);
    }

    // Mixed/alternating neighbors: inside non-hub, inside hub, other container, and uncontained [Outside]
    const mixedLocations: LocationNode[] = [
      ...locations,
      {
        id: "loc_backroom",
        world_id: "world_1",
        container_id: "cont_club",
        is_entry_exit: false,
        name: "VIP Backroom",
        summary: "Private lounge",
        description: "Velvet booths.",
        environmental_tags: [],
        is_starting_location: false,
        ui_x: 100,
        ui_y: 80,
      },
      {
        id: "loc_club_hub",
        world_id: "world_1",
        container_id: "cont_club",
        is_entry_exit: false,
        is_hub: true,
        name: "Dance Floor",
        summary: "Central hub",
        description: "Pulsing neon.",
        environmental_tags: [],
        is_starting_location: false,
        ui_x: 120,
        ui_y: 120,
      },
      {
        id: "loc_alley",
        world_id: "world_1",
        container_id: null,
        is_entry_exit: false,
        name: "Back Alley",
        summary: "Rainy alley",
        description: "Uncontained street.",
        environmental_tags: [],
        is_starting_location: false,
        ui_x: 40,
        ui_y: 180,
      },
    ];
    const mixedBundle: CampaignStateBundle = {
      ...bundle,
      visible_locations: mixedLocations,
      neighbor_locations: [
        {
          edge_id: "e_n",
          direction_label: "VIP stairs",
          compass_direction: "N",
          distance_meters: 20,
          speed_modifier: 1,
          travel_mode: null,
          obstacles: [],
          is_blocked: false,
          is_secret: false,
          destination: mixedLocations[3],
        },
        {
          edge_id: "e_ne",
          direction_label: "Out onto Canal",
          compass_direction: "NE",
          distance_meters: 140,
          speed_modifier: 1,
          travel_mode: null,
          obstacles: [],
          is_blocked: false,
          is_secret: false,
          destination: mixedLocations[1],
        },
        {
          edge_id: "e_e",
          direction_label: "Main floor",
          compass_direction: "E",
          distance_meters: 20,
          speed_modifier: 1,
          travel_mode: null,
          obstacles: [],
          is_blocked: false,
          is_secret: false,
          destination: mixedLocations[4],
        },
        {
          edge_id: "e_s",
          direction_label: "Fire exit",
          compass_direction: "S",
          distance_meters: 100,
          speed_modifier: 1,
          travel_mode: null,
          obstacles: [],
          is_blocked: true,
          is_secret: false,
          destination: mixedLocations[5],
        },
      ],
    };
    const mixedHtml = renderToStaticMarkup(
      <LiveInspector bundle={mixedBundle} world={world} character={char} />
    );
    expect(mixedHtml).toContain('stroke="#d97706"');
    expect(mixedHtml).toContain('stroke="#0891b2"');
    expect(mixedHtml).toContain('stroke="#a855f7"');
    expect(mixedHtml).toContain("[Outside]");
    expect(mixedHtml).toContain('stroke="#fbbf24" stroke-width="1.75"');
    expect(mixedHtml).toContain('stroke-width="28" stroke-linecap="round"');

    // Uncontained active location entering a contained neighbor: no <mask> envelope, cyan threshold gate
    const uncontainedBundle: CampaignStateBundle = {
      ...mixedBundle,
      active_location: mixedLocations[5],
      current_world_snapshot: {
        ...worldSnapshot,
        active_location_id: mixedLocations[5].id,
      },
      neighbor_locations: [
        {
          edge_id: "e_enter",
          direction_label: "Through side door",
          compass_direction: "N",
          distance_meters: 70,
          speed_modifier: 1,
          travel_mode: null,
          obstacles: [],
          is_blocked: false,
          is_secret: false,
          destination: mixedLocations[0],
        },
      ],
    };
    const uncontainedHtml = renderToStaticMarkup(
      <LiveInspector bundle={uncontainedBundle} world={world} character={char} />
    );
    expect(uncontainedHtml).not.toContain("<mask");
    expect(uncontainedHtml).toContain('stroke="#22d3ee" stroke-width="1.75"');
    expect(uncontainedHtml).toContain("[Afterlife Cl…]");

    // Dangling missing container ID: gracefully omits envelope & pill
    const missingContBundle: CampaignStateBundle = {
      ...bundle,
      containers: [],
    };
    const missingContHtml = renderToStaticMarkup(
      <LiveInspector
        bundle={missingContBundle}
        world={{ ...world, containers: [] }}
        character={char}
      />
    );
    expect(missingContHtml).not.toContain("<mask");

    // Scenario A: L3 active location envelops nested L1 and L2 descendants, while keeping uncontained outside
    const cityGateLoc: LocationNode = {
      id: "loc_city_gate",
      world_id: "world_1",
      container_id: "cont_city",
      is_entry_exit: true,
      name: "City Plaza",
      summary: "Main city gate.",
      description: "Central thoroughfare.",
      environmental_tags: [],
      is_starting_location: false,
      ui_x: 0,
      ui_y: 0,
    };
    const l3Bundle: CampaignStateBundle = {
      ...mixedBundle,
      containers: hierContainers,
      active_location: cityGateLoc,
      current_world_snapshot: {
        ...worldSnapshot,
        active_location_id: cityGateLoc.id,
      },
      visible_locations: [...mixedLocations, cityGateLoc],
      neighbor_locations: [
        {
          edge_id: "e_to_l1",
          direction_label: "Into Afterlife",
          compass_direction: "N",
          distance_meters: 210,
          speed_modifier: 1,
          travel_mode: null,
          obstacles: [],
          is_blocked: false,
          is_secret: false,
          destination: mixedLocations[0], // cont_club (L1 -> L2 -> L3)
        },
        {
          edge_id: "e_to_l2",
          direction_label: "Along canal",
          compass_direction: "E",
          distance_meters: 280,
          speed_modifier: 1,
          travel_mode: null,
          obstacles: [],
          is_blocked: false,
          is_secret: false,
          destination: mixedLocations[1], // cont_district (L2 -> L3)
        },
        {
          edge_id: "e_to_out",
          direction_label: "Past city wall",
          compass_direction: "S",
          distance_meters: 420,
          speed_modifier: 1,
          travel_mode: null,
          obstacles: [],
          is_blocked: false,
          is_secret: false,
          destination: mixedLocations[5], // uncontained (null)
        },
      ],
    };
    const l3Html = renderToStaticMarkup(
      <LiveInspector
        bundle={l3Bundle}
        world={{ ...world, containers: hierContainers }}
        character={char}
      />
    );
    expect(l3Html).toContain("L3 · Night City");
    // Both L1 and L2 descendants get envelope spokes (2 spokes * 3 mask passes = 6 spoke lines)
    expect(l3Html.match(/stroke-linecap="round"/g)?.length).toBeGreaterThanOrEqual(6);
    // Descendant sub-container labels appear in warm amber (#fde68a) inside the L3 envelope
    expect(l3Html).toContain('fill="#fde68a" font-size="7"');
    // Uncontained exit still triggers threshold gate & cyan [Outside]
    expect(l3Html).toContain('stroke="#fbbf24" stroke-width="1.75"');
    expect(l3Html).toContain("[Outside]");

    // Scenario B: L1 active location envelops same L1 only, excluding sibling L1 under same L2/L3 and parent L2
    const clinicLoc: LocationNode = {
      id: "loc_clinic",
      world_id: "world_1",
      container_id: "cont_clinic",
      is_entry_exit: true,
      name: "Ripper Clinic",
      summary: "Backstreet clinic.",
      description: "Chrome & scalpels.",
      environmental_tags: [],
      is_starting_location: false,
      ui_x: 180,
      ui_y: 120,
    };
    const l1Bundle: CampaignStateBundle = {
      ...mixedBundle,
      containers: hierContainers,
      active_location: mixedLocations[0], // cont_club (L1)
      visible_locations: [...mixedLocations, clinicLoc],
      neighbor_locations: [
        {
          edge_id: "e_same_l1",
          direction_label: "VIP stairs",
          compass_direction: "N",
          distance_meters: 20,
          speed_modifier: 1,
          travel_mode: null,
          obstacles: [],
          is_blocked: false,
          is_secret: false,
          destination: mixedLocations[3], // cont_club (same L1)
        },
        {
          edge_id: "e_sib_l1",
          direction_label: "Cross-alley",
          compass_direction: "E",
          distance_meters: 100,
          speed_modifier: 1,
          travel_mode: null,
          obstacles: [],
          is_blocked: false,
          is_secret: false,
          destination: clinicLoc, // cont_clinic (different L1 under same L2/L3)
        },
        {
          edge_id: "e_par_l2",
          direction_label: "Street exit",
          compass_direction: "S",
          distance_meters: 100,
          speed_modifier: 1,
          travel_mode: null,
          obstacles: [],
          is_blocked: false,
          is_secret: false,
          destination: mixedLocations[1], // cont_district (parent L2)
        },
      ],
    };
    const l1Html = renderToStaticMarkup(
      <LiveInspector
        bundle={l1Bundle}
        world={{ ...world, containers: hierContainers }}
        character={char}
      />
    );
    // Only 1 spoke inside fillMask (1 same-L1 neighbor); sibling L1 and parent L2 stay cyan (#0891b2)
    const fillMaskMatch = l1Html.match(/<mask id="minimap-env-fill-[^"]+"[\s\S]*?<\/mask>/);
    expect(fillMaskMatch).not.toBeNull();
    expect(fillMaskMatch![0].match(/stroke-width="28"/g)?.length).toBe(1);
    expect(l1Html).toContain('stroke="#d97706"');
    expect(l1Html).toContain('stroke="#0891b2"');
    expect(l1Html).toContain("[Watson Distr…]");
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
        initialContainerFocus="root"
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
    expect(html).toContain('r="38"');

    // Consolidated bottom-right canvas zoom indicator & floating Center icon button
    expect(html).toContain('data-testid="canvas-zoom-indicator"');
    expect(html).toContain('aria-label="Center on Selected / Active Location"');
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

    // 1. Pure inline edge metric formatting, adaptive stepping & commit parsing
    expect(formatDistanceCompact(20)).toBe("20m");
    expect(formatDistanceCompact(999)).toBe("999m");
    expect(formatDistanceCompact(1000)).toBe("1km");
    expect(formatDistanceCompact(1400)).toBe("1.4km");
    expect(formatDistanceCompact(12500)).toBe("12.5km");
    expect(formatDistanceCompact(125400)).toBe("125km");
    expect(deriveWalkingMinutes(20)).toBe(1);
    expect(deriveWalkingMinutes(350)).toBe(5);
    expect(formatWalkingDuration(20)).toBe("< 1 min");
    expect(formatWalkingDuration(350)).toBe("~5 min");
    expect(formatWalkingDuration(4200)).toBe("~1h");
    expect(formatWalkingDuration(5250)).toBe("~1h 15min");
    expect(formatBundleWalkingDuration(210, 560)).toBe("~3-8 min");
    expect(formatBundleWalkingDuration(20, 30)).toBe("< 1 min");
    expect(formatBundleWalkingDuration(20, 350)).toBe("< 1-5 min");
    expect(getAdaptiveDistanceStep(50)).toBe(5);
    expect(getAdaptiveDistanceStep(50, true)).toBe(1);
    expect(getAdaptiveDistanceStep(350)).toBe(25);
    expect(getAdaptiveDistanceStep(1500)).toBe(100);
    expect(getAdaptiveDistanceStep(15000)).toBe(500);

    expect(stepEdgeDistanceDraft("25", 1)).toBe("30");
    expect(stepEdgeDistanceDraft("1", -1)).toBe("1");
    expect(stepEdgeDistanceDraft("100", -1)).toBe("95");
    expect(stepEdgeDistanceDraft("1000", 1)).toBe("1100");
    expect(stepEdgeDistanceDraft("1000", -1)).toBe("975");
    expect(stepEdgeDistanceDraft("350", 1, 50, true)).toBe("351");
    expect(stepEdgeDistanceDraft("", 1, 50)).toBe("55");
    expect(parseCommittedEdgeDistance("")).toBeNull();
    expect(parseCommittedEdgeDistance("0")).toBe(1);
    expect(parseCommittedEdgeDistance("1.5km")).toBe(1500);
    expect(parseCommittedEdgeDistance("2 km")).toBe(2000);
    expect(parseCommittedEdgeDistance("25000")).toBe(25000);
    expect(parseCommittedEdgeDistance("350m")).toBe(350);

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
        openContextMenuAt={() => {}}
        handleUpdateEdgeDistance={() => {}}
        handleDeleteEdge={() => {}}
        handleDeleteEdgeGroup={() => {}}
        drillIntoContainer={() => {}}
      />
    );
    expect(canvasEditHtml).not.toContain("<foreignObject");
    expect(canvasEditHtml).toContain('data-layer="inline-edge-editor"');
    expect(canvasEditHtml).toContain('aria-label="Decrease distance"');
    expect(canvasEditHtml).toContain('aria-label="Increase distance"');
    expect(canvasEditHtml).toContain('aria-label="Distance in meters"');
    expect(canvasEditHtml).toContain('stroke-width="14"');
    expect(canvasEditHtml).not.toContain("m · 1");

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
      distance_meters: 210,
      speed_modifier: 1,
      travel_mode: null,
      obstacles: [],
      is_blocked: false,
      is_secret: false,
    };
    const extraRev: LocationEdge = {
      id: "e_extra_rev",
      world_id: "world_1",
      from_location_id: "loc_street",
      to_location_id: "loc_foyer",
      direction_label: "Up stairs",
      compass_direction: "N",
      distance_meters: 210,
      speed_modifier: 1,
      travel_mode: null,
      obstacles: [],
      is_blocked: false,
      is_secret: false,
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

  it("keeps live multi-digit travel distances synchronized in inline editor and MapDetailsDrawer Link Inspector", () => {
    const { containers, locations, edges } = makeRichWorldFixture();

    // 1. Distance input sanitization permits empty intermediate state, decimal km, and unit chars
    expect(sanitizeEdgeDistanceInput("")).toBe("");
    expect(sanitizeEdgeDistanceInput("25")).toBe("25");
    expect(sanitizeEdgeDistanceInput("1.5km")).toBe("1.5km");
    expect(sanitizeEdgeDistanceInput("2a5m")).toBe("25m");

    // 2. resolveLinkPairForInspector keeps live Link Pair synchronized with workingEdges mutations
    const updatedWorkingEdges = edges.map((e) =>
      e.id === edges[2].id
        ? { ...e, distance_meters: 1500, is_blocked: true }
        : e
    );
    const livePair = resolveLinkPairForInspector(
      edges[2].id,
      updatedWorkingEdges
    );
    expect(livePair).not.toBeNull();
    expect(livePair?.primary.distance_meters).toBe(1500);
    expect(livePair?.primary.is_blocked).toBe(true);
    expect(livePair?.reciprocal?.id).toBe(edges[3].id);
    expect(resolveLinkPairForInspector("missing_edge", updatedWorkingEdges)).toBeNull();

    // 3. MapDetailsDrawer Link Pair view renders distance input initialized to live distance_meters + compact km/duration summary
    const drawerLinkHtml = renderToStaticMarkup(
      <MapDetailsDrawer
        mode="editor"
        isMutatingLocked={false}
        selectedLocation={null}
        selectedContainer={null}
        selectedEdgePair={livePair}
        allEdges={updatedWorkingEdges}
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
        onPatchEdgePair={() => {}}
        onDeleteEdge={() => {}}
      />
    );
    expect(drawerLinkHtml).toContain("Link Pair");
    expect(drawerLinkHtml).toContain('inputMode="decimal"');
    expect(drawerLinkHtml).toContain('value="1500"');
    expect(drawerLinkHtml).toContain("1.5km · ~21 min");

    // 4. Editing either direction of an edge pair hides its SVG badge and shows typed value
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
    // Reverse edge e4 shares the same pairKey as e3 (whose label is shown on the canvas)
    const editedHtml = renderToStaticMarkup(
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
        inlineEdgeEdit={{ edgeId: "e4", midX: 10, midY: 20, value: "25" }}
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
    expect(editedHtml).toContain('value="25"');
  });

  it("exposes curated 6-category icon catalog, search/suggestions, smart inference, and MapIconBrowserModal (v0.11.3)", () => {
    const legacyKeys = [
      "map-pin",
      "building-2",
      "home",
      "store",
      "beer",
      "warehouse",
      "landmark",
      "castle",
      "church",
      "bed-double",
      "git-branch",
      "door-open",
      "footprints",
      "compass",
      "train-front",
      "anchor",
      "rocket",
      "map",
      "globe-2",
      "trees",
      "mountain",
      "waves",
      "tent",
      "flame",
      "shield",
      "key",
      "wrench",
      "cpu",
      "radio",
      "skull",
      "layers",
    ];
    const allKeys = MAP_ICON_OPTIONS.map((o) => o.key);
    expect(new Set(allKeys).size).toBe(MAP_ICON_OPTIONS.length);
    expect(MAP_ICON_OPTIONS.length).toBeGreaterThanOrEqual(120);
    for (const legacyKey of legacyKeys) {
      expect(allKeys).toContain(legacyKey);
    }
    for (const cat of MAP_ICON_CATEGORIES) {
      expect(MAP_ICON_OPTIONS.some((o) => o.category === cat.id)).toBe(true);
    }

    // Keyword search & category scoping
    const tavernMatches = filterMapIcons("tavern", "all");
    expect(tavernMatches.some((o) => o.key === "beer")).toBe(true);
    const scifiServer = filterMapIcons("mainframe", "scifi");
    expect(scifiServer.some((o) => o.key === "cpu")).toBe(true);
    expect(filterMapIcons("mainframe", "wilderness")).toEqual([]);
    expect(filterMapIcons("zzznomatch999", "all")).toEqual([]);

    // Genre & keyword ranking
    const cyberSuggestions = getSuggestedMapIcons({
      kind: "location",
      genre: "Cyberpunk Noir",
      name: "Netrunner Clinic",
      tags: ["neon", "terminal"],
      limit: 6,
    });
    expect(
      cyberSuggestions.some((o) => o.key === "terminal" || o.key === "hospital")
    ).toBe(true);

    // Smart inference on domain names vs generic placeholders
    expect(
      inferMapIconKey({ kind: "location", name: "Neon Cantina", tags: ["bar"] })
    ).toBe("beer");
    expect(
      inferMapIconKey({ kind: "container", depth: 1, name: "Old Harbor", tags: [] })
    ).toBe("anchor");
    expect(
      inferMapIconKey({ kind: "container", depth: 1, name: "Orbital Spaceport" })
    ).toBe("rocket");
    expect(
      inferMapIconKey({ kind: "location", name: "Black Clinic", tags: ["ripperdoc"] })
    ).toBe("heart-pulse");
    expect(
      inferMapIconKey({ kind: "location", name: "Royal Archive Library" })
    ).toBe("library");
    expect(inferMapIconKey({ kind: "location", name: "New Location 4" })).toBe(
      "map-pin"
    );
    expect(inferMapIconKey({ kind: "hub", name: "Junction 2" })).toBe(
      "git-branch"
    );

    // Modal target guard blocks Delete key inside aria-modal dialogs
    expect(
      isEditableKeyboardTarget({
        tagName: "BUTTON",
        closest: (sel: string) => (sel.includes("[aria-modal='true']") ? {} : null),
      })
    ).toBe(true);

    // Drawer trigger + Browse All modal SSR checks
    const { containers, locations } = makeRichWorldFixture();
    const drawerWithBrowserHtml = renderToStaticMarkup(
      <MapDetailsDrawer
        mode="editor"
        isMutatingLocked={false}
        selectedLocation={locations[0]}
        selectedContainer={null}
        containers={containers}
        allLocations={locations}
        activeLocId={locations[0].id}
        dynamicPortalIds={new Set()}
        externalPortals={[]}
        containerStats={null}
        depthLabels={{
          1: "Building / Landmark",
          2: "District / Zone",
          3: "City / Settlement",
          4: "Region / Planet / Realm",
        }}
        usedIconKeys={["beer", "anchor"]}
        onOpenIconBrowser={() => {}}
        onClose={() => {}}
        onPatchLocation={() => {}}
        onPatchContainer={() => {}}
        onResetCoordinates={() => {}}
        onDrillIntoContainer={() => {}}
      />
    );
    expect(drawerWithBrowserHtml).toContain("Browse All");

    const browserModalHtml = renderToStaticMarkup(
      <MapIconBrowserModal
        isOpen={true}
        title="Foyer"
        currentIconKey="beer"
        kind="location"
        genre="Cyberpunk"
        elementName="Neon Cantina"
        elementTags={["bar"]}
        usedIconKeys={["beer", "anchor"]}
        onSelect={() => {}}
        onClose={() => {}}
      />
    );
    expect(browserModalHtml).toContain('aria-label="Browse Map Icons"');
    expect(browserModalHtml).toContain("Used in World");
    expect(browserModalHtml).toContain("Suggested");
    expect(browserModalHtml).toContain("Sci-Fi &amp; Tech");
    expect(browserModalHtml).toContain("Cantina / Tavern");
  });

  it("supports nearest-free target port resolution, container perimeter hit-testing, bidirectional target slots, and 1.73.0 worldbuilding icons", () => {
    const { containers, locations, edges } = makeRichWorldFixture();
    const locMap = new Map(locations.map((l) => [l.id, l]));
    const contMap = new Map(containers.map((c) => [c.id, c]));

    // 1. Upgraded 1.73.0 icon catalog includes Houses + 11 additional worldbuilding icons (137 total)
    expect(MAP_ICON_OPTIONS.length).toBe(137);
    const newKeys = [
      "houses",
      "barrel",
      "bridge",
      "lighthouse",
      "cable-car",
      "tower-control",
      "tent-tree",
      "dam",
      "drone",
      "tombstone",
      "binoculars",
      "bow-arrow",
    ];
    for (const k of newKeys) {
      expect(MAP_ICON_OPTIONS.some((o) => o.key === k)).toBe(true);
      expect(resolveMapIconComponent(k, "location")).toBeDefined();
    }
    const housesOpt = MAP_ICON_OPTIONS.find((o) => o.key === "houses");
    expect(housesOpt?.category).toBe("settlement");
    expect(inferMapIconKey({ kind: "container", depth: 1, name: "Oakbrook Village" })).toBe(
      "houses"
    );
    expect(inferMapIconKey({ kind: "location", name: "Mossy Hamlet" })).toBe("houses");
    expect(inferMapIconKey({ kind: "location", name: "Stone Bridge" })).toBe("bridge");
    expect(inferMapIconKey({ kind: "location", name: "Old Graveyard" })).toBe(
      "tombstone"
    );

    // 2. Nearest-free Auto target slot resolution + explicit override & collision check
    const freeRes = resolveAutoTargetSlot("E", new Set());
    expect(freeRes).toEqual({ slot: "W", collides: false, isFallback: false });

    const fallbackRes = resolveAutoTargetSlot("E", new Set(["W"]));
    expect(fallbackRes.collides).toBe(false);
    expect(fallbackRes.isFallback).toBe(true);
    expect(["NW", "SW"]).toContain(fallbackRes.slot);

    const fullOccupied = new Set(COMPASS_ORDER);
    const fullAutoRes = resolveAutoTargetSlot("E", fullOccupied);
    expect(fullAutoRes).toEqual({ slot: "W", collides: true, isFallback: false });

    const explicitColliding = resolveAutoTargetSlot("E", new Set(["N"]), "N");
    expect(explicitColliding).toEqual({ slot: "N", collides: true, isFallback: false });

    // 3. Reverse edge honors explicit/resolved targetDirection instead of hardcoding OPPOSITE_COMPASS
    const builtPair = buildBidirectionalEdgePair({
      worldId: "world_1",
      fromLoc: locations[0],
      toLoc: locations[1],
      direction: "E",
      targetDirection: "N",
      distanceMeters: 490,
      bidirectional: true,
    });
    expect(builtPair).toHaveLength(2);
    expect(builtPair[0].compass_direction).toBe("E");
    expect(builtPair[0].distance_meters).toBe(490);
    expect(builtPair[1].compass_direction).toBe("N");
    expect(builtPair[1].distance_meters).toBe(490);

    // 4. Container breadcrumb & occupied port inspection
    expect(buildContainerBreadcrumb(locations[0].container_id, containers)).toBeTruthy();
    expect(buildContainerBreadcrumb(null, containers)).toBe("Top-Level");
    const streetOccupied = getLocationOccupiedPorts(locations[1].id, edges, locMap);
    expect(streetOccupied.size).toBeGreaterThanOrEqual(0);
    const endpoint = resolveNodeConnectionEndpoint({
      kind: "container",
      id: containers[0].id,
      locationMap: locMap,
      containerMap: contMap,
      workingContainers: containers,
      workingLocations: locations,
      dynamicPortalIds: new Set([locations[0].id]),
    });
    expect(endpoint.loc?.id).toBe(locations[0].id);

    // 5. Container perimeter port hit-testing detects diagonal & cardinal dots before body hit
    const contCenter = { x: 200, y: 120 };
    const projMock = {
      visibleSupernodes: [
        {
          container: containers[0],
          directLocationCount: 2,
          descendantLocationCount: 2,
          externalPortalsCount: 1,
          hasActivePlayer: false,
          containsStart: false,
          presentCharacterIds: [],
          representativePortalLocationId: locations[0].id,
        },
      ],
      visibleLocations: [],
    };
    const coords = { [containers[0].id]: contCenter };
    const nePort = getContainerPortPoint(contCenter, COMPASS_ANGLES.NE);
    const portHit = hitTestTopologyPortAt(
      nePort.x,
      nePort.y,
      projMock,
      coords,
      "location",
      "other_loc"
    );
    expect(portHit).toEqual({
      kind: "container",
      id: containers[0].id,
      slot: "NE",
    });

    const bodyHit = hitTestTopologyPortAt(
      contCenter.x,
      contCenter.y,
      projMock,
      coords,
      "location",
      "other_loc"
    );
    expect(bodyHit).toEqual({ kind: "container", id: containers[0].id });

    // 6. SSR assertions for TargetEdgeSelector, PortalPromotionModal & EmptyCanvasCreateModal "Existing" tab
    const edgeSelectorHtml = renderToStaticMarkup(
      <TargetEdgeSelector
        sourceSlot="E"
        targetName="Harbor Street"
        selectedSlot={undefined}
        occupiedPorts={new Map([["W", "Old Dock"]])}
        onChange={() => {}}
      />
    );
    expect(edgeSelectorHtml).toContain("Target Edge on");
    expect(edgeSelectorHtml).toContain("Auto (");
    expect(edgeSelectorHtml).toContain("nearest free compass port");

    const portalModalHtml = renderToStaticMarkup(
      <PortalPromotionModal
        promotionPrompt={{
          fromLocation: locations[1],
          toLocation: locations[0],
          targetContainerForLocationPick: containers[0],
          targetLocationCandidates: [locations[0]],
          chosenTargetLocationId: locations[0].id,
          direction: "E",
          explicitTargetSlot: undefined,
          distanceMeters: 280,
          bidirectional: true,
          candidates: [],
        }}
        containerMap={contMap}
        dynamicPortalIds={new Set([locations[0].id])}
        edges={edges}
        locationMap={locMap}
        onChangePrompt={() => {}}
        onConfirm={() => {}}
      />
    );
    expect(portalModalHtml).toContain("Connect to Container Target");
    expect(portalModalHtml).toContain("Confirm &amp; Connect");
    expect(portalModalHtml).toContain("Auto (");

    const emptyExistingTabHtml = renderToStaticMarkup(
      <EmptyCanvasCreateModal
        state={{
          sourceKind: "location",
          sourceId: locations[0].id,
          sourceName: locations[0].name,
          sourceSlot: "S",
          dropX: 40,
          dropY: 120,
          canCreateContainer: true,
          availableDepths: [1, 2],
        }}
        existingTargets={[
          {
            location: locations[1],
            breadcrumb: "Top-Level",
            alreadyLinked: false,
            occupiedPorts: new Map(),
            isPortal: false,
          },
        ]}
        onCancel={() => {}}
        onCreate={() => {}}
        onLinkExisting={() => {}}
      />
    );
    expect(emptyExistingTabHtml).toContain("Existing");
  });

  it("renders portal badges strictly for explicitly marked entry/exit locations while preserving ghost links", () => {
    const { containers, locations, edges } = makeRichWorldFixture();

    // loc_hub sits in Depth-2 cont_district with is_entry_exit: false, even though it links cross-boundary
    // into cont_club (loc_foyer, is_entry_exit: true) and root (loc_street, is_entry_exit: false).
    const distProj = projectTopologyForDepth(
      "cont_district",
      containers,
      locations,
      edges,
      "loc_foyer"
    );
    expect(Array.from(distProj.dynamicPortalIds)).toEqual(["loc_foyer"]);
    expect(distProj.dynamicPortalIds.has("loc_hub")).toBe(false);
    expect(distProj.dynamicPortalIds.has("loc_street")).toBe(false);
    // Ghost external links remain active from edges regardless of portal mark
    expect(distProj.ghostExternalNodes.map((g) => g.destination.id)).toContain(
      "loc_street"
    );

    const coords = computeFullMapCoords(
      distProj.visibleLocations,
      distProj.projectedEdges.map((pe) => pe.rawEdge),
      distProj.anchorNodeId
    );

    // District view canvas has only loc_hub visible (unmarked) -> zero cyan portal diamonds (#083344)
    const distViewHtml = renderToStaticMarkup(
      <SpatialTopologyView
        title="District Check"
        containers={containers}
        locations={locations}
        edges={edges}
        activeLocationId="loc_hub"
        mode="editor"
      />
    );
    expect(distViewHtml).toContain("Canal Junction");
    expect(distViewHtml).toContain("Harbor Pier");
    expect(distViewHtml).not.toContain('fill="#083344"');

    // Inside cont_club where loc_foyer IS marked is_entry_exit: true, cyan portal diamond renders
    const clubViewHtml = renderToStaticMarkup(
      <SpatialTopologyView
        title="Club Check"
        containers={containers}
        locations={locations}
        edges={edges}
        activeLocationId="loc_foyer"
        mode="editor"
      />
    );
    expect(clubViewHtml).toContain("Main Floor");
    expect(clubViewHtml).toContain('fill="#083344"');

    // Inspecting unmarked loc_hub in MapDetailsDrawer does NOT show [Entry/Exit Portal] badge
    const hubDrawerHtml = renderToStaticMarkup(
      <MapDetailsDrawer
        mode="editor"
        isMutatingLocked={false}
        selectedLocation={locations[1]} // loc_hub (is_entry_exit: false)
        selectedContainer={null}
        containers={containers}
        allLocations={locations}
        activeLocId={locations[0].id}
        dynamicPortalIds={distProj.dynamicPortalIds}
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
    expect(hubDrawerHtml).toContain("Canal Junction");
    expect(hubDrawerHtml).not.toContain("[Entry/Exit Portal]");

    // Inspecting marked loc_foyer in MapDetailsDrawer DOES show [Entry/Exit Portal] badge
    const foyerDrawerHtml = renderToStaticMarkup(
      <MapDetailsDrawer
        mode="editor"
        isMutatingLocked={false}
        selectedLocation={locations[0]} // loc_foyer (is_entry_exit: true)
        selectedContainer={null}
        containers={containers}
        allLocations={locations}
        activeLocId={locations[0].id}
        dynamicPortalIds={distProj.dynamicPortalIds}
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
    expect(foyerDrawerHtml).toContain("[Entry/Exit Portal]");
    expect(coords["loc_hub"]).toBeDefined();
  });

  it("auto-syncs template direction_label on rename, exposes editable edge labels, merges bidirectional aggregated badges, and keeps inline overlay coordinates live (v0.14.1)", () => {
    const { containers, locations, edges } = makeRichWorldFixture();

    // 1. syncEdgeLabelsForLocationRename updates all 5 template prefixes targeting locationId and handles regex chars
    const sampleEdges: LocationEdge[] = [
      {
        id: "t1",
        world_id: "w1",
        from_location_id: "a",
        to_location_id: "b",
        direction_label: "Passage to Passage (1-M)",
        compass_direction: "N",
        distance_meters: 140,
        speed_modifier: 1,
        travel_mode: null,
        obstacles: [],
        is_blocked: false,
        is_secret: false,
      },
      {
        id: "t2",
        world_id: "w1",
        from_location_id: "c",
        to_location_id: "b",
        direction_label: "Return to Passage (1-M)",
        compass_direction: "S",
        distance_meters: 140,
        speed_modifier: 1,
        travel_mode: null,
        obstacles: [],
        is_blocked: false,
        is_secret: false,
      },
      {
        id: "t3",
        world_id: "w1",
        from_location_id: "d",
        to_location_id: "b",
        direction_label: "To Passage (1-M)",
        compass_direction: "E",
        distance_meters: 140,
        speed_modifier: 1,
        travel_mode: null,
        obstacles: [],
        is_blocked: false,
        is_secret: false,
      },
      {
        id: "t4",
        world_id: "w1",
        from_location_id: "e",
        to_location_id: "b",
        direction_label: "Back to Passage (1-M)",
        compass_direction: "W",
        distance_meters: 140,
        speed_modifier: 1,
        travel_mode: null,
        obstacles: [],
        is_blocked: false,
        is_secret: false,
      },
      {
        id: "t5",
        world_id: "w1",
        from_location_id: "f",
        to_location_id: "b",
        direction_label: "Return passage to Passage (1-M)",
        compass_direction: "NE",
        distance_meters: 140,
        speed_modifier: 1,
        travel_mode: null,
        obstacles: [],
        is_blocked: false,
        is_secret: false,
      },
      {
        id: "custom",
        world_id: "w1",
        from_location_id: "g",
        to_location_id: "b",
        direction_label: "Rusted iron hatch",
        compass_direction: "NW",
        distance_meters: 140,
        speed_modifier: 1,
        travel_mode: null,
        obstacles: [],
        is_blocked: true,
        is_secret: false,
      },
      {
        id: "outgoing",
        world_id: "w1",
        from_location_id: "b",
        to_location_id: "a",
        direction_label: "Passage to Passage (1-M)",
        compass_direction: "S",
        distance_meters: 140,
        speed_modifier: 1,
        travel_mode: null,
        obstacles: [],
        is_blocked: false,
        is_secret: false,
      },
    ];

    // Trailing space or blank newName leaves edges referentially unchanged
    expect(
      syncEdgeLabelsForLocationRename(sampleEdges, "b", "Passage (1-M)", "")
    ).toBe(sampleEdges);
    expect(
      syncEdgeLabelsForLocationRename(
        sampleEdges,
        "b",
        "Passage (1-M)",
        "Passage (1-M) "
      )
    ).toBe(sampleEdges);

    const renamed = syncEdgeLabelsForLocationRename(
      sampleEdges,
      "b",
      "Passage (1-M)",
      "Tunnel 1-M"
    );
    expect(renamed.find((e) => e.id === "t1")?.direction_label).toBe(
      "Passage to Tunnel 1-M"
    );
    expect(renamed.find((e) => e.id === "t2")?.direction_label).toBe(
      "Return to Tunnel 1-M"
    );
    expect(renamed.find((e) => e.id === "t3")?.direction_label).toBe(
      "To Tunnel 1-M"
    );
    expect(renamed.find((e) => e.id === "t4")?.direction_label).toBe(
      "Back to Tunnel 1-M"
    );
    expect(renamed.find((e) => e.id === "t5")?.direction_label).toBe(
      "Return passage to Tunnel 1-M"
    );
    expect(renamed.find((e) => e.id === "custom")?.direction_label).toBe(
      "Rusted iron hatch"
    );
    expect(renamed.find((e) => e.id === "outgoing")?.direction_label).toBe(
      "Passage to Passage (1-M)"
    );

    // 2. resolveEdgePairForDialog resolves both directions or explicit bundles
    const pair = resolveEdgePairForDialog("e1", edges);
    expect(pair.map((e) => e.id)).toEqual(["e1", "e2"]);
    expect(resolveEdgePairForDialog("e1", edges, ["e3", "e4"]).map((e) => e.id)).toEqual([
      "e3",
      "e4",
    ]);

    // 3. resolveBidirectionalProjectedBundle merges reverse locks/minutes and counts undirected pairs
    const twoContLocs: LocationNode[] = [
      ...locations,
      {
        id: "loc_clinic_main",
        world_id: "world_1",
        container_id: "cont_clinic",
        is_entry_exit: true,
        name: "Clinic Bay",
        summary: "Sterile room.",
        description: "Fluorescent lights buzz.",
        environmental_tags: [],
        is_starting_location: false,
      },
      {
        id: "loc_clinic_back",
        world_id: "world_1",
        container_id: "cont_clinic",
        is_entry_exit: true,
        name: "Clinic Backdoor",
        summary: "Alley exit.",
        description: "Dumpsters outside.",
        environmental_tags: [],
        is_starting_location: false,
      },
    ];
    const crossEdges: LocationEdge[] = [
      ...edges,
      {
        id: "cx1_fwd",
        world_id: "world_1",
        from_location_id: "loc_foyer",
        to_location_id: "loc_clinic_main",
        direction_label: "Passage to Clinic Bay",
        compass_direction: "W",
        distance_meters: 560,
        speed_modifier: 1,
        travel_mode: null,
        obstacles: [],
        is_blocked: false,
        is_secret: false,
      },
      {
        id: "cx1_rev",
        world_id: "world_1",
        from_location_id: "loc_clinic_main",
        to_location_id: "loc_foyer",
        direction_label: "Return to Main Floor",
        compass_direction: "E",
        distance_meters: 210,
        speed_modifier: 1,
        travel_mode: null,
        obstacles: [],
        is_blocked: true,
        is_secret: false,
      },
      {
        id: "cx2_fwd",
        world_id: "world_1",
        from_location_id: "loc_hub",
        to_location_id: "loc_clinic_back",
        direction_label: "Passage to Clinic Backdoor",
        compass_direction: "N",
        distance_meters: 420,
        speed_modifier: 1,
        travel_mode: null,
        obstacles: [],
        is_blocked: false,
        is_secret: false,
      },
      {
        id: "cx2_rev",
        world_id: "world_1",
        from_location_id: "loc_clinic_back",
        to_location_id: "loc_hub",
        direction_label: "Return to Canal Junction",
        compass_direction: "S",
        distance_meters: 420,
        speed_modifier: 1,
        travel_mode: null,
        obstacles: [],
        is_blocked: false,
        is_secret: false,
      },
    ];
    const rootCrossProj = projectTopologyForDepth(
      null,
      containers,
      twoContLocs,
      crossEdges,
      "loc_foyer"
    );
    const aggFwd = rootCrossProj.projectedEdges.find(
      (pe) =>
        pe.sourceNodeId === "cont_clinic" && pe.targetNodeId === "cont_district"
    )!;
    const mergedBundle = resolveBidirectionalProjectedBundle(
      aggFwd,
      rootCrossProj.projectedEdges
    );
    expect(mergedBundle.passagePairCount).toBe(2);
    expect(mergedBundle.minDistanceMeters).toBe(210);
    expect(mergedBundle.maxDistanceMeters).toBe(560);
    expect(mergedBundle.containsBlockedEdge).toBe(true);
    expect(mergedBundle.allEdges).toHaveLength(4);

    const crossCoords: Record<string, { x: number; y: number }> = {
      ...computeFullMapCoords(twoContLocs, crossEdges, "loc_foyer"),
      cont_district: { x: 140, y: 0 },
      cont_clinic: { x: -140, y: 0 },
      loc_street: { x: 0, y: 180 },
    };
    const crossCanvasHtml = renderToStaticMarkup(
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
        projectedTopology={rootCrossProj}
        fullMapCoords={crossCoords}
        selectedContainer={null}
        selectedLocation={null}
        activeLoc={twoContLocs[0]}
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
        openContextMenuAt={() => {}}
        handleUpdateEdgeDistance={() => {}}
        handleDeleteEdge={() => {}}
        handleDeleteEdgeGroup={() => {}}
        drillIntoContainer={() => {}}
      />
    );
    expect(crossCanvasHtml).toContain("210m · 2");
    expect(crossCanvasHtml).toContain("lucide-lock");
    expect(crossCanvasHtml).not.toContain("m · 1");

    // 4. MapDetailsDrawer Bundle List View renders unique Link Pairs with drill-in support
    const bundlePairs = resolveBundleLinkPairs(
      mergedBundle.allEdges.map((e) => e.id),
      crossEdges
    );
    expect(bundlePairs).toHaveLength(2);
    const drawerBundleHtml = renderToStaticMarkup(
      <MapDetailsDrawer
        mode="editor"
        isMutatingLocked={false}
        selectedLocation={null}
        selectedContainer={null}
        selectedEdgeBundle={bundlePairs}
        allEdges={crossEdges}
        containers={containers}
        allLocations={twoContLocs}
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
        onSelectEdgePair={() => {}}
      />
    );
    expect(drawerBundleHtml).toContain("Boundary Passages (2)");
    expect(drawerBundleHtml).toContain("Passage to Clinic Bay");
    expect(drawerBundleHtml).toContain("Blocked");

    // 5. MapContextMenu shows inspect action for single edge & bundle actions for multi-bundle
    const singleCtxHtml = renderToStaticMarkup(
      <MapContextMenu
        menu={{ x: 10, y: 20, target: { kind: "edge", edgeId: "e1" } }}
        locations={locations}
        containers={containers}
        edges={edges}
        mode="editor"
        canDeleteContainer={() => ({ allowed: true })}
        canDeleteLocation={() => ({ allowed: true })}
        canConvertLocation={() => ({ allowed: true })}
        canMoveOutToParent={() => ({ allowed: true, parentLabel: "Root" })}
        onClose={() => {}}
        onInspect={() => {}}
        onEnterContainer={() => {}}
        onSetStartingLocation={() => {}}
        onConvertToContainer={() => {}}
        onMoveOutToParent={() => {}}
        onDeleteLocation={() => {}}
        onDeleteContainer={() => {}}
        onEditEdgeDistance={() => {}}
        onInspectEdge={() => {}}
        onToggleEdgeBlocked={() => {}}
        onToggleEdgeSecret={() => {}}
        onDeleteEdge={() => {}}
        onDeleteEdgeGroup={() => {}}
      />
    );
    expect(singleCtxHtml).toContain("Inspect Link...");
    expect(singleCtxHtml).toContain("Mark Blocked");
    expect(singleCtxHtml).toContain("Mark Secret");

    const bundleCtxHtml = renderToStaticMarkup(
      <MapContextMenu
        menu={{
          x: 10,
          y: 20,
          target: {
            kind: "edge",
            edgeId: "cx1_fwd",
            groupedEdgeIds: mergedBundle.allEdges.map((e) => e.id),
            pairCount: 2,
          },
        }}
        locations={twoContLocs}
        containers={containers}
        edges={crossEdges}
        mode="editor"
        canDeleteContainer={() => ({ allowed: true })}
        canDeleteLocation={() => ({ allowed: true })}
        canConvertLocation={() => ({ allowed: true })}
        canMoveOutToParent={() => ({ allowed: true, parentLabel: "Root" })}
        onClose={() => {}}
        onInspect={() => {}}
        onEnterContainer={() => {}}
        onSetStartingLocation={() => {}}
        onConvertToContainer={() => {}}
        onMoveOutToParent={() => {}}
        onDeleteLocation={() => {}}
        onDeleteContainer={() => {}}
        onEditEdgeDistance={() => {}}
        onInspectEdge={() => {}}
        onToggleEdgeBlocked={() => {}}
        onToggleEdgeSecret={() => {}}
        onDeleteEdge={() => {}}
        onDeleteEdgeGroup={() => {}}
      />
    );
    expect(bundleCtxHtml).toContain("Inspect 2 Passages...");
    expect(bundleCtxHtml).toContain("Delete All 2 Passages");

    // 6. MapDetailsDrawer renders directionLabel & edit button for externalPortals
    const drawerWithPortalHtml = renderToStaticMarkup(
      <MapDetailsDrawer
        mode="editor"
        isMutatingLocked={false}
        selectedLocation={locations[0]}
        selectedContainer={null}
        containers={containers}
        allLocations={locations}
        activeLocId={locations[0].id}
        dynamicPortalIds={new Set(["loc_foyer"])}
        externalPortals={[
          {
            edgeId: "cx1_fwd",
            destinationName: "Clinic Bay",
            destinationContainerName: "Viktor Clinic",
            directionLabel: "Passage to Clinic Bay",
            compassDirection: "W",
            distanceMeters: 560,
            speedModifier: 1,
            travelMode: null,
            obstacles: [],
            isBlocked: false,
            isSecret: false,
            isUndiscoveredSecret: false,
          },
        ]}
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
        onInspectEdgePair={() => {}}
        onDeleteEdge={() => {}}
        onDrillIntoContainer={() => {}}
      />
    );
    expect(drawerWithPortalHtml).toContain("via Passage to Clinic Bay");
    expect(drawerWithPortalHtml).toContain('aria-label="Edit link to Clinic Bay"');

    // 7. worldPointToWrapperPoint uses live pan/zoom with svgEl.getScreenCTM() (not stale groupEl)
    const mockWrap = {
      getBoundingClientRect: () => ({ left: 100, top: 50, width: 680, height: 520 }),
      clientLeft: 0,
      clientTop: 0,
    } as unknown as HTMLElement;
    const mockSvg = {
      getBoundingClientRect: () => ({ left: 100, top: 50, width: 680, height: 520 }),
      getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 440, f: 310 }),
      createSVGPoint: () => {
        const pt = {
          x: 0,
          y: 0,
          matrixTransform: (m: { e: number; f: number }) => ({
            x: pt.x + m.e,
            y: pt.y + m.f,
          }),
        };
        return pt;
      },
    } as unknown as SVGSVGElement;
    const staleGroup = {
      getScreenCTM: () => {
        throw new Error("Should not rely on stale groupEl.getScreenCTM()");
      },
    } as unknown as SVGGElement;
    const mapped = worldPointToWrapperPoint(
      10,
      20,
      mockSvg,
      mockWrap,
      staleGroup,
      { x: 5, y: -10 },
      2
    );
    // vbX = (10 + 5) * 2 = 30, vbY = (20 - 10) * 2 = 20 -> +440-100 = 370, +310-50 = 280
    expect(mapped).toEqual({ x: 370, y: 280 });
  });

  it("pushes undo snapshots when dropping moved locations/containers onto open canvas and skips no-op drops", () => {
    const locCalls: Array<{ id: string; patch: Partial<LocationNode>; pushUndo?: boolean }> = [];
    const contCalls: Array<{ id: string; patch: Partial<LocationContainer>; pushUndo?: boolean }> = [];
    const autoLoc: LocationNode = {
      id: "loc_auto",
      world_id: "w1",
      name: "The Catwalk",
      summary: "Alley",
      description: "Alley",
      environmental_tags: [],
      is_starting_location: true,
      ui_x: null,
      ui_y: null,
    };
    const pinnedLoc: LocationNode = {
      ...autoLoc,
      id: "loc_pinned",
      ui_x: 120,
      ui_y: -40,
    };
    const cont: LocationContainer = {
      id: "cont_1",
      world_id: "w1",
      depth: 1,
      name: "The Neon Rust",
      description: "",
      environmental_tags: [],
      ui_x: 50,
      ui_y: 80,
    };
    const locationMap = new Map([
      [autoLoc.id, autoLoc],
      [pinnedLoc.id, pinnedLoc],
    ]);
    const containerMap = new Map([[cont.id, cont]]);
    const patchLocation = (
      id: string,
      patch: Partial<LocationNode>,
      pushUndo?: boolean
    ) => {
      locCalls.push({ id, patch, pushUndo });
    };
    const patchContainer = (
      id: string,
      patch: Partial<LocationContainer>,
      pushUndo?: boolean
    ) => {
      contCalls.push({ id, patch, pushUndo });
    };

    // Moving an auto-placed location (null -> coords) pushes undo
    expect(
      commitCanvasDropCoordinates({
        kind: "location",
        id: "loc_auto",
        x: 200,
        y: -60,
        locationMap,
        containerMap,
        patchLocation,
        patchContainer,
      })
    ).toBe(true);
    expect(locCalls[0]).toEqual({
      id: "loc_auto",
      patch: { ui_x: 200, ui_y: -60 },
      pushUndo: true,
    });

    // Dropping a pinned location back at its exact same coords is a no-op
    expect(
      commitCanvasDropCoordinates({
        kind: "location",
        id: "loc_pinned",
        x: 120,
        y: -40,
        locationMap,
        containerMap,
        patchLocation,
        patchContainer,
      })
    ).toBe(false);
    expect(locCalls).toHaveLength(1);

    // Moving a container to new coords pushes undo
    expect(
      commitCanvasDropCoordinates({
        kind: "container",
        id: "cont_1",
        x: 90,
        y: 110,
        locationMap,
        containerMap,
        patchLocation,
        patchContainer,
      })
    ).toBe(true);
    expect(contCalls[0]).toEqual({
      id: "cont_1",
      patch: { ui_x: 90, ui_y: 110 },
      pushUndo: true,
    });
  });
});
