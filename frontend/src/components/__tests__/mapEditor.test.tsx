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
import { SpatialTopologyView, computeFullMapCoords } from "../SpatialTopologyView";
import { MapDetailsDrawer } from "../map/MapDetailsDrawer";
import {
  EmptyCanvasCreateModal,
  GroupIntoContainerModal,
  PassageHubCollisionModal,
} from "../map/MapDialogs";
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
    expect(visitedHtml).toContain("Visited room");
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
});
