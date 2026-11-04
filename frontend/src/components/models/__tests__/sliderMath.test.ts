import { describe, expect, it } from "vitest";
import { MAX_TOKENS_HARD_MAX, MAX_TOKENS_HARD_MIN, TEMPERATURE_SPEC, maxTokensSpec } from "../modelLimits";
import {
  clamp,
  formatValue,
  isOutsideTrack,
  parseDraft,
  positionToValue,
  roundTo,
  valueToPosition,
} from "../sliderMath";

describe("parseDraft", () => {
  it("accepts partial decimals while typing and never returns NaN", () => {
    expect(parseDraft("0.", TEMPERATURE_SPEC)).toBe(0);
    expect(parseDraft("0.7", TEMPERATURE_SPEC)).toBe(0.7);
    expect(parseDraft("1,25", TEMPERATURE_SPEC)).toBe(1.25);
    for (const bad of ["", "   ", "-", ".", "abc", "1e999"]) {
      expect(parseDraft(bad, TEMPERATURE_SPEC)).toBeNull();
    }
  });

  it("rejects values outside the hard bounds instead of clamping silently", () => {
    expect(parseDraft("2.01", TEMPERATURE_SPEC)).toBeNull();
    expect(parseDraft("-0.1", TEMPERATURE_SPEC)).toBeNull();
    const tokens = maxTokensSpec("actor");
    expect(parseDraft(String(MAX_TOKENS_HARD_MIN - 1), tokens)).toBeNull();
    expect(parseDraft(String(MAX_TOKENS_HARD_MAX + 1), tokens)).toBeNull();
    expect(parseDraft("8192", tokens)).toBe(8192);
  });

  it("avoids float artefacts (0.1 + 0.2 style)", () => {
    expect(roundTo(0.1 + 0.2, 2)).toBe(0.3);
    expect(formatValue(0.30000000000000004, 2)).toBe("0.3");
    expect(parseDraft("0.123456", TEMPERATURE_SPEC)).toBe(0.12);
  });
});

describe("temperature slider (linear, 0.05 notches)", () => {
  it("snaps dragged positions to 0.05 increments", () => {
    for (let i = 0; i <= 1000; i += 7) {
      const v = positionToValue(i / 1000, TEMPERATURE_SPEC);
      expect(Math.abs(v / 0.05 - Math.round(v / 0.05))).toBeLessThan(1e-9);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(2);
    }
  });

  it("shows an exact typed value while the thumb sits on the nearest snap", () => {
    const pos = valueToPosition(0.72, TEMPERATURE_SPEC);
    expect(positionToValue(pos, TEMPERATURE_SPEC)).toBe(0.7);
  });
});

describe("max tokens slider (log scale, clamped track)", () => {
  const actor = maxTokensSpec("actor");

  it("spaces the prose notches evenly", () => {
    const positions = actor.notches.map((n) => valueToPosition(n.value, actor));
    const gaps = positions.slice(1).map((p, i) => p - positions[i]);
    gaps.forEach((g) => expect(g).toBeCloseTo(gaps[0], 6));
    expect(positions[0]).toBe(0);
    expect(positions[positions.length - 1]).toBe(1);
  });

  it("round-trips notch values and snaps close drags onto them", () => {
    for (const n of actor.notches) {
      expect(positionToValue(valueToPosition(n.value, actor), actor)).toBe(n.value);
    }
    expect(positionToValue(valueToPosition(1030, actor), actor)).toBe(1024);
  });

  it("clamps the thumb for typed values beyond the track and flags them as custom", () => {
    expect(valueToPosition(8192, actor)).toBe(1);
    expect(valueToPosition(64, actor)).toBe(0);
    expect(isOutsideTrack(8192, actor)).toBe(true);
    expect(isOutsideTrack(64, actor)).toBe(true);
    expect(isOutsideTrack(1024, actor)).toBe(false);
    expect(clamp(9000, 64, 8192)).toBe(8192);
  });

  it("puts the Clerk default (768) on a notch so it is not shown as custom", () => {
    const clerk = maxTokensSpec("clerk");
    expect(clerk.notches.some((n) => n.value === 768)).toBe(true);
    expect(isOutsideTrack(768, clerk)).toBe(false);
  });

  it("never produces values outside the track from any slider position", () => {
    for (let i = 0; i <= 1000; i += 11) {
      const v = positionToValue(i / 1000, actor);
      expect(v).toBeGreaterThanOrEqual(actor.trackMin);
      expect(v).toBeLessThanOrEqual(actor.trackMax);
    }
  });
});
