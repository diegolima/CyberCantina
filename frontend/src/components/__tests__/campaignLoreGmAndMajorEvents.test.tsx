import ReactDOMServer from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  CampaignStateBundle,
  LocationContainer,
  LocationNode,
  LoreNode,
  TurnNodeRecord,
  WorldRecord,
} from "../../types";
import { MapDetailsDrawer } from "../map/MapDetailsDrawer";
import { MapLoreSection } from "../map/MapLoreSection";
import { StoryModal } from "../story/StoryModal";
import { buildStoryMajorEvents } from "../story/storyMajorEvents";
import { CodexLocationDetail } from "../world/CodexLocationDetail";
import {
  getVisibleScopedLore,
  isSecretLoreRevealed,
  searchAllCodexEntries,
} from "../world/codexHelpers";
import { WorldInspectorModal } from "../world/WorldInspectorModal";

const noop = () => {};

function makeFixture() {
  const secretLore: LoreNode = {
    id: "loc_sec_1",
    world_id: "w1",
    location_id: "loc1",
    title: "Hidden Smuggler Hatch",
    category: "secret",
    content: "Under the cellar rug is a tunnel to the harbor.",
    entity_tags: ["smuggler hatch", "harbor"],
  };
  const editedSecretLore: LoreNode = {
    ...secretLore,
    id: "loc_sec_1_v2",
    origin_lore_id: "loc_sec_1",
    title: "Hidden Smuggler Hatch (Edited)",
  };
  const publicLore: LoreNode = {
    id: "loc_pub_1",
    world_id: "w1",
    location_id: "loc1",
    title: "Dockworker Tavern Rumor",
    category: "rumor",
    content: "Sailors gamble here every Friday.",
    entity_tags: ["sailors", "tavern"],
  };
  const container: LocationContainer = {
    id: "c1",
    world_id: "w1",
    depth: 1,
    name: "Harbor Quarter",
    description: "Salty brick tenements.",
    environmental_tags: ["fog"],
    lore_nodes: [
      {
        id: "cont_sec_1",
        world_id: "w1",
        container_id: "c1",
        title: "Guild Cipher",
        category: "secret",
        content: "The lantern code signals smugglers.",
        entity_tags: ["lantern code"],
      },
    ],
  };
  const loc: LocationNode = {
    id: "loc1",
    world_id: "w1",
    container_id: "c1",
    name: "Sunstone Plaza",
    summary: "Wide cobblestone plaza.",
    description: "Cobblestones ringed by arcades.",
    environmental_tags: ["cobblestone"],
    is_starting_location: true,
    is_hub: true,
    is_visited: true,
    lore_nodes: [publicLore, secretLore],
  };
  const worldLore: LoreNode[] = [
    {
      id: "wl_1",
      world_id: "w1",
      title: "Iron Pact",
      category: "history",
      content: "Ancient treaty.",
      entity_tags: ["treaty"],
    },
    {
      id: "wl_me_1",
      world_id: "w1",
      campaign_id: "camp1",
      created_at_turn_id: "t1",
      is_major_event: true,
      title: "1420-05-10 - Fall of the Usurper",
      category: "history",
      content: "At Sunstone Plaza, Kira and the player deposed the usurper.",
      entity_tags: ["Usurper", "Kira", "Sunstone Plaza"],
    },
  ];
  const world: WorldRecord = {
    id: "w1",
    name: "Ashen Kingdom",
    global_rules: {
      genre: "Fantasy",
      tone: "Grim",
      setting_overview: "A fractured realm.",
      tech_or_magic_rules: "Runes",
      starting_timestamp: "1420-05-10 09:00",
      describe_on_first_visit: true,
    },
    created_at: "2026-11-23T00:00:00Z",
    containers: [container],
    locations: [loc],
    edges: [],
    lore_nodes: worldLore,
  };

  const makeTurn = (
    id: string,
    depth: number,
    parentId: string | null,
    postTurn?: TurnNodeRecord["post_turn"]
  ): TurnNodeRecord => ({
    id,
    campaign_id: "camp1",
    parent_turn_id: parentId,
    depth_index: depth,
    user_message: `Action ${depth}`,
    actor_id: "char1",
    raw_prose: `Prose ${depth}`,
    cognition: {
      recall: "",
      feeling: "Steady",
      want: "Observe",
      plan: "Wait",
      valence: 0,
      arousal: 0.3,
    },
    pre_turn: {
      user_sentiment: "neutral",
      subtext_interpretation: "",
      spatial_intent: "stay",
      mentioned_entities: [],
      memory_search_queries: [],
      mechanics_check: {
        requires_roll: false,
        action_description: "",
        skill_or_approach: "",
        difficulty_class: 10,
        relevant_modifier: 0,
      },
    },
    post_turn: postTurn ?? null,
    world_snapshot: {
      turn_id: id,
      world_timestamp: "1420-05-10 10:00",
      active_location_id: "loc1",
      scene_flags: [],
      visited_location_ids: ["loc1"],
      visited_container_ids: ["c1"],
      revealed_lore_ids: [],
    },
    character_state: {
      turn_id: id,
      character_id: "char1",
      current_location_id: "loc1",
      mood_label: "Steady",
      valence: 0,
      arousal: 0.3,
      active_want: "Observe",
      active_plan: "Wait",
      relationship_notes: {},
      inventory: [],
    },
    recalled_items: [],
    created_at: `2026-11-23T00:0${depth}:00Z`,
  });

  const t0 = makeTurn("t0", 0, null);
  const t1 = makeTurn("t1", 1, "t0", {
    elapsed_minutes: 10,
    transition_type: "stay",
    scene_flags_updated: [],
    major_event: {
      id: "me_t1",
      turn_id: "t1",
      scope: "world",
      date_label: "1420-05-10",
      title: "1420-05-10 - Fall of the Usurper",
      summary: "At Sunstone Plaza, Kira and the player deposed the usurper.",
      keywords: ["Usurper", "Kira", "Sunstone Plaza"],
      lore_node_id: "wl_me_1",
      location_id: "loc1",
      location_name: "Sunstone Plaza",
    },
  });
  const t2 = makeTurn("t2", 2, "t1", {
    elapsed_minutes: 60,
    transition_type: "stay",
    scene_flags_updated: [],
    major_event: {
      id: "me_t2",
      turn_id: "t2",
      scope: "location",
      date_label: "1420-05-10",
      title: "1420-05-10 - Bronze Statue Raised",
      summary: "A giant bronze statue was raised in Sunstone Plaza.",
      keywords: ["statue", "Sunstone Plaza"],
      location_id: "loc1",
      location_name: "Sunstone Plaza",
      previous_description: "Cobblestones ringed by arcades.",
      updated_description: "Cobblestones ringed by arcades, centered on a giant bronze statue.",
      tags_added: ["monument"],
      tags_removed: ["empty"],
    },
  });

  const makeBundle = (unlockLore: boolean): CampaignStateBundle => ({
    campaign: {
      id: "camp1",
      name: "Ashen Run",
      world_id: "w1",
      character_id: "char1",
      active_leaf_turn_id: "t2",
      world_settings: { describe_on_first_visit: true, unlock_lore: unlockLore },
      created_at: "2026-11-23T00:00:00Z",
    },
    active_branch_turns: [t0, t1, t2],
    all_turn_nodes: [t0, t1, t2],
    current_world_snapshot: t2.world_snapshot,
    current_character_state: t2.character_state,
    active_location: loc,
    neighbor_locations: [],
    visible_locations: [loc],
    visible_edges: [],
    containers: [container],
    world_lore_nodes: worldLore,
    episodic_chunks: [],
  });

  return { world, loc, container, secretLore, editedSecretLore, publicLore, makeBundle };
}

describe("Campaign Lore GM Mode, Secret Discovery & Major Events (v0.31.0)", () => {
  it("renders Unlock Lore & Secrets (GM Mode) greyed out in World Edit mode and interactive with branch tip in Campaign mode", () => {
    const { world } = makeFixture();
    const editHtml = ReactDOMServer.renderToStaticMarkup(
      <WorldInspectorModal
        world={world}
        mode="inspector"
        initialTab="settings"
        onClose={noop}
        onSaved={noop}
      />
    );
    expect(editHtml).toContain("Unlock Lore &amp; Secrets (GM Mode)");
    expect(editHtml).toContain("Campaign-only GM override");

    const campOffHtml = ReactDOMServer.renderToStaticMarkup(
      <WorldInspectorModal
        world={world}
        mode="campaign"
        initialTab="settings"
        campaignWorldSettings={{ describe_on_first_visit: true, unlock_lore: false }}
        onClose={noop}
        onSaved={noop}
      />
    );
    expect(campOffHtml).toContain("Unlock Lore &amp; Secrets (GM Mode)");
    expect(campOffHtml).toContain("branching from Turn 4 after editing at Turn 8");
    expect(campOffHtml).not.toContain("GM Mode Active");

    const campOnHtml = ReactDOMServer.renderToStaticMarkup(
      <WorldInspectorModal
        world={world}
        mode="campaign"
        initialTab="settings"
        campaignWorldSettings={{ describe_on_first_visit: true, unlock_lore: true }}
        onClose={noop}
        onSaved={noop}
      />
    );
    expect(campOnHtml).toContain("GM Mode Active");
  });

  it("enforces uniform secret visibility & canonical origin_lore_id across Codex helpers, CodexLocationDetail, and MapLoreSection", () => {
    const { world, loc, container, secretLore, editedSecretLore } = makeFixture();

    // Unrevealed secret hidden when GM Mode OFF
    expect(
      getVisibleScopedLore(loc.lore_nodes, true, { unlockLore: false, revealedLoreIds: [] }).map(
        (l) => l.id
      )
    ).toEqual(["loc_pub_1"]);

    // Revealed secret visible when GM Mode OFF; canonical origin_lore_id survives CoW edit
    expect(isSecretLoreRevealed(editedSecretLore, ["loc_sec_1"])).toBe(true);
    expect(
      getVisibleScopedLore([editedSecretLore], true, {
        unlockLore: false,
        revealedLoreIds: ["loc_sec_1"],
      })
    ).toHaveLength(1);

    // Search hides unrevealed secrets when GM Mode OFF, exposes when GM Mode ON or revealed
    expect(
      searchAllCodexEntries({
        loreNodes: world.lore_nodes,
        containers: [container],
        locations: [loc],
        query: "smuggler hatch",
        isCampaignMode: true,
        unlockLore: false,
        revealedLoreIds: [],
      })
    ).toHaveLength(0);
    expect(
      searchAllCodexEntries({
        loreNodes: world.lore_nodes,
        containers: [container],
        locations: [loc],
        query: "smuggler hatch",
        isCampaignMode: true,
        unlockLore: true,
        revealedLoreIds: [],
      })
    ).toHaveLength(1);

    // MapLoreSection hides unrevealed secret and Add/Edit controls when GM Mode OFF
    const mapLoreLockedHtml = ReactDOMServer.renderToStaticMarkup(
      <MapLoreSection
        mode="campaign"
        isMutatingLocked={false}
        targetId={loc.id}
        targetName={loc.name}
        worldId={world.id}
        scopeLabel="Location Lore & Secrets"
        emptyText="None"
        loreList={loc.lore_nodes ?? []}
        canEditDraftLore={false}
        savedInDb
        unlockLore={false}
        revealedLoreIds={[]}
        onCampaignSave={noop}
        onToggleLoreReveal={noop}
      />
    );
    expect(mapLoreLockedHtml).toContain("Dockworker Tavern Rumor");
    expect(mapLoreLockedHtml).not.toContain("Hidden Smuggler Hatch");
    expect(mapLoreLockedHtml).not.toContain("Add Lore");

    // MapLoreSection reveals secret + Mark Revealed / Edit controls when GM Mode ON
    const mapLoreGmHtml = ReactDOMServer.renderToStaticMarkup(
      <MapLoreSection
        mode="campaign"
        isMutatingLocked={false}
        targetId={loc.id}
        targetName={loc.name}
        worldId={world.id}
        scopeLabel="Location Lore & Secrets"
        emptyText="None"
        loreList={loc.lore_nodes ?? []}
        canEditDraftLore={false}
        savedInDb
        unlockLore
        revealedLoreIds={[]}
        onCampaignSave={noop}
        onToggleLoreReveal={noop}
      />
    );
    expect(mapLoreGmHtml).toContain("Hidden Smuggler Hatch");
    expect(mapLoreGmHtml).toContain("Hidden (GM)");
    expect(mapLoreGmHtml).toContain("Mark Revealed");
    expect(mapLoreGmHtml).toContain("Add Lore");

    // CodexLocationDetail shows Discovered badge for revealed secret with GM Mode OFF
    const codexRevealedHtml = ReactDOMServer.renderToStaticMarkup(
      <CodexLocationDetail
        kind="location"
        location={loc}
        containers={[container]}
        locations={[loc]}
        visitedContainerIds={["c1"]}
        isCampaignMode
        unlockLore={false}
        revealedLoreIds={[secretLore.id]}
        onOpenOnMap={noop}
        onEnlargeImage={noop}
      />
    );
    expect(codexRevealedHtml).toContain("Hidden Smuggler Hatch");
    expect(codexRevealedHtml).toContain("Discovered");
  });

  it("unlocks visited location narrative fields in MapDetailsDrawer when GM Mode is ON while keeping Passage Hub locked", () => {
    const { loc, container } = makeFixture();
    const lockedHtml = ReactDOMServer.renderToStaticMarkup(
      <MapDetailsDrawer
        mode="campaign"
        isMutatingLocked={false}
        selectedLocation={loc}
        selectedContainer={null}
        containerStats={null}
        activeLocId={loc.id}
        containers={[container]}
        allLocations={[loc]}
        dynamicPortalIds={new Set()}
        externalPortals={[]}
        isLocationSavedInDb
        isContainerSavedInDb
        depthLabels={{ 1: "District", 2: "City", 3: "Region", 4: "World" }}
        unlockLore={false}
        onClose={noop}
        onPatchLocation={noop}
        onPatchContainer={noop}
        onResetCoordinates={noop}
        onDrillIntoContainer={noop}
      />
    );
    expect(lockedHtml).toMatch(/<textarea[^>]*disabled=""[^>]*>Cobblestones ringed by arcades\.<\/textarea>/);

    const unlockedHtml = ReactDOMServer.renderToStaticMarkup(
      <MapDetailsDrawer
        mode="campaign"
        isMutatingLocked={false}
        selectedLocation={loc}
        selectedContainer={null}
        containerStats={null}
        activeLocId={loc.id}
        containers={[container]}
        allLocations={[loc]}
        dynamicPortalIds={new Set()}
        externalPortals={[]}
        isLocationSavedInDb
        isContainerSavedInDb
        depthLabels={{ 1: "District", 2: "City", 3: "Region", 4: "World" }}
        unlockLore
        onClose={noop}
        onPatchLocation={noop}
        onPatchContainer={noop}
        onResetCoordinates={noop}
        onDrillIntoContainer={noop}
      />
    );
    expect(unlockedHtml).not.toMatch(
      /<textarea[^>]*disabled=""[^>]*>Cobblestones ringed by arcades\.<\/textarea>/
    );
  });

  it("orders Story Major Events chronologically and renders expanded details + GM Mode edit/revert actions", () => {
    const { makeBundle } = makeFixture();
    const bundleLocked = makeBundle(false);
    const items = buildStoryMajorEvents(bundleLocked);
    expect(items.map((i) => [i.turnDepthIndex, i.scope, i.title])).toEqual([
      [1, "world", "1420-05-10 - Fall of the Usurper"],
      [2, "location", "1420-05-10 - Bronze Statue Raised"],
    ]);

    const htmlLocked = ReactDOMServer.renderToStaticMarkup(
      <StoryModal
        isOpen
        initialTab="major_events"
        initialExpandedMajorEventKey="me:t2"
        onClose={noop}
        bundle={bundleLocked}
        onZoomToTurn={noop}
        onSwitchTimeline={noop}
        onBranchFromTurn={noop}
        onUpdateMajorEvent={noop}
        onDeleteMajorEvent={noop}
      />
    );
    expect(htmlLocked).toContain("Major Events");
    expect(htmlLocked).toContain("1420-05-10 - Fall of the Usurper");
    expect(htmlLocked).toContain("1420-05-10 - Bronze Statue Raised");
    expect(htmlLocked).toContain("centered on a giant bronze statue");
    expect(htmlLocked).not.toContain("Delete &amp; Revert");

    const htmlGm = ReactDOMServer.renderToStaticMarkup(
      <StoryModal
        isOpen
        initialTab="major_events"
        initialExpandedMajorEventKey="me:t2"
        onClose={noop}
        bundle={makeBundle(true)}
        onZoomToTurn={noop}
        onSwitchTimeline={noop}
        onBranchFromTurn={noop}
        onUpdateMajorEvent={noop}
        onDeleteMajorEvent={noop}
      />
    );
    expect(htmlGm).toContain("GM Mode Active");
    expect(htmlGm).toContain("Delete &amp; Revert");
    expect(htmlGm).toContain("Edit");
  });
});
