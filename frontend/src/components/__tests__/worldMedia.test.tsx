import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  CharacterRecord,
  FirstVisitMediaItem,
  LocationContainer,
  LocationNode,
  TurnNodeRecord,
  WorldMediaItem,
  WorldRecord,
} from "../../types";
import { getCategoryPrimaryImages, getEntityPrimaryImage } from "../../utils/entityImages";
import { ArrivalDescriptionCards } from "../chat/ArrivalDescriptionCards";
import { TurnCard } from "../chat/TurnCard";
import {
  filterAvailableArrivalMedia,
  getArrivalMediaDisplayLabel,
  makeArrivalMediaCardKey,
  stepCarouselIndex,
} from "../chat/arrivalMediaHelpers";
import { MapDetailsDrawer } from "../map/MapDetailsDrawer";
import { WorldInspectorModal } from "../world/WorldInspectorModal";

function makeWorldMedia(): WorldMediaItem[] {
  return [
    {
      id: "wmed_1",
      media_type: "image",
      url: "/api/media/worlds/images/wmed_1.webp",
      label: "Neon Waterfront",
      mime_type: "image/webp",
      byte_size: 4096,
      sort_order: 0,
      created_at: "2026-01-01T00:00:00Z",
    },
    {
      id: "wmed_2",
      media_type: "image",
      url: "/api/media/worlds/images/wmed_2.webp",
      label: "",
      mime_type: "image/webp",
      byte_size: 2048,
      sort_order: 1,
      created_at: "2026-01-01T00:01:00Z",
    },
  ];
}

function makeWorld(media: WorldMediaItem[] = makeWorldMedia()): WorldRecord {
  return {
    id: "world_1",
    name: "Mistport",
    global_rules: {
      genre: "Noir",
      tone: "Moody",
      setting_overview: "Harbor city.",
      tech_or_magic_rules: "Steam.",
      starting_timestamp: "2026-01-01 20:00",
      describe_on_first_visit: true,
    },
    created_at: "2026-01-01T00:00:00Z",
    media,
    containers: [
      {
        id: "cont_1",
        world_id: "world_1",
        depth: 1,
        name: "Old Ward",
        description: "Wet stone alleys.",
        environmental_tags: [],
        image_media_id: media[0]?.id ?? null,
        image_url: media[0]?.url ?? null,
        image_label: media[0]?.label ?? null,
        lore_nodes: [],
      },
    ],
    locations: [
      {
        id: "loc_1",
        world_id: "world_1",
        container_id: "cont_1",
        name: "Anchor Tavern",
        summary: "Harbor bar",
        description: "",
        environmental_tags: [],
        is_starting_location: true,
        is_visited: true,
        image_media_id: media[1]?.id ?? null,
        image_url: media[1]?.url ?? null,
        image_label: media[1]?.label ?? null,
        lore_nodes: [],
      },
      {
        id: "loc_2",
        world_id: "world_1",
        container_id: "cont_1",
        name: "Unvisited Vault",
        summary: "Secret vault",
        description: "Hidden steel door.",
        environmental_tags: [],
        is_starting_location: false,
        is_visited: false,
        image_media_id: media[0]?.id ?? null,
        image_url: media[0]?.url ?? null,
        image_label: media[0]?.label ?? null,
        lore_nodes: [],
      },
    ],
    edges: [],
    lore_nodes: [],
  };
}

describe("World Media UI & Helpers", () => {
  it("resolves primary image from world.media for Home screen carousel", () => {
    const world = makeWorld();
    expect(getEntityPrimaryImage("worlds", world)).toBe("/api/media/worlds/images/wmed_1.webp");
    expect(getCategoryPrimaryImages("worlds", [world, makeWorld([])])).toEqual([
      "/api/media/worlds/images/wmed_1.webp",
    ]);
  });

  it("handles arrival media carousel helpers and label fallback", () => {
    const items: FirstVisitMediaItem[] = [
      {
        entity_type: "container",
        entity_id: "cont_1",
        depth: 1,
        entity_name: "Old Ward",
        media_id: "wmed_1",
        image_url: "/api/media/worlds/images/wmed_1.webp",
        label: "Neon Waterfront",
      },
      {
        entity_type: "location",
        entity_id: "loc_1",
        depth: 0,
        entity_name: "Anchor Tavern",
        media_id: "wmed_2",
        image_url: "/api/media/worlds/images/wmed_2.webp",
        label: "",
      },
    ];
    expect(getArrivalMediaDisplayLabel(items[0])).toBe("Neon Waterfront");
    expect(getArrivalMediaDisplayLabel(items[1])).toBe("Anchor Tavern");
    expect(stepCarouselIndex(0, -1, 2)).toBe(1);
    expect(stepCarouselIndex(1, 1, 2)).toBe(0);
    expect(
      filterAvailableArrivalMedia(items, { "/api/media/worlds/images/wmed_1.webp": true })
    ).toHaveLength(1);
  });

  it("renders single arrival-media carousel card and auto-collapses on next turn", () => {
    const mediaItems: FirstVisitMediaItem[] = [
      {
        entity_type: "container",
        entity_id: "cont_1",
        depth: 1,
        entity_name: "Old Ward",
        media_id: "wmed_1",
        image_url: "/api/media/worlds/images/wmed_1.webp",
        label: "Neon Waterfront",
      },
      {
        entity_type: "location",
        entity_id: "loc_1",
        depth: 0,
        entity_name: "Anchor Tavern",
        media_id: "wmed_2",
        image_url: "/api/media/worlds/images/wmed_2.webp",
        label: "",
      },
    ];

    const expandedHtml = renderToStaticMarkup(
      <ArrivalDescriptionCards
        turnId="turn_0"
        lastTurnId="turn_0"
        cards={[]}
        mediaItems={mediaItems}
        manualOverrides={{}}
        onToggleCard={() => {}}
      />
    );
    expect(expandedHtml).toContain("Arrival Visuals (2)");
    expect(expandedHtml).toContain("1/2");
    expect(expandedHtml).toContain("/api/media/worlds/images/wmed_1.webp");
    expect(expandedHtml).toContain("Previous arrival image");

    const collapsedHtml = renderToStaticMarkup(
      <ArrivalDescriptionCards
        turnId="turn_0"
        lastTurnId="turn_1"
        cards={[]}
        mediaItems={mediaItems}
        manualOverrides={{ [makeArrivalMediaCardKey("turn_0")]: false }}
        onToggleCard={() => {}}
      />
    );
    expect(collapsedHtml).toContain("Arrival Visuals (2)");
    expect(collapsedHtml).not.toContain("/api/media/worlds/images/wmed_1.webp");
  });

  it("renders TurnCard arrival media even when description cards are empty", () => {
    const char: CharacterRecord = {
      id: "char_1",
      name: "Corwin",
      tagline: "Cartographer",
      physical_appearance: "",
      core_persona: "Methodical.",
      initial_message: "Hello.",
      character_bio: "Maps tunnels.",
      voice_anchors: [],
      personality_traits: [],
      moral_code: [],
      quirks_flaws: [],
      communication_style: [],
      equipped: [],
      inventory: [],
      baseline_psyche: {
        mood_label: "Calm",
        valence: 0,
        arousal: 0.2,
        core_drive: "Explore",
        core_fear: "None",
        default_want: "Observe",
        default_plan: "Wait",
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
      id: "turn_0",
      campaign_id: "camp_1",
      parent_turn_id: null,
      depth_index: 0,
      user_message: "[Scene Start]",
      actor_id: "char_1",
      raw_prose: "The rain pours outside.",
      cognition: {
        recall: "",
        feeling: "Calm",
        valence: 0,
        arousal: 0.2,
        want: "",
        plan: "",
        skipped: true,
      },
      pre_turn: {
        user_sentiment: "neutral",
        subtext_interpretation: "",
        mentioned_entities: [],
        memory_search_queries: [],
        spatial_intent: "stay",
        active_speaker_id: "char_1",
        speaker_order: ["char_1"],
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
        turn_id: "turn_0",
        world_timestamp: "2026-01-01 20:00",
        active_location_id: "loc_1",
        scene_flags: [],
      },
      character_state: {
        turn_id: "turn_0",
        character_id: "char_1",
        current_location_id: "loc_1",
        mood_label: "Calm",
        valence: 0,
        arousal: 0.2,
        active_want: "",
        active_plan: "",
        relationship_notes: {},
        equipped: [],
        inventory: [],
      },
      post_turn: {
        elapsed_minutes: 0,
        transition_type: "stay",
        scene_flags_updated: [],
        scene_flags_removed: [],
        inventory_added: [],
        inventory_removed: [],
        character_deltas: {},
        first_visit_cards: [],
        first_visit_media: [
          {
            entity_type: "location",
            entity_id: "loc_1",
            depth: 0,
            entity_name: "Anchor Tavern",
            media_id: "wmed_1",
            image_url: "/api/media/worlds/images/wmed_1.webp",
            label: "Neon Waterfront",
          },
        ],
      },
      created_at: "2026-01-01T00:00:00Z",
    };

    const html = renderToStaticMarkup(
      <TurnCard
        turn={turn}
        turnIdx={0}
        lastTurnId="turn_0"
        bundle={{
          campaign: {
            id: "camp_1",
            name: "Run",
            world_id: "world_1",
            character_id: "char_1",
            active_leaf_turn_id: "turn_0",
            world_settings: { describe_on_first_visit: true },
            created_at: "2026-01-01T00:00:00Z",
          },
          active_branch_turns: [turn],
          all_turn_nodes: [turn],
          current_world_snapshot: turn.world_snapshot,
          current_character_state: turn.character_state,
          character_states: { char_1: turn.character_state },
          character_records: { char_1: char },
          present_character_ids: ["char_1"],
          active_location: makeWorld().locations[0],
          neighbor_locations: [],
          containers: makeWorld().containers,
          visible_locations: makeWorld().locations,
          visible_edges: [],
          episodic_chunks: [],
        }}
        character={char}
        allCampaignCharacters={[char]}
        presentCharacterIds={["char_1"]}
        siblings={[]}
        isBusy={false}
        isDeletingTurn={false}
        isEditingThisTurn={false}
        hasActiveEditingTurn={false}
        hasDeleteLastHandler={false}
        cogOpen={false}
        memOpen={false}
        onStartEdit={() => {}}
        onCancelEdit={() => {}}
        onSwipeRegenerate={() => {}}
        onDeleteLast={() => {}}
        onCheckoutTurn={() => {}}
        onToggleCognition={() => {}}
        onToggleMemories={() => {}}
        arrivalManualOverrides={{}}
        onToggleArrivalCard={() => {}}
        phase4ProgressByTurn={{}}
        onOpenAgentModal={() => {}}
      />
    );
    expect(html).toContain("/api/media/worlds/images/wmed_1.webp");
    expect(html).toContain("Neon Waterfront");
  });

  it("renders WorldInspectorModal Media tab across inspector, wizard, and campaign modes", () => {
    const world = makeWorld();
    const inspectorHtml = renderToStaticMarkup(
      <WorldInspectorModal
        world={world}
        mode="inspector"
        initialTab="media"
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    expect(inspectorHtml).toContain("Upload Image(s)");
    expect(inspectorHtml).toContain("Neon Waterfront");

    const wizardHtml = renderToStaticMarkup(
      <WorldInspectorModal
        world={makeWorld([])}
        mode="wizard"
        initialTab="media"
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    expect(wizardHtml).toContain("Save this world first");
    expect(wizardHtml).not.toContain("Upload Image(s)");

    const campaignHtml = renderToStaticMarkup(
      <WorldInspectorModal
        world={world}
        mode="campaign"
        initialTab="media"
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    expect(campaignHtml).toContain("frozen for this campaign");
    expect(campaignHtml).not.toContain("Upload Image(s)");
  });

  it("enforces editor linking and campaign visited-only / ghost-omitted rules in MapDetailsDrawer", () => {
    const world = makeWorld();
    const visitedLoc: LocationNode = world.locations[0];
    const unvisitedLoc: LocationNode = world.locations[1];
    const cont: LocationContainer = world.containers![0];

    const editorHtml = renderToStaticMarkup(
      <MapDetailsDrawer
        mode="editor"
        selectedLocation={visitedLoc}
        selectedContainer={null}
        containers={world.containers!}
        allLocations={world.locations}
        dynamicPortalIds={new Set()}
        externalPortals={[]}
        containerStats={null}
        depthLabels={{ 1: "Building", 2: "District", 3: "City", 4: "Realm" }}
        worldMedia={world.media}
        onClose={() => {}}
        onPatchLocation={() => {}}
        onPatchContainer={() => {}}
        onResetCoordinates={() => {}}
        onDrillIntoContainer={() => {}}
      />
    );
    expect(editorHtml).toContain("Scene Image (Optional)");
    expect(editorHtml).toContain("Change Image");

    const campaignVisitedHtml = renderToStaticMarkup(
      <MapDetailsDrawer
        mode="campaign"
        selectedLocation={visitedLoc}
        selectedContainer={null}
        containers={world.containers!}
        allLocations={world.locations}
        dynamicPortalIds={new Set()}
        externalPortals={[]}
        containerStats={null}
        depthLabels={{ 1: "Building", 2: "District", 3: "City", 4: "Realm" }}
        worldMedia={world.media}
        visitedContainerIds={["cont_1"]}
        onClose={() => {}}
        onPatchLocation={() => {}}
        onPatchContainer={() => {}}
        onResetCoordinates={() => {}}
        onDrillIntoContainer={() => {}}
      />
    );
    expect(campaignVisitedHtml).toContain("Location Visual");
    expect(campaignVisitedHtml).toContain("/api/media/worlds/images/wmed_2.webp");
    expect(campaignVisitedHtml).not.toContain("Change Image");

    const campaignUnvisitedHtml = renderToStaticMarkup(
      <MapDetailsDrawer
        mode="campaign"
        selectedLocation={unvisitedLoc}
        selectedContainer={null}
        containers={world.containers!}
        allLocations={world.locations}
        dynamicPortalIds={new Set()}
        externalPortals={[]}
        containerStats={null}
        depthLabels={{ 1: "Building", 2: "District", 3: "City", 4: "Realm" }}
        worldMedia={world.media}
        visitedContainerIds={["cont_1"]}
        onClose={() => {}}
        onPatchLocation={() => {}}
        onPatchContainer={() => {}}
        onResetCoordinates={() => {}}
        onDrillIntoContainer={() => {}}
      />
    );
    expect(campaignUnvisitedHtml).not.toContain("Location Visual");

    const campaignVisitedContHtml = renderToStaticMarkup(
      <MapDetailsDrawer
        mode="campaign"
        selectedLocation={null}
        selectedContainer={cont}
        containers={world.containers!}
        allLocations={world.locations}
        dynamicPortalIds={new Set()}
        externalPortals={[]}
        containerStats={null}
        depthLabels={{ 1: "Building", 2: "District", 3: "City", 4: "Realm" }}
        worldMedia={world.media}
        visitedContainerIds={["cont_1"]}
        onClose={() => {}}
        onPatchLocation={() => {}}
        onPatchContainer={() => {}}
        onResetCoordinates={() => {}}
        onDrillIntoContainer={() => {}}
      />
    );
    expect(campaignVisitedContHtml).toContain("/api/media/worlds/images/wmed_1.webp");

    const ghostHtml = renderToStaticMarkup(
      <MapDetailsDrawer
        mode="campaign"
        selectedLocation={null}
        selectedContainer={null}
        selectedGhost={{
          destination: visitedLoc,
          destinationContainerName: "Old Ward",
          connectedPortalIds: [],
        }}
        selectedGhostEdges={[]}
        containers={world.containers!}
        allLocations={world.locations}
        dynamicPortalIds={new Set()}
        externalPortals={[]}
        containerStats={null}
        depthLabels={{ 1: "Building", 2: "District", 3: "City", 4: "Realm" }}
        worldMedia={world.media}
        onClose={() => {}}
        onPatchLocation={() => {}}
        onPatchContainer={() => {}}
        onResetCoordinates={() => {}}
        onDrillIntoContainer={() => {}}
      />
    );
    expect(ghostHtml).not.toContain("<img");
  });
});
