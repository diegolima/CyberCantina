"""One-way migration: derive providers from the pre-existing actor/clerk/embedding settings."""

from __future__ import annotations

import json
import logging
import shutil
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path

from app.config import AppSettings, ModelProfile, persist_settings
from app.db.provider_store import ProviderStore
from app.security.url_policy import UrlBlockedError, normalize_base_url

logger = logging.getLogger("cybercantina.providers.seeder")

SEED_META_KEY = "providers_seeded_v1"
_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}
_DUMMY_KEYS = {"", "ollama"}


@dataclass
class SeedReport:
    skipped: bool = False
    created: list[str] = field(default_factory=list)
    discarded_overrides: list[str] = field(default_factory=list)
    backups: list[Path] = field(default_factory=list)


def _legacy_token(api_key: str) -> str | None:
    return None if api_key in _DUMMY_KEYS else api_key


def backup_before_migration(db_path: str, settings_path: Path) -> list[Path]:
    """Copy the DB (via the SQLite backup API) and settings file once, before the one-way migration."""
    backups: list[Path] = []
    db_file = Path(db_path)
    if db_file.exists():
        target = db_file.with_name(db_file.name + ".bak-pre-providers")
        if not target.exists():
            src = sqlite3.connect(str(db_file))
            dst = sqlite3.connect(str(target))
            try:
                src.backup(dst)
            finally:
                dst.close()
                src.close()
            backups.append(target)
    if settings_path.exists():
        target = settings_path.with_name(settings_path.name + ".bak-pre-providers")
        if not target.exists():
            shutil.copy2(settings_path, target)
            backups.append(target)
    return backups


def _provider_name(host: str, port: int, taken: set[str]) -> str:
    base = "Local Ollama" if host in _LOCAL_HOSTS else f"Ollama ({host})"
    name = base
    if name.casefold() in taken:
        name = f"{base[:-1]}:{port})" if base.endswith(")") else f"{base} :{port}"
    suffix = 2
    while name.casefold() in taken:
        name = f"{base} {suffix}"
        suffix += 1
    taken.add(name.casefold())
    return name


def seed_providers(
    store: ProviderStore,
    app_settings: AppSettings,
    *,
    settings_path: Path | None = None,
) -> SeedReport:
    """Create system providers from current profiles. Idempotent via ``app_meta`` and transactional."""
    if store.get_meta(SEED_META_KEY) is not None:
        return SeedReport(skipped=True)

    report = SeedReport()
    if settings_path is not None:
        report.backups = backup_before_migration(store.db_path, settings_path)

    candidates: list[tuple[str, ModelProfile | object]] = [
        ("actor", app_settings.actor_profile),
        ("clerk", app_settings.clerk_profile),
    ]
    if app_settings.embedding_profile.mode == "openai_compat":
        candidates.append(("embedding", app_settings.embedding_profile))

    groups: dict[tuple[str, str | None], str] = {}
    taken = {p.name_key for p in store.list_system()}
    conn = store._connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        root_to_id: dict[str, str] = {}
        for role, profile in candidates:
            if getattr(profile, "provider_id", None):
                continue
            try:
                url = normalize_base_url(profile.base_url)  # type: ignore[attr-defined]
            except UrlBlockedError as exc:
                logger.warning("Cannot migrate %s endpoint %r: %s", role, profile.base_url, exc)  # type: ignore[attr-defined]
                continue
            token = _legacy_token(profile.api_key)  # type: ignore[attr-defined]
            key = (url.root, token)
            provider_id = groups.get(key)
            if provider_id is None:
                record = store.create(
                    name=_provider_name(url.host, url.port, taken),
                    type="ollama",
                    scope="system",
                    owner_id=None,
                    color="cyan" if not groups else "neutral",
                    is_enabled=True,
                    base_url=url.root,
                    bearer_token=token,
                    network_restricted=False,
                    conn=conn,
                )
                provider_id = record.id
                groups[key] = provider_id
                root_to_id.setdefault(url.root, provider_id)
                report.created.append(provider_id)
            profile.provider_id = provider_id  # type: ignore[attr-defined]
            profile.api_key = "ollama"  # type: ignore[attr-defined]  # token now lives sealed on the provider

        default_id = app_settings.actor_profile.provider_id
        for row in conn.execute(
            "SELECT user_id, actor_profile_json, clerk_profile_json FROM user_model_settings"
        ).fetchall():
            updates: dict[str, str] = {}
            for col in ("actor_profile_json", "clerk_profile_json"):
                raw = row[col]
                if not raw:
                    continue
                data = json.loads(raw)
                if data.get("provider_id"):
                    continue
                matched = None
                try:
                    matched = root_to_id.get(normalize_base_url(data.get("base_url", "")).root)
                except UrlBlockedError:
                    pass
                if matched is None:
                    report.discarded_overrides.append(f"{row['user_id']}:{col}")
                data["provider_id"] = matched or default_id
                data.pop("api_key", None)
                updates[col] = json.dumps(data)
            for col, value in updates.items():
                conn.execute(f"UPDATE user_model_settings SET {col} = ? WHERE user_id = ?", (value, row["user_id"]))

        store.set_meta(SEED_META_KEY, "1", conn=conn)
        conn.commit()
    except BaseException:
        conn.rollback()
        # Undo in-memory assignments so a failed migration leaves settings untouched.
        for _role, profile in candidates:
            if profile.provider_id in report.created:  # type: ignore[attr-defined]
                profile.provider_id = None  # type: ignore[attr-defined]
        raise
    finally:
        conn.close()

    if report.created:
        persist_settings(app_settings)
    return report


def reconcile_settings_references(app_settings: AppSettings, store: ProviderStore) -> list[str]:
    """Startup guard against JSON/DB split-brain. Returns human-readable findings (also logged)."""
    findings: list[str] = []
    system = {p.id: p for p in store.list_system()}
    by_root = {}
    for p in system.values():
        by_root.setdefault(p.base_url, p.id)
    repaired = False
    for role, profile in (
        ("actor", app_settings.actor_profile),
        ("clerk", app_settings.clerk_profile),
        ("embedding", app_settings.embedding_profile),
    ):
        if profile.provider_id:
            if profile.provider_id not in system:
                findings.append(f"{role} profile references missing provider {profile.provider_id}")
            continue
        if role == "embedding" and profile.mode != "openai_compat":
            continue
        try:
            root = normalize_base_url(profile.base_url).root
        except UrlBlockedError:
            continue
        if root in by_root:
            profile.provider_id = by_root[root]
            findings.append(f"{role} profile re-linked to provider {by_root[root]}")
            repaired = True
    for message in findings:
        logger.warning("Provider reconciliation: %s", message)
    if repaired:
        try:
            persist_settings(app_settings)
        except OSError as exc:
            logger.error("Could not persist reconciled settings: %s", exc)
    return findings
