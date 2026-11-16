import React, { useEffect, useMemo, useState } from "react";
import {
  AlertOctagon,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Info,
  X,
} from "lucide-react";
import type { MessageUrgency, PublicAdminMessage } from "../../types";
import {
  type AdminMessageSurface,
  dismissAdminMessageInStorage,
  getVisibleAdminMessages,
  pruneAdminMessageStateStorage,
  toggleAdminMessageCollapsedInStorage,
} from "../../utils/adminMessageState";

export interface AdminMessageBannerListProps {
  messages: PublicAdminMessage[];
  surface: AdminMessageSurface;
  userId?: string | null;
  className?: string;
}

const URL_TOKEN_RE = /(https?:\/\/[^\s<>"']+)/g;

function renderSafeMessageLine(line: string, lineIdx: number): React.ReactNode {
  const parts = line.split(URL_TOKEN_RE);
  return (
    <React.Fragment key={lineIdx}>
      {parts.map((part, idx) => {
        if (idx % 2 === 1 && /^https?:\/\//i.test(part)) {
          let url = part;
          let trailing = "";
          while (url.length > 0 && /[.,;:!?)]$/.test(url)) {
            trailing = url.slice(-1) + trailing;
            url = url.slice(0, -1);
          }
          if (url) {
            return (
              <React.Fragment key={idx}>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="admin-msg-link"
                >
                  {url}
                </a>
                {trailing}
              </React.Fragment>
            );
          }
        }
        return <React.Fragment key={idx}>{part}</React.Fragment>;
      })}
    </React.Fragment>
  );
}

function renderSafeMessageBody(text: string): React.ReactNode {
  const lines = text.split("\n");
  return lines.map((line, idx) => (
    <React.Fragment key={idx}>
      {renderSafeMessageLine(line, idx)}
      {idx < lines.length - 1 ? "\n" : null}
    </React.Fragment>
  ));
}

function renderUrgencyIcon(urgency: MessageUrgency): React.ReactNode {
  if (urgency === "critical") {
    return <AlertOctagon size={16} className="admin-msg-icon" aria-hidden="true" />;
  }
  if (urgency === "warning") {
    return <AlertTriangle size={16} className="admin-msg-icon" aria-hidden="true" />;
  }
  return <Info size={16} className="admin-msg-icon" aria-hidden="true" />;
}

export const AdminMessageBannerList: React.FC<AdminMessageBannerListProps> = ({
  messages,
  surface,
  userId = null,
  className = "",
}) => {
  const [stateEpoch, setStateEpoch] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    pruneAdminMessageStateStorage(messages, surface, userId);
    setNowMs(Date.now());
  }, [messages, surface, userId]);

  useEffect(() => {
    const currentNow = Date.now();
    let nearestExpMs: number | null = null;
    for (const msg of messages) {
      if (!msg.expires_at) continue;
      const expMs = Date.parse(msg.expires_at);
      if (Number.isFinite(expMs) && expMs > currentNow) {
        if (nearestExpMs === null || expMs < nearestExpMs) {
          nearestExpMs = expMs;
        }
      }
    }
    if (nearestExpMs === null) return;
    const delayMs = Math.min(nearestExpMs - currentNow + 250, 2_147_483_647);
    const timer = window.setTimeout(() => {
      setNowMs(Date.now());
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [messages, nowMs]);

  const visibleMessages = useMemo(
    () => getVisibleAdminMessages(messages, surface, userId, undefined, nowMs),
    [messages, surface, userId, stateEpoch, nowMs]
  );

  if (visibleMessages.length === 0) {
    return null;
  }

  const handleToggleCollapse = (
    msg: PublicAdminMessage & { collapsed: boolean }
  ) => {
    toggleAdminMessageCollapsedInStorage(msg, !msg.collapsed, surface, userId);
    setStateEpoch((v) => v + 1);
  };

  const handleDismiss = (
    e: React.MouseEvent,
    msg: PublicAdminMessage & { collapsed: boolean }
  ) => {
    e.stopPropagation();
    dismissAdminMessageInStorage(msg, surface, userId);
    setStateEpoch((v) => v + 1);
  };

  return (
    <div
      className={`admin-msg-stack ${className}`.trim()}
      role="region"
      aria-label="Administrator announcements"
    >
      {visibleMessages.map((msg) => {
        const isExpanded = !msg.collapsed;
        const urgencyClass = `is-${msg.urgency}`;
        if (!isExpanded) {
          return (
            <div
              key={msg.id}
              className={`admin-msg-card ${urgencyClass} is-collapsed`}
            >
              <button
                type="button"
                className="admin-msg-collapsed-bar"
                aria-expanded={false}
                onClick={() => handleToggleCollapse(msg)}
                title={`Expand announcement: ${msg.title}`}
              >
                {renderUrgencyIcon(msg.urgency)}
                <span className="admin-msg-title">{msg.title}</span>
                <ChevronDown
                  size={15}
                  className="admin-msg-chevron"
                  aria-hidden="true"
                />
              </button>
            </div>
          );
        }

        return (
          <div
            key={msg.id}
            className={`admin-msg-card ${urgencyClass}`}
            role={msg.urgency === "critical" ? "alert" : "status"}
          >
            <div className="admin-msg-header-row">
              <button
                type="button"
                className="admin-msg-header-btn"
                aria-expanded={true}
                onClick={() => handleToggleCollapse(msg)}
                title={`Collapse announcement: ${msg.title}`}
              >
                {renderUrgencyIcon(msg.urgency)}
                <span className="admin-msg-title">{msg.title}</span>
                <ChevronUp
                  size={15}
                  className="admin-msg-chevron"
                  aria-hidden="true"
                />
              </button>
              {msg.dismissable && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm admin-msg-dismiss-btn"
                  onClick={(e) => handleDismiss(e, msg)}
                  aria-label={`Dismiss announcement: ${msg.title}`}
                  title="Dismiss"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="admin-msg-body">{renderSafeMessageBody(msg.message)}</div>
          </div>
        );
      })}
    </div>
  );
};
