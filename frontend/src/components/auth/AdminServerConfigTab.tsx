import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  HardDrive,
  Play,
  RefreshCw,
  Save,
  Shield,
  Sparkles,
  Trash2,
} from "lucide-react";
import { api } from "../../api";
import {
  AppSettings,
  ChloromancerStatusResponse,
  PurgePreviewResponse,
} from "../../types";

export interface AdminServerConfigTabProps {
  appSettingsForm: AppSettings | null;
  setAppSettingsForm: React.Dispatch<React.SetStateAction<AppSettings | null>>;
  savingSettings: boolean;
  handleSaveSettings: (e: React.FormEvent) => Promise<void> | void;
  setStatusMsg: (msg: string | null) => void;
  setErrorMsg: (msg: string | null) => void;
  onUsersChanged?: () => Promise<void> | void;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatTimestamp(iso?: string | null): string {
  if (!iso) return "—";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleString();
}

export const AdminServerConfigTab: React.FC<AdminServerConfigTabProps> = ({
  appSettingsForm,
  setAppSettingsForm,
  savingSettings,
  handleSaveSettings,
  setStatusMsg,
  setErrorMsg,
  onUsersChanged,
}) => {
  const [chloromancerStatus, setChloromancerStatus] =
    useState<ChloromancerStatusResponse | null>(null);
  const [purgePreview, setPurgePreview] = useState<PurgePreviewResponse | null>(
    null
  );
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [runningPurge, setRunningPurge] = useState(false);
  const [confirmManualPurge, setConfirmManualPurge] = useState(false);

  const loadChloromancerStatus = async () => {
    setLoadingStatus(true);
    try {
      const status = await api.getChloromancerStatus(15);
      setChloromancerStatus(status);
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to load Chloromancer status.");
    } finally {
      setLoadingStatus(false);
    }
  };

  useEffect(() => {
    void loadChloromancerStatus();
  }, []);

  const handlePreviewPurge = async () => {
    setLoadingPreview(true);
    setErrorMsg(null);
    try {
      const preview = await api.getPurgePreview(
        appSettingsForm?.inactive_user_purge_days ?? null
      );
      setPurgePreview(preview);
      setConfirmManualPurge(false);
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to preview purge candidates.");
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleRunCleanupNow = async () => {
    setRunningPurge(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const record = await api.runChloromancerJob("purge_inactive_users");
      setConfirmManualPurge(false);
      await loadChloromancerStatus();
      if (purgePreview) {
        await handlePreviewPurge();
      }
      await onUsersChanged?.();
      if (record.status === "skipped") {
        setStatusMsg(
          String(
            record.details?.reason ||
              "Cleanup skipped: inactive user purge timeout is disabled."
          )
        );
      } else {
        const reclaimed = Number(record.details?.bytes_reclaimed || 0);
        setStatusMsg(
          `Chloromancer cleanup finished: purged ${record.items_affected} user(s)` +
            (reclaimed > 0 ? `, reclaimed ${formatBytes(reclaimed)}` : "") +
            "."
        );
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to run Chloromancer cleanup.");
    } finally {
      setRunningPurge(false);
    }
  };

  if (!appSettingsForm) {
    return (
      <div
        style={{
          padding: 20,
          textAlign: "center",
          fontSize: "0.82rem",
          color: "var(--text-muted)",
        }}
      >
        Loading server configuration...
      </div>
    );
  }

  const allowSelfReg = Boolean(appSettingsForm.allow_self_registration ?? true);
  const quotaEnabled =
    appSettingsForm.user_media_quota_mb != null &&
    appSettingsForm.user_media_quota_mb > 0;
  const purgeEnabled =
    appSettingsForm.inactive_user_purge_days != null &&
    appSettingsForm.inactive_user_purge_days > 0;
  const intervalMinutes = Number(
    appSettingsForm.chloromancer_interval_minutes ?? 60
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <form
        onSubmit={handleSaveSettings}
        style={{ display: "flex", flexDirection: "column", gap: 14 }}
      >
        {/* Self-Registration Card */}
        <div
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 8,
            padding: 14,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Shield size={15} color="var(--accent-cyan)" />
            <span style={{ fontWeight: 600, fontSize: "0.86rem" }}>
              Registration &amp; Access Policy
            </span>
          </div>
          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              cursor: "pointer",
              fontSize: "0.82rem",
            }}
          >
            <input
              type="checkbox"
              checked={allowSelfReg}
              onChange={(e) =>
                setAppSettingsForm((prev) =>
                  prev
                    ? { ...prev, allow_self_registration: e.target.checked }
                    : prev
                )
              }
              style={{ marginTop: 2 }}
            />
            <div>
              <div style={{ fontWeight: 600 }}>Allow self-registration</div>
              <div
                style={{
                  fontSize: "0.74rem",
                  color: "var(--text-secondary)",
                  marginTop: 2,
                }}
              >
                When disabled, public signup is hidden on the sign-in screen and{" "}
                <code>POST /api/auth/register</code> rejects new signups.
                Administrators can still create users manually from the Users
                tab.
              </div>
            </div>
          </label>
        </div>

        {/* Global User Media Quota Card */}
        <div
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 8,
            padding: 14,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <HardDrive size={15} color="var(--accent-amber)" />
            <span style={{ fontWeight: 600, fontSize: "0.86rem" }}>
              Global User Media Quota
            </span>
          </div>

          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              cursor: "pointer",
              fontSize: "0.82rem",
            }}
          >
            <input
              type="checkbox"
              checked={quotaEnabled}
              onChange={(e) =>
                setAppSettingsForm((prev) =>
                  prev
                    ? {
                        ...prev,
                        user_media_quota_mb: e.target.checked
                          ? prev.user_media_quota_mb && prev.user_media_quota_mb > 0
                            ? prev.user_media_quota_mb
                            : 5
                          : null,
                      }
                    : prev
                )
              }
              style={{ marginTop: 2 }}
            />
            <div>
              <div style={{ fontWeight: 600 }}>
                Enforce per-user media storage limit
              </div>
              <div
                style={{
                  fontSize: "0.74rem",
                  color: "var(--text-secondary)",
                  marginTop: 2,
                }}
              >
                Disabled by default. Limits persisted WebP portraits, gallery
                images, and imported archive artwork for standard user accounts
                (administrators are exempt). Over-quota SillyTavern cards fall
                back to text-only distillation with a warning.
              </div>
            </div>
          </label>

          {quotaEnabled && (
            <div
              className="form-group"
              style={{ maxWidth: 240, marginLeft: 24 }}
            >
              <label className="form-label">Quota Limit (MB per user)</label>
              <input
                type="number"
                className="form-input"
                min={0.5}
                max={10240}
                step={0.5}
                value={appSettingsForm.user_media_quota_mb ?? 5}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setAppSettingsForm((prev) =>
                    prev
                      ? {
                          ...prev,
                          user_media_quota_mb:
                            Number.isFinite(val) && val > 0 ? val : 1,
                        }
                      : prev
                  );
                }}
              />
            </div>
          )}
        </div>

        {/* Chloromancer Inactivity Purge Policy Card */}
        <div
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 8,
            padding: 14,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Sparkles size={15} color="var(--accent-violet, #a78bfa)" />
              <span style={{ fontWeight: 600, fontSize: "0.86rem" }}>
                Chloromancer Housekeeping &amp; Inactivity Purge
              </span>
            </div>
            {chloromancerStatus && (
              <span
                className="role-pill"
                style={{
                  fontSize: "0.66rem",
                  borderColor: chloromancerStatus.scheduler_active
                    ? "var(--accent-cyan)"
                    : "var(--border-subtle)",
                  color: chloromancerStatus.scheduler_active
                    ? "var(--accent-cyan)"
                    : "var(--text-muted)",
                }}
              >
                {chloromancerStatus.scheduler_active
                  ? "Scheduler Active"
                  : "Scheduler Stopped"}
              </span>
            )}
          </div>

          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              cursor: "pointer",
              fontSize: "0.82rem",
            }}
          >
            <input
              type="checkbox"
              checked={purgeEnabled}
              onChange={(e) =>
                setAppSettingsForm((prev) =>
                  prev
                    ? {
                        ...prev,
                        inactive_user_purge_days: e.target.checked
                          ? prev.inactive_user_purge_days &&
                            prev.inactive_user_purge_days > 0
                            ? prev.inactive_user_purge_days
                            : 14
                          : null,
                      }
                    : prev
                )
              }
              style={{ marginTop: 2 }}
            />
            <div>
              <div style={{ fontWeight: 600 }}>
                Automatically purge inactive user accounts
              </div>
              <div
                style={{
                  fontSize: "0.74rem",
                  color: "var(--text-secondary)",
                  marginTop: 2,
                }}
              >
                Permanently deletes standard (<code>role = &quot;user&quot;</code>)
                accounts and their characters, worlds, campaigns, and media once
                their last activity exceeds the timeout. Administrator accounts
                are always exempt.
              </div>
            </div>
          </label>

          <div
            className="grid-2"
            style={{ marginLeft: 24, alignItems: "end", gap: 12 }}
          >
            <div className="form-group">
              <label className="form-label">Inactivity Timeout (days)</label>
              <input
                type="number"
                className="form-input"
                min={1}
                max={3650}
                step={1}
                disabled={!purgeEnabled}
                value={appSettingsForm.inactive_user_purge_days ?? ""}
                placeholder="Disabled"
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setAppSettingsForm((prev) =>
                    prev
                      ? {
                          ...prev,
                          inactive_user_purge_days:
                            Number.isFinite(val) && val > 0 ? val : 1,
                        }
                      : prev
                  );
                }}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Scheduler Check Interval</label>
              <select
                className="form-select"
                value={String(intervalMinutes)}
                onChange={(e) => {
                  const mins = parseInt(e.target.value, 10) || 60;
                  setAppSettingsForm((prev) =>
                    prev
                      ? { ...prev, chloromancer_interval_minutes: mins }
                      : prev
                  );
                }}
              >
                <option value="15">Every 15 minutes</option>
                <option value="60">Every 1 hour</option>
                <option value="360">Every 6 hours</option>
                <option value="720">Every 12 hours</option>
                <option value="1440">Every 24 hours</option>
              </select>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              paddingTop: 4,
            }}
          >
            <button
              type="submit"
              className="btn btn-amber"
              disabled={savingSettings}
            >
              <Save size={14} />
              <span>
                {savingSettings ? "Saving..." : "Save Server Configuration"}
              </span>
            </button>
          </div>
        </div>
      </form>

      {/* Dry-run Preview & Manual Execution */}
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-subtle)",
          borderRadius: 8,
          padding: 14,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Clock size={15} color="var(--accent-cyan)" />
            <span style={{ fontWeight: 600, fontSize: "0.86rem" }}>
              Purge Preview &amp; Manual Cleanup
            </span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn"
              onClick={handlePreviewPurge}
              disabled={loadingPreview || !purgeEnabled}
              title={
                purgeEnabled
                  ? "Simulate which accounts would be purged using the current day threshold"
                  : "Enable inactive user purging above to preview candidates"
              }
            >
              <RefreshCw size={13} />
              <span>
                {loadingPreview ? "Scanning..." : "Preview Purge Candidates"}
              </span>
            </button>
            {!confirmManualPurge ? (
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => setConfirmManualPurge(true)}
                disabled={runningPurge}
              >
                <Play size={13} />
                <span>Run Cleanup Now</span>
              </button>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setConfirmManualPurge(false)}
                  disabled={runningPurge}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={handleRunCleanupNow}
                  disabled={runningPurge}
                >
                  <Trash2 size={13} />
                  <span>
                    {runningPurge ? "Purging..." : "Confirm Run Cleanup"}
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>

        {confirmManualPurge && (
          <div
            style={{
              padding: "8px 10px",
              borderRadius: 6,
              background: "rgba(244, 63, 94, 0.08)",
              border: "1px solid rgba(244, 63, 94, 0.35)",
              fontSize: "0.75rem",
              color: "#fda4af",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <AlertTriangle size={14} />
            <span>
              Running cleanup executes against saved server settings (
              {chloromancerStatus?.inactive_user_purge_days
                ? `${chloromancerStatus.inactive_user_purge_days} day timeout`
                : "currently disabled in saved settings"}
              ). Save configuration changes first if needed.
            </span>
          </div>
        )}

        {purgePreview && (
          <div
            style={{
              background: "var(--bg-deep)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 6,
              padding: 10,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 6,
                fontSize: "0.76rem",
                color: "var(--text-secondary)",
              }}
            >
              <span>
                Threshold:{" "}
                <strong>
                  {purgePreview.days_threshold
                    ? `${purgePreview.days_threshold} days`
                    : "Disabled"}
                </strong>
              </span>
              <span>
                Eligible:{" "}
                <strong>{purgePreview.total_users} user(s)</strong> •{" "}
                {purgePreview.total_characters} chars •{" "}
                {purgePreview.total_worlds} worlds •{" "}
                {purgePreview.total_campaigns} campaigns •{" "}
                {formatBytes(purgePreview.total_media_bytes)} media
              </span>
            </div>

            {purgePreview.candidates.length === 0 ? (
              <div
                style={{
                  fontSize: "0.75rem",
                  color: "var(--accent-cyan)",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <CheckCircle2 size={14} />
                <span>
                  No standard user accounts are currently eligible for purge.
                </span>
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  maxHeight: 160,
                  overflowY: "auto",
                }}
              >
                {purgePreview.candidates.map((cand) => (
                  <div
                    key={cand.user_id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 8px",
                      borderRadius: 4,
                      background: "var(--bg-card)",
                      border: "1px solid var(--border-subtle)",
                      fontSize: "0.74rem",
                    }}
                  >
                    <div>
                      <strong>@{cand.username}</strong> ({cand.display_name})
                      <div
                        style={{
                          fontSize: "0.69rem",
                          color: "var(--text-muted)",
                        }}
                      >
                        Last active: {formatTimestamp(cand.last_active_at)}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ color: "#fda4af", fontWeight: 600 }}>
                        {cand.days_inactive}d inactive
                      </div>
                      <div
                        style={{
                          fontSize: "0.69rem",
                          color: "var(--text-secondary)",
                        }}
                      >
                        {cand.character_count}c / {cand.world_count}w /{" "}
                        {cand.campaign_count}camp •{" "}
                        {formatBytes(cand.media_bytes)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Recent Execution History */}
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 6,
            }}
          >
            <span
              style={{
                fontSize: "0.76rem",
                fontWeight: 600,
                color: "var(--text-secondary)",
              }}
            >
              Recent Chloromancer Runs
            </span>
            <button
              type="button"
              className="btn"
              style={{ padding: "3px 8px", fontSize: "0.7rem" }}
              onClick={loadChloromancerStatus}
              disabled={loadingStatus}
            >
              Refresh
            </button>
          </div>
          {!chloromancerStatus ||
          chloromancerStatus.recent_runs.length === 0 ? (
            <div
              style={{
                fontSize: "0.74rem",
                color: "var(--text-muted)",
                fontStyle: "italic",
              }}
            >
              No housekeeping runs recorded yet.
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                maxHeight: 160,
                overflowY: "auto",
              }}
            >
              {chloromancerStatus.recent_runs.map((run) => (
                <div
                  key={run.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 8px",
                    borderRadius: 4,
                    background: "var(--bg-deep)",
                    border: "1px solid var(--border-subtle)",
                    fontSize: "0.73rem",
                  }}
                >
                  <div>
                    <span style={{ fontWeight: 600 }}>{run.job_id}</span>{" "}
                    <span style={{ color: "var(--text-muted)" }}>
                      ({run.trigger})
                    </span>
                    <div
                      style={{
                        fontSize: "0.68rem",
                        color: "var(--text-muted)",
                      }}
                    >
                      {formatTimestamp(run.finished_at)}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <span
                      style={{
                        fontWeight: 600,
                        color:
                          run.status === "error"
                            ? "#fda4af"
                            : run.status === "skipped"
                            ? "var(--text-muted)"
                            : "var(--accent-cyan)",
                      }}
                    >
                      {run.status.toUpperCase()}
                    </span>{" "}
                    • {run.items_affected} purged
                    {Number(run.details?.bytes_reclaimed || 0) > 0 && (
                      <div
                        style={{
                          fontSize: "0.68rem",
                          color: "var(--text-secondary)",
                        }}
                      >
                        Reclaimed{" "}
                        {formatBytes(Number(run.details.bytes_reclaimed))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
