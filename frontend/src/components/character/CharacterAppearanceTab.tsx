import React, { useState } from "react";
import { Loader2, Plus, Sparkles, Trash2, Undo2 } from "lucide-react";
import { api } from "../../api";
import { TagChipsInput } from "../TagChipsInput";
import { ClickToEditField } from "../EntityEditorModals";

export interface CharacterAppearanceData {
  build_and_height?: string;
  distinctive_features?: string[];
  posture?: string;
  mannerisms?: string[];
  modifications?: string[];
  visual_aesthetic?: string;
  physical_appearance?: string;
  character_bio?: string;
}

export interface CharacterAppearanceTabProps {
  data: CharacterAppearanceData;
  onChange?: (updated: Partial<CharacterAppearanceData>) => void;
  readOnly?: boolean;
}

export const CharacterAppearanceTab: React.FC<CharacterAppearanceTabProps> = ({
  data,
  onChange,
  readOnly = false,
}) => {
  const buildValue = data.build_and_height ?? "";
  const featuresValue = data.distinctive_features ?? [];
  const postureValue = data.posture ?? "";
  const mannerismsValue = data.mannerisms ?? [];
  const aestheticValue = data.visual_aesthetic ?? "";
  const bioText = (data.character_bio ?? data.physical_appearance ?? "").trim();

  const [isExtracting, setIsExtracting] = useState<boolean>(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [undoSnapshot, setUndoSnapshot] = useState<{
    prevFeatures: string[];
    prevBio: string;
    addedCount: number;
  } | null>(null);

  const handleFieldChange = <K extends keyof CharacterAppearanceData>(
    field: K,
    val: CharacterAppearanceData[K]
  ) => {
    if (readOnly || !onChange) return;
    onChange({ [field]: val });
  };

  const postureShortcuts = ["Rigid", "Slouched", "Military bearing", "Relaxed & loose", "Predatory", "Vigilant"];

  const handlePopulateFromBio = async () => {
    if (readOnly || !onChange || isExtracting || !bioText) return;
    setIsExtracting(true);
    setExtractError(null);
    try {
      const res = await api.extractCharacterFeatures(bioText, featuresValue);
      if (!res.extracted_features || res.extracted_features.length === 0) {
        setExtractError("No new distinctive physical features detected in character bio.");
        return;
      }
      setUndoSnapshot({
        prevFeatures: [...featuresValue],
        prevBio: bioText,
        addedCount: res.extracted_features.length,
      });
      const nextFeatures = [...featuresValue, ...res.extracted_features];
      onChange({
        distinctive_features: nextFeatures,
        character_bio: res.rewritten_bio,
        physical_appearance: res.rewritten_bio,
      });
    } catch (err: any) {
      setExtractError(err?.message || "Failed to extract features from bio.");
    } finally {
      setIsExtracting(false);
    }
  };

  const handleUndoExtraction = () => {
    if (!undoSnapshot || !onChange) return;
    onChange({
      distinctive_features: undoSnapshot.prevFeatures,
      character_bio: undoSnapshot.prevBio,
      physical_appearance: undoSnapshot.prevBio,
    });
    setUndoSnapshot(null);
    setExtractError(null);
  };

  const handleAddMannerism = () => {
    if (readOnly || !onChange) return;
    onChange({ mannerisms: [...mannerismsValue, ""] });
  };

  const handleUpdateMannerism = (idx: number, text: string) => {
    if (readOnly || !onChange) return;
    const next = [...mannerismsValue];
    next[idx] = text;
    onChange({ mannerisms: next });
  };

  const handleRemoveMannerism = (idx: number) => {
    if (readOnly || !onChange) return;
    const next = mannerismsValue.filter((_, i) => i !== idx);
    onChange({ mannerisms: next });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Build & Height and Posture */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <ClickToEditField
          label="Build & Height"
          value={buildValue}
          placeholder="Click to set build & height (e.g. 185 cm, athletic...)"
          readOnly={readOnly}
          onChange={(val) => handleFieldChange("build_and_height", val)}
        />

        <ClickToEditField
          label="Resting Posture"
          value={postureValue}
          placeholder="Click to set posture (e.g. Rigid, slouched...)"
          readOnly={readOnly}
          suggestions={postureShortcuts}
          onChange={(val) => handleFieldChange("posture", val)}
        />
      </div>

      {/* Distinctive Features (Chips, Optional, with AI Extraction from Bio) */}
      <div className="field-group">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <label style={{ margin: 0 }}>
            {readOnly
              ? "Distinctive Features"
              : "Distinctive Features (Anatomy, Hair, Eyes, Scars, Tech/Implants — Optional)"}
          </label>
          {!readOnly && bioText.length > 0 && (
            <button
              type="button"
              className="btn btn-sm"
              disabled={isExtracting}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: "0.72rem",
                padding: "2px 8px",
                color: "var(--accent-amber)",
                borderColor: "rgba(245, 158, 11, 0.4)",
              }}
              onClick={handlePopulateFromBio}
              title="Extract distinctive physical features from bio and rewrite bio to remove them"
            >
              {isExtracting ? (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  <span>Extracting from Bio...</span>
                </>
              ) : (
                <>
                  <Sparkles size={12} />
                  <span>Populate from Bio</span>
                </>
              )}
            </button>
          )}
        </div>

        {undoSnapshot && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "rgba(245, 158, 11, 0.12)",
              border: "1px solid var(--accent-amber)",
              borderRadius: 6,
              padding: "6px 10px",
              marginBottom: 6,
              fontSize: "0.76rem",
              color: "var(--accent-amber)",
            }}
          >
            <span>
              Extracted {undoSnapshot.addedCount} {undoSnapshot.addedCount === 1 ? "feature" : "features"} from bio. Rewrote bio to exclude them.
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
              onClick={handleUndoExtraction}
            >
              <Undo2 size={12} /> Undo
            </button>
          </div>
        )}

        {extractError && (
          <div style={{ fontSize: "0.72rem", color: "var(--accent-rose)", marginBottom: 6 }}>
            {extractError}
          </div>
        )}

        {readOnly ? (
          <div className="editable-field-box read-only" style={{ cursor: "default", display: "flex", flexWrap: "wrap", gap: 6 }}>
            {featuresValue.length > 0 ? (
              featuresValue.map((f, i) => (
                <span
                  key={i}
                  style={{
                    background: "rgba(245, 158, 11, 0.15)",
                    border: "1px solid var(--accent-amber)",
                    color: "var(--accent-amber)",
                    borderRadius: 4,
                    padding: "2px 8px",
                    fontSize: "0.78rem",
                  }}
                >
                  {f}
                </span>
              ))
            ) : (
              <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>—</span>
            )}
          </div>
        ) : (
          <TagChipsInput
            value={featuresValue}
            onChange={(next) => handleFieldChange("distinctive_features", next)}
            placeholder="e.g. pale skin, scars on forearms, gray eyes, chrome ocular implant..."
            accentVariant="amber"
          />
        )}
      </div>

      {/* Mannerisms & Behavioral Tells (Multiline List) */}
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-subtle)",
          borderRadius: 8,
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-primary)" }}>
              Mannerisms &amp; Behavioral Tells
            </div>
            {!readOnly && (
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                Habitual micro-actions, stress reactions, and conversational tells
              </div>
            )}
          </div>
          {!readOnly && (
            <button
              type="button"
              className="btn btn-sm"
              style={{ fontSize: "0.72rem", padding: "3px 8px", display: "flex", alignItems: "center", gap: 4 }}
              onClick={handleAddMannerism}
            >
              <Plus size={12} /> Add Tell
            </button>
          )}
        </div>

        {mannerismsValue.length === 0 ? (
          <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", fontStyle: "italic" }}>
            {readOnly ? "—" : 'No mannerisms specified. Click "Add Tell" to add behavioral habits.'}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {mannerismsValue.map((tell, idx) => (
              <div key={idx} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {readOnly ? (
                  <div
                    style={{
                      flex: 1,
                      padding: "6px 10px",
                      borderRadius: 6,
                      background: "rgba(0, 0, 0, 0.2)",
                      border: "1px solid var(--border-subtle)",
                      fontSize: "0.82rem",
                    }}
                  >
                    • {tell}
                  </div>
                ) : (
                  <>
                    <input
                      className="field-input"
                      style={{ flex: 1 }}
                      placeholder="e.g. subtle tightening of jaw when stressed, tends to narrow eyes..."
                      value={tell}
                      onChange={(e) => handleUpdateMannerism(idx, e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: "6px 8px", color: "var(--accent-rose)" }}
                      title="Remove tell"
                      onClick={() => handleRemoveMannerism(idx)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Visual Aesthetic / Default Style */}
      <ClickToEditField
        label="Visual Aesthetic & Default Dress Vibe (General style, separate from inventory gear)"
        readOnlyLabel="Visual Aesthetic"
        value={aestheticValue}
        placeholder="Click to set visual aesthetic (e.g. practical street techwear, corporate tailoring...)"
        readOnly={readOnly}
        onChange={(val) => handleFieldChange("visual_aesthetic", val)}
      />
    </div>
  );
};
