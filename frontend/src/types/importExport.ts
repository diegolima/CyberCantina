export type ImportConflictStrategy = "copy" | "overwrite" | "skip";
export type CampaignTimelineScope = "full" | "active";

export interface ZccManifestContents {
  characters_count: number;
  worlds_count: number;
  personas_count: number;
  campaigns_count?: number;
  media_files_count: number;
  images_count?: number;
  videos_count?: number;
}

export interface ZccManifest {
  format_version: number;
  generator: string;
  generator_version: string;
  exported_at: string;
  description: string;
  contents: ZccManifestContents;
  dependencies: Record<string, string[]>;
}

export interface ExportBundleRequest {
  character_ids: string[];
  world_ids: string[];
  persona_ids: string[];
  bundle_name?: string;
  include_world_media?: boolean;
  include_videos?: boolean;
  selected_video_ids?: string[] | null;
  password?: string | null;
}

export interface ExportCampaignRequest {
  timeline_scope?: CampaignTimelineScope;
  strip_bookmark_comments?: boolean;
  include_world_media?: boolean;
  include_videos?: boolean;
  selected_video_ids?: string[] | null;
  password?: string | null;
}

export interface ImportUnlockRequest {
  staged_token: string;
  password: string;
}

export interface ImportEntityConflict {
  category: "character" | "world" | "persona";
  incoming_id: string;
  name: string;
  existing_id: string;
}

export interface EntitySummary {
  id: string;
  name: string;
  tagline?: string;
  category: "character" | "world" | "persona" | "campaign";
  extra_info?: Record<string, any>;
}

export interface ImportInspectResponse {
  is_native: boolean;
  format_type: "zcc" | "sillytavern_png" | "sillytavern_json" | "unknown";
  staged_token: string;
  requires_password?: boolean;
  manifest?: ZccManifest | null;
  characters: EntitySummary[];
  worlds: EntitySummary[];
  personas: EntitySummary[];
  campaigns?: EntitySummary[];
  conflicts: ImportEntityConflict[];
  sillytavern_draft?: any;
  warnings?: string[];
  images_count?: number;
  images_bytes?: number;
  videos_count?: number;
  videos_bytes?: number;
}

export interface ImportCommitRequest {
  staged_token: string;
  conflict_strategies?: Record<string, ImportConflictStrategy>;
  default_conflict_strategy?: ImportConflictStrategy;
  import_images?: boolean;
  import_videos?: boolean;
  import_campaign_assets_as_standalone?: boolean;
}

export interface ImportCommitResponse {
  success: boolean;
  imported_characters: string[];
  imported_worlds: string[];
  imported_personas: string[];
  imported_campaigns?: string[];
  skipped_entities: string[];
  errors: string[];
  warnings?: string[];
  message: string;
}
