import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildHistoryNavState,
  computeOverlayReconcileAction,
  createNavSessionId,
  formatAppRoute,
  isStaleForwardOverlayState,
  parseAppRoute,
  parseHistoryNavState,
  routesEqual,
  sortOverlayStack,
} from "../navigationHistory";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("navigationHistory utilities", () => {
  it("parses and formats Home and Campaign routes accurately", () => {
    expect(parseAppRoute("/")).toEqual({ kind: "home" });
    expect(parseAppRoute("")).toEqual({ kind: "home" });
    expect(parseAppRoute("/campaigns/")).toEqual({ kind: "home" });
    expect(parseAppRoute("/campaigns/camp_1/extra")).toEqual({ kind: "home" });
    expect(parseAppRoute("/unknown")).toEqual({ kind: "home" });

    expect(parseAppRoute("/campaigns/camp_1")).toEqual({
      kind: "campaign",
      campaignId: "camp_1",
    });
    expect(parseAppRoute("/campaigns/camp_1/")).toEqual({
      kind: "campaign",
      campaignId: "camp_1",
    });
    expect(parseAppRoute("/campaigns/camp%20with%20spaces")).toEqual({
      kind: "campaign",
      campaignId: "camp with spaces",
    });

    expect(formatAppRoute({ kind: "home" })).toBe("/");
    expect(
      formatAppRoute({ kind: "campaign", campaignId: "camp 42" })
    ).toBe("/campaigns/camp%2042");
  });

  it("compares routes for equality", () => {
    expect(routesEqual({ kind: "home" }, { kind: "home" })).toBe(true);
    expect(
      routesEqual({ kind: "home" }, { kind: "campaign", campaignId: "a" })
    ).toBe(false);
    expect(
      routesEqual(
        { kind: "campaign", campaignId: "a" },
        { kind: "campaign", campaignId: "a" }
      )
    ).toBe(true);
    expect(
      routesEqual(
        { kind: "campaign", campaignId: "a" },
        { kind: "campaign", campaignId: "b" }
      )
    ).toBe(false);
  });

  it("builds and validates HistoryNavState envelopes", () => {
    const valid = buildHistoryNavState(
      "sess_1",
      { kind: "campaign", campaignId: "c_9" },
      2,
      "modal-b"
    );
    expect(valid).toEqual({
      __ccNav: 1,
      sessionId: "sess_1",
      route: { kind: "campaign", campaignId: "c_9" },
      overlayDepth: 2,
      overlayId: "modal-b",
    });
    expect(parseHistoryNavState(valid)).toEqual(valid);

    const depthZero = buildHistoryNavState("sess_1", { kind: "home" }, 0, "ignored");
    expect(depthZero.overlayId).toBeNull();

    expect(parseHistoryNavState(null)).toBeNull();
    expect(parseHistoryNavState({ __ccNav: 2 })).toBeNull();
    expect(
      parseHistoryNavState({
        __ccNav: 1,
        sessionId: "s",
        route: { kind: "campaign", campaignId: "" },
        overlayDepth: 0,
        overlayId: null,
      })
    ).toBeNull();
    expect(
      parseHistoryNavState({
        __ccNav: 1,
        sessionId: "s",
        route: { kind: "home" },
        overlayDepth: -1,
        overlayId: null,
      })
    ).toBeNull();
  });

  it("sorts overlay stack by priority ascending then registration seq", () => {
    const sorted = sortOverlayStack([
      { id: "confirm", priority: 20, seq: 1 },
      { id: "picker", priority: 0, seq: 2 },
      { id: "inspector", priority: 0, seq: 3 },
      { id: "lightbox", priority: 15, seq: 4 },
    ]);
    expect(sorted.map((item) => item.id)).toEqual([
      "picker",
      "inspector",
      "lightbox",
      "confirm",
    ]);
  });

  it("computes batched reconcile actions for push, swap replace, and pop", () => {
    expect(computeOverlayReconcileAction(0, 0)).toEqual({ kind: "noop" });
    expect(computeOverlayReconcileAction(0, 1)).toEqual({ kind: "push", count: 1 });
    expect(computeOverlayReconcileAction(0, 2)).toEqual({ kind: "push", count: 2 });
    expect(computeOverlayReconcileAction(1, 1)).toEqual({ kind: "replace" });
    expect(computeOverlayReconcileAction(2, 1)).toEqual({ kind: "pop", delta: 1 });
    expect(computeOverlayReconcileAction(3, 0)).toEqual({ kind: "pop", delta: 3 });
  });

  it("identifies stale Forward overlay states without blocking clean Back/route transitions", () => {
    const current = buildHistoryNavState("sess_a", { kind: "home" }, 1, "picker");
    expect(isStaleForwardOverlayState(null, "sess_a", 0, 0)).toBe(false);
    expect(
      isStaleForwardOverlayState(
        buildHistoryNavState("sess_a", { kind: "home" }, 0, null),
        "sess_a",
        0,
        0
      )
    ).toBe(false);
    // Closed modal still in Forward stack (committedDepth=0, active=0)
    expect(isStaleForwardOverlayState(current, "sess_a", 0, 0)).toBe(true);
    // Foreign session entry
    expect(isStaleForwardOverlayState(current, "sess_b", 1, 1)).toBe(true);
    // Legitimate pop from depth 2 -> depth 1 while 2 overlays were mounted
    expect(isStaleForwardOverlayState(current, "sess_a", 2, 2)).toBe(false);
  });

  it("generates navigation session IDs across randomUUID, getRandomValues, and counter fallbacks", () => {
    vi.stubGlobal("crypto", {
      randomUUID: () => "11111111-2222-4333-8444-555555555555",
    });
    expect(createNavSessionId()).toBe("11111111-2222-4333-8444-555555555555");

    // Simulate plain HTTP LAN origin where randomUUID is unavailable but getRandomValues exists
    vi.stubGlobal("crypto", {
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i += 1) {
          arr[i] = i + 1;
        }
        return arr;
      },
    });
    expect(createNavSessionId()).toBe("ccnav_0102030405060708090a0b0c0d0e0f10");

    // Simulate environment with no Web Crypto at all
    vi.stubGlobal("crypto", undefined);
    const idA = createNavSessionId();
    const idB = createNavSessionId();
    expect(idA).toMatch(/^ccnav_[0-9a-z]+_[0-9a-z]+$/);
    expect(idB).toMatch(/^ccnav_[0-9a-z]+_[0-9a-z]+$/);
    expect(idA).not.toBe(idB);
  });
});
