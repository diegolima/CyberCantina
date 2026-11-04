"""Find (and clear) everything that points at a provider: system roles and per-user overrides."""

from __future__ import annotations

import json
import sqlite3

from app.config import AppSettings
from app.db.provider_store import ProviderStore
from app.schemas.provider import ProviderReference


def _user_override_rows(conn: sqlite3.Connection, provider_id: str, owner_id: str | None):
    sql = "SELECT user_id, actor_profile_json, clerk_profile_json FROM user_model_settings"
    params: tuple = ()
    if owner_id is not None:
        sql += " WHERE user_id = ?"
        params = (owner_id,)
    for row in conn.execute(sql, params).fetchall():
        roles = []
        for role, col in (("actor", "actor_profile_json"), ("clerk", "clerk_profile_json")):
            raw = row[col]
            if raw and json.loads(raw).get("provider_id") == provider_id:
                roles.append((role, col))
        if roles:
            yield row["user_id"], roles


def find_references(
    provider_id: str, store: ProviderStore, app_settings: AppSettings, *, owner_id: str | None = None
) -> list[ProviderReference]:
    """Describe usages. ``owner_id`` limits the user-override scan to one user (personal providers)."""
    refs: list[ProviderReference] = []
    if owner_id is None:
        for role, profile in (("actor", app_settings.actor_profile), ("clerk", app_settings.clerk_profile)):
            if profile.provider_id == provider_id:
                refs.append(ProviderReference(kind="system_role", role=role))
        if app_settings.embedding_profile.provider_id == provider_id:
            refs.append(ProviderReference(kind="embedding", role="embedding"))
    conn = store._connect()
    try:
        users = {uid for uid, _roles in _user_override_rows(conn, provider_id, owner_id)}
    finally:
        conn.close()
    if users:
        refs.append(ProviderReference(kind="user_override", user_count=len(users)))
    return refs


def clear_user_overrides(provider_id: str, store: ProviderStore, *, owner_id: str | None = None) -> int:
    """Reset overrides that reference the provider back to 'inherit'. Returns affected user count."""
    conn = store._connect()
    try:
        affected = 0
        for user_id, roles in list(_user_override_rows(conn, provider_id, owner_id)):
            for _role, col in roles:
                conn.execute(f"UPDATE user_model_settings SET {col} = NULL WHERE user_id = ?", (user_id,))
            affected += 1
        conn.commit()
        return affected
    finally:
        conn.close()
