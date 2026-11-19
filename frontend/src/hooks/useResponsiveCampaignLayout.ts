import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActiveOverlayDrawer,
  LAYOUT_STORAGE_KEYS,
  MOBILE_MAX_WIDTH,
  PanelLayoutState,
  TABLET_MAX_WIDTH,
  ViewportTier,
  getViewportTier,
  resolvePanelLayoutState,
} from "../utils/campaignLayout";

function readBooleanFlag(key: string, fallback: boolean): boolean {
  try {
    if (typeof window === "undefined") return fallback;
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) === true;
  } catch {
    return fallback;
  }
}

function writeBooleanFlag(key: string, value: boolean): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be unavailable (private mode / quota).
  }
}

function detectInitialTier(): ViewportTier {
  if (typeof window === "undefined") return "desktop";
  return getViewportTier(window.innerWidth);
}

export interface UseResponsiveCampaignLayoutOptions {
  hasCampaign: boolean;
  /** True when a higher-layer popover (e.g. NotesFlyout) should block Escape dismissal. */
  hasTopPopoverOpen?: boolean;
  /** Optional callback run when opening a drawer/panel so sibling popovers can dismiss. */
  onPanelOpened?: () => void;
}

export interface ResponsiveCampaignLayoutResult extends PanelLayoutState {
  activeOverlayDrawer: ActiveOverlayDrawer;
  toggleSidebar: () => void;
  toggleInspector: () => void;
  closeOverlays: () => void;
}

/**
 * Coordinates 3-tier responsive layout state (desktop grid collapse with
 * localStorage persistence, tablet icon rail + overlay drawers, and mobile
 * header-triggered overlay drawers).
 */
export function useResponsiveCampaignLayout({
  hasCampaign,
  hasTopPopoverOpen = false,
  onPanelOpened,
}: UseResponsiveCampaignLayoutOptions): ResponsiveCampaignLayoutResult {
  const [tier, setTier] = useState<ViewportTier>(detectInitialTier);
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState<boolean>(
    () => readBooleanFlag(LAYOUT_STORAGE_KEYS.sidebarCollapsed, false)
  );
  const [desktopInspectorCollapsed, setDesktopInspectorCollapsed] = useState<boolean>(
    () => readBooleanFlag(LAYOUT_STORAGE_KEYS.inspectorCollapsed, false)
  );
  const [activeOverlayDrawer, setActiveOverlayDrawer] =
    useState<ActiveOverlayDrawer>("none");

  useEffect(() => {
    writeBooleanFlag(LAYOUT_STORAGE_KEYS.sidebarCollapsed, desktopSidebarCollapsed);
  }, [desktopSidebarCollapsed]);

  useEffect(() => {
    writeBooleanFlag(
      LAYOUT_STORAGE_KEYS.inspectorCollapsed,
      desktopInspectorCollapsed
    );
  }, [desktopInspectorCollapsed]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mobileMq = window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`);
    const tabletMq = window.matchMedia(`(max-width: ${TABLET_MAX_WIDTH}px)`);

    const syncTier = () => {
      const nextTier: ViewportTier = mobileMq.matches
        ? "mobile"
        : tabletMq.matches
        ? "tablet"
        : "desktop";
      setTier(nextTier);
      if (nextTier === "desktop") {
        setActiveOverlayDrawer("none");
      }
    };

    syncTier();
    mobileMq.addEventListener("change", syncTier);
    tabletMq.addEventListener("change", syncTier);
    return () => {
      mobileMq.removeEventListener("change", syncTier);
      tabletMq.removeEventListener("change", syncTier);
    };
  }, []);

  // Reset transient overlays when exiting a campaign.
  useEffect(() => {
    if (!hasCampaign) {
      setActiveOverlayDrawer("none");
    }
  }, [hasCampaign]);

  const closeOverlays = useCallback(() => {
    setActiveOverlayDrawer("none");
  }, []);

  // Escape closes the active overlay drawer unless a modal or top popover is above it.
  useEffect(() => {
    if (!hasCampaign || activeOverlayDrawer === "none") return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (hasTopPopoverOpen) return;
      if (typeof document !== "undefined" && document.querySelector(".modal-backdrop")) {
        return;
      }
      setActiveOverlayDrawer("none");
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hasCampaign, activeOverlayDrawer, hasTopPopoverOpen]);

  const toggleSidebar = useCallback(() => {
    if (tier === "desktop") {
      if (desktopSidebarCollapsed) {
        onPanelOpened?.();
      }
      setDesktopSidebarCollapsed((prev) => !prev);
      return;
    }
    if (activeOverlayDrawer !== "left") {
      onPanelOpened?.();
    }
    setActiveOverlayDrawer((prev) => (prev === "left" ? "none" : "left"));
  }, [tier, desktopSidebarCollapsed, activeOverlayDrawer, onPanelOpened]);

  const toggleInspector = useCallback(() => {
    if (tier === "desktop") {
      if (desktopInspectorCollapsed) {
        onPanelOpened?.();
      }
      setDesktopInspectorCollapsed((prev) => !prev);
      return;
    }
    if (activeOverlayDrawer !== "right") {
      onPanelOpened?.();
    }
    setActiveOverlayDrawer((prev) => (prev === "right" ? "none" : "right"));
  }, [tier, desktopInspectorCollapsed, activeOverlayDrawer, onPanelOpened]);

  const resolved = useMemo(
    () =>
      resolvePanelLayoutState({
        tier,
        desktopSidebarCollapsed,
        desktopInspectorCollapsed,
        activeOverlayDrawer,
      }),
    [tier, desktopSidebarCollapsed, desktopInspectorCollapsed, activeOverlayDrawer]
  );

  return {
    ...resolved,
    activeOverlayDrawer,
    toggleSidebar,
    toggleInspector,
    closeOverlays,
  };
}
