"""Thread-safe, bounded-memory sliding-window rate limiter for auth and upload endpoints."""

from __future__ import annotations

import math
import os
import threading
import time
from fastapi import HTTPException

_FALSY_VALUES = frozenset({"0", "false", "no", "off"})
MAX_TRACKED_KEYS = 10_000


class SlidingWindowRateLimiter:
    """Bounded-memory sliding-window limiter keyed by IP address, username, or user ID."""

    def __init__(
        self,
        limit: int,
        window_seconds: float,
        *,
        max_keys: int = MAX_TRACKED_KEYS,
    ) -> None:
        self.limit = limit
        self.window_seconds = window_seconds
        self.max_keys = max(1, max_keys)
        self._lock = threading.Lock()
        self._hits: dict[str, list[float]] = {}

    def _prune_key_locked(self, key: str, now: float) -> list[float]:
        cutoff = now - self.window_seconds
        fresh = [t for t in self._hits.get(key, []) if t > cutoff]
        if fresh:
            self._hits[key] = fresh
        else:
            self._hits.pop(key, None)
        return fresh

    def _evict_if_full_locked(self, now: float, incoming_key: str) -> None:
        if incoming_key in self._hits or len(self._hits) < self.max_keys:
            return
        cutoff = now - self.window_seconds
        stale_keys = [
            k
            for k, ts_list in self._hits.items()
            if not any(t > cutoff for t in ts_list)
        ]
        for k in stale_keys:
            self._hits.pop(k, None)
        if len(self._hits) >= self.max_keys:
            # Drop the oldest least-recently-active key to keep memory strictly bounded.
            oldest_key = min(
                self._hits.items(),
                key=lambda item: item[1][-1] if item[1] else 0.0,
            )[0]
            self._hits.pop(oldest_key, None)

    def _retry_after_locked(self, hits: list[float], now: float) -> int:
        if not hits:
            return 1
        remaining = self.window_seconds - (now - hits[0])
        return max(1, int(math.ceil(remaining)))

    def check_only(self, key: str) -> tuple[bool, int]:
        """Inspect whether ``key`` is currently below the limit without consuming a slot."""
        now = time.monotonic()
        with self._lock:
            fresh = self._prune_key_locked(key, now)
            if len(fresh) >= self.limit:
                return False, self._retry_after_locked(fresh, now)
            return True, 0

    def check(self, key: str) -> tuple[bool, int]:
        """Consume a slot for ``key`` if allowed; otherwise return ``(False, retry_after_seconds)``."""
        now = time.monotonic()
        with self._lock:
            self._evict_if_full_locked(now, key)
            fresh = self._prune_key_locked(key, now)
            if len(fresh) >= self.limit:
                return False, self._retry_after_locked(fresh, now)
            fresh.append(now)
            self._hits[key] = fresh
            return True, 0

    def record(self, key: str) -> None:
        """Record an event hit for ``key`` (e.g., failed authentication attempt)."""
        now = time.monotonic()
        with self._lock:
            self._evict_if_full_locked(now, key)
            fresh = self._prune_key_locked(key, now)
            fresh.append(now)
            self._hits[key] = fresh

    def clear_key(self, key: str) -> None:
        """Clear tracked hits for ``key`` (e.g., on successful authentication)."""
        with self._lock:
            self._hits.pop(key, None)

    def reset(self) -> None:
        """Clear all tracked keys and timestamps."""
        with self._lock:
            self._hits.clear()


_LIMITERS: dict[str, SlidingWindowRateLimiter] = {
    "auth_login_ip": SlidingWindowRateLimiter(limit=15, window_seconds=300.0),
    "auth_login_user_fail": SlidingWindowRateLimiter(limit=10, window_seconds=300.0),
    "auth_register_ip": SlidingWindowRateLimiter(limit=5, window_seconds=3600.0),
    "auth_setup_ip": SlidingWindowRateLimiter(limit=10, window_seconds=900.0),
    "auth_passkey_ip": SlidingWindowRateLimiter(limit=20, window_seconds=300.0),
    "profile_sensitive_user": SlidingWindowRateLimiter(limit=10, window_seconds=900.0),
    "import_inspect_user": SlidingWindowRateLimiter(limit=15, window_seconds=300.0),
}


def is_rate_limit_enabled() -> bool:
    """Return False only when CYBERCANTINA_RATE_LIMIT_ENABLED explicitly disables limiting."""
    raw = os.environ.get("CYBERCANTINA_RATE_LIMIT_ENABLED", "true").strip().lower()
    return raw not in _FALSY_VALUES


def get_rate_limiter(name: str) -> SlidingWindowRateLimiter:
    """Look up a registered rate limiter by name."""
    return _LIMITERS[name]


def enforce_rate_limit(
    limiter_name: str,
    key: str,
    *,
    record_hit: bool = True,
    detail: str = "Too many requests. Please wait and try again.",
) -> None:
    """Enforce the named sliding-window rate limit, raising HTTP 429 with Retry-After on excess."""
    if not is_rate_limit_enabled():
        return
    limiter = get_rate_limiter(limiter_name)
    allowed, retry_after = limiter.check(key) if record_hit else limiter.check_only(key)
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail=detail,
            headers={"Retry-After": str(retry_after)},
        )


def record_rate_limit_hit(limiter_name: str, key: str) -> None:
    """Record a hit (such as a failed login) against a named limiter when enabled."""
    if not is_rate_limit_enabled():
        return
    get_rate_limiter(limiter_name).record(key)


def clear_rate_limit_key(limiter_name: str, key: str) -> None:
    """Reset the counter for a single key in a named limiter."""
    get_rate_limiter(limiter_name).clear_key(key)


def reset_rate_limiters() -> None:
    """Reset every registered rate limiter bucket (intended for automated tests)."""
    for limiter in _LIMITERS.values():
        limiter.reset()
