import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LocationContainer, LocationEdge, LocationNode } from "../../types";
import { SpatialTopologyView } from "../SpatialTopologyView";
import { TopologyHeaderToolbar } from "../map/TopologyHeaderToolbar";
import {
  filterAndRankMapSearchResults,
  scoreNameMatch,
} from "../map/mapSearch";
import { projectTopologyForDepth } from "../map/topologyProjection";

function makeSearchFixture(): {
  containers: LocationContainer[];
  locations: LocationNode[];
  edges: LocationEdge[];
} {
  const containers: LocationContainer[] = [
    {
      id: "cont_region",
      world_id: "world_1",
      parent_container_id: null,
      depth: 4,
      name: "Valkyrie Reach",
      description: "Outer orbital sector.",
      environmental_tags: ["orbital"],
      lore_nodes: [],
    },
    {
      id: "cont_harbor",
      world_id: "world_1",
      parent_container_id: "cont_region",
      depth: 2,
      name: "Harbor District",
      description: "Dockside sprawl.",
      environmental_tags: ["fog"],
      lore_nodes: [],
    },
    {
      id: "cont_market",
      world_id: "world_1",
      parent_container_id: "cont_harbor",
      depth: 1,
      name: "Market",
      description: "Covered trade hall.",
      environmental_tags: ["crowded"],
      lore_nodes: [],
    },
    {
      id: "cont_citadel",
      world_id: "world_1",
      parent_container_id: "cont_region",
      depth: 2,
      name: "High Citadel",
      description: "Fortified upper ward.",
      environmental_tags: ["stone"],
      lore_nodes: [],
    },
  ];

  const locations: LocationNode[] = [
    {
      id: "loc_market_sq",
      world_id: "world_1",
      container_id: "cont_harbor",
      is_starting_location: true,
      is_hub: true,
      name: "Market Square",
      summary: "Open transit plaza.",
      description: "Bustling plaza outside the covered market.",
      environmental_tags: ["hub"],
    },
    {
      id: "loc_courtyard_harbor",
      world_id: "world_1",
      container_id: "cont_market",
      is_starting_location: false,
      is_entry_exit: true,
      name: "Courtyard",
      summary: "Merchant loading court.",
      description: "Crates stacked around a brass fountain.",
      environmental_tags: ["crates"],
    },
    {
      id: "loc_courtyard_citadel",
      world_id: "world_1",
      container_id: "cont_citadel",
      is_starting_location: false,
      name: "Courtyard",
      summary: "Upper garrison court.",
      description: "Flagstone yard ringed by watchtowers.",
      environmental_tags: ["garrison"],
    },
    {
      id: "loc_anchor",
      world_id: "world_1",
      container_id: "cont_market",
      is_starting_location: false,
      name: "The Rusty Anchor",
      summary: "Harbor-side tavern.",
      description: "Salt-stained timbers and warm lanterns.",
      environmental_tags: ["tavern"],
    },
    {
      id: "loc_dock_7",
      world_id: "world_1",
      container_id: null,
      is_starting_location: false,
      name: "Dockyard Seven",
      summary: "Outer mooring pier.",
      description: "Heavy cranes overlook the bay.",
      environmental_tags: ["pier"],
    },
  ];

  const edges: LocationEdge[] = [
    {
      id: "e_1",
      world_id: "world_1",
      from_location_id: "loc_market_sq",
      to_location_id: "loc_courtyard_harbor",
      direction_label: "North into Market",
      compass_direction: "N",
      distance_meters: 140,
      speed_modifier: 1,
      travel_mode: null,
      obstacles: [],
      is_blocked: false,
      is_secret: false,
    },
    {
      id: "e_2",
      world_id: "world_1",
      from_location_id: "loc_courtyard_harbor",
      to_location_id: "loc_market_sq",
      direction_label: "South to Square",
      compass_direction: "S",
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

describe("mapSearch pure matching & ranking", () => {
  it("scores exact, prefix, word-prefix, and substring tiers accurately", () => {
    expect(scoreNameMatch("Market", "market")).toBe(0);
    expect(scoreNameMatch("Market Square", "market")).toBe(1);
    expect(scoreNameMatch("The Rusty Anchor", "anchor")).toBe(2);
    expect(scoreNameMatch("High Citadel", "tadel")).toBe(3);
    expect(scoreNameMatch("High Citadel", "zephyr")).toBeNull();
    expect(scoreNameMatch("High Citadel", "")).toBeNull();
  });

  it("returns empty array for empty or whitespace queries", () => {
    const { containers, locations } = makeSearchFixture();
    expect(
      filterAndRankMapSearchResults({ query: "", locations, containers })
    ).toEqual([]);
    expect(
      filterAndRankMapSearchResults({ query: "   ", locations, containers })
    ).toEqual([]);
  });

  it("ranks exact container match ahead of prefix location match across depths", () => {
    const { containers, locations } = makeSearchFixture();
    const hits = filterAndRankMapSearchResults({
      query: "market",
      locations,
      containers,
    });

    expect(hits.map((h) => [h.kind, h.id, h.matchTier])).toEqual([
      ["container", "cont_market", 0],
      ["location", "loc_market_sq", 1],
    ]);
    expect(hits[0].breadcrumb).toBe("Valkyrie Reach › Harbor District");
    expect(hits[0].containerDepth).toBe(1);
    expect(hits[1].breadcrumb).toBe("Valkyrie Reach › Harbor District");
    expect(hits[1].isHub).toBe(true);
    expect(hits[1].isStarting).toBe(true);
  });

  it("disambiguates duplicate names with distinct ancestor breadcrumbs", () => {
    const { containers, locations } = makeSearchFixture();
    const hits = filterAndRankMapSearchResults({
      query: "courtyard",
      locations,
      containers,
    });

    expect(hits).toHaveLength(2);
    expect(hits.map((h) => [h.id, h.breadcrumb])).toEqual([
      ["loc_courtyard_harbor", "Valkyrie Reach › Harbor District › Market"],
      ["loc_courtyard_citadel", "Valkyrie Reach › High Citadel"],
    ]);
  });

  it("matches partial word prefixes and top-level nodes cleanly", () => {
    const { containers, locations } = makeSearchFixture();
    const anchorHits = filterAndRankMapSearchResults({
      query: "anch",
      locations,
      containers,
    });
    expect(anchorHits.map((h) => h.id)).toEqual(["loc_anchor"]);

    const dockHits = filterAndRankMapSearchResults({
      query: "seven",
      locations,
      containers,
    });
    expect(dockHits).toHaveLength(1);
    expect(dockHits[0].id).toBe("loc_dock_7");
    expect(dockHits[0].breadcrumb).toBe("Top-Level");
  });
});

describe("TopologyHeaderToolbar map search rendering", () => {
  it("renders the search combobox in TopologyHeaderToolbar and consolidated canvas zoom/center controls", () => {
    const { containers, locations, edges } = makeSearchFixture();
    const html = renderToStaticMarkup(
      <SpatialTopologyView
        title="Test World Map"
        containers={containers}
        locations={locations}
        edges={edges}
        activeLocationId="loc_market_sq"
        mode="editor"
      />
    );

    expect(html).toContain('aria-label="Search locations and containers"');
    expect(html).toContain('role="combobox"');
    expect(html).toContain('placeholder="Search locations &amp; areas…"');
    expect(html).not.toContain('aria-label="Map zoom controls"');
    expect(html).toContain('data-testid="canvas-zoom-indicator"');
    expect(html).toContain('aria-label="Center on Selected / Active Location"');
  });

  it("remains backwards-compatible when TopologyHeaderToolbar is rendered without search callbacks", () => {
    const { containers, locations, edges } = makeSearchFixture();
    const projected = projectTopologyForDepth(
      null,
      containers,
      locations,
      edges,
      "loc_market_sq"
    );
    const html = renderToStaticMarkup(
      <TopologyHeaderToolbar
        locationsCount={locations.length}
        edgesCount={edges.length}
        containersCount={containers.length}
        hasSaveMap={false}
        effectiveDirty={false}
        hasBlockingErrors={false}
        effectiveSaving={false}
        isMutatingLocked={false}
        validationSummary={null}
        handleSaveClick={() => {}}
        handleCloseClick={() => {}}
        currentContainerId={null}
        projectedTopology={projected}
        drillIntoContainer={() => {}}
      />
    );

    expect(html).toContain("Spatial Topology");
    expect(html).not.toContain('aria-label="Map zoom controls"');
    expect(html).not.toContain('aria-label="Search locations and containers"');
  });
});
