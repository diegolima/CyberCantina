import React from "react";
import {
  Flame,
  FolderKanban,
  Globe,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  StickyNote,
  User,
  UserCheck,
  UserCog,
  Users,
  X,
} from "lucide-react";
import {
  CampaignRecord,
  CampaignStateBundle,
  CharacterRecord,
  PersonaRecord,
  UserNote,
  UserProfile,
  WorldRecord,
} from "../types";
import type { LeftPanelMode, SidebarCategoryKey } from "../utils/campaignLayout";
import { RelaySidebarBadge, SidebarCategory } from "./SidebarCategory";

export interface AppSidebarProps {
  id?: string;
  mode?: LeftPanelMode;
  onToggleCollapse?: () => void;
  onCloseOverlay?: () => void;
  expandedCategories?: Partial<Record<SidebarCategoryKey, boolean>>;
  onToggleCategory?: (key: SidebarCategoryKey, next: boolean) => void;
  onExpandToCategory?: (key: SidebarCategoryKey) => void;
  bundle: CampaignStateBundle | null;
  personas: PersonaRecord[];
  characters: CharacterRecord[];
  worlds: WorldRecord[];
  campaigns: CampaignRecord[];
  campaignActiveWorldId: string | null;
  campaignActivePersonaId: string | null;
  campaignActiveCharacterIds: Set<string>;
  notes: UserNote[];
  showNotesFlyout: boolean;
  setShowNotesFlyout: React.Dispatch<React.SetStateAction<boolean>>;
  currentUser: UserProfile;
  singleUserMode: boolean;
  isStreaming: boolean;
  setEditingPersona: React.Dispatch<React.SetStateAction<PersonaRecord | null>>;
  setShowPersonaModal: React.Dispatch<React.SetStateAction<boolean>>;
  setShowCharWizard: React.Dispatch<React.SetStateAction<boolean>>;
  setShowWorldWizard: React.Dispatch<React.SetStateAction<boolean>>;
  setShowNewCampaignModal: React.Dispatch<React.SetStateAction<boolean>>;
  setNotesModalInitialId: React.Dispatch<React.SetStateAction<string | undefined>>;
  setShowNotesModal: React.Dispatch<React.SetStateAction<boolean>>;
  setProfileInitialTab: React.Dispatch<
    React.SetStateAction<"identity" | "account" | "preferences" | "models" | "prompts" | "behavior">
  >;
  setShowProfileModal: React.Dispatch<React.SetStateAction<boolean>>;
  setAdminInitialTab: React.Dispatch<
    React.SetStateAction<
      "users" | "providers" | "models" | "prompts" | "server" | "communication"
    >
  >;
  setShowAdminModal: React.Dispatch<React.SetStateAction<boolean>>;
  handleCloseCampaign: () => void;
  handleRequestDeletePersona: (e: React.MouseEvent | undefined, p: PersonaRecord) => void;
  handleSelectCharacter: (char: CharacterRecord) => void;
  handleRequestDeleteCharacter: (e: React.MouseEvent | undefined, char: CharacterRecord) => void;
  handleSelectWorld: (world: WorldRecord) => void;
  handleRequestDeleteWorld: (e: React.MouseEvent | undefined, world: WorldRecord) => void;
  loadCampaignBundle: (campaignId: string) => Promise<void>;
  handleRequestDeleteCampaign: (e: React.MouseEvent | undefined, camp: CampaignRecord) => void;
  handleLogout: () => Promise<void>;
}

export const AppSidebar: React.FC<AppSidebarProps> = ({
  id = "app-sidebar-aside",
  mode = "expanded",
  onToggleCollapse,
  onCloseOverlay,
  expandedCategories,
  onToggleCategory,
  onExpandToCategory,
  bundle,
  personas,
  characters,
  worlds,
  campaigns,
  campaignActiveWorldId,
  campaignActivePersonaId,
  campaignActiveCharacterIds,
  notes,
  showNotesFlyout,
  setShowNotesFlyout,
  currentUser,
  singleUserMode,
  isStreaming,
  setEditingPersona,
  setShowPersonaModal,
  setShowCharWizard,
  setShowWorldWizard,
  setShowNewCampaignModal,
  setNotesModalInitialId,
  setShowNotesModal,
  setProfileInitialTab,
  setShowProfileModal,
  setAdminInitialTab,
  setShowAdminModal,
  handleCloseCampaign,
  handleRequestDeletePersona,
  handleSelectCharacter,
  handleRequestDeleteCharacter,
  handleSelectWorld,
  handleRequestDeleteWorld,
  loadCampaignBundle,
  handleRequestDeleteCampaign,
  handleLogout,
}) => {
  if (!bundle) {
    return null;
  }

  if (mode === "rail") {
    const railCategories: Array<{
      key: SidebarCategoryKey;
      label: string;
      count: number;
      icon: React.ReactNode;
    }> = [
      {
        key: "personas",
        label: `Personas (${personas.length})`,
        count: personas.length,
        icon: <UserCheck size={17} color="var(--accent-emerald)" />,
      },
      {
        key: "characters",
        label: `Characters (${characters.length})`,
        count: characters.length,
        icon: <Users size={17} color="var(--accent-amber)" />,
      },
      {
        key: "worlds",
        label: `Worlds (${worlds.length})`,
        count: worlds.length,
        icon: <Globe size={17} color="var(--accent-cyan)" />,
      },
      {
        key: "campaigns",
        label: `Campaigns (${campaigns.length})`,
        count: campaigns.length,
        icon: <FolderKanban size={17} color="var(--accent-emerald)" />,
      },
    ];

    return (
      <aside id={id} className="sidebar sidebar--rail">
        <div className="brand-header brand-header--rail">
          <button
            type="button"
            className="btn btn-ghost rail-icon-btn"
            onClick={handleCloseCampaign}
            title="Return to Home page"
            aria-label="Return to Home page"
          >
            <Flame size={19} color="var(--accent-amber)" />
          </button>
          {onToggleCollapse && (
            <button
              type="button"
              className="btn btn-ghost rail-icon-btn rail-expand-btn"
              onClick={onToggleCollapse}
              title="Expand sidebar"
              aria-label="Expand sidebar"
              aria-expanded={false}
              aria-controls={id}
            >
              <PanelLeftOpen size={15} />
            </button>
          )}
        </div>

        <nav className="rail-categories" aria-label="Campaign catalog">
          {railCategories.map((cat) => (
            <button
              key={cat.key}
              type="button"
              className="btn btn-ghost rail-icon-btn rail-category-btn"
              onClick={() => onExpandToCategory?.(cat.key)}
              title={cat.label}
              aria-label={cat.label}
            >
              {cat.icon}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom-area sidebar-bottom-area--rail">
          <RelaySidebarBadge compact />
          <button
            type="button"
            className={`btn btn-ghost rail-icon-btn ${
              showNotesFlyout ? "active" : ""
            }`}
            onClick={() => setShowNotesFlyout((prev) => !prev)}
            title="Open Player Notes scratchpad"
            aria-label="Open Player Notes scratchpad"
            aria-expanded={showNotesFlyout}
          >
            <StickyNote size={16} color="var(--accent-amber)" />
            {notes.length > 0 && <span className="rail-badge-dot" />}
          </button>
          <button
            type="button"
            className="btn btn-ghost rail-icon-btn"
            onClick={() => {
              setProfileInitialTab("identity");
              setShowProfileModal(true);
            }}
            title={`User Profile (@${currentUser.username})`}
            aria-label="Open User Profile"
          >
            <User size={16} color="var(--accent-cyan)" />
          </button>
          {!singleUserMode && (
            <button
              type="button"
              className="btn btn-ghost rail-icon-btn"
              onClick={handleLogout}
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut size={15} />
            </button>
          )}
          {currentUser.role === "admin" && (
            <button
              type="button"
              className="btn btn-ghost rail-icon-btn"
              onClick={() => {
                setAdminInitialTab("users");
                setShowAdminModal(true);
              }}
              title="Open Admin Area"
              aria-label="Open Admin Area"
            >
              <UserCog size={16} color="var(--accent-amber)" />
            </button>
          )}
        </div>
      </aside>
    );
  }

  const sidebarClassName = [
    "sidebar",
    mode === "overlay" ? "sidebar--overlay" : "",
    mode === "hidden" ? "sidebar--hidden" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const collapseAction =
    mode === "overlay" ? onCloseOverlay ?? onToggleCollapse : onToggleCollapse;

  return (
    <aside
      id={id}
      className={sidebarClassName}
      aria-hidden={mode === "hidden" ? true : undefined}
    >
      <div className="brand-header">
        <div
          className="brand-title"
          style={{ cursor: "pointer" }}
          onClick={handleCloseCampaign}
          title="Return to Home page"
        >
          <Flame size={20} color="var(--accent-amber)" />
          <span>CYBERCANTINA</span>
        </div>
        {collapseAction && (
          <button
            type="button"
            className="btn btn-ghost sidebar-collapse-btn"
            onClick={collapseAction}
            title={mode === "overlay" ? "Close sidebar" : "Collapse sidebar to icon rail"}
            aria-label={mode === "overlay" ? "Close sidebar" : "Collapse sidebar to icon rail"}
            aria-expanded={mode !== "hidden"}
            aria-controls={id}
          >
            {mode === "overlay" ? <X size={16} /> : <PanelLeftClose size={16} />}
          </button>
        )}
      </div>

      {/* 1. Personas (+new) */}
      <SidebarCategory
        title="Personas"
        icon={<UserCheck size={14} color="var(--accent-emerald)" />}
        items={personas}
        expanded={expandedCategories?.personas}
        onExpandedChange={
          onToggleCategory ? (next) => onToggleCategory("personas", next) : undefined
        }
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
          expanded={expandedCategories?.characters}
          onExpandedChange={
            onToggleCategory ? (next) => onToggleCategory("characters", next) : undefined
          }
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
          expanded={expandedCategories?.worlds}
          onExpandedChange={
            onToggleCategory ? (next) => onToggleCategory("worlds", next) : undefined
          }
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
          expanded={expandedCategories?.campaigns}
          onExpandedChange={
            onToggleCategory ? (next) => onToggleCategory("campaigns", next) : undefined
          }
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
  );
};
