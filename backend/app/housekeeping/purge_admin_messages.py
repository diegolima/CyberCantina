"""Chloromancer housekeeping job to purge deleted and expired admin messages."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from app.db.repos.base import utc_now_iso
from app.db.repository import CantinaRepository
from app.security.log_sanitize import sanitize_log_value

logger = logging.getLogger("cybercantina.housekeeping.purge_admin_messages")

ADMIN_MESSAGE_RETENTION_DAYS = 7


def run_admin_messages_purge(
    repo: CantinaRepository,
    *,
    trigger: str,
    actor_user_id: str | None = None,
    retention_days: int = ADMIN_MESSAGE_RETENTION_DAYS,
) -> dict[str, Any]:
    """Hard-delete admin_messages soft-deleted or expired more than ``retention_days`` ago."""
    started_at = utc_now_iso()
    cutoff_dt = datetime.now(timezone.utc) - timedelta(days=max(1, int(retention_days)))
    cutoff_iso = cutoff_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    try:
        counts = repo.purge_expired_and_deleted_admin_messages(cutoff_iso)
        total = int(counts["total_purged"])
        if total > 0:
            logger.info(
                "Chloromancer purged %d admin message(s) (deleted=%d, expired=%d, cutoff=%s, actor=%s)",
                total,
                counts["deleted_purged"],
                counts["expired_purged"],
                cutoff_iso,
                sanitize_log_value(actor_user_id or "scheduler"),
            )
        return repo.record_chloromancer_run(
            job_id="purge_admin_messages",
            trigger=trigger,
            started_at=started_at,
            status="ok",
            items_affected=total,
            details={
                "retention_days": int(retention_days),
                "cutoff_at": cutoff_iso,
                "deleted_purged": counts["deleted_purged"],
                "expired_purged": counts["expired_purged"],
            },
        )
    except Exception as exc:  # noqa: BLE001
        err_text = sanitize_log_value(exc)
        logger.warning("Chloromancer admin message purge error: %s", err_text)
        return repo.record_chloromancer_run(
            job_id="purge_admin_messages",
            trigger=trigger,
            started_at=started_at,
            status="error",
            items_affected=0,
            details={
                "retention_days": int(retention_days),
                "cutoff_at": cutoff_iso,
                "errors": [err_text],
            },
        )
