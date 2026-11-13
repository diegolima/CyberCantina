export interface WorldGlobalRules {
  genre: string;
  tone: string;
  setting_overview: string;
  tech_or_magic_rules: string;
  starting_timestamp: string;
}

export type CompassDirection = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

export type SharedLoreCategory = "history" | "culture" | "faction" | "rumor";
export type WorldLoreCategory = SharedLoreCategory | "artifact";
export type LocationLoreCategory = SharedLoreCategory | "secret";
export type AnyLoreCategory = WorldLoreCategory | LocationLoreCategory;

export const WORLD_LORE_CATEGORIES: WorldLoreCategory[] = [
  "history",
  "culture",
  "faction",
  "rumor",
  "artifact",
];

export const LOCATION_LORE_CATEGORIES: LocationLoreCategory[] = [
  "history",
  "culture",
  "faction",
  "rumor",
  "secret",
];

export interface LocationLoreNodeDraft {
  id?: string | null;
  title: string;
  category: LocationLoreCategory;
  content: string;
  entity_tags: string[];
}

export interface LoreNode {
  id: string;
  world_id: string;
  location_id?: string | null;
  container_id?: string | null;
  campaign_id?: string | null;
  title: string;
  category: AnyLoreCategory;
  content: string;
  entity_tags: string[];
}

export interface LocationContainer {
  id: string;
  world_id: string;
  created_at_turn_id?: string | null;
  parent_container_id?: string | null;
  depth: 1 | 2 | 3 | 4;
  name: string;
  description: string;
  environmental_tags: string[];
  ui_x?: number | null;
  ui_y?: number | null;
  icon?: string | null;
  lore_nodes?: LoreNode[];
}

export interface LocationNode {
  id: string;
  world_id: string;
  created_at_turn_id?: string | null;
  superseded_at_turn_id?: string | null;
  container_id?: string | null;
  is_entry_exit?: boolean;
  name: string;
  summary: string;
  description: string;
  environmental_tags: string[];
  is_starting_location: boolean;
  is_hub?: boolean;
  starting_message?: string;
  ui_x?: number | null;
  ui_y?: number | null;
  icon?: string | null;
  is_visited?: boolean;
  lore_nodes?: LoreNode[];
}

export interface LocationEdge {
  id: string;
  world_id: string;
  from_location_id: string;
  to_location_id: string;
  direction_label: string;
  compass_direction?: CompassDirection | null;
  travel_minutes: number;
  is_locked_or_hidden: boolean;
  created_at_turn_id?: string | null;
  superseded_at_turn_id?: string | null;
}

export interface NeighborLocationView {
  edge_id: string;
  direction_label: string;
  compass_direction?: CompassDirection | null;
  travel_minutes: number;
  is_locked_or_hidden: boolean;
  destination: LocationNode;
}

export interface WorldRecord {
  id: string;
  name: string;
  global_rules: WorldGlobalRules;
  pending_deletion?: boolean;
  created_at: string;
  containers?: LocationContainer[];
  locations: LocationNode[];
  edges: LocationEdge[];
  lore_nodes: LoreNode[];
}

export interface LocationNodeDraft {
  key: string;
  name: string;
  summary: string;
  description: string;
  environmental_tags: string[];
  is_starting_location: boolean;
  is_hub?: boolean;
  starting_message?: string;
  lore_nodes?: LocationLoreNodeDraft[];
}

export interface LocationEdgeDraft {
  from_key: string;
  to_key: string;
  direction_label: string;
  reverse_direction_label: string;
  compass_direction?: CompassDirection | null;
  travel_minutes: number;
  is_locked_or_hidden: boolean;
  bidirectional: boolean;
}

export interface WorldWizardSeed {
  name: string;
  genre_and_tone: string;
  core_premise: string;
  initial_hub_concept: string;
  location_count: number;
}

export interface WorldWizardDraft {
  name: string;
  global_rules: WorldGlobalRules;
  locations: LocationNodeDraft[];
  edges: LocationEdgeDraft[];
  lore_nodes: Array<{
    id?: string | null;
    title: string;
    category: WorldLoreCategory;
    content: string;
    entity_tags: string[];
  }>;
}

export interface WorldMapDraft {
  locations: LocationNodeDraft[];
  edges: LocationEdgeDraft[];
}

export interface WorldMapReimagineRequest {
  world_name: string;
  global_rules: WorldGlobalRules;
  map_description: string;
  location_count?: number;
}
