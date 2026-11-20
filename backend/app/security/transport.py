"""Trusted-proxy transport inspection, client IP extraction, and cookie/HSTS security helpers."""

from __future__ import annotations

import ipaddress
import json
import os
from collections.abc import Mapping
from functools import lru_cache

_TRUTHY_VALUES = frozenset({"1", "true", "yes", "on"})
_FALSY_VALUES = frozenset({"0", "false", "no", "off"})

_DEFAULT_TRUSTED_PROXY_NETWORKS: tuple[
    ipaddress.IPv4Network | ipaddress.IPv6Network, ...
] = (
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("fc00::/7"),
)


def _env_truthy(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    cleaned = raw.strip().lower()
    if cleaned in _TRUTHY_VALUES:
        return True
    if cleaned in _FALSY_VALUES:
        return False
    return default


@lru_cache(maxsize=8)
def _parse_extra_proxy_networks(
    raw_cidrs: str,
) -> tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...]:
    nets: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = []
    for item in raw_cidrs.split(","):
        cleaned = item.strip()
        if not cleaned:
            continue
        try:
            nets.append(ipaddress.ip_network(cleaned, strict=False))
        except ValueError:
            continue
    return tuple(nets)


def _trusted_proxy_hops() -> int:
    raw = os.environ.get("CYBERCANTINA_TRUSTED_PROXY_HOPS", "1").strip()
    try:
        hops = int(raw)
    except ValueError:
        return 1
    return max(0, min(hops, 10))


def _clean_ip_candidate(raw: str | None) -> str | None:
    if not raw:
        return None
    cleaned = raw.strip()
    if not cleaned:
        return None
    try:
        addr = ipaddress.ip_address(cleaned)
    except ValueError:
        return None
    return str(addr)


def is_trusted_proxy_ip(ip_str: str | None) -> bool:
    """Return True when ``ip_str`` belongs to loopback, private/Docker, or configured proxy CIDRs."""
    if not ip_str:
        return False
    cleaned = ip_str.strip()
    if not cleaned:
        return False
    try:
        addr = ipaddress.ip_address(cleaned)
    except ValueError:
        return False
    if addr.is_link_local or addr.is_multicast or addr.is_unspecified:
        return False
    for net in _DEFAULT_TRUSTED_PROXY_NETWORKS:
        if addr in net:
            return True
    extra_raw = os.environ.get("CYBERCANTINA_TRUSTED_PROXIES", "")
    if extra_raw.strip():
        for net in _parse_extra_proxy_networks(extra_raw):
            if addr in net:
                return True
    return False


def _header_get(headers: Mapping[str, str], name: str) -> str:
    target = name.lower()
    # Starlette/FastAPI Headers implement case-insensitive .get(), plain dicts may not.
    direct = headers.get(name)
    if direct is not None:
        return str(direct)
    for k, v in headers.items():
        if str(k).lower() == target:
            return str(v)
    return ""


def resolve_client_ip(headers: Mapping[str, str], client_host: str | None) -> str:
    """Resolve client IP safely, honoring forwarding headers only from trusted proxy peers."""
    peer = (client_host or "").strip()
    if not is_trusted_proxy_ip(peer):
        return peer or "unknown"

    if _env_truthy("CYBERCANTINA_TRUST_CF_HEADERS", default=False):
        cf_ip = _clean_ip_candidate(_header_get(headers, "cf-connecting-ip"))
        if cf_ip:
            return cf_ip

    xff_raw = _header_get(headers, "x-forwarded-for")
    if xff_raw:
        hops = [
            parsed
            for part in xff_raw.split(",")
            if (parsed := _clean_ip_candidate(part)) is not None
        ]
        if hops:
            remaining_trusted = _trusted_proxy_hops()
            for candidate in reversed(hops):
                if remaining_trusted > 0 and is_trusted_proxy_ip(candidate):
                    remaining_trusted -= 1
                    continue
                return candidate
            return hops[0]

    real_ip = _clean_ip_candidate(_header_get(headers, "x-real-ip"))
    return real_ip or peer


def is_request_https(
    scheme: str | None,
    headers: Mapping[str, str],
    client_host: str | None,
) -> bool:
    """Return True when the request arrived directly or via a trusted proxy over HTTPS."""
    if (scheme or "").strip().lower() == "https":
        return True
    if not is_trusted_proxy_ip(client_host):
        return False

    xfp_raw = _header_get(headers, "x-forwarded-proto")
    if xfp_raw:
        first_proto = xfp_raw.split(",", 1)[0].strip().lower()
        if first_proto == "https":
            return True

    cf_visitor_raw = _header_get(headers, "cf-visitor")
    if cf_visitor_raw:
        try:
            parsed = json.loads(cf_visitor_raw)
        except (ValueError, TypeError):
            parsed = None
        if isinstance(parsed, dict) and str(parsed.get("scheme", "")).strip().lower() == "https":
            return True

    return False


def should_set_secure_cookie(
    scheme: str | None,
    headers: Mapping[str, str],
    client_host: str | None,
) -> bool:
    """Determine whether session cookies should carry the Secure attribute."""
    mode = os.environ.get("CYBERCANTINA_COOKIE_SECURE", "auto").strip().lower()
    if mode in _TRUTHY_VALUES:
        return True
    if mode in _FALSY_VALUES:
        return False
    return is_request_https(scheme, headers, client_host)


def should_emit_hsts(
    scheme: str | None,
    headers: Mapping[str, str],
    client_host: str | None,
) -> bool:
    """Emit HSTS only when explicitly enabled AND the request arrived over HTTPS."""
    if not _env_truthy("CYBERCANTINA_ENABLE_HSTS", default=False):
        return False
    return is_request_https(scheme, headers, client_host)
