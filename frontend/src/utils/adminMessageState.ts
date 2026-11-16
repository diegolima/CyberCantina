import type { PublicAdminMessage } from "../types";

export type AdminMessageSurface = "login" | "home";

export interface AdminMessageLocalEntry {
  dismissedRevision?: number;
  collapsed?: boolean;
}

export type AdminMessageLocalStateMap = Record<string, AdminMessageLocalEntry>;

export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export const LOGIN_ADMIN_MSG_STORAGE_KEY = "cantina_login_admin_msg_state_v1";

export function getAdminMessageStorageKey(
  surface: AdminMessageSurface,
  userId?: string | null
): string {
  if (surface === "login") return LOGIN_ADMIN_MSG_STORAGE_KEY;
  return userId
    ? `cantina_home_admin_msg_state_v1:${userId}`
    : "cantina_home_admin_msg_state_v1";
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadAdminMessageStateMap(
  key: string,
  storage: StorageLike | null = defaultStorage()
): AdminMessageLocalStateMap {
  if (!storage) return {};
  try {
    const raw = storage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const clean: AdminMessageLocalStateMap = {};
    for (const [id, entry] of Object.entries(parsed)) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      clean[id] = {
        dismissedRevision:
          typeof e.dismissedRevision === "number" && Number.isFinite(e.dismissedRevision)
            ? e.dismissedRevision
            : undefined,
        collapsed: typeof e.collapsed === "boolean" ? e.collapsed : undefined,
      };
    }
    return clean;
  } catch {
    return {};
  }
}

export function saveAdminMessageStateMap(
  key: string,
  stateMap: AdminMessageLocalStateMap,
  storage: StorageLike | null = defaultStorage()
): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(stateMap));
  } catch {
    // ignore quota / restricted storage errors
  }
}

export function resolveAdminMessageUiState(
  msg: PublicAdminMessage,
  surface: AdminMessageSurface,
  userId?: string | null,
  storage: StorageLike | null = defaultStorage()
): { dismissed: boolean; collapsed: boolean } {
  const key = getAdminMessageStorageKey(surface, userId);
  const surfaceMap = loadAdminMessageStateMap(key, storage);
  const surfaceEntry = surfaceMap[msg.id];
  const loginEntry =
    surface === "home" && msg.placement === "both"
      ? loadAdminMessageStateMap(LOGIN_ADMIN_MSG_STORAGE_KEY, storage)[msg.id]
      : undefined;

  const dismissedRev = Math.max(
    surfaceEntry?.dismissedRevision ?? 0,
    loginEntry?.dismissedRevision ?? 0
  );
  const dismissed = Boolean(msg.dismissable && dismissedRev === msg.revision);
  const collapsed = surfaceEntry?.collapsed ?? loginEntry?.collapsed ?? false;
  return { dismissed, collapsed };
}

export function getVisibleAdminMessages(
  messages: PublicAdminMessage[],
  surface: AdminMessageSurface,
  userId?: string | null,
  storage: StorageLike | null = defaultStorage(),
  nowMs: number = Date.now()
): Array<PublicAdminMessage & { collapsed: boolean }> {
  const result: Array<PublicAdminMessage & { collapsed: boolean }> = [];
  for (const msg of messages) {
    if (msg.expires_at) {
      const expMs = Date.parse(msg.expires_at);
      if (Number.isFinite(expMs) && expMs <= nowMs) {
        continue;
      }
    }
    const { dismissed, collapsed } = resolveAdminMessageUiState(
      msg,
      surface,
      userId,
      storage
    );
    if (!dismissed) {
      result.push({ ...msg, collapsed });
    }
  }
  return result;
}

export function dismissAdminMessageInStorage(
  msg: PublicAdminMessage,
  surface: AdminMessageSurface,
  userId?: string | null,
  storage: StorageLike | null = defaultStorage()
): AdminMessageLocalStateMap {
  const key = getAdminMessageStorageKey(surface, userId);
  const map = loadAdminMessageStateMap(key, storage);
  map[msg.id] = {
    ...map[msg.id],
    dismissedRevision: msg.revision,
  };
  saveAdminMessageStateMap(key, map, storage);
  return map;
}

export function toggleAdminMessageCollapsedInStorage(
  msg: PublicAdminMessage,
  nextCollapsed: boolean,
  surface: AdminMessageSurface,
  userId?: string | null,
  storage: StorageLike | null = defaultStorage()
): AdminMessageLocalStateMap {
  const key = getAdminMessageStorageKey(surface, userId);
  const map = loadAdminMessageStateMap(key, storage);
  map[msg.id] = {
    ...map[msg.id],
    collapsed: nextCollapsed,
  };
  saveAdminMessageStateMap(key, map, storage);
  return map;
}

export function pruneAdminMessageStateStorage(
  activeMessages: PublicAdminMessage[],
  surface: AdminMessageSurface,
  userId?: string | null,
  storage: StorageLike | null = defaultStorage()
): void {
  const key = getAdminMessageStorageKey(surface, userId);
  const map = loadAdminMessageStateMap(key, storage);
  const activeIds = new Set(activeMessages.map((m) => m.id));
  let changed = false;
  for (const existingId of Object.keys(map)) {
    if (!activeIds.has(existingId)) {
      delete map[existingId];
      changed = true;
    }
  }
  if (changed) {
    saveAdminMessageStateMap(key, map, storage);
  }
}

export function toLocalDateTimeInputValue(
  utcIso?: string | null
): string {
  if (!utcIso) return "";
  const dt = new Date(utcIso);
  if (Number.isNaN(dt.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(
    dt.getHours()
  )}:${pad(dt.getMinutes())}`;
}

export function fromLocalDateTimeInputValue(localVal: string): string | null {
  const trimmed = localVal.trim();
  if (!trimmed) return null;
  const dt = new Date(trimmed);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}
