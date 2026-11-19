import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AppSidebar } from "../AppSidebar";
import { ChatStage } from "../ChatStage";
import { LiveInspector } from "../LiveInspector";
import type {
  CampaignStateBundle,
  CharacterRecord,
  LocationNode,
  PersonaRecord,
  UserNote,
  UserProfile,
  WorldRecord,
} from "../../types";

function makeFixtures() {
  const user: UserProfile = {
    id: "user_1",
    username: "runner",
    display_name: "Deck Runner",
    role: "admin",
    has_password: true,
    passkeys: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    last_login_at: null,
  };

  const persona: PersonaRecord = {
    id: "persona_default_user",
    owner_id: "user_1",
    name: "Merc",
    species: "Human",
    age: "28",
    age_is_secret: false,
    build_and_height: "178cm",
    physical_appearance: "Chrome-laced jacket",
    persona_bio: "Street fixer",
    tags: [],
    equipped: [],
    inventory: [],
    lore_entries: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };

  const loc: LocationNode = {
    id: "loc_1",
    world_id: "world_1",
    name: "Afterlife Bar",
    summary: "Underground merc bar.",
    description: "Neon-lit basement club.",
    environmental_tags: ["neon"],
    is_starting_location: true,
  };

  const world: WorldRecord = {
    id: "world_1",
    name: "Night Sector",
    global_rules: {
      genre: "Cyberpunk",
      tone: "Gritty",
      setting_overview: "Rain-slicked megacity.",
      tech_or_magic_rules: "Cyberware",
      starting_timestamp: "Day 1, 22:00",
    },
    created_at: "2026-01-01T00:00:00Z",
    containers: [],
    locations: [loc],
    edges: [],
    lore_nodes: [],
  };

  const character: CharacterRecord = {
    id: "char_1",
    version: 1,
    name: "Kira Vance",
    tagline: "Rogue signal broker",
    physical_appearance: "Silver hair and optic visor.",
    core_persona: "Guarded tactician.",
    initial_message: "Keep your voice down.",
    quirks_flaws: [],
    communication_style: [],
    inventory: [],
    voice_anchors: [],
    baseline_psyche: {
      mood_label: "Alert",
      valence: 0.1,
      arousal: 0.4,
      core_drive: "Stay hidden",
      core_fear: "Exposure",
      default_want: "Verify contact",
      default_plan: "Watch the stairs.",
    },
    memory_shards: [],
    tags: ["cyberpunk"],
    creator: "studio",
    creator_notes: "",
    portraits: {},
    gallery: [],
    created_at: "2026-01-01T00:00:00Z",
  };

  const bundle: CampaignStateBundle = {
    campaign: {
      id: "camp_1",
      name: "Operation Glass Horizon",
      world_id: world.id,
      character_id: character.id,
      persona_id: persona.id,
      persona_snapshot: persona,
      active_leaf_turn_id: "turn_0",
      created_at: "2026-01-01T00:00:00Z",
    },
    active_branch_turns: [],
    all_turn_nodes: [],
    current_world_snapshot: {
      turn_id: "turn_0",
      world_timestamp: "Day 1, 22:00",
      campaign_elapsed_minutes: 0,
      active_location_id: loc.id,
      scene_flags: [],
      visited_location_ids: [loc.id],
    },
    current_character_state: {
      turn_id: "turn_0",
      character_id: character.id,
      current_location_id: loc.id,
      mood_label: "Alert",
      valence: 0.1,
      arousal: 0.4,
      active_want: "Verify contact",
      active_plan: "Watch the stairs.",
      relationship_notes: {},
      inventory: [],
    },
    active_location: loc,
    neighbor_locations: [],
    containers: [],
    visible_locations: [loc],
    visible_edges: [],
    episodic_chunks: [],
  };

  const notes: UserNote[] = [
    {
      id: "note_1",
      owner_id: "user_1",
      title: "Clue",
      content: "Meet at booth 4",
      tags: ["afterlife"],
      is_starred: true,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
  ];

  return { user, persona, world, character, bundle, notes };
}

describe("Responsive campaign panels", () => {
  it("renders campaign-focused AppSidebar in icon-rail and overlay modes without catalog lists", () => {
    const { user, world, bundle, notes } = makeFixtures();
    const noop = vi.fn();

    const railHtml = renderToStaticMarkup(
      <AppSidebar
        mode="rail"
        onToggleCollapse={noop}
        bundle={bundle}
        worldName={world.name}
        codexCount={3}
        isCodexOpen={true}
        onOpenCodex={noop}
        notes={notes}
        showNotesFlyout={false}
        setShowNotesFlyout={noop}
        currentUser={user}
        singleUserMode={false}
        setNotesModalInitialId={noop}
        setShowNotesModal={noop}
        setProfileInitialTab={noop}
        setShowProfileModal={noop}
        setAdminInitialTab={noop}
        setShowAdminModal={noop}
        handleCloseCampaign={noop}
        handleLogout={async () => {}}
      />
    );

    expect(railHtml).toContain("sidebar--rail");
    expect(railHtml).toContain('aria-label="Expand sidebar"');
    expect(railHtml).toContain('aria-label="Open Campaign Codex"');
    expect(railHtml).toContain('aria-pressed="true"');
    expect(railHtml).toContain('aria-label="Close campaign and return to Home"');
    expect(railHtml).toContain("lucide-book-open");
    expect(railHtml).toContain("lucide-arrow-left");
    expect(railHtml).toContain("lucide-log-out");
    expect(railHtml).toContain("rail-badge-dot");
    expect(railHtml).toContain('aria-label="Open Admin Area"');
    expect(railHtml).not.toContain('aria-label="Personas');
    expect(railHtml).not.toContain('aria-label="Characters');
    expect(railHtml).not.toContain('aria-label="Worlds');
    expect(railHtml).not.toContain('aria-label="Campaigns');

    const overlayHtml = renderToStaticMarkup(
      <AppSidebar
        mode="overlay"
        onCloseOverlay={noop}
        bundle={bundle}
        worldName={world.name}
        codexCount={7}
        isCodexOpen={false}
        onOpenCodex={noop}
        notes={notes}
        showNotesFlyout={false}
        setShowNotesFlyout={noop}
        currentUser={user}
        singleUserMode={false}
        setNotesModalInitialId={noop}
        setShowNotesModal={noop}
        setProfileInitialTab={noop}
        setShowProfileModal={noop}
        setAdminInitialTab={noop}
        setShowAdminModal={noop}
        handleCloseCampaign={noop}
        handleLogout={async () => {}}
      />
    );

    expect(overlayHtml).toContain("sidebar--overlay");
    expect(overlayHtml).toContain('aria-label="Close sidebar"');
    expect(overlayHtml).toContain("Operation Glass Horizon");
    expect(overlayHtml).toContain("Night Sector");
    expect(overlayHtml).toContain("Close Campaign");
    expect(overlayHtml).toContain("Codex");
    expect(overlayHtml).toContain(">7<");
    expect(overlayHtml).toContain("lucide-arrow-left");
    expect(overlayHtml).toContain("lucide-log-out");
    expect(overlayHtml).toContain("Player Notes");
    expect(overlayHtml).toContain("Admin Area");
    expect(overlayHtml).not.toContain("Search characters, tags, creators...");
    expect(overlayHtml).not.toContain(">Personas<");
    expect(overlayHtml).not.toContain(">Characters<");
    expect(overlayHtml).not.toContain(">Worlds<");
    expect(overlayHtml).not.toContain(">Campaigns<");
  });

  it("renders ChatStage mobile menu toggle, inspector toggle, and no close campaign button", () => {
    const { character, bundle } = makeFixtures();
    const noop = vi.fn();

    const html = renderToStaticMarkup(
      <ChatStage
        bundle={bundle}
        character={character}
        isStreaming={false}
        liveStream={null}
        onSendTurn={noop}
        onCheckoutTurn={noop}
        showSidebarToggle
        isSidebarOpen={false}
        onToggleSidebar={noop}
        isInspectorOpen={false}
        onToggleInspector={noop}
        hasInspectorAttention
      />
    );

    expect(html).toContain('aria-controls="app-sidebar-aside"');
    expect(html).toContain('aria-controls="live-inspector-aside"');
    expect(html).toContain("stage-attention-dot");
    expect(html).toContain("stage-header-badges");
    expect(html).not.toContain("btn-close-campaign");
    expect(html).not.toContain("Close Campaign");
  });

  it("renders LiveInspector collapse controls and aria-hidden state cleanly", () => {
    const { world, character, bundle } = makeFixtures();
    const noop = vi.fn();

    const hiddenHtml = renderToStaticMarkup(
      <LiveInspector
        mode="hidden"
        onClose={noop}
        onOpenWorldSheet={noop}
        bundle={bundle}
        world={world}
        character={character}
      />
    );
    expect(hiddenHtml).toContain("inspector--hidden");
    expect(hiddenHtml).toContain('aria-hidden="true"');
    expect(hiddenHtml).toContain('aria-label="Collapse inspector"');
    expect(hiddenHtml).toContain("World Sheet");

    const overlayHtml = renderToStaticMarkup(
      <LiveInspector
        mode="overlay"
        onClose={noop}
        bundle={bundle}
        world={world}
        character={character}
      />
    );
    expect(overlayHtml).toContain("inspector--overlay");
    expect(overlayHtml).toContain('aria-label="Close inspector"');
  });
});
