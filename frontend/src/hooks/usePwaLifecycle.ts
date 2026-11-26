import { useCallback, useEffect, useRef, useState } from "react";
import type { BeforeInstallPromptEvent, PwaLifecycleState } from "../types/pwa";
import {
  isServiceWorkerSupported,
  isStandaloneDisplayMode,
  shouldShowInstallAction,
} from "../utils/pwa";

export interface PwaLifecycleResult extends PwaLifecycleState {
  applyUpdate: () => Promise<void>;
  dismissUpdate: () => void;
  promptInstall: () => Promise<void>;
}

/**
 * Manages Service Worker update prompts (prompt-only, never auto-reloading)
 * and optional Chromium `beforeinstallprompt` install affordance.
 * Safely degrades to a no-op under Node SSR and plain-HTTP LAN origins.
 */
export function usePwaLifecycle(): PwaLifecycleResult {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isStandalone, setIsStandalone] = useState<boolean>(() =>
    typeof window !== "undefined" ? isStandaloneDisplayMode(window) : false
  );
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);

  const updateSwRef = useRef<((reloadPage?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    setIsStandalone(isStandaloneDisplayMode(window));

    const mediaQuery = window.matchMedia?.("(display-mode: standalone)");
    const handleDisplayModeChange = () => {
      setIsStandalone(isStandaloneDisplayMode(window));
    };
    mediaQuery?.addEventListener?.("change", handleDisplayModeChange);

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setIsStandalone(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    let cancelled = false;
    if (import.meta.env.PROD && isServiceWorkerSupported(window)) {
      void import("virtual:pwa-register")
        .then(({ registerSW }) => {
          if (cancelled) return;
          updateSwRef.current = registerSW({
            immediate: false,
            onNeedRefresh() {
              if (!cancelled) {
                setNeedRefresh(true);
              }
            },
          });
        })
        .catch(() => {
          // Ignore registration errors in restricted or unsupported contexts
        });
    }

    return () => {
      cancelled = true;
      mediaQuery?.removeEventListener?.("change", handleDisplayModeChange);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const applyUpdate = useCallback(async () => {
    if (!updateSwRef.current) {
      if (typeof window !== "undefined") {
        window.location.reload();
      }
      return;
    }
    setIsUpdating(true);
    try {
      await updateSwRef.current(true);
    } catch {
      setIsUpdating(false);
    }
  }, []);

  const dismissUpdate = useCallback(() => {
    setNeedRefresh(false);
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
    } catch {
      // Ignore user cancellation or browser prompt errors
    } finally {
      setDeferredPrompt(null);
    }
  }, [deferredPrompt]);

  const canInstall = shouldShowInstallAction({
    hasDeferredPrompt: deferredPrompt !== null,
    isStandalone,
  });

  return {
    needRefresh,
    canInstall,
    isStandalone,
    isUpdating,
    applyUpdate,
    dismissUpdate,
    promptInstall,
  };
}
