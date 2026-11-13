"""Chloromancer housekeeping run-history persistence."""

from __future__ import annotations

import json
import uuid
from typing import Any

from app.db.repos.base import utc_now_iso


class ChloromancerMixin:
    """Persistence helpers for Chloromancer background housekeeping runs."""

    def record_chloromancer_run(
        self,
        *,
        job_id: str,
        trigger: str,
        started_at: str,
        finished_at: str | None = None,
        status: str,
        items_affected: int = 0,
        details: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        run_id = f"chloro_{uuid.uuid4().hex[:12]}"
        fin = finished_at or utc_now_iso()
        details_obj = details or {}
        details_json = json.dumps(details_obj)
        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT INTO chloromancer_runs (
                    id, job_id, trigger, started_at, finished_at, status, items_affected, details_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    run_id,
                    job_id,
                    trigger,
                    started_at,
                    fin,
                    status,
                    int(items_affected),
                    details_json,
                ),
            )
            conn.execute(
                """
                DELETE FROM chloromancer_runs
                WHERE id NOT IN (
                    SELECT id FROM chloromancer_runs ORDER BY started_at DESC LIMIT 200
                )
                """
            )
            conn.commit()
        finally:
            conn.close()
        return {
            "id": run_id,
            "job_id": job_id,
            "trigger": trigger,
            "started_at": started_at,
            "finished_at": fin,
            "status": status,
            "items_affected": int(items_affected),
            "details": details_obj,
        }

    def list_chloromancer_runs(
        self, *, job_id: str | None = None, limit: int = 20
    ) -> list[dict[str, Any]]:
        safe_limit = max(1, min(100, int(limit)))
        conn = self._connect()
        try:
            if job_id:
                rows = conn.execute(
                    """
                    SELECT * FROM chloromancer_runs
                    WHERE job_id = ?
                    ORDER BY started_at DESC
                    LIMIT ?
                    """,
                    (job_id, safe_limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT * FROM chloromancer_runs
                    ORDER BY started_at DESC
                    LIMIT ?
                    """,
                    (safe_limit,),
                ).fetchall()
        finally:
            conn.close()
        results: list[dict[str, Any]] = []
        for r in rows:
            try:
                details = json.loads(r["details_json"] or "{}")
            except ValueError:
                details = {}
            results.append(
                {
                    "id": r["id"],
                    "job_id": r["job_id"],
                    "trigger": r["trigger"],
                    "started_at": r["started_at"],
                    "finished_at": r["finished_at"],
                    "status": r["status"],
                    "items_affected": int(r["items_affected"]),
                    "details": details,
                }
            )
        return results
