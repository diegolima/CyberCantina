import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  CharacterRecord,
  LocationContainer,
  LocationNode,
  LoreNode,
  PersonaRecord,
  PersonaTurnStateSnapshot,
  WorldRecord,
} from "../../types";
import { CodexCharacterDetail } from "../world/CodexCharacterDetail";
import { CodexLocationDetail } from "../world/CodexLocationDetail";
import { CodexLoreEditor } from "../world/CodexLoreEditor";
import { WorldInspectorModal } from "../world/WorldInspectorModal";
import {
  type CodexCampaignCharacterEntry,
  buildCodexLocationTree,
  buildCodexMajorCharacterList,
  countInvalidWorldLoreBySection,
  filterAndRankWorldLore,
  getCodexSectionForCategory,
  getVisibleScopedLore,
  isCodexContainerImageVisible,
  isCodexLocationImageVisible,
  searchAllCodexEntries,
} from "../world/codexHelpers";

function makeLoreNodes(): LoreNode[] {
  return [
    {
      id: "lore_hist",
      world_id: "w1",
      title: "Charter of Ash",
      category: "history",
      content: "Signed after the blackout.",
      entity_tags: ["charter", "blackout"],
    },
    {
      id: "lore_cult",
      world_id: "w1",
      title: "Lantern Rite",
      category: "culture",
      content: "Annual night vigil.",
      entity_tags: ["lantern", "vigil"],
    },
    {
      id: "lore_fac",
      world_id: "w1",
      title: "Iron Syndicate",
      category: "faction",
      content: "Controls the rail yards.",
      entity_tags: ["syndicate", "rail"],
    },
    {
      id: "lore_fig",
      world_id: "w1",
      title: "Marshal Sol",
      category: "figure",
      content: "Retired arbiter of the old ward.",
      entity_tags: ["sol", "arbiter"],
    },
    {
      id: "lore_art",
      world_id: "w1",
      title: "Aether Compass",
      category: "artifact",
      content: "Points toward active rift beacons.",
      entity_tags: ["compass", "rift"],
    },
    {
      id: "lore_rum",
      world_id: "w1",
      title: "Echoes Under Pier 4",
      category: "rumor",
      content: "Dockworkers claim a hidden vault exists below.",
      entity_tags: ["pier", "vault"],
    },
    {
      id: "lore_thr",
      world_id: "w1",
      title: "Blight Mist",
      category: "threat",
      content: "Corrosive fog sweeping the lower channels.",
      entity_tags: ["blight", "fog"],
    },
  ];
}

function makeContainersAndLocations(): {
  containers: LocationContainer[];
  locations: LocationNode[];
} {
  const containers: LocationContainer[] = [
    {
      id: "cont_region",
      world_id: "w1",
      depth: 4,
      name: "Sunken Reach",
      description: "Coastal region shrouded in salt mist.",
      environmental_tags: ["coast", "mist"],
      image_url: "/api/media/worlds/images/region.webp",
      lore_nodes: [],
    },
    {
      id: "cont_keep",
      world_id: "w1",
      parent_container_id: "cont_region",
      depth: 1,
      name: "Beacon Keep",
      description: "Stone lighthouse fortress.",
      environmental_tags: ["stone", "lighthouse"],
      image_url: "/api/media/worlds/images/keep.webp",
      lore_nodes: [
        {
          id: "cl_public",
          world_id: "w1",
          container_id: "cont_keep",
          title: "Lighthouse Lens",
          category: "history",
          content: "Built from salvaged star-glass.",
          entity_tags: ["lens"],
        },
        {
          id: "cl_secret",
          world_id: "w1",
          container_id: "cont_keep",
          title: "Hidden Smuggler Hatch",
          category: "secret",
          content: "Concealed trapdoor beneath the oil drums.",
          entity_tags: ["hatch"],
        },
      ],
    },
  ];

  const locations: LocationNode[] = [
    {
      id: "loc_lantern",
      world_id: "w1",
      container_id: "cont_keep",
      name: "Lantern Gallery",
      summary: "Top tower catwalk.",
      description: "Windy glass platform.",
      environmental_tags: ["wind", "beacon"],
      is_starting_location: true,
      is_visited: true,
      image_url: "/api/media/worlds/images/lantern.webp",
      lore_nodes: [
        {
          id: "ll_pub",
          world_id: "w1",
          location_id: "loc_lantern",
          title: "Tower Signals",
          category: "culture",
          content: "Green flares warn ships off the shoals.",
          entity_tags: ["flares"],
        },
        {
          id: "ll_sec",
          world_id: "w1",
          location_id: "loc_lantern",
          title: "Secret Cipher Book",
          category: "secret",
          content: "Hidden inside the brass housing.",
          entity_tags: ["cipher"],
        },
      ],
    },
    {
      id: "loc_vault",
      world_id: "w1",
      container_id: "cont_keep",
      created_at_turn_id: "turn_3",
      name: "Ash Vault",
      summary: "Sub-cellar crypt.",
      description: "Cold flooded stone cellar.",
      environmental_tags: ["crypt"],
      is_starting_location: false,
      is_visited: false,
      image_url: "/api/media/worlds/images/vault.webp",
      lore_nodes: [],
    },
  ];

  return { containers, locations };
}

function makeCharacterFixtures(): {
  persona: PersonaRecord;
  personaTurnState: PersonaTurnStateSnapshot;
  entries: CodexCampaignCharacterEntry[];
} {
  const persona: PersonaRecord = {
    id: "persona_1",
    owner_id: "u1",
    name: "Ren Corvo",
    species: "Human",
    age: "31",
    age_is_secret: true,
    sex: "Male",
    pronouns: "he/him",
    persona_bio: "Harbor cartographer.",
    tags: ["cartographer"],
    build_and_height: "180 cm, lean",
    distinctive_features: ["ink-stained fingers"],
    equipped: [
      {
        id: "p_eq_1",
        name: "Brass Sextant",
        note: "Old survey gear.",
        flags: [],
        is_secret: false,
        trigger_keywords: [],
      },
    ],
    inventory: [],
    lore_entries: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };

  const personaTurnState: PersonaTurnStateSnapshot = {
    turn_id: "turn_2",
    equipped: [
      {
        id: "p_eq_live",
        name: "Storm Lantern",
        note: "Acquired on turn 2.",
        flags: [],
        is_secret: false,
        trigger_keywords: [],
      },
    ],
    inventory: [],
  };

  const makeChar = (id: string, name: string): CharacterRecord => ({
    id,
    version: 1,
    name,
    tagline: "Signal watcher",
    species: "Human",
    age: "29",
    sex: "Female",
    pronouns: "she/her",
    build_and_height: "172 cm",
    posture: "Alert",
    distinctive_features: ["scarred brow"],
    mannerisms: ["taps pocket watch"],
    visual_aesthetic: "Oilskin coat",
    character_bio: "Maintains the outer beacons.",
    core_persona: "GM_SECRET_CORE_PERSONA_TOKEN",
    moral_code: ["GM_SECRET_MORAL_TOKEN"],
    quirks_flaws: ["GM_SECRET_FLAW_TOKEN"],
    communication_style: ["terse"],
    initial_message: "Mind the tide.",
    equipped: [
      {
        id: "eq_art",
        name: "Aether Compass",
        note: "Hums near rifts.",
        flags: ["artifact"],
        lore_id: "lore_art",
      },
    ],
    inventory: [],
    voice_anchors: [],
    baseline_psyche: {
      mood_label: "Guarded",
      valence: 0,
      arousal: 0.4,
      core_drive: "GM_SECRET_DRIVE_TOKEN",
      core_fear: "GM_SECRET_FEAR_TOKEN",
      default_want: "Protect beacon",
      default_plan: "Watch pier",
    },
    memory_shards: [
      {
        title: "GM_SECRET_SHARD_TOKEN",
        content: "Hidden memory shard content",
        keywords: ["secretshard"],
        emotional_weight: 0.8,
      },
    ],
    tags: ["watcher"],
    creator: "tester",
    creator_notes: "GM_SECRET_CREATOR_NOTE_TOKEN",
    portraits: {},
    gallery: [],
    created_at: "2026-01-01T00:00:00Z",
  });

  const entries: CodexCampaignCharacterEntry[] = [
    {
      record: makeChar("char_z", "Zara Voss"),
      isPresent: false,
      elsewhereLocationName: "Ash Vault",
      isPrimary: false,
    },
    {
      record: makeChar("char_a", "Aria Kell"),
      isPresent: true,
      isPrimary: true,
    },
  ];

  return { persona, personaTurnState, entries };
}

function makeWorld(loreNodes = makeLoreNodes()): WorldRecord {
  const { containers, locations } = makeContainersAndLocations();
  return {
    id: "w1",
    name: "Sunken Reach",
    global_rules: {
      genre: "Gothic Maritime",
      tone: "Misty",
      setting_overview: "Flooded archipelago.",
      tech_or_magic_rules: "Clockwork & lanterns.",
      starting_timestamp: "1894-11-02 21:00",
    },
    created_at: "2026-01-01T00:00:00Z",
    containers,
    locations,
    edges: [],
    lore_nodes: loreNodes,
  };
}

describe("World Codex Helpers & Components (v0.20.0)", () => {
  it("maps all 7 WorldLoreCategory values deterministically to the 4 editable Codex sections", () => {
    expect(getCodexSectionForCategory("history")).toBe("history_culture");
    expect(getCodexSectionForCategory("culture")).toBe("history_culture");
    expect(getCodexSectionForCategory("faction")).toBe("factions_figures");
    expect(getCodexSectionForCategory("figure")).toBe("factions_figures");
    expect(getCodexSectionForCategory("artifact")).toBe("items_artifacts");
    expect(getCodexSectionForCategory("rumor")).toBe("rumors_threats");
    expect(getCodexSectionForCategory("threat")).toBe("rumors_threats");

    const invalidCounts = countInvalidWorldLoreBySection(
      [
        {
          id: "bad_1",
          world_id: "w1",
          title: "",
          category: "figure",
          content: "Body",
          entity_tags: ["tag"],
        },
        {
          id: "bad_2",
          world_id: "w1",
          title: "Valid Title",
          category: "threat",
          content: "Body",
          entity_tags: [],
        },
        {
          id: "ok_with_pending",
          world_id: "w1",
          title: "Pending Tag Entry",
          category: "artifact",
          content: "Body",
          entity_tags: [],
        },
      ],
      { ok_with_pending: "relic" }
    );
    expect(invalidCounts).toEqual({
      history_culture: 0,
      factions_figures: 1,
      items_artifacts: 0,
      rumors_threats: 1,
    });
  });

  it("ranks search results Title > Keywords > Content with alphabetical tie-breaks and frozen edit order", () => {
    const nodes: LoreNode[] = [
      {
        id: "n_content",
        world_id: "w1",
        title: "Alpha Archive",
        category: "history",
        content: "Mentions starlight inside body.",
        entity_tags: ["archive"],
      },
      {
        id: "n_kw",
        world_id: "w1",
        title: "Beta Chronicle",
        category: "culture",
        content: "Unrelated prose.",
        entity_tags: ["starlight"],
      },
      {
        id: "n_title_b",
        world_id: "w1",
        title: "Zeta Starlight",
        category: "history",
        content: "Title match.",
        entity_tags: ["zeta"],
      },
      {
        id: "n_title_a",
        world_id: "w1",
        title: "Aether Starlight",
        category: "culture",
        content: "Title match first alphabetically.",
        entity_tags: ["aether"],
      },
    ];

    const ranked = filterAndRankWorldLore(nodes, {
      sectionId: "history_culture",
      query: "starlight",
    });
    expect(ranked.map((r) => r.lore.id)).toEqual([
      "n_title_a",
      "n_title_b",
      "n_kw",
      "n_content",
    ]);
    expect(ranked.map((r) => r.matchTier)).toEqual([1, 1, 2, 3]);

    // Frozen sort order preserves row position while title input is focused
    const frozen = filterAndRankWorldLore(nodes, {
      sectionId: "history_culture",
      frozenOrderIds: ["n_content", "n_kw", "n_title_b", "n_title_a"],
    });
    expect(frozen.map((r) => r.lore.id)).toEqual([
      "n_content",
      "n_kw",
      "n_title_b",
      "n_title_a",
    ]);
  });

  it("excludes campaign secret lore and GM character internals from global search", () => {
    const world = makeWorld();
    const { persona, entries } = makeCharacterFixtures();

    const secretHits = searchAllCodexEntries({
      loreNodes: world.lore_nodes,
      containers: world.containers ?? [],
      locations: world.locations,
      activePersona: persona,
      campaignCharacters: entries,
      query: "Cipher",
      isCampaignMode: true,
    });
    expect(secretHits).toHaveLength(0);

    for (const gmToken of [
      "GM_SECRET_CORE_PERSONA_TOKEN",
      "GM_SECRET_MORAL_TOKEN",
      "GM_SECRET_FLAW_TOKEN",
      "GM_SECRET_DRIVE_TOKEN",
      "GM_SECRET_FEAR_TOKEN",
      "GM_SECRET_SHARD_TOKEN",
      "GM_SECRET_CREATOR_NOTE_TOKEN",
    ]) {
      const gmHits = searchAllCodexEntries({
        loreNodes: world.lore_nodes,
        containers: world.containers ?? [],
        locations: world.locations,
        activePersona: persona,
        campaignCharacters: entries,
        query: gmToken,
        isCampaignMode: true,
      });
      expect(gmHits).toHaveLength(0);
    }

    // Outside campaign mode, Major Characters are excluded from global search
    const nonCampaignCharHits = searchAllCodexEntries({
      loreNodes: world.lore_nodes,
      containers: world.containers ?? [],
      locations: world.locations,
      activePersona: persona,
      campaignCharacters: entries,
      query: "Aria",
      isCampaignMode: false,
    });
    expect(nonCampaignCharHits.some((h) => h.kind === "character")).toBe(false);
  });

  it("builds Locations tree alphabetically, handles cycles/orphans, expands ancestors, and gates visited media", () => {
    const { containers, locations } = makeContainersAndLocations();
    const tree = buildCodexLocationTree(containers, locations, {
      query: "Vault",
      isCampaignMode: true,
    });
    expect(tree.roots).toHaveLength(1);
    expect(tree.roots[0].name).toBe("Sunken Reach");
    expect(tree.autoExpandedContainerIds.has("cont_region")).toBe(true);
    expect(tree.autoExpandedContainerIds.has("cont_keep")).toBe(true);
    expect(tree.roots[0].children[0].children.map((c) => c.name)).toEqual([
      "Ash Vault",
    ]);

    // Cycle & orphan container resilience: neither drops nodes nor throws
    const cyclicContainers: LocationContainer[] = [
      {
        id: "c_a",
        world_id: "w1",
        parent_container_id: "c_b",
        depth: 2,
        name: "Alpha Cycle",
        description: "",
        environmental_tags: [],
      },
      {
        id: "c_b",
        world_id: "w1",
        parent_container_id: "c_a",
        depth: 1,
        name: "Beta Cycle",
        description: "",
        environmental_tags: [],
      },
      {
        id: "c_orphan",
        world_id: "w1",
        parent_container_id: "missing_parent",
        depth: 1,
        name: "Orphan Yard",
        description: "",
        environmental_tags: [],
      },
    ];
    const cyclicTree = buildCodexLocationTree(cyclicContainers, locations, {
      isCampaignMode: false,
    });
    expect(cyclicTree.roots.map((r) => r.name)).toEqual([
      "Alpha Cycle",
      "Ash Vault",
      "Beta Cycle",
      "Lantern Gallery",
      "Orphan Yard",
    ]);

    // Visited-only media & secret filtering
    expect(isCodexLocationImageVisible(locations[0], true)).toBe(true);
    expect(isCodexLocationImageVisible(locations[1], true)).toBe(false);
    expect(isCodexLocationImageVisible(locations[1], false)).toBe(true);
    expect(
      isCodexContainerImageVisible(containers[0], containers, locations, [], true)
    ).toBe(true);
    expect(
      isCodexContainerImageVisible(
        { ...containers[0], id: "unvisited_cont" },
        containers,
        locations,
        [],
        true
      )
    ).toBe(false);
    expect(getVisibleScopedLore(locations[0].lore_nodes, true).map((l) => l.id)).toEqual([
      "ll_pub",
    ]);
    expect(getVisibleScopedLore(locations[0].lore_nodes, false)).toHaveLength(2);
  });

  it("orders Major Characters with Persona pinned first and alphabetical cast", () => {
    const { persona, entries } = makeCharacterFixtures();
    const list = buildCodexMajorCharacterList(persona, entries);
    expect(list.map((m) => m.title)).toEqual([
      "Ren Corvo",
      "Aria Kell",
      "Zara Voss",
    ]);
    expect(list[0].kind).toBe("persona");

    const filtered = buildCodexMajorCharacterList(persona, entries, "Zara");
    expect(filtered.map((m) => m.title)).toEqual(["Zara Voss"]);
  });

  it("renders WorldInspectorModal Codex tab across inspector, wizard, and campaign modes", () => {
    const world = makeWorld([
      ...makeLoreNodes(),
      {
        id: "lore_invalid",
        world_id: "w1",
        title: "",
        category: "threat",
        content: "Missing title & tags",
        entity_tags: [],
      },
    ]);
    const { persona, entries } = makeCharacterFixtures();

    const inspectorHtml = renderToStaticMarkup(
      <WorldInspectorModal
        world={world}
        mode="inspector"
        initialTab="lore"
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    expect(inspectorHtml).toContain("Codex");
    expect(inspectorHtml).toContain("History &amp; Culture");
    expect(inspectorHtml).toContain("Factions &amp; Figures");
    expect(inspectorHtml).toContain("Items &amp; Artifacts");
    expect(inspectorHtml).toContain("Rumors &amp; Threats");
    expect(inspectorHtml).toContain("Locations");
    expect(inspectorHtml).toContain("Major Characters");
    expect(inspectorHtml).toContain("Campaign only");
    expect(inspectorHtml).toContain("!1");

    const wizardHtml = renderToStaticMarkup(
      <WorldInspectorModal
        world={world}
        mode="wizard"
        initialTab="base"
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    expect(wizardHtml).toContain("Map and Codex tabs");

    const campaignHtml = renderToStaticMarkup(
      <WorldInspectorModal
        world={world}
        mode="campaign"
        initialTab="codex"
        activePersona={persona}
        campaignCharacters={entries}
        activeLocationId="loc_lantern"
        visitedContainerIds={["cont_keep"]}
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    expect(campaignHtml).toContain("1 persona · 2 characters");
    expect(campaignHtml).not.toContain("Campaign only");
    expect(campaignHtml).not.toContain("Add Entry");
  });

  it("renders CodexLocationDetail, CodexCharacterDetail, and CodexLoreEditor contracts cleanly", () => {
    const world = makeWorld();
    const { persona, personaTurnState, entries } = makeCharacterFixtures();

    const locCampaignHtml = renderToStaticMarkup(
      <CodexLocationDetail
        kind="location"
        location={world.locations[0]}
        containers={world.containers ?? []}
        locations={world.locations}
        visitedContainerIds={["cont_keep"]}
        activeLocationId="loc_lantern"
        isCampaignMode={true}
        onOpenOnMap={() => {}}
        onEnlargeImage={() => {}}
      />
    );
    expect(locCampaignHtml).toContain("Tower Signals");
    expect(locCampaignHtml).not.toContain("Secret Cipher Book");
    expect(locCampaignHtml).toContain("/api/media/worlds/images/lantern.webp");
    expect(locCampaignHtml).toContain("Open on Map →");

    const unvisitedLocHtml = renderToStaticMarkup(
      <CodexLocationDetail
        kind="location"
        location={world.locations[1]}
        containers={world.containers ?? []}
        locations={world.locations}
        visitedContainerIds={["cont_keep"]}
        activeLocationId="loc_lantern"
        isCampaignMode={true}
        onOpenOnMap={() => {}}
        onEnlargeImage={() => {}}
      />
    );
    expect(unvisitedLocHtml).toContain("Ash Vault");
    expect(unvisitedLocHtml).not.toContain("/api/media/worlds/images/vault.webp");

    const personaHtml = renderToStaticMarkup(
      <CodexCharacterDetail
        kind="persona"
        persona={persona}
        personaTurnState={personaTurnState}
        loreNodes={world.lore_nodes}
        onJumpToLore={() => {}}
      />
    );
    expect(personaHtml).toContain("Storm Lantern");
    expect(personaHtml).not.toContain("Brass Sextant");

    const charHtml = renderToStaticMarkup(
      <CodexCharacterDetail
        kind="character"
        characterEntry={entries[1]}
        loreNodes={world.lore_nodes}
        onJumpToLore={() => {}}
      />
    );
    expect(charHtml).toContain("Aria Kell");
    expect(charHtml).toContain("Artifact: Aether Compass");
    expect(charHtml).not.toContain("GM_SECRET_CORE_PERSONA_TOKEN");
    expect(charHtml).not.toContain("GM_SECRET_SHARD_TOKEN");

    const editorHtml = renderToStaticMarkup(
      <CodexLoreEditor
        lore={world.lore_nodes[3]}
        pendingTagDraft=""
        isCampaignMode={false}
        onChangeTitle={() => {}}
        onChangeCategory={() => {}}
        onDraftTagsChange={() => {}}
        onChangeTags={() => {}}
        onChangeContent={() => {}}
        onDuplicate={() => {}}
        onDelete={() => {}}
      />
    );
    expect(editorHtml).toContain("Marshal Sol");
    expect(editorHtml).toContain("Duplicate");
    expect(editorHtml).toContain("Delete");
  });
});
