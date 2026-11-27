import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronUp,
  Compass,
  Eye,
  EyeOff,
  Gauge,
  Info,
  Lock,
  ShieldAlert,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type {
  CompassDirection,
  EdgeDistanceMode,
  LocationEdge,
  LocationNode,
  MechanicsTopicId,
} from "../../types";
import {
  formatSuggestedDistanceLabel,
  type EdgeConsistencyDiagnostic,
  type ReconciliationAdjustment,
} from "./spatialConsistency";
import { MechanicsHelpButton } from "../shared/MechanicsHelpButton";
import {
  LINK_SPEED_PRESET_GROUPS,
  MAX_EDGE_OBSTACLES,
  MAX_EDGE_OBSTACLE_LENGTH,
  MAX_EDGE_SPEED_MODIFIER,
  MAX_EDGE_TRAVEL_MODE_LENGTH,
  MIN_EDGE_SPEED_MODIFIER,
  clampEdgeDistanceMeters,
  clampEdgeSpeedModifier,
  findMatchingSpeedPreset,
  formatDistanceCompact,
  formatEffectiveSpeedKmh,
  formatExitTravelPhrase,
  formatTravelDuration,
  getAdaptiveDistanceStep,
  parseCommittedEdgeDistance,
  sanitizeEdgeDistanceInput,
  stepEdgeDistanceDraft,
} from "../../utils/spatialDistance";
import { TagChipsInput } from "../TagChipsInput";
import {
  COMPASS_ORDER,
  getLocationOccupiedPorts,
  isEdgeRevealed,
  resolveRevealedEdgePairs,
  type LinkPairInspectorData,
} from "./topologyProjection";
import type { EdgePairPatch } from "./useTopologyMutations";

export interface MapLinkInspectorSectionProps {
  mode: "editor" | "campaign";
  unlockLore?: boolean;
  isMutatingLocked?: boolean;
  selectedEdgePair?: LinkPairInspectorData | null;
  selectedEdgeBundle?: LinkPairInspectorData[] | null;
  allLocations: LocationNode[];
  allEdges?: LocationEdge[];
  revealedEdgeIds?: readonly string[];
  isEdgeSavedSecretInDb?: boolean;
  onClose: () => void;
  onPatchEdgePair?: (edgeId: string, patch: EdgePairPatch) => void;
  onToggleEdgeReveal?: (
    edgeId: string,
    revealed: boolean
  ) => Promise<void> | void;
  onSelectEdgePair?: (edgeId: string, returnBundleEdgeIds?: string[]) => void;
  onBackToBundle?: () => void;
  onDeleteEdge?: (edgeId: string) => void;
  canDeleteEdge?: (edgeId: string) => { allowed: boolean; reason?: string };
  onOpenMechanicsHelp?: (topicId: MechanicsTopicId) => void;
  consistencyDiagnostic?: EdgeConsistencyDiagnostic | null;
  reconciliationAdjustment?: ReconciliationAdjustment | null;
}

export const MapLinkInspectorSection: React.FC<MapLinkInspectorSectionProps> = ({
  mode,
  unlockLore = false,
  isMutatingLocked = false,
  selectedEdgePair = null,
  selectedEdgeBundle = null,
  allLocations,
  allEdges = [],
  revealedEdgeIds = [],
  isEdgeSavedSecretInDb = false,
  onClose,
  onPatchEdgePair,
  onToggleEdgeReveal,
  onSelectEdgePair,
  onBackToBundle,
  onDeleteEdge,
  canDeleteEdge,
  onOpenMechanicsHelp,
  consistencyDiagnostic = null,
  reconciliationAdjustment = null,
}) => {
  const locationNodeMap = useMemo(
    () => new Map(allLocations.map((loc) => [loc.id, loc])),
    [allLocations]
  );
  const locNameMap = useMemo(
    () => new Map(allLocations.map((loc) => [loc.id, loc.name])),
    [allLocations]
  );

  const revealedIdSet = useMemo(
    () => new Set(revealedEdgeIds.filter(Boolean)),
    [revealedEdgeIds]
  );
  const revealedPairs = useMemo(
    () => resolveRevealedEdgePairs(allEdges, revealedEdgeIds),
    [allEdges, revealedEdgeIds]
  );

  const primary = selectedEdgePair?.primary ?? null;
  const reciprocal = selectedEdgePair?.reciprocal ?? null;

  const [distanceDraft, setDistanceDraft] = useState(
    primary ? String(primary.distance_meters) : ""
  );
  const [speedDraft, setSpeedDraft] = useState(
    primary ? String(primary.speed_modifier ?? 1) : "1"
  );
  const [travelModeDraft, setTravelModeDraft] = useState(
    primary?.travel_mode ?? ""
  );
  const [primaryLabelDraft, setPrimaryLabelDraft] = useState(
    primary?.direction_label ?? ""
  );
  const [reciprocalLabelDraft, setReciprocalLabelDraft] = useState(
    reciprocal?.direction_label ?? ""
  );
  const [isTogglingReveal, setIsTogglingReveal] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const speedDropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!primary) return;
    setDistanceDraft(String(primary.distance_meters));
    setSpeedDraft(String(primary.speed_modifier ?? 1));
    setTravelModeDraft(primary.travel_mode ?? "");
    setPrimaryLabelDraft(primary.direction_label ?? "");
    setReciprocalLabelDraft(reciprocal?.direction_label ?? "");
    setRevealError(null);
    setSpeedMenuOpen(false);
  }, [
    primary?.id,
    primary?.distance_meters,
    primary?.speed_modifier,
    primary?.travel_mode,
    primary?.direction_label,
    reciprocal?.id,
    reciprocal?.direction_label,
  ]);

  useEffect(() => {
    if (!speedMenuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (
        speedDropdownRef.current &&
        !speedDropdownRef.current.contains(e.target as Node)
      ) {
        setSpeedMenuOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSpeedMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [speedMenuOpen]);

  if (selectedEdgeBundle && selectedEdgeBundle.length > 0) {
    const bundleEdgeIds = selectedEdgeBundle.flatMap((pair) =>
      pair.reciprocal ? [pair.primary.id, pair.reciprocal.id] : [pair.primary.id]
    );
    return (
      <div
        aria-label="Map Element Details"
        className="map-details-drawer"
        style={{
          background: "var(--bg-card)",
          borderRadius: 8,
          border: "1px solid var(--border-subtle)",
          padding: 14,
          display: "flex",
          flexDirection: "column",
          gap: 11,
          overflowY: "auto",
          minHeight: 0,
          height: "100%",
          maxHeight: "100%",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span
            className="badge"
            style={{
              fontSize: "0.66rem",
              color: "#67e8f9",
              borderColor: "rgba(6, 182, 212, 0.45)",
            }}
          >
            Boundary Passages ({selectedEdgeBundle.length})
          </span>
          <button
            type="button"
            className="btn"
            style={{ padding: "2px 7px", fontSize: "0.68rem" }}
            onClick={onClose}
            aria-label="Close details"
          >
            <X size={12} />
          </button>
        </div>

        <div style={{ fontSize: "0.73rem", color: "var(--text-muted)" }}>
          Select a boundary link below to inspect distance, terrain speed, obstacles, and visibility.
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {selectedEdgeBundle.map((pair) => {
            const p = pair.primary;
            const r = pair.reciprocal;
            const fromName = locNameMap.get(p.from_location_id) ?? p.from_location_id;
            const toName = locNameMap.get(p.to_location_id) ?? p.to_location_id;
            const rowBlocked = Boolean(p.is_blocked || r?.is_blocked);
            const rowSecret = Boolean(p.is_secret || r?.is_secret);
            const rowObstacles =
              (p.obstacles?.length ?? 0) > 0 ? p.obstacles : (r?.obstacles ?? []);
            const revealed = rowSecret
              ? mode === "campaign" &&
                (isEdgeRevealed(p, revealedIdSet, revealedPairs) ||
                  (r ? isEdgeRevealed(r, revealedIdSet, revealedPairs) : false))
              : false;
            return (
              <button
                key={pair.pairKey}
                type="button"
                className="link-bundle-row"
                onClick={() => onSelectEdgePair?.(p.id, bundleEdgeIds)}
              >
                <div className="link-bundle-row-title">
                  <span>
                    {fromName} {r ? "↔" : "→"} {toName}
                  </span>
                  {p.compass_direction && (
                    <span className="badge" style={{ fontSize: "0.62rem" }}>
                      {p.compass_direction}
                    </span>
                  )}
                </div>
                <div className="link-bundle-row-meta">
                  <span>
                    {formatDistanceCompact(p.distance_meters)} ·{" "}
                    {formatExitTravelPhrase(
                      p.distance_meters,
                      p.speed_modifier,
                      p.travel_mode
                    )}
                  </span>
                  {p.direction_label && (
                    <span className="link-bundle-row-label">
                      via {p.direction_label}
                    </span>
                  )}
                </div>
                {(rowBlocked || rowSecret || rowObstacles.length > 0) && (
                  <div className="link-bundle-row-pills">
                    {rowBlocked && (
                      <span className="link-status-pill link-status-pill--blocked">
                        <Lock size={9} /> Blocked
                      </span>
                    )}
                    {rowSecret && (
                      <span
                        className={`link-status-pill ${
                          revealed
                            ? "link-status-pill--revealed"
                            : "link-status-pill--secret"
                        }`}
                      >
                        {revealed ? <Eye size={9} /> : <EyeOff size={9} />}{" "}
                        {revealed ? "Secret · Discovered" : "Secret · Hidden"}
                      </span>
                    )}
                    {rowObstacles.length > 0 && (
                      <span className="link-status-pill">
                        <ShieldAlert size={9} /> {rowObstacles.length} obstacle
                        {rowObstacles.length === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (!primary) return null;

  const fromName =
    locNameMap.get(primary.from_location_id) ?? primary.from_location_id;
  const toName = locNameMap.get(primary.to_location_id) ?? primary.to_location_id;

  const previewMeters =
    parseCommittedEdgeDistance(distanceDraft) ?? primary.distance_meters;
  const parsedSpeedNum = Number(speedDraft);
  const previewSpeed =
    Number.isFinite(parsedSpeedNum) && parsedSpeedNum > 0
      ? clampEdgeSpeedModifier(parsedSpeedNum, primary.speed_modifier ?? 1)
      : primary.speed_modifier ?? 1;
  const previewMode = travelModeDraft.trim() || null;

  const commitDistanceDraft = () => {
    if (isMutatingLocked) {
      setDistanceDraft(String(primary.distance_meters));
      return;
    }
    const parsed = parseCommittedEdgeDistance(distanceDraft);
    if (parsed === null) {
      setDistanceDraft(String(primary.distance_meters));
      return;
    }
    setDistanceDraft(String(parsed));
    if (parsed !== primary.distance_meters) {
      onPatchEdgePair?.(primary.id, { distance_meters: parsed });
    }
  };

  const commitSteppedDistance = (direction: 1 | -1, fine = false) => {
    if (isMutatingLocked) return;
    const nextStr = stepEdgeDistanceDraft(
      distanceDraft,
      direction,
      primary.distance_meters,
      fine
    );
    const nextMeters = clampEdgeDistanceMeters(
      Number(nextStr),
      primary.distance_meters
    );
    setDistanceDraft(String(nextMeters));
    onPatchEdgePair?.(primary.id, { distance_meters: nextMeters });
  };

  const commitSpeedDraft = () => {
    if (isMutatingLocked) {
      setSpeedDraft(String(primary.speed_modifier ?? 1));
      return;
    }
    const num = Number(speedDraft);
    if (!Number.isFinite(num) || num <= 0) {
      setSpeedDraft(String(primary.speed_modifier ?? 1));
      return;
    }
    const clamped = clampEdgeSpeedModifier(num, primary.speed_modifier ?? 1);
    setSpeedDraft(String(clamped));
    if (Math.abs(clamped - (primary.speed_modifier ?? 1)) > 1e-6) {
      onPatchEdgePair?.(primary.id, { speed_modifier: clamped });
    }
  };

  const commitTravelModeDraft = () => {
    if (isMutatingLocked) {
      setTravelModeDraft(primary.travel_mode ?? "");
      return;
    }
    const cleaned = travelModeDraft
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_EDGE_TRAVEL_MODE_LENGTH);
    setTravelModeDraft(cleaned);
    const nextVal = cleaned || null;
    if ((primary.travel_mode ?? null) !== nextVal) {
      onPatchEdgePair?.(primary.id, { travel_mode: nextVal });
    }
  };

  const commitPrimaryLabel = () => {
    if (isMutatingLocked) {
      setPrimaryLabelDraft(primary.direction_label ?? "");
      return;
    }
    const cleaned = primaryLabelDraft.trim();
    if (!cleaned) {
      setPrimaryLabelDraft(primary.direction_label ?? "");
      return;
    }
    setPrimaryLabelDraft(cleaned);
    if (cleaned !== primary.direction_label) {
      onPatchEdgePair?.(primary.id, { direction_label: cleaned });
    }
  };

  const commitReciprocalLabel = () => {
    if (!reciprocal) return;
    if (isMutatingLocked) {
      setReciprocalLabelDraft(reciprocal.direction_label ?? "");
      return;
    }
    const cleaned = reciprocalLabelDraft.trim();
    if (!cleaned) {
      setReciprocalLabelDraft(reciprocal.direction_label ?? "");
      return;
    }
    setReciprocalLabelDraft(cleaned);
    if (cleaned !== reciprocal.direction_label) {
      onPatchEdgePair?.(primary.id, { reciprocal_direction_label: cleaned });
    }
  };

  const canEditSecret = mode === "editor" || unlockLore;
  const edgeRevealedOnBranch =
    primary.is_secret &&
    mode === "campaign" &&
    isEdgeRevealed(primary, revealedIdSet, revealedPairs);

  const handleToggleRevealClick = async () => {
    if (
      !onToggleEdgeReveal ||
      !isEdgeSavedSecretInDb ||
      isMutatingLocked ||
      isTogglingReveal
    ) {
      return;
    }
    setIsTogglingReveal(true);
    setRevealError(null);
    try {
      await onToggleEdgeReveal(primary.id, !edgeRevealedOnBranch);
    } catch (err: unknown) {
      setRevealError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsTogglingReveal(false);
    }
  };

  const decStep = getAdaptiveDistanceStep(Math.max(1, previewMeters - 1));
  const incStep = getAdaptiveDistanceStep(previewMeters);
  const matchedPreset = findMatchingSpeedPreset(previewSpeed);
  const delCheck = canDeleteEdge ? canDeleteEdge(primary.id) : { allowed: true };

  return (
    <div
      aria-label="Map Element Details"
      className="map-details-drawer"
      style={{
        background: "var(--bg-card)",
        borderRadius: 8,
        border: "1px solid var(--border-subtle)",
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 11,
        overflowY: "auto",
        minHeight: 0,
        height: "100%",
        maxHeight: "100%",
      }}
    >
      {/* Top Badge & Close / Back Row */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 6,
        }}
      >
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {onBackToBundle && (
            <button
              type="button"
              className="btn"
              style={{ padding: "2px 7px", fontSize: "0.68rem", gap: 4 }}
              onClick={onBackToBundle}
            >
              <ArrowLeft size={11} /> All Passages
            </button>
          )}
          <span
            className="badge"
            style={{
              fontSize: "0.66rem",
              color: "#67e8f9",
              borderColor: "rgba(6, 182, 212, 0.45)",
            }}
          >
            {reciprocal ? "Link Pair" : "One-Way Link"}
          </span>
          {primary.compass_direction && (
            <span className="badge" style={{ fontSize: "0.64rem" }}>
              <Compass size={10} /> {primary.compass_direction}
              {reciprocal?.compass_direction
                ? ` / ${reciprocal.compass_direction}`
                : ""}
            </span>
          )}
        </div>
        <button
          type="button"
          className="btn"
          style={{ padding: "2px 7px", fontSize: "0.68rem" }}
          onClick={onClose}
          aria-label="Close details"
        >
          <X size={12} />
        </button>
      </div>

      {/* Endpoint Title */}
      <div
        style={{
          fontSize: "0.92rem",
          fontWeight: 700,
          color: "var(--text-primary)",
          lineHeight: 1.3,
        }}
      >
        {fromName} {reciprocal ? "↔" : "→"} {toName}
      </div>

      {/* Live Travel Summary Banner */}
      <div className="link-travel-summary" aria-label="Travel summary">
        <span style={{ fontWeight: 700, color: "#67e8f9" }}>
          {formatDistanceCompact(previewMeters)} ·{" "}
          {formatTravelDuration(previewMeters, previewSpeed)}
        </span>
        <span style={{ color: "var(--text-secondary)" }}>
          {formatEffectiveSpeedKmh(previewSpeed)} ({previewSpeed}×)
          {previewMode ? ` · ${previewMode}` : ""}
        </span>
      </div>

      {/* Distance */}
      <div className="link-distance-row">
        <label htmlFor="link-distance-input" className="link-inspector-label">
          Distance
          <span
            className="link-info-tip"
            title={`Accepts meters or km (e.g. 1.5km) · ▲ +${incStep}m / ▼ -${decStep}m · Shift for ±1m`}
            aria-label="Distance format help: accepts meters or km such as 1.5km"
          >
            <Info size={12} />
          </span>
        </label>
        <div className="link-distance-control">
          <input
            id="link-distance-input"
            type="text"
            inputMode="decimal"
            aria-label="Link distance"
            placeholder="e.g. 350m, 1.5km"
            className="field-input field-input--compact field-input--cyan link-distance-input"
            disabled={isMutatingLocked}
            value={distanceDraft}
            onChange={(e) =>
              setDistanceDraft(sanitizeEdgeDistanceInput(e.target.value))
            }
            onBlur={commitDistanceDraft}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitDistanceDraft();
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                commitSteppedDistance(1, e.shiftKey);
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                commitSteppedDistance(-1, e.shiftKey);
              }
            }}
          />
          <div className="link-distance-steppers">
            <button
              type="button"
              className="link-distance-step-btn"
              disabled={isMutatingLocked}
              aria-label="Increase distance"
              title={`Increase (+${incStep}m, Shift +1m)`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => commitSteppedDistance(1, e.shiftKey)}
            >
              <ChevronUp size={11} />
            </button>
            <button
              type="button"
              className="link-distance-step-btn"
              disabled={isMutatingLocked}
              aria-label="Decrease distance"
              title={`Decrease (-${decStep}m, Shift -1m)`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => commitSteppedDistance(-1, e.shiftKey)}
            >
              <ChevronDown size={11} />
            </button>
          </div>
        </div>
      </div>

      {/* Consistency Warning / Suggestion Banner */}
      {consistencyDiagnostic && (
        <div
          className={`link-consistency-banner link-consistency-banner--${consistencyDiagnostic.severity}`}
          role="status"
          data-testid="link-consistency-banner"
        >
          <div className="link-consistency-banner-msg">
            <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{consistencyDiagnostic.message}</span>
          </div>
          {!isMutatingLocked && (
            <div className="link-consistency-banner-actions">
              {(reconciliationAdjustment?.proposedMeters ??
                consistencyDiagnostic.suggestedMeters) != null &&
                consistencyDiagnostic.kind !== "compass_conflict" &&
                consistencyDiagnostic.kind !== "overconstrained_locked" && (
                  <button
                    type="button"
                    className="btn btn-cyan map-consistency-mini-btn"
                    onClick={() => {
                      const nextMeters =
                        reconciliationAdjustment?.proposedMeters ??
                        consistencyDiagnostic.suggestedMeters!;
                      setDistanceDraft(String(nextMeters));
                      onPatchEdgePair?.(primary.id, {
                        distance_meters: nextMeters,
                      });
                    }}
                  >
                    <Check size={10} /> Apply{" "}
                    {formatSuggestedDistanceLabel(
                      reconciliationAdjustment?.proposedMeters ??
                        consistencyDiagnostic.suggestedMeters!
                    )}
                  </button>
                )}
              {(primary.distance_mode ?? "flexible") !== "non_euclidean" && (
                <button
                  type="button"
                  className="btn map-consistency-mini-btn"
                  title="Exempt this passage from 2D geometry checks (e.g. magic portal or folded space)"
                  onClick={() =>
                    onPatchEdgePair?.(primary.id, {
                      distance_mode: "non_euclidean",
                    })
                  }
                >
                  <Sparkles size={10} /> Mark Non-Euclidean
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Distance Rule & Vertical Transition */}
      <div className="link-inspector-card" data-testid="link-distance-rule-card">
        <div className="link-inspector-label-row">
          <span className="link-inspector-label">Distance Rule</span>
          <span style={{ fontSize: "0.64rem", color: "var(--text-muted)" }}>
            {(primary.distance_mode ?? "flexible") === "locked"
              ? "Ground truth"
              : (primary.distance_mode ?? "flexible") === "non_euclidean"
              ? "Bypasses geometry"
              : "Auto-adjustable"}
          </span>
        </div>
        <div className="link-distance-mode-group" role="group" aria-label="Distance rule">
          {(
            [
              {
                id: "flexible" as EdgeDistanceMode,
                label: "Flexible",
                title: "Participates in consistency checks and adjusts during reconciliation",
              },
              {
                id: "locked" as EdgeDistanceMode,
                label: "Locked",
                title: "Authoritative ground-truth distance; never auto-adjusted",
              },
              {
                id: "non_euclidean" as EdgeDistanceMode,
                label: "Non-Euclidean",
                title: "Physics-bending portal or folded shortcut; exempt from 2D geometry checks",
              },
            ] as const
          ).map((opt) => {
            const activeMode = primary.distance_mode ?? "flexible";
            const isActive = activeMode === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                aria-pressed={isActive}
                title={opt.title}
                disabled={isMutatingLocked}
                className={`btn link-distance-mode-btn${
                  isActive ? ` link-distance-mode-btn--${opt.id}` : ""
                }`}
                onClick={() =>
                  onPatchEdgePair?.(primary.id, { distance_mode: opt.id })
                }
              >
                {opt.id === "locked" && <Lock size={10} />}
                {opt.id === "non_euclidean" && <Sparkles size={10} />}
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>

        <label
          className={`link-toggle-row ${
            isMutatingLocked || (primary.distance_mode ?? "flexible") === "non_euclidean"
              ? "link-toggle-row--disabled"
              : ""
          }`}
        >
          <input
            type="checkbox"
            aria-label="Vertical transition"
            className="link-toggle-checkbox"
            checked={Boolean(primary.is_vertical)}
            disabled={
              isMutatingLocked ||
              (primary.distance_mode ?? "flexible") === "non_euclidean"
            }
            onChange={(e) =>
              onPatchEdgePair?.(primary.id, { is_vertical: e.target.checked })
            }
          />
          <span>
            <strong style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <ArrowUpDown size={11} /> Vertical Transition
            </strong>
            <div className="link-toggle-desc">
              Hatch, ladder, or shaft: keeps travel meters/time while contributing 0m horizontal offset.
            </div>
          </span>
        </label>
      </div>

      {/* Speed Modifier + Grouped Presets + Travel Mode */}
      <div className="link-inspector-field">
        <div className="link-inspector-label-row">
          <label htmlFor="link-speed-input" className="link-inspector-label">
            <Gauge size={11} /> Speed Modifier
            <span
              className="link-info-tip"
              title="0.05× – 100× (1× = 4.2 km/h)"
              aria-label="Speed modifier range: 0.05x to 100x, where 1x equals 4.2 kilometers per hour"
            >
              <Info size={12} />
            </span>
          </label>
          <MechanicsHelpButton
            topicId="spatial-links-travel"
            label="Links, Travel Time & Secret Passages"
            onOpenHelp={onOpenMechanicsHelp}
          />
        </div>

        <div className="link-speed-row">
          <div className="link-speed-value-wrap">
            <input
              id="link-speed-input"
              type="number"
              step="0.1"
              min={MIN_EDGE_SPEED_MODIFIER}
              max={MAX_EDGE_SPEED_MODIFIER}
              aria-label="Speed modifier"
              className="field-input field-input--compact field-input--cyan link-speed-number"
              disabled={isMutatingLocked}
              value={speedDraft}
              onChange={(e) => setSpeedDraft(e.target.value)}
              onBlur={commitSpeedDraft}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitSpeedDraft();
                }
              }}
            />
            <span className="link-speed-unit">×</span>
          </div>

          <div className="link-speed-dropdown" ref={speedDropdownRef}>
            <button
              type="button"
              className={`link-speed-trigger ${speedMenuOpen ? "open" : ""}`}
              disabled={isMutatingLocked}
              aria-haspopup="listbox"
              aria-expanded={speedMenuOpen}
              aria-label="Speed modifier preset"
              onClick={(e) => {
                e.stopPropagation();
                if (!isMutatingLocked) setSpeedMenuOpen((prev) => !prev);
              }}
            >
              <span className="link-speed-trigger-label">
                {matchedPreset ? matchedPreset.label : "Custom"}
              </span>
              {matchedPreset && (
                <span className="link-speed-trigger-mod">
                  {matchedPreset.modifier}×
                </span>
              )}
              <ChevronDown
                size={13}
                className={`link-speed-chevron ${speedMenuOpen ? "rotate" : ""}`}
              />
            </button>

            {speedMenuOpen && !isMutatingLocked && (
              <div
                className="ui-popover link-speed-popover"
                role="listbox"
                aria-label="Speed modifier presets"
                onClick={(e) => e.stopPropagation()}
              >
                {LINK_SPEED_PRESET_GROUPS.map((group) => (
                  <div key={group.category} role="group" aria-label={group.label}>
                    <div className="link-speed-group-label">{group.label}</div>
                    {group.items.map((preset) => {
                      const isActive = matchedPreset?.id === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          role="option"
                          aria-selected={isActive}
                          className={`link-speed-option ${
                            isActive ? "link-speed-option--active" : ""
                          }`}
                          onClick={() => {
                            setSpeedDraft(String(preset.modifier));
                            setTravelModeDraft(preset.modeLabel ?? "");
                            setSpeedMenuOpen(false);
                            onPatchEdgePair?.(primary.id, {
                              speed_modifier: preset.modifier,
                              travel_mode: preset.modeLabel,
                            });
                          }}
                        >
                          <span>{preset.label}</span>
                          <span className="link-speed-option-mod">
                            {preset.modifier}×
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="link-mode-row">
          <input
            type="text"
            maxLength={MAX_EDGE_TRAVEL_MODE_LENGTH}
            aria-label="Travel mode"
            className="field-input field-input--compact field-input--cyan"
            disabled={isMutatingLocked}
            placeholder="Mode label (optional, e.g. Mag-Lev Rail)"
            value={travelModeDraft}
            onChange={(e) => setTravelModeDraft(e.target.value)}
            onBlur={commitTravelModeDraft}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitTravelModeDraft();
              }
            }}
          />
          {travelModeDraft && !isMutatingLocked && (
            <button
              type="button"
              className="btn link-mode-clear-btn"
              title="Clear travel mode"
              aria-label="Clear travel mode"
              onClick={() => {
                setTravelModeDraft("");
                onPatchEdgePair?.(primary.id, { travel_mode: null });
              }}
            >
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Compass Ports */}
      {(() => {
        const primaryOtherOccupied = getLocationOccupiedPorts(
          primary.from_location_id,
          allEdges,
          locationNodeMap,
          primary.id
        );
        const reciprocalOtherOccupied = reciprocal
          ? getLocationOccupiedPorts(
              reciprocal.from_location_id,
              allEdges,
              locationNodeMap,
              reciprocal.id
            )
          : null;

        const renderCompassRow = (opts: {
          label: string;
          currentSlot?: CompassDirection | null;
          otherOccupied: Map<CompassDirection, string>;
          onSelect: (slot: CompassDirection) => void;
          testId: string;
        }) => (
          <div className="link-passage-field" data-testid={opts.testId}>
            <span className="link-passage-sub">{opts.label}</span>
            <div className="link-compass-grid" role="group" aria-label={opts.label}>
              {COMPASS_ORDER.map((slot) => {
                const isSelected = opts.currentSlot === slot;
                const occupiedBy = opts.otherOccupied.get(slot);
                const isDisabled = isMutatingLocked || Boolean(occupiedBy);
                return (
                  <button
                    key={slot}
                    type="button"
                    className={`btn link-compass-btn${
                      isSelected
                        ? " link-compass-btn--active"
                        : occupiedBy
                        ? " link-compass-btn--occupied"
                        : ""
                    }`}
                    disabled={isDisabled}
                    aria-pressed={isSelected}
                    aria-label={`${opts.label}: ${slot}`}
                    data-compass-slot={slot}
                    title={
                      isSelected
                        ? `${slot} — current port`
                        : occupiedBy
                        ? `${slot} — occupied by ${occupiedBy}`
                        : `${slot} — move port here`
                    }
                    onClick={() => {
                      if (!isSelected && !isDisabled) {
                        opts.onSelect(slot);
                      }
                    }}
                  >
                    {slot}
                  </button>
                );
              })}
            </div>
          </div>
        );

        return (
          <div className="link-inspector-card" data-testid="link-compass-ports-card">
            <span className="link-inspector-label">
              <Compass size={12} color="#38bdf8" aria-hidden="true" /> Compass Ports
            </span>
            {renderCompassRow({
              label: `Exit on ${fromName}`,
              currentSlot: primary.compass_direction,
              otherOccupied: primaryOtherOccupied,
              testId: "link-compass-primary",
              onSelect: (slot) =>
                onPatchEdgePair?.(primary.id, { compass_direction: slot }),
            })}
            {reciprocal && reciprocalOtherOccupied &&
              renderCompassRow({
                label: `Exit on ${toName}`,
                currentSlot: reciprocal.compass_direction,
                otherOccupied: reciprocalOtherOccupied,
                testId: "link-compass-reciprocal",
                onSelect: (slot) =>
                  onPatchEdgePair?.(primary.id, {
                    reciprocal_compass_direction: slot,
                  }),
              })}
          </div>
        );
      })()}

      {/* Direction Labels */}
      <div className="link-inspector-card">
        <span className="link-inspector-label">Passage Labels</span>
        <div className="link-passage-field">
          <span className="link-passage-sub">
            {fromName} → {toName}
          </span>
          <input
            type="text"
            aria-label="Forward direction label"
            className="field-input field-input--compact field-input--cyan"
            disabled={isMutatingLocked}
            value={primaryLabelDraft}
            onChange={(e) => setPrimaryLabelDraft(e.target.value)}
            onBlur={commitPrimaryLabel}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitPrimaryLabel();
              }
            }}
          />
        </div>
        {reciprocal && (
          <div className="link-passage-field">
            <span className="link-passage-sub">
              {toName} → {fromName}
            </span>
            <input
              type="text"
              aria-label="Return direction label"
              className="field-input field-input--compact field-input--cyan"
              disabled={isMutatingLocked}
              value={reciprocalLabelDraft}
              onChange={(e) => setReciprocalLabelDraft(e.target.value)}
              onBlur={commitReciprocalLabel}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitReciprocalLabel();
                }
              }}
            />
          </div>
        )}
      </div>

      {/* Obstacles */}
      <div className="link-inspector-field">
        <label className="link-inspector-label">Obstacles</label>
        <TagChipsInput
          value={primary.obstacles ?? []}
          onChange={(next) =>
            onPatchEdgePair?.(primary.id, { obstacles: next })
          }
          disabled={isMutatingLocked}
          maxTags={MAX_EDGE_OBSTACLES}
          maxTagLength={MAX_EDGE_OBSTACLE_LENGTH}
          placeholder="Add obstacle & press Enter (e.g. Collapsed Bridge)..."
          helperText="Injected into visible exits for the AI narrator (max 6)."
        />
      </div>

      {/* Access & Visibility Toggles */}
      <div className="link-inspector-card">
        <label
          className={`link-toggle-row ${
            isMutatingLocked ? "link-toggle-row--disabled" : ""
          }`}
        >
          <input
            type="checkbox"
            aria-label="Blocked link"
            className="link-toggle-checkbox link-toggle-checkbox--rose"
            checked={Boolean(primary.is_blocked)}
            disabled={isMutatingLocked}
            onChange={(e) =>
              onPatchEdgePair?.(primary.id, { is_blocked: e.target.checked })
            }
          />
          <span>
            <strong style={{ color: primary.is_blocked ? "var(--rose-fg)" : "inherit" }}>
              Blocked
            </strong>
            <div className="link-toggle-desc">
              Shows a barricade cue and triggers an obstacle check on quick exits.
            </div>
          </span>
        </label>

        {canEditSecret ? (
          <label
            className={`link-toggle-row ${
              isMutatingLocked ? "link-toggle-row--disabled" : ""
            }`}
          >
            <input
              type="checkbox"
              aria-label="Secret link"
              className="link-toggle-checkbox link-toggle-checkbox--violet"
              checked={Boolean(primary.is_secret)}
              disabled={isMutatingLocked}
              onChange={(e) =>
                onPatchEdgePair?.(primary.id, { is_secret: e.target.checked })
              }
            />
            <span>
              <strong style={{ color: primary.is_secret ? "var(--violet-fg)" : "inherit" }}>
                Secret
              </strong>
              <div className="link-toggle-desc">
                Hidden from players, exits, and narrator prompts until discovered.
              </div>
            </span>
          </label>
        ) : (
          primary.is_secret && (
            <div style={{ fontSize: "0.72rem", color: "#fde68a" }}>
              Secret Passage · Discovered
            </div>
          )
        )}

        {mode === "campaign" && unlockLore && primary.is_secret && (
          <div className="link-secret-banner">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 6,
                flexWrap: "wrap",
              }}
            >
              <span
                className={`link-status-pill ${
                  edgeRevealedOnBranch
                    ? "link-status-pill--revealed"
                    : "link-status-pill--secret"
                }`}
              >
                {edgeRevealedOnBranch ? <Eye size={10} /> : <EyeOff size={10} />}
                {edgeRevealedOnBranch
                  ? "Discovered on this branch"
                  : "Hidden from players"}
              </span>
              {onToggleEdgeReveal && (
                <button
                  type="button"
                  className="btn"
                  disabled={
                    !isEdgeSavedSecretInDb || isMutatingLocked || isTogglingReveal
                  }
                  style={{ fontSize: "0.7rem", padding: "3px 8px", gap: 4 }}
                  onClick={handleToggleRevealClick}
                >
                  {edgeRevealedOnBranch ? (
                    <>
                      <EyeOff size={11} /> Re-hide Secret Link
                    </>
                  ) : (
                    <>
                      <Eye size={11} /> Reveal to Players
                    </>
                  )}
                </button>
              )}
            </div>
            {!isEdgeSavedSecretInDb && (
              <div style={{ fontSize: "0.66rem", color: "var(--text-muted)" }}>
                Save map changes first to toggle player discovery.
              </div>
            )}
            {revealError && (
              <div style={{ fontSize: "0.68rem", color: "var(--rose-fg)" }}>
                {revealError}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer Delete Action (World Editor Only) */}
      {mode === "editor" && !isMutatingLocked && onDeleteEdge && (
        <button
          type="button"
          className="btn"
          disabled={!delCheck.allowed}
          title={delCheck.allowed ? "Delete this link pair" : delCheck.reason}
          style={{
            marginTop: 4,
            justifyContent: "center",
            gap: 6,
            fontSize: "0.74rem",
            color: "#fda4af",
            borderColor: "rgba(244, 63, 94, 0.4)",
            background: "rgba(244, 63, 94, 0.08)",
          }}
          onClick={() => onDeleteEdge(primary.id)}
        >
          <Trash2 size={13} /> Delete Link
        </button>
      )}
    </div>
  );
};
