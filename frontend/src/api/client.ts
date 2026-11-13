import type { ProviderReference } from "../types";

export const API_BASE = "/api";
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

export function notifyUnauthorized(): void {
  unauthorizedHandler?.();
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

export function buildAuthHeaders(
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

export function parseApiError(status: number, errText: string): ApiError {
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

export function parseApiErrorText(status: number, errText: string): string {
  return parseApiError(status, errText).message;
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
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

export async function fetchBlob(url: string, init?: RequestInit): Promise<{ blob: Blob; filename?: string }> {
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

export function base64UrlToUint8Array(base64Url: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray.buffer;
}

export function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
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
