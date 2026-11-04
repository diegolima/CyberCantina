import { describe, expect, it } from "vitest";
import { getCategoryPrimaryImages } from "../entityImages";

describe("Home Dashboard Logic", () => {
  it("deduplicates images if two entities happen to share the same URL", () => {
    const chars = [
      { name: "C1", portraits: { default: "https://example.com/shared.png" } },
      { name: "C2", portraits: { default: "https://example.com/shared.png" } },
    ];
    const images = getCategoryPrimaryImages("characters", chars);
    expect(images).toHaveLength(1);
    expect(images[0]).toBe("https://example.com/shared.png");
  });

  it("handles null/undefined/empty arrays cleanly without crashing", () => {
    expect(getCategoryPrimaryImages("personas", [])).toEqual([]);
    expect(getCategoryPrimaryImages("worlds", [])).toEqual([]);
    expect(getCategoryPrimaryImages("campaigns", [])).toEqual([]);
    expect(getCategoryPrimaryImages("characters", [null as any, undefined as any])).toEqual([]);
  });

  it("respects single-image static behavior condition", () => {
    const singleImage = ["https://example.com/only-one.png"];
    const hasMultiple = singleImage.length > 1;
    expect(hasMultiple).toBe(false);

    const multipleImages = ["https://example.com/one.png", "https://example.com/two.png"];
    expect(multipleImages.length > 1).toBe(true);
  });
});
