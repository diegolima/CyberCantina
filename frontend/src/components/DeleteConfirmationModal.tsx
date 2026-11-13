import React from "react";
import { AlertTriangle, X } from "lucide-react";
import type {
  CampaignRecord,
  CharacterRecord,
  PersonaRecord,
  WorldRecord,
} from "../types";

export type DeleteTarget =
  | { kind: "campaign"; campaign: CampaignRecord }
  | {
      kind: "character";
      character: CharacterRecord;
      campaignsUsing: CampaignRecord[];
    }
  | {
      kind: "world";
      world: WorldRecord;
      campaignsUsing: CampaignRecord[];
    }
  | {
      kind: "persona";
      persona: PersonaRecord;
      campaignsUsing: CampaignRecord[];
    };

export interface DeleteConfirmationModalProps {
  deleteTarget: DeleteTarget | null;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export const DeleteConfirmationModal: React.FC<DeleteConfirmationModalProps> = ({
  deleteTarget,
  isDeleting,
  onCancel,
  onConfirm,
}) => {
  if (!deleteTarget) return null;
  const setDeleteTarget = (_: null) => onCancel();
  const handleConfirmDelete = onConfirm;

  return (
        <div className="modal-backdrop">
          <div className="modal-panel" style={{ width: "min(480px, 92vw)" }}>
            <div className="modal-header">
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  color: "#fda4af",
                }}
              >
                <AlertTriangle size={18} />
                {deleteTarget.kind === "campaign"
                  ? "Delete Campaign & Timeline"
                  : deleteTarget.kind === "world"
                  ? "Remove World"
                  : deleteTarget.kind === "persona"
                  ? "Delete User Persona"
                  : "Remove Character"}
              </span>
              <button
                type="button"
                className="btn"
                onClick={() => setDeleteTarget(null)}
                disabled={isDeleting}
              >
                <X size={15} />
              </button>
            </div>

            <div className="modal-body" style={{ fontSize: "0.86rem", lineHeight: 1.55 }}>
              {deleteTarget.kind === "campaign" ? (
                <p>
                  Are you sure you want to delete campaign{" "}
                  <strong style={{ color: "var(--accent-amber)" }}>
                    "{deleteTarget.campaign.name}"
                  </strong>
                  ? This will permanently remove the campaign and its entire
                  timeline branch tree, episodic memories, and improvised
                  locations.
                </p>
              ) : deleteTarget.kind === "world" ? (
                <>
                  <p>
                    Are you sure you want to remove world{" "}
                    <strong style={{ color: "var(--accent-cyan)" }}>
                      "{deleteTarget.world.name}"
                    </strong>
                    ?
                  </p>
                  {deleteTarget.campaignsUsing.length > 0 ? (
                    <div
                      className="cog-step"
                      style={{
                        borderColor: "rgba(34, 211, 238, 0.4)",
                        fontSize: "0.8rem",
                      }}
                    >
                      <strong style={{ color: "var(--accent-cyan)" }}>
                        Used in {deleteTarget.campaignsUsing.length} active
                        campaign(s):
                      </strong>{" "}
                      {deleteTarget.campaignsUsing.map((c) => c.name).join(", ")}
                      <div style={{ marginTop: 4, color: "var(--text-secondary)" }}>
                        This world will be marked <em>pending deletion</em> and
                        hidden from your world list immediately, while its
                        spatial graph and lore remain available to those running
                        campaigns until they are removed.
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                      This world is not referenced by any running campaigns and
                      will be permanently pruned.
                    </div>
                  )}
                </>
              ) : deleteTarget.kind === "persona" ? (
                <>
                  <p>
                    Are you sure you want to delete persona{" "}
                    <strong style={{ color: "var(--accent-emerald)" }}>
                      "{deleteTarget.persona.name}"
                    </strong>
                    ?
                  </p>
                  {deleteTarget.campaignsUsing.length > 0 ? (
                    <div
                      className="cog-step"
                      style={{
                        borderColor: "rgba(16, 185, 129, 0.4)",
                        fontSize: "0.8rem",
                      }}
                    >
                      <strong style={{ color: "var(--accent-emerald)" }}>
                        Referenced by {deleteTarget.campaignsUsing.length} active
                        campaign(s):
                      </strong>{" "}
                      {deleteTarget.campaignsUsing.map((c) => c.name).join(", ")}
                      <div style={{ marginTop: 4, color: "var(--text-secondary)" }}>
                        Active campaigns will continue unaffected because each campaign
                        maintains its own frozen persona snapshot.
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                      This persona template will be permanently removed.
                    </div>
                  )}
                </>
              ) : (
                <>
                  <p>
                    Are you sure you want to remove character{" "}
                    <strong style={{ color: "var(--accent-amber)" }}>
                      "{deleteTarget.character.name}"
                    </strong>
                    ?
                  </p>
                  {deleteTarget.campaignsUsing.length > 0 ? (
                    <div
                      className="cog-step"
                      style={{
                        borderColor: "rgba(245, 158, 11, 0.4)",
                        fontSize: "0.8rem",
                      }}
                    >
                      <strong style={{ color: "var(--accent-amber)" }}>
                        Used in {deleteTarget.campaignsUsing.length} active
                        campaign(s):
                      </strong>{" "}
                      {deleteTarget.campaignsUsing.map((c) => c.name).join(", ")}
                      <div style={{ marginTop: 4, color: "var(--text-secondary)" }}>
                        This character will be marked <em>pending deletion</em>{" "}
                        and hidden from your character list immediately, while
                        remaining available to those running campaigns until
                        they are removed.
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                      This character is not referenced by any running campaigns
                      and will be permanently pruned.
                    </div>
                  )}
                </>
              )}

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 10,
                  marginTop: 8,
                }}
              >
                <button
                  type="button"
                  className="btn"
                  onClick={() => setDeleteTarget(null)}
                  disabled={isDeleting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={handleConfirmDelete}
                  disabled={isDeleting}
                >
                  {isDeleting
                    ? "Removing..."
                    : deleteTarget.kind === "campaign"
                    ? "Delete Campaign"
                    : deleteTarget.kind === "world"
                    ? "Remove World"
                    : deleteTarget.kind === "persona"
                    ? "Delete Persona"
                    : "Remove Character"}
                </button>
              </div>
            </div>
          </div>
        </div>
  );
};
