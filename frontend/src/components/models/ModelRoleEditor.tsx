import React, { useEffect, useState } from "react";
import { DisclosureSection } from "./DisclosureSection";
import { ModelRole, TEMPERATURE_SPEC, maxTokensSpec } from "./modelLimits";
import { ModelPicker } from "./ModelPicker";
import { RoleSelection } from "./modelPickerLogic";
import { NumericSliderField } from "./NumericSliderField";
import { formatValue } from "./sliderMath";

export interface ModelRoleEditorProps {
  role: ModelRole;
  title: string;
  subtitle?: string;
  accent: string;
  selection: RoleSelection;
  onSelection: (next: RoleSelection) => void;
  temperature: number;
  onTemperature: (v: number) => void;
  maxTokens: number;
  onMaxTokens: (v: number) => void;
  /** Hint shown at the right of the header (e.g. the system default). */
  headerHint?: React.ReactNode;
  /** When set, provider+model are controlled elsewhere (e.g. Clerk mirroring the Actor). */
  selectionLockedNote?: string;
  /** Rendered above the provider/model pickers (e.g. the Clerk "mirror the Actor" checkbox). */
  topSlot?: React.ReactNode;
  /** Rendered directly below the provider/model pickers (e.g. Clerk "Run on CPU" checkbox). */
  afterPickerSlot?: React.ReactNode;
  disabled?: boolean;
  /** Bubbles the number of invalid fields so the parent can block Save. */
  onInvalidChange?: (count: number) => void;
  children?: React.ReactNode;
}

/** One model role (Actor or Clerk): provider -> model cascade, plus collapsed sampling parameters. */
export const ModelRoleEditor: React.FC<ModelRoleEditorProps> = ({
  role,
  title,
  subtitle,
  accent,
  selection,
  onSelection,
  temperature,
  onTemperature,
  maxTokens,
  onMaxTokens,
  headerHint,
  selectionLockedNote,
  topSlot,
  afterPickerSlot,
  disabled,
  onInvalidChange,
  children,
}) => {
  const [tempValid, setTempValid] = useState(true);
  const [tokensValid, setTokensValid] = useState(true);
  const invalid = (tempValid ? 0 : 1) + (tokensValid ? 0 : 1);

  useEffect(() => {
    onInvalidChange?.(invalid);
  }, [invalid, onInvalidChange]);

  return (
    <div className="model-role-card">
      <div className="model-role-header">
        <div>
          <div className="model-role-title" style={{ color: accent }}>
            {title}
          </div>
          {subtitle && <div className="model-role-subtitle">{subtitle}</div>}
        </div>
        {headerHint && <div className="model-role-hint">{headerHint}</div>}
      </div>

      {topSlot}
      {selectionLockedNote ? (
        <div className="provider-note">{selectionLockedNote}</div>
      ) : (
        <>
          <ModelPicker
            role={role}
            value={selection}
            onChange={onSelection}
            modelKind="chat"
            disabled={disabled}
          />
          {afterPickerSlot}
        </>
      )}

      <DisclosureSection
        title="Advanced generation parameters"
        summary={`Temperature ${formatValue(temperature, 2)} · ${maxTokens} max tokens`}
        invalidCount={invalid}
      >
        <div className="grid-2">
          <NumericSliderField
            label="Temperature"
            value={temperature}
            spec={TEMPERATURE_SPEC}
            disabled={disabled}
            onCommit={onTemperature}
            onValidityChange={setTempValid}
          />
          <NumericSliderField
            label="Max tokens"
            value={maxTokens}
            spec={maxTokensSpec(role)}
            unit="tokens"
            disabled={disabled}
            onCommit={onMaxTokens}
            onValidityChange={setTokensValid}
          />
        </div>
      </DisclosureSection>
      {children}
    </div>
  );
};
