import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  LocationContainer,
  LocationEdge,
  LocationNode,
  WorldRecord,
} from "../../types";
import {
  SpatialTopologyView,
  buildContainerBreadcrumbChain,
  computeDynamicPortalIds,
  computeFullMapCoords,
  computePromotionCandidates,
  projectTopologyForDepth,
} from "../SpatialTopologyView";
import {
  WorldContainersTab,
  getDescendantContainerIds,
  validateContainersState,
} from "../WorldContainersTab";
import {
  LoreIndexModal,
  buildLoreIndexEntries,
} from "../inspector/LoreIndexModal";

function makeHierarchyFixture() {
  const containers: LocationContainer[] = [
    {
      id: "cont_region",
      world_id: "world_1",
      parent_container_id: null,
      depth: 4,
      name: "Pacific Rim",
      description: "Coastal megaregion.",
      environmental_tags: ["acid rain"],
      lore_nodes: [],
    },
    {
      id: "cont_city",
      world_id: "world_1",
      parent_container_id: "cont_region",
      depth: 3,
      name: "Night City",
      description: "Neon metropolis.",
      environmental_tags: ["neon"],
      lore_nodes: [],
    },
    {
      id: "cont_dist",
      world_id: "world_1",
      parent_container_id: "cont_city",
      depth: 2,
      name: "Watson District",
      description: "Industrial port ward.",
      environmental_tags: ["industrial"],
      lore_nodes: [],
    },
    {
      id: "cont_club",
      world_id: "world_1",
      parent_container_id: "cont_dist",
      depth: 1,
      name: "Afterlife Club",
      description: "Morgue turned merc bar.",
      environmental_tags: ["heavy bass", "neon haze"],
      lore_nodes: [
        {
          id: "cl_1",
          world_id: "world_1",
          container_id: "cont_club",
          title: "Mercenary Etiquette",
          category: "culture",
          content: "Neutrality enforced by Fixer Rogue.",
          entity_tags: ["Fixer Rogue", "neutrality"],
        },
        {
          id: "cl_secret",
          world_id: "world_1",
          container_id: "cont_club",
          title: "Sub-pier Vault",
          category: "secret",
          content: "Code 4-2-9 opens the vault.",
          entity_tags: ["breaker panel"],
        },
      ],
    },
    {
      id: "cont_empty",
      world_id: "world_1",
      parent_container_id: "cont_dist",
      depth: 1,
      name: "Sealed Bunker",
      description: "Zero portal vault.",
      environmental_tags: ["concrete"],
      lore_nodes: [],
    },
  ];

  const locations: LocationNode[] = [
    {
      id: "loc_foyer",
      world_id: "world_1",
      container_id: "cont_club",
      is_entry_exit: true,
      name: "Main Floor",
      summary: "Main bar floor.",
      description: "Sub-bass thrums.",
      environmental_tags: ["bar"],
      is_starting_location: true,
    },
    {
      id: "loc_vip",
      world_id: "world_1",
      container_id: "cont_club",
      is_entry_exit: false,
      name: "VIP Booth",
      summary: "Private booth.",
      description: "Tinted partition.",
      environmental_tags: ["private"],
      is_starting_location: false,
    },
    {
      id: "loc_highway",
      world_id: "world_1",
      container_id: "cont_dist",
      is_entry_exit: false,
      name: "Watson Overpass",
      summary: "Elevated concrete highway.",
      description: "Loose L0 road inside L2 district.",
      environmental_tags: ["highway"],
      is_starting_location: false,
    },
    {
      id: "loc_badlands",
      world_id: "world_1",
      container_id: null,
      is_entry_exit: false,
      name: "Salt Flats Outpost",
      summary: "Uncontained Root roadhouse.",
      description: "Windswept dirt junction.",
      environmental_tags: ["dust"],
      is_starting_location: false,
    },
  ];

  const edges: LocationEdge[] = [
    {
      id: "e1",
      world_id: "world_1",
      from_location_id: "loc_foyer",
      to_location_id: "loc_vip",
      direction_label: "VIP Stairs",
      compass_direction: "E",
      travel_minutes: 1,
      is_locked_or_hidden: false,
    },
    {
      id: "e2",
      world_id: "world_1",
      from_location_id: "loc_foyer",
      to_location_id: "loc_highway",
      direction_label: "Street Stairs",
      compass_direction: "W",
      travel_minutes: 2,
      is_locked_or_hidden: false,
    },
    {
      id: "e3",
      world_id: "world_1",
      from_location_id: "loc_highway",
      to_location_id: "loc_badlands",
      direction_label: "Dusty Interstate",
      compass_direction: "S",
      travel_minutes: 20,
      is_locked_or_hidden: true,
    },
  ];

  const world: WorldRecord = {
    id: "world_1",
    name: "Night Rim",
    global_rules: {
      genre: "Cyberpunk",
      tone: "Gritty",
      starting_timestamp: "2077-08-12 21:00",
      setting_overview: "Corporate arcologies.",
      tech_or_magic_rules: "Cyberware.",
    },
    created_at: "2026-01-01T00:00:00Z",
    containers,
    locations,
    edges,
    lore_nodes: [
      {
        id: "wl_1",
        world_id: "world_1",
        title: "Arasaka Hegemony",
        category: "faction",
        content: "Controls orbital lanes.",
        entity_tags: ["Arasaka"],
      },
    ],
  };

  return { containers, locations, edges, world };
}

describe("Location Containers Frontend Architecture", () => {
  it("projects root supernodes, loose macro nodes, breadcrumbs, and dynamic portals accurately", () => {
    const { containers, locations, edges } = makeHierarchyFixture();

    const chain = buildContainerBreadcrumbChain("cont_club", containers);
    expect(chain.map((c) => c.name)).toEqual([
      "Pacific Rim",
      "Night City",
      "Watson District",
      "Afterlife Club",
    ]);

    // Root zoom: shows L4 container Pacific Rim + uncontained Salt Flats Outpost + aggregated edge
    const rootProj = projectTopologyForDepth(
      null,
      containers,
      locations,
      edges,
      "loc_foyer",
      { char_kira: "loc_foyer" }
    );
    expect(rootProj.visibleSupernodes.map((s) => s.container.id)).toEqual([
      "cont_region",
    ]);
    expect(rootProj.visibleLocations.map((l) => l.id)).toEqual(["loc_badlands"]);
    expect(rootProj.visibleSupernodes[0].hasActivePlayer).toBe(true);
    expect(rootProj.visibleSupernodes[0].presentCharacterIds).toEqual([
      "char_kira",
    ]);
    expect(rootProj.visibleSupernodes[0].descendantLocationCount).toBe(3);
    expect(rootProj.projectedEdges).toHaveLength(1);
    expect(rootProj.projectedEdges[0].isAggregated).toBe(true);
    expect(rootProj.projectedEdges[0].containsLockedEdge).toBe(true);

    // Elastic containment inside L2 Watson District: displays child L1 supernodes (incl 0-portal Sealed Bunker) + direct L0 Watson Overpass
    const distProj = projectTopologyForDepth(
      "cont_dist",
      containers,
      locations,
      edges,
      "loc_badlands"
    );
    expect(distProj.visibleSupernodes.map((s) => s.container.name)).toEqual([
      "Afterlife Club",
      "Sealed Bunker",
    ]);
    expect(distProj.visibleLocations.map((l) => l.name)).toEqual([
      "Watson Overpass",
    ]);
    expect(distProj.visibleSupernodes[1].descendantLocationCount).toBe(0);
    expect(distProj.visibleSupernodes[1].externalPortalsCount).toBe(0);

    // Inside L1 Afterlife Club: captures external exit pill on Main Floor and anchors on Main Floor even when player is outside
    const clubProj = projectTopologyForDepth(
      "cont_club",
      containers,
      locations,
      edges,
      "loc_badlands"
    );
    expect(clubProj.visibleLocations.map((l) => l.id)).toEqual([
      "loc_foyer",
      "loc_vip",
    ]);
    expect(clubProj.anchorNodeId).toBe("loc_foyer");
    expect(clubProj.externalPortalsByLocationId["loc_foyer"][0].destination.name).toBe(
      "Watson Overpass"
    );
    const coords = computeFullMapCoords(
      clubProj.visibleLocations,
      clubProj.projectedEdges.map((pe) => pe.rawEdge),
      clubProj.anchorNodeId
    );
    expect(coords["loc_foyer"]).toBeDefined();
    expect(coords["loc_vip"]).toBeDefined();
  });

  it("identifies single and dual Level 1 interior endpoints for Portal Promotion Prompts", () => {
    const { containers, locations } = makeHierarchyFixture();
    const contById = new Map(containers.map((c) => [c.id, c]));
    const club2: LocationContainer = {
      id: "cont_lizzies",
      world_id: "world_1",
      parent_container_id: "cont_dist",
      depth: 1,
      name: "Lizzies Bar",
      description: "Mox club.",
      environmental_tags: [],
      lore_nodes: [],
    };
    contById.set(club2.id, club2);
    const lounge: LocationNode = {
      id: "loc_lounge",
      world_id: "world_1",
      container_id: club2.id,
      is_entry_exit: false,
      name: "Velvet Lounge",
      summary: "Backroom.",
      description: "Velvet booths.",
      environmental_tags: [],
      is_starting_location: false,
    };
    const vip = locations.find((l) => l.id === "loc_vip")!;
    const highway = locations.find((l) => l.id === "loc_highway")!;
    const foyer = locations.find((l) => l.id === "loc_foyer")!;
    const portals = computeDynamicPortalIds(locations, []);

    // Single non-portal L1 endpoint -> external macro road
    const single = computePromotionCandidates(vip, highway, contById, portals);
    expect(single.map((c) => c.location.id)).toEqual(["loc_vip"]);

    // Direct L1-to-L1 dual promotion when neither is a portal yet
    const dual = computePromotionCandidates(vip, lounge, contById, portals);
    expect(dual.map((c) => c.location.id)).toEqual(["loc_vip", "loc_lounge"]);

    // Already-portal foyer -> highway prompts nothing
    expect(
      computePromotionCandidates(foyer, highway, contById, portals)
    ).toEqual([]);
  });

  it("enforces cycle prevention, depth monotonicity, and L2+ lore prohibition in WorldContainersTab validation", () => {
    const { containers, locations } = makeHierarchyFixture();
    expect(validateContainersState(containers, locations)).toBeNull();

    // Cycle / descendant helper
    const descendants = getDescendantContainerIds("cont_city", containers);
    expect(descendants.has("cont_city")).toBe(true);
    expect(descendants.has("cont_dist")).toBe(true);
    expect(descendants.has("cont_club")).toBe(true);
    expect(descendants.has("cont_region")).toBe(false);

    // Invalid depth: parent is same or shallower depth
    const badDepth = containers.map((c) =>
      c.id === "cont_dist" ? { ...c, depth: 3 as const } : c
    );
    expect(validateContainersState(badDepth, locations)).toMatch(
      /strictly deeper/i
    );

    // Invalid L2 lore prohibition
    const badLore = containers.map((c) =>
      c.id === "cont_dist"
        ? {
            ...c,
            lore_nodes: [
              {
                id: "bad",
                world_id: "world_1",
                container_id: c.id,
                title: "Too deep",
                category: "rumor" as const,
                content: "Illegal L2 lore.",
                entity_tags: ["x"],
              },
            ],
          }
        : c
    );
    expect(validateContainersState(badLore, locations)).toMatch(
      /Level 1 landmarks/i
    );

    // Dangling location container reference
    const badLocs = [
      ...locations,
      { ...locations[0], id: "dangling", container_id: "cont_missing" },
    ];
    expect(validateContainersState(containers, badLocs)).toMatch(
      /non-existent container/i
    );
  });

  it("builds container_lore index entries (excluding secrets) and renders container UI components cleanly", () => {
    const { containers, locations, edges, world } = makeHierarchyFixture();

    const entries = buildLoreIndexEntries({
      world,
      characters: [],
      locations,
      containers,
      activeLocationId: "loc_foyer",
      recalledItems: [
        {
          id: "cl_1",
          source_type: "container_lore",
          title: "Afterlife Club — Mercenary Etiquette",
          content: "Neutrality enforced.",
          score: 0.91,
        },
      ],
    });
    const contEntries = entries.filter((e) => e.kind === "container_lore");
    expect(contEntries).toHaveLength(1);
    expect(contEntries[0].title).toBe("Mercenary Etiquette");
    expect(contEntries[0].ambientActive).toBe(true);
    expect(contEntries[0].recalled).toBe(true);

    const mapHtml = renderToStaticMarkup(
      <SpatialTopologyView
        title="Hierarchical Map"
        containers={containers}
        locations={locations}
        edges={edges}
        activeLocationId="loc_foyer"
        mode="campaign"
      />
    );
    expect(mapHtml).toContain("World Root");
    expect(mapHtml).toContain("Pacific Rim");
    expect(mapHtml).toContain("Afterlife Club");
    expect(mapHtml).toContain("[Entry/Exit Portal]");

    const tabHtml = renderToStaticMarkup(
      <WorldContainersTab
        worldId="world_1"
        containers={containers}
        locations={locations}
        worldLoreNodes={world.lore_nodes}
        onChangeContainers={() => {}}
        onChangeLocations={() => {}}
        onChangeWorldLoreNodes={() => {}}
        onOpenConvertModal={() => {}}
      />
    );
    expect(tabHtml).toContain("Add Container");
    expect(tabHtml).toContain("Sealed Bunker");
    expect(tabHtml).toContain("Salt Flats Outpost");

    const loreModalHtml = renderToStaticMarkup(
      <LoreIndexModal
        world={world}
        characters={[]}
        locations={locations}
        containers={containers}
        activeLocationId="loc_foyer"
        recalledItems={[]}
        onClose={() => {}}
      />
    );
    expect(loreModalHtml).toContain("Containers (1)");
    expect(loreModalHtml).toContain("Mercenary Etiquette");
    expect(loreModalHtml).not.toContain("Sub-pier Vault");
  });
});
