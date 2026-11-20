import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  CharacterRecord,
  CharacterStateSnapshot,
  LocationNode,
  PersonaRecord,
  UserProfile,
  WorldRecord,
} from "../../types";
import { PersonaEditorModal } from "../PersonaEditorModal";
import { AdminModal } from "../auth/AdminModal";
import { AuthScreen } from "../auth/AuthScreen";
import { CharacterInspectorModal } from "../character/CharacterInspectorModal";
import { CampaignCharacterModal } from "../inspector/CampaignCharacterModal";
import { WorldInspectorModal } from "../world/WorldInspectorModal";

const ADMIN_USER: UserProfile = {
  id: "u_admin",
  username: "admin",
  display_name: "Administrator",
  role: "admin",
  has_password: true,
  passkeys: [],
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
};

const LOC: LocationNode = {
  id: "loc_1",
  world_id: "world_1",
  is_entry_exit: true,
  name: "Main Plaza",
  summary: "Arrival hub",
  description: "Wide concrete square.",
  environmental_tags: ["hub"],
  is_starting_location: true,
};

const WORLD: WorldRecord = {
  id: "world_1",
  name: "Neo-Veridia",
  global_rules: {
    genre: "Cyberpunk",
    tone: "Noir",
    setting_overview: "Rainy coastal arcology.",
    tech_or_magic_rules: "Cyberware and black ice.",
    starting_timestamp: "2094-11-14 20:00",
  },
  locations: [LOC],
  edges: [],
  lore_nodes: [],
  created_at: "2026-10-01T00:00:00Z",
};

const CHAR: CharacterRecord = {
  id: "char_1",
  version: 1,
  name: "Yulia Halim",
  tagline: "Street surgeon",
  physical_appearance: "Sharp eyes, surgical coat.",
  core_persona: "Guarded and pragmatic.",
  communication_style: ["Clipped"],
  quirks_flaws: ["Insomniac"],
  moral_code: ["Do no unpaid harm"],
  baseline_psyche: {
    mood_label: "Alert",
    valence: 0,
    arousal: 0.4,
    core_drive: "Protect clinic",
    core_fear: "Corporate audit",
    default_want: "Assess caller",
    default_plan: "Stay behind glass",
  },
  voice_anchors: [],
  equipped: [],
  inventory: [],
  memory_shards: [],
  initial_message: "Clinic's closed.",
  character_bio: "Former corporate medtech.",
  tags: ["medtech"],
  creator: "",
  creator_notes: "",
  portraits: {},
  gallery: [],
  created_at: "2026-10-01T00:00:00Z",
};

const CHAR_STATE: CharacterStateSnapshot = {
  turn_id: "turn_0",
  character_id: "char_1",
  current_location_id: "loc_1",
  mood_label: "Alert",
  valence: 0,
  arousal: 0.4,
  active_want: "Assess caller",
  active_plan: "Stay behind glass",
  relationship_notes: {},
  equipped: [],
  inventory: [],
};

const PERSONA: PersonaRecord = {
  id: "persona_1",
  owner_id: "u_admin",
  name: "Valerie Wells",
  tagline: "Orbital courier",
  species: "Human",
  age: "28",
  age_is_secret: false,
  sex: "Female",
  pronouns: "she/her",
  persona_bio: "Operates out of Sector 9.",
  tags: ["courier"],
  build_and_height: "172 cm",
  distinctive_features: [],
  equipped: [],
  inventory: [],
  lore_entries: [],
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
};

describe("Stabilized Tabbed Sheet Modals", () => {
  it("renders WorldInspectorModal with modal-panel--sheet-wide across inspector, campaign, wizard modes and tabs", () => {
    for (const [mode, initialTab] of [
      ["inspector", "base"],
      ["inspector", "codex"],
      ["inspector", "map"],
      ["campaign", "base"],
      ["wizard", "base"],
    ] as const) {
      const html = renderToStaticMarkup(
        React.createElement(WorldInspectorModal, {
          world: WORLD,
          mode,
          initialTab,
          onClose: vi.fn(),
          onSaved: vi.fn(),
        })
      );
      expect(html).toContain("modal-panel modal-panel--sheet-wide");
      expect(html).toContain("World Sheet");
      expect(html).not.toContain("transition:width 0.2s ease");
    }
  });

  it("renders CharacterInspectorModal and CampaignCharacterModal with modal-panel--sheet and Character Sheet naming", () => {
    const outHtml = renderToStaticMarkup(
      React.createElement(CharacterInspectorModal, {
        character: CHAR,
        worlds: [WORLD],
        onClose: vi.fn(),
        onSaved: vi.fn(),
      })
    );
    expect(outHtml).toContain("modal-panel modal-panel--sheet");
    expect(outHtml).toContain("Character Sheet");

    const inHtml = renderToStaticMarkup(
      React.createElement(CampaignCharacterModal, {
        character: CHAR,
        state: CHAR_STATE,
        isPresent: true,
        campaignId: "camp_1",
        campaignWorld: WORLD,
        onClose: vi.fn(),
        onItemAction: vi.fn(),
        onSaveMemories: vi.fn(async () => {}),
      })
    );
    expect(inHtml).toContain("modal-panel modal-panel--sheet");
    expect(inHtml).toContain("Character Sheet");
    expect(inHtml).not.toContain("Character Dossier");
  });

  it("renders PersonaEditorModal as Persona Sheet with modal-panel--sheet and modal-sheet-form across create, edit, and read-only default modes", () => {
    const createHtml = renderToStaticMarkup(
      React.createElement(PersonaEditorModal, {
        persona: null,
        onClose: vi.fn(),
        onSaved: vi.fn(),
      })
    );
    expect(createHtml).toContain("modal-panel modal-panel--sheet");
    expect(createHtml).toContain("modal-sheet-form");
    expect(createHtml).toContain("Persona Sheet");
    expect(createHtml).toContain("New Persona");

    const editHtml = renderToStaticMarkup(
      React.createElement(PersonaEditorModal, {
        persona: PERSONA,
        onClose: vi.fn(),
        onSaved: vi.fn(),
      })
    );
    expect(editHtml).toContain("Persona Sheet");
    expect(editHtml).toContain("Valerie Wells");

    const readonlyHtml = renderToStaticMarkup(
      React.createElement(PersonaEditorModal, {
        persona: { ...PERSONA, id: "persona_default_user" },
        onClose: vi.fn(),
        onSaved: vi.fn(),
      })
    );
    expect(readonlyHtml).toContain("Persona Sheet");
    expect(readonlyHtml).toContain("Read Only");
  });

  it("renders AdminModal with modal-panel--sheet and ARIA tab semantics, while keeping AuthScreen compact", () => {
    const adminHtml = renderToStaticMarkup(
      React.createElement(AdminModal, {
        currentUser: ADMIN_USER,
        singleUserMode: false,
        onClose: vi.fn(),
        onCurrentUserUpdated: vi.fn(),
      })
    );
    expect(adminHtml).toContain("modal-panel modal-panel--sheet");
    expect(adminHtml).toContain('role="tablist"');
    expect(adminHtml).toContain('role="tab"');
    expect(adminHtml).toContain('aria-selected="true"');
    expect(adminHtml).toContain('role="tabpanel"');
    expect(adminHtml).not.toContain("max-width:740px");

    const authHtml = renderToStaticMarkup(
      React.createElement(AuthScreen, {
        singleUserMode: false,
        allowSelfRegistration: true,
        onAuthenticated: vi.fn(),
      })
    );
    expect(authHtml).toContain("max-width:440px");
    expect(authHtml).not.toContain("modal-panel--sheet");
  });
});
