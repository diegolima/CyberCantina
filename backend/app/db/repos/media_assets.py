"""Unified media asset persistence, 1:1 linked-video lifecycle, hydration, and admin purge."""

from __future__ import annotations

from collections.abc import Iterable
import json
import logging
import re
import sqlite3
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from app.db.repos.base import (
    _CHARACTER_MEDIA_URL_RE,
    _PUBLIC_CHARACTER_MEDIA_URL_RE,
    build_world_media_url,
    utc_now_iso,
)
from app.schemas.character import CharacterRecord, GalleryImage
from app.schemas.persona import PersonaRecord
from app.security.log_sanitize import sanitize_log_value
from app.security.media_path import (
    PathTraversalError,
    safe_resolve_asset_file_path,
    safe_resolve_world_media_file_path,
)

logger = logging.getLogger("cybercantina.db.media_assets")

_ASSET_URL_RE = re.compile(r"/api/media/assets/([a-zA-Z0-9_-]+)")
_PERSONA_MEDIA_URL_RE = re.compile(
    r"/api/media/personas/([^/]+)/(portraits|gallery)/([^/?#]+)"
)
_WORLD_MEDIA_URL_RE = re.compile(r"/api/media/worlds/(images|audio)/([^/?#]+)")


def build_asset_url(asset_id: str) -> str:
    """Return canonical unified API URL for a media asset."""
    return f"/api/media/assets/{asset_id}"


def extract_asset_id_from_url(url: str | None) -> str | None:
    """Extract asset_id from a unified /api/media/assets/{asset_id} URL."""
    if not isinstance(url, str):
        return None
    m = _ASSET_URL_RE.search(url.strip())
    return m.group(1) if m else None


def asset_category_dir(media_type: str) -> str:
    """Map logical media_type ('image' | 'video' | 'audio') to disk directory name."""
    if media_type == "video":
        return "videos"
    if media_type == "audio":
        return "audio"
    return "images"


def _collect_asset_ids_from_char_row(
    portraits_raw: Any, gallery_raw: Any
) -> set[str]:
    ids: set[str] = set()
    if isinstance(portraits_raw, dict):
        for url in portraits_raw.values():
            aid = extract_asset_id_from_url(url if isinstance(url, str) else None)
            if aid:
                ids.add(aid)
    if isinstance(gallery_raw, list):
        for item in gallery_raw:
            if not isinstance(item, dict):
                continue
            aid = extract_asset_id_from_url(item.get("url"))
            if aid:
                ids.add(aid)
            elif isinstance(item.get("id"), str) and item["id"]:
                # Only count legacy IDs if they exist in media_assets later
                pass
    return ids


def _collect_asset_ids_from_persona_row(
    portrait_url: str | None, gallery_raw: Any
) -> set[str]:
    ids: set[str] = set()
    aid = extract_asset_id_from_url(portrait_url)
    if aid:
        ids.add(aid)
    if isinstance(gallery_raw, list):
        for item in gallery_raw:
            if not isinstance(item, dict):
                continue
            g_aid = extract_asset_id_from_url(item.get("url"))
            if g_aid:
                ids.add(g_aid)
    return ids


class MediaAssetsMixin:
    """Unified shared media asset store across Worlds, Characters, and Personas."""

    def resolve_asset_disk_path(self, asset_row: sqlite3.Row | dict[str, Any]) -> Path:
        """Resolve an asset's physical file path within media_dir, including legacy/public fallback."""
        m_type = str(asset_row["media_type"])
        filename = str(asset_row["filename"])
        cat = asset_category_dir(m_type)
        primary = safe_resolve_asset_file_path(self.media_dir, cat, filename)
        if primary.is_file():
            return primary
        # Fallback for built-in showcase world assets and pre-migration world_media rows
        if str(asset_row["entity_scope"]) == "world" and cat in ("images", "audio"):
            legacy_world = safe_resolve_world_media_file_path(self.media_dir, cat, filename)
            if legacy_world.is_file():
                return legacy_world
        return primary

    def _asset_file_exists(self, asset_row: sqlite3.Row | dict[str, Any]) -> bool:
        try:
            return self.resolve_asset_disk_path(asset_row).is_file()
        except (PathTraversalError, ValueError, KeyError):
            return False

    def _unlink_asset_file(self, asset_row: sqlite3.Row | dict[str, Any]) -> None:
        m_type = str(asset_row["media_type"])
        filename = str(asset_row["filename"])
        cat = asset_category_dir(m_type)
        for resolver in (
            lambda: safe_resolve_asset_file_path(self.media_dir, cat, filename),
            lambda: (
                safe_resolve_world_media_file_path(self.media_dir, cat, filename)
                if str(asset_row["entity_scope"]) == "world" and cat in ("images", "audio")
                else None
            ),
        ):
            try:
                fpath = resolver()
                if fpath is not None and fpath.is_file():
                    fpath.unlink(missing_ok=True)
            except (PathTraversalError, ValueError, OSError) as exc:
                logger.warning(
                    "Skipped unlinking asset '%s': %s",
                    sanitize_log_value(filename),
                    sanitize_log_value(exc),
                )

    @staticmethod
    def build_public_or_asset_url(asset_row: sqlite3.Row | dict[str, Any]) -> str:
        """Preserve /api/media/worlds/images/pub_v1_* for seeded public world art; use /api/media/assets/{id} otherwise."""
        is_pub = bool(asset_row["is_public"])
        seed_key = asset_row["seed_key"] if "seed_key" in asset_row.keys() else None
        if (
            is_pub
            and seed_key
            and str(asset_row["entity_scope"]) == "world"
            and str(asset_row["media_type"]) == "image"
        ):
            return build_world_media_url(str(asset_row["media_type"]), str(asset_row["filename"]))
        return build_asset_url(str(asset_row["id"]))

    def register_media_asset(
        self,
        *,
        asset_id: str,
        owner_id: str | None,
        entity_scope: str,
        media_type: str,
        role: str,
        filename: str,
        mime_type: str,
        byte_size: int,
        label: str = "",
        is_public: bool = False,
        seed_key: str | None = None,
        parent_image_id: str | None = None,
        duration_ms: int | None = None,
        width: int | None = None,
        height: int | None = None,
        conn: sqlite3.Connection | None = None,
    ) -> dict[str, Any]:
        """Insert a media_assets row and return it as a dict."""
        now = utc_now_iso()
        own_conn = conn is None
        if conn is None:
            conn = self._connect()
        try:
            conn.execute(
                """
                INSERT INTO media_assets (
                    id, owner_id, entity_scope, media_type, role, filename, label,
                    mime_type, byte_size, is_public, seed_key, parent_image_id,
                    duration_ms, width, height, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    asset_id,
                    owner_id,
                    entity_scope,
                    media_type,
                    role,
                    filename,
                    label.strip(),
                    mime_type,
                    int(byte_size),
                    1 if is_public else 0,
                    seed_key,
                    parent_image_id,
                    duration_ms,
                    width,
                    height,
                    now,
                ),
            )
            if own_conn:
                conn.commit()
            row = conn.execute("SELECT * FROM media_assets WHERE id = ?", (asset_id,)).fetchone()
            return dict(row) if row else {}
        finally:
            if own_conn:
                conn.close()

    def get_media_asset(self, asset_id: str) -> dict[str, Any] | None:
        conn = self._connect()
        try:
            row = conn.execute("SELECT * FROM media_assets WHERE id = ?", (asset_id,)).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def get_linked_video_for_image(self, image_asset_id: str) -> dict[str, Any] | None:
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT * FROM media_assets WHERE parent_image_id = ? AND media_type = 'video'",
                (image_asset_id,),
            ).fetchone()
            if not row or not self._asset_file_exists(row):
                return None
            return dict(row)
        finally:
            conn.close()

    def get_linked_videos_map(
        self, conn: sqlite3.Connection, image_asset_ids: list[str] | set[str]
    ) -> dict[str, dict[str, Any]]:
        """Batch-fetch linked video assets keyed by parent_image_id (omitting missing disk files)."""
        ids = [aid for aid in image_asset_ids if aid]
        if not ids:
            return {}
        placeholders = ",".join("?" for _ in ids)
        rows = conn.execute(
            f"""
            SELECT * FROM media_assets
            WHERE parent_image_id IN ({placeholders}) AND media_type = 'video'
            """,
            ids,
        ).fetchall()
        out: dict[str, dict[str, Any]] = {}
        for r in rows:
            if self._asset_file_exists(r):
                out[str(r["parent_image_id"])] = dict(r)
        return out

    def attach_or_replace_linked_video(
        self,
        parent_image_id: str,
        *,
        video_id: str,
        owner_id: str | None,
        entity_scope: str,
        filename: str,
        mime_type: str,
        byte_size: int,
        duration_ms: int | None = None,
        width: int | None = None,
        height: int | None = None,
        label: str = "",
    ) -> dict[str, Any] | None:
        """Swap or attach a 1:1 linked video for parent_image_id, returning replaced video metadata."""
        now = utc_now_iso()
        conn = self._connect()
        replaced: dict[str, Any] | None = None
        try:
            parent_row = conn.execute(
                "SELECT id, owner_id, entity_scope, media_type, is_public FROM media_assets WHERE id = ?",
                (parent_image_id,),
            ).fetchone()
            if not parent_row:
                raise KeyError(f"Parent media asset '{parent_image_id}' not found")
            if bool(parent_row["is_public"]):
                raise PermissionError("Built-in public media assets cannot be modified.")
            if str(parent_row["media_type"]) != "image" or str(parent_row["entity_scope"]) != entity_scope:
                raise ValueError("Target media asset is not a compatible image for this entity scope.")
            if owner_id is not None and parent_row["owner_id"] != owner_id:
                raise PermissionError("Unauthorized access to parent image asset.")

            old_row = conn.execute(
                "SELECT * FROM media_assets WHERE parent_image_id = ? AND media_type = 'video'",
                (parent_image_id,),
            ).fetchone()
            if old_row:
                if owner_id is not None and old_row["owner_id"] not in (None, owner_id):
                    raise PermissionError("Unauthorized access to existing linked video asset.")
                replaced = dict(old_row)
                conn.execute("DELETE FROM media_assets WHERE id = ?", (old_row["id"],))

            conn.execute(
                """
                INSERT INTO media_assets (
                    id, owner_id, entity_scope, media_type, role, filename, label,
                    mime_type, byte_size, is_public, seed_key, parent_image_id,
                    duration_ms, width, height, created_at
                )
                VALUES (?, ?, ?, 'video', 'linked_video', ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?, ?)
                """,
                (
                    video_id,
                    owner_id,
                    entity_scope,
                    filename,
                    label.strip(),
                    mime_type,
                    int(byte_size),
                    parent_image_id,
                    duration_ms,
                    width,
                    height,
                    now,
                ),
            )
            conn.commit()
            return replaced
        finally:
            conn.close()

    def delete_linked_video(self, parent_image_id: str, owner_id: str | None = None) -> bool:
        """Delete only the private video linked to parent_image_id, preserving the parent image."""
        conn = self._connect()
        deleted_row: dict[str, Any] | None = None
        try:
            row = conn.execute(
                "SELECT * FROM media_assets WHERE parent_image_id = ? AND media_type = 'video'",
                (parent_image_id,),
            ).fetchone()
            if not row:
                return False
            if row["is_public"]:
                raise ValueError("Built-in public video assets cannot be deleted.")
            if owner_id is not None and row["owner_id"] != owner_id:
                raise KeyError(f"Video for image '{parent_image_id}' not found")
            deleted_row = dict(row)
            conn.execute("DELETE FROM media_assets WHERE id = ? AND is_public = 0", (row["id"],))
            conn.commit()
        finally:
            conn.close()

        if deleted_row:
            self._unlink_asset_file(deleted_row)
            return True
        return False

    def delete_media_asset(
        self, asset_id: str, owner_id: str | None = None
    ) -> list[dict[str, Any]]:
        """Immediately delete a private media asset (and any linked video) from DB and disk."""
        conn = self._connect()
        deleted_rows: list[dict[str, Any]] = []
        try:
            row = conn.execute("SELECT * FROM media_assets WHERE id = ?", (asset_id,)).fetchone()
            if not row:
                return []
            if row["is_public"]:
                return []
            if owner_id is not None and row["owner_id"] != owner_id:
                return []
            deleted_rows.append(dict(row))
            linked_rows = conn.execute(
                "SELECT * FROM media_assets WHERE parent_image_id = ?",
                (asset_id,),
            ).fetchall()
            for lr in linked_rows:
                deleted_rows.append(dict(lr))

            conn.execute(
                "UPDATE location_nodes SET image_media_id = NULL WHERE image_media_id = ?",
                (asset_id,),
            )
            conn.execute(
                "UPDATE location_containers SET image_media_id = NULL WHERE image_media_id = ?",
                (asset_id,),
            )
            conn.execute("DELETE FROM media_assets WHERE id = ? AND is_public = 0", (asset_id,))
            conn.commit()
        finally:
            conn.close()

        for dr in deleted_rows:
            self._unlink_asset_file(dr)
        return deleted_rows

    def assert_user_can_reference_media_urls(
        self,
        user_id: str,
        urls: Iterable[str | None],
        *,
        conn: sqlite3.Connection | None = None,
    ) -> None:
        """Verify ``user_id`` is authorized to attach every referenced local ``/api/media/...`` URL."""
        local_paths: list[str] = []
        for raw_url in urls:
            if not isinstance(raw_url, str):
                continue
            cleaned = raw_url.strip()
            if not cleaned or cleaned.startswith(("http://", "https://")):
                continue
            parsed_path = urlparse(cleaned).path
            if ".." in parsed_path.split("/"):
                raise ValueError("Unauthorized media asset reference.")
            if not parsed_path.startswith("/api/media/"):
                raise ValueError("Unauthorized media asset reference.")
            local_paths.append(parsed_path)

        if not local_paths:
            return

        own_conn = conn is None
        if conn is None:
            conn = self._connect()
        try:
            for path in local_paths:
                if _PUBLIC_CHARACTER_MEDIA_URL_RE.fullmatch(path):
                    continue
                aid = extract_asset_id_from_url(path)
                if aid is not None and path == build_asset_url(aid):
                    row = conn.execute(
                        "SELECT owner_id, is_public FROM media_assets WHERE id = ?",
                        (aid,),
                    ).fetchone()
                    if row is None or (not bool(row["is_public"]) and row["owner_id"] != user_id):
                        raise ValueError("Unauthorized media asset reference.")
                    continue
                char_m = _CHARACTER_MEDIA_URL_RE.fullmatch(path)
                if char_m is not None:
                    if not self.user_can_access_character(user_id, char_m.group(1)):
                        raise ValueError("Unauthorized media asset reference.")
                    continue
                pers_m = _PERSONA_MEDIA_URL_RE.fullmatch(path)
                if pers_m is not None:
                    if not self.user_can_access_persona_media(
                        user_id, pers_m.group(1), pers_m.group(2), pers_m.group(3)
                    ):
                        raise ValueError("Unauthorized media asset reference.")
                    continue
                world_m = _WORLD_MEDIA_URL_RE.fullmatch(path)
                if world_m is not None:
                    if not self.user_can_access_world_media(
                        user_id, world_m.group(1), world_m.group(2)
                    ):
                        raise ValueError("Unauthorized media asset reference.")
                    continue
                raise ValueError("Unauthorized media asset reference.")
        finally:
            if own_conn:
                conn.close()

    def user_can_access_asset(self, user_id: str, asset_id: str) -> bool:
        """Authorize access if asset is public, owned by user, or referenced by user's worlds/chars/personas/campaigns."""
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT id, owner_id, entity_scope, is_public, parent_image_id FROM media_assets WHERE id = ?",
                (asset_id,),
            ).fetchone()
            if not row:
                return False
            if row["is_public"]:
                return True
            if row["owner_id"] == user_id:
                return True
            target_id = str(row["parent_image_id"] or row["id"])
            if row["entity_scope"] == "world":
                hit = conn.execute(
                    """
                    SELECT 1 FROM world_media_links wml
                    JOIN worlds w ON w.id = wml.world_id
                    WHERE wml.media_id = ? AND w.owner_id = ?
                    UNION
                    SELECT 1 FROM world_media_links wml
                    JOIN campaigns c ON c.world_id = wml.world_id
                    WHERE wml.media_id = ? AND c.owner_id = ?
                    LIMIT 1
                    """,
                    (target_id, user_id, target_id, user_id),
                ).fetchone()
                return hit is not None

            if row["entity_scope"] == "character":
                c_rows = conn.execute(
                    """
                    SELECT c.portraits_json, c.gallery_json
                    FROM characters c
                    WHERE c.owner_id = ?
                       OR c.id IN (SELECT character_id FROM campaigns WHERE owner_id = ?)
                       OR c.id IN (
                           SELECT cc.character_id FROM campaign_characters cc
                           JOIN campaigns camp ON camp.id = cc.campaign_id
                           WHERE camp.owner_id = ?
                       )
                    """,
                    (user_id, user_id, user_id),
                ).fetchall()
                for cr in c_rows:
                    try:
                        p_raw = json.loads(cr["portraits_json"] or "{}")
                        g_raw = json.loads(cr["gallery_json"] or "[]")
                    except (ValueError, TypeError):
                        continue
                    if target_id in _collect_asset_ids_from_char_row(p_raw, g_raw):
                        return True
                # Check uncommitted staged ownership
                staged_cutoff = self._staged_ownership_cutoff_iso()
                staged_hit = conn.execute(
                    "SELECT 1 FROM staged_character_ownership WHERE user_id = ? AND created_at >= ? LIMIT 1",
                    (user_id, staged_cutoff),
                ).fetchone()
                if staged_hit is not None and row["owner_id"] == user_id:
                    return True
                return False

            if row["entity_scope"] == "persona":
                p_rows = conn.execute(
                    "SELECT portrait_url, gallery_json FROM personas WHERE owner_id = ?",
                    (user_id,),
                ).fetchall()
                for pr in p_rows:
                    try:
                        g_raw = json.loads(pr["gallery_json"] or "[]")
                    except (ValueError, TypeError):
                        g_raw = []
                    if target_id in _collect_asset_ids_from_persona_row(
                        pr["portrait_url"], g_raw
                    ):
                        return True
                camp_rows = conn.execute(
                    "SELECT persona_snapshot_json FROM campaigns WHERE owner_id = ? AND persona_snapshot_json IS NOT NULL",
                    (user_id,),
                ).fetchall()
                for cr in camp_rows:
                    try:
                        snap = json.loads(cr["persona_snapshot_json"] or "{}")
                    except (ValueError, TypeError):
                        continue
                    if not isinstance(snap, dict):
                        continue
                    if target_id in _collect_asset_ids_from_persona_row(
                        snap.get("portrait_url"), snap.get("gallery")
                    ):
                        return True
                return False
            return False
        finally:
            conn.close()

    def get_asset_campaign_impact(
        self, asset_id: str, owner_id: str | None = None
    ) -> dict[str, Any]:
        """Compute active campaign count and linked video info for pre-delete warnings."""
        conn = self._connect()
        try:
            row = conn.execute("SELECT * FROM media_assets WHERE id = ?", (asset_id,)).fetchone()
            if not row:
                return {
                    "asset_id": asset_id,
                    "campaigns_using": 0,
                    "is_public": False,
                    "has_linked_video": False,
                    "video_byte_size": 0,
                }
            is_public = bool(row["is_public"])
            vid_row = conn.execute(
                "SELECT id, byte_size, media_type, filename, entity_scope FROM media_assets WHERE parent_image_id = ? AND media_type = 'video'",
                (asset_id,),
            ).fetchone()
            has_video = bool(vid_row and self._asset_file_exists(vid_row))
            video_bytes = int(vid_row["byte_size"] or 0) if has_video and vid_row else 0

            campaigns_using = 0
            scope = str(row["entity_scope"])
            if scope == "world":
                if owner_id is not None:
                    cnt_row = conn.execute(
                        """
                        SELECT COUNT(DISTINCT camp.id) AS cnt
                        FROM campaigns camp
                        JOIN world_media_links wml ON wml.world_id = camp.world_id
                        WHERE wml.media_id = ? AND camp.owner_id = ?
                        """,
                        (asset_id, owner_id),
                    ).fetchone()
                else:
                    cnt_row = conn.execute(
                        """
                        SELECT COUNT(DISTINCT camp.id) AS cnt
                        FROM campaigns camp
                        JOIN world_media_links wml ON wml.world_id = camp.world_id
                        WHERE wml.media_id = ?
                        """,
                        (asset_id,),
                    ).fetchone()
                campaigns_using = int(cnt_row["cnt"]) if cnt_row else 0
            elif scope == "character":
                url_needle = build_asset_url(asset_id)
                like_pat = f"%{url_needle}%"
                if owner_id is not None:
                    cnt_row = conn.execute(
                        """
                        SELECT COUNT(DISTINCT camp_id) AS cnt
                        FROM (
                            SELECT camp.id AS camp_id
                            FROM campaigns camp
                            JOIN characters ch ON ch.id = camp.character_id
                            WHERE camp.owner_id = ?
                              AND (ch.portraits_json LIKE ? OR ch.gallery_json LIKE ?)
                            UNION
                            SELECT camp.id AS camp_id
                            FROM campaigns camp
                            JOIN campaign_characters cc ON cc.campaign_id = camp.id
                            JOIN characters ch ON ch.id = cc.character_id
                            WHERE camp.owner_id = ?
                              AND (ch.portraits_json LIKE ? OR ch.gallery_json LIKE ?)
                        )
                        """,
                        (owner_id, like_pat, like_pat, owner_id, like_pat, like_pat),
                    ).fetchone()
                else:
                    cnt_row = conn.execute(
                        """
                        SELECT COUNT(DISTINCT camp_id) AS cnt
                        FROM (
                            SELECT camp.id AS camp_id
                            FROM campaigns camp
                            JOIN characters ch ON ch.id = camp.character_id
                            WHERE ch.portraits_json LIKE ? OR ch.gallery_json LIKE ?
                            UNION
                            SELECT camp.id AS camp_id
                            FROM campaigns camp
                            JOIN campaign_characters cc ON cc.campaign_id = camp.id
                            JOIN characters ch ON ch.id = cc.character_id
                            WHERE ch.portraits_json LIKE ? OR ch.gallery_json LIKE ?
                        )
                        """,
                        (like_pat, like_pat, like_pat, like_pat),
                    ).fetchone()
                campaigns_using = int(cnt_row["cnt"]) if cnt_row else 0
            elif scope == "persona":
                url_needle = build_asset_url(asset_id)
                like_pat = f"%{url_needle}%"
                if owner_id is not None:
                    cnt_row = conn.execute(
                        "SELECT COUNT(*) AS cnt FROM campaigns WHERE owner_id = ? AND persona_snapshot_json LIKE ?",
                        (owner_id, like_pat),
                    ).fetchone()
                else:
                    cnt_row = conn.execute(
                        "SELECT COUNT(*) AS cnt FROM campaigns WHERE persona_snapshot_json LIKE ?",
                        (like_pat,),
                    ).fetchone()
                campaigns_using = int(cnt_row["cnt"]) if cnt_row else 0

            return {
                "asset_id": asset_id,
                "campaigns_using": campaigns_using,
                "is_public": is_public,
                "has_linked_video": has_video,
                "video_byte_size": video_bytes,
            }
        finally:
            conn.close()

    def list_user_private_media_assets(self, user_id: str) -> list[dict[str, Any]]:
        """Return all non-public media_assets rows owned by user_id."""
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT * FROM media_assets WHERE owner_id = ? AND is_public = 0",
                (user_id,),
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def list_active_asset_filenames(self, category: str) -> set[str]:
        """Return persisted media_assets filenames for a disk category ('images' | 'videos' | 'audio')."""
        m_type = "video" if category == "videos" else ("audio" if category == "audio" else "image")
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT filename FROM media_assets WHERE media_type = ?",
                (m_type,),
            ).fetchall()
            return {str(r["filename"]) for r in rows}
        finally:
            conn.close()

    def _hydrate_character_records_conn(
        self, conn: sqlite3.Connection, chars: list[CharacterRecord]
    ) -> list[CharacterRecord]:
        """Strip missing private media references and attach live linked videos onto CharacterRecords."""
        if not chars:
            return chars
        asset_ids: set[str] = set()
        for ch in chars:
            for url in ch.portraits.values():
                aid = extract_asset_id_from_url(url)
                if aid:
                    asset_ids.add(aid)
            for img in ch.gallery:
                aid = extract_asset_id_from_url(img.url) or img.id
                if aid:
                    asset_ids.add(aid)

        if not asset_ids:
            return chars

        placeholders = ",".join("?" for _ in asset_ids)
        rows = conn.execute(
            f"SELECT * FROM media_assets WHERE id IN ({placeholders})",
            list(asset_ids),
        ).fetchall()
        assets_by_id: dict[str, dict[str, Any]] = {
            str(r["id"]): dict(r)
            for r in rows
            if self._asset_file_exists(r)
        }
        videos_by_parent = self.get_linked_videos_map(conn, list(assets_by_id.keys()))

        hydrated: list[CharacterRecord] = []
        for ch in chars:
            new_portraits: dict[str, str] = {}
            for emotion, url in ch.portraits.items():
                aid = extract_asset_id_from_url(url)
                if aid is not None:
                    asset = assets_by_id.get(aid)
                    if asset is None:
                        continue
                    new_portraits[emotion] = self.build_public_or_asset_url(asset)
                else:
                    new_portraits[emotion] = url

            new_gallery: list[GalleryImage] = []
            for img in ch.gallery:
                aid = extract_asset_id_from_url(img.url)
                if aid is not None:
                    asset = assets_by_id.get(aid)
                    if asset is None:
                        continue
                    vid = videos_by_parent.get(aid)
                    new_gallery.append(
                        img.model_copy(
                            update={
                                "id": aid,
                                "url": self.build_public_or_asset_url(asset),
                                "is_public": bool(asset.get("is_public")),
                                "video_asset_id": vid["id"] if vid else None,
                                "video_url": build_asset_url(vid["id"]) if vid else None,
                                "video_mime_type": vid["mime_type"] if vid else None,
                                "video_byte_size": int(vid["byte_size"] or 0) if vid else None,
                            }
                        )
                    )
                else:
                    # Public showcase character gallery image (or external legacy)
                    new_gallery.append(
                        img.model_copy(
                            update={
                                "is_public": "/api/media/public/" in (img.url or ""),
                                "video_asset_id": None,
                                "video_url": None,
                                "video_mime_type": None,
                                "video_byte_size": None,
                            }
                        )
                    )
            hydrated.append(
                ch.model_copy(update={"portraits": new_portraits, "gallery": new_gallery})
            )
        return hydrated

    def _hydrate_persona_records_conn(
        self, conn: sqlite3.Connection, personas: list[PersonaRecord]
    ) -> list[PersonaRecord]:
        """Strip missing private media references and attach live linked videos onto PersonaRecords."""
        if not personas:
            return personas
        asset_ids: set[str] = set()
        for p in personas:
            aid = extract_asset_id_from_url(p.portrait_url)
            if aid:
                asset_ids.add(aid)
            for img in p.gallery:
                g_aid = extract_asset_id_from_url(img.url) or img.id
                if g_aid:
                    asset_ids.add(g_aid)

        if not asset_ids:
            return personas

        placeholders = ",".join("?" for _ in asset_ids)
        rows = conn.execute(
            f"SELECT * FROM media_assets WHERE id IN ({placeholders})",
            list(asset_ids),
        ).fetchall()
        assets_by_id: dict[str, dict[str, Any]] = {
            str(r["id"]): dict(r)
            for r in rows
            if self._asset_file_exists(r)
        }
        videos_by_parent = self.get_linked_videos_map(conn, list(assets_by_id.keys()))

        hydrated: list[PersonaRecord] = []
        for p in personas:
            new_portrait = p.portrait_url
            p_aid = extract_asset_id_from_url(p.portrait_url)
            if p_aid is not None:
                p_asset = assets_by_id.get(p_aid)
                new_portrait = self.build_public_or_asset_url(p_asset) if p_asset else None

            new_gallery: list[GalleryImage] = []
            for img in p.gallery:
                g_aid = extract_asset_id_from_url(img.url)
                if g_aid is not None:
                    asset = assets_by_id.get(g_aid)
                    if asset is None:
                        continue
                    vid = videos_by_parent.get(g_aid)
                    new_gallery.append(
                        img.model_copy(
                            update={
                                "id": g_aid,
                                "url": self.build_public_or_asset_url(asset),
                                "is_public": bool(asset.get("is_public")),
                                "video_asset_id": vid["id"] if vid else None,
                                "video_url": build_asset_url(vid["id"]) if vid else None,
                                "video_mime_type": vid["mime_type"] if vid else None,
                                "video_byte_size": int(vid["byte_size"] or 0) if vid else None,
                            }
                        )
                    )
                else:
                    new_gallery.append(img)
            hydrated.append(
                p.model_copy(update={"portrait_url": new_portrait, "gallery": new_gallery})
            )
        return hydrated

    def preview_admin_media_purge(
        self, *, purge_images: bool, purge_videos: bool
    ) -> dict[str, Any]:
        """Dry-run counts and byte totals of non-built-in media eligible for admin purge."""
        eff_videos = True if purge_images else bool(purge_videos)
        eff_images = bool(purge_images)
        if not eff_images and not eff_videos:
            return {
                "purge_images": False,
                "purge_videos": False,
                "images_count": 0,
                "images_bytes": 0,
                "videos_count": 0,
                "videos_bytes": 0,
                "total_bytes": 0,
                "cascade_videos_included": False,
            }

        conn = self._connect()
        try:
            types_to_fetch: list[str] = []
            if eff_images:
                types_to_fetch.append("image")
            if eff_videos:
                types_to_fetch.append("video")
            placeholders = ",".join("?" for _ in types_to_fetch)
            rows = conn.execute(
                f"SELECT * FROM media_assets WHERE is_public = 0 AND media_type IN ({placeholders})",
                types_to_fetch,
            ).fetchall()
        finally:
            conn.close()

        images_count = 0
        images_bytes = 0
        videos_count = 0
        videos_bytes = 0
        for r in rows:
            sz = int(r["byte_size"] or 0)
            if self._asset_file_exists(r):
                try:
                    sz = self.resolve_asset_disk_path(r).stat().st_size
                except OSError:
                    pass
            if r["media_type"] == "image":
                images_count += 1
                images_bytes += sz
            elif r["media_type"] == "video":
                videos_count += 1
                videos_bytes += sz

        return {
            "purge_images": eff_images,
            "purge_videos": eff_videos,
            "images_count": images_count,
            "images_bytes": images_bytes,
            "videos_count": videos_count,
            "videos_bytes": videos_bytes,
            "total_bytes": images_bytes + videos_bytes,
            "cascade_videos_included": bool(eff_images and not purge_videos),
        }

    def execute_admin_media_purge(
        self, *, purge_images: bool, purge_videos: bool
    ) -> dict[str, Any]:
        """Delete all non-built-in media assets matching categories, cascading images -> videos."""
        eff_images = bool(purge_images)
        eff_videos = True if eff_images else bool(purge_videos)
        if not eff_images and not eff_videos:
            raise ValueError("At least one media category (images or videos) must be selected.")

        types_to_delete: list[str] = []
        if eff_images:
            types_to_delete.append("image")
        if eff_videos:
            types_to_delete.append("video")

        conn = self._connect()
        deleted_rows: list[dict[str, Any]] = []
        try:
            placeholders = ",".join("?" for _ in types_to_delete)
            rows = conn.execute(
                f"SELECT * FROM media_assets WHERE is_public = 0 AND media_type IN ({placeholders})",
                types_to_delete,
            ).fetchall()
            deleted_rows = [dict(r) for r in rows]
            deleted_ids = {str(r["id"]) for r in deleted_rows}
            deleted_urls = {build_asset_url(aid) for aid in deleted_ids}

            if deleted_ids:
                id_ph = ",".join("?" for _ in deleted_ids)
                id_list = list(deleted_ids)
                if eff_images:
                    conn.execute(
                        f"UPDATE location_nodes SET image_media_id = NULL WHERE image_media_id IN ({id_ph})",
                        id_list,
                    )
                    conn.execute(
                        f"UPDATE location_containers SET image_media_id = NULL WHERE image_media_id IN ({id_ph})",
                        id_list,
                    )
                conn.execute(
                    f"DELETE FROM media_assets WHERE id IN ({id_ph}) AND is_public = 0",
                    id_list,
                )

                if eff_images:
                    for c_row in conn.execute(
                        "SELECT id, portraits_json, gallery_json FROM characters"
                    ).fetchall():
                        changed = False
                        p_map = json.loads(c_row["portraits_json"] or "{}")
                        if isinstance(p_map, dict):
                            cleaned_p = {
                                k: v for k, v in p_map.items() if v not in deleted_urls
                            }
                            if len(cleaned_p) != len(p_map):
                                p_map = cleaned_p
                                changed = True
                        g_list = json.loads(c_row["gallery_json"] or "[]")
                        if isinstance(g_list, list):
                            cleaned_g = [
                                item
                                for item in g_list
                                if isinstance(item, dict)
                                and item.get("url") not in deleted_urls
                                and item.get("id") not in deleted_ids
                            ]
                            if len(cleaned_g) != len(g_list):
                                g_list = cleaned_g
                                changed = True
                        if changed:
                            conn.execute(
                                "UPDATE characters SET portraits_json = ?, gallery_json = ? WHERE id = ?",
                                (json.dumps(p_map), json.dumps(g_list), c_row["id"]),
                            )

                    for p_row in conn.execute(
                        "SELECT id, portrait_url, gallery_json FROM personas"
                    ).fetchall():
                        changed = False
                        p_url = p_row["portrait_url"]
                        if p_url in deleted_urls:
                            p_url = None
                            changed = True
                        g_list = json.loads(p_row["gallery_json"] or "[]")
                        if isinstance(g_list, list):
                            cleaned_g = [
                                item
                                for item in g_list
                                if isinstance(item, dict)
                                and item.get("url") not in deleted_urls
                                and item.get("id") not in deleted_ids
                            ]
                            if len(cleaned_g) != len(g_list):
                                g_list = cleaned_g
                                changed = True
                        if changed:
                            conn.execute(
                                "UPDATE personas SET portrait_url = ?, gallery_json = ? WHERE id = ?",
                                (p_url, json.dumps(g_list), p_row["id"]),
                            )

                    for camp_row in conn.execute(
                        "SELECT id, persona_snapshot_json FROM campaigns WHERE persona_snapshot_json IS NOT NULL"
                    ).fetchall():
                        try:
                            snap = json.loads(camp_row["persona_snapshot_json"])
                        except Exception:
                            continue
                        if not isinstance(snap, dict):
                            continue
                        changed = False
                        if snap.get("portrait_url") in deleted_urls:
                            snap["portrait_url"] = None
                            changed = True
                        if isinstance(snap.get("gallery"), list):
                            cleaned_sg = [
                                item
                                for item in snap["gallery"]
                                if isinstance(item, dict)
                                and item.get("url") not in deleted_urls
                                and item.get("id") not in deleted_ids
                            ]
                            if len(cleaned_sg) != len(snap["gallery"]):
                                snap["gallery"] = cleaned_sg
                                changed = True
                        if changed:
                            conn.execute(
                                "UPDATE campaigns SET persona_snapshot_json = ? WHERE id = ?",
                                (json.dumps(snap), camp_row["id"]),
                            )

                conn.commit()
        finally:
            conn.close()

        images_deleted = 0
        videos_deleted = 0
        bytes_reclaimed = 0
        for dr in deleted_rows:
            sz = int(dr.get("byte_size") or 0)
            if self._asset_file_exists(dr):
                try:
                    sz = self.resolve_asset_disk_path(dr).stat().st_size
                except OSError:
                    pass
            self._unlink_asset_file(dr)
            bytes_reclaimed += sz
            if dr.get("media_type") == "image":
                images_deleted += 1
            elif dr.get("media_type") == "video":
                videos_deleted += 1

        return {
            "purge_images": eff_images,
            "purge_videos": eff_videos,
            "images_deleted": images_deleted,
            "videos_deleted": videos_deleted,
            "bytes_reclaimed": bytes_reclaimed,
        }

    def gc_unreferenced_character_assets(self, conn: sqlite3.Connection) -> list[dict[str, Any]]:
        """Collect and remove private character media_assets no longer referenced by any character row."""
        referenced_ids: set[str] = set()
        for row in conn.execute("SELECT portraits_json, gallery_json FROM characters").fetchall():
            try:
                p_raw = json.loads(row["portraits_json"] or "{}")
            except Exception:
                p_raw = {}
            try:
                g_raw = json.loads(row["gallery_json"] or "[]")
            except Exception:
                g_raw = []
            referenced_ids.update(_collect_asset_ids_from_char_row(p_raw, g_raw))

        rows = conn.execute(
            "SELECT * FROM media_assets WHERE entity_scope = 'character' AND is_public = 0 AND media_type = 'image'"
        ).fetchall()
        orphan_assets: list[dict[str, Any]] = []
        for r in rows:
            if str(r["id"]) in referenced_ids:
                continue
            orphan_assets.append(dict(r))
            for vr in conn.execute(
                "SELECT * FROM media_assets WHERE parent_image_id = ?",
                (r["id"],),
            ).fetchall():
                orphan_assets.append(dict(vr))
            conn.execute("DELETE FROM media_assets WHERE id = ?", (r["id"],))
        return orphan_assets

    def gc_unreferenced_world_assets(self, conn: sqlite3.Connection) -> list[dict[str, Any]]:
        """Collect and remove private world media_assets with zero remaining world_media_links."""
        rows = conn.execute(
            """
            SELECT ma.*
            FROM media_assets ma
            WHERE ma.entity_scope = 'world'
              AND ma.is_public = 0
              AND ma.media_type != 'video'
              AND NOT EXISTS (
                  SELECT 1 FROM world_media_links wml WHERE wml.media_id = ma.id
              )
            """
        ).fetchall()
        orphan_assets: list[dict[str, Any]] = []
        for r in rows:
            orphan_assets.append(dict(r))
            for vr in conn.execute(
                "SELECT * FROM media_assets WHERE parent_image_id = ?",
                (r["id"],),
            ).fetchall():
                orphan_assets.append(dict(vr))
            conn.execute("DELETE FROM media_assets WHERE id = ?", (r["id"],))
        return orphan_assets

    def gc_unreferenced_persona_assets(self, conn: sqlite3.Connection) -> list[dict[str, Any]]:
        """Collect and remove private persona media_assets no longer referenced by any persona row."""
        referenced_ids: set[str] = set()
        for row in conn.execute("SELECT portrait_url, gallery_json FROM personas").fetchall():
            try:
                g_raw = json.loads(row["gallery_json"] or "[]")
            except Exception:
                g_raw = []
            referenced_ids.update(_collect_asset_ids_from_persona_row(row["portrait_url"], g_raw))

        rows = conn.execute(
            "SELECT * FROM media_assets WHERE entity_scope = 'persona' AND is_public = 0 AND media_type = 'image'"
        ).fetchall()
        orphan_assets: list[dict[str, Any]] = []
        for r in rows:
            if str(r["id"]) in referenced_ids:
                continue
            orphan_assets.append(dict(r))
            for vr in conn.execute(
                "SELECT * FROM media_assets WHERE parent_image_id = ?",
                (r["id"],),
            ).fetchall():
                orphan_assets.append(dict(vr))
            conn.execute("DELETE FROM media_assets WHERE id = ?", (r["id"],))
        return orphan_assets
