"""Safe filesystem path validation and resolution helpers for character media assets."""

from __future__ import annotations

import os
import re
from pathlib import Path

_SAFE_ID_RE = re.compile(r"[a-zA-Z0-9_-]+")
_SAFE_FILENAME_RE = re.compile(r"[a-zA-Z0-9_.-]+")
_SAFE_PUBLIC_VERSION_RE = re.compile(r"v[0-9]+")
_VALID_MEDIA_CATEGORIES = ("portraits", "gallery")
_VALID_WORLD_MEDIA_CATEGORIES = ("images", "audio")


class PathTraversalError(ValueError):
    """Raised when a resolved filesystem path escapes its expected media directory."""


def validate_safe_character_id(character_id: str) -> str:
    """Validate that a character ID uses only safe identifier characters."""
    if not isinstance(character_id, str) or not _SAFE_ID_RE.fullmatch(character_id):
        raise ValueError("Invalid character ID.")
    return character_id


def validate_safe_media_id(media_id: str) -> str:
    """Validate that a media asset ID uses only safe identifier characters."""
    if not isinstance(media_id, str) or not _SAFE_ID_RE.fullmatch(media_id):
        raise ValueError("Invalid media ID.")
    return media_id


def _resolve_within_base(base_dir: str | Path, relative_subpath: str) -> Path:
    """Normalize base_dir + relative_subpath and ensure canonical target stays inside base_dir."""
    base_norm = os.path.normpath(os.path.abspath(str(base_dir)))
    if base_norm.endswith(os.sep):
        raise PathTraversalError("Path traversal forbidden.")

    target_norm = os.path.normpath(os.path.join(base_norm, relative_subpath))
    if not target_norm.startswith(base_norm + os.sep):
        raise PathTraversalError("Path traversal forbidden.")

    real_base = os.path.realpath(base_norm)
    if real_base.endswith(os.sep):
        raise PathTraversalError("Path traversal forbidden.")

    real_target = os.path.realpath(target_norm)
    if not real_target.startswith(real_base + os.sep):
        raise PathTraversalError("Path traversal forbidden.")
    return Path(real_target)


def safe_resolve_character_media_dir(media_dir: str | Path, character_id: str) -> Path:
    """Resolve and verify a character's media folder stays within media_dir/characters."""
    clean_id = validate_safe_character_id(character_id)
    characters_root = _resolve_within_base(media_dir, "characters")
    return _resolve_within_base(characters_root, clean_id)


def safe_resolve_media_file_path(
    media_dir: str | Path,
    character_id: str,
    category: str,
    filename: str,
) -> Path:
    """Validate category, character_id, and filename, and resolve safely within media_dir."""
    if category not in _VALID_MEDIA_CATEGORIES:
        raise ValueError("Invalid media category.")
    clean_id = validate_safe_character_id(character_id)
    if (
        not isinstance(filename, str)
        or filename.startswith(".")
        or not _SAFE_FILENAME_RE.fullmatch(filename)
    ):
        raise ValueError("Invalid filename.")

    char_dir = safe_resolve_character_media_dir(media_dir, clean_id)
    return _resolve_within_base(char_dir, os.path.join(category, filename))


def safe_resolve_world_media_root(
    media_dir: str | Path,
    category: str = "images",
) -> Path:
    """Resolve and verify the world media directory for a category within media_dir/worlds."""
    if category not in _VALID_WORLD_MEDIA_CATEGORIES:
        raise ValueError("Invalid world media category.")
    worlds_root = _resolve_within_base(media_dir, "worlds")
    return _resolve_within_base(worlds_root, category)


def safe_resolve_world_media_file_path(
    media_dir: str | Path,
    category: str,
    filename: str,
) -> Path:
    """Validate category and filename, and resolve safely within media_dir/worlds/{category}."""
    if (
        not isinstance(filename, str)
        or filename.startswith(".")
        or not _SAFE_FILENAME_RE.fullmatch(filename)
    ):
        raise ValueError("Invalid filename.")
    cat_dir = safe_resolve_world_media_root(media_dir, category)
    return _resolve_within_base(cat_dir, filename)


def safe_resolve_public_character_media_file_path(
    media_dir: str | Path,
    version_tag: str,
    seed_slug: str,
    category: str,
    filename: str,
) -> Path:
    """Validate public character media segments and resolve safely within media_dir/public/{version_tag}/characters/{seed_slug}/{category}."""
    if not isinstance(version_tag, str) or not _SAFE_PUBLIC_VERSION_RE.fullmatch(version_tag):
        raise ValueError("Invalid public media version.")
    clean_slug = validate_safe_character_id(seed_slug)
    if category not in _VALID_MEDIA_CATEGORIES:
        raise ValueError("Invalid media category.")
    if (
        not isinstance(filename, str)
        or filename.startswith(".")
        or not _SAFE_FILENAME_RE.fullmatch(filename)
    ):
        raise ValueError("Invalid filename.")
    public_root = _resolve_within_base(media_dir, "public")
    ver_dir = _resolve_within_base(public_root, version_tag)
    chars_dir = _resolve_within_base(ver_dir, "characters")
    slug_dir = _resolve_within_base(chars_dir, clean_slug)
    return _resolve_within_base(slug_dir, os.path.join(category, filename))
