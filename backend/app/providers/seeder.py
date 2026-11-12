"""One-way migration: derive providers from the pre-existing actor/clerk/embedding settings."""

from __future__ import annotations

import json
import logging
import os
import shutil
import sqlite3
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import httpx

from app.config import AppSettings, ModelProfile, persist_settings
from app.db.provider_store import ProviderStore
from app.providers.webgpu_catalog import (
    DEFAULT_WEBGPU_CONTEXT_SIZE,
    DEFAULT_WEBGPU_MODEL,
    get_webgpu_model_infos,
)
from app.schemas.auth import UserModelSettingsPayload
from app.security.url_policy import WEBGPU_SENTINEL_URL, UrlBlockedError, normalize_base_url

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
    if os.environ.get("CYBERCANTINA_NO_DEFAULT_PROVIDER", "").strip().lower() in ("1", "true", "yes"):
        store.set_meta(SEED_META_KEY, "1")
        return report
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


def auto_provision_webgpu_for_user(
    repo,  # type: ignore[no-untyped-def]
    user_id: str,
    app_settings: AppSettings,
) -> str | None:
    """When BYOP is active and no enabled global providers exist, give new users a WebGPU provider."""
    if not app_settings.allow_user_providers:
        return None
    store: ProviderStore = repo.providers
    if store.get_meta(SEED_META_KEY) is None:
        return None
    if any(p.is_enabled for p in store.list_system()):
        return None
    if store.list_for_owner(user_id) or repo.get_user_model_settings(user_id) is not None:
        return None

    record = store.create(
        name="Browser WebGPU",
        type="webgpu",
        scope="user",
        owner_id=user_id,
        color="purple",
        is_enabled=True,
        base_url=WEBGPU_SENTINEL_URL,
        bearer_token=None,
        network_restricted=True,
    )
    store.record_probe(
        record.id,
        models=get_webgpu_model_infos(),
        error_code=None,
        probed_at=datetime.now(timezone.utc).isoformat(),
    )
    repo.save_user_model_settings(
        user_id,
        UserModelSettingsPayload(
            actor_profile=ModelProfile(
                provider_id=record.id,
                model=DEFAULT_WEBGPU_MODEL,
                context_size=DEFAULT_WEBGPU_CONTEXT_SIZE,
            ),
            clerk_mirrors_actor=True,
        ),
    )
    return record.id


async def _is_default_ollama_reachable(url: str = "http://localhost:11434") -> bool:
    try:
        async with httpx.AsyncClient(timeout=1.5, follow_redirects=False) as client:
            resp = await client.get(f"{url.rstrip('/')}/api/tags")
            return resp.status_code == 200
    except Exception:  # noqa: BLE001
        return False


async def ensure_first_boot_webgpu_default(
    store: ProviderStore,
    app_settings: AppSettings,
    *,
    seed_report: SeedReport,
    settings_path: Path | None = None,
    probe_ollama: Callable[[], Awaitable[bool]] | None = None,
) -> bool:
    """On a brand-new install with no reachable server Ollama, pre-configure system Browser WebGPU.

    Leaves existing installs (``seed_report.skipped``) and explicitly configured endpoints
    (``ACTOR_BASE_URL`` / ``CLERK_BASE_URL``) untouched.
    """
    meta_key = "first_boot_provider_checked_v1"
    if store.get_meta(meta_key) is not None:
        return False
    if seed_report.skipped or not seed_report.created:
        store.set_meta(meta_key, "1")
        return False
    if os.environ.get("ACTOR_BASE_URL") or os.environ.get("CLERK_BASE_URL"):
        store.set_meta(meta_key, "1")
        return False

    ollama_ok = await (probe_ollama() if probe_ollama is not None else _is_default_ollama_reachable())
    if ollama_ok:
        store.set_meta(meta_key, "1")
        return False

    wg = store.create(
        name="Browser WebGPU",
        type="webgpu",
        scope="system",
        owner_id=None,
        color="purple",
        is_enabled=True,
        base_url=WEBGPU_SENTINEL_URL,
        bearer_token=None,
        network_restricted=False,
    )
    store.record_probe(
        wg.id,
        models=get_webgpu_model_infos(),
        error_code=None,
        probed_at=datetime.now(timezone.utc).isoformat(),
    )
    for old_id in seed_report.created:
        store.delete(old_id)

    app_settings.actor_profile = app_settings.actor_profile.model_copy(
        update={
            "provider_id": wg.id,
            "model": DEFAULT_WEBGPU_MODEL,
            "context_size": DEFAULT_WEBGPU_CONTEXT_SIZE,
        }
    )
    app_settings.clerk_profile = app_settings.clerk_profile.model_copy(
        update={
            "provider_id": wg.id,
            "model": DEFAULT_WEBGPU_MODEL,
            "context_size": DEFAULT_WEBGPU_CONTEXT_SIZE,
        }
    )
    app_settings.clerk_mirrors_actor = True
    app_settings.allow_user_providers = True
    app_settings.allow_user_model_overrides = True
    if settings_path is not None:
        persist_settings(app_settings)
    store.set_meta(meta_key, "1")
    logger.info("Pre-configured Browser WebGPU as default system provider (no server Ollama detected on first boot).")
    return True
