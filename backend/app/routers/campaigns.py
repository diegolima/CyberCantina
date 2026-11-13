"""Campaign Management, Turn Streaming & Spatial State API Router.

Domain route modules live under ``app.routers.campaign_routes``; this module remains a
backwards-compatible router & test-patch facade."""

from __future__ import annotations

from app.auth import get_current_user  # noqa: F401
from app.config import settings  # noqa: F401
from app.db.repository import UNSET  # noqa: F401
from app.dependencies import (
    get_effective_agent_dispatch_mode,
    get_effective_persona_disclosure_mode,
    get_effective_user_model_settings,
    get_repo,
    resolve_effective_models,
    run_entity_pruner,
)  # noqa: F401
from app.engine.affective_engine import (
    compute_provisional_cognition_preview,
    ensure_snapshot_care_state,
    materialize_snapshot_with_care,
)  # noqa: F401
from app.engine.mentions import decompose_user_message  # noqa: F401
from app.engine.phase1_pre import run_phase1_pre_analysis  # noqa: F401
from app.engine.phase2_context import (
    assemble_four_zone_messages,
    resolve_actor_context_ceiling,
    resolve_character_previous_state,
    resolve_phase2_turn_context,
    was_character_present_on_turn,
)  # noqa: F401
from app.engine.phase3_actor import generate_clerk_cognition, stream_phase3_actor  # noqa: F401
from app.engine.phase3_cognition import run_phase3_multi_cognition  # noqa: F401
from app.engine.phase4_prose import stream_phase4_prose  # noqa: F401
from app.engine.phase5_clerk import run_phase5_post_turn_clerk  # noqa: F401
from app.engine.phase4_clerk import run_phase4_post_turn_clerk  # noqa: F401
from app.engine.clerk_placement import generate_clerk_starting_placement  # noqa: F401
from app.prompts.defaults import PROMPT_KEY_CLERK_WORLD_START_PLACEMENT  # noqa: F401
from app.providers.local_relay import RelayRemoteError, RelayUnavailableError  # noqa: F401
from app.schemas.auth import UserProfile  # noqa: F401
from app.schemas.persona import PersonaRecord, PersonaTurnStateSnapshot  # noqa: F401
from app.schemas.character import (
    CharacterRecord,
    CharacterStateSnapshot,
    CognitionBlock,
    ItemFlag,
    MemoryShard,
    format_item_names,
)  # noqa: F401
from app.schemas.turn import (
    CampaignCharacterMemoriesUpdateRequest,
    CampaignMapUpdatePayload,
    CampaignRecord,
    CampaignStateBundle,
    MechanicsTrigger,
    Phase3ProgressEvent,
    Phase4ProgressEvent,
    Phase5ProgressEvent,
    PreTurnAnalysis,
    RecalledMemoryItem,
    TurnSubmitRequest,
    WorldStateSnapshot,
)  # noqa: F401
from app.security.log_sanitize import sanitize_log_value  # noqa: F401
from app.schemas.world import (
    CampaignContainerLoreUpdatePayload,
    CampaignLocationLoreUpdatePayload,
)  # noqa: F401

from app.routers.campaign_routes.schemas_and_gate import (  # noqa: F401
    logger,
    router,
    CampaignCreateRequest,
    CampaignAddCharacterRequest,
    BranchCheckoutRequest,
    LocationOverrideRequest,
    ItemEquipToggleRequest,
    LinkedLocationCreateRequest,
    CampaignEdgeCreateRequest,
    CampaignEdgeDistanceUpdateRequest,
    CampaignTurnGate,
    campaign_turn_gate,
)
from app.routers.campaign_routes.crud_and_state import (  # noqa: F401
    list_campaigns,
    create_campaign,
    add_campaign_character,
    get_campaign_player_turn_state,
    delete_campaign,
    get_campaign_state,
    checkout_campaign_branch,
    override_campaign_location,
    toggle_campaign_item_equip,
    update_campaign_character_memories,
    delete_campaign_last_turn,
    delete_campaign_turn,
)
from app.routers.campaign_routes.spatial_routes import (  # noqa: F401
    create_campaign_linked_location,
    connect_campaign_locations,
    update_campaign_edge_distance,
    remove_campaign_edge,
    update_campaign_map,
    update_campaign_location_lore,
    update_campaign_container_lore,
)
from app.routers.campaign_routes.turn_streaming import (  # noqa: F401
    _StreamPacketItem,
    _StreamErrorItem,
    _StreamDoneSentinel,
    _PhaseQueueItem,
    _Phase4QueueItem,
    _Phase5QueueItem,
    _execute_turn_stream_events,
    _execute_turn_stream_events_unlocked,
    _RELAY_ERROR_MESSAGES,
    stream_campaign_turn,
    submit_campaign_turn_sync,
)
