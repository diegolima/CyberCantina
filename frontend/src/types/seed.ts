import type { CharacterRecord } from "./character";
import type { WorldRecord } from "./world";

export type SeedUpdateMode = "replace" | "copy_and_update";

export interface SeedUpdateInfo {
  seed_key: string;
  current_version: number;
  latest_version: number;
  update_available: boolean;
  seed_modified: boolean;
  dismissed_version?: number | null;
  is_dismissed: boolean;
  changelog: string;
  has_custom_media: boolean;
  active_campaigns_count: number;
  linked_characters_count?: number;
}

export interface SeedUpdateRequest {
  mode: SeedUpdateMode;
  copy_name?: string | null;
}

export interface WorldSeedUpdateResponse {
  updated_world: WorldRecord;
  preserved_copy?: WorldRecord | null;
}

export interface CharacterSeedUpdateResponse {
  updated_character: CharacterRecord;
  preserved_copy?: CharacterRecord | null;
}
