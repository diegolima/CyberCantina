import { expect, type Page, type Route } from "@playwright/test";
import type {
  AppSettings,
  AuthStatusResponse,
  CampaignRecord,
  CampaignStateBundle,
  CharacterRecord,
  CharacterStateSnapshot,
  CognitionBlock,
  LLMProvider,
  LocationContainer,
  LocationEdge,
  LocationNode,
  PersonaRecord,
  PreTurnAnalysis,
  ProfileModelSettingsResponse,
  PublicAdminMessage,
  TurnNodeRecord,
  UserNote,
  UserProfile,
  WorldRecord,
} from "../../src/types";

export interface RecordedApiRequest {
  method: string;
  pathname: string;
  search: string;
  body: any;
}

export interface CantinaApiMockOptions {
  authMode?: "authenticated" | "login_required";
  startInCampaign?: boolean;
  singleUserMode?: boolean;
  presentCharacterIds?: string[];
  inPlayerParty?: boolean;
}

export interface CantinaApiMockController {
  requests: RecordedApiRequest[];
  state: {
    authenticated: boolean;
    user: UserProfile;
    settings: AppSettings;
    profileModels: ProfileModelSettingsResponse;
    loginMessages: PublicAdminMessage[];
    homeMessages: PublicAdminMessage[];
    worlds: WorldRecord[];
    characters: CharacterRecord[];
    personas: PersonaRecord[];
    campaigns: CampaignRecord[];
    bundles: Record<string, CampaignStateBundle>;
    notes: UserNote[];
    providers: LLMProvider[];
  };
  assertNoPageErrors: () => void;
}

function buildInitialState(options: CantinaApiMockOptions = {}) {
  const user: UserProfile = {
    id: "user_1",
    username: "runner",
    display_name: "Deck Runner",
    role: "admin",
    has_password: true,
    passkeys: [],
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
    last_login_at: "2026-11-19T12:00:00Z",
  };

  const modelProfile = {
    provider_id: "prov_sys_1",
    model: "qwen2.5:14b",
    temperature: 0.7,
    max_tokens: 1024,
    timeout_seconds: 60,
    context_size: 16384,
  };

  const settings: AppSettings = {
    db_path: "./cybercantina.db",
    actor_profile: modelProfile,
    clerk_profile: { ...modelProfile, temperature: 0.2 },
    embedding_profile: {
      mode: "local_hash",
      model: "hash",
      dimensions: 384,
    },
    memory_config: {
      working_memory_turns: 8,
      episodic_chunk_size: 4,
      rag_top_k: 5,
    },
    allow_offline_fallback: true,
    allow_user_model_overrides: true,
    allow_user_providers: true,
    provider_credential_store: "prefer_browser",
    delegate_cognition_to_clerk: false,
    allow_self_registration: true,
  };

  const profileModels: ProfileModelSettingsResponse = {
    allow_user_model_overrides: true,
    allow_user_providers: true,
    provider_credential_store: "prefer_browser",
    warnings: [],
    has_override: false,
    effective_actor_profile: settings.actor_profile,
    effective_clerk_profile: settings.clerk_profile,
    effective_working_memory_turns: 8,
    effective_delegate_cognition_to_clerk: false,
    default_actor_profile: settings.actor_profile,
    default_clerk_profile: settings.clerk_profile,
    default_working_memory_turns: 8,
    default_delegate_cognition_to_clerk: false,
  };

  const loginMessages: PublicAdminMessage[] = [
    {
      id: "msg_login_1",
      revision: 1,
      title: "Grid Maintenance Notice",
      message: "Sub-grid relay 9 is running on backup power tonight.",
      urgency: "info",
      placement: "login",
      dismissable: true,
      expires_at: null,
    },
  ];

  const homeMessages: PublicAdminMessage[] = [
    {
      id: "msg_home_1",
      revision: 1,
      title: "Welcome to CyberCantina v0.22",
      message: "New slash command autocomplete and World Codex are live.",
      urgency: "info",
      placement: "home",
      dismissable: true,
      expires_at: null,
    },
  ];

  const containers: LocationContainer[] = [
    {
      id: "cont_district",
      world_id: "world_green_lie",
      parent_container_id: null,
      depth: 2,
      name: "Sector 9: The Drain",
      description: "Rain-drenched industrial basin beneath Neo-Veridia.",
      environmental_tags: ["rain", "industrial"],
      lore_nodes: [],
      icon: "map",
      ui_x: 0,
      ui_y: 0,
    },
    {
      id: "cont_neon_rust",
      world_id: "world_green_lie",
      parent_container_id: "cont_district",
      depth: 1,
      name: "The Neon Rust",
      description: "Subterranean dive cantina frequented by splicers and couriers.",
      environmental_tags: ["neon", "sub-bass"],
      lore_nodes: [],
      icon: "beer",
      ui_x: -100,
      ui_y: 40,
    },
  ];

  const locations: LocationNode[] = [
    {
      id: "loc_main_floor",
      world_id: "world_green_lie",
      container_id: "cont_neon_rust",
      is_entry_exit: true,
      is_starting_location: true,
      name: "Main Floor",
      summary: "Smoky cantina floor with flickering holo-booths.",
      description:
        "Heavy synth-bass vibrates through the grated steel floor of The Neon Rust.",
      starting_message:
        "You step down the wet metal stairs into the amber glow of the Main Floor.",
      environmental_tags: ["neon", "crowded"],
      lore_nodes: [
        {
          id: "loc_lore_1",
          world_id: "world_green_lie",
          location_id: "loc_main_floor",
          category: "secret",
          title: "Booth 4 Dead-Drop",
          content: "A magnetic slot beneath Booth 4 holds courier chips.",
          entity_tags: ["booth-4"],
        },
      ],
      icon: "beer",
      ui_x: -120,
      ui_y: 20,
    },
    {
      id: "loc_clinic",
      world_id: "world_green_lie",
      container_id: "cont_neon_rust",
      is_entry_exit: false,
      is_starting_location: false,
      name: "Ripperdoc Clinic",
      summary: "Sterile surgical bay behind the cantina kitchen.",
      description:
        "Antiseptic mist hangs under harsh surgical LEDs and chrome armatures.",
      environmental_tags: ["sterile", "surgical"],
      lore_nodes: [],
      icon: "heart-pulse",
      ui_x: 120,
      ui_y: 20,
    },
    {
      id: "loc_tunnels",
      world_id: "world_green_lie",
      container_id: "cont_district",
      is_entry_exit: false,
      is_starting_location: false,
      name: "Cooling Tunnels",
      summary: "Condensation-soaked maintenance conduits.",
      description:
        "Massive coolant pipes sweat rust-colored water along the service catwalk.",
      environmental_tags: ["damp", "echoing"],
      lore_nodes: [],
      icon: "waypoints",
      ui_x: 0,
      ui_y: 180,
    },
  ];

  const edges: LocationEdge[] = [
    {
      id: "edge_main_to_clinic",
      world_id: "world_green_lie",
      from_location_id: "loc_main_floor",
      to_location_id: "loc_clinic",
      direction_label: "Back Surgery Door",
      compass_direction: "E",
      travel_minutes: 5,
      is_locked_or_hidden: false,
    },
    {
      id: "edge_clinic_to_main",
      world_id: "world_green_lie",
      from_location_id: "loc_clinic",
      to_location_id: "loc_main_floor",
      direction_label: "Cantina Main Floor",
      compass_direction: "W",
      travel_minutes: 5,
      is_locked_or_hidden: false,
    },
    {
      id: "edge_main_to_tunnels",
      world_id: "world_green_lie",
      from_location_id: "loc_main_floor",
      to_location_id: "loc_tunnels",
      direction_label: "Service Hatch",
      compass_direction: "S",
      travel_minutes: 15,
      is_locked_or_hidden: false,
    },
    {
      id: "edge_tunnels_to_main",
      world_id: "world_green_lie",
      from_location_id: "loc_tunnels",
      to_location_id: "loc_main_floor",
      direction_label: "Cantina Ladder",
      compass_direction: "N",
      travel_minutes: 15,
      is_locked_or_hidden: false,
    },
  ];

  const world: WorldRecord = {
    id: "world_green_lie",
    name: "The Green Lie",
    global_rules: {
      genre: "Cyberpunk Noir",
      tone: "Gritty & atmospheric",
      setting_overview:
        "A vertical megacity choked by engineered bio-moss and corporate blockades.",
      tech_or_magic_rules: "Subdermal cyberware, neural splicers, and wetware.",
      starting_timestamp: "Day 1, 22:00",
      describe_on_first_visit: true,
    },
    containers,
    locations,
    edges,
    lore_nodes: [
      {
        id: "lore_sovereign",
        world_id: "world_green_lie",
        category: "faction",
        title: "The Sovereign Cipher",
        content: "An air-gapped cryptographic ledger traded among Drain fixers.",
        entity_tags: ["cipher", "ledger"],
      },
      {
        id: "lore_chloromancer",
        world_id: "world_green_lie",
        category: "history",
        title: "The Chloromancer Spill",
        content: "Twenty years ago, synthetic algae overran the lower reclamation vats.",
        entity_tags: ["algae", "spill"],
      },
    ],
    media: [],
    created_at: "2026-11-01T00:00:00Z",
  };

  const kira: CharacterRecord = {
    id: "char_kira",
    world_id: world.id,
    version: 1,
    name: "Kira Vance",
    tagline: "Rogue signal broker",
    species: "Human (Augmented)",
    pronouns: "she/her",
    age: "29",
    build_and_height: "172 cm, lean wired build",
    physical_appearance: "Silver undercut, scarred left knuckle, amber optic implant.",
    distinctive_features: ["Amber optic ring", "Subdermal data port"],
    core_persona:
      "Calculating information broker who trades encrypted transit routes from Booth 4.",
    communication_style: ["Clipped sentences", "Dry understatement"],
    quirks_flaws: ["Checks exits twice", "Taps her data slate when lying"],
    moral_code: ["Never burn a courier", "Payment upfront"],
    baseline_psyche: {
      mood_label: "Vigilant",
      valence: 0.1,
      arousal: 0.5,
      core_drive: "Decode the Sovereign ledger",
      core_fear: "Corporate extraction teams",
      default_want: "Verify your credentials",
      default_plan: "Keep her back to the booth wall",
    },
    voice_anchors: [
      {
        context: "Greeting a stranger",
        snippet: "Sit where I can see your hands.",
      },
    ],
    equipped: [
      {
        id: "item_burner_slate",
        name: "Encrypted burner slate",
        note: "Cracked glass terminal running custom packet sniffers.",
        flags: ["artifact"],
        lore_id: "lore_sovereign",
      },
    ],
    inventory: [
      {
        id: "item_subdermal_shard",
        name: "Subdermal shard",
        note: "Locked biometric memory key.",
        flags: ["permanent"],
        lore_id: null,
      },
    ],
    memory_shards: [
      {
        id: "shard_kira_1",
        title: "Blackout at Pier 7",
        content: "Lost her former partner when Sector 9 lockdown shutters dropped.",
        keywords: ["pier-7", "lockdown"],
        emotional_weight: 8,
        significance: "trauma",
      },
    ],
    initial_message:
      "*Kira slides a datapad across the scarred table.* \"You're three minutes late.\"",
    tags: ["fixer", "broker"],
    creator: "CyberCantina Studio",
    creator_notes: "Starter showcase operative.",
    portraits: {},
    gallery: [],
    created_at: "2026-11-01T00:00:00Z",
  };

  const yulia: CharacterRecord = {
    ...kira,
    id: "char_yulia",
    name: "Yulia Halim",
    tagline: "Drain courier & netrunner",
    core_persona: "Fast-talking courier who knows every maintenance duct in Sector 9.",
    tags: ["courier", "netrunner"],
    initial_message: "\"Need an escort through the Cooling Tunnels?\"",
  };

  const persona: PersonaRecord = {
    id: "persona_default",
    owner_id: user.id,
    name: "Vex",
    species: "Human",
    age: "27",
    age_is_secret: false,
    build_and_height: "178 cm, athletic",
    physical_appearance: "Dark synth-leather trench coat.",
    persona_bio: "Freelance data courier operating out of Sector 9.",
    tags: ["operative"],
    equipped: [],
    inventory: [],
    lore_entries: [],
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
  };

  const kiraState: CharacterStateSnapshot = {
    turn_id: "turn_1",
    character_id: kira.id,
    current_location_id: "loc_main_floor",
    mood_label: "Vigilant",
    valence: 0.15,
    arousal: 0.5,
    active_want: "Test the courier's story",
    active_plan: "Offer a low-risk job first",
    relationship_notes: { player: "Cautious curiosity" },
    equipped: kira.equipped,
    inventory: kira.inventory,
  };

  const yuliaState: CharacterStateSnapshot = {
    ...kiraState,
    character_id: yulia.id,
    mood_label: "Alert",
    active_want: "Secure transit pay",
  };

  const presentIds = options.presentCharacterIds ?? [kira.id, yulia.id];

  const parties = options.inPlayerParty
    ? [
        {
          id: "party_player_1",
          name: "Neon Rust Crew",
          leader_id: "player",
          member_ids: ["player", kira.id],
          location_id: "loc_main_floor",
          formed_at_turn_id: "turn_0",
        },
      ]
    : [];

  const turn0Cognition: CognitionBlock = {
    recall: "The contact arrived dry enough to have taken the service stairs.",
    feeling: "Guarded tension while scanning the cantina entrance.",
    feeling_tone: "guarded",
    feeling_intensity: "moderate",
    feeling_agency: "steady",
    valence: 0.1,
    arousal: 0.5,
    want: "Verify whether they brought the Pier 7 access key.",
    plan: "Gesture toward the opposite bench and test their credentials.",
  };

  const turn0PreTurn: PreTurnAnalysis = {
    user_sentiment: "neutral",
    subtext_interpretation: "Opening arrival at Booth 4.",
    mentioned_entities: ["Kira Vance"],
    memory_search_queries: ["Pier 7"],
    spatial_intent: "stay",
    mechanics_check: {
      requires_roll: false,
      action_description: "Arrive at Booth 4",
      skill_or_approach: "Insight",
      difficulty_class: 10,
      relevant_modifier: 0,
    },
  };

  const turn0: TurnNodeRecord = {
    id: "turn_0",
    campaign_id: "camp_1",
    parent_turn_id: null,
    depth_index: 0,
    user_message: "[CAMPAIGN_START]",
    actor_id: kira.id,
    raw_prose:
      "*Rain drips from the neon sign above Booth 4 as Kira Vance looks up from her encrypted slate.* \"Sit down before the bouncer notices you.\"",
    cognition: turn0Cognition,
    cognitions: {
      [kira.id]: turn0Cognition,
    },
    cognition_character_names: {
      [kira.id]: kira.name,
    },
    pre_turn: turn0PreTurn,
    post_turn: {
      elapsed_minutes: 0,
      transition_type: "stay",
      scene_flags_updated: ["met_kira"],
      first_visit_cards: [
        {
          entity_type: "container",
          entity_id: "cont_neon_rust",
          depth: 1,
          title: "The Neon Rust",
          description:
            "Subterranean dive cantina frequented by splicers and couriers.",
        },
        {
          entity_type: "location",
          entity_id: "loc_main_floor",
          depth: 0,
          title: "Main Floor",
          description:
            "Heavy synth-bass vibrates through the grated steel floor of The Neon Rust.",
        },
      ],
    },
    world_snapshot: {
      turn_id: "turn_0",
      world_timestamp: "Day 1, 22:00",
      campaign_elapsed_minutes: 0,
      active_location_id: "loc_main_floor",
      scene_flags: ["met_kira"],
      visited_location_ids: ["loc_main_floor"],
      visited_container_ids: ["cont_district", "cont_neon_rust"],
      parties,
    },
    character_state: kiraState,
    character_states: {
      [kira.id]: kiraState,
      [yulia.id]: yuliaState,
    },
    recalled_items: [],
    created_at: "2026-11-19T22:00:00Z",
  };

  const turn1: TurnNodeRecord = {
    ...turn0,
    id: "turn_1",
    parent_turn_id: "turn_0",
    depth_index: 1,
    user_message: "I slide the encrypted chip across the table.",
    raw_prose:
      "*Kira catches the chip under two fingers and slots it into her burner slate.* \"Clean checksum. You might actually survive the night.\"",
    post_turn: {
      elapsed_minutes: 2,
      transition_type: "stay",
      scene_flags_updated: ["met_kira", "chip_verified"],
    },
    world_snapshot: {
      ...turn0.world_snapshot,
      turn_id: "turn_1",
      world_timestamp: "Day 1, 22:02",
      campaign_elapsed_minutes: 2,
      scene_flags: ["met_kira", "chip_verified"],
    },
    created_at: "2026-11-19T22:02:00Z",
  };

  const turn1Alt: TurnNodeRecord = {
    ...turn1,
    id: "turn_1_alt",
    user_message: "I keep the chip in my pocket and ask for payment first.",
    raw_prose:
      "*Kira's amber optic narrows.* \"Smart. Half now, half when the tunnel hatch opens.\"",
    created_at: "2026-11-19T22:03:00Z",
  };

  const campaign: CampaignRecord = {
    id: "camp_1",
    name: "Operation Glass Horizon",
    world_id: world.id,
    character_id: kira.id,
    participant_character_ids: [kira.id, yulia.id],
    persona_id: persona.id,
    persona_snapshot: persona,
    active_leaf_turn_id: "turn_1",
    world_settings: {
      describe_on_first_visit: true,
    },
    created_at: "2026-11-19T22:00:00Z",
  };

  const bundle: CampaignStateBundle = {
    campaign,
    active_branch_turns: [turn0, turn1],
    all_turn_nodes: [turn0, turn1, turn1Alt],
    current_world_snapshot: turn1.world_snapshot,
    current_character_state: kiraState,
    character_states: {
      [kira.id]: kiraState,
      [yulia.id]: yuliaState,
    },
    character_records: {
      [kira.id]: kira,
      [yulia.id]: yulia,
    },
    present_character_ids: presentIds,
    active_location: locations[0],
    neighbor_locations: [
      {
        edge_id: "edge_main_to_clinic",
        destination: locations[1],
        direction_label: "Back Surgery Door",
        compass_direction: "E",
        travel_minutes: 5,
        is_locked_or_hidden: false,
      },
      {
        edge_id: "edge_main_to_tunnels",
        destination: locations[2],
        direction_label: "Service Hatch",
        compass_direction: "S",
        travel_minutes: 15,
        is_locked_or_hidden: false,
      },
    ],
    visible_locations: locations,
    visible_edges: edges,
    containers,
    episodic_chunks: [],
  };

  const providers: LLMProvider[] = [
    {
      id: "prov_sys_1",
      name: "Local Ollama",
      type: "ollama",
      scope: "system",
      owner_id: null,
      color: "cyan",
      is_enabled: true,
      base_url: "http://127.0.0.1:11434",
      has_bearer_token: false,
      credential_storage: "server",
      usable: true,
      unusable_reason: null,
      cached_models: [
        {
          name: "qwen2.5:14b",
          size_mb: 8500,
          parameter_size: "14B",
          quantization_level: "Q4_K_M",
          family: "qwen2",
          is_embedding: false,
        },
      ],
      last_probed_at: "2026-11-19T22:00:00Z",
      last_error_code: null,
      version: 1,
      created_at: "2026-11-01T00:00:00Z",
      updated_at: "2026-11-19T22:00:00Z",
    },
  ];

  const notes: UserNote[] = [
    {
      id: "note_1",
      owner_id: user.id,
      title: "Sector 9 Drop Codes",
      content: "Booth 4 magnetic lock code is 7741.",
      tags: ["operation-glass-horizon", "the-green-lie"],
      is_starred: true,
      created_at: "2026-11-19T22:00:00Z",
      updated_at: "2026-11-19T22:00:00Z",
    },
  ];

  return {
    authenticated: (options.authMode ?? "authenticated") === "authenticated",
    user,
    settings,
    profileModels,
    loginMessages,
    homeMessages,
    worlds: [world],
    characters: [kira, yulia],
    personas: [persona],
    campaigns: [campaign],
    bundles: { [campaign.id]: bundle },
    notes,
    providers,
  };
}

function formatSseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function installCantinaApiMock(
  page: Page,
  options: CantinaApiMockOptions = {}
): Promise<CantinaApiMockController> {
  const state = buildInitialState(options);
  const requests: RecordedApiRequest[] = [];
  const pageErrors: Error[] = [];

  page.on("pageerror", (err) => {
    pageErrors.push(err);
  });

  if (options.startInCampaign) {
    await page.addInitScript((campId: string) => {
      try {
        window.localStorage.setItem("cybercantina_active_campaign_id", campId);
      } catch {}
    }, "camp_1");
  }

  const fulfillJson = (route: Route, payload: unknown, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(payload),
    });

  await page.route(/^https?:\/\/[^/]+\/api(\/|\?|$)/, async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const url = new URL(req.url());
    const pathname = url.pathname;
    if (!pathname.startsWith("/api/")) {
      return route.continue();
    }
    let body: any = null;
    const rawPost = req.postData();
    if (rawPost) {
      try {
        body = JSON.parse(rawPost);
      } catch {
        body = rawPost;
      }
    }
    requests.push({
      method,
      pathname,
      search: url.search,
      body,
    });

    // 1. Auth endpoints
    if (pathname === "/api/auth/status" && method === "GET") {
      const statusPayload: AuthStatusResponse = {
        setup_required: false,
        single_user_mode: options.singleUserMode ?? false,
        authenticated: state.authenticated,
        allow_self_registration: true,
        inactive_user_purge_days: null,
        login_messages: state.loginMessages,
        user: state.authenticated ? state.user : null,
      };
      return fulfillJson(route, statusPayload);
    }

    if (
      (pathname === "/api/auth/login" ||
        pathname === "/api/auth/register" ||
        pathname === "/api/auth/setup") &&
      method === "POST"
    ) {
      if (body?.password === "wrong-pass") {
        return fulfillJson(route, { detail: "Invalid username or password." }, 401);
      }
      state.authenticated = true;
      if (body?.username) {
        state.user = {
          ...state.user,
          username: body.username,
          display_name: body.display_name || state.user.display_name,
        };
      }
      return fulfillJson(route, {
        token: "e2e_mock_session_token",
        user: state.user,
        single_user_mode: options.singleUserMode ?? false,
      });
    }

    if (pathname === "/api/auth/logout" && method === "POST") {
      state.authenticated = false;
      return fulfillJson(route, { status: "ok" });
    }

    // 2. Admin & Home messages
    if (pathname === "/api/messages/home" && method === "GET") {
      return fulfillJson(route, state.homeMessages);
    }
    if (pathname === "/api/admin/messages" && method === "GET") {
      return fulfillJson(route, {
        active: [],
        archived: [],
      });
    }

    // 3. Settings, Profile Models, Providers & Prompts
    if (pathname === "/api/settings" && method === "GET") {
      return fulfillJson(route, state.settings);
    }
    if (pathname === "/api/settings" && method === "PUT") {
      state.settings = { ...state.settings, ...body };
      return fulfillJson(route, {
        ...state.settings,
        embedding_reindex_required: false,
        stale_embedding_entries: 0,
      });
    }
    if (pathname === "/api/profile/models" && method === "GET") {
      return fulfillJson(route, state.profileModels);
    }
    if (pathname === "/api/profile/models" && method === "PUT") {
      state.profileModels = {
        ...state.profileModels,
        has_override: true,
        user_actor_profile: body?.actor_profile ?? state.profileModels.user_actor_profile,
        user_clerk_profile: body?.clerk_profile ?? state.profileModels.user_clerk_profile,
        user_working_memory_turns: body?.working_memory_turns ?? state.profileModels.user_working_memory_turns,
        user_delegate_cognition_to_clerk: body?.delegate_cognition_to_clerk ?? state.profileModels.user_delegate_cognition_to_clerk,
        user_max_scene_flags: body?.max_scene_flags ?? state.profileModels.user_max_scene_flags,
        user_agent_dispatch_mode: body?.agent_dispatch_mode ?? state.profileModels.user_agent_dispatch_mode,
        user_persona_disclosure_mode: body?.persona_disclosure_mode ?? state.profileModels.user_persona_disclosure_mode,
        user_clerk_mirrors_actor: body?.clerk_mirrors_actor ?? state.profileModels.user_clerk_mirrors_actor,
        user_min_working_memory_turns: body?.min_working_memory_turns ?? state.profileModels.user_min_working_memory_turns,
        user_lod_summary_chunks: body?.lod_summary_chunks ?? state.profileModels.user_lod_summary_chunks,
        user_lod_importance_bonus: body?.lod_importance_bonus ?? state.profileModels.user_lod_importance_bonus,
        user_zone2_budget_share_pct: body?.zone2_budget_share_pct ?? state.profileModels.user_zone2_budget_share_pct,
        user_recall_budget_prose_tokens: body?.recall_budget_prose_tokens ?? state.profileModels.user_recall_budget_prose_tokens,
        user_recall_budget_cognition_tokens: body?.recall_budget_cognition_tokens ?? state.profileModels.user_recall_budget_cognition_tokens,
      };
      return fulfillJson(route, state.profileModels);
    }
    if (pathname === "/api/providers" && method === "GET") {
      return fulfillJson(route, state.providers);
    }
    if (pathname === "/api/providers" && method === "POST") {
      const created: LLMProvider = {
        id: `prov_user_${state.providers.length + 1}`,
        name: body?.name || "Custom Browser Provider",
        type: body?.type || "openrouter",
        scope: body?.scope || "user",
        owner_id: state.user.id,
        color: body?.color || "cyan",
        is_enabled: body?.is_enabled ?? true,
        base_url: body?.base_url || "https://openrouter.ai/api/v1",
        has_bearer_token: Boolean(body?.bearer_token),
        credential_storage: body?.credential_storage || "browser",
        usable: true,
        unusable_reason: null,
        cached_models: [],
        last_probed_at: null,
        last_error_code: null,
        version: 1,
        created_at: "2026-11-20T00:00:00Z",
        updated_at: "2026-11-20T00:00:00Z",
      };
      state.providers.push(created);
      return fulfillJson(route, created);
    }
    if (pathname.startsWith("/api/providers/") && pathname.endsWith("/probe")) {
      return fulfillJson(route, {
        provider: state.providers[0],
        models: state.providers[0].cached_models,
        ok: true,
        error_code: null,
        error_detail: null,
      });
    }
    if (pathname.startsWith("/api/providers/") && pathname.endsWith("/client-probe")) {
      const provId = pathname.split("/")[3];
      const found = state.providers.find((p) => p.id === provId) ?? state.providers[0];
      return fulfillJson(route, {
        provider: found,
        models: found.cached_models,
        ok: true,
        error_code: null,
        error_detail: null,
      });
    }
    if (pathname === "/api/local-relay/status" && method === "GET") {
      return fulfillJson(route, { connected: false, clients: 0 });
    }
    if (pathname === "/api/prompts/presets" && method === "GET") {
      return fulfillJson(route, []);
    }
    if (pathname === "/api/prompts/active" && method === "GET") {
      return fulfillJson(route, { active_prompt_preset_id: null });
    }
    if (pathname === "/api/prompts/defaults" && method === "GET") {
      return fulfillJson(route, {
        defaults: {},
        metadata: [],
        presets: [
          {
            id: "builtin-default",
            name: "CyberCantina Default",
            description: "Built-in system prompts",
            is_builtin: true,
            prompts: {},
            created_at: "2026-11-20T00:00:00Z",
            updated_at: "2026-11-20T00:00:00Z",
          },
        ],
        active_preset_id: null,
      });
    }
    if (pathname === "/api/admin/embeddings/status" && method === "GET") {
      return fulfillJson(route, { fingerprint: "local_hash:384", stale_entries: 0 });
    }

    // 4. Worlds
    if (pathname === "/api/worlds" && method === "GET") {
      return fulfillJson(route, state.worlds);
    }
    const worldMatch = pathname.match(/^\/api\/worlds\/([^/]+)$/);
    if (worldMatch) {
      const worldId = decodeURIComponent(worldMatch[1]);
      const idx = state.worlds.findIndex((w) => w.id === worldId);
      if (method === "GET") {
        return fulfillJson(route, state.worlds[idx] ?? state.worlds[0]);
      }
      if (method === "PUT") {
        const current = state.worlds[idx] ?? state.worlds[0];
        const updated: WorldRecord = {
          ...current,
          ...body,
          id: current.id,
        };
        if (idx >= 0) {
          state.worlds[idx] = updated;
        }
        return fulfillJson(route, updated);
      }
    }

    // 5. Characters
    if (pathname === "/api/characters" && method === "GET") {
      return fulfillJson(route, state.characters);
    }
    const charVersionsMatch = pathname.match(/^\/api\/characters\/([^/]+)\/versions$/);
    if (charVersionsMatch && method === "GET") {
      const charId = decodeURIComponent(charVersionsMatch[1]);
      const char = state.characters.find((c) => c.id === charId) ?? state.characters[0];
      return fulfillJson(route, [
        {
          id: `${char.id}_v1`,
          character_id: char.id,
          version: char.version ?? 1,
          created_at: char.created_at,
        },
      ]);
    }
    const charMatch = pathname.match(/^\/api\/characters\/([^/]+)$/);
    if (charMatch) {
      const charId = decodeURIComponent(charMatch[1]);
      const idx = state.characters.findIndex((c) => c.id === charId);
      if (method === "GET") {
        return fulfillJson(route, state.characters[idx] ?? state.characters[0]);
      }
      if (method === "PUT") {
        const current = state.characters[idx] ?? state.characters[0];
        const updated: CharacterRecord = {
          ...current,
          ...body,
          id: current.id,
          version: (current.version ?? 1) + 1,
        };
        if (idx >= 0) {
          state.characters[idx] = updated;
        }
        return fulfillJson(route, updated);
      }
    }

    // 6. Personas & Notes
    if (pathname === "/api/personas" && method === "GET") {
      return fulfillJson(route, state.personas);
    }
    if (pathname === "/api/notes" && method === "GET") {
      return fulfillJson(route, state.notes);
    }
    if (pathname === "/api/notes" && method === "POST") {
      const newNote: UserNote = {
        id: `note_${state.notes.length + 1}`,
        owner_id: state.user.id,
        title: body?.title ?? "",
        content: body?.content ?? "",
        tags: body?.tags ?? [],
        is_starred: Boolean(body?.is_starred),
        created_at: "2026-11-20T00:00:00Z",
        updated_at: "2026-11-20T00:00:00Z",
      };
      state.notes.unshift(newNote);
      return fulfillJson(route, newNote);
    }

    // 7. Campaigns & Live Turn SSE Stream
    if (pathname === "/api/campaigns" && method === "GET") {
      return fulfillJson(route, state.campaigns);
    }
    if (pathname === "/api/campaigns" && method === "POST") {
      const baseBundle = state.bundles["camp_1"];
      const newId = `camp_${state.campaigns.length + 1}`;
      const createdCamp: CampaignRecord = {
        ...baseBundle.campaign,
        id: newId,
        name: body?.name || "New E2E Campaign",
        world_id: body?.world_id || baseBundle.campaign.world_id,
        character_id:
          body?.character_id ||
          body?.character_ids?.[0] ||
          baseBundle.campaign.character_id,
      };
      const createdBundle: CampaignStateBundle = {
        ...baseBundle,
        campaign: createdCamp,
      };
      state.campaigns.unshift(createdCamp);
      state.bundles[newId] = createdBundle;
      return fulfillJson(route, createdBundle);
    }

    const campStateMatch = pathname.match(/^\/api\/campaigns\/([^/]+)\/state$/);
    if (campStateMatch && method === "GET") {
      const campId = decodeURIComponent(campStateMatch[1]);
      return fulfillJson(route, state.bundles[campId] ?? state.bundles["camp_1"]);
    }

    const campPersonaMatch = pathname.match(/^\/api\/campaigns\/([^/]+)\/persona-state$/);
    if (campPersonaMatch && method === "GET") {
      return fulfillJson(route, null);
    }

    const campCheckoutMatch = pathname.match(/^\/api\/campaigns\/([^/]+)\/checkout$/);
    if (campCheckoutMatch && method === "POST") {
      const campId = decodeURIComponent(campCheckoutMatch[1]);
      const bundle = state.bundles[campId] ?? state.bundles["camp_1"];
      const targetTurnId = body?.turn_id;
      const targetNode = bundle.all_turn_nodes.find((t) => t.id === targetTurnId);
      if (targetNode) {
        const turn0 = bundle.all_turn_nodes[0];
        bundle.active_branch_turns =
          targetNode.id === turn0.id ? [turn0] : [turn0, targetNode];
        bundle.campaign.active_leaf_turn_id = targetNode.id;
      }
      return fulfillJson(route, bundle);
    }

    const campDeleteLastMatch = pathname.match(/^\/api\/campaigns\/([^/]+)\/turns\/last$/);
    if (campDeleteLastMatch && method === "DELETE") {
      const campId = decodeURIComponent(campDeleteLastMatch[1]);
      const bundle = state.bundles[campId] ?? state.bundles["camp_1"];
      if (bundle.active_branch_turns.length > 1) {
        const popped = bundle.active_branch_turns.pop()!;
        bundle.all_turn_nodes = bundle.all_turn_nodes.filter((t) => t.id !== popped.id);
        bundle.campaign.active_leaf_turn_id =
          bundle.active_branch_turns[bundle.active_branch_turns.length - 1].id;
      }
      return fulfillJson(route, bundle);
    }

    const campPartiesMatch = pathname.match(/^\/api\/campaigns\/([^/]+)\/parties$/);
    if (campPartiesMatch && method === "POST") {
      const campId = decodeURIComponent(campPartiesMatch[1]);
      const bundle = state.bundles[campId] ?? state.bundles["camp_1"];
      const newParty = {
        id: `party_npc_${Date.now()}`,
        name: body?.name || "Sector Patrol",
        leader_id: body?.leader_id || "char_kira",
        member_ids: body?.member_ids || ["char_kira", "char_yulia"],
        location_id: "loc_main_floor",
        formed_at_turn_id: bundle.campaign.active_leaf_turn_id || "turn_1",
      };
      bundle.current_world_snapshot.parties = [
        ...(bundle.current_world_snapshot.parties ?? []),
        newParty,
      ];
      return fulfillJson(route, bundle);
    }

    const campStreamMatch = pathname.match(/^\/api\/campaigns\/([^/]+)\/turns\/stream$/);
    if (campStreamMatch && method === "POST") {
      const campId = decodeURIComponent(campStreamMatch[1]);
      const bundle = state.bundles[campId] ?? state.bundles["camp_1"];
      const parentId =
        body?.parent_turn_id ??
        bundle.active_branch_turns[bundle.active_branch_turns.length - 1]?.id ??
        "turn_1";
      const nextTurnId = `turn_${bundle.all_turn_nodes.length + 1}`;
      const preTurn: PreTurnAnalysis = {
        user_sentiment: "curious",
        subtext_interpretation: "Pressing for Cooling Tunnels routing.",
        mentioned_entities: ["Kira Vance", "Cooling Tunnels"],
        memory_search_queries: ["Cooling Tunnels"],
        spatial_intent: "stay",
        mechanics_check: {
          requires_roll: false,
          action_description: "Ask about tunnel valves",
          skill_or_approach: "Investigation",
          difficulty_class: 10,
          relevant_modifier: 0,
        },
      };
      const cognition: CognitionBlock = {
        recall: "The operative is pressing for details on the Cooling Tunnels.",
        feeling: "Measured respect for their thoroughness.",
        feeling_tone: "guarded",
        feeling_intensity: "moderate",
        feeling_agency: "assured",
        valence: 0.25,
        arousal: 0.45,
        want: "Offer the tunnel route if they agree to split the cipher payout.",
        plan: "Project the tunnel schematics onto the holo-table.",
      };
      const prose =
        "*Kira taps a sequence onto her slate, projecting a wireframe map of the Cooling Tunnels between you.* \"Watch the third pressure valve—it vents scalding steam every ten minutes.\"";

      const newTurn: TurnNodeRecord = {
        ...bundle.active_branch_turns[bundle.active_branch_turns.length - 1],
        id: nextTurnId,
        parent_turn_id: parentId,
        depth_index: bundle.active_branch_turns.length,
        user_message: body?.user_message || "Tell me about the Cooling Tunnels.",
        raw_prose: prose,
        cognition,
        cognitions: {
          char_kira: cognition,
        },
        cognition_character_names: {
          char_kira: "Kira Vance",
        },
        pre_turn: preTurn,
        post_turn: {
          elapsed_minutes: 3,
          transition_type: "stay",
          scene_flags_updated: ["met_kira", "chip_verified", "tunnels_briefed"],
        },
        world_snapshot: {
          ...bundle.current_world_snapshot,
          turn_id: nextTurnId,
          world_timestamp: "Day 1, 22:05",
          campaign_elapsed_minutes: 5,
          scene_flags: ["met_kira", "chip_verified", "tunnels_briefed"],
        },
        created_at: "2026-11-20T00:05:00Z",
      };

      bundle.active_branch_turns = [...bundle.active_branch_turns, newTurn];
      bundle.all_turn_nodes = [...bundle.all_turn_nodes, newTurn];
      bundle.campaign.active_leaf_turn_id = nextTurnId;
      bundle.current_world_snapshot = newTurn.world_snapshot;

      const sseBody = [
        formatSseEvent("phase1_complete", {
          pre_turn: preTurn,
          recalled_items: [],
        }),
        formatSseEvent("cognition_complete", cognition),
        formatSseEvent("prose_delta", { delta: prose }),
        formatSseEvent("turn_saved", newTurn),
        formatSseEvent("phase4_complete", {
          turn: newTurn,
          state_bundle: bundle,
        }),
      ].join("");

      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        headers: {
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
        body: sseBody,
      });
    }

    // Default fallback for any other /api/ route
    return fulfillJson(route, { status: "ok" });
  });

  return {
    requests,
    state,
    assertNoPageErrors: () => {
      expect(
        pageErrors.map((e) => e.message),
        "Expected zero uncaught browser pageerror exceptions"
      ).toEqual([]);
    },
  };
}
