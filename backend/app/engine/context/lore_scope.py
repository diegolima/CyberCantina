"""Token budget estimation, actor context ceilings, working windows, container chains, and lore scoping."""

from __future__ import annotations

import logging
import math
import re

from app.config import (
    ModelProfile,
    settings,
)
from app.schemas.character import (
    CharacterRecord,
    CharacterStateSnapshot,
    ItemInstance,
    coerce_item_list,
    normalize_item_key,
)
from app.schemas.turn import (
    EpisodicChunkRecord,
    PreTurnAnalysis,
    RecalledMemoryItem,
    TurnNodeRecord,
)
from app.schemas.world import (
    LocationContainer,
    LocationNode,
    LoreNode,
    WorldRecord,
)
from collections.abc import (
    Mapping,
    Sequence,
)

_WORD_TOKEN_RE = re.compile(r"[a-z0-9]{3,}")


logger = logging.getLogger("cybercantina.engine.phase2_context")


_CHAT_MSG_OVERHEAD_TOKENS = 12


_PROMPT_SAFETY_MARGIN_TOKENS = 256


def estimate_text_tokens(text: str) -> int:
    """Conservative char-based token estimate (~3.3 chars/token) without a model-specific BPE tokenizer."""
    if not text:
        return 0
    return max(1, math.ceil(len(text) / 3.3))


def estimate_messages_tokens(messages: Sequence[Mapping[str, str]]) -> int:
    """Estimate prompt tokens across chat messages including per-message framing overhead."""
    return sum(
        estimate_text_tokens(m.get("content", "")) + _CHAT_MSG_OVERHEAD_TOKENS
        for m in messages
    )


def resolve_actor_context_ceiling(actor_profile: ModelProfile) -> tuple[int | None, int]:
    """Return (max_context_tokens, reserved_output_tokens) for native Ollama; (None, 0) for server-managed providers."""
    ctx = getattr(actor_profile, "context_size", None)
    if ctx is None:
        return None, 0
    endpoint = getattr(actor_profile, "resolved", None)
    if endpoint is not None:
        if endpoint.type in ("openrouter", "aihorde"):
            return None, 0
        if endpoint.type == "webgpu":
            from app.providers.webgpu_catalog import get_webgpu_max_context

            clamped = min(int(ctx), get_webgpu_max_context(getattr(actor_profile, "model", None)))
            return clamped, int(getattr(actor_profile, "max_tokens", 0) or 0)
        if endpoint.type == "ollama":
            from app.providers.probe import probe_service

            if probe_service.get_cached_protocol(endpoint.provider_id) == "openai_compat":
                return None, 0
    return int(ctx), int(getattr(actor_profile, "max_tokens", 0) or 0)


_DISCOVERY_CHECK_STEMS = (
    "search",
    "investigat",
    "inspect",
    "examin",
    "perceiv",
    "percept",
    "spot",
    "notice",
    "scan",
    "hack",
    "intrusion",
    "decrypt",
    "lockpick",
    "pick",
    "pry",
    "sweep",
    "snoop",
    "uncover",
    "find",
    "look",
    "listen",
    "eavesdrop",
    "sense",
    "probe",
    "check",
)


def _tag_matches_text(tag: str, text_lower: str) -> bool:
    cleaned = tag.strip().lower()
    if len(cleaned) < 2 or not text_lower:
        return False
    pattern = r"(?<![a-z0-9])" + re.escape(cleaned) + r"(?![a-z0-9])"
    return bool(re.search(pattern, text_lower))


_LORE_OVERLAP_STOPWORDS = {
    "the",
    "and",
    "for",
    "from",
    "with",
    "into",
    "over",
    "under",
    "this",
    "that",
    "these",
    "those",
    "about",
    "after",
    "before",
    "during",
    "between",
    "through",
    "around",
    "was",
    "were",
    "been",
    "being",
    "have",
    "has",
    "had",
    "having",
    "their",
    "there",
    "they",
    "them",
    "her",
    "his",
    "its",
    "she",
    "him",
    "you",
    "your",
    "who",
    "whom",
    "which",
    "what",
    "when",
    "where",
    "while",
    "only",
    "very",
    "just",
    "still",
    "some",
    "more",
    "most",
    "such",
    "than",
    "then",
    "also",
    "item",
    "items",
    "worn",
    "carried",
    "equipped",
}


_ITEM_SIGNAL_ADJECTIVES = {
    "old",
    "new",
    "worn",
    "dark",
    "light",
    "heavy",
    "small",
    "large",
    "tiny",
    "black",
    "white",
    "red",
    "blue",
    "green",
    "silver",
    "gold",
    "golden",
    "brass",
    "iron",
    "steel",
    "copper",
    "wooden",
    "leather",
    "cloth",
    "tarnished",
    "rusted",
    "rusty",
    "broken",
    "cracked",
    "damaged",
    "polished",
    "ornate",
    "ancient",
    "weathered",
    "faded",
    "stained",
    "concealed",
    "hidden",
    "spare",
    "standard",
    "custom",
    "modified",
    "battered",
    "scratched",
}


def was_character_present_on_turn(turn: TurnNodeRecord, character_id: str) -> bool:
    """Return True if character_id was present in the turn's active_location (or was the speaker)."""
    if turn.actor_id == character_id:
        return True
    if turn.character_states and character_id in turn.character_states:
        return (
            turn.character_states[character_id].current_location_id
            == turn.world_snapshot.active_location_id
        )
    if turn.character_state.character_id == character_id:
        return turn.character_state.current_location_id == turn.world_snapshot.active_location_id
    return False


def get_character_working_window(
    branch_turns: list[TurnNodeRecord],
    episodic_chunks: list[EpisodicChunkRecord],
    *,
    character_id: str | None = None,
    is_narrator: bool = False,
    working_memory_turns: int | None = None,
) -> list[TurnNodeRecord]:
    """Return the exact slice of unsummarized turns present in Zone 3 Working Memory."""
    max_summarized_depth = max((c.end_turn_depth for c in episodic_chunks), default=-1)
    unsummarized_turns = [
        t
        for t in branch_turns
        if t.depth_index > max_summarized_depth
        and (
            is_narrator
            or not character_id
            or was_character_present_on_turn(t, character_id)
        )
    ]
    wm_limit = (
        working_memory_turns
        if working_memory_turns is not None
        else settings.memory_config.working_memory_turns
    )
    return unsummarized_turns[-wm_limit:]


def is_lore_substantively_in_working_window(
    lore_text: str,
    working_window: list[TurnNodeRecord],
    *,
    overlap_threshold: float = 0.60,
) -> bool:
    """Return True if the substantive content of lore_text is already present in Zone 3."""
    clean_lore = re.sub(r"\s+", " ", (lore_text or "").strip().lower())
    if not clean_lore or not working_window:
        return False

    window_corpus = "\n".join(
        f"{t.user_message}\n{t.raw_prose}" for t in working_window
    ).lower()
    if not window_corpus.strip():
        return False

    if len(clean_lore) >= 12 and clean_lore in window_corpus:
        return True

    lore_tokens = {
        tok
        for tok in _WORD_TOKEN_RE.findall(clean_lore)
        if tok not in _LORE_OVERLAP_STOPWORDS
    }
    if not lore_tokens:
        return False

    window_tokens = set(_WORD_TOKEN_RE.findall(window_corpus))
    matched_count = len(lore_tokens & window_tokens)
    return (matched_count / len(lore_tokens)) >= overlap_threshold


def _item_matches_turn_signal(
    item: ItemInstance,
    signal_lower: str,
    artifact_lore: LoreNode | None = None,
) -> bool:
    """Return True only when item name (or linked artifact title/tags) is explicitly referenced in turn signal."""
    if not signal_lower:
        return False

    clean_key = normalize_item_key(item.name)
    if clean_key and _tag_matches_text(clean_key, signal_lower):
        return True

    raw_tokens = re.findall(r"[a-z0-9]+", clean_key)
    distinctive_tokens = [
        tok
        for tok in raw_tokens
        if len(tok) >= 4
        and tok not in _ITEM_SIGNAL_ADJECTIVES
        and tok not in _LORE_OVERLAP_STOPWORDS
    ]
    if any(_tag_matches_text(tok, signal_lower) for tok in distinctive_tokens):
        return True

    if raw_tokens:
        head_noun = raw_tokens[-1]
        if (
            len(head_noun) >= 3
            and head_noun not in _ITEM_SIGNAL_ADJECTIVES
            and head_noun not in _LORE_OVERLAP_STOPWORDS
            and _tag_matches_text(head_noun, signal_lower)
        ):
            return True

    if artifact_lore is not None:
        if _tag_matches_text(artifact_lore.title, signal_lower):
            return True
        if any(_tag_matches_text(tag, signal_lower) for tag in artifact_lore.entity_tags):
            return True

    return False


def resolve_triggered_item_lore(
    *,
    world: WorldRecord,
    branch_turns: list[TurnNodeRecord],
    episodic_chunks: list[EpisodicChunkRecord],
    present_characters: list[CharacterRecord],
    all_character_states: dict[str, CharacterStateSnapshot],
    pre_turn: PreTurnAnalysis,
    user_message: str,
    narrator_directive: str | None,
    shared_scene_items: list[RecalledMemoryItem],
    per_character_recalled_items: dict[str, list[RecalledMemoryItem]],
    is_narrator: bool = False,
    working_memory_turns: int | None = None,
) -> tuple[list[RecalledMemoryItem], dict[str, list[RecalledMemoryItem]]]:
    """Conditionally inject relevant item notes and linked world artifact lore with Zone 3 hygiene & epistemic isolation."""
    signal_parts = [
        user_message or "",
        narrator_directive or "",
        *(pre_turn.mentioned_entities if pre_turn else []),
        *(pre_turn.memory_search_queries if pre_turn else []),
    ]
    signal_lower = " ".join(p for p in signal_parts if p).lower()

    updated_shared = list(shared_scene_items)
    updated_per_char: dict[str, list[RecalledMemoryItem]] = {
        cid: list(items) for cid, items in per_character_recalled_items.items()
    }
    for c in present_characters:
        updated_per_char.setdefault(c.id, [])

    if not signal_lower.strip():
        return updated_shared, updated_per_char

    world_artifacts_by_id: dict[str, LoreNode] = {
        ln.id: ln
        for ln in world.lore_nodes
        if ln.category == "artifact" and ln.location_id is None
    }

    primary_speaker_id = (
        None
        if is_narrator
        else (
            pre_turn.active_speaker_id
            if pre_turn.active_speaker_id in {c.id for c in present_characters}
            else (present_characters[0].id if present_characters else None)
        )
    )
    shared_window = get_character_working_window(
        branch_turns,
        episodic_chunks,
        character_id=primary_speaker_id,
        is_narrator=is_narrator,
        working_memory_turns=working_memory_turns,
    )

    # Also suppress any RAG-recalled world artifact lore already substantively present in Zone 3
    if world_artifacts_by_id and shared_window:
        updated_shared = [
            m
            for m in updated_shared
            if not (
                m.id in world_artifacts_by_id
                and is_lore_substantively_in_working_window(m.content, shared_window)
            )
        ]

    for c in present_characters:
        c_state = all_character_states.get(c.id)
        if c_state is None:
            continue
        c_window = get_character_working_window(
            branch_turns,
            episodic_chunks,
            character_id=c.id,
            is_narrator=False,
            working_memory_turns=working_memory_turns,
        )
        char_entries: list[tuple[str, ItemInstance]] = [
            *(("equipped", it) for it in coerce_item_list(list(c_state.equipped))),
            *(("inventory", it) for it in coerce_item_list(list(c_state.inventory))),
        ]
        for bucket_kind, item in char_entries:
            artifact_lore = (
                world_artifacts_by_id.get(item.lore_id) if item.lore_id else None
            )
            if not artifact_lore and not item.note.strip():
                continue
            if not _item_matches_turn_signal(item, signal_lower, artifact_lore):
                continue

            # 1. World Artifact Lore (shared scene lore, deduplicated against RAG vector_store)
            if artifact_lore is not None:
                if normalize_item_key(item.name) != artifact_lore.title.strip().lower():
                    prov_title = f"{artifact_lore.title} (held by {c.name} as '{item.name}')"
                else:
                    prov_title = f"{artifact_lore.title} (held by {c.name})"

                if is_lore_substantively_in_working_window(
                    artifact_lore.content, shared_window
                ):
                    updated_shared = [
                        m for m in updated_shared if m.id != artifact_lore.id
                    ]
                else:
                    existing_idx = next(
                        (
                            i
                            for i, m in enumerate(updated_shared)
                            if m.id == artifact_lore.id
                        ),
                        None,
                    )
                    if existing_idx is not None:
                        updated_shared[existing_idx] = updated_shared[
                            existing_idx
                        ].model_copy(update={"title": prov_title})
                    else:
                        updated_shared.append(
                            RecalledMemoryItem(
                                id=artifact_lore.id,
                                source_type="lore",
                                title=prov_title,
                                content=artifact_lore.content,
                                score=1.0,
                            )
                        )

            # 2. Personal Mini-Lore Note (strictly epistemically isolated to holder, or visible equipped on narrator)
            clean_note = item.note.strip()
            if clean_note:
                eff_window = shared_window if is_narrator else c_window
                if not is_lore_substantively_in_working_window(clean_note, eff_window):
                    note_mem_id = f"item_lore:{c.id}:{item.id}"
                    note_mem = RecalledMemoryItem(
                        id=note_mem_id,
                        source_type="item_lore",
                        title=f"{c.name}'s {item.name}",
                        content=clean_note,
                        score=1.0,
                    )
                    holder_list = updated_per_char.setdefault(c.id, [])
                    if not any(m.id == note_mem_id for m in holder_list):
                        holder_list.append(note_mem)
                    if (
                        is_narrator
                        and bucket_kind == "equipped"
                        and not any(m.id == note_mem_id for m in updated_shared)
                    ):
                        updated_shared.append(note_mem)

    return updated_shared, updated_per_char


def _select_scoped_lore_for_turn(
    lore_nodes: Sequence[LoreNode],
    *,
    user_message: str = "",
    pre_turn: PreTurnAnalysis | None = None,
    narrator_directive: str | None = None,
    max_ambient_entries: int = 5,
) -> list[LoreNode]:
    """Shared scorer & hard Python secret gate for location_lore and Level 1 container_lore."""
    if not lore_nodes:
        return []

    ambient_entries = [n for n in lore_nodes if n.category != "secret"]
    secret_entries = [n for n in lore_nodes if n.category == "secret"]

    mentioned = list(pre_turn.mentioned_entities) if pre_turn else []
    queries = list(pre_turn.memory_search_queries) if pre_turn else []
    combined_signal = " ".join(
        part for part in [user_message, narrator_directive or "", *mentioned, *queries] if part
    ).lower()
    signal_tokens = set(_WORD_TOKEN_RE.findall(combined_signal))

    scored_ambient: list[tuple[int, int, LoreNode]] = []
    for idx, entry in enumerate(ambient_entries):
        score = 0
        for tag in entry.entity_tags:
            if _tag_matches_text(tag, combined_signal):
                score += 10
        entry_tokens = set(
            _WORD_TOKEN_RE.findall(
                f"{entry.title} {' '.join(entry.entity_tags)} {entry.content}".lower()
            )
        )
        score += len(signal_tokens & entry_tokens)
        scored_ambient.append((score, -idx, entry))

    scored_ambient.sort(key=lambda item: (item[0], item[1]), reverse=True)
    selected_ambient_set = {id(item[2]) for item in scored_ambient[: max(0, max_ambient_entries)]}
    selected: list[LoreNode] = [
        entry for entry in ambient_entries if id(entry) in selected_ambient_set
    ]

    if not secret_entries:
        return selected

    # Evaluate roll outcomes for hard secret gating
    all_rolls = []
    if pre_turn is not None:
        if pre_turn.character_rolls:
            all_rolls.extend(pre_turn.character_rolls.values())
        elif pre_turn.resolved_roll is not None:
            all_rolls.append(pre_turn.resolved_roll)

    succeeding_rolls = [
        r for r in all_rolls if r.outcome_tier in ("Clean Success", "Critical Success")
    ]
    has_only_failed_rolls = bool(all_rolls) and not succeeding_rolls

    has_discovery_roll_success = False
    roll_signal_lower = ""
    if succeeding_rolls:
        roll_signal_lower = " ".join(
            f"{r.action_description} {r.skill_or_approach}" for r in succeeding_rolls
        ).lower()
        combined_roll_context = f"{roll_signal_lower} {(user_message or '').lower()}"
        has_discovery_roll_success = any(
            stem in combined_roll_context for stem in _DISCOVERY_CHECK_STEMS
        )

    user_and_mentioned_lower = " ".join(
        part for part in [user_message, *mentioned] if part
    ).lower()
    directive_lower = (narrator_directive or "").lower()

    for secret in secret_entries:
        # Explicit narrator directive mentioning a secret tag always unlocks it for narrator scenes
        if directive_lower and any(
            _tag_matches_text(tag, directive_lower) for tag in secret.entity_tags
        ):
            selected.append(secret)
            continue

        # Never leak secrets on turns where a mechanical check occurred and failed
        if has_only_failed_rolls:
            continue

        # Unlock on Clean/Critical Success discovery roll or roll matching secret tags
        if succeeding_rolls:
            if has_discovery_roll_success or any(
                _tag_matches_text(tag, roll_signal_lower) for tag in secret.entity_tags
            ):
                selected.append(secret)
                continue

        # Unlock on direct uncontested keyword mention in player message / mentioned entities
        if user_and_mentioned_lower and any(
            _tag_matches_text(tag, user_and_mentioned_lower) for tag in secret.entity_tags
        ):
            selected.append(secret)

    return selected


def select_active_location_lore_for_turn(
    active_location: LocationNode,
    *,
    user_message: str = "",
    pre_turn: PreTurnAnalysis | None = None,
    narrator_directive: str | None = None,
    max_ambient_entries: int = 5,
) -> list[LoreNode]:
    """Select active-location lore for prompt injection with hard Python secret gating."""
    return _select_scoped_lore_for_turn(
        active_location.lore_nodes,
        user_message=user_message,
        pre_turn=pre_turn,
        narrator_directive=narrator_directive,
        max_ambient_entries=max_ambient_entries,
    )


def select_active_container_lore_for_turn(
    container: LocationContainer,
    *,
    user_message: str = "",
    pre_turn: PreTurnAnalysis | None = None,
    narrator_directive: str | None = None,
    max_ambient_entries: int = 2,
) -> list[LoreNode]:
    """Select Level 1 immediate container lore for prompt injection (strictly capped, secret-gated)."""
    if container.depth != 1 or not container.lore_nodes:
        return []
    return _select_scoped_lore_for_turn(
        container.lore_nodes,
        user_message=user_message,
        pre_turn=pre_turn,
        narrator_directive=narrator_directive,
        max_ambient_entries=max_ambient_entries,
    )


def build_container_chain(
    location: LocationNode,
    containers: Sequence[LocationContainer],
) -> list[LocationContainer]:
    """Resolve root-to-leaf ancestor chain [OuterRealm (L4), ..., ImmediateParent] for a location."""
    if not location.container_id or not containers:
        return []
    by_id = {c.id: c for c in containers}
    chain_rev: list[LocationContainer] = []
    seen: set[str] = set()
    curr_id: str | None = location.container_id
    while curr_id and curr_id in by_id and curr_id not in seen:
        seen.add(curr_id)
        cont = by_id[curr_id]
        chain_rev.append(cont)
        curr_id = cont.parent_container_id
    chain_rev.reverse()
    return chain_rev


def get_immediate_level1_container(
    location: LocationNode,
    world: WorldRecord | None,
) -> LocationContainer | None:
    """Return the location's immediate parent container iff it is a Level 1 container."""
    if world is None or not location.container_id:
        return None
    for cont in world.containers:
        if cont.id == location.container_id:
            return cont if cont.depth == 1 else None
    return None


def _truncate_cue_text(text: str, limit: int = 200) -> str:
    """Clamp narrative threshold cues strictly within the 200-char prompt budget."""
    clean = " ".join(text.split()).strip()
    if len(clean) <= limit:
        return clean
    clipped = clean[: max(1, limit - 1)].rsplit(" ", 1)[0].rstrip(" ,;:")
    if len(clipped) < max(1, limit // 2):
        clipped = clean[: max(1, limit - 1)].rstrip()
    return f"{clipped}…"


def compute_lca_transition_cue(
    origin_location: LocationNode | None,
    target_location: LocationNode,
    containers: Sequence[LocationContainer],
) -> str:
    """Compute Zone 4 threshold cue via Lowest Common Ancestor with Entry Precedence & Turn 0/1 suppression."""
    if origin_location is None or origin_location.id == target_location.id:
        return ""

    origin_chain = build_container_chain(origin_location, containers)
    target_chain = build_container_chain(target_location, containers)

    lca_len = 0
    while (
        lca_len < len(origin_chain)
        and lca_len < len(target_chain)
        and origin_chain[lca_len].id == target_chain[lca_len].id
    ):
        lca_len += 1

    departed = origin_chain[lca_len:]
    entered = target_chain[lca_len:]

    # Entry Precedence: whenever Entered is non-empty, suppress <narrative_exit_cue> completely
    if entered:
        leaf = entered[-1]
        summary_note = f" — {leaf.description}" if leaf.description else ""
        if len(entered) == 1:
            raw = f"You cross into {leaf.name}{summary_note}"
        else:
            path_str = " > ".join(c.name for c in entered)
            raw = f"You enter {path_str}{summary_note}"
        return f"\n  <narrative_entry_cue>{_truncate_cue_text(raw, 200)}</narrative_entry_cue>"

    if departed:
        names = ", ".join(c.name for c in reversed(departed))
        raw = f"You step out of {names} into {target_location.name}."
        return f"\n  <narrative_exit_cue>{_truncate_cue_text(raw, 200)}</narrative_exit_cue>"

    return ""
