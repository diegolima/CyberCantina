import React from "react";
import { Cpu } from "lucide-react";
import { useOptionalLocalRelay } from "../providers/LocalRelayContext";

export const RelaySidebarBadge: React.FC<{ compact?: boolean }> = ({
  compact = false,
}) => {
  const relay = useOptionalLocalRelay();
  if (!relay || !relay.hasBrowserProviders) return null;
  const connected = relay.wsState === "connected";
  const statusTitle = relay.webgpuLoadedModel
    ? `Browser relay ${relay.wsState} · WebGPU loaded: ${relay.webgpuLoadedModel}`
    : `Browser inference relay: ${relay.wsState}`;

  if (compact) {
    return (
      <div
        className={`relay-status-pill relay-status-pill--compact ${
          connected ? "connected" : "offline"
        }`}
        title={statusTitle}
        aria-label={statusTitle}
      >
        <Cpu size={14} />
      </div>
    );
  }

  return (
    <div
      className={`relay-status-pill ${connected ? "connected" : "offline"}`}
      title={statusTitle}
    >
      <Cpu size={13} />
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {relay.webgpuLoadedModel
          ? `GPU: ${relay.webgpuLoadedModel.split("-q4")[0]}`
          : connected
            ? "Browser Relay Ready"
            : `Relay ${relay.wsState}…`}
      </span>
      {relay.webgpuLoadedModel && (
        <button
          type="button"
          className="btn btn-ghost"
          style={{ padding: "1px 5px", fontSize: "0.66rem" }}
          onClick={() => void relay.unloadWebGpu()}
          title="Unload WebGPU model from browser VRAM"
        >
          Unload
        </button>
      )}
    </div>
  );
};
