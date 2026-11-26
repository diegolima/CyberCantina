import { describe, expect, it } from "vitest";
import {
  getUpdateBannerCopy,
  isServiceWorkerSupported,
  isStandaloneDisplayMode,
  shouldShowInstallAction,
} from "../pwa";

describe("PWA helper utilities", () => {
  it("detects standalone display mode safely across SSR, browser, and iOS", () => {
    expect(isStandaloneDisplayMode(undefined)).toBe(false);
    expect(isStandaloneDisplayMode(null)).toBe(false);
    expect(
      isStandaloneDisplayMode({
        matchMedia: () => ({ matches: false }),
        navigator: { standalone: false },
      })
    ).toBe(false);
    expect(
      isStandaloneDisplayMode({
        matchMedia: (q) => ({ matches: q === "(display-mode: standalone)" }),
      })
    ).toBe(true);
    expect(
      isStandaloneDisplayMode({
        matchMedia: () => ({ matches: false }),
        navigator: { standalone: true },
      })
    ).toBe(true);
  });

  it("requires secure context and navigator.serviceWorker for SW registration", () => {
    expect(isServiceWorkerSupported(undefined)).toBe(false);
    expect(
      isServiceWorkerSupported({
        isSecureContext: false,
        navigator: { serviceWorker: {} },
      })
    ).toBe(false);
    expect(
      isServiceWorkerSupported({
        isSecureContext: true,
        navigator: {},
      })
    ).toBe(false);
    expect(
      isServiceWorkerSupported({
        isSecureContext: true,
        navigator: { serviceWorker: {} },
      })
    ).toBe(true);
  });

  it("shows install action only when deferred prompt is present and not standalone", () => {
    expect(
      shouldShowInstallAction({ hasDeferredPrompt: false, isStandalone: false })
    ).toBe(false);
    expect(
      shouldShowInstallAction({ hasDeferredPrompt: true, isStandalone: true })
    ).toBe(false);
    expect(
      shouldShowInstallAction({
        hasDeferredPrompt: true,
        isStandalone: false,
        dismissed: true,
      })
    ).toBe(false);
    expect(
      shouldShowInstallAction({ hasDeferredPrompt: true, isStandalone: false })
    ).toBe(true);
  });

  it("produces idle, streaming-caution, and updating banner copy", () => {
    const idle = getUpdateBannerCopy(false, false);
    expect(idle.title).toContain("New CyberCantina version ready");
    expect(idle.reloadLabel).toBe("Reload");

    const streaming = getUpdateBannerCopy(true, false);
    expect(streaming.detail).toContain("streaming");
    expect(streaming.reloadLabel).toBe("Reload");

    const updating = getUpdateBannerCopy(false, true);
    expect(updating.reloadLabel).toBe("Reloading…");
  });
});
