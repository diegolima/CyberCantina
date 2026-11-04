"""SQLite persistence for LLM providers (tenant-scoped, optimistic concurrency, sealed secrets)."""

from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from datetime import datetime, timezone

from app.schemas.provider import (
    ProviderModelInfo,
    ProviderRecord,
    normalize_provider_name,
    provider_name_key,
)
from app.security.secret_box import SecretBox, load_secret_box


class ProviderNotFoundError(KeyError):
    """No provider with that id (or not visible to the caller)."""


class ProviderNameConflictError(ValueError):
    """Another provider already uses this name within the uniqueness scope."""


class ProviderVersionConflictError(RuntimeError):
    """The provider changed since the caller loaded it (optimistic concurrency)."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def models_digest(models: list[ProviderModelInfo]) -> str:
    payload = json.dumps([m.model_dump() for m in sorted(models, key=lambda m: m.name)], sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


class ProviderStore:
    """CRUD over the ``providers`` and ``app_meta`` tables."""

    def __init__(self, db_path: str, secret_box: SecretBox | None = None) -> None:
        self.db_path = db_path
        self._box = secret_box

    @property
    def box(self) -> SecretBox:
        if self._box is None:
            self._box = load_secret_box(self.db_path)
        return self._box

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=10.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        conn.execute("PRAGMA busy_timeout = 5000;")
        return conn

    # ------------------------------------------------------------------ mapping
    @staticmethod
    def _row_to_record(row: sqlite3.Row) -> ProviderRecord:
        settings = json.loads(row["settings_json"] or "{}")
        cached_raw = json.loads(row["cached_models_json"] or "[]")
        return ProviderRecord(
            id=row["id"],
            name=row["name"],
            name_key=row["name_key"],
            type=row["type"],
            scope=row["scope"],
            owner_id=row["owner_id"],
            color=row["color"],
            is_enabled=bool(row["is_enabled"]),
            base_url=settings.get("base_url", ""),
            secret_enc=row["secret_enc"],
            network_restricted=bool(row["network_restricted"]),
            cached_models=[ProviderModelInfo.model_validate(m) for m in cached_raw],
            models_hash=row["models_hash"],
            last_probed_at=row["last_probed_at"],
            last_error_code=row["last_error_code"],
            version=row["version"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    def bearer_token(self, record: ProviderRecord) -> str | None:
        if not record.secret_enc:
            return None
        return self.box.open(record.secret_enc)

    # --------------------------------------------------------------------- reads
    def get(self, provider_id: str) -> ProviderRecord | None:
        conn = self._connect()
        try:
            row = conn.execute("SELECT * FROM providers WHERE id = ?", (provider_id,)).fetchone()
            return self._row_to_record(row) if row else None
        finally:
            conn.close()

    def list_system(self) -> list[ProviderRecord]:
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT * FROM providers WHERE scope = 'system' ORDER BY created_at, name_key"
            ).fetchall()
            return [self._row_to_record(r) for r in rows]
        finally:
            conn.close()

    def list_for_owner(self, owner_id: str) -> list[ProviderRecord]:
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT * FROM providers WHERE scope = 'user' AND owner_id = ? ORDER BY created_at, name_key",
                (owner_id,),
            ).fetchall()
            return [self._row_to_record(r) for r in rows]
        finally:
            conn.close()

    def count_system(self) -> int:
        conn = self._connect()
        try:
            return int(conn.execute("SELECT COUNT(*) FROM providers WHERE scope = 'system'").fetchone()[0])
        finally:
            conn.close()

    def name_taken(
        self,
        name_key: str,
        *,
        scope: str,
        owner_id: str | None,
        exclude_id: str | None = None,
    ) -> bool:
        """True when ``name_key`` collides within the scope (and, for user scope, with any system name)."""
        conn = self._connect()
        try:
            sql = "SELECT 1 FROM providers WHERE name_key = ? AND id != ? AND ("
            params: list = [name_key, exclude_id or ""]
            if scope == "system":
                sql += "scope = 'system')"
            else:
                sql += "scope = 'system' OR (scope = 'user' AND owner_id = ?))"
                params.append(owner_id)
            return conn.execute(sql, params).fetchone() is not None
        finally:
            conn.close()

    # -------------------------------------------------------------------- writes
    def unique_default_name(self, base: str, *, scope: str, owner_id: str | None) -> str:
        candidate = base
        suffix = 2
        while self.name_taken(provider_name_key(candidate), scope=scope, owner_id=owner_id):
            candidate = f"{base} {suffix}"
            suffix += 1
        return candidate

    def create(
        self,
        *,
        name: str | None,
        type: str,
        scope: str,
        owner_id: str | None,
        color: str,
        is_enabled: bool,
        base_url: str,
        bearer_token: str | None,
        network_restricted: bool,
        conn: sqlite3.Connection | None = None,
    ) -> ProviderRecord:
        if name is None or not name.strip():
            display = self.unique_default_name(type.capitalize(), scope=scope, owner_id=owner_id)
        else:
            display = normalize_provider_name(name)
        key = provider_name_key(display)
        if self.name_taken(key, scope=scope, owner_id=owner_id):
            raise ProviderNameConflictError(f"A provider named '{display}' already exists.")
        now = _now()
        provider_id = f"prov_{uuid.uuid4().hex[:16]}"
        secret = self.box.seal(bearer_token) if bearer_token else None
        owns = conn is None
        active = conn or self._connect()
        try:
            try:
                active.execute(
                    """
                    INSERT INTO providers (id, name, name_key, type, scope, owner_id, color, is_enabled,
                        settings_json, secret_enc, network_restricted, version, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                    """,
                    (
                        provider_id, display, key, type, scope, owner_id, color, 1 if is_enabled else 0,
                        json.dumps({"base_url": base_url}), secret, 1 if network_restricted else 0, now, now,
                    ),
                )
            except sqlite3.IntegrityError as exc:
                raise ProviderNameConflictError(f"A provider named '{display}' already exists.") from exc
            if owns:
                active.commit()
        finally:
            if owns:
                active.close()
        record = self.get(provider_id) if owns else None
        if record is None:  # inside a caller-managed transaction
            record = ProviderRecord(
                id=provider_id, name=display, name_key=key, type=type, scope=scope, owner_id=owner_id,
                color=color, is_enabled=is_enabled, base_url=base_url, secret_enc=secret,
                network_restricted=network_restricted, version=1, created_at=now, updated_at=now,
            )
        return record

    def update(
        self,
        provider_id: str,
        *,
        expected_version: int,
        name: str | None = None,
        color: str | None = None,
        is_enabled: bool | None = None,
        base_url: str | None = None,
        bearer_token: str | None = None,
        clear_bearer_token: bool = False,
    ) -> ProviderRecord:
        current = self.get(provider_id)
        if current is None:
            raise ProviderNotFoundError(provider_id)
        new_name, new_key = current.name, current.name_key
        if name is not None:
            new_name = normalize_provider_name(name)
            new_key = provider_name_key(new_name)
            if new_key != current.name_key and self.name_taken(
                new_key, scope=current.scope, owner_id=current.owner_id, exclude_id=provider_id
            ):
                raise ProviderNameConflictError(f"A provider named '{new_name}' already exists.")
        secret = current.secret_enc
        if clear_bearer_token:
            secret = None
        if bearer_token:
            secret = self.box.seal(bearer_token)
        conn = self._connect()
        try:
            try:
                cur = conn.execute(
                    """
                    UPDATE providers SET name = ?, name_key = ?, color = ?, is_enabled = ?, settings_json = ?,
                        secret_enc = ?, version = version + 1, updated_at = ?
                    WHERE id = ? AND version = ?
                    """,
                    (
                        new_name, new_key, color or current.color,
                        1 if (current.is_enabled if is_enabled is None else is_enabled) else 0,
                        json.dumps({"base_url": base_url if base_url is not None else current.base_url}),
                        secret, _now(), provider_id, expected_version,
                    ),
                )
            except sqlite3.IntegrityError as exc:
                raise ProviderNameConflictError(f"A provider named '{new_name}' already exists.") from exc
            if cur.rowcount == 0:
                conn.rollback()
                raise ProviderVersionConflictError(provider_id)
            conn.commit()
        finally:
            conn.close()
        updated = self.get(provider_id)
        assert updated is not None
        return updated

    def delete(self, provider_id: str) -> bool:
        conn = self._connect()
        try:
            cur = conn.execute("DELETE FROM providers WHERE id = ?", (provider_id,))
            conn.commit()
            return cur.rowcount > 0
        finally:
            conn.close()

    def record_probe(
        self,
        provider_id: str,
        *,
        models: list[ProviderModelInfo] | None,
        error_code: str | None,
        probed_at: str,
    ) -> None:
        """Persist probe outcome touching ONLY probe columns (never races with config edits).

        Model catalog is written only when it changed (or was never stored); failures keep the
        last good catalog so dropdowns stay populated.
        """
        conn = self._connect()
        try:
            if models is not None:
                digest = models_digest(models)
                row = conn.execute("SELECT models_hash FROM providers WHERE id = ?", (provider_id,)).fetchone()
                if row is None:
                    return
                if row["models_hash"] != digest:
                    conn.execute(
                        "UPDATE providers SET cached_models_json = ?, models_hash = ?, last_probed_at = ?, last_error_code = NULL WHERE id = ?",
                        (json.dumps([m.model_dump() for m in models]), digest, probed_at, provider_id),
                    )
                else:
                    conn.execute(
                        "UPDATE providers SET last_probed_at = ?, last_error_code = NULL WHERE id = ?",
                        (probed_at, provider_id),
                    )
            else:
                conn.execute(
                    "UPDATE providers SET last_probed_at = ?, last_error_code = ? WHERE id = ?",
                    (probed_at, error_code, provider_id),
                )
            conn.commit()
        finally:
            conn.close()

    # ---------------------------------------------------------------------- meta
    def get_meta(self, key: str, conn: sqlite3.Connection | None = None) -> str | None:
        active = conn or self._connect()
        try:
            row = active.execute("SELECT value FROM app_meta WHERE key = ?", (key,)).fetchone()
            return row["value"] if row else None
        finally:
            if conn is None:
                active.close()

    def set_meta(self, key: str, value: str, conn: sqlite3.Connection | None = None) -> None:
        active = conn or self._connect()
        try:
            active.execute(
                "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, value),
            )
            if conn is None:
                active.commit()
        finally:
            if conn is None:
                active.close()
