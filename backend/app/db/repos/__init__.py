"""Domain repository mixins composed into CantinaRepository."""

from __future__ import annotations

from app.db.repos.base import RepositoryBase
from app.db.repos.schema_init import SchemaInitMixin
from app.db.repos.auth_users import AuthUsersMixin
from app.db.repos.worlds import WorldsMixin
from app.db.repos.world_locations import WorldLocationsMixin
from app.db.repos.characters import CharactersMixin
from app.db.repos.personas import PersonasMixin
from app.db.repos.campaigns import CampaignsMixin
from app.db.repos.prompt_presets import PromptPresetsMixin
from app.db.repos.turns import TurnsBranchesMixin
from app.db.repos.campaign_spatial import CampaignMapOpsMixin
from app.db.repos.notes import NotesMixin
from app.db.repos.base import (
    STAGED_CHARACTER_OWNERSHIP_TTL_SECONDS,
    UNSET,
    WEBAUTHN_CHALLENGE_TTL_SECONDS,
    _dump_provenance_json,
    _location_lore_vector_fields,
    slugify_tag,
    utc_now_iso,
)
