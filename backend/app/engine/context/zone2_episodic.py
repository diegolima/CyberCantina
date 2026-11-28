"""Zone 2 LOD episodic memory rendering, vector recall packing, and compacted turn elevation."""

from __future__ import annotations

from app.config import settings
from app.db.vector_store import (
    build_short_memory_content,
    extract_context_activations,
)
from app.engine.mentions import (
    DecomposedUserMessage,
    filter_user_message_for_character,
)
from app.engine.world_clock import describe_world_timestamp
from app.schemas.character import (
    CharacterObjective,
    CharacterRecord,
    CharacterStateSnapshot,
)
from app.schemas.party import PartyRecord
from app.schemas.persona import (
    PersonaRecord,
    PersonaTurnStateSnapshot,
)
from app.schemas.turn import (
    EpisodicChunkRecord,
    NarrativeVoice,
    PreTurnAnalysis,
    RecalledMemoryItem,
    TurnNodeRecord,
)
from app.schemas.world import (
    LocationNode,
    NeighborLocationView,
    WorldRecord,
)
from collections.abc import (
    Mapping,
    Sequence,
)
from typing import Literal
from dataclasses import (
    dataclass,
    field,
)

from app.engine.context.lore_scope import (
    estimate_messages_tokens,
    estimate_text_tokens,
    was_character_present_on_turn,
)
from app.engine.context.zone1_static import DiscoveredPersonaView

@dataclass(frozen=True)
class TurnContextBundle:
    """Consolidated turn context payload resolved during Phase 2."""

    world: WorldRecord
    branch_turns: list[TurnNodeRecord]
    leaf_turn: TurnNodeRecord
    active_location: LocationNode
    neighbors: list[NeighborLocationView]
    present_characters: list[CharacterRecord]
    pre_turn: PreTurnAnalysis
    user_message: str
    episodic_chunks: list[EpisodicChunkRecord]
    shared_scene_items: list[RecalledMemoryItem]
    per_character_recalled_items: dict[str, list[RecalledMemoryItem]]
    all_character_states: dict[str, CharacterStateSnapshot]
    character_name_map: dict[str, str]
    is_narrator: bool = False
    narrative_mode: str | None = None
    narrator_directive: str | None = None
    working_memory_turns: int | None = None
    actor_system_prompt_template: str | None = None
    persona_snapshot: PersonaRecord | None = None
    current_player_state: PersonaTurnStateSnapshot | None = None
    per_character_known_personas: dict[str, DiscoveredPersonaView] = field(default_factory=dict)
    decomposed_message: DecomposedUserMessage | None = None
    recall_budget_cognition_tokens: int | None = None
    active_parties: list[PartyRecord] = field(default_factory=list)
    narrative_voice: NarrativeVoice = "first_person"


def _chunk_synopsis_fallback(chunk: EpisodicChunkRecord) -> str:
    """Return the chunk's 1-line synopsis_text, or derive one from summary_text for legacy chunks."""
    if chunk.synopsis_text and chunk.synopsis_text.strip():
        return chunk.synopsis_text.strip()
    first_sent = chunk.summary_text.strip().split(". ")[0].strip()
    if first_sent and not first_sent.endswith((".", "!", "?")):
        first_sent += "."
    return first_sent[:200] if first_sent else chunk.summary_text.strip()[:200]


def render_zone2_lod_episodic_summary(
    chunks: Sequence[EpisodicChunkRecord],
    *,
    budget_tokens: int | None = None,
    lod_summary_chunks: int | None = None,
    lod_importance_bonus: int | None = None,
) -> tuple[str | None, dict[str, Literal["summary", "synopsis", "dropped"]]]:
    """Zone 2: Sealed-Episode Level-of-Detail (LOD) cascade (summary -> synopsis -> dropped).

    Preserves shared campaign storyline prefix for KV-cache efficiency across characters.
    """
    if not chunks:
        return None, {}

    eff_summary_cap = (
        lod_summary_chunks
        if lod_summary_chunks is not None
        else settings.memory_config.lod_summary_chunks
    )
    eff_bonus = (
        lod_importance_bonus
        if lod_importance_bonus is not None
        else settings.memory_config.lod_importance_bonus
    )

    ordered = sorted(chunks, key=lambda c: (c.start_turn_depth, c.end_turn_depth))
    total = len(ordered)

    # Calculate effective age with salience bonus (salience_score >= 8 stays in summary longer)
    scored_ages: list[tuple[int, int, str]] = []
    for idx, c in enumerate(ordered):
        pos_from_end = (total - 1) - idx
        bonus = eff_bonus if getattr(c, "salience_score", 5) >= 8 else 0
        eff_age = max(0, pos_from_end - bonus)
        scored_ages.append((eff_age, pos_from_end, c.id))

    scored_ages.sort(key=lambda t: (t[0], t[1]))
    summary_winner_ids = {cid for _ea, _pos, cid in scored_ages[: max(0, eff_summary_cap)]}

    tiers: dict[str, Literal["summary", "synopsis", "dropped"]] = {
        c.id: ("summary" if c.id in summary_winner_ids else "synopsis")
        for c in ordered
    }

    def _render_from_tiers() -> str | None:
        lines: list[str] = []
        for c in ordered:
            tier = tiers[c.id]
            if tier == "dropped":
                continue
            if tier == "summary":
                lines.append(
                    f"[Episode Turns {c.start_turn_depth}–{c.end_turn_depth}]: {c.summary_text}"
                )
            else:
                lines.append(
                    f"[Episode Turns {c.start_turn_depth}–{c.end_turn_depth} (Synopsis)]: {_chunk_synopsis_fallback(c)}"
                )
        if not lines:
            return None
        return "=== STORY SO FAR (EPISODIC MEMORY) ===\n" + "\n".join(lines)

    rendered = _render_from_tiers()
    if budget_tokens is not None and rendered is not None:
        if budget_tokens <= 0:
            for c in ordered:
                tiers[c.id] = "dropped"
            return None, tiers

        def _cost(txt: str | None) -> int:
            if not txt:
                return 0
            return estimate_messages_tokens([{"role": "system", "content": txt}])

        # Pass 1: Demote oldest 'summary' -> 'synopsis' one by one
        for c in ordered:
            if _cost(rendered) <= budget_tokens:
                break
            if tiers[c.id] == "summary":
                tiers[c.id] = "synopsis"
                rendered = _render_from_tiers()

        # Pass 2: Drop oldest 'synopsis' -> 'dropped' one by one
        for c in ordered:
            if _cost(rendered) <= budget_tokens:
                break
            if tiers[c.id] != "dropped":
                tiers[c.id] = "dropped"
                rendered = _render_from_tiers()

    return rendered, tiers


def build_zone2_episodic_summary(
    chunks: list[EpisodicChunkRecord],
    *,
    budget_tokens: int | None = None,
    lod_summary_chunks: int | None = None,
    lod_importance_bonus: int | None = None,
) -> str | None:
    """Zone 2: Semi-static episodic summary block with LOD degradation."""
    rendered, _tiers = render_zone2_lod_episodic_summary(
        chunks,
        budget_tokens=budget_tokens,
        lod_summary_chunks=lod_summary_chunks,
        lod_importance_bonus=lod_importance_bonus,
    )
    return rendered


def pack_recalled_items_to_budget(
    items: Sequence[RecalledMemoryItem],
    token_budget: int,
    *,
    prefer_short_first: bool = False,
) -> list[RecalledMemoryItem]:
    """Best-first two-form (full + short) token budget packer for Zone 4 and Phase 3 recall.

    - When `prefer_short_first=False` (default, Zone 4 prose): Rank 0 is always admitted in 'full' form,
      and subsequent items reserve their 'short' 1-line synopsis cost first before upgrading.
    - When `prefer_short_first=True` (Phase 3 Cognition): reserves 'short' cost from Rank 0 downward so
      more distinct top matches fit inside tight budgets before upgrading to 'full' with spare tokens.
    """
    if not items or token_budget <= 0:
        return []

    prepared: list[tuple[RecalledMemoryItem, str, int, int]] = []
    for m in items:
        short_txt = (
            m.short_content.strip()
            if (m.short_content and m.short_content.strip())
            else build_short_memory_content(m.title, m.content)
        )
        full_line = f"  - [{m.source_type.upper()}] {m.title}: {m.content}"
        short_line = f"  - [{m.source_type.upper()}] {m.title}: {short_txt}"
        full_cost = max(1, estimate_text_tokens(full_line))
        short_cost = max(1, min(full_cost, estimate_text_tokens(short_line)))
        prepared.append((m, short_txt, full_cost, short_cost))

    if prefer_short_first and len(prepared) > 1:
        first_item, first_short, first_full_cost, first_short_cost = prepared[0]
        admitted: list[tuple[RecalledMemoryItem, str, int, int]] = [
            (first_item, first_short, first_full_cost, first_short_cost)
        ]
        used_short_sum = first_short_cost
        for entry in prepared[1:]:
            _m, _stxt, _fcost, scost = entry
            if used_short_sum + scost <= token_budget:
                admitted.append(entry)
                used_short_sum += scost

        spare_tokens = max(0, token_budget - used_short_sum)
        packed: list[RecalledMemoryItem] = []
        for m, short_txt, full_cost, short_cost in admitted:
            upgrade_delta = max(0, full_cost - short_cost)
            if upgrade_delta <= spare_tokens:
                spare_tokens -= upgrade_delta
                packed.append(
                    m.model_copy(update={"short_content": short_txt, "render_form": "full"})
                )
            else:
                packed.append(
                    m.model_copy(update={"short_content": short_txt, "render_form": "short"})
                )
        return packed

    # Always admit Rank 0 in full form
    first_item, first_short, first_full_cost, _first_short_cost = prepared[0]
    admitted = [
        (first_item, first_short, first_full_cost, first_full_cost)
    ]
    used_short_sum = first_full_cost

    for entry in prepared[1:]:
        _m, _stxt, _fcost, scost = entry
        if used_short_sum + scost <= token_budget:
            admitted.append(entry)
            used_short_sum += scost

    # Upgrade admitted[1:] from short to full in best-first rank order when unreserved budget permits
    spare_tokens = max(0, token_budget - used_short_sum)
    packed = [
        first_item.model_copy(
            update={"short_content": first_short, "render_form": "full"}
        )
    ]
    for m, short_txt, full_cost, short_cost in admitted[1:]:
        upgrade_delta = max(0, full_cost - short_cost)
        if upgrade_delta <= spare_tokens:
            spare_tokens -= upgrade_delta
            packed.append(
                m.model_copy(update={"short_content": short_txt, "render_form": "full"})
            )
        else:
            packed.append(
                m.model_copy(update={"short_content": short_txt, "render_form": "short"})
            )

    return packed


def format_arc_objective_prompt_line(
    arc_objective: CharacterObjective | None,
    *,
    world_timestamp: str | None = None,
    temperament_archetype: str | None = None,
    for_cognition: bool = True,
) -> str:
    """Format a quiet, always-on Arc Objective anchor with optional world clock and CARE vigilance hint."""
    if arc_objective is None:
        if for_cognition:
            return "- Arc Objective: None (no active multi-scene commitment; focus on the immediate scene and core drive)."
        return ""

    deadline_part = (
        f" [Deadline/Condition: {arc_objective.deadline_cue}]"
        if arc_objective.deadline_cue
        else ""
    )
    if not for_cognition:
        return (
            f"    Arc Objective (background compass — do not force into unrelated turns): "
            f"{arc_objective.summary}{deadline_part}\n"
        )

    arch = (temperament_archetype or "balanced").strip().lower()
    if arch in ("paranoiac", "proud_rival"):
        vigilance_hint = (
            "Keep sharp awareness of schedule, leverage, and obstacles, while acting naturally on the immediate scene."
        )
    elif arch == "volatile":
        vigilance_hint = (
            "Pursue with drive when openings appear, without derailing unrelated interactions."
        )
    else:
        vigilance_hint = (
            "Background arc compass — pursue organically when relevant or time-pressured; never force it into unrelated scene beats."
        )
    time_part = (
        f" [Current Time: {describe_world_timestamp(world_timestamp)}]"
        if world_timestamp and world_timestamp.strip()
        else ""
    )
    return (
        f"- Arc Objective: {arc_objective.summary}{deadline_part}{time_part} "
        f"*({vigilance_hint})*"
    )


def build_cognition_witnessed_synopsis_strip(
    episodic_chunks: Sequence[EpisodicChunkRecord],
    branch_turns: Sequence[TurnNodeRecord],
    character_id: str,
    *,
    max_tokens: int = 350,
) -> str:
    """Render an epistemically-filtered 1-line synopsis strip of episodes witnessed by `character_id`."""
    if not episodic_chunks or max_tokens <= 0:
        return ""

    ordered = sorted(episodic_chunks, key=lambda c: (c.start_turn_depth, c.end_turn_depth))
    witnessed: list[EpisodicChunkRecord] = []
    for chunk in ordered:
        wids = getattr(chunk, "witness_character_ids", None) or []
        if wids:
            if character_id not in wids:
                continue
        else:
            # Legacy chunk without witness list: infer from constituent turns
            if not any(
                chunk.start_turn_depth <= t.depth_index <= chunk.end_turn_depth
                and was_character_present_on_turn(t, character_id)
                for t in branch_turns
            ):
                continue
        witnessed.append(chunk)

    if not witnessed:
        return ""

    entries: list[tuple[int, EpisodicChunkRecord, str]] = [
        (
            idx,
            c,
            f"  - [Turns {c.start_turn_depth}–{c.end_turn_depth}]: {_chunk_synopsis_fallback(c)}",
        )
        for idx, c in enumerate(witnessed)
    ]

    def _total_tokens(items: list[tuple[int, EpisodicChunkRecord, str]]) -> int:
        if not items:
            return 0
        return estimate_text_tokens("\n".join(line for _i, _c, line in items))

    # If over budget, drop lowest-salience oldest chunks first while protecting high-salience & recent chunks
    surviving = list(entries)
    while surviving and _total_tokens(surviving) > max_tokens:
        if len(surviving) == 1:
            break
        # Prefer preserving newest 2 chunks and high-salience (>= 8) chunks before dropping
        total_len = len(surviving)
        drop_idx = min(
            range(total_len),
            key=lambda pos: (
                1 if pos >= total_len - 2 else 0,
                1 if getattr(surviving[pos][1], "salience_score", 5) >= 8 else 0,
                getattr(surviving[pos][1], "salience_score", 5),
                surviving[pos][0],
            ),
        )
        surviving.pop(drop_idx)

    return "\n".join(line for _i, _c, line in surviving)


def build_cognition_recent_turns_tail(
    branch_turns: Sequence[TurnNodeRecord],
    episodic_chunks: Sequence[EpisodicChunkRecord],
    character_id: str,
    *,
    present_characters: Sequence[CharacterRecord],
    character_name_map: Mapping[str, str] | None = None,
    max_turns: int = 3,
    max_tokens: int = 300,
) -> str:
    """Render a compact, whisper-filtered tail of up to `max_turns` recent witnessed unsummarized turns."""
    if not branch_turns or max_turns <= 0 or max_tokens <= 0:
        return ""

    max_sum_depth = max((c.end_turn_depth for c in episodic_chunks), default=-1)
    witnessed_recent = [
        t
        for t in branch_turns
        if t.depth_index > max_sum_depth
        and t.actor_id != "__arrival__"
        and was_character_present_on_turn(t, character_id)
    ][-max_turns:]
    if not witnessed_recent:
        return ""

    name_lookup = dict(character_name_map or {})
    name_lookup["__narrator__"] = "Narrator"
    name_lookup["__solo__"] = "Narrator"
    for pc in present_characters:
        name_lookup.setdefault(pc.id, pc.name)

    whisper_roster: list[CharacterRecord] = list(present_characters)
    if whisper_roster:
        seen_ids = {c.id for c in whisper_roster}
        template_char = whisper_roster[0]
        for cid, cname in name_lookup.items():
            if cid not in seen_ids and cid not in ("__narrator__", "__solo__") and cname.strip():
                whisper_roster.append(template_char.model_copy(update={"id": cid, "name": cname}))
                seen_ids.add(cid)

    lines: list[str] = []
    for t in witnessed_recent:
        vis_user = filter_user_message_for_character(
            t.user_message,
            target_character_id=character_id,
            campaign_characters=whisper_roster,
        )
        u_clean = " ".join(vis_user.replace("\r", " ").replace("\n", " ").split()).strip()[:120]
        p_clean = " ".join((t.raw_prose or "").replace("\r", " ").replace("\n", " ").split()).strip()[:160]
        speaker_label = name_lookup.get(t.actor_id, t.actor_id)
        if t.depth_index == 0 and t.user_message == "[Scene Start]":
            lines.append(f"  - [Turn 0 Opening]: {speaker_label}: \"{p_clean}\"")
        else:
            lines.append(
                f"  - [Turn {t.depth_index}]: User: \"{u_clean}\" | {speaker_label}: \"{p_clean}\""
            )

    while len(lines) > 1 and estimate_text_tokens("\n".join(lines)) > max_tokens:
        lines.pop(0)
    return "\n".join(lines)


def elevate_compacted_episode_turns(
    *,
    recalled_items: Sequence[RecalledMemoryItem],
    episodic_chunks: Sequence[EpisodicChunkRecord],
    branch_turns: Sequence[TurnNodeRecord],
    queries: Sequence[str],
    mentioned_entities: Sequence[str],
    recent_turn_texts: Sequence[str] | None = None,
    target_character_id: str | None = None,
    present_characters: Sequence[CharacterRecord] | None = None,
    character_name_map: Mapping[str, str] | None = None,
    working_memory_turns: int | None = None,
    is_narrator: bool = False,
) -> list[RecalledMemoryItem]:
    """Dynamic Turn Elevation + Slotted Witness RAG for compacted episodic chunks.

    When a recalled `episodic_chunk` refers to turns already compacted out of the character's
    Zone 3 working window, searches the chunk's underlying `branch_turns` (strictly filtered by
    `was_character_present_on_turn` for `target_character_id`) and attaches the highest-matching
    verbatim exchange without mutating Zone 2.
    """
    if not recalled_items or not episodic_chunks or not branch_turns:
        return list(recalled_items)

    chunks_by_id = {c.id: c for c in episodic_chunks}
    max_sum_depth = max((c.end_turn_depth for c in episodic_chunks), default=-1)
    wm_limit = (
        working_memory_turns
        if working_memory_turns is not None
        else settings.memory_config.working_memory_turns
    )
    if target_character_id and not is_narrator:
        unsummarized = [
            t
            for t in branch_turns
            if t.depth_index > max_sum_depth
            and was_character_present_on_turn(t, target_character_id)
        ]
    else:
        unsummarized = [t for t in branch_turns if t.depth_index > max_sum_depth]
    active_wm_ids = {t.id for t in unsummarized[-wm_limit:]}

    token_weights, entity_phrases = extract_context_activations(
        queries, mentioned_entities, recent_turn_texts
    )
    name_lookup = dict(character_name_map or {})
    name_lookup["__narrator__"] = "Narrator"
    name_lookup["__solo__"] = "Narrator"
    for pc in present_characters or []:
        name_lookup.setdefault(pc.id, pc.name)

    elevated_list: list[RecalledMemoryItem] = []
    for item in recalled_items:
        if item.source_type != "episodic_chunk" or item.id not in chunks_by_id:
            elevated_list.append(item)
            continue

        chunk = chunks_by_id[item.id]
        chunk_turns = [
            t
            for t in branch_turns
            if chunk.start_turn_depth <= t.depth_index <= chunk.end_turn_depth
            and t.id not in active_wm_ids
            and (
                is_narrator
                or target_character_id is None
                or was_character_present_on_turn(t, target_character_id)
            )
        ]
        if not chunk_turns:
            elevated_list.append(item)
            continue

        scored_turns: list[tuple[float, TurnNodeRecord]] = []
        for t in chunk_turns:
            vis_user = (
                t.user_message
                if (is_narrator or target_character_id is None)
                else filter_user_message_for_character(
                    t.user_message,
                    target_character_id=target_character_id,
                    campaign_characters=list(present_characters or []),
                )
            )
            combined_txt = f"{vis_user} {t.raw_prose}".lower()
            t_score = 0.0
            for ent in entity_phrases:
                if ent and ent in combined_txt:
                    t_score += 2.0
            for tok, w in token_weights.items():
                if tok in combined_txt:
                    t_score += w
            if t_score > 0.0:
                scored_turns.append((t_score, t))

        if not scored_turns:
            elevated_list.append(item)
            continue

        scored_turns.sort(key=lambda pair: (pair[0], pair[1].depth_index), reverse=True)
        best_turn = scored_turns[0][1]
        best_user = (
            best_turn.user_message
            if (is_narrator or target_character_id is None)
            else filter_user_message_for_character(
                best_turn.user_message,
                target_character_id=target_character_id,
                campaign_characters=list(present_characters or []),
            )
        )
        u_clean = " ".join(best_user.replace("\r", " ").replace("\n", " ").split()).strip()[:110]
        p_clean = " ".join(best_turn.raw_prose.replace("\r", " ").replace("\n", " ").split()).strip()[:160]
        speaker_label = name_lookup.get(best_turn.actor_id, best_turn.actor_id)

        base_synopsis = _chunk_synopsis_fallback(chunk)
        elevated_full = (
            f"{item.content} "
            f"[Elevated Turn {best_turn.depth_index} Recall — User: \"{u_clean}\" | {speaker_label}: \"{p_clean}\"]"
        )
        elevated_short = (
            f"{base_synopsis} [Turn {best_turn.depth_index}: \"{p_clean[:85]}\"]"
        )
        elevated_list.append(
            item.model_copy(
                update={
                    "content": elevated_full,
                    "short_content": elevated_short,
                }
            )
        )

    return elevated_list
