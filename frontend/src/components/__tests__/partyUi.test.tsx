import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AppSidebar } from "../AppSidebar";
import { CharacterMentionPicker } from "../CharacterMentionPicker";
import { ChatComposer } from "../chat/ChatComposer";
import { CharacterRow } from "../inspector/CharacterRow";
import { LocationOverrideButton } from "../inspector/LocationOverrideButton";
import { PartyManagementModal } from "../party/PartyManagementModal";
import {
  USER_PARTY_MEMBER_ID,
  type CampaignStateBundle,
  type CharacterRecord,
  type CharacterStateSnapshot,
  type LocationNode,
  type PartyRecord,
  type UserProfile,
} from "../../types";

const USER: UserProfile = {
  id: "u1",
  username: "runner",
  display_name: "Deck Runner",
  role: "admin",
  has_password: true,
  passkeys: [],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  last_login_at: null,
};

const LOC_MAIN: LocationNode = {
  id: "loc_main",
  world_id: "w1",
  name: "Neon Rust Floor",
  summary: "Smoky taproom",
  description: "Low neon lighting.",
  environmental_tags: ["neon"],
  is_starting_location: true,
};

const LOC_CATWALK: LocationNode = {
  id: "loc_catwalk",
  world_id: "w1",
  name: "The Catwalk",
  summary: "High steel catwalk",
  description: "Overlooks the bar.",
  environmental_tags: ["grating"],
  is_starting_location: false,
};

function makeChar(id: string, name: string): CharacterRecord {
  return {
    id,
    version: 1,
    name,
    tagline: "Operative",
    physical_appearance: "Jacket",
    core_persona: "Sharp",
    communication_style: ["Dry"],
    quirks_flaws: ["Cautious"],
    moral_code: ["Pragmatic"],
    baseline_psyche: {
      mood_label: "Alert",
      valence: 0,
      arousal: 0.4,
      core_drive: "Survive",
      core_fear: "Exposure",
      default_want: "Observe",
      default_plan: "Wait",
    },
    voice_anchors: [],
    equipped: [],
    inventory: [],
    memory_shards: [],
    initial_message: "",
    tags: [],
    creator: "test",
    creator_notes: "",
    portraits: {},
    gallery: [],
    created_at: "2026-01-01T00:00:00Z",
  };
}

const KIRA = makeChar("char_kira", "Kira Vance");
const NYX = makeChar("char_nyx", "Nyx");
const VIKTOR = makeChar("char_viktor", "Viktor");

function makeState(cid: string, locId: string): CharacterStateSnapshot {
  return {
    turn_id: "t1",
    character_id: cid,
    current_location_id: locId,
    mood_label: "Alert",
    valence: 0.1,
    arousal: 0.4,
    active_want: "Observe",
    active_plan: "Hold",
    relationship_notes: {},
    equipped: [],
    inventory: [],
    unlocked_persona_keys: [],
    persona_knowledge_provenance: {},
  };
}

const PLAYER_PARTY: PartyRecord = {
  id: "p_player",
  name: "Your Party",
  member_ids: [USER_PARTY_MEMBER_ID, KIRA.id],
  leader_id: USER_PARTY_MEMBER_ID,
  location_id: LOC_MAIN.id,
};

const NPC_PARTY: PartyRecord = {
  id: "p_npc",
  name: "Nyx & Viktor",
  member_ids: [NYX.id, VIKTOR.id],
  leader_id: NYX.id,
  location_id: LOC_CATWALK.id,
};

const BUNDLE: CampaignStateBundle = {
  campaign: {
    id: "camp_1",
    name: "Midnight Run",
    world_id: "w1",
    character_id: KIRA.id,
    participant_character_ids: [KIRA.id, NYX.id, VIKTOR.id],
    created_at: "2026-01-01T00:00:00Z",
  },
  active_branch_turns: [],
  all_turn_nodes: [],
  current_world_snapshot: {
    turn_id: "t1",
    world_timestamp: "Day 1, 22:00",
    active_location_id: LOC_MAIN.id,
    scene_flags: [],
    parties: [PLAYER_PARTY, NPC_PARTY],
  },
  current_character_state: makeState(KIRA.id, LOC_MAIN.id),
  character_states: {
    [KIRA.id]: makeState(KIRA.id, LOC_MAIN.id),
    [NYX.id]: makeState(NYX.id, LOC_CATWALK.id),
    [VIKTOR.id]: makeState(VIKTOR.id, LOC_CATWALK.id),
  },
  character_records: {
    [KIRA.id]: KIRA,
    [NYX.id]: NYX,
    [VIKTOR.id]: VIKTOR,
  },
  active_location: LOC_MAIN,
  visible_locations: [LOC_MAIN, LOC_CATWALK],
  neighbor_locations: [],
  episodic_chunks: [],
  present_character_ids: [KIRA.id],
};

describe("Parties UI components (SSR markup)", () => {
  it("renders always-clickable Story and Party buttons below Codex in expanded and rail modes", () => {
    const expanded = renderToStaticMarkup(
      <AppSidebar
        mode="expanded"
        bundle={BUNDLE}
        worldName="Night Sector"
        codexCount={3}
        storyCount={2}
        partyCount={2}
        isPartyOpen={false}
        onOpenCodex={() => {}}
        onOpenStory={() => {}}
        onOpenParty={() => {}}
        notes={[]}
        showNotesFlyout={false}
        setShowNotesFlyout={vi.fn()}
        currentUser={USER}
        singleUserMode
        setNotesModalInitialId={vi.fn()}
        setShowNotesModal={vi.fn()}
        setProfileInitialTab={vi.fn()}
        setShowProfileModal={vi.fn()}
        setAdminInitialTab={vi.fn()}
        setShowAdminModal={vi.fn()}
        handleCloseCampaign={() => {}}
        handleLogout={async () => {}}
      />
    );
    expect(expanded).toContain("Codex");
    expect(expanded).toContain("Story");
    expect(expanded).toContain("Party");
    expect(expanded.indexOf("Codex")).toBeLessThan(expanded.indexOf("Story"));
    expect(expanded.indexOf("Story")).toBeLessThan(expanded.indexOf("Party"));
    expect(expanded).toContain("Manage Parties");

    const rail = renderToStaticMarkup(
      <AppSidebar
        mode="rail"
        bundle={BUNDLE}
        codexCount={3}
        partyCount={0}
        onOpenStory={() => {}}
        onOpenParty={() => {}}
        notes={[]}
        showNotesFlyout={false}
        setShowNotesFlyout={vi.fn()}
        currentUser={USER}
        singleUserMode
        setNotesModalInitialId={vi.fn()}
        setShowNotesModal={vi.fn()}
        setProfileInitialTab={vi.fn()}
        setShowProfileModal={vi.fn()}
        setAdminInitialTab={vi.fn()}
        setShowAdminModal={vi.fn()}
        handleCloseCampaign={() => {}}
        handleLogout={async () => {}}
      />
    );
    expect(rail).toContain('aria-label="Open Campaign Codex"');
    expect(rail).toContain('aria-label="Open Campaign Story &amp; Timelines"');
    expect(rail).toContain('aria-label="Manage Parties"');
    expect(rail.indexOf("Open Campaign Codex")).toBeLessThan(
      rail.indexOf("Open Campaign Story &amp; Timelines")
    );
    expect(rail.indexOf("Open Campaign Story &amp; Timelines")).toBeLessThan(
      rail.indexOf("Manage Parties")
    );
  });

  it("renders PartyManagementModal with player party, NPC party, and relocation controls", () => {
    const html = renderToStaticMarkup(
      <PartyManagementModal
        isOpen
        onClose={() => {}}
        parties={[PLAYER_PARTY, NPC_PARTY]}
        activeLocationId={LOC_MAIN.id}
        locations={[LOC_MAIN, LOC_CATWALK]}
        presentCharacterIds={[KIRA.id]}
        characterRecords={{ [KIRA.id]: KIRA, [NYX.id]: NYX, [VIKTOR.id]: VIKTOR }}
        characterStates={BUNDLE.character_states!}
        personaName="Merc"
        onSubmitPartyTurn={() => {}}
        onOverrideCharacterLocation={() => {}}
        onCreateNpcParty={() => {}}
        onDisbandNpcParty={() => {}}
      />
    );
    expect(html).toContain("Party Management");
    expect(html).toContain("Your Party");
    expect(html).toContain("Leave Party");
    expect(html).toContain("Disband Party");
    expect(html).toContain("Nyx &amp; Viktor");
    expect(html).toContain("NPC Parties (1)");
    expect(html).toContain('class="field-input"');
    expect(html).toContain('class="field-select party-relocate-select"');
  });

  it("renders LocationOverrideButton as single button when alone and split button with party", () => {
    const solo = renderToStaticMarkup(
      <LocationOverrideButton
        targetLocationId={LOC_CATWALK.id}
        targetLocationName={LOC_CATWALK.name}
        coLocatedPartyNpcs={[]}
        onOverride={() => {}}
      />
    );
    expect(solo).toContain("Move Scene Here (Override)");
    expect(solo).not.toContain("Override movement options");

    const withParty = renderToStaticMarkup(
      <LocationOverrideButton
        targetLocationId={LOC_CATWALK.id}
        targetLocationName={LOC_CATWALK.name}
        coLocatedPartyNpcs={[{ id: KIRA.id, name: KIRA.name }]}
        onOverride={() => {}}
      />
    );
    expect(withParty).toContain("Move Party Here");
    expect(withParty).toContain('aria-label="Override movement options"');
  });

  it("renders CharacterRow party pills for In Party, NPC Party, and NPC Party Leader", () => {
    const playerHtml = renderToStaticMarkup(
      <CharacterRow
        character={KIRA}
        state={makeState(KIRA.id, LOC_MAIN.id)}
        isPresent
        partyRole="player_party"
        partyName="Your Party"
      />
    );
    expect(playerHtml).toContain("In Party");

    const leaderHtml = renderToStaticMarkup(
      <CharacterRow
        character={NYX}
        state={makeState(NYX.id, LOC_CATWALK.id)}
        isPresent={false}
        elsewhereLocationName={LOC_CATWALK.name}
        partyRole="npc_leader"
        partyName="Nyx & Viktor"
      />
    );
    expect(leaderHtml).toContain("NPC Party · Leader");
  });

  it("renders scoped CharacterMentionPicker titles and ChatComposer blocking warning", () => {
    const picker = renderToStaticMarkup(
      <CharacterMentionPicker
        isOpen
        filterText=""
        characters={[NYX]}
        presentCharacterIds={[KIRA.id, NYX.id]}
        selectedIndex={0}
        mode="party_invite"
        onSelect={() => {}}
        onClose={() => {}}
      />
    );
    expect(picker).toContain("Invite to Party");
    expect(picker).toContain("@Nyx");

    const composerHtml = renderToStaticMarkup(
      <ChatComposer
        composerBarRef={{ current: null }}
        narratorBtnRef={{ current: null }}
        exitsBtnRef={{ current: null }}
        textareaRef={{ current: null }}
        character={KIRA}
        editingTurn={null}
        activeTray="none"
        setActiveTray={vi.fn()}
        activePopover="none"
        setActivePopover={vi.fn()}
        customDirectiveText=""
        setCustomDirectiveText={vi.fn()}
        presentCharacters={[KIRA]}
        allCampaignCharacters={[KIRA, NYX]}
        presentCharacterIds={[KIRA.id]}
        stagedChoices={{}}
        activeChoiceCharId={KIRA.id}
        setActiveChoiceCharId={vi.fn()}
        activeCharRecord={KIRA}
        totalStagedOptionsCount={0}
        diceMode="auto"
        setDiceMode={vi.fn()}
        diceOverride=""
        setDiceOverride={vi.fn()}
        hasActiveGates={false}
        choicePreview={null}
        choiceSlashWarning={null}
        partySlashWarning="Unknown character '@Ghost' — use @ autocomplete to pick an exact character."
        decomposedInput={{
          raw_message: "/party @Ghost",
          public_text: "/party @Ghost",
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
        inputText="/party @Ghost"
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
        activeLocationName={LOC_MAIN.name}
        neighborLocations={[]}
        handleSelectMention={vi.fn()}
        handleRemoveMentionChip={vi.fn()}
        checkAndTriggerMention={vi.fn()}
        handleInvokeNarrator={vi.fn()}
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
      />
    );
    expect(composerHtml).toContain("Unknown character &#x27;@Ghost&#x27;");
    expect(composerHtml).toContain("disabled");
  });
});
