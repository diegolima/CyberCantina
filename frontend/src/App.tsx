import React, { useEffect, useMemo, useState } from "react";
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
import { LocalRelayProvider } from "./providers/LocalRelayContext";
import { useCampaignTurnActions } from "./hooks/useCampaignTurnActions";
import { slugifyTag } from "./utils/noteSearch";
import {
  AppSettings,
  AuthSessionResponse,
  CampaignRecord,
  CampaignStateBundle,
  CharacterRecord,
  PersonaRecord,
  ProfileModelSettingsResponse,
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
    "users" | "providers" | "models" | "prompts" | "server"
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
    handleToggleItemEquip,
    handleUpdateCampaignMemories,
    handleSaveCampaignLocationLore,
    handleSaveCampaignContainerLore,
    handleSaveCampaignMap,
    handleCheckoutTurn,
    handleDeleteLastTurn,
  } = useCampaignTurnActions({
    bundle,
    setBundle,
    setCampaignWorld,
  });

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
    setAllowSelfRegistration(status.allow_self_registration ?? true);
    setInactiveUserPurgeDays(status.inactive_user_purge_days ?? null);
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
        allowSelfRegistration={allowSelfRegistration}
        onAuthenticated={handleAuthenticated}
      />
    );
  }

  return (
    <LocalRelayProvider currentUser={currentUser}>
    <div className={`studio-shell ${!bundle ? "no-campaign" : ""}`}>
      {/* Left Sidebar: 4 Collapsible, Searchable, Paged Categories (Active in play mode) */}
      <AppSidebar
        bundle={bundle}
        personas={personas}
        characters={characters}
        worlds={worlds}
        campaigns={campaigns}
        campaignActiveWorldId={campaignActiveWorldId}
        campaignActivePersonaId={campaignActivePersonaId}
        campaignActiveCharacterIds={campaignActiveCharacterIds}
        notes={notes}
        showNotesFlyout={showNotesFlyout}
        setShowNotesFlyout={setShowNotesFlyout}
        currentUser={currentUser}
        singleUserMode={singleUserMode}
        isStreaming={isStreaming}
        setEditingPersona={setEditingPersona}
        setShowPersonaModal={setShowPersonaModal}
        setShowCharWizard={setShowCharWizard}
        setShowWorldWizard={setShowWorldWizard}
        setShowNewCampaignModal={setShowNewCampaignModal}
        setNotesModalInitialId={setNotesModalInitialId}
        setShowNotesModal={setShowNotesModal}
        setProfileInitialTab={setProfileInitialTab}
        setShowProfileModal={setShowProfileModal}
        setAdminInitialTab={setAdminInitialTab}
        setShowAdminModal={setShowAdminModal}
        handleCloseCampaign={handleCloseCampaign}
        handleRequestDeletePersona={handleRequestDeletePersona}
        handleSelectCharacter={handleSelectCharacter}
        handleRequestDeleteCharacter={handleRequestDeleteCharacter}
        handleSelectWorld={handleSelectWorld}
        handleRequestDeleteWorld={handleRequestDeleteWorld}
        loadCampaignBundle={loadCampaignBundle}
        handleRequestDeleteCampaign={handleRequestDeleteCampaign}
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
          bundle={bundle}
          world={campaignWorld}
          character={campaignCharacter}
          participants={characters.filter((ch) =>
            campaignActiveCharacterIds.has(ch.id)
          )}
          memoryConfig={appSettings?.memory_config}
          pendingLocationOverrideId={pendingLocationOverrideId}
          onOverrideLocation={handleOverrideLocation}
          onSaveCampaignMap={handleSaveCampaignMap}
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
        setAppSettings={setAppSettings}
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
