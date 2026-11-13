"""Deterministic inactive-user purge job and dry-run preview for Chloromancer."""

from __future__ import annotations

import logging
import shutil
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from app.config import settings
from app.db.repos.base import utc_now_iso
from app.db.repository import CantinaRepository
from app.schemas.housekeeping import PurgeCandidatePreview, PurgePreviewResponse
from app.security.log_sanitize import sanitize_log_value
from app.security.media_path import PathTraversalError, safe_resolve_character_media_dir

logger = logging.getLogger("cybercantina.housekeeping.purge_inactive")

ORPHAN_MEDIA_GRACE_SECONDS = 24 * 60 * 60


def _dir_bytes(media_dir: str, character_id: str) -> int:
    try:
        c_dir = safe_resolve_character_media_dir(media_dir, character_id)
    except (PathTraversalError, ValueError):
        return 0
    if not c_dir.is_dir():
        return 0
    total = 0
    for item in c_dir.rglob("*"):
        if item.is_file():
            try:
                total += item.stat().st_size
            except OSError:
                continue
    return total


def _parse_utc_iso(ts: str) -> datetime:
    try:
        return datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(timezone.utc)


def compute_purge_preview(
    repo: CantinaRepository,
    *,
    days_override: int | None = None,
    exclude_user_id: str | None = None,
) -> PurgePreviewResponse:
    """Return a non-destructive dry-run preview of standard users eligible for inactivity purge."""
    days = days_override if days_override is not None else settings.inactive_user_purge_days
    if days is None or days <= 0:
        return PurgePreviewResponse(days_threshold=None, cutoff_at=None)

    now_dt = datetime.now(timezone.utc)
    cutoff_dt = now_dt - timedelta(days=int(days))
    cutoff_iso = cutoff_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    raw_candidates = repo.list_inactive_purge_candidates(
        cutoff_iso, exclude_user_id=exclude_user_id
    )
    previews: list[PurgeCandidatePreview] = []
    total_chars = 0
    total_worlds = 0
    total_campaigns = 0
    total_media_bytes = 0

    for cand in raw_candidates:
        media_bytes = sum(_dir_bytes(repo.media_dir, cid) for cid in cand["character_ids"])
        try:
            active_dt = _parse_utc_iso(cand["effective_last_active_at"])
            days_inactive = max(0, int((now_dt - active_dt).total_seconds() // 86400))
        except Exception:
            days_inactive = int(days)

        total_chars += cand["character_count"]
        total_worlds += cand["world_count"]
        total_campaigns += cand["campaign_count"]
        total_media_bytes += media_bytes

        previews.append(
            PurgeCandidatePreview(
                user_id=cand["user_id"],
                username=cand["username"],
                display_name=cand["display_name"],
                created_at=cand["created_at"],
                last_login_at=cand["last_login_at"],
                last_active_at=cand["effective_last_active_at"],
                days_inactive=days_inactive,
                character_count=cand["character_count"],
                world_count=cand["world_count"],
                campaign_count=cand["campaign_count"],
                media_bytes=media_bytes,
            )
        )

    return PurgePreviewResponse(
        days_threshold=int(days),
        cutoff_at=cutoff_iso,
        candidates=previews,
        total_users=len(previews),
        total_characters=total_chars,
        total_worlds=total_worlds,
        total_campaigns=total_campaigns,
        total_media_bytes=total_media_bytes,
    )


def _sweep_orphan_media_dirs(repo: CantinaRepository) -> int:
    """Remove unreferenced character media directories older than ORPHAN_MEDIA_GRACE_SECONDS."""
    characters_root = Path(repo.media_dir) / "characters"
    if not characters_root.is_dir():
        return 0
    active_ids = repo.list_active_media_character_ids()
    now_epoch = time.time()
    removed = 0
    for entry in characters_root.iterdir():
        if not entry.is_dir():
            continue
        char_id = entry.name
        if char_id in active_ids:
            continue
        try:
            age_seconds = now_epoch - entry.stat().st_mtime
        except OSError:
            continue
        if age_seconds < ORPHAN_MEDIA_GRACE_SECONDS:
            continue
        try:
            safe_dir = safe_resolve_character_media_dir(repo.media_dir, char_id)
        except (PathTraversalError, ValueError):
            continue
        shutil.rmtree(safe_dir, ignore_errors=True)
        removed += 1
    return removed


def run_inactive_user_purge(
    repo: CantinaRepository,
    *,
    trigger: str,
    actor_user_id: str | None = None,
    days_override: int | None = None,
) -> dict[str, Any] | None:
    """Purge standard accounts past the inactivity threshold, sweep orphan media, and VACUUM if needed.

    Returns the recorded run dict, or ``None`` when a scheduled tick skips a disabled policy.
    """
    started_at = utc_now_iso()
    days = days_override if days_override is not None else settings.inactive_user_purge_days
    if days is None or days <= 0:
        if trigger == "scheduled":
            return None
        return repo.record_chloromancer_run(
            job_id="purge_inactive_users",
            trigger=trigger,
            started_at=started_at,
            status="skipped",
            items_affected=0,
            details={"reason": "Inactive user purge timeout is disabled."},
        )

    cutoff_dt = datetime.now(timezone.utc) - timedelta(days=int(days))
    cutoff_iso = cutoff_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    candidates = repo.list_inactive_purge_candidates(
        cutoff_iso, exclude_user_id=actor_user_id
    )

    purged_usernames: list[str] = []
    errors: list[str] = []
    for cand in candidates:
        uid = cand["user_id"]
        uname = sanitize_log_value(cand["username"])
        try:
            repo.delete_user(uid)
            purged_usernames.append(uname)
            logger.info(
                "Chloromancer purged inactive user '%s' (id=%s, last_active=%s)",
                uname,
                sanitize_log_value(uid),
                sanitize_log_value(cand["effective_last_active_at"]),
            )
        except Exception as exc:  # noqa: BLE001
            err_msg = f"{uname}: {sanitize_log_value(exc)}"
            errors.append(err_msg)
            logger.warning("Chloromancer failed deleting user '%s': %s", uname, sanitize_log_value(exc))

    orphan_dirs_removed = 0
    try:
        orphan_dirs_removed = _sweep_orphan_media_dirs(repo)
    except Exception as exc:  # noqa: BLE001
        errors.append(f"orphan_media_sweep: {sanitize_log_value(exc)}")
        logger.warning("Chloromancer orphan media sweep error: %s", sanitize_log_value(exc))

    vacuum_ran = False
    bytes_reclaimed = 0
    if purged_usernames:
        try:
            before_b, after_b = repo.vacuum_and_checkpoint_wal()
            vacuum_ran = True
            bytes_reclaimed = max(0, before_b - after_b)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"vacuum: {sanitize_log_value(exc)}")
            logger.warning("Chloromancer SQLite VACUUM error: %s", sanitize_log_value(exc))

    status = "error" if (errors and not purged_usernames) else "ok"
    details: dict[str, Any] = {
        "days_threshold": int(days),
        "cutoff_at": cutoff_iso,
        "purged_usernames": purged_usernames,
        "orphan_media_dirs_removed": orphan_dirs_removed,
        "vacuum_ran": vacuum_ran,
        "bytes_reclaimed": bytes_reclaimed,
    }
    if errors:
        details["errors"] = errors

    return repo.record_chloromancer_run(
        job_id="purge_inactive_users",
        trigger=trigger,
        started_at=started_at,
        status=status,
        items_affected=len(purged_usernames),
        details=details,
    )
