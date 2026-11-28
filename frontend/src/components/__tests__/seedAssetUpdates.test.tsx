import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CharacterRecord, SeedUpdateInfo, WorldRecord } from "../../types";
import { HomeEntityPickerModal } from "../HomeEntityPickerModal";
import { HomeScreen } from "../HomeScreen";
import { SeedUpdateModal } from "../SeedUpdateModal";
import { CharacterInspectorModal } from "../character/CharacterInspectorModal";
import { WorldInspectorModal } from "../world/WorldInspectorModal";

function makeSeedUpdate(overrides: Partial<SeedUpdateInfo> = {}): SeedUpdateInfo {
  return {
    seed_key: "showcase:the_green_lie",
    current_version: 2,
    latest_version: 3,
    update_available: true,
    seed_modified: false,
    dismissed_version: null,
    is_dismissed: false,
    changelog: "v3: Upgraded spatial topology and tracked props.",
    has_custom_media: false,
    active_campaigns_count: 0,
    linked_characters_count: 1,
    ...overrides,
  };
}

function makeWorld(seedUpdate: SeedUpdateInfo | null = null): WorldRecord {
  return {
    id: "world_1",
    name: "The Green Lie",
    global_rules: {
      genre: "Cyberpunk",
      tone: "Noir",
      setting_overview: "Under-city.",
      tech_or_magic_rules: "Cyberware.",
      starting_timestamp: "2087-10-14 21:30",
      describe_on_first_visit: true,
    },
    created_at: "2026-01-01T00:00:00Z",
    containers: [],
    locations: [
      {
        id: "loc_1",
        world_id: "world_1",
        name: "Main Floor",
        summary: "Neon bar",
        description: "Chrome and smoke.",
        environmental_tags: [],
        is_starting_location: true,
        lore_nodes: [],
      },
    ],
    edges: [],
    lore_nodes: [],
    media: [],
    seed_update: seedUpdate,
  };
}

function makeCharacter(seedUpdate: SeedUpdateInfo | null = null): CharacterRecord {
  return {
    id: "char_1",
    world_id: "world_1",
    name: "Yulia Halim",
    tagline: "Streetwise fixer",
    character_bio: "Former courier.",
    species: "Human",
    sex: "Female",
    pronouns: "she/her",
    age: "27",
    build_and_height: "170 cm, athletic",
    distinctive_features: [],
    posture: "Alert",
    mannerisms: [],
    visual_aesthetic: "Techwear",
    personality_traits: ["sharp"],
    core_persona: "Pragmatic survivor.",
    moral_code: ["Never sell out friends"],
    quirks_flaws: ["Impatient"],
    communication_style: ["Direct"],
    initial_message: "Hey.",
    equipped: [],
    inventory: [],
    voice_anchors: [],
    baseline_psyche: {
      mood_label: "Guarded",
      valence: 0.0,
      arousal: 0.3,
      core_drive: "Survive the under-city",
      core_fear: "Being cornered by Aegis",
      default_want: "Stay ahead",
      default_plan: "Watch exits",
    },
    memory_shards: [],
    tags: ["fixer"],
    creator: "CyberCantina Team",
    creator_notes: "",
    portraits: {},
    gallery: [],
    version: 1,
    created_at: "2026-01-01T00:00:00Z",
    seed_update: seedUpdate,
  };
}

describe("Seeded Asset Update UI", () => {
  it("shows update badges on HomeScreen cards only for unskipped updates", () => {
    const outdatedHtml = renderToStaticMarkup(
      <HomeScreen
        personas={[]}
        characters={[makeCharacter(makeSeedUpdate({ seed_key: "showcase:kira_vance" }))]}
        worlds={[makeWorld(makeSeedUpdate())]}
        campaigns={[]}
        activePersona={null}
        currentUser={null}
        singleUserMode={true}
        onSelectCampaign={vi.fn()}
        onInspectCharacter={vi.fn()}
        onInspectWorld={vi.fn()}
        onEditPersona={vi.fn()}
        onNewCampaign={vi.fn()}
        onNewCharacter={vi.fn()}
        onNewWorld={vi.fn()}
        onNewPersona={vi.fn()}
        onSetActivePersona={vi.fn()}
        onOpenProfile={vi.fn()}
        onOpenAdmin={vi.fn()}
        onOpenNotes={vi.fn()}
        onLogout={vi.fn()}
      />
    );
    expect(outdatedHtml).toContain("home-card-update-badge");
    expect(outdatedHtml).toContain("Update available");

    const skippedHtml = renderToStaticMarkup(
      <HomeScreen
        personas={[]}
        characters={[
          makeCharacter(
            makeSeedUpdate({
              seed_key: "showcase:kira_vance",
              is_dismissed: true,
              dismissed_version: 3,
            })
          ),
        ]}
        worlds={[
          makeWorld(makeSeedUpdate({ is_dismissed: true, dismissed_version: 3 })),
        ]}
        campaigns={[]}
        activePersona={null}
        currentUser={null}
        singleUserMode={true}
        onSelectCampaign={vi.fn()}
        onInspectCharacter={vi.fn()}
        onInspectWorld={vi.fn()}
        onEditPersona={vi.fn()}
        onNewCampaign={vi.fn()}
        onNewCharacter={vi.fn()}
        onNewWorld={vi.fn()}
        onNewPersona={vi.fn()}
        onSetActivePersona={vi.fn()}
        onOpenProfile={vi.fn()}
        onOpenAdmin={vi.fn()}
        onOpenNotes={vi.fn()}
        onLogout={vi.fn()}
      />
    );
    expect(skippedHtml).not.toContain("home-card-update-badge");
  });

  it("shows Update button in HomeEntityPickerModal only when unskipped", () => {
    const activeHtml = renderToStaticMarkup(
      <HomeEntityPickerModal
        category="worlds"
        personas={[]}
        characters={[]}
        worlds={[makeWorld(makeSeedUpdate())]}
        campaigns={[]}
        onClose={vi.fn()}
        onSelectCampaign={vi.fn()}
        onSelectCharacter={vi.fn()}
        onSelectWorld={vi.fn()}
        onSelectPersona={vi.fn()}
        onNewClick={vi.fn()}
        onUpdateWorld={vi.fn()}
      />
    );
    expect(activeHtml).toContain("home-picker-update-btn");
    expect(activeHtml).toContain("Update");

    const skippedHtml = renderToStaticMarkup(
      <HomeEntityPickerModal
        category="worlds"
        personas={[]}
        characters={[]}
        worlds={[makeWorld(makeSeedUpdate({ is_dismissed: true }))]}
        campaigns={[]}
        onClose={vi.fn()}
        onSelectCampaign={vi.fn()}
        onSelectCharacter={vi.fn()}
        onSelectWorld={vi.fn()}
        onSelectPersona={vi.fn()}
        onNewClick={vi.fn()}
        onUpdateWorld={vi.fn()}
      />
    );
    expect(skippedHtml).not.toContain("home-picker-update-btn");
  });

  it("renders unmodified compact view vs modified 3-option view in SeedUpdateModal", () => {
    const unmodifiedHtml = renderToStaticMarkup(
      <SeedUpdateModal
        entityKind="world"
        entityName="The Green Lie"
        seedUpdate={makeSeedUpdate({ seed_modified: false, active_campaigns_count: 2 })}
        onConfirm={vi.fn()}
        onDismissVersion={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(unmodifiedHtml).toContain("v2 → v3");
    expect(unmodifiedHtml).toContain("Update World");
    expect(unmodifiedHtml).toContain("2 active campaigns currently use this world");
    expect(unmodifiedHtml).not.toContain("Save Copy &amp; Update");

    const modifiedHtml = renderToStaticMarkup(
      <SeedUpdateModal
        entityKind="world"
        entityName="The Green Lie"
        seedUpdate={makeSeedUpdate({ seed_modified: true, has_custom_media: true })}
        onConfirm={vi.fn()}
        onDismissVersion={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(modifiedHtml).toContain("Manual edits detected.");
    expect(modifiedHtml).toContain("The Green Lie (Custom Copy)");
    expect(modifiedHtml).toContain("Custom uploaded media is attached");
    expect(modifiedHtml).toContain("Save Copy &amp; Update");
    expect(modifiedHtml).toContain("Replace &amp; Discard Edits");
    expect(modifiedHtml).toContain("Skip v3");
  });

  it("shows inspector update banner in library mode and suppresses it in campaign mode", () => {
    const inspectorHtml = renderToStaticMarkup(
      <WorldInspectorModal
        world={makeWorld(makeSeedUpdate())}
        mode="inspector"
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onRequestSeedUpdate={vi.fn()}
      />
    );
    expect(inspectorHtml).toContain("Update available (v2 → v3)");
    expect(inspectorHtml).toContain("seed-update-banner is-cyan");

    const skippedInspectorHtml = renderToStaticMarkup(
      <WorldInspectorModal
        world={makeWorld(makeSeedUpdate({ is_dismissed: true, dismissed_version: 3 }))}
        mode="inspector"
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onRequestSeedUpdate={vi.fn()}
      />
    );
    expect(skippedInspectorHtml).toContain("Built-in seed v3 available (skipped)");
    expect(skippedInspectorHtml).toContain("Review Update");

    const campaignHtml = renderToStaticMarkup(
      <WorldInspectorModal
        world={makeWorld(makeSeedUpdate())}
        mode="campaign"
        campaignId="camp_1"
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onRequestSeedUpdate={vi.fn()}
      />
    );
    expect(campaignHtml).not.toContain("seed-update-banner");
    expect(campaignHtml).not.toContain("Update available");

    const charHtml = renderToStaticMarkup(
      <CharacterInspectorModal
        character={makeCharacter(makeSeedUpdate({ seed_key: "showcase:kira_vance" }))}
        worlds={[makeWorld()]}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onRequestSeedUpdate={vi.fn()}
      />
    );
    expect(charHtml).toContain("seed-update-banner is-amber");
    expect(charHtml).toContain("Update available (v2 → v3)");
  });
});
