import React, { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

export interface PasswordFieldProps {
  id: string;
  label: string;
  labelHint?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder: string;
  autoComplete: "current-password" | "new-password";
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  required?: boolean;
  resetKey?: string;
}

/**
 * Accessible password input with an inline Show/Hide visibility toggle and ARIA validation bindings.
 */
export const PasswordField: React.FC<PasswordFieldProps> = ({
  id,
  label,
  labelHint,
  value,
  onChange,
  placeholder,
  autoComplete,
  disabled = false,
  invalid = false,
  describedBy,
  required = false,
  resetKey,
}) => {
  const [visible, setVisible] = useState(false);

  // Re-mask password text whenever the parent switches auth modes.
  useEffect(() => {
    setVisible(false);
  }, [resetKey]);

  return (
    <div className="field-group">
      <label htmlFor={id}>
        {label}
        {labelHint && (
          <>
            {" "}
            <span className="form-hint">{labelHint}</span>
          </>
        )}
      </label>
      <div className="field-input-wrap">
        <input
          id={id}
          type={visible ? "text" : "password"}
          className="field-input field-input-with-toggle"
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          autoComplete={autoComplete}
          disabled={disabled}
          required={required}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid && describedBy ? describedBy : undefined}
        />
        <button
          type="button"
          className="field-visibility-btn"
          onClick={() => setVisible((v) => !v)}
          disabled={disabled}
          aria-label={
            visible
              ? `Hide ${label.toLowerCase()}`
              : `Show ${label.toLowerCase()}`
          }
          aria-pressed={visible}
        >
          {visible ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
    </div>
  );
};
