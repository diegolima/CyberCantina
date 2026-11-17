export type ViewportTier = "desktop" | "tablet" | "mobile";

export type SidebarCategoryKey =
  | "personas"
  | "characters"
  | "worlds"
  | "campaigns";

export type LeftPanelMode = "expanded" | "rail" | "overlay" | "hidden";
export type RightPanelMode = "expanded" | "overlay" | "hidden";
export type ActiveOverlayDrawer = "none" | "left" | "right";

export const MOBILE_MAX_WIDTH = 820;
export const TABLET_MAX_WIDTH = 1100;

export const LAYOUT_STORAGE_KEYS = {
  sidebarCollapsed: "cybercantina.layout.sidebarCollapsed",
  inspectorCollapsed: "cybercantina.layout.inspectorCollapsed",
} as const;

export interface PanelLayoutInput {
  tier: ViewportTier;
  desktopSidebarCollapsed: boolean;
  desktopInspectorCollapsed: boolean;
  activeOverlayDrawer: ActiveOverlayDrawer;
}

export interface PanelLayoutState {
  tier: ViewportTier;
  leftMode: LeftPanelMode;
  rightMode: RightPanelMode;
  showBackdrop: boolean;
  showMobileMenuButton: boolean;
  isSidebarOpen: boolean;
  isInspectorOpen: boolean;
}

/**
 * Classifies viewport width into one of the three campaign layout tiers:
 * - mobile: <= 820px
 * - tablet: 821px..1100px
 * - desktop: > 1100px
 */
export function getViewportTier(width: number): ViewportTier {
  if (width <= MOBILE_MAX_WIDTH) return "mobile";
  if (width <= TABLET_MAX_WIDTH) return "tablet";
  return "desktop";
}

/**
 * Computes effective panel visibility and drawer modes from viewport tier,
 * persisted desktop collapse flags, and transient overlay drawer state.
 */
export function resolvePanelLayoutState({
  tier,
  desktopSidebarCollapsed,
  desktopInspectorCollapsed,
  activeOverlayDrawer,
}: PanelLayoutInput): PanelLayoutState {
  if (tier === "desktop") {
    const leftMode: LeftPanelMode = desktopSidebarCollapsed ? "rail" : "expanded";
    const rightMode: RightPanelMode = desktopInspectorCollapsed ? "hidden" : "expanded";
    return {
      tier,
      leftMode,
      rightMode,
      showBackdrop: false,
      showMobileMenuButton: false,
      isSidebarOpen: !desktopSidebarCollapsed,
      isInspectorOpen: !desktopInspectorCollapsed,
    };
  }

  if (tier === "tablet") {
    const leftMode: LeftPanelMode = activeOverlayDrawer === "left" ? "overlay" : "rail";
    const rightMode: RightPanelMode = activeOverlayDrawer === "right" ? "overlay" : "hidden";
    return {
      tier,
      leftMode,
      rightMode,
      showBackdrop: activeOverlayDrawer !== "none",
      showMobileMenuButton: false,
      isSidebarOpen: activeOverlayDrawer === "left",
      isInspectorOpen: activeOverlayDrawer === "right",
    };
  }

  const leftMode: LeftPanelMode = activeOverlayDrawer === "left" ? "overlay" : "hidden";
  const rightMode: RightPanelMode = activeOverlayDrawer === "right" ? "overlay" : "hidden";
  return {
    tier,
    leftMode,
    rightMode,
    showBackdrop: activeOverlayDrawer !== "none",
    showMobileMenuButton: true,
    isSidebarOpen: activeOverlayDrawer === "left",
    isInspectorOpen: activeOverlayDrawer === "right",
  };
}

/**
 * Builds CSS class names for the root `.studio-shell` container.
 */
export function getShellClassNames(
  state: PanelLayoutState,
  hasCampaign: boolean
): string {
  if (!hasCampaign) {
    return "studio-shell no-campaign";
  }
  const classes = ["studio-shell"];
  if (state.leftMode === "rail") {
    classes.push("studio-shell--sidebar-rail");
  } else if (state.leftMode === "hidden") {
    classes.push("studio-shell--sidebar-hidden");
  } else if (state.leftMode === "overlay") {
    classes.push("studio-shell--left-overlay");
  }
  if (state.rightMode === "hidden") {
    classes.push("studio-shell--inspector-hidden");
  } else if (state.rightMode === "overlay") {
    classes.push("studio-shell--right-overlay");
  }
  return classes.join(" ");
}
