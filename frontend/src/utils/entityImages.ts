import { BasicEmotion, CampaignRecord, CharacterRecord, PersonaRecord, WorldRecord } from "../types";

export type EntityCategory = "personas" | "characters" | "worlds" | "campaigns";

/**
 * Resolves a character's portrait for a live CARE BasicEmotion, falling back cleanly
 * to portraits.default -> first uploaded portrait -> gallery[0] -> null.
 */
export function getCharacterEmotionPortrait(
  character: Partial<CharacterRecord> | null | undefined,
  activeEmotion?: BasicEmotion | string | null
): string | null {
  if (!character) return null;
  const portraits = character.portraits || {};
  if (activeEmotion && portraits[activeEmotion]) {
    return portraits[activeEmotion];
  }
  if (portraits.default) {
    return portraits.default;
  }
  const portraitValues = Object.values(portraits);
  if (portraitValues.length > 0 && portraitValues[0]) {
    return portraitValues[0];
  }
  if (character.gallery && character.gallery.length > 0 && character.gallery[0]?.url) {
    return character.gallery[0].url;
  }
  return null;
}

/**
 * Extracts the single primary image URL for an entity (if any).
 * Ready for future schema extensions on personas, worlds, and campaigns.
 */
export function getEntityPrimaryImage(
  category: EntityCategory,
  entity: PersonaRecord | CharacterRecord | WorldRecord | CampaignRecord | any
): string | null {
  if (!entity) return null;

  switch (category) {
    case "characters": {
      const c = entity as CharacterRecord;
      if (c.portraits?.default) return c.portraits.default;
      const portraitValues = Object.values(c.portraits || {});
      if (portraitValues.length > 0 && portraitValues[0]) return portraitValues[0];
      if (c.gallery && c.gallery.length > 0 && c.gallery[0]?.url) return c.gallery[0].url;
      return null;
    }
    case "worlds": {
      const w = entity as WorldRecord & Record<string, any>;
      const firstWorldImage = (w.media || []).find(
        (m) => m.media_type === "image" && Boolean(m.url)
      );
      if (firstWorldImage?.url) return firstWorldImage.url;
      return (
        w.cover_url ||
        w.banner_url ||
        w.image_url ||
        (w.gallery && w.gallery[0]?.url) ||
        null
      );
    }
    case "personas": {
      const p = entity as PersonaRecord & Record<string, any>;
      if (p.portrait_url) return p.portrait_url;
      if (p.avatar_url || p.image_url) return p.avatar_url || p.image_url;
      if (p.gallery && p.gallery.length > 0 && p.gallery[0]?.url) {
        return p.gallery[0].url;
      }
      return null;
    }
    case "campaigns": {
      const camp = entity as any;
      return camp.cover_url || camp.banner_url || camp.image_url || null;
    }
    default:
      return null;
  }
}

/**
 * Returns a list of primary image URLs (at most 1 per entity) for the given category.
 * If multiple entities share the same URL, duplicates are removed.
 */
export function getCategoryPrimaryImages(
  category: EntityCategory,
  entities: Array<PersonaRecord | CharacterRecord | WorldRecord | CampaignRecord | any>
): string[] {
  const images: string[] = [];
  for (const item of entities) {
    const img = getEntityPrimaryImage(category, item);
    if (img && !images.includes(img)) {
      images.push(img);
    }
  }
  return images;
}
