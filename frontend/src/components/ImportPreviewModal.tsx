import React, { useEffect, useId, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  FileArchive,
  FolderKanban,
  Loader2,
  Lock,
  Sparkles,
  Unlock,
  X,
} from "lucide-react";
import { api } from "../api";
import { useModalDialog } from "../hooks/useModalDialog";
import {
  ImportCommitResponse,
  ImportConflictStrategy,
  ImportInspectResponse,
} from "../types";
import {
  type ImportMediaSelection,
  computeImportMediaToggleState,
  formatMediaBytes,
  shouldShowEntityConflictControls,
} from "../utils/importExportLogic";

export interface ImportPreviewModalProps {
  initialFile?: File | null;
  initialInspectResult?: ImportInspectResponse | null;
  onClose: () => void;
  onImportSuccess: () => void;
  onOpenCharacterWizardWithDraft?: (
    draft: any,
    autoWorld?: any,
    preassignedId?: string,
    mediaWarning?: string | null
  ) => void;
}

export const ImportPreviewModal: React.FC<ImportPreviewModalProps> = ({
  initialFile,
  initialInspectResult = null,
  onClose,
  onImportSuccess,
  onOpenCharacterWizardWithDraft,
}) => {
  const [file, setFile] = useState<File | null>(initialFile || null);
  const [inspecting, setInspecting] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState("");
  const [showUnlockPassword, setShowUnlockPassword] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState("");
  const [inspectResult, setInspectResult] =
    useState<ImportInspectResponse | null>(initialInspectResult);

  const [conflictStrategies, setConflictStrategies] = useState<
    Record<string, ImportConflictStrategy>
  >({});
  const defaultStrategy: ImportConflictStrategy = "copy";
  const [importMediaSelection, setImportMediaSelection] =
    useState<ImportMediaSelection>({ importImages: true, importVideos: true });
  const [importCampaignAssetsAsStandalone, setImportCampaignAssetsAsStandalone] =
    useState(false);
  const [commitResult, setCommitResult] =
    useState<ImportCommitResponse | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  useModalDialog({
    isOpen: true,
    onClose,
    disableEscape: inspecting || unlocking || committing,
    dialogRef,
  });

  // Auto-inspect if file provided
  useEffect(() => {
    if (initialFile) {
      handleInspect(initialFile);
    }
  }, [initialFile]);

  const handleInspect = async (targetFile: File) => {
    setFile(targetFile);
    setInspecting(true);
    setError("");
    setInspectResult(null);
    setCommitResult(null);

    try {
      const res = await api.inspectImport(targetFile);
      setInspectResult(res);
      setUnlockPassword("");
      setImportCampaignAssetsAsStandalone(false);
      setImportMediaSelection({
        importImages: true,
        importVideos: (res.videos_count ?? 0) > 0,
      });

      // Initialize default conflict strategies
      const initStrategies: Record<string, ImportConflictStrategy> = {};
      res.conflicts.forEach((c) => {
        initStrategies[c.incoming_id] = "copy";
      });
      setConflictStrategies(initStrategies);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setInspecting(false);
    }
  };

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inspectResult?.staged_token) return;
    if (!unlockPassword) {
      setError("Enter the archive password to unlock.");
      return;
    }
    setUnlocking(true);
    setError("");
    try {
      const res = await api.unlockImport({
        staged_token: inspectResult.staged_token,
        password: unlockPassword,
      });
      setInspectResult(res);
      setUnlockPassword("");
      setImportMediaSelection({
        importImages: true,
        importVideos: (res.videos_count ?? 0) > 0,
      });
      const initStrategies: Record<string, ImportConflictStrategy> = {};
      res.conflicts.forEach((c) => {
        initStrategies[c.incoming_id] = "copy";
      });
      setConflictStrategies(initStrategies);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setUnlocking(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleInspect(e.target.files[0]);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleInspect(e.dataTransfer.files[0]);
    }
  };

  // SillyTavern distillation redirect
  const handleProceedSillyTavern = async () => {
    if (!file) return;
    setCommitting(true);
    setError("");
    try {
      const res = await api.importSillyTavernCard(file, true);
      onClose();
      if (onOpenCharacterWizardWithDraft) {
        onOpenCharacterWizardWithDraft(
          res.draft,
          res.auto_generated_world,
          res.preassigned_character_id,
          res.media_warning ?? null
        );
      }
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setCommitting(false);
    }
  };

  // Native bundle commit
  const handleCommit = async () => {
    if (!inspectResult) return;
    setCommitting(true);
    setError("");

    try {
      const res = await api.commitImport({
        staged_token: inspectResult.staged_token,
        conflict_strategies: conflictStrategies,
        default_conflict_strategy: defaultStrategy,
        import_images: importMediaSelection.importImages,
        import_videos: importMediaSelection.importVideos,
        import_campaign_assets_as_standalone: importCampaignAssetsAsStandalone,
      });
      setCommitResult(res);
      if (res.success) {
        onImportSuccess();
      }
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setCommitting(false);
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
        style={{ maxWidth: 680 }}
      >
        <div className="modal-header">
          <span
            id={titleId}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              color: "var(--accent-emerald)",
            }}
          >
            <Download size={18} />
            Import Package or Character Card
          </span>
          <button
            type="button"
            className="btn"
            onClick={onClose}
            disabled={inspecting || committing}
          >
            <X size={15} />
          </button>
        </div>

        <div
          className="modal-body"
          style={{ display: "flex", flexDirection: "column", gap: 16 }}
        >
          {error && (
            <div
              style={{
                color: "var(--accent-rose)",
                fontSize: "0.85rem",
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "rgba(244, 63, 94, 0.1)",
                padding: "8px 12px",
                borderRadius: 6,
              }}
            >
              <AlertCircle size={15} />
              {error}
            </div>
          )}

          {/* 1. File Picker / Drag and Drop (when no file or re-uploading) */}
          {!file && (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              style={{
                border: "2px dashed var(--border-color)",
                borderRadius: 8,
                padding: "36px 20px",
                textAlign: "center",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 12,
                cursor: "pointer",
                background: "var(--bg-card)",
              }}
              onClick={() => {
                const el = document.getElementById("import-file-input");
                el?.click();
              }}
            >
              <FileArchive size={40} color="var(--accent-cyan)" />
              <div>
                <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>
                  Click to select or drag & drop a file here
                </div>
                <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4 }}>
                  Supports CyberCantina packages (<strong>.zcc</strong>, <strong>.zip</strong>) and SillyTavern cards (<strong>.png</strong>, <strong>.json</strong>)
                </div>
              </div>
              <input
                id="import-file-input"
                type="file"
                accept=".zcc,.zip,.png,.json"
                style={{ display: "none" }}
                onChange={handleFileChange}
              />
            </div>
          )}

          {/* 2. Loading State */}
          {inspecting && (
            <div
              style={{
                padding: "32px 0",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 12,
                color: "var(--text-muted)",
              }}
            >
              <Loader2 className="animate-spin" size={28} color="var(--accent-cyan)" />
              <span>Analyzing file structure and validating contents...</span>
            </div>
          )}

          {/* 3. Success / Commit Result View */}
          {commitResult && (
            <div
              style={{
                padding: 16,
                background: "rgba(16, 185, 129, 0.1)",
                border: "1px solid rgba(16, 185, 129, 0.3)",
                borderRadius: 8,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--accent-emerald)", fontWeight: 600 }}>
                <CheckCircle2 size={18} />
                {commitResult.message}
              </div>
              <div style={{ fontSize: "0.82rem", color: "var(--text-secondary)" }}>
                {commitResult.imported_campaigns && commitResult.imported_campaigns.length > 0 && (
                  <div>
                    <strong>Campaigns:</strong> {commitResult.imported_campaigns.join(", ")}
                  </div>
                )}
                {commitResult.imported_characters.length > 0 && (
                  <div>
                    <strong>Characters:</strong> {commitResult.imported_characters.join(", ")}
                  </div>
                )}
                {commitResult.imported_worlds.length > 0 && (
                  <div>
                    <strong>Worlds:</strong> {commitResult.imported_worlds.join(", ")}
                  </div>
                )}
                {commitResult.imported_personas.length > 0 && (
                  <div>
                    <strong>Personas:</strong> {commitResult.imported_personas.join(", ")}
                  </div>
                )}
              </div>
              {commitResult.warnings && commitResult.warnings.length > 0 && (
                <div
                  style={{
                    border: "1px solid rgba(245, 158, 11, 0.35)",
                    background: "rgba(245, 158, 11, 0.08)",
                    borderRadius: 6,
                    padding: 10,
                    fontSize: "0.79rem",
                    color: "var(--text-secondary)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <div style={{ fontWeight: 600, color: "var(--accent-amber)", display: "flex", alignItems: "center", gap: 6 }}>
                    <AlertTriangle size={14} /> Media &amp; Import Notices
                  </div>
                  {commitResult.warnings.map((w, idx) => (
                    <div key={idx}>{w}</div>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                <button type="button" className="btn btn-emerald" onClick={onClose}>
                  Done
                </button>
              </div>
            </div>
          )}

          {/* 4. Inspected Details View (before commit) */}
          {inspectResult && !commitResult && !inspecting && (
            <>
              {/* Format Badge */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 12px",
                  borderRadius: 6,
                  background: inspectResult.is_native
                    ? "rgba(56, 189, 248, 0.1)"
                    : "rgba(245, 158, 11, 0.1)",
                  border: inspectResult.is_native
                    ? "1px solid rgba(56, 189, 248, 0.3)"
                    : "1px solid rgba(245, 158, 11, 0.3)",
                  fontSize: "0.85rem",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {inspectResult.is_native ? (
                    <FileArchive size={16} color="var(--accent-cyan)" />
                  ) : (
                    <Sparkles size={16} color="var(--accent-amber)" />
                  )}
                  <span>
                    Detected format:{" "}
                    <strong>
                      {inspectResult.is_native
                        ? "Native CyberCantina Package (.zcc)"
                        : "SillyTavern Character Card"}
                    </strong>
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    setFile(null);
                    setInspectResult(null);
                  }}
                >
                  Change File
                </button>
              </div>

              {/* Case A: SillyTavern Card */}
              {!inspectResult.is_native && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                    This card requires AI distillation to generate CyberCantina baseline psyche, voice cadence, and RAG memory shards.
                  </div>
                  {inspectResult.characters[0] && (
                    <div
                      style={{
                        padding: 12,
                        background: "var(--bg-card)",
                        borderRadius: 6,
                        border: "1px solid var(--border-color)",
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>
                        {inspectResult.characters[0].name}
                      </div>
                      {inspectResult.characters[0].tagline && (
                        <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4 }}>
                          {inspectResult.characters[0].tagline}
                        </div>
                      )}
                    </div>
                  )}
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
                    <button type="button" className="btn" onClick={onClose}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn-amber"
                      onClick={handleProceedSillyTavern}
                      disabled={committing}
                      style={{ display: "flex", alignItems: "center", gap: 6 }}
                    >
                      <Sparkles size={14} />
                      {committing ? "Distilling with AI..." : "Open Character Creation Wizard"}
                    </button>
                  </div>
                </div>
              )}

              {/* Case A0: Password-Protected .zcc Archive */}
              {inspectResult.is_native && inspectResult.requires_password && (
                <form
                  onSubmit={handleUnlock}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                    padding: 14,
                    borderRadius: 8,
                    background: "rgba(245, 158, 11, 0.08)",
                    border: "1px solid rgba(245, 158, 11, 0.35)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontWeight: 600,
                      color: "var(--accent-amber)",
                      fontSize: "0.9rem",
                    }}
                  >
                    <Lock size={16} />
                    Password-Protected Archive
                  </div>
                  <div style={{ fontSize: "0.82rem", color: "var(--text-secondary)" }}>
                    This .zcc archive is encrypted. Enter its password to inspect and import its contents.
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      type={showUnlockPassword ? "text" : "password"}
                      className="input"
                      placeholder="Enter archive password"
                      value={unlockPassword}
                      onChange={(e) => setUnlockPassword(e.target.value)}
                      autoComplete="current-password"
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setShowUnlockPassword((v) => !v)}
                      title={showUnlockPassword ? "Hide password" : "Show password"}
                    >
                      {showUnlockPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                    <button type="button" className="btn" onClick={onClose} disabled={unlocking}>
                      Cancel
                    </button>
                    <button type="submit" className="btn btn-amber" disabled={unlocking}>
                      <Unlock size={14} />
                      {unlocking ? "Unlocking..." : "Unlock Archive"}
                    </button>
                  </div>
                </form>
              )}

              {/* Case B: Native CyberCantina Package */}
              {inspectResult.is_native && !inspectResult.requires_password && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {/* Campaign Summary & Standalone Toggle */}
                  {inspectResult.campaigns && inspectResult.campaigns.length > 0 && (
                    <div
                      style={{
                        border: "1px solid rgba(167, 139, 250, 0.35)",
                        background: "rgba(167, 139, 250, 0.08)",
                        borderRadius: 8,
                        padding: 12,
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          fontWeight: 600,
                          color: "var(--accent-violet)",
                          fontSize: "0.88rem",
                        }}
                      >
                        <FolderKanban size={15} />
                        Running Campaign ({inspectResult.campaigns.length})
                      </div>
                      {inspectResult.campaigns.map((camp) => (
                        <div
                          key={camp.id || camp.name}
                          style={{
                            padding: "8px 10px",
                            borderRadius: 6,
                            background: "var(--bg-card)",
                            border: "1px solid var(--border-subtle)",
                            fontSize: "0.82rem",
                          }}
                        >
                          <div style={{ fontWeight: 600 }}>{camp.name}</div>
                          {camp.tagline && (
                            <div style={{ fontSize: "0.76rem", color: "var(--text-secondary)", marginTop: 2 }}>
                              {camp.tagline}
                            </div>
                          )}
                          <div style={{ fontSize: "0.74rem", color: "var(--text-muted)", marginTop: 4 }}>
                            {camp.extra_info?.timeline_scope === "active"
                              ? "Active timeline only"
                              : "Full timelines (all branches & swipes)"}{" "}
                            • {camp.extra_info?.turns_count ?? 0} turn(s) •{" "}
                            {camp.extra_info?.summaries_count ?? 0} summary(s) •{" "}
                            {camp.extra_info?.bookmarks_count ?? 0} bookmark(s)
                          </div>
                        </div>
                      ))}
                      <label
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 8,
                          cursor: "pointer",
                          fontSize: "0.82rem",
                          paddingTop: 2,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={importCampaignAssetsAsStandalone}
                          onChange={(e) => setImportCampaignAssetsAsStandalone(e.target.checked)}
                          style={{ marginTop: 2 }}
                        />
                        <span>
                          <strong style={{ color: "var(--text-primary)" }}>
                            Import base world, characters &amp; persona as standalone library items
                          </strong>
                          <span style={{ display: "block", fontSize: "0.74rem", color: "var(--text-muted)" }}>
                            Unchecked by default: base world &amp; characters stay private to this campaign (auto-cleaned when the campaign is deleted) and persona runs from its campaign snapshot.
                          </span>
                        </span>
                      </label>
                    </div>
                  )}

                  {/* Entity Breakdown */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(3, 1fr)",
                      gap: 8,
                      textAlign: "center",
                    }}
                  >
                    <div
                      style={{
                        padding: 10,
                        background: "var(--bg-card)",
                        border: "1px solid var(--border-color)",
                        borderRadius: 6,
                      }}
                    >
                      <div style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--accent-amber)" }}>
                        {inspectResult.characters.length}
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                        Characters
                      </div>
                    </div>
                    <div
                      style={{
                        padding: 10,
                        background: "var(--bg-card)",
                        border: "1px solid var(--border-color)",
                        borderRadius: 6,
                      }}
                    >
                      <div style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--accent-cyan)" }}>
                        {inspectResult.worlds.length}
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                        Worlds
                      </div>
                    </div>
                    <div
                      style={{
                        padding: 10,
                        background: "var(--bg-card)",
                        border: "1px solid var(--border-color)",
                        borderRadius: 6,
                      }}
                    >
                      <div style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--accent-emerald)" }}>
                        {inspectResult.personas.length}
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                        Personas
                      </div>
                    </div>
                  </div>

                  {/* Media Import Selection (.zcc archives with images/videos) */}
                  {((inspectResult.images_count ?? 0) > 0 ||
                    (inspectResult.videos_count ?? 0) > 0) && (
                    <div
                      style={{
                        border: "1px solid var(--border-color)",
                        background: "var(--bg-card)",
                        borderRadius: 6,
                        padding: 12,
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          fontSize: "0.84rem",
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={
                            importMediaSelection.importImages ||
                            importMediaSelection.importVideos
                          }
                          onChange={(e) =>
                            setImportMediaSelection((prev) =>
                              computeImportMediaToggleState(
                                prev,
                                "parent",
                                e.target.checked
                              )
                            )
                          }
                        />
                        <span>Import media</span>
                      </label>
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 16,
                          paddingLeft: 22,
                          fontSize: "0.79rem",
                          color: "var(--text-secondary)",
                        }}
                      >
                        <label
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            cursor: "pointer",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={importMediaSelection.importImages}
                            onChange={(e) =>
                              setImportMediaSelection((prev) =>
                                computeImportMediaToggleState(
                                  prev,
                                  "images",
                                  e.target.checked
                                )
                              )
                            }
                          />
                          <span>
                            Images ({inspectResult.images_count ?? 0} ·{" "}
                            {formatMediaBytes(inspectResult.images_bytes ?? 0)})
                          </span>
                        </label>
                        {(inspectResult.videos_count ?? 0) > 0 && (
                          <label
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              cursor: "pointer",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={importMediaSelection.importVideos}
                              onChange={(e) =>
                                setImportMediaSelection((prev) =>
                                  computeImportMediaToggleState(
                                    prev,
                                    "videos",
                                    e.target.checked
                                  )
                                )
                              }
                            />
                            <span>
                              Videos ({inspectResult.videos_count ?? 0} ·{" "}
                              {formatMediaBytes(inspectResult.videos_bytes ?? 0)})
                            </span>
                          </label>
                        )}
                      </div>
                      <div style={{ fontSize: "0.73rem", color: "var(--text-muted)", paddingLeft: 22 }}>
                        Linked videos require their parent images; enabling Videos automatically includes Images.
                      </div>
                    </div>
                  )}

                  {/* Non-blocking Warnings (e.g. unsupported/deprecated fields) */}
                  {inspectResult.warnings && inspectResult.warnings.length > 0 && (
                    <div
                      style={{
                        border: "1px solid rgba(245, 158, 11, 0.3)",
                        background: "rgba(245, 158, 11, 0.08)",
                        borderRadius: 6,
                        padding: 10,
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                        fontSize: "0.8rem",
                        color: "var(--text-secondary)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          fontWeight: 600,
                          color: "var(--accent-amber)",
                        }}
                      >
                        <AlertTriangle size={14} />
                        Compatibility Notice
                      </div>
                      {inspectResult.warnings.map((w, idx) => (
                        <div key={idx}>{w}</div>
                      ))}
                    </div>
                  )}

                  {/* Conflict Resolution Section if names collide */}
                  {inspectResult.conflicts.length > 0 &&
                    shouldShowEntityConflictControls(
                      Boolean(inspectResult.campaigns && inspectResult.campaigns.length > 0),
                      importCampaignAssetsAsStandalone
                    ) && (
                    <div
                      style={{
                        border: "1px solid rgba(245, 158, 11, 0.3)",
                        background: "rgba(245, 158, 11, 0.05)",
                        borderRadius: 6,
                        padding: 12,
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          fontWeight: 600,
                          fontSize: "0.85rem",
                          color: "var(--accent-amber)",
                        }}
                      >
                        <AlertTriangle size={15} />
                        Name Collisions Detected ({inspectResult.conflicts.length})
                      </div>
                      <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>
                        Choose how to handle entities that share names with existing ones:
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
                        {inspectResult.conflicts.map((c) => {
                          const strat = conflictStrategies[c.incoming_id] || defaultStrategy;
                          return (
                            <div
                              key={c.incoming_id}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                padding: "6px 8px",
                                background: "var(--bg-card)",
                                borderRadius: 4,
                                fontSize: "0.82rem",
                              }}
                            >
                              <span>
                                <span style={{ textTransform: "capitalize", color: "var(--text-muted)" }}>
                                  [{c.category}]
                                </span>{" "}
                                <strong>{c.name}</strong>
                              </span>
                              <select
                                className="field-select"
                                style={{ width: "auto", padding: "4px 8px", fontSize: "0.8rem" }}
                                value={strat}
                                onChange={(e) => {
                                  const val = e.target.value as ImportConflictStrategy;
                                  setConflictStrategies((prev) => ({
                                    ...prev,
                                    [c.incoming_id]: val,
                                  }));
                                }}
                              >
                                <option value="copy">Import as Copy</option>
                                <option value="skip">Skip</option>
                              </select>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Actions Footer */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: 8,
                      marginTop: 8,
                      paddingTop: 12,
                      borderTop: "1px solid var(--border-color)",
                    }}
                  >
                    <button type="button" className="btn" onClick={onClose} disabled={committing}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn-cyan"
                      onClick={handleCommit}
                      disabled={committing}
                      style={{ display: "flex", alignItems: "center", gap: 6 }}
                    >
                      <Check size={14} />
                      {committing ? "Importing..." : "Confirm & Import into Database"}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
