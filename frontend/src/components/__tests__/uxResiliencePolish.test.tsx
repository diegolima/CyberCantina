import ReactDOMServer from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  CampaignStateBundle,
  CharacterRecord,
  PersonaRecord,
  UserProfile,
  WorldRecord,
} from "../../types";
import {
  formatServerUnreachableDetail,
  isServerUnreachableError,
} from "../../utils/serverReachability";
import { ChatStage } from "../ChatStage";
import { ChatComposer, type ChatComposerProps } from "../chat/ChatComposer";
import { DeleteConfirmationModal } from "../DeleteConfirmationModal";
import { HomeScreen } from "../HomeScreen";
import { NewCampaignModal } from "../NewCampaignModal";
import { PersonaEditorModal } from "../PersonaEditorModal";
import { AdminModal } from "../auth/AdminModal";
import { ProfileModal } from "../auth/ProfileModal";
import { ServerUnreachableScreen } from "../shared/ServerUnreachableScreen";

const TEST_USER: UserProfile = {
  id: "user_1",
  username: "tester",
  display_name: "Tester",
  role: "admin",
  has_password: true,
  passkeys: [],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const TEST_WORLD: WorldRecord = {
  id: "world_1",
  name: "Sector 9",
  global_rules: {
    genre: "Cyberpunk",
    tone: "Noir",
    setting_overview: "Rainy megacity",
    tech_or_magic_rules: "Cyberware",
    starting_timestamp: "2094-11-14 20:00",
  },
  containers: [],
  locations: [
    {
      id: "loc_1",
      world_id: "world_1",
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
  created_at: "2026-01-01T00:00:00Z",
};

const TEST_CHAR: CharacterRecord = {
  id: "char_1",
  world_id: "world_1",
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

const TEST_PERSONA: PersonaRecord = {
  id: "persona_1",
  owner_id: "user_1",
  name: "Deckard",
  tagline: "Investigator",
  species: "Human",
  age: "34",
  age_is_secret: true,
  sex: "Male",
  pronouns: "he/him",
  persona_bio: "Former detective.",
  tags: ["noir"],
  build_and_height: "180 cm",
  distinctive_features: [],
  physical_appearance: "",
  equipped: [],
  inventory: [],
  lore_entries: [],
  gallery: [],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const TEST_BUNDLE: CampaignStateBundle = {
  campaign: {
    id: "camp_1",
    name: "Night Shift",
    world_id: TEST_WORLD.id,
    character_id: TEST_CHAR.id,
    participant_character_ids: [TEST_CHAR.id],
    active_leaf_turn_id: "turn_0",
    created_at: "2026-01-01T00:00:00Z",
  },
  active_branch_turns: [
    {
      id: "turn_0",
      campaign_id: "camp_1",
      parent_turn_id: null,
      depth_index: 0,
      user_message: "",
      actor_id: TEST_CHAR.id,
      raw_prose: "Keep moving.",
      cognition: {
        recall: "",
        feeling: "Alert",
        valence: 0.1,
        arousal: 0.6,
        want: "Exit clean",
        plan: "Watch perimeter",
        skipped: false,
      },
      pre_turn: {
        user_sentiment: "neutral",
        subtext_interpretation: "",
        mentioned_entities: [],
        memory_search_queries: [],
        spatial_intent: "stay",
        active_speaker_id: TEST_CHAR.id,
        mechanics_check: {
          requires_roll: false,
          action_description: "",
          skill_or_approach: "",
          difficulty_class: 12,
          relevant_modifier: 0,
        },
      },
      world_snapshot: {
        turn_id: "turn_0",
        world_timestamp: "2094-11-14 20:00",
        active_location_id: "loc_1",
        scene_flags: [],
      },
      character_state: {
        turn_id: "turn_0",
        character_id: TEST_CHAR.id,
        current_location_id: "loc_1",
        mood_label: "Alert",
        valence: 0.1,
        arousal: 0.6,
        active_want: "Exit clean",
        active_plan: "Watch perimeter",
        relationship_notes: {},
        equipped: [],
        inventory: [],
      },
      recalled_items: [],
      created_at: "2026-01-01T00:00:00Z",
    },
  ],
  all_turn_nodes: [],
  current_world_snapshot: {
    turn_id: "turn_0",
    world_timestamp: "2094-11-14 20:00",
    active_location_id: "loc_1",
    scene_flags: [],
  },
  current_character_state: {
    turn_id: "turn_0",
    character_id: TEST_CHAR.id,
    current_location_id: "loc_1",
    mood_label: "Alert",
    valence: 0.1,
    arousal: 0.6,
    active_want: "Exit clean",
    active_plan: "Watch perimeter",
    relationship_notes: {},
    equipped: [],
    inventory: [],
  },
  active_location: TEST_WORLD.locations[0],
  neighbor_locations: [],
  visible_locations: TEST_WORLD.locations,
  episodic_chunks: [],
};

function makeBaseComposerProps(): ChatComposerProps {
  return {
    composerBarRef: { current: null },
    narratorBtnRef: { current: null },
    exitsBtnRef: { current: null },
    textareaRef: { current: null },
    character: TEST_CHAR,
    editingTurn: null,
    activeTray: "none",
    setActiveTray: vi.fn(),
    activePopover: "none",
    setActivePopover: vi.fn(),
    customDirectiveText: "",
    setCustomDirectiveText: vi.fn(),
    presentCharacters: [TEST_CHAR],
    allCampaignCharacters: [TEST_CHAR],
    presentCharacterIds: [TEST_CHAR.id],
    stagedChoices: {},
    activeChoiceCharId: TEST_CHAR.id,
    setActiveChoiceCharId: vi.fn(),
    activeCharRecord: TEST_CHAR,
    totalStagedOptionsCount: 0,
    diceMode: "auto",
    setDiceMode: vi.fn(),
    diceOverride: "",
    setDiceOverride: vi.fn(),
    hasActiveGates: false,
    choicePreview: null,
    choiceSlashWarning: null,
    decomposedInput: {
      raw_message: "",
      public_text: "",
      whispers: [],
      whispers_by_character_id: {},
      remote_whispers: [],
    },
    mentionPickerOpen: false,
    setMentionPickerOpen: vi.fn(),
    mentionQuery: "",
    mentionSelectedIndex: 0,
    setMentionSelectedIndex: vi.fn(),
    filteredMentionCharacters: [],
    inputText: "I check the lock.",
    setInputText: vi.fn(),
    isBusy: false,
    magicWand: {
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
    },
    neighborLocations: [],
    handleSelectMention: vi.fn(),
    handleRemoveMentionChip: vi.fn(),
    checkAndTriggerMention: vi.fn(),
    handleInvokeNarrator: vi.fn(),
    handleQuickExit: vi.fn(),
    handleSendCustomDirective: vi.fn(),
    handleClearAllChoices: vi.fn(),
    handleClearCharChoices: vi.fn(),
    handleSetDC: vi.fn(),
    handleAddOption: vi.fn(),
    handleUpdateOption: vi.fn(),
    handleRemoveOption: vi.fn(),
    handleCancelEdit: vi.fn(),
    handleSend: vi.fn(),
  };
}

describe("Campaign stream Stop button & error recovery", () => {
  it("swaps Send for Stop while streaming pre-save and shows Finalizing during Phase 5", () => {
    const idleHtml = ReactDOMServer.renderToStaticMarkup(
      <ChatComposer {...makeBaseComposerProps()} />
    );
    expect(idleHtml).toContain("composer-send-btn");
    expect(idleHtml).not.toContain("composer-stop-btn");

    const streamingHtml = ReactDOMServer.renderToStaticMarkup(
      <ChatComposer
        {...makeBaseComposerProps()}
        isBusy={true}
        isStreaming={true}
        onStopTurn={vi.fn()}
      />
    );
    expect(streamingHtml).toContain("composer-stop-btn");
    expect(streamingHtml).toContain("Stop");

    const finalizingHtml = ReactDOMServer.renderToStaticMarkup(
      <ChatComposer
        {...makeBaseComposerProps()}
        isBusy={true}
        isStreaming={false}
        isPhase4Running={true}
        onStopTurn={vi.fn()}
      />
    );
    expect(finalizingHtml).not.toContain("composer-stop-btn");
    expect(finalizingHtml).toContain("Finalizing…");
  });

  it("renders Retry, Model Settings, and Dismiss for turn_pre_save, and hides Retry/Settings for post-save & action errors", () => {
    const preSaveHtml = ReactDOMServer.renderToStaticMarkup(
      <ChatStage
        bundle={TEST_BUNDLE}
        world={TEST_WORLD}
        character={TEST_CHAR}
        isStreaming={false}
        liveStream={null}
        streamError={{
          kind: "turn_pre_save",
          message: "Provider timed out",
          retryable: true,
          failedTurnOpts: { userMessage: "Hello" },
        }}
        onDismissStreamError={vi.fn()}
        onOpenSettings={vi.fn()}
        onSendTurn={vi.fn()}
        onCheckoutTurn={vi.fn()}
      />
    );
    expect(preSaveHtml).toContain("Turn Error:");
    expect(preSaveHtml).toContain("Retry");
    expect(preSaveHtml).toContain("Model Settings");
    expect(preSaveHtml).toContain('aria-label="Dismiss error"');
    expect(preSaveHtml).not.toContain("Ollama / LLM Error");

    const postSaveHtml = ReactDOMServer.renderToStaticMarkup(
      <ChatStage
        bundle={TEST_BUNDLE}
        world={TEST_WORLD}
        character={TEST_CHAR}
        isStreaming={false}
        liveStream={null}
        streamError={{
          kind: "turn_post_save",
          message: "Clerk failed",
          retryable: false,
        }}
        onDismissStreamError={vi.fn()}
        onOpenSettings={vi.fn()}
        onSendTurn={vi.fn()}
        onCheckoutTurn={vi.fn()}
      />
    );
    expect(postSaveHtml).toContain("Turn Finalization Error:");
    expect(postSaveHtml).not.toContain(">Retry<");
    expect(postSaveHtml).not.toContain("Model Settings");

    const actionHtml = ReactDOMServer.renderToStaticMarkup(
      <ChatStage
        bundle={TEST_BUNDLE}
        world={TEST_WORLD}
        character={TEST_CHAR}
        isStreaming={false}
        liveStream={null}
        streamError={{
          kind: "action",
          message: "Cannot relocate character",
          retryable: false,
        }}
        onDismissStreamError={vi.fn()}
        onOpenSettings={vi.fn()}
        onSendTurn={vi.fn()}
        onCheckoutTurn={vi.fn()}
      />
    );
    expect(actionHtml).toContain("Action Error:");
    expect(actionHtml).not.toContain(">Retry<");
    expect(actionHtml).not.toContain("Model Settings");
  });
});

describe("Offline / ServerUnreachableScreen & reachability classification", () => {
  it("distinguishes network/5xx errors from 401/403 auth errors", () => {
    expect(isServerUnreachableError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isServerUnreachableError({ status: 502, message: "Bad Gateway" })).toBe(true);
    expect(isServerUnreachableError({ status: 503, message: "Unavailable" })).toBe(true);
    expect(isServerUnreachableError({ status: 401, message: "Unauthorized" })).toBe(false);
    expect(isServerUnreachableError({ status: 403, message: "Forbidden" })).toBe(false);
    expect(formatServerUnreachableDetail({ status: 502 })).toBe(
      "Server responded with HTTP 502."
    );
  });

  it("renders ServerUnreachableScreen with Retry Connection CTA", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <ServerUnreachableScreen
        retrying={false}
        detail="Server responded with HTTP 503."
        onRetry={vi.fn()}
      />
    );
    expect(html).toContain("Cannot reach CyberCantina server");
    expect(html).toContain("Retry Connection");
    expect(html).toContain("Server responded with HTTP 503.");
  });
});

describe("HomeScreen keyboard buttons & modal role='dialog' accessibility", () => {
  it("renders HomeScreen cards, new shelves, and profile chip as native buttons", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <HomeScreen
        personas={[TEST_PERSONA]}
        characters={[TEST_CHAR]}
        worlds={[TEST_WORLD]}
        campaigns={[]}
        activePersona={TEST_PERSONA}
        currentUser={TEST_USER}
        singleUserMode={false}
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
    expect(html).toContain('<button type="button" class="home-card-main-zone"');
    expect(html).toContain('<button type="button" class="home-card-new-shelf"');
    expect(html).toContain('<button type="button" class="home-nav-profile-chip"');
  });

  it("renders role=dialog and aria-modal=true on core modals under Node SSR", () => {
    const modals = [
      ReactDOMServer.renderToStaticMarkup(
        <PersonaEditorModal
          persona={TEST_PERSONA}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      ),
      ReactDOMServer.renderToStaticMarkup(
        <NewCampaignModal
          worlds={[TEST_WORLD]}
          characters={[TEST_CHAR]}
          personas={[TEST_PERSONA]}
          onClose={vi.fn()}
          onCreate={vi.fn()}
        />
      ),
      ReactDOMServer.renderToStaticMarkup(
        <ProfileModal
          user={TEST_USER}
          singleUserMode={false}
          onClose={vi.fn()}
          onUserUpdated={vi.fn()}
          onAccountReset={vi.fn()}
          onAccountDeleted={vi.fn()}
        />
      ),
      ReactDOMServer.renderToStaticMarkup(
        <AdminModal
          currentUser={TEST_USER}
          singleUserMode={false}
          onClose={vi.fn()}
          onCurrentUserUpdated={vi.fn()}
        />
      ),
      ReactDOMServer.renderToStaticMarkup(
        <DeleteConfirmationModal
          deleteTarget={{
            kind: "persona",
            persona: TEST_PERSONA,
            campaignsUsing: [],
          }}
          isDeleting={false}
          onCancel={vi.fn()}
          onConfirm={vi.fn()}
        />
      ),
    ];

    for (const html of modals) {
      expect(html).toContain('role="dialog"');
      expect(html).toContain('aria-modal="true"');
    }
  });
});
