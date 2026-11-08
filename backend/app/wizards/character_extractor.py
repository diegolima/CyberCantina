"""Extraction and surgical prose rephrasing for character bio and core persona."""

from __future__ import annotations

import logging
from pydantic import BaseModel, Field

from app.config import ModelProfile, settings
from app.engine.llm_client import llm_client

logger = logging.getLogger("cybercantina.wizards.character_extractor")


class ExtractedFeaturesLLMOutput(BaseModel):
    distinctive_features: list[str] = Field(
        default_factory=list,
        description="Concise visual, physical, cybernetic, or anatomical traits (e.g. 'scar across left eyebrow', 'cybernetic eye', 'chrome arm').",
    )
    cleaned_bio: str = Field(
        description="The character bio rephrased to smoothly exclude the extracted features while preserving all narrative, origin, and role context.",
    )


class ExtractedPersonaLLMOutput(BaseModel):
    moral_code: list[str] = Field(
        default_factory=list,
        description="Ethical boundaries, vows, and rules of engagement (e.g. 'never harms children', 'never betrays a client').",
    )
    quirks_flaws: list[str] = Field(
        default_factory=list,
        description="Behavioral flaws, neurotic ticks, habits, or psychological vulnerabilities (e.g. 'chain smoker under stress', 'compulsive gambler').",
    )
    cleaned_core_persona: str = Field(
        description="The core persona rephrased to smoothly exclude the specific extracted moral rules and quirks/flaws while retaining demeanor, speech habits, and psychology.",
    )


async def extract_features_from_bio(
    character_bio: str,
    existing_features: list[str] | None = None,
    profile: ModelProfile | None = None,
) -> tuple[list[str], str]:
    """Extract distinctive features from character bio prose and return (new_features, cleaned_bio)."""
    text = (character_bio or "").strip()
    if not text:
        return [], ""

    existing = [f.strip() for f in (existing_features or []) if f.strip()]
    existing_str = f"Already extracted features to IGNORE: {', '.join(existing)}\n" if existing else ""

    system_prompt = (
        "You are an expert character sheet editor.\n"
        "Analyze the provided Character Bio and extract concise, high-salience Distinctive Features "
        "(visible anatomy, scars, cybernetics, implants, tattoos, eyes, hair, markings, physical traits).\n\n"
        "Guidelines:\n"
        "1. Extract punchy, concise tag items (e.g. 'faint scar along jawline', 'luminescent retinal implant', 'piercing amber eyes').\n"
        "2. Do NOT extract items that are already listed in the existing features list.\n"
        "3. Rewrite the Character Bio so that the extracted physical traits are smoothly removed without leaving awkward grammatical stubs, missing subjects, or chopped sentences.\n"
        "4. PRESERVE all narrative history, public reputation, background, origins, and thematic identity.\n"
        "5. If no distinctive physical features are present in the text, return an empty distinctive_features list and keep the cleaned_bio identical to the input."
    )

    user_prompt = f"{existing_str}Character Bio:\n{text}"
    actor_prof = profile or settings.actor_profile

    try:
        llm_out = await llm_client.complete_structured(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            ExtractedFeaturesLLMOutput,
            profile=actor_prof,
            max_tokens=2048,
        )
        if isinstance(llm_out, ExtractedFeaturesLLMOutput):
            new_feats = [
                f.strip()
                for f in llm_out.distinctive_features
                if f.strip() and f.strip().lower() not in {e.lower() for e in existing}
            ]
            cleaned = (llm_out.cleaned_bio or "").strip() or text
            return new_feats, cleaned
    except Exception as exc:
        logger.warning("Feature extraction LLM call failed: %s", exc)

    return [], text


async def extract_persona_traits_from_demeanor(
    core_persona: str,
    existing_moral_code: list[str] | None = None,
    existing_quirks_flaws: list[str] | None = None,
    profile: ModelProfile | None = None,
) -> tuple[list[str], list[str], str]:
    """Extract moral code and quirks/flaws from core persona prose in a single pass, returning (new_code, new_quirks, cleaned_persona)."""
    text = (core_persona or "").strip()
    if not text:
        return [], [], ""

    existing_code = [m.strip() for m in (existing_moral_code or []) if m.strip()]
    existing_quirks = [q.strip() for q in (existing_quirks_flaws or []) if q.strip()]

    existing_context_parts: list[str] = []
    if existing_code:
        existing_context_parts.append(f"Existing Moral Code to IGNORE: {', '.join(existing_code)}")
    if existing_quirks:
        existing_context_parts.append(f"Existing Quirks/Flaws to IGNORE: {', '.join(existing_quirks)}")
    existing_context = "\n".join(existing_context_parts) + "\n" if existing_context_parts else ""

    system_prompt = (
        "You are an expert character psychologist and roleplay sheet editor.\n"
        "Analyze the provided Core Persona / Demeanor text and extract two structured lists:\n"
        "1. moral_code: Ethical boundaries, vows, principles, or lines the character will not cross (e.g. 'never harms non-combatants', 'refuses bribes to abandon a partner').\n"
        "2. quirks_flaws: Specific behavioral flaws, neurotic ticks, habits, addictions, or conversational weaknesses (e.g. 'compulsive hand sanitizer user', 'cynical distrust of synth-intelligences', 'bites fingernails when cornered').\n\n"
        "Guidelines:\n"
        "1. Extract punchy, concise items.\n"
        "2. Do NOT duplicate items already listed in existing lists.\n"
        "3. Rewrite the Core Persona text to smoothly exclude the specific extracted rules and quirks without damaging the prose flow, tone, speech patterns, or conversational demeanor.\n"
        "4. If no moral rules or quirks are found, return empty lists and keep the core persona intact."
    )

    user_prompt = f"{existing_context}Core Persona Demeanor:\n{text}"
    actor_prof = profile or settings.actor_profile

    try:
        llm_out = await llm_client.complete_structured(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            ExtractedPersonaLLMOutput,
            profile=actor_prof,
            max_tokens=2048,
        )
        if isinstance(llm_out, ExtractedPersonaLLMOutput):
            new_code = [
                m.strip()
                for m in llm_out.moral_code
                if m.strip() and m.strip().lower() not in {e.lower() for e in existing_code}
            ]
            new_quirks = [
                q.strip()
                for q in llm_out.quirks_flaws
                if q.strip() and q.strip().lower() not in {e.lower() for e in existing_quirks}
            ]
            cleaned = (llm_out.cleaned_core_persona or "").strip() or text
            return new_code, new_quirks, cleaned
    except Exception as exc:
        logger.warning("Persona trait extraction LLM call failed: %s", exc)

    return [], [], text
