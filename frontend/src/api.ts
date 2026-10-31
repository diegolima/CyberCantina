import {
  AdminResetPasswordResponse,
  AppSettings,
  AuthSessionResponse,
  AuthStatusResponse,
  CampaignRecord,
  CampaignStateBundle,
  CharacterRecord,
  CharacterVersionSummary,
  CharacterWizardDraft,
  CharacterWizardSeed,
  CognitionBlock,
  CreateNotePayload,
  MemoryShard,
  OllamaStatusResponse,
  PreTurnAnalysis,
  ProfileModelSettingsResponse,
  PromptDefaultsResponse,
  PromptPresetCreatePayload,
  PromptPresetRecord,
  PromptPresetUpdatePayload,
  RecalledMemoryItem,
  SillyTavernImportResponse,
  TurnNodeRecord,
  TurnSubmitOptions,
  UpdateNotePayload,
  UserModelSettingsPayload,
  UserNote,
  UserProfile,
  UserRole,
  WorldMapDraft,
  WorldMapReimagineRequest,
  WorldRecord,
  WorldWizardDraft,
  WorldWizardSeed,
} from "./types";

const API_BASE = "/api";
const TOKEN_STORAGE_KEY = "cantina_session_token";

let unauthorizedHandler: (() => void) | null = null;

export function setOnUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

export function getStoredSessionToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredSessionToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

function buildAuthHeaders(
  extra?: HeadersInit,
  isFormData: boolean = false
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!isFormData) {
    headers["Content-Type"] = "application/json";
  }
  const token = getStoredSessionToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  if (extra) {
    if (extra instanceof Headers) {
      extra.forEach((v, k) => {
        headers[k] = v;
      });
    } else if (Array.isArray(extra)) {
      for (const [k, v] of extra) {
        headers[k] = v;
      }
    } else {
      Object.assign(headers, extra);
    }
  }
  return headers;
}

function parseApiErrorText(status: number, errText: string): string {
  try {
    const parsed = JSON.parse(errText);
    if (parsed && typeof parsed.detail === "string") {
      return parsed.detail;
    }
  } catch {
    // fallback to raw text
  }
  return errText || `HTTP ${status}`;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const isFormData =
    typeof FormData !== "undefined" && init?.body instanceof FormData;
  const res = await fetch(url, {
    ...init,
    credentials: "include",
    headers: buildAuthHeaders(init?.headers, isFormData),
  });
  if (!res.ok) {
    const errText = await res.text();
    if (
      res.status === 401 &&
      !url.includes("/auth/login") &&
      !url.includes("/auth/passkey/login") &&
      !url.includes("/auth/status")
    ) {
      unauthorizedHandler?.();
    }
    throw new Error(parseApiErrorText(res.status, errText));
  }
  return res.json() as Promise<T>;
}

// ------------------------------------------------------------------
// WebAuthn Base64URL <-> ArrayBuffer Browser Helpers
// ------------------------------------------------------------------

function base64UrlToUint8Array(base64Url: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray.buffer;
}

function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window
    .btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export const api = {
  // Auth & Setup
  getAuthStatus: () => fetchJson<AuthStatusResponse>(`${API_BASE}/auth/status`),

  initialSetup: async (payload: {
    username: string;
    display_name?: string;
    password?: string;
    confirm_blank_password?: boolean;
  }) => {
    const res = await fetchJson<AuthSessionResponse>(`${API_BASE}/auth/setup`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setStoredSessionToken(res.token);
    return res;
  },

  login: async (payload: { username: string; password?: string }) => {
    const res = await fetchJson<AuthSessionResponse>(`${API_BASE}/auth/login`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setStoredSessionToken(res.token);
    return res;
  },

  register: async (payload: {
    username: string;
    display_name?: string;
    password: string;
  }) => {
    const res = await fetchJson<AuthSessionResponse>(
      `${API_BASE}/auth/register`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    );
    setStoredSessionToken(res.token);
    return res;
  },

  logout: async () => {
    try {
      await fetchJson<{ status: string }>(`${API_BASE}/auth/logout`, {
        method: "POST",
      });
    } finally {
      setStoredSessionToken(null);
    }
  },

  loginWithPasskey: async (username?: string): Promise<AuthSessionResponse> => {
    if (!window.PublicKeyCredential || !navigator.credentials) {
      throw new Error("WebAuthn Passkeys are not supported in this browser.");
    }
    const startRes = await fetchJson<{
      challenge_id: string;
      options: Record<string, any>;
    }>(`${API_BASE}/auth/passkey/login/start`, {
      method: "POST",
      body: JSON.stringify({ username: username?.trim() || null }),
    });

    const opts = startRes.options;
    const publicKey: PublicKeyCredentialRequestOptions = {
      challenge: base64UrlToUint8Array(opts.challenge),
      rpId: opts.rpId,
      timeout: opts.timeout ?? 60000,
      userVerification: opts.userVerification ?? "preferred",
      allowCredentials: Array.isArray(opts.allowCredentials)
        ? opts.allowCredentials.map((cred: any) => ({
            id: base64UrlToUint8Array(cred.id),
            type: "public-key" as const,
            transports: cred.transports,
          }))
        : undefined,
    };

    const assertion = (await navigator.credentials.get({
      publicKey,
    })) as PublicKeyCredential | null;

    if (!assertion) {
      throw new Error("Passkey authentication was cancelled.");
    }

    const assertionResp = assertion.response as AuthenticatorAssertionResponse;
    const credentialPayload: Record<string, any> = {
      id: assertion.id,
      rawId: arrayBufferToBase64Url(assertion.rawId),
      type: assertion.type,
      response: {
        authenticatorData: arrayBufferToBase64Url(
          assertionResp.authenticatorData
        ),
        clientDataJSON: arrayBufferToBase64Url(assertionResp.clientDataJSON),
        signature: arrayBufferToBase64Url(assertionResp.signature),
        userHandle: assertionResp.userHandle
          ? arrayBufferToBase64Url(assertionResp.userHandle)
          : null,
      },
    };

    const finishRes = await fetchJson<AuthSessionResponse>(
      `${API_BASE}/auth/passkey/login/finish`,
      {
        method: "POST",
        body: JSON.stringify({
          challenge_id: startRes.challenge_id,
          credential: credentialPayload,
        }),
      }
    );
    setStoredSessionToken(finishRes.token);
    return finishRes;
  },

  // User Profile & Passkeys
  getProfile: () => fetchJson<UserProfile>(`${API_BASE}/profile`),

  updateProfile: (payload: { display_name: string }) =>
    fetchJson<UserProfile>(`${API_BASE}/profile`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  changePassword: (payload: {
    current_password?: string;
    new_password: string;
    confirm_blank_password?: boolean;
  }) =>
    fetchJson<AuthStatusResponse>(`${API_BASE}/profile/password`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  registerPasskey: async (payload: {
    current_password: string;
    friendly_name: string;
    replace_credential_id?: string | null;
  }): Promise<UserProfile> => {
    if (!window.PublicKeyCredential || !navigator.credentials) {
      throw new Error("WebAuthn Passkeys are not supported in this browser.");
    }
    const startRes = await fetchJson<{
      challenge_id: string;
      options: Record<string, any>;
    }>(`${API_BASE}/profile/passkeys/register/start`, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    const opts = startRes.options;
    const publicKey: PublicKeyCredentialCreationOptions = {
      challenge: base64UrlToUint8Array(opts.challenge),
      rp: opts.rp,
      user: {
        id: base64UrlToUint8Array(opts.user.id),
        name: opts.user.name,
        displayName: opts.user.displayName,
      },
      pubKeyCredParams: opts.pubKeyCredParams,
      timeout: opts.timeout ?? 60000,
      attestation: opts.attestation ?? "none",
      authenticatorSelection: opts.authenticatorSelection,
      excludeCredentials: Array.isArray(opts.excludeCredentials)
        ? opts.excludeCredentials.map((cred: any) => ({
            id: base64UrlToUint8Array(cred.id),
            type: "public-key" as const,
            transports: cred.transports,
          }))
        : undefined,
    };

    const credential = (await navigator.credentials.create({
      publicKey,
    })) as PublicKeyCredential | null;

    if (!credential) {
      throw new Error("Passkey creation was cancelled.");
    }

    const attResp = credential.response as AuthenticatorAttestationResponse & {
      getTransports?: () => string[];
    };
    const transports =
      typeof attResp.getTransports === "function" ? attResp.getTransports() : [];

    const credentialPayload = {
      id: credential.id,
      rawId: arrayBufferToBase64Url(credential.rawId),
      type: credential.type,
      response: {
        attestationObject: arrayBufferToBase64Url(attResp.attestationObject),
        clientDataJSON: arrayBufferToBase64Url(attResp.clientDataJSON),
        transports,
      },
    };

    return fetchJson<UserProfile>(`${API_BASE}/profile/passkeys/register/finish`, {
      method: "POST",
      body: JSON.stringify({
        challenge_id: startRes.challenge_id,
        credential: credentialPayload,
      }),
    });
  },

  deletePasskey: (credentialId: string, currentPassword: string) =>
    fetchJson<UserProfile>(
      `${API_BASE}/profile/passkeys/${encodeURIComponent(credentialId)}/delete`,
      {
        method: "POST",
        body: JSON.stringify({ current_password: currentPassword }),
      }
    ),

  resetProfileData: (payload?: { current_password?: string }) =>
    fetchJson<{ status: string; message: string }>(
      `${API_BASE}/profile/reset-data`,
      {
        method: "POST",
        body: JSON.stringify(payload ?? {}),
      }
    ),

  deleteProfileAccount: async (payload?: { current_password?: string }) => {
    try {
      const res = await fetchJson<{ status: string }>(`${API_BASE}/profile`, {
        method: "DELETE",
        body: JSON.stringify(payload ?? {}),
      });
      return res;
    } finally {
      setStoredSessionToken(null);
    }
  },

  // Admin Area
  adminListUsers: (query?: string) => {
    const q = query && query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
    return fetchJson<UserProfile[]>(`${API_BASE}/admin/users${q}`);
  },

  adminCreateUser: (payload: {
    username: string;
    display_name?: string;
    password: string;
    role?: UserRole;
  }) =>
    fetchJson<UserProfile>(`${API_BASE}/admin/users`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  adminChangeUsername: (userId: string, username: string) =>
    fetchJson<UserProfile>(
      `${API_BASE}/admin/users/${encodeURIComponent(userId)}/username`,
      {
        method: "PUT",
        body: JSON.stringify({ username }),
      }
    ),

  adminResetPassword: (userId: string) =>
    fetchJson<AdminResetPasswordResponse>(
      `${API_BASE}/admin/users/${encodeURIComponent(userId)}/reset-password`,
      {
        method: "POST",
      }
    ),

  adminDeleteUser: async (userId: string) => {
    const res = await fetchJson<{ status: string; user_id: string }>(
      `${API_BASE}/admin/users/${encodeURIComponent(userId)}`,
      {
        method: "DELETE",
      }
    );
    return res;
  },

  getSettings: () => fetchJson<AppSettings>(`${API_BASE}/settings`),
  updateSettings: (settings: AppSettings) =>
    fetchJson<AppSettings>(`${API_BASE}/settings`, {
      method: "PUT",
      body: JSON.stringify(settings),
    }),
  getProfileModels: () =>
    fetchJson<ProfileModelSettingsResponse>(`${API_BASE}/profile/models`),
  updateProfileModels: (payload: UserModelSettingsPayload) =>
    fetchJson<ProfileModelSettingsResponse>(`${API_BASE}/profile/models`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  resetProfileModels: () =>
    fetchJson<ProfileModelSettingsResponse>(`${API_BASE}/profile/models`, {
      method: "DELETE",
    }),
  getPromptDefaults: () =>
    fetchJson<PromptDefaultsResponse>(`${API_BASE}/prompts/defaults`),
  listPromptPresets: () =>
    fetchJson<PromptPresetRecord[]>(`${API_BASE}/prompts/presets`),
  getPromptPreset: (id: string) =>
    fetchJson<PromptPresetRecord>(`${API_BASE}/prompts/presets/${id}`),
  createPromptPreset: (payload: PromptPresetCreatePayload) =>
    fetchJson<PromptPresetRecord>(`${API_BASE}/prompts/presets`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updatePromptPreset: (id: string, payload: PromptPresetUpdatePayload) =>
    fetchJson<PromptPresetRecord>(`${API_BASE}/prompts/presets/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  deletePromptPreset: (id: string) =>
    fetchJson<{ status: string; id: string }>(`${API_BASE}/prompts/presets/${id}`, {
      method: "DELETE",
    }),
  resetPromptPreset: (id: string) =>
    fetchJson<PromptPresetRecord>(`${API_BASE}/prompts/presets/${id}/reset`, {
      method: "POST",
    }),
  setCampaignPromptPreset: (campaignId: string, presetId: string | null) =>
    fetchJson<CampaignRecord>(`${API_BASE}/campaigns/${campaignId}/prompt-preset`, {
      method: "PUT",
      body: JSON.stringify({ preset_id: presetId }),
    }),

  // User Notes
  listNotes: () => fetchJson<UserNote[]>(`${API_BASE}/notes`),
  createNote: (payload: CreateNotePayload) =>
    fetchJson<UserNote>(`${API_BASE}/notes`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getNote: (noteId: string) =>
    fetchJson<UserNote>(`${API_BASE}/notes/${encodeURIComponent(noteId)}`),
  updateNote: (noteId: string, payload: UpdateNotePayload) =>
    fetchJson<UserNote>(`${API_BASE}/notes/${encodeURIComponent(noteId)}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  deleteNote: (noteId: string) =>
    fetchJson<{ status: string; id: string }>(
      `${API_BASE}/notes/${encodeURIComponent(noteId)}`,
      {
        method: "DELETE",
      }
    ),

  getOllamaStatus: (baseUrl?: string) => {
    const q = baseUrl ? `?base_url=${encodeURIComponent(baseUrl)}` : "";
    return fetchJson<OllamaStatusResponse>(`${API_BASE}/ollama/status${q}`);
  },

  listWorlds: () => fetchJson<WorldRecord[]>(`${API_BASE}/worlds`),
  getWorld: (worldId: string) => fetchJson<WorldRecord>(`${API_BASE}/worlds/${worldId}`),
  draftWorld: (seed: WorldWizardSeed) =>
    fetchJson<WorldWizardDraft>(`${API_BASE}/wizards/world/draft`, {
      method: "POST",
      body: JSON.stringify(seed),
    }),
  reimagineWorldMap: (req: WorldMapReimagineRequest) =>
    fetchJson<WorldMapDraft>(`${API_BASE}/wizards/world/reimagine-map`, {
      method: "POST",
      body: JSON.stringify(req),
    }),
  commitWorld: (draft: WorldWizardDraft) =>
    fetchJson<WorldRecord>(`${API_BASE}/wizards/world/commit`, {
      method: "POST",
      body: JSON.stringify(draft),
    }),
  updateWorld: (
    worldId: string,
    payload: Pick<
      WorldRecord,
      "name" | "global_rules" | "locations" | "edges" | "lore_nodes"
    >
  ) =>
    fetchJson<WorldRecord>(`${API_BASE}/worlds/${worldId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  deleteWorld: (worldId: string) =>
    fetchJson<{
      world_id: string;
      pending_deletion: boolean;
      campaigns_using: number;
    }>(`${API_BASE}/worlds/${worldId}`, {
      method: "DELETE",
    }),

  listCharacters: () => fetchJson<CharacterRecord[]>(`${API_BASE}/characters`),
  getCharacter: (characterId: string) =>
    fetchJson<CharacterRecord>(`${API_BASE}/characters/${characterId}`),
  listCharacterVersions: (characterId: string) =>
    fetchJson<CharacterVersionSummary[]>(
      `${API_BASE}/characters/${characterId}/versions`
    ),
  getCharacterVersion: (characterId: string, version: number) =>
    fetchJson<CharacterRecord>(
      `${API_BASE}/characters/${characterId}/versions/${version}`
    ),
  draftCharacter: (seed: CharacterWizardSeed) =>
    fetchJson<CharacterWizardDraft>(`${API_BASE}/wizards/character/draft`, {
      method: "POST",
      body: JSON.stringify(seed),
    }),
  importSillyTavernCard: (
    file: File,
    autoGenerateWorld: boolean = true,
    worldId?: string | null
  ) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("auto_generate_world", String(autoGenerateWorld));
    if (worldId) {
      formData.append("world_id", worldId);
    }
    return fetchJson<SillyTavernImportResponse>(
      `${API_BASE}/wizards/character/import-sillytavern`,
      {
        method: "POST",
        body: formData,
      }
    );
  },
  commitCharacter: (
    draft: CharacterWizardDraft,
    worldId?: string | null,
    characterId?: string | null
  ) =>
    fetchJson<CharacterRecord>(`${API_BASE}/wizards/character/commit`, {
      method: "POST",
      body: JSON.stringify({
        draft,
        world_id: worldId ?? null,
        character_id: characterId ?? null,
      }),
    }),
  updateCharacter: (
    characterId: string,
    payload: CharacterWizardDraft & { world_id?: string | null }
  ) =>
    fetchJson<CharacterRecord>(`${API_BASE}/characters/${characterId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  deleteCharacter: (characterId: string) =>
    fetchJson<{
      character_id: string;
      pending_deletion: boolean;
      campaigns_using: number;
    }>(`${API_BASE}/characters/${characterId}`, {
      method: "DELETE",
    }),
  uploadCharacterPortrait: (
    characterId: string,
    emotion: string,
    file: File | Blob
  ) => {
    const formData = new FormData();
    formData.append("file", file);
    return fetchJson<CharacterRecord>(
      `${API_BASE}/characters/${characterId}/portraits/${emotion}`,
      {
        method: "POST",
        body: formData,
      }
    );
  },
  deleteCharacterPortrait: (characterId: string, emotion: string) =>
    fetchJson<CharacterRecord>(
      `${API_BASE}/characters/${characterId}/portraits/${emotion}`,
      {
        method: "DELETE",
      }
    ),
  uploadCharacterGalleryImage: (
    characterId: string,
    file: File | Blob,
    caption?: string
  ) => {
    const formData = new FormData();
    formData.append("file", file);
    if (caption) {
      formData.append("caption", caption);
    }
    return fetchJson<CharacterRecord>(
      `${API_BASE}/characters/${characterId}/gallery`,
      {
        method: "POST",
        body: formData,
      }
    );
  },
  deleteCharacterGalleryImage: (characterId: string, imageId: string) =>
    fetchJson<CharacterRecord>(
      `${API_BASE}/characters/${characterId}/gallery/${imageId}`,
      {
        method: "DELETE",
      }
    ),

  listCampaigns: () => fetchJson<CampaignRecord[]>(`${API_BASE}/campaigns`),
  createCampaign: (payload: {
    name: string;
    world_id: string;
    character_id: string;
    opening_prose?: string;
  }) =>
    fetchJson<CampaignStateBundle>(`${API_BASE}/campaigns`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  deleteCampaign: (campaignId: string) =>
    fetchJson<{ status: string; campaign_id: string }>(
      `${API_BASE}/campaigns/${campaignId}`,
      {
        method: "DELETE",
      }
    ),
  getCampaignState: (campaignId: string) =>
    fetchJson<CampaignStateBundle>(`${API_BASE}/campaigns/${campaignId}/state`),
  checkoutBranch: (campaignId: string, turnId: string) =>
    fetchJson<CampaignStateBundle>(`${API_BASE}/campaigns/${campaignId}/checkout`, {
      method: "POST",
      body: JSON.stringify({ turn_id: turnId }),
    }),
  overrideLocation: (campaignId: string, locationId: string) =>
    fetchJson<CampaignStateBundle>(
      `${API_BASE}/campaigns/${campaignId}/location-override`,
      {
        method: "POST",
        body: JSON.stringify({ location_id: locationId }),
      }
    ),
  toggleItemEquip: (
    campaignId: string,
    payload: {
      item: string;
      action: "equip" | "unequip" | "remove" | "add";
      target?: "equipped" | "inventory";
      character_id?: string;
    }
  ) =>
    fetchJson<CampaignStateBundle>(
      `${API_BASE}/campaigns/${campaignId}/item-equip`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    ),
  updateCampaignCharacterMemories: (
    campaignId: string,
    characterId: string,
    memoryShards: MemoryShard[]
  ) =>
    fetchJson<CampaignStateBundle>(
      `${API_BASE}/campaigns/${campaignId}/characters/${characterId}/memories`,
      {
        method: "POST",
        body: JSON.stringify({ memory_shards: memoryShards }),
      }
    ),
  createLinkedLocation: (
    campaignId: string,
    payload: {
      from_location_id: string;
      name: string;
      compass_direction: string;
      travel_minutes: number;
      description: string;
      environmental_tags: string[];
    }
  ) =>
    fetchJson<CampaignStateBundle>(`${API_BASE}/campaigns/${campaignId}/locations`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  connectCampaignLocations: (
    campaignId: string,
    payload: {
      from_location_id: string;
      to_location_id: string;
      direction_label?: string;
      compass_direction: string;
      travel_minutes: number;
      bidirectional?: boolean;
    }
  ) =>
    fetchJson<CampaignStateBundle>(`${API_BASE}/campaigns/${campaignId}/edges`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateCampaignEdgeDistance: (
    campaignId: string,
    edgeId: string,
    travelMinutes: number,
    updateReciprocal: boolean = true
  ) =>
    fetchJson<CampaignStateBundle>(
      `${API_BASE}/campaigns/${campaignId}/edges/${edgeId}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          travel_minutes: travelMinutes,
          update_reciprocal: updateReciprocal,
        }),
      }
    ),
  removeCampaignEdge: (
    campaignId: string,
    edgeId: string,
    removeReciprocal: boolean = true
  ) =>
    fetchJson<CampaignStateBundle>(
      `${API_BASE}/campaigns/${campaignId}/edges/${edgeId}?remove_reciprocal=${removeReciprocal}`,
      {
        method: "DELETE",
      }
    ),
  deleteLastTurn: (campaignId: string) =>
    fetchJson<CampaignStateBundle>(
      `${API_BASE}/campaigns/${campaignId}/turns/last`,
      {
        method: "DELETE",
      }
    ),
};

export interface TurnStreamCallbacks {
  onPhase1Complete?: (data: {
    pre_turn: PreTurnAnalysis;
    recalled_items: RecalledMemoryItem[];
  }) => void;
  onCognitionDelta?: (rawBuffer: string) => void;
  onCognitionComplete?: (cognition: CognitionBlock) => void;
  onProseDelta?: (delta: string) => void;
  onTurnSaved?: (turn: TurnNodeRecord) => void;
  onPhase4Complete?: (data: {
    turn: TurnNodeRecord;
    state_bundle: CampaignStateBundle;
  }) => void;
  onError?: (err: string) => void;
}

export async function streamCampaignTurn(
  campaignId: string,
  payload: TurnSubmitOptions,
  callbacks: TurnStreamCallbacks
): Promise<void> {
  const response = await fetch(`${API_BASE}/campaigns/${campaignId}/turns/stream`, {
    method: "POST",
    credentials: "include",
    headers: buildAuthHeaders(),
    body: JSON.stringify(payload),
  });

  if (!response.ok || !response.body) {
    const text = await response.text();
    if (response.status === 401) {
      unauthorizedHandler?.();
    }
    throw new Error(`Stream failed (${response.status}): ${parseApiErrorText(response.status, text)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";

    for (const block of blocks) {
      if (!block.trim()) continue;
      let eventName = "message";
      let dataJson = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) {
          eventName = line.slice("event:".length).trim();
        } else if (line.startsWith("data:")) {
          dataJson += line.slice("data:".length).trim();
        }
      }
      if (!dataJson) continue;
      const parsed = JSON.parse(dataJson);

      switch (eventName) {
        case "phase1_complete":
          callbacks.onPhase1Complete?.(parsed);
          break;
        case "cognition_delta":
          callbacks.onCognitionDelta?.(parsed.raw_buffer);
          break;
        case "cognition_complete":
          callbacks.onCognitionComplete?.(parsed);
          break;
        case "prose_delta":
          callbacks.onProseDelta?.(parsed.delta);
          break;
        case "turn_saved":
          callbacks.onTurnSaved?.(parsed);
          break;
        case "phase4_complete":
          callbacks.onPhase4Complete?.(parsed);
          break;
        case "error":
          callbacks.onError?.(parsed.error || "Unknown stream error");
          break;
      }
    }
  }
}
