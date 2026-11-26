/**
 * Classifies startup/API errors to distinguish an unreachable backend
 * (offline, connection refused, proxy 502/503/504, 5xx) from genuine
 * authentication rejections (401/403).
 */
export function isServerUnreachableError(err: unknown): boolean {
  if (!err) return true;
  if (err instanceof TypeError) return true;
  if (typeof err === "object" && err !== null) {
    const maybeErr = err as { status?: unknown; name?: unknown; message?: unknown };
    if (maybeErr.name === "AbortError") return true;
    if (typeof maybeErr.status === "number") {
      if (maybeErr.status === 401 || maybeErr.status === 403) return false;
      if (maybeErr.status === 0 || maybeErr.status >= 500) return true;
      return false;
    }
    if (typeof maybeErr.message === "string") {
      const lower = maybeErr.message.toLowerCase();
      if (
        lower.includes("failed to fetch") ||
        lower.includes("networkerror") ||
        lower.includes("load failed") ||
        lower.includes("network request failed")
      ) {
        return true;
      }
    }
  }
  return true;
}

export function formatServerUnreachableDetail(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const maybeErr = err as { status?: unknown; message?: unknown };
  if (typeof maybeErr.status === "number" && maybeErr.status >= 500) {
    return `Server responded with HTTP ${maybeErr.status}.`;
  }
  if (typeof maybeErr.message === "string" && maybeErr.message.trim()) {
    const msg = maybeErr.message.trim();
    if (msg.length <= 160 && !msg.startsWith("<")) {
      return msg;
    }
  }
  return null;
}
