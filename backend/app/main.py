"""FastAPI entrypoint and application orchestrator for CyberCantina."""

from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth import get_current_user, get_optional_user
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
from app.routers.notes import router as notes_router
from app.routers.prompts import router as prompts_router
from app.routers.settings import router as settings_router
from app.routers.worlds import router as worlds_router

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
    await auto_configure_ollama_models()
    pruner_task = asyncio.create_task(_periodic_entity_pruner())
    try:
        yield
    finally:
        pruner_task.cancel()
        with suppress(asyncio.CancelledError):
            await pruner_task
        await llm_client.close()


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

# Register modular domain routers
app.include_router(auth_router)
app.include_router(settings_router)
app.include_router(prompts_router)
app.include_router(notes_router)
app.include_router(worlds_router)
app.include_router(characters_router)
app.include_router(campaigns_router)
