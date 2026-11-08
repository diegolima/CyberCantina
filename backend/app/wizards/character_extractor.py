"""Extraction and surgical prose rephrasing for character bio and core persona."""

from __future__ import annotations

import logging
from pydantic import BaseModel, Field

from app.config import ModelProfile, settings
from app.engine.llm_client import llm_client

logger = logging.getLogger("cybercantina.wizards.character_extractor")


# --- Schemas for Distinctive Features (2-Pass Architecture) ---

class DistinctiveFeaturesExtractionLLMOutput(BaseModel):
    distinctive_features: list[str] = Field(
        default_factory=list,
        description="Comprehensive list of concise, high-salience visual, anatomical, and physical traits.",
    )


class RewrittenBioLLMOutput(BaseModel):
    cleaned_bio: str = Field(
        description="The character bio rephrased to smoothly exclude the extracted features while preserving all narrative, origin, and role context.",
    )


# Backward-compatible aliases
ExtractedFeaturesLLMOutput = DistinctiveFeaturesExtractionLLMOutput


# --- Schemas for Demeanor Persona Traits (2-Pass Architecture) ---

class PersonaTraitsExtractionLLMOutput(BaseModel):
    moral_code: list[str] = Field(
        default_factory=list,
        description="Ethical boundaries, vows, and rules of engagement (e.g. 'never harms children', 'never betrays a client').",
    )
    quirks_flaws: list[str] = Field(
        default_factory=list,
        description="Behavioral flaws, neurotic ticks, habits, or psychological vulnerabilities (e.g. 'chain smoker under stress', 'compulsive gambler').",
    )


class RewrittenPersonaLLMOutput(BaseModel):
    cleaned_core_persona: str = Field(
        description="The core persona rephrased to smoothly exclude the specific extracted moral rules and quirks/flaws while retaining demeanor, speech habits, and psychology.",
    )


# Backward-compatible aliases
ExtractedPersonaLLMOutput = PersonaTraitsExtractionLLMOutput


async def extract_features_from_bio(
    character_bio: str,
    existing_features: list[str] | None = None,
    profile: ModelProfile | None = None,
) -> tuple[list[str], str]:
    """Extract distinctive features from character bio prose using a 2-pass workflow.

    Pass 1: Extract all distinctive physical and visual traits into a structured list.
    Pass 2: Rewrite the bio to cleanly excise the extracted traits as a bulleted checklist.
    """
    text = (character_bio or "").strip()
    if not text:
        return [], ""

    existing = [f.strip() for f in (existing_features or []) if f.strip()]
    actor_prof = profile or settings.actor_profile

    # =========================================================================
    # PASS 1: Comprehensive Physical Trait Extraction
    # =========================================================================
    existing_str = (
        f"Already extracted features to IGNORE (do not extract these again):\n"
        + "\n".join(f"- {f}" for f in existing)
        + "\n\n"
        if existing
        else ""
    )

    system_prompt_pass1 = (
        "You are an expert character sheet editor.\n"
        "Analyze the provided Character Bio and identify all distinctive physical, anatomical, and visual traits.\n\n"
        "Examine the text for traits across broad, genre-neutral categories such as:\n"
        "- Eye color, shape, or gaze (e.g. 'piercing amber eyes', 'pale gray eyes', 'narrow watchful gaze')\n"
        "- Hair color, style, or texture (e.g. 'chestnut hair cut short', 'raven braided hair', 'shaved temples')\n"
        "- Markings, scars, tattoos, or skin features (e.g. 'faint scar along jawline', 'freckled pale skin', 'intricate forearm tattoo')\n"
        "- Build, height, posture, or physique (e.g. 'tall wiry build', 'broad-shouldered athletic frame', 'slight limp')\n"
        "- Setting-specific modifications or physical anomalies (e.g. 'pointed ears', 'weathered prosthetic', 'cybernetic ocular implant')\n\n"
        "Guidelines:\n"
        "1. Extract punchy, concise tag items (e.g. 'pale gray eyes', 'faint scar across nose', 'athletic build').\n"
        "2. Be thorough: catch all concrete visual markers mentioned in the prose.\n"
        "3. Do NOT extract items that are already listed in the existing features list.\n"
        "4. Do NOT extract abstract personality traits, social reputation, occupation, clothing items, or general backstory.\n"
        "5. If no distinctive physical features are present in the text, return an empty distinctive_features list."
    )
    user_prompt_pass1 = f"{existing_str}Character Bio:\n{text}"

    new_feats: list[str] = []
    try:
        pass1_out = await llm_client.complete_structured(
            [
                {"role": "system", "content": system_prompt_pass1},
                {"role": "user", "content": user_prompt_pass1},
            ],
            DistinctiveFeaturesExtractionLLMOutput,
            profile=actor_prof,
            max_tokens=1024,
        )
        if isinstance(pass1_out, DistinctiveFeaturesExtractionLLMOutput):
            new_feats = [
                f.strip()
                for f in pass1_out.distinctive_features
                if f.strip() and f.strip().lower() not in {e.lower() for e in existing}
            ]
    except Exception as exc:
        logger.warning("Pass 1 feature extraction LLM call failed: %s", exc)
        return [], text

    # If no new features were found, skip Pass 2 and keep the original bio unchanged
    if not new_feats:
        return [], text

    # =========================================================================
    # PASS 2: Surgical Prose Rewrite (Excise Extracted Traits)
    # =========================================================================
    bullet_list = "\n".join(f"- {f}" for f in new_feats)
    system_prompt_pass2 = (
        "You are an expert character sheet editor and narrative copyeditor.\n"
        "You are given a Character Bio and a specific bullet list of physical traits that have been extracted into dedicated sheet fields.\n\n"
        "Task:\n"
        "Rewrite the Character Bio to completely remove all mentions, descriptions, and references to the extracted traits.\n\n"
        "Extracted physical traits to REMOVE:\n"
        f"{bullet_list}\n\n"
        "Critical Rules:\n"
        "1. Remove every single trait listed above from the prose.\n"
        "2. Ensure natural prose flow: rewrite surrounding sentences smoothly so that no awkward grammatical stubs, dangling modifiers, incomplete clauses, or chopped sentences remain.\n"
        "3. PRESERVE 100% of the character's narrative history, background, occupation, reputation, personality cues, tone, and thematic voice.\n"
        "4. Do NOT invent new physical traits or narrative facts."
    )
    user_prompt_pass2 = f"Original Character Bio:\n{text}"

    try:
        pass2_out = await llm_client.complete_structured(
            [
                {"role": "system", "content": system_prompt_pass2},
                {"role": "user", "content": user_prompt_pass2},
            ],
            RewrittenBioLLMOutput,
            profile=actor_prof,
            max_tokens=2048,
        )
        if isinstance(pass2_out, RewrittenBioLLMOutput):
            cleaned = (pass2_out.cleaned_bio or "").strip() or text
            return new_feats, cleaned
    except Exception as exc:
        logger.warning("Pass 2 bio rewrite LLM call failed: %s", exc)

    return new_feats, text


async def extract_persona_traits_from_demeanor(
    core_persona: str,
    existing_moral_code: list[str] | None = None,
    existing_quirks_flaws: list[str] | None = None,
    profile: ModelProfile | None = None,
) -> tuple[list[str], list[str], str]:
    """Extract moral code and quirks/flaws from core persona prose using a 2-pass workflow.

    Pass 1: Extract ethical boundaries and behavioral quirks into structured lists.
    Pass 2: Rewrite core persona to smoothly excise the extracted traits as a bulleted checklist.
    """
    text = (core_persona or "").strip()
    if not text:
        return [], [], ""

    existing_code = [m.strip() for m in (existing_moral_code or []) if m.strip()]
    existing_quirks = [q.strip() for q in (existing_quirks_flaws or []) if q.strip()]
    actor_prof = profile or settings.actor_profile

    # =========================================================================
    # PASS 1: Extraction of Moral Code & Quirks
    # =========================================================================
    existing_context_parts: list[str] = []
    if existing_code:
        existing_context_parts.append(
            "Existing Moral Code to IGNORE (do not duplicate):\n"
            + "\n".join(f"- {c}" for c in existing_code)
        )
    if existing_quirks:
        existing_context_parts.append(
            "Existing Quirks/Flaws to IGNORE (do not duplicate):\n"
            + "\n".join(f"- {q}" for q in existing_quirks)
        )
    existing_context = "\n\n".join(existing_context_parts) + "\n\n" if existing_context_parts else ""

    system_prompt_pass1 = (
        "You are an expert character psychologist and roleplay sheet editor.\n"
        "Analyze the provided Core Persona / Demeanor text and extract two structured lists:\n"
        "1. moral_code: Ethical boundaries, vows, principles, or lines the character will not cross (e.g. 'never harms non-combatants', 'refuses bribes to abandon a partner').\n"
        "2. quirks_flaws: Specific behavioral flaws, neurotic ticks, habits, addictions, or conversational weaknesses (e.g. 'compulsive hand-washer', 'cynical distrust of authority', 'bites fingernails when cornered').\n\n"
        "Guidelines:\n"
        "1. Extract punchy, concise tag items.\n"
        "2. Do NOT duplicate items already listed in existing lists.\n"
        "3. Do NOT extract general demeanor or conversational tone (e.g. 'speaks softly') unless it represents a clear flaw or ethical boundary.\n"
        "4. If no moral rules or quirks are found, return empty lists."
    )
    user_prompt_pass1 = f"{existing_context}Core Persona Demeanor:\n{text}"

    new_code: list[str] = []
    new_quirks: list[str] = []
    try:
        pass1_out = await llm_client.complete_structured(
            [
                {"role": "system", "content": system_prompt_pass1},
                {"role": "user", "content": user_prompt_pass1},
            ],
            PersonaTraitsExtractionLLMOutput,
            profile=actor_prof,
            max_tokens=1024,
        )
        if isinstance(pass1_out, PersonaTraitsExtractionLLMOutput):
            new_code = [
                m.strip()
                for m in pass1_out.moral_code
                if m.strip() and m.strip().lower() not in {e.lower() for e in existing_code}
            ]
            new_quirks = [
                q.strip()
                for q in pass1_out.quirks_flaws
                if q.strip() and q.strip().lower() not in {e.lower() for e in existing_quirks}
            ]
    except Exception as exc:
        logger.warning("Pass 1 persona extraction LLM call failed: %s", exc)
        return [], [], text

    # If nothing was extracted, skip Pass 2 and keep demeanor unchanged
    if not new_code and not new_quirks:
        return [], [], text

    # =========================================================================
    # PASS 2: Surgical Prose Rewrite (Excise Extracted Traits)
    # =========================================================================
    items_to_remove: list[str] = []
    if new_code:
        items_to_remove.append("Extracted Moral Code to REMOVE:\n" + "\n".join(f"- {c}" for c in new_code))
    if new_quirks:
        items_to_remove.append("Extracted Quirks/Flaws to REMOVE:\n" + "\n".join(f"- {q}" for q in new_quirks))
    remove_context = "\n\n".join(items_to_remove)

    system_prompt_pass2 = (
        "You are an expert character psychologist and narrative copyeditor.\n"
        "You are given a character's Core Persona prose and a bullet list of moral rules and behavioral quirks/flaws that have been extracted into dedicated sheet fields.\n\n"
        "Task:\n"
        "Rewrite the Core Persona prose to completely remove all direct mentions and descriptions of the extracted moral rules and quirks.\n\n"
        f"{remove_context}\n\n"
        "Critical Rules:\n"
        "1. Remove every single extracted moral rule and quirk listed above from the prose.\n"
        "2. Ensure natural prose flow: rephrase surrounding sentences smoothly so that no grammatical gaps, missing subjects, or chopped clauses remain.\n"
        "3. PRESERVE the character's general demeanor, conversational habits, social defense mechanisms, speech cadence, and interpersonal attitude.\n"
        "4. Do NOT add new behavioral quirks or moral rules."
    )
    user_prompt_pass2 = f"Original Core Persona Demeanor:\n{text}"

    try:
        pass2_out = await llm_client.complete_structured(
            [
                {"role": "system", "content": system_prompt_pass2},
                {"role": "user", "content": user_prompt_pass2},
            ],
            RewrittenPersonaLLMOutput,
            profile=actor_prof,
            max_tokens=2048,
        )
        if isinstance(pass2_out, RewrittenPersonaLLMOutput):
            cleaned = (pass2_out.cleaned_core_persona or "").strip() or text
            return new_code, new_quirks, cleaned
    except Exception as exc:
        logger.warning("Pass 2 demeanor rewrite LLM call failed: %s", exc)

    return new_code, new_quirks, text



# --- Schemas for Dedicated Quirks & Flaws Extraction (2-Pass Architecture) ---

class QuirksFlawsExtractionLLMOutput(BaseModel):
    quirks_flaws: list[str] = Field(
        default_factory=list,
        description="Behavioral flaws, neurotic ticks, habits, vices, or psychological vulnerabilities.",
    )


class RewrittenDemeanorLLMOutput(BaseModel):
    cleaned_core_persona: str = Field(
        description="The core persona rephrased to smoothly exclude the extracted quirks/flaws while preserving demeanor, speech cadence, and general personality.",
    )


async def extract_quirks_from_demeanor(
    core_persona: str,
    existing_quirks: list[str] | None = None,
    profile: ModelProfile | None = None,
) -> tuple[list[str], str]:
    """Extract quirks and flaws from core persona prose using a 2-pass workflow.

    Pass 1: Extract all concrete behavioral flaws, neurotic ticks, vices, and defense mechanisms into a structured list.
    Pass 2: Rewrite the core persona to cleanly excise the extracted quirks as a bulleted checklist.
    """
    text = (core_persona or "").strip()
    if not text:
        return [], ""

    existing = [q.strip() for q in (existing_quirks or []) if q.strip()]
    actor_prof = profile or settings.actor_profile

    # =========================================================================
    # PASS 1: Comprehensive Quirks & Flaws Extraction
    # =========================================================================
    existing_str = (
        f"Already extracted quirks/flaws to IGNORE (do not extract these again):\n"
        + "\n".join(f"- {q}" for q in existing)
        + "\n\n"
        if existing
        else ""
    )

    system_prompt_pass1 = (
        "You are an expert character psychologist and roleplay sheet editor.\n"
        "Analyze the provided Core Persona Demeanor text and identify all behavioral flaws, quirks, and psychological vulnerabilities.\n\n"
        "Examine the text for traits across broad, genre-neutral categories such as:\n"
        "- Nervous ticks, physical tells, and conversational habits (e.g. 'fidgets with signet ring', 'speaks in rapid monotone when cornered', 'avoids direct eye contact')\n"
        "- Social defense mechanisms and interpersonal vulnerabilities (e.g. 'deflects vulnerability with dark humor', 'habitually suspicious of kindness', 'proud to a fault')\n"
        "- Vices, compulsions, or addictions (e.g. 'chain smoker under pressure', 'compulsive gambler', 'bites fingernails')\n"
        "- Cognitive blindspots, temperamental flaws, or emotional triggers (e.g. 'overestimates physical stamina', 'short-tempered when contradicted', 'holds grudges')\n\n"
        "Guidelines:\n"
        "1. Extract punchy, concise tag items (e.g. 'chain smoker under pressure', 'deflects with dark humor').\n"
        "2. Be thorough: catch concrete behavioral flaws and eccentricities mentioned in the prose.\n"
        "3. Do NOT extract items already listed in the existing quirks list.\n"
        "4. Do NOT extract ethical rules, vows, or lines they won't cross (e.g. 'never harms children')—those belong in Moral Code.\n"
        "5. Do NOT extract positive virtues or general profession/backstory.\n"
        "6. If no quirks or behavioral flaws are present in the text, return an empty quirks_flaws list."
    )
    user_prompt_pass1 = f"{existing_str}Core Persona Demeanor:\n{text}"

    new_quirks: list[str] = []
    try:
        pass1_out = await llm_client.complete_structured(
            [
                {"role": "system", "content": system_prompt_pass1},
                {"role": "user", "content": user_prompt_pass1},
            ],
            QuirksFlawsExtractionLLMOutput,
            profile=actor_prof,
            max_tokens=1024,
        )
        if isinstance(pass1_out, QuirksFlawsExtractionLLMOutput):
            new_quirks = [
                q.strip()
                for q in pass1_out.quirks_flaws
                if q.strip() and q.strip().lower() not in {e.lower() for e in existing}
            ]
    except Exception as exc:
        logger.warning("Pass 1 quirks extraction LLM call failed: %s", exc)
        return [], text

    # If no new quirks were found, skip Pass 2 and keep original text
    if not new_quirks:
        return [], text

    # =========================================================================
    # PASS 2: Surgical Prose Rewrite (Excise Extracted Quirks)
    # =========================================================================
    bullet_list = "\n".join(f"- {q}" for q in new_quirks)
    system_prompt_pass2 = (
        "You are an expert character psychologist and narrative copyeditor.\n"
        "You are given a character's Core Persona prose and a bullet list of quirks and flaws that have been extracted into dedicated sheet fields.\n\n"
        "Task:\n"
        "Rewrite the Core Persona prose to completely remove all direct mentions and descriptions of the extracted quirks.\n\n"
        "Extracted quirks to REMOVE:\n"
        f"{bullet_list}\n\n"
        "Critical Rules:\n"
        "1. Remove every single extracted quirk listed above from the prose.\n"
        "2. Ensure natural prose flow: rephrase surrounding sentences smoothly so that no grammatical gaps, missing subjects, or chopped clauses remain.\n"
        "3. PRESERVE the character's general demeanor, conversational habits, social defense mechanisms, speech cadence, and interpersonal attitude.\n"
        "4. Do NOT add new behavioral quirks or moral rules."
    )
    user_prompt_pass2 = f"Original Core Persona Demeanor:\n{text}"

    try:
        pass2_out = await llm_client.complete_structured(
            [
                {"role": "system", "content": system_prompt_pass2},
                {"role": "user", "content": user_prompt_pass2},
            ],
            RewrittenDemeanorLLMOutput,
            profile=actor_prof,
            max_tokens=2048,
        )
        if isinstance(pass2_out, RewrittenDemeanorLLMOutput):
            cleaned = (pass2_out.cleaned_core_persona or "").strip() or text
            return new_quirks, cleaned
    except Exception as exc:
        logger.warning("Pass 2 demeanor rewrite LLM call failed: %s", exc)

    return new_quirks, text
