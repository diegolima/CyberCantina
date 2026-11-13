import React, { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Compass,
  Cpu,
  DoorOpen,
  Flag,
  GitBranch,
  Lock,
  Maximize2,
  Navigation,
  ScrollText,
  Search,
  Sparkles,
} from "lucide-react";
import {
  CampaignStateBundle,
  CharacterRecord,
  CharacterStateSnapshot,
  CompassDirection,
  ItemEquipActionPayload,
  LocationContainer,
  LocationEdge,
  LocationLoreNodeDraft,
  LocationNode,
  MemoryShard,
  NeighborLocationView,
  RecalledMemoryItem,
  WorldRecord,
} from "../types";
import { InspectorSection, usePersistentState } from "./inspector/InspectorPrimitives";
import { CharacterRow } from "./inspector/CharacterRow";
import { CampaignCharacterModal } from "./inspector/CampaignCharacterModal";
import { LoreIndexModal } from "./inspector/LoreIndexModal";
import {
  COMPASS_ANGLES,
  buildContainerBreadcrumbChain,
  computeDynamicPortalIds,
  pickCompassSlot,
  SpatialTopologyView,
} from "./SpatialTopologyView";
import { resolveMapIconComponent } from "./map/mapIcons";

const RECALL_SOURCE_LABEL: Record<RecalledMemoryItem["source_type"], string> = {
  lore: "Lore",
  location_lore: "Loc Lore",
  container_lore: "Cont Lore",
  character_shard: "Shard",
  episodic_chunk: "Episode",
  item_lore: "Item",
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
  onSaveCampaignMap?: (payload: {
    containers: LocationContainer[];
    locations: LocationNode[];
    edges: LocationEdge[];
  }) => Promise<void> | void;
  onToggleItemEquip?: (payload: ItemEquipActionPayload) => Promise<void> | void;
  onUpdateCampaignMemories?: (
    characterId: string,
    memoryShards: MemoryShard[]
  ) => Promise<void>;
  onSaveCampaignLocationLore?: (
    locationId: string,
    loreNodes: LocationLoreNodeDraft[]
  ) => Promise<void> | void;
  onSaveCampaignContainerLore?: (
    containerId: string,
    loreNodes: LocationLoreNodeDraft[]
  ) => Promise<void> | void;
  onCheckoutTurn?: (turnId: string) => Promise<void> | void;
  isMutatingLocked?: boolean;
  worlds?: WorldRecord[];
}

export const LiveInspector: React.FC<LiveInspectorProps> = ({
  bundle,
  world,
  character,
  participants,
  memoryConfig,
  pendingLocationOverrideId,
  onOverrideLocation,
  onSaveCampaignMap,
  onToggleItemEquip,
  onUpdateCampaignMemories,
  onSaveCampaignLocationLore,
  onSaveCampaignContainerLore,
  onCheckoutTurn,
  isMutatingLocked = false,
  worlds = [],
}) => {
  const activeLoc = bundle.active_location;
  const [selectedLocId, setSelectedLocId] = useState<string>(activeLoc.id);
  const [showFullMap, setShowFullMap] = useState(false);
  const [isOverriding, setIsOverriding] = useState(false);
  const [showExits, setShowExits] = usePersistentState<boolean>("map.exits", false);
  const [showLoreIndex, setShowLoreIndex] = useState(false);
  const [expandedRecalls, setExpandedRecalls] = useState<Set<string>>(new Set());
  const [showAllFlags, setShowAllFlags] = useState(false);
  const [sheetCharacterId, setSheetCharacterId] = useState<string | null>(null);
  const [sheetInitialTab, setSheetInitialTab] = useState<"current" | "inventory">("current");
  const [sheetInitialItemId, setSheetInitialItemId] = useState<string | null>(null);

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

  const [turnFilter, setTurnFilter] = useState("");
  const activeBranchSet = useMemo(
    () => new Set(bundle.active_branch_turns.map((t) => t.id)),
    [bundle.active_branch_turns]
  );

  const filteredTurnNodes = useMemo(() => {
    const q = turnFilter.trim().toLowerCase();
    if (!q) return bundle.all_turn_nodes;
    return bundle.all_turn_nodes.filter(
      (node) =>
        `turn #${node.depth_index}`.toLowerCase().includes(q) ||
        node.user_message.toLowerCase().includes(q) ||
        node.raw_prose.toLowerCase().includes(q) ||
        node.world_snapshot.world_timestamp.toLowerCase().includes(q)
    );
  }, [bundle.all_turn_nodes, turnFilter]);

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
      const record = bundle.character_records?.[id] ?? byId.get(id);
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

  const characterNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const r of characterRows) {
      map[r.record.id] = r.record.name;
    }
    return map;
  }, [characterRows]);

  const sheetRow = useMemo(
    () => characterRows.find((r) => r.record.id === sheetCharacterId),
    [characterRows, sheetCharacterId]
  );

  const indexedCharacters = useMemo(
    () => characterRows.map((r) => r.record),
    [characterRows]
  );
  const presentCharacterLocations = useMemo(() => {
    const map: Record<string, string> = {};
    for (const row of characterRows) {
      map[row.record.id] = row.state.current_location_id || activeLoc.id;
    }
    return map;
  }, [characterRows, activeLoc.id]);

  const effectiveContainers = useMemo(
    () => bundle.containers ?? world.containers ?? [],
    [bundle.containers, world.containers]
  );

  const containerMap = useMemo(
    () => new Map(effectiveContainers.map((c) => [c.id, c])),
    [effectiveContainers]
  );

  const activeBreadcrumbChain = useMemo(
    () => buildContainerBreadcrumbChain(activeLoc.container_id, effectiveContainers),
    [activeLoc.container_id, effectiveContainers]
  );

  const indexedCount =
    world.lore_nodes.length +
    (bundle.visible_locations ?? []).reduce(
      (n, loc) =>
        n + (loc.lore_nodes ?? []).filter((l) => l.category !== "secret").length,
      0
    ) +
    effectiveContainers.reduce(
      (n, cont) =>
        n +
        (cont.depth === 1
          ? (cont.lore_nodes ?? []).filter((l) => l.category !== "secret").length
          : 0),
      0
    ) +
    indexedCharacters.reduce((n, c) => n + c.memory_shards.length, 0);

  const toggleRecall = (key: string) =>
    setExpandedRecalls((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  useEffect(() => {
    setSelectedLocId(activeLoc.id);
  }, [activeLoc.id, bundle.campaign.id]);

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

  const miniDynamicPortalIds = useMemo(
    () => computeDynamicPortalIds(bundle.visible_locations, activeEdges),
    [bundle.visible_locations, activeEdges]
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
    setSelectedLocId(activeLoc.id);
    setShowFullMap(true);
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
              width: "min(1100px, 95vw)",
              height: "min(900px, 92vh)",
              maxHeight: "92vh",
              display: "flex",
              flexDirection: "column",
              padding: "16px",
              boxSizing: "border-box",
              overflow: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <SpatialTopologyView
              title={`${world.name} — Full Spatial Topology (${bundle.visible_locations.length} Locations)`}
              containers={effectiveContainers}
              locations={bundle.visible_locations}
              edges={activeEdges}
              activeLocationId={activeLoc.id}
              defaultSelectedLocationId={selectedLocId}
              presentCharacterLocations={presentCharacterLocations}
              mode="campaign"
              worldContext={{
                worldId: world.id,
                worldName: world.name,
                genre: world.global_rules.genre,
                tone: world.global_rules.tone,
                settingOverview: world.global_rules.setting_overview,
              }}
              onSaveMap={onSaveCampaignMap}
              onClose={() => setShowFullMap(false)}
              onOverrideLocation={handleOverrideClick}
              isOverriding={isOverriding}
              onSaveCampaignLocationLore={onSaveCampaignLocationLore}
              onSaveCampaignContainerLore={onSaveCampaignContainerLore}
              isMutatingLocked={isMutatingLocked}
            />
          </div>
        </div>
      )}

      {/* 3. Characters (collapsed "Name · Mood" rows, expandable to meters & gear) */}
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
              isMutatingLocked={isMutatingLocked}
              personaSnapshot={bundle.campaign.persona_snapshot}
              characterNameMap={characterNameMap}
              onToggleItemEquip={onToggleItemEquip}
              onOpenSheet={(cid) => {
                setSheetInitialTab("current");
                setSheetInitialItemId(null);
                setSheetCharacterId(cid);
              }}
              onInspectItem={(cid, itemId) => {
                setSheetInitialTab("inventory");
                setSheetInitialItemId(itemId);
                setSheetCharacterId(cid);
              }}
            />
          ))}
        </div>
      )}

      {/* Full Campaign Character Sheet / Dossier Modal */}
      {sheetRow && (
        <CampaignCharacterModal
          character={sheetRow.record}
          state={sheetRow.state}
          isPresent={sheetRow.isPresent}
          elsewhereLocationName={sheetRow.elsewhereLocationName}
          campaignId={bundle.campaign.id}
          campaignWorld={world}
          worlds={worlds}
          initialTab={sheetInitialTab}
          initialExpandedItemId={sheetInitialItemId}
          isMutatingLocked={isMutatingLocked}
          characterNameMap={Object.fromEntries(
            characterRows.map((r) => [r.record.id, r.record.name])
          )}
          onClose={() => {
            setSheetCharacterId(null);
            setSheetInitialItemId(null);
          }}
          onItemAction={onToggleItemEquip || (() => {})}
          onSaveMemories={async (cid, shards) => {
            if (onUpdateCampaignMemories) {
              await onUpdateCampaignMemories(cid, shards);
            }
          }}
        />
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

      {/* 5. Timeline Branches */}
      <InspectorSection
        storageKey="timeline"
        title="Timeline Branches"
        icon={<GitBranch size={13} color="var(--accent-violet)" />}
        meta={
          bundle.all_turn_nodes.length > 0
            ? `${turns.length} on branch · ${bundle.all_turn_nodes.length} total`
            : undefined
        }
      >
        {bundle.all_turn_nodes.length === 0 ? (
          <div className="inspector-empty">No turns in this timeline yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {bundle.all_turn_nodes.length > 4 && (
              <div style={{ position: "relative" }}>
                <Search
                  size={12}
                  style={{
                    position: "absolute",
                    left: 7,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "var(--text-muted)",
                    pointerEvents: "none",
                  }}
                />
                <input
                  type="text"
                  placeholder="Search turns..."
                  value={turnFilter}
                  onChange={(e) => setTurnFilter(e.target.value)}
                  style={{
                    width: "100%",
                    fontSize: "0.72rem",
                    padding: "4px 8px 4px 24px",
                    background: "var(--bg-card)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: 5,
                    color: "var(--text-primary)",
                    outline: "none",
                  }}
                />
              </div>
            )}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 5,
                maxHeight: 280,
                overflowY: "auto",
                paddingRight: 2,
              }}
            >
              {filteredTurnNodes.map((node) => {
                const inActive = activeBranchSet.has(node.id);
                const isLeaf = node.id === bundle.campaign.active_leaf_turn_id;
                return (
                  <div
                    key={node.id}
                    className={`branch-node-item ${
                      inActive ? "in-active-branch" : ""
                    } ${isLeaf ? "is-leaf" : ""}`}
                    style={{
                      marginLeft: Math.min(node.depth_index * 6, 32),
                      cursor: isMutatingLocked || isLeaf ? "default" : "pointer",
                      opacity: isMutatingLocked ? 0.65 : 1,
                    }}
                    onClick={() => {
                      if (!isMutatingLocked && !isLeaf && onCheckoutTurn) {
                        onCheckoutTurn(node.id);
                      }
                    }}
                    title={
                      isLeaf
                        ? "Current active timeline turn"
                        : inActive
                        ? "Click to checkout this earlier turn on the active branch"
                        : "Click to checkout this branch and switch timelines"
                    }
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        fontWeight: 600,
                        fontSize: "0.75rem",
                        color: isLeaf
                          ? "var(--accent-amber)"
                          : inActive
                          ? "#e2e8f0"
                          : "var(--text-muted)",
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        Turn #{node.depth_index}
                        {isLeaf && (
                          <span
                            style={{
                              fontSize: "0.58rem",
                              padding: "1px 4px",
                              borderRadius: 3,
                              background: "rgba(245, 158, 11, 0.2)",
                              color: "var(--accent-amber)",
                              fontWeight: 700,
                              textTransform: "uppercase",
                            }}
                          >
                            Active Leaf
                          </span>
                        )}
                      </span>
                      <span style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>
                        {node.world_snapshot.world_timestamp.split(" ")[1] ?? ""}
                      </span>
                    </div>
                    <div
                      style={{
                        color: "var(--text-secondary)",
                        fontSize: "0.72rem",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {node.depth_index === 0
                        ? "[Opening Scene]"
                        : node.user_message}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </InspectorSection>

      {/* 6. Internals (Scene Flags, Recalled Memories, Static RAG Index) */}
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
          locations={bundle.visible_locations}
          containers={effectiveContainers}
          activeLocationId={activeLoc.id}
          recalledItems={recalledItems}
          onClose={() => setShowLoreIndex(false)}
        />
      )}
    </aside>
  );
};
