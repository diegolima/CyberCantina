import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  CampaignStateBundle,
  CharacterRecord,
  LocationContainer,
  LocationNode,
  TurnNodeRecord,
  WorldRecord,
} from "../../types";
import { ArrivalDescriptionCards } from "../chat/ArrivalDescriptionCards";
import { StandaloneArrivalCard } from "../chat/StandaloneArrivalCard";
import { TurnCard } from "../chat/TurnCard";
import {
  buildArrivalHeaderSummary,
  getArrivalScopeLabel,
  getLatestBranchTurnId,
  isArrivalCardExpanded,
  isArrivalInnerItemExpanded,
  makeArrivalCardKey,
  makeArrivalGroupKey,
} from "../chat/arrivalHelpers";
import { WorldInspectorModal } from "../world/WorldInspectorModal";

function makeFixtureBundle() {
  const containers: LocationContainer[] = [
    {
      id: "cont_ward",
      world_id: "world_1",
      depth: 2,
      name: "Old Ward",
      description: "Fog curls along wet flagstones.",
      environmental_tags: [],
      lore_nodes: [],
    },
  ];
  const loc: LocationNode = {
    id: "loc_1",
    world_id: "world_1",
    container_id: "cont_ward",
    is_entry_exit: true,
    name: "Anchor Tavern",
    summary: "Harbor tavern.",
    description: "Salt-crusted timbers creak above lantern-lit tables.",
    environmental_tags: [],
    is_starting_location: true,
  };
  const world: WorldRecord = {
    id: "world_1",
    name: "Mistport",
    global_rules: {
      genre: "Gothic Steampunk",
      tone: "Atmospheric",
      setting_overview: "Harbor city.",
      tech_or_magic_rules: "Clockwork.",
      starting_timestamp: "1899-11-16 20:00",
      describe_on_first_visit: true,
    },
    created_at: "2026-01-01T00:00:00Z",
    containers,
    locations: [loc],
    edges: [],
    lore_nodes: [],
  };
  const char: CharacterRecord = {
    id: "char_1",
    name: "Corwin",
    tagline: "Cartographer",
    physical_appearance: "Weathered coat, ink-stained fingers.",
    core_persona: "Methodical cartographer.",
    initial_message: "Pull up a stool.",
    character_bio: "Maps tunnels.",
    voice_anchors: [],
    personality_traits: [],
    moral_code: [],
    quirks_flaws: [],
    communication_style: [],
    equipped: [],
    inventory: [],
    baseline_psyche: {
      mood_label: "Alert",
      valence: 0,
      arousal: 0.4,
      core_drive: "Map Mistport",
      core_fear: "Drowning",
      default_want: "Chart the docks",
      default_plan: "Explore",
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
  const turn1: TurnNodeRecord = {
    id: "turn_1",
    campaign_id: "camp_1",
    parent_turn_id: "turn_0",
    depth_index: 1,
    user_message: "Step into the tavern.",
    actor_id: char.id,
    raw_prose: "The door swings inward.",
    cognition: {
      recall: "Docks",
      feeling: "Curious",
      valence: 0.1,
      arousal: 0.4,
      want: "Look around",
      plan: "Inspect tables",
    },
    pre_turn: {
      user_sentiment: "curious",
      subtext_interpretation: "",
      mentioned_entities: [],
      memory_search_queries: [],
      spatial_intent: "move_known",
      active_speaker_id: char.id,
      speaker_order: [char.id],
      mechanics_check: {
        requires_roll: false,
        action_description: "",
        skill_or_approach: "",
        difficulty_class: 10,
        relevant_modifier: 0,
      },
    },
    post_turn: {
      elapsed_minutes: 2,
      transition_type: "move_existing",
      scene_flags_updated: [],
      first_visit_cards: [
        {
          entity_type: "container",
          entity_id: "cont_ward",
          depth: 2,
          title: "Old Ward",
          description: "Fog curls along wet flagstones.",
        },
        {
          entity_type: "location",
          entity_id: "loc_1",
          depth: 0,
          title: "Anchor Tavern",
          description: "Salt-crusted timbers creak above lantern-lit tables.",
        },
      ],
    },
    world_snapshot: {
      turn_id: "turn_1",
      world_timestamp: "1899-11-16 20:02",
      active_location_id: "loc_1",
      scene_flags: [],
      visited_location_ids: ["loc_1"],
      visited_container_ids: ["cont_ward"],
    },
    character_state: {
      turn_id: "turn_1",
      character_id: char.id,
      current_location_id: "loc_1",
      mood_label: "Curious",
      valence: 0.1,
      arousal: 0.4,
      active_want: "Look around",
      active_plan: "Inspect tables",
      relationship_notes: {},
      equipped: [],
      inventory: [],
    },
    recalled_items: [],
    created_at: "2026-01-01T00:02:00Z",
  };
  const arrivalTurn: TurnNodeRecord = {
    ...turn1,
    id: "turn_2",
    parent_turn_id: "turn_1",
    depth_index: 2,
    user_message: "",
    actor_id: "__arrival__",
    raw_prose: "",
    cognition: {
      recall: "",
      feeling: "",
      valence: 0,
      arousal: 0,
      want: "",
      plan: "",
      skipped: true,
    },
    post_turn: {
      elapsed_minutes: 0,
      transition_type: "move_existing",
      scene_flags_updated: [],
      first_visit_cards: [
        {
          entity_type: "location",
          entity_id: "loc_1",
          depth: 0,
          title: "Anchor Tavern",
          description: "Salt-crusted timbers creak above lantern-lit tables.",
        },
      ],
    },
  };
  const bundle: CampaignStateBundle = {
    campaign: {
      id: "camp_1",
      name: "Mistport Run",
      world_id: world.id,
      character_id: char.id,
      participant_character_ids: [char.id],
      active_leaf_turn_id: turn1.id,
      world_settings: { describe_on_first_visit: true },
      created_at: "2026-01-01T00:00:00Z",
    },
    active_branch_turns: [turn1],
    all_turn_nodes: [turn1],
    current_world_snapshot: turn1.world_snapshot,
    current_character_state: turn1.character_state,
    character_states: { [char.id]: turn1.character_state },
    character_records: { [char.id]: char },
    present_character_ids: [char.id],
    containers,
    active_location: loc,
    neighbor_locations: [],
    visible_locations: [loc],
    visible_edges: [],
    episodic_chunks: [],
  };

  return { world, char, turn1, arrivalTurn, bundle };
}

describe("First-Visit Arrival Descriptions & World Settings (v0.11.6 + v0.19.1)", () => {
  it("expands only latest turn outer arrival card by default, keeps inner items open by default, and summarizes headers cleanly", () => {
    const g1 = makeArrivalGroupKey("turn_1");
    const k1 = makeArrivalCardKey("turn_1", "container", "cont_ward");
    expect(
      isArrivalCardExpanded({
        turnId: "turn_1",
        lastTurnId: "turn_1",
        cardKey: g1,
        manualOverrides: {},
      })
    ).toBe(true);

    // Next turn arrives -> turn_1 outer group defaults collapsed
    expect(
      isArrivalCardExpanded({
        turnId: "turn_1",
        lastTurnId: "turn_2",
        cardKey: g1,
        manualOverrides: {},
      })
    ).toBe(false);

    // Manual override re-expands older outer group
    expect(
      isArrivalCardExpanded({
        turnId: "turn_1",
        lastTurnId: "turn_2",
        cardKey: g1,
        manualOverrides: { [g1]: true },
      })
    ).toBe(true);

    // Inner items default to expanded when outer card is open, unless explicitly collapsed
    expect(isArrivalInnerItemExpanded({ cardKey: k1, manualOverrides: {} })).toBe(true);
    expect(
      isArrivalInnerItemExpanded({ cardKey: k1, manualOverrides: { [k1]: false } })
    ).toBe(false);

    expect(getLatestBranchTurnId([])).toBeUndefined();
    expect(getArrivalScopeLabel("location", 0)).toBe("Location");
    expect(getArrivalScopeLabel("container", 2)).toBe("L2 Area");
    expect(getArrivalScopeLabel("container", 0)).toBe("Area");

    const { turn1 } = makeFixtureBundle();
    const multiSummary = buildArrivalHeaderSummary({
      cards: turn1.post_turn!.first_visit_cards!,
      visibleMedia: [],
      slideIdx: 0,
    });
    expect(multiSummary).toEqual({
      title: "Old Ward › Anchor Tavern",
      badgeText: "2 cards",
      iconKind: "compass",
    });

    const singleSummary = buildArrivalHeaderSummary({
      cards: [turn1.post_turn!.first_visit_cards![1]],
      visibleMedia: [],
      slideIdx: 0,
    });
    expect(singleSummary).toEqual({
      title: "Anchor Tavern",
      badgeText: "Location",
      iconKind: "location",
    });
  });

  it("renders Turn 0 standalone arrival before prose, Clerk standalone arrival after Turn N footer, and deduplicates 1-item headers", () => {
    const { char, turn1, arrivalTurn, bundle } = makeFixtureBundle();
    const attachedCards = turn1.post_turn!.first_visit_cards!;

    // Outer card expands on latest turn and collapses to 1 summary bar on subsequent turns
    const standaloneExpandedHtml = renderToStaticMarkup(
      <StandaloneArrivalCard
        turnId="turn_1"
        lastTurnId="turn_1"
        worldTimestamp="1899-11-16 20:02"
        source="clerk"
        turnDepthIndex={1}
        cards={attachedCards}
        manualOverrides={{}}
        onToggleCard={() => {}}
      />
    );
    expect(standaloneExpandedHtml).toContain("Old Ward › Anchor Tavern");
    expect(standaloneExpandedHtml).toContain("Fog curls along wet flagstones.");
    expect(standaloneExpandedHtml).toContain("Salt-crusted timbers creak above lantern-lit tables.");
    expect(standaloneExpandedHtml).toContain('aria-expanded="true"');

    const standaloneCollapsedHtml = renderToStaticMarkup(
      <StandaloneArrivalCard
        turnId="turn_1"
        lastTurnId="turn_99"
        worldTimestamp="1899-11-16 20:02"
        source="clerk"
        turnDepthIndex={1}
        cards={attachedCards}
        manualOverrides={{}}
        onToggleCard={() => {}}
      />
    );
    expect(standaloneCollapsedHtml).toContain('aria-expanded="false"');
    expect(standaloneCollapsedHtml).toContain("Old Ward › Anchor Tavern");
    expect(standaloneCollapsedHtml).toContain("2 cards");
    expect(standaloneCollapsedHtml).not.toContain("Fog curls along wet flagstones.");

    // Individual inner element can still be collapsed while outer card remains open
    const kCont = makeArrivalCardKey("turn_1", "container", "cont_ward");
    const innerCollapsedHtml = renderToStaticMarkup(
      <ArrivalDescriptionCards
        turnId="turn_1"
        lastTurnId="turn_1"
        cards={attachedCards}
        manualOverrides={{ [kCont]: false }}
        onToggleCard={() => {}}
      />
    );
    expect(innerCollapsedHtml).not.toContain("Fog curls along wet flagstones.");
    expect(innerCollapsedHtml).toContain("Salt-crusted timbers creak above lantern-lit tables.");

    // Turn 0 renders standalone arrival card BEFORE opening prose (and auto-collapses once Turn 1 exists)
    const turn0: TurnNodeRecord = {
      ...turn1,
      id: "turn_0",
      parent_turn_id: null,
      depth_index: 0,
      user_message: "[Scene Start]",
      raw_prose: "Lanterns sway over the wet cobblestones.",
    };
    const turn0Bundle: CampaignStateBundle = {
      ...bundle,
      active_branch_turns: [turn0],
      all_turn_nodes: [turn0],
    };
    const turn0Html = renderToStaticMarkup(
      <TurnCard
        turn={turn0}
        turnIdx={0}
        bundle={turn0Bundle}
        character={char}
        allCampaignCharacters={[char]}
        presentCharacterIds={[char.id]}
        siblings={[]}
        isBusy={false}
        isDeletingTurn={false}
        isEditingThisTurn={false}
        hasActiveEditingTurn={false}
        hasDeleteLastHandler={true}
        cogOpen={false}
        memOpen={false}
        phase4ProgressByTurn={{}}
        lastTurnId="turn_0"
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
    expect(turn0Html).not.toContain("arrival-cards-panel");
    expect(turn0Html).toContain("arrival-turn-card");
    expect(turn0Html).toContain("Scene Opening");
    expect(turn0Html.indexOf("arrival-turn-card")).toBeLessThan(
      turn0Html.indexOf("Lanterns sway over the wet cobblestones.")
    );

    // Clerk-attached Turn N renders standalone arrival AFTER Turn N footer and retains Edit, Swipe, Delete
    const clerkTurnHtml = renderToStaticMarkup(
      <TurnCard
        turn={turn1}
        turnIdx={0}
        bundle={bundle}
        character={char}
        allCampaignCharacters={[char]}
        presentCharacterIds={[char.id]}
        siblings={[]}
        isBusy={false}
        isDeletingTurn={false}
        isEditingThisTurn={false}
        hasActiveEditingTurn={false}
        hasDeleteLastHandler={true}
        cogOpen={false}
        memOpen={false}
        phase4ProgressByTurn={{}}
        lastTurnId="turn_1"
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
    expect(clerkTurnHtml).not.toContain("arrival-cards-panel");
    expect(clerkTurnHtml).toContain("arrival-turn-card");
    expect(clerkTurnHtml).toContain("Arrived via Turn #1");
    expect(clerkTurnHtml).toContain("Old Ward");
    expect(clerkTurnHtml).toContain("Edit");
    expect(clerkTurnHtml).toContain("Swipe");
    expect(clerkTurnHtml.indexOf("arrival-turn-card")).toBeGreaterThan(
      clerkTurnHtml.indexOf("Delete")
    );

    // Standalone map-move arrival turn (1 item) omits redundant inner toggle header, keeps sibling Undo, omits Swipe
    const arrivalBundle: CampaignStateBundle = {
      ...bundle,
      active_branch_turns: [turn1, arrivalTurn],
      all_turn_nodes: [turn1, arrivalTurn],
    };
    const standaloneHtml = renderToStaticMarkup(
      <TurnCard
        turn={arrivalTurn}
        turnIdx={1}
        bundle={arrivalBundle}
        character={char}
        allCampaignCharacters={[char]}
        presentCharacterIds={[char.id]}
        siblings={[]}
        isBusy={false}
        isDeletingTurn={false}
        isEditingThisTurn={false}
        hasActiveEditingTurn={false}
        hasDeleteLastHandler={true}
        cogOpen={false}
        memOpen={false}
        phase4ProgressByTurn={{}}
        lastTurnId="turn_2"
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
    expect(standaloneHtml).toContain("arrival-turn-card");
    expect(standaloneHtml).toContain("Map Move");
    expect(standaloneHtml).toContain("Anchor Tavern");
    expect(standaloneHtml).toContain("arrival-card-body--bare");
    expect(standaloneHtml).not.toContain("arrival-card-header");
    expect(standaloneHtml).toContain("Undo");
    expect(standaloneHtml).not.toContain("Delete");
    expect(standaloneHtml).not.toContain("Swipe");
  });

  it("renders World Settings tab with Describe on First Visit toggle in both Editor and Campaign modes", () => {
    const { world } = makeFixtureBundle();

    const editorHtml = renderToStaticMarkup(
      <WorldInspectorModal
        world={world}
        mode="inspector"
        initialTab="settings"
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    expect(editorHtml).toContain("World Settings");
    expect(editorHtml).toContain("Describe on First Visit");
    expect(editorHtml).toContain("Default world settings inherited when launching new campaigns");

    const campaignHtml = renderToStaticMarkup(
      <WorldInspectorModal
        world={world}
        mode="campaign"
        initialTab="settings"
        campaignWorldSettings={{ describe_on_first_visit: false }}
        onSaveCampaignWorldSettings={() => {}}
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    expect(campaignHtml).toContain("World Settings");
    expect(campaignHtml).toContain("Describe on First Visit");
    expect(campaignHtml).toContain("starting from future arrivals");
  });
});
