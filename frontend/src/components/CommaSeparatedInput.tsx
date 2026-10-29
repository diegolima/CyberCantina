import React, { useEffect, useState } from "react";

export interface CommaSeparatedInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> {
  value: string[];
  onChange: (values: string[]) => void;
}

/**
 * An input component for comma-separated string arrays that allows natural typing
 * of commas and spaces without immediately stripping or reformatting text on each keystroke.
 */
export const CommaSeparatedInput: React.FC<CommaSeparatedInputProps> = ({
  value,
  onChange,
  onFocus,
  onBlur,
  ...props
}) => {
  const [draft, setDraft] = useState(() => value.join(", "));
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setDraft(value.join(", "));
    }
  }, [value, isFocused]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setDraft(raw);
    const parsed = raw
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    onChange(parsed);
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    setIsFocused(true);
    if (onFocus) onFocus(e);
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    setIsFocused(false);
    const parsed = draft
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    onChange(parsed);
    setDraft(parsed.join(", "));
    if (onBlur) onBlur(e);
  };

  return (
    <input
      {...props}
      type="text"
      value={draft}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
    />
  );
};
