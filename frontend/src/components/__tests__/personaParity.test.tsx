import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  CampaignStateBundle,
  CharacterRecord,
  LocationNode,
  PersonaRecord,
  TurnNodeRecord,
  WorldRecord,
} from "../../types";
import { HomeEntityPickerModal } from "../HomeEntityPickerModal";
import { NewCampaignModal } from "../NewCampaignModal";
import { PersonaEditorModal } from "../PersonaEditorModal";
import { LiveStreamingTurnCard } from "../chat/LiveStreamingTurnCard";
import { TurnCard } from "../chat/TurnCard";

function makePersona(overrides: Partial<PersonaRecord> = {}): PersonaRecord {
  return {
    id: "persona_custom_1",
    owner_id: "user_1",
    name: "Valerie Wells",
    tagline: "Former orbital courier keeping a low profile.",
    species: "Cyborg",
    age: "29",
    age_is_secret: true,
    sex: "Female",
    pronouns: "she/her",
    persona_bio: "Operates out of the neon lower ward.",
    tags: ["courier", "cyborg"],
    build_and_height: "172 cm",
    distinctive_features: ["lean build", "amber optical implant"],
    equipped: [],
    inventory: [],
    lore_entries: [],
    portrait_url: "/api/media/personas/persona_custom_1/portraits/default_abcd.webp",
    gallery: [
      {
        id: "img_1",
        url: "/api/media/personas/persona_custom_1/gallery/img_1.webp",
        caption: "Rain Slicker",
        created_at: "2026-01-01T00:00:00Z",
      },
    ],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeTurnBundle(personaSnapshot: PersonaRecord | null): {
  bundle: CampaignStateBundle;
  world: WorldRecord;
  character: CharacterRecord;
  turn: TurnNodeRecord;
} {
  const loc: LocationNode = {
    id: "loc_1",
    world_id: "world_1",
    is_entry_exit: true,
    name: "Cantina",
    summary: "Smoky lounge.",
    description: "Neon booths.",
    environmental_tags: [],
    is_starting_location: true,
  };
  const world: WorldRecord = {
    id: "world_1",
    name: "Test World",
    global_rules: {
      genre: "Cyberpunk",
      tone: "Gritty",
      setting_overview: "Rainy megacity.",
      tech_or_magic_rules: "Cyberware.",
      starting_timestamp: "2094-11-14 20:00",
    },
    locations: [loc],
    edges: [],
    lore_nodes: [],
    created_at: "2026-01-01T00:00:00Z",
  };
  const character: CharacterRecord = {
    id: "char_1",
    name: "Yulia",
    tagline: "Bartender",
    physical_appearance: "Tall.",
    core_persona: "Observant.",
    initial_message: "What'll it be?",
    character_bio: "Runs the bar.",
    voice_anchors: [],
    equipped: [],
    inventory: [],
    baseline_psyche: {
      mood_label: "Calm",
      valence: 0,
      arousal: 0.3,
      core_drive: "Protect bar",
      core_fear: "Shutdown",
      default_want: "Serve drinks",
      default_plan: "Wipe counter",
    },
    memory_shards: [],
    version: 1,
    tags: [],
    creator: "test",
    creator_notes: "",
    portraits: {},
    gallery: [],
    created_at: "2026-01-01T00:00:00Z",
  };
  const turn: TurnNodeRecord = {
    id: "turn_1",
    campaign_id: "camp_1",
    parent_turn_id: "turn_0",
    depth_index: 1,
    user_message: "I slide a credchip across the counter.",
    actor_id: "char_1",
    raw_prose: "Yulia eyes the chip.",
    cognition: {
      recall: "",
      feeling: "Neutral",
      valence: 0,
      arousal: 0.3,
      want: "Assess offer",
      plan: "Inspect credchip",
    },
    cognitions: {},
    pre_turn: {
      user_sentiment: "calm",
      subtext_interpretation: "Paying for info",
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
    recalled_items: [],
    world_snapshot: {
      turn_id: "turn_1",
      active_location_id: "loc_1",
      visited_location_ids: ["loc_1"],
      visited_container_ids: [],
      scene_flags: [],
      world_timestamp: "Day 1, 20:00",
    },
    character_state: {
      turn_id: "turn_1",
      character_id: "char_1",
      current_location_id: "loc_1",
      mood_label: "Calm",
      valence: 0,
      arousal: 0.3,
      active_want: "Assess offer",
      active_plan: "Inspect credchip",
      relationship_notes: {},
      equipped: [],
      inventory: [],
      unlocked_persona_keys: [],
      persona_knowledge_provenance: {},
    },
    character_states: {},
    created_at: "2026-01-01T00:00:00Z",
  };

  const bundle: CampaignStateBundle = {
    campaign: {
      id: "camp_1",
      name: "Test Campaign",
      world_id: "world_1",
      character_id: "char_1",
      participant_character_ids: ["char_1"],
      persona_id: personaSnapshot?.id ?? null,
      persona_snapshot: personaSnapshot,
      active_leaf_turn_id: "turn_1",
      created_at: "2026-01-01T00:00:00Z",
    },
    character_records: { char_1: character },
    character_states: { char_1: turn.character_state },
    present_character_ids: ["char_1"],
    active_branch_turns: [turn],
    all_turn_nodes: [turn],
    visible_locations: [loc],
    visible_edges: [],
    neighbor_locations: [],
    active_location: loc,
    current_world_snapshot: turn.world_snapshot,
    current_character_state: turn.character_state,
    episodic_chunks: [],
  };

  return { bundle, world, character, turn };
}

describe("Persona-Character Parity (v0.23.0)", () => {
  it("renders Tagline, Height (with metric shortcuts), and Media tab in PersonaEditorModal", () => {
    const persona = makePersona();
    const editHtml = renderToStaticMarkup(
      <PersonaEditorModal
        persona={persona}
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    expect(editHtml).toContain("Tagline (Quick Reference)");
    expect(editHtml).toContain("Former orbital courier keeping a low profile.");
    expect(editHtml).toContain(">Height<");
    expect(editHtml).not.toContain(">Build &amp; Height<");
    expect(editHtml).toContain("180 cm");
    expect(editHtml).toContain("Media");
    expect(editHtml).toContain("Primary Portrait");
    expect(editHtml).toContain("Photo Album (1)");
    expect(editHtml).toContain(persona.portrait_url!);

    // Save-first guard when creating a brand new persona
    const createHtml = renderToStaticMarkup(
      <PersonaEditorModal
        persona={null}
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    expect(createHtml).toContain(
      "Save this persona first to upload a primary portrait or photo album images."
    );
    expect(createHtml).not.toContain("Upload Portrait");

    // Read-only guard on system default 'User' persona
    const defaultHtml = renderToStaticMarkup(
      <PersonaEditorModal
        persona={makePersona({
          id: "persona_default_u1",
          name: "User",
          portrait_url: null,
          gallery: [],
        })}
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    expect(defaultHtml).toContain("is read-only. Clone it as a new persona to attach custom media.");
  });

  it("renders persona portrait to the right of non-cue user prompts in TurnCard and LiveStreamingTurnCard", () => {
    const persona = makePersona();
    const { bundle, character, turn } = makeTurnBundle(persona);

    const turnHtml = renderToStaticMarkup(
      <TurnCard
        turn={turn}
        turnIdx={0}
        bundle={bundle}
        character={character}
        allCampaignCharacters={[character]}
        presentCharacterIds={["char_1"]}
        siblings={[]}
        isBusy={false}
        isDeletingTurn={false}
        isEditingThisTurn={false}
        hasActiveEditingTurn={false}
        hasDeleteLastHandler={false}
        cogOpen={false}
        memOpen={false}
        phase4ProgressByTurn={{}}
        onToggleCognition={() => {}}
        onToggleMemories={() => {}}
        onCheckoutTurn={() => {}}
        onStartEdit={() => {}}
        onCancelEdit={() => {}}
        onSwipeRegenerate={() => {}}
        onDeleteLast={() => {}}
        onOpenAgentModal={() => {}}
      />
    );
    expect(turnHtml).toContain("user-prompt-row");
    expect(turnHtml).toContain("user-prompt-avatar");
    expect(turnHtml).toContain(persona.portrait_url!);

    // Director / OOC cue bubbles omit persona portrait
    const cueTurnHtml = renderToStaticMarkup(
      <TurnCard
        turn={{ ...turn, user_message: "[Advance the story by 30 minutes]" }}
        turnIdx={0}
        bundle={bundle}
        character={character}
        allCampaignCharacters={[character]}
        presentCharacterIds={["char_1"]}
        siblings={[]}
        isBusy={false}
        isDeletingTurn={false}
        isEditingThisTurn={false}
        hasActiveEditingTurn={false}
        hasDeleteLastHandler={false}
        cogOpen={false}
        memOpen={false}
        phase4ProgressByTurn={{}}
        onToggleCognition={() => {}}
        onToggleMemories={() => {}}
        onCheckoutTurn={() => {}}
        onStartEdit={() => {}}
        onCancelEdit={() => {}}
        onSwipeRegenerate={() => {}}
        onDeleteLast={() => {}}
        onOpenAgentModal={() => {}}
      />
    );
    expect(cueTurnHtml).not.toContain("user-prompt-avatar");

    // Portrait-less persona omits avatar cleanly
    const noPortraitBundle = makeTurnBundle(makePersona({ portrait_url: null })).bundle;
    const noPortraitHtml = renderToStaticMarkup(
      <TurnCard
        turn={turn}
        turnIdx={0}
        bundle={noPortraitBundle}
        character={character}
        allCampaignCharacters={[character]}
        presentCharacterIds={["char_1"]}
        siblings={[]}
        isBusy={false}
        isDeletingTurn={false}
        isEditingThisTurn={false}
        hasActiveEditingTurn={false}
        hasDeleteLastHandler={false}
        cogOpen={false}
        memOpen={false}
        phase4ProgressByTurn={{}}
        onToggleCognition={() => {}}
        onToggleMemories={() => {}}
        onCheckoutTurn={() => {}}
        onStartEdit={() => {}}
        onCancelEdit={() => {}}
        onSwipeRegenerate={() => {}}
        onDeleteLast={() => {}}
        onOpenAgentModal={() => {}}
      />
    );
    expect(noPortraitHtml).not.toContain("user-prompt-avatar");

    // LiveStreamingTurnCard matches TurnCard
    const liveHtml = renderToStaticMarkup(
      <LiveStreamingTurnCard
        liveStream={{
          userMessage: "I check the terminal.",
          phaseStatus: "Streaming...",
          cognitionRaw: "",
          cognitionParsed: null,
          recalledItems: [],
          proseText: "",
          preTurn: null,
        }}
        bundle={bundle}
        character={character}
        allCampaignCharacters={[character]}
        presentCharacterIds={["char_1"]}
        phase3Progress={null}
      />
    );
    expect(liveHtml).toContain("user-prompt-row");
    expect(liveHtml).toContain(persona.portrait_url!);
  });

  it("displays persona tagline and portrait in HomeEntityPickerModal and NewCampaignModal", () => {
    const persona = makePersona();
    const { bundle, world, character } = makeTurnBundle(persona);

    const pickerHtml = renderToStaticMarkup(
      <HomeEntityPickerModal
        category="personas"
        personas={[persona]}
        characters={[character]}
        worlds={[world]}
        campaigns={[bundle.campaign]}
        activePersonaId={persona.id}
        onClose={() => {}}
        onSelectPersona={() => {}}
        onSelectCharacter={() => {}}
        onSelectWorld={() => {}}
        onSelectCampaign={() => {}}
        onNewClick={() => {}}
      />
    );
    expect(pickerHtml).toContain(persona.tagline!);
    expect(pickerHtml).toContain(persona.portrait_url!);

    const newCampHtml = renderToStaticMarkup(
      <NewCampaignModal
        worlds={[world]}
        characters={[character]}
        personas={[persona]}
        initialPersonaId={persona.id}
        onClose={() => {}}
        onCreate={async () => {}}
      />
    );
    expect(newCampHtml).toContain(persona.tagline!);
    expect(newCampHtml).toContain(persona.portrait_url!);
  });
});
