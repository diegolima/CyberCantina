import {
  AdminResetPasswordResponse,
  AgentDispatchMode,
  AppSettings,
  AuthSessionResponse,
  AuthStatusResponse,
  CampaignRecord,
  CampaignStateBundle,
  CharacterAgentDelta,
  CharacterChoiceSet,
  CharacterRecord,
  CharacterVersionSummary,
  CharacterWizardDraft,
  CharacterWizardSeed,
  ChoicePreviewResponse,
  ClientProbeReport,
  CognitionBlock,
  CreateNotePayload,
  CreateCampaignPayload,
  DiceMode,
  ExportBundleRequest,
  ImportCommitRequest,
  ImportCommitResponse,
  ImportInspectResponse,
  ItemEquipActionPayload,
  LocalRelayStatusResponse,
  LocationLoreNodeDraft,
  MemoryShard,
  OllamaStatusResponse,
  PersonaCreatePayload,
  PersonaRecord,
  PersonaTurnStateSnapshot,
  PersonaUpdatePayload,
  Phase3ProgressEventPayload,
  Phase4AgentKind,
  Phase5ProgressEventPayload,
  PreTurnAnalysis,
  ProfileModelSettingsResponse,
  LLMProvider,
  ProviderCreatePayload,
  ProviderDraft,
  ProviderProbeResponse,
  ProviderReference,
  ProviderUpdatePayload,
  SettingsUpdateResponse,
  PromptDefaultsResponse,
  PromptEnrichRequest,
  PromptEnrichResponse,
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
  WorldPostTurnDelta,
  WorldMapDraft,
  WorldMapReimagineRequest,
  WorldRecord,
  WorldWizardDraft,
  WorldWizardSeed,
} from "./types";

const API_BASE = "/api";
const TOKEN_STORAGE_KEY = "cantina_session_token";
const RELAY_TAB_STORAGE_KEY = "cantina_relay_tab_id";

let fallbackTabId: string | null = null;

export function getRelayTabId(): string {
  try {
    const existing = sessionStorage.getItem(RELAY_TAB_STORAGE_KEY);
    if (existing) return existing;
    const generated =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `tab_${Math.random().toString(36).slice(2, 12)}`;
    sessionStorage.setItem(RELAY_TAB_STORAGE_KEY, generated);
    return generated;
  } catch {
    if (!fallbackTabId) {
      fallbackTabId = `tab_${Math.random().toString(36).slice(2, 12)}`;
    }
    return fallbackTabId;
  }
}

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
  headers["X-Cantina-Tab-Id"] = getRelayTabId();
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

/** Error carrying the HTTP status and parsed JSON body so callers can react to 409/422 payloads. */
export class ApiError extends Error {
  status: number;
  payload: any;
  constructor(message: string, status: number, payload: any) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
  /** Structured error code (e.g. "token_required_on_url_change"), when the server sent one. */
  get code(): string | undefined {
    return this.payload?.detail?.code;
  }
  /** Usages blocking a provider delete/disable (409), for both response shapes the API uses. */
  get references(): ProviderReference[] {
    return this.payload?.referenced_by ?? this.payload?.detail?.referenced_by ?? [];
  }
}

function parseApiError(status: number, errText: string): ApiError {
  let payload: any = null;
  let message = errText || `HTTP ${status}`;
  try {
    payload = JSON.parse(errText);
    const detail = payload?.detail;
    if (typeof detail === "string") {
      message = detail;
    } else if (detail && typeof detail.message === "string") {
      message = detail.message;
    } else if (detail && typeof detail.detail === "string") {
      message = detail.detail;
    }
  } catch {
    // fallback to raw text
  }
  return new ApiError(message, status, payload);
}

function parseApiErrorText(status: number, errText: string): string {
  return parseApiError(status, errText).message;
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
    throw parseApiError(res.status, errText);
  }
  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return {} as T;
  }
  const text = await res.text();
  if (!text || !text.trim()) {
    return {} as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}

async function fetchBlob(url: string, init?: RequestInit): Promise<{ blob: Blob; filename?: string }> {
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
    throw parseApiError(res.status, errText);
  }

  // Extract filename from Content-Disposition if present
  let filename: string | undefined;
  const disposition = res.headers.get("Content-Disposition");
  if (disposition) {
    const match = /filename\*?=['"]?(?:UTF-\d['"]*)?([^;\r\n"']*)['"]?/i.exec(disposition);
    if (match?.[1]) {
      filename = decodeURIComponent(match[1]);
    }
  }

  const blob = await res.blob();
  return { blob, filename };
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
    fetchJson<SettingsUpdateResponse>(`${API_BASE}/settings`, {
      method: "PUT",
      body: JSON.stringify(settings),
    }),
  getEmbeddingStatus: () =>
    fetchJson<{ fingerprint: string; stale_entries: number }>(
      `${API_BASE}/admin/embeddings/status`
    ),
  reindexEmbeddings: () =>
    fetchJson<{ reindexed: number }>(`${API_BASE}/admin/embeddings/reindex`, {
      method: "POST",
    }),
  listProviders: (signal?: AbortSignal) =>
    fetchJson<LLMProvider[]>(`${API_BASE}/providers`, { signal }),
  createProvider: (payload: ProviderCreatePayload) =>
    fetchJson<LLMProvider>(`${API_BASE}/providers`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateProvider: (id: string, payload: ProviderUpdatePayload) =>
    fetchJson<LLMProvider>(`${API_BASE}/providers/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  deleteProvider: async (id: string) => {
    const res = await fetch(`${API_BASE}/providers/${id}`, {
      method: "DELETE",
      credentials: "include",
      headers: buildAuthHeaders(),
    });
    if (!res.ok) throw parseApiError(res.status, await res.text());
    return (await res.json()) as {
      status: string;
      id: string;
      reset_user_overrides: number;
    };
  },
  probeProvider: (id: string, opts?: { force?: boolean; signal?: AbortSignal }) =>
    fetchJson<ProviderProbeResponse>(
      `${API_BASE}/providers/${id}/probe${opts?.force ? "?force=true" : ""}`,
      { method: "POST", signal: opts?.signal }
    ),
  reportClientProbe: (id: string, report: ClientProbeReport, signal?: AbortSignal) =>
    fetchJson<ProviderProbeResponse>(`${API_BASE}/providers/${id}/client-probe`, {
      method: "POST",
      body: JSON.stringify(report),
      signal,
    }),
  getLocalRelayStatus: () =>
    fetchJson<LocalRelayStatusResponse>(`${API_BASE}/local-relay/status`),
  probeProviderDraft: (draft: ProviderDraft) =>
    fetchJson<ProviderProbeResponse>(`${API_BASE}/providers/probe-draft`, {
      method: "POST",
      body: JSON.stringify(draft),
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
  getActivePromptPreset: () =>
    fetchJson<{ active_prompt_preset_id: string | null }>(`${API_BASE}/prompts/active`),
  setActivePromptPreset: (presetId: string | null) =>
    fetchJson<{ status: string; active_prompt_preset_id: string | null }>(
      `${API_BASE}/prompts/active`,
      {
        method: "PUT",
        body: JSON.stringify({ preset_id: presetId }),
      }
    ),
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

  // AI Magic Wand Enrichment
  enrichPrompt: (req: PromptEnrichRequest, signal?: AbortSignal) =>
    fetchJson<PromptEnrichResponse>(`${API_BASE}/enrich`, {
      method: "POST",
      body: JSON.stringify(req),
      signal,
    }),

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
  restoreCharacterVersion: (characterId: string, version: number) =>
    fetchJson<CharacterRecord>(
      `${API_BASE}/characters/${characterId}/versions/${version}/restore`,
      {
        method: "POST",
      }
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

  // Native Import / Export (.zcc)
  exportBundle: async (payload: ExportBundleRequest) => {
    const { blob, filename } = await fetchBlob(`${API_BASE}/export/bundle`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    triggerDownload(blob, filename || `${payload.bundle_name || "cybercantina_export"}.zcc`);
    return blob;
  },

  exportCharacter: async (characterId: string, includeWorld: boolean = false) => {
    const { blob, filename } = await fetchBlob(
      `${API_BASE}/export/character/${encodeURIComponent(characterId)}?include_world=${includeWorld}`
    );
    triggerDownload(blob, filename || `character_${characterId}.zcc`);
    return blob;
  },

  exportWorld: async (worldId: string, includeCharacters: boolean = true) => {
    const { blob, filename } = await fetchBlob(
      `${API_BASE}/export/world/${encodeURIComponent(worldId)}?include_characters=${includeCharacters}`
    );
    triggerDownload(blob, filename || `world_${worldId}.zcc`);
    return blob;
  },

  inspectImport: (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return fetchJson<ImportInspectResponse>(`${API_BASE}/import/inspect`, {
      method: "POST",
      body: formData,
    });
  },

  commitImport: (payload: ImportCommitRequest) => {
    return fetchJson<ImportCommitResponse>(`${API_BASE}/import/commit`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
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
  extractCharacterFeatures: (
    characterBio: string,
    existingFeatures: string[]
  ) =>
    fetchJson<{
      extracted_features: string[];
      rewritten_bio: string;
    }>(`${API_BASE}/wizards/character/extract-features`, {
      method: "POST",
      body: JSON.stringify({
        character_bio: characterBio,
        existing_features: existingFeatures,
      }),
    }),
  extractCharacterPersonaTraits: (
    corePersona: string,
    existingMoralCode: string[],
    existingQuirksFlaws: string[]
  ) =>
    fetchJson<{
      extracted_moral_code: string[];
      extracted_quirks_flaws: string[];
      rewritten_core_persona: string;
    }>(`${API_BASE}/wizards/character/extract-persona-traits`, {
      method: "POST",
      body: JSON.stringify({
        core_persona: corePersona,
        existing_moral_code: existingMoralCode,
        existing_quirks_flaws: existingQuirksFlaws,
      }),
    }),
  extractCharacterQuirks: (
    corePersona: string,
    existingQuirks: string[]
  ) =>
    fetchJson<{
      extracted_quirks: string[];
      rewritten_core_persona: string;
    }>(`${API_BASE}/wizards/character/extract-quirks`, {
      method: "POST",
      body: JSON.stringify({
        core_persona: corePersona,
        existing_quirks: existingQuirks,
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
  createCampaign: (payload: CreateCampaignPayload) =>
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
  getCampaignPersonaState: (campaignId: string) =>
    fetchJson<PersonaTurnStateSnapshot | null>(
      `${API_BASE}/campaigns/${campaignId}/persona-state`
    ),
  listPersonas: () => fetchJson<PersonaRecord[]>(`${API_BASE}/personas`),
  getPersona: (personaId: string) =>
    fetchJson<PersonaRecord>(`${API_BASE}/personas/${personaId}`),
  createPersona: (payload: PersonaCreatePayload) =>
    fetchJson<PersonaRecord>(`${API_BASE}/personas`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updatePersona: (personaId: string, payload: PersonaUpdatePayload) =>
    fetchJson<PersonaRecord>(`${API_BASE}/personas/${personaId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  deletePersona: (personaId: string) =>
    fetchJson<{ status: string; persona_id: string }>(
      `${API_BASE}/personas/${personaId}`,
      {
        method: "DELETE",
      }
    ),
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
  toggleItemEquip: (campaignId: string, payload: ItemEquipActionPayload) =>
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
  updateCampaignLocationLore: (
    campaignId: string,
    locationId: string,
    loreNodes: LocationLoreNodeDraft[]
  ) =>
    fetchJson<CampaignStateBundle>(
      `${API_BASE}/campaigns/${campaignId}/locations/${locationId}/lore`,
      {
        method: "PUT",
        body: JSON.stringify({ lore_nodes: loreNodes }),
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

  previewChoices: (
    req: {
      choice_set: CharacterChoiceSet;
      dice_mode?: DiceMode;
      manual_dice_override?: number | null;
    },
    signal?: AbortSignal
  ) =>
    fetchJson<ChoicePreviewResponse>(`${API_BASE}/mechanics/choice-preview`, {
      method: "POST",
      body: JSON.stringify(req),
      signal,
    }),
};

export interface Phase4ProgressEventPayload {
  turn_id: string;
  dispatch_mode?: AgentDispatchMode | null;
  roster?: Array<{
    agent_key: string;
    kind: Phase4AgentKind;
    label: string;
  }> | null;
  agent_key?: string | null;
  kind?: Phase4AgentKind | null;
  label?: string | null;
  world_delta?: WorldPostTurnDelta | null;
  character_delta?: CharacterAgentDelta | null;
  contested_agent_keys?: string[] | null;
  error?: string | null;
}

export interface TurnStreamCallbacks {
  onChoicesAdjusted?: (data: { dropped_character_ids: string[] }) => void;
  onPhase1Complete?: (data: {
    pre_turn: PreTurnAnalysis;
    recalled_items: RecalledMemoryItem[];
  }) => void;
  onCognitionDelta?: (rawBuffer: string) => void;
  onCognitionComplete?: (cognition: CognitionBlock) => void;
  onPhase3Start?: (data: Phase3ProgressEventPayload) => void;
  onPhase3AgentStart?: (data: Phase3ProgressEventPayload) => void;
  onPhase3AgentComplete?: (data: Phase3ProgressEventPayload) => void;
  onPhase3AgentError?: (data: Phase3ProgressEventPayload) => void;
  onPhase3Complete?: (data: Phase3ProgressEventPayload) => void;
  onProseDelta?: (delta: string) => void;
  onTurnSaved?: (turn: TurnNodeRecord) => void;
  onPhase5Start?: (data: Phase5ProgressEventPayload) => void;
  onPhase5AgentStart?: (data: Phase5ProgressEventPayload) => void;
  onPhase5AgentComplete?: (data: Phase5ProgressEventPayload) => void;
  onPhase5AgentError?: (data: Phase5ProgressEventPayload) => void;
  onPhase5ArbitrationStart?: (data: Phase5ProgressEventPayload) => void;
  onPhase5Complete?: (data: {
    turn: TurnNodeRecord;
    state_bundle: CampaignStateBundle;
  }) => void;
  onPhase4Start?: (data: Phase4ProgressEventPayload) => void;
  onPhase4AgentStart?: (data: Phase4ProgressEventPayload) => void;
  onPhase4AgentComplete?: (data: Phase4ProgressEventPayload) => void;
  onPhase4AgentError?: (data: Phase4ProgressEventPayload) => void;
  onPhase4ArbitrationStart?: (data: Phase4ProgressEventPayload) => void;
  onPhase4Complete?: (data: {
    turn: TurnNodeRecord;
    state_bundle: CampaignStateBundle;
  }) => void;
  onError?: (err: string) => void;
}

export async function streamCampaignTurn(
  campaignId: string,
  payload: TurnSubmitOptions,
  callbacks: TurnStreamCallbacks,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch(`${API_BASE}/campaigns/${campaignId}/turns/stream`, {
    method: "POST",
    credentials: "include",
    headers: buildAuthHeaders(),
    body: JSON.stringify(payload),
    signal,
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
        case "choices_adjusted":
          callbacks.onChoicesAdjusted?.(parsed);
          break;
        case "phase1_complete":
          callbacks.onPhase1Complete?.(parsed);
          break;
        case "phase3_start":
          callbacks.onPhase3Start?.(parsed);
          break;
        case "phase3_agent_start":
          callbacks.onPhase3AgentStart?.(parsed);
          break;
        case "phase3_agent_complete":
          callbacks.onPhase3AgentComplete?.(parsed);
          break;
        case "phase3_agent_error":
          callbacks.onPhase3AgentError?.(parsed);
          break;
        case "phase3_complete":
          callbacks.onPhase3Complete?.(parsed);
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
        case "phase5_start":
          callbacks.onPhase5Start?.(parsed);
          callbacks.onPhase4Start?.(parsed);
          break;
        case "phase5_agent_start":
          callbacks.onPhase5AgentStart?.(parsed);
          callbacks.onPhase4AgentStart?.(parsed);
          break;
        case "phase5_agent_complete":
          callbacks.onPhase5AgentComplete?.(parsed);
          callbacks.onPhase4AgentComplete?.(parsed);
          break;
        case "phase5_agent_error":
          callbacks.onPhase5AgentError?.(parsed);
          callbacks.onPhase4AgentError?.(parsed);
          break;
        case "phase5_arbitration_start":
          callbacks.onPhase5ArbitrationStart?.(parsed);
          callbacks.onPhase4ArbitrationStart?.(parsed);
          break;
        case "phase5_complete":
          callbacks.onPhase5Complete?.(parsed);
          callbacks.onPhase4Complete?.(parsed);
          break;
        case "phase4_start":
          callbacks.onPhase4Start?.(parsed);
          break;
        case "phase4_agent_start":
          callbacks.onPhase4AgentStart?.(parsed);
          break;
        case "phase4_agent_complete":
          callbacks.onPhase4AgentComplete?.(parsed);
          break;
        case "phase4_agent_error":
          callbacks.onPhase4AgentError?.(parsed);
          break;
        case "phase4_arbitration_start":
          callbacks.onPhase4ArbitrationStart?.(parsed);
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
