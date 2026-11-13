"""Legacy snapshot hydration, seeding, and CARE state materialization."""

from __future__ import annotations

from app.schemas.affective import (
    AffectiveCareState,
    RelationalEdge,
    SituationalAppraisal,
    WorldviewProfile,
)
from app.schemas.character import (
    BaselinePsyche,
    CharacterStateSnapshot,
)
from collections.abc import Mapping

from app.engine.affective.lexical import (
    _edge_compact_summary,
    derive_active_emotion,
    describe_outward_demeanor,
    describe_pad_disposition,
)
from app.engine.affective.models import (
    _NARRATOR_ALIASES,
    _USER_ALIASES,
    _clamp,
    build_stranger_edge,
)

# ---------------------------------------------------------------------------
# Seeding, Legacy Hydration, & Snapshot Materialization
# ---------------------------------------------------------------------------


def _refresh_derived_care_fields(
    care: AffectiveCareState,
    *,
    preferred_mood_label: str | None = None,
    primary_target_id: str = "user",
) -> AffectiveCareState:
    short_label, _ = describe_pad_disposition(
        care.valence, care.arousal, care.dominance
    )
    effective_label = (
        preferred_mood_label.strip()[:80]
        if (preferred_mood_label and preferred_mood_label.strip())
        else short_label
    )
    primary_edge = care.relations.get(primary_target_id) or care.relations.get("user")
    emotion = derive_active_emotion(
        valence=care.valence,
        arousal=care.arousal,
        dominance=care.dominance,
        ambiguity=care.appraisal.ambiguity,
        primary_edge=primary_edge,
        prior_emotion=care.active_emotion,
    )
    demeanor = describe_outward_demeanor(
        valence=care.valence,
        arousal=care.arousal,
        dominance=care.dominance,
        composure=care.composure,
        short_mood_label=effective_label,
    )
    return care.model_copy(
        update={
            "active_emotion": emotion,
            "short_mood_label": effective_label,
            "outward_demeanor": demeanor,
        }
    )


def seed_initial_care_state(
    psyche: BaselinePsyche,
    *,
    initial_elapsed_minutes: int = 0,
    initial_user_note: str = "Acquaintance / Uncertain trust",
) -> AffectiveCareState:
    """Construct Turn-0 authoritative AffectiveCareState from immutable CharacterRecord seed."""
    wv = psyche.initial_worldview.model_copy()
    v0 = round(_clamp(psyche.valence, -1.0, 1.0), 4)
    a0 = round(_clamp(psyche.arousal, 0.0, 1.0), 4)
    d0 = round(_clamp(0.40 * wv.agency, -1.0, 1.0), 4)
    c0 = round(
        _clamp(0.82 + 0.06 * (psyche.temperament.composure_resilience - 1.0), 0.55, 0.96),
        4,
    )
    user_edge = build_stranger_edge("user", wv, episodic_note=initial_user_note)
    base = AffectiveCareState(
        schema_version=1,
        is_provisional=False,
        state_elapsed_minutes=max(0, int(initial_elapsed_minutes)),
        valence=v0,
        arousal=a0,
        dominance=d0,
        composure=c0,
        mood_variance=(0.08, 0.08, 0.08),
        active_worldview=wv,
        appraisal=SituationalAppraisal(),
        relations={"user": user_edge},
    )
    return _refresh_derived_care_fields(base, preferred_mood_label=psyche.mood_label)


def _infer_edge_from_legacy_note(
    target_id: str,
    note: str,
    worldview: WorldviewProfile,
) -> RelationalEdge:
    edge = build_stranger_edge(target_id, worldview, episodic_note=note)
    low = note.lower()
    w = edge.warmth
    t = edge.trust
    r = edge.respect
    g = 0.0
    o = 0.0
    if any(k in low for k in ("ally", "friend", "fond", "warm", "loyal", "care")):
        w = _clamp(w + 0.40, -1.0, 1.0)
        t = _clamp(t + 0.35, -1.0, 1.0)
    if any(k in low for k in ("trust", "confid", "reliab")):
        t = _clamp(t + 0.40, -1.0, 1.0)
    if any(k in low for k in ("distrust", "suspici", "wary", "skeptic", "doubt")):
        t = _clamp(t - 0.40, -1.0, 1.0)
    if any(k in low for k in ("hostil", "enem", "hate", "furi", "despis", "malic")):
        w = _clamp(w - 0.55, -1.0, 1.0)
        t = _clamp(t - 0.50, -1.0, 1.0)
    if any(k in low for k in ("betray", "grudge", "grievance", "unforgiv", "wronged")):
        g = 0.55
        t = _clamp(t - 0.45, -1.0, 1.0)
    if any(k in low for k in ("respect", "admir", "capable", "impress")):
        r = _clamp(r + 0.40, -1.0, 1.0)
    if any(k in low for k in ("contempt", "disdain", "pathetic", "weak")):
        r = _clamp(r - 0.45, -1.0, 1.0)
    if any(k in low for k in ("indebted", "owes them", "life-debt", "saved my")):
        o = 0.50
    return edge.model_copy(
        update={
            "warmth": round(w, 4),
            "trust": round(t, 4),
            "respect": round(r, 4),
            "grievance": round(g, 4),
            "obligation": round(o, 4),
            "consolidated_warmth": round(w, 4),
            "consolidated_trust": round(t, 4),
        }
    )


def hydrate_legacy_care_state(
    *,
    valence: float,
    arousal: float,
    mood_label: str,
    relationship_notes: Mapping[str, str],
    psyche: BaselinePsyche,
    elapsed_minutes: int = 0,
) -> AffectiveCareState:
    """Deterministically upgrade a pre-CARE SQLite row (affective_state_json == '{}')."""
    seeded = seed_initial_care_state(
        psyche, initial_elapsed_minutes=max(0, int(elapsed_minutes))
    )
    relations = dict(seeded.relations)
    for raw_key, raw_note in (relationship_notes or {}).items():
        key = str(raw_key or "").strip()
        if not key:
            continue
        canon_key = "user" if key.lower() in _USER_ALIASES else key
        if canon_key.lower() in _NARRATOR_ALIASES:
            continue
        relations[canon_key] = _infer_edge_from_legacy_note(
            canon_key, str(raw_note or "").strip(), seeded.active_worldview
        )
    updated = seeded.model_copy(
        update={
            "valence": round(_clamp(float(valence), -1.0, 1.0), 4),
            "arousal": round(_clamp(float(arousal), 0.0, 1.0), 4),
            "relations": relations,
        }
    )
    pref_label = mood_label if mood_label and mood_label != "Objective / Detached" else None
    return _refresh_derived_care_fields(updated, preferred_mood_label=pref_label)


def ensure_snapshot_care_state(
    snapshot: CharacterStateSnapshot,
    psyche: BaselinePsyche,
    *,
    elapsed_minutes: int = 0,
) -> AffectiveCareState:
    """Return snapshot.care_state if present (syncing any newly injected relationship_notes), else hydrate."""
    if snapshot.care_state is not None:
        care = snapshot.care_state
        raw_notes = snapshot.relationship_notes or {}
        if not raw_notes:
            return care
        updated_rels: dict[str, RelationalEdge] | None = None
        for raw_key, raw_note in raw_notes.items():
            key = str(raw_key or "").strip()
            if not key:
                continue
            canon_key = "user" if key.lower() in _USER_ALIASES else key
            if canon_key.lower() in _NARRATOR_ALIASES:
                continue
            note_str = str(raw_note or "").strip()
            existing = care.relations.get(canon_key)
            if existing is None:
                if updated_rels is None:
                    updated_rels = dict(care.relations)
                updated_rels[canon_key] = _infer_edge_from_legacy_note(
                    canon_key, note_str, care.active_worldview
                )
            elif (
                canon_key == "user"
                and existing.episodic_note == "Acquaintance / Uncertain trust"
                and note_str
                and note_str != existing.episodic_note
                and note_str != _edge_compact_summary(existing)
            ):
                if updated_rels is None:
                    updated_rels = dict(care.relations)
                updated_rels["user"] = _infer_edge_from_legacy_note(
                    "user", note_str, care.active_worldview
                )
        if updated_rels is not None:
            return _refresh_derived_care_fields(
                care.model_copy(update={"relations": updated_rels}),
                preferred_mood_label=care.short_mood_label,
            )
        return care
    return hydrate_legacy_care_state(
        valence=snapshot.valence,
        arousal=snapshot.arousal,
        mood_label=snapshot.mood_label,
        relationship_notes=snapshot.relationship_notes,
        psyche=psyche,
        elapsed_minutes=elapsed_minutes,
    )


def materialize_snapshot_with_care(
    snapshot: CharacterStateSnapshot,
    care_state: AffectiveCareState,
) -> CharacterStateSnapshot:
    """One-way projection syncing top-level valence, arousal, mood_label & relationship_notes."""
    merged_notes = dict(snapshot.relationship_notes or {})
    for target_id, edge in care_state.relations.items():
        summary = _edge_compact_summary(edge)
        if edge.episodic_note or target_id in merged_notes or target_id != "user":
            if (
                edge.episodic_note
                and merged_notes.get(target_id) == edge.episodic_note
                and summary.startswith("Measured / neutral — ")
            ):
                merged_notes[target_id] = edge.episodic_note
            else:
                merged_notes[target_id] = summary
        elif (
            abs(edge.warmth) >= 0.25
            or abs(edge.trust) >= 0.25
            or abs(edge.respect) >= 0.25
            or edge.grievance >= 0.20
            or abs(edge.obligation) >= 0.20
        ):
            merged_notes[target_id] = summary

    return snapshot.model_copy(
        update={
            "valence": round(_clamp(care_state.valence, -1.0, 1.0), 3),
            "arousal": round(_clamp(care_state.arousal, 0.0, 1.0), 3),
            "mood_label": care_state.short_mood_label,
            "relationship_notes": merged_notes,
            "care_state": care_state,
        }
    )
