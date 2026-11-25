import ReactDOMServer from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  CampaignStateBundle,
  CharacterRecord,
  TurnNodeRecord,
  TurnTelemetry,
  WorldRecord,
} from "../../types";
import { ChatStage } from "../ChatStage";
import { ContextHealthPill } from "../chat/ContextHealthPill";
import { ContextHealthModal } from "../chat/ContextHealthModal";
import { splitWorldClockDisplay } from "../chat/worldClockDisplay";
import {
  buildActionableRecommendation,
  buildContextHealthTooltip,
  formatCompactTokens,
  getMicroBarHeightPct,
} from "../chat/contextHealthHelpers";

const SAMPLE_WARNING_TELEMETRY: TurnTelemetry = {
  overall_status: "warning",
  total_prompt_tokens: 14800,
  total_completion_tokens: 520,
  usage_source: "exact",
  phase5_pending: false,
  phases: {
    phase1_pre: {
      phase: "phase1_pre",
      status: "healthy",
      call_count: 1,
      peak_prompt_tokens: 1200,
      total_prompt_tokens: 1200,
      total_completion_tokens: 80,
      context_ceiling: 8192,
      peak_utilization_pct: 14.6,
      usage_source: "exact",
      truncated_output: false,
      calls: [
        {
          phase: "phase1_pre",
          label: "Pre-Turn Analysis",
          model: "gemma3:12b",
          provider_type: "ollama",
          prompt_tokens: 1200,
          completion_tokens: 80,
          usage_source: "exact",
          context_ceiling: 8192,
          finish_reason: "stop",
          retries: 0,
          duration_ms: 420,
        },
      ],
    },
    phase3_cognition: {
      phase: "phase3_cognition",
      status: "healthy",
      call_count: 1,
      peak_prompt_tokens: 2100,
      total_prompt_tokens: 2100,
      total_completion_tokens: 110,
      context_ceiling: 8192,
      peak_utilization_pct: 25.6,
      usage_source: "exact",
      truncated_output: false,
      calls: [],
    },
    phase4_prose: {
      phase: "phase4_prose",
      status: "warning",
      call_count: 1,
      peak_prompt_tokens: 9900,
      total_prompt_tokens: 9900,
      total_completion_tokens: 240,
      context_ceiling: 12288,
      peak_utilization_pct: 80.6,
      usage_source: "exact",
      dropped_summary: "2 working-memory turns dropped · 1 episodic chunk downgraded",
      cropped_summary: null,
      truncated_output: false,
      budget_report: {
        context_ceiling: 12288,
        reserved_output_tokens: 1024,
        safety_margin_tokens: 256,
        input_budget: 11008,
        zone1_tokens: 4600,
        zone2_tokens: 1400,
        zone3_tokens: 2200,
        zone4_tokens: 1700,
        total_zone3_turns_available: 8,
        dropped_zone3_turns: 2,
        trimmed_below_min_wm: false,
        total_zone2_chunks_available: 3,
        downgraded_zone2_chunks: 1,
        dropped_zone2_chunks: 0,
        base_exceeds_budget: false,
        estimated_cropped_tokens: 0,
      },
      calls: [],
    },
    phase5_clerk: {
      phase: "phase5_clerk",
      status: "healthy",
      call_count: 2,
      peak_prompt_tokens: 1600,
      total_prompt_tokens: 1600,
      total_completion_tokens: 90,
      context_ceiling: 8192,
      peak_utilization_pct: 19.5,
      usage_source: "exact",
      truncated_output: false,
      calls: [],
    },
  },
};

const SAMPLE_CRITICAL_TELEMETRY: TurnTelemetry = {
  ...SAMPLE_WARNING_TELEMETRY,
  overall_status: "critical",
  phases: {
    ...SAMPLE_WARNING_TELEMETRY.phases,
    phase4_prose: {
      ...SAMPLE_WARNING_TELEMETRY.phases.phase4_prose!,
      status: "critical",
      peak_prompt_tokens: 12500,
      peak_utilization_pct: 101.7,
      cropped_summary: "~480 tok overflow (Zone 1+4 exceeded budget)",
      budget_report: {
        ...SAMPLE_WARNING_TELEMETRY.phases.phase4_prose!.budget_report!,
        base_exceeds_budget: true,
        estimated_cropped_tokens: 480,
      },
    },
  },
};

describe("contextHealthHelpers", () => {
  it("formats compact tokens and micro-bar heights safely", () => {
    expect(formatCompactTokens(8192)).toBe("8,192");
    expect(formatCompactTokens(12288)).toBe("12.3k");
    expect(getMicroBarHeightPct(null)).toBe(18);
    expect(getMicroBarHeightPct(SAMPLE_WARNING_TELEMETRY.phases.phase4_prose!)).toBe(81);
  });

  it("builds tooltips and actionable recommendations for warning and critical states", () => {
    expect(buildContextHealthTooltip(null)).toContain("No turn telemetry yet");
    expect(buildContextHealthTooltip(SAMPLE_WARNING_TELEMETRY)).toContain("Warning");
    expect(buildContextHealthTooltip(SAMPLE_WARNING_TELEMETRY)).toContain("2 working-memory turns dropped");

    expect(buildActionableRecommendation(null)).toBeNull();
    expect(buildActionableRecommendation(SAMPLE_WARNING_TELEMETRY)).toContain("trimmed");
    expect(buildActionableRecommendation(SAMPLE_CRITICAL_TELEMETRY)).toContain("Zone 1");
  });
});

describe("ContextHealthPill & ContextHealthModal SSR rendering", () => {
  it("renders Idle pill when telemetry is null and pending pulse when phase5_pending is true", () => {
    const idleHtml = ReactDOMServer.renderToStaticMarkup(
      <ContextHealthPill telemetry={null} onClick={() => {}} />,
    );
    expect(idleHtml).toContain("context-health-idle");
    expect(idleHtml).toContain("Idle");

    const pendingHtml = ReactDOMServer.renderToStaticMarkup(
      <ContextHealthPill
        telemetry={{ ...SAMPLE_WARNING_TELEMETRY, phase5_pending: true }}
        onClick={() => {}}
      />,
    );
    expect(pendingHtml).toContain("context-health-warning");
    expect(pendingHtml).toContain("is-pending");
  });

  it("renders all 4 phase bars, Zone 1-4 breakdown, drop/crop callouts, and settings button in modal", () => {
    const warnHtml = ReactDOMServer.renderToStaticMarkup(
      <ContextHealthModal
        isOpen={true}
        onClose={() => {}}
        telemetry={SAMPLE_WARNING_TELEMETRY}
        turnDepth={5}
        onOpenSettings={() => {}}
        initialExpandedPhases={{ phase1_pre: true }}
      />,
    );
    expect(warnHtml).toContain("Phase 1 — Pre-Turn");
    expect(warnHtml).toContain("Phase 3 — Cognition");
    expect(warnHtml).toContain("Phase 4 — Prose");
    expect(warnHtml).toContain("Phase 5 — Clerk");
    expect(warnHtml).toContain("2 working-memory turns dropped");
    expect(warnHtml).toContain("Zone 1 Static");
    expect(warnHtml).toContain("Open Model Settings");
    expect(warnHtml).toContain("<th>Time</th>");
    expect(warnHtml).toContain("420ms");

    const critHtml = ReactDOMServer.renderToStaticMarkup(
      <ContextHealthModal
        isOpen={true}
        onClose={() => {}}
        telemetry={SAMPLE_CRITICAL_TELEMETRY}
        turnDepth={6}
        onOpenSettings={() => {}}
      />,
    );
    expect(critHtml).toContain("Critical");
    expect(critHtml).toContain("~480 tok overflow");
    expect(critHtml).toContain("is-overflow");
  });

  it("renders 3 tabs in ContextHealthModal including Turn #0 diagnostics and historical Scene & Recall / Lore Index", () => {
    const world: WorldRecord = {
      id: "world_1",
      name: "Night City",
      global_rules: {
        genre: "Cyberpunk",
        tone: "Gritty",
        tech_or_magic_rules: "Cyberware",
        setting_overview: "Neon rain.",
        starting_timestamp: "2094-11-14 23:00",
      },
      lore_nodes: [
        {
          id: "w_public",
          world_id: "world_1",
          title: "Arasaka Pier",
          category: "faction",
          content: "Corporate docks.",
          entity_tags: ["arasaka"],
        },
        {
          id: "w_secret",
          world_id: "world_1",
          title: "Blackwall Backdoor",
          category: "secret",
          content: "Encrypted tunnel.",
          entity_tags: ["net"],
        },
      ],
      containers: [],
      locations: [
        {
          id: "loc_1",
          world_id: "world_1",
          is_starting_location: true,
          is_entry_exit: true,
          name: "Afterlife Bar",
          summary: "Dim booth",
          description: "Chrome stools.",
          environmental_tags: [],
          lore_nodes: [],
        },
      ],
      edges: [],
      created_at: "2026-10-01T00:00:00Z",
    };
    const char: CharacterRecord = {
      id: "char_1",
      world_id: "world_1",
      name: "Kira",
      tagline: "Netrunner",
      core_persona: "Sharp.",
      communication_style: ["Terse"],
      quirks_flaws: [],
      distinctive_features: [],
      moral_code: ["No betrayals"],
      initial_message: "Keep your head down.",
      voice_anchors: [],
      baseline_psyche: {
        mood_label: "alert",
        valence: 0.0,
        arousal: 0.4,
        core_drive: "Survive",
        core_fear: "Ice",
        default_want: "Jack in",
        default_plan: "Watch doors",
        temperament: {
          archetype: "paranoiac",
          relational_inertia: 0.65,
          negativity_ratio: 5.0,
          theta_pos_base: 0.16,
          theta_neg_base: -0.1,
          composure_resilience: 0.65,
        },
      },
      equipped: [],
      inventory: [],
      memory_shards: [
        {
          id: "shard_1",
          title: "Dock Deal",
          content: "Met Fixer at midnight.",
          keywords: ["dock", "fixer"],
          emotional_weight: 0.8,
          significance: "revelation",
        },
      ],
      portraits: {},
      gallery: [],
      tags: [],
      creator: "test",
      creator_notes: "",
      version: 1,
      created_at: "2026-10-01T00:00:00Z",
    };
    const t1: TurnNodeRecord = {
      id: "turn_1",
      campaign_id: "camp_1",
      parent_turn_id: "turn_0",
      depth_index: 1,
      user_message: "Scan the room.",
      actor_id: "char_1",
      raw_prose: "Sparks fly.",
      cognition: {
        recall: "Dock meeting.",
        feeling: "alert",
        valence: 0,
        arousal: 0.4,
        want: "Jack in",
        plan: "stay put",
      },
      pre_turn: {
        user_sentiment: "curious",
        subtext_interpretation: "checking surroundings",
        mentioned_entities: [],
        memory_search_queries: [],
        spatial_intent: "stay",
        mechanics_check: {
          requires_roll: false,
          action_description: "",
          skill_or_approach: "",
          difficulty_class: 10,
          relevant_modifier: 0,
        },
      },
      recalled_items: [
        {
          id: "w_public",
          source_type: "lore",
          title: "Arasaka Pier",
          content: "Corporate docks.",
          score: 0.91,
        },
      ],
      world_snapshot: {
        turn_id: "turn_1",
        world_timestamp: "2094-11-14 23:10",
        active_location_id: "loc_1",
        scene_flags: ["power_flicker"],
        revealed_lore_ids: [],
      },
      character_state: {
        turn_id: "turn_1",
        character_id: "char_1",
        current_location_id: "loc_1",
        mood_label: "alert",
        valence: 0,
        arousal: 0.4,
        active_want: "Jack in",
        active_plan: "Watch doors",
        inventory: [],
        relationship_notes: {},
      },
      created_at: "2026-10-01T00:01:00Z",
    };
    const t2: TurnNodeRecord = {
      ...t1,
      id: "turn_2",
      parent_turn_id: "turn_1",
      depth_index: 2,
      recalled_items: [],
      world_snapshot: {
        ...t1.world_snapshot,
        turn_id: "turn_2",
        world_timestamp: "2094-11-14 23:25",
        scene_flags: ["power_flicker", "alarm_armed"],
      },
    };
    const bundle: CampaignStateBundle = {
      campaign: {
        id: "camp_1",
        name: "Neon Rain",
        world_id: "world_1",
        character_id: "char_1",
        active_leaf_turn_id: "turn_2",
        world_settings: { describe_on_first_visit: true, unlock_lore: false },
        created_at: "2026-10-01T00:00:00Z",
      },
      active_location: world.locations[0],
      neighbor_locations: [],
      present_character_ids: ["char_1"],
      current_world_snapshot: t2.world_snapshot,
      current_character_state: t2.character_state,
      active_branch_turns: [t1, t2],
      all_turn_nodes: [t1, t2],
      visible_locations: world.locations,
      episodic_chunks: [],
    };

    // Turn #0 idle state still exposes all 3 tabs
    const turn0Html = ReactDOMServer.renderToStaticMarkup(
      <ContextHealthModal
        isOpen={true}
        onClose={() => {}}
        telemetry={null}
        bundle={bundle}
        world={world}
        characters={[char]}
      />
    );
    expect(turn0Html).toContain("Telemetry");
    expect(turn0Html).toContain("Scene &amp; Recall");
    expect(turn0Html).toContain("Lore Index");
    expect(turn0Html).toContain("No turn telemetry recorded yet.");

    // Historical Turn #1 inspection shows Turn #1's flags & recalled items
    const histSceneHtml = ReactDOMServer.renderToStaticMarkup(
      <ContextHealthModal
        isOpen={true}
        onClose={() => {}}
        telemetry={SAMPLE_WARNING_TELEMETRY}
        turnDepth={1}
        bundle={bundle}
        world={world}
        characters={[char]}
        inspectedTurn={t1}
        initialTab="scene_recall"
      />
    );
    expect(histSceneHtml).toContain("Recalled on Turn #1 (1)");
    expect(histSceneHtml).toContain("power_flicker");
    expect(histSceneHtml).not.toContain("alarm_armed");
    expect(histSceneHtml).toContain("Arasaka Pier");

    // Lore Index tab hides unrevealed secret when GM Mode is OFF
    const playerLoreHtml = ReactDOMServer.renderToStaticMarkup(
      <ContextHealthModal
        isOpen={true}
        onClose={() => {}}
        telemetry={null}
        bundle={bundle}
        world={world}
        characters={[char]}
        initialTab="lore_index"
      />
    );
    expect(playerLoreHtml).toContain("Arasaka Pier");
    expect(playerLoreHtml).toContain("Dock Deal");
    expect(playerLoreHtml).not.toContain("Blackwall Backdoor");

    // World clock display splitter & streaming colon blink
    expect(splitWorldClockDisplay("2094-11-14 23:15")).toEqual({
      prefix: "2094-11-14 23",
      colon: ":",
      suffix: "15",
    });
    expect(splitWorldClockDisplay("2094-11-14T08:05:30")).toEqual({
      prefix: "2094-11-14T08",
      colon: ":",
      suffix: "05:30",
    });
    expect(splitWorldClockDisplay("3rd Moon of Frost")).toBeNull();
    expect(splitWorldClockDisplay("Day 4 (+15m)")).toBeNull();

    const streamingStageHtml = ReactDOMServer.renderToStaticMarkup(
      <ChatStage
        bundle={bundle}
        world={world}
        character={char}
        isStreaming={true}
        liveStream={null}
        onSendTurn={() => {}}
        onCheckoutTurn={() => {}}
      />
    );
    expect(streamingStageHtml).toContain("stage-clock-colon--blinking");
  });
});
