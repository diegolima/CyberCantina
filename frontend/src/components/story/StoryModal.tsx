import React, { useEffect, useMemo, useState } from "react";
import { GitBranch, ScrollText, X } from "lucide-react";
import type { CampaignStateBundle } from "../../types";
import { BranchGraphCanvas } from "./BranchGraphCanvas";
import { countVisibleTimelines } from "./branchGraphLayout";

export type StoryModalTab = "summary" | "timelines";

export interface StoryModalProps {
  isOpen: boolean;
  initialTab?: StoryModalTab;
  onClose: () => void;
  bundle: CampaignStateBundle;
  memoryConfig?: { working_memory_turns: number; episodic_chunk_size: number };
  isMutatingLocked?: boolean;
  /** Optional initial selected node ID for the Branch Graph (helpful in tests). */
  initialSelectedNodeId?: string | null;
  onZoomToTurn: (turnId: string) => void;
  onSwitchTimeline: (tipTurnId: string) => Promise<void> | void;
  onBranchFromTurn: (turnId: string) => Promise<void> | void;
}

export const StoryModal: React.FC<StoryModalProps> = ({
  isOpen,
  initialTab = "summary",
  onClose,
  bundle,
  memoryConfig,
  isMutatingLocked = false,
  initialSelectedNodeId,
  onZoomToTurn,
  onSwitchTimeline,
  onBranchFromTurn,
}) => {
  const [activeTab, setActiveTab] = useState<StoryModalTab>(initialTab);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isOpen, onClose]);

  const timelineCount = useMemo(
    () =>
      countVisibleTimelines(
        bundle.all_turn_nodes,
        bundle.active_branch_turns,
        bundle.campaign.active_leaf_turn_id
      ),
    [
      bundle.all_turn_nodes,
      bundle.active_branch_turns,
      bundle.campaign.active_leaf_turn_id,
    ]
  );

  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      style={{ zIndex: 75 }}
      role="dialog"
      aria-modal="true"
      aria-label="Campaign Story and Timelines"
    >
      <div
        className="modal-panel story-modal-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="story-modal-header">
          <div className="story-modal-title-group">
            <ScrollText size={18} color="var(--accent-amber)" />
            <div>
              <h2 className="story-modal-title">Story</h2>
              <div className="story-modal-subtitle">{bundle.campaign.name}</div>
            </div>
          </div>

          <div className="story-modal-tabs" role="tablist" aria-label="Story categories">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "summary"}
              className={`story-modal-tab ${activeTab === "summary" ? "active" : ""}`}
              onClick={() => setActiveTab("summary")}
            >
              <ScrollText size={14} />
              <span>Summary</span>
              {bundle.episodic_chunks.length > 0 && (
                <span className="story-modal-tab-count">
                  {bundle.episodic_chunks.length}
                </span>
              )}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "timelines"}
              className={`story-modal-tab ${activeTab === "timelines" ? "active" : ""}`}
              onClick={() => setActiveTab("timelines")}
            >
              <GitBranch size={14} />
              <span>Timelines</span>
              {timelineCount > 0 && (
                <span className="story-modal-tab-count">{timelineCount}</span>
              )}
            </button>
          </div>

          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            aria-label="Close Story modal"
            title="Close"
            style={{ padding: "6px" }}
          >
            <X size={16} />
          </button>
        </div>

        <div className="story-modal-body">
          {activeTab === "summary" ? (
            <div className="story-summary-panel" role="tabpanel" aria-label="Story Summary">
              <div className="story-summary-scope-note">
                Showing condensed episodic summaries for the{" "}
                <strong>currently active timeline branch</strong> (
                {bundle.active_branch_turns.length}{" "}
                {bundle.active_branch_turns.length === 1 ? "turn" : "turns"}).
              </div>
              {bundle.episodic_chunks.length === 0 ? (
                <div className="inspector-empty story-summary-empty">
                  No summaries yet.
                  {memoryConfig &&
                    ` Once the story exceeds ${memoryConfig.working_memory_turns} turns, the oldest ${memoryConfig.episodic_chunk_size} are condensed into a summary here.`}
                </div>
              ) : (
                <div className="story-summary-list">
                  {bundle.episodic_chunks.map((chunk) => (
                    <div key={chunk.id} className="story-chunk">
                      <div className="story-chunk-range">
                        Turns {chunk.start_turn_depth}–{chunk.end_turn_depth}
                      </div>
                      {chunk.summary_text}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="story-timelines-panel" role="tabpanel" aria-label="Branch Graph">
              <BranchGraphCanvas
                bundle={bundle}
                isMutatingLocked={isMutatingLocked}
                initialSelectedNodeId={initialSelectedNodeId}
                onZoomToTurn={onZoomToTurn}
                onSwitchTimeline={onSwitchTimeline}
                onBranchFromTurn={onBranchFromTurn}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
