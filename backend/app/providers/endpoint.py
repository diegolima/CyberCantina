"""Leaf module (no app imports) holding the resolved-endpoint value object."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class ResolvedEndpoint:
    """A fully resolved, ready-to-call provider endpoint for one request.

    ``bearer_token`` is excluded from ``repr`` so it can never leak through logging.
    """

    provider_id: str
    type: str
    root_url: str
    bearer_token: str | None = field(default=None, repr=False)
    timeout_seconds: float = 120.0
    # True for providers created by non-admin users: network location is re-validated before use.
    network_restricted: bool = False
