"""Leaf schemas for traveling parties, cognitive invite/travel intents, and party events."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

USER_PARTY_MEMBER_ID = "user"

TravelIntent = Literal["default", "stay_behind", "follow_player"]
PartyInviteDecision = Literal["accept", "refuse"]
PartyActionKind = Literal["invite", "leave", "kick", "disband"]
PartyActionSource = Literal["slash_command", "party_modal"]
LocationOverrideMoveMode = Literal["party", "alone", "subset"]


class PartyRecord(BaseModel):
    """Snapshot of a co-located group of 2+ characters (including 'user' via canonical sentinel)."""

    id: str
    name: str = ""
    member_ids: list[str] = Field(min_length=2)
    leader_id: str = ""
    location_id: str
    shared_goal: str | None = None
    formed_at_turn_id: str | None = None

    @model_validator(mode="after")
    def _validate_and_normalize(self) -> PartyRecord:
        deduped: list[str] = []
        seen: set[str] = set()
        for raw_id in self.member_ids:
            cid = str(raw_id or "").strip()
            if cid and cid not in seen:
                seen.add(cid)
                deduped.append(cid)
        if len(deduped) < 2:
            raise ValueError("A party must contain at least 2 unique members.")
        self.member_ids = deduped
        if USER_PARTY_MEMBER_ID in deduped:
            self.leader_id = USER_PARTY_MEMBER_ID
        elif self.leader_id not in deduped:
            self.leader_id = deduped[0]
        self.name = (self.name or "").strip()
        if self.shared_goal is not None:
            goal = self.shared_goal.strip()
            self.shared_goal = goal or None
        return self


class PartyActionSpec(BaseModel):
    """Explicit party action command submitted via /party slash command or the Party Management modal."""

    kind: PartyActionKind
    target_character_ids: list[str] = Field(default_factory=list)
    message: str | None = None
    source: PartyActionSource = "slash_command"

    @model_validator(mode="after")
    def _normalize_fields(self) -> PartyActionSpec:
        deduped: list[str] = []
        seen: set[str] = set()
        for cid in self.target_character_ids:
            clean = str(cid or "").strip()
            if clean and clean not in seen:
                seen.add(clean)
                deduped.append(clean)
        self.target_character_ids = deduped
        if self.message is not None:
            msg = self.message.strip()
            self.message = msg or None
        return self


class PartyInviteOutcome(BaseModel):
    """Recorded Phase 3 accept/refuse evaluation for an invited character."""

    character_id: str
    character_name: str
    decision: PartyInviteDecision
    reason: str = ""
    joined_party_id: str | None = None


class PartyEventDelta(BaseModel):
    """Audit summary of party membership and travel outcomes reconciled during Phase 5."""

    action_kind: PartyActionKind | None = None
    invite_outcomes: list[PartyInviteOutcome] = Field(default_factory=list)
    formed_party_ids: list[str] = Field(default_factory=list)
    updated_party_ids: list[str] = Field(default_factory=list)
    disbanded_party_ids: list[str] = Field(default_factory=list)
    departed_member_ids: list[str] = Field(default_factory=list)
    stayed_behind_ids: list[str] = Field(default_factory=list)
    followed_player_ids: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
