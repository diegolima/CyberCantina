"""Router for the AI Magic Wand text enrichment service."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.config import settings
from app.dependencies import get_effective_user_model_settings, get_repo
from app.engine.llm_client import llm_client
from app.schemas.auth import UserProfile
from app.schemas.enrich import PromptEnrichRequest, PromptEnrichResponse

logger = logging.getLogger("cybercantina.enrich")

router = APIRouter(prefix="/api/enrich", tags=["enrich"])


@router.post("", response_model=PromptEnrichResponse)
async def enrich_text(
    req: PromptEnrichRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> PromptEnrichResponse:
    """Enrich or draft text using contextual domain references."""
    repo = get_repo()
    raw_text = req.current_text.strip()
    is_empty = len(raw_text) == 0

    _eff_actor, eff_clerk, _eff_wm, _eff_delegate, _eff_flags = get_effective_user_model_settings(
        current_user.id
    )

    context_summary_lines: list[str] = []
    role_instruction = ""

    if req.context_ref.scope == "campaign_turn":
        try:
            campaign = repo.get_campaign(req.context_ref.campaign_id, owner_id=current_user.id)
        except KeyError:
            raise HTTPException(status_code=404, detail="Campaign not found")

        parent_id = req.context_ref.parent_turn_id or campaign.active_leaf_turn_id
        if not parent_id:
            raise HTTPException(status_code=400, detail="Campaign has no turns")

        branch_turns = repo.get_branch_turn_chain(parent_id)
        valid_turn_ids = {t.id for t in branch_turns}
        leaf_turn = branch_turns[-1]

        world = repo.get_world(campaign.world_id, valid_turn_ids=valid_turn_ids)
        target_loc_id = req.context_ref.override_location_id or leaf_turn.world_snapshot.active_location_id
        try:
            active_loc = repo.get_location(target_loc_id)
        except KeyError:
            active_loc = repo.get_location(leaf_turn.world_snapshot.active_location_id)

        try:
            interlocutor = repo.get_character(campaign.character_id, campaign_id=campaign.id, valid_turn_ids=valid_turn_ids)
            npc_name = interlocutor.name
            npc_tagline = interlocutor.tagline
        except KeyError:
            npc_name = "the character"
            npc_tagline = ""

        context_summary_lines = [
            f"World Setting: {world.name} (Genre: {world.global_rules.genre}, Tone: {world.global_rules.tone})",
            f"Current Location: {active_loc.name} — {active_loc.summary}",
            f"Sensory markers: {', '.join(active_loc.environmental_tags) if active_loc.environmental_tags else 'none'}",
            f"Present NPC interlocutor: {npc_name} ({npc_tagline})",
            f"Recent story context: {leaf_turn.raw_prose[-300:] if leaf_turn.raw_prose else 'None'}",
        ]

        if req.field_role == "player_turn_prompt":
            role_instruction = (
                f"You are a creative writing assistant helping a HUMAN PLAYER formulate their action or spoken dialogue "
                f"directed toward {npc_name}.\n"
                f"STRICT PERSPECTIVE RULES:\n"
                f"- Write SOLELY from the human player's point of view.\n"
                f"- Put physical actions in *italics* and spoken dialogue in \"quotes\".\n"
                f"- NEVER write dialogue or thoughts for {npc_name}.\n"
                f"- NEVER decide how {npc_name} reacts or responds.\n"
                f"- Keep the length between 15 and {req.max_words} words."
            )
        elif req.field_role == "narrator_directive":
            role_instruction = (
                f"You are crafting an objective, detached directive for the neutral scene narrator.\n"
                f"Focus on sensory details, environmental shifts, or ambient sounds in {active_loc.name}.\n"
                f"Do NOT tell the protagonist how to feel or act."
            )
        else:
            role_instruction = f"Refine the {req.field_role} to fit {world.global_rules.genre} and {world.global_rules.tone}."

    elif req.context_ref.scope == "world_location":
        try:
            world = repo.get_world(req.context_ref.world_id)
        except KeyError:
            raise HTTPException(status_code=404, detail="World not found")

        loc_name = "Location"
        if req.context_ref.location_id:
            try:
                loc = repo.get_location(req.context_ref.location_id)
                loc_name = loc.name
            except KeyError:
                pass

        context_summary_lines = [
            f"World: {world.name} ({world.global_rules.genre} — {world.global_rules.tone})",
            f"Setting overview: {world.global_rules.setting_overview}",
            f"Target Location: {loc_name}",
        ]
        role_instruction = (
            f"Write an atmospheric, sensory location description ({req.max_words} words max) "
            f"grounded in the world's genre ({world.global_rules.genre}) and tone ({world.global_rules.tone})."
        )

    elif req.context_ref.scope == "character_field":
        try:
            char = repo.get_character(req.context_ref.character_id)
        except KeyError:
            raise HTTPException(status_code=404, detail="Character not found")

        context_summary_lines = [
            f"Character: {char.name} ({char.tagline})",
            f"Persona: {char.core_persona}",
        ]
        role_instruction = (
            f"Enhance the character's {req.field_role} into evocative, consistent prose ({req.max_words} words max)."
        )

    # Instruction modifiers
    instruction_guidance = ""
    if req.instruction == "polish":
        instruction_guidance = "Polish grammar and vocabulary, preserving the exact tone and intent."
    elif req.instruction == "expand":
        instruction_guidance = "Add vivid sensory textures and descriptive detail."
    elif req.instruction == "concise":
        instruction_guidance = "Make the text punchy, concise, and direct."

    if is_empty:
        user_prompt = (
            f"Draft a compelling starting draft from scratch based on the following scene context.\n\n"
            f"=== CONTEXT ===\n" + "\n".join(context_summary_lines) + "\n\n"
            f"Output ONLY the final text without commentary, markdown headers, or quotation wrappers."
        )
    else:
        user_prompt = (
            f"Enhance the following text according to the context and instructions.\n\n"
            f"=== CONTEXT ===\n" + "\n".join(context_summary_lines) + "\n\n"
            f"=== USER DRAFT ===\n{raw_text}\n\n"
            f"{instruction_guidance}\n"
            f"Output ONLY the enhanced text without preamble, explanations, or meta-commentary."
        )

    messages = [
        {"role": "system", "content": role_instruction},
        {"role": "user", "content": user_prompt},
    ]

    try:
        enriched_text = await llm_client.complete_text(
            messages=messages,
            profile=eff_clerk,
            temperature=0.7,
            max_tokens=min(req.max_words * 4, 300),
        )
        cleaned = enriched_text.strip()
        if req.single_line:
            cleaned = " ".join(cleaned.splitlines()).strip()
        return PromptEnrichResponse(
            enriched_text=cleaned,
            mode_applied="generated" if is_empty else "enriched",
            model_used=eff_clerk.model,
        )
    except Exception as exc:
        logger.warning("Enrichment failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"AI enrichment failed: {exc}")
