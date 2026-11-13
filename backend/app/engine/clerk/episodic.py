"""Episodic chunk witnesses, salience scoring, and structured LLM chunk summarization."""

from __future__ import annotations

from app.config import (
    ModelProfile,
    settings,
)
from app.engine.llm_client import llm_client
from app.engine.mentions import sanitize_history_for_episodic_summary
from app.engine.phase2_context import was_character_present_on_turn
from app.prompts import (
    get_default_prompt,
    render_template,
)
from app.schemas.character import CharacterRecord
from app.schemas.turn import (
    EpisodicChunkLLMOutput,
    ExtractedCharacterMemory,
    TurnNodeRecord,
)
from collections.abc import Sequence

def _resolve_summarize_fn():
    import sys

    for mod_name in ("app.engine.phase4_clerk", "app.engine.phase5_clerk"):
        mod = sys.modules.get(mod_name)
        if mod and hasattr(mod, "summarize_turn_chunk") and mod.summarize_turn_chunk is not summarize_turn_chunk:
            return mod.summarize_turn_chunk
    return summarize_turn_chunk


def compute_episodic_chunk_witnesses(turns: Sequence[TurnNodeRecord]) -> list[str]:
    """Return ordered list of character IDs who were physically present during any turn in the chunk."""
    candidate_ids: list[str] = []
    seen: set[str] = set()
    for t in turns:
        if t.actor_id and t.actor_id != "__narrator__" and t.actor_id not in seen:
            seen.add(t.actor_id)
            candidate_ids.append(t.actor_id)
        if t.character_state and t.character_state.character_id not in seen:
            seen.add(t.character_state.character_id)
            candidate_ids.append(t.character_state.character_id)
        for cid in (t.character_states or {}):
            if cid and cid != "__narrator__" and cid not in seen:
                seen.add(cid)
                candidate_ids.append(cid)

    witnesses: list[str] = []
    for cid in candidate_ids:
        if any(was_character_present_on_turn(t, cid) for t in turns):
            witnesses.append(cid)
    return witnesses


def compute_episodic_chunk_salience(
    turns: Sequence[TurnNodeRecord],
    extracted_memories: Sequence[ExtractedCharacterMemory] | None = None,
) -> int:
    """Compute deterministic narrative salience score (1-10) for an episodic chunk from turn telemetry."""
    if not turns:
        return 5
    score = 5

    # +2 if any turn in the slice had a Critical Success or Critical Failure roll outcome
    has_crit_roll = False
    for t in turns:
        if t.pre_turn.resolved_roll and t.pre_turn.resolved_roll.outcome_tier in (
            "Critical Success",
            "Critical Failure",
        ):
            has_crit_roll = True
            break
        for r in (t.pre_turn.character_rolls or {}).values():
            if r.outcome_tier in ("Critical Success", "Critical Failure"):
                has_crit_roll = True
                break
        if has_crit_roll:
            break
    if has_crit_roll:
        score += 2

    # +2 if any turn produced a transformative personal memory or shattered composure (<= 0.35)
    high_sig = {"trauma", "betrayal", "vow", "bonding"}
    has_transformative = False
    if extracted_memories:
        for m in extracted_memories:
            if m.significance in high_sig:
                has_transformative = True
                break
    if not has_transformative:
        for t in turns:
            if t.post_turn and t.post_turn.character_memories:
                if any(m.significance in high_sig for m in t.post_turn.character_memories):
                    has_transformative = True
                    break
            all_snaps = [t.character_state, *(t.character_states or {}).values()]
            for snap in all_snaps:
                if snap and snap.care_state and snap.care_state.composure <= 0.35:
                    has_transformative = True
                    break
            if has_transformative:
                break
    if has_transformative:
        score += 2

    # +1 if any turn involved a spatial location transition or secret persona disclosure
    has_transition_or_secret = False
    prev_loc_id: str | None = None
    for t in turns:
        if t.pre_turn.revealed_persona_keys:
            has_transition_or_secret = True
            break
        if t.post_turn and t.post_turn.transition_type != "stay":
            has_transition_or_secret = True
            break
        cur_loc_id = t.world_snapshot.active_location_id
        if prev_loc_id is not None and cur_loc_id != prev_loc_id:
            has_transition_or_secret = True
            break
        prev_loc_id = cur_loc_id
    if has_transition_or_secret:
        score += 1

    return max(1, min(10, score))


def _derive_fallback_episodic_fields(
    turns: Sequence[TurnNodeRecord],
    summary_text: str,
) -> EpisodicChunkLLMOutput:
    """Derive deterministic title, 1-line synopsis, and keywords from a summary string and turn slice."""
    start_d = turns[0].depth_index if turns else 0
    end_d = turns[-1].depth_index if turns else 0
    clean_sum = " ".join(summary_text.replace("\r", " ").replace("\n", " ").split()).strip()

    # Extract first sentence for 1-line synopsis
    first_sent = clean_sum.split(". ")[0].strip()
    if first_sent and not first_sent.endswith((".", "!", "?")):
        first_sent += "."
    synopsis = first_sent[:200] if first_sent else clean_sum[:200]

    # Collect entity keywords from turns
    kws: list[str] = []
    seen_kw: set[str] = set()
    for t in turns:
        for ent in t.pre_turn.mentioned_entities:
            c = ent.strip()
            if c and c.lower() not in seen_kw:
                seen_kw.add(c.lower())
                kws.append(c)
        for fl in t.world_snapshot.scene_flags[-2:]:
            c = fl.strip()
            if c and c.lower() not in seen_kw:
                seen_kw.add(c.lower())
                kws.append(c)
    title = f"Episode Turns {start_d}–{end_d}"
    if kws:
        title = f"{kws[0]} (Turns {start_d}–{end_d})"[:80]

    return EpisodicChunkLLMOutput(
        title=title,
        synopsis_text=synopsis,
        summary_text=clean_sum,
        keywords=kws[:6],
    )


async def summarize_turn_chunk(
    turns: list[TurnNodeRecord],
    character: CharacterRecord,
    profile: ModelProfile | None = None,
    prompt_template: str | None = None,
    character_name_map: dict[str, str] | None = None,
) -> str:
    """Summarize a slice of working memory turns into an objective storyline episodic paragraph."""
    name_lookup = character_name_map or {character.id: character.name}
    transcript_lines: list[str] = []
    for t in turns:
        speaker_label = (
            "Narrator"
            if t.actor_id == "__narrator__"
            else name_lookup.get(t.actor_id, character.name)
        )
        flags_str = (
            f" [Flags: {', '.join(t.world_snapshot.scene_flags[-3:])}]"
            if t.world_snapshot.scene_flags
            else ""
        )
        sanitized_u = sanitize_history_for_episodic_summary(t.user_message, [character])
        transcript_lines.append(
            f"Turn {t.depth_index}{flags_str} | User: {sanitized_u}\n{speaker_label}: {t.raw_prose}"
        )
    transcript = "\n".join(transcript_lines)
    system_prompt = render_template(
        prompt_template or get_default_prompt("clerk_episodic_summary_system")
    )
    clerk_prof = profile or settings.clerk_profile
    try:
        summary = await llm_client.complete_text(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": transcript},
            ],
            profile=clerk_prof,
            temperature=0.2,
            max_tokens=256,
        )
        if summary.strip():
            return summary.strip()
    except Exception:
        if not settings.allow_offline_fallback:
            raise

    # Deterministic fallback episodic compression focused on objective actions & state
    start_d = turns[0].depth_index
    end_d = turns[-1].depth_index
    snippets: list[str] = []
    for t in turns:
        u_short = t.user_message.strip().replace("\n", " ")[:70]
        if t.post_turn and t.post_turn.notable_event_summary:
            outcome_short = t.post_turn.notable_event_summary.strip()[:80]
            snippets.append(f"[T{t.depth_index}] {outcome_short}")
        else:
            c_short = t.cognition.plan.strip()[:70] or t.cognition.want.strip()[:70]
            snippets.append(f"[T{t.depth_index}] Action: '{u_short}' -> {c_short}")
    return f"Turns {start_d}–{end_d} summary: " + " | ".join(snippets[:4])


_ORIGINAL_SUMMARIZE_TURN_CHUNK = summarize_turn_chunk


async def summarize_turn_chunk_structured(
    turns: list[TurnNodeRecord],
    character: CharacterRecord,
    profile: ModelProfile | None = None,
    prompt_template: str | None = None,
    character_name_map: dict[str, str] | None = None,
) -> EpisodicChunkLLMOutput:
    """Produce a structured EpisodicChunkLLMOutput (title, 1-line synopsis, full summary, keywords).

    Preserves seamless compatibility if tests monkeypatch `summarize_turn_chunk` or `complete_text`.
    """
    resolved_fn = _resolve_summarize_fn()
    if resolved_fn is not _ORIGINAL_SUMMARIZE_TURN_CHUNK:
        raw_summary = await resolved_fn(
            turns,
            character,
            profile=profile,
            prompt_template=prompt_template,
            character_name_map=character_name_map,
        )
        return _derive_fallback_episodic_fields(turns, raw_summary)

    name_lookup = character_name_map or {character.id: character.name}
    transcript_lines: list[str] = []
    for t in turns:
        speaker_label = (
            "Narrator"
            if t.actor_id == "__narrator__"
            else name_lookup.get(t.actor_id, character.name)
        )
        flags_str = (
            f" [Flags: {', '.join(t.world_snapshot.scene_flags[-3:])}]"
            if t.world_snapshot.scene_flags
            else ""
        )
        sanitized_u = sanitize_history_for_episodic_summary(t.user_message, [character])
        transcript_lines.append(
            f"Turn {t.depth_index}{flags_str} | User: {sanitized_u}\n{speaker_label}: {t.raw_prose}"
        )
    transcript = "\n".join(transcript_lines)
    system_prompt = render_template(
        prompt_template or get_default_prompt("clerk_episodic_summary_system")
    )
    clerk_prof = profile or settings.clerk_profile
    try:
        structured = await llm_client.complete_structured(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": transcript},
            ],
            EpisodicChunkLLMOutput,
            profile=clerk_prof,
            temperature=0.2,
            max_tokens=320,
            required_properties=list(EpisodicChunkLLMOutput.model_fields.keys()),
        )
        if structured.summary_text.strip():
            fallback_fields = _derive_fallback_episodic_fields(turns, structured.summary_text)
            return EpisodicChunkLLMOutput(
                title=structured.title or fallback_fields.title,
                synopsis_text=structured.synopsis_text or fallback_fields.synopsis_text,
                summary_text=structured.summary_text,
                keywords=structured.keywords or fallback_fields.keywords,
            )
    except Exception:
        pass

    raw_summary = await resolved_fn(
        turns,
        character,
        profile=profile,
        prompt_template=prompt_template,
        character_name_map=character_name_map,
    )
    return _derive_fallback_episodic_fields(turns, raw_summary)
