import type {
  AdminResetPasswordResponse,
  AuthSessionResponse,
  AuthStatusResponse,
  UserProfile,
  UserRole,
} from "../types";
import {
  API_BASE,
  setStoredSessionToken,
  fetchJson,
  base64UrlToUint8Array,
  arrayBufferToBase64Url,
} from "./client";

export const authApi = {
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
};
