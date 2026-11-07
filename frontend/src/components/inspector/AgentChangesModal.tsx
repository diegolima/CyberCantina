import React from "react";
import {
  ArrowRight,
  Award,
  Bot,
  Brain,
  Clock,
  Compass,
  Flag,
  Globe,
  Heart,
  MapPin,
  Package,
  RefreshCw,
  Sparkles,
  User,
  X,
  Zap,
} from "lucide-react";
import {
  CampaignStateBundle,
  CharacterAgentDelta,
  ExtractedCharacterMemory,
  ImprovisedLocationSpec,
  Phase4TurnProgress,
} from "../../types";

export interface ActiveAgentModalTarget {
  turnId: string;
  agentKey: string; // "clerk" | character_id
}

export interface AgentChangesModalProps {
  target: ActiveAgentModalTarget;
  bundle: CampaignStateBundle;
  turnProgress?: Phase4TurnProgress | null;
  onClose: () => void;
}

export const AgentChangesModal: React.FC<AgentChangesModalProps> = ({
  target,
  bundle,
  turnProgress,
  onClose,
}) => {
  const isClerk = target.agentKey === "clerk";
  const turn =
    bundle.all_turn_nodes.find((t) => t.id === target.turnId) ||
    bundle.active_branch_turns.find((t) => t.id === target.turnId);

  const parentTurn = turn?.parent_turn_id
    ? bundle.all_turn_nodes.find((t) => t.id === turn.parent_turn_id)
    : null;

  const isReconciled = Boolean(turn?.post_turn) || turnProgress?.isComplete === true;
  const progressAgent = turnProgress?.agents?.[target.agentKey];

  // ==========================================
  // Global World Clerk View
  // ==========================================
  if (isClerk) {
    const postTurn = turn?.post_turn;
    const provisional = progressAgent?.provisionalWorldDelta;

    const elapsedMinutes =
      postTurn?.elapsed_minutes ?? provisional?.elapsed_minutes ?? 0;
    const resolvedTimestamp =
      postTurn?.new_world_timestamp ||
      turn?.world_snapshot.world_timestamp ||
      provisional?.new_world_timestamp ||
      "Not set";
    const previousTimestamp = parentTurn?.world_snapshot.world_timestamp;

    const transitionType =
      postTurn?.transition_type ?? provisional?.transition_type ?? "stay";
    const targetLocId =
      postTurn?.target_location_id ?? provisional?.target_location_id;
    const improvised: ImprovisedLocationSpec | null =
      postTurn?.improvised_location ?? provisional?.improvised_location ?? null;

    const fromLocation =
      parentTurn?.world_snapshot.active_location_id
        ? bundle.visible_locations.find(
            (l) => l.id === parentTurn.world_snapshot.active_location_id
          )
        : null;
    const fromLocationName = fromLocation?.name;

    const toLocation = targetLocId
      ? bundle.visible_locations.find((l) => l.id === targetLocId)
      : improvised
      ? { name: improvised.name }
      : bundle.active_location;

    const flagsAdded =
      postTurn?.scene_flags_updated ?? provisional?.scene_flags_updated ?? [];
    const flagsRemoved =
      postTurn?.scene_flags_removed ?? provisional?.scene_flags_removed ?? [];
    const notableSummary =
      postTurn?.notable_event_summary ?? provisional?.notable_event_summary;

    const arbitrationRulings = postTurn?.arbitration_rulings ?? [];
    const arbitrationNotes = postTurn?.arbitration_notes ?? [];

    const hasAnyChanges =
      elapsedMinutes > 0 ||
      transitionType !== "stay" ||
      flagsAdded.length > 0 ||
      flagsRemoved.length > 0 ||
      Boolean(notableSummary) ||
      arbitrationRulings.length > 0;

    return (
      <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 85 }}>
        <div
          className="modal-panel"
          style={{ width: "min(720px, 94vw)", maxHeight: "90vh" }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="modal-header">
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  background: "rgba(245, 158, 11, 0.15)",
                  border: "1px solid rgba(245, 158, 11, 0.4)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--accent-amber)",
                }}
              >
                <Globe size={13} />
              </div>
              <span style={{ fontWeight: 700, fontSize: "1rem" }}>
                Global World Clerk
              </span>
              <span className="badge-clerk-pill">clerk</span>
              <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>
                · Turn #{turn?.depth_index ?? 0}
              </span>
            </span>
            <button
              type="button"
              className="btn"
              onClick={onClose}
              aria-label="Close dialog"
            >
              <X size={15} />
            </button>
          </div>

          {/* Body */}
          <div
            className="modal-body"
            style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}
          >
            {/* Status Banner */}
            {!isReconciled && (
              <div
                style={{
                  background: "rgba(6, 182, 212, 0.1)",
                  border: "1px solid rgba(6, 182, 212, 0.35)",
                  borderRadius: 8,
                  padding: "8px 12px",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: "0.78rem",
                  color: "var(--accent-cyan)",
                }}
              >
                <RefreshCw size={13} className="spin-slow" />
                <span>
                  Provisional Clerk Output — Awaiting final multi-agent reconciliation...
                </span>
              </div>
            )}

            {/* Time / Clock Advancement */}
            <div className="agent-modal-card">
              <div className="agent-modal-card-header">
                <Clock size={13} color="var(--accent-amber)" />
                <span>World Clock & Time Elapsed</span>
              </div>
              <div className="agent-modal-card-body">
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ fontSize: "0.85rem" }}>
                    <span style={{ color: "var(--text-muted)" }}>Elapsed: </span>
                    <strong style={{ color: "var(--text-primary)" }}>
                      +{elapsedMinutes} min
                    </strong>
                  </div>
                  {previousTimestamp && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.82rem" }}>
                      <span style={{ color: "var(--text-muted)" }}>{previousTimestamp}</span>
                      <ArrowRight size={12} color="var(--text-muted)" />
                      <span style={{ color: "var(--accent-amber)", fontWeight: 600 }}>
                        {resolvedTimestamp}
                      </span>
                    </div>
                  )}
                  {!previousTimestamp && (
                    <span style={{ color: "var(--accent-amber)", fontSize: "0.82rem", fontWeight: 600 }}>
                      {resolvedTimestamp}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Spatial Graph / Location Transition */}
            <div className="agent-modal-card">
              <div className="agent-modal-card-header">
                <Compass size={13} color="var(--accent-cyan)" />
                <span>Spatial Location & Navigation</span>
              </div>
              <div className="agent-modal-card-body">
                {transitionType === "stay" ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.82rem" }}>
                    <MapPin size={13} color="var(--text-muted)" />
                    <span>
                      Remained in current location:{" "}
                      <strong style={{ color: "var(--text-primary)" }}>
                        {toLocation?.name || "Current Scene"}
                      </strong>
                    </span>
                  </div>
                ) : transitionType === "move_existing" ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.82rem" }}>
                    <MapPin size={13} color="var(--accent-cyan)" />
                    <span>
                      Departed {fromLocationName ? `from ${fromLocationName} ` : ""}to connected exit:{" "}
                      <strong style={{ color: "var(--accent-cyan)" }}>
                        {toLocation?.name || targetLocId}
                      </strong>
                    </span>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "0.82rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Sparkles size={13} color="var(--accent-amber)" />
                      <span>
                        Improvised new adjacent room:{" "}
                        <strong style={{ color: "var(--accent-amber)" }}>
                          {improvised?.name || "New Chamber"}
                        </strong>
                      </span>
                    </div>
                    {improvised?.description && (
                      <div
                        style={{
                          fontSize: "0.78rem",
                          color: "var(--text-secondary)",
                          fontStyle: "italic",
                          background: "var(--bg-card)",
                          padding: "6px 10px",
                          borderRadius: 6,
                          border: "1px solid var(--border-subtle)",
                        }}
                      >
                        "{improvised.description}"
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Notable World Event */}
            {notableSummary && (
              <div className="agent-modal-card">
                <div className="agent-modal-card-header">
                  <Sparkles size={13} color="var(--accent-amber)" />
                  <span>Macro Plot / World Event</span>
                </div>
                <div
                  className="agent-modal-card-body"
                  style={{ color: "var(--accent-amber)", fontSize: "0.84rem", fontWeight: 500 }}
                >
                  ★ {notableSummary}
                </div>
              </div>
            )}

            {/* Scene Flags Added / Removed */}
            <div className="agent-modal-card">
              <div className="agent-modal-card-header">
                <Flag size={13} color="#a78bfa" />
                <span>Scene & Environmental Flags</span>
              </div>
              <div className="agent-modal-card-body">
                {flagsAdded.length === 0 && flagsRemoved.length === 0 ? (
                  <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>
                    No scene flag mutations this turn.
                  </span>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {flagsAdded.length > 0 && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ fontSize: "0.74rem", color: "#6ee7b7", fontWeight: 600 }}>
                          ADDED:
                        </span>
                        {flagsAdded.map((flag, idx) => (
                          <span
                            key={idx}
                            className="badge"
                            style={{
                              fontSize: "0.72rem",
                              padding: "2px 7px",
                              borderColor: "rgba(16, 185, 129, 0.4)",
                              color: "#6ee7b7",
                            }}
                          >
                            + {flag}
                          </span>
                        ))}
                      </div>
                    )}
                    {flagsRemoved.length > 0 && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ fontSize: "0.74rem", color: "#f87171", fontWeight: 600 }}>
                          REMOVED:
                        </span>
                        {flagsRemoved.map((flag, idx) => (
                          <span
                            key={idx}
                            className="badge"
                            style={{
                              fontSize: "0.72rem",
                              padding: "2px 7px",
                              borderColor: "rgba(239, 68, 68, 0.4)",
                              color: "#f87171",
                            }}
                          >
                            - {flag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Clerk Arbitration Decisions */}
            {(arbitrationRulings.length > 0 || arbitrationNotes.length > 0) && (
              <div className="agent-modal-card">
                <div className="agent-modal-card-header">
                  <Award size={13} color="var(--accent-amber)" />
                  <span>Item Contention Arbitration Rulings</span>
                </div>
                <div className="agent-modal-card-body">
                  {arbitrationRulings.length > 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {arbitrationRulings.map((ruling, idx) => (
                        <div
                          key={idx}
                          style={{
                            padding: "8px 10px",
                            borderRadius: 6,
                            background: "var(--bg-card)",
                            border: "1px solid rgba(245, 158, 11, 0.3)",
                            fontSize: "0.8rem",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                            <strong style={{ color: "var(--accent-amber)" }}>
                              {ruling.item_name}
                            </strong>
                            <span style={{ color: "#6ee7b7", fontWeight: 600 }}>
                              Awarded to: {ruling.winner_label}
                            </span>
                          </div>
                          <div style={{ color: "var(--text-secondary)", fontSize: "0.76rem" }}>
                            {ruling.rationale || "Resolved by Clerk Arbiter referee."}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {arbitrationNotes.map((note, idx) => (
                        <div
                          key={idx}
                          style={{
                            fontSize: "0.8rem",
                            color: "var(--text-secondary)",
                          }}
                        >
                          • {note}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {!hasAnyChanges && (
              <div
                style={{
                  textAlign: "center",
                  padding: "16px 12px",
                  color: "var(--text-muted)",
                  fontSize: "0.82rem",
                }}
              >
                World Clerk executed: environment composition and world clock maintained steady state.
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // Character State Agent View
  // ==========================================
  const charId = target.agentKey;
  const charRecord = bundle.character_records?.[charId];
  const delta: CharacterAgentDelta | null =
    turn?.post_turn?.character_deltas?.[charId] ??
    progressAgent?.provisionalCharacterDelta ??
    null;

  const charName =
    turn?.post_turn?.character_names?.[charId] ||
    charRecord?.name ||
    progressAgent?.label ||
    "Agent";

  const prevCharState = parentTurn?.character_states?.[charId];

  // Affective calculations
  const moodLabel = delta?.mood_label || charRecord?.tagline || "Observant and composed";
  const prevMoodLabel = prevCharState?.mood_label;
  const valDelta = delta?.valence_delta ?? 0;
  const arDelta = delta?.arousal_delta ?? 0;

  const resolvedVal =
    turn?.character_states?.[charId]?.valence ??
    (prevCharState ? Number((prevCharState.valence + valDelta).toFixed(2)) : null);
  const resolvedAr =
    turn?.character_states?.[charId]?.arousal ??
    (prevCharState ? Number((prevCharState.arousal + arDelta).toFixed(2)) : null);

  // Stances resolved
  const stanceEntries = Object.entries(delta?.stance_updates || {}).map(([rawTarget, note]) => {
    let targetLabel = rawTarget;
    if (rawTarget.toLowerCase() === "user" || rawTarget.toLowerCase() === "player") {
      targetLabel = "Player (You)";
    } else {
      const match = bundle.character_records?.[rawTarget];
      if (match) targetLabel = match.name;
    }
    return { targetKey: rawTarget, targetLabel, note };
  });

  // Inventory 4 buckets
  const eqItems = delta?.items_equipped || [];
  const unequippedItems = delta?.items_unequipped || [];
  const obtainedItems = delta?.items_obtained || [];
  const removedItems = delta?.items_removed || [];
  const hasInventoryChanges =
    eqItems.length > 0 ||
    unequippedItems.length > 0 ||
    obtainedItems.length > 0 ||
    removedItems.length > 0;

  // Spatial transition
  const locTransition = delta?.location_transition || "stay_here";
  const targetLocId = delta?.target_location_id;
  const targetLoc = targetLocId
    ? bundle.visible_locations.find((l) => l.id === targetLocId)
    : null;

  // Memories
  const newMemories: ExtractedCharacterMemory[] = delta?.new_memories || [];
  const isCompacted = Boolean(
    turn?.post_turn?.compacted_character_ids?.includes(charId)
  );

  // Arbitration involving this character
  const characterArbitrations = (turn?.post_turn?.arbitration_rulings || []).filter(
    (r) =>
      r.winner_id === charId ||
      r.claimant_ids.includes(charId) ||
      r.prior_holder_id === charId
  );

  const relationalEvents = delta?.relational_events || [];

  const hasAnyMutations =
    Boolean(delta?.updated_want) ||
    Boolean(delta?.affect_tone) ||
    valDelta !== 0 ||
    arDelta !== 0 ||
    relationalEvents.length > 0 ||
    stanceEntries.length > 0 ||
    hasInventoryChanges ||
    locTransition !== "stay_here" ||
    newMemories.length > 0 ||
    characterArbitrations.length > 0;

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 85 }}>
      <div
        className="modal-panel"
        style={{ width: "min(720px, 94vw)", maxHeight: "90vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: "50%",
                background: "rgba(6, 182, 212, 0.15)",
                border: "1px solid rgba(6, 182, 212, 0.4)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--accent-cyan)",
              }}
            >
              <Bot size={13} />
            </div>
            <span style={{ fontWeight: 700, fontSize: "1rem" }}>{charName}</span>
            <span
              className="badge"
              style={{
                fontSize: "0.7rem",
                padding: "2px 7px",
                borderColor: "rgba(6, 182, 212, 0.35)",
                color: "var(--accent-cyan)",
              }}
            >
              Phase 4 Agent
            </span>
            <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>
              · Turn #{turn?.depth_index ?? 0}
            </span>
          </span>
          <button
            type="button"
            className="btn"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div
          className="modal-body"
          style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}
        >
          {/* Status Banner */}
          {!isReconciled && (
            <div
              style={{
                background: "rgba(6, 182, 212, 0.1)",
                border: "1px solid rgba(6, 182, 212, 0.35)",
                borderRadius: 8,
                padding: "8px 12px",
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: "0.78rem",
                color: "var(--accent-cyan)",
              }}
            >
              <RefreshCw size={13} className="spin-slow" />
              <span>
                Provisional Agent Output — Awaiting scene arbitration and snapshot commit...
              </span>
            </div>
          )}

          {/* Affect & Emotion */}
          <div className="agent-modal-card">
            <div className="agent-modal-card-header">
              <Heart size={13} color="#f472b6" />
              <span>Affect, Mood & Emotional Shift</span>
            </div>
            <div className="agent-modal-card-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-primary)" }}>
                  {moodLabel}
                </span>
                {prevMoodLabel && prevMoodLabel !== moodLabel && (
                  <span style={{ fontSize: "0.76rem", color: "var(--text-muted)" }}>
                    (was: {prevMoodLabel})
                  </span>
                )}
              </div>
              {(delta?.affect_tone ||
                delta?.affect_intensity ||
                delta?.affect_agency ||
                (delta?.scene_threat && delta.scene_threat !== "none") ||
                delta?.scene_coping) && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {delta?.affect_tone && (
                    <span className="badge" style={{ fontSize: "0.71rem" }}>
                      Tone: {delta.affect_tone}
                    </span>
                  )}
                  {delta?.affect_intensity && (
                    <span className="badge" style={{ fontSize: "0.71rem" }}>
                      Intensity: {delta.affect_intensity}
                    </span>
                  )}
                  {delta?.affect_agency && (
                    <span className="badge" style={{ fontSize: "0.71rem" }}>
                      Agency: {delta.affect_agency}
                    </span>
                  )}
                  {delta?.scene_threat && delta.scene_threat !== "none" && (
                    <span
                      className="badge"
                      style={{
                        fontSize: "0.71rem",
                        borderColor: "rgba(244, 63, 94, 0.4)",
                        color: "#fda4af",
                      }}
                    >
                      Threat: {delta.scene_threat}
                    </span>
                  )}
                  {delta?.scene_coping && (
                    <span className="badge" style={{ fontSize: "0.71rem" }}>
                      Coping: {delta.scene_coping}
                    </span>
                  )}
                </div>
              )}
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.78rem" }}>
                  <span style={{ color: "var(--text-muted)" }}>Valence Delta:</span>
                  <span
                    className="badge"
                    style={{
                      fontSize: "0.74rem",
                      fontWeight: 600,
                      padding: "1px 6px",
                      borderColor:
                        valDelta > 0
                          ? "rgba(16, 185, 129, 0.4)"
                          : valDelta < 0
                          ? "rgba(239, 68, 68, 0.4)"
                          : "var(--border-subtle)",
                      color: valDelta > 0 ? "#6ee7b7" : valDelta < 0 ? "#f87171" : "var(--text-secondary)",
                    }}
                  >
                    {valDelta >= 0 ? `+${valDelta.toFixed(2)}` : valDelta.toFixed(2)}
                  </span>
                  {resolvedVal !== null && (
                    <span style={{ color: "var(--text-muted)", fontSize: "0.74rem" }}>
                      (current: {resolvedVal >= 0 ? `+${resolvedVal.toFixed(2)}` : resolvedVal.toFixed(2)})
                    </span>
                  )}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.78rem" }}>
                  <span style={{ color: "var(--text-muted)" }}>Arousal Delta:</span>
                  <span
                    className="badge"
                    style={{
                      fontSize: "0.74rem",
                      fontWeight: 600,
                      padding: "1px 6px",
                      borderColor:
                        arDelta > 0
                          ? "rgba(245, 158, 11, 0.4)"
                          : arDelta < 0
                          ? "rgba(59, 130, 246, 0.4)"
                          : "var(--border-subtle)",
                      color: arDelta > 0 ? "var(--accent-amber)" : arDelta < 0 ? "#60a5fa" : "var(--text-secondary)",
                    }}
                  >
                    {arDelta >= 0 ? `+${arDelta.toFixed(2)}` : arDelta.toFixed(2)}
                  </span>
                  {resolvedAr !== null && (
                    <span style={{ color: "var(--text-muted)", fontSize: "0.74rem" }}>
                      (current: {resolvedAr.toFixed(2)})
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Immediate Want / Goal */}
          {delta?.updated_want && (
            <div className="agent-modal-card">
              <div className="agent-modal-card-header">
                <Zap size={13} color="var(--accent-amber)" />
                <span>Immediate Want / Intention Shift</span>
              </div>
              <div
                className="agent-modal-card-body"
                style={{ fontSize: "0.82rem", color: "var(--accent-amber)", fontWeight: 500 }}
              >
                "{delta.updated_want}"
              </div>
            </div>
          )}

          {/* Relationship Stance & CARE Relational Events */}
          <div className="agent-modal-card">
            <div className="agent-modal-card-header">
              <User size={13} color="var(--accent-cyan)" />
              <span>Interpersonal Relational Events &amp; Stances</span>
            </div>
            <div className="agent-modal-card-body">
              {stanceEntries.length === 0 && relationalEvents.length === 0 ? (
                <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>
                  No interpersonal stances shifted this turn.
                </span>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {relationalEvents.map((ev, idx) => {
                    const tLow = (ev.target || "").toLowerCase();
                    const evLabel =
                      tLow === "user" || tLow === "player"
                        ? "Player (You)"
                        : bundle.character_records?.[ev.target]?.name || ev.target;
                    const shiftBadges: string[] = [];
                    if (ev.warmth_shift && ev.warmth_shift !== "none")
                      shiftBadges.push(`Warmth: ${ev.warmth_shift}`);
                    if (ev.trust_shift && ev.trust_shift !== "none")
                      shiftBadges.push(`Trust: ${ev.trust_shift}`);
                    if (ev.respect_shift && ev.respect_shift !== "none")
                      shiftBadges.push(`Respect: ${ev.respect_shift}`);
                    if (ev.power_shift && ev.power_shift !== "none")
                      shiftBadges.push(`Power: ${ev.power_shift}`);
                    if (ev.grievance_shift && ev.grievance_shift !== "none")
                      shiftBadges.push(`Grievance: ${ev.grievance_shift}`);
                    if (ev.obligation_shift && ev.obligation_shift !== "none")
                      shiftBadges.push(`Obligation: ${ev.obligation_shift}`);
                    return (
                      <div
                        key={`rel-ev-${idx}`}
                        style={{
                          padding: "7px 9px",
                          borderRadius: 6,
                          background: "var(--bg-card)",
                          border: "1px solid var(--border-subtle)",
                          fontSize: "0.79rem",
                          display: "flex",
                          flexDirection: "column",
                          gap: 4,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <strong style={{ color: "var(--accent-cyan)" }}>{evLabel}</strong>
                          {ev.visibility && ev.visibility !== "public_room" && (
                            <span
                              className="badge"
                              style={{ fontSize: "0.66rem", padding: "0px 5px" }}
                            >
                              {ev.visibility}
                            </span>
                          )}
                          {shiftBadges.map((b, bIdx) => (
                            <span
                              key={bIdx}
                              className="badge"
                              style={{ fontSize: "0.68rem", padding: "1px 6px" }}
                            >
                              {b}
                            </span>
                          ))}
                        </div>
                        {ev.note && (
                          <div style={{ color: "var(--text-secondary)" }}>{ev.note}</div>
                        )}
                      </div>
                    );
                  })}
                  {stanceEntries.map(({ targetKey, targetLabel, note }) => (
                    <div
                      key={targetKey}
                      style={{
                        padding: "6px 9px",
                        borderRadius: 6,
                        background: "var(--bg-card)",
                        border: "1px solid var(--border-subtle)",
                        fontSize: "0.8rem",
                      }}
                    >
                      <strong style={{ color: "var(--accent-cyan)" }}>{targetLabel}:</strong>{" "}
                      <span style={{ color: "var(--text-secondary)" }}>{note}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 4-Bucket Inventory Transitions */}
          <div className="agent-modal-card">
            <div className="agent-modal-card-header">
              <Package size={13} color="#fcd34d" />
              <span>Gear & Inventory Transitions</span>
            </div>
            <div className="agent-modal-card-body">
              {!hasInventoryChanges ? (
                <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>
                  No inventory or equipment changed this turn.
                </span>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {eqItems.length > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontSize: "0.74rem", color: "var(--accent-amber)", fontWeight: 600 }}>
                        EQUIPPED:
                      </span>
                      {eqItems.map((item, idx) => (
                        <span key={idx} className="item-badge item-badge-equipped">
                          {item}
                        </span>
                      ))}
                    </div>
                  )}
                  {unequippedItems.length > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontSize: "0.74rem", color: "var(--text-secondary)", fontWeight: 600 }}>
                        STOWED / UNEQUIPPED:
                      </span>
                      {unequippedItems.map((item, idx) => (
                        <span key={idx} className="item-badge item-badge-inventory">
                          {item}
                        </span>
                      ))}
                    </div>
                  )}
                  {obtainedItems.length > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontSize: "0.74rem", color: "#6ee7b7", fontWeight: 600 }}>
                        ACQUIRED:
                      </span>
                      {obtainedItems.map((item, idx) => (
                        <span
                          key={idx}
                          className="badge"
                          style={{
                            fontSize: "0.72rem",
                            padding: "2px 7px",
                            borderColor: "rgba(16, 185, 129, 0.4)",
                            color: "#6ee7b7",
                          }}
                        >
                          + {item}
                        </span>
                      ))}
                    </div>
                  )}
                  {removedItems.length > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontSize: "0.74rem", color: "#f87171", fontWeight: 600 }}>
                        DISCARDED / REMOVED:
                      </span>
                      {removedItems.map((item, idx) => (
                        <span
                          key={idx}
                          className="badge"
                          style={{
                            fontSize: "0.72rem",
                            padding: "2px 7px",
                            borderColor: "rgba(239, 68, 68, 0.4)",
                            color: "#f87171",
                          }}
                        >
                          - {item}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Spatial Movement */}
          <div className="agent-modal-card">
            <div className="agent-modal-card-header">
              <Compass size={13} color="var(--accent-cyan)" />
              <span>Spatial Movement</span>
            </div>
            <div className="agent-modal-card-body" style={{ fontSize: "0.82rem" }}>
              {locTransition === "stay_here" ? (
                <span style={{ color: "var(--text-secondary)" }}>
                  Remained in current scene with the player.
                </span>
              ) : locTransition === "follow_player" ? (
                <span style={{ color: "var(--accent-cyan)" }}>
                  Accompanied the player to the active room.
                </span>
              ) : (
                <span style={{ color: "var(--accent-amber)" }}>
                  Departed independently to adjacent exit:{" "}
                  <strong>{targetLoc?.name || targetLocId}</strong>
                </span>
              )}
            </div>
          </div>

          {/* Memories Extracted / Compacted */}
          {(newMemories.length > 0 || isCompacted) && (
            <div className="agent-modal-card">
              <div className="agent-modal-card-header">
                <Brain size={13} color="#a78bfa" />
                <span>Personal Memories Formed</span>
              </div>
              <div className="agent-modal-card-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {newMemories.map((mem, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 6,
                      background: "var(--bg-card)",
                      border: "1px solid rgba(167, 139, 250, 0.35)",
                      fontSize: "0.8rem",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                      <span
                        className="badge"
                        style={{
                          fontSize: "0.68rem",
                          padding: "1px 6px",
                          borderColor: "rgba(167, 139, 250, 0.4)",
                          color: "#c084fc",
                        }}
                      >
                        {mem.significance?.toUpperCase() || "SIGNIFICANT"}
                      </span>
                      <strong style={{ color: "var(--text-primary)" }}>{mem.title}</strong>
                    </div>
                    <div style={{ color: "var(--text-secondary)", fontSize: "0.78rem" }}>
                      {mem.content}
                    </div>
                  </div>
                ))}
                {isCompacted && (
                  <div
                    style={{
                      fontSize: "0.76rem",
                      color: "var(--accent-cyan)",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <Sparkles size={11} />
                    <span>Aged ephemeral memories consolidated into permanent memory shard this turn.</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Arbitration Rulings */}
          {characterArbitrations.length > 0 && (
            <div className="agent-modal-card">
              <div className="agent-modal-card-header">
                <Award size={13} color="var(--accent-amber)" />
                <span>Inventory Dispute Rulings Involving {charName}</span>
              </div>
              <div className="agent-modal-card-body" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {characterArbitrations.map((ruling, idx) => {
                  const isWinner = ruling.winner_id === charId;
                  return (
                    <div
                      key={idx}
                      style={{
                        padding: "8px 10px",
                        borderRadius: 6,
                        background: "var(--bg-card)",
                        border: `1px solid ${
                          isWinner ? "rgba(16, 185, 129, 0.4)" : "rgba(245, 158, 11, 0.3)"
                        }`,
                        fontSize: "0.8rem",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                        <strong style={{ color: "var(--text-primary)" }}>
                          {ruling.item_name}
                        </strong>
                        <span
                          style={{
                            fontWeight: 600,
                            color: isWinner ? "#6ee7b7" : "var(--accent-amber)",
                          }}
                        >
                          {isWinner ? "Awarded Custody" : `Custody -> ${ruling.winner_label}`}
                        </span>
                      </div>
                      <div style={{ color: "var(--text-secondary)", fontSize: "0.76rem" }}>
                        {ruling.rationale}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {!hasAnyMutations && (
            <div
              style={{
                textAlign: "center",
                padding: "16px 12px",
                color: "var(--text-muted)",
                fontSize: "0.82rem",
              }}
            >
              Character Agent executed: observant and composed in scene, maintaining baseline psyche.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
