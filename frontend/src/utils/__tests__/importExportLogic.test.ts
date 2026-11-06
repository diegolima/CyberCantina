import { describe, expect, it } from "vitest";
import { CharacterRecord, PersonaRecord, WorldRecord } from "../../types";
import {
  computeSuggestedBundleName,
  filterCharacters,
  filterPersonas,
  filterWorlds,
  findMissingResidentCharacters,
  findMissingWorldDependencies,
  sanitizeBundleFilename,
} from "../importExportLogic";

describe("importExportLogic", () => {
  const dummyWorlds: WorldRecord[] = [
    {
      id: "world_1",
      name: "Neo-Kyoto",
      global_rules: { genre: "cyberpunk" } as any,
      locations: [],
      edges: [],
      lore_nodes: [],
      pending_deletion: false,
      created_at: "",
    },
    {
      id: "world_2",
      name: "Solaris Outpost",
      global_rules: { genre: "sci-fi" } as any,
      locations: [],
      edges: [],
      lore_nodes: [],
      pending_deletion: false,
      created_at: "",
    },
  ];

  const dummyChars: CharacterRecord[] = [
    {
      id: "char_1",
      name: "Kael Vex",
      world_id: "world_1",
      tagline: "Mercenary",
      physical_appearance: "",
      core_persona: "",
      initial_message: "",
      equipped: [],
      inventory: [],
      voice_anchors: [],
      baseline_psyche: {} as any,
      memory_shards: [],
      tags: [],
      creator: "",
      creator_notes: "",
      portraits: {},
      gallery: [],
      pending_deletion: false,
      created_at: "",
      version: 1,
    },
    {
      id: "char_2",
      name: "Nyx Raven",
      world_id: "world_1",
      tagline: "Hacker",
      physical_appearance: "",
      core_persona: "",
      initial_message: "",
      equipped: [],
      inventory: [],
      voice_anchors: [],
      baseline_psyche: {} as any,
      memory_shards: [],
      tags: [],
      creator: "",
      creator_notes: "",
      portraits: {},
      gallery: [],
      pending_deletion: false,
      created_at: "",
      version: 1,
    },
    {
      id: "char_3",
      name: "Astronaut Bob",
      world_id: "world_2",
      tagline: "Pilot",
      physical_appearance: "",
      core_persona: "",
      initial_message: "",
      equipped: [],
      inventory: [],
      voice_anchors: [],
      baseline_psyche: {} as any,
      memory_shards: [],
      tags: ["pilot", "explorer"],
      creator: "",
      creator_notes: "",
      portraits: {},
      gallery: [],
      pending_deletion: false,
      created_at: "",
      version: 1,
    },
  ];

  // Set tags on dummyChars for search testing
  dummyChars[0].tags = ["runner", "stealth"];
  dummyChars[1].tags = ["netrunner", "cybernetics"];

  const dummyPersonas: PersonaRecord[] = [
    {
      id: "persona_1",
      owner_id: "user_1",
      name: "Deckard",
      age: "35",
      age_is_secret: false,
      physical_appearance: "Trenchcoat",
      equipped: [],
      inventory: [],
      lore_entries: [
        {
          id: "entry_1",
          title: "Blade Runner",
          content: "Retired detective",
          is_secret: false,
          trigger_keywords: ["detective", "noir"],
        },
      ],
      created_at: "",
      updated_at: "",
    },
    {
      id: "persona_2",
      owner_id: "user_1",
      name: "Rachael",
      age: "unknown",
      age_is_secret: true,
      physical_appearance: "Elegant hair",
      equipped: [],
      inventory: [],
      lore_entries: [
        {
          id: "entry_2",
          title: "Replicant",
          content: "Nexus 7",
          is_secret: false,
          trigger_keywords: ["android", "synth"],
        },
      ],
      created_at: "",
      updated_at: "",
    },
  ];

  it("identifies missing world when characters from that world are selected", () => {
    // Select Kael and Nyx, but do not select Neo-Kyoto
    const selectedChars = new Set(["char_1", "char_2"]);
    const selectedWorlds = new Set<string>();

    const missing = findMissingWorldDependencies(
      selectedChars,
      dummyChars,
      selectedWorlds,
      dummyWorlds
    );

    expect(missing).toHaveLength(1);
    expect(missing[0].worldId).toBe("world_1");
    expect(missing[0].worldName).toBe("Neo-Kyoto");
    expect(missing[0].charNames).toEqual(["Kael Vex", "Nyx Raven"]);
  });

  it("returns empty when all referenced worlds are selected", () => {
    const selectedChars = new Set(["char_1"]);
    const selectedWorlds = new Set(["world_1"]);

    const missing = findMissingWorldDependencies(
      selectedChars,
      dummyChars,
      selectedWorlds,
      dummyWorlds
    );

    expect(missing).toHaveLength(0);
  });

  it("identifies missing resident characters when a world is selected", () => {
    // Select Neo-Kyoto, but only select Kael Vex (Nyx is missing)
    const selectedWorlds = new Set(["world_1"]);
    const selectedChars = new Set(["char_1"]);

    const missing = findMissingResidentCharacters(
      selectedWorlds,
      dummyWorlds,
      selectedChars,
      dummyChars
    );

    expect(missing).toHaveLength(1);
    expect(missing[0].worldName).toBe("Neo-Kyoto");
    expect(missing[0].unselectedChars).toHaveLength(1);
    expect(missing[0].unselectedChars[0].name).toBe("Nyx Raven");
  });

  it("sanitizes filenames correctly", () => {
    expect(sanitizeBundleFilename("cyberpunk pack")).toBe("cyberpunk_pack.zcc");
    expect(sanitizeBundleFilename("special!@#$%^&*()name.zcc")).toBe("special__________name.zcc");
    expect(sanitizeBundleFilename("")).toBe("cybercantina_export.zcc");
    expect(sanitizeBundleFilename("my_bundle.zcc")).toBe("my_bundle.zcc");
  });

  describe("computeSuggestedBundleName", () => {
    it("returns empty string when nothing is selected", () => {
      expect(computeSuggestedBundleName([], [], [])).toBe("");
    });

    it("tier 1: returns persona name if a single persona is selected", () => {
      expect(computeSuggestedBundleName([], [], [dummyPersonas[0]])).toBe("Deckard");
    });

    it("tier 2: returns 'Personas' if multiple personas are selected", () => {
      expect(computeSuggestedBundleName([], [], [dummyPersonas[0], dummyPersonas[1]])).toBe("Personas");
    });

    it("tier 3: returns character name if a single character is selected (overrides personas)", () => {
      // 1 char alone
      expect(computeSuggestedBundleName([], [dummyChars[0]], [])).toBe("Kael Vex");
      // 1 char with 1 persona
      expect(computeSuggestedBundleName([], [dummyChars[0]], [dummyPersonas[0]])).toBe("Kael Vex");
      // 1 char with multiple personas
      expect(computeSuggestedBundleName([], [dummyChars[0]], [dummyPersonas[0], dummyPersonas[1]])).toBe("Kael Vex");
    });

    it("tier 4: returns 'Characters' if multiple characters are selected (overrides personas)", () => {
      // multiple chars alone
      expect(computeSuggestedBundleName([], [dummyChars[0], dummyChars[1]], [])).toBe("Characters");
      // multiple chars with multiple personas
      expect(
        computeSuggestedBundleName(
          [],
          [dummyChars[0], dummyChars[1]],
          [dummyPersonas[0], dummyPersonas[1]]
        )
      ).toBe("Characters");
    });

    it("tier 5: returns world name if a single world is selected (overrides chars and personas)", () => {
      // 1 world alone
      expect(computeSuggestedBundleName([dummyWorlds[0]], [], [])).toBe("Neo-Kyoto");
      // 1 world with chars and personas
      expect(
        computeSuggestedBundleName(
          [dummyWorlds[0]],
          [dummyChars[0], dummyChars[1]],
          [dummyPersonas[0]]
        )
      ).toBe("Neo-Kyoto");
    });

    it("tier 6: returns 'Worlds' if multiple worlds are selected (highest priority)", () => {
      // multiple worlds alone
      expect(computeSuggestedBundleName([dummyWorlds[0], dummyWorlds[1]], [], [])).toBe("Worlds");
      // multiple worlds with chars and personas
      expect(
        computeSuggestedBundleName(
          [dummyWorlds[0], dummyWorlds[1]],
          [dummyChars[0]],
          [dummyPersonas[0], dummyPersonas[1]]
        )
      ).toBe("Worlds");
    });
  });

  describe("filterCharacters", () => {
    it("returns all characters when query is empty", () => {
      expect(filterCharacters(dummyChars, "")).toHaveLength(3);
      expect(filterCharacters(dummyChars, "   ")).toHaveLength(3);
    });

    it("filters characters by name case-insensitively", () => {
      const result = filterCharacters(dummyChars, "kael");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Kael Vex");
    });

    it("filters characters by tags", () => {
      const runnerRes = filterCharacters(dummyChars, "runner");
      // Both "runner" and "netrunner" match "runner"
      expect(runnerRes.map((c) => c.name)).toContain("Kael Vex");
      expect(runnerRes.map((c) => c.name)).toContain("Nyx Raven");

      // With hashtag
      const tagWithHash = filterCharacters(dummyChars, "#stealth");
      expect(tagWithHash).toHaveLength(1);
      expect(tagWithHash[0].name).toBe("Kael Vex");
    });

    it("returns empty array when no characters match", () => {
      expect(filterCharacters(dummyChars, "nonexistent")).toHaveLength(0);
    });
  });

  describe("filterWorlds", () => {
    const worldsWithDetails: WorldRecord[] = [
      {
        ...dummyWorlds[0],
        locations: [
          {
            id: "loc_1",
            world_id: "world_1",
            name: "Downtown Alley",
            summary: "",
            description: "",
            environmental_tags: ["neon", "rain"],
            is_starting_location: true,
          },
        ],
        lore_nodes: [
          {
            id: "lore_1",
            world_id: "world_1",
            title: "Zaibatsu Cartel",
            category: "faction",
            content: "Megacorp",
            entity_tags: ["syndicate"],
          },
        ],
      },
      dummyWorlds[1],
    ];

    it("returns all worlds when query is empty", () => {
      expect(filterWorlds(worldsWithDetails, "")).toHaveLength(2);
    });

    it("filters worlds by name", () => {
      const res = filterWorlds(worldsWithDetails, "solaris");
      expect(res).toHaveLength(1);
      expect(res[0].name).toBe("Solaris Outpost");
    });

    it("filters worlds by genre", () => {
      const res = filterWorlds(worldsWithDetails, "cyberpunk");
      expect(res).toHaveLength(1);
      expect(res[0].name).toBe("Neo-Kyoto");
    });

    it("filters worlds by location environmental tags", () => {
      const res = filterWorlds(worldsWithDetails, "#rain");
      expect(res).toHaveLength(1);
      expect(res[0].name).toBe("Neo-Kyoto");
    });

    it("filters worlds by lore node entity tags", () => {
      const res = filterWorlds(worldsWithDetails, "syndicate");
      expect(res).toHaveLength(1);
      expect(res[0].name).toBe("Neo-Kyoto");
    });
  });

  describe("filterPersonas", () => {
    it("returns all personas when query is empty", () => {
      expect(filterPersonas(dummyPersonas, "")).toHaveLength(2);
    });

    it("filters personas by name", () => {
      const res = filterPersonas(dummyPersonas, "rachael");
      expect(res).toHaveLength(1);
      expect(res[0].name).toBe("Rachael");
    });

    it("filters personas by lore trigger keywords", () => {
      const res = filterPersonas(dummyPersonas, "detective");
      expect(res).toHaveLength(1);
      expect(res[0].name).toBe("Deckard");

      const synthRes = filterPersonas(dummyPersonas, "#synth");
      expect(synthRes).toHaveLength(1);
      expect(synthRes[0].name).toBe("Rachael");
    });
  });
});
