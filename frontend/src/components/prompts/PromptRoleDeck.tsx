import React from "react";
import { PROMPT_ROLES, PromptRoleId } from "./promptRoleDefinitions";
import { PromptRoleCard } from "./PromptRoleCard";

export interface RoleStats {
  promptCount: number;
  missingTokenCount: number;
  unsavedCount: number;
}

export interface PromptRoleDeckProps {
  selectedRoleId: PromptRoleId;
  onSelectRole: (roleId: PromptRoleId) => void;
  stats: Record<PromptRoleId, RoleStats>;
}

export const PromptRoleDeck: React.FC<PromptRoleDeckProps> = ({
  selectedRoleId,
  onSelectRole,
  stats,
}) => {
  return (
    <div className="prompt-role-deck" role="tablist" aria-label="Prompt Roles">
      {PROMPT_ROLES.map((role) => {
        const roleStats = stats[role.id] || {
          promptCount: 0,
          missingTokenCount: 0,
          unsavedCount: 0,
        };

        return (
          <PromptRoleCard
            key={role.id}
            role={role}
            isSelected={selectedRoleId === role.id}
            onSelect={() => onSelectRole(role.id)}
            promptCount={roleStats.promptCount}
            missingTokenCount={roleStats.missingTokenCount}
            unsavedCount={roleStats.unsavedCount}
          />
        );
      })}
    </div>
  );
};
