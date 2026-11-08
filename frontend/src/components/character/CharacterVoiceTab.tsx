import React from "react";
import { MessageSquare, Plus, Trash2 } from "lucide-react";
import { VoiceAnchor } from "../../types";
import { TagChipsInput } from "../TagChipsInput";
import { ClickToEditField } from "../EntityEditorModals";

export interface CharacterVoiceData {
  communication_style?: string[];
  voice_anchors: VoiceAnchor[];
}

export interface CharacterVoiceTabProps {
  data: CharacterVoiceData;
  onChange?: (updated: Partial<CharacterVoiceData>) => void;
  readOnly?: boolean;
}

export const CharacterVoiceTab: React.FC<CharacterVoiceTabProps> = ({
  data,
  onChange,
  readOnly = false,
}) => {
  const styleKeywords = data.communication_style ?? [];
  const anchors = data.voice_anchors ?? [];

  const handleFieldChange = <K extends keyof CharacterVoiceData>(
    field: K,
    val: CharacterVoiceData[K]
  ) => {
    if (readOnly || !onChange) return;
    onChange({ [field]: val });
  };

  const styleSuggestions = [
    "clipped",
    "concise",
    "stripped of flowery metaphors",
    "dry sarcasm",
    "formal",
    "laconic",
    "never uses contractions",
    "clinical",
    "profane",
    "poetic",
  ];

  const handleAddAnchor = () => {
    if (readOnly || !onChange) return;
    onChange({
      voice_anchors: [
        ...anchors,
        { context: "New Context", snippet: "*Sample action in italics.* \"Sample spoken dialogue in quotes.\"" },
      ],
    });
  };

  const handleUpdateAnchor = (idx: number, updated: Partial<VoiceAnchor>) => {
    if (readOnly || !onChange) return;
    const next = [...anchors];
    next[idx] = { ...next[idx], ...updated };
    onChange({ voice_anchors: next });
  };

  const handleRemoveAnchor = (idx: number) => {
    if (readOnly || !onChange) return;
    const next = anchors.filter((_, i) => i !== idx);
    onChange({ voice_anchors: next });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Communication Style Chips */}
      <div className="field-group">
        <label>
          {readOnly
            ? "Communication Style"
            : "Communication Style & Voice Constraints (Type & Press Comma or Enter)"}
        </label>
        {readOnly ? (
          <div className="editable-field-box read-only" style={{ cursor: "default", display: "flex", flexWrap: "wrap", gap: 6 }}>
            {styleKeywords.length > 0 ? (
              styleKeywords.map((s, i) => (
                <span
                  key={i}
                  title={s}
                  style={{
                    background: "rgba(56, 189, 248, 0.15)",
                    border: "1px solid var(--accent-cyan)",
                    color: "var(--accent-cyan)",
                    borderRadius: 4,
                    padding: "2px 8px",
                    fontSize: "0.78rem",
                  }}
                >
                  {s}
                </span>
              ))
            ) : (
              <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>—</span>
            )}
          </div>
        ) : (
          <TagChipsInput
            value={styleKeywords}
            onChange={(next) => handleFieldChange("communication_style", next)}
            placeholder="e.g. clipped, concise, stripped of flowery metaphors, clinical, sarcastic..."
            accentVariant="cyan"
            suggestions={styleSuggestions}
          />
        )}
      </div>

      {/* Voice & Dialogue Anchors */}
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.82rem", fontWeight: 600, color: "var(--text-primary)" }}>
              <MessageSquare size={14} color="var(--accent-cyan)" /> Dialogue &amp; Action Anchors ({anchors.length})
            </div>
            {!readOnly && (
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                Few-shot examples teaching the model the character&apos;s exact cadence, vocabulary, and body language
              </div>
            )}
          </div>
          {!readOnly && (
            <button
              type="button"
              className="btn"
              style={{ padding: "4px 10px", fontSize: "0.74rem", display: "flex", alignItems: "center", gap: 4 }}
              onClick={handleAddAnchor}
            >
              <Plus size={12} /> Add Anchor
            </button>
          )}
        </div>

        {anchors.length === 0 ? (
          <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", fontStyle: "italic", padding: "8px 0" }}>
            {readOnly ? "—" : "No voice anchors specified. Anchors provide few-shot exemplar dialogue to guide model generations."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {anchors.map((va, idx) => (
              <div
                key={idx}
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
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <ClickToEditField
                      label="Context / Trigger Situation"
                      value={va.context}
                      readOnly={readOnly}
                      placeholder="e.g. Calm / Banter, Cornered / Hostile, Vulnerable..."
                      onChange={(val) => handleUpdateAnchor(idx, { context: val })}
                    />
                  </div>
                  {!readOnly && (
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: "4px 8px", color: "var(--accent-rose)", marginTop: 20 }}
                      title="Delete anchor"
                      onClick={() => handleRemoveAnchor(idx)}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>

                <ClickToEditField
                  label="Sample In-Character Action & Dialogue"
                  value={va.snippet}
                  readOnly={readOnly}
                  multiline
                  rows={2}
                  placeholder="*Action in italics.* &quot;Spoken dialogue in quotes.&quot;"
                  onChange={(val) => handleUpdateAnchor(idx, { snippet: val })}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
