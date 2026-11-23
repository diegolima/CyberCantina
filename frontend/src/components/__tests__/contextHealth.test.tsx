import ReactDOMServer from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TurnTelemetry } from "../../types";
import { ContextHealthPill } from "../chat/ContextHealthPill";
import { ContextHealthModal } from "../chat/ContextHealthModal";
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
});
