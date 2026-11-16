import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CharacterRecord } from "../../types";
import { CharacterInspectorModal } from "../character/CharacterInspectorModal";
import { CharacterUnsupportedTab } from "../character/CharacterUnsupportedTab";
import {
  appendLegacyBio,
  buildUnsupportedFieldsState,
  filterRemainingUnsupportedFields,
  mergeUniqueDistinctiveFeatures,
} from "../character/unsupportedFields";

function makeBaseCharacter(overrides: Partial<CharacterRecord> = {}): CharacterRecord {
  return {
    id: "char_test_1",
    name: "Kira Vance",
    tagline: "Underground medic",
    character_bio: "Former Vespera surgeon.",
    physical_appearance: "",
    species: "Human",
    sex: "Female",
    pronouns: "she/her",
    age: "34",
    build_and_height: "170 cm",
    distinctive_features: ["Hazel eyes"],
    posture: "Alert",
    mannerisms: ["Wipes counter"],
    modifications: [],
    visual_aesthetic: "Utilitarian",
    personality_traits: ["cynical"],
    core_persona: "Clipped and pragmatic.",
    moral_code: ["No freebies"],
    quirks_flaws: ["Distrustful"],
    communication_style: ["clipped"],
    initial_message: "Talk.",
    equipped: [],
    inventory: [],
    voice_anchors: [],
    baseline_psyche: {
      mood_label: "Wary & Guarded",
      valence: -0.2,
      arousal: 0.4,
      core_drive: "Survive",
      core_fear: "Capture",
      default_want: "Intel",
      default_plan: "- Ask questions",
    },
    memory_shards: [],
    tags: [],
    creator: "",
    creator_notes: "",
    portraits: {},
    gallery: [],
    unsupported_fields: {},
    version: 1,
    created_at: "2026-11-16T00:00:00Z",
    ...overrides,
  };
}

describe("Unsupported character fields helpers & UI", () => {
  it("hides Unsupported tab for canonical characters and exact physical_appearance duplicates", () => {
    const cleanChar = makeBaseCharacter();
    expect(buildUnsupportedFieldsState(cleanChar)).toEqual({});

    const dupChar = makeBaseCharacter({
      character_bio: "Same text.",
      physical_appearance: "Same text.",
    });
    expect(buildUnsupportedFieldsState(dupChar)).toEqual({});

    const html = renderToStaticMarkup(
      <CharacterInspectorModal
        character={dupChar}
        worlds={[]}
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    expect(html).not.toContain(">Unsupported<");
  });

  it("shows Unsupported tab with count badge for legacy and future keys", () => {
    const charWithUnsupported = makeBaseCharacter({
      physical_appearance: "Distinct legacy physical text",
      modifications: ["Chrome left arm"],
      unsupported_fields: {
        future_voice_id: "voice_v99",
      },
    });
    const state = buildUnsupportedFieldsState(charWithUnsupported);
    expect(state).toEqual({
      future_voice_id: "voice_v99",
      physical_appearance: "Distinct legacy physical text",
      modifications: ["Chrome left arm"],
    });

    const html = renderToStaticMarkup(
      <CharacterInspectorModal
        character={charWithUnsupported}
        worlds={[]}
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    expect(html).toContain("Unsupported");
    expect(html).toContain("Distinct legacy physical text");
    expect(html).toContain("Chrome left arm");
    expect(html).toContain("voice_v99");
    expect(html).toContain("Deprecated");
  });

  it("renders read-only badges, staged deletion Undo, and hides actions when readOnly", () => {
    const editableHtml = renderToStaticMarkup(
      <CharacterUnsupportedTab
        isActive={true}
        unsupportedFields={{
          physical_appearance: "Legacy appearance text",
          future_stat: { level: 5 },
        }}
        stagedDeletes={new Set(["future_stat"])}
        characterBio=""
        readOnly={false}
        onStageDelete={() => {}}
        onUndoDelete={() => {}}
        onCopyLegacyPhysicalToBio={() => {}}
        onMoveLegacyModificationsToFeatures={() => {}}
      />
    );
    expect(editableHtml).toContain("Copy to Bio");
    expect(editableHtml).toContain("Move to Bio &amp; Delete");
    expect(editableHtml).toContain("Marked for deletion");
    expect(editableHtml).toContain("Undo");

    const readOnlyHtml = renderToStaticMarkup(
      <CharacterUnsupportedTab
        isActive={true}
        unsupportedFields={{
          physical_appearance: "Legacy appearance text",
        }}
        stagedDeletes={new Set()}
        characterBio=""
        readOnly={true}
        onStageDelete={() => {}}
        onUndoDelete={() => {}}
        onCopyLegacyPhysicalToBio={() => {}}
        onMoveLegacyModificationsToFeatures={() => {}}
      />
    );
    expect(readOnlyHtml).toContain("Deprecated");
    expect(readOnlyHtml).not.toContain("Delete");
    expect(readOnlyHtml).not.toContain("Copy to Bio");
  });

  it("handles copy/append, deduplicated feature moves, and staged deletion filtering", () => {
    expect(appendLegacyBio("", "Legacy text")).toBe("Legacy text");
    expect(appendLegacyBio("Existing bio.", "Legacy text")).toBe("Existing bio.\n\nLegacy text");

    expect(
      mergeUniqueDistinctiveFeatures(["Chrome Arm", "Hazel eyes"], [
        "chrome arm",
        "Subdermal shard",
      ])
    ).toEqual(["Chrome Arm", "Hazel eyes", "Subdermal shard"]);

    expect(
      filterRemainingUnsupportedFields(
        { physical_appearance: "old", future_key: 123 },
        new Set(["physical_appearance"])
      )
    ).toEqual({ future_key: 123 });
  });
});
