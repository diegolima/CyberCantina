import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Cpu,
  Flag,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import type {
  CampaignStateBundle,
  CharacterRecord,
  MechanicsTopicId,
  Phase4BudgetReport,
  RecalledMemoryItem,
  TelemetryPhaseKey,
  TurnNodeRecord,
  TurnTelemetry,
  WorldRecord,
} from "../../types";
import { LoreIndexPanel, buildLoreIndexEntries } from "../inspector/LoreIndexModal";
import { MechanicsHelpButton } from "../shared/MechanicsHelpButton";
import {
  PHASE_DISPLAY_META,
  TELEMETRY_PHASE_ORDER,
  buildActionableRecommendation,
  formatTokenCount,
  getHealthStatusColor,
  getHealthStatusLabel,
  getPhaseSummary,
} from "./contextHealthHelpers";
import { formatDurationMs } from "./proseTelemetryHelpers";

export type ContextHealthTab = "telemetry" | "scene_recall" | "lore_index";

const RECALL_SOURCE_LABEL: Record<RecalledMemoryItem["source_type"], string> = {
  lore: "Lore",
  location_lore: "Loc Lore",
  container_lore: "Cont Lore",
  character_shard: "Shard",
  episodic_chunk: "Episode",
  item_lore: "Item",
};

const FLAG_PREVIEW_LIMIT = 12;

interface ContextHealthModalProps {
  isOpen: boolean;
  onClose: () => void;
  telemetry: TurnTelemetry | null;
  turnDepth?: number | null;
  bundle?: CampaignStateBundle | null;
  world?: WorldRecord | null;
  characters?: CharacterRecord[];
  inspectedTurn?: TurnNodeRecord | null;
  initialTab?: ContextHealthTab;
  onOpenSettings?: () => void;
  onOpenMechanicsHelp?: (topicId: MechanicsTopicId) => void;
  initialExpandedPhases?: Partial<Record<TelemetryPhaseKey, boolean>>;
}

const ZoneBreakdownBar: React.FC<{
  report: Phase4BudgetReport;
  completionTokens: number;
}> = ({ report, completionTokens }) => {
  const segments = [
    { key: "z1", label: "Zone 1 Static", tokens: report.zone1_tokens, color: "#38bdf8" },
    { key: "z2", label: "Zone 2 Episodic", tokens: report.zone2_tokens, color: "#a78bfa" },
    { key: "z3", label: "Zone 3 Working Mem", tokens: report.zone3_tokens, color: "#10b981" },
    { key: "z4", label: "Zone 4 Ephemeral/RAG", tokens: report.zone4_tokens, color: "#f59e0b" },
    { key: "out", label: "Output", tokens: completionTokens, color: "#94a3b8" },
  ];
  const total = segments.reduce((acc, s) => acc + s.tokens, 0);
  if (total <= 0) return null;

  return (
    <div className="context-health-zones">
      <div className="context-health-zones-bar" aria-label="Phase 4 4-zone token distribution">
        {segments.map((seg) =>
          seg.tokens > 0 ? (
            <div
              key={seg.key}
              className="context-health-zone-seg"
              style={{
                width: `${(seg.tokens / total) * 100}%`,
                background: seg.color,
              }}
              title={`${seg.label}: ~${formatTokenCount(seg.tokens)} tok (${Math.round((seg.tokens / total) * 100)}%)`}
            />
          ) : null
        )}
      </div>
      <div className="context-health-zones-legend">
        {segments.map((seg) => (
          <span key={seg.key} className="context-health-zone-item">
            <span
              className="context-health-zone-swatch"
              style={{ background: seg.color }}
              aria-hidden="true"
            />
            <span>{seg.label}:</span>
            <strong>{formatTokenCount(seg.tokens)}</strong>
          </span>
        ))}
      </div>
    </div>
  );
};

export const ContextHealthModal: React.FC<ContextHealthModalProps> = ({
  isOpen,
  onClose,
  telemetry,
  turnDepth,
  bundle = null,
  world = null,
  characters = [],
  inspectedTurn = null,
  initialTab = "telemetry",
  onOpenSettings,
  onOpenMechanicsHelp,
  initialExpandedPhases,
}) => {
  const [activeTab, setActiveTab] = useState<ContextHealthTab>(initialTab);
  const [expandedPhases, setExpandedPhases] = useState<Record<string, boolean>>(() => ({
    ...(initialExpandedPhases ?? {}),
  }));
  const [showAllFlags, setShowAllFlags] = useState(false);
  const [expandedRecalls, setExpandedRecalls] = useState<Set<string>>(new Set());

  const inspectedTurnId = inspectedTurn?.id ?? null;

  useEffect(() => {
    if (!isOpen) return;
    setActiveTab(initialTab);
    setShowAllFlags(false);
    setExpandedRecalls(new Set());
  }, [isOpen, inspectedTurnId, initialTab]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  const effectiveWorld = useMemo<WorldRecord | null>(() => {
    if (world) return world;
    if (!bundle) return null;
    return {
      id: bundle.campaign.world_id,
      name: bundle.campaign.world_name || "Active World",
      lore_nodes: bundle.world_lore_nodes ?? [],
      locations: bundle.visible_locations ?? [],
      containers: bundle.containers ?? [],
      edges: bundle.visible_edges ?? [],
    } as unknown as WorldRecord;
  }, [world, bundle]);

  const unlockLore = Boolean(bundle?.campaign.world_settings?.unlock_lore);
  const revealedLoreIds = useMemo(
    () =>
      inspectedTurn?.world_snapshot?.revealed_lore_ids ??
      bundle?.current_world_snapshot.revealed_lore_ids ??
      [],
    [inspectedTurn, bundle]
  );
  const sceneFlags = useMemo(
    () =>
      inspectedTurn?.world_snapshot?.scene_flags ??
      bundle?.current_world_snapshot.scene_flags ??
      [],
    [inspectedTurn, bundle]
  );
  const recalledItems = useMemo(
    () => inspectedTurn?.recalled_items ?? [],
    [inspectedTurn]
  );

  const lastBranchTurn =
    bundle && bundle.active_branch_turns.length > 0
      ? bundle.active_branch_turns[bundle.active_branch_turns.length - 1]
      : undefined;
  const isHistoricalTurn = Boolean(
    inspectedTurn && lastBranchTurn && inspectedTurn.id !== lastBranchTurn.id
  );
  const effectiveLocationId =
    inspectedTurn?.world_snapshot?.active_location_id ??
    bundle?.active_location.id;

  const indexedLoreEntries = useMemo(() => {
    if (!effectiveWorld) return [];
    return buildLoreIndexEntries({
      world: effectiveWorld,
      worldLoreNodes: bundle?.world_lore_nodes ?? effectiveWorld.lore_nodes,
      characters,
      locations: bundle?.visible_locations ?? effectiveWorld.locations,
      containers: bundle?.containers ?? effectiveWorld.containers,
      activeLocationId: effectiveLocationId,
      recalledItems,
      unlockLore,
      revealedLoreIds,
    });
  }, [
    effectiveWorld,
    bundle,
    characters,
    effectiveLocationId,
    recalledItems,
    unlockLore,
    revealedLoreIds,
  ]);

  if (!isOpen) return null;

  const overallStatus = telemetry?.overall_status ?? "idle";
  const statusLabel = getHealthStatusLabel(overallStatus);
  const statusColor = getHealthStatusColor(overallStatus);
  const recommendation = buildActionableRecommendation(telemetry);
  const turnsCount = bundle?.active_branch_turns.length ?? 0;
  const episodicChunksCount = bundle?.episodic_chunks.length ?? 0;
  const recallHeading = isHistoricalTurn
    ? `Recalled on Turn #${inspectedTurn?.depth_index ?? 0}`
    : "Recalled Last Turn";

  const toggleExpand = (phaseKey: TelemetryPhaseKey) => {
    setExpandedPhases((prev) => ({ ...prev, [phaseKey]: !prev[phaseKey] }));
  };

  const toggleRecall = (key: string) =>
    setExpandedRecalls((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const handleOpenHelpFromModal = onOpenMechanicsHelp
    ? (topicId: MechanicsTopicId) => {
        onClose();
        onOpenMechanicsHelp(topicId);
      }
    : undefined;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Context Health & Diagnostics"
      onClick={onClose}
    >
      <div
        className="modal-panel context-health-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Activity size={18} color={statusColor} />
            <h2 style={{ margin: 0, fontSize: "1.02rem" }}>Context Health</h2>
            <span
              className={`context-health-status-badge context-health-${overallStatus}`}
              style={{
                borderColor: statusColor,
                color: statusColor,
              }}
            >
              {statusLabel}
            </span>
            <MechanicsHelpButton
              topicId="memory-context-health"
              label="Context Health & 4-Zone Economy"
              onOpenHelp={handleOpenHelpFromModal}
            />
          </div>
          <button
            type="button"
            className="btn context-health-close-btn"
            onClick={onClose}
            aria-label="Close Context Health modal"
          >
            <X size={16} />
          </button>
        </div>

        <div
          className="context-health-tabs"
          role="tablist"
          aria-label="Context Health diagnostics tabs"
        >
          <button
            type="button"
            role="tab"
            id="context-health-tab-telemetry"
            aria-selected={activeTab === "telemetry"}
            className={`context-health-tab${
              activeTab === "telemetry" ? " active" : ""
            }`}
            onClick={() => setActiveTab("telemetry")}
          >
            <Activity size={13} />
            <span>Telemetry</span>
          </button>
          <button
            type="button"
            role="tab"
            id="context-health-tab-scene-recall"
            aria-selected={activeTab === "scene_recall"}
            className={`context-health-tab${
              activeTab === "scene_recall" ? " active" : ""
            }`}
            onClick={() => setActiveTab("scene_recall")}
          >
            <Cpu size={13} />
            <span>Scene &amp; Recall</span>
            {(bundle || inspectedTurn) && (
              <span className="context-health-tab-count">
                {sceneFlags.length} · {recalledItems.length}
              </span>
            )}
          </button>
          <button
            type="button"
            role="tab"
            id="context-health-tab-lore-index"
            aria-selected={activeTab === "lore_index"}
            className={`context-health-tab${
              activeTab === "lore_index" ? " active" : ""
            }`}
            onClick={() => setActiveTab("lore_index")}
          >
            <BookOpen size={13} />
            <span>Lore Index</span>
            {effectiveWorld && (
              <span className="context-health-tab-count">
                {indexedLoreEntries.length}
              </span>
            )}
          </button>
        </div>

        <div className="modal-body context-health-modal-body">
          {activeTab === "telemetry" && (
            <div role="tabpanel" aria-labelledby="context-health-tab-telemetry">
              {!telemetry || overallStatus === "idle" ? (
                <div className="ui-empty-state ui-empty-state--dashed">
                  <p style={{ margin: 0, fontWeight: 600 }}>No turn telemetry recorded yet.</p>
                  <p style={{ margin: "6px 0 0", color: "var(--text-muted)", fontSize: "0.84rem" }}>
                    Send a message in this campaign to capture exact per-phase token usage, working-memory
                    trimming, and context-window headroom across all 4 LLM phases.
                  </p>
                </div>
              ) : (
                <div className="context-health-tab-panel">
                  <div className="context-health-summary-bar">
                    <div className="context-health-summary-stat">
                      <span className="context-health-stat-label">Turn</span>
                      <strong>{turnDepth != null ? `#${turnDepth}` : "Latest"}</strong>
                    </div>
                    <div className="context-health-summary-stat">
                      <span className="context-health-stat-label">Total Prompt</span>
                      <strong>{formatTokenCount(telemetry.total_prompt_tokens)} tok</strong>
                    </div>
                    <div className="context-health-summary-stat">
                      <span className="context-health-stat-label">Total Output</span>
                      <strong>{formatTokenCount(telemetry.total_completion_tokens)} tok</strong>
                    </div>
                    <div className="context-health-summary-stat">
                      <span className="context-health-stat-label">Measurement</span>
                      <strong>
                        {telemetry.usage_source === "exact"
                          ? "Exact (Provider)"
                          : telemetry.usage_source === "mixed"
                            ? "Mixed (Exact + Est.)"
                            : "Estimated"}
                      </strong>
                    </div>
                  </div>

                  {recommendation && (
                    <div
                      className={`context-health-recommendation context-health-${overallStatus}`}
                      style={{ borderColor: statusColor }}
                    >
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                        <AlertTriangle
                          size={16}
                          color={statusColor}
                          style={{ flexShrink: 0, marginTop: 2 }}
                        />
                        <div style={{ flex: 1, fontSize: "0.83rem", lineHeight: 1.45 }}>
                          {recommendation}
                        </div>
                      </div>
                      {onOpenSettings && (
                        <button
                          type="button"
                          className="btn context-health-settings-btn"
                          onClick={() => {
                            onClose();
                            onOpenSettings();
                          }}
                          style={{ flexShrink: 0 }}
                        >
                          <Settings size={13} />
                          Open Model Settings
                        </button>
                      )}
                    </div>
                  )}

                  <div className="context-health-phase-list">
                    {TELEMETRY_PHASE_ORDER.map((phaseKey) => {
                      const meta = PHASE_DISPLAY_META[phaseKey];
                      const summary = getPhaseSummary(telemetry, phaseKey);
                      const phaseStatus = summary?.status ?? "idle";
                      const phaseColor = getHealthStatusColor(phaseStatus);
                      const pct = summary?.peak_utilization_pct ?? null;
                      const visualWidth =
                        phaseStatus === "idle"
                          ? 0
                          : pct != null
                            ? Math.min(100, Math.max(2, pct))
                            : 25;
                      const isOverflow = pct != null && pct > 100;
                      const isExpanded = Boolean(expandedPhases[phaseKey]);
                      const hasCalls = Boolean(summary && summary.calls.length > 0);
                      const isPending = phaseKey === "phase5_clerk" && telemetry.phase5_pending;

                      return (
                        <div
                          key={phaseKey}
                          className={`context-health-phase-card context-health-${phaseStatus}`}
                        >
                          <button
                            type="button"
                            className="context-health-phase-header"
                            onClick={() => hasCalls && toggleExpand(phaseKey)}
                            disabled={!hasCalls}
                            aria-expanded={hasCalls ? isExpanded : undefined}
                          >
                            <div className="context-health-phase-title-group">
                              {hasCalls ? (
                                isExpanded ? (
                                  <ChevronDown size={14} color="var(--text-muted)" />
                                ) : (
                                  <ChevronRight size={14} color="var(--text-muted)" />
                                )
                              ) : (
                                <span style={{ width: 14, display: "inline-block" }} />
                              )}
                              <div>
                                <div className="context-health-phase-title">
                                  {meta.title}
                                  {summary && summary.call_count > 1 && (
                                    <span className="context-health-call-count">
                                      {summary.call_count} calls
                                    </span>
                                  )}
                                  {isPending && (
                                    <span className="context-health-call-count">running…</span>
                                  )}
                                </div>
                                <div className="context-health-phase-subtitle">{meta.subtitle}</div>
                              </div>
                            </div>

                            <div className="context-health-phase-metric">
                              {phaseStatus === "idle" ? (
                                <span className="context-health-muted">Skipped / Idle</span>
                              ) : pct != null && summary?.context_ceiling ? (
                                <>
                                  <strong style={{ color: phaseColor }}>
                                    {pct.toFixed(1)}%
                                  </strong>
                                  <span className="context-health-muted">
                                    {formatTokenCount(summary.peak_prompt_tokens)} /{" "}
                                    {formatTokenCount(summary.context_ceiling)} tok
                                  </span>
                                </>
                              ) : (
                                <>
                                  <strong style={{ color: phaseColor }}>
                                    {formatTokenCount(summary?.peak_prompt_tokens ?? 0)} tok
                                  </strong>
                                  <span className="context-health-muted">limit unknown</span>
                                </>
                              )}
                            </div>
                          </button>

                          <div className="context-health-bar-track">
                            <div
                              className={`context-health-bar-fill${isOverflow ? " is-overflow" : ""}`}
                              style={{
                                width: `${visualWidth}%`,
                                background: phaseColor,
                              }}
                            />
                          </div>

                          {summary?.cropped_summary && (
                            <div
                              className="context-health-callout"
                              style={{ color: "var(--accent-rose)" }}
                            >
                              <strong>Cropping / Truncation:</strong> {summary.cropped_summary}
                            </div>
                          )}

                          {summary?.dropped_summary && (
                            <div
                              className="context-health-callout"
                              style={{ color: "var(--accent-amber)" }}
                            >
                              <strong>Context Trimmed:</strong> {summary.dropped_summary}
                            </div>
                          )}

                          {phaseKey === "phase4_prose" && summary?.budget_report && (
                            <ZoneBreakdownBar
                              report={summary.budget_report}
                              completionTokens={summary.total_completion_tokens}
                            />
                          )}

                          {isExpanded && summary && summary.calls.length > 0 && (
                            <div className="context-health-subcalls">
                              <table>
                                <thead>
                                  <tr>
                                    <th>Call</th>
                                    <th>Model</th>
                                    <th>Prompt</th>
                                    <th>Output</th>
                                    <th>Time</th>
                                    <th>Stop</th>
                                    <th>Source</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {summary.calls.map((c, idx) => (
                                    <tr key={`${c.label}-${idx}`}>
                                      <td>
                                        {c.label}
                                        {c.retries > 0 && (
                                          <span className="context-health-muted">
                                            {" "}
                                            ({c.retries} retry)
                                          </span>
                                        )}
                                        {c.error && (
                                          <span
                                            title={c.error}
                                            style={{ color: "var(--accent-amber)", marginLeft: 4 }}
                                          >
                                            ⚠
                                          </span>
                                        )}
                                      </td>
                                      <td className="context-health-mono">{c.model || "—"}</td>
                                      <td>{formatTokenCount(c.prompt_tokens)}</td>
                                      <td>{formatTokenCount(c.completion_tokens)}</td>
                                      <td className="context-health-mono">
                                        {formatDurationMs(c.duration_ms) ?? "—"}
                                      </td>
                                      <td
                                        style={
                                          c.finish_reason === "length"
                                            ? { color: "var(--accent-rose)", fontWeight: 600 }
                                            : undefined
                                        }
                                      >
                                        {c.finish_reason}
                                      </td>
                                      <td>{c.usage_source === "exact" ? "Exact" : "Est."}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === "scene_recall" && (
            <div
              role="tabpanel"
              aria-labelledby="context-health-tab-scene-recall"
              className="context-health-tab-panel"
            >
              {!bundle && !inspectedTurn ? (
                <div className="ui-empty-state ui-empty-state--dashed">
                  <p style={{ margin: 0, fontWeight: 600 }}>No campaign snapshot loaded.</p>
                </div>
              ) : (
                <>
                  <div className="context-health-scene-head">
                    <div className="internals-stats">
                      {turnsCount} branch turns · {episodicChunksCount} episodic chunks ·{" "}
                      {indexedLoreEntries.length} visible indexed entries
                      {turnDepth != null ? ` · Inspecting Turn #${turnDepth}` : ""}
                    </div>
                    {handleOpenHelpFromModal && (
                      <MechanicsHelpButton
                        topicId="memory-lore-flags"
                        label="Lore Recall, Secrets & Scene Flags"
                        onOpenHelp={handleOpenHelpFromModal}
                      />
                    )}
                  </div>

                  <div className="internals-group">
                    <div className="internals-group-label">
                      <Flag size={11} /> Scene Flags ({sceneFlags.length})
                    </div>
                    {sceneFlags.length > 0 ? (
                      <>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {(showAllFlags
                            ? sceneFlags
                            : sceneFlags.slice(0, FLAG_PREVIEW_LIMIT)
                          ).map((flag, i) => (
                            <span
                              key={i}
                              className="badge"
                              style={{ fontSize: "0.7rem", padding: "2px 7px" }}
                            >
                              {flag}
                            </span>
                          ))}
                        </div>
                        {sceneFlags.length > FLAG_PREVIEW_LIMIT && (
                          <button
                            type="button"
                            className="exits-toggle"
                            aria-expanded={showAllFlags}
                            onClick={() => setShowAllFlags((v) => !v)}
                          >
                            {showAllFlags ? (
                              <ChevronDown size={12} />
                            ) : (
                              <ChevronRight size={12} />
                            )}
                            {showAllFlags
                              ? "Show fewer"
                              : `Show all ${sceneFlags.length} flags`}
                          </button>
                        )}
                      </>
                    ) : (
                      <div className="inspector-empty">No active scene flags.</div>
                    )}
                  </div>

                  <div className="internals-group">
                    <div className="internals-group-label">
                      <Sparkles size={11} /> {recallHeading} ({recalledItems.length})
                    </div>
                    {recalledItems.length > 0 ? (
                      recalledItems.map((item, idx) => {
                        const key = `${item.source_type}-${item.id}-${idx}`;
                        const expanded = expandedRecalls.has(key);
                        return (
                          <button
                            type="button"
                            key={key}
                            className={`memory-item memory-item-${item.source_type} memory-item-clickable`}
                            aria-expanded={expanded}
                            onClick={() => toggleRecall(key)}
                            title={expanded ? "Collapse" : "Expand"}
                          >
                            <div className="memory-item-head">
                              <strong>
                                [{RECALL_SOURCE_LABEL[item.source_type]}] {item.title}
                              </strong>
                              <span className="memory-item-score">{item.score.toFixed(2)}</span>
                            </div>
                            <div className={`memory-item-content ${expanded ? "" : "clamped"}`}>
                              {item.content}
                            </div>
                          </button>
                        );
                      })
                    ) : (
                      <div className="inspector-empty">
                        {isHistoricalTurn
                          ? `Nothing was recalled on Turn #${inspectedTurn?.depth_index ?? 0}.`
                          : "Nothing was recalled on the last turn."}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === "lore_index" && (
            <div
              role="tabpanel"
              aria-labelledby="context-health-tab-lore-index"
              className="context-health-tab-panel"
            >
              {effectiveWorld ? (
                <LoreIndexPanel
                  world={effectiveWorld}
                  worldLoreNodes={bundle?.world_lore_nodes ?? effectiveWorld.lore_nodes}
                  characters={characters}
                  locations={bundle?.visible_locations ?? effectiveWorld.locations}
                  containers={bundle?.containers ?? effectiveWorld.containers}
                  activeLocationId={effectiveLocationId}
                  recalledItems={recalledItems}
                  unlockLore={unlockLore}
                  revealedLoreIds={revealedLoreIds}
                  embedded
                  autoFocusSearch
                />
              ) : (
                <div className="ui-empty-state ui-empty-state--dashed">
                  <p style={{ margin: 0, fontWeight: 600 }}>World lore index unavailable.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
