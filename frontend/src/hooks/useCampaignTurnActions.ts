import { useState } from "react";
import { api, streamCampaignTurn } from "../api";
import type {
  CampaignStateBundle,
  CharacterChoiceSet,
  DiceMode,
  ItemEquipActionPayload,
  LiveStreamState,
  LocationContainer,
  LocationEdge,
  LocationLoreNodeDraft,
  LocationNode,
  MemoryShard,
  NarrativeMode,
  Phase3AgentProgressItem,
  Phase3TurnProgress,
  Phase4AgentProgressItem,
  Phase4TurnProgress,
  WorldRecord,
} from "../types";

export interface UseCampaignTurnActionsParams {
  bundle: CampaignStateBundle | null;
  setBundle: React.Dispatch<React.SetStateAction<CampaignStateBundle | null>>;
  setCampaignWorld: React.Dispatch<React.SetStateAction<WorldRecord | null>>;
}

export function useCampaignTurnActions({
  bundle,
  setBundle,
  setCampaignWorld,
}: UseCampaignTurnActionsParams) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [phase3Progress, setPhase3Progress] = useState<Phase3TurnProgress | null>(null);
  const [isPhase4Running, setIsPhase4Running] = useState(false);
  const [phase4ProgressByTurn, setPhase4ProgressByTurn] = useState<
    Record<string, Phase4TurnProgress>
  >({});
  const [streamError, setStreamError] = useState<string | null>(null);
  const [pendingLocationOverrideId, setPendingLocationOverrideId] = useState<
    string | null
  >(null);
  const [liveStream, setLiveStream] = useState<LiveStreamState | null>(null);

  const handleSendTurn = async (opts: {
    userMessage: string;
    parentTurnId?: string | null;
    diceMode?: DiceMode;
    manualDiceOverride?: number | null;
    narrativeMode?: NarrativeMode;
    narratorDirective?: string | null;
    durationMinutes?: number | null;
    characterChoices?: Record<string, CharacterChoiceSet>;
  }) => {
    if (!bundle) return;
    setIsStreaming(true);
    setStreamError(null);
    setPhase3Progress(null);
    const isNarrator = Boolean(
      opts.narrativeMode && opts.narrativeMode !== "standard"
    );
    setLiveStream({
      userMessage: opts.userMessage,
      preTurn: null,
      recalledItems: [],
      cognitionRaw: "",
      cognitionParsed: null,
      proseText: "",
      isNarrator,
      phaseStatus:
        isNarrator
          ? "Invoking Neutral Scene Narrator..."
          : "Phase 1: Pre-Turn Analysis & GraphRAG...",
    });

    try {
      await streamCampaignTurn(
        bundle.campaign.id,
        {
          user_message: opts.userMessage,
          parent_turn_id: opts.parentTurnId ?? bundle.campaign.active_leaf_turn_id,
          dice_mode: opts.diceMode ?? "auto",
          manual_dice_override: opts.manualDiceOverride ?? null,
          override_location_id: pendingLocationOverrideId,
          narrative_mode: opts.narrativeMode,
          narrator_directive: opts.narratorDirective,
          duration_minutes: opts.durationMinutes,
          character_choices: opts.characterChoices,
        },
        {
          onChoicesAdjusted: (data) => {
            console.warn(
              "Director choices adjusted - dropped characters:",
              data.dropped_character_ids
            );
          },
          onPhase1Complete: (data) => {
            setLiveStream((prev) =>
              prev
                ? {
                    ...prev,
                    preTurn: data.pre_turn,
                    recalledItems: data.recalled_items,
                    isNarrator:
                      prev.isNarrator ||
                      data.pre_turn?.active_speaker_id === "__narrator__",
                    phaseStatus: "Phase 2: Scoped RAG & Context Resolved...",
                  }
                : null
            );
          },
          onPhase3Start: (data) => {
            const rosterAgents: Record<string, Phase3AgentProgressItem> = {};
            const orderedIds: string[] = [];
            for (const entry of data.roster || []) {
              orderedIds.push(entry.character_id);
              rosterAgents[entry.character_id] = {
                characterId: entry.character_id,
                characterName: entry.character_name,
                role: entry.role,
                status: "queued",
              };
            }
            setPhase3Progress({
              dispatchMode: data.dispatch_mode || "sequential",
              isComplete: false,
              orderedCharacterIds: orderedIds,
              agents: rosterAgents,
            });
            setLiveStream((prev) =>
              prev
                ? {
                    ...prev,
                    phaseStatus: `Phase 3: Multi-Cognition Swarm (${data.dispatch_mode || "sequential"})...`,
                  }
                : null
            );
          },
          onPhase3AgentStart: (data) => {
            if (!data.character_id) return;
            setPhase3Progress((prev) => {
              if (!prev) return prev;
              const agent = prev.agents[data.character_id!];
              return {
                ...prev,
                agents: {
                  ...prev.agents,
                  [data.character_id!]: {
                    ...(agent || {
                      characterId: data.character_id!,
                      characterName: data.character_name || data.character_id!,
                      role: data.role || "co_present",
                    }),
                    status: "thinking",
                  },
                },
              };
            });
          },
          onPhase3AgentComplete: (data) => {
            if (!data.character_id) return;
            setPhase3Progress((prev) => {
              if (!prev) return prev;
              const agent = prev.agents[data.character_id!];
              return {
                ...prev,
                agents: {
                  ...prev.agents,
                  [data.character_id!]: {
                    ...(agent || {
                      characterId: data.character_id!,
                      characterName: data.character_name || data.character_id!,
                      role: data.role || "co_present",
                    }),
                    status: "completed",
                    cognition: data.cognition,
                    usedFallback: data.used_fallback,
                  },
                },
              };
            });
          },
          onPhase3AgentError: (data) => {
            if (!data.character_id) return;
            setPhase3Progress((prev) => {
              if (!prev) return prev;
              const agent = prev.agents[data.character_id!];
              return {
                ...prev,
                agents: {
                  ...prev.agents,
                  [data.character_id!]: {
                    ...(agent || {
                      characterId: data.character_id!,
                      characterName: data.character_name || data.character_id!,
                      role: data.role || "co_present",
                    }),
                    status: "failed",
                    error: data.error,
                  },
                },
              };
            });
          },
          onPhase3Complete: (_data) => {
            setPhase3Progress((prev) => (prev ? { ...prev, isComplete: true } : null));
            setLiveStream((prev) =>
              prev
                ? {
                    ...prev,
                    phaseStatus: "Phase 4: Streaming Narrative Prose...",
                  }
                : null
            );
          },
          onCognitionDelta: (rawBuffer) => {
            setLiveStream((prev) =>
              prev ? { ...prev, cognitionRaw: rawBuffer } : null
            );
          },
          onCognitionComplete: (cognition) => {
            setLiveStream((prev) =>
              prev ? { ...prev, cognitionParsed: cognition } : null
            );
          },
          onProseDelta: (delta) => {
            setLiveStream((prev) =>
              prev ? { ...prev, proseText: prev.proseText + delta } : null
            );
          },
          onTurnSaved: (savedTurn) => {
            setPendingLocationOverrideId(null);
            setBundle((prev) => {
              if (!prev) return prev;
              const parentIdx = prev.active_branch_turns.findIndex(
                (t) => t.id === savedTurn.parent_turn_id
              );
              const baseBranch =
                parentIdx !== -1
                  ? prev.active_branch_turns.slice(0, parentIdx + 1)
                  : prev.active_branch_turns;
              const nextAll = prev.all_turn_nodes.some(
                (t) => t.id === savedTurn.id
              )
                ? prev.all_turn_nodes.map((t) =>
                    t.id === savedTurn.id ? savedTurn : t
                  )
                : [...prev.all_turn_nodes, savedTurn];
              return {
                ...prev,
                campaign: {
                  ...prev.campaign,
                  active_leaf_turn_id: savedTurn.id,
                },
                active_branch_turns: [...baseBranch, savedTurn],
                all_turn_nodes: nextAll,
                current_world_snapshot: savedTurn.world_snapshot,
                current_character_state: savedTurn.character_state,
              };
            });
            setLiveStream(null);
            setPhase3Progress(null);
            setIsStreaming(false);
            setIsPhase4Running(true);
          },
          onPhase4Start: (data) => {
            setIsPhase4Running(true);
            setPhase4ProgressByTurn((prev) => {
              const rosterAgents: Record<string, Phase4AgentProgressItem> = {};
              const orderedKeys: string[] = [];
              for (const entry of data.roster || []) {
                orderedKeys.push(entry.agent_key);
                rosterAgents[entry.agent_key] = {
                  agentKey: entry.agent_key,
                  kind: entry.kind,
                  label: entry.label,
                  status: "queued",
                  reconciled: false,
                };
              }
              return {
                ...prev,
                [data.turn_id]: {
                  turnId: data.turn_id,
                  dispatchMode: data.dispatch_mode || "parallel",
                  isComplete: false,
                  orderedAgentKeys: orderedKeys,
                  agents: rosterAgents,
                },
              };
            });
          },
          onPhase4AgentStart: (data) => {
            if (!data.agent_key) return;
            setPhase4ProgressByTurn((prev) => {
              const current = prev[data.turn_id];
              if (!current) return prev;
              const agent = current.agents[data.agent_key!];
              return {
                ...prev,
                [data.turn_id]: {
                  ...current,
                  agents: {
                    ...current.agents,
                    [data.agent_key!]: {
                      ...(agent || {
                        agentKey: data.agent_key!,
                        kind: data.kind || "character",
                        label: data.label || data.agent_key!,
                        reconciled: false,
                      }),
                      status: "running",
                    },
                  },
                },
              };
            });
          },
          onPhase4AgentComplete: (data) => {
            if (!data.agent_key) return;
            setPhase4ProgressByTurn((prev) => {
              const current = prev[data.turn_id];
              if (!current) return prev;
              const agent = current.agents[data.agent_key!];
              return {
                ...prev,
                [data.turn_id]: {
                  ...current,
                  agents: {
                    ...current.agents,
                    [data.agent_key!]: {
                      ...(agent || {
                        agentKey: data.agent_key!,
                        kind: data.kind || "character",
                        label: data.label || data.agent_key!,
                        reconciled: false,
                      }),
                      status: "completed",
                      reconciled: false,
                      provisionalWorldDelta: data.world_delta ?? agent?.provisionalWorldDelta,
                      provisionalCharacterDelta: data.character_delta ?? agent?.provisionalCharacterDelta,
                    },
                  },
                },
              };
            });
          },
          onPhase4AgentError: (data) => {
            if (!data.agent_key) return;
            setPhase4ProgressByTurn((prev) => {
              const current = prev[data.turn_id];
              if (!current) return prev;
              const agent = current.agents[data.agent_key!];
              return {
                ...prev,
                [data.turn_id]: {
                  ...current,
                  agents: {
                    ...current.agents,
                    [data.agent_key!]: {
                      ...(agent || {
                        agentKey: data.agent_key!,
                        kind: data.kind || "character",
                        label: data.label || data.agent_key!,
                        reconciled: false,
                      }),
                      status: "failed",
                      error: data.error,
                    },
                  },
                },
              };
            });
          },
          onPhase4ArbitrationStart: (data) => {
            setPhase4ProgressByTurn((prev) => {
              const current = prev[data.turn_id];
              if (!current) return prev;
              const contested = new Set(data.contested_agent_keys || []);
              const updatedAgents = { ...current.agents };
              for (const [key, item] of Object.entries(updatedAgents)) {
                if (contested.has(key)) {
                  updatedAgents[key] = { ...item, status: "arbitrating" };
                }
              }
              return {
                ...prev,
                [data.turn_id]: {
                  ...current,
                  agents: updatedAgents,
                },
              };
            });
          },
          onPhase4Complete: async (data) => {
            setIsPhase4Running(false);
            setPhase4ProgressByTurn((prev) => {
              const current = prev[data.turn.id];
              if (!current) return prev;
              const markedAgents: Record<string, Phase4AgentProgressItem> = {};
              for (const [key, item] of Object.entries(current.agents)) {
                markedAgents[key] = {
                  ...item,
                  status: item.status === "failed" ? "failed" : "completed",
                  reconciled: true,
                };
              }
              return {
                ...prev,
                [data.turn.id]: {
                  ...current,
                  isComplete: true,
                  agents: markedAgents,
                },
              };
            });
            setPendingLocationOverrideId(null);
            setBundle(data.state_bundle);
            const updatedWorld = await api.getWorld(
              data.state_bundle.campaign.world_id
            );
            setCampaignWorld(updatedWorld);
          },
          onError: (err) => {
            setStreamError(err);
          },
        }
      );
    } catch (err) {
      setStreamError(String(err));
    } finally {
      setIsStreaming(false);
      setIsPhase4Running(false);
      setPhase3Progress(null);
      setLiveStream(null);
    }
  };

  const handleOverrideLocation = async (locationId: string) => {
    if (!bundle || isStreaming || isPhase4Running) return;
    const updated = await api.overrideLocation(bundle.campaign.id, locationId);
    setBundle(updated);
    setPendingLocationOverrideId(locationId);
  };

  const handleToggleItemEquip = async (payload: ItemEquipActionPayload) => {
    if (!bundle || isStreaming || isPhase4Running) return;
    try {
      const updated = await api.toggleItemEquip(bundle.campaign.id, payload);
      setBundle(updated);
    } catch (err) {
      console.error("Failed to manage item equipment/inventory:", err);
      if (payload.action === "update" || payload.action === "add") {
        throw err;
      }
    }
  };

  const handleUpdateCampaignMemories = async (
    characterId: string,
    memoryShards: MemoryShard[]
  ) => {
    if (!bundle || isStreaming || isPhase4Running) return;
    try {
      const updated = await api.updateCampaignCharacterMemories(
        bundle.campaign.id,
        characterId,
        memoryShards
      );
      setBundle(updated);
    } catch (err) {
      console.error("Failed to update campaign character memories:", err);
      throw err;
    }
  };

  const handleSaveCampaignLocationLore = async (
    locationId: string,
    loreNodes: LocationLoreNodeDraft[]
  ) => {
    if (!bundle || isStreaming || isPhase4Running) return;
    const updated = await api.updateCampaignLocationLore(
      bundle.campaign.id,
      locationId,
      loreNodes
    );
    setBundle(updated);
  };

  const handleSaveCampaignContainerLore = async (
    containerId: string,
    loreNodes: LocationLoreNodeDraft[]
  ) => {
    if (!bundle || isStreaming || isPhase4Running) return;
    const updated = await api.updateCampaignContainerLore(
      bundle.campaign.id,
      containerId,
      loreNodes
    );
    setBundle(updated);
  };

  const handleSaveCampaignMap = async (payload: {
    containers: LocationContainer[];
    locations: LocationNode[];
    edges: LocationEdge[];
  }) => {
    if (!bundle || isStreaming || isPhase4Running) return;
    const updated = await api.updateCampaignMap(bundle.campaign.id, payload);
    setBundle(updated);
  };

  const handleCheckoutTurn = async (turnId: string) => {
    if (!bundle || isStreaming || isPhase4Running) return;
    setPendingLocationOverrideId(null);
    const updated = await api.checkoutBranch(bundle.campaign.id, turnId);
    setBundle(updated);
  };

  const handleDeleteLastTurn = async () => {
    if (!bundle || isStreaming || isPhase4Running) return;
    setStreamError(null);
    setPendingLocationOverrideId(null);
    const updated = await api.deleteLastTurn(bundle.campaign.id);
    setBundle(updated);
    const updatedWorld = await api.getWorld(updated.campaign.world_id);
    setCampaignWorld(updatedWorld);
  };

  return {
    isStreaming,
    phase3Progress,
    isPhase4Running,
    phase4ProgressByTurn,
    streamError,
    setStreamError,
    pendingLocationOverrideId,
    setPendingLocationOverrideId,
    liveStream,
    handleSendTurn,
    handleOverrideLocation,
    handleToggleItemEquip,
    handleUpdateCampaignMemories,
    handleSaveCampaignLocationLore,
    handleSaveCampaignContainerLore,
    handleSaveCampaignMap,
    handleCheckoutTurn,
    handleDeleteLastTurn,
  };
}
