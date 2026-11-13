import React from "react";
import { api } from "../api";
import { AdminModal, ProfileModal } from "./AuthModals";
import { DeleteConfirmationModal, type DeleteTarget } from "./DeleteConfirmationModal";
import {
  CharacterInspectorModal,
  WorldInspectorModal,
} from "./EntityEditorModals";
import { NewCampaignModal } from "./NewCampaignModal";
import { NotesModal } from "./NotesDrawer";
import { PersonaEditorModal } from "./PersonaEditorModal";
import { CharacterWizardModal, WorldWizardModal } from "./WizardModals";
import {
  AppSettings,
  CampaignRecord,
  CampaignStateBundle,
  CharacterRecord,
  CharacterWizardDraft,
  PersonaRecord,
  ProfileModelSettingsResponse,
  UserNote,
  UserProfile,
  WorldRecord,
  WorldWizardDraft,
} from "../types";

export interface AppModalsProps {
  ACTIVE_CAMPAIGN_STORAGE_KEY: string;
  DEFAULT_PERSONA_STORAGE_KEY: string;
  currentUser: UserProfile;
  setCurrentUser: React.Dispatch<React.SetStateAction<UserProfile | null>>;
  singleUserMode: boolean;
  worlds: WorldRecord[];
  setWorlds: React.Dispatch<React.SetStateAction<WorldRecord[]>>;
  characters: CharacterRecord[];
  setCharacters: React.Dispatch<React.SetStateAction<CharacterRecord[]>>;
  personas: PersonaRecord[];
  setPersonas: React.Dispatch<React.SetStateAction<PersonaRecord[]>>;
  setCampaigns: React.Dispatch<React.SetStateAction<CampaignRecord[]>>;
  notes: UserNote[];
  bundle: CampaignStateBundle | null;
  setBundle: React.Dispatch<React.SetStateAction<CampaignStateBundle | null>>;
  activeWorld: WorldRecord | null;
  setActiveWorld: React.Dispatch<React.SetStateAction<WorldRecord | null>>;
  activeCharacter: CharacterRecord | null;
  setActiveCharacter: React.Dispatch<React.SetStateAction<CharacterRecord | null>>;
  activePersona: PersonaRecord | null;
  setActivePersona: React.Dispatch<React.SetStateAction<PersonaRecord | null>>;
  campaignWorld: WorldRecord | null;
  setCampaignWorld: React.Dispatch<React.SetStateAction<WorldRecord | null>>;
  campaignCharacter: CharacterRecord | null;
  setCampaignCharacter: React.Dispatch<React.SetStateAction<CharacterRecord | null>>;
  inspectingCharacter: CharacterRecord | null;
  setInspectingCharacter: React.Dispatch<React.SetStateAction<CharacterRecord | null>>;
  inspectingWorld: WorldRecord | null;
  setInspectingWorld: React.Dispatch<React.SetStateAction<WorldRecord | null>>;
  noteContextTags: string[];
  deleteTarget: DeleteTarget | null;
  setDeleteTarget: React.Dispatch<React.SetStateAction<DeleteTarget | null>>;
  isDeleting: boolean;
  handleConfirmDelete: () => Promise<void>;
  showCharWizard: boolean;
  setShowCharWizard: React.Dispatch<React.SetStateAction<boolean>>;
  wizardInitialDraft: CharacterWizardDraft | null;
  setWizardInitialDraft: React.Dispatch<React.SetStateAction<CharacterWizardDraft | null>>;
  wizardInitialPreassignedId: string | null;
  setWizardInitialPreassignedId: React.Dispatch<React.SetStateAction<string | null>>;
  wizardInitialWorldDraft: WorldWizardDraft | null;
  setWizardInitialWorldDraft: React.Dispatch<React.SetStateAction<WorldWizardDraft | null>>;
  showWorldWizard: boolean;
  setShowWorldWizard: React.Dispatch<React.SetStateAction<boolean>>;
  showProfileModal: boolean;
  setShowProfileModal: React.Dispatch<React.SetStateAction<boolean>>;
  profileInitialTab: "identity" | "account" | "preferences" | "models" | "prompts" | "behavior";
  profileInitialSubTab: "behavior" | "prompts" | "models" | "providers" | undefined;
  setProfileInitialSubTab: React.Dispatch<
    React.SetStateAction<"behavior" | "prompts" | "models" | "providers" | undefined>
  >;
  setProfileModels: React.Dispatch<React.SetStateAction<ProfileModelSettingsResponse | null>>;
  showAdminModal: boolean;
  setShowAdminModal: React.Dispatch<React.SetStateAction<boolean>>;
  adminInitialTab: "users" | "providers" | "models" | "prompts";
  setAppSettings: React.Dispatch<React.SetStateAction<AppSettings | null>>;
  showNotesModal: boolean;
  setShowNotesModal: React.Dispatch<React.SetStateAction<boolean>>;
  notesModalInitialId: string | undefined;
  setNotesModalInitialId: React.Dispatch<React.SetStateAction<string | undefined>>;
  showPersonaModal: boolean;
  setShowPersonaModal: React.Dispatch<React.SetStateAction<boolean>>;
  editingPersona: PersonaRecord | null;
  setEditingPersona: React.Dispatch<React.SetStateAction<PersonaRecord | null>>;
  showNewCampaignModal: boolean;
  setShowNewCampaignModal: React.Dispatch<React.SetStateAction<boolean>>;
  handleSaveNote: (
    noteId: string | null,
    payload: {
      title: string;
      content: string;
      tags: string[];
      is_starred: boolean;
    }
  ) => Promise<UserNote | void>;
  handleDeleteNote: (noteId: string) => Promise<void>;
  handleToggleNoteStar: (note: UserNote) => Promise<void>;
  handleSetDefaultPersona: (persona: PersonaRecord) => void;
  handleAccountDeleted: () => Promise<void>;
  refreshAuthStatus: () => Promise<unknown>;
  loadWorkspaceData: () => Promise<void>;
}

export const AppModals: React.FC<AppModalsProps> = ({
  ACTIVE_CAMPAIGN_STORAGE_KEY,
  DEFAULT_PERSONA_STORAGE_KEY,
  currentUser,
  setCurrentUser,
  singleUserMode,
  worlds,
  setWorlds,
  characters,
  setCharacters,
  personas,
  setPersonas,
  setCampaigns,
  notes,
  bundle,
  setBundle,
  activeWorld,
  setActiveWorld,
  activeCharacter,
  setActiveCharacter,
  activePersona,
  setActivePersona,
  campaignWorld,
  setCampaignWorld,
  campaignCharacter,
  setCampaignCharacter,
  inspectingCharacter,
  setInspectingCharacter,
  inspectingWorld,
  setInspectingWorld,
  noteContextTags,
  deleteTarget,
  setDeleteTarget,
  isDeleting,
  handleConfirmDelete,
  showCharWizard,
  setShowCharWizard,
  wizardInitialDraft,
  setWizardInitialDraft,
  wizardInitialPreassignedId,
  setWizardInitialPreassignedId,
  wizardInitialWorldDraft,
  setWizardInitialWorldDraft,
  showWorldWizard,
  setShowWorldWizard,
  showProfileModal,
  setShowProfileModal,
  profileInitialTab,
  profileInitialSubTab,
  setProfileInitialSubTab,
  setProfileModels,
  showAdminModal,
  setShowAdminModal,
  adminInitialTab,
  setAppSettings,
  showNotesModal,
  setShowNotesModal,
  notesModalInitialId,
  setNotesModalInitialId,
  showPersonaModal,
  setShowPersonaModal,
  editingPersona,
  setEditingPersona,
  showNewCampaignModal,
  setShowNewCampaignModal,
  handleSaveNote,
  handleDeleteNote,
  handleToggleNoteStar,
  handleSetDefaultPersona,
  handleAccountDeleted,
  refreshAuthStatus,
  loadWorkspaceData,
}) => {
  return (
    <>
      <DeleteConfirmationModal
        deleteTarget={deleteTarget}
        isDeleting={isDeleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
      />
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
    </>
  );
};
