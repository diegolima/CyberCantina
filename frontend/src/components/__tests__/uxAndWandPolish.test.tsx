import ReactDOMServer from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  LocationContainer,
  LocationEdge,
  LocationNode,
  LoreNode,
  PersonaRecord,
  UserProfile,
  WorldRecord,
} from "../../types";
import { HomeScreen } from "../HomeScreen";
import { MapDetailsDrawer } from "../map/MapDetailsDrawer";
import { MapLoreSection } from "../map/MapLoreSection";
import { TopologyHeaderToolbar } from "../map/TopologyHeaderToolbar";
import { projectTopologyForDepth } from "../map/topologyProjection";
import { SplitSaveButton } from "../shared/SplitSaveButton";
import { CodexLoreEditor } from "../world/CodexLoreEditor";
import { WorldInspectorModal } from "../world/WorldInspectorModal";

const TEST_USER: UserProfile = {
  id: "user_1",
  username: "tester",
  display_name: "VeryLongTesterDisplayName",
  role: "admin",
  has_password: true,
  passkeys: [],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const TEST_PERSONA: PersonaRecord = {
  id: "pers_1",
  owner_id: "user_1",
  name: "Kael",
  tagline: "Courier",
  species: "Human",
  age: "29",
  age_is_secret: false,
  sex: "Male",
  pronouns: "he/him",
  persona_bio: "Seasoned runner.",
  tags: ["runner"],
  build_and_height: "178 cm",
  distinctive_features: ["Crooked smile"],
  lore_entries: [],
  equipped: [],
  inventory: [],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const TEST_CONTAINER: LocationContainer = {
  id: "cont_rust",
  world_id: "world_1",
  parent_container_id: null,
  depth: 1,
  name: "The Neon Rust",
  description: "Subterranean club entrance.",
  environmental_tags: ["damp concrete", "distant bass"],
  lore_nodes: [],
};

const TEST_LOCATION: LocationNode = {
  id: "loc_hatch",
  world_id: "world_1",
  container_id: "cont_rust",
  name: "Service Hatch",
  summary: "Corroded floor hatch in the rear alley.",
  description: "A corroded hatch sits at the end of a narrow alley.",
  environmental_tags: ["peeling paint", "oil sheen"],
  is_starting_location: true,
  is_hub: false,
  lore_nodes: [
    {
      id: "lore_loc_1",
      world_id: "world_1",
      location_id: "loc_hatch",
      title: "Drainage Seal",
      category: "rumor",
      content: "Locked since the autumn flood.",
      entity_tags: ["hatch", "flood"],
    },
  ],
};

const TEST_WORLD_LORE: LoreNode = {
  id: "lore_world_1",
  world_id: "world_1",
  title: "Algae Grid",
  category: "history",
  content: "Municipal bio-filters built beneath the lower wards.",
  entity_tags: ["algae", "filters"],
};

const TEST_WORLD: WorldRecord = {
  id: "world_1",
  name: "Lower Wards",
  global_rules: {
    genre: "Biopunk Noir",
    tone: "Gritty",
    setting_overview: "Flooded industrial tiers.",
    tech_or_magic_rules: "Bio-engineered infrastructure.",
    starting_timestamp: "2094-11-14 20:00",
  },
  containers: [TEST_CONTAINER],
  locations: [TEST_LOCATION],
  edges: [],
  lore_nodes: [TEST_WORLD_LORE],
  media: [],
  pending_deletion: false,
  created_at: "2026-01-01T00:00:00Z",
};

describe("HomeScreen mobile navbar responsiveness hooks", () => {
  it("renders responsive brand, button-label, profile truncation, and aria attributes", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <HomeScreen
        personas={[TEST_PERSONA]}
        characters={[]}
        worlds={[TEST_WORLD]}
        campaigns={[]}
        activePersona={TEST_PERSONA}
        currentUser={TEST_USER}
        singleUserMode={false}
        canInstallApp
        notesCount={4}
        onInstallApp={vi.fn()}
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
    expect(html).toContain('aria-label="CyberCantina"');
    expect(html).toContain('class="home-nav-brand-text"');
    expect(html).toContain('class="home-nav-btn-label"');
    expect(html).toContain('class="home-nav-badge">4<');
    expect(html).toContain('class="home-nav-profile-name"');
    expect(html).toContain("home-nav-profile-role");
    expect(html).toContain('aria-label="Install App"');
    expect(html).toContain('aria-label="Open Notes Manager (4)"');
    expect(html).toContain('aria-label="Open Admin Area"');
    expect(html).toContain('aria-label="Sign out"');
  });
});

describe("SplitSaveButton & stay-open Map/World save controls", () => {
  it("renders a single button when onSaveAndClose is omitted and a split button when provided", () => {
    const plainHtml = ReactDOMServer.renderToStaticMarkup(
      <SplitSaveButton
        label="Save Map"
        onSave={vi.fn()}
        testId="plain-save"
      />
    );
    expect(plainHtml).not.toContain("ui-split-btn__toggle");
    expect(plainHtml).toContain("Save Map");

    const splitHtml = ReactDOMServer.renderToStaticMarkup(
      <SplitSaveButton
        label="Save Map"
        onSave={vi.fn()}
        onSaveAndClose={vi.fn()}
        testId="split-save"
      />
    );
    expect(splitHtml).toContain("ui-split-btn__main");
    expect(splitHtml).toContain("ui-split-btn__toggle");
    expect(splitHtml).toContain('aria-haspopup="menu"');
    expect(splitHtml).toContain('aria-expanded="false"');
  });

  it("renders Save Map split toggle in TopologyHeaderToolbar only when Save & Close callback exists", () => {
    const projected = projectTopologyForDepth(
      null,
      [TEST_CONTAINER],
      [TEST_LOCATION],
      [] as LocationEdge[],
      TEST_LOCATION.id,
      {},
      { mode: "editor", unlockLore: false, revealedEdgeIds: [] }
    );

    const noCloseHtml = ReactDOMServer.renderToStaticMarkup(
      <TopologyHeaderToolbar
        locationsCount={1}
        edgesCount={0}
        containersCount={1}
        hasSaveMap
        effectiveDirty
        hasBlockingErrors={false}
        effectiveSaving={false}
        isMutatingLocked={false}
        validationSummary={null}
        handleSaveClick={vi.fn()}
        handleCloseClick={vi.fn()}
        currentContainerId={null}
        projectedTopology={projected}
        drillIntoContainer={vi.fn()}
      />
    );
    expect(noCloseHtml).toContain("Save Map");
    expect(noCloseHtml).not.toContain("ui-split-btn__toggle");

    const withCloseHtml = ReactDOMServer.renderToStaticMarkup(
      <TopologyHeaderToolbar
        locationsCount={1}
        edgesCount={0}
        containersCount={1}
        hasSaveMap
        effectiveDirty
        hasBlockingErrors={false}
        effectiveSaving={false}
        isMutatingLocked={false}
        validationSummary={null}
        handleSaveClick={vi.fn()}
        handleSaveAndCloseClick={vi.fn()}
        onClose={vi.fn()}
        handleCloseClick={vi.fn()}
        currentContainerId={null}
        projectedTopology={projected}
        drillIntoContainer={vi.fn()}
      />
    );
    expect(withCloseHtml).toContain("Save Map");
    expect(withCloseHtml).toContain("ui-split-btn__toggle");
  });

  it("keeps wizard Commit World & Spatial Graph as a single button without a split toggle", () => {
    const wizardHtml = ReactDOMServer.renderToStaticMarkup(
      <WorldInspectorModal
        world={TEST_WORLD}
        mode="wizard"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    expect(wizardHtml).toContain("Commit World &amp; Spatial Graph");
    expect(wizardHtml).not.toContain("world-modal-save-btn-toggle");
  });
});

describe("MapDetailsDrawer, MapLoreSection & CodexLoreEditor Magic Wand wiring", () => {
  const depthLabels: Record<1 | 2 | 3 | 4, string> = {
    1: "Building / Landmark",
    2: "District / Zone",
    3: "City / Settlement",
    4: "Region / Planet / Realm",
  };

  it("renders Draft Summary, Enrich Description, Suggest Tags, and Draft Lore wands on editable Level 0 locations", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <MapDetailsDrawer
        mode="editor"
        selectedLocation={TEST_LOCATION}
        selectedContainer={null}
        containers={[TEST_CONTAINER]}
        allLocations={[TEST_LOCATION]}
        dynamicPortalIds={new Set()}
        externalPortals={[]}
        containerStats={null}
        depthLabels={depthLabels}
        worldContext={{
          worldId: TEST_WORLD.id,
          worldName: TEST_WORLD.name,
          genre: TEST_WORLD.global_rules.genre,
          tone: TEST_WORLD.global_rules.tone,
          settingOverview: TEST_WORLD.global_rules.setting_overview,
        }}
        onClose={vi.fn()}
        onPatchLocation={vi.fn()}
        onPatchContainer={vi.fn()}
        onResetCoordinates={vi.fn()}
        onDrillIntoContainer={vi.fn()}
      />
    );
    expect(html).toContain('aria-label="Draft Summary:');
    expect(html).toContain('aria-label="Enrich Description:');
    expect(html).toContain('aria-label="Suggest Tags:');
  });

  it("omits Draft Summary wand on Level 1 containers while keeping Enrich Description and Suggest Tags", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <MapDetailsDrawer
        mode="editor"
        selectedLocation={null}
        selectedContainer={TEST_CONTAINER}
        containers={[TEST_CONTAINER]}
        allLocations={[TEST_LOCATION]}
        dynamicPortalIds={new Set()}
        externalPortals={[]}
        containerStats={{
          descendantLocationCount: 1,
          externalPortalsCount: 0,
          hasActivePlayer: true,
        }}
        depthLabels={depthLabels}
        worldContext={{
          worldId: TEST_WORLD.id,
          worldName: TEST_WORLD.name,
        }}
        onClose={vi.fn()}
        onPatchLocation={vi.fn()}
        onPatchContainer={vi.fn()}
        onResetCoordinates={vi.fn()}
        onDrillIntoContainer={vi.fn()}
      />
    );
    expect(html).not.toContain('aria-label="Draft Summary:');
    expect(html).toContain('aria-label="Enrich Description:');
    expect(html).toContain('aria-label="Suggest Tags:');
  });

  it("renders Draft Lore wand in CodexLoreEditor only when editable", () => {
    const editableHtml = ReactDOMServer.renderToStaticMarkup(
      <CodexLoreEditor
        lore={TEST_WORLD_LORE}
        pendingTagDraft=""
        isCampaignMode={false}
        worldId={TEST_WORLD.id}
        worldContext={{
          worldId: TEST_WORLD.id,
          worldName: TEST_WORLD.name,
          genre: TEST_WORLD.global_rules.genre,
          tone: TEST_WORLD.global_rules.tone,
        }}
        onChangeTitle={vi.fn()}
        onChangeCategory={vi.fn()}
        onDraftTagsChange={vi.fn()}
        onChangeTags={vi.fn()}
        onChangeContent={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(editableHtml).toContain('aria-label="Draft Lore:');

    const readOnlyHtml = ReactDOMServer.renderToStaticMarkup(
      <CodexLoreEditor
        lore={TEST_WORLD_LORE}
        pendingTagDraft=""
        isCampaignMode
        worldId={TEST_WORLD.id}
        onChangeTitle={vi.fn()}
        onChangeCategory={vi.fn()}
        onDraftTagsChange={vi.fn()}
        onChangeTags={vi.fn()}
        onChangeContent={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(readOnlyHtml).not.toContain('aria-label="Draft Lore:');
  });

  it("renders MapLoreSection safely in read-only campaign mode without Draft Lore wand", () => {
    const readOnlyHtml = ReactDOMServer.renderToStaticMarkup(
      <MapLoreSection
        mode="campaign"
        isMutatingLocked={false}
        targetId={TEST_LOCATION.id}
        targetName={TEST_LOCATION.name}
        worldId={TEST_WORLD.id}
        scopeLabel="Location Lore & Secrets"
        emptyText="None"
        loreList={TEST_LOCATION.lore_nodes ?? []}
        canEditDraftLore={false}
        savedInDb
      />
    );
    expect(readOnlyHtml).not.toContain('aria-label="Draft Lore:');
  });
});
