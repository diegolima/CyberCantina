import React, { useRef, useState } from "react";
import { X } from "lucide-react";

export interface TagChipsInputProps {
  value: string[];
  onChange: (nextTags: string[]) => void;
  onDraftChange?: (draft: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  maxTags?: number;
  maxTagLength?: number;
  accentVariant?: "cyan" | "amber" | "violet";
  helperText?: string;
  suggestions?: string[];
}

export function normalizeTagList(
  existing: string[],
  rawAdditions: string[],
  maxTags = 20,
  maxTagLength = 64
): string[] {
  const result: string[] = [];
  const seenLower = new Set<string>();

  for (const item of [...existing, ...rawAdditions]) {
    const cleaned = item.replace(/\s+/g, " ").trim().slice(0, maxTagLength);
    if (!cleaned) continue;
    const low = cleaned.toLowerCase();
    if (seenLower.has(low)) continue;
    seenLower.add(low);
    result.push(cleaned);
    if (result.length >= maxTags) break;
  }

  return result;
}

export const TagChipsInput: React.FC<TagChipsInputProps> = ({
  value,
  onChange,
  onDraftChange,
  placeholder = "Add keyword & press Enter...",
  required = true,
  disabled = false,
  maxTags = 20,
  maxTagLength = 64,
  accentVariant = "cyan",
  helperText,
  suggestions,
}) => {
  const [draft, setDraft] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const updateDraft = (next: string) => {
    setDraft(next);
    onDraftChange?.(next);
  };

  const commitRawString = (raw: string) => {
    const parts = raw
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) {
      updateDraft("");
      return;
    }
    const merged = normalizeTagList(value, parts, maxTags, maxTagLength);
    if (merged.length !== value.length || merged.some((t, i) => t !== value[i])) {
      onChange(merged);
    }
    updateDraft("");
  };

  const removeAt = (idx: number) => {
    if (disabled) return;
    const next = value.filter((_, i) => i !== idx);
    onChange(next);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;

    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      e.stopPropagation();
      if (draft.trim()) {
        commitRawString(draft);
      }
      return;
    }

    if (e.key === "Backspace" && draft === "" && value.length > 0 && !disabled) {
      e.preventDefault();
      removeAt(value.length - 1);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (text && /[,;\n]/.test(text)) {
      e.preventDefault();
      commitRawString(`${draft},${text}`);
    }
  };

  const handleBlur = () => {
    setIsFocused(false);
    if (draft.trim()) {
      commitRawString(draft);
    }
  };

  const isMissingRequired = required && value.length === 0 && !draft.trim();

  return (
    <div className="tag-chips-field-wrap">
      <div
        className={[
          "tag-chips-box",
          `tag-chips-box--${accentVariant}`,
          isFocused ? "tag-chips-box--focused" : "",
          isMissingRequired ? "tag-chips-box--invalid" : "",
          disabled ? "tag-chips-box--disabled" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={() => {
          if (!disabled) inputRef.current?.focus();
        }}
      >
        {value.map((tag, idx) => (
          <span
            key={`${tag.toLowerCase()}-${idx}`}
            className={`tag-chip-pill tag-chip-pill--${accentVariant}`}
          >
            <span className="tag-chip-text">{tag}</span>
            {!disabled && (
              <button
                type="button"
                className="tag-chip-remove"
                aria-label={`Remove keyword ${tag}`}
                title={`Remove "${tag}"`}
                onMouseDown={(e) => {
                  // Prevent input blur before click removes chip
                  e.preventDefault();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  removeAt(idx);
                }}
              >
                <X size={11} />
              </button>
            )}
          </span>
        ))}
        {!disabled && value.length < maxTags && (
          <input
            ref={inputRef}
            type="text"
            className="tag-chips-inline-input"
            value={draft}
            disabled={disabled}
            placeholder={value.length === 0 ? placeholder : "Add keyword..."}
            onFocus={() => setIsFocused(true)}
            onBlur={handleBlur}
            onChange={(e) => updateDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
          />
        )}
      </div>

      {suggestions && suggestions.length > 0 && (isFocused || draft.trim().length > 0) && !disabled && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4, marginTop: 4 }}>
          <span style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginRight: 2 }}>
            Suggestions:
          </span>
          {suggestions
            .filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()))
            .map((sug) => (
              <button
                key={sug}
                type="button"
                className="btn"
                style={{
                  padding: "1px 6px",
                  fontSize: "0.68rem",
                  borderRadius: 4,
                  borderStyle: "dashed",
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  commitRawString(sug);
                  inputRef.current?.focus();
                }}
              >
                + {sug}
              </button>
            ))}
        </div>
      )}

      {isMissingRequired ? (
        <div className="tag-chips-validation-hint">
          At least 1 trigger keyword is required (type &amp; press Enter or comma).
        </div>
      ) : helperText ? (
        <div className="tag-chips-helper-hint">{helperText}</div>
      ) : null}
    </div>
  );
};
