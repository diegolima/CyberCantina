import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import {
  EnrichFieldRole,
  EnrichInstruction,
  MagicContextRef,
  MagicWandStatus,
  UseMagicWandReturn,
} from "../types";

export interface UseMagicWandOptions {
  fieldRole: EnrichFieldRole;
  value: string;
  onChange: (nextValue: string) => void;
  contextRef: MagicContextRef;
  contextKey: string;
  disabled?: boolean;
  singleLine?: boolean;
  maxWords?: number;
}

export function useMagicWand({
  fieldRole,
  value,
  onChange,
  contextRef,
  contextKey,
  disabled = false,
  singleLine = false,
  maxWords = 120,
}: UseMagicWandOptions): UseMagicWandReturn {
  const [status, setStatus] = useState<MagicWandStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<{
    originalText: string;
    appliedText: string;
  } | null>(null);

  const activeAbortRef = useRef<AbortController | null>(null);
  const activeReqIdRef = useRef<number>(0);
  const currentKeyRef = useRef<string>(contextKey);

  // Invalidate when contextKey (turn leaf, campaign, or location override) changes
  useEffect(() => {
    if (currentKeyRef.current !== contextKey) {
      currentKeyRef.current = contextKey;
      if (activeAbortRef.current) {
        activeAbortRef.current.abort();
        activeAbortRef.current = null;
      }
      setStatus("idle");
      setError(null);
      setSnapshot(null);
    }
  }, [contextKey]);

  useEffect(() => {
    return () => {
      if (activeAbortRef.current) {
        activeAbortRef.current.abort();
      }
    };
  }, []);

  const isSlashCommand = value.trim().startsWith("/");
  const canEnrich = !disabled && status !== "enriching" && !isSlashCommand;
  const canRevert = status === "applied" && snapshot !== null;
  const isDirtyAfterApply =
    status === "applied" && snapshot !== null && value !== snapshot.appliedText;

  const triggerEnrich = useCallback(
    async (instruction: EnrichInstruction = "auto") => {
      if (!canEnrich) return;

      if (activeAbortRef.current) {
        activeAbortRef.current.abort();
      }
      const controller = new AbortController();
      activeAbortRef.current = controller;
      const reqId = ++activeReqIdRef.current;

      const originalText = value;
      setStatus("enriching");
      setError(null);

      try {
        const res = await api.enrichPrompt(
          {
            field_role: fieldRole,
            current_text: originalText,
            instruction,
            context_ref: contextRef,
            single_line: singleLine,
            max_words: maxWords,
          },
          controller.signal
        );

        if (reqId !== activeReqIdRef.current) return;

        setSnapshot({
          originalText,
          appliedText: res.enriched_text,
        });
        setStatus("applied");
        onChange(res.enriched_text);
      } catch (err: unknown) {
        if (reqId !== activeReqIdRef.current) return;
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }
        setStatus("error");
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (reqId === activeReqIdRef.current) {
          activeAbortRef.current = null;
        }
      }
    },
    [canEnrich, value, fieldRole, contextRef, singleLine, maxWords, onChange]
  );

  const cancelEnrich = useCallback(() => {
    if (activeAbortRef.current) {
      activeAbortRef.current.abort();
      activeAbortRef.current = null;
    }
    setStatus("idle");
    setError(null);
  }, []);

  const revert = useCallback(() => {
    if (snapshot) {
      onChange(snapshot.originalText);
    }
    setSnapshot(null);
    setStatus("idle");
    setError(null);
  }, [snapshot, onChange]);

  const dismissUndo = useCallback(() => {
    setSnapshot(null);
    setStatus("idle");
    setError(null);
  }, []);

  const reset = useCallback(() => {
    if (activeAbortRef.current) {
      activeAbortRef.current.abort();
      activeAbortRef.current = null;
    }
    setSnapshot(null);
    setStatus("idle");
    setError(null);
  }, []);

  return {
    status,
    error,
    canEnrich,
    canRevert,
    isDirtyAfterApply,
    triggerEnrich,
    cancelEnrich,
    revert,
    dismissUndo,
    reset,
  };
}
