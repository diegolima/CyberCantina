"""Safe filesystem path validation and resolution helpers for character media assets."""

from __future__ import annotations

import os
import re
from pathlib import Path

_SAFE_ID_RE = re.compile(r"[a-zA-Z0-9_-]+")
_SAFE_FILENAME_RE = re.compile(r"[a-zA-Z0-9_.-]+")
_VALID_MEDIA_CATEGORIES = ("portraits", "gallery")


class PathTraversalError(ValueError):
    """Raised when a resolved filesystem path escapes its expected media directory."""


def validate_safe_character_id(character_id: str) -> str:
    """Validate that a character ID uses only safe identifier characters."""
    if not isinstance(character_id, str) or not _SAFE_ID_RE.fullmatch(character_id):
        raise ValueError("Invalid character ID.")
    return character_id


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
