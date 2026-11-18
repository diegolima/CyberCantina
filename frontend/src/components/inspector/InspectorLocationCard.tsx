import React, { useId } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Compass,
  DoorOpen,
  Globe,
  Lock,
  Maximize2,
  Navigation,
} from "lucide-react";
import type {
  CampaignStateBundle,
  CompassDirection,
  LocationContainer,
  LocationNode,
  NeighborLocationView,
} from "../../types";
import { resolveMapIconComponent } from "../map/mapIcons";
import {
  computeBoundaryMarkerTicks,
  doesEdgeCrossContainer,
  ENVELOPE_ARM_RADIUS,
  ENVELOPE_BORDER_WIDTH,
  ENVELOPE_HUB_RADIUS,
  ENVELOPE_TIP_RADIUS,
  isSameContainerLocation,
  MINI_MAP_HEIGHT,
  MINI_MAP_RX,
  MINI_MAP_RY,
  MINI_MAP_WIDTH,
  resolveExternalContainerLabel,
} from "./miniMapGeometry";

const HALO_TEXT_STYLE: React.CSSProperties = {
  paintOrder: "stroke",
  stroke: "#0b0e14",
  strokeWidth: 3,
  strokeLinejoin: "round",
};

export interface InspectorLocationCardProps {
  bundle: CampaignStateBundle;
  activeLoc: LocationNode;
  pendingLocationOverrideId?: string | null;
  selectedLocId: string;
  setSelectedLocId: React.Dispatch<React.SetStateAction<string>>;
  selectedLocation: LocationNode;
  selectedNeighbor:
    | (NeighborLocationView & { slot: CompassDirection })
    | undefined;
  immediateNeighbors: Array<NeighborLocationView & { slot: CompassDirection }>;
  miniMapCenter: { x: number; y: number };
  miniMapCoords: Record<
    string,
    { x: number; y: number; slot?: CompassDirection }
  >;
  miniDynamicPortalIds: Set<string>;
  containerMap: Map<string, LocationContainer>;
  activeBreadcrumbChain: LocationContainer[];
  showExits: boolean;
  setShowExits: React.Dispatch<React.SetStateAction<boolean>>;
  isOverriding: boolean;
  onOverrideLocation?: (locationId: string) => Promise<void> | void;
  handleOverrideClick: (targetLocId: string) => Promise<void>;
  handleOpenFullMap: () => void;
  onOpenWorldSheet?: () => void;
}

export const InspectorLocationCard: React.FC<InspectorLocationCardProps> = ({
  bundle,
  activeLoc,
  pendingLocationOverrideId,
  selectedLocId,
  setSelectedLocId,
  selectedLocation,
  selectedNeighbor,
  immediateNeighbors,
  miniMapCenter,
  miniMapCoords,
  miniDynamicPortalIds,
  containerMap,
  activeBreadcrumbChain,
  showExits,
  setShowExits,
  isOverriding,
  onOverrideLocation,
  handleOverrideClick,
  handleOpenFullMap,
  onOpenWorldSheet,
}) => {
  const maskUid = useId().replace(/:/g, "");
  const fillMaskId = `minimap-env-fill-${maskUid}`;
  const borderMaskId = `minimap-env-border-${maskUid}`;

  const activeCont = activeLoc.container_id
    ? containerMap.get(activeLoc.container_id) ?? null
    : null;
  const activeContIcon = activeCont
    ? resolveMapIconComponent(activeCont.icon, "container", activeCont.depth)
    : null;

  const sameContainerPts = activeCont
    ? immediateNeighbors.flatMap((nb) => {
        if (
          !isSameContainerLocation(
            nb.destination.container_id,
            activeCont.id,
            containerMap
          )
        ) {
          return [];
        }
        const pt = miniMapCoords[nb.destination.id];
        return pt ? [{ id: nb.destination.id, ...pt }] : [];
      })
    : [];

  const renderUnionShapes = (fillColor: string, pad = 0) => (
    <>
      <circle
        cx={miniMapCenter.x}
        cy={miniMapCenter.y}
        r={ENVELOPE_HUB_RADIUS + pad}
        fill={fillColor}
      />
      {sameContainerPts.map((pt) => (
        <React.Fragment key={pt.id}>
          <line
            x1={miniMapCenter.x}
            y1={miniMapCenter.y}
            x2={pt.x}
            y2={pt.y}
            stroke={fillColor}
            strokeWidth={(ENVELOPE_ARM_RADIUS + pad) * 2}
            strokeLinecap="round"
          />
          <circle
            cx={pt.x}
            cy={pt.y}
            r={ENVELOPE_TIP_RADIUS + pad}
            fill={fillColor}
          />
        </React.Fragment>
      ))}
    </>
  );

  return (
      <div className="inspector-card">
        <div
          className="sidebar-label"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 6,
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Compass size={13} color="var(--accent-cyan)" />
            Adjacent Map ({immediateNeighbors.length}/8 exits)
          </span>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            {onOpenWorldSheet && (
              <button
                type="button"
                className="btn"
                style={{ padding: "2px 7px", fontSize: "0.68rem" }}
                onClick={onOpenWorldSheet}
                title="Open World Sheet & campaign World Settings"
              >
                <Globe size={11} />
                World Sheet
              </button>
            )}
            <button
              type="button"
              className="btn"
              style={{ padding: "2px 7px", fontSize: "0.68rem" }}
              onClick={handleOpenFullMap}
              title="Expand full zoomable world map"
            >
              <Maximize2 size={11} />
              Expand Map ({bundle.visible_locations.length})
            </button>
          </div>
        </div>

        <svg
          width="100%"
          height={MINI_MAP_HEIGHT}
          viewBox={`0 0 ${MINI_MAP_WIDTH} ${MINI_MAP_HEIGHT}`}
          style={{
            display: "block",
            width: "100%",
            height: "auto",
            maxHeight: MINI_MAP_HEIGHT,
            background: "var(--bg-deep)",
            borderRadius: 8,
            border: "1px solid var(--border-subtle)",
            marginBottom: 10,
          }}
        >
          {activeCont && (
            <defs>
              <mask
                id={fillMaskId}
                maskUnits="userSpaceOnUse"
                x={0}
                y={0}
                width={MINI_MAP_WIDTH}
                height={MINI_MAP_HEIGHT}
              >
                <rect x={0} y={0} width={MINI_MAP_WIDTH} height={MINI_MAP_HEIGHT} fill="black" />
                {renderUnionShapes("white", 0)}
              </mask>
              <mask
                id={borderMaskId}
                maskUnits="userSpaceOnUse"
                x={0}
                y={0}
                width={MINI_MAP_WIDTH}
                height={MINI_MAP_HEIGHT}
              >
                <rect x={0} y={0} width={MINI_MAP_WIDTH} height={MINI_MAP_HEIGHT} fill="black" />
                {renderUnionShapes("white", ENVELOPE_BORDER_WIDTH)}
                {renderUnionShapes("black", 0)}
              </mask>
            </defs>
          )}

          {/* Hub-and-Spoke Active Container Envelope */}
          {activeCont && (
            <g pointerEvents="none">
              <rect
                x={0}
                y={0}
                width={MINI_MAP_WIDTH}
                height={MINI_MAP_HEIGHT}
                fill="rgba(245, 158, 11, 0.06)"
                mask={`url(#${fillMaskId})`}
              />
              <rect
                x={0}
                y={0}
                width={MINI_MAP_WIDTH}
                height={MINI_MAP_HEIGHT}
                fill="rgba(245, 158, 11, 0.42)"
                mask={`url(#${borderMaskId})`}
              />
            </g>
          )}

          {/* Subtle Compass Rose Guide Ring */}
          <g pointerEvents="none">
            <ellipse
              cx={miniMapCenter.x}
              cy={miniMapCenter.y}
              rx={MINI_MAP_RX}
              ry={MINI_MAP_RY}
              fill="none"
              stroke="rgba(148, 163, 184, 0.12)"
              strokeDasharray="3 4"
            />
            <text x={miniMapCenter.x} y={13} textAnchor="middle" fill="#475569" fontSize="8" fontWeight="700">
              N
            </text>
            <text x={MINI_MAP_WIDTH - 10} y={miniMapCenter.y + 3} textAnchor="end" fill="#475569" fontSize="8" fontWeight="700">
              E
            </text>
            <text x={miniMapCenter.x} y={MINI_MAP_HEIGHT - 5} textAnchor="middle" fill="#475569" fontSize="8" fontWeight="700">
              S
            </text>
            <text x={10} y={miniMapCenter.y + 3} textAnchor="start" fill="#475569" fontSize="8" fontWeight="700">
              W
            </text>
          </g>

          {/* 1-Hop Edges from Active Location */}
          {immediateNeighbors.map((nb) => {
            const p2 = miniMapCoords[nb.destination.id];
            if (!p2) return null;
            const midX = (miniMapCenter.x + p2.x) / 2;
            const midY = (miniMapCenter.y + p2.y) / 2;
            const crossesContainer = doesEdgeCrossContainer(
              nb.destination.container_id,
              activeLoc.container_id,
              containerMap
            );
            const ticks = crossesContainer
              ? computeBoundaryMarkerTicks(miniMapCenter, p2, nb.slot)
              : null;
            const isVerticalSlot = nb.slot === "N" || nb.slot === "S";
            const labelX = isVerticalSlot ? midX + 8 : midX;
            const labelY =
              nb.slot === "N"
                ? midY + 7
                : nb.slot === "S"
                ? midY - 6
                : midY - 4;
            const markerColor = activeCont ? "#fbbf24" : "#22d3ee";
            return (
              <g key={nb.edge_id} pointerEvents="none">
                <line
                  x1={miniMapCenter.x}
                  y1={miniMapCenter.y}
                  x2={p2.x}
                  y2={p2.y}
                  stroke={crossesContainer ? "#22d3ee" : "#06b6d4"}
                  strokeWidth={2}
                  strokeDasharray={nb.is_locked_or_hidden ? "4 3" : undefined}
                />
                {ticks && (
                  <g>
                    <line
                      x1={ticks.gap.x1}
                      y1={ticks.gap.y1}
                      x2={ticks.gap.x2}
                      y2={ticks.gap.y2}
                      stroke="#0b0e14"
                      strokeWidth={4}
                    />
                    <line
                      x1={ticks.bar1.x1}
                      y1={ticks.bar1.y1}
                      x2={ticks.bar1.x2}
                      y2={ticks.bar1.y2}
                      stroke={markerColor}
                      strokeWidth={1.75}
                      strokeLinecap="round"
                    />
                    <line
                      x1={ticks.bar2.x1}
                      y1={ticks.bar2.y1}
                      x2={ticks.bar2.x2}
                      y2={ticks.bar2.y2}
                      stroke={markerColor}
                      strokeWidth={1.75}
                      strokeLinecap="round"
                    />
                  </g>
                )}
                <text
                  x={labelX}
                  y={labelY}
                  textAnchor={isVerticalSlot ? "start" : "middle"}
                  fill="#67e8f9"
                  fontSize="7.5"
                  fontWeight="700"
                  style={HALO_TEXT_STYLE}
                >
                  {nb.slot} · {nb.travel_minutes}m
                </text>
              </g>
            );
          })}

          {/* Fixed Top-Left Active Container Pill */}
          {activeCont && activeContIcon && (() => {
            const ContIcon = activeContIcon;
            const shortContName =
              activeCont.name.length > 12
                ? `${activeCont.name.slice(0, 11)}…`
                : activeCont.name;
            const pillText = `L${activeCont.depth} · ${shortContName}`;
            const pillWidth = Math.min(130, Math.max(58, Math.round(22 + pillText.length * 4.3)));
            return (
              <g pointerEvents="none">
                <title>{`L${activeCont.depth} · ${activeCont.name}`}</title>
                <rect
                  x={6}
                  y={6}
                  width={pillWidth}
                  height={17}
                  rx={5}
                  fill="rgba(15, 23, 42, 0.88)"
                  stroke="rgba(245, 158, 11, 0.35)"
                  strokeWidth={1}
                />
                <ContIcon x={11} y={10} width={9} height={9} stroke="#fbbf24" />
                <text
                  x={23}
                  y={17}
                  fill="#fbbf24"
                  fontSize="7"
                  fontWeight="700"
                >
                  {pillText}
                </text>
              </g>
            );
          })()}

          {/* Centered Active Node + Immediate Adjacent Nodes Only */}
          {[activeLoc, ...immediateNeighbors.map((n) => n.destination)].map(
            (loc) => {
              const pt = miniMapCoords[loc.id];
              if (!pt) return null;
              const isCurrent = loc.id === activeLoc.id;
              const isSelected = loc.id === selectedLocId;
              const isPortal = miniDynamicPortalIds.has(loc.id);
              const isUnvisited = loc.is_visited === false;
              const isSameCont =
                !isCurrent &&
                Boolean(activeCont) &&
                isSameContainerLocation(
                  loc.container_id,
                  activeCont?.id,
                  containerMap
                );
              const externalLabel = !isCurrent
                ? resolveExternalContainerLabel(
                    loc,
                    activeLoc.container_id,
                    containerMap
                  )
                : null;
              const IconComp = resolveMapIconComponent(
                loc.icon,
                loc.is_hub ? "hub" : "location"
              );
              const strokeCol = isCurrent
                ? "#f59e0b"
                : loc.is_hub
                ? "#a855f7"
                : isSameCont
                ? isSelected
                  ? "#fbbf24"
                  : "#d97706"
                : isSelected
                ? "#22d3ee"
                : "#0891b2";
              const fillCol = isCurrent
                ? "rgba(245, 158, 11, 0.25)"
                : loc.is_hub
                ? "rgba(168, 85, 247, 0.24)"
                : isSameCont
                ? "rgba(245, 158, 11, 0.11)"
                : "#0f172a";
              const iconCol = isCurrent
                ? "#fbbf24"
                : loc.is_hub
                ? "#e9d5ff"
                : isSameCont
                ? "#fbbf24"
                : "#67e8f9";
              const labelCol = isCurrent
                ? "#fbbf24"
                : isSameCont
                ? isSelected
                  ? "#fbbf24"
                  : "#fde68a"
                : "#cbd5e1";
              const selectionRingCol =
                isCurrent || isSameCont ? "#fbbf24" : "#38bdf8";
              const shortName =
                loc.name.length > 16 ? loc.name.slice(0, 15) + "…" : loc.name;
              const hubRadius = isCurrent ? 13 : 11;
              const hubPoints = Array.from({ length: 8 }, (_, k) => {
                const a = (k * Math.PI) / 4 + Math.PI / 8;
                return `${(pt.x + Math.cos(a) * hubRadius).toFixed(1)},${(
                  pt.y +
                  Math.sin(a) * hubRadius
                ).toFixed(1)}`;
              }).join(" ");

              return (
                <g
                  key={loc.id}
                  style={{
                    cursor: "pointer",
                    opacity: isUnvisited && !isSelected ? 0.78 : 1,
                  }}
                  onClick={() => setSelectedLocId(loc.id)}
                >
                  {isSelected && (
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={isCurrent ? 16 : 14}
                      fill="none"
                      stroke={selectionRingCol}
                      strokeWidth={1.6}
                      strokeDasharray="2 2"
                    />
                  )}
                  {loc.is_hub ? (
                    <polygon
                      points={hubPoints}
                      fill={fillCol}
                      stroke={strokeCol}
                      strokeWidth={1.7}
                      strokeDasharray={isUnvisited ? "2 2" : undefined}
                    />
                  ) : (
                    <rect
                      x={pt.x - (isCurrent ? 12 : 10)}
                      y={pt.y - (isCurrent ? 12 : 10)}
                      width={isCurrent ? 24 : 20}
                      height={isCurrent ? 24 : 20}
                      rx={6}
                      fill={fillCol}
                      stroke={strokeCol}
                      strokeWidth={1.7}
                      strokeDasharray={isUnvisited ? "2 2" : undefined}
                    />
                  )}
                  <IconComp
                    x={pt.x - (isCurrent ? 6 : 5)}
                    y={pt.y - (isCurrent ? 6 : 5)}
                    width={isCurrent ? 12 : 10}
                    height={isCurrent ? 12 : 10}
                    stroke={iconCol}
                  />
                  {isPortal && (
                    <g>
                      <polygon
                        points={`${pt.x + 11},${pt.y - 14} ${pt.x + 15},${pt.y - 10} ${pt.x + 11},${pt.y - 6} ${pt.x + 7},${pt.y - 10}`}
                        fill="#083344"
                        stroke="#22d3ee"
                        strokeWidth={1}
                      />
                    </g>
                  )}
                  <text
                    x={pt.x}
                    y={pt.y + (isCurrent ? 21 : 18)}
                    textAnchor="middle"
                    fill={labelCol}
                    fontSize="8.8"
                    fontWeight={isCurrent || isSelected ? "700" : "500"}
                    style={HALO_TEXT_STYLE}
                  >
                    {shortName}
                  </text>
                  {externalLabel && (
                    <text
                      x={pt.x}
                      y={pt.y + 27}
                      textAnchor="middle"
                      fill={isSameCont ? "#fde68a" : "#67e8f9"}
                      fontSize="7"
                      style={HALO_TEXT_STYLE}
                    >
                      {externalLabel}
                    </text>
                  )}
                </g>
              );
            }
          )}
        </svg>

        {pendingLocationOverrideId === activeLoc.id && (
          <div
            style={{
              fontSize: "0.72rem",
              color: "#6ee7b7",
              background: "rgba(16, 185, 129, 0.12)",
              border: "1px solid rgba(16, 185, 129, 0.35)",
              borderRadius: 6,
              padding: "5px 9px",
              marginBottom: 8,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <CheckCircle2 size={12} />
            Location overridden to <strong>{activeLoc.name}</strong> for next turn / swipe.
          </div>
        )}

        {activeBreadcrumbChain.length > 0 && (
          <div
            style={{
              fontSize: "0.69rem",
              color: "var(--accent-cyan)",
              background: "rgba(6, 182, 212, 0.08)",
              border: "1px solid rgba(6, 182, 212, 0.25)",
              borderRadius: 5,
              padding: "3px 8px",
              marginBottom: 8,
              display: "flex",
              alignItems: "center",
              gap: 4,
              flexWrap: "wrap",
            }}
            title="Spatial hierarchy breadcrumbs for active scene"
          >
            {activeBreadcrumbChain.map((c) => c.name).join(" > ")}
          </div>
        )}

        {/* Selected Node Details & Override Current Location Action */}
        <div
          style={{
            background: "var(--bg-card)",
            padding: "9px 11px",
            borderRadius: 6,
            border:
              selectedLocation.id === activeLoc.id
                ? "1px solid rgba(245, 158, 11, 0.35)"
                : "1px solid rgba(6, 182, 212, 0.45)",
            marginBottom: 10,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 6,
            }}
          >
            <div
              style={{
                fontSize: "0.82rem",
                fontWeight: 700,
                color:
                  selectedLocation.id === activeLoc.id
                    ? "var(--accent-amber)"
                    : "var(--accent-cyan)",
                display: "flex",
                alignItems: "center",
                gap: 5,
                flexWrap: "wrap",
              }}
            >
              {(() => {
                const SelectedIcon = resolveMapIconComponent(
                  selectedLocation.icon,
                  selectedLocation.is_hub ? "hub" : "location"
                );
                return <SelectedIcon size={13} />;
              })()}
              <span>{selectedLocation.name}</span>
              {selectedLocation.is_hub && (
                <span className="badge" style={{ fontSize: "0.62rem", padding: "1px 5px" }}>
                  HUB
                </span>
              )}
              {miniDynamicPortalIds.has(selectedLocation.id) && (
                <span
                  className="badge"
                  style={{
                    fontSize: "0.6rem",
                    padding: "1px 5px",
                    color: "#22d3ee",
                    borderColor: "rgba(6, 182, 212, 0.4)",
                  }}
                >
                  <DoorOpen size={9} style={{ marginRight: 2 }} /> Portal
                </span>
              )}
              {selectedLocation.is_visited === false && (
                <span
                  className="badge"
                  style={{
                    fontSize: "0.6rem",
                    padding: "1px 5px",
                    color: "#94a3b8",
                  }}
                >
                  Unvisited
                </span>
              )}
            </div>
            {selectedLocation.id === activeLoc.id ? (
              <span
                className="badge"
                style={{
                  fontSize: "0.64rem",
                  padding: "1px 6px",
                  borderColor: "rgba(245, 158, 11, 0.4)",
                  color: "var(--accent-amber)",
                }}
              >
                Current
              </span>
            ) : (
              onOverrideLocation && (
                <button
                  type="button"
                  className="btn btn-amber"
                  style={{ padding: "2px 8px", fontSize: "0.69rem" }}
                  disabled={isOverriding}
                  onClick={() => handleOverrideClick(selectedLocation.id)}
                  title="Override the current scene location (fixes Clerk hallucinations for the next turn or swipe)"
                >
                  <Navigation size={11} />
                  {isOverriding ? "Setting..." : "Override Location"}
                </button>
              )
            )}
          </div>
          <div
            style={{
              fontSize: "0.75rem",
              color: "var(--text-secondary)",
              marginTop: 4,
              lineHeight: 1.45,
            }}
          >
            {selectedLocation.description}
          </div>
          {selectedNeighbor && (
            <div className="selected-exit-meta">
              <span>[{selectedNeighbor.slot}]</span>
              <span>{selectedNeighbor.travel_minutes}m</span>
              <span>via {selectedNeighbor.direction_label}</span>
              {selectedNeighbor.is_locked_or_hidden && (
                <span style={{ color: "var(--accent-rose)" }}>
                  <Lock size={10} style={{ display: "inline" }} /> Hidden/Locked
                </span>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          className="exits-toggle"
          aria-expanded={showExits}
          onClick={() => setShowExits((v) => !v)}
        >
          {showExits ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          Exits ({immediateNeighbors.length})
        </button>
        {showExits && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
            {immediateNeighbors.map((nb) => (
              <div
                key={nb.edge_id}
                className="exit-pill"
                style={{
                  cursor: "pointer",
                  borderColor:
                    selectedLocId === nb.destination.id
                      ? "var(--accent-cyan)"
                      : undefined,
                }}
                onClick={() => setSelectedLocId(nb.destination.id)}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "0.78rem",
                    fontWeight: 600,
                    color: "#22d3ee",
                  }}
                >
                  <span>
                    [{nb.slot}] → {nb.destination.name}
                  </span>
                  <span style={{ color: "var(--text-muted)", fontSize: "0.72rem" }}>
                    {nb.travel_minutes}m
                  </span>
                </div>
                <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)" }}>
                  Via: {nb.direction_label}{" "}
                  {nb.is_locked_or_hidden && (
                    <span style={{ color: "var(--accent-rose)" }}>
                      <Lock size={10} style={{ display: "inline" }} /> Hidden/Locked
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
  );
};
