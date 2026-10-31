import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Flame,
  FolderKanban,
  GitBranch,
  Globe,
  LogOut,
  Plus,
  Search,
  StickyNote,
  User,
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
import { NotesFlyout, NotesModal } from "./components/NotesDrawer";
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
  CharacterRecord,
  CognitionBlock,
  CompassDirection,
  MemoryShard,
  NarrativeMode,
  PreTurnAnalysis,
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
  const [adminInitialTab, setAdminInitialTab] = useState<"users" | "models">(
    "users"
  );

  const [campaigns, setCampaigns] = useState<CampaignRecord[]>([]);
  const [worlds, setWorlds] = useState<WorldRecord[]>([]);
  const [characters, setCharacters] = useState<CharacterRecord[]>([]);
  const [bundle, setBundle] = useState<CampaignStateBundle | null>(null);
  const [campaignWorld, setCampaignWorld] = useState<WorldRecord | null>(null);
  const [campaignCharacter, setCampaignCharacter] =
    useState<CharacterRecord | null>(null);
  const [activeWorld, setActiveWorld] = useState<WorldRecord | null>(null);
  const [activeCharacter, setActiveCharacter] = useState<CharacterRecord | null>(
    null
  );
  const [inspectingCharacter, setInspectingCharacter] =
    useState<CharacterRecord | null>(null);
  const [inspectingWorld, setInspectingWorld] = useState<WorldRecord | null>(
    null
  );
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);

  const [showCharWizard, setShowCharWizard] = useState(false);
  const [showWorldWizard, setShowWorldWizard] = useState(false);

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
    | null
  >(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [isStreaming, setIsStreaming] = useState(false);
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
  } | null>(null);

  const loadCampaignBundle = async (campaignId: string) => {
    setPendingLocationOverrideId(null);
    const stateBundle = await api.getCampaignState(campaignId);
    setBundle(stateBundle);
    const [w, c] = await Promise.all([
      api.getWorld(stateBundle.campaign.world_id),
      api.getCharacter(stateBundle.campaign.character_id),
    ]);
    setCampaignWorld(w);
    setCampaignCharacter(c);
    setActiveWorld(w);
    setActiveCharacter(c);
  };

  const loadWorkspaceData = async () => {
    const [camps, wList, cList, cfg, userNotes] = await Promise.all([
      api.listCampaigns(),
      api.listWorlds(),
      api.listCharacters(),
      api.getSettings(),
      api.listNotes().catch(() => [] as UserNote[]),
    ]);
    setCampaigns(camps);
    setWorlds(wList);
    setCharacters(cList);
    setAppSettings(cfg);
    setNotes(userNotes);
    if (camps.length > 0) {
      await loadCampaignBundle(camps[0].id);
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
    await api.logout();
    const status = await refreshAuthStatus();
    if (!status.authenticated) {
      setCurrentUser(null);
      setBundle(null);
      setCampaigns([]);
      setWorlds([]);
      setCharacters([]);
      setNotes([]);
    }
  };

  const handleAccountDeleted = async () => {
    setShowProfileModal(false);
    setShowAdminModal(false);
    setStoredSessionToken(null);
    setCurrentUser(null);
    setBundle(null);
    setCampaigns([]);
    setWorlds([]);
    setCharacters([]);
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

  const handleCreateNewCampaign = async () => {
    if (worlds.length === 0 || characters.length === 0) return;
    const w = worlds.find((item) => item.id === activeWorld?.id) ?? worlds[0];
    const c =
      characters.find((item) => item.id === activeCharacter?.id) ??
      characters[0];
    const created = await api.createCampaign({
      name: `${c.name} in ${w.name}`,
      world_id: w.id,
      character_id: c.id,
    });
    const allCamps = await api.listCampaigns();
    setCampaigns(allCamps);
    setBundle(created);
    setCampaignWorld(w);
    setCampaignCharacter(c);
    setActiveWorld(w);
    setActiveCharacter(c);
  };

  const handleSelectCharacter = (char: CharacterRecord) => {
    setActiveCharacter(char);
    setInspectingCharacter(char);
  };

  const handleSelectWorld = (world: WorldRecord) => {
    setActiveWorld(world);
    setInspectingWorld(world);
  };

  const handleRequestDeleteCharacter = (
    e: React.MouseEvent,
    char: CharacterRecord
  ) => {
    e.stopPropagation();
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
    e: React.MouseEvent,
    world: WorldRecord
  ) => {
    e.stopPropagation();
    if (isStreaming) return;
    const using = campaigns.filter((c) => c.world_id === world.id);
    setDeleteTarget({
      kind: "world",
      world,
      campaignsUsing: using,
    });
  };

  const handleRequestDeleteCampaign = (
    e: React.MouseEvent,
    camp: CampaignRecord
  ) => {
    e.stopPropagation();
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
          if (updatedCamps.length > 0) {
            await loadCampaignBundle(updatedCamps[0].id);
          } else {
            setBundle(null);
          }
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
    manualDiceOverride?: number | null;
    narrativeMode?: NarrativeMode;
    narratorDirective?: string | null;
    durationMinutes?: number | null;
  }) => {
    if (!bundle) return;
    setIsStreaming(true);
    setStreamError(null);
    setLiveStream({
      userMessage: opts.userMessage,
      preTurn: null,
      recalledItems: [],
      cognitionRaw: "",
      cognitionParsed: null,
      proseText: "",
      phaseStatus:
        opts.narrativeMode && opts.narrativeMode !== "standard"
          ? "Invoking Neutral Scene Narrator..."
          : "Phase 1: Pre-Turn Analysis & GraphRAG...",
    });

    try {
      await streamCampaignTurn(
        bundle.campaign.id,
        {
          user_message: opts.userMessage,
          parent_turn_id: opts.parentTurnId ?? bundle.campaign.active_leaf_turn_id,
          manual_dice_override: opts.manualDiceOverride ?? null,
          override_location_id: pendingLocationOverrideId,
          narrative_mode: opts.narrativeMode,
          narrator_directive: opts.narratorDirective,
          duration_minutes: opts.durationMinutes,
        },
        {
          onPhase1Complete: (data) => {
            setLiveStream((prev) =>
              prev
                ? {
                    ...prev,
                    preTurn: data.pre_turn,
                    recalledItems: data.recalled_items,
                    phaseStatus: "Phase 3: Streaming <cognition> & Narrative...",
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
            setIsStreaming(false);
          },
          onPhase4Complete: async (data) => {
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
      setLiveStream(null);
    }
  };

  const handleOverrideLocation = async (locationId: string) => {
    if (!bundle || isStreaming) return;
    const updated = await api.overrideLocation(bundle.campaign.id, locationId);
    setBundle(updated);
    setPendingLocationOverrideId(locationId);
  };

  const handleToggleItemEquip = async (payload: {
    item: string;
    action: "equip" | "unequip" | "remove" | "add";
    target?: "equipped" | "inventory";
    character_id?: string;
  }) => {
    if (!bundle || isStreaming) return;
    try {
      const updated = await api.toggleItemEquip(bundle.campaign.id, payload);
      setBundle(updated);
    } catch (err) {
      console.error("Failed to manage item equipment/inventory:", err);
    }
  };

  const handleUpdateCampaignMemories = async (
    characterId: string,
    memoryShards: MemoryShard[]
  ) => {
    if (!bundle || isStreaming) return;
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

  const handleCreateLinkedLocation = async (payload: {
    from_location_id: string;
    name: string;
    compass_direction: string;
    travel_minutes: number;
    description: string;
    environmental_tags: string[];
  }): Promise<string | void> => {
    if (!bundle || isStreaming) return;
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
    if (!bundle || isStreaming) return;
    const updated = await api.connectCampaignLocations(bundle.campaign.id, payload);
    setBundle(updated);
    const updatedWorld = await api.getWorld(updated.campaign.world_id);
    setCampaignWorld(updatedWorld);
  };

  const handleDeleteCampaignEdge = async (edgeId: string) => {
    if (!bundle || isStreaming) return;
    const updated = await api.removeCampaignEdge(bundle.campaign.id, edgeId, true);
    setBundle(updated);
    const updatedWorld = await api.getWorld(updated.campaign.world_id);
    setCampaignWorld(updatedWorld);
  };

  const handleUpdateCampaignEdgeDistance = async (payload: {
    edgeId: string;
    travel_minutes: number;
  }) => {
    if (!bundle || isStreaming) return;
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
    if (!bundle || isStreaming) return;
    setPendingLocationOverrideId(null);
    const updated = await api.checkoutBranch(bundle.campaign.id, turnId);
    setBundle(updated);
  };

  const handleDeleteLastTurn = async () => {
    if (!bundle || isStreaming) return;
    setStreamError(null);
    setPendingLocationOverrideId(null);
    const updated = await api.deleteLastTurn(bundle.campaign.id);
    setBundle(updated);
    const updatedWorld = await api.getWorld(updated.campaign.world_id);
    setCampaignWorld(updatedWorld);
  };

  const activeBranchSet = new Set(
    bundle?.active_branch_turns.map((t) => t.id) ?? []
  );

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
    <div className="studio-shell">
      {/* Left Sidebar: 4 Collapsible, Searchable, Paged Categories */}
      <aside className="sidebar">
        <div className="brand-header">
          <div className="brand-title">
            <Flame size={20} color="var(--accent-amber)" />
            <span>CYBERCANTINA</span>
          </div>
        </div>

        {/* 1. Characters (+new) */}
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
          renderItem={(char) => (
            <div
              key={char.id}
              className={`campaign-item ${
                activeCharacter?.id === char.id ? "active" : ""
              }`}
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
          )}
        />

        {/* 2. Worlds (+new) */}
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
          renderItem={(w) => (
            <div
              key={w.id}
              className={`campaign-item ${
                activeWorld?.id === w.id ? "active" : ""
              }`}
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
                <div style={{ fontWeight: 600, fontSize: "0.81rem" }}>
                  {w.name}
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
          )}
        />

        {/* 3. Campaigns (+new) */}
        <SidebarCategory
          title="Campaigns"
          icon={<FolderKanban size={14} color="var(--accent-emerald)" />}
          items={campaigns}
          searchPlaceholder="Search campaigns..."
          onNewClick={
            worlds.length > 0 && characters.length > 0
              ? handleCreateNewCampaign
              : undefined
          }
          newButtonTitle="Start a new campaign with the selected Character & World"
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

        {/* 4. Timeline Branch Tree */}
        <SidebarCategory
          title="Timeline Branch Tree"
          icon={<GitBranch size={14} color="var(--accent-violet)" />}
          items={bundle?.all_turn_nodes ?? []}
          searchPlaceholder="Search turns..."
          filterFn={(node, q) =>
            `turn #${node.depth_index}`.includes(q) ||
            node.user_message.toLowerCase().includes(q) ||
            node.raw_prose.toLowerCase().includes(q) ||
            node.world_snapshot.world_timestamp.toLowerCase().includes(q)
          }
          renderItem={(node) => {
            const inActive = activeBranchSet.has(node.id);
            const isLeaf = node.id === bundle?.campaign.active_leaf_turn_id;
            return (
              <div
                key={node.id}
                className={`branch-node-item ${
                  inActive ? "in-active-branch" : ""
                } ${isLeaf ? "is-leaf" : ""}`}
                style={{ marginLeft: Math.min(node.depth_index * 6, 36) }}
                onClick={() => handleCheckoutTurn(node.id)}
                title="Click to checkout this timeline branch and roll back world/spatial/memory state"
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontWeight: 600,
                    color: isLeaf
                      ? "var(--accent-amber)"
                      : inActive
                      ? "#e2e8f0"
                      : "var(--text-muted)",
                  }}
                >
                  <span>Turn #{node.depth_index}</span>
                  <span>{node.world_snapshot.world_timestamp.split(" ")[1]}</span>
                </div>
                <div
                  style={{
                    color: "var(--text-secondary)",
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
          }}
        />

        {/* Bottom User Profile & Admin Area */}
        <div className="sidebar-bottom-area">
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

      {/* Center Roleplay Stage */}
      {bundle && campaignCharacter ? (
        <ChatStage
          bundle={bundle}
          character={campaignCharacter}
          isStreaming={isStreaming}
          liveStream={liveStream}
          streamError={streamError}
          onOpenSettings={handleOpenModelSettings}
          onSendTurn={handleSendTurn}
          onCheckoutTurn={handleCheckoutTurn}
          onDeleteLastTurn={handleDeleteLastTurn}
        />
      ) : (
        <main
          className="chat-stage"
          style={{
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            padding: 24,
            textAlign: "center",
          }}
        >
          <div style={{ color: "var(--text-secondary)", fontSize: "0.95rem" }}>
            {campaigns.length === 0
              ? "No active campaigns remaining. Create a new campaign or character to start roleplaying."
              : "Select or create a campaign from the left sidebar."}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {worlds.length > 0 && characters.length > 0 && (
              <button
                type="button"
                className="btn btn-amber"
                onClick={handleCreateNewCampaign}
              >
                <Plus size={14} /> New Campaign
              </button>
            )}
            <button
              type="button"
              className="btn"
              onClick={() => setShowCharWizard(true)}
            >
              <Plus size={14} /> New Character
            </button>
          </div>
        </main>
      )}

      {/* Right Live World & Mind Inspector */}
      {bundle && campaignWorld && campaignCharacter ? (
        <LiveInspector
          bundle={bundle}
          world={campaignWorld}
          character={campaignCharacter}
          participants={characters.filter((ch) =>
            (bundle.campaign.participant_character_ids ?? [bundle.campaign.character_id]).includes(ch.id)
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
          worlds={worlds}
        />
      ) : (
        <aside className="inspector" />
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
          onClose={() => setShowCharWizard(false)}
          onCreated={async (createdChar, launchWorldId) => {
            setShowCharWizard(false);
            const [cList, wList] = await Promise.all([
              api.listCharacters(),
              api.listWorlds(),
            ]);
            setCharacters(cList);
            setWorlds(wList);
            setActiveCharacter(createdChar);
            const targetWorld =
              wList.find((w) => w.id === launchWorldId) ?? wList[0];
            if (targetWorld) {
              const newBundle = await api.createCampaign({
                name: `${createdChar.name} in ${targetWorld.name}`,
                world_id: targetWorld.id,
                character_id: createdChar.id,
              });
              const allCamps = await api.listCampaigns();
              setCampaigns(allCamps);
              setBundle(newBundle);
              setCampaignWorld(targetWorld);
              setCampaignCharacter(createdChar);
              setActiveWorld(targetWorld);
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
          onSaved={async (updatedChar) => {
            setInspectingCharacter(null);
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
          onClose={() => setShowProfileModal(false)}
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
          onClose={() => setShowAdminModal(false)}
          onCurrentUserUpdated={async (updated) => {
            setCurrentUser(updated);
            await refreshAuthStatus();
          }}
          onAccountDeleted={async (deletedUserId) => {
            if (deletedUserId === currentUser.id) {
              await handleAccountDeleted();
            }
          }}
          onSettingsUpdated={(updated) => setAppSettings(updated)}
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
    </div>
  );
};
