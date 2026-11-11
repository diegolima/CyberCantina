import React, { useState } from "react";
import { ChevronDown, ChevronRight, HeartPulse, Loader2, Sparkles, Undo2 } from "lucide-react";
import { api } from "../../api";
import {
  BASELINE_MOOD_PRESETS,
  BaselinePsyche,
  TEMPERAMENT_ARCHETYPE_OPTIONS,
  TemperamentArchetype,
  getTemperamentPresetMeta,
} from "../../types";
import { TagChipsInput } from "../TagChipsInput";
import { ClickToEditField } from "../EntityEditorModals";

export interface CharacterPersonalityData {
  personality_traits?: string[];
  core_persona: string;
  moral_code?: string[];
  quirks_flaws?: string[];
  baseline_psyche: BaselinePsyche;
}

export interface CharacterPersonalityTabProps {
  data: CharacterPersonalityData;
  onChange?: (updated: Partial<CharacterPersonalityData>) => void;
  readOnly?: boolean;
}

export const CharacterPersonalityTab: React.FC<CharacterPersonalityTabProps> = ({
  data,
  onChange,
  readOnly = false,
}) => {
  const traits = data.personality_traits ?? [];
  const moralCode = data.moral_code ?? [];
  const quirks = data.quirks_flaws ?? [];
  const psyche = data.baseline_psyche;

  // Detect whether current mood matches one of the presets
  const matchedPreset = BASELINE_MOOD_PRESETS.find(
    (p) =>
      p.label.toLowerCase() === (psyche.mood_label || "").toLowerCase() &&
      Math.abs(p.valence - psyche.valence) < 0.05 &&
      Math.abs(p.arousal - psyche.arousal) < 0.05
  );

  const [isCustomMood, setIsCustomMood] = useState<boolean>(!matchedPreset && Boolean(psyche.mood_label));
  const [showAdvancedCare, setShowAdvancedCare] = useState<boolean>(false);

  const [isExtractingQuirks, setIsExtractingQuirks] = useState<boolean>(false);
  const [quirksExtractError, setQuirksExtractError] = useState<string | null>(null);
  const [quirksUndoSnapshot, setQuirksUndoSnapshot] = useState<{
    prevQuirks: string[];
    prevCorePersona: string;
    addedCount: number;
  } | null>(null);

  const demeanorText = (data.core_persona || "").trim();

  const handlePopulateQuirksFromDemeanor = async () => {
    if (readOnly || !onChange || isExtractingQuirks || !demeanorText) return;
    setIsExtractingQuirks(true);
    setQuirksExtractError(null);
    try {
      const res = await api.extractCharacterQuirks(demeanorText, quirks);
      const newQuirks = res.extracted_quirks || [];
      if (newQuirks.length === 0) {
        setQuirksExtractError("No new behavioral quirks or flaws detected in demeanor prose.");
        return;
      }
      setQuirksUndoSnapshot({
        prevQuirks: [...quirks],
        prevCorePersona: demeanorText,
        addedCount: newQuirks.length,
      });
      const nextQuirks = [...quirks, ...newQuirks];
      onChange({
        quirks_flaws: nextQuirks,
        core_persona: res.rewritten_core_persona,
      });
    } catch (err: any) {
      setQuirksExtractError(err?.message || "Failed to extract quirks from demeanor.");
    } finally {
      setIsExtractingQuirks(false);
    }
  };

  const handleUndoQuirksExtraction = () => {
    if (!quirksUndoSnapshot || !onChange) return;
    onChange({
      quirks_flaws: quirksUndoSnapshot.prevQuirks,
      core_persona: quirksUndoSnapshot.prevCorePersona,
    });
    setQuirksUndoSnapshot(null);
    setQuirksExtractError(null);
  };

  const handleFieldChange = <K extends keyof CharacterPersonalityData>(
    field: K,
    val: CharacterPersonalityData[K]
  ) => {
    if (readOnly || !onChange) return;
    onChange({ [field]: val });
  };

  const handlePsycheChange = (updated: Partial<BaselinePsyche>) => {
    if (readOnly || !onChange) return;
    onChange({
      baseline_psyche: {
        ...psyche,
        ...updated,
      },
    });
  };

  const handleMoodPresetChange = (presetId: string) => {
    if (presetId === "custom") {
      setIsCustomMood(true);
      return;
    }
    const preset = BASELINE_MOOD_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setIsCustomMood(false);
    handlePsycheChange({
      mood_label: preset.label,
      valence: preset.valence,
      arousal: preset.arousal,
    });
  };

  const activeArchetypeMeta = getTemperamentPresetMeta(psyche.temperament?.archetype);
  const wv = psyche.initial_worldview ?? activeArchetypeMeta.worldview;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Personality Traits / Tropes (Chips) */}
      <div className="field-group">
        <label>
          {readOnly
            ? "Personality Traits"
            : "Personality Traits & Archetypal Tropes (Type & Press Comma or Enter)"}
        </label>
        {readOnly ? (
          <div className="editable-field-box read-only" style={{ cursor: "default", display: "flex", flexWrap: "wrap", gap: 6 }}>
            {traits.length > 0 ? (
              traits.map((t, i) => (
                <span
                  key={i}
                  title={t}
                  style={{
                    background: "rgba(168, 85, 247, 0.15)",
                    border: "1px solid var(--accent-violet, #a855f7)",
                    color: "var(--accent-violet, #a855f7)",
                    borderRadius: 4,
                    padding: "2px 8px",
                    fontSize: "0.78rem",
                  }}
                >
                  {t}
                </span>
              ))
            ) : (
              <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>—</span>
            )}
          </div>
        ) : (
          <TagChipsInput
            value={traits}
            onChange={(next) => handleFieldChange("personality_traits", next)}
            placeholder="e.g. cynical, hyper-observant, dryly funny, loyal, secretive..."
            accentVariant="violet"
          />
        )}
      </div>

      {/* Core Demeanor & Persona Prose */}
      <ClickToEditField
        label="Core Persona Demeanor (Zone 1 Demeanor, Conversational Habits & Social Defenses)"
        readOnlyLabel="Core Demeanor"
        value={data.core_persona}
        readOnly={readOnly}
        multiline
        rows={4}
        placeholder="Describe how the character acts, speaks, deflects, and behaves in scenes..."
        onChange={(val) => handleFieldChange("core_persona", val)}
      />

      {/* Moral Code & Boundaries and Quirks & Flaws (Both Optional) */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {/* Moral Code (Optional) */}
        <div className="field-group">
          <label>
            {readOnly ? "Moral Code & Boundaries" : "Moral Code & Lines They Won't Cross (Optional)"}
          </label>
          {readOnly ? (
            <div className="editable-field-box read-only" style={{ cursor: "default", display: "flex", flexWrap: "wrap", gap: 6 }}>
              {moralCode.length > 0 ? (
                moralCode.map((m, i) => (
                  <span
                    key={i}
                    title={m}
                    style={{
                      background: "rgba(34, 197, 94, 0.15)",
                      border: "1px solid #22c55e",
                      color: "#22c55e",
                      borderRadius: 4,
                      padding: "2px 8px",
                      fontSize: "0.78rem",
                    }}
                  >
                    {m}
                  </span>
                ))
              ) : (
                <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>—</span>
              )}
            </div>
          ) : (
            <TagChipsInput
              value={moralCode}
              onChange={(next) => handleFieldChange("moral_code", next)}
              placeholder="e.g. never betrays a client, protects children..."
              accentVariant="amber"
            />
          )}
        </div>

        {/* Quirks & Flaws (Optional) with Dedicated Demeanor Extractor */}
        <div className="field-group">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <label style={{ margin: 0 }}>
              {readOnly ? "Quirks & Flaws" : "Quirks & Flaws (Optional)"}
            </label>
            {!readOnly && demeanorText.length > 0 && (
              <button
                type="button"
                className="btn btn-sm"
                disabled={isExtractingQuirks}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: "0.72rem",
                  padding: "2px 8px",
                  color: "var(--accent-amber)",
                  borderColor: "rgba(245, 158, 11, 0.4)",
                }}
                onClick={handlePopulateQuirksFromDemeanor}
                title="Extract behavioral quirks and flaws from demeanor prose and rewrite prose to remove them"
              >
                {isExtractingQuirks ? (
                  <>
                    <Loader2 size={12} className="animate-spin" />
                    <span>Extracting Quirks...</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={12} />
                    <span>Populate from Demeanor</span>
                  </>
                )}
              </button>
            )}
          </div>

          {quirksUndoSnapshot && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "rgba(244, 63, 94, 0.12)",
                border: "1px solid var(--accent-rose)",
                borderRadius: 6,
                padding: "6px 10px",
                marginBottom: 6,
                fontSize: "0.76rem",
                color: "var(--accent-rose)",
              }}
            >
              <span>
                Extracted {quirksUndoSnapshot.addedCount} {quirksUndoSnapshot.addedCount === 1 ? "quirk" : "quirks"} from demeanor. Rewrote demeanor to exclude {quirksUndoSnapshot.addedCount === 1 ? "it" : "them"}.
              </span>
              <button
                type="button"
                className="btn btn-sm"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: "0.72rem",
                  padding: "2px 8px",
                }}
                onClick={handleUndoQuirksExtraction}
              >
                <Undo2 size={12} /> Undo
              </button>
            </div>
          )}

          {quirksExtractError && (
            <div style={{ fontSize: "0.72rem", color: "var(--accent-rose)", marginBottom: 6 }}>
              {quirksExtractError}
            </div>
          )}

          {readOnly ? (
            <div className="editable-field-box read-only" style={{ cursor: "default", display: "flex", flexWrap: "wrap", gap: 6 }}>
              {quirks.length > 0 ? (
                quirks.map((q, i) => (
                  <span
                    key={i}
                    title={q}
                    style={{
                      background: "rgba(244, 63, 94, 0.15)",
                      border: "1px solid var(--accent-rose)",
                      color: "var(--accent-rose)",
                      borderRadius: 4,
                      padding: "2px 8px",
                      fontSize: "0.78rem",
                    }}
                  >
                    {q}
                  </span>
                ))
              ) : (
                <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>—</span>
              )}
            </div>
          ) : (
            <TagChipsInput
              value={quirks}
              onChange={(next) => handleFieldChange("quirks_flaws", next)}
              placeholder="e.g. insomniac, chain smoker, distrusts authorities..."
              accentVariant="amber"
            />
          )}
        </div>
      </div>

      {/* Baseline Psyche & CARE Psychological Framework */}
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-subtle)",
          borderRadius: 8,
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.82rem", fontWeight: 600, color: "#ec4899" }}>
          <HeartPulse size={15} /> Baseline Psyche & Emotional Defaults
        </div>

        {/* Baseline Mood Presets with Progressive Disclosure for Custom */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: isCustomMood && !readOnly ? "1fr 1fr 1fr" : "1fr", gap: 10 }}>
            <div className="field-group">
              <label>Starting Mood</label>
              {readOnly ? (
                <div className="editable-field-box read-only" style={{ cursor: "default" }}>
                  {psyche.mood_label} (Valence: {psyche.valence}, Arousal: {psyche.arousal})
                </div>
              ) : (
                <select
                  className="field-select"
                  value={isCustomMood ? "custom" : matchedPreset?.id ?? "custom"}
                  onChange={(e) => handleMoodPresetChange(e.target.value)}
                >
                  {BASELINE_MOOD_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} (Valence: {p.valence > 0 ? `+${p.valence}` : p.valence}, Arousal: {p.arousal})
                    </option>
                  ))}
                  <option value="custom">Custom Mood & Coordinates...</option>
                </select>
              )}
            </div>

            {isCustomMood && !readOnly && (
              <>
                <div className="field-group">
                  <label>Valence (-1.0 to +1.0)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="-1"
                    max="1"
                    className="field-input"
                    value={psyche.valence}
                    onChange={(e) =>
                      handlePsycheChange({
                        valence: Math.max(-1, Math.min(1, Number(e.target.value) || 0)),
                      })
                    }
                  />
                </div>
                <div className="field-group">
                  <label>Arousal (0.0 to 1.0)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="1"
                    className="field-input"
                    value={psyche.arousal}
                    onChange={(e) =>
                      handlePsycheChange({
                        arousal: Math.max(0, Math.min(1, Number(e.target.value) || 0)),
                      })
                    }
                  />
                </div>
              </>
            )}
          </div>

          {isCustomMood && !readOnly && (
            <ClickToEditField
              label="Custom Mood Label"
              value={psyche.mood_label}
              onChange={(val) => handlePsycheChange({ mood_label: val })}
              placeholder="e.g. Wary but composed, quietly simmering, cautious optimism..."
            />
          )}
        </div>

        {/* CARE Temperament Preset & Layer 1 Worldview with Progressive Disclosure */}
        <div
          style={{
            background: "var(--bg-panel)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 6,
            padding: 10,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div className="field-group">
            <label>CARE Temperament Archetype</label>
            {readOnly ? (
              <div className="editable-field-box read-only" style={{ cursor: "default" }}>
                {activeArchetypeMeta.label}
              </div>
            ) : (
              <select
                className="field-select"
                value={activeArchetypeMeta.archetype}
                onChange={(e) => {
                  const nextMeta = getTemperamentPresetMeta(e.target.value as TemperamentArchetype);
                  handlePsycheChange({
                    temperament: { ...nextMeta.temperament },
                    initial_worldview: { ...nextMeta.worldview },
                  });
                }}
              >
                {TEMPERAMENT_ARCHETYPE_OPTIONS.map((opt) => (
                  <option key={opt.archetype} value={opt.archetype}>
                    {opt.label}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div style={{ fontSize: "0.74rem", color: "var(--text-muted)" }}>
            {activeArchetypeMeta.summary}
          </div>

          {/* Advanced CARE Tuning Disclosure */}
          {!readOnly && (
            <button
              type="button"
              className="btn"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "3px 8px",
                fontSize: "0.72rem",
                width: "fit-content",
                marginTop: 2,
              }}
              onClick={() => setShowAdvancedCare(!showAdvancedCare)}
            >
              {showAdvancedCare ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {showAdvancedCare ? "Hide Advanced Psychological Coordinates" : "Advanced Psychological Coordinates (Worldview)"}
            </button>
          )}

          {(showAdvancedCare || readOnly) && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 10,
                marginTop: 4,
                paddingTop: 8,
                borderTop: "1px dashed var(--border-subtle)",
              }}
            >
              <div className="field-group">
                <label>Benevolence (-1 to +1)</label>
                {readOnly ? (
                  <div className="editable-field-box read-only" style={{ cursor: "default" }}>{wv.benevolence}</div>
                ) : (
                  <input
                    type="number"
                    step="0.1"
                    min="-1"
                    max="1"
                    className="field-input"
                    value={wv.benevolence}
                    onChange={(e) =>
                      handlePsycheChange({
                        initial_worldview: {
                          ...wv,
                          benevolence: Math.max(-1, Math.min(1, Number(e.target.value) || 0)),
                        },
                      })
                    }
                  />
                )}
              </div>

              <div className="field-group">
                <label>Belonging (-1 to +1)</label>
                {readOnly ? (
                  <div className="editable-field-box read-only" style={{ cursor: "default" }}>{wv.belonging}</div>
                ) : (
                  <input
                    type="number"
                    step="0.1"
                    min="-1"
                    max="1"
                    className="field-input"
                    value={wv.belonging}
                    onChange={(e) =>
                      handlePsycheChange({
                        initial_worldview: {
                          ...wv,
                          belonging: Math.max(-1, Math.min(1, Number(e.target.value) || 0)),
                        },
                      })
                    }
                  />
                )}
              </div>

              <div className="field-group">
                <label>Agency (-1 to +1)</label>
                {readOnly ? (
                  <div className="editable-field-box read-only" style={{ cursor: "default" }}>{wv.agency}</div>
                ) : (
                  <input
                    type="number"
                    step="0.1"
                    min="-1"
                    max="1"
                    className="field-input"
                    value={wv.agency}
                    onChange={(e) =>
                      handlePsycheChange({
                        initial_worldview: {
                          ...wv,
                          agency: Math.max(-1, Math.min(1, Number(e.target.value) || 0)),
                        },
                      })
                    }
                  />
                )}
              </div>
            </div>
          )}
        </div>

        {/* Core Drive & Fear */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <ClickToEditField
            label="Core Long-Term Drive"
            value={psyche.core_drive}
            readOnly={readOnly}
            multiline
            rows={2}
            onChange={(val) => handlePsycheChange({ core_drive: val })}
          />
          <ClickToEditField
            label="Core Fear"
            value={psyche.core_fear}
            readOnly={readOnly}
            multiline
            rows={2}
            onChange={(val) => handlePsycheChange({ core_fear: val })}
          />
        </div>

        {/* Default Want & Plan */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <ClickToEditField
            label="Default Scene Want (Turn 0 Objective)"
            readOnlyLabel="Default Scene Want"
            value={psyche.default_want}
            readOnly={readOnly}
            multiline
            rows={2}
            onChange={(val) => handlePsycheChange({ default_want: val })}
          />
          <ClickToEditField
            label="Default Action Plan (Step-by-step bullet list)"
            readOnlyLabel="Default Action Plan"
            value={psyche.default_plan}
            placeholder={"- Step 1: Observe immediate exits and threats\n- Step 2: Gauge motives with a direct question\n- Step 3: Maintain tactical distance"}
            readOnly={readOnly}
            multiline
            rows={3}
            onChange={(val) => handlePsycheChange({ default_plan: val })}
          />
        </div>
      </div>
    </div>
  );
};
