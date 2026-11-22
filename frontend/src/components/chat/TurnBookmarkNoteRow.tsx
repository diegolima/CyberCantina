import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bookmark, Check, Edit3, Trash2, X } from "lucide-react";
import type {
  MagicWandStatus,
  TurnNodeRecord,
  UseMagicWandReturn,
} from "../../types";
import { MagicWandButton } from "../MagicWandButton";

export interface TurnBookmarkNoteRowProps {
  turn: TurnNodeRecord;
  onSaveNote: (turnId: string, note: string | null) => Promise<void>;
  onSummarizeTurn?: (turnId: string, signal?: AbortSignal) => Promise<string>;
  /** Optional initial edit state (helpful for SSR unit tests). */
  initialEditing?: boolean;
}

export const TurnBookmarkNoteRow: React.FC<TurnBookmarkNoteRowProps> = ({
  turn,
  onSaveNote,
  onSummarizeTurn,
  initialEditing = false,
}) => {
  const savedNote = turn.user_note?.trim() ?? "";
  const [isEditing, setIsEditing] = useState(initialEditing);
  const [draft, setDraft] = useState(savedNote);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Local MagicWand controller state calling the Clerk single-turn summarizer
  const [wandStatus, setWandStatus] = useState<MagicWandStatus>("idle");
  const [wandError, setWandError] = useState<string | null>(null);
  const [wandSnapshot, setWandSnapshot] = useState<{
    originalText: string;
    appliedText: string;
  } | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    if (!isEditing) {
      setDraft(savedNote);
    }
  }, [savedNote, isEditing]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, []);

  const resetWand = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setWandStatus("idle");
    setWandError(null);
    setWandSnapshot(null);
  }, []);

  const handleOpenEditor = () => {
    setDraft(savedNote);
    setSaveError(null);
    resetWand();
    setIsEditing(true);
  };

  const handleCancel = () => {
    resetWand();
    setSaveError(null);
    setDraft(savedNote);
    setIsEditing(false);
  };

  const handleCommit = async (nextText: string | null) => {
    if (isSaving) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const cleaned = nextText?.trim() || null;
      await onSaveNote(turn.id, cleaned);
      resetWand();
      setIsEditing(false);
    } catch (err: unknown) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to save bookmark note."
      );
    } finally {
      setIsSaving(false);
    }
  };

  const wand: UseMagicWandReturn = useMemo(() => {
    const canEnrich =
      Boolean(onSummarizeTurn) && !isSaving && wandStatus !== "enriching";
    const canRevert = wandStatus === "applied" && wandSnapshot !== null;
    const isDirtyAfterApply =
      wandStatus === "applied" &&
      wandSnapshot !== null &&
      draft !== wandSnapshot.appliedText;

    return {
      status: wandStatus,
      error: wandError,
      canEnrich,
      canRevert,
      isDirtyAfterApply,
      triggerEnrich: async () => {
        if (!onSummarizeTurn || isSaving || wandStatus === "enriching") return;
        if (abortRef.current) {
          abortRef.current.abort();
        }
        const controller = new AbortController();
        abortRef.current = controller;
        const reqId = ++reqIdRef.current;
        const originalText = draft;
        setWandStatus("enriching");
        setWandError(null);
        setSaveError(null);

        try {
          const summary = await onSummarizeTurn(turn.id, controller.signal);
          if (reqId !== reqIdRef.current) return;
          setWandSnapshot({ originalText, appliedText: summary });
          setWandStatus("applied");
          setDraft(summary);
        } catch (err: unknown) {
          if (reqId !== reqIdRef.current) return;
          if (err instanceof Error && err.name === "AbortError") {
            return;
          }
          setWandStatus("error");
          setWandError(
            err instanceof Error ? err.message : "Clerk summary failed."
          );
        } finally {
          if (reqId === reqIdRef.current) {
            abortRef.current = null;
          }
        }
      },
      cancelEnrich: () => {
        if (abortRef.current) {
          abortRef.current.abort();
          abortRef.current = null;
        }
        setWandStatus("idle");
        setWandError(null);
      },
      revert: () => {
        if (wandSnapshot) {
          setDraft(wandSnapshot.originalText);
        }
        setWandSnapshot(null);
        setWandStatus("idle");
        setWandError(null);
      },
      dismissUndo: () => {
        setWandSnapshot(null);
        setWandStatus("idle");
        setWandError(null);
      },
      reset: resetWand,
    };
  }, [
    draft,
    isSaving,
    onSummarizeTurn,
    resetWand,
    turn.id,
    wandError,
    wandSnapshot,
    wandStatus,
  ]);

  if (isEditing) {
    return (
      <div
        className="turn-bookmark-note-row"
        data-bookmark-note-editor={turn.id}
      >
        <div className="turn-bookmark-note-editor">
          <Bookmark
            size={13}
            color="var(--accent-purple, #c084fc)"
            fill="currentColor"
            style={{ flexShrink: 0 }}
          />
          <input
            ref={inputRef}
            type="text"
            className="turn-bookmark-note-input"
            value={draft}
            maxLength={500}
            disabled={isSaving}
            placeholder="Add personal bookmark note (never sent to LLM)..."
            aria-label="Bookmark note"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleCommit(draft);
              } else if (e.key === "Escape") {
                e.preventDefault();
                handleCancel();
              }
            }}
          />
          {onSummarizeTurn && (
            <MagicWandButton
              wand={wand}
              isInputEmpty={!draft.trim()}
              isSlashCommand={false}
              variant="compact"
              compactLabel="Summarize turn with Clerk"
              iconAccent="violet"
            />
          )}
          <button
            type="button"
            className="btn turn-bookmark-note-save-btn"
            disabled={isSaving}
            onClick={() => void handleCommit(draft)}
            title="Save bookmark note"
            aria-label="Save bookmark note"
          >
            <Check size={12} />
            <span>{isSaving ? "Saving..." : "Save"}</span>
          </button>
          {savedNote && (
            <button
              type="button"
              className="btn btn-ghost turn-bookmark-note-action-btn"
              disabled={isSaving}
              onClick={() => void handleCommit(null)}
              title="Clear saved bookmark note"
              aria-label="Clear saved bookmark note"
            >
              <Trash2 size={12} />
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost turn-bookmark-note-action-btn"
            disabled={isSaving}
            onClick={handleCancel}
            title="Cancel editing bookmark note"
            aria-label="Cancel editing bookmark note"
          >
            <X size={12} />
          </button>
        </div>
        {(saveError || wandError) && (
          <div className="turn-bookmark-note-error" role="alert">
            {saveError || wandError}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="turn-bookmark-note-row" data-bookmark-note-row={turn.id}>
      {savedNote ? (
        <div className="turn-bookmark-note-display">
          <Bookmark
            size={12}
            color="var(--accent-purple, #c084fc)"
            fill="currentColor"
            style={{ flexShrink: 0 }}
          />
          <span className="turn-bookmark-note-text">{savedNote}</span>
          <button
            type="button"
            className="turn-bookmark-note-edit-btn"
            onClick={handleOpenEditor}
            title="Edit bookmark note"
            aria-label="Edit bookmark note"
          >
            <Edit3 size={11} />
            <span>Edit</span>
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="turn-bookmark-add-note-btn"
          onClick={handleOpenEditor}
          title="Add a personal note to this bookmarked turn (never injected into LLM context)"
        >
          <Bookmark size={12} color="var(--accent-purple, #c084fc)" />
          <span>Add bookmark note</span>
        </button>
      )}
    </div>
  );
};
