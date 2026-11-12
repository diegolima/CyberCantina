"""FastAPI entrypoint and application orchestrator for CyberCantina."""

from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app import config
from app.auth import get_current_user, get_optional_user
from app.config import settings
from app.providers.local_relay import local_relay_hub, relay_tab_context, relay_user_context
from app.providers.probe import probe_service, probe_system_providers
from app.providers.seeder import (
    ensure_first_boot_webgpu_default,
    reconcile_settings_references,
    seed_providers,
)
from app.db.seed import ensure_default_seed
from app.dependencies import (
    get_effective_user_model_settings,
    get_repo,
    process_and_save_image,
    run_entity_pruner,
    safe_resolve_media_path,
)
from app.engine.llm_client import auto_configure_ollama_models, llm_client
from app.routers.auth import router as auth_router
from app.routers.campaigns import _execute_turn_stream_events, router as campaigns_router
from app.routers.characters import router as characters_router
from app.routers.enrich import router as enrich_router
from app.routers.import_export import router as import_export_router
from app.routers.local_relay import router as local_relay_router
from app.routers.mechanics import router as mechanics_router
from app.routers.notes import router as notes_router
from app.routers.personas import router as personas_router
from app.routers.prompts import router as prompts_router
from app.routers.providers import router as providers_router
from app.routers.settings import router as settings_router
from app.routers.worlds import router as worlds_router
from app.security.log_sanitize import sanitize_log_value

# Configure root logger
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("cybercantina")

# Re-exports for backward compatibility with tests
_safe_resolve_media_path = safe_resolve_media_path
_process_and_save_image = process_and_save_image


async def _periodic_entity_pruner(interval_seconds: float = 60.0) -> None:
    """Background task that periodically prunes unreferenced soft-deleted characters and worlds."""
    while True:
        await asyncio.sleep(interval_seconds)
        try:
            run_entity_pruner()
        except Exception as exc:
            logger.warning("Periodic entity pruner error: %s", exc)


async def _migrate_providers(repo) -> None:  # type: ignore[no-untyped-def]
    """Startup order: backup -> seed (one-way, transactional) -> reconcile -> first-boot WebGPU check."""
    store = repo.providers
    try:
        report = seed_providers(store, settings, settings_path=config.SETTINGS_FILE_PATH)
        if not report.skipped:
            logger.info(
                "Seeded %d provider(s) from existing settings (backups: %s)",
                len(report.created),
                [str(b) for b in report.backups],
            )
            if report.discarded_overrides:
                logger.warning("User overrides reset to the default provider: %s", report.discarded_overrides)
            repo.vector_store.stamp_unstamped_entries()
        reconcile_settings_references(settings, store)
        await ensure_first_boot_webgpu_default(
            store,
            settings,
            seed_report=report,
            settings_path=config.SETTINGS_FILE_PATH,
        )
    except Exception:  # noqa: BLE001 - never block startup; legacy endpoints keep working
        logger.exception("Provider migration failed; continuing with legacy endpoint settings")


async def _periodic_provider_probe(interval_seconds: float = 300.0) -> None:
    """Background task refreshing the stored status of system providers (probe now, then periodically)."""
    while True:
        try:
            await probe_system_providers(get_repo().providers)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Periodic provider probe error: %s", exc)
        await asyncio.sleep(interval_seconds)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    repo = get_repo()
    repo.init_db()
    run_entity_pruner()
    ensure_default_seed(repo)
    users = repo.list_users()
    if users:
        admin = next((u for u in users if u.role == "admin"), users[0])
        repo.claim_unowned_entities(admin.id)
    await _migrate_providers(repo)
    await auto_configure_ollama_models()
    pruner_task = asyncio.create_task(_periodic_entity_pruner())
    probe_task = asyncio.create_task(_periodic_provider_probe())
    try:
        yield
    finally:
        pruner_task.cancel()
        probe_task.cancel()
        with suppress(asyncio.CancelledError):
            await pruner_task
        with suppress(asyncio.CancelledError):
            await probe_task
        await llm_client.close()
        await probe_service.close()
        await local_relay_hub.close_all()


app = FastAPI(
    title="CyberCantina Agentic Roleplay API",
    version="0.1.0",
    lifespan=lifespan,
)

allowed_origins_env = os.environ.get("CYBERCANTINA_ALLOWED_ORIGINS")
if allowed_origins_env:
    cors_origins = [o.strip() for o in allowed_origins_env.split(",") if o.strip()]
else:
    cors_origins = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://testserver",
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def attach_relay_tab_context(request: Request, call_next):
    raw_tab = request.headers.get("x-cantina-tab-id")
    tab_id = sanitize_log_value(raw_tab).strip()[:64] if raw_tab else None
    tab_token = relay_tab_context.set(tab_id or None)
    user_token = relay_user_context.set(None)
    try:
        response = await call_next(request)
        if "Permissions-Policy" not in response.headers:
            response.headers["Permissions-Policy"] = "loopback-network=(self)"
        return response
    finally:
        relay_user_context.reset(user_token)
        relay_tab_context.reset(tab_token)


# Register modular domain routers
app.include_router(auth_router)
app.include_router(settings_router)
app.include_router(providers_router)
app.include_router(local_relay_router)
app.include_router(prompts_router)
app.include_router(notes_router)
app.include_router(worlds_router)
app.include_router(characters_router)
app.include_router(personas_router)
app.include_router(mechanics_router)
app.include_router(campaigns_router)
app.include_router(enrich_router)
app.include_router(import_export_router)
