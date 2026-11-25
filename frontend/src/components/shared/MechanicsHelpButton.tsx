import React from "react";
import { HelpCircle } from "lucide-react";
import type { MechanicsTopicId } from "../../types";

export interface MechanicsHelpButtonProps {
  topicId: MechanicsTopicId;
  label: string;
  onOpenHelp?: (topicId: MechanicsTopicId) => void;
  className?: string;
  size?: number;
}

/** Subtle contextual help icon button that deep-links to a Game Mechanics guide. */
export const MechanicsHelpButton: React.FC<MechanicsHelpButtonProps> = ({
  topicId,
  label,
  onOpenHelp,
  className,
  size = 13,
}) => {
  if (!onOpenHelp) return null;

  return (
    <button
      type="button"
      className={
        className ? `ui-mechanics-help-btn ${className}` : "ui-mechanics-help-btn"
      }
      aria-label={`Learn about ${label}`}
      title={`Game Mechanics: ${label}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onOpenHelp(topicId);
      }}
    >
      <HelpCircle size={size} />
    </button>
  );
};
