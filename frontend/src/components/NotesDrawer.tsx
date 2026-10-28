import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Clock,
  Copy,
  ExternalLink,
  Lock,
  Maximize2,
  Plus,
  Search,
  Sparkles,
  Star,
  StickyNote,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { UserNote } from "../types";
import { rankNotes, slugifyTag } from "../utils/noteSearch";

interface NotesFlyoutProps {
  isOpen: boolean;
  notes: UserNote[];
  contextTags: string[];
  activeCampaignName?: string;
  activeWorldName?: string;
  activeCharacterName?: string;
  onClose: () => void;
  onOpenModal: (noteIdToSelect?: string) => void;
  onToggleStar: (note: UserNote) => Promise<void>;
  onQuickAdd: (content: string, title?: string, tags?: string[]) => Promise<void>;
  onDeleteNote: (noteId: string) => Promise<void>;
}

export const NotesFlyout: React.FC<NotesFlyoutProps> = ({
  isOpen,
  notes,
  contextTags,
  activeCampaignName,
  onClose,
  onOpenModal,
  onToggleStar,
  onQuickAdd,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"starred" | "all" | "scene">("starred");
  const [quickInput, setQuickInput] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);

  // Close on Escape or click outside
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (flyoutRef.current && !flyoutRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, onClose]);

  // Copy helper
  const handleCopy = async (note: UserNote, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await navigator.clipboard.writeText(note.content);
      setCopiedId(note.id);
      setTimeout(() => setCopiedId((curr) => (curr === note.id ? null : curr)), 1500);
    } catch (err) {
      console.error("Failed to copy note to clipboard", err);
    }
  };

  // Quick submit
  const handleQuickSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = quickInput.trim();
    if (!text) return;
    setQuickInput("");
    // By default, if inside a campaign, tag with the campaign tag
    const defaultTags = contextTags.length > 0 ? [contextTags[0]] : [];
    await onQuickAdd(text, "", defaultTags);
  };

  // Filter notes based on tab before search ranking
  const candidateNotes = useMemo(() => {
    if (activeTab === "starred") {
      const starred = notes.filter((n) => n.is_starred);
      // Graceful fallback: if no starred notes, show all notes
      return starred.length > 0 ? starred : notes;
    }
    if (activeTab === "scene" && contextTags.length > 0) {
      const normalizedContext = contextTags.map((t) => t.toLowerCase().replace(/^#/, ""));
      return notes.filter((n) =>
        n.tags.some((t) => normalizedContext.includes(t.toLowerCase().replace(/^#/, "")))
      );
    }
    return notes;
  }, [notes, activeTab, contextTags]);

  // Ranked results
  const ranked = useMemo(() => {
    return rankNotes(candidateNotes, searchQuery, contextTags);
  }, [candidateNotes, searchQuery, contextTags]);

  const starredCount = useMemo(() => notes.filter((n) => n.is_starred).length, [notes]);

  if (!isOpen) return null;

  return (
    <div className="notes-flyout-popover" ref={flyoutRef}>
      {/* Header */}
      <div className="notes-flyout-header">
        <div className="notes-flyout-title">
          <StickyNote size={15} color="var(--accent-amber)" />
          <span>Player Scratchpad</span>
          <span className="notes-privacy-tag" title="Private to you. Never injected into AI prompt context.">
            <Lock size={10} /> Private
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: "3px 6px", fontSize: "0.72rem" }}
            onClick={() => {
              onClose();
              onOpenModal();
            }}
            title="Open Full Notes Manager"
          >
            <Maximize2 size={13} />
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: "3px 6px", fontSize: "0.72rem" }}
            onClick={onClose}
            title="Close"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Search Input */}
      <div className="notes-flyout-search-wrap">
        <Search size={13} className="notes-search-icon" />
        <input
          type="text"
          className="notes-search-input"
          placeholder="Search by tag (#combat) or keyword..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          autoFocus
        />
        {searchQuery && (
          <button
            type="button"
            className="notes-search-clear"
            onClick={() => setSearchQuery("")}
            title="Clear search"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Tab Pills */}
      <div className="notes-flyout-tabs">
        <button
          type="button"
          className={`notes-tab-pill ${activeTab === "starred" ? "active" : ""}`}
          onClick={() => setActiveTab("starred")}
        >
          <Star size={11} fill={activeTab === "starred" ? "currentColor" : "none"} />
          <span>Starred ({starredCount})</span>
        </button>
        {contextTags.length > 0 && (
          <button
            type="button"
            className={`notes-tab-pill ${activeTab === "scene" ? "active" : ""}`}
            onClick={() => setActiveTab("scene")}
            title={`Notes matching current scene: ${activeCampaignName || "Scene"}`}
          >
            <Sparkles size={11} />
            <span>Scene ({activeCampaignName ? activeCampaignName.slice(0, 12) : "Context"})</span>
          </button>
        )}
        <button
          type="button"
          className={`notes-tab-pill ${activeTab === "all" ? "active" : ""}`}
          onClick={() => setActiveTab("all")}
        >
          <span>All ({notes.length})</span>
        </button>
      </div>

      {/* Notes List */}
      <div className="notes-flyout-list">
        {ranked.length > 0 ? (
          ranked.map((note) => {
            const isCopied = copiedId === note.id;
            const displayTitle = note.title.trim() || note.content.slice(0, 32).trim() || "Untitled Note";

            return (
              <div
                key={note.id}
                className="notes-flyout-card"
                onClick={() => {
                  onClose();
                  onOpenModal(note.id);
                }}
                title="Click to edit in full modal"
              >
                <div className="notes-card-top">
                  <div className="notes-card-title-row">
                    <button
                      type="button"
                      className={`notes-star-btn ${note.is_starred ? "starred" : ""}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleStar(note);
                      }}
                      title={note.is_starred ? "Unstar note" : "Star note"}
                    >
                      <Star size={13} fill={note.is_starred ? "var(--accent-amber)" : "none"} />
                    </button>
                    <span className="notes-card-title">{displayTitle}</span>
                  </div>

                  {/* 1-Click Copy Button */}
                  <button
                    type="button"
                    className={`btn notes-copy-btn ${isCopied ? "copied" : ""}`}
                    onClick={(e) => handleCopy(note, e)}
                    title="Copy note text to clipboard"
                  >
                    {isCopied ? (
                      <>
                        <Check size={12} color="var(--accent-emerald)" />
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy size={12} />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Content snippet */}
                <div className="notes-card-body">{note.content}</div>

                {/* Tag chips */}
                {note.tags.length > 0 && (
                  <div className="notes-card-tags">
                    {note.tags.map((tag) => (
                      <span
                        key={tag}
                        className="notes-tag-chip"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSearchQuery(`#${tag}`);
                        }}
                        title={`Filter by #${tag}`}
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div className="notes-empty-state">
            {searchQuery ? (
              <>No notes matching "{searchQuery}"</>
            ) : activeTab === "starred" && starredCount === 0 ? (
              <>
                <Star size={18} color="var(--text-muted)" style={{ margin: "0 auto 6px" }} />
                <div>No starred notes yet.</div>
                <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: 4 }}>
                  Click the star icon on any note to pin it here for instant access.
                </div>
              </>
            ) : (
              <>No notes found</>
            )}
          </div>
        )}
      </div>

      {/* Quick Add Form */}
      <form className="notes-quick-add-form" onSubmit={handleQuickSubmit}>
        <input
          type="text"
          className="notes-quick-add-input"
          placeholder="Quick note: type & press Enter..."
          value={quickInput}
          onChange={(e) => setQuickInput(e.target.value)}
        />
        <button
          type="submit"
          className="btn btn-amber"
          style={{ padding: "5px 9px", fontSize: "0.72rem" }}
          disabled={!quickInput.trim()}
          title="Save quick note"
        >
          <Plus size={13} />
        </button>
      </form>

      {/* Footer trigger to full modal */}
      <div className="notes-flyout-footer">
        <button
          type="button"
          className="btn btn-ghost notes-manage-all-btn"
          onClick={() => {
            onClose();
            onOpenModal();
          }}
        >
          <ExternalLink size={12} />
          <span>Open Full Notes Manager</span>
        </button>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------
// Full Notes Management Modal
// ------------------------------------------------------------------

interface NotesModalProps {
  isOpen: boolean;
  notes: UserNote[];
  initialSelectedId?: string;
  contextTags: string[];
  activeCampaignName?: string;
  activeWorldName?: string;
  activeCharacterName?: string;
  onClose: () => void;
  onSaveNote: (
    noteId: string | null,
    payload: { title: string; content: string; tags: string[]; is_starred: boolean }
  ) => Promise<UserNote | void>;
  onDeleteNote: (noteId: string) => Promise<void>;
  onToggleStar: (note: UserNote) => Promise<void>;
}

export const NotesModal: React.FC<NotesModalProps> = ({
  isOpen,
  notes,
  initialSelectedId,
  contextTags,
  activeCampaignName,
  activeWorldName,
  activeCharacterName,
  onClose,
  onSaveNote,
  onDeleteNote,
  onToggleStar,
}) => {
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(initialSelectedId || null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTagFilter, setSelectedTagFilter] = useState<string | null>(null);

  // Editor form state
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [formTitle, setFormTitle] = useState("");
  const [formContent, setFormContent] = useState("");
  const [formTags, setFormTags] = useState<string[]>([]);
  const [formStarred, setFormStarred] = useState(false);
  const [newTagInput, setNewTagInput] = useState("");
  const [copiedSuccess, setCopiedSuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Synchronize selection
  useEffect(() => {
    if (!isOpen) return;
    if (initialSelectedId && notes.some((n) => n.id === initialSelectedId)) {
      setSelectedNoteId(initialSelectedId);
      setIsCreatingNew(false);
    } else if (notes.length > 0 && !selectedNoteId && !isCreatingNew) {
      setSelectedNoteId(notes[0].id);
    } else if (notes.length === 0) {
      setIsCreatingNew(true);
    }
  }, [isOpen, initialSelectedId, notes]);

  // Load selected note into editor
  useEffect(() => {
    if (isCreatingNew) {
      setFormTitle("");
      setFormContent("");
      // When creating new note, prefill with context tags if available
      setFormTags(contextTags.length > 0 ? [contextTags[0]] : []);
      setFormStarred(false);
      return;
    }

    const current = notes.find((n) => n.id === selectedNoteId);
    if (current) {
      setFormTitle(current.title);
      setFormContent(current.content);
      setFormTags(current.tags);
      setFormStarred(current.is_starred);
    }
  }, [selectedNoteId, isCreatingNew, notes]);

  // All unique tags across all notes
  const allUniqueTags = useMemo(() => {
    const set = new Set<string>();
    notes.forEach((n) => n.tags.forEach((t) => set.add(t.toLowerCase())));
    return Array.from(set).sort();
  }, [notes]);

  // Filter and rank notes
  const filteredNotes = useMemo(() => {
    let list = notes;
    if (selectedTagFilter) {
      list = list.filter((n) =>
        n.tags.some((t) => t.toLowerCase() === selectedTagFilter.toLowerCase())
      );
    }
    return rankNotes(list, searchQuery, contextTags);
  }, [notes, searchQuery, selectedTagFilter, contextTags]);

  // Save current note
  const handleSave = async () => {
    if (!formContent.trim() && !formTitle.trim()) return;
    setIsSaving(true);
    try {
      const saved = await onSaveNote(isCreatingNew ? null : selectedNoteId, {
        title: formTitle.trim(),
        content: formContent,
        tags: formTags,
        is_starred: formStarred,
      });
      if (saved && isCreatingNew) {
        setIsCreatingNew(false);
        setSelectedNoteId(saved.id);
      }
    } finally {
      setIsSaving(false);
    }
  };

  // Add a tag to form
  const handleAddTag = (tagToAdd: string) => {
    const clean = slugifyTag(tagToAdd);
    if (clean && !formTags.includes(clean)) {
      setFormTags((prev) => [...prev, clean]);
    }
    setNewTagInput("");
  };

  // Remove a tag from form
  const handleRemoveTag = (tagToRemove: string) => {
    setFormTags((prev) => prev.filter((t) => t !== tagToRemove));
  };

  // 1-Click Copy from Editor
  const handleCopyEditorContent = async () => {
    if (!formContent) return;
    try {
      await navigator.clipboard.writeText(formContent);
      setCopiedSuccess(true);
      setTimeout(() => setCopiedSuccess(false), 1500);
    } catch (err) {
      console.error("Failed to copy note", err);
    }
  };

  // Delete current note
  const handleDeleteCurrent = async () => {
    if (!selectedNoteId) return;
    await onDeleteNote(selectedNoteId);
    setConfirmDeleteId(null);
    const remaining = notes.filter((n) => n.id !== selectedNoteId);
    if (remaining.length > 0) {
      setSelectedNoteId(remaining[0].id);
    } else {
      setIsCreatingNew(true);
    }
  };

  // Suggested tags from active context
  const suggestedContextBadges = useMemo(() => {
    const list: { label: string; tag: string }[] = [];
    if (activeCampaignName) {
      list.push({ label: `Campaign: ${activeCampaignName}`, tag: slugifyTag(activeCampaignName) });
    }
    if (activeWorldName) {
      list.push({ label: `World: ${activeWorldName}`, tag: slugifyTag(activeWorldName) });
    }
    if (activeCharacterName) {
      list.push({ label: `Character: ${activeCharacterName}`, tag: slugifyTag(activeCharacterName) });
    }
    return list;
  }, [activeCampaignName, activeWorldName, activeCharacterName]);

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop">
      <div className="notes-modal-dialog">
        {/* Modal Header */}
        <div className="notes-modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <StickyNote size={20} color="var(--accent-amber)" />
            <div style={{ fontWeight: 700, fontSize: "1.05rem", letterSpacing: "0.02em" }}>
              Notes & Player Scratchpad
            </div>
            <div className="notes-privacy-tag" title="Strictly private to your user account. Never sent to the LLM.">
              <Lock size={11} /> Private to you • Never seen by AI
            </div>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose} title="Close (Esc)">
            <X size={16} />
          </button>
        </div>

        {/* Modal Body: Split Master-Detail Layout */}
        <div className="notes-modal-body">
          {/* Left Column: Note List & Filters */}
          <div className="notes-master-pane">
            <div className="notes-master-actions">
              <button
                type="button"
                className="btn btn-amber"
                style={{ width: "100%", justifyContent: "center", gap: 6 }}
                onClick={() => {
                  setIsCreatingNew(true);
                  setSelectedNoteId(null);
                }}
              >
                <Plus size={14} /> New Note
              </button>
            </div>

            {/* Search */}
            <div className="notes-flyout-search-wrap" style={{ margin: "10px 0" }}>
              <Search size={13} className="notes-search-icon" />
              <input
                type="text"
                className="notes-search-input"
                placeholder="Search tags & keywords..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  type="button"
                  className="notes-search-clear"
                  onClick={() => setSearchQuery("")}
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Tag Filter Chips */}
            {allUniqueTags.length > 0 && (
              <div className="notes-filter-tags-scroll">
                <button
                  type="button"
                  className={`notes-filter-tag-pill ${selectedTagFilter === null ? "active" : ""}`}
                  onClick={() => setSelectedTagFilter(null)}
                >
                  All Tags
                </button>
                {allUniqueTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className={`notes-filter-tag-pill ${selectedTagFilter === tag ? "active" : ""}`}
                    onClick={() => setSelectedTagFilter(selectedTagFilter === tag ? null : tag)}
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            )}

            {/* Note items list */}
            <div className="notes-master-list">
              {filteredNotes.length > 0 ? (
                filteredNotes.map((note) => {
                  const isSelected = !isCreatingNew && selectedNoteId === note.id;
                  const displayTitle = note.title.trim() || note.content.slice(0, 30).trim() || "Untitled Note";

                  return (
                    <div
                      key={note.id}
                      className={`notes-master-item ${isSelected ? "selected" : ""}`}
                      onClick={() => {
                        setIsCreatingNew(false);
                        setSelectedNoteId(note.id);
                      }}
                    >
                      <div className="notes-master-item-row">
                        <button
                          type="button"
                          className={`notes-star-btn ${note.is_starred ? "starred" : ""}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleStar(note);
                          }}
                          title={note.is_starred ? "Unstar" : "Star"}
                        >
                          <Star size={13} fill={note.is_starred ? "var(--accent-amber)" : "none"} />
                        </button>
                        <span className="notes-master-item-title">{displayTitle}</span>
                      </div>

                      <div className="notes-master-item-meta">
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                          <Clock size={10} />
                          {new Date(note.updated_at).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                        {note.tags.length > 0 && (
                          <span style={{ color: "var(--accent-cyan)", fontSize: "0.68rem" }}>
                            #{note.tags[0]} {note.tags.length > 1 ? `+${note.tags.length - 1}` : ""}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="notes-empty-state" style={{ padding: "20px 10px" }}>
                  No matching notes
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Note Editor */}
          <div className="notes-detail-pane">
            {/* Top Toolbar */}
            <div className="notes-detail-toolbar">
              <input
                type="text"
                className="notes-title-input"
                placeholder="Note Title (optional)..."
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
              />

              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button
                  type="button"
                  className={`btn ${formStarred ? "btn-amber" : "btn-ghost"}`}
                  style={{ padding: "5px 8px", fontSize: "0.75rem" }}
                  onClick={() => setFormStarred((prev) => !prev)}
                  title={formStarred ? "Starred note" : "Star this note"}
                >
                  <Star size={13} fill={formStarred ? "currentColor" : "none"} />
                  <span>{formStarred ? "Starred" : "Star"}</span>
                </button>

                <button
                  type="button"
                  className={`btn ${copiedSuccess ? "btn-emerald" : "btn-ghost"}`}
                  style={{ padding: "5px 8px", fontSize: "0.75rem" }}
                  onClick={handleCopyEditorContent}
                  disabled={!formContent}
                  title="Copy note text to clipboard"
                >
                  {copiedSuccess ? <Check size={13} /> : <Copy size={13} />}
                  <span>{copiedSuccess ? "Copied!" : "Copy"}</span>
                </button>

                {!isCreatingNew && selectedNoteId && (
                  confirmDeleteId === selectedNoteId ? (
                    <div style={{ display: "flex", gap: 4 }}>
                      <button
                        type="button"
                        className="btn btn-rose"
                        style={{ padding: "5px 8px", fontSize: "0.72rem" }}
                        onClick={handleDeleteCurrent}
                      >
                        Confirm Delete
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ padding: "5px 6px", fontSize: "0.72rem" }}
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ padding: "5px 8px", fontSize: "0.75rem", color: "var(--accent-rose)" }}
                      onClick={() => setConfirmDeleteId(selectedNoteId)}
                      title="Delete note"
                    >
                      <Trash2 size={13} />
                    </button>
                  )
                )}
              </div>
            </div>

            {/* Smart Suggestions Bar: Campaign, World, Character */}
            {suggestedContextBadges.length > 0 && (
              <div className="notes-context-suggestions">
                <span className="notes-context-label">
                  <Sparkles size={11} color="var(--accent-amber)" /> Suggested Tags:
                </span>
                {suggestedContextBadges.map(({ label, tag }) => {
                  const alreadyAdded = formTags.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      className={`notes-context-chip ${alreadyAdded ? "added" : ""}`}
                      onClick={() => {
                        if (!alreadyAdded) handleAddTag(tag);
                      }}
                      disabled={alreadyAdded}
                      title={`Add #${tag} to note (${label})`}
                    >
                      {alreadyAdded ? <Check size={10} /> : <Plus size={10} />}
                      <span>#{tag}</span>
                    </button>
                  );
                })}

                {/* Add all context tags shortcut */}
                {suggestedContextBadges.some((s) => !formTags.includes(s.tag)) && (
                  <button
                    type="button"
                    className="notes-context-chip add-all"
                    onClick={() => {
                      suggestedContextBadges.forEach((s) => {
                        if (!formTags.includes(s.tag)) {
                          handleAddTag(s.tag);
                        }
                      });
                    }}
                    title="Add all active scene tags"
                  >
                    <span>+ Add All Scene Tags</span>
                  </button>
                )}
              </div>
            )}

            {/* Tag Chips & Input */}
            <div className="notes-tags-editor">
              <Tag size={13} color="var(--text-muted)" style={{ flexShrink: 0 }} />
              <div className="notes-tags-container">
                {formTags.map((t) => (
                  <span key={t} className="notes-tag-chip editable">
                    <span>#{t}</span>
                    <button
                      type="button"
                      className="notes-tag-remove"
                      onClick={() => handleRemoveTag(t)}
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
                <input
                  type="text"
                  className="notes-tag-input"
                  placeholder="Add tag (press Enter)..."
                  value={newTagInput}
                  onChange={(e) => setNewTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      handleAddTag(newTagInput);
                    }
                  }}
                />
              </div>
            </div>

            {/* Content Textarea */}
            <div className="notes-editor-wrap">
              <textarea
                className="notes-textarea"
                placeholder="Write private notes, scene prompts, dialogue ideas, character secrets, or GM directives here..."
                value={formContent}
                onChange={(e) => setFormContent(e.target.value)}
              />
            </div>

            {/* Footer Status & Save Button */}
            <div className="notes-detail-footer">
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                {formContent.length} chars • {formContent.trim().split(/\s+/).filter(Boolean).length} words
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-amber"
                  onClick={handleSave}
                  disabled={isSaving || (!formTitle.trim() && !formContent.trim())}
                >
                  {isSaving ? "Saving..." : isCreatingNew ? "Create Note" : "Save Changes"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
