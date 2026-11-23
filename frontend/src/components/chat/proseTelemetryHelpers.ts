import type { LlmCallTelemetry, ProviderColor, TurnTelemetry } from "../../types";
import { TELEMETRY_PHASE_ORDER } from "./contextHealthHelpers";

export interface ProseSpeedMetric {
  tokPerSec: number;
  kind: "decode" | "stream_decode" | "e2e";
  estimated: boolean;
}

const VALID_PROVIDER_COLORS: ReadonlySet<ProviderColor> = new Set<ProviderColor>([
  "neutral",
  "cyan",
  "purple",
  "indigo",
  "bronze",
]);

const PROVIDER_TYPE_LABELS: Record<string, string> = {
  ollama: "Ollama",
  openrouter: "OpenRouter",
  nanogpt: "NanoGPT",
  aihorde: "AI Horde",
  openai_compat: "OpenAI-Compatible",
  browser_ollama: "Browser Ollama",
  webgpu: "WebGPU",
};

/** Return the final recorded Phase 4 prose call for a turn, or null if absent. */
export function getProseCallTelemetry(
  telemetry: TurnTelemetry | null | undefined,
): LlmCallTelemetry | null {
  const calls = telemetry?.phases?.phase4_prose?.calls;
  if (!calls || calls.length === 0) return null;
  return calls[calls.length - 1] ?? null;
}

/** Resolve a valid ProviderColor token from call telemetry, defaulting to neutral. */
export function resolveProseProviderColor(call: LlmCallTelemetry): ProviderColor {
  const c = call.provider_color;
  if (c && VALID_PROVIDER_COLORS.has(c)) {
    return c;
  }
  return "neutral";
}

/** Resolve the user-facing provider label from snapshotted name or provider_type fallback. */
export function resolveProseProviderLabel(call: LlmCallTelemetry): string {
  const snap = (call.provider_name ?? "").trim();
  if (snap) return snap;
  const ptype = (call.provider_type ?? "").trim();
  if (!ptype) return "Provider";
  return PROVIDER_TYPE_LABELS[ptype] ?? ptype;
}

/** Shorten verbose registry prefixes (e.g. hf.co/<org>/) for compact footer pill display. */
export function formatShortModelLabel(model: string): string {
  const trimmed = (model ?? "").trim();
  if (!trimmed) return "Model";
  if (trimmed.toLowerCase().startsWith("hf.co/")) {
    const parts = trimmed.split("/");
    if (parts.length >= 3 && parts.slice(2).join("/").trim()) {
      return parts.slice(2).join("/");
    }
  }
  return trimmed;
}

/** Format positive durations in ms into compact human-readable spans. */
export function formatDurationMs(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const totalSec = ms / 1000;
  if (totalSec < 60) return `${totalSec.toFixed(1)}s`;
  const mins = Math.floor(totalSec / 60);
  const remSec = Math.round(totalSec % 60);
  if (remSec === 60) return `${mins + 1}m 0s`;
  return `${mins}m ${remSec}s`;
}

/**
 * Compute tokens/s for a prose call while avoiding misleading throughput when
 * prompt evaluation dominates or token counts are purely heuristic.
 */
export function computeProseSpeed(call: LlmCallTelemetry): ProseSpeedMetric | null {
  if (!Number.isFinite(call.completion_tokens) || call.completion_tokens <= 0) {
    return null;
  }
  const estimated = call.usage_source !== "exact";

  if (call.eval_duration_ms != null && Number.isFinite(call.eval_duration_ms) && call.eval_duration_ms > 0) {
    return {
      tokPerSec: call.completion_tokens / (call.eval_duration_ms / 1000),
      kind: "decode",
      estimated,
    };
  }

  if (call.ttft_ms != null && Number.isFinite(call.ttft_ms) && Number.isFinite(call.duration_ms)) {
    const decodeMs = call.duration_ms - call.ttft_ms;
    if (decodeMs >= 200 && call.completion_tokens >= 5) {
      return {
        tokPerSec: call.completion_tokens / (decodeMs / 1000),
        kind: "stream_decode",
        estimated,
      };
    }
  }

  if (call.usage_source === "exact" && Number.isFinite(call.duration_ms) && call.duration_ms >= 200) {
    return {
      tokPerSec: call.completion_tokens / (call.duration_ms / 1000),
      kind: "e2e",
      estimated: false,
    };
  }

  return null;
}

/** Format a computed ProseSpeedMetric into display text (e.g. "48.2 tok/s"). */
export function formatProseSpeed(metric: ProseSpeedMetric | null): string | null {
  if (!metric || !Number.isFinite(metric.tokPerSec) || metric.tokPerSec <= 0) {
    return null;
  }
  const prefix = metric.estimated ? "~" : "";
  const val = metric.tokPerSec >= 100 ? metric.tokPerSec.toFixed(0) : metric.tokPerSec.toFixed(1);
  const suffix = metric.kind === "e2e" ? " (e2e)" : "";
  return `${prefix}${val} tok/s${suffix}`;
}

/** Sum non-null provider-reported USD costs across all recorded phases on a turn. */
export function computeTurnTotalCostUsd(
  telemetry: TurnTelemetry | null | undefined,
): { totalUsd: number; paidCallCount: number } | null {
  if (!telemetry?.phases) return null;
  let totalUsd = 0;
  let paidCallCount = 0;
  for (const phaseKey of TELEMETRY_PHASE_ORDER) {
    const summary = telemetry.phases[phaseKey];
    if (!summary?.calls) continue;
    for (const c of summary.calls) {
      if (c.cost_usd != null && Number.isFinite(c.cost_usd) && c.cost_usd >= 0) {
        totalUsd += c.cost_usd;
        paidCallCount += 1;
      }
    }
  }
  if (paidCallCount === 0) return null;
  return { totalUsd, paidCallCount };
}

/** Format a USD cost value cleanly without rounding away micro-costs. */
export function formatCostUsd(costUsd: number | null | undefined): string | null {
  if (costUsd == null || !Number.isFinite(costUsd) || costUsd < 0) return null;
  if (costUsd === 0) return "$0.00";
  if (costUsd < 0.0001) return "<$0.0001";
  if (costUsd < 0.01) return `$${costUsd.toFixed(4)}`;
  return `$${costUsd.toFixed(2)}`;
}
