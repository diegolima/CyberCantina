import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PersonaRecord, WorldRecord } from "../../types";
import {
  DEPRECATED_WORLD_KEYS,
  appendLegacyText,
  buildPersonaUnsupportedFieldsState,
  buildWorldUnsupportedFieldsState,
  filterRemainingUnsupportedFields,
} from "../../utils/unsupportedFields";
import { PersonaEditorModal } from "../PersonaEditorModal";
import { WorldInspectorModal } from "../world/WorldInspectorModal";

function makeBasePersona(overrides: Partial<PersonaRecord> = {}): PersonaRecord {
  return {
    id: "persona_test_1",
    owner_id: "user_1",
    name: "Archivist Mara",
    species: "Human",
    age: "31",
    age_is_secret: true,
    sex: "Female",
    pronouns: "she/her",
    persona_bio: "Orbital historian.",
    tags: [],
    build_and_height: "168 cm",
    distinctive_features: ["Silver spectacles"],
    physical_appearance: "",
    equipped: [],
    inventory: [],
    lore_entries: [],
    unsupported_fields: {},
    created_at: "2026-11-16T00:00:00Z",
    updated_at: "2026-11-16T00:00:00Z",
    ...overrides,
  };
}

function makeBaseWorld(overrides: Partial<WorldRecord> = {}): WorldRecord {
  return {
    id: "world_test_1",
    name: "Orbital Ring",
    global_rules: {
      genre: "Sci-Fi",
      tone: "",
      setting_overview: "Rotating orbital station.",
      tech_or_magic_rules: "",
      starting_timestamp: "Day 1, 08:00",
      describe_on_first_visit: true,
    },
    created_at: "2026-11-16T00:00:00Z",
    containers: [],
    locations: [
      {
        id: "loc_1",
        world_id: "world_test_1",
        name: "Concourse",
        summary: "Main hub",
        description: "Busy arrival ring.",
        environmental_tags: ["orbital"],
        is_starting_location: true,
        is_hub: true,
      },
    ],
    edges: [],
    lore_nodes: [],
    unsupported_fields: {},
    ...overrides,
  };
}

describe("Shared, Persona, and World UnsupportedFieldsTab helpers & modals", () => {
  it("builds persona unsupported state while discarding exact physical_appearance duplicates", () => {
    const clean = makeBasePersona();
    expect(buildPersonaUnsupportedFieldsState(clean)).toEqual({});

    const dup = makeBasePersona({
      persona_bio: "Same persona description.",
      physical_appearance: "Same persona description.",
    });
    expect(buildPersonaUnsupportedFieldsState(dup)).toEqual({});

    const cleanHtml = renderToStaticMarkup(
      <PersonaEditorModal
        persona={dup}
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    expect(cleanHtml).not.toContain(">Unsupported<");
  });

  it("renders Persona Unsupported tab with Copy/Move to Bio actions when distinct legacy or future keys exist", () => {
    const persona = makeBasePersona({
      persona_bio: "",
      physical_appearance: "Ink-stained fingertips and brass monacle.",
      unsupported_fields: {
        favorite_drink: "Chamomile",
      },
    });
    expect(buildPersonaUnsupportedFieldsState(persona)).toEqual({
      favorite_drink: "Chamomile",
      physical_appearance: "Ink-stained fingertips and brass monacle.",
    });

    const html = renderToStaticMarkup(
      <PersonaEditorModal
        persona={persona}
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    expect(html).toContain(">Unsupported<");
    expect(html).toContain("favorite_drink");
    expect(html).toContain("physical_appearance");
    expect(html).toContain("Deprecated");
    expect(html).toContain("Copy to Bio");
    expect(html).toContain("Move to Bio &amp; Delete");

    // Non-empty bio switches label to Append to Bio
    const nonEmptyBioHtml = renderToStaticMarkup(
      <PersonaEditorModal
        persona={makeBasePersona({
          persona_bio: "Existing background.",
          unsupported_fields: {
            physical_appearance: "Old appearance line.",
          },
        })}
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    expect(nonEmptyBioHtml).toContain("Append to Bio");
  });

  it("hides World Unsupported tab on canonical worlds and renders Deprecated vs Unsupported helpers in inspector mode", () => {
    const canonicalHtml = renderToStaticMarkup(
      <WorldInspectorModal
        world={makeBaseWorld()}
        mode="inspector"
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    expect(canonicalHtml).not.toContain(">Unsupported<");

    const worldWithExt = makeBaseWorld({
      unsupported_fields: {
        "global_rules.narrative_style": "Second-person noir",
        "global_rules.taboos_and_limits": "No FTL jumps",
        calendar_system: "13-month solar ledger",
      },
    });
    expect(buildWorldUnsupportedFieldsState(worldWithExt)).toEqual({
      "global_rules.narrative_style": "Second-person noir",
      "global_rules.taboos_and_limits": "No FTL jumps",
      calendar_system: "13-month solar ledger",
    });
    expect(DEPRECATED_WORLD_KEYS.has("global_rules.narrative_style")).toBe(true);
    expect(DEPRECATED_WORLD_KEYS.has("calendar_system")).toBe(false);

    const inspectorHtml = renderToStaticMarkup(
      <WorldInspectorModal
        world={worldWithExt}
        mode="inspector"
        initialTab="unsupported"
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    expect(inspectorHtml).toContain(">Unsupported<");
    expect(inspectorHtml).toContain("global_rules.narrative_style");
    expect(inspectorHtml).toContain("global_rules.taboos_and_limits");
    expect(inspectorHtml).toContain("calendar_system");
    expect(inspectorHtml).toContain("Deprecated");
    expect(inspectorHtml).toContain("Copy to Tone");
    expect(inspectorHtml).toContain("Move to Tone &amp; Delete");
    expect(inspectorHtml).toContain("Copy to World Rules");
    expect(inspectorHtml).toContain("Move to World Rules &amp; Delete");
    expect(inspectorHtml).toContain("Delete");
  });

  it("renders World Unsupported tab strictly read-only in campaign mode", () => {
    const worldWithExt = makeBaseWorld({
      global_rules: {
        genre: "Sci-Fi",
        tone: "Atmospheric",
        setting_overview: "Rotating orbital station.",
        tech_or_magic_rules: "Hard sci-fi",
        starting_timestamp: "Day 1, 08:00",
        describe_on_first_visit: true,
      },
      unsupported_fields: {
        "global_rules.narrative_style": "Second-person noir",
        "global_rules.taboos_and_limits": "No FTL jumps",
        calendar_system: "13-month solar ledger",
      },
    });

    const campaignHtml = renderToStaticMarkup(
      <WorldInspectorModal
        world={worldWithExt}
        mode="campaign"
        initialTab="unsupported"
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    expect(campaignHtml).toContain("global_rules.narrative_style");
    expect(campaignHtml).toContain("shown read-only here");
    expect(campaignHtml).not.toContain("Append to Tone");
    expect(campaignHtml).not.toContain("Move to Tone &amp; Delete");
    expect(campaignHtml).not.toContain("Append to World Rules");
    expect(campaignHtml).not.toContain("Delete legacy or unsupported field");
  });

  it("supports appendLegacyText and filterRemainingUnsupportedFields cleanly", () => {
    expect(appendLegacyText("", "  Old lore  ")).toBe("Old lore");
    expect(appendLegacyText("Existing tone.", "Sensory focus.")).toBe(
      "Existing tone.\n\nSensory focus."
    );
    expect(
      filterRemainingUnsupportedFields(
        { calendar_system: "13-month", "global_rules.narrative_style": "Noir" },
        new Set(["global_rules.narrative_style"])
      )
    ).toEqual({ calendar_system: "13-month" });
  });
});
