"""Schemas for native CyberCantina archive (.zcc) export and import."""

from __future__ import annotations

from typing import Any, Literal
from pydantic import BaseModel, Field

ImportConflictStrategy = Literal["copy", "overwrite", "skip"]


class ZccManifestContents(BaseModel):
    """Counts of entities bundled in the archive."""

    characters_count: int = 0
    worlds_count: int = 0
    personas_count: int = 0
    campaigns_count: int = 0
    media_files_count: int = 0
    images_count: int = 0
    videos_count: int = 0


class ZccManifest(BaseModel):
    """Top-level manifest descriptor stored at root of .zcc archive."""

    format_version: int = 1
    generator: str = "CyberCantina"
    generator_version: str = "0.5.0"
    exported_at: str
    description: str = ""
    contents: ZccManifestContents = Field(default_factory=ZccManifestContents)
    dependencies: dict[str, list[str]] = Field(default_factory=dict)


class ExportBundleRequest(BaseModel):
    """Payload to trigger a multi-entity .zcc export."""

    character_ids: list[str] = Field(default_factory=list)
    world_ids: list[str] = Field(default_factory=list)
    persona_ids: list[str] = Field(default_factory=list)
    bundle_name: str = Field(default="cybercantina_export", max_length=100)
    include_world_media: bool = True
    include_videos: bool = False
    selected_video_ids: list[str] | None = None
    password: str | None = Field(default=None, min_length=1, max_length=256)


class ExportCharacterOptions(BaseModel):
    """Options when exporting an individual character."""

    include_world: bool = False
    include_videos: bool = False
    password: str | None = Field(default=None, min_length=1, max_length=256)


class ExportWorldOptions(BaseModel):
    """Options when exporting an individual world."""

    include_characters: bool = True
    include_media: bool = True
    include_videos: bool = False
    password: str | None = Field(default=None, min_length=1, max_length=256)


class ExportCampaignRequest(BaseModel):
    """Payload to export a running campaign into a .zcc v2 archive."""

    timeline_scope: Literal["full", "active"] = "full"
    strip_bookmark_comments: bool = False
    include_world_media: bool = True
    include_videos: bool = False
    include_gm_chat: bool = False
    selected_video_ids: list[str] | None = None
    password: str | None = Field(default=None, min_length=1, max_length=256)


class ImportUnlockRequest(BaseModel):
    """Payload to unlock a password-protected staged .zcc archive."""

    staged_token: str = Field(..., min_length=1, max_length=128)
    password: str = Field(..., min_length=1, max_length=256)


class ImportEntityConflict(BaseModel):
    """Conflict information when an incoming entity matches an existing one."""

    category: Literal["character", "world", "persona"]
    incoming_id: str
    name: str
    existing_id: str


class EntitySummary(BaseModel):
    """Lightweight summary of an entity found in an import archive."""

    id: str
    name: str
    tagline: str = ""
    category: Literal["character", "world", "persona", "campaign"]
    extra_info: dict[str, Any] = Field(default_factory=dict)


class ImportInspectResponse(BaseModel):
    """Result of inspecting an uploaded archive or character card."""

    is_native: bool
    format_type: Literal["zcc", "sillytavern_png", "sillytavern_json", "unknown"]
    staged_token: str
    requires_password: bool = False
    manifest: ZccManifest | None = None
    characters: list[EntitySummary] = Field(default_factory=list)
    worlds: list[EntitySummary] = Field(default_factory=list)
    personas: list[EntitySummary] = Field(default_factory=list)
    campaigns: list[EntitySummary] = Field(default_factory=list)
    conflicts: list[ImportEntityConflict] = Field(default_factory=list)
    sillytavern_draft: dict[str, Any] | None = None
    warnings: list[str] = Field(default_factory=list)
    images_count: int = 0
    images_bytes: int = 0
    videos_count: int = 0
    videos_bytes: int = 0


class ImportCommitRequest(BaseModel):
    """User instructions for committing a staged import bundle."""

    staged_token: str
    conflict_strategies: dict[str, ImportConflictStrategy] = Field(default_factory=dict)
    default_conflict_strategy: ImportConflictStrategy = "copy"
    import_images: bool = True
    import_videos: bool = True
    import_campaign_assets_as_standalone: bool = False


class ImportCommitResponse(BaseModel):
    """Result of committing an import bundle."""

    success: bool
    imported_characters: list[str] = Field(default_factory=list)
    imported_worlds: list[str] = Field(default_factory=list)
    imported_personas: list[str] = Field(default_factory=list)
    imported_campaigns: list[str] = Field(default_factory=list)
    skipped_entities: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    message: str = ""
