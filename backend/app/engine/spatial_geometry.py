"""Pure 2D spatial geometry, visible-path routing, and ReDoS-safe travel cue helpers."""

from __future__ import annotations

import heapq
import math
import re
from dataclasses import dataclass

from app.schemas.affective import MAX_TURN_ELAPSED_MINUTES_SANITY
from app.schemas.world import (
    DEFAULT_EDGE_SPEED_MODIFIER,
    MAX_EDGE_DISTANCE_METERS,
    CompassDirection,
    LocationContainer,
    LocationEdge,
    LocationNode,
    NeighborLocationView,
    WorldRecord,
    canonical_edge_pair_key,
    derive_travel_minutes,
    is_edge_revealed,
    normalize_edge_distance_mode,
    normalize_edge_is_vertical,
    resolve_revealed_edge_pairs,
)

_SQRT1_2 = math.sqrt(0.5)

COMPASS_UNIT_VECTORS: dict[CompassDirection, tuple[float, float]] = {
    "N": (0.0, 1.0),
    "NE": (_SQRT1_2, _SQRT1_2),
    "E": (1.0, 0.0),
    "SE": (_SQRT1_2, -_SQRT1_2),
    "S": (0.0, -1.0),
    "SW": (-_SQRT1_2, -_SQRT1_2),
    "W": (-1.0, 0.0),
    "NW": (-_SQRT1_2, _SQRT1_2),
}

_NUMBER_WORDS: dict[str, int] = {
    "a": 1,
    "an": 1,
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
    "eleven": 11,
    "twelve": 12,
    "fifteen": 15,
    "twenty": 20,
    "thirty": 30,
    "couple of": 2,
    "a couple of": 2,
    "few": 3,
    "a few": 3,
    "several": 4,
}

_NUM_TOKEN = (
    r"(\d{1,4}|a couple of|couple of|a few|few|several|"
    r"an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty)"
)

# Bounded, non-overlapping patterns (py/polynomial-redos safe)
_DISTANCE_RE = re.compile(
    r"\b(\d{1,6}(?:\.\d{1,2})?)\s{0,2}(km|kilometers?|kilometres?|meters?|metres?|m)\b",
    re.I,
)
_HALF_HOUR_RE = re.compile(r"\bhalf\s+an?\s+hour\b", re.I)
_DURATION_TRAVEL_RE = re.compile(
    rf"\b{_NUM_TOKEN}[\s-]+(minute|min|mins|minutes|hour|hr|hrs|hours)\b",
    re.I,
)
_PACE_CRAWL_RE = re.compile(r"\b(?:crawl(?:ing|ed)?|squeez(?:e|ing|ed)|wad(?:e|ing|ed)|creep(?:ing)?)\b", re.I)
_PACE_SPRINT_RE = re.compile(r"\b(?:sprint(?:ing|ed)?|run(?:ning)?|ran|dash(?:ing|ed)?|jog(?:ging|ged)?|rush(?:ing|ed)?)\b", re.I)
_PACE_MOUNT_RE = re.compile(r"\b(?:bik(?:e|ing)|bicycl(?:e|ing)|cycl(?:e|ing)|hors(?:e|eback)|gallop(?:ing|ed)?|ride|riding|rode|mount)\b", re.I)
_PACE_VEHICLE_RE = re.compile(r"\b(?:car|truck|van|taxi|cab|driv(?:e|ing)|drove|motorcycle|motorbik(?:e|ing)|scooter|speeder|hovercar|boat|ferry)\b", re.I)
_PACE_RAIL_RE = re.compile(r"\b(?:train|rail|subway|metro|tram|monorail|maglev)\b", re.I)
_VERTICAL_RE = re.compile(
    r"\b(?:ladder|hatch|trapdoor|shaft|elevator|lift|stairway|staircase|stairs|stairwell|"
    r"basement|cellar|downstairs|upstairs|attic|catwalk|rappelling|rappel|"
    r"climb(?:s|ed|ing)?\s+(?:up|down)|drop(?:s|ped|ping)?\s+down)\b",
    re.I,
)
_NON_EUCLIDEAN_RE = re.compile(
    r"\b(?:magic\s+portal|arcane\s+portal|portal|teleport(?:s|ed|ing)?|warp(?:s|ed|ing)?|"
    r"spatial\s+rift|dimensional\s+(?:rift|door|gate)|wormhole|folded\s+space|shimmering\s+gate)\b",
    re.I,
)


@dataclass(frozen=True)
class TravelCues:
    """Deterministic distance, duration, pace, and physical constraint cues parsed from turn text."""

    distance_meters: int | None = None
    duration_minutes: int | None = None
    speed_modifier: float | None = None
    is_vertical: bool = False
    is_non_euclidean: bool = False


@dataclass(frozen=True)
class GeometricOffset:
    """2D compass displacement implied by visible map geometry between two locations."""

    distance_meters: int
    bearing: CompassDirection
    dx: float
    dy: float


@dataclass(frozen=True)
class VisiblePathResult:
    """Shortest path along currently visible edges."""

    path_node_ids: list[str]
    hop_count: int
    total_distance_meters: int
    total_travel_minutes: int


@dataclass(frozen=True)
class CandidateKnownLocation:
    """Non-adjacent known location candidate safe to expose to Phase 1 & Phase 5 World Clerk."""

    location: LocationNode
    breadcrumb: str
    shortest_path: VisiblePathResult | None
    geometric_offset: GeometricOffset | None
    is_visited: bool
    has_hidden_secret_direct_edge: bool


def normalize_location_name_key(name: str) -> str:
    """Normalize a location name for strict duplicate-name detection."""
    cleaned = " ".join((name or "").strip().lower().split())
    for prefix in ("the ", "a ", "an "):
        if cleaned.startswith(prefix) and len(cleaned) > len(prefix):
            cleaned = cleaned[len(prefix):]
            break
    return cleaned


def vector_to_compass(dx: float, dy: float) -> CompassDirection:
    """Quantize a non-zero 2D (east, north) displacement vector into the nearest 8-way compass direction."""
    if abs(dx) < 1e-9 and abs(dy) < 1e-9:
        return "N"
    # Angle measured clockwise from North (0 = N, 45 = NE, 90 = E, ...)
    deg = math.degrees(math.atan2(dx, dy)) % 360.0
    idx = int((deg + 22.5) // 45.0) % 8
    order: tuple[CompassDirection, ...] = ("N", "NE", "E", "SE", "S", "SW", "W", "NW")
    return order[idx]


def extract_travel_cues(text: str) -> TravelCues:
    """Extract bounded metric distance, travel minutes, speed, vertical, and portal cues from text."""
    if not text:
        return TravelCues()

    distance_meters: int | None = None
    m_dist = _DISTANCE_RE.search(text)
    if m_dist:
        try:
            raw_val = float(m_dist.group(1))
            unit = m_dist.group(2).lower()
            meters = raw_val * 1000.0 if unit.startswith("k") else raw_val
            if meters > 0 and math.isfinite(meters):
                distance_meters = max(1, min(MAX_EDGE_DISTANCE_METERS, int(round(meters))))
        except ValueError:
            distance_meters = None

    duration_minutes: int | None = None
    if _HALF_HOUR_RE.search(text):
        duration_minutes = 30
    else:
        m_dur = _DURATION_TRAVEL_RE.search(text)
        if m_dur:
            tok = " ".join(m_dur.group(1).lower().split())
            num_val = int(tok) if tok.isdigit() else _NUMBER_WORDS.get(tok, 1)
            unit = m_dur.group(2).lower()
            mult = 60 if unit.startswith(("h",)) else 1
            duration_minutes = max(1, min(MAX_TURN_ELAPSED_MINUTES_SANITY, num_val * mult))

    speed_modifier: float | None = None
    if _PACE_RAIL_RE.search(text):
        speed_modifier = 25.0
    elif _PACE_VEHICLE_RE.search(text):
        speed_modifier = 10.0
    elif _PACE_MOUNT_RE.search(text):
        speed_modifier = 3.0
    elif _PACE_SPRINT_RE.search(text):
        speed_modifier = 2.0
    elif _PACE_CRAWL_RE.search(text):
        speed_modifier = 0.3

    return TravelCues(
        distance_meters=distance_meters,
        duration_minutes=duration_minutes,
        speed_modifier=speed_modifier,
        is_vertical=bool(_VERTICAL_RE.search(text)),
        is_non_euclidean=bool(_NON_EUCLIDEAN_RE.search(text)),
    )


def _visible_edges(
    edges: list[LocationEdge],
    revealed_edge_ids: set[str],
    gm_unlocked: bool,
) -> tuple[list[LocationEdge], set[tuple[str, str]]]:
    """Return edges visible under Player/GM rules plus canonical pairs of hidden secret edges."""
    if gm_unlocked:
        return list(edges), set()
    revealed_pairs = resolve_revealed_edge_pairs(edges, revealed_edge_ids)
    visible: list[LocationEdge] = []
    hidden_pairs: set[tuple[str, str]] = set()
    for edge in edges:
        if edge.is_secret and not is_edge_revealed(
            edge.id,
            edge.from_location_id,
            edge.to_location_id,
            revealed_edge_ids,
            revealed_pairs,
        ):
            hidden_pairs.add(canonical_edge_pair_key(edge.from_location_id, edge.to_location_id))
            continue
        visible.append(edge)
    return visible, hidden_pairs


def find_shortest_visible_path(
    world: WorldRecord,
    from_id: str,
    to_id: str,
    *,
    revealed_edge_ids: set[str] | None = None,
    gm_unlocked: bool = False,
) -> VisiblePathResult | None:
    """Compute shortest directed path across currently visible edges minimizing `(minutes, hops)`."""
    if from_id == to_id:
        return VisiblePathResult(
            path_node_ids=[from_id],
            hop_count=0,
            total_distance_meters=0,
            total_travel_minutes=0,
        )
    rev_set = set(revealed_edge_ids or ())
    visible, _ = _visible_edges(world.edges, rev_set, gm_unlocked)

    adj: dict[str, list[LocationEdge]] = {}
    for edge in visible:
        adj.setdefault(edge.from_location_id, []).append(edge)

    dist: dict[str, tuple[int, int, int]] = {from_id: (0, 0, 0)}  # (minutes, hops, meters)
    prev: dict[str, str] = {}
    heap: list[tuple[int, int, int, str]] = [(0, 0, 0, from_id)]

    while heap:
        cur_min, cur_hops, cur_m, u = heapq.heappop(heap)
        best = dist.get(u)
        if best is not None and (cur_min, cur_hops, cur_m) > best:
            continue
        if u == to_id:
            break
        for edge in adj.get(u, ()):
            v = edge.to_location_id
            hop_min = derive_travel_minutes(edge.distance_meters, edge.speed_modifier)
            cand_cost = (cur_min + hop_min, cur_hops + 1, cur_m + int(edge.distance_meters))
            if v not in dist or cand_cost < dist[v]:
                dist[v] = cand_cost
                prev[v] = u
                heapq.heappush(heap, (*cand_cost, v))

    if to_id not in dist:
        return None
    path: list[str] = [to_id]
    cur = to_id
    while cur != from_id:
        cur = prev[cur]
        path.append(cur)
    path.reverse()
    total_min, total_hops, total_m = dist[to_id]
    return VisiblePathResult(
        path_node_ids=path,
        hop_count=total_hops,
        total_distance_meters=total_m,
        total_travel_minutes=min(MAX_TURN_ELAPSED_MINUTES_SANITY, total_min),
    )


def _container_chain(
    cont_id: str | None,
    cont_map: dict[str, LocationContainer],
) -> list[str]:
    chain: list[str] = []
    seen: set[str] = set()
    cur = cont_id
    while cur and cur in cont_map and cur not in seen:
        seen.add(cur)
        chain.append(cur)
        cur = cont_map[cur].parent_container_id
    return chain


def _scope_node_key(
    loc: LocationNode,
    active_container_id: str | None,
    cont_map: dict[str, LocationContainer],
) -> str:
    """Collapse child containers outside `active_container_id` to their immediate parent macro node."""
    if not loc.container_id or loc.container_id == active_container_id:
        return loc.id
    chain = _container_chain(loc.container_id, cont_map)
    if not active_container_id:
        return f"cont:{chain[-1]}" if chain else loc.id
    if active_container_id in chain:
        idx = chain.index(active_container_id)
        if idx == 0:
            return loc.id
        return f"cont:{chain[idx - 1]}"
    return loc.id


def compute_visible_scope_positions(
    world: WorldRecord,
    active_location_id: str,
    *,
    revealed_edge_ids: set[str] | None = None,
    gm_unlocked: bool = False,
) -> dict[str, tuple[float, float]]:
    """Project visible non-portal horizontal distances relative to `active_location_id` at `(0, 0)`."""
    loc_map = {loc.id: loc for loc in world.locations}
    active_loc = loc_map.get(active_location_id)
    if active_loc is None:
        return {}
    cont_map = {c.id: c for c in world.containers}
    active_cont_id = active_loc.container_id

    rev_set = set(revealed_edge_ids or ())
    visible, _ = _visible_edges(world.edges, rev_set, gm_unlocked)

    scope_key_by_loc: dict[str, str] = {
        loc.id: _scope_node_key(loc, active_cont_id, cont_map)
        for loc in world.locations
    }

    # Union-Find to contract vertical edges cleanly
    parent: dict[str, str] = {}

    def _find(x: str) -> str:
        while parent.get(x, x) != x:
            parent[x] = parent.get(parent[x], parent[x])
            x = parent[x]
        return parent.setdefault(x, x)

    def _union(a: str, b: str) -> None:
        ra, rb = _find(a), _find(b)
        if ra != rb:
            parent[rb] = ra

    for k in set(scope_key_by_loc.values()):
        _find(k)

    # First contract vertical links between nodes within active scope
    horizontal_edges: list[tuple[str, str, float, float]] = []
    pair_dirs: dict[tuple[str, str], LocationEdge] = {}
    for edge in visible:
        if normalize_edge_distance_mode(edge.distance_mode) == "non_euclidean":
            continue
        pair_dirs.setdefault((edge.from_location_id, edge.to_location_id), edge)

    for (u_loc, v_loc), edge in pair_dirs.items():
        ku = scope_key_by_loc.get(u_loc)
        kv = scope_key_by_loc.get(v_loc)
        if not ku or not kv or ku == kv:
            continue
        if normalize_edge_is_vertical(edge.is_vertical):
            _union(ku, kv)
            continue
        if edge.compass_direction is None:
            continue
        ux, uy = COMPASS_UNIT_VECTORS.get(edge.compass_direction, (0.0, 1.0))
        d = float(max(1, edge.distance_meters))
        horizontal_edges.append((ku, kv, ux * d, uy * d))

    # Build averaged displacement adjacency per contracted root
    adj: dict[str, dict[str, tuple[float, float, int]]] = {}
    for ku, kv, dx, dy in horizontal_edges:
        ru, rv = _find(ku), _find(kv)
        if ru == rv:
            continue
        bucket = adj.setdefault(ru, {})
        prev_dx, prev_dy, prev_cnt = bucket.get(rv, (0.0, 0.0, 0))
        bucket[rv] = (prev_dx + dx, prev_dy + dy, prev_cnt + 1)

        rev_bucket = adj.setdefault(rv, {})
        rprev_dx, rprev_dy, rprev_cnt = rev_bucket.get(ru, (0.0, 0.0, 0))
        rev_bucket[ru] = (rprev_dx - dx, rprev_dy - dy, rprev_cnt + 1)

    start_root = _find(scope_key_by_loc[active_location_id])
    coords: dict[str, tuple[float, float]] = {start_root: (0.0, 0.0)}
    queue: list[str] = [start_root]
    head = 0
    while head < len(queue):
        u = queue[head]
        head += 1
        ux, uy = coords[u]
        for v, (sum_dx, sum_dy, cnt) in adj.get(u, {}).items():
            if v in coords:
                continue
            coords[v] = (ux + sum_dx / cnt, uy + sum_dy / cnt)
            queue.append(v)

    result: dict[str, tuple[float, float]] = {}
    for loc_id, skey in scope_key_by_loc.items():
        root = _find(skey)
        if root in coords:
            result[loc_id] = coords[root]
    return result


def estimate_euclidean_offset(
    world: WorldRecord,
    from_id: str,
    to_id: str,
    *,
    revealed_edge_ids: set[str] | None = None,
    gm_unlocked: bool = False,
) -> GeometricOffset | None:
    """Compute implied 2D horizontal distance and compass bearing from `from_id` to `to_id`."""
    positions = compute_visible_scope_positions(
        world,
        from_id,
        revealed_edge_ids=revealed_edge_ids,
        gm_unlocked=gm_unlocked,
    )
    p1 = positions.get(from_id)
    p2 = positions.get(to_id)
    if p1 is None or p2 is None:
        return None
    dx = p2[0] - p1[0]
    dy = p2[1] - p1[1]
    dist = math.hypot(dx, dy)
    if dist < 0.5:
        return None
    clamped = max(1, min(MAX_EDGE_DISTANCE_METERS, int(round(dist))))
    return GeometricOffset(
        distance_meters=clamped,
        bearing=vector_to_compass(dx, dy),
        dx=dx,
        dy=dy,
    )


def _build_breadcrumb(cont_id: str | None, cont_map: dict[str, LocationContainer]) -> str:
    if not cont_id or cont_id not in cont_map:
        return ""
    names: list[str] = []
    cur: str | None = cont_id
    seen: set[str] = set()
    while cur and cur in cont_map and cur not in seen:
        seen.add(cur)
        names.append(cont_map[cur].name)
        cur = cont_map[cur].parent_container_id
    names.reverse()
    return " > ".join(names)


def select_candidate_known_locations(
    world: WorldRecord,
    active_location_id: str,
    visible_neighbors: list[NeighborLocationView],
    visited_location_ids: set[str] | list[str] | None = None,
    revealed_edge_ids: set[str] | list[str] | None = None,
    gm_unlocked: bool = False,
    *,
    user_message: str = "",
    limit: int = 20,
) -> list[CandidateKnownLocation]:
    """Select non-adjacent known/reachable locations safe to show Phase 1 & World Clerk."""
    neighbor_ids = {nb.destination.id for nb in visible_neighbors}
    visited_set = set(visited_location_ids or ())
    rev_set = set(revealed_edge_ids or ())
    _, hidden_secret_pairs = _visible_edges(world.edges, rev_set, gm_unlocked)
    cont_map = {c.id: c for c in world.containers}
    msg_low = (user_message or "").lower()
    active_loc = next((l for l in world.locations if l.id == active_location_id), None)
    active_cont_id = active_loc.container_id if active_loc else None

    positions = compute_visible_scope_positions(
        world,
        active_location_id,
        revealed_edge_ids=rev_set,
        gm_unlocked=gm_unlocked,
    )
    p_origin = positions.get(active_location_id)

    candidates: list[CandidateKnownLocation] = []
    for loc in world.locations:
        if loc.id == active_location_id or loc.id in neighbor_ids:
            continue
        sp = find_shortest_visible_path(
            world,
            active_location_id,
            loc.id,
            revealed_edge_ids=rev_set,
            gm_unlocked=gm_unlocked,
        )
        is_vis = loc.id in visited_set or bool(loc.is_starting_location)
        # Never expose unvisited locations reachable solely behind unrevealed secret links
        if not is_vis and (sp is None or sp.hop_count > 3):
            continue

        geo: GeometricOffset | None = None
        if p_origin is not None and loc.id in positions:
            p_dest = positions[loc.id]
            dx = p_dest[0] - p_origin[0]
            dy = p_dest[1] - p_origin[1]
            dist = math.hypot(dx, dy)
            if dist >= 0.5:
                geo = GeometricOffset(
                    distance_meters=max(1, min(MAX_EDGE_DISTANCE_METERS, int(round(dist)))),
                    bearing=vector_to_compass(dx, dy),
                    dx=dx,
                    dy=dy,
                )

        pair_key = canonical_edge_pair_key(active_location_id, loc.id)
        candidates.append(
            CandidateKnownLocation(
                location=loc,
                breadcrumb=_build_breadcrumb(loc.container_id, cont_map),
                shortest_path=sp,
                geometric_offset=geo,
                is_visited=is_vis,
                has_hidden_secret_direct_edge=(pair_key in hidden_secret_pairs),
            )
        )

    def _sort_key(cand: CandidateKnownLocation) -> tuple[int, int, int, int, str]:
        name_low = cand.location.name.lower()
        norm_key = normalize_location_name_key(cand.location.name)
        mentioned = int(
            bool(msg_low and ((name_low and name_low in msg_low) or (norm_key and norm_key in msg_low)))
        )
        visited_rank = 1 if cand.is_visited else 0
        hops = cand.shortest_path.hop_count if cand.shortest_path is not None else 999
        same_cont = 1 if cand.location.container_id == active_cont_id else 0
        return (-mentioned, -visited_rank, hops, -same_cont, name_low)

    candidates.sort(key=_sort_key)
    return candidates[: max(1, int(limit))]


def format_candidate_known_locations_block(
    candidates: list[CandidateKnownLocation],
    *,
    include_ids: bool = True,
) -> str:
    """Format non-adjacent known locations compactly for Phase 1 & Phase 5 prompts."""
    if not candidates:
        return "None"
    lines: list[str] = []
    for cand in candidates:
        hints: list[str] = []
        if cand.breadcrumb:
            hints.append(cand.breadcrumb)
        if cand.shortest_path is not None:
            hints.append(
                f"{cand.shortest_path.hop_count} hops (~{cand.shortest_path.total_travel_minutes} min via existing route)"
            )
        elif cand.is_visited:
            hints.append("visited")
        if cand.geometric_offset is not None:
            est_min = derive_travel_minutes(
                cand.geometric_offset.distance_meters,
                DEFAULT_EDGE_SPEED_MODIFIER,
            )
            hints.append(
                f"~{cand.geometric_offset.distance_meters}m {cand.geometric_offset.bearing} straight-line (~{est_min} min walk)"
            )
        hint_str = f" ({'; '.join(hints)})" if hints else ""
        if include_ids:
            lines.append(f"- id='{cand.location.id}': {cand.location.name}{hint_str}")
        else:
            lines.append(f"- {cand.location.name}{hint_str}")
    return "\n".join(lines)
