"""Branch-aware SQLite persistence for out-of-character Neuromancer GM Talk messages."""

from __future__ import annotations

import json
import sqlite3
import uuid
from typing import Any

from app.db.repos.base import utc_now_iso
from app.schemas.gm import GmChatMessage, GmMentionRef, GmSourceRef


def _row_to_gm_message(row: sqlite3.Row) -> GmChatMessage:
    """Convert a SQLite row into a validated GmChatMessage DTO."""
    mentions_raw = json.loads(row["mentions_json"] or "[]")
    sources_raw = json.loads(row["sources_json"] or "[]")
    mentions: list[GmMentionRef] = []
    for item in mentions_raw if isinstance(mentions_raw, list) else []:
        try:
            mentions.append(GmMentionRef.model_validate(item))
        except Exception:
            continue
    sources: list[GmSourceRef] = []
    for item in sources_raw if isinstance(sources_raw, list) else []:
        try:
            sources.append(GmSourceRef.model_validate(item))
        except Exception:
            continue
    return GmChatMessage(
        id=str(row["id"]),
        campaign_id=str(row["campaign_id"]),
        anchor_turn_id=row["anchor_turn_id"],
        role=row["role"],
        content=str(row["content"]),
        mentions=mentions,
        sources=sources,
        created_at=str(row["created_at"]),
    )


def _branch_filter_clause(valid_turn_ids: set[str] | list[str]) -> tuple[str, list[Any]]:
    """Build SQL WHERE clause matching root (NULL) or active-branch anchor_turn_id rows."""
    turn_ids = [str(tid) for tid in valid_turn_ids if tid]
    if not turn_ids:
        return "anchor_turn_id IS NULL", []
    placeholders = ",".join("?" for _ in turn_ids)
    return f"(anchor_turn_id IS NULL OR anchor_turn_id IN ({placeholders}))", turn_ids


class GmChatMixin:
    """Repository mixin for branch-safe `gm_chat_messages` persistence."""

    def list_gm_messages_for_branch(
        self,
        campaign_id: str,
        valid_turn_ids: set[str] | list[str],
    ) -> list[GmChatMessage]:
        """List GM Talk messages visible along the active branch in chronological order."""
        clause, params = _branch_filter_clause(valid_turn_ids)
        conn = self._connect()
        try:
            rows = conn.execute(
                f"""
                SELECT id, campaign_id, anchor_turn_id, role, content, mentions_json, sources_json, created_at
                FROM gm_chat_messages
                WHERE campaign_id = ? AND {clause}
                ORDER BY created_at ASC, rowid ASC
                """,
                [campaign_id, *params],
            ).fetchall()
            return [_row_to_gm_message(r) for r in rows]
        finally:
            conn.close()

    def append_gm_message_pair(
        self,
        campaign_id: str,
        anchor_turn_id: str | None,
        user_content: str,
        user_mentions: list[GmMentionRef],
        assistant_content: str,
        sources: list[GmSourceRef],
    ) -> tuple[GmChatMessage, GmChatMessage]:
        """Persist a completed user + Neuromancer message pair atomically on the active branch."""
        user_id = f"gm_{uuid.uuid4().hex[:12]}"
        asst_id = f"gm_{uuid.uuid4().hex[:12]}"
        user_ts = utc_now_iso()
        asst_ts = utc_now_iso()
        if asst_ts < user_ts:
            asst_ts = user_ts
        mentions_json = json.dumps([m.model_dump() for m in user_mentions])
        sources_json = json.dumps([s.model_dump() for s in sources])

        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT INTO gm_chat_messages (
                    id, campaign_id, anchor_turn_id, role, content, mentions_json, sources_json, created_at
                ) VALUES (?, ?, ?, 'user', ?, ?, '[]', ?)
                """,
                (user_id, campaign_id, anchor_turn_id, user_content, mentions_json, user_ts),
            )
            conn.execute(
                """
                INSERT INTO gm_chat_messages (
                    id, campaign_id, anchor_turn_id, role, content, mentions_json, sources_json, created_at
                ) VALUES (?, ?, ?, 'assistant', ?, '[]', ?, ?)
                """,
                (asst_id, campaign_id, anchor_turn_id, assistant_content, sources_json, asst_ts),
            )
            conn.commit()
        finally:
            conn.close()

        return (
            GmChatMessage(
                id=user_id,
                campaign_id=campaign_id,
                anchor_turn_id=anchor_turn_id,
                role="user",
                content=user_content,
                mentions=list(user_mentions),
                sources=[],
                created_at=user_ts,
            ),
            GmChatMessage(
                id=asst_id,
                campaign_id=campaign_id,
                anchor_turn_id=anchor_turn_id,
                role="assistant",
                content=assistant_content,
                mentions=[],
                sources=list(sources),
                created_at=asst_ts,
            ),
        )

    def clear_gm_messages_for_branch(
        self,
        campaign_id: str,
        valid_turn_ids: set[str] | list[str],
    ) -> int:
        """Delete GM Talk messages visible on the active branch without disturbing sibling branches."""
        clause, params = _branch_filter_clause(valid_turn_ids)
        conn = self._connect()
        try:
            cur = conn.execute(
                f"DELETE FROM gm_chat_messages WHERE campaign_id = ? AND {clause}",
                [campaign_id, *params],
            )
            conn.commit()
            return int(cur.rowcount or 0)
        finally:
            conn.close()

    def list_all_gm_messages(self, campaign_id: str) -> list[dict[str, Any]]:
        """Return raw GM Talk rows across all branches of a campaign for `.zcc` v2 export."""
        conn = self._connect()
        try:
            rows = conn.execute(
                """
                SELECT id, campaign_id, anchor_turn_id, role, content, mentions_json, sources_json, created_at
                FROM gm_chat_messages
                WHERE campaign_id = ?
                ORDER BY created_at ASC, rowid ASC
                """,
                (campaign_id,),
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()
