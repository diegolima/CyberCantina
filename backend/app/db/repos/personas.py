"""Player personas and dynamic campaign persona turn state."""

from __future__ import annotations

import json
from pathlib import Path
import re
import sqlite3
import time
from typing import Any
import uuid
from app.schemas.character import GalleryImage
from app.schemas.persona import (
    DEFAULT_PERSONA_ID,
    PersonaCreatePayload,
    PersonaItemInstance,
    PersonaLoreEntry,
    PersonaRecord,
    PersonaTurnStateSnapshot,
    PersonaUpdatePayload,
    canonicalize_persona_legacy_fields,
    default_persona_id_for_user,
    get_default_persona,
    is_default_persona_id,
    sanitize_persona_unsupported_fields,
)
from app.schemas.physical import (
    PhysicalStance,
    normalize_physical_stance,
    sanitize_physical_context,
)
from app.db.repos.base import _sanitize_persona_media, utc_now_iso
from app.security.media_path import (
    PathTraversalError,
    safe_resolve_persona_media_dir,
    safe_resolve_persona_media_file_path,
    validate_safe_persona_id,
)

_PERSONA_MEDIA_URL_RE = re.compile(
    r"^/api/media/personas/([a-zA-Z0-9_-]+)/(portraits|gallery)/([a-zA-Z0-9_.-]+)$"
)


def _parse_persona_media_url(url: str | None) -> tuple[str, str, str] | None:
    if not isinstance(url, str):
        return None
    m = _PERSONA_MEDIA_URL_RE.fullmatch(url.strip())
    if not m:
        return None
    return m.group(1), m.group(2), m.group(3)


def _extract_refs_from_persona_fields(
    portrait_url: str | None, gallery_raw: Any
) -> set[tuple[str, str, str]]:
    refs: set[tuple[str, str, str]] = set()
    p_ref = _parse_persona_media_url(portrait_url)
    if p_ref:
        refs.add(p_ref)
    if isinstance(gallery_raw, list):
        for item in gallery_raw:
            url = item.get("url") if isinstance(item, dict) else getattr(item, "url", None)
            g_ref = _parse_persona_media_url(url)
            if g_ref:
                refs.add(g_ref)
    return refs


def _extract_refs_from_snapshot_json(snapshot_json: str | None) -> set[tuple[str, str, str]]:
    if not snapshot_json:
        return set()
    try:
        data = json.loads(snapshot_json)
    except Exception:
        return set()
    if not isinstance(data, dict):
        return set()
    return _extract_refs_from_persona_fields(
        data.get("portrait_url"),
        data.get("gallery"),
    )


class PersonasMixin:
    """Player personas and dynamic campaign persona turn state."""

    def create_persona(
        self,
        draft: PersonaCreatePayload,
        owner_id: str,
        persona_id: str | None = None,
    ) -> PersonaRecord:
        """Create a new user persona in the master gallery."""
        p_id = (
            validate_safe_persona_id(persona_id)
            if persona_id is not None
            else f"persona_{uuid.uuid4().hex[:10]}"
        )
        now = utc_now_iso()
        equipped_json = json.dumps([it.model_dump() for it in draft.equipped])
        inventory_json = json.dumps([it.model_dump() for it in draft.inventory])
        lore_json = json.dumps([entry.model_dump() for entry in draft.lore_entries])
        tags_json = json.dumps(draft.tags or [])
        features_json = json.dumps(draft.distinctive_features or [])
        clean_portrait, clean_gallery = _sanitize_persona_media(
            draft.portrait_url, draft.gallery
        )
        if owner_id is not None:
            urls_to_check: list[str | None] = [clean_portrait]
            for img in clean_gallery:
                urls_to_check.append(img.url)
                if img.video_url:
                    urls_to_check.append(img.video_url)
            self.assert_user_can_reference_media_urls(owner_id, urls_to_check)
        gallery_json = json.dumps([img.model_dump() for img in clean_gallery])
        persona_bio = (draft.persona_bio or "").strip()
        canonical_physical, unsupported_fields = canonicalize_persona_legacy_fields(
            persona_bio=persona_bio,
            physical_appearance=draft.physical_appearance,
            unsupported_fields=draft.unsupported_fields,
            strict=True,
        )
        unsupported_json = json.dumps(unsupported_fields)

        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT INTO personas (
                    id, owner_id, name, tagline, species, age, age_is_secret, sex, pronouns,
                    persona_bio, tags_json, build_and_height, distinctive_features_json,
                    physical_appearance, equipped_json, inventory_json, lore_entries_json,
                    portrait_url, gallery_json, unsupported_fields_json, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    p_id,
                    owner_id,
                    draft.name.strip(),
                    (draft.tagline or "").strip(),
                    (draft.species or "Human").strip(),
                    draft.age.strip() if draft.age else None,
                    1 if draft.age_is_secret else 0,
                    (draft.sex or "").strip(),
                    (draft.pronouns or "").strip(),
                    persona_bio,
                    tags_json,
                    (draft.build_and_height or "").strip(),
                    features_json,
                    canonical_physical,
                    equipped_json,
                    inventory_json,
                    lore_json,
                    clean_portrait,
                    gallery_json,
                    unsupported_json,
                    now,
                    now,
                ),
            )
            conn.commit()
            created = self.get_persona(p_id, owner_id=owner_id)
            if not created:
                raise RuntimeError(f"Failed to retrieve created persona '{p_id}'")
            return created
        finally:
            conn.close()

    @classmethod
    def _ensure_default_persona_for_user_conn(cls, conn: sqlite3.Connection, user_id: str) -> PersonaRecord:
        """Ensure the deterministic default 'User' persona exists for the specified user."""
        def_id = default_persona_id_for_user(user_id)
        r = conn.execute("SELECT * FROM personas WHERE id = ?", (def_id,)).fetchone()
        if r:
            return cls._row_to_persona_record(r)

        default_persona = get_default_persona(owner_id=user_id)
        conn.execute(
            """
            INSERT OR IGNORE INTO personas (
                id, owner_id, name, tagline, species, age, age_is_secret, sex, pronouns,
                persona_bio, tags_json, build_and_height, distinctive_features_json,
                physical_appearance, equipped_json, inventory_json, lore_entries_json,
                portrait_url, gallery_json, created_at, updated_at
            )
            VALUES (?, ?, ?, '', 'Human', NULL, 0, '', '', '', '[]', '', '[]', '', '[]', '[]', '[]', NULL, '[]', ?, ?)
            """,
            (
                def_id,
                user_id,
                default_persona.name,
                default_persona.created_at,
                default_persona.updated_at,
            ),
        )
        return default_persona

    def ensure_default_persona_for_user(self, user_id: str) -> PersonaRecord:
        """Public helper to retrieve or ensure a user's default persona."""
        conn = self._connect()
        try:
            p = self._ensure_default_persona_for_user_conn(conn, user_id)
            conn.commit()
            return p
        finally:
            conn.close()

    def get_persona(
        self,
        persona_id: str,
        owner_id: str | None = None,
    ) -> PersonaRecord | None:
        """Fetch a single persona by ID, enforcing ownership if provided."""
        conn = self._connect()
        try:
            if owner_id is not None:
                if persona_id == default_persona_id_for_user(owner_id) or persona_id == DEFAULT_PERSONA_ID:
                    p = self._ensure_default_persona_for_user_conn(conn, owner_id)
                    conn.commit()
                    return p
                r = conn.execute(
                    "SELECT * FROM personas WHERE id = ? AND owner_id = ?",
                    (persona_id, owner_id),
                ).fetchone()
            else:
                r = conn.execute(
                    "SELECT * FROM personas WHERE id = ?",
                    (persona_id,),
                ).fetchone()
            if not r:
                return None
            rec = self._row_to_persona_record(r)
            return self._hydrate_persona_records_conn(conn, [rec])[0]
        finally:
            conn.close()

    def list_personas(
        self,
        owner_id: str | None = None,
    ) -> list[PersonaRecord]:
        """List all personas, filtered by owner_id if supplied, always ensuring user's default persona exists."""
        conn = self._connect()
        try:
            if owner_id is not None:
                def_p = self._ensure_default_persona_for_user_conn(conn, owner_id)
                conn.commit()
                rows = conn.execute(
                    "SELECT * FROM personas WHERE owner_id = ? ORDER BY (CASE WHEN id = ? THEN 1 ELSE 0 END), created_at DESC",
                    (owner_id, def_p.id),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM personas ORDER BY (CASE WHEN id LIKE 'persona_default_%' THEN 1 ELSE 0 END), created_at DESC"
                ).fetchall()
            records = [self._row_to_persona_record(r) for r in rows]
            return self._hydrate_persona_records_conn(conn, records)
        finally:
            conn.close()

    def update_persona(
        self,
        persona_id: str,
        payload: PersonaUpdatePayload,
        owner_id: str | None = None,
    ) -> PersonaRecord:
        """Update an existing master persona."""
        if is_default_persona_id(persona_id):
            raise ValueError("The default 'User' persona is hard-coded and cannot be modified.")
        existing = self.get_persona(persona_id, owner_id=owner_id)
        if not existing:
            raise KeyError(f"Persona '{persona_id}' not found")

        now = utc_now_iso()
        name = payload.name.strip() if payload.name is not None else existing.name
        tagline = (
            payload.tagline.strip()
            if payload.tagline is not None
            else getattr(existing, "tagline", "")
        )
        species = (
            payload.species.strip()
            if payload.species is not None
            else getattr(existing, "species", "Human")
        )
        age = payload.age.strip() if payload.age is not None else existing.age
        age_is_secret = (
            (1 if payload.age_is_secret else 0)
            if payload.age_is_secret is not None
            else (1 if existing.age_is_secret else 0)
        )
        sex = (
            payload.sex.strip()
            if payload.sex is not None
            else getattr(existing, "sex", "")
        )
        pronouns = (
            payload.pronouns.strip()
            if payload.pronouns is not None
            else getattr(existing, "pronouns", "")
        )
        persona_bio = (
            payload.persona_bio.strip()
            if payload.persona_bio is not None
            else getattr(existing, "persona_bio", "")
        )
        tags = (
            payload.tags
            if payload.tags is not None
            else getattr(existing, "tags", [])
        )
        build_and_height = (
            payload.build_and_height.strip()
            if payload.build_and_height is not None
            else getattr(existing, "build_and_height", "")
        )
        distinctive_features = (
            payload.distinctive_features
            if payload.distinctive_features is not None
            else getattr(existing, "distinctive_features", [])
        )
        if payload.physical_appearance is not None:
            raw_physical_appearance = payload.physical_appearance.strip()
        elif payload.unsupported_fields is None:
            raw_physical_appearance = existing.physical_appearance
        else:
            raw_physical_appearance = ""
        raw_unsupported = (
            payload.unsupported_fields
            if payload.unsupported_fields is not None
            else existing.unsupported_fields
        )
        physical_appearance, unsupported_fields = canonicalize_persona_legacy_fields(
            persona_bio=persona_bio,
            physical_appearance=raw_physical_appearance,
            unsupported_fields=raw_unsupported,
            strict=True,
        )
        equipped = (
            [it.model_dump() for it in payload.equipped]
            if payload.equipped is not None
            else [it.model_dump() for it in existing.equipped]
        )
        inventory = (
            [it.model_dump() for it in payload.inventory]
            if payload.inventory is not None
            else [it.model_dump() for it in existing.inventory]
        )
        lore = (
            [entry.model_dump() for entry in payload.lore_entries]
            if payload.lore_entries is not None
            else [entry.model_dump() for entry in existing.lore_entries]
        )

        conn = self._connect()
        try:
            conn.execute(
                """
                UPDATE personas
                SET name = ?, tagline = ?, species = ?, age = ?, age_is_secret = ?, sex = ?, pronouns = ?,
                    persona_bio = ?, tags_json = ?, build_and_height = ?, distinctive_features_json = ?,
                    physical_appearance = ?, equipped_json = ?, inventory_json = ?, lore_entries_json = ?,
                    unsupported_fields_json = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    name,
                    tagline,
                    species,
                    age,
                    age_is_secret,
                    sex,
                    pronouns,
                    persona_bio,
                    json.dumps(tags),
                    build_and_height,
                    json.dumps(distinctive_features),
                    physical_appearance,
                    json.dumps(equipped),
                    json.dumps(inventory),
                    json.dumps(lore),
                    json.dumps(unsupported_fields),
                    now,
                    persona_id,
                ),
            )
            conn.commit()
            updated = self.get_persona(persona_id, owner_id=owner_id)
            if not updated:
                raise RuntimeError(f"Failed to retrieve updated persona '{persona_id}'")
            return updated
        finally:
            conn.close()

    def delete_persona(
        self,
        persona_id: str,
        owner_id: str | None = None,
    ) -> bool:
        """Delete a persona and immediately reclaim any private media_assets owned solely by it."""
        if is_default_persona_id(persona_id):
            raise ValueError("The default 'User' persona is hard-coded and cannot be deleted.")
        conn = self._connect()
        orphan_assets: list[dict[str, Any]] = []
        try:
            if owner_id is not None:
                res = conn.execute(
                    "DELETE FROM personas WHERE id = ? AND owner_id = ?",
                    (persona_id, owner_id),
                )
            else:
                res = conn.execute(
                    "DELETE FROM personas WHERE id = ?",
                    (persona_id,),
                )
            deleted = res.rowcount > 0
            if deleted:
                orphan_assets = self.gc_unreferenced_persona_assets(conn)
                active_refs = self._collect_all_active_persona_media_refs(conn)
            else:
                active_refs = set()
            conn.commit()
        finally:
            conn.close()

        if deleted:
            for oa in orphan_assets:
                self._unlink_asset_file(oa)
            self._cleanup_persona_dir_unreferenced(persona_id, active_refs)
        return deleted

    def update_persona_portrait(
        self,
        persona_id: str,
        portrait_url: str | None,
        owner_id: str | None = None,
    ) -> PersonaRecord:
        """Update only the primary portrait URL for a non-default persona."""
        if is_default_persona_id(persona_id):
            raise ValueError("The default 'User' persona is hard-coded and cannot be modified.")
        existing = self.get_persona(persona_id, owner_id=owner_id)
        if not existing:
            raise KeyError(f"Persona '{persona_id}' not found")
        clean_portrait, _ = _sanitize_persona_media(portrait_url, [])
        now = utc_now_iso()
        conn = self._connect()
        try:
            conn.execute(
                "UPDATE personas SET portrait_url = ?, updated_at = ? WHERE id = ?",
                (clean_portrait, now, persona_id),
            )
            conn.commit()
            updated = self.get_persona(persona_id, owner_id=owner_id)
            if not updated:
                raise RuntimeError(f"Failed to retrieve updated persona '{persona_id}'")
            return updated
        finally:
            conn.close()

    def update_persona_gallery(
        self,
        persona_id: str,
        gallery: list[GalleryImage],
        owner_id: str | None = None,
    ) -> PersonaRecord:
        """Update only the photo album list for a non-default persona."""
        if is_default_persona_id(persona_id):
            raise ValueError("The default 'User' persona is hard-coded and cannot be modified.")
        existing = self.get_persona(persona_id, owner_id=owner_id)
        if not existing:
            raise KeyError(f"Persona '{persona_id}' not found")
        _, clean_gallery = _sanitize_persona_media(None, gallery)
        now = utc_now_iso()
        conn = self._connect()
        try:
            conn.execute(
                "UPDATE personas SET gallery_json = ?, updated_at = ? WHERE id = ?",
                (json.dumps([img.model_dump() for img in clean_gallery]), now, persona_id),
            )
            conn.commit()
            updated = self.get_persona(persona_id, owner_id=owner_id)
            if not updated:
                raise RuntimeError(f"Failed to retrieve updated persona '{persona_id}'")
            return updated
        finally:
            conn.close()

    @staticmethod
    def _collect_all_campaign_persona_media_refs(
        conn: sqlite3.Connection,
    ) -> set[tuple[str, str, str]]:
        refs: set[tuple[str, str, str]] = set()
        rows = conn.execute(
            "SELECT persona_snapshot_json FROM campaigns WHERE persona_snapshot_json IS NOT NULL"
        ).fetchall()
        for row in rows:
            refs.update(_extract_refs_from_snapshot_json(row["persona_snapshot_json"]))
        return refs

    @classmethod
    def _collect_all_active_persona_media_refs(
        cls,
        conn: sqlite3.Connection,
    ) -> set[tuple[str, str, str]]:
        refs = cls._collect_all_campaign_persona_media_refs(conn)
        rows = conn.execute(
            "SELECT portrait_url, gallery_json FROM personas"
        ).fetchall()
        for row in rows:
            try:
                gal = json.loads(row["gallery_json"] or "[]")
            except Exception:
                gal = []
            refs.update(_extract_refs_from_persona_fields(row["portrait_url"], gal))
        return refs

    def is_persona_media_url_referenced_by_campaigns(self, media_url: str | None) -> bool:
        """Return True if any campaign persona_snapshot_json still references media_url."""
        ref = _parse_persona_media_url(media_url)
        if ref is None:
            return False
        conn = self._connect()
        try:
            return ref in self._collect_all_campaign_persona_media_refs(conn)
        finally:
            conn.close()

    def user_can_access_persona_media(
        self,
        user_id: str,
        persona_id: str,
        category: str,
        filename: str,
    ) -> bool:
        """Authorize persona media reads via persona ownership or campaign snapshot ownership."""
        target_ref = (persona_id, category, filename)
        conn = self._connect()
        try:
            owns_persona = conn.execute(
                "SELECT 1 FROM personas WHERE id = ? AND owner_id = ?",
                (persona_id, user_id),
            ).fetchone()
            if owns_persona:
                return True
            camp_rows = conn.execute(
                "SELECT persona_snapshot_json FROM campaigns WHERE owner_id = ? AND persona_snapshot_json IS NOT NULL",
                (user_id,),
            ).fetchall()
            for row in camp_rows:
                if target_ref in _extract_refs_from_snapshot_json(row["persona_snapshot_json"]):
                    return True
            return False
        finally:
            conn.close()

    def list_user_persona_media_files(self, user_id: str) -> set[tuple[str, str, str]]:
        """List deduplicated persona media file tuples owned via personas or campaign snapshots."""
        refs: set[tuple[str, str, str]] = set()
        conn = self._connect()
        try:
            p_rows = conn.execute(
                "SELECT portrait_url, gallery_json FROM personas WHERE owner_id = ?",
                (user_id,),
            ).fetchall()
            for row in p_rows:
                try:
                    gal = json.loads(row["gallery_json"] or "[]")
                except Exception:
                    gal = []
                refs.update(_extract_refs_from_persona_fields(row["portrait_url"], gal))

            c_rows = conn.execute(
                "SELECT persona_snapshot_json FROM campaigns WHERE owner_id = ? AND persona_snapshot_json IS NOT NULL",
                (user_id,),
            ).fetchall()
            for row in c_rows:
                refs.update(_extract_refs_from_snapshot_json(row["persona_snapshot_json"]))
            return refs
        finally:
            conn.close()

    def unlink_persona_media_if_unreferenced(self, media_url: str | None) -> bool:
        """Unlink a persona media file on disk only if no campaign snapshot or persona references it."""
        ref = _parse_persona_media_url(media_url)
        if ref is None:
            return False
        p_id, category, filename = ref
        conn = self._connect()
        try:
            active_refs = self._collect_all_active_persona_media_refs(conn)
        finally:
            conn.close()
        if ref in active_refs:
            return False
        try:
            target = safe_resolve_persona_media_file_path(
                self.media_dir, p_id, category, filename
            )
            if target.is_file():
                target.unlink(missing_ok=True)
                self._remove_empty_persona_dirs(p_id)
                return True
        except (PathTraversalError, ValueError, OSError):
            pass
        return False

    def _remove_empty_persona_dirs(self, persona_id: str) -> None:
        try:
            p_dir = safe_resolve_persona_media_dir(self.media_dir, persona_id)
        except (PathTraversalError, ValueError):
            return
        if not p_dir.is_dir():
            return
        for sub in ("portraits", "gallery"):
            sub_dir = p_dir / sub
            if sub_dir.is_dir():
                try:
                    sub_dir.rmdir()
                except OSError:
                    pass
        try:
            p_dir.rmdir()
        except OSError:
            pass

    def _cleanup_persona_dir_unreferenced(
        self,
        persona_id: str,
        active_refs: set[tuple[str, str, str]],
    ) -> int:
        removed = 0
        try:
            p_dir = safe_resolve_persona_media_dir(self.media_dir, persona_id)
        except (PathTraversalError, ValueError):
            return 0
        if not p_dir.is_dir():
            return 0
        for category in ("portraits", "gallery"):
            cat_dir = p_dir / category
            if not cat_dir.is_dir():
                continue
            for entry in cat_dir.iterdir():
                if not entry.is_file():
                    continue
                if (persona_id, category, entry.name) in active_refs:
                    continue
                try:
                    safe_file = safe_resolve_persona_media_file_path(
                        self.media_dir, persona_id, category, entry.name
                    )
                    safe_file.unlink(missing_ok=True)
                    removed += 1
                except (PathTraversalError, ValueError, OSError):
                    continue
        self._remove_empty_persona_dirs(persona_id)
        return removed

    def prune_orphaned_persona_media(self, min_age_seconds: float = 0.0) -> int:
        """Remove persona media files referenced by neither personas nor any campaign snapshot."""
        personas_root = Path(self.media_dir) / "personas"
        if not personas_root.is_dir():
            return 0
        conn = self._connect()
        try:
            active_refs = self._collect_all_active_persona_media_refs(conn)
        finally:
            conn.close()

        now_epoch = time.time()
        removed = 0
        for p_entry in personas_root.iterdir():
            if not p_entry.is_dir():
                continue
            p_id = p_entry.name
            try:
                p_dir = safe_resolve_persona_media_dir(self.media_dir, p_id)
            except (PathTraversalError, ValueError):
                continue
            for category in ("portraits", "gallery"):
                cat_dir = p_dir / category
                if not cat_dir.is_dir():
                    continue
                for f_entry in cat_dir.iterdir():
                    if not f_entry.is_file():
                        continue
                    if (p_id, category, f_entry.name) in active_refs:
                        continue
                    if min_age_seconds > 0:
                        try:
                            if (now_epoch - f_entry.stat().st_mtime) < min_age_seconds:
                                continue
                        except OSError:
                            continue
                    try:
                        safe_file = safe_resolve_persona_media_file_path(
                            self.media_dir, p_id, category, f_entry.name
                        )
                        safe_file.unlink(missing_ok=True)
                        removed += 1
                    except (PathTraversalError, ValueError, OSError):
                        continue
            self._remove_empty_persona_dirs(p_id)
        return removed

    @staticmethod
    def _row_to_persona_record(r: sqlite3.Row) -> PersonaRecord:
        r_keys = r.keys()
        equipped_raw = json.loads(
            r["equipped_json"] if "equipped_json" in r_keys and r["equipped_json"] else "[]"
        )
        inventory_raw = json.loads(
            r["inventory_json"] if "inventory_json" in r_keys and r["inventory_json"] else "[]"
        )
        lore_raw = json.loads(
            r["lore_entries_json"] if "lore_entries_json" in r_keys and r["lore_entries_json"] else "[]"
        )
        tags_raw = json.loads(
            r["tags_json"] if "tags_json" in r_keys and r["tags_json"] else "[]"
        )
        features_raw = json.loads(
            r["distinctive_features_json"] if "distinctive_features_json" in r_keys and r["distinctive_features_json"] else "[]"
        )
        unsupported_raw = json.loads(
            r["unsupported_fields_json"] if "unsupported_fields_json" in r_keys and r["unsupported_fields_json"] else "{}"
        )
        gallery_raw = json.loads(
            r["gallery_json"] if "gallery_json" in r_keys and r["gallery_json"] else "[]"
        )
        raw_portrait = r["portrait_url"] if "portrait_url" in r_keys and r["portrait_url"] else None
        clean_portrait, clean_gallery = _sanitize_persona_media(raw_portrait, gallery_raw)
        persona_bio = r["persona_bio"] if "persona_bio" in r_keys and r["persona_bio"] else ""
        raw_physical = r["physical_appearance"] if "physical_appearance" in r_keys and r["physical_appearance"] else ""
        unsupported_fields = sanitize_persona_unsupported_fields(unsupported_raw)
        # Surface untouched legacy DB physical_appearance dynamically without mutating the row on read.
        if (
            raw_physical.strip()
            and raw_physical.strip() != persona_bio.strip()
            and "physical_appearance" not in unsupported_fields
        ):
            unsupported_fields = sanitize_persona_unsupported_fields(
                {**unsupported_fields, "physical_appearance": raw_physical.strip()}
            )
        return PersonaRecord(
            id=r["id"],
            owner_id=r["owner_id"] if "owner_id" in r_keys else None,
            name=r["name"],
            tagline=r["tagline"] if "tagline" in r_keys and r["tagline"] else "",
            species=r["species"] if "species" in r_keys and r["species"] else "Human",
            age=r["age"] if "age" in r_keys else None,
            age_is_secret=bool(r["age_is_secret"]) if "age_is_secret" in r_keys else True,
            sex=r["sex"] if "sex" in r_keys and r["sex"] else "",
            pronouns=r["pronouns"] if "pronouns" in r_keys and r["pronouns"] else "",
            persona_bio=persona_bio,
            tags=[str(t) for t in tags_raw if str(t).strip()],
            build_and_height=r["build_and_height"] if "build_and_height" in r_keys and r["build_and_height"] else "",
            distinctive_features=[str(f) for f in features_raw if str(f).strip()],
            physical_appearance=raw_physical,
            equipped=[PersonaItemInstance.model_validate(it) for it in equipped_raw],
            inventory=[PersonaItemInstance.model_validate(it) for it in inventory_raw],
            lore_entries=[PersonaLoreEntry.model_validate(entry) for entry in lore_raw],
            portrait_url=clean_portrait,
            gallery=clean_gallery,
            unsupported_fields=unsupported_fields,
            created_at=r["created_at"],
            updated_at=r["updated_at"] if "updated_at" in r_keys else r["created_at"],
        )

    def turn_belongs_to_campaign(self, campaign_id: str, turn_id: str) -> bool:
        """Return True if ``turn_id`` belongs to ``campaign_id``."""
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT 1 FROM turn_nodes WHERE id = ? AND campaign_id = ?",
                (turn_id, campaign_id),
            ).fetchone()
            return row is not None
        finally:
            conn.close()

    def get_campaign_persona_turn_state(
        self, turn_id: str, campaign_id: str | None = None
    ) -> PersonaTurnStateSnapshot | None:
        """Retrieve the player's dynamic inventory, equipped items, and physical state for a turn."""
        conn = self._connect()
        try:
            if campaign_id is not None:
                r = conn.execute(
                    """
                    SELECT pts.equipped_json, pts.inventory_json,
                           pts.physical_stance, pts.physical_context
                    FROM persona_turn_states pts
                    JOIN turn_nodes tn ON tn.id = pts.turn_id
                    WHERE pts.turn_id = ? AND tn.campaign_id = ?
                    """,
                    (turn_id, campaign_id),
                ).fetchone()
            else:
                r = conn.execute(
                    """
                    SELECT equipped_json, inventory_json, physical_stance, physical_context
                    FROM persona_turn_states
                    WHERE turn_id = ?
                    """,
                    (turn_id,),
                ).fetchone()
            if not r:
                return None
            r_keys = r.keys()
            equipped_raw = json.loads(r["equipped_json"] or "[]")
            inventory_raw = json.loads(r["inventory_json"] or "[]")
            stance = normalize_physical_stance(
                r["physical_stance"] if "physical_stance" in r_keys else "unspecified"
            )
            context = sanitize_physical_context(
                r["physical_context"] if "physical_context" in r_keys else ""
            )
            return PersonaTurnStateSnapshot(
                turn_id=turn_id,
                equipped=[PersonaItemInstance.model_validate(it) for it in equipped_raw],
                inventory=[PersonaItemInstance.model_validate(it) for it in inventory_raw],
                physical_stance=stance,
                physical_context=context,
            )
        finally:
            conn.close()

    def save_campaign_persona_turn_state(
        self,
        turn_id: str,
        equipped: list[PersonaItemInstance],
        inventory: list[PersonaItemInstance],
        *,
        physical_stance: PhysicalStance = "unspecified",
        physical_context: str = "",
    ) -> None:
        """Persist or update the player's turn-indexed dynamic inventory and physical state."""
        norm_stance = normalize_physical_stance(physical_stance)
        clean_ctx = sanitize_physical_context(physical_context)
        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT INTO persona_turn_states (
                    turn_id, equipped_json, inventory_json, physical_stance, physical_context
                )
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(turn_id) DO UPDATE SET
                    equipped_json = excluded.equipped_json,
                    inventory_json = excluded.inventory_json,
                    physical_stance = excluded.physical_stance,
                    physical_context = excluded.physical_context
                """,
                (
                    turn_id,
                    json.dumps([it.model_dump() for it in equipped]),
                    json.dumps([it.model_dump() for it in inventory]),
                    norm_stance,
                    clean_ctx,
                ),
            )
            conn.commit()
        finally:
            conn.close()
