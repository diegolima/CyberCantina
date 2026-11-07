import React from "react";
import { AlertTriangle, Check } from "lucide-react";
import { PromptRoleMeta } from "./promptRoleDefinitions";

export interface PromptRoleCardProps {
  role: PromptRoleMeta;
  isSelected: boolean;
  onSelect: () => void;
  promptCount: number;
  missingTokenCount: number;
  unsavedCount: number;
}

export const PromptRoleCard: React.FC<PromptRoleCardProps> = ({
  role,
  isSelected,
  onSelect,
  promptCount,
  missingTokenCount,
  unsavedCount,
}) => {
  const Icon = role.icon;

  return (
    <button
      type="button"
      role="tab"
      aria-selected={isSelected}
      title={`${role.title} (${role.subtitle})\n${role.description}`}
      className={`prompt-role-card ${isSelected ? "selected" : ""}`}
      style={
        {
          "--card-accent-color": role.accent,
        } as React.CSSProperties
      }
      onClick={onSelect}
    >
      {/* Background Watermark Icon */}
      <div className="prompt-role-watermark">
        <Icon size={76} strokeWidth={1.4} />
      </div>

      {/* Top Header: Icon + Titles */}
      <div className="prompt-role-header">
        <div className="prompt-role-icon-box">
          <Icon size={18} />
        </div>
        <div className="prompt-role-title-block">
          <div className="prompt-role-title">{role.title}</div>
          <div className="prompt-role-subtitle">{role.subtitle}</div>
        </div>
      </div>

      {/* Bottom Metrics Shelf */}
      <div className="prompt-role-footer">
        <div className="prompt-role-badges">
          <span className="prompt-role-count-pill">
            {promptCount} {promptCount === 1 ? "Prompt" : "Prompts"}
          </span>

          {missingTokenCount > 0 ? (
            <span
              className="prompt-role-health-badge warning"
              title={`${missingTokenCount} prompt(s) missing required XML/schema tokens`}
            >
              <AlertTriangle size={12} />
              <span>{missingTokenCount} warning</span>
            </span>
          ) : (
            <span className="prompt-role-health-badge valid" title="All prompts contain required tokens">
              <Check size={12} />
              <span>Valid</span>
            </span>
          )}

          {unsavedCount > 0 && (
            <span
              className="prompt-role-unsaved-pill"
              title={`${unsavedCount} prompt(s) have unsaved changes`}
            >
              {unsavedCount} unsaved
            </span>
          )}
        </div>
      </div>

      {/* Active Indicator Arrow/Accent Bar */}
      {isSelected && <div className="prompt-role-active-indicator" />}
    </button>
  );
};
