import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Compass,
  Crosshair,
  GitBranch,
  Link2,
  Lock,
  MapPin,
  Navigation,
  Plus,
  Star,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { CompassDirection, LocationEdge, LocationNode } from "../types";

export const COMPASS_ORDER: CompassDirection[] = [
  "N",
  "NE",
  "E",
  "SE",
  "S",
  "SW",
  "W",
  "NW",
];

export const OPPOSITE_COMPASS: Record<CompassDirection, CompassDirection> = {
  N: "S",
  NE: "SW",
  E: "W",
  SE: "NW",
  S: "N",
  SW: "NE",
  W: "E",
  NW: "SE",
};

export const COMPASS_ANGLES: Record<CompassDirection, number> = {
  N: -Math.PI / 2,
  NE: -Math.PI / 4,
  E: 0,
  SE: Math.PI / 4,
  S: Math.PI / 2,
  SW: (3 * Math.PI) / 4,
  W: Math.PI,
  NW: (-3 * Math.PI) / 4,
};

export function inferCompassDirection(
  rawDir?: string | null,
  fallbackText = ""
): CompassDirection {
  if (rawDir) {
    const cleaned = rawDir.replace(/[^A-Za-z]/g, "").toUpperCase();
    const aliasMap: Record<string, CompassDirection> = {
      N: "N",
      NORTH: "N",
      NE: "NE",
      NORTHEAST: "NE",
      E: "E",
      EAST: "E",
      SE: "SE",
      SOUTHEAST: "SE",
      S: "S",
      SOUTH: "S",
      SW: "SW",
      SOUTHWEST: "SW",
      W: "W",
      WEST: "W",
      NW: "NW",
      NORTHWEST: "NW",
    };
    if (aliasMap[cleaned]) return aliasMap[cleaned];
  }
  const low = `${rawDir ?? ""} ${fallbackText}`.toLowerCase();
  const patterns: Array<[RegExp, CompassDirection]> = [
    [/\b(north[\s-]?east|ne)\b/, "NE"],
    [/\b(north[\s-]?west|nw)\b/, "NW"],
    [/\b(south[\s-]?east|se)\b/, "SE"],
    [/\b(south[\s-]?west|sw)\b/, "SW"],
    [/\b(north|northern|back|rear|behind|upstairs|up|above|mezzanine|roof)\b/, "N"],
    [/\b(east|eastern|right|starboard)\b/, "E"],
    [/\b(south|southern|front|street|outside|downstairs|down|below|basement|sub-basement|hatch|cellar)\b/, "S"],
    [/\b(west|western|left|port|alley|side)\b/, "W"],
  ];
  for (const [pat, cdir] of patterns) {
    if (pat.test(low)) return cdir;
  }
  return "N";
}

export function pickCompassSlot(
  preferred: CompassDirection | null | undefined,
  occupied: Set<CompassDirection>
): CompassDirection {
  const base: CompassDirection =
    preferred && COMPASS_ORDER.includes(preferred) ? preferred : "N";
  if (!occupied.has(base)) return base;
  const startIdx = COMPASS_ORDER.indexOf(base);
  for (let offset = 1; offset < COMPASS_ORDER.length; offset++) {
    for (const sign of [1, -1]) {
      const idx =
        (startIdx + offset * sign + COMPASS_ORDER.length) %
        COMPASS_ORDER.length;
      const cand = COMPASS_ORDER[idx];
      if (!occupied.has(cand)) return cand;
    }
  }
  return base;
}

export function computeFullMapCoords(
  locations: LocationNode[],
  edges: LocationEdge[],
  activeLocId: string
): Record<string, { x: number; y: number }> {
  const coords: Record<string, { x: number; y: number }> = {};
  if (locations.length === 0) return coords;

  const locById = new Map(locations.map((l) => [l.id, l]));
  const startId = locById.has(activeLocId) ? activeLocId : locations[0].id;
  coords[startId] = { x: 0, y: 0 };

  const adj = new Map<string, Array<{ to: string; dir: CompassDirection }>>();
  for (const e of edges) {
    if (!locById.has(e.from_location_id) || !locById.has(e.to_location_id)) {
      continue;
    }
    const d: CompassDirection =
      e.compass_direction && COMPASS_ORDER.includes(e.compass_direction)
        ? e.compass_direction
        : "N";
    if (!adj.has(e.from_location_id)) adj.set(e.from_location_id, []);
    adj.get(e.from_location_id)!.push({ to: e.to_location_id, dir: d });
  }

  const visited = new Set<string>([startId]);
  const queue: string[] = [startId];
  const stepDist = 175;

  while (queue.length > 0) {
    const curr = queue.shift()!;
    const currPt = coords[curr];
    const outgoing = adj.get(curr) ?? [];
    const usedSlots = new Set<CompassDirection>();

    for (const item of outgoing) {
      if (visited.has(item.to)) continue;
      visited.add(item.to);
      const slot = pickCompassSlot(item.dir, usedSlots);
      usedSlots.add(slot);
      const angle = COMPASS_ANGLES[slot];
      coords[item.to] = {
        x: currPt.x + Math.cos(angle) * stepDist,
        y: currPt.y + Math.sin(angle) * stepDist,
      };
      queue.push(item.to);
    }
  }

  // Place any unvisited/disconnected locations in an outer ring
  const unvisited = locations.filter((l) => !visited.has(l.id));
  unvisited.forEach((loc, idx) => {
    const angle =
      (idx / Math.max(1, unvisited.length)) * Math.PI * 2 - Math.PI / 2;
    coords[loc.id] = {
      x: Math.cos(angle) * (stepDist * 2.2),
      y: Math.sin(angle) * (stepDist * 2.2),
    };
  });

  // Iterative collision repulsion so multi-hop nodes never overlap
  const ids = Object.keys(coords);
  const minDist = 115;
  for (let iter = 0; iter < 36; iter++) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const idA = ids[i];
        const idB = ids[j];
        const pA = coords[idA];
        const pB = coords[idB];
        let dx = pB.x - pA.x;
        let dy = pB.y - pA.y;
        let dist = Math.hypot(dx, dy);
        if (dist < 1) {
          dx = (i + 1) * 7;
          dy = (j + 1) * 5;
          dist = Math.hypot(dx, dy);
        }
        if (dist < minDist) {
          const push = ((minDist - dist) / dist) * 0.5;
          const ox = dx * push;
          const oy = dy * push;
          if (idA === startId) {
            pB.x += ox * 2;
            pB.y += oy * 2;
          } else if (idB === startId) {
            pA.x -= ox * 2;
            pA.y -= oy * 2;
          } else {
            pA.x -= ox;
            pA.y -= oy;
            pB.x += ox;
            pB.y += oy;
          }
        }
      }
    }
  }

  for (const id of ids) {
    coords[id] = {
      x: Math.round(coords[id].x),
      y: Math.round(coords[id].y),
    };
  }
  return coords;
}

export interface SpatialTopologyViewProps {
  title?: string;
  locations: LocationNode[];
  edges: LocationEdge[];
  /** In Campaign mode: current active scene location. In World Sheet: starting hub location. */
  activeLocationId: string;
  defaultSelectedLocationId?: string;
  mode: "campaign" | "editor";

  // Optional Close callback (used when rendered in a modal overlay)
  onClose?: () => void;

  // Editor mode actions (staged updates in World Sheet)
  onUpdateLocation?: (updated: LocationNode) => void;
  onDeleteLocation?: (locationId: string) => void;
  onSetStartingLocation?: (locationId: string) => void;
  onAddEdge?: (payload: {
    from_location_id: string;
    to_location_id: string;
    direction_label: string;
    compass_direction: CompassDirection;
    travel_minutes: number;
    bidirectional?: boolean;
  }) => void;
  onDeleteEdge?: (edgeId: string) => void;

  // Link Creation (supported in both modes)
  onCreateLinkedLocation?: (payload: {
    from_location_id: string;
    name: string;
    compass_direction: CompassDirection;
    travel_minutes: number;
    description: string;
    environmental_tags: string[];
    is_hub?: boolean;
    summary?: string;
  }) => Promise<string | void> | void;

  // Campaign mode actions
  onOverrideLocation?: (locationId: string) => Promise<void> | void;
  isOverriding?: boolean;
}

export const SpatialTopologyView: React.FC<SpatialTopologyViewProps> = ({
  title,
  locations,
  edges,
  activeLocationId,
  defaultSelectedLocationId,
  mode,
  onClose,
  onUpdateLocation,
  onDeleteLocation,
  onSetStartingLocation,
  onAddEdge,
  onDeleteEdge,
  onCreateLinkedLocation,
  onOverrideLocation,
  isOverriding = false,
}) => {
  const [selectedLocId, setSelectedLocId] = useState<string>(
    defaultSelectedLocationId || activeLocationId || locations[0]?.id || ""
  );

  // Pan and zoom state for the SVG canvas
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragRef = useRef<{
    dragging: boolean;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  }>({ dragging: false, startX: 0, startY: 0, origX: 0, origY: 0 });

  // "Create Link" form state
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkName, setLinkName] = useState("");
  const [linkDirection, setLinkDirection] = useState<CompassDirection>("N");
  const [linkMinutes, setLinkMinutes] = useState("2");
  const [linkDescription, setLinkDescription] = useState("");
  const [linkTags, setLinkTags] = useState("");
  const [linkIsHub, setLinkIsHub] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [isCreatingLink, setIsCreatingLink] = useState(false);

  // "Connect Existing Location" form state (Editor mode)
  const [showConnectForm, setShowConnectForm] = useState(false);
  const [connectTargetId, setConnectTargetId] = useState<string>("");
  const [connectDirection, setConnectDirection] = useState<CompassDirection>("N");
  const [connectMinutes, setConnectMinutes] = useState("2");
  const [connectBidirectional, setConnectBidirectional] = useState(true);

  // Keep selectedLocId valid if locations list changes
  useEffect(() => {
    if (locations.length === 0) return;
    const exists = locations.some((l) => l.id === selectedLocId);
    if (!exists) {
      setSelectedLocId(activeLocationId || locations[0].id);
    }
  }, [locations, selectedLocId, activeLocationId]);

  useEffect(() => {
    setShowLinkForm(false);
    setShowConnectForm(false);
  }, [selectedLocId]);

  const activeLoc = useMemo(
    () =>
      locations.find((l) => l.id === activeLocationId) ??
      locations.find((l) => l.is_starting_location) ??
      locations[0],
    [locations, activeLocationId]
  );

  const selectedLocation = useMemo(
    () => locations.find((l) => l.id === selectedLocId) ?? activeLoc,
    [locations, selectedLocId, activeLoc]
  );

  // Memoize graph topology coordinates so text edits (description, tags) don't trigger layout recalculation
  const topologyKey = useMemo(() => {
    const locIds = locations.map((l) => l.id).sort().join(",");
    const edgeKeys = edges
      .map((e) => `${e.from_location_id}->${e.to_location_id}`)
      .sort()
      .join(",");
    return `${locIds}::${edgeKeys}::${activeLoc?.id || ""}`;
  }, [locations, edges, activeLoc?.id]);

  const fullMapCoords = useMemo(() => {
    return computeFullMapCoords(locations, edges, activeLoc?.id || "");
  }, [topologyKey]);

  const locMap = useMemo(
    () => new Map(locations.map((l) => [l.id, l])),
    [locations]
  );

  // Connected exits originating from the selected location
  const selectedLocExits = useMemo(() => {
    if (!selectedLocation) return [];
    return edges
      .filter((e) => e.from_location_id === selectedLocation.id)
      .map((e) => ({
        edge: e,
        dest: locMap.get(e.to_location_id),
      }))
      .filter(
        (item): item is { edge: LocationEdge; dest: LocationNode } =>
          Boolean(item.dest)
      );
  }, [edges, selectedLocation, locMap]);

  // Occupied exits from this node
  const occupiedDirections = useMemo(() => {
    return new Set(
      selectedLocExits
        .map((ex) => ex.edge.compass_direction)
        .filter((d): d is CompassDirection => Boolean(d))
    );
  }, [selectedLocExits]);

  // Immediate neighbors of active location for styling
  const activeNeighborIds = useMemo(() => {
    if (!activeLoc) return new Set<string>();
    return new Set(
      edges
        .filter((e) => e.from_location_id === activeLoc.id)
        .map((e) => e.to_location_id)
    );
  }, [edges, activeLoc]);

  const handleCenter = () => {
    const targetId = selectedLocation?.id || activeLoc?.id;
    if (!targetId) {
      setPan({ x: 0, y: 0 });
      setZoom(1);
      return;
    }
    const pt = fullMapCoords[targetId] ?? { x: 0, y: 0 };
    setPan({ x: -pt.x, y: -pt.y });
    setZoom(1);
  };

  const openLinkForm = (asHub = false) => {
    const firstFreeSlot =
      COMPASS_ORDER.find((d) => !occupiedDirections.has(d)) ?? "N";
    setLinkName(asHub ? `${selectedLocation?.name || "Sector"} — Passage` : "");
    setLinkDirection(firstFreeSlot);
    setLinkMinutes(asHub ? "1" : "2");
    setLinkDescription(
      asHub
        ? "A connecting passageway and transit corridor linking adjoining sectors."
        : ""
    );
    setLinkTags(asHub ? "hub, passageway" : "");
    setLinkIsHub(asHub);
    setLinkError(null);
    setShowLinkForm(true);
    setShowConnectForm(false);
  };

  const submitLinkForm = async () => {
    if (!onCreateLinkedLocation || !selectedLocation || isCreatingLink) return;
    setIsCreatingLink(true);
    setLinkError(null);
    try {
      const minutes = Math.max(1, Math.min(240, parseInt(linkMinutes, 10) || 1));
      const tags = linkTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const newId = await onCreateLinkedLocation({
        from_location_id: selectedLocation.id,
        name: linkName.trim(),
        compass_direction: linkDirection,
        travel_minutes: minutes,
        description: linkDescription.trim(),
        environmental_tags: tags,
        is_hub: linkIsHub,
        summary: linkName.trim(),
      });
      setShowLinkForm(false);
      if (newId) {
        setSelectedLocId(newId);
      }
    } catch (err) {
      setLinkError(String(err));
    } finally {
      setIsCreatingLink(false);
    }
  };

  const openConnectForm = () => {
    const availableTargets = locations.filter(
      (l) => l.id !== selectedLocation?.id
    );
    setConnectTargetId(availableTargets[0]?.id || "");
    const firstFreeSlot =
      COMPASS_ORDER.find((d) => !occupiedDirections.has(d)) ?? "N";
    setConnectDirection(firstFreeSlot);
    setConnectMinutes("2");
    setConnectBidirectional(true);
    setShowConnectForm(true);
    setShowLinkForm(false);
  };

  const submitConnectForm = () => {
    if (!onAddEdge || !selectedLocation || !connectTargetId) return;
    const minutes = Math.max(
      1,
      Math.min(240, parseInt(connectMinutes, 10) || 1)
    );
    const targetLoc = locMap.get(connectTargetId);
    onAddEdge({
      from_location_id: selectedLocation.id,
      to_location_id: connectTargetId,
      direction_label: `Passage to ${targetLoc?.name || "adjoining sector"}`,
      compass_direction: connectDirection,
      travel_minutes: minutes,
      bidirectional: connectBidirectional,
    });
    setShowConnectForm(false);
  };

  if (!selectedLocation && locations.length === 0) {
    return (
      <div
        style={{
          padding: 30,
          textAlign: "center",
          color: "var(--text-muted)",
          background: "var(--bg-deep)",
          borderRadius: 8,
          border: "1px solid var(--border-subtle)",
        }}
      >
        <Compass
          size={32}
          color="var(--accent-cyan)"
          style={{ marginBottom: 8, opacity: 0.6 }}
        />
        <div style={{ fontSize: "0.9rem", color: "var(--text-secondary)" }}>
          No spatial locations defined in this world yet.
        </div>
      </div>
    );
  }

  const isCurrentOrStart = selectedLocation?.id === activeLoc?.id;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        width: "100%",
      }}
    >
      {/* Header Toolbar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: "0.88rem",
            fontWeight: 600,
          }}
        >
          <Compass size={17} color="var(--accent-cyan)" />
          {title ||
            `Full Spatial Topology (${locations.length} Locations, ${edges.length} Passages)`}
        </span>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            type="button"
            className="btn"
            style={{ padding: "4px 8px", fontSize: "0.74rem" }}
            onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))}
            title="Zoom In"
          >
            <ZoomIn size={14} />
          </button>
          <button
            type="button"
            className="btn"
            style={{ padding: "4px 8px", fontSize: "0.74rem" }}
            onClick={() => setZoom((z) => Math.max(0.35, +(z - 0.25).toFixed(2)))}
            title="Zoom Out"
          >
            <ZoomOut size={14} />
          </button>
          <button
            type="button"
            className="btn"
            style={{ padding: "4px 9px", fontSize: "0.74rem" }}
            onClick={handleCenter}
            title="Center on Selected / Starting Location"
          >
            <Crosshair size={14} />
            Center ({Math.round(zoom * 100)}%)
          </button>
          {onClose && (
            <button
              type="button"
              className="btn"
              style={{ padding: "4px 8px" }}
              onClick={onClose}
              title="Close Map"
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      {/* Main 2-Column Area: SVG Visual Map + Selected Location Inspector */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 340px",
          gap: 14,
          minHeight: 520,
          maxHeight: "calc(88vh - 120px)",
        }}
      >
        {/* Left: Interactive Pan/Zoom SVG Canvas */}
        <div
          style={{
            position: "relative",
            background: "var(--bg-deep)",
            borderRadius: 8,
            border: "1px solid var(--border-subtle)",
            overflow: "hidden",
            userSelect: "none",
            minHeight: 520,
          }}
        >
          <svg
            width="100%"
            height="100%"
            style={{
              minHeight: 520,
              cursor: dragRef.current.dragging ? "grabbing" : "grab",
              display: "block",
            }}
            viewBox="-340 -260 680 520"
            onWheel={(e) => {
              e.preventDefault();
              const delta = e.deltaY < 0 ? 0.15 : -0.15;
              setZoom((z) =>
                Math.min(3, Math.max(0.35, +(z + delta).toFixed(2)))
              );
            }}
            onMouseDown={(e) => {
              dragRef.current = {
                dragging: true,
                startX: e.clientX,
                startY: e.clientY,
                origX: pan.x,
                origY: pan.y,
              };
            }}
            onMouseMove={(e) => {
              if (!dragRef.current.dragging) return;
              const dx = (e.clientX - dragRef.current.startX) / zoom;
              const dy = (e.clientY - dragRef.current.startY) / zoom;
              setPan({
                x: dragRef.current.origX + dx,
                y: dragRef.current.origY + dy,
              });
            }}
            onMouseUp={() => {
              dragRef.current.dragging = false;
            }}
            onMouseLeave={() => {
              dragRef.current.dragging = false;
            }}
          >
            <g transform={`scale(${zoom}) translate(${pan.x}, ${pan.y})`}>
              {/* All Visible Edge Passages */}
              {edges.map((edge) => {
                const p1 = fullMapCoords[edge.from_location_id];
                const p2 = fullMapCoords[edge.to_location_id];
                if (!p1 || !p2) return null;
                const isDirect =
                  edge.from_location_id === activeLoc?.id ||
                  edge.to_location_id === activeLoc?.id ||
                  edge.from_location_id === selectedLocation?.id ||
                  edge.to_location_id === selectedLocation?.id;
                const midX = (p1.x + p2.x) / 2;
                const midY = (p1.y + p2.y) / 2;
                return (
                  <g key={edge.id}>
                    <line
                      x1={p1.x}
                      y1={p1.y}
                      x2={p2.x}
                      y2={p2.y}
                      stroke={isDirect ? "#06b6d4" : "#334155"}
                      strokeWidth={isDirect ? 2.4 : 1.4}
                      strokeDasharray={
                        edge.is_locked_or_hidden ? "5 4" : undefined
                      }
                    />
                    {edge.compass_direction &&
                      edge.from_location_id < edge.to_location_id && (
                        <text
                          x={midX}
                          y={midY - 5}
                          textAnchor="middle"
                          fill={isDirect ? "#67e8f9" : "#64748b"}
                          fontSize="8.5"
                          fontWeight="600"
                        >
                          {edge.compass_direction} ({edge.travel_minutes}m)
                        </text>
                      )}
                  </g>
                );
              })}

              {/* All Visible Location Nodes */}
              {locations.map((loc) => {
                const pt = fullMapCoords[loc.id];
                if (!pt) return null;
                const isAnchor = loc.id === activeLoc?.id;
                const isNeighbor = activeNeighborIds.has(loc.id);
                const isSelected = loc.id === selectedLocation?.id;
                const fill = isAnchor
                  ? "#f59e0b"
                  : loc.is_hub
                  ? "#a855f7"
                  : isNeighbor
                  ? "#06b6d4"
                  : "#475569";

                return (
                  <g
                    key={loc.id}
                    style={{ cursor: "pointer" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedLocId(loc.id);
                    }}
                  >
                    {isSelected && (
                      <circle
                        cx={pt.x}
                        cy={pt.y}
                        r={isAnchor ? 16 : 13}
                        fill="none"
                        stroke={isAnchor ? "#fbbf24" : "#38bdf8"}
                        strokeWidth={2}
                        strokeDasharray="3 3"
                      />
                    )}
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={isAnchor ? 11 : loc.is_hub ? 9.5 : 8}
                      fill={fill}
                      stroke="#0b0e14"
                      strokeWidth={2.2}
                    />
                    <text
                      x={pt.x}
                      y={pt.y + (isAnchor ? 23 : 19)}
                      textAnchor="middle"
                      fill={
                        isAnchor
                          ? "#fbbf24"
                          : isSelected
                          ? "#f8fafc"
                          : "#cbd5e1"
                      }
                      fontSize="10.5"
                      fontWeight={isAnchor || isSelected ? "700" : "500"}
                    >
                      {loc.name}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>

          {/* Floating Legend Overlay */}
          <div
            style={{
              position: "absolute",
              left: 10,
              bottom: 10,
              background: "rgba(11, 14, 20, 0.88)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 6,
              padding: "5px 10px",
              fontSize: "0.7rem",
              color: "var(--text-secondary)",
              display: "flex",
              gap: 10,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <span>
              <strong style={{ color: "#f59e0b" }}>●</strong>{" "}
              {mode === "campaign" ? "Current Scene" : "Starting Hub"}
            </span>
            <span>
              <strong style={{ color: "#a855f7" }}>●</strong> Passage Hub
            </span>
            <span>
              <strong style={{ color: "#06b6d4" }}>●</strong> Adjacent
            </span>
            <span>
              <strong style={{ color: "#475569" }}>●</strong> Other Rooms
            </span>
            <span style={{ color: "var(--text-muted)", fontSize: "0.68rem" }}>
              (Drag to pan • Wheel to zoom • Click node to select)
            </span>
          </div>
        </div>

        {/* Right: Selected Location Inspector & Editor Controls */}
        <div
          style={{
            background: "var(--bg-card)",
            borderRadius: 8,
            border: "1px solid var(--border-subtle)",
            padding: 14,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            overflowY: "auto",
            maxHeight: "100%",
          }}
        >
          {/* Header Row */}
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 6,
              }}
            >
              <div
                style={{
                  fontSize: "0.68rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "var(--text-muted)",
                  fontWeight: 600,
                }}
              >
                Selected Location
              </div>

              {/* Editor Mode: Delete Location button */}
              {mode === "editor" &&
                onDeleteLocation &&
                locations.length > 1 && (
                  <button
                    type="button"
                    className="item-remove-btn"
                    title="Delete this location and connected exits"
                    onClick={() => {
                      if (
                        window.confirm(
                          `Delete "${selectedLocation.name}" and all connecting passages?`
                        )
                      ) {
                        onDeleteLocation(selectedLocation.id);
                      }
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
            </div>

            {/* Location Title / Name Input */}
            {mode === "editor" && onUpdateLocation ? (
              <div className="field-group" style={{ marginBottom: 6 }}>
                <label style={{ fontSize: "0.72rem" }}>Location Name</label>
                <input
                  className="field-input"
                  style={{
                    fontWeight: 700,
                    fontSize: "0.9rem",
                    color: isCurrentOrStart
                      ? "var(--accent-amber)"
                      : "var(--text-primary)",
                  }}
                  value={selectedLocation.name}
                  onChange={(e) =>
                    onUpdateLocation({
                      ...selectedLocation,
                      name: e.target.value,
                    })
                  }
                />
              </div>
            ) : (
              <div
                style={{
                  fontSize: "0.98rem",
                  fontWeight: 700,
                  color: isCurrentOrStart
                    ? "var(--accent-amber)"
                    : "var(--text-primary)",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  flexWrap: "wrap",
                }}
              >
                <MapPin size={15} color="var(--accent-cyan)" />
                {selectedLocation.name}
                {selectedLocation.is_hub && (
                  <span
                    className="badge"
                    style={{
                      fontSize: "0.62rem",
                      padding: "1px 6px",
                      color: "#c084fc",
                      borderColor: "rgba(168, 85, 247, 0.4)",
                    }}
                  >
                    PASSAGE HUB
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Location Role & Starting Location Status */}
          {mode === "campaign" ? (
            isCurrentOrStart ? (
              <div
                style={{
                  background: "rgba(245, 158, 11, 0.12)",
                  border: "1px solid rgba(245, 158, 11, 0.35)",
                  borderRadius: 6,
                  padding: "6px 10px",
                  fontSize: "0.74rem",
                  color: "var(--accent-amber)",
                  fontWeight: 600,
                }}
              >
                Active Scene Location
              </div>
            ) : (
              onOverrideLocation && (
                <button
                  type="button"
                  className="btn btn-amber"
                  style={{
                    width: "100%",
                    justifyContent: "center",
                    padding: "7px 12px",
                    fontSize: "0.78rem",
                  }}
                  disabled={isOverriding}
                  onClick={() => onOverrideLocation(selectedLocation.id)}
                >
                  <Navigation size={13} />
                  {isOverriding
                    ? "Overriding Location..."
                    : "Override Current Location Here"}
                </button>
              )
            )
          ) : (
            /* Editor Mode: Hub toggle + Starting Hub designation */
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                background: "var(--bg-panel)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 6,
                padding: "8px 10px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                {selectedLocation.is_starting_location ? (
                  <span
                    className="badge"
                    style={{
                      color: "var(--accent-amber)",
                      borderColor: "rgba(245, 158, 11, 0.4)",
                      fontSize: "0.72rem",
                      fontWeight: 600,
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <Star size={11} fill="var(--accent-amber)" /> Starting Hub
                  </span>
                ) : (
                  onSetStartingLocation && (
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: "3px 8px", fontSize: "0.72rem" }}
                      onClick={() =>
                        onSetStartingLocation(selectedLocation.id)
                      }
                      title="Set as initial starting location for campaigns"
                    >
                      <Star size={12} /> Set as Starting Hub
                    </button>
                  )
                )}

                {/* Passage Hub Toggle */}
                {onUpdateLocation && (
                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: "0.74rem",
                      cursor: "pointer",
                      color: selectedLocation.is_hub
                        ? "#c084fc"
                        : "var(--text-secondary)",
                      fontWeight: selectedLocation.is_hub ? 600 : 400,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(selectedLocation.is_hub)}
                      onChange={(e) =>
                        onUpdateLocation({
                          ...selectedLocation,
                          is_hub: e.target.checked,
                        })
                      }
                    />
                    Passage Hub
                  </label>
                )}
              </div>
            </div>
          )}

          {/* Summary / Exit Hook */}
          {mode === "editor" && onUpdateLocation ? (
            <div className="field-group">
              <label style={{ fontSize: "0.72rem" }}>
                1-Sentence Exit Hook / Summary
              </label>
              <input
                className="field-input"
                value={selectedLocation.summary || ""}
                placeholder="Brief summary visible from adjacent rooms..."
                onChange={(e) =>
                  onUpdateLocation({
                    ...selectedLocation,
                    summary: e.target.value,
                  })
                }
              />
            </div>
          ) : (
            selectedLocation.summary && (
              <div
                style={{
                  fontSize: "0.76rem",
                  color: "var(--accent-cyan)",
                  lineHeight: 1.4,
                }}
              >
                {selectedLocation.summary}
              </div>
            )
          )}

          {/* Sensory Description */}
          {mode === "editor" && onUpdateLocation ? (
            <div className="field-group">
              <label style={{ fontSize: "0.72rem" }}>
                Sensory Description (Atmosphere, Sights, Smells)
              </label>
              <textarea
                className="field-textarea"
                rows={3}
                value={selectedLocation.description}
                placeholder="Full sensory description when inside this room..."
                onChange={(e) =>
                  onUpdateLocation({
                    ...selectedLocation,
                    description: e.target.value,
                  })
                }
              />
            </div>
          ) : (
            <div className="cog-step">
              <div className="cog-step-label">Sensory Description</div>
              <div style={{ fontSize: "0.76rem", lineHeight: 1.45 }}>
                {selectedLocation.description}
              </div>
            </div>
          )}

          {/* Environmental Tags */}
          {mode === "editor" && onUpdateLocation ? (
            <div className="field-group">
              <label style={{ fontSize: "0.72rem" }}>
                Environmental Tags (comma-separated)
              </label>
              <input
                className="field-input"
                value={selectedLocation.environmental_tags.join(", ")}
                placeholder="e.g. dim, noisy, neon, smoke"
                onChange={(e) =>
                  onUpdateLocation({
                    ...selectedLocation,
                    environmental_tags: e.target.value
                      .split(",")
                      .map((t) => t.trim())
                      .filter(Boolean),
                  })
                }
              />
            </div>
          ) : (
            selectedLocation.environmental_tags.length > 0 && (
              <div className="cog-step">
                <div className="cog-step-label">Environmental Tags</div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 4,
                    marginTop: 4,
                  }}
                >
                  {selectedLocation.environmental_tags.map((tag, idx) => (
                    <span
                      key={idx}
                      className="badge"
                      style={{ fontSize: "0.68rem", padding: "2px 6px" }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )
          )}

          {/* Action: Create Linked Location from Selected Location */}
          {onCreateLinkedLocation && (
            <div>
              {!showLinkForm && !showConnectForm ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <button
                    type="button"
                    className="btn"
                    style={{
                      width: "100%",
                      justifyContent: "center",
                      padding: "7px 12px",
                      fontSize: "0.78rem",
                    }}
                    onClick={() => openLinkForm(false)}
                  >
                    <Link2 size={13} />
                    Create Link from {selectedLocation.name}
                  </button>

                  {mode === "editor" && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                      <button
                        type="button"
                        className="btn"
                        style={{
                          justifyContent: "center",
                          padding: "5px 8px",
                          fontSize: "0.72rem",
                          color: "#c084fc",
                        }}
                        onClick={() => openLinkForm(true)}
                        title="Add a connected transit corridor or junction"
                      >
                        <GitBranch size={12} />
                        + Passage Hub
                      </button>

                      {locations.length >= 2 && onAddEdge && (
                        <button
                          type="button"
                          className="btn"
                          style={{
                            justifyContent: "center",
                            padding: "5px 8px",
                            fontSize: "0.72rem",
                          }}
                          onClick={openConnectForm}
                          title="Connect this room to an existing location"
                        >
                          <Plus size={12} />
                          + Exit to Room
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ) : showLinkForm ? (
                /* Link Creation Form */
                <div
                  style={{
                    border: "1px solid rgba(6, 182, 212, 0.45)",
                    borderRadius: 6,
                    padding: 10,
                    display: "flex",
                    flexDirection: "column",
                    gap: 7,
                    background: "var(--bg-panel)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span className="cog-step-label">
                      New {linkIsHub ? "Passage Hub" : "Room"} linked to{" "}
                      {selectedLocation.name}
                    </span>
                    {mode === "editor" && (
                      <label
                        style={{
                          fontSize: "0.7rem",
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          cursor: "pointer",
                          color: linkIsHub ? "#c084fc" : "var(--text-secondary)",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={linkIsHub}
                          onChange={(e) => setLinkIsHub(e.target.checked)}
                        />
                        Passage Hub
                      </label>
                    )}
                  </div>

                  <input
                    className="field-input"
                    placeholder="Name of the new location"
                    value={linkName}
                    onChange={(e) => setLinkName(e.target.value)}
                  />

                  <div style={{ display: "flex", gap: 6 }}>
                    <select
                      className="field-input"
                      style={{ flex: 1 }}
                      value={linkDirection}
                      onChange={(e) =>
                        setLinkDirection(e.target.value as CompassDirection)
                      }
                      title="Compass direction relative to current room"
                    >
                      {COMPASS_ORDER.map((d) => {
                        const isOcc = occupiedDirections.has(d);
                        return (
                          <option key={d} value={d}>
                            {d} {isOcc ? "(exit taken)" : "(free)"}
                          </option>
                        );
                      })}
                    </select>

                    <input
                      className="field-input"
                      type="number"
                      min={1}
                      max={240}
                      style={{ width: 85 }}
                      value={linkMinutes}
                      onChange={(e) => setLinkMinutes(e.target.value)}
                      title="Travel minutes"
                    />
                    <span
                      style={{
                        fontSize: "0.7rem",
                        color: "var(--text-muted)",
                        alignSelf: "center",
                      }}
                    >
                      min
                    </span>
                  </div>

                  <textarea
                    className="field-textarea"
                    rows={3}
                    placeholder="Sensory description of the new room..."
                    value={linkDescription}
                    onChange={(e) => setLinkDescription(e.target.value)}
                  />

                  <input
                    className="field-input"
                    placeholder="Environmental tags (comma separated)"
                    value={linkTags}
                    onChange={(e) => setLinkTags(e.target.value)}
                  />

                  {linkError && (
                    <div style={{ fontSize: "0.72rem", color: "#fda4af" }}>
                      {linkError}
                    </div>
                  )}

                  <div
                    style={{
                      display: "flex",
                      gap: 6,
                      justifyContent: "flex-end",
                      marginTop: 2,
                    }}
                  >
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: "3px 10px", fontSize: "0.74rem" }}
                      onClick={() => setShowLinkForm(false)}
                      disabled={isCreatingLink}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn-amber"
                      style={{ padding: "3px 10px", fontSize: "0.74rem" }}
                      onClick={submitLinkForm}
                      disabled={
                        isCreatingLink ||
                        !linkName.trim() ||
                        !linkDescription.trim()
                      }
                    >
                      {isCreatingLink ? "Creating..." : "Create Link"}
                    </button>
                  </div>
                </div>
              ) : (
                /* Connect to Existing Room Form (Editor mode) */
                <div
                  style={{
                    border: "1px solid rgba(168, 85, 247, 0.45)",
                    borderRadius: 6,
                    padding: 10,
                    display: "flex",
                    flexDirection: "column",
                    gap: 7,
                    background: "var(--bg-panel)",
                  }}
                >
                  <div className="cog-step-label">
                    Connect {selectedLocation.name} to Existing Room
                  </div>

                  <select
                    className="field-select"
                    value={connectTargetId}
                    onChange={(e) => setConnectTargetId(e.target.value)}
                  >
                    {locations
                      .filter((l) => l.id !== selectedLocation.id)
                      .map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name} {l.is_hub ? "(Hub)" : ""}
                        </option>
                      ))}
                  </select>

                  <div style={{ display: "flex", gap: 6 }}>
                    <select
                      className="field-input"
                      style={{ flex: 1 }}
                      value={connectDirection}
                      onChange={(e) =>
                        setConnectDirection(e.target.value as CompassDirection)
                      }
                    >
                      {COMPASS_ORDER.map((d) => (
                        <option key={d} value={d}>
                          {d} {occupiedDirections.has(d) ? "(exit taken)" : ""}
                        </option>
                      ))}
                    </select>

                    <input
                      className="field-input"
                      type="number"
                      min={1}
                      max={240}
                      style={{ width: 85 }}
                      value={connectMinutes}
                      onChange={(e) => setConnectMinutes(e.target.value)}
                    />
                    <span
                      style={{
                        fontSize: "0.7rem",
                        color: "var(--text-muted)",
                        alignSelf: "center",
                      }}
                    >
                      min
                    </span>
                  </div>

                  <label
                    style={{
                      fontSize: "0.72rem",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      color: "var(--text-secondary)",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={connectBidirectional}
                      onChange={(e) =>
                        setConnectBidirectional(e.target.checked)
                      }
                    />
                    Create reciprocal return exit automatically
                  </label>

                  <div
                    style={{
                      display: "flex",
                      gap: 6,
                      justifyContent: "flex-end",
                    }}
                  >
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: "3px 10px", fontSize: "0.74rem" }}
                      onClick={() => setShowConnectForm(false)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn-cyan"
                      style={{ padding: "3px 10px", fontSize: "0.74rem" }}
                      onClick={submitConnectForm}
                      disabled={!connectTargetId}
                    >
                      Add Connection
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Connected Exits Section */}
          <div>
            <div
              className="cog-step-label"
              style={{
                marginBottom: 6,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>Connected Exits ({selectedLocExits.length}/8)</span>
            </div>

            {selectedLocExits.length === 0 ? (
              <div
                style={{
                  fontSize: "0.72rem",
                  color: "var(--text-muted)",
                  fontStyle: "italic",
                }}
              >
                No exits leading out of this location.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {selectedLocExits.map(({ edge, dest }) => (
                  <div
                    key={edge.id}
                    className="exit-pill"
                    style={{ cursor: "pointer", position: "relative" }}
                    onClick={() => setSelectedLocId(dest.id)}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        fontSize: "0.76rem",
                        fontWeight: 600,
                        color: "#22d3ee",
                      }}
                    >
                      <span>
                        [{edge.compass_direction || "N"}] → {dest.name}
                        {dest.is_hub && (
                          <span
                            style={{
                              marginLeft: 5,
                              color: "#c084fc",
                              fontSize: "0.65rem",
                            }}
                          >
                            (Hub)
                          </span>
                        )}
                      </span>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <span
                          style={{
                            color: "var(--text-muted)",
                            fontSize: "0.7rem",
                          }}
                        >
                          {edge.travel_minutes}m
                        </span>
                        {mode === "editor" && onDeleteEdge && (
                          <button
                            type="button"
                            className="item-remove-btn"
                            style={{ padding: 2 }}
                            title="Remove this exit connection"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteEdge(edge.id);
                            }}
                          >
                            <Trash2 size={11} />
                          </button>
                        )}
                      </div>
                    </div>
                    <div
                      style={{
                        fontSize: "0.7rem",
                        color: "var(--text-secondary)",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <span>Via: {edge.direction_label}</span>
                      {edge.is_locked_or_hidden && (
                        <span
                          style={{
                            color: "var(--accent-rose)",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 3,
                          }}
                        >
                          <Lock size={10} /> Hidden/Locked
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
