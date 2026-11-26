import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  MapPin,
  Users,
} from "lucide-react";
import type { RightPanelMode } from "../utils/campaignLayout";
import { useDrawerSwipeDismiss } from "../hooks/useDrawerSwipeDismiss";
import { useOverlayBackHandler } from "../hooks/useOverlayBackHandler";
import {
  CampaignStateBundle,
  CharacterRecord,
  CharacterStateSnapshot,
  CompassDirection,
  LocationContainer,
  LocationEdge,
  LocationLoreNodeDraft,
  LocationNode,
  LocationOverrideOptions,
  MechanicsTopicId,
  NeighborLocationView,
  PhysicalStateOverridePayload,
  WorldRecord,
} from "../types";
import {
  getActiveParties,
  getCharacterParty,
  getCoLocatedPlayerPartyNpcs,
} from "../utils/partyHelpers";
import { USER_PARTY_MEMBER_ID } from "../types";
import { getEntityPrimaryImage } from "../utils/entityImages";
import {
  InspectorSection,
  usePersistentState,
} from "./inspector/InspectorPrimitives";
import { CharacterRow } from "./inspector/CharacterRow";
import { InspectorLocationCard } from "./inspector/InspectorLocationCard";
import {
  MINI_MAP_CENTER,
  MINI_MAP_RX,
  MINI_MAP_RY,
} from "./inspector/miniMapGeometry";
import { PhysicalStateControl } from "./shared/PhysicalStateControl";
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
  onOverridePlayerPhysicalState?: (
    payload: PhysicalStateOverridePayload
  ) => Promise<void> | void;
  onSaveCampaignMap?: (payload: {
    containers: LocationContainer[];
    locations: LocationNode[];
    edges: LocationEdge[];
  }) => Promise<void> | void;
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
  onOpenCharacterInCodex?: (characterId: string) => void;
  onOpenPersonaInCodex?: (personaId: string) => void;
  onOpenMechanicsHelp?: (topicId: MechanicsTopicId) => void;
  defaultElsewhereOpen?: boolean;
  isMutatingLocked?: boolean;
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
  onOverridePlayerPhysicalState,
  onSaveCampaignMap,
  onSaveCampaignLocationLore,
  onSaveCampaignContainerLore,
  onToggleCampaignLoreReveal,
  onToggleCampaignEdgeReveal,
  onOpenWorldSheet,
  onOpenCharacterInCodex,
  onOpenPersonaInCodex,
  onOpenMechanicsHelp,
  defaultElsewhereOpen = false,
  isMutatingLocked = false,
}) => {
  const activeLoc = bundle.active_location;
  const [selectedLocId, setSelectedLocId] = useState<string>(activeLoc.id);
  const [showFullMap, setShowFullMap] = useState(false);
  const [isOverriding, setIsOverriding] = useState(false);
  const [showExits, setShowExits] = usePersistentState<boolean>("map.exits", false);

  useOverlayBackHandler({
    id: "fullscreen-map-modal",
    isOpen: showFullMap,
    priority: 5,
    onClose: () => setShowFullMap(false),
  });

  // Latest vs previous turn on the active branch, used for "changed this turn" indicators
  const turns = bundle.active_branch_turns;
  const prevTurn = turns.length > 1 ? turns[turns.length - 2] : undefined;

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

  const presentRows = useMemo(
    () => characterRows.filter((r) => r.isPresent),
    [characterRows]
  );
  const absentRows = useMemo(
    () => characterRows.filter((r) => !r.isPresent),
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

  const { swipeOffsetPx, touchHandlers } = useDrawerSwipeDismiss({
    enabled: mode === "overlay",
    side: "right",
    onDismiss: onClose,
  });

  const personaSnapshot = bundle.campaign.persona_snapshot ?? null;
  const personaName = personaSnapshot?.name?.trim() || "You";
  const personaPortraitUrl = getEntityPrimaryImage("personas", personaSnapshot);

  const renderCharacterCard = (
    row: (typeof characterRows)[number],
    showPresenceLabel: boolean
  ) => {
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
        partyRole={partyRole}
        partyName={cParty?.name ?? null}
        showPresenceLabel={showPresenceLabel}
        onOpenInCodex={onOpenCharacterInCodex}
      />
    );
  };

  return (
    <aside
      id={id}
      className={inspectorClassName}
      aria-hidden={mode === "hidden" ? true : undefined}
      style={
        swipeOffsetPx !== 0
          ? { transform: `translateX(${swipeOffsetPx}px)`, transition: "none" }
          : undefined
      }
      {...(mode === "overlay" ? touchHandlers : {})}
    >
      {/* 1. Where is here (Map) */}
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
        panelId={id}
        mode={mode}
        onClose={onClose}
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
                onOpenMechanicsHelp={
                  onOpenMechanicsHelp
                    ? (topicId) => {
                        setShowFullMap(false);
                        onOpenMechanicsHelp(topicId);
                      }
                    : undefined
                }
              />
            </div>
          </div>
        );
        return typeof document !== "undefined"
          ? createPortal(fullMapModal, document.body)
          : fullMapModal;
      })()}

      {/* 2. Who is here: Here (User Persona + present characters) & collapsed Elsewhere */}
      <div className="inspector-card inspector-collapsible">
        <div className="inspector-here-header">
          <span className="inspector-section-title">
            <Users size={13} color="var(--accent-emerald)" />
            Here
          </span>
          <span className="inspector-section-meta">{1 + presentRows.length}</span>
        </div>
        <PhysicalStateControl
          label={personaName}
          variant="inspector"
          portraitUrl={personaPortraitUrl}
          showYouBadge={personaName.toLowerCase() !== "you"}
          onOpenPersona={
            personaSnapshot && onOpenPersonaInCodex
              ? () => onOpenPersonaInCodex(personaSnapshot.id)
              : undefined
          }
          stance={bundle.current_persona_turn_state?.physical_stance}
          context={bundle.current_persona_turn_state?.physical_context}
          isMutatingLocked={isMutatingLocked}
          onSave={onOverridePlayerPhysicalState}
          onOpenMechanicsHelp={onOpenMechanicsHelp}
        />
        {presentRows.map((row) => renderCharacterCard(row, false))}
        {presentRows.length === 0 && (
          <div className="inspector-here-empty">No other characters here</div>
        )}
      </div>

      {absentRows.length > 0 && (
        <InspectorSection
          storageKey="elsewhere"
          title="Elsewhere"
          icon={<MapPin size={13} color="var(--text-muted)" />}
          meta={absentRows.length}
          defaultOpen={defaultElsewhereOpen}
          bodyClassName="inspector-section-body--flush"
        >
          {absentRows.map((row) => renderCharacterCard(row, true))}
        </InspectorSection>
      )}
    </aside>
  );
};
