import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Compass,
  Cpu,
  Crosshair,
  Flag,
  Link2,
  Lock,
  MapPin,
  Maximize2,
  Navigation,
  ScrollText,
  Sparkles,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  CampaignStateBundle,
  CharacterRecord,
  CharacterStateSnapshot,
  CompassDirection,
  LocationEdge,
  LocationNode,
  NeighborLocationView,
  RecalledMemoryItem,
  WorldRecord,
} from "../types";
import { InspectorSection, usePersistentState } from "./inspector/InspectorPrimitives";
import { CharacterRow } from "./inspector/CharacterRow";
import { LoreIndexModal } from "./inspector/LoreIndexModal";

const RECALL_SOURCE_LABEL: Record<RecalledMemoryItem["source_type"], string> = {
  lore: "Lore",
  character_shard: "Shard",
  episodic_chunk: "Episode",
};

/** Scene flags shown before the "Show all" toggle in Internals. */
const FLAG_PREVIEW_LIMIT = 12;

/** True when the affective state moved noticeably between two snapshots. */
function moodShifted(
  prev: CharacterStateSnapshot | undefined,
  curr: CharacterStateSnapshot
): boolean {
  if (!prev) return false;
  return (
    prev.mood_label !== curr.mood_label ||
    Math.abs(prev.valence - curr.valence) >= 0.1 ||
    Math.abs(prev.arousal - curr.arousal) >= 0.1
  );
}

const COMPASS_ORDER: CompassDirection[] = [
  "N",
  "NE",
  "E",
  "SE",
  "S",
  "SW",
  "W",
  "NW",
];

const COMPASS_ANGLES: Record<CompassDirection, number> = {
  N: -Math.PI / 2,
  NE: -Math.PI / 4,
  E: 0,
  SE: Math.PI / 4,
  S: Math.PI / 2,
  SW: (3 * Math.PI) / 4,
  W: Math.PI,
  NW: (-3 * Math.PI) / 4,
};

function pickCompassSlot(
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

function computeFullMapCoords(
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
    const angle = (idx / Math.max(1, unvisited.length)) * Math.PI * 2 - Math.PI / 2;
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

interface LiveInspectorProps {
  bundle: CampaignStateBundle;
  world: WorldRecord;
  character: CharacterRecord;
  /** All campaign participant records (primary character included). */
  participants?: CharacterRecord[];
  /** Memory settings used for the Story empty-state hint. */
  memoryConfig?: { working_memory_turns: number; episodic_chunk_size: number };
  pendingLocationOverrideId?: string | null;
  onOverrideLocation?: (locationId: string) => Promise<void> | void;
  onCreateLinkedLocation?: (payload: {
    from_location_id: string;
    name: string;
    compass_direction: string;
    travel_minutes: number;
    description: string;
    environmental_tags: string[];
  }) => Promise<string | void>;
}

export const LiveInspector: React.FC<LiveInspectorProps> = ({
  bundle,
  world,
  character,
  participants,
  memoryConfig,
  pendingLocationOverrideId,
  onOverrideLocation,
  onCreateLinkedLocation,
}) => {
  const activeLoc = bundle.active_location;
  const [selectedLocId, setSelectedLocId] = useState<string>(activeLoc.id);
  const [showFullMap, setShowFullMap] = useState(false);
  const [isOverriding, setIsOverriding] = useState(false);
  const [showExits, setShowExits] = usePersistentState<boolean>("map.exits", false);
  const [showLoreIndex, setShowLoreIndex] = useState(false);
  const [expandedRecalls, setExpandedRecalls] = useState<Set<string>>(new Set());
  const [showAllFlags, setShowAllFlags] = useState(false);

  // Latest vs previous turn on the active branch, used for "changed this turn" indicators
  const turns = bundle.active_branch_turns;
  const lastTurn = turns[turns.length - 1];
  const prevTurn = turns.length > 1 ? turns[turns.length - 2] : undefined;
  const sceneFlags = bundle.current_world_snapshot.scene_flags;
  const recalledItems = lastTurn?.recalled_items ?? [];

  const flagsChanged = useMemo(() => {
    if (!prevTurn) return false;
    const prev = new Set(prevTurn.world_snapshot.scene_flags);
    return (
      prev.size !== sceneFlags.length || sceneFlags.some((f) => !prev.has(f))
    );
  }, [prevTurn, sceneFlags]);

  const storyChanged = useMemo(
    () =>
      Boolean(lastTurn) &&
      bundle.episodic_chunks.some((c) => c.leaf_turn_id === lastTurn.id),
    [bundle.episodic_chunks, lastTurn]
  );

  // Participant roster: primary character first, then present, then elsewhere
  const characterRows = useMemo(() => {
    const byId = new Map<string, CharacterRecord>();
    for (const c of participants ?? []) byId.set(c.id, c);
    byId.set(character.id, character);

    const ids = bundle.campaign.participant_character_ids?.length
      ? bundle.campaign.participant_character_ids
      : [bundle.campaign.character_id];
    const orderedIds = [character.id, ...ids.filter((id) => id !== character.id)];
    const presentIds = new Set(bundle.present_character_ids ?? []);
    const locNames = new Map(bundle.visible_locations.map((l) => [l.id, l.name]));

    const rows = orderedIds.flatMap((id) => {
      const record = byId.get(id);
      const state =
        bundle.character_states?.[id] ??
        (id === character.id ? bundle.current_character_state : undefined);
      if (!record || !state) return [];
      const prevState =
        prevTurn?.character_states?.[id] ??
        (id === character.id ? prevTurn?.character_state : undefined);
      // Older single-character bundles may omit present_character_ids entirely
      const isPresent =
        presentIds.size === 0
          ? state.current_location_id === activeLoc.id || id === character.id
          : presentIds.has(id);
      return [
        {
          record,
          state,
          isPresent,
          elsewhereLocationName: locNames.get(state.current_location_id),
          moodChanged: moodShifted(prevState, state),
        },
      ];
    });
    // Stable partition keeps the primary character on top among present ones
    return [...rows.filter((r) => r.isPresent), ...rows.filter((r) => !r.isPresent)];
  }, [participants, character, bundle, prevTurn, activeLoc.id]);

  const indexedCharacters = useMemo(
    () => characterRows.map((r) => r.record),
    [characterRows]
  );
  const indexedCount =
    world.lore_nodes.length +
    indexedCharacters.reduce((n, c) => n + c.memory_shards.length, 0);

  const toggleRecall = (key: string) =>
    setExpandedRecalls((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Manual "Create Link" form state
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkName, setLinkName] = useState("");
  const [linkDirection, setLinkDirection] = useState<CompassDirection>("N");
  const [linkMinutes, setLinkMinutes] = useState("2");
  const [linkDescription, setLinkDescription] = useState("");
  const [linkTags, setLinkTags] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [isCreatingLink, setIsCreatingLink] = useState(false);

  const openLinkForm = () => {
    setLinkName("");
    setLinkDirection("N");
    setLinkMinutes("2");
    setLinkDescription("");
    setLinkTags("");
    setLinkError(null);
    setShowLinkForm(true);
  };

  const submitLinkForm = async () => {
    if (!onCreateLinkedLocation || isCreatingLink) return;
    setIsCreatingLink(true);
    setLinkError(null);
    try {
      const minutes = Math.max(1, Math.min(240, parseInt(linkMinutes, 10) || 1));
      const newId = await onCreateLinkedLocation({
        from_location_id: selectedLocId,
        name: linkName.trim(),
        compass_direction: linkDirection,
        travel_minutes: minutes,
        description: linkDescription.trim(),
        environmental_tags: linkTags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      });
      setShowLinkForm(false);
      if (newId) setSelectedLocId(newId);
    } catch (err) {
      setLinkError(String(err));
    } finally {
      setIsCreatingLink(false);
    }
  };

  // Pan and zoom state for the Full Map modal
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragRef = useRef<{
    dragging: boolean;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  }>({ dragging: false, startX: 0, startY: 0, origX: 0, origY: 0 });

  useEffect(() => {
    setSelectedLocId(activeLoc.id);
  }, [activeLoc.id, bundle.campaign.id]);

  useEffect(() => {
    setShowLinkForm(false);
  }, [selectedLocId]);

  // 1. Deduplicate immediate 1-hop neighbors (capped at 8 compass slots) for the centered mini-map
  const immediateNeighbors = useMemo(() => {
    const seen = new Set<string>();
    const list: Array<NeighborLocationView & { slot: CompassDirection }> = [];
    const occupied = new Set<CompassDirection>();
    for (const nb of bundle.neighbor_locations) {
      if (nb.destination.id === activeLoc.id || seen.has(nb.destination.id)) {
        continue;
      }
      seen.add(nb.destination.id);
      const slot = pickCompassSlot(nb.compass_direction, occupied);
      occupied.add(slot);
      list.push({ ...nb, slot });
      if (list.length >= 8) break;
    }
    return list;
  }, [bundle.neighbor_locations, activeLoc.id]);

  // Mini-map coordinates: activeLoc always centered at (165, 95); only immediate 1-hop neighbors displayed
  const miniMapCenter = { x: 165, y: 95 };
  const miniMapCoords = useMemo(() => {
    const map: Record<string, { x: number; y: number; slot?: CompassDirection }> = {
      [activeLoc.id]: { x: miniMapCenter.x, y: miniMapCenter.y },
    };
    for (const nb of immediateNeighbors) {
      const angle = COMPASS_ANGLES[nb.slot];
      map[nb.destination.id] = {
        x: Math.round(miniMapCenter.x + Math.cos(angle) * 102),
        y: Math.round(miniMapCenter.y + Math.sin(angle) * 66),
        slot: nb.slot,
      };
    }
    return map;
  }, [activeLoc.id, immediateNeighbors]);

  const activeEdges = bundle.visible_edges ?? world.edges;
  const fullMapCoords = useMemo(
    () =>
      computeFullMapCoords(
        bundle.visible_locations,
        activeEdges,
        activeLoc.id
      ),
    [bundle.visible_locations, activeEdges, activeLoc.id]
  );

  const neighborDestIds = useMemo(
    () => new Set(immediateNeighbors.map((n) => n.destination.id)),
    [immediateNeighbors]
  );

  const selectedLocation = useMemo(
    () =>
      bundle.visible_locations.find((l) => l.id === selectedLocId) ?? activeLoc,
    [bundle.visible_locations, selectedLocId, activeLoc]
  );

  const selectedNeighbor = useMemo(
    () => immediateNeighbors.find((n) => n.destination.id === selectedLocation.id),
    [immediateNeighbors, selectedLocation.id]
  );

  const selectedLocExits = useMemo(() => {
    const locMap = new Map(bundle.visible_locations.map((l) => [l.id, l]));
    return activeEdges
      .filter((e) => e.from_location_id === selectedLocation.id)
      .map((e) => ({
        edge: e,
        dest: locMap.get(e.to_location_id),
      }))
      .filter(
        (item): item is { edge: LocationEdge; dest: LocationNode } =>
          Boolean(item.dest)
      );
  }, [activeEdges, bundle.visible_locations, selectedLocation.id]);

  const handleOverrideClick = async (targetLocId: string) => {
    if (!onOverrideLocation || isOverriding || targetLocId === activeLoc.id) {
      return;
    }
    setIsOverriding(true);
    try {
      await onOverrideLocation(targetLocId);
    } finally {
      setIsOverriding(false);
    }
  };

  const handleOpenFullMap = () => {
    setShowLinkForm(false);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setSelectedLocId(activeLoc.id);
    setShowFullMap(true);
  };

  const handleCenterFullMap = () => {
    const pt = fullMapCoords[activeLoc.id] ?? { x: 0, y: 0 };
    setPan({ x: -pt.x, y: -pt.y });
    setZoom(1);
  };

  return (
    <aside className="inspector">
      {/* 1. World Clock */}
      <div className="inspector-card">
        <div className="sidebar-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Clock size={13} color="var(--accent-amber)" />
          World Clock
        </div>
        <div className="clock-display">
          <span>{bundle.current_world_snapshot.world_timestamp}</span>
          <span style={{ fontSize: "0.72rem", color: "var(--text-secondary)" }}>
            Turn #{lastTurn?.depth_index ?? 0}
          </span>
        </div>
      </div>

      {/* 2. Spatial Engine Topology Map (Centered 1-Hop Mini-Map) */}
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
            return (
              <g key={nb.edge_id}>
                <line
                  x1={miniMapCenter.x}
                  y1={miniMapCenter.y}
                  x2={p2.x}
                  y2={p2.y}
                  stroke="#06b6d4"
                  strokeWidth={2}
                  strokeDasharray={nb.is_locked_or_hidden ? "4 3" : undefined}
                />
                <text
                  x={midX}
                  y={midY - 3}
                  textAnchor="middle"
                  fill="#67e8f9"
                  fontSize="7.5"
                  fontWeight="700"
                >
                  {nb.slot}
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
              const fill = isCurrent
                ? "#f59e0b"
                : loc.is_hub
                ? "#a855f7"
                : "#06b6d4";
              const shortName =
                loc.name.length > 18 ? loc.name.slice(0, 17) + "…" : loc.name;

              return (
                <g
                  key={loc.id}
                  style={{ cursor: "pointer" }}
                  onClick={() => setSelectedLocId(loc.id)}
                >
                  {isSelected && (
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={isCurrent ? 13 : 10}
                      fill="none"
                      stroke={isCurrent ? "#fbbf24" : "#38bdf8"}
                      strokeWidth={1.5}
                      strokeDasharray="2 2"
                    />
                  )}
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r={isCurrent ? 9 : 6.5}
                    fill={fill}
                    stroke="#0b0e14"
                    strokeWidth={2}
                  />
                  <text
                    x={pt.x}
                    y={pt.y + (isCurrent ? 19 : 15)}
                    textAnchor="middle"
                    fill={isCurrent ? "#fbbf24" : "#cbd5e1"}
                    fontSize="9.5"
                    fontWeight={isCurrent || isSelected ? "700" : "500"}
                  >
                    {shortName}
                  </text>
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
              }}
            >
              <MapPin size={13} />
              {selectedLocation.name}
              {selectedLocation.is_hub && (
                <span className="badge" style={{ fontSize: "0.62rem", padding: "1px 5px" }}>
                  HUB
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

      {/* Full Zoomable Map Modal */}
      {showFullMap && (
        <div
          className="modal-backdrop"
          onClick={() => setShowFullMap(false)}
          style={{ zIndex: 70 }}
        >
          <div
            className="modal-panel"
            style={{
              width: "min(1040px, 95vw)",
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Compass size={17} color="var(--accent-cyan)" />
                {world.name} — Full Spatial Topology ({bundle.visible_locations.length} Locations)
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
                  onClick={handleCenterFullMap}
                  title="Center on Current Location"
                >
                  <Crosshair size={14} />
                  Center ({Math.round(zoom * 100)}%)
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{ padding: "4px 8px" }}
                  onClick={() => setShowFullMap(false)}
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            <div
              className="modal-body"
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 320px",
                gap: 14,
                minHeight: 500,
                overflow: "hidden",
              }}
            >
              {/* Interactive Pan/Zoom SVG Canvas */}
              <div
                style={{
                  position: "relative",
                  background: "var(--bg-deep)",
                  borderRadius: 8,
                  border: "1px solid var(--border-subtle)",
                  overflow: "hidden",
                  userSelect: "none",
                }}
              >
                <svg
                  width="100%"
                  height="520"
                  viewBox="-340 -260 680 520"
                  style={{
                    cursor: dragRef.current.dragging ? "grabbing" : "grab",
                    display: "block",
                  }}
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
                  <g
                    transform={`scale(${zoom}) translate(${pan.x}, ${pan.y})`}
                  >
                    {/* All Visible Connections */}
                    {activeEdges.map((edge) => {
                      const p1 = fullMapCoords[edge.from_location_id];
                      const p2 = fullMapCoords[edge.to_location_id];
                      if (!p1 || !p2) return null;
                      const isDirect =
                        edge.from_location_id === activeLoc.id ||
                        edge.to_location_id === activeLoc.id;
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
                    {bundle.visible_locations.map((loc) => {
                      const pt = fullMapCoords[loc.id];
                      if (!pt) return null;
                      const isCurrent = loc.id === activeLoc.id;
                      const isNeighbor = neighborDestIds.has(loc.id);
                      const isSelected = loc.id === selectedLocation.id;
                      const fill = isCurrent
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
                              r={isCurrent ? 16 : 13}
                              fill="none"
                              stroke={isCurrent ? "#fbbf24" : "#38bdf8"}
                              strokeWidth={2}
                              strokeDasharray="3 3"
                            />
                          )}
                          <circle
                            cx={pt.x}
                            cy={pt.y}
                            r={isCurrent ? 11 : loc.is_hub ? 9 : 8}
                            fill={fill}
                            stroke="#0b0e14"
                            strokeWidth={2.2}
                          />
                          <text
                            x={pt.x}
                            y={pt.y + (isCurrent ? 23 : 19)}
                            textAnchor="middle"
                            fill={
                              isCurrent
                                ? "#fbbf24"
                                : isSelected
                                ? "#f8fafc"
                                : "#cbd5e1"
                            }
                            fontSize="10.5"
                            fontWeight={isCurrent || isSelected ? "700" : "500"}
                          >
                            {loc.name}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                </svg>

                {/* Legend overlay */}
                <div
                  style={{
                    position: "absolute",
                    left: 10,
                    bottom: 10,
                    background: "rgba(11, 14, 20, 0.85)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: 6,
                    padding: "5px 9px",
                    fontSize: "0.7rem",
                    color: "var(--text-secondary)",
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                  }}
                >
                  <span>
                    <strong style={{ color: "#f59e0b" }}>●</strong> Current
                  </span>
                  <span>
                    <strong style={{ color: "#06b6d4" }}>●</strong> 1-Hop Adjacent
                  </span>
                  <span>
                    <strong style={{ color: "#a855f7" }}>●</strong> Passage Hub
                  </span>
                  <span>
                    <strong style={{ color: "#64748b" }}>●</strong> 2+ Hops
                  </span>
                  <span style={{ color: "var(--text-muted)" }}>
                    (Drag to pan • Scroll to zoom • Click node to inspect/override)
                  </span>
                </div>
              </div>

              {/* Right Side Panel: Selected Location Inspector & Override Control */}
              <div
                style={{
                  background: "var(--bg-card)",
                  borderRadius: 8,
                  border: "1px solid var(--border-subtle)",
                  padding: 14,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  overflowY: "auto",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: "0.7rem",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      color: "var(--text-muted)",
                      marginBottom: 4,
                    }}
                  >
                    Selected Location
                  </div>
                  <div
                    style={{
                      fontSize: "0.95rem",
                      fontWeight: 700,
                      color:
                        selectedLocation.id === activeLoc.id
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
                      <span className="badge" style={{ fontSize: "0.65rem" }}>
                        PASSAGE HUB
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: "0.76rem",
                      color: "var(--accent-cyan)",
                      marginTop: 4,
                    }}
                  >
                    {selectedLocation.summary}
                  </div>
                </div>

                {selectedLocation.id === activeLoc.id ? (
                  <div
                    style={{
                      background: "rgba(245, 158, 11, 0.12)",
                      border: "1px solid rgba(245, 158, 11, 0.35)",
                      borderRadius: 6,
                      padding: "7px 10px",
                      fontSize: "0.76rem",
                      color: "var(--accent-amber)",
                      fontWeight: 600,
                    }}
                  >
                    Active Scene Location (Centered in Mini-Map)
                  </div>
                ) : (
                  onOverrideLocation && (
                    <button
                      type="button"
                      className="btn btn-amber"
                      style={{
                        width: "100%",
                        justifyContent: "center",
                        padding: "8px 12px",
                        fontSize: "0.8rem",
                      }}
                      disabled={isOverriding}
                      onClick={() => handleOverrideClick(selectedLocation.id)}
                    >
                      <Navigation size={14} />
                      {isOverriding
                        ? "Overriding Location..."
                        : "Override Current Location Here"}
                    </button>
                  )
                )}

                {onCreateLinkedLocation && (
                  <div>
                    {!showLinkForm ? (
                      <button
                        type="button"
                        className="btn"
                        style={{
                          width: "100%",
                          justifyContent: "center",
                          padding: "7px 12px",
                          fontSize: "0.78rem",
                        }}
                        onClick={openLinkForm}
                      >
                        <Link2 size={14} />
                        Create Link from {selectedLocation.name}
                      </button>
                    ) : (
                      <div
                        style={{
                          border: "1px solid rgba(6, 182, 212, 0.45)",
                          borderRadius: 6,
                          padding: 10,
                          display: "flex",
                          flexDirection: "column",
                          gap: 7,
                        }}
                      >
                        <div className="cog-step-label">
                          New room linked to {selectedLocation.name}
                        </div>
                        <input
                          className="field-input"
                          placeholder="Name of the new room"
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
                            title="Direction relative to the selected location"
                          >
                            {COMPASS_ORDER.map((d) => (
                              <option key={d} value={d}>
                                {d}
                              </option>
                            ))}
                          </select>
                          <input
                            className="field-input"
                            type="number"
                            min={1}
                            max={240}
                            style={{ width: 90 }}
                            value={linkMinutes}
                            onChange={(e) => setLinkMinutes(e.target.value)}
                            title="Distance in minutes of travel"
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
                          rows={4}
                          placeholder="Sensory description"
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
                    )}
                  </div>
                )}

                <div className="cog-step">
                  <div className="cog-step-label">Sensory Description</div>
                  <div style={{ fontSize: "0.76rem", lineHeight: 1.45 }}>
                    {selectedLocation.description}
                  </div>
                </div>

                {selectedLocation.environmental_tags.length > 0 && (
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
                )}

                <div>
                  <div
                    className="cog-step-label"
                    style={{ marginBottom: 6 }}
                  >
                    Connected Exits ({selectedLocExits.length}/8)
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    {selectedLocExits.map(({ edge, dest }) => (
                      <div
                        key={edge.id}
                        className="exit-pill"
                        style={{ cursor: "pointer" }}
                        onClick={() => setSelectedLocId(dest.id)}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            fontSize: "0.76rem",
                            fontWeight: 600,
                            color: "#22d3ee",
                          }}
                        >
                          <span>
                            [{edge.compass_direction || "N"}] → {dest.name}
                          </span>
                          <span style={{ color: "var(--text-muted)", fontSize: "0.7rem" }}>
                            {edge.travel_minutes}m
                          </span>
                        </div>
                        <div style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>
                          Via: {edge.direction_label}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. Characters (collapsed "Name · Mood" rows, expandable to full affective & goal state) */}
      {characterRows.length > 0 && (
        <div className="inspector-card inspector-collapsible">
          {characterRows.map((row) => (
            <CharacterRow
              key={row.record.id}
              character={row.record}
              state={row.state}
              isPresent={row.isPresent}
              elsewhereLocationName={row.elsewhereLocationName}
              moodChanged={row.moodChanged}
            />
          ))}
        </div>
      )}

      {/* 4. Story (Zone 2 Episodic Summaries) */}
      <InspectorSection
        storageKey="story"
        title="Story"
        icon={<ScrollText size={13} color="var(--accent-amber)" />}
        meta={bundle.episodic_chunks.length || undefined}
        changed={storyChanged}
        changedTitle="New summary this turn"
      >
        {bundle.episodic_chunks.length === 0 ? (
          <div className="inspector-empty">
            No summaries yet.
            {memoryConfig &&
              ` Once the story exceeds ${memoryConfig.working_memory_turns} turns, the oldest ${memoryConfig.episodic_chunk_size} are condensed into a summary here.`}
          </div>
        ) : (
          bundle.episodic_chunks.map((chunk) => (
            <div key={chunk.id} className="story-chunk">
              <div className="story-chunk-range">
                Turns {chunk.start_turn_depth}–{chunk.end_turn_depth}
              </div>
              {chunk.summary_text}
            </div>
          ))
        )}
      </InspectorSection>

      {/* 5. Internals (Scene Flags, Recalled Memories, Static RAG Index) */}
      <InspectorSection
        storageKey="internals"
        title="Internals"
        icon={<Cpu size={13} color="var(--accent-emerald)" />}
        meta={`${sceneFlags.length} flags · ${recalledItems.length} recalled`}
        changed={flagsChanged}
        changedTitle="Scene flags changed this turn"
      >
        <div className="internals-stats">
          {turns.length} branch turns · {bundle.episodic_chunks.length} episodic chunks ·{" "}
          {indexedCount} indexed shards
        </div>

        <div className="internals-group">
          <div className="internals-group-label">
            <Flag size={11} /> Scene Flags ({sceneFlags.length})
          </div>
          {sceneFlags.length > 0 ? (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {(showAllFlags ? sceneFlags : sceneFlags.slice(0, FLAG_PREVIEW_LIMIT)).map(
                  (flag, i) => (
                    <span key={i} className="badge" style={{ fontSize: "0.68rem", padding: "2px 6px" }}>
                      {flag}
                    </span>
                  )
                )}
              </div>
              {sceneFlags.length > FLAG_PREVIEW_LIMIT && (
                <button
                  type="button"
                  className="exits-toggle"
                  aria-expanded={showAllFlags}
                  onClick={() => setShowAllFlags((v) => !v)}
                >
                  {showAllFlags ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
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
            <Sparkles size={11} /> Recalled Last Turn ({recalledItems.length})
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
            <div className="inspector-empty">Nothing was recalled on the last turn.</div>
          )}
        </div>

        <button
          type="button"
          className="btn"
          style={{ padding: "5px 10px", fontSize: "0.72rem", alignSelf: "flex-start" }}
          onClick={() => setShowLoreIndex(true)}
        >
          <BookOpen size={12} />
          Browse Shards &amp; Lore Index ({indexedCount})
        </button>
      </InspectorSection>

      {showLoreIndex && (
        <LoreIndexModal
          world={world}
          characters={indexedCharacters}
          recalledItems={recalledItems}
          onClose={() => setShowLoreIndex(false)}
        />
      )}
    </aside>
  );
};
