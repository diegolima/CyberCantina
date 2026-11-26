import React, { useId, useRef, useState } from "react";
import {
  AlertCircle,
  Bookmark,
  Compass,
  Download,
  Eye,
  EyeOff,
  FolderKanban,
  GitBranch,
  Lock,
  X,
} from "lucide-react";
import { api } from "../api";
import { useModalDialog } from "../hooks/useModalDialog";
import { CampaignRecord, CampaignTimelineScope } from "../types";
import { validateExportPassword } from "../utils/importExportLogic";

export interface ExportCampaignModalProps {
  campaign: CampaignRecord;
  onClose: () => void;
}

export const ExportCampaignModal: React.FC<ExportCampaignModalProps> = ({
  campaign,
  onClose,
}) => {
  const [timelineScope, setTimelineScope] = useState<CampaignTimelineScope>("full");
  const [stripBookmarkComments, setStripBookmarkComments] = useState(false);
  const [includeWorldMedia, setIncludeWorldMedia] = useState(true);
  const [includeVideos, setIncludeVideos] = useState(false);
  const [includeGmChat, setIncludeGmChat] = useState(false);
  const [passwordEnabled, setPasswordEnabled] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  useModalDialog({
    isOpen: true,
    onClose,
    disableEscape: exporting,
    dialogRef,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const pwErr = validateExportPassword(passwordEnabled, password, confirmPassword);
    if (pwErr) {
      setError(pwErr);
      return;
    }
    setExporting(true);
    setError("");
    try {
      await api.exportCampaign(campaign.id, {
        timeline_scope: timelineScope,
        strip_bookmark_comments: stripBookmarkComments,
        include_world_media: includeWorldMedia,
        include_videos: includeVideos,
        include_gm_chat: includeGmChat,
        password: passwordEnabled ? password : null,
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="modal-panel"
        style={{ maxWidth: 540 }}
      >
        <div className="modal-header">
          <span
            id={titleId}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              color: "var(--accent-cyan)",
            }}
          >
            <FolderKanban size={18} />
            Export Running Campaign (.zcc)
          </span>
          <button type="button" className="btn" onClick={onClose} disabled={exporting}>
            <X size={15} />
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="modal-body"
          style={{ display: "flex", flexDirection: "column", gap: 14 }}
        >
          {error && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                borderRadius: 6,
                background: "rgba(244, 63, 94, 0.12)",
                border: "1px solid rgba(244, 63, 94, 0.35)",
                color: "var(--accent-rose)",
                fontSize: "0.82rem",
              }}
            >
              <AlertCircle size={15} />
              <span>{error}</span>
            </div>
          )}

          <div
            style={{
              padding: "10px 12px",
              borderRadius: 8,
              background: "var(--bg-card)",
              border: "1px solid var(--border-subtle)",
              fontSize: "0.84rem",
            }}
          >
            <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>{campaign.name}</div>
            <div style={{ fontSize: "0.77rem", color: "var(--text-secondary)", marginTop: 2 }}>
              Bundles base world, characters, persona snapshot, CARE states, episodic summaries, memories, bookmarks, and spatial overrides.
            </div>
          </div>

          {/* Timeline Scope */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: "0.82rem",
                fontWeight: 600,
                color: "var(--text-primary)",
              }}
            >
              <GitBranch size={14} color="var(--accent-cyan)" />
              Timeline Scope
            </div>
            <label
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                padding: "8px 10px",
                borderRadius: 6,
                cursor: "pointer",
                border:
                  timelineScope === "full"
                    ? "1px solid rgba(56, 189, 248, 0.45)"
                    : "1px solid var(--border-subtle)",
                background:
                  timelineScope === "full" ? "rgba(56, 189, 248, 0.08)" : "var(--bg-card)",
              }}
            >
              <input
                type="radio"
                name="campaign-timeline-scope"
                checked={timelineScope === "full"}
                onChange={() => setTimelineScope("full")}
                style={{ marginTop: 3 }}
              />
              <div>
                <div style={{ fontSize: "0.83rem", fontWeight: 600 }}>Full timelines</div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                  Includes all alternative timelines, branches, and unfollowed swipes. Best for backups and migrations.
                </div>
              </div>
            </label>
            <label
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                padding: "8px 10px",
                borderRadius: 6,
                cursor: "pointer",
                border:
                  timelineScope === "active"
                    ? "1px solid rgba(56, 189, 248, 0.45)"
                    : "1px solid var(--border-subtle)",
                background:
                  timelineScope === "active" ? "rgba(56, 189, 248, 0.08)" : "var(--bg-card)",
              }}
            >
              <input
                type="radio"
                name="campaign-timeline-scope"
                checked={timelineScope === "active"}
                onChange={() => setTimelineScope("active")}
                style={{ marginTop: 3 }}
              />
              <div>
                <div style={{ fontSize: "0.83rem", fontWeight: 600 }}>Currently active timeline only</div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                  Prunes unfollowed swipes, alternate branches, and branch-only summaries/memories/characters.
                </div>
              </div>
            </label>
          </div>

          {/* Privacy & Media Options */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              padding: "10px 12px",
              borderRadius: 8,
              background: "var(--bg-card)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer", fontSize: "0.82rem" }}>
              <input
                type="checkbox"
                checked={stripBookmarkComments}
                onChange={(e) => setStripBookmarkComments(e.target.checked)}
                style={{ marginTop: 2 }}
              />
              <span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontWeight: 500 }}>
                  <Bookmark size={13} color="var(--accent-violet)" />
                  Strip player-added bookmark comments
                </span>
                <span style={{ display: "block", fontSize: "0.74rem", color: "var(--text-muted)" }}>
                  Clears personal bookmark notes while keeping bookmark pins intact.
                </span>
              </span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "0.82rem" }}>
              <input
                type="checkbox"
                checked={includeWorldMedia}
                onChange={(e) => setIncludeWorldMedia(e.target.checked)}
              />
              <span>Include world scene images</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "0.82rem" }}>
              <input
                type="checkbox"
                checked={includeVideos}
                onChange={(e) => setIncludeVideos(e.target.checked)}
              />
              <span>Include linked videos (larger archive)</span>
            </label>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer", fontSize: "0.82rem" }}>
              <input
                type="checkbox"
                checked={includeGmChat}
                onChange={(e) => setIncludeGmChat(e.target.checked)}
                style={{ marginTop: 2 }}
              />
              <span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontWeight: 500 }}>
                  <Compass size={13} color="var(--accent-violet)" />
                  Include GM conversations
                </span>
                <span style={{ display: "block", fontSize: "0.74rem", color: "var(--text-muted)" }}>
                  Include out-of-character Neuromancer GM Talk history in this archive.
                </span>
              </span>
            </label>
          </div>

          {/* Optional Password Protection */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              padding: "10px 12px",
              borderRadius: 8,
              background: "var(--bg-card)",
              border: passwordEnabled
                ? "1px solid rgba(245, 158, 11, 0.4)"
                : "1px solid var(--border-subtle)",
            }}
          >
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "0.82rem", fontWeight: 500 }}>
              <input
                type="checkbox"
                checked={passwordEnabled}
                onChange={(e) => {
                  setPasswordEnabled(e.target.checked);
                  if (!e.target.checked) {
                    setPassword("");
                    setConfirmPassword("");
                  }
                }}
              />
              <Lock size={13} color="var(--accent-amber)" />
              <span>Password-protect .zcc archive (Argon2id + AES-256-GCM)</span>
            </label>
            {passwordEnabled && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4 }}>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    type={showPassword ? "text" : "password"}
                    className="input"
                    placeholder="Archive password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setShowPassword((v) => !v)}
                    title={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <input
                  type={showPassword ? "text" : "password"}
                  className="input"
                  placeholder="Confirm archive password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
            )}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
            <button type="button" className="btn" onClick={onClose} disabled={exporting}>
              Cancel
            </button>
            <button type="submit" className="btn btn-cyan" disabled={exporting}>
              <Download size={14} />
              {exporting ? "Exporting..." : "Export Campaign (.zcc)"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
