import React, { useEffect, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  Download,
  FileArchive,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import { api } from "../api";
import {
  ImportCommitResponse,
  ImportConflictStrategy,
  ImportInspectResponse,
} from "../types";

export interface ImportPreviewModalProps {
  initialFile?: File | null;
  onClose: () => void;
  onImportSuccess: () => void;
  onOpenCharacterWizardWithDraft?: (
    draft: any,
    autoWorld?: any,
    preassignedId?: string
  ) => void;
}

export const ImportPreviewModal: React.FC<ImportPreviewModalProps> = ({
  initialFile,
  onClose,
  onImportSuccess,
  onOpenCharacterWizardWithDraft,
}) => {
  const [file, setFile] = useState<File | null>(initialFile || null);
  const [inspecting, setInspecting] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState("");
  const [inspectResult, setInspectResult] =
    useState<ImportInspectResponse | null>(null);

  const [conflictStrategies, setConflictStrategies] = useState<
    Record<string, ImportConflictStrategy>
  >({});
  const defaultStrategy: ImportConflictStrategy = "copy";
  const [commitResult, setCommitResult] =
    useState<ImportCommitResponse | null>(null);

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
          res.preassigned_character_id
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
      <div className="modal-panel" style={{ maxWidth: 680 }}>
        <div className="modal-header">
          <span
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

              {/* Case B: Native CyberCantina Package */}
              {inspectResult.is_native && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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

                  {/* Conflict Resolution Section if names collide */}
                  {inspectResult.conflicts.length > 0 && (
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
