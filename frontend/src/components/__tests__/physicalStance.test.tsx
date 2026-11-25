import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  type CampaignStateBundle,
  type CharacterRecord,
  type CharacterStateSnapshot,
  type LocationNode,
  type PersonaRecord,
  PHYSICAL_STANCE_OPTIONS,
  type TurnNodeRecord,
  type WorldRecord,
  formatPhysicalStateResetLabel,
  formatPhysicalStanceLabel,
  getPhysicalStanceMeta,
  isPhysicalStateEstablished,
} from "../../types";
import { LiveInspector } from "../LiveInspector";
import { AgentChangesModal } from "../inspector/AgentChangesModal";
import { CharacterRow } from "../inspector/CharacterRow";
import { CodexCharacterDetail } from "../world/CodexCharacterDetail";
import { CampaignCharacterStateTab } from "../world/codexCharacter/CampaignCharacterStateTab";
import { getMechanicsArticle } from "../world/mechanics/mechanicsHelpers";

function makeLocation(id = "loc_1", name = "Dockside Cantina"): LocationNode {
  return {
    id,
    world_id: "w_1",
    name,
    summary: "Harbor bar",
    description: "Dim lights and wet concrete.",
    environmental_tags: ["booths", "steel bar"],
    is_starting_location: true,
    lore_nodes: [],
  };
}

function makeWorld(loc: LocationNode): WorldRecord {
  return {
    id: "w_1",
    name: "Iron Harbor",
    global_rules: {
      genre: "Cyberpunk Noir",
      tone: "Gritty",
      setting_overview: "Rainy port city.",
      tech_or_magic_rules: "Low cyberware.",
      starting_timestamp: "2088-05-10 21:00",
    },
    locations: [loc],
    edges: [],
    containers: [],
    lore_nodes: [],
    created_at: "2088-05-10T21:00:00Z",
  };
}

function makeCharacter(id = "char_kira", name = "Kira Vance"): CharacterRecord {
  return {
    id,
    world_id: "w_1",
    version: 1,
    name,
    tagline: "Watchful courier",
    physical_appearance: "Short-cropped hair and weathered coat.",
    core_persona: "Calm under pressure.",
    initial_message: "Ready.",
    baseline_psyche: {
      mood_label: "Composed",
      valence: 0.1,
      arousal: 0.35,
      core_drive: "Protect the ledger",
      core_fear: "Exposure",
      default_want: "Verify contacts",
      default_plan: "Watch exits",
    },
    voice_anchors: [],
    equipped: [],
    inventory: [],
    memory_shards: [],
    tags: [],
    creator: "Test",
    creator_notes: "",
    portraits: {},
    gallery: [],
    created_at: "2088-05-10T21:00:00Z",
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
    valence: 0.1,
    arousal: 0.4,
    active_want: "Stay unseen",
    active_plan: "Keep low",
    relationship_notes: {},
    inventory: [],
    physical_stance: "unspecified",
    physical_context: "",
    ...overrides,
  };
}

function makeTurn(overrides: Partial<TurnNodeRecord> = {}): TurnNodeRecord {
  const st = makeCharState();
  return {
    id: "turn_1",
    campaign_id: "camp_1",
    parent_turn_id: null,
    depth_index: 1,
    user_message: "Drop behind the crate!",
    actor_id: "char_kira",
    raw_prose: "Kira drops flat onto her stomach.",
    cognition: {
      recall: "",
      feeling: "Alert",
      valence: 0.1,
      arousal: 0.4,
      want: "Take cover",
      plan: "Drop flat",
      skipped: false,
    },
    pre_turn: {
      user_sentiment: "urgent",
      subtext_interpretation: "danger",
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
    world_snapshot: {
      turn_id: "turn_1",
      world_timestamp: "2088-05-10 21:05",
      active_location_id: "loc_1",
      scene_flags: [],
      parties: [],
    },
    character_state: st,
    character_states: { char_kira: st },
    recalled_items: [],
    created_at: "2088-05-10T21:05:00Z",
    ...overrides,
  };
}

function makeBundle(opts: {
  persona?: PersonaRecord | null;
  playerStance?: CharacterStateSnapshot["physical_stance"];
  playerContext?: string;
  charState?: CharacterStateSnapshot;
  presentIds?: string[];
  turns?: TurnNodeRecord[];
}): CampaignStateBundle {
  const loc = makeLocation();
  const char = makeCharacter();
  const charState = opts.charState ?? makeCharState();
  const turn = opts.turns?.[opts.turns.length - 1] ?? makeTurn({ character_state: charState, character_states: { [char.id]: charState } });
  const turns = opts.turns ?? [turn];
  return {
    campaign: {
      id: "camp_1",
      name: "Harbor Run",
      world_id: "w_1",
      character_id: char.id,
      participant_character_ids: [char.id],
      active_leaf_turn_id: turn.id,
      created_at: "2088-05-10T21:00:00Z",
      persona_id: opts.persona?.id ?? null,
      persona_snapshot: opts.persona ?? null,
    },
    active_branch_turns: turns,
    all_turn_nodes: turns,
    current_world_snapshot: turn.world_snapshot,
    current_character_state: charState,
    current_persona_turn_state: {
      turn_id: turn.id,
      equipped: [],
      inventory: [],
      physical_stance: opts.playerStance ?? "unspecified",
      physical_context: opts.playerContext ?? "",
    },
    character_states: { [char.id]: charState },
    character_records: { [char.id]: char },
    present_character_ids: opts.presentIds ?? [char.id],
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

describe("Physical Stance Helpers & UI (v0.41.0)", () => {
  it("exposes all 10 canonical stances and helper metadata consistently", () => {
    expect(PHYSICAL_STANCE_OPTIONS).toHaveLength(10);
    expect(getPhysicalStanceMeta("lying_down").label).toBe("Lying Down");
    expect(getPhysicalStanceMeta("restrained").tone).toBe("rose");
    expect(getPhysicalStanceMeta("incapacitated").tone).toBe("rose");
    expect(formatPhysicalStanceLabel("crouching")).toBe("Crouching");
    expect(isPhysicalStateEstablished("unspecified", "")).toBe(false);
    expect(isPhysicalStateEstablished("kneeling", "")).toBe(true);
    expect(formatPhysicalStateResetLabel("location_changed")).toBe("Reset on travel");
    expect(formatPhysicalStateResetLabel("time_skip")).toBe("Reset on time skip");
    expect(getMechanicsArticle("spatial-physical-stance")).toBeDefined();
  });

  it("renders CharacterRow stance pill strictly when present and non-unspecified", () => {
    const char = makeCharacter();
    const presentLying = renderToStaticMarkup(
      <CharacterRow
        character={char}
        state={makeCharState({
          physical_stance: "lying_down",
          physical_context: "on stomach behind bar",
        })}
        isPresent={true}
      />
    );
    expect(presentLying).toContain("char-row-stance-pill");
    expect(presentLying).toContain("Lying Down");
    expect(presentLying).toContain("Lying Down: on stomach behind bar");

    const presentUnspecified = renderToStaticMarkup(
      <CharacterRow
        character={char}
        state={makeCharState({ physical_stance: "unspecified" })}
        isPresent={true}
      />
    );
    expect(presentUnspecified).not.toContain("char-row-stance-pill");

    const elsewhereLying = renderToStaticMarkup(
      <CharacterRow
        character={char}
        state={makeCharState({ physical_stance: "lying_down" })}
        isPresent={false}
        elsewhereLocationName="Alley"
      />
    );
    expect(elsewhereLying).not.toContain("char-row-stance-pill");
  });

  it("renders LiveInspector Here section & Persona card parity with and without Persona (including Solo rooms)", () => {
    const loc = makeLocation();
    const world = makeWorld(loc);
    const char = makeCharacter();

    const persona: PersonaRecord = {
      id: "pers_jax",
      owner_id: "u_1",
      name: "Jax Mercer",
      tagline: "Fixer",
      age_is_secret: false,
      persona_bio: "Always watching exits.",
      portrait_url: "/api/media/personas/pers_jax/portrait.png",
      equipped: [],
      inventory: [],
      lore_entries: [],
      created_at: "2088-05-10T21:00:00Z",
      updated_at: "2088-05-10T21:00:00Z",
    };

    const withPersonaHtml = renderToStaticMarkup(
      <LiveInspector
        bundle={makeBundle({
          persona,
          playerStance: "crouching",
          playerContext: "behind overturned booth",
          charState: makeCharState({ physical_stance: "kneeling" }),
        })}
        world={world}
        character={char}
        onOverridePlayerPhysicalState={() => {}}
        onOpenPersonaInCodex={() => {}}
        onOpenMechanicsHelp={() => {}}
      />
    );
    expect(withPersonaHtml).toContain("Here");
    expect(withPersonaHtml).toContain("Jax Mercer");
    expect(withPersonaHtml).toContain("inspector-you-pill");
    expect(withPersonaHtml).toContain("/api/media/personas/pers_jax/portrait.png");
    expect(withPersonaHtml).toContain("Open Jax Mercer in Codex");
    expect(withPersonaHtml).toContain("Crouching");
    expect(withPersonaHtml).toContain("behind overturned booth");
    expect(withPersonaHtml).toContain("Kneeling");
    // Present badge is suppressed inside Here, and no nested <button> exists inside persona link
    expect(withPersonaHtml).not.toContain("char-row-present");
    const linkStart = withPersonaHtml.indexOf('class="inspector-persona-link"');
    const linkEnd = withPersonaHtml.indexOf("</button>", linkStart);
    expect(linkStart).toBeGreaterThan(-1);
    expect(linkEnd).toBeGreaterThan(linkStart);
    expect(withPersonaHtml.slice(linkStart, linkEnd)).not.toContain("<button");
    expect(withPersonaHtml).toContain("Learn about Physical Stance &amp; Motion Continuity");
    expect(withPersonaHtml).not.toContain("Elsewhere");

    // Persona-less & Solo empty room (presentIds = []) with unspecified stance shows quiet cue + collapsed Elsewhere
    const soloNoPersonaHtml = renderToStaticMarkup(
      <LiveInspector
        bundle={makeBundle({
          persona: null,
          playerStance: "unspecified",
          playerContext: "",
          presentIds: [],
        })}
        world={world}
        character={char}
        participants={[]}
        onOverridePlayerPhysicalState={() => {}}
        onOpenPersonaInCodex={() => {}}
      />
    );
    expect(soloNoPersonaHtml).toContain('char-row-name">You</span>');
    expect(soloNoPersonaHtml).not.toContain("inspector-you-pill");
    expect(soloNoPersonaHtml).not.toContain("inspector-persona-link");
    expect(soloNoPersonaHtml).toContain("Set stance");
    expect(soloNoPersonaHtml).toContain("No other characters here");
    expect(soloNoPersonaHtml).toContain("Elsewhere");
    expect(soloNoPersonaHtml).not.toContain("char-row-absent");
  });

  it("renders Physical State controls inside NPC Current tab and Persona Codex dossier", () => {
    const char = makeCharacter();
    const state = makeCharState({
      physical_stance: "leaning",
      physical_context: "against steel bulkhead",
    });

    const npcCurrentHtml = renderToStaticMarkup(
      <CampaignCharacterStateTab
        character={char}
        state={state}
        isPresent={true}
        characterNameMap={{ [char.id]: char.name }}
        onOverridePhysicalState={() => {}}
        isActive={true}
      />
    );
    expect(npcCurrentHtml).toContain("Physical Stance &amp; Position");
    expect(npcCurrentHtml).toContain("Leaning");
    expect(npcCurrentHtml).toContain("against steel bulkhead");
    expect(npcCurrentHtml).toContain("Override");

    const persona: PersonaRecord = {
      id: "pers_jax",
      owner_id: "u_1",
      name: "Jax Mercer",
      tagline: "Fixer",
      age_is_secret: false,
      persona_bio: "Calm.",
      equipped: [],
      inventory: [],
      lore_entries: [],
      created_at: "2088-05-10T21:00:00Z",
      updated_at: "2088-05-10T21:00:00Z",
    };

    const personaCodexHtml = renderToStaticMarkup(
      <CodexCharacterDetail
        kind="persona"
        persona={persona}
        personaTurnState={{
          turn_id: "turn_1",
          equipped: [],
          inventory: [],
          physical_stance: "lying_down",
          physical_context: "on stomach in vent",
        }}
        loreNodes={[]}
        onJumpToLore={() => {}}
        onOverridePlayerPhysicalState={() => {}}
      />
    );
    expect(personaCodexHtml).toContain("Current Physical State (Live)");
    expect(personaCodexHtml).toContain("Lying Down");
    expect(personaCodexHtml).toContain("on stomach in vent");
  });

  it("renders Player and Character physical state transitions and reset badges in AgentChangesModal", () => {
    const parentTurn = makeTurn({
      id: "turn_0",
      depth_index: 0,
      character_state: makeCharState({
        turn_id: "turn_0",
        physical_stance: "lying_down",
        physical_context: "on stomach",
      }),
      character_states: {
        char_kira: makeCharState({
          turn_id: "turn_0",
          physical_stance: "lying_down",
          physical_context: "on stomach",
        }),
      },
    });
    const childTurn = makeTurn({
      id: "turn_1",
      parent_turn_id: "turn_0",
      depth_index: 1,
      character_state: makeCharState({
        turn_id: "turn_1",
        physical_stance: "standing",
        physical_context: "",
      }),
      character_states: {
        char_kira: makeCharState({
          turn_id: "turn_1",
          physical_stance: "standing",
          physical_context: "",
        }),
      },
      post_turn: {
        elapsed_minutes: 3,
        transition_type: "move_existing",
        target_location_id: "loc_1",
        scene_flags_updated: [],
        previous_player_physical_stance: "kneeling",
        previous_player_physical_context: "behind booth",
        player_physical_stance: "standing",
        player_physical_context: "",
        physical_state_reset_reasons: {
          user: "location_changed",
          char_kira: "location_changed",
        },
        character_deltas: {
          char_kira: {
            mood_label: "Alert",
            valence_delta: 0,
            arousal_delta: 0,
            stance_updates: {},
            items_equipped: [],
            items_unequipped: [],
            items_obtained: [],
            items_removed: [],
            location_transition: "follow_player",
            new_memories: [],
            physical_stance: "standing",
            physical_context: "",
          },
        },
        character_names: { char_kira: "Kira Vance" },
      },
    });

    const bundle = makeBundle({
      turns: [parentTurn, childTurn],
      charState: childTurn.character_state,
    });

    const clerkModalHtml = renderToStaticMarkup(
      <AgentChangesModal
        target={{ turnId: "turn_1", agentKey: "clerk" }}
        bundle={bundle}
        onClose={() => {}}
      />
    );
    expect(clerkModalHtml).toContain("Player Physical State");
    expect(clerkModalHtml).toContain("Kneeling");
    expect(clerkModalHtml).toContain("Standing");
    expect(clerkModalHtml).toContain("Reset on travel");

    const charModalHtml = renderToStaticMarkup(
      <AgentChangesModal
        target={{ turnId: "turn_1", agentKey: "char_kira" }}
        bundle={bundle}
        onClose={() => {}}
      />
    );
    expect(charModalHtml).toContain("Physical Stance &amp; Position");
    expect(charModalHtml).toContain("Lying Down");
    expect(charModalHtml).toContain("Standing");
    expect(charModalHtml).toContain("Reset on travel");
  });
});
