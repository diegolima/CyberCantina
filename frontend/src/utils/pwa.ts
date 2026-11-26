export interface PwaWindowLike {
  isSecureContext?: boolean;
  navigator?: {
    serviceWorker?: unknown;
    standalone?: boolean;
  };
  matchMedia?: (query: string) => { matches: boolean };
}

export interface PwaUpdateBannerCopy {
  title: string;
  detail: string;
  reloadLabel: string;
}

/**
 * Returns true when running inside an installed standalone PWA window
 * (CSS display-mode: standalone or iOS Safari navigator.standalone).
 */
export function isStandaloneDisplayMode(win?: PwaWindowLike | null): boolean {
  if (!win) return false;
  try {
    if (win.matchMedia?.("(display-mode: standalone)")?.matches) {
      return true;
    }
  } catch {
    // Ignore matchMedia errors in partial environments
  }
  return win.navigator?.standalone === true;
}

/**
 * Returns true when Service Worker registration is permitted (browser, secure
 * context such as HTTPS or localhost, and navigator.serviceWorker available).
 */
export function isServiceWorkerSupported(win?: PwaWindowLike | null): boolean {
  if (!win) return false;
  return Boolean(win.isSecureContext && win.navigator && "serviceWorker" in win.navigator);
}

/**
 * Determines whether the subtle "Install App" action should be surfaced.
 */
export function shouldShowInstallAction(opts: {
  hasDeferredPrompt: boolean;
  isStandalone: boolean;
  dismissed?: boolean;
}): boolean {
  if (opts.isStandalone || opts.dismissed) return false;
  return opts.hasDeferredPrompt;
}

/**
 * Produces calm, streaming-aware copy for the non-intrusive PWA update banner.
 */
export function getUpdateBannerCopy(
  isStreaming: boolean,
  isUpdating = false
): PwaUpdateBannerCopy {
  if (isUpdating) {
    return {
      title: "Updating CyberCantina…",
      detail: "Applying the new app shell and reloading.",
      reloadLabel: "Reloading…",
    };
  }
  if (isStreaming) {
    return {
      title: "New CyberCantina version ready",
      detail: "A turn is currently streaming — reload after it finishes to avoid interrupting.",
      reloadLabel: "Reload",
    };
  }
  return {
    title: "New CyberCantina version ready",
    detail: "Reload to switch to the latest interface.",
    reloadLabel: "Reload",
  };
}
