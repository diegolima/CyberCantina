import React, { useEffect, useId, useState } from "react";
import { SliderSpec, formatValue, parseDraft, clamp } from "./sliderMath";

export interface IntegerFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
  onValidityChange?: (valid: boolean) => void;
  disabled?: boolean;
  hint?: string;
}

/** Integer input with a draft string: never writes NaN, flags out-of-range text, reverts on blur. */
export const IntegerField: React.FC<IntegerFieldProps> = ({
  label,
  value,
  min,
  max,
  onCommit,
  onValidityChange,
  disabled,
  hint,
}) => {
  const id = useId();
  const spec: SliderSpec = {
    hardMin: min,
    hardMax: max,
    trackMin: min,
    trackMax: max,
    step: 1,
    precision: 0,
    scale: "linear",
    notches: [],
  };
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);
  const parsed = parseDraft(draft, spec);
  const valid = parsed !== null;

  useEffect(() => {
    if (!focused) setDraft(String(value));
  }, [value, focused]);
  useEffect(() => {
    onValidityChange?.(valid);
  }, [valid, onValidityChange]);

  return (
    <div className="form-group">
      <label className="form-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        className={`form-input ${valid ? "" : "invalid"}`}
        style={valid ? undefined : { borderColor: "var(--accent-rose)" }}
        value={draft}
        disabled={disabled}
        aria-invalid={!valid}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          if (parsed === null) setDraft(String(value));
          else {
            const bounded = clamp(parsed, min, max);
            setDraft(formatValue(bounded, 0));
            if (bounded !== value) onCommit(bounded);
          }
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          const next = parseDraft(e.target.value, spec);
          if (next !== null && next !== value) onCommit(next);
        }}
      />
      {hint && <div className="form-hint" style={{ fontSize: "0.7rem" }}>{hint}</div>}
      {!valid && (
        <div className="nsf-error" role="alert">
          Enter a whole number between {min} and {max}.
        </div>
      )}
    </div>
  );
};
