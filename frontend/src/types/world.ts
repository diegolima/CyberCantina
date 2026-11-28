import type { ItemFlag } from "./character";

export interface WorldGlobalRules {
  genre: string;
  tone: string;
  setting_overview: string;
  tech_or_magic_rules: string;
  starting_timestamp: string;
  describe_on_first_visit?: boolean;
  auto_spawn_props_on_search_crit?: boolean;
}

export interface LocationProp {
  id?: string;
  name: string;
  note: string;
  flags: ItemFlag[];
  lore_id?: string | null;
  is_hidden: boolean;
  auto_spawned?: boolean;
}

import type { SeedUpdateInfo } from "./seed";

export type CompassDirection = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

export type EdgeDistanceMode = "flexible" | "locked" | "non_euclidean";

export type SharedLoreCategory = "history" | "culture" | "faction" | "rumor";
export type WorldLoreCategory = SharedLoreCategory | "figure" | "threat" | "artifact";
export type LocationLoreCategory = SharedLoreCategory | "secret";
export type AnyLoreCategory = WorldLoreCategory | LocationLoreCategory;

export const WORLD_LORE_CATEGORIES: WorldLoreCategory[] = [
  "history",
  "culture",
  "faction",
  "figure",
  "rumor",
  "threat",
  "artifact",
];

export const LOCATION_LORE_CATEGORIES: LocationLoreCategory[] = [
  "history",
  "culture",
  "faction",
  "rumor",
  "secret",
];

export interface WorldLoreNodeDraft {
  id?: string | null;
  title: string;
  category: WorldLoreCategory;
  content: string;
  entity_tags: string[];
}

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
  created_at_turn_id?: string | null;
  origin_lore_id?: string | null;
  is_major_event?: boolean;
  title: string;
  category: AnyLoreCategory;
  content: string;
  entity_tags: string[];
}

export interface WorldMediaItem {
  id: string;
  media_type: "image" | "audio";
  url: string;
  label: string;
  mime_type: string;
  byte_size: number;
  sort_order: number;
  is_public?: boolean;
  video_asset_id?: string | null;
  video_url?: string | null;
  video_mime_type?: string | null;
  video_byte_size?: number | null;
  created_at: string;
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
  ghost_coords?: Record<string, { x: number; y: number }>;
  icon?: string | null;
  image_media_id?: string | null;
  image_url?: string | null;
  image_label?: string | null;
  video_url?: string | null;
  video_mime_type?: string | null;
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
  anchor_location_id?: string | null;
  image_media_id?: string | null;
  image_url?: string | null;
  image_label?: string | null;
  video_url?: string | null;
  video_mime_type?: string | null;
  is_visited?: boolean;
  lore_nodes?: LoreNode[];
  props?: LocationProp[];
}

export interface LocationEdge {
  id: string;
  world_id: string;
  from_location_id: string;
  to_location_id: string;
  direction_label: string;
  compass_direction?: CompassDirection | null;
  distance_meters: number;
  speed_modifier: number;
  travel_mode?: string | null;
  obstacles: string[];
  is_blocked: boolean;
  is_secret: boolean;
  distance_mode?: EdgeDistanceMode;
  is_vertical?: boolean;
  created_at_turn_id?: string | null;
  superseded_at_turn_id?: string | null;
}

export interface NeighborLocationView {
  edge_id: string;
  direction_label: string;
  compass_direction?: CompassDirection | null;
  distance_meters: number;
  speed_modifier: number;
  travel_mode?: string | null;
  obstacles: string[];
  is_blocked: boolean;
  is_secret: boolean;
  distance_mode?: EdgeDistanceMode;
  is_vertical?: boolean;
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
  media?: WorldMediaItem[];
  unsupported_fields?: Record<string, unknown>;
  seed_update?: SeedUpdateInfo | null;
}

export interface LocationContainerDraft {
  id: string;
  parent_container_id?: string | null;
  depth: 1 | 2 | 3 | 4;
  name: string;
  description: string;
  environmental_tags: string[];
  ui_x?: number | null;
  ui_y?: number | null;
  ghost_coords?: Record<string, { x: number; y: number }>;
  icon?: string | null;
  lore_nodes?: LocationLoreNodeDraft[];
}

export interface LocationNodeDraft {
  key: string;
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
  anchor_location_id?: string | null;
  lore_nodes?: LocationLoreNodeDraft[];
  props?: LocationProp[];
}

export interface LocationEdgeDraft {
  from_key: string;
  to_key: string;
  direction_label: string;
  reverse_direction_label: string;
  compass_direction?: CompassDirection | null;
  distance_meters: number;
  speed_modifier?: number;
  travel_mode?: string | null;
  obstacles?: string[];
  is_blocked: boolean;
  is_secret: boolean;
  distance_mode?: EdgeDistanceMode;
  is_vertical?: boolean;
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
  containers?: LocationContainerDraft[];
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
