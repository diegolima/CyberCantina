import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Compass,
  Eye,
  EyeOff,
  Gauge,
  Lock,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import type { LocationEdge, LocationNode } from "../../types";
import {
  LINK_SPEED_PRESETS,
  MAX_EDGE_OBSTACLES,
  MAX_EDGE_OBSTACLE_LENGTH,
  MAX_EDGE_SPEED_MODIFIER,
  MAX_EDGE_TRAVEL_MODE_LENGTH,
  MIN_EDGE_SPEED_MODIFIER,
  clampEdgeDistanceMeters,
  clampEdgeSpeedModifier,
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
}) => {
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

  useEffect(() => {
    if (!primary) return;
    setDistanceDraft(String(primary.distance_meters));
    setSpeedDraft(String(primary.speed_modifier ?? 1));
    setTravelModeDraft(primary.travel_mode ?? "");
    setPrimaryLabelDraft(primary.direction_label ?? "");
    setReciprocalLabelDraft(reciprocal?.direction_label ?? "");
    setRevealError(null);
  }, [
    primary?.id,
    primary?.distance_meters,
    primary?.speed_modifier,
    primary?.travel_mode,
    primary?.direction_label,
    reciprocal?.id,
    reciprocal?.direction_label,
  ]);

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
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
          Distance (meters or e.g. 1.5km)
        </label>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            type="button"
            className="btn"
            disabled={isMutatingLocked}
            aria-label="Decrease distance"
            title={`Decrease (-${decStep}m, Shift -1m)`}
            style={{ padding: "4px 9px", fontSize: "0.8rem" }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => commitSteppedDistance(-1, e.shiftKey)}
          >
            −
          </button>
          <input
            type="text"
            inputMode="decimal"
            aria-label="Link distance"
            className="input"
            disabled={isMutatingLocked}
            style={{ flex: 1, fontSize: "0.78rem", textAlign: "center" }}
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
          <button
            type="button"
            className="btn"
            disabled={isMutatingLocked}
            aria-label="Increase distance"
            title={`Increase (+${incStep}m, Shift +1m)`}
            style={{ padding: "4px 9px", fontSize: "0.8rem" }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => commitSteppedDistance(1, e.shiftKey)}
          >
            +
          </button>
        </div>
      </div>

      {/* Speed Modifier + Presets + Travel Mode */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <label
            style={{
              fontSize: "0.7rem",
              color: "var(--text-muted)",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <Gauge size={11} /> Speed Modifier &amp; Mode
          </label>
          <span style={{ fontSize: "0.66rem", color: "var(--text-muted)" }}>
            0.05× – 100× (1× = 4.2 km/h)
          </span>
        </div>

        <div className="link-speed-presets" role="group" aria-label="Speed presets">
          {LINK_SPEED_PRESETS.map((preset) => {
            const isActive =
              Math.abs((primary.speed_modifier ?? 1) - preset.modifier) < 0.005;
            return (
              <button
                key={preset.id}
                type="button"
                disabled={isMutatingLocked}
                className={`link-preset-chip ${
                  isActive ? "link-preset-chip--active" : ""
                }`}
                onClick={() => {
                  setSpeedDraft(String(preset.modifier));
                  setTravelModeDraft(preset.modeLabel ?? "");
                  onPatchEdgePair?.(primary.id, {
                    speed_modifier: preset.modifier,
                    travel_mode: preset.modeLabel,
                  });
                }}
              >
                <span>{preset.label}</span>
                <strong>{preset.modifier}×</strong>
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          <div style={{ width: 88, flexShrink: 0 }}>
            <input
              type="number"
              step="0.1"
              min={MIN_EDGE_SPEED_MODIFIER}
              max={MAX_EDGE_SPEED_MODIFIER}
              aria-label="Speed modifier"
              className="input"
              disabled={isMutatingLocked}
              style={{ width: "100%", fontSize: "0.76rem" }}
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
          </div>
          <div style={{ flex: 1, display: "flex", gap: 4 }}>
            <input
              type="text"
              maxLength={MAX_EDGE_TRAVEL_MODE_LENGTH}
              aria-label="Travel mode"
              className="input"
              disabled={isMutatingLocked}
              placeholder="Travel mode (optional, e.g. Mag-Lev)"
              style={{ flex: 1, fontSize: "0.76rem" }}
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
                className="btn"
                title="Clear travel mode"
                aria-label="Clear travel mode"
                style={{ padding: "2px 6px" }}
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
      </div>

      {/* Direction Labels */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
          Passage Labels
        </label>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: "0.66rem", color: "var(--text-muted)" }}>
            {fromName} → {toName}
          </span>
          <input
            type="text"
            aria-label="Forward direction label"
            className="input"
            disabled={isMutatingLocked}
            style={{ fontSize: "0.76rem" }}
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
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: "0.66rem", color: "var(--text-muted)" }}>
              {toName} → {fromName}
            </span>
            <input
              type="text"
              aria-label="Return direction label"
              className="input"
              disabled={isMutatingLocked}
              style={{ fontSize: "0.76rem" }}
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
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
          Obstacles
        </label>
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
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 7,
          padding: "8px 10px",
          borderRadius: 6,
          background: "var(--bg-panel)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            fontSize: "0.75rem",
            color: "var(--text-secondary)",
            cursor: isMutatingLocked ? "not-allowed" : "pointer",
          }}
        >
          <input
            type="checkbox"
            aria-label="Blocked link"
            checked={Boolean(primary.is_blocked)}
            disabled={isMutatingLocked}
            onChange={(e) =>
              onPatchEdgePair?.(primary.id, { is_blocked: e.target.checked })
            }
          />
          <span>
            <strong style={{ color: primary.is_blocked ? "#fda4af" : "inherit" }}>
              Blocked
            </strong>
            <div style={{ fontSize: "0.66rem", color: "var(--text-muted)" }}>
              Shows a barricade cue and triggers an obstacle check on quick exits.
            </div>
          </span>
        </label>

        {canEditSecret ? (
          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              fontSize: "0.75rem",
              color: "var(--text-secondary)",
              cursor: isMutatingLocked ? "not-allowed" : "pointer",
            }}
          >
            <input
              type="checkbox"
              aria-label="Secret link"
              checked={Boolean(primary.is_secret)}
              disabled={isMutatingLocked}
              onChange={(e) =>
                onPatchEdgePair?.(primary.id, { is_secret: e.target.checked })
              }
            />
            <span>
              <strong style={{ color: primary.is_secret ? "#c4b5fd" : "inherit" }}>
                Secret
              </strong>
              <div style={{ fontSize: "0.66rem", color: "var(--text-muted)" }}>
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
