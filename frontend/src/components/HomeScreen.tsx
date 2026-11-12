import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Computer,
  Cpu,
  Download,
  FileArchive,
  Flame,
  FolderKanban,
  Globe,
  LogOut,
  Plus,
  StickyNote,
  Upload,
  User,
  UserCheck,
  UserCog,
  Users,
  X,
} from "lucide-react";
import { useOptionalLocalRelay } from "../providers/LocalRelayContext";
import {
  CampaignRecord,
  CharacterRecord,
  PersonaRecord,
  UserProfile,
  WorldRecord,
} from "../types";
import {
  EntityCategory,
  getCategoryPrimaryImages,
} from "../utils/entityImages";
import { HomeEntityPickerModal } from "./HomeEntityPickerModal";
import { ExportBundleModal } from "./ExportBundleModal";
import { ImportPreviewModal } from "./ImportPreviewModal";

export interface HomeScreenProps {
  personas: PersonaRecord[];
  characters: CharacterRecord[];
  worlds: WorldRecord[];
  campaigns: CampaignRecord[];
  activePersona: PersonaRecord | null;
  currentUser: UserProfile | null;
  singleUserMode: boolean;
  notesCount?: number;
  onSelectCampaign: (campaign: CampaignRecord) => void;
  onInspectCharacter: (character: CharacterRecord) => void;
  onInspectWorld: (world: WorldRecord) => void;
  onEditPersona: (persona: PersonaRecord) => void;
  onNewCampaign: () => void;
  onNewCharacter: () => void;
  onNewWorld: () => void;
  onNewPersona: () => void;
  onSetActivePersona: (persona: PersonaRecord) => void;
  onOpenProfile: () => void;
  onOpenAdmin: () => void;
  onOpenProviders?: () => void;
  onOpenNotes: () => void;
  effectiveActorModel?: {
    providerId?: string | null;
    model?: string;
    contextSize?: number | null;
  } | null;
  allowUserProviders?: boolean;
  onLogout: () => void;
  onDeleteCampaign?: (campaign: CampaignRecord) => void;
  onDeleteCharacter?: (character: CharacterRecord) => void;
  onDeleteWorld?: (world: WorldRecord) => void;
  onDeletePersona?: (persona: PersonaRecord) => void;
  onRefreshData?: () => void;
  onOpenCharacterWizardWithDraft?: (draft: any, autoWorld?: any, preassignedId?: string) => void;
}

interface HomeCardProps {
  category: EntityCategory;
  title: string;
  singular: string;
  count: number;
  countLabel: string;
  watermarkIcon: React.ReactNode;
  accentColor: string;
  images: string[];
  imagePosition?: "top" | "center";
  onCardClick: () => void;
  onNewClick: () => void;
}

const HomeCard: React.FC<HomeCardProps> = ({
  title,
  singular,
  count,
  countLabel,
  watermarkIcon,
  accentColor,
  images,
  imagePosition = "center",
  onCardClick,
  onNewClick,
}) => {
  const [activeIdx, setActiveIdx] = useState(0);

  // Rotate images every 12 seconds when more than 1 image is present
  useEffect(() => {
    if (images.length <= 1) return;
    const interval = setInterval(() => {
      if (document.hidden) return;
      setActiveIdx((prev) => (prev + 1) % images.length);
    }, 12000);
    return () => clearInterval(interval);
  }, [images.length]);

  return (
    <div
      className="home-card"
      style={
        {
          "--card-accent-color": accentColor,
        } as React.CSSProperties
      }
    >
      {/* Background Carousel Images */}
      <div className="home-card-bg-container">
        {images.map((imgUrl, idx) => (
          <img
            key={imgUrl}
            src={imgUrl}
            alt=""
            loading="lazy"
            className={`home-card-bg-image align-${imagePosition} ${
              images.length === 1 || idx === activeIdx ? "active" : ""
            }`}
          />
        ))}
      </div>

      {/* Dark gradient scrim overlay */}
      <div className="home-card-scrim" />

      {/* Large Centered Watermark Icon - Fallback ONLY when no images are available */}
      {images.length === 0 && (
        <div className="home-card-watermark">{watermarkIcon}</div>
      )}

      {/* Upper Main Clickable Zone (Opens Selector Modal) */}
      <div
        className="home-card-main-zone"
        onClick={onCardClick}
        title={`Browse & select ${title.toLowerCase()}`}
      >
        {/* Subtle Carousel Progress Dots in Top Right */}
        {images.length > 1 && (
          <div
            className="home-card-carousel-dots"
            title={`Cycling ${images.length} images (12s)`}
          >
            {images.map((_, dotIdx) => (
              <span
                key={dotIdx}
                className={`home-carousel-dot ${
                  dotIdx === activeIdx ? "active" : ""
                }`}
              />
            ))}
          </div>
        )}

        {/* Centralized Title and Glanceable Count */}
        <div className="home-card-center-block">
          <div className="home-card-title">{title}</div>
          <div className="home-card-count">
            {count} {countLabel}
          </div>
        </div>
      </div>

      {/* Full-width Bottom "+ New" Shelf */}
      <div
        className="home-card-new-shelf"
        onClick={(e) => {
          e.stopPropagation();
          onNewClick();
        }}
        title={`Create new ${singular}`}
      >
        <Plus size={14} className="home-card-new-shelf-icon" />
        <span>New {singular}</span>
      </div>
    </div>
  );
};

export const HomeScreen: React.FC<HomeScreenProps> = ({
  personas,
  characters,
  worlds,
  campaigns,
  activePersona,
  currentUser,
  singleUserMode,
  notesCount,
  onSelectCampaign,
  onInspectCharacter,
  onInspectWorld,
  onEditPersona,
  onNewCampaign,
  onNewCharacter,
  onNewWorld,
  onNewPersona,
  onSetActivePersona,
  onOpenProfile,
  onOpenAdmin,
  onOpenProviders,
  onOpenNotes,
  effectiveActorModel,
  allowUserProviders = false,
  onLogout,
  onDeleteCampaign,
  onDeleteCharacter,
  onDeleteWorld,
  onDeletePersona,
  onRefreshData,
  onOpenCharacterWizardWithDraft,
}) => {
  const relay = useOptionalLocalRelay();
  const [activePickerCategory, setActivePickerCategory] = useState<EntityCategory | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [droppedFile, setDroppedFile] = useState<File | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [preloadingWebGpu, setPreloadingWebGpu] = useState(false);
  const [preloadError, setPreloadError] = useState<string | null>(null);

  const dismissKey = currentUser
    ? `cantina_webgpu_notice_dismissed_v1:${currentUser.id}`
    : "cantina_webgpu_notice_dismissed_v1";
  const [noticeDismissed, setNoticeDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(dismissKey) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      setNoticeDismissed(localStorage.getItem(dismissKey) === "1");
    } catch {
      setNoticeDismissed(false);
    }
  }, [dismissKey]);

  const activeActorProvider = useMemo(
    () =>
      effectiveActorModel?.providerId
        ? relay?.allProviders.find((p) => p.id === effectiveActorModel.providerId)
        : undefined,
    [effectiveActorModel?.providerId, relay?.allProviders]
  );

  const showWebGpuNotice =
    !noticeDismissed && activeActorProvider?.type === "webgpu";
  const canConfigureProviders =
    currentUser?.role === "admin" || allowUserProviders;

  const dismissWebGpuNotice = () => {
    setNoticeDismissed(true);
    try {
      localStorage.setItem(dismissKey, "1");
    } catch {
      // ignore storage errors
    }
  };

  // Extract primary images (at most 1 per entity) for each category
  const personaImages = useMemo(() => getCategoryPrimaryImages("personas", personas), [personas]);
  const characterImages = useMemo(() => getCategoryPrimaryImages("characters", characters), [characters]);
  const worldImages = useMemo(() => getCategoryPrimaryImages("worlds", worlds), [worlds]);
  const campaignImages = useMemo(() => getCategoryPrimaryImages("campaigns", campaigns), [campaigns]);

  const handleOpenPicker = (category: EntityCategory) => {
    setActivePickerCategory(category);
  };

  const handlePickerNewClick = (category: EntityCategory) => {
    switch (category) {
      case "personas":
        onNewPersona();
        break;
      case "characters":
        onNewCharacter();
        break;
      case "worlds":
        onNewWorld();
        break;
      case "campaigns":
        onNewCampaign();
        break;
    }
  };

  return (
    <main
      className="home-screen"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDraggingOver(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setIsDraggingOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDraggingOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) {
          setDroppedFile(f);
          setShowImportModal(true);
        }
      }}
    >
      {/* Top Hub Navigation Bar */}
      <header className="home-navbar">
        <div className="home-nav-brand">
          <Flame size={20} color="var(--accent-amber)" />
          <span>CYBERCANTINA</span>
        </div>

        <div className="home-nav-actions">
          {/* Notes button */}
          <button
            type="button"
            className="home-nav-btn"
            onClick={onOpenNotes}
            title="Open Notes Manager"
          >
            <StickyNote size={14} color="var(--accent-amber)" />
            <span>Notes</span>
            {notesCount !== undefined && notesCount > 0 && (
              <span className="home-nav-badge">{notesCount}</span>
            )}
          </button>

          {/* Admin area button (role-gated) */}
          {currentUser?.role === "admin" && (
            <button
              type="button"
              className="home-nav-btn"
              onClick={onOpenAdmin}
              title="Open Admin Area"
            >
              <UserCog size={14} color="var(--accent-amber)" />
              <span>Admin Area</span>
            </button>
          )}

          {/* User profile widget */}
          {currentUser && (
            <div
              className="home-nav-profile-chip"
              onClick={onOpenProfile}
              title="Open Profile, Password & Passkeys"
            >
              <User size={14} color="var(--accent-cyan)" />
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{
                    fontWeight: 600,
                    fontSize: "0.8rem",
                    color: "var(--text-primary)",
                  }}
                >
                  {currentUser.display_name || currentUser.username}
                </span>
                <span className={`role-pill role-${currentUser.role}`}>
                  {currentUser.role}
                </span>
              </div>
            </div>
          )}

          {/* Sign Out Button (if not singleUserMode) */}
          {currentUser && !singleUserMode && (
            <button
              type="button"
              className="home-nav-btn"
              style={{ padding: "5px 9px" }}
              onClick={onLogout}
              title="Sign out"
            >
              <LogOut size={13} />
            </button>
          )}
        </div>
      </header>

      <div className="home-body">
        <div className="home-container">
          {/* Hero Header */}
          <div className="home-header">
            <div className="home-title">
              <Computer size={32} color="var(--accent-amber)" />
              <span>Control Deck</span>
            </div>
            <div className="home-subtitle">
              Welcome to your central control deck. Explore worlds, manage characters, configure personas, or dive straight into active campaigns.
            </div>
          </div>

          {showWebGpuNotice && (
            <div
              className={`home-webgpu-notice ${
                relay?.webgpuSupported === false ? "is-unsupported" : ""
              }`}
              role="status"
            >
              <div className="home-webgpu-notice-icon">
                {relay?.webgpuSupported === false ? (
                  <AlertTriangle size={18} color="var(--accent-amber)" />
                ) : (
                  <Cpu size={18} color="var(--accent-violet)" />
                )}
              </div>
              <div className="home-webgpu-notice-body">
                <div className="home-webgpu-notice-title">
                  {relay?.webgpuSupported === false
                    ? "Browser WebGPU is unavailable on this browser or GPU"
                    : "In-Browser WebGPU is pre-configured out of the box"}
                </div>
                <div className="home-webgpu-notice-text">
                  {relay?.webgpuSupported === false ? (
                    <>
                      {relay.webgpuError || "This browser cannot run WebGPU models."}{" "}
                      Add a <strong>Local Ollama (Browser)</strong> or{" "}
                      <strong>OpenRouter</strong> provider to start generating turns.
                    </>
                  ) : (
                    <>
                      Ready to play with{" "}
                      <code>{effectiveActorModel?.model || "Qwen2.5-3B-Instruct"}</code>{" "}
                      running locally on your browser GPU (first turn downloads ~2.5 GB
                      into browser cache, 4k context cap). For optimal speed, larger
                      models, and 12k+ context, we recommend adding a{" "}
                      <strong>Local Ollama</strong> or <strong>OpenRouter</strong>{" "}
                      provider.
                    </>
                  )}
                </div>
                {preloadError && (
                  <div className="home-webgpu-notice-error">{preloadError}</div>
                )}
                <div className="home-webgpu-notice-actions">
                  {canConfigureProviders && onOpenProviders && (
                    <button
                      type="button"
                      className="btn btn-amber btn-sm"
                      onClick={onOpenProviders}
                    >
                      {currentUser?.role === "admin"
                        ? "Configure Providers (Admin)"
                        : "Add Optimal Provider"}
                    </button>
                  )}
                  {relay?.webgpuSupported !== false &&
                    !relay?.webgpuLoadedModel &&
                    effectiveActorModel?.model && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={preloadingWebGpu || !!relay?.webgpuProgress}
                        onClick={async () => {
                          setPreloadingWebGpu(true);
                          setPreloadError(null);
                          try {
                            await relay?.preloadWebGpu(
                              effectiveActorModel.model!,
                              effectiveActorModel.contextSize
                            );
                          } catch (err: any) {
                            setPreloadError(
                              err?.message || "Failed to preload WebGPU model."
                            );
                          } finally {
                            setPreloadingWebGpu(false);
                          }
                        }}
                      >
                        {preloadingWebGpu || relay?.webgpuProgress
                          ? `Loading (${Math.round(
                              (relay?.webgpuProgress?.progress ?? 0) * 100
                            )}%)…`
                          : "Preload Browser Model"}
                      </button>
                    )}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ padding: 4, alignSelf: "flex-start" }}
                onClick={dismissWebGpuNotice}
                aria-label="Dismiss WebGPU notice"
                title="Dismiss"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {/* Centralized Cards Deck Area */}
          <div className="home-deck-area">
            <div className="home-grid">
              {/* 1. Worlds */}
              <HomeCard
                category="worlds"
                title="Worlds"
                singular="World"
                count={worlds.length}
                countLabel={worlds.length === 1 ? "world" : "worlds"}
                watermarkIcon={<Globe size={140} />}
                accentColor="var(--accent-cyan)"
                images={worldImages}
                imagePosition="center"
                onCardClick={() => handleOpenPicker("worlds")}
                onNewClick={onNewWorld}
              />

              {/* 2. Characters */}
              <HomeCard
                category="characters"
                title="Characters"
                singular="Character"
                count={characters.length}
                countLabel={characters.length === 1 ? "character" : "characters"}
                watermarkIcon={<Users size={140} />}
                accentColor="var(--accent-amber)"
                images={characterImages}
                imagePosition="top"
                onCardClick={() => handleOpenPicker("characters")}
                onNewClick={onNewCharacter}
              />

              {/* 3. Personas */}
              <HomeCard
                category="personas"
                title="Personas"
                singular="Persona"
                count={personas.length}
                countLabel={personas.length === 1 ? "persona" : "personas"}
                watermarkIcon={<UserCheck size={140} />}
                accentColor="var(--accent-emerald)"
                images={personaImages}
                imagePosition="top"
                onCardClick={() => handleOpenPicker("personas")}
                onNewClick={onNewPersona}
              />

              {/* 4. Campaigns */}
              <HomeCard
                category="campaigns"
                title="Campaigns"
                singular="Campaign"
                count={campaigns.length}
                countLabel={campaigns.length === 1 ? "campaign" : "campaigns"}
                watermarkIcon={<FolderKanban size={140} />}
                accentColor="var(--accent-violet)"
                images={campaignImages}
                imagePosition="center"
                onCardClick={() => handleOpenPicker("campaigns")}
                onNewClick={onNewCampaign}
              />
            </div>

            {/* Import & Export Action Row */}
            <div className="home-actions-row">
              <button
                type="button"
                className="btn home-action-btn"
                onClick={() => {
                  setDroppedFile(null);
                  setShowImportModal(true);
                }}
                title="Import CyberCantina packages (.zcc) or SillyTavern character cards"
              >
                <Download size={15} color="var(--accent-emerald)" />
                <span>Import</span>
              </button>

              <button
                type="button"
                className="btn home-action-btn"
                onClick={() => setShowExportModal(true)}
                title="Export bundle of characters, worlds, and personas as .zcc"
              >
                <Upload size={15} color="var(--accent-cyan)" />
                <span>Export</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Drag & Drop Full Window Overlay */}
      {isDraggingOver && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(10, 15, 29, 0.88)",
            backdropFilter: "blur(4px)",
            border: "3px dashed var(--accent-cyan)",
            zIndex: 9999,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            pointerEvents: "none",
          }}
        >
          <FileArchive size={64} color="var(--accent-cyan)" />
          <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--text-primary)" }}>
            Drop package (.zcc / .zip) or character card (.png / .json) to import
          </div>
        </div>
      )}

      {/* Export Bundle Modal */}
      {showExportModal && (
        <ExportBundleModal
          characters={characters}
          worlds={worlds}
          personas={personas}
          onClose={() => setShowExportModal(false)}
        />
      )}

      {/* Import Preview Modal */}
      {showImportModal && (
        <ImportPreviewModal
          initialFile={droppedFile}
          onClose={() => {
            setShowImportModal(false);
            setDroppedFile(null);
          }}
          onImportSuccess={() => {
            onRefreshData?.();
          }}
          onOpenCharacterWizardWithDraft={onOpenCharacterWizardWithDraft}
        />
      )}

      {/* Entity Picker Selection Modal */}
      {activePickerCategory && (
        <HomeEntityPickerModal
          category={activePickerCategory}
          personas={personas}
          characters={characters}
          worlds={worlds}
          campaigns={campaigns}
          activePersonaId={activePersona?.id}
          onClose={() => setActivePickerCategory(null)}
          onSelectCampaign={(c) => {
            setActivePickerCategory(null);
            onSelectCampaign(c);
          }}
          onSelectCharacter={(c) => {
            setActivePickerCategory(null);
            onInspectCharacter(c);
          }}
          onSelectWorld={(w) => {
            setActivePickerCategory(null);
            onInspectWorld(w);
          }}
          onSelectPersona={(p) => {
            setActivePickerCategory(null);
            onSetActivePersona(p);
            onEditPersona(p);
          }}
          onNewClick={(cat) => {
            setActivePickerCategory(null);
            handlePickerNewClick(cat);
          }}
          onDeleteCampaign={onDeleteCampaign}
          onDeleteCharacter={onDeleteCharacter}
          onDeleteWorld={onDeleteWorld}
          onDeletePersona={onDeletePersona}
        />
      )}
    </main>
  );
};
