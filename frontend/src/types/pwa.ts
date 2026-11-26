export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export interface PwaLifecycleState {
  needRefresh: boolean;
  canInstall: boolean;
  isStandalone: boolean;
  isUpdating: boolean;
}
