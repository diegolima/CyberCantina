import { CharacterRecord, PersonaRecord, WorldRecord } from "../types";

export interface MissingWorldDependency {
  worldId: string;
  worldName: string;
  charNames: string[];
}

export interface MissingResidentCharacters {
  worldId: string;
  worldName: string;
  unselectedChars: CharacterRecord[];
}

/**
 * Identify worlds that are referenced by selected characters but not included in the export set.
 */
export function findMissingWorldDependencies(
  selectedCharIds: Set<string>,
  characters: CharacterRecord[],
  selectedWorldIds: Set<string>,
  worlds: WorldRecord[]
): MissingWorldDependency[] {
  const worldMap = new Map(worlds.map((w) => [w.id, w]));
  const missing: MissingWorldDependency[] = [];
  const grouped = new Map<string, string[]>();

  for (const cid of selectedCharIds) {
    const char = characters.find((c) => c.id === cid);
    if (char?.world_id && !selectedWorldIds.has(char.world_id)) {
      const list = grouped.get(char.world_id) || [];
      list.push(char.name);
      grouped.set(char.world_id, list);
    }
  }

  for (const [wid, charNames] of grouped.entries()) {
    const w = worldMap.get(wid);
    if (w) {
      missing.push({ worldId: wid, worldName: w.name, charNames });
    }
  }

  return missing;
}

/**
 * Identify characters that belong to selected worlds but are not yet included in the export set.
 */
export function findMissingResidentCharacters(
  selectedWorldIds: Set<string>,
  worlds: WorldRecord[],
  selectedCharIds: Set<string>,
  characters: CharacterRecord[]
): MissingResidentCharacters[] {
  const worldMap = new Map(worlds.map((w) => [w.id, w]));
  const missing: MissingResidentCharacters[] = [];

  for (const wid of selectedWorldIds) {
    const w = worldMap.get(wid);
    if (!w) continue;
    const residentChars = characters.filter(
      (c) => c.world_id === wid && !selectedCharIds.has(c.id)
    );
    if (residentChars.length > 0) {
      missing.push({ worldId: wid, worldName: w.name, unselectedChars: residentChars });
    }
  }

  return missing;
}

/**
 * Normalize an export bundle name into a safe file slug.
 */
export function sanitizeBundleFilename(name: string): string {
  const clean = name.trim().replace(/[^\w\-_.]/g, "_");
  if (!clean) return "cybercantina_export.zcc";
  return clean.endsWith(".zcc") ? clean : `${clean}.zcc`;
}

/**
 * Compute the auto-populated package bundle name based on current selections.
 * Priority hierarchy (in increasing priority):
 * 1. Persona name, if a single persona is selected
 * 2. "Personas", if multiple personas are selected
 * 3. Character name, if a single character is selected (even if one or more personas are also selected)
 * 4. "Characters", if multiple characters are selected
 * 5. World name, if a single world is selected (even if one or more characters or personas are also selected)
 * 6. "Worlds", if multiple worlds are selected
 */
export function computeSuggestedBundleName(
  selectedWorlds: WorldRecord[],
  selectedChars: CharacterRecord[],
  selectedPersonas: PersonaRecord[]
): string {
  if (selectedWorlds.length > 1) {
    return "Worlds";
  }
  if (selectedWorlds.length === 1) {
    return selectedWorlds[0].name;
  }
  if (selectedChars.length > 1) {
    return "Characters";
  }
  if (selectedChars.length === 1) {
    return selectedChars[0].name;
  }
  if (selectedPersonas.length > 1) {
    return "Personas";
  }
  if (selectedPersonas.length === 1) {
    return selectedPersonas[0].name;
  }
  return "";
}

/**
 * Filter characters by name and tags (case-insensitive).
 */
export function filterCharacters(
  characters: CharacterRecord[],
  query: string
): CharacterRecord[] {
  const q = query.trim().toLowerCase();
  if (!q) return characters;
  const cleanQ = q.startsWith("#") ? q.slice(1).trim() : q;
  return characters.filter((c) => {
    if (c.name.toLowerCase().includes(q)) return true;
    if (
      c.tags &&
      c.tags.some(
        (t) =>
          t.toLowerCase().includes(q) ||
          (cleanQ.length > 0 && t.toLowerCase().includes(cleanQ))
      )
    ) {
      return true;
    }
    return false;
  });
}

/**
 * Filter worlds by name and tags/genre/locations (case-insensitive).
 */
export function filterWorlds(
  worlds: WorldRecord[],
  query: string
): WorldRecord[] {
  const q = query.trim().toLowerCase();
  if (!q) return worlds;
  const cleanQ = q.startsWith("#") ? q.slice(1).trim() : q;
  return worlds.filter((w) => {
    if (w.name.toLowerCase().includes(q)) return true;
    if (w.global_rules?.genre && w.global_rules.genre.toLowerCase().includes(q)) {
      return true;
    }
    if (
      w.locations &&
      w.locations.some((l) =>
        l.environmental_tags?.some(
          (t) =>
            t.toLowerCase().includes(q) ||
            (cleanQ.length > 0 && t.toLowerCase().includes(cleanQ))
        )
      )
    ) {
      return true;
    }
    if (
      w.lore_nodes &&
      w.lore_nodes.some((n) =>
        n.entity_tags?.some(
          (t) =>
            t.toLowerCase().includes(q) ||
            (cleanQ.length > 0 && t.toLowerCase().includes(cleanQ))
        )
      )
    ) {
      return true;
    }
    if (
      Array.isArray((w as any).tags) &&
      (w as any).tags.some(
        (t: string) =>
          t.toLowerCase().includes(q) ||
          (cleanQ.length > 0 && t.toLowerCase().includes(cleanQ))
      )
    ) {
      return true;
    }
    return false;
  });
}

/**
 * Filter personas by name and tags/trigger keywords (case-insensitive).
 */
export function filterPersonas(
  personas: PersonaRecord[],
  query: string
): PersonaRecord[] {
  const q = query.trim().toLowerCase();
  if (!q) return personas;
  const cleanQ = q.startsWith("#") ? q.slice(1).trim() : q;
  return personas.filter((p) => {
    if (p.name.toLowerCase().includes(q)) return true;
    if (
      p.lore_entries &&
      p.lore_entries.some((e) =>
        e.trigger_keywords?.some(
          (k) =>
            k.toLowerCase().includes(q) ||
            (cleanQ.length > 0 && k.toLowerCase().includes(cleanQ))
        )
      )
    ) {
      return true;
    }
    if (
      Array.isArray((p as any).tags) &&
      (p as any).tags.some(
        (t: string) =>
          t.toLowerCase().includes(q) ||
          (cleanQ.length > 0 && t.toLowerCase().includes(cleanQ))
      )
    ) {
      return true;
    }
    return false;
  });
}

export interface ExportableVideoItem {
  videoAssetId: string;
  entityType: "world" | "character" | "persona";
  entityId: string;
  entityName: string;
  imageLabel: string;
  byteSize: number;
  mimeType: string;
}

export interface ImportMediaSelection {
  importImages: boolean;
  importVideos: boolean;
}

export interface PurgeMediaSelection {
  purgeImages: boolean;
  purgeVideos: boolean;
}

/**
 * Format a byte count into a human-readable KB / MB display string.
 */
export function formatMediaBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 KB";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Collect all selectable linked videos belonging to the currently checked entities for .zcc bundle export.
 */
export function collectExportableVideos(
  worlds: readonly WorldRecord[],
  characters: readonly CharacterRecord[],
  personas: readonly PersonaRecord[],
  selectedWorldIds: ReadonlySet<string>,
  selectedCharIds: ReadonlySet<string>,
  selectedPersonaIds: ReadonlySet<string>,
  includeWorldMedia: boolean
): ExportableVideoItem[] {
  const items: ExportableVideoItem[] = [];

  if (includeWorldMedia) {
    for (const w of worlds) {
      if (!selectedWorldIds.has(w.id)) continue;
      for (const m of w.media ?? []) {
        if (!m.video_asset_id || !m.video_url) continue;
        items.push({
          videoAssetId: m.video_asset_id,
          entityType: "world",
          entityId: w.id,
          entityName: w.name,
          imageLabel: m.label || "World scene",
          byteSize: m.video_byte_size ?? 0,
          mimeType: m.video_mime_type ?? "video/mp4",
        });
      }
    }
  }

  for (const c of characters) {
    if (!selectedCharIds.has(c.id)) continue;
    for (const g of c.gallery ?? []) {
      if (!g.video_asset_id || !g.video_url) continue;
      items.push({
        videoAssetId: g.video_asset_id,
        entityType: "character",
        entityId: c.id,
        entityName: c.name,
        imageLabel: g.caption || "Character photo",
        byteSize: g.video_byte_size ?? 0,
        mimeType: g.video_mime_type ?? "video/mp4",
      });
    }
  }

  for (const p of personas) {
    if (!selectedPersonaIds.has(p.id)) continue;
    for (const g of p.gallery ?? []) {
      if (!g.video_asset_id || !g.video_url) continue;
      items.push({
        videoAssetId: g.video_asset_id,
        entityType: "persona",
        entityId: p.id,
        entityName: p.name,
        imageLabel: g.caption || "Persona photo",
        byteSize: g.video_byte_size ?? 0,
        mimeType: g.video_mime_type ?? "video/mp4",
      });
    }
  }

  return items;
}

/**
 * Compute coupled checkbox state for "Import media" (parent), "Images", and "Videos":
 * - Checking "Videos" automatically checks "Images" (videos cannot exist detached).
 * - Unchecking "Images" automatically unchecks "Videos".
 */
export function computeImportMediaToggleState(
  prev: ImportMediaSelection,
  control: "parent" | "images" | "videos",
  checked: boolean
): ImportMediaSelection {
  if (control === "parent") {
    return {
      importImages: checked,
      importVideos: checked,
    };
  }
  if (control === "images") {
    return {
      importImages: checked,
      importVideos: checked ? prev.importVideos : false,
    };
  }
  return {
    importImages: checked ? true : prev.importImages,
    importVideos: checked,
  };
}

/**
 * Compute coupled checkbox state for Admin Purge Non-Built-In Media:
 * Checking "Images" automatically selects and locks "Videos" because deleting images cascades to linked videos.
 */
export function computePurgeToggleState(
  prev: PurgeMediaSelection,
  target: "images" | "videos",
  checked: boolean
): PurgeMediaSelection {
  if (target === "images") {
    return {
      purgeImages: checked,
      purgeVideos: checked ? true : prev.purgeVideos,
    };
  }
  if (prev.purgeImages && !checked) {
    return {
      purgeImages: true,
      purgeVideos: true,
    };
  }
  return {
    purgeImages: prev.purgeImages,
    purgeVideos: checked,
  };
}

/**
 * Validate optional .zcc password-protection fields before triggering export.
 * Returns an error message string if invalid, or null if valid.
 */
export function validateExportPassword(
  enabled: boolean,
  password: string,
  confirmPassword: string
): string | null {
  if (!enabled) return null;
  if (!password) {
    return "Enter a password to encrypt this .zcc archive.";
  }
  if (password.length > 256) {
    return "Password must be 256 characters or fewer.";
  }
  if (password !== confirmPassword) {
    return "Passwords do not match.";
  }
  return null;
}

/**
 * Return true when library entity conflict selectors should be displayed in ImportPreviewModal.
 * When importing a campaign with standalone disabled, base entities are campaign-private
 * (pending_deletion = 1 / snapshot-only) so standalone library conflicts do not apply.
 */
export function shouldShowEntityConflictControls(
  hasCampaigns: boolean,
  importCampaignAssetsAsStandalone: boolean
): boolean {
  if (!hasCampaigns) return true;
  return importCampaignAssetsAsStandalone;
}
