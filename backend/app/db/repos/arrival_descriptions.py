"""Pure helpers for resolving cosmetic first-visit arrival description cards."""

from __future__ import annotations

from collections.abc import Sequence

from app.schemas.turn import FirstVisitDescriptionCard, FirstVisitMediaItem
from app.schemas.world import LocationContainer, LocationNode

BOILERPLATE_DESCRIPTIONS: frozenset[str] = frozenset(
    {
        "a newly connected location awaiting description.",
        "a newly added structure.",
        "a newly created district or zone.",
        "an unexplored area.",
    }
)


def is_meaningful_description(description: str | None) -> bool:
    """Return True when description has authored prose rather than blank or map stub text."""
    cleaned = (description or "").strip()
    if not cleaned:
        return False
    return cleaned.lower() not in BOILERPLATE_DESCRIPTIONS


def resolve_ancestor_container_chain(
    container_id: str | None,
    container_by_id: dict[str, LocationContainer],
) -> list[LocationContainer]:
    """Return container ancestry ordered outermost -> innermost."""
    chain_rev: list[LocationContainer] = []
    seen: set[str] = set()
    curr_id = container_id
    while curr_id and curr_id in container_by_id and curr_id not in seen:
        seen.add(curr_id)
        cont = container_by_id[curr_id]
        chain_rev.append(cont)
        curr_id = cont.parent_container_id
    chain_rev.reverse()
    return chain_rev


def derive_visited_container_ids(
    visited_location_ids: Sequence[str],
    explicit_visited_containers: Sequence[str],
    location_by_id: dict[str, LocationNode],
    container_by_id: dict[str, LocationContainer],
) -> list[str]:
    """Combine persisted visited container IDs with inferred ancestors of visited locations."""
    ordered: list[str] = []
    seen: set[str] = set()
    for cid in explicit_visited_containers:
        if cid and cid not in seen:
            seen.add(cid)
            ordered.append(cid)
    for lid in visited_location_ids:
        loc = location_by_id.get(lid)
        if not loc or not loc.container_id:
            continue
        for cont in resolve_ancestor_container_chain(loc.container_id, container_by_id):
            if cont.id not in seen:
                seen.add(cont.id)
                ordered.append(cont.id)
    return ordered


def build_first_visit_arrival(
    *,
    target_location: LocationNode,
    containers: Sequence[LocationContainer],
    locations: Sequence[LocationNode],
    prev_visited_locations: Sequence[str],
    prev_visited_containers: Sequence[str],
    describe_on_first_visit: bool,
    skip_location_card: bool = False,
    suppress_cards: bool = False,
    extra_visited_location_ids: Sequence[str] = (),
) -> tuple[list[FirstVisitDescriptionCard], list[str], list[str]]:
    """Compute first-visit description cards (outer -> inner -> location) and updated branch visit lists."""
    cards, _media, merged_locations, merged_containers = build_first_visit_arrival_bundle(
        target_location=target_location,
        containers=containers,
        locations=locations,
        prev_visited_locations=prev_visited_locations,
        prev_visited_containers=prev_visited_containers,
        describe_on_first_visit=describe_on_first_visit,
        skip_location_card=skip_location_card,
        suppress_cards=suppress_cards,
        emit_media=False,
        extra_visited_location_ids=extra_visited_location_ids,
    )
    return cards, merged_locations, merged_containers


def build_first_visit_arrival_bundle(
    *,
    target_location: LocationNode,
    containers: Sequence[LocationContainer],
    locations: Sequence[LocationNode],
    prev_visited_locations: Sequence[str],
    prev_visited_containers: Sequence[str],
    describe_on_first_visit: bool,
    skip_location_card: bool = False,
    suppress_cards: bool = False,
    emit_media: bool | None = None,
    extra_visited_location_ids: Sequence[str] = (),
) -> tuple[list[FirstVisitDescriptionCard], list[FirstVisitMediaItem], list[str], list[str]]:
    """Compute first-visit description cards, deduplicated arrival media items, and updated visit lists."""
    container_by_id = {c.id: c for c in containers}
    location_by_id = {l.id: l for l in locations}
    location_by_id.setdefault(target_location.id, target_location)

    prior_loc_set = set(prev_visited_locations)
    prior_cont_list = derive_visited_container_ids(
        prev_visited_locations,
        prev_visited_containers,
        location_by_id,
        container_by_id,
    )
    prior_cont_set = set(prior_cont_list)

    target_chain = resolve_ancestor_container_chain(
        target_location.container_id,
        container_by_id,
    )

    should_emit_media = describe_on_first_visit if emit_media is None else emit_media
    cards: list[FirstVisitDescriptionCard] = []
    raw_media_items: list[FirstVisitMediaItem] = []

    if describe_on_first_visit and not suppress_cards:
        for cont in target_chain:
            if cont.id not in prior_cont_set and is_meaningful_description(cont.description):
                cards.append(
                    FirstVisitDescriptionCard(
                        entity_type="container",
                        entity_id=cont.id,
                        depth=cont.depth,
                        title=cont.name,
                        description=cont.description.strip(),
                    )
                )
        if (
            not skip_location_card
            and target_location.id not in prior_loc_set
            and is_meaningful_description(target_location.description)
        ):
            cards.append(
                FirstVisitDescriptionCard(
                    entity_type="location",
                    entity_id=target_location.id,
                    depth=0,
                    title=target_location.name,
                    description=target_location.description.strip(),
                )
            )

    if should_emit_media:
        for cont in target_chain:
            if (
                cont.id not in prior_cont_set
                and cont.image_media_id
                and cont.image_url
            ):
                raw_media_items.append(
                    FirstVisitMediaItem(
                        entity_type="container",
                        entity_id=cont.id,
                        depth=cont.depth,
                        entity_name=cont.name,
                        media_id=cont.image_media_id,
                        image_url=cont.image_url,
                        label=(cont.image_label or "").strip() or cont.name,
                    )
                )
        if (
            target_location.id not in prior_loc_set
            and target_location.image_media_id
            and target_location.image_url
        ):
            raw_media_items.append(
                FirstVisitMediaItem(
                    entity_type="location",
                    entity_id=target_location.id,
                    depth=0,
                    entity_name=target_location.name,
                    media_id=target_location.image_media_id,
                    image_url=target_location.image_url,
                    label=(target_location.image_label or "").strip() or target_location.name,
                )
            )

    # Deduplicate repeated media_ids within a single arrival event, keeping the innermost occurrence.
    dedup_rev: list[FirstVisitMediaItem] = []
    seen_media_ids: set[str] = set()
    for item in reversed(raw_media_items):
        if item.media_id in seen_media_ids:
            continue
        seen_media_ids.add(item.media_id)
        dedup_rev.append(item)
    dedup_rev.reverse()

    merged_locations = list(
        dict.fromkeys([*prev_visited_locations, *extra_visited_location_ids, target_location.id])
    )
    merged_containers = derive_visited_container_ids(
        merged_locations,
        [*prior_cont_list, *(c.id for c in target_chain)],
        location_by_id,
        container_by_id,
    )
    return cards, dedup_rev, merged_locations, merged_containers
