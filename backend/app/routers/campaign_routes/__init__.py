"""Campaign REST & SSE endpoints package.

Submodules:
- `schemas_and_gate`: Request schemas, `CampaignTurnGate` concurrency lock, and facade attribute helpers
- `crud_and_state`: Campaign CRUD, turn/branch checkout, and bundle retrieval routes
- `spatial_routes`: In-campaign linked locations, edges, and lore/container overrides
- `turn_streaming`: SSE 5-phase turn streaming (`/turn/stream`) and synchronous `/turn` endpoint
"""

from __future__ import annotations

from app.routers.campaign_routes.schemas_and_gate import (
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
from app.routers.campaign_routes.crud_and_state import (
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
from app.routers.campaign_routes.spatial_routes import (
    create_campaign_linked_location,
    connect_campaign_locations,
    update_campaign_edge_distance,
    remove_campaign_edge,
    update_campaign_map,
    update_campaign_location_lore,
    update_campaign_container_lore,
)
from app.routers.campaign_routes.turn_streaming import (
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

__all__ = [
    "logger",
    "router",
    "CampaignCreateRequest",
    "CampaignAddCharacterRequest",
    "BranchCheckoutRequest",
    "LocationOverrideRequest",
    "ItemEquipToggleRequest",
    "LinkedLocationCreateRequest",
    "CampaignEdgeCreateRequest",
    "CampaignEdgeDistanceUpdateRequest",
    "CampaignTurnGate",
    "campaign_turn_gate",
    "list_campaigns",
    "create_campaign",
    "add_campaign_character",
    "get_campaign_player_turn_state",
    "delete_campaign",
    "get_campaign_state",
    "checkout_campaign_branch",
    "override_campaign_location",
    "toggle_campaign_item_equip",
    "update_campaign_character_memories",
    "delete_campaign_last_turn",
    "delete_campaign_turn",
    "create_campaign_linked_location",
    "connect_campaign_locations",
    "update_campaign_edge_distance",
    "remove_campaign_edge",
    "update_campaign_map",
    "update_campaign_location_lore",
    "update_campaign_container_lore",
    "_StreamPacketItem",
    "_StreamErrorItem",
    "_StreamDoneSentinel",
    "_PhaseQueueItem",
    "_Phase4QueueItem",
    "_Phase5QueueItem",
    "_execute_turn_stream_events",
    "_execute_turn_stream_events_unlocked",
    "_RELAY_ERROR_MESSAGES",
    "stream_campaign_turn",
    "submit_campaign_turn_sync",
]
