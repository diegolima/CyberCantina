import React, { useEffect, useState } from "react";
import { Edit3 } from "lucide-react";

export interface ClickToEditFieldProps {
  label?: string;
  readOnlyLabel?: string;
  value: string;
  onChange: (next: string) => void;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  readOnly?: boolean;
  suggestions?: string[];
}

export const ClickToEditField: React.FC<ClickToEditFieldProps> = ({
  label,
  readOnlyLabel,
  value,
  onChange,
  multiline = false,
  rows = 3,
  placeholder = "Click to edit...",
  readOnly = false,
  suggestions,
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!editing) {
      setDraft(value);
    }
  }, [value, editing]);

  const handleCommit = (commitVal?: string) => {
    setEditing(false);
    onChange(commitVal !== undefined ? commitVal : draft);
  };

  const displayLabel = (readOnly && readOnlyLabel) ? readOnlyLabel : label;

  return (
    <div className="field-group">
      {displayLabel && <label>{displayLabel}</label>}
      {editing && !readOnly ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {multiline ? (
            <textarea
              className="field-textarea"
              rows={rows}
              autoFocus
              value={draft}
              placeholder={placeholder}
              onChange={(e) => {
                setDraft(e.target.value);
                onChange(e.target.value);
              }}
              onBlur={() => handleCommit()}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setDraft(value);
                  setEditing(false);
                }
              }}
            />
          ) : (
            <input
              className="field-input"
              autoFocus
              value={draft}
              placeholder={placeholder}
              onChange={(e) => {
                setDraft(e.target.value);
                onChange(e.target.value);
              }}
              onBlur={() => handleCommit()}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCommit();
                if (e.key === "Escape") {
                  setDraft(value);
                  setEditing(false);
                }
              }}
            />
          )}

          {suggestions && suggestions.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5, marginTop: 4 }}>
              <span style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginRight: 2 }}>
                Suggestions:
              </span>
              {suggestions.map((sug) => (
                <button
                  key={sug}
                  type="button"
                  className="btn"
                  style={{
                    padding: "2px 7px",
                    fontSize: "0.68rem",
                    borderRadius: 4,
                    borderStyle: "dashed",
                    background: draft.toLowerCase() === sug.toLowerCase() ? "var(--accent-amber)" : "transparent",
                    color: draft.toLowerCase() === sug.toLowerCase() ? "#000" : "var(--text-secondary)",
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setDraft(sug);
                    onChange(sug);
                  }}
                >
                  + {sug}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div
          className={`editable-field-box ${readOnly ? "read-only" : ""}`}
          onClick={() => {
            if (!readOnly) {
              setDraft(value);
              setEditing(true);
            }
          }}
          style={readOnly ? { cursor: "default" } : undefined}
          title={readOnly ? undefined : "Click to edit field"}
        >
          {!readOnly && (
            <span className="editable-field-hint">
              <Edit3 size={11} /> Click to edit
            </span>
          )}
          {value && value.trim().length > 0 ? (
            value
          ) : (
            <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
              {readOnly ? "—" : placeholder}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
