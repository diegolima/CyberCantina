"""FastAPI entrypoint and 4-Phase Turn Orchestrator for CyberCantina."""

from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from typing import Any

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.config import AppSettings, persist_settings, settings
from app.db.repository import CantinaRepository
from app.db.seed import ensure_default_seed
from app.engine.llm_client import (
    OllamaStatusResponse,
    auto_configure_ollama_models,
    query_ollama_status,
)
from app.engine.phase1_pre import run_phase1_pre_analysis
from app.engine.phase2_context import assemble_four_zone_messages, was_character_present_on_turn
from app.engine.phase3_actor import stream_phase3_actor
from app.engine.phase4_clerk import run_phase4_post_turn_clerk
from app.schemas.character import (
    CharacterRecord,
    CharacterStateSnapshot,
    CharacterUpdatePayload,
    CharacterWizardDraft,
    CharacterWizardSeed,
    CognitionBlock,
)
from app.schemas.turn import (
    CampaignRecord,
    CampaignStateBundle,
    TurnSubmitRequest,
    WorldStateSnapshot,
)
from app.schemas.world import (
    WorldRecord,
    WorldUpdatePayload,
    WorldWizardDraft,
    WorldWizardSeed,
)
from app.wizards.character_wizard import generate_character_draft
from app.wizards.world_wizard import generate_world_draft


def get_repo() -> CantinaRepository:
    return CantinaRepository(settings.db_path)


def run_entity_pruner() -> dict[str, list[str]]:
    """Prune any characters and worlds marked pending_deletion that are no longer referenced by any campaign."""
    repo = get_repo()
    return {
        "pruned_characters": repo.prune_pending_deletion_characters(),
        "pruned_worlds": repo.prune_pending_deletion_worlds(),
    }


async def _periodic_entity_pruner(interval_seconds: float = 60.0) -> None:
    """Background task that periodically prunes unreferenced soft-deleted characters and worlds."""
    while True:
        await asyncio.sleep(interval_seconds)
        try:
            run_entity_pruner()
        except Exception:
            pass


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    repo = get_repo()
    repo.init_db()
    run_entity_pruner()
    ensure_default_seed(repo)
    await auto_configure_ollama_models()
    pruner_task = asyncio.create_task(_periodic_entity_pruner())
    try:
        yield
    finally:
        pruner_task.cancel()
        with suppress(asyncio.CancelledError):
            await pruner_task


app = FastAPI(
    title="CyberCantina Agentic Roleplay API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CampaignCreateRequest(BaseModel):
    name: str
    world_id: str
    character_id: str
    character_ids: list[str] | None = None
    character_locations: dict[str, str] | None = None
    opening_prose: str | None = None


class CampaignAddCharacterRequest(BaseModel):
    character_id: str
    location_id: str | None = None


class BranchCheckoutRequest(BaseModel):
    turn_id: str


class LocationOverrideRequest(BaseModel):
    location_id: str


class LinkedLocationCreateRequest(BaseModel):
    from_location_id: str
    name: str
    compass_direction: str
    travel_minutes: int = 2
    description: str
    environmental_tags: list[str] = []


class CharacterCommitRequest(BaseModel):
    draft: CharacterWizardDraft
    world_id: str | None = None


# ------------------------------------------------------------------
# Settings & Health
# ------------------------------------------------------------------


@app.get("/api/health")
def health_check() -> dict[str, str]:
    return {"status": "ok", "service": "cybercantina-backend"}


@app.get("/api/ollama/status", response_model=OllamaStatusResponse)
async def get_ollama_status(base_url: str | None = None) -> OllamaStatusResponse:
    return await query_ollama_status(base_url)


@app.get("/api/settings", response_model=AppSettings)
def get_settings() -> AppSettings:
    return settings


@app.put("/api/settings", response_model=AppSettings)
def update_settings(updated: AppSettings) -> AppSettings:
    settings.actor_profile = updated.actor_profile
    settings.clerk_profile = updated.clerk_profile
    settings.embedding_profile = updated.embedding_profile
    settings.memory_config = updated.memory_config
    settings.allow_offline_fallback = updated.allow_offline_fallback
    persist_settings(settings)
    return settings


# ------------------------------------------------------------------
# Worlds & 1.2 World Creation Wizard
# ------------------------------------------------------------------


@app.get("/api/worlds", response_model=list[WorldRecord])
def list_worlds() -> list[WorldRecord]:
    return get_repo().list_worlds()


@app.get("/api/worlds/{world_id}", response_model=WorldRecord)
def get_world(world_id: str) -> WorldRecord:
    try:
        return get_repo().get_world(world_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/wizards/world/draft", response_model=WorldWizardDraft)
async def wizard_draft_world(seed: WorldWizardSeed) -> WorldWizardDraft:
    try:
        return await generate_world_draft(seed)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/wizards/world/commit", response_model=WorldRecord)
async def wizard_commit_world(draft: WorldWizardDraft) -> WorldRecord:
    return await get_repo().acreate_world_from_draft(draft)


@app.put("/api/worlds/{world_id}", response_model=WorldRecord)
async def update_world(world_id: str, payload: WorldUpdatePayload) -> WorldRecord:
    """Update a world in-place if unused, or silently fork a new version if used by campaigns."""
    try:
        return await get_repo().aupdate_world(world_id, payload)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.delete("/api/worlds/{world_id}")
def delete_world(
    world_id: str,
    background_tasks: BackgroundTasks,
) -> dict[str, int | str | bool]:
    """Mark a world as pending deletion (hiding it from the UI) and trigger background pruning."""
    repo = get_repo()
    try:
        result = repo.mark_world_pending_deletion(world_id)
        background_tasks.add_task(run_entity_pruner)
        return result
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


# ------------------------------------------------------------------
# Characters & 1.1 Character Creation Wizard
# ------------------------------------------------------------------


@app.get("/api/characters", response_model=list[CharacterRecord])
def list_characters() -> list[CharacterRecord]:
    return get_repo().list_characters()


@app.get("/api/characters/{character_id}", response_model=CharacterRecord)
def get_character(character_id: str) -> CharacterRecord:
    try:
        return get_repo().get_character(character_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/wizards/character/draft", response_model=CharacterWizardDraft)
async def wizard_draft_character(seed: CharacterWizardSeed) -> CharacterWizardDraft:
    repo = get_repo()
    world = None
    if seed.world_id:
        try:
            world = repo.get_world(seed.world_id)
        except KeyError:
            world = None
    try:
        return await generate_character_draft(seed, world=world)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/wizards/character/commit", response_model=CharacterRecord)
async def wizard_commit_character(req: CharacterCommitRequest) -> CharacterRecord:
    return await get_repo().acreate_character_from_draft(req.draft, world_id=req.world_id)


@app.put("/api/characters/{character_id}", response_model=CharacterRecord)
async def update_character(character_id: str, payload: CharacterUpdatePayload) -> CharacterRecord:
    """Update a character in-place if unused, or silently fork a new version if used by campaigns."""
    try:
        return await get_repo().aupdate_character(character_id, payload)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.delete("/api/characters/{character_id}")
def delete_character(
    character_id: str,
    background_tasks: BackgroundTasks,
) -> dict[str, int | str | bool]:
    """Mark a character as pending deletion (hiding it from the UI) and trigger background pruning."""
    repo = get_repo()
    try:
        result = repo.mark_character_pending_deletion(character_id)
        background_tasks.add_task(run_entity_pruner)
        return result
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


# ------------------------------------------------------------------
# Campaigns & Branching Turn Tree
# ------------------------------------------------------------------


@app.get("/api/campaigns", response_model=list[CampaignRecord])
def list_campaigns() -> list[CampaignRecord]:
    return get_repo().list_campaigns()


@app.post("/api/campaigns", response_model=CampaignStateBundle)
def create_campaign(req: CampaignCreateRequest) -> CampaignStateBundle:
    repo = get_repo()
    try:
        camp = repo.create_campaign(
            name=req.name,
            world_id=req.world_id,
            character_id=req.character_id,
            character_ids=req.character_ids,
            character_locations=req.character_locations,
            opening_prose=req.opening_prose,
        )
        return repo.get_campaign_state_bundle(camp.id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/campaigns/{campaign_id}/characters", response_model=CampaignStateBundle)
def add_campaign_character(
    campaign_id: str,
    req: CampaignAddCharacterRequest,
) -> CampaignStateBundle:
    """Add an additional character to a campaign (optionally stationed at a specific location_id)."""
    repo = get_repo()
    try:
        return repo.add_character_to_campaign(
            campaign_id=campaign_id,
            character_id=req.character_id,
            location_id=req.location_id,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.delete("/api/campaigns/{campaign_id}")
def delete_campaign(
    campaign_id: str,
    background_tasks: BackgroundTasks,
) -> dict[str, str]:
    """Delete a campaign and its entire timeline, then prune any unreferenced pending_deletion characters and worlds."""
    repo = get_repo()
    try:
        repo.delete_campaign(campaign_id)
        background_tasks.add_task(run_entity_pruner)
        return {"status": "deleted", "campaign_id": campaign_id}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/campaigns/{campaign_id}/state", response_model=CampaignStateBundle)
def get_campaign_state(campaign_id: str) -> CampaignStateBundle:
    try:
        return get_repo().get_campaign_state_bundle(campaign_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/campaigns/{campaign_id}/checkout", response_model=CampaignStateBundle)
def checkout_campaign_branch(
    campaign_id: str,
    req: BranchCheckoutRequest,
) -> CampaignStateBundle:
    try:
        return get_repo().checkout_turn_branch(campaign_id, req.turn_id)
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/campaigns/{campaign_id}/locations", response_model=CampaignStateBundle)
def create_campaign_linked_location(
    campaign_id: str,
    req: LinkedLocationCreateRequest,
) -> CampaignStateBundle:
    """Manually create a new location linked to an existing one (bound to the active timeline)."""
    try:
        return get_repo().create_linked_location(
            campaign_id,
            from_location_id=req.from_location_id,
            name=req.name,
            description=req.description,
            environmental_tags=req.environmental_tags,
            compass_direction=req.compass_direction,
            travel_minutes=req.travel_minutes,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/campaigns/{campaign_id}/location-override", response_model=CampaignStateBundle)
def override_campaign_location(
    campaign_id: str,
    req: LocationOverrideRequest,
) -> CampaignStateBundle:
    """Override the current active location on the leaf turn (fixing Clerk hallucinations for the next turn or swipe)."""
    try:
        return get_repo().override_campaign_location(campaign_id, req.location_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.delete("/api/campaigns/{campaign_id}/turns/last", response_model=CampaignStateBundle)
def delete_campaign_last_turn(campaign_id: str) -> CampaignStateBundle:
    """Delete the last user message turn on the active branch, including all generated swipes."""
    try:
        return get_repo().delete_last_turn(campaign_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.delete("/api/campaigns/{campaign_id}/turns/{turn_id}", response_model=CampaignStateBundle)
def delete_campaign_turn(campaign_id: str, turn_id: str) -> CampaignStateBundle:
    """Delete the specified last user message turn (and its sibling swipes) from the campaign."""
    try:
        return get_repo().delete_last_turn(campaign_id, turn_id=turn_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# ------------------------------------------------------------------
# 4-Phase Turn Execution Pipeline (SSE Stream & Sync REST)
# ------------------------------------------------------------------


async def _execute_turn_stream_events(
    campaign_id: str,
    req: TurnSubmitRequest,
) -> AsyncIterator[dict[str, Any]]:
    """Orchestrate Phases 1, 2, 3, and 4 for a single turn, yielding structured events."""
    repo = get_repo()
    campaign = repo.get_campaign(campaign_id)
    parent_id = req.parent_turn_id or campaign.active_leaf_turn_id
    if not parent_id:
        raise RuntimeError(f"Campaign '{campaign_id}' has no parent turn node")

    # Resolve parent branch chain (allows instantaneous swipe/branch from any node!)
    branch_turns = repo.get_branch_turn_chain(parent_id)
    valid_turn_ids = {t.id for t in branch_turns}
    parent_turn = branch_turns[-1]

    world = repo.get_world(campaign.world_id, valid_turn_ids=valid_turn_ids)
    primary_character = repo.get_character(campaign.character_id)
    participant_ids = campaign.participant_character_ids or [campaign.character_id]
    participants: list[CharacterRecord] = []
    for cid in participant_ids:
        try:
            participants.append(repo.get_character(cid))
        except KeyError:
            continue
    if not participants:
        participants = [primary_character]
    participants_by_id = {c.id: c for c in participants}

    parent_active_loc_id = parent_turn.world_snapshot.active_location_id
    if req.override_location_id:
        override_loc = repo.get_location(req.override_location_id)
        if override_loc.world_id == world.id:
            active_location = override_loc
            if active_location.created_at_turn_id:
                valid_turn_ids = set(valid_turn_ids) | {active_location.created_at_turn_id}
            parent_turn.world_snapshot.active_location_id = active_location.id
            for st in parent_turn.character_states.values():
                if st.current_location_id == parent_active_loc_id:
                    st.current_location_id = active_location.id
            if parent_turn.character_state.current_location_id == parent_active_loc_id:
                parent_turn.character_state.current_location_id = active_location.id
        else:
            active_location = repo.get_location(parent_active_loc_id)
    else:
        active_location = repo.get_location(parent_active_loc_id)

    neighbors = repo.get_neighbor_locations(
        world.id,
        active_location.id,
        valid_turn_ids=valid_turn_ids,
    )
    episodic_chunks = repo.get_branch_episodic_chunks(campaign.id, valid_turn_ids)

    # Filter characters physically present in active_location (room-level spatial isolation)
    present_characters = [
        c
        for c in participants
        if parent_turn.character_states.get(c.id, parent_turn.character_state).current_location_id
        == active_location.id
    ]
    if not present_characters:
        present_characters = [primary_character]

    # Collect known entity tags from lore and present characters' shards for Phase 1
    known_entities: list[str] = [c.name for c in present_characters]
    for lore in world.lore_nodes:
        known_entities.append(lore.title)
        known_entities.extend(lore.entity_tags)
    for c in present_characters:
        for shard in c.memory_shards:
            known_entities.extend(shard.keywords)
    for loc in world.locations:
        known_entities.append(loc.name)

    # PHASE 1: Auxiliary Pre-Turn Analysis, Multi-Character Speaker Orchestration & RNG Mechanics
    pre_turn = await run_phase1_pre_analysis(
        user_message=req.user_message,
        character=present_characters[0],
        active_location=active_location,
        neighbors=neighbors,
        known_entities=known_entities,
        manual_dice_override=req.manual_dice_override,
        present_characters=present_characters,
        previous_speaker_id=parent_turn.actor_id,
    )

    # Resolve active speaker selected by Phase 1 from characters present in the room
    character = (
        participants_by_id.get(pre_turn.active_speaker_id or "")
        if pre_turn.active_speaker_id in {c.id for c in present_characters}
        else None
    ) or present_characters[0]
    prev_char_state = parent_turn.character_states.get(
        character.id,
        CharacterStateSnapshot(
            turn_id=parent_turn.id,
            character_id=character.id,
            current_location_id=active_location.id,
            mood_label=character.baseline_psyche.mood_label,
            valence=character.baseline_psyche.valence,
            arousal=character.baseline_psyche.arousal,
            active_want=character.baseline_psyche.default_want,
            active_plan=character.baseline_psyche.default_plan,
            relationship_notes={"user": "Acquaintance / Uncertain trust"},
            inventory=list(character.inventory),
        ),
    )

    # Hybrid GraphRAG Memory Retrieval (filtered by valid_turn_ids & character room presence)
    character_present_turn_ids = {
        t.id for t in branch_turns if was_character_present_on_turn(t, character.id)
    }
    recalled_items = await repo.vector_store.search_memories(
        queries=pre_turn.memory_search_queries,
        mentioned_entities=pre_turn.mentioned_entities,
        world_id=world.id,
        character_id=character.id,
        campaign_id=campaign.id,
        valid_branch_turn_ids=valid_turn_ids,
        character_present_turn_ids=character_present_turn_ids,
        top_k=settings.memory_config.rag_top_k,
    )

    yield {
        "event": "phase1_complete",
        "data": {
            "pre_turn": pre_turn.model_dump(),
            "recalled_items": [m.model_dump() for m in recalled_items],
        },
    }

    # PHASE 2: 4-Zone KV-Cache-Preserving Context Assembly
    messages = assemble_four_zone_messages(
        world=world,
        character=character,
        branch_turns=branch_turns,
        episodic_chunks=episodic_chunks,
        active_location=active_location,
        neighbors=neighbors,
        recalled_items=recalled_items,
        pre_turn=pre_turn,
        user_message=req.user_message,
        present_characters=present_characters,
        character_name_map={c.id: c.name for c in participants},
    )

    # PHASE 3: Guided Single-Pass <cognition> + Narrative Prose Streaming
    final_cognition = CognitionBlock(
        recall="",
        feeling=prev_char_state.mood_label,
        valence=prev_char_state.valence,
        arousal=prev_char_state.arousal,
        want=prev_char_state.active_want,
        plan=prev_char_state.active_plan,
    )
    final_prose = ""

    async for item in stream_phase3_actor(
        messages=messages,
        user_message=req.user_message,
        character=character,
        previous_state=prev_char_state,
        active_location=active_location,
        neighbors=neighbors,
        recalled_items=recalled_items,
        pre_turn=pre_turn,
    ):
        if item["event"] == "actor_finished":
            final_cognition = CognitionBlock.model_validate(item["data"]["cognition"])
            final_prose = item["data"]["raw_prose"]
        else:
            yield item

    # Persist initial Turn Node prior to Phase 4 Clerk
    new_turn_id = f"turn_{uuid.uuid4().hex[:10]}"
    new_depth = parent_turn.depth_index + 1
    initial_world_snapshot = WorldStateSnapshot(
        turn_id=new_turn_id,
        world_timestamp=parent_turn.world_snapshot.world_timestamp,
        active_location_id=active_location.id,
        scene_flags=parent_turn.world_snapshot.scene_flags,
    )
    initial_char_state = CharacterStateSnapshot(
        turn_id=new_turn_id,
        character_id=character.id,
        current_location_id=active_location.id,
        mood_label=final_cognition.feeling[:80] or prev_char_state.mood_label,
        valence=final_cognition.valence,
        arousal=final_cognition.arousal,
        active_want=final_cognition.want or prev_char_state.active_want,
        active_plan=final_cognition.plan or prev_char_state.active_plan,
        relationship_notes=prev_char_state.relationship_notes,
        inventory=list(prev_char_state.inventory),
    )

    saved_turn = repo.save_turn_node(
        turn_id=new_turn_id,
        campaign_id=campaign.id,
        parent_turn_id=parent_turn.id,
        depth_index=new_depth,
        user_message=req.user_message,
        actor_id=character.id,
        raw_prose=final_prose,
        cognition=final_cognition,
        pre_turn=pre_turn,
        world_snapshot=initial_world_snapshot,
        character_state=initial_char_state,
        recalled_items=recalled_items,
    )

    yield {"event": "turn_saved", "data": saved_turn.model_dump()}

    # PHASE 4: Post-Turn Clerk (Clock, Spatial Graph Transitions, Episodic Summarizer)
    updated_turn, _chunks = await run_phase4_post_turn_clerk(
        repo=repo,
        campaign_id=campaign.id,
        world_id=world.id,
        character=character,
        completed_turn=saved_turn,
        active_location=active_location,
        neighbors=neighbors,
    )
    bundle = repo.get_campaign_state_bundle(campaign.id)
    yield {
        "event": "phase4_complete",
        "data": {
            "turn": updated_turn.model_dump(),
            "state_bundle": bundle.model_dump(),
        },
    }


@app.post("/api/campaigns/{campaign_id}/turns/stream")
async def stream_campaign_turn(
    campaign_id: str,
    req: TurnSubmitRequest,
) -> StreamingResponse:
    """SSE endpoint streaming Phase 1, Phase 3 (<cognition> + prose), and Phase 4 updates."""

    async def _sse_generator() -> AsyncIterator[str]:
        try:
            async for packet in _execute_turn_stream_events(campaign_id, req):
                ev_name = packet["event"]
                payload = json.dumps(packet["data"])
                yield f"event: {ev_name}\ndata: {payload}\n\n"
        except Exception as exc:
            err_payload = json.dumps({"error": str(exc)})
            yield f"event: error\ndata: {err_payload}\n\n"

    return StreamingResponse(
        _sse_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/campaigns/{campaign_id}/turns", response_model=CampaignStateBundle)
async def submit_campaign_turn_sync(
    campaign_id: str,
    req: TurnSubmitRequest,
) -> CampaignStateBundle:
    """Execute all 4 phases synchronously and return the updated CampaignStateBundle."""
    try:
        final_bundle: dict[str, Any] | None = None
        async for packet in _execute_turn_stream_events(campaign_id, req):
            if packet["event"] == "phase4_complete":
                final_bundle = packet["data"]["state_bundle"]
        if final_bundle is not None:
            return CampaignStateBundle.model_validate(final_bundle)
        return get_repo().get_campaign_state_bundle(campaign_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
