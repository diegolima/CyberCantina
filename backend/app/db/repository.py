"""Branch-aware SQLite repository for Worlds, Characters, Spatial Graph, and Turn Trees."""

from __future__ import annotations

from app.db.repos import (
    AuthUsersMixin,
    CampaignMapOpsMixin,
    CampaignsMixin,
    CharactersMixin,
    NotesMixin,
    PersonasMixin,
    PromptPresetsMixin,
    RepositoryBase,
    STAGED_CHARACTER_OWNERSHIP_TTL_SECONDS,
    SchemaInitMixin,
    TurnsBranchesMixin,
    UNSET,
    WEBAUTHN_CHALLENGE_TTL_SECONDS,
    WorldLocationsMixin,
    WorldsMixin,
    _dump_provenance_json,
    _location_lore_vector_fields,
    slugify_tag,
    utc_now_iso,
)
from app.db.vector_store import embed_text


class CantinaRepository(
    NotesMixin,
    CampaignMapOpsMixin,
    TurnsBranchesMixin,
    PromptPresetsMixin,
    CampaignsMixin,
    PersonasMixin,
    CharactersMixin,
    WorldLocationsMixin,
    WorldsMixin,
    AuthUsersMixin,
    SchemaInitMixin,
    RepositoryBase,
):
    """Data access layer with native turn-tree and spatial graph traversal."""


__all__ = [
    "CantinaRepository",
    "STAGED_CHARACTER_OWNERSHIP_TTL_SECONDS",
    "UNSET",
    "WEBAUTHN_CHALLENGE_TTL_SECONDS",
    "_dump_provenance_json",
    "_location_lore_vector_fields",
    "embed_text",
    "slugify_tag",
    "utc_now_iso",
]
