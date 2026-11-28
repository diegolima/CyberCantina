import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  type CampaignStateBundle,
  type CharacterRecord,
  type CharacterStateSnapshot,
  type LocationNode,
  type TurnNodeRecord,
} from "../../types";
import { CharacterPersonalityTab } from "../character/CharacterPersonalityTab";
import { AgentChangesModal } from "../inspector/AgentChangesModal";
import { CampaignCharacterStateTab } from "../world/codexCharacter/CampaignCharacterStateTab";

function makeLocation(): LocationNode {
  return {
    id: "loc_1",
    world_id: "w_1",
    name: "Rustbucket Cantina",
    summary: "Neon dive",
    description: "Humid air and humming neon.",
    environmental_tags: ["neon"],
    is_starting_location: true,
    lore_nodes: [],
  };
}

function makeCharacter(overrides: Partial<CharacterRecord> = {}): CharacterRecord {
  return {
    id: "char_kira",
    world_id: "w_1",
    version: 1,
    name: "Yulia Halim",
    tagline: "Fugitive courier",
    physical_appearance: "Worn coat",
    core_persona: "Calm and guarded",
    initial_message: "Keep moving.",
    baseline_psyche: {
      mood_label: "Alert",
      valence: 0.0,
      arousal: 0.4,
      core_drive: "Survive the night",
      core_fear: "Purge sweeps",
      default_want: "Secure transit",
      default_plan: "Stay unseen",
      default_objective: {
        summary: "Transit the Sluice into Sector 8",
        deadline_cue: "at daybreak",
      },
    },
    voice_anchors: [],
    equipped: [],
    inventory: [],
    memory_shards: [],
    tags: [],
    creator: "test",
    creator_notes: "",
    portraits: {},
    gallery: [],
    created_at: "2088-05-10T21:00:00Z",
    ...overrides,
  };
}

function makeCharState(
  overrides: Partial<CharacterStateSnapshot> = {}
): CharacterStateSnapshot {
  return {
    turn_id: "turn_1",
    character_id: "char_kira",
    current_location_id: "loc_1",
    mood_label: "Alert",
    valence: 0.0,
    arousal: 0.4,
    active_want: "Confirm the pilot is serious",
    active_plan: "- Ask about launch window",
    arc_objective: {
      summary: "Transit the Sluice into Sector 8",
      deadline_cue: "at daybreak",
      set_at_turn_depth: 0,
    },
    relationship_notes: {},
    inventory: [],
    physical_stance: "standing",
    physical_context: "",
    ...overrides,
  };
}

function makeBundle(turns: TurnNodeRecord[], charState: CharacterStateSnapshot): CampaignStateBundle {
  const loc = makeLocation();
  const char = makeCharacter();
  const leaf = turns[turns.length - 1];
  return {
    campaign: {
      id: "camp_1",
      name: "The Green Lie",
      world_id: "w_1",
      character_id: char.id,
      participant_character_ids: [char.id],
      active_leaf_turn_id: leaf.id,
      created_at: "2088-05-10T21:00:00Z",
      world_settings: { unlock_lore: true, describe_on_first_visit: false },
    },
    active_branch_turns: turns,
    all_turn_nodes: turns,
    current_world_snapshot: leaf.world_snapshot,
    current_character_state: charState,
    character_states: { [char.id]: charState },
    character_records: { [char.id]: char },
    present_character_ids: [char.id],
    active_location: loc,
    neighbor_locations: [],
    visible_locations: [loc],
    visible_edges: [],
    containers: [],
    world_lore_nodes: [],
    episodic_chunks: [],
    all_episodic_chunks: [],
  };
}

describe("Arc Objectives UI (TBD)", () => {
  it("renders Arc Objective card, deadline badge, empty state, and GM Mode override controls in CampaignCharacterStateTab", () => {
    const char = makeCharacter();
    const activeState = makeCharState();

    const gmUnlockedHtml = renderToStaticMarkup(
      <CampaignCharacterStateTab
        character={char}
        state={activeState}
        isPresent={true}
        characterNameMap={{ [char.id]: char.name }}
        onOverrideObjective={() => {}}
        isActive={true}
      />
    );
    expect(gmUnlockedHtml).toContain("Arc Objective");
    expect(gmUnlockedHtml).toContain("Transit the Sluice into Sector 8");
    expect(gmUnlockedHtml).toContain("at daybreak");
    expect(gmUnlockedHtml).toContain("Override Arc Objective (GM Mode)");
    expect(gmUnlockedHtml).toContain("Clear Arc Objective (GM Mode)");
    const arcIdx = gmUnlockedHtml.indexOf("Arc Objective");
    const wantIdx = gmUnlockedHtml.indexOf("Active Scene Want");
    expect(arcIdx).toBeGreaterThan(-1);
    expect(wantIdx).toBeGreaterThan(arcIdx);

    const lockedHtml = renderToStaticMarkup(
      <CampaignCharacterStateTab
        character={char}
        state={activeState}
        isPresent={true}
        characterNameMap={{ [char.id]: char.name }}
        isActive={true}
      />
    );
    expect(lockedHtml).toContain("Transit the Sluice into Sector 8");
    expect(lockedHtml).not.toContain("Override Arc Objective (GM Mode)");
    expect(lockedHtml).not.toContain("Clear Arc Objective (GM Mode)");

    const emptyHtml = renderToStaticMarkup(
      <CampaignCharacterStateTab
        character={char}
        state={makeCharState({ arc_objective: null })}
        isPresent={true}
        characterNameMap={{ [char.id]: char.name }}
        onOverrideObjective={() => {}}
        isActive={true}
      />
    );
    expect(emptyHtml).toContain("No active arc objective");
    expect(emptyHtml).toContain("Override Arc Objective (GM Mode)");
    expect(emptyHtml).not.toContain("Clear Arc Objective (GM Mode)");
  });

  it("renders Arc Objective lifecycle transition cards and disruption badges in AgentChangesModal", () => {
    const baseState = makeCharState();
    const turn0: TurnNodeRecord = {
      id: "turn_0",
      campaign_id: "camp_1",
      parent_turn_id: null,
      depth_index: 0,
      user_message: "",
      actor_id: "char_kira",
      raw_prose: "Ready.",
      cognition: {
        recall: "",
        feeling: "Alert",
        valence: 0,
        arousal: 0.4,
        want: "Confirm the pilot",
        plan: "Ask about launch window",
        skipped: false,
      },
      pre_turn: {
        user_sentiment: "steady",
        subtext_interpretation: "cautious",
        mentioned_entities: [],
        memory_search_queries: [],
        spatial_intent: "stay",
        mechanics_check: {
          requires_roll: false,
          action_description: "",
          skill_or_approach: "General",
          difficulty_class: 12,
          relevant_modifier: 0,
        },
        active_speaker_id: "char_kira",
        speaker_order: ["char_kira"],
      },
      character_state: baseState,
      character_states: { char_kira: baseState },
      world_snapshot: {
        turn_id: "turn_0",
        world_timestamp: "2088-05-10 21:00",
        active_location_id: "loc_1",
        scene_flags: [],
        parties: [],
      },
      recalled_items: [],
      created_at: "2088-05-10T21:00:00Z",
    };

    const actions: Array<{
      action: "set" | "refine" | "complete" | "abandon";
      label: string;
      disrupted: boolean;
    }> = [
      { action: "set", label: "Set", disrupted: true },
      { action: "refine", label: "Refined", disrupted: false },
      { action: "complete", label: "Completed", disrupted: false },
      { action: "abandon", label: "Abandoned", disrupted: true },
    ];

    for (const tc of actions) {
      const turn1: TurnNodeRecord = {
        ...turn0,
        id: "turn_1",
        parent_turn_id: "turn_0",
        depth_index: 1,
        post_turn: {
          elapsed_minutes: 5,
          transition_type: "stay",
          target_location_id: "loc_1",
          scene_flags_updated: [],
          objective_transitions: {
            char_kira: {
              action: tc.action,
              previous_objective: {
                summary: "Prior Sluice goal",
                deadline_cue: null,
                set_at_turn_depth: 0,
              },
              new_objective:
                tc.action === "complete" || tc.action === "abandon"
                  ? null
                  : {
                      summary: "Reach Sector 8 before blockade",
                      deadline_cue: "at daybreak",
                      set_at_turn_depth: 1,
                    },
              disruption_triggered: tc.disrupted,
            },
          },
          character_names: { char_kira: "Yulia Halim" },
        },
      };

      const html = renderToStaticMarkup(
        <AgentChangesModal
          target={{ turnId: "turn_1", agentKey: "char_kira" }}
          bundle={makeBundle([turn0, turn1], baseState)}
          onClose={() => {}}
        />
      );
      expect(html).toContain("Arc Objective");
      expect(html).toContain(tc.label);
      expect(html).toContain("Prior Sluice goal");
      if (tc.disrupted) {
        expect(html).toContain("Disruption");
      } else {
        expect(html).not.toContain("Disruption");
      }
      if (tc.action === "set" || tc.action === "refine") {
        expect(html).toContain("Reach Sector 8 before blockade");
        expect(html).toContain("at daybreak");
      }
    }
  });

  it("renders Default Arc Objective and Objective Deadline Cue fields in CharacterPersonalityTab", () => {
    const char = makeCharacter();
    const html = renderToStaticMarkup(
      <CharacterPersonalityTab
        data={{
          personality_traits: ["Measured"],
          core_persona: char.core_persona,
          moral_code: [],
          quirks_flaws: [],
          baseline_psyche: char.baseline_psyche,
        }}
        readOnly={false}
        onChange={() => {}}
      />
    );
    expect(html).toContain("Default Arc Objective");
    expect(html).toContain("Objective Deadline Cue");
    expect(html).toContain("Transit the Sluice into Sector 8");
    expect(html).toContain("at daybreak");
  });
});
