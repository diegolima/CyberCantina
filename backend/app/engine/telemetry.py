"""Turn-scoped ContextVar telemetry collector and Context Health classifier."""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from typing import Iterator

from app.schemas.telemetry import (
    AggregateUsageSource,
    ContextHealthStatus,
    LlmCallTelemetry,
    Phase4BudgetReport,
    PhaseTelemetrySummary,
    TelemetryPhaseKey,
    TurnTelemetry,
)

ALL_TELEMETRY_PHASES: tuple[TelemetryPhaseKey, ...] = (
    "phase1_pre",
    "phase3_cognition",
    "phase4_prose",
    "phase5_clerk",
)

_STATUS_RANK: dict[ContextHealthStatus, int] = {
    "idle": 0,
    "healthy": 1,
    "warning": 2,
    "critical": 3,
}

_WARNING_UTILIZATION_THRESHOLD_PCT = 90.0

active_turn_telemetry: ContextVar[TurnTelemetryCollector | None] = ContextVar(
    "active_turn_telemetry", default=None
)
active_telemetry_phase: ContextVar[TelemetryPhaseKey | None] = ContextVar(
    "active_telemetry_phase", default=None
)
active_telemetry_label: ContextVar[str | None] = ContextVar(
    "active_telemetry_label", default=None
)


@contextmanager
def telemetry_phase_scope(
    phase: TelemetryPhaseKey,
    label: str | None = None,
) -> Iterator[None]:
    """Tag nested llm_client calls with a telemetry phase and descriptive sub-call label."""
    tok_phase = active_telemetry_phase.set(phase)
    tok_label = active_telemetry_label.set(label)
    try:
        yield
    finally:
        active_telemetry_phase.reset(tok_phase)
        active_telemetry_label.reset(tok_label)


def _aggregate_usage_source(sources: list[str]) -> AggregateUsageSource:
    if not sources:
        return "none"
    unique = set(sources)
    if unique == {"exact"}:
        return "exact"
    if unique == {"estimated"}:
        return "estimated"
    return "mixed"


def _worst_status(statuses: list[ContextHealthStatus]) -> ContextHealthStatus:
    best: ContextHealthStatus = "idle"
    for st in statuses:
        if _STATUS_RANK[st] > _STATUS_RANK[best]:
            best = st
    return best


def _format_dropped_summary(report: Phase4BudgetReport | None) -> str | None:
    if report is None:
        return None
    parts: list[str] = []
    if report.dropped_zone3_turns > 0:
        unit = "turn" if report.dropped_zone3_turns == 1 else "turns"
        parts.append(f"{report.dropped_zone3_turns} working-memory {unit} dropped")
    if report.dropped_zone2_chunks > 0:
        unit = "chunk" if report.dropped_zone2_chunks == 1 else "chunks"
        parts.append(f"{report.dropped_zone2_chunks} episodic {unit} dropped")
    if report.downgraded_zone2_chunks > 0:
        unit = "chunk" if report.downgraded_zone2_chunks == 1 else "chunks"
        parts.append(f"{report.downgraded_zone2_chunks} episodic {unit} downgraded")
    return " · ".join(parts) if parts else None


def _format_cropped_summary(
    *,
    report: Phase4BudgetReport | None,
    provider_hit_ceiling: bool,
    provider_overflow_tokens: int,
    peak_prompt_tokens: int,
    context_ceiling: int | None,
    truncated_output: bool,
) -> str | None:
    parts: list[str] = []
    if report is not None and report.base_exceeds_budget:
        if report.estimated_cropped_tokens > 0:
            parts.append(
                f"~{report.estimated_cropped_tokens:,} tok overflow (Zone 1+4 exceeded budget)"
            )
        else:
            parts.append("Zone 1+4 exceeded input budget")
    if report is not None and report.trimmed_below_min_wm:
        parts.append("trimmed below minimum working-memory floor")
    if provider_hit_ceiling and context_ceiling is not None:
        if provider_overflow_tokens > 0:
            parts.append(f"{provider_overflow_tokens:,} prompt tok exceeded {context_ceiling:,} limit")
        else:
            parts.append(f"prompt reached {peak_prompt_tokens:,} / {context_ceiling:,} tok limit")
    if truncated_output:
        parts.append("output truncated at max_tokens")
    return " · ".join(parts) if parts else None


def classify_phase_telemetry(
    phase: TelemetryPhaseKey,
    calls: list[LlmCallTelemetry],
    budget_report: Phase4BudgetReport | None = None,
) -> PhaseTelemetrySummary:
    """Compute aggregated metrics and Context Health status for a single LLM phase."""
    if not calls and budget_report is None:
        return PhaseTelemetrySummary(phase=phase, status="idle")

    total_prompt = sum(c.prompt_tokens for c in calls)
    total_completion = sum(c.completion_tokens for c in calls)
    peak_prompt = max((c.prompt_tokens for c in calls), default=0)

    # Determine peak single-call utilization and corresponding ceiling
    peak_pct: float | None = None
    effective_ceiling: int | None = None
    provider_overflow_tokens = 0
    for c in calls:
        ceiling = c.context_ceiling
        if ceiling is None and budget_report is not None:
            ceiling = budget_report.context_ceiling
        if ceiling is not None and ceiling > 0:
            pct = (c.prompt_tokens / ceiling) * 100.0
            if peak_pct is None or pct > peak_pct:
                peak_pct = round(pct, 1)
                effective_ceiling = ceiling
            if c.prompt_tokens >= ceiling:
                provider_overflow_tokens = max(
                    provider_overflow_tokens,
                    max(1, c.prompt_tokens - ceiling) if c.prompt_tokens > ceiling else c.prompt_tokens,
                )
    if effective_ceiling is None and budget_report is not None:
        effective_ceiling = budget_report.context_ceiling
        if effective_ceiling and effective_ceiling > 0 and peak_prompt > 0:
            peak_pct = round((peak_prompt / effective_ceiling) * 100.0, 1)

    truncated_output = any(c.finish_reason == "length" for c in calls)
    has_provider_crop = any(
        c.context_ceiling is not None
        and c.context_ceiling > 0
        and c.prompt_tokens >= c.context_ceiling
        for c in calls
    )

    is_critical = (
        truncated_output
        or has_provider_crop
        or (
            budget_report is not None
            and (budget_report.base_exceeds_budget or budget_report.trimmed_below_min_wm)
        )
    )
    is_warning = (
        not is_critical
        and (
            (
                budget_report is not None
                and (
                    budget_report.dropped_zone3_turns > 0
                    or budget_report.dropped_zone2_chunks > 0
                    or budget_report.downgraded_zone2_chunks > 0
                )
            )
            or (peak_pct is not None and peak_pct >= _WARNING_UTILIZATION_THRESHOLD_PCT)
        )
    )

    if not calls:
        status: ContextHealthStatus = "critical" if is_critical else ("warning" if is_warning else "idle")
    elif is_critical:
        status = "critical"
    elif is_warning:
        status = "warning"
    else:
        status = "healthy"

    dropped_summary = _format_dropped_summary(budget_report)
    cropped_summary = (
        _format_cropped_summary(
            report=budget_report,
            provider_hit_ceiling=has_provider_crop,
            provider_overflow_tokens=(
                max(0, peak_prompt - effective_ceiling)
                if has_provider_crop and effective_ceiling is not None
                else 0
            ),
            peak_prompt_tokens=peak_prompt,
            context_ceiling=effective_ceiling,
            truncated_output=truncated_output,
        )
        if is_critical
        else None
    )

    return PhaseTelemetrySummary(
        phase=phase,
        status=status,
        call_count=len(calls),
        peak_prompt_tokens=peak_prompt,
        total_prompt_tokens=total_prompt,
        total_completion_tokens=total_completion,
        context_ceiling=effective_ceiling,
        peak_utilization_pct=peak_pct,
        usage_source=_aggregate_usage_source([c.usage_source for c in calls]),
        dropped_summary=dropped_summary,
        cropped_summary=cropped_summary,
        truncated_output=truncated_output,
        budget_report=budget_report,
        calls=list(calls),
    )


class TurnTelemetryCollector:
    """Mutable per-turn accumulator bound to ``active_turn_telemetry``."""

    def __init__(self) -> None:
        self._calls: list[LlmCallTelemetry] = []
        self._phase4_budget: Phase4BudgetReport | None = None

    def record_call(self, call: LlmCallTelemetry) -> None:
        self._calls.append(call)

    def set_phase4_budget(self, report: Phase4BudgetReport) -> None:
        self._phase4_budget = report

    def build_snapshot(self, *, phase5_pending: bool = False) -> TurnTelemetry:
        phases: dict[TelemetryPhaseKey, PhaseTelemetrySummary] = {}
        for phase in ALL_TELEMETRY_PHASES:
            phase_calls = [c for c in self._calls if c.phase == phase]
            budget = self._phase4_budget if phase == "phase4_prose" else None
            phases[phase] = classify_phase_telemetry(phase, phase_calls, budget)

        overall = _worst_status([p.status for p in phases.values()])
        return TurnTelemetry(
            overall_status=overall,
            total_prompt_tokens=sum(c.prompt_tokens for c in self._calls),
            total_completion_tokens=sum(c.completion_tokens for c in self._calls),
            usage_source=_aggregate_usage_source([c.usage_source for c in self._calls]),
            phase5_pending=phase5_pending,
            phases=phases,
        )
