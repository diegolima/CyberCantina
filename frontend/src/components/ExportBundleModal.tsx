import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckSquare,
  Eye,
  EyeOff,
  Film,
  Globe,
  Lock,
  Package,
  Search,
  Square,
  Upload,
  User,
  Users,
  X,
} from "lucide-react";
import { api } from "../api";
import { useModalDialog } from "../hooks/useModalDialog";
import { CharacterRecord, PersonaRecord, WorldRecord } from "../types";
import {
  collectExportableVideos,
  computeSuggestedBundleName,
  filterCharacters,
  filterPersonas,
  filterWorlds,
  findMissingResidentCharacters,
  findMissingWorldDependencies,
  formatMediaBytes,
  validateExportPassword,
} from "../utils/importExportLogic";

export interface ExportBundleModalProps {
  characters: CharacterRecord[];
  worlds: WorldRecord[];
  personas: PersonaRecord[];
  onClose: () => void;
}

export const ExportBundleModal: React.FC<ExportBundleModalProps> = ({
  characters,
  worlds,
  personas,
  onClose,
}) => {
  // Start with no elements selected by default
  const [selectedCharIds, setSelectedCharIds] = useState<Set<string>>(
    () => new Set()
  );
  const [selectedWorldIds, setSelectedWorldIds] = useState<Set<string>>(
    () => new Set()
  );
  const [selectedPersonaIds, setSelectedPersonaIds] = useState<Set<string>>(
    () => new Set()
  );

  // Category search filters
  const [charSearch, setCharSearch] = useState("");
  const [worldSearch, setWorldSearch] = useState("");
  const [personaSearch, setPersonaSearch] = useState("");

  // Track user-typed bundle name (null means auto-naming is active)
  const [customName, setCustomName] = useState<string | null>(null);
  const [includeWorldMedia, setIncludeWorldMedia] = useState(true);
  const [includeVideos, setIncludeVideos] = useState(false);
  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<string>>(
    () => new Set()
  );
  const knownVideoIdsRef = useRef<Set<string>>(new Set());
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

  // Filtered lists based on search queries
  const visibleChars = useMemo(
    () => filterCharacters(characters, charSearch),
    [characters, charSearch]
  );
  const visibleWorlds = useMemo(
    () => filterWorlds(worlds, worldSearch),
    [worlds, worldSearch]
  );
  const visiblePersonas = useMemo(
    () => filterPersonas(personas, personaSearch),
    [personas, personaSearch]
  );

  // Auto-naming calculation based on current selection hierarchy
  const selectedWorlds = useMemo(
    () => worlds.filter((w) => selectedWorldIds.has(w.id)),
    [worlds, selectedWorldIds]
  );
  const selectedChars = useMemo(
    () => characters.filter((c) => selectedCharIds.has(c.id)),
    [characters, selectedCharIds]
  );
  const selectedPersonas = useMemo(
    () => personas.filter((p) => selectedPersonaIds.has(p.id)),
    [personas, selectedPersonaIds]
  );

  const suggestedName = useMemo(
    () => computeSuggestedBundleName(selectedWorlds, selectedChars, selectedPersonas),
    [selectedWorlds, selectedChars, selectedPersonas]
  );

  const availableVideos = useMemo(
    () =>
      collectExportableVideos(
        worlds,
        characters,
        personas,
        selectedWorldIds,
        selectedCharIds,
        selectedPersonaIds,
        includeWorldMedia
      ),
    [
      worlds,
      characters,
      personas,
      selectedWorldIds,
      selectedCharIds,
      selectedPersonaIds,
      includeWorldMedia,
    ]
  );

  // Sync per-video selections whenever availableVideos shifts while "Include videos" is enabled
  useEffect(() => {
    const currentSet = new Set(availableVideos.map((v) => v.videoAssetId));
    if (!includeVideos) {
      knownVideoIdsRef.current = currentSet;
      return;
    }
    setSelectedVideoIds((prev) => {
      const next = new Set<string>();
      for (const vid of currentSet) {
        if (prev.has(vid) || !knownVideoIdsRef.current.has(vid)) {
          next.add(vid);
        }
      }
      return next;
    });
    knownVideoIdsRef.current = currentSet;
  }, [availableVideos, includeVideos]);

  const handleToggleIncludeVideos = (checked: boolean) => {
    setIncludeVideos(checked);
    if (checked) {
      const allIds = new Set(availableVideos.map((v) => v.videoAssetId));
      setSelectedVideoIds(allIds);
      knownVideoIdsRef.current = allIds;
    } else {
      setSelectedVideoIds(new Set());
    }
  };

  const toggleVideoId = (videoAssetId: string) => {
    setSelectedVideoIds((prev) => {
      const next = new Set(prev);
      if (next.has(videoAssetId)) next.delete(videoAssetId);
      else next.add(videoAssetId);
      return next;
    });
  };

  const displayBundleName = customName !== null ? customName : suggestedName;

  // Toggle helpers
  const toggleChar = (id: string) => {
    setSelectedCharIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleWorld = (id: string) => {
    setSelectedWorldIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const togglePersona = (id: string) => {
    setSelectedPersonaIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Filter-aware selection handlers
  const selectAllVisibleChars = () => {
    setSelectedCharIds((prev) => {
      const next = new Set(prev);
      visibleChars.forEach((c) => next.add(c.id));
      return next;
    });
  };

  const selectNoneVisibleChars = () => {
    setSelectedCharIds((prev) => {
      const next = new Set(prev);
      visibleChars.forEach((c) => next.delete(c.id));
      return next;
    });
  };

  const selectAllVisibleWorlds = () => {
    setSelectedWorldIds((prev) => {
      const next = new Set(prev);
      visibleWorlds.forEach((w) => next.add(w.id));
      return next;
    });
  };

  const selectNoneVisibleWorlds = () => {
    setSelectedWorldIds((prev) => {
      const next = new Set(prev);
      visibleWorlds.forEach((w) => next.delete(w.id));
      return next;
    });
  };

  const selectAllVisiblePersonas = () => {
    setSelectedPersonaIds((prev) => {
      const next = new Set(prev);
      visiblePersonas.forEach((p) => next.add(p.id));
      return next;
    });
  };

  const selectNoneVisiblePersonas = () => {
    setSelectedPersonaIds((prev) => {
      const next = new Set(prev);
      visiblePersonas.forEach((p) => next.delete(p.id));
      return next;
    });
  };

  // Find unselected worlds referenced by selected characters
  const missingWorldSuggestions = useMemo(
    () =>
      findMissingWorldDependencies(
        selectedCharIds,
        characters,
        selectedWorldIds,
        worlds
      ),
    [selectedCharIds, characters, selectedWorldIds, worlds]
  );

  // Find unselected characters residing in selected worlds
  const missingCharSuggestions = useMemo(
    () =>
      findMissingResidentCharacters(
        selectedWorldIds,
        worlds,
        selectedCharIds,
        characters
      ),
    [selectedWorldIds, worlds, selectedCharIds, characters]
  );

  const totalSelected =
    selectedCharIds.size + selectedWorldIds.size + selectedPersonaIds.size;

  const handleExport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (totalSelected === 0) {
      setError("Please select at least one character, world, or persona to export.");
      return;
    }
    const pwErr = validateExportPassword(passwordEnabled, password, confirmPassword);
    if (pwErr) {
      setError(pwErr);
      return;
    }

    setExporting(true);
    setError("");

    const finalBundleName =
      (displayBundleName && displayBundleName.trim()) ||
      suggestedName ||
      "cybercantina_export";

    try {
      await api.exportBundle({
        character_ids: Array.from(selectedCharIds),
        world_ids: Array.from(selectedWorldIds),
        persona_ids: Array.from(selectedPersonaIds),
        bundle_name: finalBundleName,
        include_world_media: includeWorldMedia,
        include_videos: includeVideos,
        selected_video_ids: includeVideos ? Array.from(selectedVideoIds) : undefined,
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
        style={{ maxWidth: 740 }}
      >
        <div className="modal-header">
          <span id={titleId} style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--accent-cyan)" }}>
            <Package size={18} />
            Export CyberCantina Package (.zcc)
          </span>
          <button type="button" className="btn" onClick={onClose} disabled={exporting}>
            <X size={15} />
          </button>
        </div>

        <form onSubmit={handleExport} className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {error && (
            <div style={{ color: "var(--accent-rose)", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: 6 }}>
              <AlertCircle size={15} />
              {error}
            </div>
          )}

          <div className="field-group">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <label>Package / Bundle Filename</label>
              {customName !== null && (
                <button
                  type="button"
                  onClick={() => setCustomName(null)}
                  className="btn btn-sm"
                  style={{ fontSize: "0.75rem", padding: "2px 8px", color: "var(--accent-cyan)" }}
                  title="Reset to auto-generated name based on selections"
                >
                  Reset to auto-name
                </button>
              )}
            </div>
            <input
              type="text"
              className="field-input"
              value={displayBundleName}
              onChange={(e) => setCustomName(e.target.value)}
              onBlur={() => {
                if (customName !== null && customName.trim() === "") {
                  setCustomName(null);
                }
              }}
              placeholder={suggestedName || "Select elements to auto-generate name..."}
              disabled={exporting}
            />
          </div>

          {/* Dependency Suggestions: Characters -> Missing World */}
          {missingWorldSuggestions.map((s) => (
            <div
              key={s.worldId}
              style={{
                background: "rgba(56, 189, 248, 0.1)",
                border: "1px solid rgba(56, 189, 248, 0.3)",
                borderRadius: 6,
                padding: "8px 12px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                fontSize: "0.82rem",
              }}
            >
              <span>
                <strong>{s.charNames.join(", ")}</strong> belong(s) to world{" "}
                <strong>{s.worldName}</strong>. If not included, world association and artifact lore links will be stripped.
              </span>
              <button
                type="button"
                className="btn btn-cyan btn-sm"
                onClick={() => {
                  setSelectedWorldIds((prev) => new Set([...prev, s.worldId]));
                }}
              >
                Include World
              </button>
            </div>
          ))}

          {/* Dependency Suggestions: World -> Resident Characters */}
          {missingCharSuggestions.map((s) => (
            <div
              key={s.worldName}
              style={{
                background: "rgba(168, 85, 247, 0.1)",
                border: "1px solid rgba(168, 85, 247, 0.3)",
                borderRadius: 6,
                padding: "8px 12px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                fontSize: "0.82rem",
              }}
            >
              <span>
                World <strong>{s.worldName}</strong> has {s.unselectedChars.length} resident character(s) not currently selected.
              </span>
              <button
                type="button"
                className="btn btn-violet btn-sm"
                onClick={() => {
                  setSelectedCharIds((prev) => {
                    const next = new Set(prev);
                    s.unselectedChars.forEach((c) => next.add(c.id));
                    return next;
                  });
                }}
              >
                Include Characters
              </button>
            </div>
          ))}

          {/* 1. Characters Section */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6, minWidth: "fit-content" }}>
                <Users size={16} color="var(--accent-amber)" />
                Characters ({selectedCharIds.size} / {characters.length})
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, justifyContent: "flex-end", minWidth: 260 }}>
                <div className="ui-search-wrap ui-search-wrap--export">
                  <Search size={13} className="ui-search-icon" />
                  <input
                    type="text"
                    className="ui-search-input ui-search-input--compact ui-search-input--cyan"
                    placeholder="Search name or tag..."
                    value={charSearch}
                    onChange={(e) => setCharSearch(e.target.value)}
                  />
                  {charSearch && (
                    <button
                      type="button"
                      className="ui-search-clear"
                      onClick={() => setCharSearch("")}
                      title="Clear search"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={selectAllVisibleChars}
                  title={charSearch ? "Select all matching characters" : "Select all characters"}
                >
                  All
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={selectNoneVisibleChars}
                  title={charSearch ? "Deselect matching characters" : "Deselect all characters"}
                >
                  None
                </button>
              </div>
            </div>

            <div
              style={{
                maxHeight: 140,
                overflowY: "auto",
                border: "1px solid var(--border-color)",
                borderRadius: 6,
                padding: 6,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                gap: 6,
              }}
            >
              {visibleChars.map((c) => {
                const selected = selectedCharIds.has(c.id);
                return (
                  <div
                    key={c.id}
                    onClick={() => toggleChar(c.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 8px",
                      borderRadius: 4,
                      background: selected ? "rgba(245, 158, 11, 0.15)" : "var(--bg-card)",
                      border: selected ? "1px solid var(--accent-amber)" : "1px solid transparent",
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                  >
                    {selected ? (
                      <CheckSquare size={16} color="var(--accent-amber)" />
                    ) : (
                      <Square size={16} color="var(--text-muted)" />
                    )}
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <div style={{ fontSize: "0.85rem", fontWeight: 500 }}>{c.name}</div>
                      {c.tags && c.tags.length > 0 ? (
                        <div style={{ fontSize: "0.72rem", color: "var(--accent-amber)", opacity: 0.85, overflow: "hidden", textOverflow: "ellipsis" }}>
                          {c.tags.map((t) => `#${t}`).join(" ")}
                        </div>
                      ) : c.tagline ? (
                        <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {c.tagline}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              {visibleChars.length === 0 && (
                <div style={{ padding: 8, color: "var(--text-muted)", fontSize: "0.8rem", gridColumn: "1 / -1" }}>
                  {characters.length === 0 ? "No characters created yet." : `No characters matching "${charSearch}".`}
                </div>
              )}
            </div>
          </div>

          {/* 2. Worlds Section */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6, minWidth: "fit-content" }}>
                <Globe size={16} color="var(--accent-cyan)" />
                Worlds ({selectedWorldIds.size} / {worlds.length})
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, justifyContent: "flex-end", minWidth: 260 }}>
                <div className="ui-search-wrap ui-search-wrap--export">
                  <Search size={13} className="ui-search-icon" />
                  <input
                    type="text"
                    className="ui-search-input ui-search-input--compact ui-search-input--cyan"
                    placeholder="Search name, genre, tag..."
                    value={worldSearch}
                    onChange={(e) => setWorldSearch(e.target.value)}
                  />
                  {worldSearch && (
                    <button
                      type="button"
                      className="ui-search-clear"
                      onClick={() => setWorldSearch("")}
                      title="Clear search"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={selectAllVisibleWorlds}
                  title={worldSearch ? "Select all matching worlds" : "Select all worlds"}
                >
                  All
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={selectNoneVisibleWorlds}
                  title={worldSearch ? "Deselect matching worlds" : "Deselect all worlds"}
                >
                  None
                </button>
              </div>
            </div>

            <div
              style={{
                maxHeight: 140,
                overflowY: "auto",
                border: "1px solid var(--border-color)",
                borderRadius: 6,
                padding: 6,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                gap: 6,
              }}
            >
              {visibleWorlds.map((w) => {
                const selected = selectedWorldIds.has(w.id);
                return (
                  <div
                    key={w.id}
                    onClick={() => toggleWorld(w.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 8px",
                      borderRadius: 4,
                      background: selected ? "rgba(56, 189, 248, 0.15)" : "var(--bg-card)",
                      border: selected ? "1px solid var(--accent-cyan)" : "1px solid transparent",
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                  >
                    {selected ? (
                      <CheckSquare size={16} color="var(--accent-cyan)" />
                    ) : (
                      <Square size={16} color="var(--text-muted)" />
                    )}
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <div style={{ fontSize: "0.85rem", fontWeight: 500 }}>{w.name}</div>
                      <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                        {w.global_rules?.genre ? `${w.global_rules.genre} • ` : ""}{w.locations?.length || 0} locations
                      </div>
                    </div>
                  </div>
                );
              })}
              {visibleWorlds.length === 0 && (
                <div style={{ padding: 8, color: "var(--text-muted)", fontSize: "0.8rem", gridColumn: "1 / -1" }}>
                  {worlds.length === 0 ? "No worlds created yet." : `No worlds matching "${worldSearch}".`}
                </div>
              )}
            </div>
          </div>

          {/* 3. Personas Section */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6, minWidth: "fit-content" }}>
                <User size={16} color="var(--accent-emerald)" />
                Personas ({selectedPersonaIds.size} / {personas.length})
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, justifyContent: "flex-end", minWidth: 260 }}>
                <div className="ui-search-wrap ui-search-wrap--export">
                  <Search size={13} className="ui-search-icon" />
                  <input
                    type="text"
                    className="ui-search-input ui-search-input--compact ui-search-input--cyan"
                    placeholder="Search name, tag..."
                    value={personaSearch}
                    onChange={(e) => setPersonaSearch(e.target.value)}
                  />
                  {personaSearch && (
                    <button
                      type="button"
                      className="ui-search-clear"
                      onClick={() => setPersonaSearch("")}
                      title="Clear search"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={selectAllVisiblePersonas}
                  title={personaSearch ? "Select all matching personas" : "Select all personas"}
                >
                  All
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={selectNoneVisiblePersonas}
                  title={personaSearch ? "Deselect matching personas" : "Deselect all personas"}
                >
                  None
                </button>
              </div>
            </div>

            <div
              style={{
                maxHeight: 120,
                overflowY: "auto",
                border: "1px solid var(--border-color)",
                borderRadius: 6,
                padding: 6,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                gap: 6,
              }}
            >
              {visiblePersonas.map((p) => {
                const selected = selectedPersonaIds.has(p.id);
                return (
                  <div
                    key={p.id}
                    onClick={() => togglePersona(p.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 8px",
                      borderRadius: 4,
                      background: selected ? "rgba(16, 185, 129, 0.15)" : "var(--bg-card)",
                      border: selected ? "1px solid var(--accent-emerald)" : "1px solid transparent",
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                  >
                    {selected ? (
                      <CheckSquare size={16} color="var(--accent-emerald)" />
                    ) : (
                      <Square size={16} color="var(--text-muted)" />
                    )}
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <div style={{ fontSize: "0.85rem", fontWeight: 500 }}>{p.name}</div>
                      {(p.tagline || p.persona_bio || p.build_and_height || p.physical_appearance) && (
                        <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {p.tagline || p.persona_bio || p.build_and_height || p.physical_appearance}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {visiblePersonas.length === 0 && (
                <div style={{ padding: 8, color: "var(--text-muted)", fontSize: "0.8rem", gridColumn: "1 / -1" }}>
                  {personas.length === 0 ? "No personas created yet." : `No personas matching "${personaSearch}".`}
                </div>
              )}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 12,
              paddingTop: 12,
              borderTop: "1px solid var(--border-color)",
            }}
          >
            <div style={{ fontSize: "0.82rem", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span>{totalSelected} item(s) selected</span>
              {selectedWorldIds.size > 0 && (
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", color: "var(--text-secondary)" }}>
                  <input
                    type="checkbox"
                    checked={includeWorldMedia}
                    onChange={(e) => setIncludeWorldMedia(e.target.checked)}
                  />
                  <span>Include world media</span>
                </label>
              )}
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", color: "var(--text-secondary)" }}>
                <input
                  type="checkbox"
                  checked={includeVideos}
                  onChange={(e) => handleToggleIncludeVideos(e.target.checked)}
                />
                <span>
                  Include videos
                  {availableVideos.length > 0 ? ` (${availableVideos.length})` : ""}
                </span>
              </label>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="btn"
                onClick={onClose}
                disabled={exporting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-cyan"
                disabled={totalSelected === 0 || exporting}
                style={{ display: "flex", alignItems: "center", gap: 6 }}
              >
                <Upload size={14} />
                {exporting ? "Packaging..." : "Download .zcc"}
              </button>
            </div>
          </div>

          {includeVideos && (
            <div
              style={{
                border: "1px solid var(--border-color)",
                borderRadius: 6,
                padding: 10,
                background: "var(--bg-card)",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontSize: "0.78rem",
                  color: "var(--text-secondary)",
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
                  <Film size={13} color="var(--accent-cyan)" />
                  Included Videos ({selectedVideoIds.size}/{availableVideos.length})
                </span>
                {availableVideos.length > 0 && (
                  <div style={{ display: "flex", gap: 8, fontSize: "0.72rem" }}>
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() =>
                        setSelectedVideoIds(new Set(availableVideos.map((v) => v.videoAssetId)))
                      }
                    >
                      All
                    </button>
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => setSelectedVideoIds(new Set())}
                    >
                      None
                    </button>
                  </div>
                )}
              </div>
              {availableVideos.length === 0 ? (
                <div style={{ fontSize: "0.76rem", color: "var(--text-muted)" }}>
                  No linked videos found on the selected entities.
                </div>
              ) : (
                <div
                  style={{
                    maxHeight: 130,
                    overflowY: "auto",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  {availableVideos.map((v) => (
                    <label
                      key={v.videoAssetId}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                        fontSize: "0.77rem",
                        cursor: "pointer",
                        padding: "3px 6px",
                        borderRadius: 4,
                        background: selectedVideoIds.has(v.videoAssetId)
                          ? "rgba(56, 189, 248, 0.08)"
                          : "transparent",
                      }}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                        <input
                          type="checkbox"
                          checked={selectedVideoIds.has(v.videoAssetId)}
                          onChange={() => toggleVideoId(v.videoAssetId)}
                        />
                        <span style={{ color: "var(--text-muted)", textTransform: "capitalize" }}>
                          [{v.entityType}]
                        </span>
                        <span style={{ fontWeight: 500 }}>{v.entityName}</span>
                        <span style={{ color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          — {v.imageLabel}
                        </span>
                      </span>
                      <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>
                        {formatMediaBytes(v.byteSize)}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

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
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                cursor: "pointer",
                fontSize: "0.82rem",
                fontWeight: 500,
              }}
            >
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
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <div style={{ display: "flex", gap: 6, flex: "1 1 200px" }}>
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
                  placeholder="Confirm password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  style={{ flex: "1 1 180px" }}
                />
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};
