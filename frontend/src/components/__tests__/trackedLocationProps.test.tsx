import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  CharacterRecord,
  LocationContainer,
  LocationNode,
  LoreNode,
  WorldRecord,
} from "../../types";
import type { SlashCommandAvailabilityContext } from "../../utils/slashCommands";
import { ChatComposer } from "../chat/ChatComposer";
import { MapDetailsDrawer } from "../map/MapDetailsDrawer";
import { CONTAINER_DEPTH_LABELS } from "../map/topologyProjection";
import { WorldInspectorModal } from "../world/WorldInspectorModal";
import { MECHANICS_ARTICLES } from "../world/mechanics/mechanicsCatalog";

const noop = () => {};

const TEST_CHAR: CharacterRecord = {
  id: "char_yulia",
  version: 1,
  name: "Yulia Halim",
  tagline: "Signal courier",
  physical_appearance: "Leather coat",
  core_persona: "Watchful",
  communication_style: ["Terse"],
  quirks_flaws: ["Guarded"],
  moral_code: ["Honor contracts"],
  baseline_psyche: {
    mood_label: "Alert",
    valence: 0.1,
    arousal: 0.6,
    core_drive: "Protect crew",
    core_fear: "Exposure",
    default_want: "Exit clean",
    default_plan: "Watch perimeter",
  },
  voice_anchors: [],
  equipped: [],
  inventory: [],
  memory_shards: [],
  initial_message: "Keep moving.",
  tags: [],
  creator: "test",
  creator_notes: "",
  portraits: {},
  gallery: [],
  created_at: "2026-01-01T00:00:00Z",
};

const DEFAULT_CTX: SlashCommandAvailabilityContext = {
  presentCharacterCount: 1,
  eligiblePartyInviteCount: 1,
  inPlayerParty: true,
  isEditingTurn: false,
  searchCooldownRemaining: 0,
};

function renderComposer(
  overrides: Partial<React.ComponentProps<typeof ChatComposer>> = {}
) {
  return renderToStaticMarkup(
    <ChatComposer
      composerBarRef={{ current: null }}
      narratorBtnRef={{ current: null }}
      exitsBtnRef={{ current: null }}
      textareaRef={{ current: null }}
      character={TEST_CHAR}
      editingTurn={null}
      activeTray="none"
      setActiveTray={vi.fn()}
      activePopover="none"
      setActivePopover={vi.fn()}
      customDirectiveText=""
      setCustomDirectiveText={vi.fn()}
      presentCharacters={[TEST_CHAR]}
      allCampaignCharacters={[TEST_CHAR]}
      presentCharacterIds={[TEST_CHAR.id]}
      stagedChoices={{}}
      activeChoiceCharId={TEST_CHAR.id}
      setActiveChoiceCharId={vi.fn()}
      activeCharRecord={TEST_CHAR}
      totalStagedOptionsCount={0}
      diceMode="auto"
      setDiceMode={vi.fn()}
      diceOverride=""
      setDiceOverride={vi.fn()}
      hasActiveGates={false}
      choicePreview={null}
      choiceSlashWarning={null}
      partySlashWarning={null}
      decomposedInput={{
        raw_message: "",
        public_text: "",
        whispers: [],
        whispers_by_character_id: {},
        remote_whispers: [],
      }}
      mentionPickerOpen={false}
      setMentionPickerOpen={vi.fn()}
      mentionQuery=""
      mentionSelectedIndex={0}
      setMentionSelectedIndex={vi.fn()}
      filteredMentionCharacters={[]}
      inputText=""
      setInputText={vi.fn()}
      isBusy={false}
      magicWand={{
        status: "idle",
        error: null,
        canEnrich: false,
        canRevert: false,
        isDirtyAfterApply: false,
        triggerEnrich: vi.fn(),
        cancelEnrich: vi.fn(),
        revert: vi.fn(),
        dismissUndo: vi.fn(),
        reset: vi.fn(),
      }}
      activeLocationName="Neon Rust Floor"
      neighborLocations={[]}
      handleSelectMention={vi.fn()}
      handleRemoveMentionChip={vi.fn()}
      checkAndTriggerMention={vi.fn()}
      handleInvokeNarrator={vi.fn()}
      handleInvokeSearch={vi.fn()}
      handleQuickExit={vi.fn()}
      handleSendCustomDirective={vi.fn()}
      handleClearAllChoices={vi.fn()}
      handleClearCharChoices={vi.fn()}
      handleSetDC={vi.fn()}
      handleAddOption={vi.fn()}
      handleUpdateOption={vi.fn()}
      handleRemoveOption={vi.fn()}
      handleCancelEdit={vi.fn()}
      handleSend={vi.fn()}
      slashAvailabilityContext={DEFAULT_CTX}
      {...overrides}
    />
  );
}

function makePropWorld(): {
  containerL1: LocationContainer;
  containerL2: LocationContainer;
  location: LocationNode;
  artifactLore: LoreNode;
  world: WorldRecord;
} {
  const containerL2: LocationContainer = {
    id: "cont_l2",
    world_id: "w1",
    depth: 2,
    name: "Dockside Sector",
    description: "Industrial sector.",
    environmental_tags: ["rain"],
    lore_nodes: [],
  };
  const containerL1: LocationContainer = {
    id: "cont_l1",
    world_id: "w1",
    parent_container_id: "cont_l2",
    depth: 1,
    name: "Old Cannery",
    description: "Brick cannery warehouse.",
    environmental_tags: ["rust"],
    lore_nodes: [],
  };
  const artifactLore: LoreNode = {
    id: "art_1",
    world_id: "w1",
    title: "Void Seal",
    category: "artifact",
    content: "Carved obsidian signet.",
    entity_tags: ["seal", "obsidian"],
  };
  const location: LocationNode = {
    id: "loc_1",
    world_id: "w1",
    container_id: "cont_l1",
    name: "Foreman's Office",
    summary: "Cramped glass booth overlooking the canning floor.",
    description: "A grease-stained desk sits beneath cracked panes.",
    environmental_tags: ["cramped"],
    is_starting_location: true,
    is_hub: false,
    is_visited: true,
    lore_nodes: [],
    props: [
      {
        id: "prop_vis",
        name: "Brass Keycard",
        note: "Stamped 'GATE-4'.",
        flags: ["artifact"],
        lore_id: "art_1",
        is_hidden: false,
        auto_spawned: true,
      },
      {
        id: "prop_hid",
        name: "Hidden Ledger",
        note: "Tucked behind the loose baseboard.",
        flags: ["permanent"],
        lore_id: null,
        is_hidden: true,
      },
    ],
  };
  const world: WorldRecord = {
    id: "w1",
    name: "Harbor District",
    global_rules: {
      genre: "Noir",
      tone: "Gritty",
      setting_overview: "Foggy port city.",
      tech_or_magic_rules: "Grounded tech.",
      starting_timestamp: "2026-06-01 21:00",
      describe_on_first_visit: true,
      auto_spawn_props_on_search_crit: false,
    },
    containers: [containerL2, containerL1],
    locations: [location],
    edges: [],
    lore_nodes: [artifactLore],
    created_at: "2026-06-01T21:00:00Z",
  };
  return { containerL1, containerL2, location, artifactLore, world };
}

describe("tracked location props & /search frontend UI", () => {
  it("renders ChatComposer Search button with cooldown disable and GM bypass tooltips", () => {
    const readyHtml = renderComposer({
      searchCooldownRemaining: 0,
      isGmMode: false,
    });
    expect(readyHtml).toContain('aria-label="Search Room"');
    expect(readyHtml).toContain(
      "Search the current room for hidden props &amp; secrets (DC 12) [/search]"
    );

    const cooldownHtml = renderComposer({
      searchCooldownRemaining: 3,
      isGmMode: false,
    });
    expect(cooldownHtml).toContain(
      "Search on cooldown in this room (3 turns remaining)"
    );
    expect(cooldownHtml).toContain("3t");
    expect(cooldownHtml).toContain("disabled");

    const gmHtml = renderComposer({
      searchCooldownRemaining: 0,
      isGmMode: true,
    });
    expect(gmHtml).toContain(
      "Search the current room for hidden props &amp; secrets [/search] (GM Mode bypasses cooldown)"
    );
  });

  it("renders Location Props only on Level 0 Locations (never on Level 1-4 Containers)", () => {
    const { containerL1, containerL2, location, artifactLore } = makePropWorld();

    const locEditorHtml = renderToStaticMarkup(
      <MapDetailsDrawer
        mode="editor"
        selectedLocation={location}
        selectedContainer={null}
        containers={[containerL2, containerL1]}
        allLocations={[location]}
        dynamicPortalIds={new Set()}
        externalPortals={[]}
        containerStats={null}
        depthLabels={CONTAINER_DEPTH_LABELS}
        onClose={noop}
        onPatchLocation={noop}
        onPatchContainer={noop}
        onResetCoordinates={noop}
        onDrillIntoContainer={noop}
        worldArtifactLore={[artifactLore]}
      />
    );
    expect(locEditorHtml).toContain("Location Props (2)");
    expect(locEditorHtml).toContain("Add Prop");
    expect(locEditorHtml).toContain("Brass Keycard");
    expect(locEditorHtml).toContain("Hidden Ledger");

    for (const cont of [containerL1, containerL2]) {
      const contHtml = renderToStaticMarkup(
        <MapDetailsDrawer
          mode="editor"
          selectedLocation={null}
          selectedContainer={cont}
          containers={[containerL2, containerL1]}
          allLocations={[location]}
          dynamicPortalIds={new Set()}
          externalPortals={[]}
          containerStats={null}
          depthLabels={CONTAINER_DEPTH_LABELS}
          onClose={noop}
          onPatchLocation={noop}
          onPatchContainer={noop}
          onResetCoordinates={noop}
          onDrillIntoContainer={noop}
          worldArtifactLore={[artifactLore]}
        />
      );
      expect(contHtml).not.toContain("Location Props");
      expect(contHtml).not.toContain("Add Prop");
    }
  });

  it("redacts unrevealed hidden props in Player Mode and exposes Reveal + Transfer in GM Mode", () => {
    const { containerL1, containerL2, location, artifactLore } = makePropWorld();

    const playerHiddenHtml = renderToStaticMarkup(
      <MapDetailsDrawer
        mode="campaign"
        selectedLocation={location}
        selectedContainer={null}
        containers={[containerL2, containerL1]}
        allLocations={[location]}
        dynamicPortalIds={new Set()}
        externalPortals={[]}
        containerStats={null}
        depthLabels={CONTAINER_DEPTH_LABELS}
        onClose={noop}
        onPatchLocation={noop}
        onPatchContainer={noop}
        onResetCoordinates={noop}
        onDrillIntoContainer={noop}
        unlockLore={false}
        revealedPropIds={[]}
        worldArtifactLore={[artifactLore]}
      />
    );
    expect(playerHiddenHtml).toContain("Location Props (1)");
    expect(playerHiddenHtml).toContain("Brass Keycard");
    expect(playerHiddenHtml).toContain("Auto-spawned");
    expect(playerHiddenHtml).toContain("Linked Artifact: Void Seal");
    expect(playerHiddenHtml).not.toContain("Hidden Ledger");
    expect(playerHiddenHtml).not.toContain("Hidden (GM)");

    const playerRevealedHtml = renderToStaticMarkup(
      <MapDetailsDrawer
        mode="campaign"
        selectedLocation={location}
        selectedContainer={null}
        containers={[containerL2, containerL1]}
        allLocations={[location]}
        dynamicPortalIds={new Set()}
        externalPortals={[]}
        containerStats={null}
        depthLabels={CONTAINER_DEPTH_LABELS}
        onClose={noop}
        onPatchLocation={noop}
        onPatchContainer={noop}
        onResetCoordinates={noop}
        onDrillIntoContainer={noop}
        unlockLore={false}
        revealedPropIds={["prop_hid"]}
        worldArtifactLore={[artifactLore]}
      />
    );
    expect(playerRevealedHtml).toContain("Location Props (2)");
    expect(playerRevealedHtml).toContain("Hidden Ledger");
    expect(playerRevealedHtml).toContain("Discovered");

    const gmHtml = renderToStaticMarkup(
      <MapDetailsDrawer
        mode="campaign"
        selectedLocation={location}
        selectedContainer={null}
        containers={[containerL2, containerL1]}
        allLocations={[location]}
        dynamicPortalIds={new Set()}
        externalPortals={[]}
        containerStats={null}
        depthLabels={CONTAINER_DEPTH_LABELS}
        onClose={noop}
        onPatchLocation={noop}
        onPatchContainer={noop}
        onResetCoordinates={noop}
        onDrillIntoContainer={noop}
        unlockLore
        revealedPropIds={[]}
        worldArtifactLore={[artifactLore]}
        propTransferTargets={[
          { id: "player", label: "Player (Kael)" },
          { id: TEST_CHAR.id, label: TEST_CHAR.name },
        ]}
        onSaveCampaignLocationProps={noop}
        onTogglePropReveal={noop}
        onTransferProp={noop}
      />
    );
    expect(gmHtml).toContain("Location Props (2)");
    expect(gmHtml).toContain("Hidden (GM)");
    expect(gmHtml).toContain("Reveal");
    expect(gmHtml).toContain("Transfer");
    expect(gmHtml).toContain("Player (Kael)");
    expect(gmHtml).toContain("Yulia Halim");
    expect(gmHtml).toContain("Add Prop");
  });

  it("renders Auto-spawn situational props toggle in World Settings", () => {
    const { world } = makePropWorld();
    const html = renderToStaticMarkup(
      <WorldInspectorModal
        world={world}
        mode="campaign"
        initialTab="settings"
        campaignWorldSettings={{
          describe_on_first_visit: true,
          unlock_lore: false,
          auto_spawn_props_on_search_crit: true,
        }}
        onClose={noop}
        onSaved={noop}
      />
    );
    expect(html).toContain(
      "Auto-spawn situational props on /search Critical Success"
    );
    expect(html).toContain("never weapons, currencies, or master keys");
  });

  it("documents /search, DC 12, cooldown, and Location Props in mechanicsCatalog", () => {
    const byId = new Map(MECHANICS_ARTICLES.map((a) => [a.id, a]));
    expect(JSON.stringify(byId.get("dice-modes"))).toContain("/search");
    expect(JSON.stringify(byId.get("dice-modes"))).toContain("DC 12");
    expect(JSON.stringify(byId.get("directing-narrator-clock"))).toContain(
      "5-turn"
    );
    expect(JSON.stringify(byId.get("spatial-hierarchy-portals"))).toContain(
      "Location Props"
    );
    expect(JSON.stringify(byId.get("memory-lore-flags"))).toContain(
      "auto-spawn"
    );
    expect(JSON.stringify(byId.get("gm-mode"))).toContain("cooldown");
  });
});
