import React, { useState } from "react";
import { AlertTriangle, ArrowRight, Check, Copy, Trash2, Undo2 } from "lucide-react";
import {
  formatUnsupportedValueText,
  isDeprecatedLegacyKey,
} from "./unsupportedFields";

export interface CharacterUnsupportedTabProps {
  isActive: boolean;
  unsupportedFields: Record<string, unknown>;
  stagedDeletes: Set<string>;
  characterBio: string;
  readOnly?: boolean;
  onStageDelete: (key: string) => void;
  onUndoDelete: (key: string) => void;
  onCopyLegacyPhysicalToBio: (text: string, deleteAfter: boolean) => void;
  onMoveLegacyModificationsToFeatures: (mods: unknown) => void;
}

function renderReadOnlyValue(val: unknown): React.ReactNode {
  if (typeof val === "string") {
    const lines = Math.min(8, Math.max(2, val.split("\n").length));
    return (
      <textarea
        className="field-input"
        readOnly
        rows={lines}
        value={val}
        style={{
          resize: "vertical",
          background: "var(--bg-deep)",
          color: "var(--text-primary)",
          cursor: "text",
          fontFamily: "inherit",
        }}
      />
    );
  }
  if (Array.isArray(val) && val.every((item) => typeof item === "string")) {
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {(val as string[]).map((chip, idx) => (
          <span
            key={`${chip}-${idx}`}
            style={{
              fontSize: "0.78rem",
              padding: "3px 9px",
              borderRadius: 999,
              background: "var(--bg-deep)",
              border: "1px solid var(--border-subtle)",
              color: "var(--text-primary)",
            }}
          >
            {chip}
          </span>
        ))}
      </div>
    );
  }
  return (
    <pre
      style={{
        margin: 0,
        padding: "8px 10px",
        borderRadius: 6,
        background: "var(--bg-deep)",
        border: "1px solid var(--border-subtle)",
        color: "var(--text-primary)",
        fontSize: "0.76rem",
        overflowX: "auto",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {formatUnsupportedValueText(val)}
    </pre>
  );
}

export const CharacterUnsupportedTab: React.FC<CharacterUnsupportedTabProps> = ({
  isActive,
  unsupportedFields,
  stagedDeletes,
  characterBio,
  readOnly = false,
  onStageDelete,
  onUndoDelete,
  onCopyLegacyPhysicalToBio,
  onMoveLegacyModificationsToFeatures,
}) => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const entries = Object.entries(unsupportedFields);

  const handleCopy = async (key: string, val: unknown) => {
    const text = formatUnsupportedValueText(val);
    try {
      await navigator.clipboard?.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1500);
    } catch {
      // Clipboard unavailable in non-browser/restricted context
    }
  };

  return (
    <div
      style={{
        display: isActive ? "flex" : "none",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          padding: "10px 12px",
          borderRadius: 6,
          background: "rgba(245, 158, 11, 0.08)",
          border: "1px solid rgba(245, 158, 11, 0.3)",
          fontSize: "0.8rem",
          color: "var(--text-secondary)",
          lineHeight: 1.45,
        }}
      >
        <AlertTriangle
          size={16}
          color="var(--accent-amber)"
          style={{ flexShrink: 0, marginTop: 2 }}
        />
        <div>
          These fields come from an older CyberCantina schema or a newer version not supported by
          this server. They are preserved on save and export, but are <strong>not</strong>{" "}
          included in AI roleplay context. Copy any details you want into supported tabs, or
          delete fields when ready.
        </div>
      </div>

      {entries.map(([key, value]) => {
        const isDeprecated = isDeprecatedLegacyKey(key);
        const isDeleted = stagedDeletes.has(key);
        const badgeLabel = isDeprecated ? "Deprecated" : "Unsupported";
        const badgeColor = isDeprecated ? "var(--accent-amber)" : "var(--accent-cyan)";
        const badgeBg = isDeprecated
          ? "rgba(245, 158, 11, 0.14)"
          : "rgba(56, 189, 248, 0.14)";
        const badgeBorder = isDeprecated
          ? "rgba(245, 158, 11, 0.35)"
          : "rgba(56, 189, 248, 0.35)";

        return (
          <div
            key={key}
            style={{
              padding: 12,
              borderRadius: 8,
              background: "var(--bg-card)",
              border: isDeleted
                ? "1px dashed rgba(244, 63, 94, 0.45)"
                : "1px solid var(--border-subtle)",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              opacity: isDeleted ? 0.78 : 1,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <code
                  style={{
                    fontSize: "0.82rem",
                    fontWeight: 600,
                    color: "var(--text-primary)",
                  }}
                >
                  {key}
                </code>
                <span
                  style={{
                    fontSize: "0.7rem",
                    fontWeight: 600,
                    padding: "2px 8px",
                    borderRadius: 999,
                    color: badgeColor,
                    background: badgeBg,
                    border: `1px solid ${badgeBorder}`,
                  }}
                >
                  {badgeLabel}
                </span>
              </div>

              {!readOnly && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  {isDeleted ? (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => onUndoDelete(key)}
                      style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                    >
                      <Undo2 size={13} /> Undo
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => handleCopy(key, value)}
                        title={`Copy ${key} value`}
                        style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                      >
                        {copiedKey === key ? <Check size={13} /> : <Copy size={13} />}
                        {copiedKey === key ? "Copied" : "Copy"}
                      </button>

                      {key === "physical_appearance" && typeof value === "string" && (
                        <>
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => onCopyLegacyPhysicalToBio(value, false)}
                            style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                          >
                            <ArrowRight size={13} />
                            {characterBio.trim() ? "Append to Bio" : "Copy to Bio"}
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => onCopyLegacyPhysicalToBio(value, true)}
                            style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                          >
                            <ArrowRight size={13} />
                            Move to Bio &amp; Delete
                          </button>
                        </>
                      )}

                      {key === "modifications" && Array.isArray(value) && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => onMoveLegacyModificationsToFeatures(value)}
                          style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                        >
                          <ArrowRight size={13} />
                          Move to Distinctive Features &amp; Delete
                        </button>
                      )}

                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => onStageDelete(key)}
                        aria-label={`Delete legacy or unsupported field ${key}`}
                        title={`Mark '${key}' for deletion on Save`}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          color: "var(--accent-rose)",
                          borderColor: "rgba(244, 63, 94, 0.35)",
                        }}
                      >
                        <Trash2 size={13} /> Delete
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {isDeleted ? (
              <div style={{ fontSize: "0.78rem", color: "#fda4af" }}>
                Marked for deletion — click <strong>Save Changes</strong> to remove permanently, or{" "}
                <strong>Undo</strong> to keep.
              </div>
            ) : (
              renderReadOnlyValue(value)
            )}
          </div>
        );
      })}
    </div>
  );
};
