import React from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Compass,
  DoorOpen,
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
}) => {
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

        <svg
          width="100%"
          height="195"
          viewBox="0 0 330 195"
          style={{
            background: "var(--bg-deep)",
            borderRadius: 8,
            border: "1px solid var(--border-subtle)",
            marginBottom: 10,
          }}
        >
          {/* Active Container Boundary Hint */}
          {activeLoc.container_id && containerMap.get(activeLoc.container_id) && (() => {
            const activeCont = containerMap.get(activeLoc.container_id)!;
            const ContIcon = resolveMapIconComponent(
              activeCont.icon,
              "container",
              activeCont.depth
            );
            return (
              <g>
                <rect
                  x={124}
                  y={62}
                  width={82}
                  height={66}
                  rx={8}
                  fill="rgba(245, 158, 11, 0.04)"
                  stroke="rgba(245, 158, 11, 0.3)"
                  strokeDasharray="3 3"
                  strokeWidth={1}
                />
                <g>
                  <ContIcon x={128} y={51} width={9} height={9} stroke="#fbbf24" />
                  <text
                    x={140}
                    y={58}
                    fill="#fbbf24"
                    fontSize="7"
                    fontWeight="700"
                  >
                    L{activeCont.depth} ·{" "}
                    {activeCont.name.length > 12
                      ? `${activeCont.name.slice(0, 11)}…`
                      : activeCont.name}
                  </text>
                </g>
              </g>
            );
          })()}

          {/* Subtle Compass Rose Guide Ring */}
          <ellipse
            cx={miniMapCenter.x}
            cy={miniMapCenter.y}
            rx={102}
            ry={66}
            fill="none"
            stroke="rgba(148, 163, 184, 0.12)"
            strokeDasharray="3 4"
          />
          <text x={miniMapCenter.x} y={14} textAnchor="middle" fill="#475569" fontSize="8" fontWeight="700">
            N
          </text>
          <text x={320} y={miniMapCenter.y + 3} textAnchor="end" fill="#475569" fontSize="8" fontWeight="700">
            E
          </text>
          <text x={miniMapCenter.x} y={189} textAnchor="middle" fill="#475569" fontSize="8" fontWeight="700">
            S
          </text>
          <text x={10} y={miniMapCenter.y + 3} textAnchor="start" fill="#475569" fontSize="8" fontWeight="700">
            W
          </text>

          {/* 1-Hop Edges from Active Location */}
          {immediateNeighbors.map((nb) => {
            const p2 = miniMapCoords[nb.destination.id];
            if (!p2) return null;
            const midX = (miniMapCenter.x + p2.x) / 2;
            const midY = (miniMapCenter.y + p2.y) / 2;
            const crossesContainer =
              (nb.destination.container_id ?? null) !==
              (activeLoc.container_id ?? null);
            return (
              <g key={nb.edge_id}>
                <line
                  x1={miniMapCenter.x}
                  y1={miniMapCenter.y}
                  x2={p2.x}
                  y2={p2.y}
                  stroke={crossesContainer ? "#22d3ee" : "#06b6d4"}
                  strokeWidth={2}
                  strokeDasharray={
                    nb.is_locked_or_hidden
                      ? "4 3"
                      : crossesContainer
                      ? "2 2"
                      : undefined
                  }
                />
                <text
                  x={midX}
                  y={midY - 3}
                  textAnchor="middle"
                  fill="#67e8f9"
                  fontSize="7.5"
                  fontWeight="700"
                >
                  {nb.slot} · {nb.travel_minutes}m
                </text>
              </g>
            );
          })}

          {/* Centered Active Node + Immediate Adjacent Nodes Only */}
          {[activeLoc, ...immediateNeighbors.map((n) => n.destination)].map(
            (loc) => {
              const pt = miniMapCoords[loc.id];
              if (!pt) return null;
              const isCurrent = loc.id === activeLoc.id;
              const isSelected = loc.id === selectedLocId;
              const isPortal = miniDynamicPortalIds.has(loc.id);
              const isUnvisited = loc.is_visited === false;
              const diffCont =
                !isCurrent &&
                loc.container_id &&
                loc.container_id !== activeLoc.container_id
                  ? containerMap.get(loc.container_id) ?? null
                  : null;
              const IconComp = resolveMapIconComponent(
                loc.icon,
                loc.is_hub ? "hub" : "location"
              );
              const strokeCol = isCurrent
                ? "#f59e0b"
                : loc.is_hub
                ? "#a855f7"
                : isSelected
                ? "#22d3ee"
                : "#0891b2";
              const fillCol = isCurrent
                ? "rgba(245, 158, 11, 0.25)"
                : loc.is_hub
                ? "rgba(168, 85, 247, 0.24)"
                : "#0f172a";
              const iconCol = isCurrent
                ? "#fbbf24"
                : loc.is_hub
                ? "#e9d5ff"
                : "#67e8f9";
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
                      stroke={isCurrent ? "#fbbf24" : "#38bdf8"}
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
                    fill={isCurrent ? "#fbbf24" : "#cbd5e1"}
                    fontSize="8.8"
                    fontWeight={isCurrent || isSelected ? "700" : "500"}
                  >
                    {shortName}
                  </text>
                  {diffCont && (
                    <text
                      x={pt.x}
                      y={pt.y + 27}
                      textAnchor="middle"
                      fill="#fbbf24"
                      fontSize="7"
                    >
                      [{diffCont.name.length > 13
                        ? `${diffCont.name.slice(0, 12)}…`
                        : diffCont.name}]
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
