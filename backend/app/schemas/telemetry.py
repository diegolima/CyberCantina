"""Leaf Pydantic v2 schemas for per-turn LLM token usage and Context Health telemetry."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

TelemetryPhaseKey = Literal[
    "phase1_pre",
    "phase3_cognition",
    "phase4_prose",
    "phase5_clerk",
]

ContextHealthStatus = Literal["healthy", "warning", "critical", "idle"]

TokenUsageSource = Literal["exact", "estimated"]

AggregateUsageSource = Literal["exact", "estimated", "mixed", "none"]


class LlmCallTelemetry(BaseModel):
    """Telemetry captured for a single LLM invocation within a turn phase."""

    phase: TelemetryPhaseKey
    label: str
    model: str = ""
    provider_type: str = ""
    prompt_tokens: int = Field(default=0, ge=0)
    completion_tokens: int = Field(default=0, ge=0)
    usage_source: TokenUsageSource = "estimated"
    context_ceiling: int | None = Field(default=None, ge=1)
    finish_reason: str = "unknown"
    retries: int = Field(default=0, ge=0)
    duration_ms: int = Field(default=0, ge=0)
    error: str | None = None


class Phase4BudgetReport(BaseModel):
    """4-zone token budget and trimming/overflow report from Phase 4 prompt assembly."""

    context_ceiling: int | None = Field(default=None, ge=1)
    reserved_output_tokens: int = Field(default=0, ge=0)
    safety_margin_tokens: int = Field(default=256, ge=0)
    input_budget: int | None = Field(default=None, ge=0)

    zone1_tokens: int = Field(default=0, ge=0)
    zone2_tokens: int = Field(default=0, ge=0)
    zone3_tokens: int = Field(default=0, ge=0)
    zone4_tokens: int = Field(default=0, ge=0)

    total_zone3_turns_available: int = Field(default=0, ge=0)
    dropped_zone3_turns: int = Field(default=0, ge=0)
    trimmed_below_min_wm: bool = False

    total_zone2_chunks_available: int = Field(default=0, ge=0)
    downgraded_zone2_chunks: int = Field(default=0, ge=0)
    dropped_zone2_chunks: int = Field(default=0, ge=0)

    base_exceeds_budget: bool = False
    estimated_cropped_tokens: int = Field(default=0, ge=0)


class PhaseTelemetrySummary(BaseModel):
    """Aggregated telemetry and health verdict for one of the 4 LLM phases."""

    phase: TelemetryPhaseKey
    status: ContextHealthStatus = "idle"
    call_count: int = Field(default=0, ge=0)
    peak_prompt_tokens: int = Field(default=0, ge=0)
    total_prompt_tokens: int = Field(default=0, ge=0)
    total_completion_tokens: int = Field(default=0, ge=0)
    context_ceiling: int | None = Field(default=None, ge=1)
    peak_utilization_pct: float | None = Field(default=None, ge=0.0)
    usage_source: AggregateUsageSource = "none"
    dropped_summary: str | None = None
    cropped_summary: str | None = None
    truncated_output: bool = False
    budget_report: Phase4BudgetReport | None = None
    calls: list[LlmCallTelemetry] = Field(default_factory=list)


class TurnTelemetry(BaseModel):
    """Complete per-turn context telemetry snapshot persisted on a turn_node."""

    overall_status: ContextHealthStatus = "idle"
    total_prompt_tokens: int = Field(default=0, ge=0)
    total_completion_tokens: int = Field(default=0, ge=0)
    usage_source: AggregateUsageSource = "none"
    phase5_pending: bool = False
    phases: dict[TelemetryPhaseKey, PhaseTelemetrySummary] = Field(default_factory=dict)
