import ReactDOMServer from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  NewCampaignModal,
  resolveInitialCharacterIds,
  resolveInitialPersonaId,
  resolveInitialWorldId,
} from "../NewCampaignModal";
import { CharacterRecord, PersonaRecord, WorldRecord } from "../../types";

function makeWorld(overrides: Partial<WorldRecord> = {}): WorldRecord {
  const worldId = overrides.id ?? "world_active_v2";
  return {
    id: worldId,
    name: "The Green Lie",
    global_rules: {
      genre: "Cyberpunk",
      tone: "Noir",
      setting_overview: "Rainy megacity.",
      tech_or_magic_rules: "Cyberware.",
      starting_timestamp: "2094-11-14 20:00",
    },
    containers: [],
    locations: [
      {
        id: "loc_1",
        world_id: worldId,
        name: "Main Floor",
        summary: "Dim bar",
        description: "Neon bar",
        environmental_tags: [],
        is_starting_location: true,
        is_hub: true,
        starting_message: "Rain taps against the glass.",
      },
    ],
    edges: [],
    lore_nodes: [],
    media: [],
    pending_deletion: false,
    created_at: "2026-11-19T18:24:42Z",
    ...overrides,
  };
}

function makeCharacter(overrides: Partial<CharacterRecord> = {}): CharacterRecord {
  return {
    id: "char_active_v2",
    world_id: "world_active_v2",
    name: "Yulia Halim",
    tagline: "Street doc",
    physical_appearance: "Tall.",
    core_persona: "Composed and sharp.",
    initial_message: "What'll it be?",
    character_bio: "Runs the clinic.",
    voice_anchors: [],
    baseline_psyche: {
      mood_label: "Calm",
      valence: 0,
      arousal: 0.3,
      core_drive: "Protect patients",
      core_fear: "Shutdown",
      default_want: "Patch people up",
      default_plan: "Check vitals",
    },
    memory_shards: [],
    equipped: [],
    inventory: [],
    portraits: {},
    gallery: [],
    tags: [],
    creator: "test",
    creator_notes: "",
    pending_deletion: false,
    version: 1,
    created_at: "2026-11-19T18:24:42Z",
    ...overrides,
  };
}

function makePersona(overrides: Partial<PersonaRecord> = {}): PersonaRecord {
  return {
    id: "pers_1",
    owner_id: "user_1",
    name: "Kael",
    tagline: "Courier",
    age_is_secret: false,
    persona_bio: "Fast on rooftops.",
    equipped: [],
    inventory: [],
    lore_entries: [],
    gallery: [],
    created_at: "2026-11-19T18:24:42Z",
    updated_at: "2026-11-19T18:24:42Z",
    ...overrides,
  };
}

describe("NewCampaignModal stale/pending_deletion selection safety", () => {
  it("falls back to the first active world when initialWorldId is stale or pending_deletion", () => {
    const activeWorld = makeWorld({ id: "world_v2", pending_deletion: false });
    const archivedWorld = makeWorld({ id: "world_old", pending_deletion: true });

    // Stale ID from an opened archived campaign not present in active worlds list
    expect(resolveInitialWorldId([activeWorld], "world_old")).toBe("world_v2");
    // Archived world explicitly present in list is still skipped
    expect(resolveInitialWorldId([archivedWorld, activeWorld], "world_old")).toBe("world_v2");
    // Valid active ID is preserved
    expect(resolveInitialWorldId([activeWorld], "world_v2")).toBe("world_v2");
  });

  it("falls back to the first active character and valid persona when initial IDs are stale", () => {
    const activeChar = makeCharacter({ id: "char_v2", pending_deletion: false });
    const archivedChar = makeCharacter({ id: "char_old", pending_deletion: true });
    const persona = makePersona({ id: "pers_1" });

    expect(resolveInitialCharacterIds([activeChar], "char_old")).toEqual(["char_v2"]);
    expect(resolveInitialCharacterIds([archivedChar, activeChar], "char_old")).toEqual(["char_v2"]);
    expect(resolveInitialPersonaId([persona], "pers_deleted")).toBe("pers_1");
    expect(resolveInitialPersonaId([persona], "pers_1")).toBe("pers_1");
  });

  it("renders only active worlds and selects the active world when given a stale initialWorldId", () => {
    const activeWorld = makeWorld({ id: "world_v2", name: "The Green Lie", pending_deletion: false });
    const archivedWorld = makeWorld({ id: "world_old", name: "The Green Lie (Old)", pending_deletion: true });
    const activeChar = makeCharacter();
    const persona = makePersona();

    const html = ReactDOMServer.renderToStaticMarkup(
      <NewCampaignModal
        worlds={[archivedWorld, activeWorld]}
        characters={[activeChar]}
        personas={[persona]}
        initialWorldId="world_old"
        initialCharacterId="char_deleted"
        initialPersonaId="pers_deleted"
        onClose={() => {}}
        onCreate={async () => {}}
      />
    );

    expect(html).toContain('value="world_v2"');
    expect(html).not.toContain('value="world_old"');
    expect(html).not.toContain("The Green Lie (Old)");
  });
});
