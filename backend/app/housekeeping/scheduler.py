"""In-process async Chloromancer housekeeping scheduler."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from app.config import settings
from app.db.repository import CantinaRepository
from app.housekeeping.purge_inactive import run_inactive_user_purge
from app.schemas.housekeeping import (
    ChloromancerJobInfo,
    ChloromancerRunRecord,
    ChloromancerStatusResponse,
)

logger = logging.getLogger("cybercantina.housekeeping.scheduler")


class JobNotFoundError(KeyError):
    """Raised when an unknown Chloromancer job ID is requested."""


class JobAlreadyRunningError(RuntimeError):
    """Raised when a Chloromancer job is already executing."""


@dataclass
class _RegisteredJob:
    job_id: str
    description: str
    runner: Callable[[CantinaRepository, str, str | None], Awaitable[dict[str, Any] | None]]
    is_enabled: Callable[[], bool]


class ChloromancerScheduler:
    """Extensible single-process housekeeping scheduler managed by FastAPI lifespan."""

    def __init__(self) -> None:
        self._jobs: dict[str, _RegisteredJob] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._task: asyncio.Task[None] | None = None
        self._last_tick_monotonic: float = 0.0
        self._register_builtin_jobs()

    def _register_builtin_jobs(self) -> None:
        async def _purge_runner(
            repo: CantinaRepository, trigger: str, actor_user_id: str | None
        ) -> dict[str, Any] | None:
            return await asyncio.to_thread(
                run_inactive_user_purge,
                repo,
                trigger=trigger,
                actor_user_id=actor_user_id,
            )

        self.register_job(
            _RegisteredJob(
                job_id="purge_inactive_users",
                description="Purge standard user accounts past the configured inactivity timeout and reclaim SQLite disk space.",
                runner=_purge_runner,
                is_enabled=lambda: bool(
                    settings.inactive_user_purge_days and settings.inactive_user_purge_days > 0
                ),
            )
        )

    def register_job(self, job: _RegisteredJob) -> None:
        self._jobs[job.job_id] = job
        self._locks.setdefault(job.job_id, asyncio.Lock())

    def _make_repo(self) -> CantinaRepository:
        return CantinaRepository(settings.db_path, media_dir=settings.media_dir)

    async def run_job(
        self,
        job_id: str,
        *,
        trigger: str = "manual",
        actor_user_id: str | None = None,
        repo: CantinaRepository | None = None,
    ) -> dict[str, Any] | None:
        job = self._jobs.get(job_id)
        if job is None:
            raise JobNotFoundError(f"Unknown Chloromancer job '{job_id}'.")
        lock = self._locks[job_id]
        if lock.locked():
            raise JobAlreadyRunningError(f"Chloromancer job '{job_id}' is already running.")
        async with lock:
            target_repo = repo or self._make_repo()
            return await job.runner(target_repo, trigger, actor_user_id)

    async def _loop(self) -> None:
        self._last_tick_monotonic = time.monotonic()
        while True:
            await asyncio.sleep(60.0)
            interval_seconds = max(5, int(settings.chloromancer_interval_minutes)) * 60.0
            now_mono = time.monotonic()
            if (now_mono - self._last_tick_monotonic) < interval_seconds:
                continue
            self._last_tick_monotonic = now_mono
            for job_id, job in list(self._jobs.items()):
                if not job.is_enabled():
                    continue
                if self._locks[job_id].locked():
                    continue
                try:
                    await self.run_job(job_id, trigger="scheduled")
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # noqa: BLE001
                    logger.warning("Chloromancer scheduled job '%s' failed: %s", job_id, exc)

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._loop(), name="chloromancer-scheduler")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None

    def get_status(self, repo: CantinaRepository, *, limit: int = 20) -> ChloromancerStatusResponse:
        interval_mins = int(settings.chloromancer_interval_minutes)
        jobs = [
            ChloromancerJobInfo(
                job_id=j.job_id,
                description=j.description,
                interval_minutes=interval_mins,
                enabled=j.is_enabled(),
                running=self._locks[j.job_id].locked(),
            )
            for j in self._jobs.values()
        ]
        recent = [
            ChloromancerRunRecord.model_validate(r)
            for r in repo.list_chloromancer_runs(limit=limit)
        ]
        return ChloromancerStatusResponse(
            scheduler_active=self._task is not None and not self._task.done(),
            interval_minutes=interval_mins,
            inactive_user_purge_days=settings.inactive_user_purge_days,
            jobs=jobs,
            recent_runs=recent,
        )


chloromancer_scheduler = ChloromancerScheduler()
