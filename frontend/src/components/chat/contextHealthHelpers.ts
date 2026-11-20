import type {
  CampaignStateBundle,
  ContextHealthStatus,
  PhaseTelemetrySummary,
  TelemetryPhaseKey,
  TurnNodeRecord,
  TurnTelemetry,
} from "../../types";

export const TELEMETRY_PHASE_ORDER: readonly TelemetryPhaseKey[] = [
  "phase1_pre",
  "phase3_cognition",
  "phase4_prose",
  "phase5_clerk",
] as const;

export interface PhaseDisplayMeta {
  key: TelemetryPhaseKey;
  shortLabel: string;
  title: string;
  subtitle: string;
}

export const PHASE_DISPLAY_META: Record<TelemetryPhaseKey, PhaseDisplayMeta> = {
  phase1_pre: {
    key: "phase1_pre",
    shortLabel: "P1",
    title: "Phase 1 — Pre-Turn",
    subtitle: "Intent, movement, rolls & disclosures (Clerk)",
  },
  phase3_cognition: {
    key: "phase3_cognition",
    shortLabel: "P3",
    title: "Phase 3 — Cognition",
    subtitle: "Per-character private reasoning",
  },
  phase4_prose: {
    key: "phase4_prose",
    shortLabel: "P4",
    title: "Phase 4 — Prose",
    subtitle: "4-zone narrative generation (Actor)",
  },
  phase5_clerk: {
    key: "phase5_clerk",
    shortLabel: "P5",
    title: "Phase 5 — Clerk",
    subtitle: "World state, character agents & compaction",
  },
};

export function getActiveTurnForTelemetry(
  bundle: CampaignStateBundle | null | undefined,
): TurnNodeRecord | null {
  if (!bundle) return null;
  const activeLeafId = bundle.campaign?.active_leaf_turn_id;
  if (activeLeafId && bundle.active_branch_turns?.length) {
    const exact = bundle.active_branch_turns.find((t) => t.id === activeLeafId);
    if (exact) return exact;
  }
  if (bundle.active_branch_turns?.length) {
    return bundle.active_branch_turns[bundle.active_branch_turns.length - 1];
  }
  return null;
}

export function getActiveTurnTelemetry(
  bundle: CampaignStateBundle | null | undefined,
): TurnTelemetry | null {
  const turn = getActiveTurnForTelemetry(bundle);
  return turn?.telemetry ?? null;
}

export function getHealthStatusLabel(status: ContextHealthStatus): string {
  switch (status) {
    case "healthy":
      return "Healthy";
    case "warning":
      return "Warning";
    case "critical":
      return "Critical";
    default:
      return "Idle";
  }
}

export function getHealthStatusColor(status: ContextHealthStatus): string {
  switch (status) {
    case "healthy":
      return "var(--accent-emerald)";
    case "warning":
      return "var(--accent-amber)";
    case "critical":
      return "var(--accent-rose)";
    default:
      return "var(--text-muted)";
  }
}

export function formatTokenCount(tokens: number): string {
  const n = Math.max(0, Math.round(tokens));
  return n.toLocaleString("en-US");
}

export function formatCompactTokens(tokens: number): string {
  const n = Math.max(0, Math.round(tokens));
  if (n >= 10000) {
    return `${(n / 1000).toFixed(1)}k`;
  }
  return n.toLocaleString("en-US");
}

export function getPhaseSummary(
  telemetry: TurnTelemetry | null | undefined,
  phase: TelemetryPhaseKey,
): PhaseTelemetrySummary | null {
  if (!telemetry || !telemetry.phases) return null;
  return telemetry.phases[phase] ?? null;
}

/**
 * Compute vertical fill height (%) for the compact 4-bar micro-meter in the top bar.
 */
export function getMicroBarHeightPct(phase: PhaseTelemetrySummary | null): number {
  if (!phase || phase.status === "idle") return 18;
  if (phase.peak_utilization_pct != null) {
    return Math.max(20, Math.min(100, Math.round(phase.peak_utilization_pct)));
  }
  // Known tokens but unknown ceiling (cloud provider without context_length)
  if (phase.peak_prompt_tokens > 0) {
    return 42;
  }
  return 20;
}

export function buildContextHealthTooltip(telemetry: TurnTelemetry | null): string {
  if (!telemetry || telemetry.overall_status === "idle") {
    return "Context Health: No turn telemetry yet. Send a turn to inspect per-phase token usage.";
  }
  const statusLabel = getHealthStatusLabel(telemetry.overall_status);
  const p4 = getPhaseSummary(telemetry, "phase4_prose");
  const details: string[] = [];
  if (p4 && p4.status !== "idle") {
    if (p4.peak_utilization_pct != null && p4.context_ceiling) {
      details.push(
        `Phase 4: ${p4.peak_utilization_pct.toFixed(0)}% of ${formatCompactTokens(p4.context_ceiling)} tok`,
      );
    } else if (p4.peak_prompt_tokens > 0) {
      details.push(`Phase 4: ${formatCompactTokens(p4.peak_prompt_tokens)} tok`);
    }
    if (p4.cropped_summary) {
      details.push(p4.cropped_summary);
    } else if (p4.dropped_summary) {
      details.push(p4.dropped_summary);
    }
  }
  if (telemetry.phase5_pending) {
    details.push("Phase 5 running…");
  }
  const suffix = details.length > 0 ? ` — ${details.join(" · ")}` : "";
  return `Context Health: ${statusLabel}${suffix}. Click to inspect phase usage.`;
}

export function buildActionableRecommendation(telemetry: TurnTelemetry | null): string | null {
  if (!telemetry) return null;
  if (telemetry.overall_status !== "warning" && telemetry.overall_status !== "critical") {
    return null;
  }

  const p4 = getPhaseSummary(telemetry, "phase4_prose");
  const rep = p4?.budget_report;

  if (rep?.base_exceeds_budget) {
    return "Zone 1 (static prompt) + Zone 4 (ephemeral scene frame) alone exceed the Actor input budget. Increase Actor Context Size in Model Settings or switch to the Fast & Concise prompt preset.";
  }

  if (rep?.trimmed_below_min_wm) {
    return "Working memory was trimmed below your minimum protected turn floor to fit the Actor window. Increase Actor Context Size or reduce Zone 1 character/world prompt length.";
  }

  const anyTruncated = TELEMETRY_PHASE_ORDER.some(
    (k) => getPhaseSummary(telemetry, k)?.truncated_output,
  );
  if (anyTruncated) {
    return "At least one phase hit its max_tokens output limit and was cut off. Increase Max Output Tokens for the affected role in Model Settings.";
  }

  if (telemetry.overall_status === "critical") {
    return "Prompt tokens reached or exceeded the model's context ceiling, risking silent left-cropping. Increase Context Size in Model Settings or lower Working Memory Turns.";
  }

  if (rep && (rep.dropped_zone3_turns > 0 || rep.dropped_zone2_chunks > 0 || rep.downgraded_zone2_chunks > 0)) {
    const z1Share =
      rep.context_ceiling && rep.context_ceiling > 0
        ? Math.round((rep.zone1_tokens / rep.context_ceiling) * 100)
        : null;
    if (z1Share !== null && z1Share >= 45) {
      return `Zone 1 static prompt uses ~${z1Share}% of your Actor context window, leaving limited room for history. Increase Actor Context Size or switch to the Fast & Concise preset.`;
    }
    return "Older working-memory turns or episodic summaries were trimmed to stay within the Actor context budget. Increase Actor Context Size in Model Settings to retain deeper history.";
  }

  return "One or more phases are above 90% context utilization. Increase Context Size in Model Settings to leave headroom and avoid cropping.";
}
