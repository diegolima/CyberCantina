import { describe, expect, it } from "vitest";
import {
  getShellClassNames,
  getViewportTier,
  resolvePanelLayoutState,
} from "../campaignLayout";

describe("campaignLayout", () => {
  it("classifies mobile, tablet, and desktop viewport tiers accurately", () => {
    expect(getViewportTier(375)).toBe("mobile");
    expect(getViewportTier(820)).toBe("mobile");
    expect(getViewportTier(821)).toBe("tablet");
    expect(getViewportTier(1100)).toBe("tablet");
    expect(getViewportTier(1101)).toBe("desktop");
    expect(getViewportTier(1440)).toBe("desktop");
  });

  it("uses persisted desktop collapse flags only on desktop (> 1100px)", () => {
    const bothOpen = resolvePanelLayoutState({
      tier: "desktop",
      desktopSidebarCollapsed: false,
      desktopInspectorCollapsed: false,
      activeOverlayDrawer: "none",
    });
    expect(bothOpen.leftMode).toBe("expanded");
    expect(bothOpen.rightMode).toBe("expanded");
    expect(bothOpen.showBackdrop).toBe(false);
    expect(bothOpen.showMobileMenuButton).toBe(false);
    expect(getShellClassNames(bothOpen, true)).toBe("studio-shell");

    const bothCollapsed = resolvePanelLayoutState({
      tier: "desktop",
      desktopSidebarCollapsed: true,
      desktopInspectorCollapsed: true,
      activeOverlayDrawer: "none",
    });
    expect(bothCollapsed.leftMode).toBe("rail");
    expect(bothCollapsed.rightMode).toBe("hidden");
    expect(bothCollapsed.isSidebarOpen).toBe(false);
    expect(bothCollapsed.isInspectorOpen).toBe(false);
    expect(getShellClassNames(bothCollapsed, true)).toBe(
      "studio-shell studio-shell--sidebar-rail studio-shell--inspector-hidden"
    );
  });

  it("starts tablet with 52px left rail and hidden right inspector, opening overlays mutually exclusively", () => {
    const idle = resolvePanelLayoutState({
      tier: "tablet",
      desktopSidebarCollapsed: false,
      desktopInspectorCollapsed: false,
      activeOverlayDrawer: "none",
    });
    expect(idle.leftMode).toBe("rail");
    expect(idle.rightMode).toBe("hidden");
    expect(idle.showBackdrop).toBe(false);
    expect(idle.showMobileMenuButton).toBe(false);

    const leftOverlay = resolvePanelLayoutState({
      tier: "tablet",
      desktopSidebarCollapsed: false,
      desktopInspectorCollapsed: false,
      activeOverlayDrawer: "left",
    });
    expect(leftOverlay.leftMode).toBe("overlay");
    expect(leftOverlay.rightMode).toBe("hidden");
    expect(leftOverlay.showBackdrop).toBe(true);
    expect(getShellClassNames(leftOverlay, true)).toBe(
      "studio-shell studio-shell--left-overlay studio-shell--inspector-hidden"
    );

    const rightOverlay = resolvePanelLayoutState({
      tier: "tablet",
      desktopSidebarCollapsed: false,
      desktopInspectorCollapsed: false,
      activeOverlayDrawer: "right",
    });
    expect(rightOverlay.leftMode).toBe("rail");
    expect(rightOverlay.rightMode).toBe("overlay");
    expect(rightOverlay.showBackdrop).toBe(true);
  });

  it("hides both panes by default on mobile even when desktop flags are expanded", () => {
    const mobileIdle = resolvePanelLayoutState({
      tier: "mobile",
      desktopSidebarCollapsed: false,
      desktopInspectorCollapsed: false,
      activeOverlayDrawer: "none",
    });
    expect(mobileIdle.leftMode).toBe("hidden");
    expect(mobileIdle.rightMode).toBe("hidden");
    expect(mobileIdle.showBackdrop).toBe(false);
    expect(mobileIdle.showMobileMenuButton).toBe(true);
    expect(getShellClassNames(mobileIdle, true)).toBe(
      "studio-shell studio-shell--sidebar-hidden studio-shell--inspector-hidden"
    );

    const mobileRight = resolvePanelLayoutState({
      tier: "mobile",
      desktopSidebarCollapsed: false,
      desktopInspectorCollapsed: false,
      activeOverlayDrawer: "right",
    });
    expect(mobileRight.leftMode).toBe("hidden");
    expect(mobileRight.rightMode).toBe("overlay");
    expect(mobileRight.showBackdrop).toBe(true);
  });

  it("always returns no-campaign shell class when no campaign is active", () => {
    const state = resolvePanelLayoutState({
      tier: "mobile",
      desktopSidebarCollapsed: true,
      desktopInspectorCollapsed: true,
      activeOverlayDrawer: "left",
    });
    expect(getShellClassNames(state, false)).toBe("studio-shell no-campaign");
  });
});
