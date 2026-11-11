import React from "react";
import { WorldRecord } from "../../types";
import { ClickToEditField } from "../EntityEditorModals";
import { TagChipsInput } from "../TagChipsInput";

export interface CharacterBaseData {
  name: string;
  world_id?: string | null;
  tagline: string;
  character_bio?: string;
  physical_appearance?: string;
  species?: string;
  sex?: string;
  pronouns?: string;
  age?: string;
  initial_message?: string;
  creator?: string;
  creator_notes?: string;
  tags?: string[];
}

export interface CharacterBaseTabProps {
  data: CharacterBaseData;
  onChange?: (updated: Partial<CharacterBaseData>) => void;
  readOnly?: boolean;
  worlds?: WorldRecord[];
}

export const CharacterBaseTab: React.FC<CharacterBaseTabProps> = ({
  data,
  onChange,
  readOnly = false,
  worlds = [],
}) => {
  const bioValue = data.character_bio ?? data.physical_appearance ?? "";
  const speciesValue = data.species ?? "Human";
  const sexValue = data.sex ?? "";
  const pronounsValue = data.pronouns ?? "";
  const ageValue = data.age ?? "";
  const tagsValue = data.tags ?? [];

  const handleFieldChange = <K extends keyof CharacterBaseData>(
    field: K,
    val: CharacterBaseData[K]
  ) => {
    if (readOnly || !onChange) return;
    onChange({ [field]: val });
  };

  const sexShortcuts = ["Male", "Female", "Non-binary", "Other"];
  const pronounShortcuts = ["he/him", "she/her", "they/them", "it/its"];
  const ageShortcuts = ["Unknown", "Ageless", "Early 20s", "Mid 30s"];
  const speciesShortcuts = ["Human", "Cyborg", "Android", "Replicant", "Elf", "Synth"];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Name and World */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <ClickToEditField
          label="Character Name"
          value={data.name}
          readOnly={readOnly}
          onChange={(val) => handleFieldChange("name", val)}
        />

        <div className="field-group">
          <label>Home World Association</label>
          {readOnly ? (
            <div className="editable-field-box read-only" style={{ cursor: "default" }}>
              {worlds.find((w) => w.id === data.world_id)?.name || "Standalone (No specific world)"}
            </div>
          ) : (
            <select
              className="field-select"
              value={data.world_id ?? ""}
              disabled={readOnly}
              onChange={(e) => handleFieldChange("world_id", e.target.value || null)}
            >
              <option value="">Standalone (No specific world)</option>
              {worlds.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.global_rules.genre})
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Evocative Tagline */}
      <ClickToEditField
        label="Evocative Tagline"
        value={data.tagline}
        readOnly={readOnly}
        onChange={(val) => handleFieldChange("tagline", val)}
      />

      {/* Demographics Group: Species, Sex, Pronouns, Age */}
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
        <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--accent-amber)" }}>
          Demographics & Identity
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {/* Species / Heritage */}
          <ClickToEditField
            label="Species / Heritage"
            value={speciesValue}
            placeholder="Click to set species (e.g. Human, Cyborg...)"
            readOnly={readOnly}
            suggestions={speciesShortcuts}
            onChange={(val) => handleFieldChange("species", val)}
          />

          {/* Age */}
          <ClickToEditField
            label="Age"
            value={ageValue}
            placeholder="Click to set age (e.g. 28, Unknown, Ageless...)"
            readOnly={readOnly}
            suggestions={ageShortcuts}
            onChange={(val) => handleFieldChange("age", val)}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {/* Sex */}
          <ClickToEditField
            label="Sex"
            value={sexValue}
            placeholder="Click to set sex (e.g. Male, Female, Other...)"
            readOnly={readOnly}
            suggestions={sexShortcuts}
            onChange={(val) => handleFieldChange("sex", val)}
          />

          {/* Pronouns */}
          <ClickToEditField
            label="Pronouns"
            value={pronounsValue}
            placeholder="Click to set pronouns (e.g. he/him, she/her...)"
            readOnly={readOnly}
            suggestions={pronounShortcuts}
            onChange={(val) => handleFieldChange("pronouns", val)}
          />
        </div>
      </div>

      {/* Character Bio / Concept */}
      <ClickToEditField
        label="Character Bio / High Concept (Role, Background & Reputation)"
        readOnlyLabel="Character Bio"
        value={bioValue}
        readOnly={readOnly}
        multiline
        rows={3}
        placeholder="High-level public background, origins, and core concept..."
        onChange={(val) => {
          handleFieldChange("character_bio", val);
          handleFieldChange("physical_appearance", val);
        }}
      />

      {/* Creator & Tags */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <ClickToEditField
          label="Creator / Author"
          placeholder="Author name, handle, or contact"
          value={data.creator ?? ""}
          readOnly={readOnly}
          onChange={(val) => handleFieldChange("creator", val)}
        />
        <div className="field-group">
          <label>Character Tags</label>
          {readOnly ? (
            <div className="editable-field-box read-only" style={{ cursor: "default", display: "flex", flexWrap: "wrap", gap: 6 }}>
              {tagsValue.length > 0 ? (
                tagsValue.map((t, idx) => (
                  <span
                    key={idx}
                    className="badge"
                    style={{ fontSize: "0.75rem", padding: "2px 8px" }}
                  >
                    #{t}
                  </span>
                ))
              ) : (
                <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>—</span>
              )}
            </div>
          ) : (
            <TagChipsInput
              value={tagsValue}
              onChange={(next) => handleFieldChange("tags", next)}
              placeholder="e.g. cyberpunk, medic, ally (press comma or enter)"
              accentVariant="cyan"
            />
          )}
        </div>
      </div>

      {/* Creator Notes */}
      <ClickToEditField
        label="Creator Notes (Built-in usage notes; viewable in User Notes)"
        readOnlyLabel="Creator Notes"
        value={data.creator_notes ?? ""}
        readOnly={readOnly}
        multiline
        rows={2}
        placeholder="Add roleplay guidance, scenario hints, or recommended model settings..."
        onChange={(val) => handleFieldChange("creator_notes", val)}
      />

      {/* Initial Message */}
      <ClickToEditField
        label="Initial Message (Turn 0 Opening Scene Prose)"
        readOnlyLabel="Opening Scene Message"
        value={data.initial_message ?? ""}
        readOnly={readOnly}
        multiline
        rows={4}
        placeholder="Opening scene narrative and dialogue when starting a campaign..."
        onChange={(val) => handleFieldChange("initial_message", val)}
      />
    </div>
  );
};
