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
from app.schemas.character import (
    CharacterRecord,
    CharacterStateSnapshot,
)
from app.schemas.persona import (
    PersonaRecord,
    PersonaTurnStateSnapshot,
)
from app.schemas.turn import (
    EpisodicChunkRecord,
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
) -> list[RecalledMemoryItem]:
    """Best-first two-form (full + short) token budget packer for Zone 4 and Phase 3 recall.

    - Rank 0 (strongest consensus match) is always rendered in 'full' form.
    - Subsequent items reserve their 'short' 1-line synopsis cost first so more distinct memories
      fit, then upgrade from 'short' to 'full' in priority order as unreserved budget allows.
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

    # Always admit Rank 0 in full form
    first_item, first_short, first_full_cost, _first_short_cost = prepared[0]
    admitted: list[tuple[RecalledMemoryItem, str, int, int]] = [
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
    packed: list[RecalledMemoryItem] = [
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
