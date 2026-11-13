"""Prompt preset CRUD and effective prompt resolution."""

from __future__ import annotations

import json
import uuid
from app.prompts import FACTORY_DEFAULT_PROMPTS
from app.schemas.prompt import PromptPresetRecord
from app.db.repos.base import utc_now_iso


class PromptPresetsMixin:
    """Prompt preset CRUD and effective prompt resolution."""

    def list_prompt_presets(self, user_id: str | None = None) -> list[PromptPresetRecord]:
        """List all available prompt presets (built-in system presets plus user-owned presets)."""
        conn = self._connect()
        try:
            if user_id:
                rows = conn.execute(
                    """
                    SELECT id, owner_id, name, description, is_builtin, prompts_json, created_at, updated_at
                    FROM prompt_presets
                    WHERE owner_id IS NULL OR owner_id = ?
                    ORDER BY is_builtin DESC, name ASC
                    """,
                    (user_id,),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT id, owner_id, name, description, is_builtin, prompts_json, created_at, updated_at
                    FROM prompt_presets
                    WHERE owner_id IS NULL
                    ORDER BY is_builtin DESC, name ASC
                    """
                ).fetchall()

            presets: list[PromptPresetRecord] = []
            for r in rows:
                p_dict = json.loads(r["prompts_json"] or "{}")
                merged = {**FACTORY_DEFAULT_PROMPTS, **p_dict}
                presets.append(
                    PromptPresetRecord(
                        id=r["id"],
                        owner_id=r["owner_id"],
                        name=r["name"],
                        description=r["description"] or "",
                        is_builtin=bool(r["is_builtin"]),
                        prompts=merged,
                        created_at=r["created_at"],
                        updated_at=r["updated_at"],
                    )
                )
            return presets
        finally:
            conn.close()

    def get_prompt_preset(self, preset_id: str) -> PromptPresetRecord | None:
        """Fetch a single prompt preset by ID, populated with merged fallback prompts."""
        conn = self._connect()
        try:
            r = conn.execute(
                """
                SELECT id, owner_id, name, description, is_builtin, prompts_json, created_at, updated_at
                FROM prompt_presets
                WHERE id = ?
                """,
                (preset_id,),
            ).fetchone()
            if not r:
                return None
            p_dict = json.loads(r["prompts_json"] or "{}")
            merged = {**FACTORY_DEFAULT_PROMPTS, **p_dict}
            return PromptPresetRecord(
                id=r["id"],
                owner_id=r["owner_id"],
                name=r["name"],
                description=r["description"] or "",
                is_builtin=bool(r["is_builtin"]),
                prompts=merged,
                created_at=r["created_at"],
                updated_at=r["updated_at"],
            )
        finally:
            conn.close()

    def create_prompt_preset(
        self,
        *,
        owner_id: str | None,
        name: str,
        description: str = "",
        prompts: dict[str, str] | None = None,
        is_builtin: bool = False,
        preset_id: str | None = None,
    ) -> PromptPresetRecord:
        """Create a new custom prompt preset."""
        pid = preset_id or f"preset_{uuid.uuid4().hex[:10]}"
        now = utc_now_iso()
        merged = {**FACTORY_DEFAULT_PROMPTS, **(prompts or {})}
        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT INTO prompt_presets (id, owner_id, name, description, is_builtin, prompts_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (pid, owner_id, name, description, 1 if is_builtin else 0, json.dumps(merged), now, now),
            )
            conn.commit()
        finally:
            conn.close()

        return PromptPresetRecord(
            id=pid,
            owner_id=owner_id,
            name=name,
            description=description,
            is_builtin=is_builtin,
            prompts=merged,
            created_at=now,
            updated_at=now,
        )

    def update_prompt_preset(
        self,
        preset_id: str,
        *,
        name: str | None = None,
        description: str | None = None,
        prompts: dict[str, str] | None = None,
        user_id: str | None = None,
    ) -> PromptPresetRecord:
        """Update an existing prompt preset's metadata or prompt templates."""
        existing = self.get_prompt_preset(preset_id)
        if not existing:
            raise KeyError(f"Preset '{preset_id}' not found")
        if existing.is_builtin:
            raise ValueError("Built-in presets cannot be edited directly. Clone or create a new custom preset instead.")
        if user_id and existing.owner_id and existing.owner_id != user_id:
            raise PermissionError("Cannot modify a preset owned by another user.")

        new_name = name if name is not None else existing.name
        new_desc = description if description is not None else existing.description
        new_prompts = dict(existing.prompts)
        if prompts is not None:
            new_prompts.update(prompts)
        now = utc_now_iso()

        conn = self._connect()
        try:
            conn.execute(
                """
                UPDATE prompt_presets
                SET name = ?, description = ?, prompts_json = ?, updated_at = ?
                WHERE id = ?
                """,
                (new_name, new_desc, json.dumps(new_prompts), now, preset_id),
            )
            conn.commit()
        finally:
            conn.close()

        return PromptPresetRecord(
            id=preset_id,
            owner_id=existing.owner_id,
            name=new_name,
            description=new_desc,
            is_builtin=False,
            prompts=new_prompts,
            created_at=existing.created_at,
            updated_at=now,
        )

    def delete_prompt_preset(self, preset_id: str, user_id: str | None = None) -> bool:
        """Delete a custom prompt preset. Built-in presets are protected."""
        existing = self.get_prompt_preset(preset_id)
        if not existing:
            return False
        if existing.is_builtin:
            raise ValueError("Built-in system presets cannot be deleted.")
        if user_id and existing.owner_id and existing.owner_id != user_id:
            raise PermissionError("Cannot delete a preset owned by another user.")

        conn = self._connect()
        try:
            conn.execute("UPDATE user_model_settings SET active_prompt_preset_id = NULL WHERE active_prompt_preset_id = ?", (preset_id,))
            conn.execute("UPDATE campaigns SET prompt_preset_id = NULL WHERE prompt_preset_id = ?", (preset_id,))
            conn.execute("DELETE FROM prompt_presets WHERE id = ?", (preset_id,))
            conn.commit()
            return True
        finally:
            conn.close()

    def set_user_active_prompt_preset(
        self, user_id: str, preset_id: str | None
    ) -> None:
        """Set or clear the active prompt preset for a user without modifying other settings."""
        conn = self._connect()
        try:
            now = utc_now_iso()
            conn.execute(
                """
                INSERT INTO user_model_settings (user_id, active_prompt_preset_id, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    active_prompt_preset_id = excluded.active_prompt_preset_id,
                    updated_at = excluded.updated_at
                """,
                (user_id, preset_id, now),
            )
            conn.commit()
        finally:
            conn.close()

    def reset_prompt_preset(self, preset_id: str, user_id: str | None = None) -> PromptPresetRecord:
        """Reset a custom prompt preset's templates back to the factory defaults."""
        existing = self.get_prompt_preset(preset_id)
        if not existing:
            raise KeyError(f"Preset '{preset_id}' not found")
        if user_id and existing.owner_id and existing.owner_id != user_id:
            raise PermissionError("Cannot reset a preset owned by another user.")

        now = utc_now_iso()
        conn = self._connect()
        try:
            conn.execute(
                """
                UPDATE prompt_presets
                SET prompts_json = ?, updated_at = ?
                WHERE id = ?
                """,
                (json.dumps(FACTORY_DEFAULT_PROMPTS), now, preset_id),
            )
            conn.commit()
        finally:
            conn.close()

        return PromptPresetRecord(
            id=preset_id,
            owner_id=existing.owner_id,
            name=existing.name,
            description=existing.description,
            is_builtin=existing.is_builtin,
            prompts=dict(FACTORY_DEFAULT_PROMPTS),
            created_at=existing.created_at,
            updated_at=now,
        )

    def resolve_effective_prompts(
        self,
        user_id: str | None = None,
        campaign_id: str | None = None,
    ) -> dict[str, str]:
        """Resolve effective prompt templates for an inference call with guaranteed fallback."""
        preset_id: str | None = None

        # 1. Campaign-level override takes precedence
        if campaign_id:
            try:
                camp = self.get_campaign(campaign_id)
                if camp.prompt_preset_id:
                    preset_id = camp.prompt_preset_id
            except Exception:
                pass

        # 2. User active preset
        if not preset_id and user_id:
            try:
                ums = self.get_user_model_settings(user_id)
                if ums and ums.active_prompt_preset_id:
                    preset_id = ums.active_prompt_preset_id
            except Exception:
                pass

        # 3. Fallback to default
        if not preset_id:
            preset_id = "builtin-default"

        preset = self.get_prompt_preset(preset_id)
        if preset:
            return {**FACTORY_DEFAULT_PROMPTS, **preset.prompts}
        return dict(FACTORY_DEFAULT_PROMPTS)
