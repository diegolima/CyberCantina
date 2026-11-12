import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Flame,
  FolderKanban,
  Globe,
  LogOut,
  Plus,
  Search,
  StickyNote,
  User,
  UserCheck,
  UserCog,
  Users,
  X,
} from "lucide-react";
import {
  api,
  setOnUnauthorizedHandler,
  setStoredSessionToken,
  streamCampaignTurn,
} from "./api";
import {
  AdminModal,
  AuthScreen,
  InitialSetupScreen,
  ProfileModal,
} from "./components/AuthModals";
import { ChatStage } from "./components/ChatStage";
import {
  CharacterInspectorModal,
  WorldInspectorModal,
} from "./components/EntityEditorModals";
import { LiveInspector } from "./components/LiveInspector";
import { HomeScreen } from "./components/HomeScreen";
import { NewCampaignModal } from "./components/NewCampaignModal";
import { NotesFlyout, NotesModal } from "./components/NotesDrawer";
import { PersonaEditorModal } from "./components/PersonaEditorModal";
import {
  LocalRelayProvider,
  useOptionalLocalRelay,
} from "./providers/LocalRelayContext";
import {
  CharacterWizardModal,
  WorldWizardModal,
} from "./components/WizardModals";
import { slugifyTag } from "./utils/noteSearch";
import {
  AppSettings,
  AuthSessionResponse,
  CampaignRecord,
  CampaignStateBundle,
  CharacterChoiceSet,
  CharacterRecord,
  CognitionBlock,
  CompassDirection,
  DiceMode,
  ItemEquipActionPayload,
  LocationLoreNodeDraft,
  MemoryShard,
  NarrativeMode,
  PersonaRecord,
  Phase3AgentProgressItem,
  Phase3TurnProgress,
  Phase4AgentProgressItem,
  Phase4TurnProgress,
  PreTurnAnalysis,
  ProfileModelSettingsResponse,
  RecalledMemoryItem,
  UserNote,
  UserProfile,
  WorldRecord,
} from "./types";

const PAGE_SIZE = 5;

interface SidebarCategoryProps<T> {
  title: string;
  icon: React.ReactNode;
  items: T[];
  searchPlaceholder: string;
  filterFn: (item: T, query: string) => boolean;
  renderItem: (item: T) => React.ReactNode;
  onNewClick?: () => void;
  newButtonTitle?: string;
  defaultExpanded?: boolean;
}

function SidebarCategory<T>({
  title,
  icon,
  items,
  searchPlaceholder,
  filterFn,
  renderItem,
  onNewClick,
  newButtonTitle,
  defaultExpanded = false,
}: SidebarCategoryProps<T>) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(0);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredItems = normalizedQuery
    ? items.filter((item) => filterFn(item, normalizedQuery))
    : items;

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pagedItems = filteredItems.slice(
    safePage * PAGE_SIZE,
    (safePage + 1) * PAGE_SIZE
  );

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    setPage(0);
  };

  return (
    <div className="sidebar-section">
      <div
        className="sidebar-category-header"
        onClick={() => setExpanded((prev) => !prev)}
      >
        <div className="sidebar-category-title">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {icon}
          <span>
            {title} ({items.length})
          </span>
        </div>

        {onNewClick && (
          <button
            type="button"
            className="btn"
            style={{ padding: "2px 7px", fontSize: "0.68rem" }}
            onClick={(e) => {
              e.stopPropagation();
              onNewClick();
            }}
            title={newButtonTitle}
          >
            <Plus size={11} /> New
          </button>
        )}
      </div>

      {expanded && (
        <div className="sidebar-category-body">
          <div className="sidebar-search-wrap">
            <Search size={13} className="sidebar-search-icon" />
            <input
              type="text"
              className="sidebar-search-input"
              placeholder={searchPlaceholder}
              value={searchQuery}
              onChange={handleSearchChange}
            />
          </div>

          <div className="campaign-list">
            {pagedItems.length > 0 ? (
              pagedItems.map((item) => renderItem(item))
            ) : (
              <div
                style={{
                  fontSize: "0.75rem",
                  color: "var(--text-muted)",
                  padding: "6px 4px",
                  textAlign: "center",
                }}
              >
                No matching entries
              </div>
            )}
          </div>

          {filteredItems.length > PAGE_SIZE && (
            <div className="sidebar-pager">
              <span>
                {safePage * PAGE_SIZE + 1}–
                {Math.min((safePage + 1) * PAGE_SIZE, filteredItems.length)} of{" "}
                {filteredItems.length}
              </span>
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  type="button"
                  className="btn"
                  style={{ padding: "2px 6px", fontSize: "0.68rem" }}
                  disabled={safePage === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  <ChevronLeft size={12} />
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{ padding: "2px 6px", fontSize: "0.68rem" }}
                  disabled={safePage >= totalPages - 1}
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                >
                  <ChevronRight size={12} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const RelaySidebarBadge: React.FC = () => {
  const relay = useOptionalLocalRelay();
  if (!relay || !relay.hasBrowserProviders) return null;
  const connected = relay.wsState === "connected";
  return (
    <div
      className={`relay-status-pill ${connected ? "connected" : "offline"}`}
      title={
        relay.webgpuLoadedModel
          ? `Browser relay ${relay.wsState} · WebGPU loaded: ${relay.webgpuLoadedModel}`
          : `Browser inference relay: ${relay.wsState}`
      }
    >
      <Cpu size={13} />
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {relay.webgpuLoadedModel
          ? `GPU: ${relay.webgpuLoadedModel.split("-q4")[0]}`
          : connected
          ? "Browser Relay Ready"
          : `Relay ${relay.wsState}…`}
      </span>
      {relay.webgpuLoadedModel && (
        <button
          type="button"
          className="btn btn-ghost"
          style={{ padding: "1px 5px", fontSize: "0.66rem" }}
          onClick={() => void relay.unloadWebGpu()}
          title="Unload WebGPU model from browser VRAM"
        >
          Unload
        </button>
      )}
    </div>
  );
};

export const App: React.FC = () => {
  const [authChecking, setAuthChecking] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);
  const [singleUserMode, setSingleUserMode] = useState(false);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [profileInitialTab, setProfileInitialTab] = useState<
    "identity" | "account" | "preferences" | "models" | "prompts" | "behavior"
  >("identity");
  const [profileInitialSubTab, setProfileInitialSubTab] = useState<
    "behavior" | "prompts" | "models" | "providers" | undefined
  >(undefined);
  const [adminInitialTab, setAdminInitialTab] = useState<
    "users" | "providers" | "models" | "prompts"
  >("users");
  const [profileModels, setProfileModels] =
    useState<ProfileModelSettingsResponse | null>(null);

  const [campaigns, setCampaigns] = useState<CampaignRecord[]>([]);
  const [worlds, setWorlds] = useState<WorldRecord[]>([]);
  const [characters, setCharacters] = useState<CharacterRecord[]>([]);
  const [personas, setPersonas] = useState<PersonaRecord[]>([]);
  const [bundle, setBundle] = useState<CampaignStateBundle | null>(null);
  const [campaignWorld, setCampaignWorld] = useState<WorldRecord | null>(null);
  const [campaignCharacter, setCampaignCharacter] =
    useState<CharacterRecord | null>(null);
  const [activeWorld, setActiveWorld] = useState<WorldRecord | null>(null);
  const [activeCharacter, setActiveCharacter] = useState<CharacterRecord | null>(
    null
  );
  const [activePersona, setActivePersona] = useState<PersonaRecord | null>(null);
  const [inspectingCharacter, setInspectingCharacter] =
    useState<CharacterRecord | null>(null);
  const [inspectingWorld, setInspectingWorld] = useState<WorldRecord | null>(
    null
  );
  const [showPersonaModal, setShowPersonaModal] = useState(false);
  const [editingPersona, setEditingPersona] = useState<PersonaRecord | null>(null);
  const [showNewCampaignModal, setShowNewCampaignModal] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);

  const [showCharWizard, setShowCharWizard] = useState(false);
  const [showWorldWizard, setShowWorldWizard] = useState(false);
  const [wizardInitialDraft, setWizardInitialDraft] = useState<any>(null);
  const [wizardInitialWorldDraft, setWizardInitialWorldDraft] = useState<any>(null);
  const [wizardInitialPreassignedId, setWizardInitialPreassignedId] = useState<string | null>(null);

  // User Notes (Player Scratchpad) State
  const [notes, setNotes] = useState<UserNote[]>([]);
  const [showNotesFlyout, setShowNotesFlyout] = useState(false);
  const [showNotesModal, setShowNotesModal] = useState(false);
  const [notesModalInitialId, setNotesModalInitialId] = useState<string | undefined>(undefined);

  const noteContextTags = useMemo(() => {
    const tags: string[] = [];
    if (bundle?.campaign?.name) {
      tags.push(slugifyTag(bundle.campaign.name));
    }
    const worldName = campaignWorld?.name || activeWorld?.name;
    if (worldName) {
      tags.push(slugifyTag(worldName));
    }
    const charName = campaignCharacter?.name || activeCharacter?.name;
    if (charName) {
      tags.push(slugifyTag(charName));
    }
    return Array.from(new Set(tags.filter(Boolean)));
  }, [bundle, campaignWorld, activeWorld, campaignCharacter, activeCharacter]);

  const handleToggleNoteStar = async (note: UserNote) => {
    try {
      const updated = await api.updateNote(note.id, { is_starred: !note.is_starred });
      setNotes((prev) => prev.map((n) => (n.id === note.id ? updated : n)));
    } catch (err) {
      console.error("Failed to toggle note star", err);
    }
  };

  const handleQuickAddNote = async (content: string, title = "", tags: string[] = []) => {
    try {
      const created = await api.createNote({
        title,
        content,
        tags,
        is_starred: false,
      });
      setNotes((prev) => [created, ...prev]);
    } catch (err) {
      console.error("Failed to create quick note", err);
    }
  };

  const handleSaveNote = async (
    noteId: string | null,
    payload: { title: string; content: string; tags: string[]; is_starred: boolean }
  ) => {
    if (noteId) {
      const updated = await api.updateNote(noteId, payload);
      setNotes((prev) => prev.map((n) => (n.id === noteId ? updated : n)));
      return updated;
    } else {
      const created = await api.createNote(payload);
      setNotes((prev) => [created, ...prev]);
      return created;
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    try {
      await api.deleteNote(noteId);
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
    } catch (err) {
      console.error("Failed to delete note", err);
    }
  };

  const handleOpenModelSettings = () => {
    if (currentUser?.role === "admin") {
      setAdminInitialTab("models");
      setShowAdminModal(true);
    } else {
      setProfileInitialTab("models");
      setShowProfileModal(true);
    }
  };

  const [deleteTarget, setDeleteTarget] = useState<
    | { kind: "campaign"; campaign: CampaignRecord }
    | {
        kind: "character";
        character: CharacterRecord;
        campaignsUsing: CampaignRecord[];
      }
    | {
        kind: "world";
        world: WorldRecord;
        campaignsUsing: CampaignRecord[];
      }
    | {
        kind: "persona";
        persona: PersonaRecord;
        campaignsUsing: CampaignRecord[];
      }
    | null
  >(null);
  const [isDeleting, setIsDeleting] = useState(false);

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
  const [liveStream, setLiveStream] = useState<{
    userMessage: string;
    preTurn: PreTurnAnalysis | null;
    recalledItems: RecalledMemoryItem[];
    cognitionRaw: string;
    cognitionParsed: CognitionBlock | null;
    proseText: string;
    phaseStatus: string;
    isNarrator?: boolean;
  } | null>(null);

  const ACTIVE_CAMPAIGN_STORAGE_KEY = "cybercantina_active_campaign_id";
  const DEFAULT_PERSONA_STORAGE_KEY = "cybercantina_default_persona_id";

  const handleSetDefaultPersona = (p: PersonaRecord) => {
    setActivePersona(p);
    try {
      localStorage.setItem(DEFAULT_PERSONA_STORAGE_KEY, p.id);
    } catch {}
  };

  const loadCampaignBundle = async (campaignId: string) => {
    setPendingLocationOverrideId(null);
    const stateBundle = await api.getCampaignState(campaignId);
    setBundle(stateBundle);
    try {
      localStorage.setItem(ACTIVE_CAMPAIGN_STORAGE_KEY, campaignId);
    } catch {}
    const [w, c] = await Promise.all([
      api.getWorld(stateBundle.campaign.world_id),
      api.getCharacter(stateBundle.campaign.character_id),
    ]);
    setCampaignWorld(w);
    setCampaignCharacter(c);
    setActiveWorld(w);
    setActiveCharacter(c);
  };

  const handleCloseCampaign = () => {
    try {
      localStorage.removeItem(ACTIVE_CAMPAIGN_STORAGE_KEY);
    } catch {}
    setBundle(null);
    setCampaignWorld(null);
    setCampaignCharacter(null);
  };

  const loadWorkspaceData = async () => {
    const [camps, wList, cList, cfg, userNotes, personaList, profModels] = await Promise.all([
      api.listCampaigns(),
      api.listWorlds(),
      api.listCharacters(),
      api.getSettings(),
      api.listNotes().catch(() => [] as UserNote[]),
      api.listPersonas().catch(() => [] as PersonaRecord[]),
      api.getProfileModels().catch(() => null),
    ]);
    setCampaigns(camps);
    setWorlds(wList);
    setCharacters(cList);
    setAppSettings(cfg);
    setProfileModels(profModels);
    setNotes(userNotes);
    setPersonas(personaList);
    const storedPersonaId = localStorage.getItem(DEFAULT_PERSONA_STORAGE_KEY);
    const matchedDefault = storedPersonaId
      ? personaList.find((p) => p.id === storedPersonaId)
      : null;
    setActivePersona(matchedDefault || personaList[0] || null);
    const storedCampaignId = localStorage.getItem(ACTIVE_CAMPAIGN_STORAGE_KEY);
    const activeCamp = storedCampaignId ? camps.find((c) => c.id === storedCampaignId) : null;
    if (activeCamp) {
      await loadCampaignBundle(activeCamp.id);
    } else {
      setBundle(null);
      setCampaignWorld(null);
      setCampaignCharacter(null);
      setActiveWorld(wList[0] ?? null);
      setActiveCharacter(cList[0] ?? null);
    }
  };

  const refreshAuthStatus = async () => {
    const status = await api.getAuthStatus();
    setSetupRequired(status.setup_required);
    setSingleUserMode(status.single_user_mode);
    setCurrentUser(status.user ?? null);
    return status;
  };

  useEffect(() => {
    setOnUnauthorizedHandler(() => {
      setCurrentUser(null);
      setBundle(null);
      setShowProfileModal(false);
      setShowAdminModal(false);
    });
    (async () => {
      try {
        const status = await refreshAuthStatus();
        if (status.authenticated && status.user) {
          await loadWorkspaceData();
        }
      } finally {
        setAuthChecking(false);
      }
    })();
  }, []);

  const handleAuthenticated = async (session: AuthSessionResponse) => {
    setSetupRequired(false);
    setSingleUserMode(session.single_user_mode);
    setCurrentUser(session.user);
    await loadWorkspaceData();
  };

  const handleLogout = async () => {
    try {
      localStorage.removeItem(ACTIVE_CAMPAIGN_STORAGE_KEY);
    } catch {}
    await api.logout();
    const status = await refreshAuthStatus();
    if (!status.authenticated) {
      setCurrentUser(null);
      setBundle(null);
      setCampaigns([]);
      setWorlds([]);
      setCharacters([]);
      setPersonas([]);
      setActivePersona(null);
      setNotes([]);
    }
  };

  const handleAccountDeleted = async () => {
    try {
      localStorage.removeItem(ACTIVE_CAMPAIGN_STORAGE_KEY);
    } catch {}
    setShowProfileModal(false);
    setShowAdminModal(false);
    setStoredSessionToken(null);
    setCurrentUser(null);
    setBundle(null);
    setCampaigns([]);
    setWorlds([]);
    setCharacters([]);
    setPersonas([]);
    setActivePersona(null);
    setNotes([]);
    try {
      await api.logout();
    } catch {
      // ignore errors
    }
    const status = await api.getAuthStatus();
    setSetupRequired(status.setup_required);
    setSingleUserMode(status.single_user_mode);
    setCurrentUser(null);
  };

  const handleSelectCharacter = (char: CharacterRecord) => {
    setInspectingCharacter(char);
  };

  const handleSelectWorld = (world: WorldRecord) => {
    setInspectingWorld(world);
  };

  const handleRequestDeleteCharacter = (
    e: React.MouseEvent | undefined,
    char: CharacterRecord
  ) => {
    e?.stopPropagation();
    if (isStreaming) return;
    const using = campaigns.filter((c) =>
      (c.participant_character_ids ?? [c.character_id]).includes(char.id)
    );
    setDeleteTarget({
      kind: "character",
      character: char,
      campaignsUsing: using,
    });
  };

  const handleRequestDeleteWorld = (
    e: React.MouseEvent | undefined,
    world: WorldRecord
  ) => {
    e?.stopPropagation();
    if (isStreaming) return;
    const using = campaigns.filter((c) => c.world_id === world.id);
    setDeleteTarget({
      kind: "world",
      world,
      campaignsUsing: using,
    });
  };

  const handleRequestDeletePersona = (
    e: React.MouseEvent | undefined,
    persona: PersonaRecord
  ) => {
    e?.stopPropagation();
    if (isStreaming) return;
    const using = campaigns.filter((c) => c.persona_id === persona.id);
    setDeleteTarget({
      kind: "persona",
      persona,
      campaignsUsing: using,
    });
  };

  const handleRequestDeleteCampaign = (
    e: React.MouseEvent | undefined,
    camp: CampaignRecord
  ) => {
    e?.stopPropagation();
    if (isStreaming) return;
    setDeleteTarget({
      kind: "campaign",
      campaign: camp,
    });
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      if (deleteTarget.kind === "character") {
        await api.deleteCharacter(deleteTarget.character.id);
        const updatedChars = await api.listCharacters();
        setCharacters(updatedChars);
      } else if (deleteTarget.kind === "world") {
        await api.deleteWorld(deleteTarget.world.id);
        const updatedWorlds = await api.listWorlds();
        setWorlds(updatedWorlds);
      } else if (deleteTarget.kind === "persona") {
        await api.deletePersona(deleteTarget.persona.id);
        const updatedPersonas = await api.listPersonas();
        setPersonas(updatedPersonas);
        if (activePersona?.id === deleteTarget.persona.id) {
          const nextDefault = updatedPersonas[0] ?? null;
          if (nextDefault) {
            handleSetDefaultPersona(nextDefault);
          } else {
            setActivePersona(null);
            try {
              localStorage.removeItem(DEFAULT_PERSONA_STORAGE_KEY);
            } catch {}
          }
        }
      } else {
        const deletedCampId = deleteTarget.campaign.id;
        await api.deleteCampaign(deletedCampId);
        const [updatedCamps, updatedChars, updatedWorlds] = await Promise.all([
          api.listCampaigns(),
          api.listCharacters(),
          api.listWorlds(),
        ]);
        setCampaigns(updatedCamps);
        setCharacters(updatedChars);
        setWorlds(updatedWorlds);

        if (bundle?.campaign.id === deletedCampId) {
          try {
            localStorage.removeItem(ACTIVE_CAMPAIGN_STORAGE_KEY);
          } catch {}
          setBundle(null);
          setCampaignWorld(null);
          setCampaignCharacter(null);
        }
      }
      setDeleteTarget(null);
    } finally {
      setIsDeleting(false);
    }
  };

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

  const handleCreateLinkedLocation = async (payload: {
    from_location_id: string;
    name: string;
    compass_direction: string;
    travel_minutes: number;
    description: string;
    environmental_tags: string[];
  }): Promise<string | void> => {
    if (!bundle || isStreaming || isPhase4Running) return;
    const prevIds = new Set(bundle.visible_locations.map((l) => l.id));
    const updated = await api.createLinkedLocation(bundle.campaign.id, payload);
    setBundle(updated);
    const updatedWorld = await api.getWorld(updated.campaign.world_id);
    setCampaignWorld(updatedWorld);
    return updated.visible_locations.find((l) => l.name === payload.name && !prevIds.has(l.id))?.id;
  };

  const handleConnectLocations = async (payload: {
    from_location_id: string;
    to_location_id: string;
    direction_label?: string;
    compass_direction: CompassDirection;
    travel_minutes: number;
    bidirectional?: boolean;
  }) => {
    if (!bundle || isStreaming || isPhase4Running) return;
    const updated = await api.connectCampaignLocations(bundle.campaign.id, payload);
    setBundle(updated);
    const updatedWorld = await api.getWorld(updated.campaign.world_id);
    setCampaignWorld(updatedWorld);
  };

  const handleDeleteCampaignEdge = async (edgeId: string) => {
    if (!bundle || isStreaming || isPhase4Running) return;
    const updated = await api.removeCampaignEdge(bundle.campaign.id, edgeId, true);
    setBundle(updated);
    const updatedWorld = await api.getWorld(updated.campaign.world_id);
    setCampaignWorld(updatedWorld);
  };

  const handleUpdateCampaignEdgeDistance = async (payload: {
    edgeId: string;
    travel_minutes: number;
  }) => {
    if (!bundle || isStreaming || isPhase4Running) return;
    const updated = await api.updateCampaignEdgeDistance(
      bundle.campaign.id,
      payload.edgeId,
      payload.travel_minutes,
      true
    );
    setBundle(updated);
    const updatedWorld = await api.getWorld(updated.campaign.world_id);
    setCampaignWorld(updatedWorld);
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

  // Highlight entities strictly according to the active campaign.
  // Edge case: if the campaign was created with an older version of a character/world,
  // find and highlight the latest version currently in the library.
  const campaignActiveWorldId = useMemo(() => {
    if (!bundle?.campaign) return null;
    const targetWorldId = bundle.campaign.world_id;
    const worldName = campaignWorld?.name;

    if (worldName) {
      const matchingByName = worlds.filter(
        (w) => w.name === worldName && !w.pending_deletion
      );
      if (matchingByName.length > 0) {
        return [...matchingByName].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )[0].id;
      }
    }

    const directMatch = worlds.find((w) => w.id === targetWorldId);
    return directMatch?.id ?? targetWorldId;
  }, [bundle?.campaign, worlds, campaignWorld]);

  const campaignActiveCharacterIds = useMemo(() => {
    if (!bundle?.campaign) return new Set<string>();
    const activeIds = new Set<string>();
    const campaignCharIds = bundle.campaign.participant_character_ids?.length
      ? bundle.campaign.participant_character_ids
      : [bundle.campaign.character_id].filter(Boolean);

    // Collect all campaign character records (including historical/snapshots)
    const campaignRecords: CharacterRecord[] = [];
    for (const cid of campaignCharIds) {
      const rec =
        bundle.character_records?.[cid] ??
        (campaignCharacter?.id === cid ? campaignCharacter : null);
      if (rec) {
        campaignRecords.push(rec);
      }
    }

    for (const cid of campaignCharIds) {
      const cRec =
        campaignRecords.find((r) => r.id === cid) ??
        (campaignCharacter?.id === cid ? campaignCharacter : null);

      if (cRec?.name) {
        const matchingByName = characters.filter(
          (c) => c.name === cRec.name && !c.pending_deletion
        );
        if (matchingByName.length > 0) {
          // Sort by version descending, then created_at descending -> latest version first
          const latest = [...matchingByName].sort((a, b) => {
            const vDiff = (b.version ?? 1) - (a.version ?? 1);
            if (vDiff !== 0) return vDiff;
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
          })[0];
          activeIds.add(latest.id);
          continue;
        }
      }

      const directMatch = characters.find((c) => c.id === cid);
      if (directMatch) {
        activeIds.add(directMatch.id);
      }
    }

    return activeIds;
  }, [bundle?.campaign, bundle?.character_records, characters, campaignCharacter]);

  const campaignActivePersonaId = useMemo(() => {
    if (!bundle?.campaign) return null;
    const targetId = bundle.campaign.persona_id;
    if (!targetId) return null;
    const directMatch = personas.find((p) => p.id === targetId);
    if (directMatch) return directMatch.id;
    const pName = bundle.campaign.persona_snapshot?.name;
    if (pName) {
      const match = personas.find((p) => p.name === pName);
      if (match) return match.id;
    }
    return targetId;
  }, [bundle?.campaign, personas]);

  if (authChecking) {
    return (
      <div className="auth-stage-backdrop">
        <div style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
          Initializing CyberCantina...
        </div>
      </div>
    );
  }

  if (setupRequired) {
    return <InitialSetupScreen onComplete={handleAuthenticated} />;
  }

  if (!currentUser) {
    return (
      <AuthScreen
        singleUserMode={singleUserMode}
        onAuthenticated={handleAuthenticated}
      />
    );
  }

  return (
    <LocalRelayProvider currentUser={currentUser}>
    <div className={`studio-shell ${!bundle ? "no-campaign" : ""}`}>
      {/* Left Sidebar: 4 Collapsible, Searchable, Paged Categories (Active in play mode) */}
      {bundle && (
        <aside className="sidebar">
          <div
            className="brand-header"
            style={{ cursor: "pointer" }}
            onClick={handleCloseCampaign}
            title="Return to Home page"
          >
            <div className="brand-title">
              <Flame size={20} color="var(--accent-amber)" />
              <span>CYBERCANTINA</span>
            </div>
          </div>

        {/* 1. Personas (+new) */}
        <SidebarCategory
          title="Personas"
          icon={<UserCheck size={14} color="var(--accent-emerald)" />}
          items={personas}
          searchPlaceholder="Search personas, appearance, lore..."
          onNewClick={() => {
            setEditingPersona(null);
            setShowPersonaModal(true);
          }}
          newButtonTitle="Create a new User Persona"
          filterFn={(p, q) => {
            const query = q.trim().toLowerCase();
            return Boolean(
              p.name.toLowerCase().includes(query) ||
              (p.species && p.species.toLowerCase().includes(query)) ||
              (p.persona_bio && p.persona_bio.toLowerCase().includes(query)) ||
              (p.tags && p.tags.some((t) => t.toLowerCase().includes(query))) ||
              (p.build_and_height && p.build_and_height.toLowerCase().includes(query)) ||
              (p.physical_appearance && p.physical_appearance.toLowerCase().includes(query)) ||
              (p.inventory && p.inventory.some((i) => i.name.toLowerCase().includes(query))) ||
              (p.lore_entries && p.lore_entries.some((l) => l.title.toLowerCase().includes(query)))
            );
          }}
          renderItem={(p) => {
            const isActive = campaignActivePersonaId === p.id;
            return (
              <div
                key={p.id}
                className={`campaign-item ${isActive ? "active" : ""}`}
                onClick={() => {
                  setEditingPersona(p);
                  setShowPersonaModal(true);
                }}
              >
                {!p.id.startsWith("persona_default_") && p.id !== "persona_default_user" ? (
                  <button
                    type="button"
                    className="item-remove-btn"
                    onClick={(e) => handleRequestDeletePersona(e, p)}
                    disabled={isStreaming}
                    title={`Delete persona ${p.name}`}
                  >
                    <X size={13} />
                  </button>
                ) : (
                  <div style={{ width: 14 }} />
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: "0.81rem" }}>
                      {p.name}
                      {(p.id.startsWith("persona_default_") || p.id === "persona_default_user") && (
                        <span
                          style={{
                            fontSize: "0.62rem",
                            color: "var(--accent-emerald)",
                            background: "rgba(16, 185, 129, 0.12)",
                            padding: "1px 4px",
                            borderRadius: 3,
                            marginLeft: 5,
                            fontWeight: 500,
                          }}
                        >
                          Default
                        </span>
                      )}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      {isActive && (
                        <span
                          style={{
                            fontSize: "0.62rem",
                            color: "var(--accent-amber)",
                            background: "rgba(245, 158, 11, 0.12)",
                            border: "1px solid rgba(245, 158, 11, 0.35)",
                            padding: "1px 4px",
                            borderRadius: 3,
                            fontWeight: 600,
                            flexShrink: 0,
                          }}
                        >
                          Active
                        </span>
                      )}
                      {p.age && (
                        <span
                          style={{
                            fontSize: "0.65rem",
                            color: "var(--accent-emerald)",
                            background: "rgba(16, 185, 129, 0.12)",
                            padding: "1px 4px",
                            borderRadius: 3,
                            flexShrink: 0,
                          }}
                        >
                          Age {p.age}
                        </span>
                      )}
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: "0.71rem",
                      color: "var(--text-secondary)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {p.physical_appearance || "No physical description"}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 6,
                      marginTop: 3,
                      fontSize: "0.63rem",
                      color: "var(--text-muted)",
                    }}
                  >
                    <span>{p.equipped?.length ?? 0} equipped</span>
                    <span>•</span>
                    <span>{p.inventory?.length ?? 0} items</span>
                    <span>•</span>
                    <span>{p.lore_entries?.length ?? 0} lore</span>
                  </div>
                </div>
              </div>
            );
          }}
        />

        {/* 2. Characters (+new) */}
        <SidebarCategory
          title="Characters"
          icon={<Users size={14} color="var(--accent-amber)" />}
          items={characters}
          searchPlaceholder="Search characters, tags, creators..."
          onNewClick={() => setShowCharWizard(true)}
          newButtonTitle="Create a new Character with AI Wizard"
          filterFn={(char, q) => {
            const query = q.trim().toLowerCase().replace(/^#/, "");
            return Boolean(
              char.name.toLowerCase().includes(query) ||
              char.tagline.toLowerCase().includes(query) ||
              (char.tags && char.tags.some((t) => t.toLowerCase().includes(query))) ||
              (char.creator && char.creator.toLowerCase().includes(query))
            );
          }}
          renderItem={(char) => {
            const isActive = campaignActiveCharacterIds.has(char.id);
            return (
              <div
                key={char.id}
                className={`campaign-item ${isActive ? "active" : ""}`}
                onClick={() => handleSelectCharacter(char)}
              >
                <button
                  type="button"
                  className="item-remove-btn"
                  onClick={(e) => handleRequestDeleteCharacter(e, char)}
                  disabled={isStreaming}
                  title={`Remove ${char.name}`}
                >
                  <X size={13} />
                </button>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: "0.81rem" }}>
                      {char.name}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      {isActive && (
                        <span
                          style={{
                            fontSize: "0.62rem",
                            color: "var(--accent-amber)",
                            background: "rgba(245, 158, 11, 0.12)",
                            border: "1px solid rgba(245, 158, 11, 0.35)",
                            padding: "1px 4px",
                            borderRadius: 3,
                            fontWeight: 600,
                            flexShrink: 0,
                          }}
                        >
                          Active
                        </span>
                      )}
                      <span
                        style={{
                          fontSize: "0.65rem",
                          color: "var(--accent-amber)",
                          background: "rgba(245, 158, 11, 0.12)",
                          padding: "1px 4px",
                          borderRadius: 3,
                          flexShrink: 0,
                        }}
                      >
                        v{char.version ?? 1}
                      </span>
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: "0.71rem",
                      color: "var(--text-secondary)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {char.tagline}
                  </div>
                  {char.tags && char.tags.length > 0 && (
                    <div
                      style={{
                        display: "flex",
                        gap: 4,
                        marginTop: 3,
                        overflow: "hidden",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {char.tags.slice(0, 3).map((t) => (
                        <span
                          key={t}
                          style={{
                            fontSize: "0.62rem",
                            color: "var(--accent-cyan)",
                            background: "rgba(6, 182, 212, 0.1)",
                            padding: "0 4px",
                            borderRadius: 2,
                          }}
                        >
                          #{t}
                        </span>
                      ))}
                      {char.tags.length > 3 && (
                        <span style={{ fontSize: "0.62rem", color: "var(--text-muted)" }}>
                          +{char.tags.length - 3}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          }}
        />

        {/* 3. Worlds (+new) */}
        <SidebarCategory
          title="Worlds"
          icon={<Globe size={14} color="var(--accent-cyan)" />}
          items={worlds}
          searchPlaceholder="Search worlds..."
          onNewClick={() => setShowWorldWizard(true)}
          newButtonTitle="Create a new World & Spatial Graph with AI Wizard"
          filterFn={(w, q) =>
            w.name.toLowerCase().includes(q) ||
            w.global_rules.genre.toLowerCase().includes(q)
          }
          renderItem={(w) => {
            const isActive = campaignActiveWorldId === w.id;
            return (
              <div
                key={w.id}
                className={`campaign-item ${isActive ? "active" : ""}`}
                onClick={() => handleSelectWorld(w)}
              >
                <button
                  type="button"
                  className="item-remove-btn"
                  onClick={(e) => handleRequestDeleteWorld(e, w)}
                  disabled={isStreaming}
                  title={`Remove ${w.name}`}
                >
                  <X size={13} />
                </button>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
                    <div style={{ fontWeight: 600, fontSize: "0.81rem" }}>
                      {w.name}
                    </div>
                    {isActive && (
                      <span
                        style={{
                          fontSize: "0.62rem",
                          color: "var(--accent-amber)",
                          background: "rgba(245, 158, 11, 0.12)",
                          border: "1px solid rgba(245, 158, 11, 0.35)",
                          padding: "1px 4px",
                          borderRadius: 3,
                          fontWeight: 600,
                          flexShrink: 0,
                        }}
                      >
                        Active
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: "0.71rem",
                      color: "var(--text-secondary)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {w.global_rules.genre} • {w.locations.length} locations
                  </div>
                </div>
              </div>
            );
          }}
        />

        {/* 4. Campaigns (+new) */}
        <SidebarCategory
          title="Campaigns"
          icon={<FolderKanban size={14} color="var(--accent-emerald)" />}
          items={campaigns}
          searchPlaceholder="Search campaigns..."
          onNewClick={
            worlds.length > 0 && characters.length > 0
              ? () => setShowNewCampaignModal(true)
              : undefined
          }
          newButtonTitle="Start a new campaign with selected Character, World & Persona"
          filterFn={(camp, q) => camp.name.toLowerCase().includes(q)}
          renderItem={(camp) => (
            <div
              key={camp.id}
              className={`campaign-item ${
                bundle?.campaign.id === camp.id ? "active" : ""
              }`}
              onClick={() => loadCampaignBundle(camp.id)}
            >
              <button
                type="button"
                className="item-remove-btn"
                onClick={(e) => handleRequestDeleteCampaign(e, camp)}
                disabled={isStreaming}
                title={`Delete campaign ${camp.name}`}
              >
                <X size={13} />
              </button>
              <div
                style={{
                  fontWeight: 600,
                  fontSize: "0.81rem",
                  minWidth: 0,
                  flex: 1,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {camp.name}
              </div>
            </div>
          )}
        />

        {/* Bottom User Profile & Admin Area */}
        <div className="sidebar-bottom-area">
          <RelaySidebarBadge />
          {/* Notes Button sitting directly above user profile */}
          <div
            className={`sidebar-notes-btn ${showNotesFlyout ? "active" : ""}`}
            onClick={() => setShowNotesFlyout((prev) => !prev)}
            title="Open Player Notes scratchpad"
          >
            <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
              <StickyNote size={15} color="var(--accent-amber)" />
              <span style={{ fontWeight: 600, fontSize: "0.81rem", color: "var(--text-primary)" }}>
                Player Notes
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {notes.length > 0 && (
                <span className="notes-pill-count">
                  {notes.filter((n) => n.is_starred).length > 0
                    ? `★ ${notes.filter((n) => n.is_starred).length}`
                    : notes.length}
                </span>
              )}
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: "2px 5px", fontSize: "0.7rem" }}
                onClick={(e) => {
                  e.stopPropagation();
                  setNotesModalInitialId(undefined);
                  setShowNotesModal(true);
                  setShowNotesFlyout(false);
                }}
                title="New Note / Manage All"
              >
                <Plus size={12} />
              </button>
            </div>
          </div>

          <div
            className="sidebar-user-card"
            onClick={() => {
              setProfileInitialTab("identity");
              setShowProfileModal(true);
            }}
            title="Open User Profile, Password & Passkeys"
          >
            <User size={15} color="var(--accent-cyan)" />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontWeight: 600,
                  fontSize: "0.8rem",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span
                  style={{
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {currentUser.display_name || currentUser.username}
                </span>
                <span className={`role-pill role-${currentUser.role}`}>
                  {currentUser.role}
                </span>
              </div>
              <div
                style={{
                  fontSize: "0.69rem",
                  color: "var(--text-muted)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                @{currentUser.username}
                {singleUserMode ? " • Single-user mode" : ""}
              </div>
            </div>
            {!singleUserMode && (
              <button
                type="button"
                className="btn"
                style={{ padding: "4px 7px", fontSize: "0.7rem" }}
                onClick={(e) => {
                  e.stopPropagation();
                  handleLogout();
                }}
                title="Sign out"
              >
                <LogOut size={13} />
              </button>
            )}
          </div>

          {currentUser.role === "admin" && (
            <button
              type="button"
              className="btn sidebar-admin-btn"
              onClick={() => {
                setAdminInitialTab("users");
                setShowAdminModal(true);
              }}
              title="Open Admin Area"
            >
              <UserCog size={14} color="var(--accent-amber)" />
              <span>Admin Area</span>
            </button>
          )}
        </div>
      </aside>
      )}

      {/* Quick Player Notes Flyout Drawer */}
      {showNotesFlyout && (
        <NotesFlyout
          isOpen={showNotesFlyout}
          notes={notes}
          contextTags={noteContextTags}
          activeCampaignName={bundle?.campaign?.name}
          activeWorldName={(campaignWorld || activeWorld)?.name}
          activeCharacterName={(campaignCharacter || activeCharacter)?.name}
          onClose={() => setShowNotesFlyout(false)}
          onOpenModal={(noteId) => {
            setNotesModalInitialId(noteId);
            setShowNotesModal(true);
          }}
          onToggleStar={handleToggleNoteStar}
          onQuickAdd={handleQuickAddNote}
          onDeleteNote={handleDeleteNote}
        />
      )}

      {/* Center Roleplay Stage or Central Home Screen */}
      {bundle && campaignCharacter ? (
        <ChatStage
          bundle={bundle}
          character={campaignCharacter}
          pendingLocationOverrideId={pendingLocationOverrideId}
          isStreaming={isStreaming}
          isPhase4Running={isPhase4Running}
          phase3Progress={phase3Progress}
          phase4ProgressByTurn={phase4ProgressByTurn}
          liveStream={liveStream}
          streamError={streamError}
          onOpenSettings={handleOpenModelSettings}
          onSendTurn={handleSendTurn}
          onCheckoutTurn={handleCheckoutTurn}
          onDeleteLastTurn={handleDeleteLastTurn}
          onCloseCampaign={handleCloseCampaign}
        />
      ) : (
        <HomeScreen
          personas={personas}
          characters={characters}
          worlds={worlds}
          campaigns={campaigns}
          activePersona={activePersona}
          currentUser={currentUser}
          singleUserMode={singleUserMode}
          notesCount={notes.length}
          onSelectCampaign={(c) => loadCampaignBundle(c.id)}
          onInspectCharacter={(c) => setInspectingCharacter(c)}
          onInspectWorld={(w) => setInspectingWorld(w)}
          onEditPersona={(p) => {
            setEditingPersona(p);
            setShowPersonaModal(true);
          }}
          onSetActivePersona={(p) => handleSetDefaultPersona(p)}
          onNewCampaign={() => {
            if (worlds.length > 0 && characters.length > 0) {
              setShowNewCampaignModal(true);
            } else if (worlds.length === 0) {
              setShowWorldWizard(true);
            } else {
              setShowCharWizard(true);
            }
          }}
          onNewCharacter={() => setShowCharWizard(true)}
          onNewWorld={() => setShowWorldWizard(true)}
          onNewPersona={() => {
            setEditingPersona(null);
            setShowPersonaModal(true);
          }}
          onOpenProfile={() => {
            setProfileInitialTab("identity");
            setProfileInitialSubTab(undefined);
            setShowProfileModal(true);
          }}
          onOpenAdmin={() => {
            setAdminInitialTab("users");
            setShowAdminModal(true);
          }}
          onOpenProviders={() => {
            if (currentUser?.role === "admin") {
              setAdminInitialTab("providers");
              setShowAdminModal(true);
            } else {
              setProfileInitialTab("preferences");
              setProfileInitialSubTab("providers");
              setShowProfileModal(true);
            }
          }}
          effectiveActorModel={
            profileModels?.effective_actor_profile
              ? {
                  providerId: profileModels.effective_actor_profile.provider_id,
                  model: profileModels.effective_actor_profile.model,
                  contextSize: profileModels.effective_actor_profile.context_size,
                }
              : appSettings?.actor_profile
              ? {
                  providerId: appSettings.actor_profile.provider_id,
                  model: appSettings.actor_profile.model,
                  contextSize: appSettings.actor_profile.context_size,
                }
              : null
          }
          allowUserProviders={Boolean(
            profileModels?.allow_user_providers ?? appSettings?.allow_user_providers
          )}
          onOpenNotes={() => {
            setNotesModalInitialId(undefined);
            setShowNotesModal(true);
          }}
          onLogout={handleLogout}
          onDeleteCampaign={(camp) => handleRequestDeleteCampaign(undefined, camp)}
          onDeleteCharacter={(char) => handleRequestDeleteCharacter(undefined, char)}
          onDeleteWorld={(w) => handleRequestDeleteWorld(undefined, w)}
          onDeletePersona={(p) => handleRequestDeletePersona(undefined, p)}
          onRefreshData={async () => {
            const [c, w, p, camp] = await Promise.all([
              api.listCharacters(),
              api.listWorlds(),
              api.listPersonas(),
              api.listCampaigns(),
            ]);
            setCharacters(c);
            setWorlds(w);
            setPersonas(p);
            setCampaigns(camp);
          }}
          onOpenCharacterWizardWithDraft={(draft, autoWorld, preassignedId) => {
            setWizardInitialDraft(draft);
            setWizardInitialWorldDraft(autoWorld);
            setWizardInitialPreassignedId(preassignedId || null);
            setShowCharWizard(true);
          }}
        />
      )}

      {/* Right Live World & Mind Inspector (rendered only when campaign is open) */}
      {bundle && campaignWorld && campaignCharacter && (
        <LiveInspector
          bundle={bundle}
          world={campaignWorld}
          character={campaignCharacter}
          participants={characters.filter((ch) =>
            campaignActiveCharacterIds.has(ch.id)
          )}
          memoryConfig={appSettings?.memory_config}
          pendingLocationOverrideId={pendingLocationOverrideId}
          onOverrideLocation={handleOverrideLocation}
          onCreateLinkedLocation={handleCreateLinkedLocation}
          onAddEdge={handleConnectLocations}
          onDeleteEdge={handleDeleteCampaignEdge}
          onUpdateEdgeDistance={handleUpdateCampaignEdgeDistance}
          onToggleItemEquip={handleToggleItemEquip}
          onUpdateCampaignMemories={handleUpdateCampaignMemories}
          onSaveCampaignLocationLore={handleSaveCampaignLocationLore}
          onSaveCampaignContainerLore={handleSaveCampaignContainerLore}
          onCheckoutTurn={handleCheckoutTurn}
          isMutatingLocked={isStreaming || isPhase4Running}
          worlds={worlds}
        />
      )}

      {/* Modals */}
      {deleteTarget && (
        <div className="modal-backdrop">
          <div className="modal-panel" style={{ width: "min(480px, 92vw)" }}>
            <div className="modal-header">
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  color: "#fda4af",
                }}
              >
                <AlertTriangle size={18} />
                {deleteTarget.kind === "campaign"
                  ? "Delete Campaign & Timeline"
                  : deleteTarget.kind === "world"
                  ? "Remove World"
                  : deleteTarget.kind === "persona"
                  ? "Delete User Persona"
                  : "Remove Character"}
              </span>
              <button
                type="button"
                className="btn"
                onClick={() => setDeleteTarget(null)}
                disabled={isDeleting}
              >
                <X size={15} />
              </button>
            </div>

            <div className="modal-body" style={{ fontSize: "0.86rem", lineHeight: 1.55 }}>
              {deleteTarget.kind === "campaign" ? (
                <p>
                  Are you sure you want to delete campaign{" "}
                  <strong style={{ color: "var(--accent-amber)" }}>
                    "{deleteTarget.campaign.name}"
                  </strong>
                  ? This will permanently remove the campaign and its entire
                  timeline branch tree, episodic memories, and improvised
                  locations.
                </p>
              ) : deleteTarget.kind === "world" ? (
                <>
                  <p>
                    Are you sure you want to remove world{" "}
                    <strong style={{ color: "var(--accent-cyan)" }}>
                      "{deleteTarget.world.name}"
                    </strong>
                    ?
                  </p>
                  {deleteTarget.campaignsUsing.length > 0 ? (
                    <div
                      className="cog-step"
                      style={{
                        borderColor: "rgba(34, 211, 238, 0.4)",
                        fontSize: "0.8rem",
                      }}
                    >
                      <strong style={{ color: "var(--accent-cyan)" }}>
                        Used in {deleteTarget.campaignsUsing.length} active
                        campaign(s):
                      </strong>{" "}
                      {deleteTarget.campaignsUsing.map((c) => c.name).join(", ")}
                      <div style={{ marginTop: 4, color: "var(--text-secondary)" }}>
                        This world will be marked <em>pending deletion</em> and
                        hidden from your world list immediately, while its
                        spatial graph and lore remain available to those running
                        campaigns until they are removed.
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                      This world is not referenced by any running campaigns and
                      will be permanently pruned.
                    </div>
                  )}
                </>
              ) : deleteTarget.kind === "persona" ? (
                <>
                  <p>
                    Are you sure you want to delete persona{" "}
                    <strong style={{ color: "var(--accent-emerald)" }}>
                      "{deleteTarget.persona.name}"
                    </strong>
                    ?
                  </p>
                  {deleteTarget.campaignsUsing.length > 0 ? (
                    <div
                      className="cog-step"
                      style={{
                        borderColor: "rgba(16, 185, 129, 0.4)",
                        fontSize: "0.8rem",
                      }}
                    >
                      <strong style={{ color: "var(--accent-emerald)" }}>
                        Referenced by {deleteTarget.campaignsUsing.length} active
                        campaign(s):
                      </strong>{" "}
                      {deleteTarget.campaignsUsing.map((c) => c.name).join(", ")}
                      <div style={{ marginTop: 4, color: "var(--text-secondary)" }}>
                        Active campaigns will continue unaffected because each campaign
                        maintains its own frozen persona snapshot.
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                      This persona template will be permanently removed.
                    </div>
                  )}
                </>
              ) : (
                <>
                  <p>
                    Are you sure you want to remove character{" "}
                    <strong style={{ color: "var(--accent-amber)" }}>
                      "{deleteTarget.character.name}"
                    </strong>
                    ?
                  </p>
                  {deleteTarget.campaignsUsing.length > 0 ? (
                    <div
                      className="cog-step"
                      style={{
                        borderColor: "rgba(245, 158, 11, 0.4)",
                        fontSize: "0.8rem",
                      }}
                    >
                      <strong style={{ color: "var(--accent-amber)" }}>
                        Used in {deleteTarget.campaignsUsing.length} active
                        campaign(s):
                      </strong>{" "}
                      {deleteTarget.campaignsUsing.map((c) => c.name).join(", ")}
                      <div style={{ marginTop: 4, color: "var(--text-secondary)" }}>
                        This character will be marked <em>pending deletion</em>{" "}
                        and hidden from your character list immediately, while
                        remaining available to those running campaigns until
                        they are removed.
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                      This character is not referenced by any running campaigns
                      and will be permanently pruned.
                    </div>
                  )}
                </>
              )}

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 10,
                  marginTop: 8,
                }}
              >
                <button
                  type="button"
                  className="btn"
                  onClick={() => setDeleteTarget(null)}
                  disabled={isDeleting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={handleConfirmDelete}
                  disabled={isDeleting}
                >
                  {isDeleting
                    ? "Removing..."
                    : deleteTarget.kind === "campaign"
                    ? "Delete Campaign"
                    : deleteTarget.kind === "world"
                    ? "Remove World"
                    : deleteTarget.kind === "persona"
                    ? "Delete Persona"
                    : "Remove Character"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showCharWizard && (
        <CharacterWizardModal
          worlds={worlds}
          defaultWorldId={
            worlds.find((w) => w.id === activeWorld?.id)?.id ??
            worlds[0]?.id ??
            ""
          }
          initialDraft={wizardInitialDraft}
          initialPreassignedId={wizardInitialPreassignedId}
          initialWorldDraft={wizardInitialWorldDraft}
          onClose={() => {
            setShowCharWizard(false);
            setWizardInitialDraft(null);
            setWizardInitialWorldDraft(null);
            setWizardInitialPreassignedId(null);
          }}
          onCreated={async (createdChar, launchWorldId) => {
            setShowCharWizard(false);
            setWizardInitialDraft(null);
            setWizardInitialWorldDraft(null);
            setWizardInitialPreassignedId(null);
            const [cList, wList] = await Promise.all([
              api.listCharacters(),
              api.listWorlds(),
            ]);
            setCharacters(cList);
            setWorlds(wList);
            setActiveCharacter(createdChar);
            if (launchWorldId) {
              const targetWorld =
                wList.find((w) => w.id === launchWorldId) ?? wList[0];
              if (targetWorld) {
                const newBundle = await api.createCampaign({
                  name: `${createdChar.name} in ${targetWorld.name}`,
                  world_id: targetWorld.id,
                  character_id: createdChar.id,
                  persona_id: activePersona?.id,
                });
                const allCamps = await api.listCampaigns();
                setCampaigns(allCamps);
                setBundle(newBundle);
                try {
                  localStorage.setItem(ACTIVE_CAMPAIGN_STORAGE_KEY, newBundle.campaign.id);
                } catch {}
                setCampaignWorld(targetWorld);
                setCampaignCharacter(createdChar);
                setActiveWorld(targetWorld);
              }
            }
          }}
        />
      )}

      {showWorldWizard && (
        <WorldWizardModal
          onClose={() => setShowWorldWizard(false)}
          onCreated={async (createdWorld) => {
            setShowWorldWizard(false);
            const wList = await api.listWorlds();
            setWorlds(wList);
            setActiveWorld(createdWorld);
          }}
        />
      )}

      {inspectingCharacter && (
        <CharacterInspectorModal
          character={inspectingCharacter}
          worlds={worlds}
          onClose={() => setInspectingCharacter(null)}
          onSaved={async (updatedChar, closeModal = true) => {
            if (closeModal) {
              setInspectingCharacter(null);
            } else {
              setInspectingCharacter(updatedChar);
            }
            const cList = await api.listCharacters();
            setCharacters(cList);
            setActiveCharacter(updatedChar);
            // If updated in-place (not used by any campaign), keep campaignCharacter synced if matching
            if (campaignCharacter?.id === updatedChar.id) {
              setCampaignCharacter(updatedChar);
            }
          }}
        />
      )}

      {inspectingWorld && (
        <WorldInspectorModal
          world={inspectingWorld}
          onClose={() => setInspectingWorld(null)}
          onSaved={async (updatedWorld) => {
            setInspectingWorld(null);
            const [wList, cList] = await Promise.all([
              api.listWorlds(),
              api.listCharacters(),
            ]);
            setWorlds(wList);
            setCharacters(cList);
            setActiveWorld(updatedWorld);
            // If updated in-place (not used by any campaign), keep campaignWorld synced if matching
            if (campaignWorld?.id === updatedWorld.id) {
              setCampaignWorld(updatedWorld);
            }
          }}
        />
      )}

      {showProfileModal && currentUser && (
        <ProfileModal
          user={currentUser}
          singleUserMode={singleUserMode}
          initialTab={profileInitialTab}
          initialSubTab={profileInitialSubTab}
          onClose={() => {
            setShowProfileModal(false);
            setProfileInitialSubTab(undefined);
            void api.getProfileModels().then(setProfileModels).catch(() => {});
          }}
          onUserUpdated={async (updated) => {
            setCurrentUser(updated);
            await refreshAuthStatus();
          }}
          onAccountReset={async () => {
            await loadWorkspaceData();
          }}
          onAccountDeleted={handleAccountDeleted}
        />
      )}

      {showAdminModal && currentUser && currentUser.role === "admin" && (
        <AdminModal
          currentUser={currentUser}
          singleUserMode={singleUserMode}
          initialTab={adminInitialTab}
          onClose={() => {
            setShowAdminModal(false);
            void api.getProfileModels().then(setProfileModels).catch(() => {});
          }}
          onCurrentUserUpdated={async (updated) => {
            setCurrentUser(updated);
            await refreshAuthStatus();
          }}
          onAccountDeleted={async (deletedUserId) => {
            if (deletedUserId === currentUser.id) {
              await handleAccountDeleted();
            }
          }}
          onSettingsUpdated={(updated) => {
            setAppSettings(updated);
            void api.getProfileModels().then(setProfileModels).catch(() => {});
          }}
        />
      )}

      {/* Full Notes Manager Modal */}
      {showNotesModal && (
        <NotesModal
          isOpen={showNotesModal}
          notes={notes}
          initialSelectedId={notesModalInitialId}
          contextTags={noteContextTags}
          activeCampaignName={bundle?.campaign?.name}
          activeWorldName={(campaignWorld || activeWorld)?.name}
          activeCharacterName={(campaignCharacter || activeCharacter)?.name}
          onClose={() => {
            setShowNotesModal(false);
            setNotesModalInitialId(undefined);
          }}
          onSaveNote={handleSaveNote}
          onDeleteNote={handleDeleteNote}
          onToggleStar={handleToggleNoteStar}
        />
      )}

      {showPersonaModal && (
        <PersonaEditorModal
          persona={editingPersona}
          isDefault={Boolean(editingPersona && activePersona?.id === editingPersona.id)}
          onClose={() => {
            setShowPersonaModal(false);
            setEditingPersona(null);
          }}
          onSetDefault={(p) => handleSetDefaultPersona(p)}
          onSaved={async (savedPersona) => {
            const list = await api.listPersonas();
            setPersonas(list);
            if (!activePersona || activePersona.id === savedPersona.id) {
              handleSetDefaultPersona(savedPersona);
            }
            setShowPersonaModal(false);
            setEditingPersona(null);
          }}
          onDeleted={async () => {
            const list = await api.listPersonas();
            setPersonas(list);
            const nextDef = list[0] ?? null;
            if (nextDef) {
              handleSetDefaultPersona(nextDef);
            } else {
              setActivePersona(null);
              try {
                localStorage.removeItem(DEFAULT_PERSONA_STORAGE_KEY);
              } catch {}
            }
            setShowPersonaModal(false);
            setEditingPersona(null);
          }}
        />
      )}

      {showNewCampaignModal && (
        <NewCampaignModal
          worlds={worlds}
          characters={characters}
          personas={personas}
          initialWorldId={activeWorld?.id}
          initialCharacterId={activeCharacter?.id}
          initialPersonaId={activePersona?.id}
          onClose={() => setShowNewCampaignModal(false)}
          onOpenPersonaModal={() => {
            setEditingPersona(null);
            setShowPersonaModal(true);
          }}
          onCreate={async (payload) => {
            const created = await api.createCampaign(payload);
            const allCamps = await api.listCampaigns();
            setCampaigns(allCamps);
            setBundle(created);
            try {
              localStorage.setItem(ACTIVE_CAMPAIGN_STORAGE_KEY, created.campaign.id);
            } catch {}
            const w = worlds.find((item) => item.id === payload.world_id) ?? worlds[0];
            const primaryId = payload.focus_character_id || payload.character_id || payload.character_ids?.[0];
            const c = characters.find((item) => item.id === primaryId) ?? characters[0];
            setCampaignWorld(w);
            setCampaignCharacter(c);
            setActiveWorld(w);
            setActiveCharacter(c);
            if (payload.persona_id) {
              const p = personas.find((item) => item.id === payload.persona_id) ?? null;
              setActivePersona(p);
            }
          }}
        />
      )}
    </div>
    </LocalRelayProvider>
  );
};
