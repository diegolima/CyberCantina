export interface PromptVariableDoc {
  name: string;
  description: string;
}

export interface PromptMetadata {
  key: string;
  title: string;
  description: string;
  available_variables: PromptVariableDoc[];
  required_tags: string[];
}

export interface PromptPresetRecord {
  id: string;
  owner_id?: string | null;
  name: string;
  description: string;
  is_builtin: boolean;
  prompts: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export interface PromptPresetCreatePayload {
  name: string;
  description?: string;
  base_preset_id?: string | null;
  prompts?: Record<string, string> | null;
}

export interface PromptPresetUpdatePayload {
  name?: string | null;
  description?: string | null;
  prompts?: Record<string, string> | null;
}

export interface PromptDefaultsResponse {
  presets: PromptPresetRecord[];
  defaults: Record<string, string>;
  metadata: PromptMetadata[];
  active_preset_id?: string | null;
}
