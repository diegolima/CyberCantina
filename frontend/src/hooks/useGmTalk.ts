import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { gmApi } from "../api/gm";
import type {
  CampaignStateBundle,
  GmChatMessage,
  GmCodexProposal,
  GmMentionCandidate,
  GmMentionCategory,
  GmMentionRef,
  GmModelRole,
  GmSourceRef,
  WorldLoreNodeDraft,
} from "../types";
import {
  applyCategoryDrilldown,
  detectGmMentionTrigger,
  GM_MENTION_CATEGORIES,
  insertGmMentionToken,
  MAX_GM_PINNED_MENTIONS,
  removePinnedMentionFromDraft,
  shouldPopCategoryToBrowse,
  syncPinnedMentionsWithText,
  type GmMentionTrigger,
} from "../utils/gmMentions";

const MINIMIZE_ANIMATION_MS = 190;

export interface UseGmTalkOptions {
  campaignId: string;
  activeLeafTurnId: string | null;
  unlockLore: boolean;
  isCampaignStreaming: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  onCampaignBundleChange?: (bundle: CampaignStateBundle) => void;
}

export interface GmModelMeta {
  role: GmModelRole;
  modelName: string;
  temperature: number;
  maxTokens: number;
}

export interface UseGmTalkReturn {
  isOpen: boolean;
  isClosing: boolean;
  isExpanded: boolean;
  isModeActive: boolean;
  messages: GmChatMessage[];
  isLoading: boolean;
  isStreaming: boolean;
  streamingText: string;
  streamingSources: GmSourceRef[];
  error: string | null;
  clearConfirm: boolean;
  isClearing: boolean;
  copiedId: string | null;
  expandedSources: Record<string, boolean>;
  modelMeta: GmModelMeta | null;
  draftingMessageId: string | null;
  savingProposalId: string | null;
  proposalErrors: Record<string, string>;
  draftText: string;
  pinnedMentions: GmMentionRef[];
  mentionTrigger: GmMentionTrigger | null;
  mentionPopoverOpen: boolean;
  mentionItems: GmMentionCandidate[];
  mentionLoading: boolean;
  mentionSelectedIndex: number;
  open: (initialMessage?: string | null) => void;
  minimize: () => void;
  toggle: () => void;
  toggleExpanded: () => void;
  dismissError: () => void;
  setMentionSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  handleDraftChange: (nextText: string, cursorPos: number) => void;
  handleDraftCursorChange: (cursorPos: number) => void;
  handleSelectCategory: (category: GmMentionCategory) => void;
  handleSelectCandidate: (candidate: GmMentionCandidate) => void;
  handlePopCategoryToBrowse: () => boolean;
  dismissMentionPopover: () => void;
  handleRemovePinnedMention: (ref: GmMentionRef) => void;
  insertAtTrigger: () => void;
  sendMessage: (
    overrideText?: string,
    overrideMentions?: GmMentionRef[]
  ) => Promise<void>;
  stopStreaming: () => void;
  handleClearChat: () => Promise<void>;
  copyMessage: (id: string, content: string) => void;
  toggleSources: (id: string) => void;
  draftCodexEntry: (messageId: string) => Promise<void>;
  confirmCodexProposal: (
    messageId: string,
    proposalId: string,
    draft: WorldLoreNodeDraft,
    replaceLoreId: string | null
  ) => Promise<void>;
  cancelCodexProposal: (messageId: string, proposalId: string) => Promise<void>;
}

export function useGmTalk({
  campaignId,
  activeLeafTurnId,
  unlockLore,
  isCampaignStreaming,
  textareaRef,
  onCampaignBundleChange,
}: UseGmTalkOptions): UseGmTalkReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const [messages, setMessages] = useState<GmChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [streamingSources, setStreamingSources] = useState<GmSourceRef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedSources, setExpandedSources] = useState<Record<string, boolean>>({});
  const [modelMeta, setModelMeta] = useState<GmModelMeta | null>(null);
  const [draftingMessageId, setDraftingMessageId] = useState<string | null>(null);
  const [savingProposalId, setSavingProposalId] = useState<string | null>(null);
  const [proposalErrors, setProposalErrors] = useState<Record<string, string>>({});

  const [draftText, setDraftText] = useState("");
  const [draftCursorPos, setDraftCursorPos] = useState(0);
  const [pinnedMentions, setPinnedMentions] = useState<GmMentionRef[]>([]);
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const [mentionItems, setMentionItems] = useState<GmMentionCandidate[]>([]);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);

  const closeTimerRef = useRef<number | null>(null);
  const clearTimerRef = useRef<number | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const streamingTextRef = useRef("");
  const isStreamingRef = useRef(false);
  const lastLoadedKeyRef = useRef<string | null>(null);
  const prevCampaignIdRef = useRef(campaignId);
  const isMountedRef = useRef(true);

  const isModeActive = isOpen && !isClosing;

  const focusTextareaAt = useCallback(
    (pos?: number) => {
      window.setTimeout(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        const target = pos ?? el.value.length;
        el.setSelectionRange(target, target);
      }, 0);
    },
    [textareaRef]
  );

  // Cleanup all timers & active SSE stream on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
      if (clearTimerRef.current !== null) {
        window.clearTimeout(clearTimerRef.current);
      }
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      streamAbortRef.current?.abort();
      streamAbortRef.current = null;
    };
  }, []);

  // Reset full GM state when switching campaigns
  useEffect(() => {
    if (prevCampaignIdRef.current === campaignId) return;
    prevCampaignIdRef.current = campaignId;
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    isStreamingRef.current = false;
    streamingTextRef.current = "";
    lastLoadedKeyRef.current = null;

    setIsOpen(false);
    setIsClosing(false);
    setIsExpanded(false);
    setMessages([]);
    setIsLoading(false);
    setIsStreaming(false);
    setStreamingText("");
    setStreamingSources([]);
    setError(null);
    setClearConfirm(false);
    setIsClearing(false);
    setExpandedSources({});
    setModelMeta(null);
    setDraftingMessageId(null);
    setSavingProposalId(null);
    setProposalErrors({});
    setDraftText("");
    setDraftCursorPos(0);
    setPinnedMentions([]);
    setMentionDismissed(false);
    setMentionItems([]);
    setMentionSelectedIndex(0);
  }, [campaignId]);

  // Load branch-filtered GM messages when drawer opens or active branch/unlock_lore changes while open
  const loadKey = `${campaignId}:${activeLeafTurnId ?? "root"}:${unlockLore ? "1" : "0"}`;
  useEffect(() => {
    if (!isOpen) return;
    if (lastLoadedKeyRef.current === loadKey) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    gmApi
      .getGmMessages(campaignId)
      .then((res) => {
        if (cancelled || !isMountedRef.current) return;
        lastLoadedKeyRef.current = loadKey;
        setMessages(res.messages);
        setModelMeta({
          role: res.gm_model_role,
          modelName: res.gm_model_name,
          temperature: res.gm_temperature,
          maxTokens: res.gm_max_tokens,
        });
      })
      .catch((err) => {
        if (cancelled || !isMountedRef.current) return;
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load Neuromancer GM conversation."
        );
      })
      .finally(() => {
        if (!cancelled && isMountedRef.current) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [campaignId, isOpen, loadKey]);

  // Detect active @ mention trigger in GM draft
  const mentionTrigger = useMemo(
    () =>
      isModeActive
        ? detectGmMentionTrigger(draftText, draftCursorPos, pinnedMentions)
        : null,
    [isModeActive, draftText, draftCursorPos, pinnedMentions]
  );

  const mentionPopoverOpen = Boolean(mentionTrigger && !mentionDismissed);

  // Reset highlight index when trigger mode/category/query changes
  useEffect(() => {
    setMentionSelectedIndex(0);
  }, [mentionTrigger?.mode, mentionTrigger?.category, mentionTrigger?.query]);

  // Debounced live search for @category: and @<query> triggers
  useEffect(() => {
    if (
      !mentionPopoverOpen ||
      !mentionTrigger ||
      mentionTrigger.mode === "browse"
    ) {
      setMentionLoading(false);
      if (!mentionPopoverOpen) {
        setMentionItems([]);
      }
      return;
    }

    const controller = new AbortController();
    setMentionLoading(true);
    const timer = window.setTimeout(() => {
      gmApi
        .searchGmMentions(
          campaignId,
          {
            category:
              mentionTrigger.mode === "category"
                ? mentionTrigger.category
                : undefined,
            q: mentionTrigger.query || undefined,
            limit: 16,
          },
          controller.signal
        )
        .then((res) => {
          if (!controller.signal.aborted && isMountedRef.current) {
            setMentionItems(res.items);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted && isMountedRef.current) {
            setMentionItems([]);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted && isMountedRef.current) {
            setMentionLoading(false);
          }
        });
    }, 110);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [campaignId, mentionPopoverOpen, mentionTrigger]);

  const stopStreaming = useCallback(() => {
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    isStreamingRef.current = false;
    setIsStreaming(false);
    setStreamingText("");
    setStreamingSources([]);
  }, []);

  const sendMessage = useCallback(
    async (overrideText?: string, overrideMentions?: GmMentionRef[]) => {
      const text = (overrideText ?? draftText).trim();
      if (!text || isStreamingRef.current || isCampaignStreaming) return;

      const effectiveMentions = overrideMentions
        ? overrideMentions.slice(0, MAX_GM_PINNED_MENTIONS)
        : syncPinnedMentionsWithText(text, pinnedMentions);

      if (overrideText === undefined) {
        setDraftText("");
        setDraftCursorPos(0);
        setPinnedMentions([]);
      }
      setMentionDismissed(false);
      setError(null);
      setClearConfirm(false);

      const optimisticUserId = `gm-temp-user-${Date.now()}`;
      const optimisticUserMsg: GmChatMessage = {
        id: optimisticUserId,
        campaign_id: campaignId,
        anchor_turn_id: activeLeafTurnId,
        role: "user",
        content: text,
        mentions: effectiveMentions,
        sources: [],
        created_at: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, optimisticUserMsg]);
      isStreamingRef.current = true;
      setIsStreaming(true);
      streamingTextRef.current = "";
      setStreamingText("");
      setStreamingSources([]);

      const controller = new AbortController();
      streamAbortRef.current = controller;

      try {
        let receivedDone = false;
        await gmApi.streamGmChat(
          campaignId,
          { message: text, mentions: effectiveMentions },
          {
            onMeta: (meta) => {
              if (!isMountedRef.current) return;
              setModelMeta({
                role: meta.model_role,
                modelName: meta.model,
                temperature: meta.temperature,
                maxTokens: meta.max_tokens,
              });
              const mergedSources: GmSourceRef[] = [
                ...(meta.pinned_mentions || []),
                ...(meta.retrieved_sources || []),
              ];
              setStreamingSources(mergedSources);
            },
            onToken: (delta) => {
              if (!isMountedRef.current) return;
              streamingTextRef.current += delta;
              setStreamingText(streamingTextRef.current);
            },
            onDone: (done) => {
              if (!isMountedRef.current) return;
              receivedDone = true;
              setMessages((prev) => {
                const withoutTemp = prev.filter((m) => m.id !== optimisticUserId);
                return [...withoutTemp, done.user_message, done.assistant_message];
              });
              setStreamingText("");
              setStreamingSources([]);
            },
            onError: (detail) => {
              if (!isMountedRef.current) return;
              setError(detail);
            },
          },
          controller.signal
        );

        if (!receivedDone && !controller.signal.aborted && isMountedRef.current) {
          const partial = streamingTextRef.current.trim();
          if (partial) {
            setMessages((prev) => [
              ...prev,
              {
                id: `gm-partial-${Date.now()}`,
                campaign_id: campaignId,
                anchor_turn_id: activeLeafTurnId,
                role: "assistant",
                content: partial,
                mentions: [],
                sources: [],
                created_at: new Date().toISOString(),
              },
            ]);
          }
        }
      } catch (err) {
        if (controller.signal.aborted || !isMountedRef.current) {
          setMessages((prev) => prev.filter((m) => m.id !== optimisticUserId));
        } else {
          setMessages((prev) => prev.filter((m) => m.id !== optimisticUserId));
          setError(
            err instanceof Error
              ? err.message
              : "Failed to reach Neuromancer."
          );
        }
      } finally {
        if (streamAbortRef.current === controller) {
          streamAbortRef.current = null;
        }
        isStreamingRef.current = false;
        if (isMountedRef.current) {
          setIsStreaming(false);
          setStreamingText("");
          setStreamingSources([]);
        }
      }
    },
    [activeLeafTurnId, campaignId, draftText, isCampaignStreaming, pinnedMentions]
  );

  const open = useCallback(
    (initialMessage?: string | null) => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      setIsClosing(false);
      setIsOpen(true);
      setMentionDismissed(false);

      const trimmed = initialMessage?.trim() ?? "";
      if (trimmed) {
        void sendMessage(trimmed, []);
      }
      focusTextareaAt();
    },
    [focusTextareaAt, sendMessage]
  );

  const minimize = useCallback(() => {
    if (!isOpen || isClosing) return;
    setMentionDismissed(true);
    setClearConfirm(false);
    setIsClosing(true);

    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      if (!isMountedRef.current) return;
      setIsOpen(false);
      setIsClosing(false);
    }, MINIMIZE_ANIMATION_MS);
  }, [isClosing, isOpen]);

  const toggle = useCallback(() => {
    if (isOpen && !isClosing) {
      minimize();
    } else {
      open();
    }
  }, [isClosing, isOpen, minimize, open]);

  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  const handleDraftChange = useCallback((nextText: string, cursorPos: number) => {
    setDraftText(nextText);
    setDraftCursorPos(cursorPos);
    setMentionDismissed(false);
    setPinnedMentions((prev) => syncPinnedMentionsWithText(nextText, prev));
  }, []);

  const handleDraftCursorChange = useCallback((cursorPos: number) => {
    setDraftCursorPos(cursorPos);
  }, []);

  const handleSelectCategory = useCallback(
    (category: GmMentionCategory) => {
      if (!mentionTrigger) return;
      const { nextText, nextCursorPos } = applyCategoryDrilldown(
        draftText,
        mentionTrigger,
        category
      );
      setDraftText(nextText);
      setDraftCursorPos(nextCursorPos);
      setMentionDismissed(false);
      setMentionSelectedIndex(0);
      focusTextareaAt(nextCursorPos);
    },
    [draftText, focusTextareaAt, mentionTrigger]
  );

  const handleSelectCandidate = useCallback(
    (candidate: GmMentionCandidate) => {
      if (!mentionTrigger) return;
      const { nextText, nextCursorPos, mentionRef } = insertGmMentionToken(
        draftText,
        mentionTrigger,
        candidate
      );
      setDraftText(nextText);
      setDraftCursorPos(nextCursorPos);
      setPinnedMentions((prev) =>
        syncPinnedMentionsWithText(nextText, [...prev, mentionRef])
      );
      setMentionDismissed(false);
      setMentionSelectedIndex(0);
      focusTextareaAt(nextCursorPos);
    },
    [draftText, focusTextareaAt, mentionTrigger]
  );

  const handlePopCategoryToBrowse = useCallback((): boolean => {
    const popped = shouldPopCategoryToBrowse(draftText, draftCursorPos);
    if (!popped) return false;
    setDraftText(popped.nextText);
    setDraftCursorPos(popped.nextCursorPos);
    setMentionDismissed(false);
    setMentionSelectedIndex(0);
    focusTextareaAt(popped.nextCursorPos);
    return true;
  }, [draftCursorPos, draftText, focusTextareaAt]);

  const dismissMentionPopover = useCallback(() => {
    setMentionDismissed(true);
  }, []);

  const handleRemovePinnedMention = useCallback(
    (ref: GmMentionRef) => {
      const { nextText, nextMentions } = removePinnedMentionFromDraft(
        draftText,
        pinnedMentions,
        ref
      );
      setDraftText(nextText);
      setDraftCursorPos(nextText.length);
      setPinnedMentions(nextMentions);
    },
    [draftText, pinnedMentions]
  );

  const insertAtTrigger = useCallback(() => {
    const needsSpace = draftText.length > 0 && !/\s$/.test(draftText);
    const nextText = `${draftText}${needsSpace ? " @" : "@"}`;
    const nextPos = nextText.length;
    setDraftText(nextText);
    setDraftCursorPos(nextPos);
    setMentionDismissed(false);
    setMentionSelectedIndex(0);
    focusTextareaAt(nextPos);
  }, [draftText, focusTextareaAt]);

  const handleClearChat = useCallback(async () => {
    if (isStreamingRef.current || isClearing) return;
    if (!clearConfirm) {
      setClearConfirm(true);
      if (clearTimerRef.current !== null) {
        window.clearTimeout(clearTimerRef.current);
      }
      clearTimerRef.current = window.setTimeout(() => {
        clearTimerRef.current = null;
        if (isMountedRef.current) setClearConfirm(false);
      }, 4000);
      return;
    }

    if (clearTimerRef.current !== null) {
      window.clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
    setIsClearing(true);
    setError(null);
    try {
      await gmApi.clearGmMessages(campaignId);
      if (!isMountedRef.current) return;
      setMessages([]);
      setExpandedSources({});
      setProposalErrors({});
      setDraftingMessageId(null);
      setSavingProposalId(null);
      setClearConfirm(false);
    } catch (err) {
      if (!isMountedRef.current) return;
      setError(
        err instanceof Error ? err.message : "Failed to clear GM chat."
      );
    } finally {
      if (isMountedRef.current) {
        setIsClearing(false);
      }
    }
  }, [campaignId, clearConfirm, isClearing]);

  const copyMessage = useCallback((id: string, content: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(content).catch(() => {});
    }
    setCopiedId(id);
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = window.setTimeout(() => {
      copyTimerRef.current = null;
      if (isMountedRef.current) {
        setCopiedId((curr) => (curr === id ? null : curr));
      }
    }, 1500);
  }, []);

  const toggleSources = useCallback((id: string) => {
    setExpandedSources((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const updateProposalInMessage = useCallback(
    (messageId: string, updater: (proposals: GmCodexProposal[]) => GmCodexProposal[]) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, proposals: updater(m.proposals ?? []) }
            : m
        )
      );
    },
    []
  );

  const draftCodexEntry = useCallback(
    async (messageId: string) => {
      if (isStreamingRef.current || isCampaignStreaming || draftingMessageId) return;
      setDraftingMessageId(messageId);
      setError(null);
      try {
        const res = await gmApi.draftGmCodexEntry(campaignId, {
          message_id: messageId,
        });
        if (!isMountedRef.current) return;
        updateProposalInMessage(res.message_id, (existing) => [
          ...existing,
          res.proposal,
        ]);
      } catch (err) {
        if (!isMountedRef.current) return;
        setError(
          err instanceof Error
            ? err.message
            : "Failed to draft a World Codex entry."
        );
      } finally {
        if (isMountedRef.current) {
          setDraftingMessageId(null);
        }
      }
    },
    [campaignId, draftingMessageId, isCampaignStreaming, updateProposalInMessage]
  );

  const confirmCodexProposal = useCallback(
    async (
      messageId: string,
      proposalId: string,
      draft: WorldLoreNodeDraft,
      replaceLoreId: string | null
    ) => {
      if (savingProposalId) return;
      setSavingProposalId(proposalId);
      setProposalErrors((prev) => {
        const next = { ...prev };
        delete next[proposalId];
        return next;
      });
      try {
        const res = await gmApi.saveCampaignWorldLoreEntry(campaignId, {
          draft,
          replace_lore_id: replaceLoreId,
          proposal_message_id: messageId,
          proposal_id: proposalId,
        });
        if (!isMountedRef.current) return;
        updateProposalInMessage(messageId, (existing) =>
          existing.map((prop) =>
            prop.id === proposalId
              ? res.proposal ?? {
                  ...prop,
                  status: "confirmed",
                  draft,
                  replace_lore_id: replaceLoreId,
                  saved_lore_id: res.saved_lore_id,
                }
              : prop
          )
        );
        onCampaignBundleChange?.(res.bundle);
      } catch (err) {
        if (!isMountedRef.current) return;
        const detail =
          err instanceof Error
            ? err.message
            : "Could not save World Codex entry.";
        setProposalErrors((prev) => ({ ...prev, [proposalId]: detail }));
      } finally {
        if (isMountedRef.current) {
          setSavingProposalId(null);
        }
      }
    },
    [campaignId, onCampaignBundleChange, savingProposalId, updateProposalInMessage]
  );

  const cancelCodexProposal = useCallback(
    async (messageId: string, proposalId: string) => {
      if (savingProposalId) return;
      setSavingProposalId(proposalId);
      setProposalErrors((prev) => {
        const next = { ...prev };
        delete next[proposalId];
        return next;
      });
      try {
        const res = await gmApi.cancelGmProposal(campaignId, proposalId);
        if (!isMountedRef.current) return;
        updateProposalInMessage(messageId, (existing) =>
          existing.map((prop) =>
            prop.id === proposalId ? res.proposal : prop
          )
        );
      } catch (err) {
        if (!isMountedRef.current) return;
        const detail =
          err instanceof Error
            ? err.message
            : "Could not dismiss proposal.";
        setProposalErrors((prev) => ({ ...prev, [proposalId]: detail }));
      } finally {
        if (isMountedRef.current) {
          setSavingProposalId(null);
        }
      }
    },
    [campaignId, savingProposalId, updateProposalInMessage]
  );

  // Keep mentionSelectedIndex clamped when candidate list shrinks
  useEffect(() => {
    const maxLen =
      mentionTrigger?.mode === "browse"
        ? GM_MENTION_CATEGORIES.length
        : mentionItems.length;
    if (maxLen > 0 && mentionSelectedIndex >= maxLen) {
      setMentionSelectedIndex(0);
    }
  }, [mentionItems.length, mentionSelectedIndex, mentionTrigger?.mode]);

  return {
    isOpen,
    isClosing,
    isExpanded,
    isModeActive,
    messages,
    isLoading,
    isStreaming,
    streamingText,
    streamingSources,
    error,
    clearConfirm,
    isClearing,
    copiedId,
    expandedSources,
    modelMeta,
    draftingMessageId,
    savingProposalId,
    proposalErrors,
    draftText,
    pinnedMentions,
    mentionTrigger,
    mentionPopoverOpen,
    mentionItems,
    mentionLoading,
    mentionSelectedIndex,
    open,
    minimize,
    toggle,
    toggleExpanded,
    dismissError: () => setError(null),
    setMentionSelectedIndex,
    handleDraftChange,
    handleDraftCursorChange,
    handleSelectCategory,
    handleSelectCandidate,
    handlePopCategoryToBrowse,
    dismissMentionPopover,
    handleRemovePinnedMention,
    insertAtTrigger,
    sendMessage,
    stopStreaming,
    handleClearChat,
    copyMessage,
    toggleSources,
    draftCodexEntry,
    confirmCodexProposal,
    cancelCodexProposal,
  };
}
