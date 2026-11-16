"""Shared bounded validation helpers for entity unsupported_fields extension containers."""

from __future__ import annotations

import json
from typing import Any

MAX_UNSUPPORTED_KEYS = 64
MAX_UNSUPPORTED_BYTES = 64 * 1024
MAX_UNSUPPORTED_DEPTH = 8


def measure_json_depth(val: Any) -> int:
    """Measure nested dict/list depth iteratively."""
    if not isinstance(val, (dict, list)):
        return 0
    max_depth = 0
    stack: list[tuple[Any, int]] = [(val, 1)]
    while stack:
        curr, depth = stack.pop()
        if depth > max_depth:
            max_depth = depth
        if isinstance(curr, dict):
            for child in curr.values():
                if isinstance(child, (dict, list)):
                    stack.append((child, depth + 1))
        elif isinstance(curr, list):
            for child in curr:
                if isinstance(child, (dict, list)):
                    stack.append((child, depth + 1))
    return max_depth


def sanitize_unsupported_fields_dict(
    raw: Any,
    *,
    blocked_keys: frozenset[str],
    strict: bool = False,
) -> dict[str, Any]:
    """Validate and bound arbitrary extension/legacy keys in unsupported_fields."""
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        if strict:
            raise ValueError("unsupported_fields must be a JSON object.")
        return {}

    cleaned: dict[str, Any] = {}
    for k, v in raw.items():
        if not isinstance(k, str):
            continue
        key = k.strip()
        if not key or key in blocked_keys:
            continue
        if v is None:
            continue
        if isinstance(v, str) and not v.strip():
            continue
        if isinstance(v, list) and len(v) == 0:
            continue
        cleaned[key] = v

    if len(cleaned) > MAX_UNSUPPORTED_KEYS:
        if strict:
            raise ValueError(
                f"Too many unsupported fields ({len(cleaned)} > {MAX_UNSUPPORTED_KEYS})."
            )
        cleaned = dict(list(cleaned.items())[:MAX_UNSUPPORTED_KEYS])

    for k, v in list(cleaned.items()):
        depth = measure_json_depth(v)
        if depth > MAX_UNSUPPORTED_DEPTH:
            if strict:
                raise ValueError(
                    f"Unsupported field '{k}' exceeds maximum nesting depth ({depth} > {MAX_UNSUPPORTED_DEPTH})."
                )
            cleaned.pop(k, None)

    try:
        encoded = json.dumps(cleaned, ensure_ascii=False).encode("utf-8")
    except (TypeError, ValueError) as exc:
        if strict:
            raise ValueError("Unsupported fields must be JSON-serializable.") from exc
        return {}

    if len(encoded) > MAX_UNSUPPORTED_BYTES:
        if strict:
            raise ValueError(
                f"Unsupported fields payload exceeds size limit ({len(encoded)} bytes > {MAX_UNSUPPORTED_BYTES} bytes)."
            )
        return {}

    return cleaned
