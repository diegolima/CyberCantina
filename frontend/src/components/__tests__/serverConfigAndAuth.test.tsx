import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AuthScreen } from "../auth/AuthScreen";
import { AdminServerConfigTab } from "../auth/AdminServerConfigTab";
import { AdminUsersTab } from "../auth/AdminUsersTab";
import { ProfileAccountTab } from "../auth/ProfileAccountTab";
import { CharacterWizardModal } from "../WizardModals";
import type { AppSettings, UserProfile } from "../../types";

const BASE_SETTINGS: AppSettings = {
  db_path: "./cybercantina.db",
  actor_profile: {
    provider_id: null,
    model: "test-actor",
    temperature: 0.7,
    max_tokens: 1024,
    timeout_seconds: 60,
  },
  clerk_profile: {
    provider_id: null,
    model: "test-clerk",
    temperature: 0.3,
    max_tokens: 1024,
    timeout_seconds: 60,
  },
  embedding_profile: {
    mode: "local_hash",
    model: "hash",
    dimensions: 384,
  },
  memory_config: {
    working_memory_turns: 8,
    episodic_chunk_size: 4,
    rag_top_k: 5,
  },
  allow_offline_fallback: true,
  allow_user_model_overrides: false,
  delegate_cognition_to_clerk: false,
  allow_self_registration: true,
  inactive_user_purge_days: 14,
  user_media_quota_mb: 5,
  chloromancer_interval_minutes: 60,
};

const ADMIN_USER: UserProfile = {
  id: "user_admin",
  username: "admin",
  display_name: "Administrator",
  role: "admin",
  has_password: true,
  passkeys: [],
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  last_login_at: "2026-11-01T00:00:00Z",
  last_active_at: "2026-11-10T00:00:00Z",
  media_bytes_used: 2 * 1024 * 1024,
  media_quota_bytes: null,
};

const STALE_PLAYER: UserProfile = {
  id: "user_stale",
  username: "stale_player",
  display_name: "Stale Player",
  role: "user",
  has_password: true,
  passkeys: [],
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
  last_login_at: "2026-09-10T00:00:00Z",
  last_active_at: "2026-09-15T00:00:00Z",
  media_bytes_used: 1536 * 1024,
  media_quota_bytes: 5 * 1024 * 1024,
};

describe("Server Configuration, Self-Registration Toggle, Quotas & Activity UI", () => {
  it("hides Create Account on AuthScreen when allowSelfRegistration is false", () => {
    const openHtml = renderToStaticMarkup(
      React.createElement(AuthScreen, {
        singleUserMode: false,
        allowSelfRegistration: true,
        onAuthenticated: vi.fn(),
      })
    );
    expect(openHtml).toContain("Create Account");

    const closedHtml = renderToStaticMarkup(
      React.createElement(AuthScreen, {
        singleUserMode: false,
        allowSelfRegistration: false,
        onAuthenticated: vi.fn(),
      })
    );
    expect(closedHtml).not.toContain("Create Account");
    expect(closedHtml).toContain("Self-registration is currently disabled");
  });

  it("renders AdminServerConfigTab with quota, self-registration, and Chloromancer controls", () => {
    const html = renderToStaticMarkup(
      React.createElement(AdminServerConfigTab, {
        appSettingsForm: BASE_SETTINGS,
        setAppSettingsForm: vi.fn(),
        savingSettings: false,
        handleSaveSettings: vi.fn(),
        setStatusMsg: vi.fn(),
        setErrorMsg: vi.fn(),
      })
    );
    expect(html).toContain("Allow self-registration");
    expect(html).toContain("Global User Media Quota");
    expect(html).toContain("Chloromancer Housekeeping");
    expect(html).toContain("Preview Purge Candidates");
    expect(html).toContain("Run Cleanup Now");
  });

  it("displays activity timestamps, media quota, and purge countdown badges in AdminUsersTab", () => {
    const html = renderToStaticMarkup(
      React.createElement(AdminUsersTab, {
        currentUser: ADMIN_USER,
        singleUserMode: false,
        inactiveUserPurgeDays: 14,
        users: [ADMIN_USER, STALE_PLAYER],
        setUsers: vi.fn(),
        loadUsers: vi.fn(async () => {}),
        filterQuery: "",
        setFilterQuery: vi.fn(),
        selectedUserId: STALE_PLAYER.id,
        setSelectedUserId: vi.fn(),
        editUsername: STALE_PLAYER.username,
        setEditUsername: vi.fn(),
        loading: false,
        setStatusMsg: vi.fn(),
        setErrorMsg: vi.fn(),
        setFeedback: vi.fn(),
        onCurrentUserUpdated: vi.fn(),
        onClose: vi.fn(),
      })
    );
    expect(html).toContain("Due for purge");
    expect(html).toContain("Last Active:");
    expect(html).toContain("Media Storage:");
    expect(html).toContain("1.50 MB");
  });

  it("renders retention backup notice for standard users and quota exemption for admins in ProfileAccountTab", () => {
    const playerHtml = renderToStaticMarkup(
      React.createElement(ProfileAccountTab, {
        user: STALE_PLAYER,
        singleUserMode: false,
        inactiveUserPurgeDays: 14,
        setStatusMsg: vi.fn(),
        setErrorMsg: vi.fn(),
        setFeedback: vi.fn(),
        onUserUpdated: vi.fn(),
        onAccountReset: vi.fn(async () => {}),
        onAccountDeleted: vi.fn(async () => {}),
        onClose: vi.fn(),
      })
    );
    expect(playerHtml).toContain("Account Retention Policy:");
    expect(playerHtml).toContain("inactive for 14 days");
    expect(playerHtml).toContain(".zcc");
    expect(playerHtml).toContain("1.50 MB / 5.00 MB");

    const adminHtml = renderToStaticMarkup(
      React.createElement(ProfileAccountTab, {
        user: ADMIN_USER,
        singleUserMode: false,
        inactiveUserPurgeDays: 14,
        setStatusMsg: vi.fn(),
        setErrorMsg: vi.fn(),
        setFeedback: vi.fn(),
        onUserUpdated: vi.fn(),
        onAccountReset: vi.fn(async () => {}),
        onAccountDeleted: vi.fn(async () => {}),
        onClose: vi.fn(),
      })
    );
    expect(adminHtml).toContain("Administrator: Exempt from quota");
    expect(adminHtml).not.toContain("Account Retention Policy:");
  });

  it("renders initialMediaWarning banner in CharacterWizardModal when card artwork exceeded quota", () => {
    const html = renderToStaticMarkup(
      React.createElement(CharacterWizardModal, {
        worlds: [],
        defaultWorldId: "",
        onClose: vi.fn(),
        onCreated: vi.fn(),
        initialMediaWarning: "Card artwork was omitted because staging exceeds quota.",
      })
    );
    expect(html).toContain("Media Quota Notice:");
    expect(html).toContain("Card artwork was omitted because staging exceeds quota.");
  });
});
