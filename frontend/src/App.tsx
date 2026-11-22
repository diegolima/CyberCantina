import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  setOnUnauthorizedHandler,
  setStoredSessionToken,
} from "./api";
import {
  AuthScreen,
  InitialSetupScreen,
} from "./components/AuthModals";
import { ChatStage } from "./components/ChatStage";
import { type DeleteTarget } from "./components/DeleteConfirmationModal";
import { LiveInspector } from "./components/LiveInspector";
import { HomeScreen } from "./components/HomeScreen";
import { AppSidebar } from "./components/AppSidebar";
import { AppModals } from "./components/AppModals";
import { NotesFlyout } from "./components/NotesDrawer";
import {
  WorldInspectorModal,
  type WorldTab,
} from "./components/world/WorldInspectorModal";
import { PartyManagementModal } from "./components/party/PartyManagementModal";
import { StoryModal, type StoryModalTab } from "./components/story/StoryModal";
import { ExportCampaignModal } from "./components/ExportCampaignModal";
import { countVisibleTimelines } from "./components/story/branchGraphLayout";
import { buildCampaignCharacterEntries } from "./components/world/codexHelpers";
import { LocalRelayProvider } from "./providers/LocalRelayContext";
import { useCampaignTurnActions } from "./hooks/useCampaignTurnActions";
import { useResponsiveCampaignLayout } from "./hooks/useResponsiveCampaignLayout";
import { getShellClassNames } from "./utils/campaignLayout";
import { slugifyTag } from "./utils/noteSearch";
import { formatPartyActionTurnMessage } from "./utils/partyCommand";
import { getActiveParties } from "./utils/partyHelpers";
import {
  AppSettings,
  AuthSessionResponse,
  CampaignRecord,
  CampaignStateBundle,
  CharacterRecord,
  PersonaRecord,
  ProfileModelSettingsResponse,
  PublicAdminMessage,
  UserNote,
  UserProfile,
  WorldRecord,
} from "./types";

export const App: React.FC = () => {
  const [authChecking, setAuthChecking] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);
  const [singleUserMode, setSingleUserMode] = useState(false);
  const [allowSelfRegistration, setAllowSelfRegistration] = useState(true);
  const [inactiveUserPurgeDays, setInactiveUserPurgeDays] = useState<number | null>(null);
  const [loginMessages, setLoginMessages] = useState<PublicAdminMessage[]>([]);
  const [homeMessages, setHomeMessages] = useState<PublicAdminMessage[]>([]);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [profileInitialTab, setProfileInitialTab] = useState<
    "identity" | "account" | "preferences" | "models" | "prompts" | "behavior"
  >("preferences");
  const [profileInitialSubTab, setProfileInitialSubTab] = useState<
    "behavior" | "prompts" | "models" | "providers" | undefined
  >(undefined);
  const [adminInitialTab, setAdminInitialTab] = useState<
    "users" | "providers" | "models" | "prompts" | "server" | "communication"
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
  const [campaignWorldSheetTab, setCampaignWorldSheetTab] =
    useState<WorldTab | null>(null);
  const [storyModalTab, setStoryModalTab] = useState<StoryModalTab | null>(null);
  const [scrollTargetTurn, setScrollTargetTurn] = useState<{
    turnId: string;
    nonce: number;
    highlight?: boolean;
  } | null>(null);
  const [focusComposerNonce, setFocusComposerNonce] = useState(0);
  const [isPartyModalOpen, setIsPartyModalOpen] = useState(false);
  const [exportingCampaign, setExportingCampaign] =
    useState<CampaignRecord | null>(null);
  const [showPersonaModal, setShowPersonaModal] = useState(false);
  const [editingPersona, setEditingPersona] = useState<PersonaRecord | null>(null);
  const [showNewCampaignModal, setShowNewCampaignModal] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);

  const [showCharWizard, setShowCharWizard] = useState(false);
  const [showWorldWizard, setShowWorldWizard] = useState(false);
  const [wizardInitialDraft, setWizardInitialDraft] = useState<any>(null);
  const [wizardInitialWorldDraft, setWizardInitialWorldDraft] = useState<any>(null);
  const [wizardInitialPreassignedId, setWizardInitialPreassignedId] = useState<string | null>(null);
  const [wizardInitialMediaWarning, setWizardInitialMediaWarning] = useState<string | null>(null);

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

  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const {
    isStreaming,
    phase3Progress,
    isPhase4Running,
    phase4ProgressByTurn,
    streamError,
    pendingLocationOverrideId,
    setPendingLocationOverrideId,
    liveStream,
    handleSendTurn,
    handleOverrideLocation,
    handleOverrideCharacterLocation,
    handleCreateNpcParty,
    handleDisbandParty,
    handleUpdateCampaignWorldSettings,
    handleToggleItemEquip,
    handleUpdateCampaignMemories,
    handleSaveCampaignLocationLore,
    handleSaveCampaignContainerLore,
    handleSaveCampaignMap,
    handleCheckoutTurn,
    handleDeleteLastTurn,
    handleUpdateTurnBookmark,
    handleSummarizeTurnForBookmark,
  } = useCampaignTurnActions({
    bundle,
    setBundle,
    setCampaignWorld,
  });

  const ACTIVE_CAMPAIGN_STORAGE_KEY = "cybercantina_active_campaign_id";
  const DEFAULT_PERSONA_STORAGE_KEY = "cybercantina_default_persona_id";

  const handlePanelOpened = useCallback(() => {
    setShowNotesFlyout(false);
  }, []);

  const layout = useResponsiveCampaignLayout({
    hasCampaign: Boolean(bundle),
    hasTopPopoverOpen: showNotesFlyout,
    onPanelOpened: handlePanelOpened,
  });

  // Close overlay drawer automatically when NotesFlyout opens on tablet/mobile.
  useEffect(() => {
    if (showNotesFlyout && layout.activeOverlayDrawer !== "none") {
      layout.closeOverlays();
    }
  }, [showNotesFlyout, layout.activeOverlayDrawer, layout.closeOverlays]);

  const handleSetDefaultPersona = (p: PersonaRecord) => {
    setActivePersona(p);
    try {
      localStorage.setItem(DEFAULT_PERSONA_STORAGE_KEY, p.id);
    } catch {}
  };

  const loadCampaignBundle = async (
    campaignId: string,
    catalogWorlds?: WorldRecord[],
    catalogCharacters?: CharacterRecord[]
  ) => {
    setPendingLocationOverrideId(null);
    setCampaignWorldSheetTab(null);
    setStoryModalTab(null);
    setScrollTargetTurn(null);
    setIsPartyModalOpen(false);
    layout.closeOverlays();
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
    const liveWorlds = (catalogWorlds ?? worlds).filter((item) => !item.pending_deletion);
    const liveChars = (catalogCharacters ?? characters).filter((item) => !item.pending_deletion);
    const nextActiveWorld = !w.pending_deletion
      ? w
      : liveWorlds.find((item) => item.name === w.name) ?? liveWorlds[0] ?? null;
    const nextActiveCharacter = !c.pending_deletion
      ? c
      : liveChars.find((item) => item.name === c.name) ?? liveChars[0] ?? null;
    setActiveWorld(nextActiveWorld);
    setActiveCharacter(nextActiveCharacter);
  };

  const storyMetrics = useMemo(() => {
    if (!bundle) {
      return { timelineCount: 0, storyAttention: false };
    }
    const lastTurn =
      bundle.active_branch_turns[bundle.active_branch_turns.length - 1];
    const storyAttention = Boolean(
      lastTurn &&
        bundle.episodic_chunks.some((c) => c.leaf_turn_id === lastTurn.id)
    );
    const timelineCount = countVisibleTimelines(
      bundle.all_turn_nodes,
      bundle.active_branch_turns,
      bundle.campaign.active_leaf_turn_id
    );
    return { timelineCount, storyAttention };
  }, [bundle]);

  const handleZoomToStoryTurn = useCallback((turnId: string) => {
    setStoryModalTab(null);
    setScrollTargetTurn({ turnId, nonce: Date.now(), highlight: true });
  }, []);

  const handleSwitchStoryTimeline = useCallback(
    async (tipTurnId: string) => {
      await handleCheckoutTurn(tipTurnId);
      setStoryModalTab(null);
      setScrollTargetTurn({ turnId: tipTurnId, nonce: Date.now(), highlight: false });
    },
    [handleCheckoutTurn]
  );

  const handleBranchFromStoryTurn = useCallback(
    async (turnId: string) => {
      await handleCheckoutTurn(turnId);
      setStoryModalTab(null);
      setFocusComposerNonce((n) => n + 1);
    },
    [handleCheckoutTurn]
  );

  const handleCloseCampaign = () => {
    try {
      localStorage.removeItem(ACTIVE_CAMPAIGN_STORAGE_KEY);
    } catch {}
    setBundle(null);
    setCampaignWorld(null);
    setCampaignCharacter(null);
    setCampaignWorldSheetTab(null);
    setStoryModalTab(null);
    setScrollTargetTurn(null);
    setIsPartyModalOpen(false);
  };

  const refreshHomeMessages = async () => {
    try {
      const msgs = await api.getHomeMessages();
      setHomeMessages(msgs);
    } catch {
      setHomeMessages([]);
    }
  };

  const loadWorkspaceData = async () => {
    const [camps, wList, cList, cfg, userNotes, personaList, profModels, homeMsgs] = await Promise.all([
      api.listCampaigns(),
      api.listWorlds(),
      api.listCharacters(),
      api.getSettings(),
      api.listNotes().catch(() => [] as UserNote[]),
      api.listPersonas().catch(() => [] as PersonaRecord[]),
      api.getProfileModels().catch(() => null),
      api.getHomeMessages().catch(() => [] as PublicAdminMessage[]),
    ]);
    setHomeMessages(homeMsgs);
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
      await loadCampaignBundle(activeCamp.id, wList, cList);
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
    setAllowSelfRegistration(status.allow_self_registration ?? true);
    setInactiveUserPurgeDays(status.inactive_user_purge_days ?? null);
    setLoginMessages(status.login_messages ?? []);
    if (status.single_user_mode) {
      setHomeMessages([]);
    }
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

  const handleRequestDeleteWorld = async (
    e: React.MouseEvent | undefined,
    world: WorldRecord
  ) => {
    e?.stopPropagation();
    if (isStreaming) return;
    const using = campaigns.filter((c) => c.world_id === world.id);
    let siblingMediaCampaignsCount = 0;
    let mediaCount = (world.media ?? []).length;
    try {
      const impact = await api.getWorldDeleteImpact(world.id);
      siblingMediaCampaignsCount = impact.sibling_campaigns_sharing_media || 0;
      mediaCount = impact.media_count ?? mediaCount;
    } catch {
      // Fallback to local metadata if impact check fails
    }
    setDeleteTarget({
      kind: "world",
      world,
      campaignsUsing: using,
      siblingMediaCampaignsCount,
      mediaCount,
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
        if (activeCharacter?.id === deleteTarget.character.id) {
          setActiveCharacter(updatedChars[0] ?? null);
        }
      } else if (deleteTarget.kind === "world") {
        await api.deleteWorld(deleteTarget.world.id);
        const updatedWorlds = await api.listWorlds();
        setWorlds(updatedWorlds);
        if (activeWorld?.id === deleteTarget.world.id) {
          setActiveWorld(updatedWorlds[0] ?? null);
        }
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
          setCampaignWorldSheetTab(null);
          setIsPartyModalOpen(false);
        }
      }
      setDeleteTarget(null);
    } finally {
      setIsDeleting(false);
    }
  };

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

  const campaignParticipants = useMemo(
    () => characters.filter((ch) => campaignActiveCharacterIds.has(ch.id)),
    [characters, campaignActiveCharacterIds]
  );

  const liftedCodexCharacters = useMemo(
    () =>
      bundle && campaignCharacter
        ? buildCampaignCharacterEntries(
            bundle,
            campaignCharacter,
            campaignParticipants
          )
        : [],
    [bundle, campaignCharacter, campaignParticipants]
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
        allowSelfRegistration={allowSelfRegistration}
        loginMessages={loginMessages}
        onAuthenticated={handleAuthenticated}
      />
    );
  }

  return (
    <LocalRelayProvider currentUser={currentUser}>
    <div className={getShellClassNames(layout, Boolean(bundle))}>
      {bundle && layout.showBackdrop && (
        <div
          className="drawer-backdrop"
          onClick={layout.closeOverlays}
          aria-hidden="true"
        />
      )}
      {/* Left Sidebar: Campaign Context, Close Campaign & Campaign Tools */}
      <AppSidebar
        mode={layout.leftMode}
        onToggleCollapse={layout.toggleSidebar}
        onCloseOverlay={layout.closeOverlays}
        bundle={bundle}
        worldName={campaignWorld?.name}
        codexCount={campaignWorld?.lore_nodes.length ?? 0}
        isCodexOpen={campaignWorldSheetTab === "codex"}
        onOpenCodex={() => {
          layout.closeOverlays();
          setCampaignWorldSheetTab("codex");
        }}
        storyCount={
          storyMetrics.timelineCount > 1
            ? storyMetrics.timelineCount
            : bundle?.episodic_chunks.length ?? 0
        }
        hasStoryAttention={storyMetrics.storyAttention}
        isStoryOpen={storyModalTab !== null}
        onOpenStory={() => {
          layout.closeOverlays();
          setStoryModalTab("summary");
        }}
        partyCount={getActiveParties(bundle).length}
        isPartyOpen={isPartyModalOpen}
        onOpenParty={() => {
          layout.closeOverlays();
          setIsPartyModalOpen(true);
        }}
        onExportCampaign={
          bundle ? () => setExportingCampaign(bundle.campaign) : undefined
        }
        notes={notes}
        showNotesFlyout={showNotesFlyout}
        setShowNotesFlyout={setShowNotesFlyout}
        currentUser={currentUser}
        singleUserMode={singleUserMode}
        setNotesModalInitialId={setNotesModalInitialId}
        setShowNotesModal={setShowNotesModal}
        setProfileInitialTab={setProfileInitialTab}
        setShowProfileModal={setShowProfileModal}
        setAdminInitialTab={setAdminInitialTab}
        setShowAdminModal={setShowAdminModal}
        handleCloseCampaign={handleCloseCampaign}
        handleLogout={handleLogout}
      />

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
          scrollTargetTurn={scrollTargetTurn}
          focusComposerNonce={focusComposerNonce}
          onOpenStoryTimelines={() => {
            layout.closeOverlays();
            setStoryModalTab("timelines");
          }}
          showSidebarToggle={layout.showMobileMenuButton}
          isSidebarOpen={layout.isSidebarOpen}
          onToggleSidebar={layout.toggleSidebar}
          isInspectorOpen={layout.isInspectorOpen}
          onToggleInspector={layout.toggleInspector}
          hasInspectorAttention={Boolean(pendingLocationOverrideId)}
          onUpdateTurnBookmark={handleUpdateTurnBookmark}
          onSummarizeTurnForBookmark={handleSummarizeTurnForBookmark}
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
          homeMessages={homeMessages}
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
            setProfileInitialTab("preferences");
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
          onExportCampaign={(camp) => setExportingCampaign(camp)}
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
          onOpenCharacterWizardWithDraft={(draft, autoWorld, preassignedId, mediaWarning) => {
            setWizardInitialDraft(draft);
            setWizardInitialWorldDraft(autoWorld);
            setWizardInitialPreassignedId(preassignedId || null);
            setWizardInitialMediaWarning(mediaWarning ?? null);
            setShowCharWizard(true);
          }}
        />
      )}

      {/* Right Live World & Mind Inspector (rendered only when campaign is open) */}
      {bundle && campaignWorld && campaignCharacter && (
        <LiveInspector
          mode={layout.rightMode}
          onClose={layout.toggleInspector}
          bundle={bundle}
          world={campaignWorld}
          character={campaignCharacter}
          participants={campaignParticipants}
          pendingLocationOverrideId={pendingLocationOverrideId}
          onOverrideLocation={handleOverrideLocation}
          onOverrideCharacterLocation={handleOverrideCharacterLocation}
          onOpenWorldSheet={() => setCampaignWorldSheetTab("base")}
          onSaveCampaignMap={handleSaveCampaignMap}
          onToggleItemEquip={handleToggleItemEquip}
          onUpdateCampaignMemories={handleUpdateCampaignMemories}
          onSaveCampaignLocationLore={handleSaveCampaignLocationLore}
          onSaveCampaignContainerLore={handleSaveCampaignContainerLore}
          isMutatingLocked={isStreaming || isPhase4Running}
          worlds={worlds}
        />
      )}

      {/* Lifted Campaign Story & Branch Graph Modal */}
      {bundle && storyModalTab !== null && (
        <StoryModal
          isOpen={storyModalTab !== null}
          initialTab={storyModalTab}
          onClose={() => setStoryModalTab(null)}
          bundle={bundle}
          memoryConfig={appSettings?.memory_config}
          isMutatingLocked={isStreaming || isPhase4Running}
          onZoomToTurn={handleZoomToStoryTurn}
          onSwitchTimeline={handleSwitchStoryTimeline}
          onBranchFromTurn={handleBranchFromStoryTurn}
        />
      )}

      {/* Running Campaign Export Modal */}
      {exportingCampaign && (
        <ExportCampaignModal
          campaign={exportingCampaign}
          onClose={() => setExportingCampaign(null)}
        />
      )}

      {/* Lifted Campaign World Sheet / Codex Modal (rendered outside inspector container) */}
      {bundle && campaignWorld && campaignCharacter && campaignWorldSheetTab !== null && (
        <WorldInspectorModal
          key={`${bundle.campaign.id}:${campaignWorldSheetTab}`}
          world={{
            ...campaignWorld,
            containers: bundle.containers ?? campaignWorld.containers ?? [],
            locations: bundle.visible_locations,
            edges: bundle.visible_edges ?? campaignWorld.edges,
          }}
          mode="campaign"
          initialTab={campaignWorldSheetTab}
          campaignId={bundle.campaign.id}
          activePersona={bundle.campaign.persona_snapshot ?? null}
          campaignCharacters={liftedCodexCharacters}
          activeLocationId={bundle.active_location.id}
          visitedContainerIds={
            bundle.current_world_snapshot.visited_container_ids ?? []
          }
          campaignWorldSettings={bundle.campaign.world_settings}
          appSettings={appSettings}
          isAdmin={currentUser.role === "admin"}
          isMutatingLocked={isStreaming || isPhase4Running}
          onSaveCampaignWorldSettings={handleUpdateCampaignWorldSettings}
          onClose={() => setCampaignWorldSheetTab(null)}
          onSaved={() => setCampaignWorldSheetTab(null)}
        />
      )}

      {/* Lifted Party Management Modal */}
      {bundle && campaignWorld && isPartyModalOpen && (() => {
        const activeParties = getActiveParties(bundle);
        const charRecordMap: Record<string, CharacterRecord> = {
          ...(bundle.character_records ?? {}),
        };
        for (const p of campaignParticipants) {
          if (p.id && !charRecordMap[p.id]) {
            charRecordMap[p.id] = p;
          }
        }
        const nameMap: Record<string, string> = Object.fromEntries(
          Object.values(charRecordMap).map((c) => [c.id, c.name])
        );
        return (
          <PartyManagementModal
            isOpen={isPartyModalOpen}
            onClose={() => setIsPartyModalOpen(false)}
            parties={activeParties}
            activeLocationId={bundle.active_location.id}
            locations={bundle.visible_locations}
            presentCharacterIds={bundle.present_character_ids ?? []}
            characterRecords={charRecordMap}
            characterStates={bundle.character_states ?? {}}
            personaName={bundle.campaign.persona_snapshot?.name ?? null}
            isMutatingLocked={isStreaming || isPhase4Running}
            onSubmitPartyTurn={(action) => {
              void handleSendTurn({
                userMessage: formatPartyActionTurnMessage(action, nameMap),
                diceMode: "auto",
                partyAction: action,
              });
            }}
            onOverrideCharacterLocation={handleOverrideCharacterLocation}
            onCreateNpcParty={handleCreateNpcParty}
            onDisbandNpcParty={handleDisbandParty}
          />
        );
      })()}

      {/* Modals */}
      <AppModals
        ACTIVE_CAMPAIGN_STORAGE_KEY={ACTIVE_CAMPAIGN_STORAGE_KEY}
        DEFAULT_PERSONA_STORAGE_KEY={DEFAULT_PERSONA_STORAGE_KEY}
        currentUser={currentUser}
        setCurrentUser={setCurrentUser}
        singleUserMode={singleUserMode}
        worlds={worlds}
        setWorlds={setWorlds}
        characters={characters}
        setCharacters={setCharacters}
        personas={personas}
        setPersonas={setPersonas}
        setCampaigns={setCampaigns}
        notes={notes}
        bundle={bundle}
        setBundle={setBundle}
        activeWorld={activeWorld}
        setActiveWorld={setActiveWorld}
        activeCharacter={activeCharacter}
        setActiveCharacter={setActiveCharacter}
        activePersona={activePersona}
        setActivePersona={setActivePersona}
        campaignWorld={campaignWorld}
        setCampaignWorld={setCampaignWorld}
        campaignCharacter={campaignCharacter}
        setCampaignCharacter={setCampaignCharacter}
        inspectingCharacter={inspectingCharacter}
        setInspectingCharacter={setInspectingCharacter}
        inspectingWorld={inspectingWorld}
        setInspectingWorld={setInspectingWorld}
        noteContextTags={noteContextTags}
        deleteTarget={deleteTarget}
        setDeleteTarget={setDeleteTarget}
        isDeleting={isDeleting}
        handleConfirmDelete={handleConfirmDelete}
        showCharWizard={showCharWizard}
        setShowCharWizard={setShowCharWizard}
        wizardInitialDraft={wizardInitialDraft}
        setWizardInitialDraft={setWizardInitialDraft}
        wizardInitialPreassignedId={wizardInitialPreassignedId}
        setWizardInitialPreassignedId={setWizardInitialPreassignedId}
        wizardInitialWorldDraft={wizardInitialWorldDraft}
        setWizardInitialWorldDraft={setWizardInitialWorldDraft}
        wizardInitialMediaWarning={wizardInitialMediaWarning}
        setWizardInitialMediaWarning={setWizardInitialMediaWarning}
        showWorldWizard={showWorldWizard}
        setShowWorldWizard={setShowWorldWizard}
        showProfileModal={showProfileModal}
        setShowProfileModal={setShowProfileModal}
        profileInitialTab={profileInitialTab}
        profileInitialSubTab={profileInitialSubTab}
        setProfileInitialSubTab={setProfileInitialSubTab}
        setProfileModels={setProfileModels}
        showAdminModal={showAdminModal}
        setShowAdminModal={setShowAdminModal}
        adminInitialTab={adminInitialTab}
        inactiveUserPurgeDays={inactiveUserPurgeDays}
        appSettings={appSettings}
        setAppSettings={setAppSettings}
        onMessagesUpdated={async () => {
          await Promise.all([refreshAuthStatus(), refreshHomeMessages()]);
        }}
        showNotesModal={showNotesModal}
        setShowNotesModal={setShowNotesModal}
        notesModalInitialId={notesModalInitialId}
        setNotesModalInitialId={setNotesModalInitialId}
        showPersonaModal={showPersonaModal}
        setShowPersonaModal={setShowPersonaModal}
        editingPersona={editingPersona}
        setEditingPersona={setEditingPersona}
        showNewCampaignModal={showNewCampaignModal}
        setShowNewCampaignModal={setShowNewCampaignModal}
        handleSaveNote={handleSaveNote}
        handleDeleteNote={handleDeleteNote}
        handleToggleNoteStar={handleToggleNoteStar}
        handleSetDefaultPersona={handleSetDefaultPersona}
        handleAccountDeleted={handleAccountDeleted}
        refreshAuthStatus={refreshAuthStatus}
        loadWorkspaceData={loadWorkspaceData}
      />
    </div>
    </LocalRelayProvider>
  );
};
