import React, { useEffect, useMemo, useState } from "react";
import {
  Clock,
  GitBranch,
  ScrollText,
  Search,
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
  WorldRecord,
} from "../types";
import { InspectorSection, usePersistentState } from "./inspector/InspectorPrimitives";
import { CharacterRow } from "./inspector/CharacterRow";
import { CampaignCharacterModal } from "./inspector/CampaignCharacterModal";
import { InspectorLocationCard } from "./inspector/InspectorLocationCard";
import { InspectorInternalsSection } from "./inspector/InspectorInternalsSection";
import { LoreIndexModal } from "./inspector/LoreIndexModal";
import {
  COMPASS_ANGLES,
  buildContainerBreadcrumbChain,
  computeDynamicPortalIds,
  pickCompassSlot,
  SpatialTopologyView,
} from "./SpatialTopologyView";

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


      <InspectorLocationCard
        bundle={bundle}
        activeLoc={activeLoc}
        pendingLocationOverrideId={pendingLocationOverrideId}
        selectedLocId={selectedLocId}
        setSelectedLocId={setSelectedLocId}
        selectedLocation={selectedLocation}
        selectedNeighbor={selectedNeighbor}
        immediateNeighbors={immediateNeighbors}
        miniMapCenter={miniMapCenter}
        miniMapCoords={miniMapCoords}
        miniDynamicPortalIds={miniDynamicPortalIds}
        containerMap={containerMap}
        activeBreadcrumbChain={activeBreadcrumbChain}
        showExits={showExits}
        setShowExits={setShowExits}
        isOverriding={isOverriding}
        onOverrideLocation={onOverrideLocation}
        handleOverrideClick={handleOverrideClick}
        handleOpenFullMap={handleOpenFullMap}
      />

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


      <InspectorInternalsSection
        bundle={bundle}
        turnsCount={turns.length}
        indexedCount={indexedCount}
        sceneFlags={sceneFlags}
        recalledItems={recalledItems}
        flagsChanged={flagsChanged}
        showAllFlags={showAllFlags}
        setShowAllFlags={setShowAllFlags}
        expandedRecalls={expandedRecalls}
        toggleRecall={toggleRecall}
        onOpenLoreIndex={() => setShowLoreIndex(true)}
      />

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
