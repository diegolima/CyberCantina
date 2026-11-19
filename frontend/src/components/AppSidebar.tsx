import React from "react";
import {
  ArrowLeft,
  BookOpen,
  Flame,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  StickyNote,
  User,
  UserCog,
  X,
} from "lucide-react";
import {
  CampaignStateBundle,
  UserNote,
  UserProfile,
} from "../types";
import type { LeftPanelMode } from "../utils/campaignLayout";
import { RelaySidebarBadge } from "./RelaySidebarBadge";

export interface AppSidebarProps {
  id?: string;
  mode?: LeftPanelMode;
  onToggleCollapse?: () => void;
  onCloseOverlay?: () => void;
  bundle: CampaignStateBundle | null;
  worldName?: string | null;
  codexCount?: number;
  isCodexOpen?: boolean;
  onOpenCodex?: () => void;
  notes: UserNote[];
  showNotesFlyout: boolean;
  setShowNotesFlyout: React.Dispatch<React.SetStateAction<boolean>>;
  currentUser: UserProfile;
  singleUserMode: boolean;
  setNotesModalInitialId: React.Dispatch<React.SetStateAction<string | undefined>>;
  setShowNotesModal: React.Dispatch<React.SetStateAction<boolean>>;
  setProfileInitialTab: React.Dispatch<
    React.SetStateAction<
      "identity" | "account" | "preferences" | "models" | "prompts" | "behavior"
    >
  >;
  setShowProfileModal: React.Dispatch<React.SetStateAction<boolean>>;
  setAdminInitialTab: React.Dispatch<
    React.SetStateAction<
      "users" | "providers" | "models" | "prompts" | "server" | "communication"
    >
  >;
  setShowAdminModal: React.Dispatch<React.SetStateAction<boolean>>;
  handleCloseCampaign: () => void;
  handleLogout: () => Promise<void>;
}

export const AppSidebar: React.FC<AppSidebarProps> = ({
  id = "app-sidebar-aside",
  mode = "expanded",
  onToggleCollapse,
  onCloseOverlay,
  bundle,
  worldName,
  codexCount,
  isCodexOpen = false,
  onOpenCodex,
  notes,
  showNotesFlyout,
  setShowNotesFlyout,
  currentUser,
  singleUserMode,
  setNotesModalInitialId,
  setShowNotesModal,
  setProfileInitialTab,
  setShowProfileModal,
  setAdminInitialTab,
  setShowAdminModal,
  handleCloseCampaign,
  handleLogout,
}) => {
  if (!bundle) {
    return null;
  }

  const closeCampaignAction = () => {
    onCloseOverlay?.();
    handleCloseCampaign();
  };

  const openCodexAction = () => {
    onCloseOverlay?.();
    onOpenCodex?.();
  };

  if (mode === "rail") {
    return (
      <aside id={id} className="sidebar sidebar--rail">
        <div className="brand-header brand-header--rail">
          <button
            type="button"
            className="btn btn-ghost rail-icon-btn"
            onClick={closeCampaignAction}
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

        <nav className="rail-categories" aria-label="Campaign tools">
          <button
            type="button"
            className={`btn btn-ghost rail-icon-btn rail-category-btn ${
              isCodexOpen ? "active" : ""
            }`}
            onClick={openCodexAction}
            title="Open Campaign Codex"
            aria-label="Open Campaign Codex"
            aria-pressed={isCodexOpen}
          >
            <BookOpen size={17} color="var(--accent-violet)" />
          </button>
          <button
            type="button"
            className="btn btn-ghost rail-icon-btn rail-category-btn"
            onClick={closeCampaignAction}
            title="Close campaign and return to Home"
            aria-label="Close campaign and return to Home"
          >
            <ArrowLeft size={17} />
          </button>
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
          onClick={closeCampaignAction}
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
            title={
              mode === "overlay" ? "Close sidebar" : "Collapse sidebar to icon rail"
            }
            aria-label={
              mode === "overlay" ? "Close sidebar" : "Collapse sidebar to icon rail"
            }
            aria-expanded={mode !== "hidden"}
            aria-controls={id}
          >
            {mode === "overlay" ? <X size={16} /> : <PanelLeftClose size={16} />}
          </button>
        )}
      </div>

      <div className="sidebar-campaign-body">
        <div className="sidebar-campaign-card">
          <div className="sidebar-campaign-meta">
            <div className="sidebar-campaign-kicker">Active Campaign</div>
            <div className="sidebar-campaign-name" title={bundle.campaign.name}>
              {bundle.campaign.name}
            </div>
            {worldName && (
              <div className="sidebar-campaign-world" title={worldName}>
                {worldName}
              </div>
            )}
          </div>
          <button
            type="button"
            className="btn sidebar-close-campaign-btn"
            onClick={closeCampaignAction}
            title="Close campaign and return to Home"
          >
            <ArrowLeft size={14} />
            <span>Close Campaign</span>
          </button>
        </div>

        <nav className="sidebar-campaign-nav" aria-label="Campaign tools">
          <div className="sidebar-nav-heading">Campaign Tools</div>
          <button
            type="button"
            className={`sidebar-nav-item ${isCodexOpen ? "active" : ""}`}
            onClick={openCodexAction}
            title="Open Campaign Codex"
            aria-pressed={isCodexOpen}
          >
            <span className="sidebar-nav-item-main">
              <BookOpen size={15} color="var(--accent-violet)" />
              <span>Codex</span>
            </span>
            {typeof codexCount === "number" && (
              <span className="sidebar-nav-count">{codexCount}</span>
            )}
          </button>
        </nav>
      </div>

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
            <span
              style={{
                fontWeight: 600,
                fontSize: "0.81rem",
                color: "var(--text-primary)",
              }}
            >
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
