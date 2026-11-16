const CREDENTIAL_PREFIX = "cantina_provider_cred:";

function buildStorageKey(userId: string, providerId: string): string {
  return `${CREDENTIAL_PREFIX}${userId}:${providerId}`;
}

function getStorage(): Storage | null {
  try {
    return typeof window !== "undefined" && window.localStorage
      ? window.localStorage
      : null;
  } catch {
    return null;
  }
}

export function getProviderCredential(
  userId: string | null | undefined,
  providerId: string | null | undefined
): string | null {
  if (!userId || !providerId) return null;
  const storage = getStorage();
  if (!storage) return null;
  try {
    const val = storage.getItem(buildStorageKey(userId, providerId));
    return val && val.trim() ? val : null;
  } catch {
    return null;
  }
}

export function hasProviderCredential(
  userId: string | null | undefined,
  providerId: string | null | undefined
): boolean {
  return getProviderCredential(userId, providerId) !== null;
}

export function setProviderCredential(
  userId: string | null | undefined,
  providerId: string | null | undefined,
  token: string
): void {
  if (!userId || !providerId) return;
  const storage = getStorage();
  if (!storage) return;
  const cleaned = token.trim();
  try {
    if (!cleaned) {
      storage.removeItem(buildStorageKey(userId, providerId));
    } else {
      storage.setItem(buildStorageKey(userId, providerId), cleaned);
    }
  } catch {
    // ignore storage quota / private mode errors
  }
}

export function deleteProviderCredential(
  userId: string | null | undefined,
  providerId: string | null | undefined
): void {
  if (!userId || !providerId) return;
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(buildStorageKey(userId, providerId));
  } catch {
    // ignore storage errors
  }
}

/**
 * Remove stored credentials for providers that have been deleted from the server.
 * Never prunes keys for existing providers (even when temporarily unusable under server_only).
 */
export function pruneMissingProviderCredentials(
  userId: string | null | undefined,
  existingProviderIds: ReadonlySet<string>
): void {
  if (!userId) return;
  const storage = getStorage();
  if (!storage) return;
  const userPrefix = `${CREDENTIAL_PREFIX}${userId}:`;
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && key.startsWith(userPrefix)) {
        const providerId = key.slice(userPrefix.length);
        if (providerId && !existingProviderIds.has(providerId)) {
          toRemove.push(key);
        }
      }
    }
    for (const key of toRemove) {
      storage.removeItem(key);
    }
  } catch {
    // ignore storage errors
  }
}
