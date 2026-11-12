"""Safe filesystem path validation and resolution helpers for character media assets."""

from __future__ import annotations

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


def safe_resolve_character_media_dir(media_dir: str | Path, character_id: str) -> Path:
    """Resolve and verify a character's media folder stays within media_dir/characters."""
    clean_id = validate_safe_character_id(character_id)
    media_root = Path(media_dir).resolve()
    characters_root = (media_root / "characters").resolve()
    if not characters_root.is_relative_to(media_root):
        raise PathTraversalError("Path traversal forbidden.")

    target = (characters_root / clean_id).resolve()
    if target == characters_root or not target.is_relative_to(characters_root):
        raise PathTraversalError("Path traversal forbidden.")
    return target


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
    cat_dir = (char_dir / category).resolve()
    if not cat_dir.is_relative_to(char_dir):
        raise PathTraversalError("Path traversal forbidden.")

    target = (cat_dir / filename).resolve()
    if target == cat_dir or not target.is_relative_to(cat_dir):
        raise PathTraversalError("Path traversal forbidden.")
    return target
