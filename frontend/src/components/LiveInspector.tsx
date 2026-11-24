import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Clock,
  PanelRightClose,
  X,
} from "lucide-react";
import type { RightPanelMode } from "../utils/campaignLayout";
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
  LocationOverrideOptions,
  MemoryShard,
  NeighborLocationView,
  WorldRecord,
} from "../types";
import {
  getActiveParties,
  getCharacterParty,
  getCoLocatedPlayerPartyNpcs,
} from "../utils/partyHelpers";
import { USER_PARTY_MEMBER_ID } from "../types";
import { usePersistentState } from "./inspector/InspectorPrimitives";
import { CharacterRow } from "./inspector/CharacterRow";
import { CampaignCharacterModal } from "./inspector/CampaignCharacterModal";
import { InspectorLocationCard } from "./inspector/InspectorLocationCard";
import {
  MINI_MAP_CENTER,
  MINI_MAP_RX,
  MINI_MAP_RY,
} from "./inspector/miniMapGeometry";
import { InspectorInternalsSection } from "./inspector/InspectorInternalsSection";
import { LoreIndexModal } from "./inspector/LoreIndexModal";
import { buildCampaignCharacterEntries } from "./world/codexHelpers";
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
  id?: string;
  mode?: RightPanelMode;
  onClose?: () => void;
  bundle: CampaignStateBundle;
  world: WorldRecord;
  character: CharacterRecord;
  /** All campaign participant records (primary character included). */
  participants?: CharacterRecord[];
  pendingLocationOverrideId?: string | null;
  onOverrideLocation?: (
    locationId: string,
    options?: LocationOverrideOptions
  ) => Promise<void> | void;
  onOverrideCharacterLocation?: (
    characterId: string,
    locationId: string
  ) => Promise<void> | void;
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
  onToggleCampaignLoreReveal?: (
    loreId: string,
    revealed: boolean
  ) => Promise<void> | void;
  onToggleCampaignEdgeReveal?: (
    edgeId: string,
    revealed: boolean
  ) => Promise<void> | void;
  onOpenWorldSheet?: () => void;
  isMutatingLocked?: boolean;
  worlds?: WorldRecord[];
}

export const LiveInspector: React.FC<LiveInspectorProps> = ({
  id = "live-inspector-aside",
  mode = "expanded",
  onClose,
  bundle,
  world,
  character,
  participants,
  pendingLocationOverrideId,
  onOverrideLocation,
  onOverrideCharacterLocation,
  onSaveCampaignMap,
  onToggleItemEquip,
  onUpdateCampaignMemories,
  onSaveCampaignLocationLore,
  onSaveCampaignContainerLore,
  onToggleCampaignLoreReveal,
  onToggleCampaignEdgeReveal,
  onOpenWorldSheet,
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

  // Participant roster: primary character first, then present, then elsewhere
  const characterRows = useMemo(() => {
    const entries = buildCampaignCharacterEntries(bundle, character, participants);
    const rows = entries.flatMap((entry) => {
      if (!entry.state) return [];
      const prevState =
        prevTurn?.character_states?.[entry.record.id] ??
        (entry.record.id === character.id ? prevTurn?.character_state : undefined);
      return [
        {
          record: entry.record,
          state: entry.state,
          isPresent: Boolean(entry.isPresent),
          elsewhereLocationName: entry.elsewhereLocationName,
          moodChanged: moodShifted(prevState, entry.state),
        },
      ];
    });
    // Stable partition keeps the primary character on top among present ones
    return [...rows.filter((r) => r.isPresent), ...rows.filter((r) => !r.isPresent)];
  }, [participants, character, bundle, prevTurn]);

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

  // Mini-map coordinates: activeLoc always centered; only immediate 1-hop neighbors displayed
  const miniMapCenter = MINI_MAP_CENTER;
  const miniMapCoords = useMemo(() => {
    const map: Record<string, { x: number; y: number; slot?: CompassDirection }> = {
      [activeLoc.id]: { x: miniMapCenter.x, y: miniMapCenter.y },
    };
    for (const nb of immediateNeighbors) {
      const angle = COMPASS_ANGLES[nb.slot];
      map[nb.destination.id] = {
        x: Math.round(miniMapCenter.x + Math.cos(angle) * MINI_MAP_RX),
        y: Math.round(miniMapCenter.y + Math.sin(angle) * MINI_MAP_RY),
        slot: nb.slot,
      };
    }
    return map;
  }, [activeLoc.id, immediateNeighbors, miniMapCenter]);

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

  const activeParties = getActiveParties(bundle);
  const coLocatedPartyNpcs = useMemo(() => {
    const npcIds = getCoLocatedPlayerPartyNpcs(activeParties, activeLoc.id);
    return npcIds.map((cid) => ({
      id: cid,
      name: bundle.character_records?.[cid]?.name || cid,
    }));
  }, [activeParties, activeLoc.id, bundle.character_records]);

  const handleOverrideClick = async (
    targetLocId: string,
    options?: LocationOverrideOptions
  ) => {
    if (!onOverrideLocation || isOverriding || targetLocId === activeLoc.id) {
      return;
    }
    setIsOverriding(true);
    try {
      await onOverrideLocation(targetLocId, options);
    } finally {
      setIsOverriding(false);
    }
  };

  const handleOpenFullMap = () => {
    setSelectedLocId(activeLoc.id);
    setShowFullMap(true);
  };

  useEffect(() => {
    if (!showFullMap || typeof document === "undefined") return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [showFullMap]);

  const inspectorClassName = [
    "inspector",
    mode === "overlay" ? "inspector--overlay" : "",
    mode === "hidden" ? "inspector--hidden" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <aside
      id={id}
      className={inspectorClassName}
      aria-hidden={mode === "hidden" ? true : undefined}
    >
      {/* 1. World Clock */}
      <div className="inspector-card">
        <div
          className="sidebar-label inspector-top-row"
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Clock size={13} color="var(--accent-amber)" />
            World Clock
          </span>
          {onClose && (
            <button
              type="button"
              className="btn btn-ghost inspector-collapse-btn"
              onClick={onClose}
              title={mode === "overlay" ? "Close inspector" : "Collapse inspector"}
              aria-label={mode === "overlay" ? "Close inspector" : "Collapse inspector"}
              aria-expanded={mode !== "hidden"}
              aria-controls={id}
            >
              {mode === "overlay" ? <X size={15} /> : <PanelRightClose size={15} />}
            </button>
          )}
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
        coLocatedPartyNpcs={coLocatedPartyNpcs}
        onOverrideLocation={onOverrideLocation}
        handleOverrideClick={handleOverrideClick}
        handleOpenFullMap={handleOpenFullMap}
        onOpenWorldSheet={onOpenWorldSheet}
      />

      {/* Full Zoomable Map Modal (portaled to document.body to escape .inspector--overlay stacking context) */}
      {showFullMap && (() => {
        const fullMapModal = (
          <div
            className="modal-backdrop map-fullscreen-modal-backdrop"
            onClick={() => setShowFullMap(false)}
          >
            <div
              className="modal-panel map-fullscreen-modal-panel"
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
                coLocatedPartyNpcs={coLocatedPartyNpcs}
                isOverriding={isOverriding}
                onSaveCampaignLocationLore={onSaveCampaignLocationLore}
                onSaveCampaignContainerLore={onSaveCampaignContainerLore}
                unlockLore={Boolean(bundle.campaign.world_settings?.unlock_lore)}
                revealedLoreIds={bundle.current_world_snapshot.revealed_lore_ids ?? []}
                onToggleLoreReveal={onToggleCampaignLoreReveal}
                revealedEdgeIds={bundle.current_world_snapshot.revealed_edge_ids ?? []}
                onToggleEdgeReveal={onToggleCampaignEdgeReveal}
                isMutatingLocked={isMutatingLocked}
                visitedContainerIds={bundle.current_world_snapshot.visited_container_ids ?? []}
              />
            </div>
          </div>
        );
        return typeof document !== "undefined"
          ? createPortal(fullMapModal, document.body)
          : fullMapModal;
      })()}

      {/* 3. Characters (collapsed "Name · Mood" rows, expandable to meters & gear) */}
      {characterRows.length > 0 && (
        <div className="inspector-card inspector-collapsible">
          {characterRows.map((row) => {
            const cParty = getCharacterParty(activeParties, row.record.id);
            const partyRole = cParty
              ? cParty.member_ids.includes(USER_PARTY_MEMBER_ID)
                ? "player_party"
                : cParty.leader_id === row.record.id
                ? "npc_leader"
                : "npc_party"
              : null;
            return (
              <CharacterRow
                key={row.record.id}
                character={row.record}
                state={row.state}
                isPresent={row.isPresent}
                elsewhereLocationName={row.elsewhereLocationName}
                moodChanged={row.moodChanged}
                isMutatingLocked={isMutatingLocked}
                partyRole={partyRole}
                partyName={cParty?.name ?? null}
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
            );
          })}
        </div>
      )}

      {/* Full Campaign Character Sheet / Dossier Modal */}
      {sheetRow && (() => {
        const sheetParty = getCharacterParty(activeParties, sheetRow.record.id);
        const sheetPartyRole = sheetParty
          ? sheetParty.member_ids.includes(USER_PARTY_MEMBER_ID)
            ? "player_party"
            : sheetParty.leader_id === sheetRow.record.id
            ? "npc_leader"
            : "npc_party"
          : null;
        return (
          <CampaignCharacterModal
            character={sheetRow.record}
            state={sheetRow.state}
            isPresent={sheetRow.isPresent}
            elsewhereLocationName={sheetRow.elsewhereLocationName}
            partyRole={sheetPartyRole}
            partyName={sheetParty?.name ?? null}
            locations={bundle.visible_locations}
            onRelocateCharacter={onOverrideCharacterLocation}
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
        );
      })()}

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
