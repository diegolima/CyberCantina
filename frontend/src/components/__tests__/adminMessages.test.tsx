import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AuthScreen } from "../auth/AuthScreen";
import { AdminModal } from "../auth/AdminModal";
import { HomeScreen } from "../HomeScreen";
import { AdminMessageBannerList } from "../shared/AdminMessageBannerList";
import {
  type StorageLike,
  dismissAdminMessageInStorage,
  getVisibleAdminMessages,
  pruneAdminMessageStateStorage,
  toggleAdminMessageCollapsedInStorage,
} from "../../utils/adminMessageState";
import type { PublicAdminMessage, UserProfile } from "../../types";

function makeMemoryStorage(): StorageLike {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

const ADMIN_USER: UserProfile = {
  id: "user_admin",
  username: "admin",
  display_name: "Administrator",
  role: "admin",
  has_password: true,
  passkeys: [],
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
};

const MSG_CRITICAL: PublicAdminMessage = {
  id: "msg_crit",
  revision: 1,
  placement: "both",
  title: "Scheduled Maintenance",
  message: "Downtime at 22:00 UTC.\nDetails: https://status.example.com.",
  urgency: "critical",
  dismissable: true,
  expires_at: null,
};

const MSG_PINNED: PublicAdminMessage = {
  id: "msg_pin",
  revision: 1,
  placement: "home",
  title: "Read-Only Window",
  message: "Backups running.",
  urgency: "warning",
  dismissable: false,
  expires_at: null,
};

describe("AdminMessageState localStorage logic", () => {
  it("hides dismissed message until revision increments, while preserving collapsed state", () => {
    const storage = makeMemoryStorage();

    // Collapse and dismiss rev 1
    toggleAdminMessageCollapsedInStorage(MSG_CRITICAL, true, "home", "u1", storage);
    dismissAdminMessageInStorage(MSG_CRITICAL, "home", "u1", storage);

    expect(
      getVisibleAdminMessages([MSG_CRITICAL], "home", "u1", storage)
    ).toEqual([]);

    // Admin edits message -> revision increments to 2 -> reappears AND stays collapsed
    const rev2: PublicAdminMessage = { ...MSG_CRITICAL, revision: 2 };
    const visible = getVisibleAdminMessages([rev2], "home", "u1", storage);
    expect(visible).toHaveLength(1);
    expect(visible[0].id).toBe("msg_crit");
    expect(visible[0].collapsed).toBe(true);
  });

  it("re-displays a previously dismissed message if admin unchecks dismissable", () => {
    const storage = makeMemoryStorage();
    dismissAdminMessageInStorage(MSG_CRITICAL, "login", null, storage);
    expect(getVisibleAdminMessages([MSG_CRITICAL], "login", null, storage)).toEqual(
      []
    );

    const nonDismissable: PublicAdminMessage = {
      ...MSG_CRITICAL,
      dismissable: false,
    };
    const visible = getVisibleAdminMessages(
      [nonDismissable],
      "login",
      null,
      storage
    );
    expect(visible).toHaveLength(1);
  });

  it("carries over dismiss and collapse state from Login to Home for placement='both'", () => {
    const storage = makeMemoryStorage();
    dismissAdminMessageInStorage(MSG_CRITICAL, "login", null, storage);
    expect(
      getVisibleAdminMessages([MSG_CRITICAL], "home", "u1", storage)
    ).toEqual([]);

    toggleAdminMessageCollapsedInStorage(MSG_CRITICAL, true, "login", null, storage);
    const rev2: PublicAdminMessage = { ...MSG_CRITICAL, revision: 2 };
    const visible = getVisibleAdminMessages([rev2], "home", "u1", storage);
    expect(visible).toHaveLength(1);
    expect(visible[0].collapsed).toBe(true);
  });

  it("prunes deleted or expired IDs from storage and skips locally expired items", () => {
    const storage = makeMemoryStorage();
    toggleAdminMessageCollapsedInStorage(MSG_CRITICAL, true, "home", "u1", storage);
    toggleAdminMessageCollapsedInStorage(MSG_PINNED, true, "home", "u1", storage);
    pruneAdminMessageStateStorage([MSG_PINNED], "home", "u1", storage);

    const visibleAfterPrune = getVisibleAdminMessages(
      [MSG_CRITICAL, MSG_PINNED],
      "home",
      "u1",
      storage
    );
    expect(visibleAfterPrune.find((m) => m.id === "msg_crit")?.collapsed).toBe(
      false
    );
    expect(visibleAfterPrune.find((m) => m.id === "msg_pin")?.collapsed).toBe(
      true
    );

    const pastMsg: PublicAdminMessage = {
      ...MSG_CRITICAL,
      expires_at: "2020-01-01T00:00:00Z",
    };
    expect(getVisibleAdminMessages([pastMsg], "home", "u1", storage)).toEqual([]);
  });
});

describe("Admin Communication UI SSR markup", () => {
  it("renders AuthScreen login messages above the sign-in card with safe links", () => {
    const html = renderToStaticMarkup(
      React.createElement(AuthScreen, {
        singleUserMode: false,
        allowSelfRegistration: true,
        loginMessages: [MSG_CRITICAL],
        onAuthenticated: vi.fn(),
      })
    );
    expect(html).toContain("auth-stage-stack");
    expect(html).toContain("Scheduled Maintenance");
    expect(html).toContain('href="https://status.example.com"');
    expect(html).toContain("is-critical");
    expect(html).toContain("Dismiss announcement: Scheduled Maintenance");
    expect(html.indexOf("Scheduled Maintenance")).toBeLessThan(
      html.indexOf("Sign In to CyberCantina")
    );
  });

  it("renders HomeScreen messages above the deck and omits X on non-dismissable messages", () => {
    const html = renderToStaticMarkup(
      React.createElement(HomeScreen, {
        personas: [],
        characters: [],
        worlds: [],
        campaigns: [],
        activePersona: null,
        currentUser: ADMIN_USER,
        singleUserMode: false,
        homeMessages: [MSG_CRITICAL, MSG_PINNED],
        onSelectCampaign: vi.fn(),
        onInspectCharacter: vi.fn(),
        onInspectWorld: vi.fn(),
        onEditPersona: vi.fn(),
        onNewCampaign: vi.fn(),
        onNewCharacter: vi.fn(),
        onNewWorld: vi.fn(),
        onNewPersona: vi.fn(),
        onSetActivePersona: vi.fn(),
        onOpenProfile: vi.fn(),
        onOpenAdmin: vi.fn(),
        onOpenNotes: vi.fn(),
        onLogout: vi.fn(),
      })
    );
    expect(html).toContain("Scheduled Maintenance");
    expect(html).toContain("Read-Only Window");
    expect(html).toContain("Dismiss announcement: Scheduled Maintenance");
    expect(html).not.toContain("Dismiss announcement: Read-Only Window");
  });

  it("disables the Communication tab on AdminModal in singleUserMode", () => {
    const singleHtml = renderToStaticMarkup(
      React.createElement(AdminModal, {
        currentUser: ADMIN_USER,
        singleUserMode: true,
        onClose: vi.fn(),
        onCurrentUserUpdated: vi.fn(),
      })
    );
    expect(singleHtml).toContain("Communication");
    expect(singleHtml).toContain('disabled=""');

    const multiHtml = renderToStaticMarkup(
      React.createElement(AdminModal, {
        currentUser: ADMIN_USER,
        singleUserMode: false,
        onClose: vi.fn(),
        onCurrentUserUpdated: vi.fn(),
      })
    );
    expect(multiHtml).toContain("Communication");
  });

  it("renders AdminMessageBannerList safely with info/warning/critical classes", () => {
    const infoMsg: PublicAdminMessage = {
      id: "msg_info",
      revision: 1,
      placement: "home",
      title: "New Models Added",
      message: "Check the catalog.",
      urgency: "info",
      dismissable: true,
    };
    const html = renderToStaticMarkup(
      React.createElement(AdminMessageBannerList, {
        messages: [MSG_CRITICAL, MSG_PINNED, infoMsg],
        surface: "home",
        userId: "u1",
      })
    );
    expect(html).toContain("is-critical");
    expect(html).toContain("is-warning");
    expect(html).toContain("is-info");
  });

  it("hides body and dismiss X button when a dismissable message is collapsed", () => {
    const prevStorage = (globalThis as any).localStorage;
    const mem = makeMemoryStorage();
    toggleAdminMessageCollapsedInStorage(MSG_CRITICAL, true, "home", "u1", mem);
    (globalThis as any).localStorage = mem;
    try {
      const html = renderToStaticMarkup(
        React.createElement(AdminMessageBannerList, {
          messages: [MSG_CRITICAL],
          surface: "home",
          userId: "u1",
        })
      );
      expect(html).toContain('aria-expanded="false"');
      expect(html).toContain("Scheduled Maintenance");
      expect(html).not.toContain("Downtime at 22:00 UTC.");
      expect(html).not.toContain("Dismiss announcement: Scheduled Maintenance");
    } finally {
      (globalThis as any).localStorage = prevStorage;
    }
  });
});
