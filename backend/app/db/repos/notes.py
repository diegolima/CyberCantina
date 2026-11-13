"""User notes persistence and row mapping."""

from __future__ import annotations

import json
import sqlite3
import uuid
from app.schemas.note import UserNoteRecord
from app.db.repos.base import slugify_tag, utc_now_iso


class NotesMixin:
    """User notes persistence and row mapping."""

    def _row_to_user_note(self, r: sqlite3.Row) -> UserNoteRecord:
        return UserNoteRecord(
            id=r["id"],
            owner_id=r["owner_id"],
            title=r["title"],
            content=r["content"],
            tags=json.loads(r["tags_json"] or "[]"),
            is_starred=bool(r["is_starred"]),
            created_at=r["created_at"],
            updated_at=r["updated_at"],
        )

    def list_user_notes(self, owner_id: str) -> list[UserNoteRecord]:
        """List all notes belonging to the specified owner, including federated character creator notes."""
        conn = self._connect()
        try:
            rows = conn.execute(
                """
                SELECT id, owner_id, title, content, tags_json, is_starred, created_at, updated_at
                FROM user_notes
                WHERE owner_id = ?
                ORDER BY is_starred DESC, updated_at DESC
                """,
                (owner_id,),
            ).fetchall()
            user_notes = [self._row_to_user_note(r) for r in rows]

            # Model A: Federated virtual notes for characters with creator_notes
            char_rows = conn.execute(
                """
                SELECT id, name, creator_notes, tags_json, created_at
                FROM characters
                WHERE (owner_id = ? OR owner_id IS NULL)
                  AND creator_notes != ''
                  AND pending_deletion = 0
                ORDER BY created_at DESC
                """,
                (owner_id,),
            ).fetchall()

            virtual_notes: list[UserNoteRecord] = []
            for cr in char_rows:
                c_id = cr["id"]
                c_name = cr["name"]
                c_notes = cr["creator_notes"]
                char_tags = [
                    slugify_tag(t)
                    for t in (json.loads(cr["tags_json"] or "[]"))
                    if t and t.strip()
                ]
                norm_char_name = slugify_tag(c_name)
                note_tags = [norm_char_name, "creator-notes"]
                for t in char_tags:
                    if t not in note_tags:
                        note_tags.append(t)

                virtual_notes.append(
                    UserNoteRecord(
                        id=f"char_note_{c_id}",
                        owner_id=owner_id,
                        title=f"{c_name} — Creator Notes",
                        content=c_notes,
                        tags=note_tags,
                        is_starred=False,
                        is_character_note=True,
                        character_id=c_id,
                        created_at=cr["created_at"],
                        updated_at=cr["created_at"],
                    )
                )

            combined = user_notes + virtual_notes
            return sorted(
                combined,
                key=lambda n: (1 if n.is_starred else 0, n.updated_at),
                reverse=True,
            )
        finally:
            conn.close()

    def get_user_note(self, note_id: str, owner_id: str) -> UserNoteRecord | None:
        """Fetch a specific note if it belongs to the owner, supporting virtual character creator notes."""
        if note_id.startswith("char_note_"):
            char_id = note_id[len("char_note_") :]
            conn = self._connect()
            try:
                row = conn.execute(
                    """
                    SELECT id, name, creator_notes, tags_json, created_at
                    FROM characters
                    WHERE id = ? AND (owner_id = ? OR owner_id IS NULL) AND pending_deletion = 0
                    """,
                    (char_id, owner_id),
                ).fetchone()
                if not row or not row["creator_notes"]:
                    return None
                c_name = row["name"]
                char_tags = [
                    slugify_tag(t)
                    for t in (json.loads(row["tags_json"] or "[]"))
                    if t and t.strip()
                ]
                norm_char_name = slugify_tag(c_name)
                note_tags = [norm_char_name, "creator-notes"]
                for t in char_tags:
                    if t not in note_tags:
                        note_tags.append(t)
                return UserNoteRecord(
                    id=note_id,
                    owner_id=owner_id,
                    title=f"{c_name} — Creator Notes",
                    content=row["creator_notes"],
                    tags=note_tags,
                    is_starred=False,
                    is_character_note=True,
                    character_id=char_id,
                    created_at=row["created_at"],
                    updated_at=row["created_at"],
                )
            finally:
                conn.close()

        conn = self._connect()
        try:
            row = conn.execute(
                """
                SELECT id, owner_id, title, content, tags_json, is_starred, created_at, updated_at
                FROM user_notes
                WHERE id = ? AND owner_id = ?
                """,
                (note_id, owner_id),
            ).fetchone()
            return self._row_to_user_note(row) if row else None
        finally:
            conn.close()

    def create_user_note(
        self,
        *,
        owner_id: str,
        title: str = "",
        content: str = "",
        tags: list[str] | None = None,
        is_starred: bool = False,
        note_id: str | None = None,
    ) -> UserNoteRecord:
        """Create a new note for the specified owner."""
        nid = note_id or f"note_{uuid.uuid4().hex[:10]}"
        now = utc_now_iso()
        clean_tags = [t.strip().lstrip("#") for t in (tags or []) if t and t.strip()]
        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT INTO user_notes (id, owner_id, title, content, tags_json, is_starred, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    nid,
                    owner_id,
                    title.strip(),
                    content,
                    json.dumps(clean_tags),
                    1 if is_starred else 0,
                    now,
                    now,
                ),
            )
            conn.commit()
            return UserNoteRecord(
                id=nid,
                owner_id=owner_id,
                title=title.strip(),
                content=content,
                tags=clean_tags,
                is_starred=is_starred,
                created_at=now,
                updated_at=now,
            )
        finally:
            conn.close()

    def update_user_note(
        self,
        note_id: str,
        owner_id: str,
        *,
        title: str | None = None,
        content: str | None = None,
        tags: list[str] | None = None,
        is_starred: bool | None = None,
    ) -> UserNoteRecord | None:
        """Update an existing note belonging to the owner, supporting virtual character creator notes."""
        if note_id.startswith("char_note_"):
            char_id = note_id[len("char_note_") :]
            conn = self._connect()
            try:
                row = conn.execute(
                    "SELECT id, creator_notes FROM characters WHERE id = ? AND (owner_id = ? OR owner_id IS NULL) AND pending_deletion = 0",
                    (char_id, owner_id),
                ).fetchone()
                if not row:
                    return None
                new_content = row["creator_notes"] if content is None else content
                conn.execute(
                    "UPDATE characters SET creator_notes = ? WHERE id = ?",
                    (new_content, char_id),
                )
                conn.commit()
            finally:
                conn.close()
            return self.get_user_note(note_id, owner_id)

        existing = self.get_user_note(note_id, owner_id)
        if not existing:
            return None

        new_title = existing.title if title is None else title.strip()
        new_content = existing.content if content is None else content
        new_tags = (
            existing.tags
            if tags is None
            else [t.strip().lstrip("#") for t in tags if t and t.strip()]
        )
        new_starred = existing.is_starred if is_starred is None else is_starred
        now = utc_now_iso()

        conn = self._connect()
        try:
            conn.execute(
                """
                UPDATE user_notes
                SET title = ?, content = ?, tags_json = ?, is_starred = ?, updated_at = ?
                WHERE id = ? AND owner_id = ?
                """,
                (
                    new_title,
                    new_content,
                    json.dumps(new_tags),
                    1 if new_starred else 0,
                    now,
                    note_id,
                    owner_id,
                ),
            )
            conn.commit()
            return UserNoteRecord(
                id=note_id,
                owner_id=owner_id,
                title=new_title,
                content=new_content,
                tags=new_tags,
                is_starred=new_starred,
                created_at=existing.created_at,
                updated_at=now,
            )
        finally:
            conn.close()

    def delete_user_note(self, note_id: str, owner_id: str) -> bool:
        """Delete an existing note belonging to the owner. Returns True if deleted, False if not found."""
        if note_id.startswith("char_note_"):
            char_id = note_id[len("char_note_") :]
            conn = self._connect()
            try:
                cursor = conn.execute(
                    "UPDATE characters SET creator_notes = '' WHERE id = ? AND (owner_id = ? OR owner_id IS NULL)",
                    (char_id, owner_id),
                )
                conn.commit()
                return cursor.rowcount > 0
            finally:
                conn.close()

        conn = self._connect()
        try:
            cursor = conn.execute(
                "DELETE FROM user_notes WHERE id = ? AND owner_id = ?",
                (note_id, owner_id),
            )
            conn.commit()
            return cursor.rowcount > 0
        finally:
            conn.close()
