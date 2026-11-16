"""Admin communication messages persistence and lifecycle queries."""

from __future__ import annotations

import uuid
from typing import Any, Literal

from app.db.repos.base import utc_now_iso

_URGENCY_ORDER_SQL = (
    "CASE urgency WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END"
)


def _derive_message_status(
    *,
    deleted_at: str | None,
    starts_at: str | None,
    expires_at: str | None,
    now_iso: str,
) -> Literal["live", "scheduled", "expired", "deleted"]:
    if deleted_at is not None:
        return "deleted"
    if expires_at is not None and expires_at <= now_iso:
        return "expired"
    if starts_at is not None and starts_at > now_iso:
        return "scheduled"
    return "live"


def _row_to_admin_message(row: Any, now_iso: str) -> dict[str, Any]:
    deleted_at = row["deleted_at"]
    starts_at = row["starts_at"]
    expires_at = row["expires_at"]
    return {
        "id": row["id"],
        "revision": int(row["revision"]),
        "placement": row["placement"],
        "title": row["title"],
        "message": row["message"],
        "urgency": row["urgency"],
        "dismissable": bool(row["dismissable"]),
        "starts_at": starts_at,
        "expires_at": expires_at,
        "sort_order": int(row["sort_order"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "deleted_at": deleted_at,
        "status": _derive_message_status(
            deleted_at=deleted_at,
            starts_at=starts_at,
            expires_at=expires_at,
            now_iso=now_iso,
        ),
    }


class AdminMessagesMixin:
    """Persistence helpers for admin communication messages."""

    def list_active_admin_messages(self, now_iso: str | None = None) -> list[dict[str, Any]]:
        """List non-deleted, non-expired messages (including future-scheduled) ordered by urgency & sort_order."""
        now = now_iso or utc_now_iso()
        conn = self._connect()
        try:
            rows = conn.execute(
                f"""
                SELECT * FROM admin_messages
                WHERE deleted_at IS NULL
                  AND (expires_at IS NULL OR expires_at > ?)
                ORDER BY {_URGENCY_ORDER_SQL}, sort_order ASC, created_at ASC
                """,
                (now,),
            ).fetchall()
        finally:
            conn.close()
        return [_row_to_admin_message(r, now) for r in rows]

    def list_archived_admin_messages(self, now_iso: str | None = None) -> list[dict[str, Any]]:
        """List soft-deleted and expired messages, newest archive event first."""
        now = now_iso or utc_now_iso()
        conn = self._connect()
        try:
            rows = conn.execute(
                """
                SELECT * FROM admin_messages
                WHERE deleted_at IS NOT NULL
                   OR (expires_at IS NOT NULL AND expires_at <= ?)
                ORDER BY COALESCE(deleted_at, expires_at) DESC, updated_at DESC
                """,
                (now,),
            ).fetchall()
        finally:
            conn.close()
        return [_row_to_admin_message(r, now) for r in rows]

    def list_visible_admin_messages(
        self,
        placement_target: Literal["login", "home"],
        now_iso: str | None = None,
    ) -> list[dict[str, Any]]:
        """List currently live messages for 'login' or 'home' (including 'both'), ordered by urgency & sort_order."""
        now = now_iso or utc_now_iso()
        conn = self._connect()
        try:
            rows = conn.execute(
                f"""
                SELECT * FROM admin_messages
                WHERE deleted_at IS NULL
                  AND placement IN (?, 'both')
                  AND (starts_at IS NULL OR starts_at <= ?)
                  AND (expires_at IS NULL OR expires_at > ?)
                ORDER BY {_URGENCY_ORDER_SQL}, sort_order ASC, created_at ASC
                """,
                (placement_target, now, now),
            ).fetchall()
        finally:
            conn.close()
        return [_row_to_admin_message(r, now) for r in rows]

    def get_admin_message(
        self, message_id: str, now_iso: str | None = None
    ) -> dict[str, Any] | None:
        """Fetch a single admin message by ID."""
        now = now_iso or utc_now_iso()
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT * FROM admin_messages WHERE id = ?",
                (message_id,),
            ).fetchone()
        finally:
            conn.close()
        if not row:
            return None
        return _row_to_admin_message(row, now)

    def create_admin_message(
        self,
        *,
        placement: str,
        title: str,
        message: str,
        urgency: str = "info",
        dismissable: bool = True,
        starts_at: str | None = None,
        expires_at: str | None = None,
        now_iso: str | None = None,
    ) -> dict[str, Any]:
        """Insert a new admin message at the end of its urgency group with revision=1."""
        now = now_iso or utc_now_iso()
        msg_id = f"msg_{uuid.uuid4().hex}"
        conn = self._connect()
        try:
            max_row = conn.execute(
                """
                SELECT COALESCE(MAX(sort_order), -1) AS max_order
                FROM admin_messages
                WHERE deleted_at IS NULL
                  AND (expires_at IS NULL OR expires_at > ?)
                  AND urgency = ?
                """,
                (now, urgency),
            ).fetchone()
            next_order = int(max_row["max_order"]) + 1 if max_row else 0
            conn.execute(
                """
                INSERT INTO admin_messages (
                    id, revision, placement, title, message, urgency,
                    dismissable, starts_at, expires_at, sort_order,
                    created_at, updated_at, deleted_at
                )
                VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
                """,
                (
                    msg_id,
                    placement,
                    title,
                    message,
                    urgency,
                    1 if dismissable else 0,
                    starts_at,
                    expires_at,
                    next_order,
                    now,
                    now,
                ),
            )
            conn.commit()
            created = conn.execute(
                "SELECT * FROM admin_messages WHERE id = ?",
                (msg_id,),
            ).fetchone()
        finally:
            conn.close()
        return _row_to_admin_message(created, now)

    def update_admin_message(
        self,
        message_id: str,
        *,
        placement: str,
        title: str,
        message: str,
        urgency: str,
        dismissable: bool,
        starts_at: str | None,
        expires_at: str | None,
        now_iso: str | None = None,
    ) -> dict[str, Any] | None:
        """Update an active or archived admin message, bumping revision and restoring if archived."""
        now = now_iso or utc_now_iso()
        conn = self._connect()
        try:
            existing = conn.execute(
                "SELECT * FROM admin_messages WHERE id = ?",
                (message_id,),
            ).fetchone()
            if not existing:
                return None

            was_archived = (
                existing["deleted_at"] is not None
                or (existing["expires_at"] is not None and existing["expires_at"] <= now)
            )
            urgency_changed = existing["urgency"] != urgency

            if was_archived or urgency_changed:
                max_row = conn.execute(
                    """
                    SELECT COALESCE(MAX(sort_order), -1) AS max_order
                    FROM admin_messages
                    WHERE deleted_at IS NULL
                      AND (expires_at IS NULL OR expires_at > ?)
                      AND urgency = ?
                      AND id != ?
                    """,
                    (now, urgency, message_id),
                ).fetchone()
                sort_order = int(max_row["max_order"]) + 1 if max_row else 0
            else:
                sort_order = int(existing["sort_order"])

            new_revision = int(existing["revision"]) + 1
            conn.execute(
                """
                UPDATE admin_messages
                SET revision = ?,
                    placement = ?,
                    title = ?,
                    message = ?,
                    urgency = ?,
                    dismissable = ?,
                    starts_at = ?,
                    expires_at = ?,
                    sort_order = ?,
                    updated_at = ?,
                    deleted_at = NULL
                WHERE id = ?
                """,
                (
                    new_revision,
                    placement,
                    title,
                    message,
                    urgency,
                    1 if dismissable else 0,
                    starts_at,
                    expires_at,
                    sort_order,
                    now,
                    message_id,
                ),
            )
            conn.commit()
            updated = conn.execute(
                "SELECT * FROM admin_messages WHERE id = ?",
                (message_id,),
            ).fetchone()
        finally:
            conn.close()
        return _row_to_admin_message(updated, now)

    def soft_delete_admin_message(
        self, message_id: str, now_iso: str | None = None
    ) -> bool:
        """Soft-delete an admin message by setting deleted_at."""
        now = now_iso or utc_now_iso()
        conn = self._connect()
        try:
            cur = conn.execute(
                """
                UPDATE admin_messages
                SET deleted_at = ?, updated_at = ?
                WHERE id = ? AND deleted_at IS NULL
                """,
                (now, now, message_id),
            )
            conn.commit()
            return cur.rowcount > 0
        finally:
            conn.close()

    def reorder_admin_messages(
        self,
        *,
        urgency: str,
        ordered_ids: list[str],
        now_iso: str | None = None,
    ) -> list[dict[str, Any]]:
        """Persist sort_order within a single urgency group without changing message revision."""
        if len(ordered_ids) != len(set(ordered_ids)):
            raise ValueError("Duplicate message IDs in reorder payload.")
        now = now_iso or utc_now_iso()
        conn = self._connect()
        try:
            active_rows = conn.execute(
                """
                SELECT id FROM admin_messages
                WHERE deleted_at IS NULL
                  AND (expires_at IS NULL OR expires_at > ?)
                  AND urgency = ?
                ORDER BY sort_order ASC, created_at ASC
                """,
                (now, urgency),
            ).fetchall()
            active_ids = [r["id"] for r in active_rows]
            active_set = set(active_ids)
            for mid in ordered_ids:
                if mid not in active_set:
                    raise ValueError(
                        f"Message '{mid}' is not an active '{urgency}' message."
                    )

            remaining = [mid for mid in active_ids if mid not in set(ordered_ids)]
            final_order = list(ordered_ids) + remaining
            for idx, mid in enumerate(final_order):
                conn.execute(
                    "UPDATE admin_messages SET sort_order = ? WHERE id = ?",
                    (idx, mid),
                )
            conn.commit()
        finally:
            conn.close()
        return self.list_active_admin_messages(now)

    def purge_expired_and_deleted_admin_messages(
        self, cutoff_iso: str
    ) -> dict[str, int]:
        """Permanently delete messages soft-deleted or expired prior to cutoff_iso."""
        conn = self._connect()
        try:
            rows = conn.execute(
                """
                SELECT id, deleted_at, expires_at
                FROM admin_messages
                WHERE (deleted_at IS NOT NULL AND deleted_at < ?)
                   OR (expires_at IS NOT NULL AND expires_at < ?)
                """,
                (cutoff_iso, cutoff_iso),
            ).fetchall()
            if not rows:
                return {"total_purged": 0, "deleted_purged": 0, "expired_purged": 0}

            deleted_purged = sum(1 for r in rows if r["deleted_at"] is not None)
            expired_purged = sum(
                1
                for r in rows
                if r["deleted_at"] is None and r["expires_at"] is not None
            )
            ids = [r["id"] for r in rows]
            placeholders = ", ".join("?" for _ in ids)
            conn.execute(
                f"DELETE FROM admin_messages WHERE id IN ({placeholders})",
                ids,
            )
            conn.commit()
            return {
                "total_purged": len(ids),
                "deleted_purged": deleted_purged,
                "expired_purged": expired_purged,
            }
        finally:
            conn.close()
