import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Crown,
  LogOut,
  MapPin,
  Plus,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import {
  USER_PARTY_MEMBER_ID,
  type CharacterRecord,
  type CharacterStateSnapshot,
  type CreateNpcPartyPayload,
  type LocationNode,
  type MechanicsTopicId,
  type PartyActionSpec,
  type PartyRecord,
} from "../../types";
import { MechanicsHelpButton } from "../shared/MechanicsHelpButton";
import { useModalDialog } from "../../hooks/useModalDialog";
import {
  getCharacterParty,
  getNpcOnlyParties,
  getPlayerParty,
} from "../../utils/partyHelpers";

export interface PartyManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  parties: PartyRecord[];
  activeLocationId: string;
  locations: LocationNode[];
  presentCharacterIds: string[];
  characterRecords: Record<string, CharacterRecord>;
  characterStates: Record<string, CharacterStateSnapshot>;
  personaName?: string | null;
  isMutatingLocked?: boolean;
  onSubmitPartyTurn: (action: PartyActionSpec) => void | Promise<void>;
  onOverrideCharacterLocation: (
    characterId: string,
    locationId: string
  ) => void | Promise<void>;
  onCreateNpcParty: (payload: CreateNpcPartyPayload) => void | Promise<void>;
  onDisbandNpcParty: (partyId: string) => void | Promise<void>;
  onOpenMechanicsHelp?: (topicId: MechanicsTopicId) => void;
}

export const PartyManagementModal: React.FC<PartyManagementModalProps> = ({
  isOpen,
  onClose,
  parties,
  activeLocationId,
  locations,
  presentCharacterIds,
  characterRecords,
  characterStates,
  personaName,
  isMutatingLocked = false,
  onSubmitPartyTurn,
  onOverrideCharacterLocation,
  onCreateNpcParty,
  onDisbandNpcParty,
  onOpenMechanicsHelp,
}) => {
  const [actionMessage, setActionMessage] = useState("");
  const [selectedInviteIds, setSelectedInviteIds] = useState<string[]>([]);
  const [confirmDisbandId, setConfirmDisbandId] = useState<string | null>(null);
  const [moveTargets, setMoveTargets] = useState<Record<string, string>>({});
  const [busyAction, setBusyAction] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // NPC party builder state
  const [showCreateNpcForm, setShowCreateNpcForm] = useState(false);
  const [npcBuilderLocId, setNpcBuilderLocId] = useState("");
  const [npcBuilderMembers, setNpcBuilderMembers] = useState<string[]>([]);
  const [npcBuilderName, setNpcBuilderName] = useState("");
  const [npcBuilderGoal, setNpcBuilderGoal] = useState("");
  const [showSoloSection, setShowSoloSection] = useState(false);

  const playerLabel = (personaName || "").trim() || "You";
  const playerParty = useMemo(() => getPlayerParty(parties), [parties]);
  const npcParties = useMemo(() => getNpcOnlyParties(parties), [parties]);

  const locNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const loc of locations) {
      map[loc.id] = loc.name;
    }
    return map;
  }, [locations]);

  const presentSet = useMemo(
    () => new Set(presentCharacterIds),
    [presentCharacterIds]
  );

  const playerPartyNpcIds = useMemo(
    () =>
      playerParty
        ? playerParty.member_ids.filter((id) => id !== USER_PARTY_MEMBER_ID)
        : [],
    [playerParty]
  );

  const invitableCoLocatedNpcs = useMemo(() => {
    const memberSet = new Set(playerPartyNpcIds);
    return Object.values(characterRecords).filter(
      (c) => presentSet.has(c.id) && !memberSet.has(c.id)
    );
  }, [characterRecords, presentSet, playerPartyNpcIds]);

  const freeNpcsByLocation = useMemo(() => {
    const grouped: Record<string, CharacterRecord[]> = {};
    for (const ch of Object.values(characterRecords)) {
      if (getCharacterParty(parties, ch.id)) continue;
      const locId =
        characterStates[ch.id]?.current_location_id || activeLocationId;
      if (!grouped[locId]) grouped[locId] = [];
      grouped[locId].push(ch);
    }
    return grouped;
  }, [characterRecords, characterStates, parties, activeLocationId]);

  const eligibleNpcLocations = useMemo(
    () =>
      Object.entries(freeNpcsByLocation).filter(([, chars]) => chars.length >= 2),
    [freeNpcsByLocation]
  );

  const soloCharacters = useMemo(
    () =>
      Object.values(characterRecords).filter(
        (ch) => !getCharacterParty(parties, ch.id)
      ),
    [characterRecords, parties]
  );

  useEffect(() => {
    if (!isOpen) return;
    setConfirmDisbandId(null);
    setLocalError(null);
    setSelectedInviteIds([]);
    if (eligibleNpcLocations.length > 0) {
      const currentValid = eligibleNpcLocations.some(
        ([lid]) => lid === npcBuilderLocId
      );
      if (!currentValid) {
        setNpcBuilderLocId(eligibleNpcLocations[0][0]);
        setNpcBuilderMembers([]);
      }
    } else {
      setNpcBuilderLocId("");
      setNpcBuilderMembers([]);
    }
  }, [isOpen, eligibleNpcLocations, npcBuilderLocId]);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  useModalDialog({
    isOpen,
    onClose,
    disableEscape: busyAction,
    dialogRef,
  });

  if (!isOpen) return null;

  const isLocked = isMutatingLocked || busyAction;

  const getCharName = (id: string) =>
    id === USER_PARTY_MEMBER_ID
      ? playerLabel
      : characterRecords[id]?.name || id;

  const getCharCurrentLoc = (id: string) =>
    characterStates[id]?.current_location_id || activeLocationId;

  const getMoveTarget = (id: string) =>
    moveTargets[id] || getCharCurrentLoc(id);

  const handleRelocateChar = async (charId: string) => {
    const targetLocId = getMoveTarget(charId);
    if (!targetLocId || targetLocId === getCharCurrentLoc(charId)) return;
    setBusyAction(true);
    setLocalError(null);
    try {
      await onOverrideCharacterLocation(charId, targetLocId);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(false);
    }
  };

  const submitInCharacterAction = (action: PartyActionSpec) => {
    onClose();
    void onSubmitPartyTurn(action);
  };

  const handleDisbandNpcGroup = async (partyId: string) => {
    setBusyAction(true);
    setLocalError(null);
    try {
      await onDisbandNpcParty(partyId);
      setConfirmDisbandId(null);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(false);
    }
  };

  const handleCreateNpcGroupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (npcBuilderMembers.length < 2) {
      setLocalError("Select at least 2 co-located characters.");
      return;
    }
    setBusyAction(true);
    setLocalError(null);
    try {
      await onCreateNpcParty({
        member_ids: npcBuilderMembers,
        name: npcBuilderName.trim() || null,
        shared_goal: npcBuilderGoal.trim() || null,
      });
      setNpcBuilderName("");
      setNpcBuilderGoal("");
      setNpcBuilderMembers([]);
      setShowCreateNpcForm(false);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(false);
    }
  };

  const builderCandidates = npcBuilderLocId
    ? freeNpcsByLocation[npcBuilderLocId] ?? []
    : [];

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Party Management"
        tabIndex={-1}
        className="modal-panel party-modal-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Users size={18} color="var(--accent-cyan)" />
            <h2 style={{ margin: 0, fontSize: "1.05rem" }}>Party Management</h2>
            <MechanicsHelpButton
              topicId="spatial-parties"
              label="Parties & Strict Co-Location"
              onOpenHelp={onOpenMechanicsHelp}
            />
          </div>
          <button
            type="button"
            className="btn"
            style={{ padding: "4px 6px" }}
            onClick={onClose}
            aria-label="Close Party Management"
          >
            <X size={16} />
          </button>
        </div>

        <div className="modal-body" style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>

        {localError && (
          <div className="party-modal-error" role="alert">
            {localError}
          </div>
        )}

        {/* Section 1: Player's Party (Focused by Default) */}
        <section className="party-modal-section" aria-label="Your Party">
          <div className="party-modal-section-header">
            <h3 style={{ margin: 0, fontSize: "0.92rem" }}>Your Party</h3>
            {playerParty && (
              <span className="party-pill party-pill--player">
                {playerParty.member_ids.length} members ·{" "}
                {locNameById[playerParty.location_id] || playerParty.location_id}
              </span>
            )}
          </div>

          <div style={{ marginBottom: 10 }}>
            <input
              type="text"
              className="field-input"
              value={actionMessage}
              onChange={(e) => setActionMessage(e.target.value)}
              disabled={isLocked}
              placeholder="Optional in-character note (pitch, farewell, dismissal reason)..."
              style={{ fontSize: "0.8rem", padding: "7px 10px" }}
            />
          </div>

          {playerParty ? (
            <div className="party-card">
              <div className="party-card-top">
                <div style={{ fontWeight: 600, fontSize: "0.88rem" }}>
                  {playerParty.name || "Your Party"}
                </div>
                <span className="party-pill">
                  <Crown size={11} />
                  <span>Leader: {playerLabel}</span>
                </span>
              </div>

              <div className="party-member-list">
                <div className="party-member-row">
                  <span className="party-member-name">
                    {playerLabel} <span style={{ color: "var(--text-muted)" }}>(You)</span>
                  </span>
                  <span className="party-pill party-pill--subtle">
                    <MapPin size={11} />
                    {locNameById[activeLocationId] || activeLocationId}
                  </span>
                </div>

                {playerPartyNpcIds.map((mid) => {
                  const curLoc = getCharCurrentLoc(mid);
                  const targetLoc = getMoveTarget(mid);
                  return (
                    <div key={mid} className="party-member-row">
                      <span className="party-member-name">{getCharName(mid)}</span>
                      <div className="party-member-actions">
                        <select
                          aria-label={`Relocate ${getCharName(mid)}`}
                          className="field-select party-relocate-select"
                          value={targetLoc}
                          disabled={isLocked}
                          onChange={(e) =>
                            setMoveTargets((prev) => ({
                              ...prev,
                              [mid]: e.target.value,
                            }))
                          }
                        >
                          {locations.map((loc) => (
                            <option key={loc.id} value={loc.id}>
                              {loc.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={isLocked || targetLoc === curLoc}
                          onClick={() => void handleRelocateChar(mid)}
                          style={{ fontSize: "0.72rem", padding: "3px 8px" }}
                          title="Override this character's location immediately (leaves party if moved away)"
                        >
                          Move
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={isLocked}
                          onClick={() =>
                            submitInCharacterAction({
                              kind: "kick",
                              target_character_ids: [mid],
                              message: actionMessage.trim() || null,
                              source: "party_modal",
                            })
                          }
                          style={{ fontSize: "0.72rem", padding: "3px 8px" }}
                          title={`Kick ${getCharName(mid)} from party (triggers in-character turn)`}
                        >
                          <UserMinus size={12} />
                          <span>Kick</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {invitableCoLocatedNpcs.length > 0 && (
                <div className="party-inline-invite">
                  <div
                    style={{
                      fontSize: "0.76rem",
                      color: "var(--text-secondary)",
                      marginBottom: 6,
                    }}
                  >
                    Invite co-located characters in {locNameById[activeLocationId] || "this room"}:
                  </div>
                  <div className="party-checkbox-row">
                    {invitableCoLocatedNpcs.map((ch) => {
                      const checked = selectedInviteIds.includes(ch.id);
                      return (
                        <label key={ch.id} className="party-checkbox-chip">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={isLocked}
                            onChange={() =>
                              setSelectedInviteIds((prev) =>
                                prev.includes(ch.id)
                                  ? prev.filter((id) => id !== ch.id)
                                  : [...prev, ch.id]
                              )
                            }
                          />
                          <span>{ch.name}</span>
                        </label>
                      );
                    })}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={isLocked || selectedInviteIds.length === 0}
                      onClick={() =>
                        submitInCharacterAction({
                          kind: "invite",
                          target_character_ids: selectedInviteIds,
                          message: actionMessage.trim() || null,
                          source: "party_modal",
                        })
                      }
                      style={{ fontSize: "0.75rem" }}
                    >
                      <UserPlus size={13} />
                      <span>Invite Selected ({selectedInviteIds.length})</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={isLocked}
                      onClick={() =>
                        submitInCharacterAction({
                          kind: "invite",
                          target_character_ids: invitableCoLocatedNpcs.map((c) => c.id),
                          message: actionMessage.trim() || null,
                          source: "party_modal",
                        })
                      }
                      style={{ fontSize: "0.75rem" }}
                    >
                      <UserPlus size={13} />
                      <span>Invite All Here</span>
                    </button>
                  </div>
                </div>
              )}

              <div className="party-card-footer">
                <div>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={isLocked}
                    onClick={() =>
                      submitInCharacterAction({
                        kind: "leave",
                        target_character_ids: [],
                        message: actionMessage.trim() || null,
                        source: "party_modal",
                      })
                    }
                    style={{ fontSize: "0.76rem" }}
                  >
                    <LogOut size={13} />
                    <span>Leave Party</span>
                  </button>
                  {playerPartyNpcIds.length >= 2 && (
                    <span
                      style={{
                        display: "block",
                        fontSize: "0.7rem",
                        color: "var(--text-muted)",
                        marginTop: 4,
                      }}
                    >
                      Remaining {playerPartyNpcIds.length} companions will stay together as an NPC party.
                    </span>
                  )}
                </div>

                {confirmDisbandId === playerParty.id ? (
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <button
                      type="button"
                      className="btn party-btn-danger"
                      disabled={isLocked}
                      onClick={() =>
                        submitInCharacterAction({
                          kind: "disband",
                          target_character_ids: [],
                          message: actionMessage.trim() || null,
                          source: "party_modal",
                        })
                      }
                      style={{ fontSize: "0.76rem" }}
                    >
                      Confirm Disband
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={isLocked}
                      onClick={() => setConfirmDisbandId(null)}
                      style={{ fontSize: "0.76rem" }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn party-btn-danger-outline"
                    disabled={isLocked}
                    onClick={() => setConfirmDisbandId(playerParty.id)}
                    style={{ fontSize: "0.76rem" }}
                  >
                    <Trash2 size={13} />
                    <span>Disband Party</span>
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="party-card">
              <div
                style={{
                  fontSize: "0.82rem",
                  color: "var(--text-secondary)",
                  marginBottom: invitableCoLocatedNpcs.length > 0 ? 8 : 0,
                }}
              >
                {invitableCoLocatedNpcs.length > 0
                  ? `You are traveling alone in ${locNameById[activeLocationId] || "this room"}. Invite co-located characters below (triggers an in-character turn):`
                  : `You are not currently in a party, and nobody else is in ${locNameById[activeLocationId] || "this room"} to invite right now.`}
              </div>
              {invitableCoLocatedNpcs.length > 0 && (
                <>
                  <div className="party-checkbox-row">
                    {invitableCoLocatedNpcs.map((ch) => {
                      const checked = selectedInviteIds.includes(ch.id);
                      return (
                        <label key={ch.id} className="party-checkbox-chip">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={isLocked}
                            onChange={() =>
                              setSelectedInviteIds((prev) =>
                                prev.includes(ch.id)
                                  ? prev.filter((id) => id !== ch.id)
                                  : [...prev, ch.id]
                              )
                            }
                          />
                          <span>{ch.name}</span>
                        </label>
                      );
                    })}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={isLocked || selectedInviteIds.length === 0}
                      onClick={() =>
                        submitInCharacterAction({
                          kind: "invite",
                          target_character_ids: selectedInviteIds,
                          message: actionMessage.trim() || null,
                          source: "party_modal",
                        })
                      }
                      style={{ fontSize: "0.76rem" }}
                    >
                      <UserPlus size={13} />
                      <span>Invite Selected ({selectedInviteIds.length})</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={isLocked}
                      onClick={() =>
                        submitInCharacterAction({
                          kind: "invite",
                          target_character_ids: invitableCoLocatedNpcs.map((c) => c.id),
                          message: actionMessage.trim() || null,
                          source: "party_modal",
                        })
                      }
                      style={{ fontSize: "0.76rem" }}
                    >
                      <UserPlus size={13} />
                      <span>Invite All Here</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </section>

        {/* Section 2: NPC-Only Parties */}
        <section className="party-modal-section" aria-label="NPC Parties">
          <div className="party-modal-section-header">
            <h3 style={{ margin: 0, fontSize: "0.92rem" }}>
              NPC Parties ({npcParties.length})
            </h3>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={isLocked}
              onClick={() => setShowCreateNpcForm((prev) => !prev)}
              style={{ fontSize: "0.74rem", padding: "4px 9px" }}
            >
              <Plus size={12} />
              <span>{showCreateNpcForm ? "Close Builder" : "Create NPC Party"}</span>
            </button>
          </div>

          {showCreateNpcForm && (
            <form className="party-card" onSubmit={handleCreateNpcGroupSubmit}>
              {eligibleNpcLocations.length === 0 ? (
                <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                  At least 2 co-located non-party characters are needed to form an NPC party. Use Solo Characters below or Character Details to move characters together first.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <label
                      htmlFor="npc-party-loc-select"
                      style={{
                        fontSize: "0.76rem",
                        color: "var(--text-secondary)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Room:
                    </label>
                    <select
                      id="npc-party-loc-select"
                      className="field-select"
                      value={npcBuilderLocId}
                      disabled={isLocked}
                      onChange={(e) => {
                        setNpcBuilderLocId(e.target.value);
                        setNpcBuilderMembers([]);
                      }}
                      style={{ width: "auto", flex: 1, fontSize: "0.78rem", padding: "5px 8px" }}
                    >
                      {eligibleNpcLocations.map(([lid, chars]) => (
                        <option key={lid} value={lid}>
                          {locNameById[lid] || lid} ({chars.length} free)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="party-checkbox-row">
                    {builderCandidates.map((ch) => {
                      const checked = npcBuilderMembers.includes(ch.id);
                      return (
                        <label key={ch.id} className="party-checkbox-chip">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={isLocked}
                            onChange={() =>
                              setNpcBuilderMembers((prev) =>
                                prev.includes(ch.id)
                                  ? prev.filter((id) => id !== ch.id)
                                  : [...prev, ch.id]
                              )
                            }
                          />
                          <span>{ch.name}</span>
                        </label>
                      );
                    })}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <input
                      type="text"
                      className="field-input"
                      placeholder="Optional party name..."
                      value={npcBuilderName}
                      disabled={isLocked}
                      onChange={(e) => setNpcBuilderName(e.target.value)}
                      style={{ fontSize: "0.76rem", padding: "6px 9px" }}
                    />
                    <input
                      type="text"
                      className="field-input"
                      placeholder="Optional shared goal..."
                      value={npcBuilderGoal}
                      disabled={isLocked}
                      onChange={(e) => setNpcBuilderGoal(e.target.value)}
                      style={{ fontSize: "0.76rem", padding: "6px 9px" }}
                    />
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button
                      type="submit"
                      className="btn btn-primary"
                      disabled={isLocked || npcBuilderMembers.length < 2}
                      style={{ fontSize: "0.76rem" }}
                    >
                      Create NPC Party (Random Leader)
                    </button>
                  </div>
                </div>
              )}
            </form>
          )}

          {npcParties.length === 0 && !showCreateNpcForm ? (
            <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
              No active NPC-only parties.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {npcParties.map((party) => (
                <div key={party.id} className="party-card">
                  <div className="party-card-top">
                    <div>
                      <div style={{ fontWeight: 600, fontSize: "0.86rem" }}>
                        {party.name || "NPC Party"}
                      </div>
                      {party.shared_goal && (
                        <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)" }}>
                          Goal: {party.shared_goal}
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                      <span className="party-pill party-pill--subtle">
                        <MapPin size={11} />
                        {locNameById[party.location_id] || party.location_id}
                      </span>
                      <span className="party-pill party-pill--npc">
                        <Crown size={11} />
                        Leader: {getCharName(party.leader_id)}
                      </span>
                    </div>
                  </div>

                  <div className="party-member-list">
                    {party.member_ids.map((mid) => {
                      const curLoc = getCharCurrentLoc(mid);
                      const targetLoc = getMoveTarget(mid);
                      return (
                        <div key={mid} className="party-member-row">
                          <span className="party-member-name">
                            {getCharName(mid)}
                            {mid === party.leader_id && (
                              <span
                                style={{
                                  fontSize: "0.68rem",
                                  color: "var(--accent-amber)",
                                  marginLeft: 6,
                                }}
                              >
                                Leader
                              </span>
                            )}
                          </span>
                          <div className="party-member-actions">
                            <select
                              aria-label={`Relocate ${getCharName(mid)}`}
                              className="field-select party-relocate-select"
                              value={targetLoc}
                              disabled={isLocked}
                              onChange={(e) =>
                                setMoveTargets((prev) => ({
                                  ...prev,
                                  [mid]: e.target.value,
                                }))
                              }
                            >
                              {locations.map((loc) => (
                                <option key={loc.id} value={loc.id}>
                                  {loc.name}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              disabled={isLocked || targetLoc === curLoc}
                              onClick={() => void handleRelocateChar(mid)}
                              style={{ fontSize: "0.72rem", padding: "3px 8px" }}
                            >
                              Move
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="party-card-footer">
                    <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                      NPC-only groups disband immediately out-of-character.
                    </span>
                    {confirmDisbandId === party.id ? (
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          type="button"
                          className="btn party-btn-danger"
                          disabled={isLocked}
                          onClick={() => void handleDisbandNpcGroup(party.id)}
                          style={{ fontSize: "0.74rem" }}
                        >
                          Confirm Disband
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={isLocked}
                          onClick={() => setConfirmDisbandId(null)}
                          style={{ fontSize: "0.74rem" }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="btn party-btn-danger-outline"
                        disabled={isLocked}
                        onClick={() => setConfirmDisbandId(party.id)}
                        style={{ fontSize: "0.74rem" }}
                      >
                        <Trash2 size={12} />
                        <span>Disband</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Section 3: Collapsible Solo Character Quick Relocate */}
        {soloCharacters.length > 0 && (
          <section className="party-modal-section" aria-label="Solo Characters">
            <button
              type="button"
              className="btn btn-secondary"
              style={{
                width: "100%",
                justifyContent: "space-between",
                fontSize: "0.8rem",
              }}
              onClick={() => setShowSoloSection((prev) => !prev)}
            >
              <span>Solo Characters ({soloCharacters.length})</span>
              {showSoloSection ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            {showSoloSection && (
              <div className="party-card" style={{ marginTop: 8 }}>
                <div className="party-member-list">
                  {soloCharacters.map((ch) => {
                    const curLoc = getCharCurrentLoc(ch.id);
                    const targetLoc = getMoveTarget(ch.id);
                    return (
                      <div key={ch.id} className="party-member-row">
                        <span className="party-member-name">
                          {ch.name}{" "}
                          <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                            ({locNameById[curLoc] || curLoc})
                          </span>
                        </span>
                        <div className="party-member-actions">
                          <select
                            aria-label={`Relocate ${ch.name}`}
                            className="field-select party-relocate-select"
                            value={targetLoc}
                            disabled={isLocked}
                            onChange={(e) =>
                              setMoveTargets((prev) => ({
                                ...prev,
                                [ch.id]: e.target.value,
                              }))
                            }
                          >
                            {locations.map((loc) => (
                              <option key={loc.id} value={loc.id}>
                                {loc.name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            disabled={isLocked || targetLoc === curLoc}
                            onClick={() => void handleRelocateChar(ch.id)}
                            style={{ fontSize: "0.72rem", padding: "3px 8px" }}
                          >
                            Move
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        )}
        </div>
      </div>
    </div>
  );
};
