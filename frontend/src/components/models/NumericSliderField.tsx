import React, { useEffect, useId, useState } from "react";
import {
  SliderSpec,
  formatValue,
  isOutsideTrack,
  parseDraft,
  positionToValue,
  valueToPosition,
  clamp,
  roundTo,
} from "./sliderMath";

const POSITION_RESOLUTION = 1000;

export interface NumericSliderFieldProps {
  label: string;
  /** Committed value. */
  value: number;
  /** Never called with NaN or a value outside the hard bounds. */
  onCommit: (value: number) => void;
  spec: SliderSpec;
  unit?: string;
  disabled?: boolean;
  /** Reports whether the text currently typed is committable (for form-level validation). */
  onValidityChange?: (valid: boolean) => void;
}

/**
 * Slider with notches plus a typed numeric input that stay in sync.
 *
 * The input holds a local draft string, so partial text ("0.") is allowed while typing; valid text
 * is committed live (the slider follows), invalid text is flagged and reverted on blur. The thumb
 * clamps to the track ends for typed values beyond the track, and a "Custom" badge explains why.
 */
export const NumericSliderField: React.FC<NumericSliderFieldProps> = ({
  label,
  value,
  onCommit,
  spec,
  unit,
  disabled,
  onValidityChange,
}) => {
  const id = useId();
  const [draft, setDraft] = useState(formatValue(value, spec.precision));
  const [focused, setFocused] = useState(false);
  const parsed = parseDraft(draft, spec);
  const valid = parsed !== null;

  useEffect(() => {
    if (!focused) setDraft(formatValue(value, spec.precision));
  }, [value, focused, spec.precision]);

  useEffect(() => {
    onValidityChange?.(valid);
  }, [valid, onValidityChange]);

  const position = Math.round(valueToPosition(value, spec) * POSITION_RESOLUTION);
  const outside = isOutsideTrack(value, spec);
  const activeNotch = spec.notches.find((n) => n.value === value);

  const handleText = (text: string) => {
    setDraft(text);
    const next = parseDraft(text, spec);
    if (next !== null && next !== value) onCommit(next);
  };

  const handleBlur = () => {
    setFocused(false);
    const next = parseDraft(draft, spec);
    if (next === null) {
      setDraft(formatValue(value, spec.precision));
    } else {
      const bounded = roundTo(clamp(next, spec.hardMin, spec.hardMax), spec.precision);
      setDraft(formatValue(bounded, spec.precision));
      if (bounded !== value) onCommit(bounded);
    }
  };

  const valueText = `${formatValue(value, spec.precision)}${unit ? ` ${unit}` : ""}${
    activeNotch ? `, ${activeNotch.label}` : ""
  }`;

  return (
    <div className="nsf">
      <div className="nsf-header">
        <label className="form-label" htmlFor={`${id}-num`}>
          {label}
        </label>
        {outside && <span className="nsf-custom-badge">Custom: {formatValue(value, spec.precision)}</span>}
        {!outside && activeNotch && <span className="nsf-notch-badge">{activeNotch.label}</span>}
      </div>

      <div className="nsf-controls">
        <div className="nsf-track">
          <input
            type="range"
            className="nsf-range"
            min={0}
            max={POSITION_RESOLUTION}
            step={1}
            value={position}
            disabled={disabled}
            aria-label={label}
            aria-valuetext={valueText}
            onChange={(e) => {
              const next = positionToValue(Number(e.target.value) / POSITION_RESOLUTION, spec);
              if (next !== value) onCommit(next);
            }}
          />
          <div className="nsf-ticks" aria-hidden={false}>
            {spec.notches.map((n) => (
              <button
                key={n.value}
                type="button"
                className={`nsf-tick ${n.value === value ? "active" : ""}`}
                style={{ left: `${valueToPosition(n.value, spec) * 100}%` }}
                disabled={disabled}
                title={`${n.label} (${formatValue(n.value, spec.precision)})`}
                onClick={() => onCommit(n.value)}
              >
                <span className="nsf-tick-mark" />
                <span className="nsf-tick-label">{n.label}</span>
              </button>
            ))}
          </div>
        </div>

        <input
          id={`${id}-num`}
          type="text"
          inputMode="decimal"
          className={`form-input nsf-number ${valid ? "" : "invalid"}`}
          value={draft}
          disabled={disabled}
          aria-invalid={!valid}
          onFocus={() => setFocused(true)}
          onBlur={handleBlur}
          onChange={(e) => handleText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
      </div>
      {!valid && (
        <div className="nsf-error" role="alert">
          Enter a value between {formatValue(spec.hardMin, spec.precision)} and{" "}
          {formatValue(spec.hardMax, spec.precision)}.
        </div>
      )}
    </div>
  );
};
