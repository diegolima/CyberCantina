import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  CampaignStateBundle,
  CharacterRecord,
  CharacterStateSnapshot,
  LocationNode,
  TurnNodeRecord,
} from "../../types";
import { AgentChangesModal } from "../inspector/AgentChangesModal";

function makeLoc(id: string, name: string): LocationNode {
  return {
    id,
    world_id: "w1",
    name,
    summary: name,
    description: `${name} desc.`,
    environmental_tags: [],
    is_starting_location: id === "loc_plaza",
    lore_nodes: [],
  };
}

function makeBaseBundle(turns: TurnNodeRecord[]): CampaignStateBundle {
  const plaza = makeLoc("loc_plaza", "Plaza");
  const bar = makeLoc("loc_bar", "Bar");
  const street = makeLoc("loc_street", "Street");
  const char: CharacterRecord = {
    id: "char_1",
    version: 1,
    world_id: "w1",
    name: "Vance",
    tagline: "Runner",
    physical_appearance: "Weathered coat.",
    core_persona: "Direct.",
    initial_message: "Ready.",
    baseline_psyche: {
      mood_label: "Steady",
      valence: 0,
      arousal: 0.3,
      default_want: "Move",
      default_plan: "Walk",
      core_drive: "Survive",
      core_fear: "Trap",
    },
    equipped: [],
    inventory: [],
    memory_shards: [],
    voice_anchors: [],
    tags: [],
    creator: "Test",
    creator_notes: "",
    portraits: {},
    gallery: [],
    created_at: "2099-05-01T12:00:00Z",
  };
  const st: CharacterStateSnapshot = {
    turn_id: turns[turns.length - 1].id,
    character_id: "char_1",
    current_location_id: "loc_plaza",
    mood_label: "Steady",
    valence: 0,
    arousal: 0.3,
    active_want: "Move",
    active_plan: "Walk",
    relationship_notes: {},
    equipped: [],
    inventory: [],
    unlocked_persona_keys: [],
    physical_stance: "standing",
    physical_context: "",
  };
  return {
    campaign: {
      id: "camp_1",
      name: "Walk Test",
      world_id: "w1",
      character_id: "char_1",
      participant_character_ids: ["char_1"],
      active_leaf_turn_id: turns[turns.length - 1].id,
      created_at: "2099-05-01T12:00:00Z",
    },
    active_branch_turns: turns,
    all_turn_nodes: turns,
    current_world_snapshot: turns[turns.length - 1].world_snapshot,
    current_character_state: st,
    current_persona_turn_state: {
      turn_id: turns[turns.length - 1].id,
      equipped: [],
      inventory: [],
      physical_stance: "standing",
      physical_context: "",
    },
    character_states: { char_1: st },
    character_records: { char_1: char },
    present_character_ids: ["char_1"],
    active_location: plaza,
    neighbor_locations: [],
    visible_locations: [plaza, bar, street],
    visible_edges: [],
    containers: [],
    world_lore_nodes: [],
    episodic_chunks: [],
    all_episodic_chunks: [],
  };
}

function makeTurn(
  id: string,
  parentId: string | null,
  depth: number,
  activeLocId: string,
  postTurn?: TurnNodeRecord["post_turn"]
): TurnNodeRecord {
  const st: CharacterStateSnapshot = {
    turn_id: id,
    character_id: "char_1",
    current_location_id: activeLocId,
    mood_label: "Steady",
    valence: 0,
    arousal: 0.3,
    active_want: "",
    active_plan: "",
    relationship_notes: {},
    equipped: [],
    inventory: [],
    unlocked_persona_keys: [],
    physical_stance: "standing",
    physical_context: "",
  };
  return {
    id,
    campaign_id: "camp_1",
    parent_turn_id: parentId,
    depth_index: depth,
    user_message: "walk",
    actor_id: "char_1",
    raw_prose: "walked",
    cognition: {
      recall: "",
      feeling: "Steady",
      valence: 0,
      arousal: 0.3,
      want: "",
      plan: "",
      skipped: false,
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
    },
    world_snapshot: {
      turn_id: id,
      world_timestamp: "2099-05-01 12:26",
      active_location_id: activeLocId,
      scene_flags: [],
      campaign_elapsed_minutes: 26,
      visited_location_ids: ["loc_plaza", "loc_bar", "loc_street"],
      visited_container_ids: [],
      revealed_lore_ids: [],
      revealed_edge_ids: [],
    },
    character_state: st,
    character_states: { char_1: st },
    recalled_items: [],
    post_turn: postTurn ?? null,
    created_at: "2099-05-01T12:26:00Z",
  };
}

describe("Runtime spatial improvisation AgentChangesModal rendering", () => {
  it("renders connect_existing with compass, distance, and Clamped to geometry badge", () => {
    const parent = makeTurn("t2", null, 2, "loc_street");
    const child = makeTurn("t3", "t2", 3, "loc_plaza", {
      elapsed_minutes: 11,
      transition_type: "connect_existing",
      target_location_id: "loc_plaza",
      improvised_link: {
        to_location_id: "loc_plaza",
        entry_direction_label: "Cut to Plaza",
        return_direction_label: "Cut to Street",
        compass_direction: "SE",
        distance_meters: 783,
        speed_modifier: 1,
        distance_mode: "flexible",
        is_vertical: false,
        clamped_from_meters: 350,
      },
      scene_flags_updated: [],
    });
    const html = renderToStaticMarkup(
      <AgentChangesModal
        target={{ turnId: "t3", agentKey: "clerk" }}
        bundle={makeBaseBundle([parent, child])}
        onClose={() => {}}
      />
    );
    expect(html).toContain("Linked direct route");
    expect(html).toContain("Plaza");
    expect(html).toContain("783m");
    expect(html).toContain("Clamped to geometry (from 350m)");
  });

  it("renders multi-hop traversed path and improvise_new vertical/distance badges", () => {
    const parent = makeTurn("t2", null, 2, "loc_street");
    const multiHop = makeTurn("t3_mh", "t2", 3, "loc_plaza", {
      elapsed_minutes: 15,
      transition_type: "move_existing",
      target_location_id: "loc_plaza",
      traversed_location_ids: ["loc_street", "loc_bar", "loc_plaza"],
      scene_flags_updated: [],
    });
    const htmlMulti = renderToStaticMarkup(
      <AgentChangesModal
        target={{ turnId: "t3_mh", agentKey: "clerk" }}
        bundle={makeBaseBundle([parent, multiHop])}
        onClose={() => {}}
      />
    );
    expect(htmlMulti).toContain("Street → Bar → Plaza");

    const impVert = makeTurn("t3_vert", "t2", 3, "loc_street", {
      elapsed_minutes: 2,
      transition_type: "improvise_new",
      improvised_location: {
        name: "Storm Drain",
        description: "Metal rung shaft descending beneath the street.",
        compass_direction: "S",
        distance_meters: 25,
        environmental_tags: ["damp"],
        is_vertical: true,
        distance_mode: "flexible",
      },
      scene_flags_updated: [],
    });
    const htmlVert = renderToStaticMarkup(
      <AgentChangesModal
        target={{ turnId: "t3_vert", agentKey: "clerk" }}
        bundle={makeBaseBundle([parent, impVert])}
        onClose={() => {}}
      />
    );
    expect(htmlVert).toContain("Storm Drain");
    expect(htmlVert).toContain("25m");
    expect(htmlVert).toContain("Vertical");
  });
});
