import React from "react";
import { ArrowRight } from "lucide-react";
import { UnsupportedFieldsTab } from "../shared/UnsupportedFieldsTab";
import { DEPRECATED_CHARACTER_KEYS } from "./unsupportedFields";

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
  return (
    <UnsupportedFieldsTab
      isActive={isActive}
      unsupportedFields={unsupportedFields}
      stagedDeletes={stagedDeletes}
      readOnly={readOnly}
      accentColor="amber"
      deprecatedKeys={DEPRECATED_CHARACTER_KEYS}
      saveActionLabel="Save Changes"
      onStageDelete={onStageDelete}
      onUndoDelete={onUndoDelete}
      renderFieldActions={(key, value) => (
        <>
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
        </>
      )}
    />
  );
};
