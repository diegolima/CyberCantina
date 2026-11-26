import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  CampaignStateBundle,
  CharacterRecord,
  CharacterStateSnapshot,
  LocationContainer,
  LocationNode,
  NeighborLocationView,
  TurnNodeRecord,
  WorldRecord,
  WorldStateSnapshot,
} from "../../types";
import { LiveInspector } from "../LiveInspector";
import { InspectorLocationCard } from "../inspector/InspectorLocationCard";
import {
  MINI_MAP_DRAG_CANCEL_PX,
  MINI_MAP_SYNTHETIC_DBLCLICK_SUPPRESS_MS,
  beginMiniMapTouchTap,
  cancelMiniMapTouchTap,
  completeMiniMapTouchTap,
  createMiniMapTouchGestureState,
  moveMiniMapTouchTap,
  resolveFullMapModalProps,
  shouldSuppressSyntheticDblClick,
} from "../inspector/miniMapGeometry";
import { DOUBLE_TAP_MAX_DIST_PX, DOUBLE_TAP_MAX_MS } from "../map/mapGeometry";

const CONTAINER_BLDG: LocationContainer = {
  id: "cont-cantina",
  world_id: "w-1",
  parent_container_id: null,
  depth: 1,
  name: "Sector 7 Cantina",
  description: "Rain-slicked noodle bar and synth-lounge.",
  environmental_tags: ["neon"],
};

const LOC_HUB: LocationNode = {
  id: "loc-hub",
  world_id: "w-1",
  container_id: CONTAINER_BLDG.id,
  name: "Main Bar",
  summary: "Neon hub.",
  description: "Rain on chrome.",
  environmental_tags: [],
  is_starting_location: true,
  is_visited: true,
  lore_nodes: [],
  ui_x: 0,
  ui_y: 0,
};

const LOC_ALLEY: LocationNode = {
  id: "loc-alley",
  world_id: "w-1",
  container_id: null,
  name: "Back Alley",
  summary: "Steam vents.",
  description: "Narrow service corridor.",
  environmental_tags: [],
  is_starting_location: false,
  is_visited: false,
  lore_nodes: [],
  ui_x: 120,
  ui_y: 40,
};

const NEIGHBOR_ALLEY: NeighborLocationView = {
  edge_id: "edge-1",
  direction_label: "north",
  compass_direction: "N",
  distance_meters: 40,
  speed_modifier: 1,
  obstacles: [],
  is_blocked: false,
  is_secret: false,
  destination: LOC_ALLEY,
};

const WORLD_FIXTURE: WorldRecord = {
  id: "w-1",
  name: "Kowloon Run",
  global_rules: {
    genre: "Cyberpunk Noir",
    tone: "Gritty",
    setting_overview: "Rain-soaked vertical megablock.",
    tech_or_magic_rules: "Chrome and ICE.",
    starting_timestamp: "2094-11-14 23:15",
  },
  created_at: "2026-01-01T00:00:00Z",
  containers: [CONTAINER_BLDG],
  locations: [LOC_HUB, LOC_ALLEY],
  edges: [
    {
      id: "edge-1",
      world_id: "w-1",
      from_location_id: LOC_HUB.id,
      to_location_id: LOC_ALLEY.id,
      direction_label: "north",
      compass_direction: "N",
      distance_meters: 40,
      speed_modifier: 1,
      obstacles: [],
      is_blocked: false,
      is_secret: false,
    },
  ],
  lore_nodes: [],
};

const CHAR_MIRA: CharacterRecord = {
  id: "char-mira",
  version: 1,
  world_id: "w-1",
  name: "Mira",
  tagline: "Courier",
  physical_appearance: "Jacket",
  core_persona: "Sharp",
  communication_style: ["Terse"],
  quirks_flaws: ["Guarded"],
  moral_code: ["Deliver on time"],
  baseline_psyche: {
    mood_label: "focused",
    valence: 0,
    arousal: 0.2,
    core_drive: "Deliver",
    core_fear: "Failure",
    default_want: "Move",
    default_plan: "Scan",
  },
  voice_anchors: [],
  equipped: [],
  inventory: [],
  memory_shards: [],
  initial_message: "Doors slide shut.",
  tags: [],
  creator: "test",
  creator_notes: "",
  portraits: {},
  gallery: [],
  created_at: "2026-01-01T00:00:00Z",
};

function makeBundle(): CampaignStateBundle {
  const ws: WorldStateSnapshot = {
    turn_id: "t-0",
    world_timestamp: "2094-11-14 23:15",
    active_location_id: LOC_HUB.id,
    scene_flags: [],
    campaign_elapsed_minutes: 0,
    visited_location_ids: [LOC_HUB.id],
    visited_container_ids: [CONTAINER_BLDG.id],
    parties: [],
  };
  const cs: CharacterStateSnapshot = {
    turn_id: "t-0",
    character_id: CHAR_MIRA.id,
    current_location_id: LOC_HUB.id,
    mood_label: "focused",
    valence: 0,
    arousal: 0.2,
    active_want: "Move",
    active_plan: "Scan",
    relationship_notes: {},
    equipped: [],
    inventory: [],
  };
  const turn: TurnNodeRecord = {
    id: "t-0",
    campaign_id: "camp-1",
    parent_turn_id: null,
    depth_index: 0,
    user_message: "",
    actor_id: CHAR_MIRA.id,
    raw_prose: "Neon flickers overhead.",
    cognition: {
      recall: "Old courier drop.",
      feeling: "focused",
      want: "Check signal",
      plan: "Decrypt header",
      valence: 0,
      arousal: 0.2,
    },
    pre_turn: {
      user_sentiment: "neutral",
      subtext_interpretation: "",
      mentioned_entities: [],
      memory_search_queries: [],
      spatial_intent: "stay",
      mechanics_check: {
        requires_roll: false,
        action_description: "",
        skill_or_approach: "",
        difficulty_class: 10,
        relevant_modifier: 0,
      },
      active_speaker_id: CHAR_MIRA.id,
      speaker_order: [CHAR_MIRA.id],
    },
    world_snapshot: ws,
    character_state: cs,
    character_states: { [CHAR_MIRA.id]: cs },
    recalled_items: [],
    created_at: "2026-01-01T00:00:00Z",
  };
  return {
    campaign: {
      id: "camp-1",
      name: "Kowloon Run",
      world_id: WORLD_FIXTURE.id,
      character_id: CHAR_MIRA.id,
      participant_character_ids: [CHAR_MIRA.id],
      active_leaf_turn_id: turn.id,
      created_at: "2026-01-01T00:00:00Z",
    },
    active_branch_turns: [turn],
    all_turn_nodes: [turn],
    current_world_snapshot: ws,
    current_character_state: cs,
    character_states: { [CHAR_MIRA.id]: cs },
    character_records: { [CHAR_MIRA.id]: CHAR_MIRA },
    present_character_ids: [CHAR_MIRA.id],
    active_location: LOC_HUB,
    neighbor_locations: [NEIGHBOR_ALLEY],
    containers: [CONTAINER_BLDG],
    visible_locations: [LOC_HUB, LOC_ALLEY],
    visible_edges: WORLD_FIXTURE.edges,
    episodic_chunks: [],
    all_episodic_chunks: [],
  };
}

describe("minimap touch double-tap gesture detector", () => {
  it("triggers once on matching same-target touch double-tap and suppresses synthetic dblclick", () => {
    for (const targetKey of ["empty", "container", `location:${LOC_ALLEY.id}`]) {
      let state = createMiniMapTouchGestureState();
      state = beginMiniMapTouchTap(state, {
        pointerId: 1,
        targetKey,
        clientX: 100,
        clientY: 120,
      });
      const first = completeMiniMapTouchTap(state, {
        pointerId: 1,
        targetKey,
        clientX: 101,
        clientY: 121,
        now: 1000,
      });
      expect(first.triggered).toBe(false);
      expect(shouldSuppressSyntheticDblClick(first.state, 1000)).toBe(false);

      state = beginMiniMapTouchTap(first.state, {
        pointerId: 2,
        targetKey,
        clientX: 104,
        clientY: 123,
      });
      const second = completeMiniMapTouchTap(state, {
        pointerId: 2,
        targetKey,
        clientX: 104,
        clientY: 123,
        now: 1000 + DOUBLE_TAP_MAX_MS - 40,
      });
      expect(second.triggered).toBe(true);
      expect(shouldSuppressSyntheticDblClick(second.state, 1000 + DOUBLE_TAP_MAX_MS)).toBe(true);
      expect(
        shouldSuppressSyntheticDblClick(
          second.state,
          1000 + DOUBLE_TAP_MAX_MS - 40 + MINI_MAP_SYNTHETIC_DBLCLICK_SUPPRESS_MS + 1
        )
      ).toBe(false);
    }
  });

  it("does not trigger when timing, distance, or target mismatches", () => {
    let state = createMiniMapTouchGestureState();
    state = beginMiniMapTouchTap(state, {
      pointerId: 1,
      targetKey: `location:${LOC_ALLEY.id}`,
      clientX: 50,
      clientY: 50,
    });
    state = completeMiniMapTouchTap(state, {
      pointerId: 1,
      targetKey: `location:${LOC_ALLEY.id}`,
      clientX: 50,
      clientY: 50,
      now: 1000,
    }).state;

    // Target mismatch (node then empty)
    const mismatchStart = beginMiniMapTouchTap(state, {
      pointerId: 2,
      targetKey: "empty",
      clientX: 50,
      clientY: 50,
    });
    const mismatchEnd = completeMiniMapTouchTap(mismatchStart, {
      pointerId: 2,
      targetKey: "empty",
      clientX: 50,
      clientY: 50,
      now: 1120,
    });
    expect(mismatchEnd.triggered).toBe(false);

    // Distance exceeds DOUBLE_TAP_MAX_DIST_PX
    const farStart = beginMiniMapTouchTap(state, {
      pointerId: 3,
      targetKey: `location:${LOC_ALLEY.id}`,
      clientX: 50 + DOUBLE_TAP_MAX_DIST_PX + 2,
      clientY: 50,
    });
    const farEnd = completeMiniMapTouchTap(farStart, {
      pointerId: 3,
      targetKey: `location:${LOC_ALLEY.id}`,
      clientX: 50 + DOUBLE_TAP_MAX_DIST_PX + 2,
      clientY: 50,
      now: 1120,
    });
    expect(farEnd.triggered).toBe(false);

    // Interval exceeds DOUBLE_TAP_MAX_MS
    const slowStart = beginMiniMapTouchTap(state, {
      pointerId: 4,
      targetKey: `location:${LOC_ALLEY.id}`,
      clientX: 50,
      clientY: 50,
    });
    const slowEnd = completeMiniMapTouchTap(slowStart, {
      pointerId: 4,
      targetKey: `location:${LOC_ALLEY.id}`,
      clientX: 50,
      clientY: 50,
      now: 1000 + DOUBLE_TAP_MAX_MS + 1,
    });
    expect(slowEnd.triggered).toBe(false);
  });

  it("cancels pending double-tap on drag movement or pointercancel", () => {
    let state = createMiniMapTouchGestureState();
    state = beginMiniMapTouchTap(state, {
      pointerId: 10,
      targetKey: "empty",
      clientX: 100,
      clientY: 100,
    });
    state = completeMiniMapTouchTap(state, {
      pointerId: 10,
      targetKey: "empty",
      clientX: 100,
      clientY: 100,
      now: 2000,
    }).state;

    // Second touch starts then drags past MINI_MAP_DRAG_CANCEL_PX (e.g. swipe-dismiss)
    state = beginMiniMapTouchTap(state, {
      pointerId: 11,
      targetKey: "empty",
      clientX: 100,
      clientY: 100,
    });
    state = moveMiniMapTouchTap(state, {
      pointerId: 11,
      clientX: 100 + MINI_MAP_DRAG_CANCEL_PX + 4,
      clientY: 100,
    });
    const afterDrag = completeMiniMapTouchTap(state, {
      pointerId: 11,
      targetKey: "empty",
      clientX: 100 + MINI_MAP_DRAG_CANCEL_PX + 4,
      clientY: 100,
      now: 2100,
    });
    expect(afterDrag.triggered).toBe(false);
    expect(afterDrag.state.lastTap).toBeNull();

    // Pointer cancel clears active candidate and prior tap
    let cancelState = createMiniMapTouchGestureState();
    cancelState = beginMiniMapTouchTap(cancelState, {
      pointerId: 20,
      targetKey: "container",
      clientX: 20,
      clientY: 15,
    });
    cancelState = completeMiniMapTouchTap(cancelState, {
      pointerId: 20,
      targetKey: "container",
      clientX: 20,
      clientY: 15,
      now: 3000,
    }).state;
    cancelState = beginMiniMapTouchTap(cancelState, {
      pointerId: 21,
      targetKey: "container",
      clientX: 20,
      clientY: 15,
    });
    cancelState = cancelMiniMapTouchTap(cancelState, 21);
    const afterCancel = completeMiniMapTouchTap(cancelState, {
      pointerId: 21,
      targetKey: "container",
      clientX: 20,
      clientY: 15,
      now: 3080,
    });
    expect(afterCancel.triggered).toBe(false);
  });
});

describe("resolveFullMapModalProps", () => {
  it("maps empty, active, location, and container intents accurately", () => {
    expect(resolveFullMapModalProps({ kind: "empty" }, LOC_HUB.id, 1)).toEqual({
      defaultSelectedLocationId: null,
      externalFocusRequest: null,
    });
    expect(resolveFullMapModalProps({ kind: "active" }, LOC_HUB.id, 2)).toEqual({
      defaultSelectedLocationId: LOC_HUB.id,
      externalFocusRequest: null,
    });
    expect(resolveFullMapModalProps(null, LOC_HUB.id, 2)).toEqual({
      defaultSelectedLocationId: LOC_HUB.id,
      externalFocusRequest: null,
    });
    expect(
      resolveFullMapModalProps({ kind: "location", id: LOC_ALLEY.id }, LOC_HUB.id, 3)
    ).toEqual({
      defaultSelectedLocationId: null,
      externalFocusRequest: { kind: "location", id: LOC_ALLEY.id, nonce: 3 },
    });
    expect(
      resolveFullMapModalProps({ kind: "container", id: CONTAINER_BLDG.id }, LOC_HUB.id, 4)
    ).toEqual({
      defaultSelectedLocationId: null,
      externalFocusRequest: {
        kind: "container",
        id: CONTAINER_BLDG.id,
        nonce: 4,
      },
    });
  });
});

describe("InspectorLocationCard & LiveInspector SSR affordances", () => {
  it("renders minimap zoom-in SVG, interactive container pill, node tooltips, and preview focus button", () => {
    const bundle = makeBundle();
    const containerMap = new Map([[CONTAINER_BLDG.id, CONTAINER_BLDG]]);
    const htmlWithActive = renderToStaticMarkup(
      <InspectorLocationCard
        bundle={bundle}
        activeLoc={LOC_HUB}
        selectedLocId={LOC_HUB.id}
        setSelectedLocId={vi.fn()}
        selectedLocation={LOC_HUB}
        selectedNeighbor={undefined}
        immediateNeighbors={[{ ...NEIGHBOR_ALLEY, slot: "N" }]}
        miniMapCenter={{ x: 165, y: 118 }}
        miniMapCoords={{
          [LOC_HUB.id]: { x: 165, y: 118 },
          [LOC_ALLEY.id]: { x: 165, y: 46, slot: "N" },
        }}
        miniDynamicPortalIds={new Set()}
        containerMap={containerMap}
        activeBreadcrumbChain={[CONTAINER_BLDG]}
        showExits={false}
        setShowExits={vi.fn()}
        isOverriding={false}
        handleOverrideClick={vi.fn()}
        handleOpenFullMap={vi.fn()}
      />
    );

    expect(htmlWithActive).toContain("inspector-minimap-svg");
    expect(htmlWithActive).toContain("<title>Double-click to expand full map</title>");
    expect(htmlWithActive).toContain("minimap-container-pill");
    expect(htmlWithActive).toContain('pointer-events="auto"');
    expect(htmlWithActive).toContain(
      `L1 · ${CONTAINER_BLDG.name} — Double-click to inspect container on full map`
    );
    expect(htmlWithActive).toContain(
      `${LOC_HUB.name} — Click to preview, double-click to inspect on full map`
    );
    expect(htmlWithActive).toContain(
      `${LOC_ALLEY.name} — Click to preview, double-click to inspect on full map`
    );
    expect(htmlWithActive).toContain("inspector-preview-focus-btn");
    expect(htmlWithActive).toContain(`aria-label="Inspect ${LOC_HUB.name} on full map"`);

    const htmlWithNeighborSelected = renderToStaticMarkup(
      <InspectorLocationCard
        bundle={bundle}
        activeLoc={LOC_HUB}
        selectedLocId={LOC_ALLEY.id}
        setSelectedLocId={vi.fn()}
        selectedLocation={LOC_ALLEY}
        selectedNeighbor={{ ...NEIGHBOR_ALLEY, slot: "N" }}
        immediateNeighbors={[{ ...NEIGHBOR_ALLEY, slot: "N" }]}
        miniMapCenter={{ x: 165, y: 118 }}
        miniMapCoords={{
          [LOC_HUB.id]: { x: 165, y: 118 },
          [LOC_ALLEY.id]: { x: 165, y: 46, slot: "N" },
        }}
        miniDynamicPortalIds={new Set()}
        containerMap={containerMap}
        activeBreadcrumbChain={[CONTAINER_BLDG]}
        showExits={false}
        setShowExits={vi.fn()}
        isOverriding={false}
        handleOverrideClick={vi.fn()}
        handleOpenFullMap={vi.fn()}
      />
    );
    expect(htmlWithNeighborSelected).toContain(
      `aria-label="Inspect ${LOC_ALLEY.name} on full map"`
    );

    const liveInspectorHtml = renderToStaticMarkup(
      <LiveInspector
        bundle={bundle}
        world={WORLD_FIXTURE}
        character={CHAR_MIRA}
      />
    );
    expect(liveInspectorHtml).toContain("inspector-minimap-svg");
    expect(liveInspectorHtml).toContain("inspector-preview-focus-btn");
  });
});
