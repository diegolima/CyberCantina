"""Outbound URL normalization and SSRF policy for provider endpoints.

Policy:
* http/https only, no userinfo, query or fragment.
* Link-local (cloud metadata), unspecified, multicast and reserved addresses are always blocked.
* Loopback, private/LAN addresses and ``localhost``-style names are blocked for regular users
  (``allow_private=False``) and allowed for administrators.
* Every address a hostname resolves to must pass.
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
import time
from dataclasses import dataclass
from urllib.parse import urlsplit

_DNS_TTL_SECONDS = 30.0
_DNS_CACHE: dict[str, tuple[float, list[str]]] = {}
_LOCAL_NAME_SUFFIXES = (".localhost", ".local", ".internal", ".lan", ".home.arpa")


class UrlBlockedError(ValueError):
    """Raised when a provider URL is malformed or violates the outbound network policy."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class NormalizedUrl:
    root: str
    host: str
    port: int
    scheme: str


OPENROUTER_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"


def normalize_base_url(raw: str, *, provider_type: str = "ollama") -> NormalizedUrl:
    """Validate syntax and reduce to a root URL (no trailing slash, ``/v1`` or ``/api``)."""
    text = (raw or "").strip()
    if not text:
        if provider_type == "openrouter":
            text = OPENROUTER_DEFAULT_BASE_URL
        else:
            raise UrlBlockedError("invalid_url", "Server URL is required.")
    parts = urlsplit(text)
    if parts.scheme not in ("http", "https"):
        raise UrlBlockedError("invalid_url", "Server URL must start with http:// or https://.")
    if not parts.hostname:
        raise UrlBlockedError("invalid_url", "Server URL has no host.")
    if parts.username is not None or parts.password is not None:
        raise UrlBlockedError("invalid_url", "Credentials in the URL are not allowed; use the bearer token field.")
    if parts.query or parts.fragment:
        raise UrlBlockedError("invalid_url", "Server URL must not contain a query string or fragment.")
    try:
        port = parts.port or (443 if parts.scheme == "https" else 80)
    except ValueError as exc:
        raise UrlBlockedError("invalid_url", "Server URL has an invalid port.") from exc
    path = parts.path.rstrip("/")
    if provider_type == "openrouter":
        if not path:
            path = "/api/v1"
    else:
        for suffix in ("/v1", "/api"):
            if path.endswith(suffix):
                path = path[: -len(suffix)].rstrip("/")
    host_part = parts.netloc
    root = f"{parts.scheme}://{host_part}{path}"
    return NormalizedUrl(root=root, host=parts.hostname.lower(), port=port, scheme=parts.scheme)


def _classify(ip_text: str, *, allow_private: bool) -> str | None:
    """Return a block reason for an address, or None when allowed."""
    ip = ipaddress.ip_address(ip_text)
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    # Never allowed for anyone: cloud metadata/link-local, unspecified, multicast.
    if ip.is_link_local or ip.is_unspecified or ip.is_multicast:
        return "link-local, unspecified or multicast address"
    # Loopback and private/shared (RFC1918, ULA, CGNAT...) space: administrators only.
    if ip.is_loopback or ip.is_private or not ip.is_global:
        return None if allow_private else "loopback or private-network address"
    if ip.is_reserved:
        return "reserved address"
    return None


async def _resolve(host: str) -> list[str]:
    now = time.monotonic()
    cached = _DNS_CACHE.get(host)
    if cached and now - cached[0] < _DNS_TTL_SECONDS:
        return cached[1]
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise UrlBlockedError("dns_failure", "Server host could not be resolved.") from exc
    addresses = sorted({info[4][0].split("%")[0] for info in infos})
    _DNS_CACHE[host] = (now, addresses)
    return addresses


async def assert_url_allowed(url: NormalizedUrl, *, allow_private: bool) -> None:
    """Raise ``UrlBlockedError`` unless every resolved address of ``url`` passes the policy."""
    host = url.host
    if not allow_private and (host == "localhost" or host.endswith(_LOCAL_NAME_SUFFIXES)):
        raise UrlBlockedError("blocked_by_policy", "Local addresses are not allowed for user providers.")
    try:
        addresses = [str(ipaddress.ip_address(host))]
    except ValueError:
        addresses = await _resolve(host)
    for address in addresses:
        reason = _classify(address, allow_private=allow_private)
        if reason:
            raise UrlBlockedError("blocked_by_policy", f"Server address is not allowed ({reason}).")


def clear_dns_cache() -> None:
    _DNS_CACHE.clear()
