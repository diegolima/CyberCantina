import { describe, expect, it } from "vitest";
import {
  getCategoryPrimaryImages,
  getCharacterEmotionPortrait,
  getEntityPrimaryImage,
} from "../entityImages";

describe("entityImages utility", () => {
  it("extracts character portrait default first", () => {
    const char = {
      name: "Aria",
      portraits: { default: "https://example.com/aria-default.png", alt: "https://example.com/aria-alt.png" },
      gallery: [{ url: "https://example.com/aria-gallery.png" }],
    };
    expect(getEntityPrimaryImage("characters", char)).toBe("https://example.com/aria-default.png");
  });

  it("extracts first portrait value when default is missing", () => {
    const char = {
      name: "Marcus",
      portraits: { happy: "https://example.com/marcus-happy.png" },
      gallery: [],
    };
    expect(getEntityPrimaryImage("characters", char)).toBe("https://example.com/marcus-happy.png");
  });

  it("falls back to gallery[0].url if portraits are empty", () => {
    const char = {
      name: "Kaelen",
      portraits: {},
      gallery: [{ url: "https://example.com/kaelen-1.png" }, { url: "https://example.com/kaelen-2.png" }],
    };
    expect(getEntityPrimaryImage("characters", char)).toBe("https://example.com/kaelen-1.png");
  });

  it("returns null if character has no images", () => {
    const char = {
      name: "Ghost",
      portraits: {},
      gallery: [],
    };
    expect(getEntityPrimaryImage("characters", char)).toBeNull();
  });

  it("collects at most one image per character in getCategoryPrimaryImages", () => {
    const chars = [
      {
        name: "Char1",
        portraits: { default: "https://example.com/c1.png" },
        gallery: [{ url: "https://example.com/c1-gal.png" }],
      },
      {
        name: "Char2",
        portraits: {},
        gallery: [{ url: "https://example.com/c2.png" }, { url: "https://example.com/c2-gal2.png" }],
      },
      {
        name: "Char3",
        portraits: {},
        gallery: [],
      },
    ];

    const result = getCategoryPrimaryImages("characters", chars);
    expect(result).toEqual(["https://example.com/c1.png", "https://example.com/c2.png"]);
  });

  it("supports future world/persona/campaign image fields gracefully", () => {
    const world = { cover_url: "https://example.com/world.png" };
    expect(getEntityPrimaryImage("worlds", world)).toBe("https://example.com/world.png");

    const persona = { avatar_url: "https://example.com/persona.png" };
    expect(getEntityPrimaryImage("personas", persona)).toBe("https://example.com/persona.png");

    const campaign = { cover_url: "https://example.com/campaign.png" };
    expect(getEntityPrimaryImage("campaigns", campaign)).toBe("https://example.com/campaign.png");
  });

  it("resolves live CARE emotion portraits with fallback to default and gallery", () => {
    const char = {
      name: "Kira",
      portraits: {
        default: "https://example.com/kira-default.webp",
        angry: "https://example.com/kira-angry.webp",
        happy: "https://example.com/kira-happy.webp",
      },
      gallery: [{ id: "g1", url: "https://example.com/kira-gal.webp", created_at: "2026" }],
    };

    expect(getCharacterEmotionPortrait(char, "angry")).toBe("https://example.com/kira-angry.webp");
    expect(getCharacterEmotionPortrait(char, "afraid")).toBe("https://example.com/kira-default.webp");
    expect(getCharacterEmotionPortrait(char, null)).toBe("https://example.com/kira-default.webp");
    expect(getCharacterEmotionPortrait(null, "happy")).toBeNull();
  });
});
