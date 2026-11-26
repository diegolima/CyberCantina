export type AppRoute =
  | { kind: "home" }
  | { kind: "campaign"; campaignId: string };

export interface HistoryNavState {
  __ccNav: 1;
  sessionId: string;
  route: AppRoute;
  overlayDepth: number;
  overlayId: string | null;
}

export interface OverlayBackGuard {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface OverlayRegistration {
  id: string;
  onClose: () => void;
  priority?: number;
  isDirty?: boolean;
  guard?: OverlayBackGuard;
}

export interface NavigationGuardPrompt {
  kind: "overlay" | "route";
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
}
