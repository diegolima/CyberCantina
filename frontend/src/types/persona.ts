import type { GalleryImage, ItemFlag } from "./character";
import type { PhysicalStance } from "./physical";

export type DisclosureDetectionMode = "llm_intent" | "token_matching" | "hybrid";

export interface PersonaItemInstance {
  id: string;
  name: string;
  note: string;
  flags: ItemFlag[];
  is_secret: boolean;
  trigger_keywords: string[];
}

export interface PersonaLoreEntry {
  id: string;
  title: string;
  content: string;
  is_secret: boolean;
  trigger_keywords: string[];
}

export interface PersonaKnowledgeProvenance {
  unlocked_at_turn_id: string;
  learned_from: string;
}

export interface PersonaRecord {
  id: string;
  owner_id: string;
  name: string;
  tagline?: string;
  species?: string;
  age?: string | null;
  age_is_secret: boolean;
  sex?: string;
  pronouns?: string;
  persona_bio?: string;
  tags?: string[];
  build_and_height?: string;
  distinctive_features?: string[];
  physical_appearance?: string;
  equipped: PersonaItemInstance[];
  inventory: PersonaItemInstance[];
  lore_entries: PersonaLoreEntry[];
  portrait_url?: string | null;
  gallery?: GalleryImage[];
  unsupported_fields?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface PersonaCreatePayload {
  name: string;
  tagline?: string;
  species?: string;
  age?: string | null;
  age_is_secret?: boolean;
  sex?: string;
  pronouns?: string;
  persona_bio?: string;
  tags?: string[];
  build_and_height?: string;
  distinctive_features?: string[];
  physical_appearance?: string;
  equipped?: PersonaItemInstance[];
  inventory?: PersonaItemInstance[];
  lore_entries?: PersonaLoreEntry[];
  portrait_url?: string | null;
  gallery?: GalleryImage[];
  unsupported_fields?: Record<string, unknown>;
}

export interface PersonaUpdatePayload {
  name?: string;
  tagline?: string;
  species?: string;
  age?: string | null;
  age_is_secret?: boolean;
  sex?: string;
  pronouns?: string;
  persona_bio?: string;
  tags?: string[];
  build_and_height?: string;
  distinctive_features?: string[];
  physical_appearance?: string;
  equipped?: PersonaItemInstance[];
  inventory?: PersonaItemInstance[];
  lore_entries?: PersonaLoreEntry[];
  unsupported_fields?: Record<string, unknown>;
}

export interface PersonaTurnStateSnapshot {
  turn_id: string;
  equipped: PersonaItemInstance[];
  inventory: PersonaItemInstance[];
  physical_stance?: PhysicalStance;
  physical_context?: string;
}

// ---------------------------------------------------------------------------
// Import / Export (.zcc) Types
// ---------------------------------------------------------------------------
