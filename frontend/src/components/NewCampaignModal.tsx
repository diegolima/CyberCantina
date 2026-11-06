import React, { useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  FolderPlus,
  Globe,
  Loader2,
  Lock,
  Plus,
  Sparkles,
  User,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import {
  CharacterRecord,
  CreateCampaignPayload,
  PersonaRecord,
  WorldRecord,
} from "../types";

export type CampaignWizardStep = 1 | 2 | 3;

export const CAMPAIGN_PREFIXES: readonly string[] = [
  "Chronicles of",
  "Adventures in",
  "Tales from",
  "Shadows of",
  "Echoes of",
  "Journey through",
  "Legends of",
  "Secrets of",
  "The Fall of",
  "Whispers of",
] as const;

export interface NewCampaignModalProps {
  worlds: WorldRecord[];
  characters: CharacterRecord[];
  personas: PersonaRecord[];
  initialWorldId?: string;
  initialCharacterId?: string;
  initialPersonaId?: string;
  onClose: () => void;
  onCreate: (payload: CreateCampaignPayload) => Promise<void>;
  onOpenPersonaModal?: () => void;
}

function getRandomPrefix(): string {
  const idx = Math.floor(Math.random() * CAMPAIGN_PREFIXES.length);
  return CAMPAIGN_PREFIXES[idx];
}

export const NewCampaignModal: React.FC<NewCampaignModalProps> = ({
  worlds,
  characters,
  personas,
  initialWorldId,
  initialCharacterId,
  initialPersonaId,
  onClose,
  onCreate,
  onOpenPersonaModal,
}) => {
  const [step, setStep] = useState<CampaignWizardStep>(1);

  // --- Step 1 State: World, Persona, Name ---
  const [selectedWorldId, setSelectedWorldId] = useState(
    initialWorldId || worlds[0]?.id || ""
  );
  const selectedWorld =
    worlds.find((w) => w.id === selectedWorldId) || worlds[0];

  const [activePrefix, setActivePrefix] = useState<string>(() => getRandomPrefix());
  const [hasUserEditedName, setHasUserEditedName] = useState(false);
  const [campaignName, setCampaignName] = useState<string>(() => {
    const wName = selectedWorld?.name ?? "World";
    return `${activePrefix} ${wName}`;
  });

  const [selectedPersonaId, setSelectedPersonaId] = useState(
    initialPersonaId || (personas.length > 0 ? personas[0].id : "")
  );
  const selectedPersona =
    personas.find((p) => p.id === selectedPersonaId) || null;

  // --- Step 2 State: Characters ---
  const [selectedCharIds, setSelectedCharIds] = useState<string[]>(() => {
    if (initialCharacterId && characters.some((c) => c.id === initialCharacterId)) {
      return [initialCharacterId];
    }
    return characters.length > 0 ? [characters[0].id] : [];
  });

  // --- Step 3 State: Focus & Preview ---
  const startingLoc =
    selectedWorld?.locations.find((l) => l.is_starting_location) ??
    selectedWorld?.locations[0];
  const hasWorldStartMsg = Boolean(startingLoc?.starting_message?.trim());

  const [startFocus, setStartFocus] = useState<"world" | "character">(() =>
    hasWorldStartMsg ? "world" : "character"
  );
  const [focusCharId, setFocusCharId] = useState<string>(() =>
    selectedCharIds[0] || (characters[0]?.id ?? "")
  );
  const [showProsePreview, setShowProsePreview] = useState(false);

  // --- Submission State ---
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleWorldChange = (worldId: string) => {
    setSelectedWorldId(worldId);
    const w = worlds.find((item) => item.id === worldId);
    if (w) {
      if (!hasUserEditedName) {
        const nextPrefix = getRandomPrefix();
        setActivePrefix(nextPrefix);
        setCampaignName(`${nextPrefix} ${w.name}`);
      }
      const nextStartLoc =
        w.locations.find((l) => l.is_starting_location) ?? w.locations[0];
      const nextHasStart = Boolean(nextStartLoc?.starting_message?.trim());
      if (!nextHasStart && startFocus === "world") {
        setStartFocus("character");
      }
    }
  };

  const handleToggleChar = (charId: string) => {
    setSelectedCharIds((prev) => {
      const exists = prev.includes(charId);
      const next = exists ? prev.filter((id) => id !== charId) : [...prev, charId];
      if (next.length > 0 && !next.includes(focusCharId)) {
        setFocusCharId(next[0]);
      }
      return next;
    });
  };

  const selectedCharacters = characters.filter((c) =>
    selectedCharIds.includes(c.id)
  );
  const focusedCharacter =
    characters.find((c) => c.id === focusCharId) || selectedCharacters[0] || characters[0];

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedWorldId) {
      setErrorMsg("Please select a world.");
      return;
    }
    if (selectedCharIds.length === 0) {
      setErrorMsg("Please select at least one character in Step 2.");
      return;
    }

    const finalName =
      campaignName.trim() || `${activePrefix} ${selectedWorld?.name ?? "World"}`;
    const effectiveFocusCharId =
      startFocus === "character"
        ? focusCharId || selectedCharIds[0]
        : selectedCharIds[0];

    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      await onCreate({
        name: finalName,
        world_id: selectedWorldId,
        character_id: effectiveFocusCharId,
        character_ids: selectedCharIds,
        start_focus: startFocus,
        focus_character_id: effectiveFocusCharId,
        persona_id: selectedPersonaId ? selectedPersonaId : undefined,
      });
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to start campaign.");
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!isSubmitting) onClose();
      }}
    >
      <div
        className="modal-panel"
        style={{
          width: "min(620px, 95vw)",
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          position: "relative",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Preparing Campaign Loading Overlay */}
        {isSubmitting && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(10, 14, 23, 0.88)",
              backdropFilter: "blur(4px)",
              zIndex: 50,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 14,
              padding: 24,
              textAlign: "center",
            }}
          >
            <Loader2
              size={36}
              color="var(--accent-emerald)"
              className="spin"
              style={{ animation: "spin 1.2s linear infinite" }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span
                style={{
                  fontSize: "1.05rem",
                  fontWeight: 600,
                  color: "var(--text-primary)",
                }}
              >
                Preparing campaign...
              </span>
              <span
                style={{
                  fontSize: "0.82rem",
                  color: "var(--text-secondary)",
                  maxWidth: 380,
                  lineHeight: 1.45,
                }}
              >
                {startFocus === "world"
                  ? "Staging participant characters into the starting location. This may take a few moments."
                  : "Initializing world timeline snapshots and baseline states."}
              </span>
            </div>
          </div>
        )}

        {/* Modal Header */}
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--accent-emerald)" }}>
            <FolderPlus size={18} />
            <span style={{ fontWeight: 600 }}>Launch Campaign</span>
          </div>

          {/* Step Badges */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              type="button"
              className={`badge ${step === 1 ? "badge--active" : ""}`}
              onClick={() => !isSubmitting && setStep(1)}
              style={{
                cursor: isSubmitting ? "default" : "pointer",
                background: step === 1 ? "var(--accent-emerald)" : "rgba(255, 255, 255, 0.05)",
                color: step === 1 ? "#000" : "var(--text-secondary)",
                fontSize: "0.72rem",
                padding: "2px 8px",
              }}
            >
              1. Setup
            </button>
            <button
              type="button"
              className={`badge ${step === 2 ? "badge--active" : ""}`}
              onClick={() => !isSubmitting && setStep(2)}
              style={{
                cursor: isSubmitting ? "default" : "pointer",
                background: step === 2 ? "var(--accent-emerald)" : "rgba(255, 255, 255, 0.05)",
                color: step === 2 ? "#000" : "var(--text-secondary)",
                fontSize: "0.72rem",
                padding: "2px 8px",
              }}
            >
              2. Characters ({selectedCharIds.length})
            </button>
            <button
              type="button"
              className={`badge ${step === 3 ? "badge--active" : ""}`}
              onClick={() => {
                if (!isSubmitting && selectedCharIds.length > 0) setStep(3);
              }}
              disabled={selectedCharIds.length === 0}
              style={{
                cursor: selectedCharIds.length > 0 && !isSubmitting ? "pointer" : "not-allowed",
                background: step === 3 ? "var(--accent-emerald)" : "rgba(255, 255, 255, 0.05)",
                color: step === 3 ? "#000" : "var(--text-secondary)",
                opacity: selectedCharIds.length === 0 ? 0.5 : 1,
                fontSize: "0.72rem",
                padding: "2px 8px",
              }}
            >
              3. Opening Scene
            </button>
          </div>

          <button type="button" className="btn" onClick={onClose} disabled={isSubmitting}>
            <X size={15} />
          </button>
        </div>

        {/* Modal Body / Steps */}
        <div
          className="modal-body"
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          {errorMsg && (
            <div
              style={{
                color: "#fda4af",
                fontSize: "0.82rem",
                background: "rgba(239, 68, 68, 0.12)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                padding: "8px 12px",
                borderRadius: 6,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <AlertCircle size={14} color="#fda4af" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* STEP 1: CAMPAIGN BASICS (NAME, WORLD, PERSONA) */}
          {step === 1 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ fontSize: "0.82rem", fontWeight: 600, display: "block", marginBottom: 4 }}>
                  Campaign Title
                </label>
                <input
                  type="text"
                  className="field-input"
                  value={campaignName}
                  onChange={(e) => {
                    setCampaignName(e.target.value);
                    setHasUserEditedName(true);
                  }}
                  placeholder="e.g. Chronicles of The Sprawl"
                  required
                />
              </div>

              <div>
                <label style={{ fontSize: "0.82rem", fontWeight: 600, display: "block", marginBottom: 4 }}>
                  World Setting
                </label>
                <select
                  className="field-select"
                  value={selectedWorldId}
                  onChange={(e) => handleWorldChange(e.target.value)}
                  required
                >
                  {worlds.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.locations.length} locations)
                    </option>
                  ))}
                </select>

                {/* Non-intrusive warning if World has no starting message */}
                {!hasWorldStartMsg && (
                  <div
                    style={{
                      marginTop: 8,
                      background: "rgba(245, 158, 11, 0.08)",
                      border: "1px solid rgba(245, 158, 11, 0.25)",
                      borderRadius: 6,
                      padding: "8px 10px",
                      fontSize: "0.76rem",
                      color: "var(--accent-amber)",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <AlertCircle size={14} />
                    <span>
                      This world's starting location has no opening atmosphere message.
                      World-focused start will not be available.
                    </span>
                  </div>
                )}
              </div>

              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <label style={{ fontSize: "0.82rem", fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                    <UserCheck size={14} color="var(--accent-emerald)" />
                    Player Persona (Your Identity)
                  </label>
                  {onOpenPersonaModal && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        onClose();
                        onOpenPersonaModal();
                      }}
                      style={{ fontSize: "0.72rem", padding: "2px 8px", display: "flex", alignItems: "center", gap: 4 }}
                    >
                      <Plus size={12} />
                      New Persona
                    </button>
                  )}
                </div>

                <select
                  className="field-select"
                  value={selectedPersonaId}
                  onChange={(e) => setSelectedPersonaId(e.target.value)}
                >
                  <option value="">None (Standard Anonymous Protagonist)</option>
                  {personas.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.age ? `(Age ${p.age})` : ""} — {p.inventory?.length ?? 0} items, {p.lore_entries?.length ?? 0} lore
                    </option>
                  ))}
                </select>
              </div>

              {selectedPersona ? (
                <div
                  style={{
                    background: "rgba(16, 185, 129, 0.05)",
                    border: "1px solid rgba(16, 185, 129, 0.2)",
                    borderRadius: 6,
                    padding: "10px 12px",
                    fontSize: "0.78rem",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <strong style={{ color: "var(--accent-emerald)" }}>{selectedPersona.name}</strong>
                    <span style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>
                      Frozen snapshot for this campaign
                    </span>
                  </div>
                  <div style={{ color: "var(--text-secondary)", lineHeight: 1.4 }}>
                    {selectedPersona.physical_appearance || "No physical appearance specified."}
                  </div>
                  <div style={{ display: "flex", gap: 12, marginTop: 2, color: "var(--text-muted)", fontSize: "0.72rem" }}>
                    <span>Equipped: {selectedPersona.equipped?.length ?? 0}</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                      <Lock size={10} /> Inventory: {selectedPersona.inventory?.length ?? 0}
                    </span>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    background: "rgba(255, 255, 255, 0.02)",
                    border: "1px dashed var(--border-subtle)",
                    borderRadius: 6,
                    padding: "8px 12px",
                    fontSize: "0.75rem",
                    color: "var(--text-muted)",
                  }}
                >
                  No persona selected. Running with the default anonymous protagonist view.
                </div>
              )}
            </div>
          )}

          {/* STEP 2: PARTICIPANT CHARACTERS */}
          {step === 2 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <label style={{ fontSize: "0.82rem", fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                  <Users size={14} color="var(--accent-emerald)" />
                  Select Characters to Include ({selectedCharIds.length} selected)
                </label>
                <span style={{ fontSize: "0.72rem", color: "var(--text-secondary)" }}>
                  At least 1 required
                </span>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                  gap: 8,
                  maxHeight: "360px",
                  overflowY: "auto",
                  paddingRight: 4,
                }}
              >
                {characters.map((char) => {
                  const isSelected = selectedCharIds.includes(char.id);
                  return (
                    <div
                      key={char.id}
                      onClick={() => handleToggleChar(char.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "8px 10px",
                        borderRadius: 6,
                        border: isSelected
                          ? "1px solid var(--accent-emerald)"
                          : "1px solid var(--border-subtle)",
                        background: isSelected
                          ? "rgba(16, 185, 129, 0.08)"
                          : "rgba(255, 255, 255, 0.02)",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}} // handled by parent onClick
                        style={{ cursor: "pointer" }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: "0.82rem",
                            color: isSelected ? "var(--accent-emerald)" : "var(--text-primary)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {char.name}
                        </div>
                        <div
                          style={{
                            fontSize: "0.72rem",
                            color: "var(--text-secondary)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {char.tagline || char.core_persona?.slice(0, 50) || "No description"}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {selectedCharIds.length === 0 && (
                <div style={{ fontSize: "0.74rem", color: "#fda4af" }}>
                  Please select at least one character to participate in this campaign.
                </div>
              )}
            </div>
          )}

          {/* STEP 3: OPENING SCENE FOCUS */}
          {step === 3 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ fontSize: "0.82rem", fontWeight: 600, display: "block", marginBottom: 6 }}>
                  Campaign Opening Hook
                </label>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {/* World Atmosphere Option */}
                  <div
                    onClick={() => {
                      if (hasWorldStartMsg) setStartFocus("world");
                    }}
                    style={{
                      border:
                        startFocus === "world"
                          ? "1px solid var(--accent-emerald)"
                          : "1px solid var(--border-subtle)",
                      background:
                        startFocus === "world"
                          ? "rgba(16, 185, 129, 0.08)"
                          : "rgba(255, 255, 255, 0.02)",
                      borderRadius: 8,
                      padding: "12px",
                      cursor: hasWorldStartMsg ? "pointer" : "not-allowed",
                      opacity: hasWorldStartMsg ? 1 : 0.5,
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          fontWeight: 600,
                          fontSize: "0.84rem",
                          color: startFocus === "world" ? "var(--accent-emerald)" : "var(--text-primary)",
                        }}
                      >
                        <Globe size={15} />
                        World Atmosphere
                      </span>
                      <input
                        type="radio"
                        name="startFocus"
                        checked={startFocus === "world"}
                        disabled={!hasWorldStartMsg}
                        onChange={() => setStartFocus("world")}
                      />
                    </div>
                    <div style={{ fontSize: "0.74rem", color: "var(--text-secondary)", lineHeight: 1.4 }}>
                      Opens with {startingLoc?.name ?? "the starting hub"}'s atmosphere. The Clerk stages all participant characters in the room.
                    </div>
                    {!hasWorldStartMsg && (
                      <span style={{ fontSize: "0.68rem", color: "var(--accent-amber)", marginTop: 2 }}>
                        Unavailable: No starting message in this world
                      </span>
                    )}
                  </div>

                  {/* Character Focus Option */}
                  <div
                    onClick={() => setStartFocus("character")}
                    style={{
                      border:
                        startFocus === "character"
                          ? "1px solid var(--accent-emerald)"
                          : "1px solid var(--border-subtle)",
                      background:
                        startFocus === "character"
                          ? "rgba(16, 185, 129, 0.08)"
                          : "rgba(255, 255, 255, 0.02)",
                      borderRadius: 8,
                      padding: "12px",
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          fontWeight: 600,
                          fontSize: "0.84rem",
                          color: startFocus === "character" ? "var(--accent-emerald)" : "var(--text-primary)",
                        }}
                      >
                        <User size={15} />
                        Character Greeting
                      </span>
                      <input
                        type="radio"
                        name="startFocus"
                        checked={startFocus === "character"}
                        onChange={() => setStartFocus("character")}
                      />
                    </div>
                    <div style={{ fontSize: "0.74rem", color: "var(--text-secondary)", lineHeight: 1.4 }}>
                      Opens with a selected character's greeting monologue and in-character interaction.
                    </div>
                  </div>
                </div>
              </div>

              {/* Character selection if Character Focus is picked */}
              {startFocus === "character" && (
                <div>
                  <label style={{ fontSize: "0.8rem", fontWeight: 600, display: "block", marginBottom: 4 }}>
                    Focused Character for Opening
                  </label>
                  <select
                    className="field-select"
                    value={focusCharId}
                    onChange={(e) => setFocusCharId(e.target.value)}
                  >
                    {selectedCharacters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Collapsed Prose Preview Accordion */}
              <div
                style={{
                  border: "1px solid var(--border-subtle)",
                  borderRadius: 6,
                  overflow: "hidden",
                  background: "rgba(0, 0, 0, 0.2)",
                }}
              >
                <button
                  type="button"
                  onClick={() => setShowProsePreview(!showProsePreview)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 12px",
                    background: "rgba(255, 255, 255, 0.03)",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--text-primary)",
                    fontSize: "0.76rem",
                    fontWeight: 600,
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Sparkles size={13} color="var(--accent-emerald)" />
                    Opening Scene Preview (Turn 0)
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--text-secondary)" }}>
                    <span style={{ fontSize: "0.7rem" }}>
                      {showProsePreview ? "Hide preview" : "View preview"}
                    </span>
                    {showProsePreview ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </div>
                </button>

                {showProsePreview && (
                  <div
                    style={{
                      padding: "10px 12px",
                      fontSize: "0.76rem",
                      lineHeight: 1.5,
                      color: "var(--text-secondary)",
                      maxHeight: "180px",
                      overflowY: "auto",
                      borderTop: "1px solid var(--border-subtle)",
                    }}
                  >
                    {startFocus === "world" ? (
                      <div>
                        <div style={{ fontStyle: "italic", whiteSpace: "pre-wrap" }}>
                          {startingLoc?.starting_message || startingLoc?.description}
                        </div>
                        <div
                          style={{
                            marginTop: 10,
                            paddingTop: 8,
                            borderTop: "1px dashed rgba(255, 255, 255, 0.1)",
                            color: "var(--accent-emerald)",
                            fontSize: "0.72rem",
                          }}
                        >
                          + Non-user characters ({selectedCharacters.map((c) => c.name).join(", ")}) will be placed in {startingLoc?.name} by the Clerk upon launch.
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontStyle: "italic", whiteSpace: "pre-wrap" }}>
                        {focusedCharacter?.initial_message?.trim() ||
                          `*${focusedCharacter?.name} stands inside ${startingLoc?.name ?? "the room"}.*\n\n"You're late," ${focusedCharacter?.name} says quietly.`}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer / Navigation Controls */}
        <div
          className="modal-footer"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 20px",
            borderTop: "1px solid var(--border-subtle)",
            background: "rgba(0, 0, 0, 0.15)",
          }}
        >
          {step > 1 ? (
            <button
              type="button"
              className="btn"
              onClick={() => setStep((s) => (s - 1) as CampaignWizardStep)}
              disabled={isSubmitting}
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              <ArrowLeft size={14} />
              Back
            </button>
          ) : (
            <button type="button" className="btn" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </button>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            {step < 3 ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setStep((s) => (s + 1) as CampaignWizardStep)}
                disabled={isSubmitting || (step === 2 && selectedCharIds.length === 0)}
                style={{ display: "flex", alignItems: "center", gap: 6 }}
              >
                <span>Next</span>
                <ArrowRight size={14} />
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => handleSubmit()}
                disabled={isSubmitting || selectedCharIds.length === 0}
                style={{ display: "flex", alignItems: "center", gap: 6 }}
              >
                <Sparkles size={14} />
                <span>Launch Campaign</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
