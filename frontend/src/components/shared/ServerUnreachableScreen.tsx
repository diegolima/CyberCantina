import React, { useEffect } from "react";
import { Flame, RefreshCw, WifiOff } from "lucide-react";

export interface ServerUnreachableScreenProps {
  retrying: boolean;
  detail?: string | null;
  onRetry: () => void;
}

export const ServerUnreachableScreen: React.FC<ServerUnreachableScreenProps> = ({
  retrying,
  detail = null,
  onRetry,
}) => {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleOnline = () => {
      onRetry();
    };
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("online", handleOnline);
    };
  }, [onRetry]);

  return (
    <div className="auth-stage-backdrop">
      <main
        className="modal-panel"
        style={{
          maxWidth: 440,
          width: "100%",
          padding: "28px 24px",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
        }}
        role="status"
        aria-live="polite"
      >
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: 12,
            background: "var(--amber-bg)",
            border: "1px solid var(--amber-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
          }}
          aria-hidden="true"
        >
          <Flame size={24} color="var(--accent-amber)" />
          <WifiOff
            size={13}
            color="var(--accent-amber)"
            style={{ position: "absolute", right: 5, bottom: 5 }}
          />
        </div>

        <h1
          style={{
            margin: 0,
            fontSize: "1.15rem",
            fontWeight: 600,
            color: "var(--text-primary)",
          }}
        >
          Cannot reach CyberCantina server
        </h1>

        <p
          style={{
            margin: 0,
            fontSize: "0.88rem",
            lineHeight: 1.5,
            color: "var(--text-secondary)",
          }}
        >
          Campaigns, CARE state, and AI inference require an active connection to your
          CyberCantina server. Check your network or server status and try again.
        </p>

        {detail && (
          <div
            style={{
              width: "100%",
              fontSize: "0.76rem",
              color: "var(--text-muted)",
              background: "var(--surface-glass-1)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 6,
              padding: "6px 10px",
              wordBreak: "break-word",
            }}
          >
            {detail}
          </div>
        )}

        <button
          type="button"
          className="btn btn-amber"
          onClick={onRetry}
          disabled={retrying}
          style={{ marginTop: 4, minWidth: 160 }}
        >
          <RefreshCw size={14} className={retrying ? "spin" : ""} aria-hidden="true" />
          <span>{retrying ? "Connecting…" : "Retry Connection"}</span>
        </button>
      </main>
    </div>
  );
};
