import ReactDOMServer from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  CampaignStateBundle,
  CharacterRecord,
  CharacterStateSnapshot,
  LlmCallTelemetry,
  LocationNode,
  TurnNodeRecord,
  TurnTelemetry,
  WorldStateSnapshot,
} from "../../types";
import { ModelCard } from "../models/ModelCard";
import { ProvidersProvider } from "../providers/ProvidersContext";
import { TurnCard } from "../chat/TurnCard";
import { TurnProseModelPill } from "../chat/TurnProseModelPill";
import {
  computeProseSpeed,
  computeTurnTotalCostUsd,
  formatCostUsd,
  formatDurationMs,
  formatProseSpeed,
  formatShortModelLabel,
  getProseCallTelemetry,
  resolveProseProviderColor,
  resolveProseProviderLabel,
} from "../chat/proseTelemetryHelpers";

const LOC_HUB: LocationNode = {
  id: "loc-hub",
  world_id: "w-1",
  name: "Cantina",
  summary: "Neon hub.",
  description: "Rain on chrome.",
  environmental_tags: [],
  is_starting_location: true,
  lore_nodes: [],
  ui_x: 0,
  ui_y: 0,
  is_visited: true,
};

const CHAR_ACTOR: CharacterRecord = {
  id: "char-mira",
  version: 1,
  world_id: "w-1",
  name: "Mira",
  tagline: "Courier",
  physical_appearance: "Jacket",
  core_persona: "Sharp",
  communication_style: [],
  quirks_flaws: [],
  moral_code: [],
  baseline_psyche: {
    mood_label: "focused",
    valence: 0,
    arousal: 0.2,
    core_drive: "Deliver",
    core_fear: "Failure",
    default_want: "Move",
    default_plan: "Scan",
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

function makeCall(overrides: Partial<LlmCallTelemetry> = {}): LlmCallTelemetry {
  return {
    phase: "phase4_prose",
    label: "Prose: Mira",
    model: "qwen2.5:14b-instruct",
    provider_type: "ollama",
    provider_id: "prov-1",
    provider_name: "Home GPU",
    provider_color: "cyan",
    prompt_tokens: 2400,
    completion_tokens: 180,
    usage_source: "exact",
    context_ceiling: 12288,
    finish_reason: "stop",
    retries: 0,
    duration_ms: 4200,
    ttft_ms: 1200,
    eval_duration_ms: 3000,
    cost_usd: null,
    ...overrides,
  };
}

function makeTurn(
  depth: number,
  telemetry: TurnTelemetry | null = null,
): TurnNodeRecord {
  const id = `t-${depth}`;
  const ws: WorldStateSnapshot = {
    turn_id: id,
    world_timestamp: `Day 1, 20:0${depth}`,
    active_location_id: LOC_HUB.id,
    scene_flags: [],
    campaign_elapsed_minutes: depth * 5,
    visited_location_ids: [LOC_HUB.id],
    parties: [],
  };
  const cs: CharacterStateSnapshot = {
    turn_id: id,
    character_id: CHAR_ACTOR.id,
    current_location_id: LOC_HUB.id,
    mood_label: "focused",
    valence: 0,
    arousal: 0.2,
    active_want: "Move",
    active_plan: "Scan",
    relationship_notes: {},
    equipped: [],
    inventory: [],
  };
  return {
    id,
    campaign_id: "camp-1",
    parent_turn_id: depth === 0 ? null : `t-${depth - 1}`,
    depth_index: depth,
    user_message: depth === 0 ? "" : "Hello",
    actor_id: CHAR_ACTOR.id,
    raw_prose: "Neon flickers overhead.",
    cognition: {
      recall: "Old contact",
      feeling: "focused",
      want: "Move",
      plan: "Scan",
      valence: 0,
      arousal: 0.2,
    },
    pre_turn: {
      user_sentiment: "neutral",
      subtext_interpretation: "",
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
      active_speaker_id: CHAR_ACTOR.id,
      speaker_order: [CHAR_ACTOR.id],
    },
    world_snapshot: ws,
    character_state: cs,
    character_states: { [CHAR_ACTOR.id]: cs },
    recalled_items: [],
    telemetry,
    created_at: "2026-01-01T00:00:00Z",
  };
}

function makeTelemetry(
  proseCalls: LlmCallTelemetry[],
  extraPhases: Partial<TurnTelemetry["phases"]> = {},
): TurnTelemetry {
  return {
    overall_status: "healthy",
    total_prompt_tokens: 2400,
    total_completion_tokens: 180,
    usage_source: "exact",
    phase5_pending: false,
    phases: {
      phase4_prose: {
        phase: "phase4_prose",
        status: proseCalls.length > 0 ? "healthy" : "idle",
        call_count: proseCalls.length,
        peak_prompt_tokens: proseCalls[0]?.prompt_tokens ?? 0,
        total_prompt_tokens: proseCalls[0]?.prompt_tokens ?? 0,
        total_completion_tokens: proseCalls[0]?.completion_tokens ?? 0,
        usage_source: proseCalls[0]?.usage_source ?? "none",
        truncated_output: proseCalls.some((c) => c.finish_reason === "length"),
        calls: proseCalls,
      },
      ...extraPhases,
    },
  };
}

function makeBundle(turns: TurnNodeRecord[]): CampaignStateBundle {
  const leaf = turns[turns.length - 1];
  return {
    campaign: {
      id: "camp-1",
      name: "Test",
      world_id: "w-1",
      character_id: CHAR_ACTOR.id,
      participant_character_ids: [CHAR_ACTOR.id],
      active_leaf_turn_id: leaf.id,
      created_at: "2026-01-01T00:00:00Z",
    },
    active_branch_turns: turns,
    all_turn_nodes: turns,
    current_world_snapshot: leaf.world_snapshot,
    current_character_state: leaf.character_state,
    character_states: leaf.character_states,
    character_records: { [CHAR_ACTOR.id]: CHAR_ACTOR },
    present_character_ids: [CHAR_ACTOR.id],
    active_location: LOC_HUB,
    neighbor_locations: [],
    visible_locations: [LOC_HUB],
    visible_edges: [],
    episodic_chunks: [],
    all_episodic_chunks: [],
  };
}

describe("proseTelemetryHelpers", () => {
  it("resolves provider colors, labels, short model names, and durations", () => {
    const legacyCall = makeCall({
      provider_color: undefined,
      provider_name: undefined,
      provider_type: "openrouter",
      model: "hf.co/bartowski/Llama-3.3-70B-Instruct-GGUF:Q4_K_M",
    });
    expect(resolveProseProviderColor(legacyCall)).toBe("neutral");
    expect(resolveProseProviderLabel(legacyCall)).toBe("OpenRouter");
    expect(formatShortModelLabel(legacyCall.model)).toBe(
      "Llama-3.3-70B-Instruct-GGUF:Q4_K_M",
    );
    expect(formatShortModelLabel("anthropic/claude-3.7-sonnet")).toBe(
      "anthropic/claude-3.7-sonnet",
    );

    expect(formatDurationMs(0)).toBeNull();
    expect(formatDurationMs(840)).toBe("840ms");
    expect(formatDurationMs(4200)).toBe("4.2s");
    expect(formatDurationMs(72_000)).toBe("1m 12s");
  });

  it("computes honest tok/s prioritizing native eval_duration, then stream decode, then exact e2e", () => {
    const nativeDecode = makeCall({
      eval_duration_ms: 3000,
      completion_tokens: 180,
    });
    expect(formatProseSpeed(computeProseSpeed(nativeDecode))).toBe("60.0 tok/s");

    const streamDecode = makeCall({
      eval_duration_ms: null,
      duration_ms: 4000,
      ttft_ms: 1000,
      completion_tokens: 90,
    });
    expect(formatProseSpeed(computeProseSpeed(streamDecode))).toBe("30.0 tok/s");

    const exactE2e = makeCall({
      eval_duration_ms: null,
      ttft_ms: null,
      duration_ms: 5000,
      completion_tokens: 100,
      usage_source: "exact",
    });
    expect(formatProseSpeed(computeProseSpeed(exactE2e))).toBe("20.0 tok/s (e2e)");

    const estimatedNoDecode = makeCall({
      eval_duration_ms: null,
      ttft_ms: null,
      duration_ms: 5000,
      completion_tokens: 100,
      usage_source: "estimated",
    });
    expect(computeProseSpeed(estimatedNoDecode)).toBeNull();
  });

  it("extracts final prose call and formats USD costs cleanly", () => {
    const c1 = makeCall({ model: "first-attempt", cost_usd: 0.001 });
    const c2 = makeCall({ model: "final-model", cost_usd: 0.0042 });
    const tel = makeTelemetry([c1, c2], {
      phase1_pre: {
        phase: "phase1_pre",
        status: "healthy",
        call_count: 1,
        peak_prompt_tokens: 500,
        total_prompt_tokens: 500,
        total_completion_tokens: 50,
        usage_source: "exact",
        truncated_output: false,
        calls: [makeCall({ phase: "phase1_pre", cost_usd: 0.0008 })],
      },
    });
    expect(getProseCallTelemetry(tel)?.model).toBe("final-model");
    const total = computeTurnTotalCostUsd(tel);
    expect(total?.paidCallCount).toBe(3);
    expect(total?.totalUsd).toBeCloseTo(0.006, 6);
    expect(formatCostUsd(0.0042)).toBe("$0.0042");
    expect(formatCostUsd(0.25)).toBe("$0.25");
    expect(formatCostUsd(null)).toBeNull();
  });
});

describe("TurnProseModelPill & TurnCard SSR", () => {
  it("omits pill when turn has null telemetry or empty phase4_prose calls", () => {
    const rootTurn = makeTurn(0, null);
    const emptyProseTurn = makeTurn(1, makeTelemetry([]));
    const bundle = makeBundle([rootTurn, emptyProseTurn]);

    const rootHtml = ReactDOMServer.renderToStaticMarkup(
      <TurnCard
        turn={rootTurn}
        turnIdx={0}
        bundle={bundle}
        character={CHAR_ACTOR}
        allCampaignCharacters={[CHAR_ACTOR]}
        presentCharacterIds={[CHAR_ACTOR.id]}
        siblings={[]}
        isBusy={false}
        isDeletingTurn={false}
        isEditingThisTurn={false}
        hasActiveEditingTurn={false}
        hasDeleteLastHandler={false}
        cogOpen={false}
        memOpen={false}
        phase4ProgressByTurn={{}}
        onToggleCognition={() => {}}
        onToggleMemories={() => {}}
        onCheckoutTurn={() => {}}
        onStartEdit={() => {}}
        onCancelEdit={() => {}}
        onSwipeRegenerate={() => {}}
        onDeleteLast={() => {}}
        onOpenAgentModal={() => {}}
      />,
    );
    expect(rootHtml).not.toContain("turn-model-pill");

    const emptyHtml = ReactDOMServer.renderToStaticMarkup(
      <TurnProseModelPill
        turn={emptyProseTurn}
        isOpen={false}
        onToggle={() => {}}
        onClose={() => {}}
      />,
    );
    expect(emptyHtml).toBe("");
  });

  it("renders provider-colored Feather pill in TurnCard footer while preserving Brain for Cognition", () => {
    for (const color of ["neutral", "cyan", "purple", "indigo", "bronze"] as const) {
      const turn = makeTurn(1, makeTelemetry([makeCall({ provider_color: color })]));
      const bundle = makeBundle([makeTurn(0), turn]);
      const html = ReactDOMServer.renderToStaticMarkup(
        <TurnCard
          turn={turn}
          turnIdx={1}
          bundle={bundle}
          character={CHAR_ACTOR}
          allCampaignCharacters={[CHAR_ACTOR]}
          presentCharacterIds={[CHAR_ACTOR.id]}
          siblings={[]}
          isBusy={false}
          isDeletingTurn={false}
          isEditingThisTurn={false}
          hasActiveEditingTurn={false}
          hasDeleteLastHandler={false}
          cogOpen={false}
          memOpen={false}
          phase4ProgressByTurn={{}}
          onToggleCognition={() => {}}
          onToggleMemories={() => {}}
          onCheckoutTurn={() => {}}
          onStartEdit={() => {}}
          onCancelEdit={() => {}}
          onSwipeRegenerate={() => {}}
          onDeleteLast={() => {}}
          onOpenAgentModal={() => {}}
        />,
      );
      expect(html).toContain(`turn-model-pill--${color}`);
      expect(html).toContain("lucide-feather");
      expect(html).toContain("lucide-brain");
      expect(html).toContain("qwen2.5:14b-instruct");
    }
  });

  it("renders full model, latency, TTFT, tok/s, cost, truncation tag, and inspect button inside open popover", () => {
    const turn = makeTurn(
      2,
      makeTelemetry(
        [
          makeCall({
            model: "anthropic/claude-3.7-sonnet:thinking",
            provider_type: "openrouter",
            provider_name: "OpenRouter",
            provider_color: "purple",
            duration_ms: 4200,
            ttft_ms: 1100,
            eval_duration_ms: null,
            prompt_tokens: 3100,
            completion_tokens: 155,
            finish_reason: "length",
            cost_usd: 0.0042,
          }),
        ],
        {
          phase1_pre: {
            phase: "phase1_pre",
            status: "healthy",
            call_count: 1,
            peak_prompt_tokens: 600,
            total_prompt_tokens: 600,
            total_completion_tokens: 40,
            usage_source: "exact",
            truncated_output: false,
            calls: [makeCall({ phase: "phase1_pre", cost_usd: 0.0008 })],
          },
        },
      ),
    );
    const html = ReactDOMServer.renderToStaticMarkup(
      <TurnProseModelPill
        turn={turn}
        isOpen={true}
        onToggle={() => {}}
        onClose={() => {}}
        onInspectFullTelemetry={() => {}}
      />,
    );
    expect(html).toContain("turn-model-popover");
    expect(html).toContain("provider-pill--purple");
    expect(html).toContain("OpenRouter");
    expect(html).toContain("anthropic/claude-3.7-sonnet:thinking");
    expect(html).toContain("4.2s");
    expect(html).toContain("1.1s");
    expect(html).toContain("50.0 tok/s");
    expect(html).toContain("3,100 in");
    expect(html).toContain("155 out");
    expect(html).toContain("Truncated (max tokens)");
    expect(html).toContain("Prose cost");
    expect(html).toContain("$0.0042");
    expect(html).toContain("Turn total");
    expect(html).toContain("$0.0050");
    expect(html).toContain("Inspect all 4 phases");
  });

  it("omits Cost row when cost_usd is null", () => {
    const turn = makeTurn(1, makeTelemetry([makeCall({ cost_usd: null })]));
    const html = ReactDOMServer.renderToStaticMarkup(
      <TurnProseModelPill
        turn={turn}
        isOpen={true}
        onToggle={() => {}}
        onClose={() => {}}
      />,
    );
    expect(html).not.toContain("Prose cost");
    expect(html).not.toContain(">Cost<");
  });

  it("uses Feather watermark for actor ModelCard and Cpu for clerk ModelCard", () => {
    const actorHtml = ReactDOMServer.renderToStaticMarkup(
      <ProvidersProvider probeSystem={false}>
        <ModelCard role="actor" />
      </ProvidersProvider>,
    );
    expect(actorHtml).toContain("lucide-feather");
    expect(actorHtml).not.toContain("lucide-brain");

    const clerkHtml = ReactDOMServer.renderToStaticMarkup(
      <ProvidersProvider probeSystem={false}>
        <ModelCard role="clerk" />
      </ProvidersProvider>,
    );
    expect(clerkHtml).toContain("lucide-cpu");
    expect(clerkHtml).not.toContain("lucide-feather");
  });
});
