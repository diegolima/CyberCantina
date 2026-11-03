import React, { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Compass,
  Cpu,
  Flag,
  Lock,
  MapPin,
  Maximize2,
  Navigation,
  ScrollText,
  Sparkles,
} from "lucide-react";
import {
  CampaignStateBundle,
  CharacterRecord,
  CharacterStateSnapshot,
  CompassDirection,
  LocationLoreNodeDraft,
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
  pickCompassSlot,
  SpatialTopologyView,
} from "./SpatialTopologyView";

const RECALL_SOURCE_LABEL: Record<RecalledMemoryItem["source_type"], string> = {
  lore: "Lore",
  location_lore: "Loc Lore",
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
  onAddEdge?: (payload: {
    from_location_id: string;
    to_location_id: string;
    direction_label?: string;
    compass_direction: CompassDirection;
    travel_minutes: number;
    bidirectional?: boolean;
  }) => Promise<void> | void;
  onDeleteEdge?: (edgeId: string) => Promise<void> | void;
  onUpdateEdgeDistance?: (payload: {
    edgeId: string;
    travel_minutes: number;
  }) => Promise<void> | void;
  onToggleItemEquip?: (payload: {
    item: string;
    action: "equip" | "unequip" | "remove" | "add";
    target?: "equipped" | "inventory";
    character_id?: string;
  }) => Promise<void> | void;
  onUpdateCampaignMemories?: (
    characterId: string,
    memoryShards: MemoryShard[]
  ) => Promise<void>;
  onSaveCampaignLocationLore?: (
    locationId: string,
    loreNodes: LocationLoreNodeDraft[]
  ) => Promise<void> | void;
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
  onCreateLinkedLocation,
  onAddEdge,
  onDeleteEdge,
  onUpdateEdgeDistance,
  onToggleItemEquip,
  onUpdateCampaignMemories,
  onSaveCampaignLocationLore,
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

  const sheetRow = useMemo(
    () => characterRows.find((r) => r.record.id === sheetCharacterId),
    [characterRows, sheetCharacterId]
  );

  const indexedCharacters = useMemo(
    () => characterRows.map((r) => r.record),
    [characterRows]
  );
  const indexedCount =
    world.lore_nodes.length +
    (bundle.visible_locations ?? []).reduce(
      (n, loc) =>
        n + (loc.lore_nodes ?? []).filter((l) => l.category !== "secret").length,
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
              width: "min(1100px, 95vw)",
              maxHeight: "92vh",
              display: "flex",
              flexDirection: "column",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <SpatialTopologyView
              title={`${world.name} — Full Spatial Topology (${bundle.visible_locations.length} Locations)`}
              locations={bundle.visible_locations}
              edges={activeEdges}
              activeLocationId={activeLoc.id}
              defaultSelectedLocationId={selectedLocId}
              mode="campaign"
              onClose={() => setShowFullMap(false)}
              onOverrideLocation={handleOverrideClick}
              isOverriding={isOverriding}
              onCreateLinkedLocation={onCreateLinkedLocation}
              onAddEdge={onAddEdge}
              onDeleteEdge={onDeleteEdge}
              onUpdateEdgeDistance={onUpdateEdgeDistance}
              onSaveCampaignLocationLore={onSaveCampaignLocationLore}
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
              onToggleItemEquip={onToggleItemEquip}
              onOpenSheet={(cid) => setSheetCharacterId(cid)}
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
          worlds={worlds}
          characterNameMap={Object.fromEntries(
            characterRows.map((r) => [r.record.id, r.record.name])
          )}
          onClose={() => setSheetCharacterId(null)}
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
          locations={bundle.visible_locations}
          activeLocationId={activeLoc.id}
          recalledItems={recalledItems}
          onClose={() => setShowLoreIndex(false)}
        />
      )}
    </aside>
  );
};
