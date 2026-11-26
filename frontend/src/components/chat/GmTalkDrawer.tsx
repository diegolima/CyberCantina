import React, { useEffect, useRef } from "react";
import {
  AlertTriangle,
  AtSign,
  BookPlus,
  Check,
  ChevronDown,
  Compass,
  Copy,
  Info,
  Loader2,
  Lock,
  Maximize2,
  Minimize2,
  Shield,
  Trash2,
  X,
} from "lucide-react";
import type {
  GmChatMessage,
  GmSourceRef,
  MechanicsTopicId,
  WorldLoreNodeDraft,
} from "../../types";
import type { GmModelMeta } from "../../hooks/useGmTalk";
import { GM_GREETING_MESSAGE, GM_NAME } from "../../utils/gmMentions";
import { MechanicsHelpButton } from "../shared/MechanicsHelpButton";
import { getMechanicsArticle } from "../world/mechanics/mechanicsHelpers";
import { GmCodexProposalCard } from "./GmCodexProposalCard";
import { GmMarkdown } from "./GmMarkdown";

export interface GmTalkDrawerProps {
  drawerRef?: React.RefObject<HTMLElement>;
  campaignTitle: string;
  worldName: string;
  unlockLore: boolean;
  isClosing: boolean;
  isExpanded: boolean;
  isCampaignStreaming: boolean;
  messages: GmChatMessage[];
  isLoading: boolean;
  isStreaming: boolean;
  streamingText: string;
  streamingSources: GmSourceRef[];
  toolStatus?: string | null;
  toolNotice?: string | null;
  error: string | null;
  clearConfirm: boolean;
  isClearing: boolean;
  copiedId: string | null;
  expandedSources: Record<string, boolean>;
  modelMeta: GmModelMeta | null;
  draftingMessageId?: string | null;
  savingProposalId?: string | null;
  proposalErrors?: Record<string, string>;
  onInsertAtTrigger: () => void;
  onClearChat: () => void;
  onCopyMessage: (id: string, content: string) => void;
  onToggleSources: (id: string) => void;
  onDraftCodexEntry?: (messageId: string) => void;
  onConfirmCodexProposal?: (
    messageId: string,
    proposalId: string,
    draft: WorldLoreNodeDraft,
    replaceLoreId: string | null
  ) => void;
  onCancelCodexProposal?: (messageId: string, proposalId: string) => void;
  onOpenCodex?: () => void;
  onOpenMechanicsHelp?: (topicId: MechanicsTopicId) => void;
  onDismissToolNotice?: () => void;
  onDismissError: () => void;
  onToggleExpanded: () => void;
  onMinimize: () => void;
}

export const GmTalkDrawer: React.FC<GmTalkDrawerProps> = ({
  drawerRef,
  campaignTitle,
  worldName,
  unlockLore,
  isClosing,
  isExpanded,
  isCampaignStreaming,
  messages,
  isLoading,
  isStreaming,
  streamingText,
  streamingSources,
  toolStatus = null,
  toolNotice = null,
  error,
  clearConfirm,
  isClearing,
  copiedId,
  expandedSources,
  modelMeta,
  draftingMessageId = null,
  savingProposalId = null,
  proposalErrors = {},
  onInsertAtTrigger,
  onClearChat,
  onCopyMessage,
  onToggleSources,
  onDraftCodexEntry,
  onConfirmCodexProposal,
  onCancelCodexProposal,
  onOpenCodex,
  onOpenMechanicsHelp,
  onDismissToolNotice,
  onDismissError,
  onToggleExpanded,
  onMinimize,
}) => {
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = messagesEndRef.current;
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages.length, streamingText, isStreaming]);

  const panelClasses = [
    "gm-slideout-panel",
    isExpanded ? "gm-slideout-panel--expanded" : "",
    isClosing ? "gm-slideout-panel--closing" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const renderSourceChip = (src: GmSourceRef, idx: number) => {
    const key = `${src.kind}:${src.id}:${idx}`;
    const isClickableMechanic =
      src.kind === "mechanic" &&
      Boolean(onOpenMechanicsHelp) &&
      Boolean(getMechanicsArticle(src.id as MechanicsTopicId));
    if (isClickableMechanic && onOpenMechanicsHelp) {
      return (
        <button
          key={key}
          type="button"
          className="gm-source-chip gm-source-chip--interactive"
          onClick={() => onOpenMechanicsHelp(src.id as MechanicsTopicId)}
          title={`Open ${src.label} in Game Mechanics`}
        >
          {src.kind}: {src.label}
        </button>
      );
    }
    return (
      <span key={key} className="gm-source-chip">
        {src.kind}: {src.label}
      </span>
    );
  };

  return (
    <section
      ref={drawerRef}
      className={panelClasses}
      role="region"
      aria-label={`${GM_NAME} — GM Talk`}
    >
      {/* Header Bar */}
      <div className="gm-slideout-header">
        <div className="gm-talk-header-title">
          <Compass size={16} color="var(--accent-violet)" />
          <div className="gm-talk-header-meta">
            <strong>{GM_NAME} · GM Talk</strong>
            <span>
              {campaignTitle} · {worldName}
            </span>
          </div>
        </div>

        <div className="gm-talk-header-actions">
          <span
            className={`gm-spoiler-pill ${
              unlockLore
                ? "gm-spoiler-pill--unlocked"
                : "gm-spoiler-pill--safe"
            }`}
            title={
              unlockLore
                ? "Unlock Lore & Secrets (GM Mode) is enabled in World Settings — secrets and private cognitions are visible."
                : "Spoiler-Safe Mode — unrevealed secrets, unvisited areas, and private character cognitions are hidden."
            }
          >
            {unlockLore ? <Shield size={11} /> : <Lock size={11} />}
            {unlockLore ? (
              <span>
                GM Mode<span className="gm-spoiler-pill-detail"> · Secrets Unlocked</span>
              </span>
            ) : (
              <span>Spoiler-Safe</span>
            )}
          </span>

          {modelMeta?.modelName && (
            <span
              className="gm-model-pill"
              title={`Role: ${modelMeta.role} · Temp ${modelMeta.temperature} · Max ${modelMeta.maxTokens} tok${modelMeta.toolsEnabled ? " · Tools ON" : ""}`}
            >
              {modelMeta.role === "clerk" ? "Clerk" : "Primary"} ·{" "}
              {modelMeta.modelName}
              {modelMeta.toolsEnabled ? " · Tools" : ""}
            </span>
          )}

          <MechanicsHelpButton
            topicId="gm-neuromancer"
            label="GM Talk (Neuromancer)"
            onOpenHelp={onOpenMechanicsHelp}
          />

          <button
            type="button"
            className={`btn gm-clear-btn ${
              clearConfirm ? "gm-clear-btn--confirm" : ""
            }`}
            disabled={isStreaming || isClearing || messages.length === 0}
            onClick={onClearChat}
            aria-label={clearConfirm ? "Confirm Clear GM Chat" : "Clear GM Chat"}
            title="Clear GM chat messages on the active branch"
          >
            <Trash2 size={12} />
            {isClearing ? (
              <span>Clearing…</span>
            ) : clearConfirm ? (
              <span>Confirm Clear?</span>
            ) : (
              <span className="gm-clear-btn-label">Clear Chat</span>
            )}
          </button>

          <button
            type="button"
            className="btn gm-slideout-icon-btn"
            onClick={onToggleExpanded}
            aria-label={isExpanded ? "Restore 50% height" : "Expand GM Talk"}
            title={isExpanded ? "Restore 50% height" : "Expand GM Talk"}
          >
            {isExpanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>

          <button
            type="button"
            className="btn gm-slideout-icon-btn"
            onClick={onMinimize}
            aria-label="Minimize GM Talk"
            title="Minimize GM Talk (Esc)"
          >
            <ChevronDown size={15} />
          </button>
        </div>
      </div>

      {/* Scrollable Conversation Body */}
      <div className="gm-talk-messages">
        {isLoading && messages.length === 0 ? (
          <div className="gm-talk-loading">
            <Loader2 size={16} className="spinning" />
            <span>Loading Neuromancer session…</span>
          </div>
        ) : (
          <>
            {messages.length === 0 && !isStreaming && (
              <div className="gm-greeting-card">
                <div className="gm-message-role-row">
                  <Compass size={13} color="var(--accent-violet)" />
                  <strong>{GM_NAME}</strong>
                  <span className="gm-message-role-badge">GM · OOC</span>
                </div>
                <p className="gm-greeting-text">{GM_GREETING_MESSAGE}</p>
                <div className="gm-greeting-tips">
                  <span>
                    Type <code>@</code> in the prompt below to browse{" "}
                    <strong>Characters</strong>, <strong>Lore</strong>,{" "}
                    <strong>Locations</strong>, <strong>Containers</strong>, or{" "}
                    <strong>Turns</strong>.
                  </span>
                  <button
                    type="button"
                    className="btn gm-try-at-btn"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={onInsertAtTrigger}
                  >
                    <AtSign size={12} />
                    <span>Browse @</span>
                  </button>
                </div>
              </div>
            )}

            {messages.map((msg) => {
              const isUser = msg.role === "user";
              const showSources = Boolean(expandedSources[msg.id]);
              return (
                <div
                  key={msg.id}
                  className={`gm-message-card ${
                    isUser ? "gm-message-card--user" : "gm-message-card--gm"
                  }`}
                >
                  <div className="gm-message-header">
                    <div className="gm-message-role-row">
                      {!isUser && (
                        <Compass size={12} color="var(--accent-violet)" />
                      )}
                      <strong>{isUser ? "You (OOC)" : GM_NAME}</strong>
                      {!isUser && (
                        <span className="gm-message-role-badge">GM</span>
                      )}
                    </div>
                    {!isUser && (
                      <div className="gm-message-actions">
                        <button
                          type="button"
                          className="gm-draft-codex-btn"
                          disabled={
                            !onDraftCodexEntry ||
                            isStreaming ||
                            isCampaignStreaming ||
                            Boolean(draftingMessageId)
                          }
                          onClick={() => onDraftCodexEntry?.(msg.id)}
                          title="Draft a World Codex entry from this reply"
                          aria-label="Draft World Codex entry"
                        >
                          {draftingMessageId === msg.id ? (
                            <Loader2 size={12} className="spinning" />
                          ) : (
                            <BookPlus size={12} />
                          )}
                          <span>
                            {draftingMessageId === msg.id
                              ? "Drafting…"
                              : "Draft Codex"}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="gm-copy-btn"
                          onClick={() => onCopyMessage(msg.id, msg.content)}
                          title="Copy reply"
                          aria-label="Copy Neuromancer reply"
                        >
                          {copiedId === msg.id ? (
                            <Check size={12} color="var(--accent-emerald)" />
                          ) : (
                            <Copy size={12} />
                          )}
                        </button>
                      </div>
                    )}
                  </div>

                  {isUser && msg.mentions && msg.mentions.length > 0 && (
                    <div className="gm-message-mentions">
                      {msg.mentions.map((ref) => (
                        <span
                          key={`${ref.kind}:${ref.id}`}
                          className="gm-mention-badge"
                        >
                          @{ref.label}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="gm-message-body">
                    {isUser ? msg.content : <GmMarkdown content={msg.content} />}
                  </div>

                  {!isUser && msg.sources && msg.sources.length > 0 && (
                    <div className="gm-sources-bar">
                      <button
                        type="button"
                        className="gm-sources-toggle"
                        onClick={() => onToggleSources(msg.id)}
                      >
                        Sources used ({msg.sources.length}){" "}
                        {showSources ? "▾" : "▸"}
                      </button>
                      {showSources && (
                        <div className="gm-sources-list">
                          {msg.sources.map(renderSourceChip)}
                        </div>
                      )}
                    </div>
                  )}

                  {!isUser && msg.proposals && msg.proposals.length > 0 && (
                    <div className="gm-codex-proposals-stack">
                      {msg.proposals.map((prop) => (
                        <GmCodexProposalCard
                          key={prop.id}
                          proposal={prop}
                          unlockLore={unlockLore}
                          isBusy={savingProposalId === prop.id}
                          error={proposalErrors[prop.id] ?? null}
                          onConfirm={(draft, replaceLoreId) =>
                            onConfirmCodexProposal?.(
                              msg.id,
                              prop.id,
                              draft,
                              replaceLoreId
                            )
                          }
                          onCancel={() =>
                            onCancelCodexProposal?.(msg.id, prop.id)
                          }
                          onOpenCodex={onOpenCodex}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {isStreaming && (
              <div className="gm-message-card gm-message-card--gm gm-message-card--streaming">
                <div className="gm-message-header">
                  <div className="gm-message-role-row">
                    <Compass size={12} color="var(--accent-violet)" />
                    <strong>{GM_NAME}</strong>
                    <span className="gm-message-role-badge">Thinking…</span>
                  </div>
                </div>
                <div className="gm-message-body">
                  {streamingText ? (
                    <GmMarkdown content={streamingText} />
                  ) : toolStatus ? (
                    <div className="gm-tool-status-pill" role="status" aria-live="polite">
                      <Loader2 size={12} className="spinning" />
                      <span>{toolStatus}</span>
                    </div>
                  ) : (
                    "Consulting campaign records…"
                  )}
                </div>
                {streamingSources.length > 0 && (
                  <div className="gm-sources-bar">
                    <div className="gm-sources-list">
                      {streamingSources.map(renderSourceChip)}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Inline Notice / Error / Streaming Guard Banners */}
      {toolNotice && (
        <div className="gm-talk-notice" role="status">
          <Info size={13} />
          <span>{toolNotice}</span>
          {onDismissToolNotice && (
            <button
              type="button"
              className="gm-notice-dismiss"
              onClick={onDismissToolNotice}
              aria-label="Dismiss notice"
            >
              <X size={12} />
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="gm-talk-error" role="alert">
          <AlertTriangle size={13} />
          <span>{error}</span>
          <button
            type="button"
            className="gm-error-dismiss"
            onClick={onDismissError}
            aria-label="Dismiss error"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {isCampaignStreaming && (
        <div className="gm-talk-streaming-guard">
          Campaign turn in progress — wait for it to finish before asking{" "}
          {GM_NAME}.
        </div>
      )}
    </section>
  );
};
